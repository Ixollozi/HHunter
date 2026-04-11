from __future__ import annotations

import datetime as dt
import re
from typing import Any

from pydantic import BaseModel, Field, field_validator


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=6, max_length=200)

    @field_validator("username")
    @classmethod
    def username_alnum(cls, v: str) -> str:
        s = v.strip()
        if not re.match(r"^[a-zA-Z0-9._-]+$", s):
            raise ValueError("Username: только буквы, цифры, точка, _ и -")
        return s


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserPublic(BaseModel):
    id: int
    username: str
    created_at: dt.datetime


_SEARCH_FIELD_IDS = frozenset({"name", "description", "company_name"})


class SearchConfigIn(BaseModel):
    search_text: str | None = None
    search_fields: list[str] | None = None
    area: str | None = None
    experience: str | None = None
    employment: list[str] | None = None
    schedule: list[str] | None = None
    period: int | None = None
    salary: int | None = None
    only_with_salary: bool | None = None
    order_by: str | None = None
    delay_min: int | None = None
    delay_max: int | None = None
    daily_limit: int | None = None
    hourly_limit: int | None = None

    @field_validator("search_fields")
    @classmethod
    def search_fields_allowed(cls, v: list[str] | None) -> list[str] | None:
        if not v:
            return v
        return [x for x in v if x in _SEARCH_FIELD_IDS]


class SettingsIn(BaseModel):
    gemini_api_key: str | None = None
    resume_text: str | None = None
    groq_api_key: str | None = None
    groq_model: str | None = None
    search: SearchConfigIn | None = None


class SettingsOut(BaseModel):
    gemini_api_key: str | None = None
    resume_text: str | None = None
    groq_model: str | None = None
    groq_configured: bool | None = None
    search: SearchConfigIn | None = None


# --- Chrome extension API ---

_ALLOWED_APP_STATUSES = frozenset({"sent", "skipped", "error"})


class ExtensionSettingsOut(BaseModel):
    daily_limit: int
    delay_min: int
    delay_max: int
    hourly_limit: int = 35
    sent_today: int = 0
    """Откликов со статусом sent за текущие сутки UTC (как в лимите save-application)."""

    sent_last_hour: int = 0
    """Откликов sent за последние 60 минут UTC (антиспам)."""

    search: dict[str, Any]
    """Параметры поиска (как в «Поиск» на сайте): для сборки URL выдачи hh.ru в расширении."""

    username: str | None = None
    groq_model: str | None = None
    groq_configured: bool | None = None
    groq_requests_remaining: int | None = None


class ExtensionGenerateLetterIn(BaseModel):
    vacancy_title: str = Field(min_length=1, max_length=512)
    vacancy_description: str = Field(min_length=1, max_length=120_000)
    company_name: str = Field(default="", max_length=512)
    vacancy_requirements: str = Field(default="", max_length=24_000)
    key_skills: str = Field(default="", max_length=4000)
    salary_info: str = Field(default="", max_length=512)


class ExtensionGenerateLetterOut(BaseModel):
    letter: str
    model_used: str | None = None
    requests_remaining: int | None = None


class ExtensionSaveApplicationIn(BaseModel):
    vacancy_id: str = Field(min_length=1, max_length=64)
    vacancy_title: str = Field(default="", max_length=512)
    vacancy_url: str | None = Field(default=None, max_length=4096)
    company_name: str | None = Field(default=None, max_length=512)
    company_url: str | None = Field(default=None, max_length=4096)
    contact_name: str | None = Field(default=None, max_length=512)
    contact_phone: str | None = Field(default=None, max_length=64)
    salary_from: int | None = None
    salary_to: int | None = None
    salary_currency: str | None = Field(default=None, max_length=8)
    cover_letter: str | None = Field(default=None, max_length=32_000)
    model_used: str | None = Field(default=None, max_length=64)
    status: str = Field(min_length=1, max_length=16)
    skip_reason: str | None = Field(default=None, max_length=32)
    session_id: int | None = None
    error_message: str | None = Field(default=None, max_length=2000)

    @field_validator("status")
    @classmethod
    def status_allowed(cls, v: str) -> str:
        s = v.strip().lower()
        if s not in _ALLOWED_APP_STATUSES:
            raise ValueError(f"status must be one of: {sorted(_ALLOWED_APP_STATUSES)}")
        return s


class ExtensionSaveApplicationOut(BaseModel):
    id: int
    status: str


_EXTENSION_LOG_LEVELS = frozenset({"INFO", "SUCCESS", "WARNING", "ERROR", "CRITICAL"})


class ExtensionLogIn(BaseModel):
    level: str = Field(min_length=1, max_length=16)
    message: str = Field(min_length=1, max_length=4000)
    source: str | None = Field(default=None, max_length=32)
    """Например extension_bg, extension_content, extension_popup."""

    step: str | None = Field(default=None, max_length=64)
    """Короткий код этапа: full_auto_serp, apply_generate_letter, …"""

    @field_validator("level")
    @classmethod
    def level_upper(cls, v: str) -> str:
        u = v.strip().upper()
        if u not in _EXTENSION_LOG_LEVELS:
            raise ValueError(f"level must be one of: {sorted(_EXTENSION_LOG_LEVELS)}")
        return u
