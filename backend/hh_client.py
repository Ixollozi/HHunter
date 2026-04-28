"""Клиент публичного API hh.ru (поиск и карточка вакансии). Требуется корректный User-Agent."""

from __future__ import annotations

import html
import json
import random
import re
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .config import settings


def _hh_headers() -> dict[str, str]:
    return {
        "User-Agent": settings.hh_api_user_agent,
        "Accept": "application/json",
    }

def _hh_web_headers() -> dict[str, str]:
    # HH может резать "пустые" юзер-агенты; используем общий, но Accept уже под HTML.
    return {
        "User-Agent": settings.hh_api_user_agent,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }


def _hh_get(path: str, query: list[tuple[str, str]]) -> dict[str, Any]:
    url = f"https://api.hh.ru{path}"
    if query:
        url += "?" + urlencode(query)
    req = Request(url, headers=_hh_headers())
    try:
        with urlopen(req, timeout=30) as resp:  # noqa: S310 — доверенный API hh.ru
            raw = resp.read().decode("utf-8")
    except HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")[:800]
        except Exception:  # noqa: BLE001
            body = ""
        raise RuntimeError(f"hh.ru API ответил с кодом {e.code}: {body or e.reason}") from e
    except URLError as e:
        raise RuntimeError(f"Не удалось связаться с API hh.ru: {e.reason!s}") from e
    return json.loads(raw)


def strip_html(text: str) -> str:
    if not text:
        return ""
    t = re.sub(r"<[^>]+>", " ", text)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _hh_web_get(url: str) -> str:
    """GET HTML (hh.ru веб)."""
    u = str(url or "").strip()
    if not u.startswith("https://"):
        raise ValueError("Некорректный URL для hh web.")
    req = Request(u, headers=_hh_web_headers())
    try:
        with urlopen(req, timeout=35) as resp:  # noqa: S310 — доверенный hh.ru
            raw = resp.read()
            # hh чаще отдаёт utf-8; в редких случаях может быть cp1251. Пробуем мягко.
            try:
                return raw.decode("utf-8")
            except UnicodeDecodeError:
                return raw.decode("cp1251", errors="replace")
    except HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")[:800]
        except Exception:  # noqa: BLE001
            body = ""
        raise RuntimeError(f"hh.ru web ответил с кодом {e.code}: {body or e.reason}") from e
    except URLError as e:
        raise RuntimeError(f"Не удалось связаться с hh.ru (web): {e.reason!s}") from e


def build_hh_web_search_url(cfg_dict: dict[str, Any], *, origin: str = "https://hh.ru") -> str:
    """
    URL веб-выдачи hh.ru (как в браузере) для парсинга SERP.
    Важно: это НЕ api.hh.ru, а /search/vacancy HTML.
    """
    text = (cfg_dict.get("search_text") or "").strip()
    if not text:
        raise ValueError("Укажите текст поиска в разделе «Поиск» и сохраните настройки.")

    q: list[tuple[str, str]] = [("text", text)]
    fields = cfg_dict.get("search_fields") or ["name", "description", "company_name"]
    for f in fields:
        if f in ("name", "company_name", "description"):
            q.append(("search_field", f))

    area = cfg_dict.get("area")
    if area is not None and str(area).strip():
        q.append(("area", str(area).strip()))

    exp = (cfg_dict.get("experience") or "").strip()
    if exp:
        q.append(("experience", exp))

    for emp in cfg_dict.get("employment") or []:
        if emp:
            q.append(("employment", str(emp)))

    for sch in cfg_dict.get("schedule") or []:
        if sch:
            q.append(("schedule", str(sch)))

    per = cfg_dict.get("period")
    if per is not None:
        try:
            q.append(("period", str(int(per))))
        except (TypeError, ValueError):
            pass

    sal = cfg_dict.get("salary")
    if sal is not None and str(sal).strip():
        try:
            q.append(("salary", str(int(sal))))
            # На вебе hh обычно использует currency_code
            cur = str(cfg_dict.get("salary_currency_code") or "RUR").strip().upper() or "RUR"
            q.append(("currency_code", cur))
        except (TypeError, ValueError):
            pass

    if cfg_dict.get("only_with_salary"):
        q.append(("only_with_salary", "true"))

    ob = (cfg_dict.get("order_by") or "publication_time").strip()
    if ob:
        q.append(("order_by", ob))

    base = str(origin or "https://hh.ru").rstrip("/")
    return f"{base}/search/vacancy?{urlencode(q)}"


def collect_vacancy_ids_from_web_serp_html(html_text: str) -> list[str]:
    """
    Очень лёгкий парсер SERP: вытаскивает /vacancy/{id} из HTML.
    Нормализуем и дедуплицируем; сохраняем порядок появления.
    """
    t = str(html_text or "")
    # Встречаются варианты вида /vacancy/12345 и /vacancy/12345?query...
    ids = re.findall(r"/vacancy/(\d{3,})", t)
    out: list[str] = []
    seen: set[str] = set()
    for vid in ids:
        if vid in seen:
            continue
        seen.add(vid)
        out.append(vid)
        if len(out) >= 120:
            break
    return out


def pick_vacancy_id_from_web_serp(cfg_dict: dict[str, Any], exclude_ids: set[str], *, max_pages: int = 3) -> tuple[str | None, dict[str, Any]]:
    """
    Берёт SERP hh.ru (веб) по сохранённым фильтрам, собирает ID, возвращает случайный,
    исключая уже откликнутые. Возвращает (vid, meta).
    meta: { search_url, pages_tried, collected, collected_after_exclude }
    """
    raw = str(cfg_dict.get("search_url") or "").strip()
    if raw:
        # Если сохранён полный URL выдачи — используем его как базовый.
        base_url = raw
    else:
        base_url = build_hh_web_search_url(cfg_dict)
    candidates: list[str] = []
    pages_tried = 0
    collected_total = 0

    for page in range(max(1, int(max_pages or 1))):
        pages_tried += 1
        url = base_url + (("&page=" + str(page)) if page > 0 else "")
        html_page = _hh_web_get(url)
        ids = collect_vacancy_ids_from_web_serp_html(html_page)
        collected_total += len(ids)
        for vid in ids:
            if vid and vid not in exclude_ids and vid not in candidates:
                candidates.append(vid)
        if len(candidates) >= 25:
            break
        # Если на странице совсем нет вакансий — дальше смысла нет
        if not ids:
            break

    meta = {
        "search_url": base_url,
        "pages_tried": pages_tried,
        "collected": collected_total,
        "collected_after_exclude": len(candidates),
    }
    if not candidates:
        return None, meta
    return random.choice(candidates), meta


def vacancy_dict_for_letter_from_web_vacancy_html(vacancy_id: str, vacancy_html: str) -> dict[str, Any]:
    """
    Пытается извлечь из HTML страницы вакансии: title, company, description, skills.
    Возвращает формат, совместимый с build_prompt/get_quality_letter.
    """
    vid = str(vacancy_id or "").strip()
    raw = str(vacancy_html or "")

    def _unescape(s: str) -> str:
        return html.unescape(s or "")

    def _text_from_block(m: re.Match[str] | None) -> str:
        if not m:
            return ""
        return strip_html(_unescape(m.group(1)))

    # title
    title = ""
    m_title = re.search(r'data-qa="vacancy-title"[^>]*>([\s\S]{0,5000}?)</', raw, re.IGNORECASE)
    if m_title:
        title = _text_from_block(m_title)
    if not title:
        m_h1 = re.search(r"<h1[^>]*>([\s\S]{0,5000}?)</h1>", raw, re.IGNORECASE)
        title = _text_from_block(m_h1)
    title = (title or "").strip()

    # company
    company = ""
    m_comp = re.search(r'data-qa="vacancy-company-name"[^>]*>([\s\S]{0,5000}?)</', raw, re.IGNORECASE)
    if m_comp:
        company = _text_from_block(m_comp)
    if not company:
        m_comp2 = re.search(r'data-qa="vacancy-company"[^>]*>([\s\S]{0,5000}?)</', raw, re.IGNORECASE)
        company = _text_from_block(m_comp2)
    company = (company or "").strip()

    # description
    desc = ""
    m_desc = re.search(r'data-qa="vacancy-description"[^>]*>([\s\S]{200,240000}?)</div>\s*</', raw, re.IGNORECASE)
    if m_desc:
        desc = _text_from_block(m_desc)
    if not desc:
        # fallback: meta description
        m_meta = re.search(r'<meta\s+name="description"\s+content="([^"]{80,2000})"', raw, re.IGNORECASE)
        if m_meta:
            desc = _unescape(m_meta.group(1))
    desc = re.sub(r"\s+", " ", (desc or "")).strip()
    if len(desc) < 120:
        # крайний случай: вытащим кусок body
        body = strip_html(raw)
        desc = (body or "")[:4000].strip()

    # skills
    skills: list[str] = []
    for mm in re.finditer(r'data-qa="skills-element"[^>]*>([\s\S]{1,200}?)</', raw, re.IGNORECASE):
        s = strip_html(_unescape(mm.group(1))).strip()
        if s and s not in skills:
            skills.append(s)
        if len(skills) >= 48:
            break

    return {
        "name": title or (f"Вакансия {vid}" if vid else "Вакансия"),
        "description": desc,
        "employer": {"name": company or ""},
        "key_skills": [{"name": n} for n in skills if n],
        "id": vid,
    }


def fetch_web_vacancy_for_letter(cfg_dict: dict[str, Any], exclude_ids: set[str]) -> tuple[dict[str, Any], dict[str, Any]]:
    """
    Главный способ для диагностики: берём вакансию из веб-выдачи (HTML),
    затем тянем страницу вакансии и собираем vacancy_dict_for_letter.
    Возвращает (vacancy_dict, meta).
    """
    vid, meta = pick_vacancy_id_from_web_serp(cfg_dict, exclude_ids)
    if vid is None:
        vid2, meta2 = pick_vacancy_id_from_web_serp(cfg_dict, set())
        meta = {**meta, "fallback_without_exclude": True, **meta2}
        vid = vid2
    if vid is None:
        raise ValueError("По вашим параметрам веб‑выдача hh.ru не вернула вакансий. Ослабьте фильтры или измените запрос.")
    vac_html = _hh_web_get(f"https://hh.ru/vacancy/{vid}")
    return vacancy_dict_for_letter_from_web_vacancy_html(vid, vac_html), meta


def search_params_from_saved_search(cfg_dict: dict[str, Any]) -> list[tuple[str, str]]:
    """Готовит query string для GET /vacancies из слоя search_config_dict_from_row."""
    text = (cfg_dict.get("search_text") or "").strip()
    if not text:
        raise ValueError("Укажите текст поиска в разделе «Поиск» и сохраните настройки.")

    q: list[tuple[str, str]] = [("text", text)]
    fields = cfg_dict.get("search_fields") or ["name", "description", "company_name"]
    for f in fields:
        if f in ("name", "company_name", "description"):
            q.append(("search_field", f))

    area = cfg_dict.get("area")
    if area is not None and str(area).strip():
        q.append(("area", str(area).strip()))

    exp = (cfg_dict.get("experience") or "").strip()
    if exp:
        q.append(("experience", exp))

    for emp in cfg_dict.get("employment") or []:
        if emp:
            q.append(("employment", str(emp)))

    for sch in cfg_dict.get("schedule") or []:
        if sch:
            q.append(("schedule", str(sch)))

    per = cfg_dict.get("period")
    if per is not None:
        try:
            q.append(("period", str(int(per))))
        except (TypeError, ValueError):
            pass

    sal = cfg_dict.get("salary")
    if sal is not None and str(sal).strip():
        try:
            q.append(("salary", str(int(sal))))
            cur = str(cfg_dict.get("salary_currency_code") or "RUR").strip().upper() or "RUR"
            q.append(("currency", cur))
        except (TypeError, ValueError):
            pass

    if cfg_dict.get("only_with_salary"):
        q.append(("only_with_salary", "true"))

    ob = (cfg_dict.get("order_by") or "publication_time").strip()
    if ob:
        q.append(("order_by", ob))

    q.append(("per_page", "20"))
    return q


def search_vacancies_page(cfg_dict: dict[str, Any], page: int) -> list[dict[str, Any]]:
    base = search_params_from_saved_search(cfg_dict)
    base.append(("page", str(max(0, int(page)))))
    data = _hh_get("/vacancies", base)
    return list(data.get("items") or [])


def get_vacancy_raw(vacancy_id: str) -> dict[str, Any]:
    vid = str(vacancy_id).strip()
    if not vid.isdigit():
        raise ValueError("Некорректный идентификатор вакансии.")
    return _hh_get(f"/vacancies/{vid}", [])


def vacancy_dict_for_letter(full: dict[str, Any]) -> dict[str, Any]:
    """Формат, ожидаемый build_prompt / get_quality_letter."""
    emp = full.get("employer") or {}
    name = full.get("name") or ""
    desc = strip_html(full.get("description") or "")
    snippet = full.get("snippet") or {}
    if len(desc) < 120:
        extra = strip_html(
            f"{snippet.get('requirement') or ''} {snippet.get('responsibility') or ''}"
        )
        if extra:
            desc = f"{desc}\n{extra}".strip()

    skills: list[str] = []
    for k in full.get("key_skills") or []:
        if isinstance(k, dict):
            n = k.get("name")
            if n:
                skills.append(str(n))
        elif isinstance(k, str) and k:
            skills.append(k)

    vid = full.get("id")
    return {
        "name": name,
        "description": desc,
        "employer": {"name": (emp.get("name") if isinstance(emp, dict) else "") or ""},
        "key_skills": skills,
        "id": str(vid) if vid is not None else "",
    }


def pick_vacancy_id_for_preview(cfg_dict: dict[str, Any], exclude_ids: set[str], *, max_pages: int = 3) -> str | None:
    """Собирает id с первых страниц выдачи; исключает уже откликнутые."""
    candidates: list[str] = []
    for page in range(max(1, max_pages)):
        items = search_vacancies_page(cfg_dict, page=page)
        if not items:
            break
        for it in items:
            vid = str(it.get("id") or "")
            if vid and vid.isdigit() and vid not in exclude_ids and vid not in candidates:
                candidates.append(vid)
        if len(candidates) >= 25:
            break
    if not candidates:
        return None
    return random.choice(candidates)


def fetch_real_vacancy_for_letter(cfg_dict: dict[str, Any], exclude_ids: set[str]) -> dict[str, Any]:
    """
    Одна случайная вакансия из выдачи hh.ru по сохранённым фильтрам.
    exclude_ids — vacancy_id из истории откликов (чтобы по возможности взять новую).
    """
    vid = pick_vacancy_id_for_preview(cfg_dict, exclude_ids)
    if vid is None:
        vid = pick_vacancy_id_for_preview(cfg_dict, set())
    if vid is None:
        raise ValueError(
            "По вашим параметрам hh.ru не вернул вакансий. Ослабьте фильтры или измените запрос в разделе «Поиск»."
        )
    full = get_vacancy_raw(vid)
    return vacancy_dict_for_letter(full)
