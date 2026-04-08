"""Клиент публичного API hh.ru (поиск и карточка вакансии). Требуется корректный User-Agent."""

from __future__ import annotations

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
            q.append(("currency", "RUR"))
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
