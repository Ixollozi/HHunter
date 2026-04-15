"""Генерация тестового письма: реальная вакансия с hh.ru по сохранённому поиску + Groq."""

from __future__ import annotations

from typing import Any
import re

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from .crypto import decrypt_secret
from .letter_generation import get_quality_letter, validate_letter
from .hh_client import fetch_real_vacancy_for_letter, fetch_web_vacancy_for_letter
from .models import Application, SearchConfig, UserSettings
from .search_params import search_config_dict_from_row


def _render_custom_letter(template: str, vacancy: dict[str, Any]) -> str:
    tpl = (template or "").strip()
    if not tpl:
        raise ValueError("Выбран режим «своё письмо», но текст письма пустой (Настройки → Письмо для отклика).")
    emp = vacancy.get("employer") if isinstance(vacancy.get("employer"), dict) else {}
    company_name = (emp.get("name") or "") if isinstance(emp, dict) else ""
    # key_skills: list[str] или list[dict{name}]
    skills_raw = vacancy.get("key_skills") or []
    skills: list[str] = []
    for sk in skills_raw:
        if isinstance(sk, str) and sk.strip():
            skills.append(sk.strip())
        elif isinstance(sk, dict):
            n = sk.get("name")
            if isinstance(n, str) and n.strip():
                skills.append(n.strip())
    skills_line = ", ".join(skills[:48])
    mapping = {
        "{vacancy_title}": str(vacancy.get("name") or ""),
        "{company_name}": str(company_name or ""),
        "{salary_info}": "",  # в demo (web/api) зарплата обычно не извлекается
        "{key_skills}": skills_line,
        "{vacancy_requirements}": "",  # requirements отдельным полем в demo не выделяем
    }
    out = tpl
    for k, v in mapping.items():
        out = out.replace(k, v)
    out = out.strip()
    # ограничение как в /extension/generate-letter
    if len(out) > 32_000:
        out = out[:32_000]
    # аккуратно схлопнем "пустые" строки, если плейсхолдеры не заполнились
    out = re.sub(r"\n{3,}", "\n\n", out).strip()
    return out


def _latest_search_row(db: Session, user_id: int) -> SearchConfig | None:
    return db.scalar(select(SearchConfig).where(SearchConfig.user_id == user_id).order_by(desc(SearchConfig.created_at)))


def _applied_ids(db: Session, user_id: int) -> set[str]:
    applied_ids = set(db.scalars(select(Application.vacancy_id).where(Application.user_id == user_id)).all())
    return {str(x) for x in applied_ids if x}


def _preview_payload_from_vacancy(vacancy: dict[str, Any], *, source: str, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    vid = (vacancy.get("id") or "").strip()
    emp = vacancy.get("employer") or {}
    skills_raw = vacancy.get("key_skills") or []
    skills: list[str] = []
    for s in skills_raw:
        if isinstance(s, str):
            if s.strip():
                skills.append(s.strip())
        elif isinstance(s, dict):
            n = s.get("name")
            if isinstance(n, str) and n.strip():
                skills.append(n.strip())
    # дедуп (с сохранением порядка)
    seen: set[str] = set()
    skills_norm: list[str] = []
    for s in skills:
        low = s.lower()
        if low in seen:
            continue
        seen.add(low)
        skills_norm.append(s)
    return {
        "source": source,
        "meta": meta or None,
        "vacancy": {
            "id": vid or None,
            "title": vacancy.get("name"),
            "company_name": emp.get("name") if isinstance(emp, dict) else None,
            "description": vacancy.get("description"),
            "skills": skills_norm,
            "hh_url": f"https://hh.ru/vacancy/{vid}" if vid else None,
        },
    }


def build_vacancy_preview_payload_web(db: Session, user_id: int) -> dict[str, Any]:
    """Вернёт одну вакансию из веб‑выдачи hh.ru (HTML) по сохранённому поиску (без генерации письма)."""
    cfg_row = db.scalar(
        select(SearchConfig).where(SearchConfig.user_id == user_id).order_by(desc(SearchConfig.created_at))
    )
    if not cfg_row:
        raise ValueError("Сохраните параметры поиска в разделе «Поиск».")
    cfg_dict = search_config_dict_from_row(cfg_row)

    applied_ids = _applied_ids(db, user_id)

    vacancy, meta = fetch_web_vacancy_for_letter(cfg_dict, applied_ids)
    return _preview_payload_from_vacancy(vacancy, source="hh_web", meta=meta)


def build_vacancy_preview_payload_api(db: Session, user_id: int) -> dict[str, Any]:
    """Резерв: вернёт одну вакансию из api.hh.ru по сохранённому поиску (без генерации письма)."""
    cfg_row = _latest_search_row(db, user_id)
    if not cfg_row:
        raise ValueError("Сохраните параметры поиска в разделе «Поиск».")
    cfg_dict = search_config_dict_from_row(cfg_row)
    vacancy = fetch_real_vacancy_for_letter(cfg_dict, _applied_ids(db, user_id))
    return _preview_payload_from_vacancy(vacancy, source="hh_api", meta=None)


def build_letter_demo_payload_web(db: Session, user_id: int, s: UserSettings, *, force_custom: bool = False) -> dict[str, Any]:
    """
    Нужны: настройки с ключом и резюме; сохранённые параметры поиска с непустым текстом запроса.
    Берётся случайная вакансия из веб‑выдачи hh.ru (по возможности ещё не из истории откликов).
    """
    mode = (getattr(s, "cover_letter_mode", None) or "ai").strip().lower()
    use_custom = force_custom or mode == "custom"
    if not use_custom:
        if not (s.groq_api_key_enc or "").strip():
            raise ValueError("Укажите ключ Groq API в настройках.")
        if not (s.resume_text or "").strip():
            raise ValueError("Укажите текст резюме в настройках (или загрузите PDF).")

    cfg_row = _latest_search_row(db, user_id)
    if not cfg_row:
        raise ValueError("Сохраните параметры поиска в разделе «Поиск».")
    cfg_dict = search_config_dict_from_row(cfg_row)

    applied_ids = _applied_ids(db, user_id)

    vacancy, meta = fetch_web_vacancy_for_letter(cfg_dict, applied_ids)
    vid = (vacancy.get("id") or "").strip()
    emp = vacancy.get("employer") or {}
    skills_raw = vacancy.get("key_skills") or []
    skills: list[str] = []
    for sk in skills_raw:
        if isinstance(sk, str) and sk.strip():
            skills.append(sk.strip())
        elif isinstance(sk, dict):
            n = sk.get("name")
            if isinstance(n, str) and n.strip():
                skills.append(n.strip())

    if use_custom:
        letter = _render_custom_letter(getattr(s, "cover_letter_text", None) or "", vacancy)
    else:
        api_key = decrypt_secret(s.groq_api_key_enc or "")
        letter = get_quality_letter(
            vacancy,
            s.resume_text or "",
            api_key,
            max_retries=2,
            user_id=user_id,
            model=(s.groq_model or None),
        )
    vok, vmsg = validate_letter(letter, vacancy_description=str(vacancy.get("description") or ""))

    return {
        "ok": True,
        "demo": False,
        "vacancy_source": "hh_web",
        "vacancy_meta": meta,
        "vacancy": {
            "id": vid or None,
            "title": vacancy.get("name"),
            "company_name": emp.get("name") if isinstance(emp, dict) else None,
            "description": vacancy.get("description"),
            "skills": skills,
            "hh_url": f"https://hh.ru/vacancy/{vid}" if vid else None,
        },
        "letter": letter,
        "validation_ok": vok,
        "validation_message": vmsg,
    }


def build_letter_demo_payload_api(db: Session, user_id: int, s: UserSettings, *, force_custom: bool = False) -> dict[str, Any]:
    """Резервная генерация по api.hh.ru (если web недоступен)."""
    mode = (getattr(s, "cover_letter_mode", None) or "ai").strip().lower()
    use_custom = force_custom or mode == "custom"
    if not use_custom:
        if not (s.groq_api_key_enc or "").strip():
            raise ValueError("Укажите ключ Groq API в настройках.")
        if not (s.resume_text or "").strip():
            raise ValueError("Укажите текст резюме в настройках (или загрузите PDF).")

    cfg_row = _latest_search_row(db, user_id)
    if not cfg_row:
        raise ValueError("Сохраните параметры поиска в разделе «Поиск».")
    cfg_dict = search_config_dict_from_row(cfg_row)

    vacancy = fetch_real_vacancy_for_letter(cfg_dict, _applied_ids(db, user_id))
    vid = (vacancy.get("id") or "").strip()
    emp = vacancy.get("employer") or {}
    skills_raw = vacancy.get("key_skills") or []
    skills: list[str] = []
    for sk in skills_raw:
        if isinstance(sk, str) and sk.strip():
            skills.append(sk.strip())
        elif isinstance(sk, dict):
            n = sk.get("name")
            if isinstance(n, str) and n.strip():
                skills.append(n.strip())

    if use_custom:
        letter = _render_custom_letter(getattr(s, "cover_letter_text", None) or "", vacancy)
    else:
        api_key = decrypt_secret(s.groq_api_key_enc or "")
        letter = get_quality_letter(
            vacancy,
            s.resume_text or "",
            api_key,
            max_retries=2,
            user_id=user_id,
            model=(s.groq_model or None),
        )
    vok, vmsg = validate_letter(letter, vacancy_description=str(vacancy.get("description") or ""))

    return {
        "ok": True,
        "demo": False,
        "vacancy_source": "hh_api",
        "vacancy": {
            "id": vid or None,
            "title": vacancy.get("name"),
            "company_name": emp.get("name") if isinstance(emp, dict) else None,
            "description": vacancy.get("description"),
            "skills": skills,
            "hh_url": f"https://hh.ru/vacancy/{vid}" if vid else None,
        },
        "letter": letter,
        "validation_ok": vok,
        "validation_message": vmsg,
    }
