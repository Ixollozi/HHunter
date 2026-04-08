"""Генерация тестового письма: реальная вакансия с hh.ru по сохранённому поиску + Groq."""

from __future__ import annotations

from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from .crypto import decrypt_secret
from .letter_generation import get_quality_letter, validate_letter
from .hh_client import fetch_real_vacancy_for_letter
from .models import Application, SearchConfig, UserSettings
from .search_params import search_config_dict_from_row


def build_vacancy_preview_payload(db: Session, user_id: int) -> dict[str, Any]:
    """Вернёт одну вакансию из hh.ru по сохранённому поиску (без генерации письма)."""
    cfg_row = db.scalar(
        select(SearchConfig).where(SearchConfig.user_id == user_id).order_by(desc(SearchConfig.created_at))
    )
    if not cfg_row:
        raise ValueError("Сохраните параметры поиска в разделе «Поиск».")
    cfg_dict = search_config_dict_from_row(cfg_row)

    applied_ids = set(
        db.scalars(select(Application.vacancy_id).where(Application.user_id == user_id)).all()
    )
    applied_ids = {str(x) for x in applied_ids if x}

    vacancy = fetch_real_vacancy_for_letter(cfg_dict, applied_ids)
    vid = (vacancy.get("id") or "").strip()
    emp = vacancy.get("employer") or {}

    return {
        "source": "hh_api",
        "vacancy": {
            "id": vid or None,
            "title": vacancy.get("name"),
            "company_name": emp.get("name") if isinstance(emp, dict) else None,
            "description": vacancy.get("description"),
            "skills": vacancy.get("key_skills") or [],
            "hh_url": f"https://hh.ru/vacancy/{vid}" if vid else None,
        },
    }


def build_letter_demo_payload(db: Session, user_id: int, s: UserSettings) -> dict[str, Any]:
    """
    Нужны: настройки с ключом и резюме; сохранённые параметры поиска с непустым текстом запроса.
    Берётся случайная вакансия из выдачи hh.ru (по возможности ещё не из истории откликов).
    """
    if not (s.groq_api_key_enc or "").strip():
        raise ValueError("Укажите ключ Groq API в настройках.")
    if not (s.resume_text or "").strip():
        raise ValueError("Укажите текст резюме в настройках (или загрузите PDF).")

    cfg_row = db.scalar(
        select(SearchConfig).where(SearchConfig.user_id == user_id).order_by(desc(SearchConfig.created_at))
    )
    if not cfg_row:
        raise ValueError("Сохраните параметры поиска в разделе «Поиск».")
    cfg_dict = search_config_dict_from_row(cfg_row)

    applied_ids = set(
        db.scalars(select(Application.vacancy_id).where(Application.user_id == user_id)).all()
    )
    applied_ids = {str(x) for x in applied_ids if x}

    vacancy = fetch_real_vacancy_for_letter(cfg_dict, applied_ids)
    vid = (vacancy.get("id") or "").strip()
    emp = vacancy.get("employer") or {}

    api_key = decrypt_secret(s.groq_api_key_enc or "")
    letter = get_quality_letter(
        vacancy,
        s.resume_text or "",
        api_key,
        user_id=user_id,
        model=(s.groq_model or None),
    )
    vok, vmsg = validate_letter(letter)

    return {
        "ok": True,
        "demo": False,
        "vacancy_source": "hh_api",
        "vacancy": {
            "id": vid or None,
            "title": vacancy.get("name"),
            "company_name": emp.get("name") if isinstance(emp, dict) else None,
            "description": vacancy.get("description"),
            "skills": vacancy.get("key_skills") or [],
            "hh_url": f"https://hh.ru/vacancy/{vid}" if vid else None,
        },
        "letter": letter,
        "validation_ok": vok,
        "validation_message": vmsg,
    }
