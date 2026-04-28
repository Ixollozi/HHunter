from __future__ import annotations

import datetime as dt
import re

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, desc, func, select
from sqlalchemy.orm import Session

from .config import settings
from .auth import get_current_user
from .crypto import decrypt_secret
from .deps import get_db
from .letter_generation import get_quality_letter, vacancy_dict_for_extension
from .logger import log_app
from .logger import log_letter_generation
from .rate_limit import limiter
from .models import ActivityLog, Application, BlacklistedVacancy, SearchConfig, Session as DbSession, User, UserSettings
from .search_params import search_config_dict_from_row
from .schemas import (
    ExtensionGenerateLetterIn,
    ExtensionGenerateLetterOut,
    ExtensionLogIn,
    ExtensionSaveApplicationIn,
    ExtensionSaveApplicationOut,
    ExtensionSettingsOut,
)

router = APIRouter(prefix="/extension", tags=["extension"])

_KEEP_ACTIVITY_ROWS = 2500

# rate limits (per-user, per-process)
_RL_LOG_PER_MIN = 60
_RL_GEN_PER_MIN = 10

# --- Relevance filter (anti-spam, save tokens) ---
_PRESETS: dict[str, set[str]] = {
    "python_backend": {
        "python",
        "fastapi",
        "django",
        "flask",
        "api",
        "rest",
        "postgres",
        "postgresql",
        "redis",
        "celery",
        "docker",
    },
    "frontend": {"react", "typescript", "javascript", "redux", "next", "vite", "webpack", "html", "css"},
    "qa": {"qa", "testing", "pytest", "selenium", "playwright", "postman", "api", "rest", "jira"},
}


def _parse_skill_line(s: str) -> list[str]:
    raw = (s or "").strip()
    if not raw:
        return []
    parts = re.split(r"[,;\n|•\t]+", raw)
    out: list[str] = []
    seen: set[str] = set()
    for p in parts:
        t = p.strip().lower()
        if not t:
            continue
        if len(t) > 40:
            t = t[:40]
        if t in seen:
            continue
        seen.add(t)
        out.append(t)
    return out[:120]


def _parse_relevance_terms(raw: str) -> tuple[list[str], list[str]]:
    """
    Поддержка простого DSL без миграций:
    - обычные слова/фразы -> positive
    - строки/термы с префиксом '-' -> negative (минус-слова, чтобы отсеять вакансии)
    Пример:
      python, fastapi, postgresql
      -1c
      -php
      -react
    """
    pos: list[str] = []
    neg: list[str] = []
    for t in _parse_skill_line(raw or ""):
        if t.startswith("-") and len(t) >= 2:
            neg.append(t[1:].strip())
        else:
            pos.append(t)
    return pos, neg


def _normalize_text(s: str) -> str:
    t = (s or "").lower()
    t = t.replace("\u00a0", " ")
    t = re.sub(r"[\t\r]+", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _tokenize_words(s: str) -> set[str]:
    # слова/технологии: python, fastapi, postgresql, c#, c++
    words = set(re.findall(r"[a-zа-яё0-9+#.\-]{2,32}", s, flags=re.IGNORECASE))
    return {w.lower() for w in words if w}


def score_vacancy(description: str, title: str, *, skills: set[str]) -> int:
    """
    Улучшенная эвристика:
    - title матчит сильнее, чем description
    - термы считаются как фразы (substring) + как слова (tokenize), чтобы не промахиваться из-за пунктуации
    - поддержка минус-слов (если встретилось в title/desc — сильный штраф)
    """
    t_title = _normalize_text(title or "")
    t_desc = _normalize_text(description or "")
    words_title = _tokenize_words(t_title)
    words_desc = _tokenize_words(t_desc)

    score = 0
    # positive terms
    for term in skills:
        term = (term or "").strip().lower()
        if not term:
            continue
        # фраза
        in_title_phrase = term in t_title
        in_desc_phrase = term in t_desc
        # слово
        in_title_word = term in words_title
        in_desc_word = term in words_desc
        if in_title_phrase or in_title_word:
            score += 2
        elif in_desc_phrase or in_desc_word:
            score += 1

    # penalties for seniority mismatch (мягче, чтобы не отбрасывать хорошие вакансии)
    senior_markers = ["senior", "lead", "architect", "7+ лет", "6+ лет", "5+ лет", "principal", "staff"]
    if any(m in t_title for m in senior_markers):
        score -= 2
    elif any(m in t_desc for m in senior_markers):
        score -= 1

    return score


def _relevance_settings_from_user(st: UserSettings | None) -> tuple[set[str], int, str]:
    profile = ((getattr(st, "relevance_profile", None) or "") if st else "").strip().lower()
    if not profile:
        profile = "python_backend"
    min_score = 3
    try:
        if st and getattr(st, "relevance_min_score", None) is not None:
            min_score = int(getattr(st, "relevance_min_score"))
    except Exception:
        min_score = 3
    min_score = max(0, min(min_score, 50))

    raw_custom = (getattr(st, "relevance_skills", "") or "") if st else ""
    custom_pos, custom_neg = _parse_relevance_terms(raw_custom)
    if profile == "custom":
        skills = set(custom_pos)
    else:
        base = _PRESETS.get(profile) or _PRESETS["python_backend"]
        skills = set(base) | set(custom_pos)
    if not skills:
        skills = set(_PRESETS["python_backend"])
        profile = "python_backend"
    # negative terms мы кодируем обратно как "-term" прямо в skills-set, чтобы не менять сигнатуры и модель.
    # (score_vacancy их не использует напрямую; применим штрафы там, где вызываем).
    for n in custom_neg[:80]:
        if n:
            skills.add(f"-{n}")
    return skills, min_score, profile


def _prune_user_activity_logs(db: Session, user_id: int) -> None:
    n = db.scalar(select(func.count(ActivityLog.id)).where(ActivityLog.user_id == user_id))
    if not n or n <= _KEEP_ACTIVITY_ROWS + 400:
        return
    to_drop = int(n - _KEEP_ACTIVITY_ROWS)
    ids = db.scalars(
        select(ActivityLog.id)
        .where(ActivityLog.user_id == user_id)
        .order_by(ActivityLog.id.asc())
        .limit(to_drop)
    ).all()
    if ids:
        db.execute(delete(ActivityLog).where(ActivityLog.id.in_(ids)))


@router.post("/test-provider")
def extension_test_provider(body: dict, user: User = Depends(get_current_user)) -> dict:
    """
    Минимальная проверка ключа Groq (без сохранения): делает маленький запрос.
    Body: { "groq_api_key": "gsk_...", "groq_model": "qwen/qwen3-32b" }
    """
    key = str((body or {}).get("groq_api_key") or "").strip()
    model = str((body or {}).get("groq_model") or settings.groq_default_model).strip()
    if not key:
        raise HTTPException(status_code=400, detail="Нет groq_api_key")
    try:
        from .groq_client import groq_chat_completion

        r = groq_chat_completion(
            api_key=key,
            model=model,
            system_prompt="Отвечай только словом OK.",
            user_prompt="OK",
            temperature=0.0,
            max_tokens=4,
        )
        if not r.text:
            raise RuntimeError("Пустой ответ модели")
        return {"valid": True, "model_used": r.model_used, "requests_remaining": r.requests_remaining}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(e)[:500]) from e


def _latest_search_config(db: Session, user_id: int) -> SearchConfig | None:
    return db.scalar(select(SearchConfig).where(SearchConfig.user_id == user_id).order_by(desc(SearchConfig.created_at)))


@router.post("/set-hh-origin")
def extension_set_hh_origin(
    body: dict,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    raw = str((body or {}).get("hh_origin") or "").strip().rstrip("/")
    if not raw:
        raise HTTPException(status_code=400, detail="hh_origin обязателен")
    if not re.match(r"^https?://", raw, flags=re.IGNORECASE):
        raise HTTPException(status_code=400, detail="hh_origin должен начинаться с http:// или https://")
    try:
        from urllib.parse import urlparse

        u = urlparse(raw)
        if (u.scheme or "").lower() != "https":
            raise ValueError("https only")
        host = (u.hostname or "").lower()
        if not (host == "hh.ru" or host.endswith(".hh.ru") or host == "hh.uz" or host.endswith(".hh.uz") or host == "hh.kz" or host.endswith(".hh.kz")):
            raise ValueError("not hh host")
        origin = f"{u.scheme}://{host}"
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Некорректный hh_origin: {e!s}"[:220]) from e

    cfg = _latest_search_config(db, user.id)
    if not cfg:
        raise HTTPException(status_code=400, detail="Нет сохранённых параметров поиска — сначала сохраните поиск на сайте.")
    cfg.hh_origin = origin
    db.add(cfg)
    db.commit()
    return {"ok": True, "hh_origin": origin}


def _utc_day_start() -> dt.datetime:
    now = dt.datetime.now(dt.UTC)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def _utc_hour_ago() -> dt.datetime:
    return dt.datetime.now(dt.UTC) - dt.timedelta(hours=1)


@router.get("/settings", response_model=ExtensionSettingsOut)
def extension_settings(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> ExtensionSettingsOut:
    cfg = _latest_search_config(db, user.id)
    if not cfg:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нет сохранённых параметров поиска — откройте раздел «Поиск» на сайте HHunter и сохраните настройки.",
        )
    st = db.get(UserSettings, user.id)
    groq_model = (st.groq_model if st else None) or None
    groq_configured = bool(st and (st.groq_api_key_enc or "").strip())
    cover_letter_mode = (getattr(st, "cover_letter_mode", None) or "ai").strip().lower() if st else "ai"
    sent_today = db.scalar(
        select(func.count(Application.id)).where(
            Application.user_id == user.id,
            Application.status == "sent",
            Application.applied_at >= _utc_day_start(),
        )
    )
    sent_last_hour = db.scalar(
        select(func.count(Application.id)).where(
            Application.user_id == user.id,
            Application.status == "sent",
            Application.applied_at >= _utc_hour_ago(),
        )
    )
    hourly_raw = int(getattr(cfg, "hourly_limit", 35) or 35)
    hourly_limit = min(max(hourly_raw, 10), 80)
    return ExtensionSettingsOut(
        daily_limit=int(cfg.daily_limit or 200),
        delay_min=int(cfg.delay_min),
        delay_max=int(cfg.delay_max),
        hourly_limit=hourly_limit,
        sent_today=int(sent_today or 0),
        sent_last_hour=int(sent_last_hour or 0),
        search=search_config_dict_from_row(cfg),
        username=user.username,
        groq_model=groq_model,
        groq_configured=groq_configured,
        groq_requests_remaining=None,
        cover_letter_mode=cover_letter_mode,
    )


@router.get("/vacancy-known")
def extension_vacancy_known(
    vacancy_id: str = Query(..., min_length=1, max_length=64),
    title: str | None = Query(default=None, max_length=512),
    company_name: str | None = Query(default=None, max_length=512),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, bool]:
    def _norm_text(s: str) -> str:
        t = (s or "").lower().strip()
        t = re.sub(r"\s+", " ", t)
        t = re.sub(r"[^\w\s]+", " ", t, flags=re.UNICODE)
        t = re.sub(r"\s+", " ", t).strip()
        return t

    def _norm_company(s: str) -> str:
        t = _norm_text(s)
        t = re.sub(r"\b(ооо|оао|зао|пао|ао|ип|llc|inc|ltd|gmbh|sarl|plc)\b", " ", t, flags=re.IGNORECASE)
        t = re.sub(r"\s+", " ", t).strip()
        return t

    vid = str(vacancy_id).strip()
    exists = db.scalar(select(Application.id).where(Application.user_id == user.id, Application.vacancy_id == vid))
    if exists:
        return {"already_applied": True}

    t_norm = _norm_text(title or "") if title else ""
    c_norm = _norm_company(company_name or "") if company_name else ""
    if t_norm and c_norm:
        rows = db.execute(
            select(Application.vacancy_name, Application.company_name)
            .where(Application.user_id == user.id)
            .order_by(Application.applied_at.desc())
            .limit(2500)
        ).all()
        for vn, cn in rows:
            if not vn or not cn:
                continue
            if _norm_text(str(vn)) == t_norm and _norm_company(str(cn)) == c_norm:
                return {"already_applied": True}

    blacklisted = db.scalar(
        select(BlacklistedVacancy.id).where(
            BlacklistedVacancy.user_id == user.id,
            BlacklistedVacancy.vacancy_id == vid,
        )
    )
    if blacklisted:
        log_app(user.id, "INFO", f"[blacklist] Пропуск вакансии {vid} — в чёрном списке", None)
    return {"already_applied": bool(blacklisted)}


@router.post("/generate-letter", response_model=ExtensionGenerateLetterOut)
def extension_generate_letter(
    body: ExtensionGenerateLetterIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ExtensionGenerateLetterOut:
    ok, retry = limiter.allow(
        key=f"u{user.id}:ext_generate_letter",
        capacity=_RL_GEN_PER_MIN,
        refill_per_sec=_RL_GEN_PER_MIN / 60.0,
    )
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "rate_limited", "retry_after_s": round(retry, 2)},
        )
    st = db.get(UserSettings, user.id)
    if not st:
        raise HTTPException(status_code=400, detail="Нет настроек пользователя.")

    # ── Пользовательское письмо (без AI) ──────────────────────────────────
    mode = (getattr(st, "cover_letter_mode", None) or "ai").strip().lower()
    if mode == "none":
        # Явный режим «без письма»: расширение отправит отклик без текста.
        return ExtensionGenerateLetterOut(letter="", model_used=None, requests_remaining=None)
    if mode == "custom":
        tpl = (getattr(st, "cover_letter_text", None) or "").strip()
        if not tpl:
            raise HTTPException(status_code=400, detail="Выбран режим «своё письмо», но текст письма пустой.")

        mapping = {
            "{vacancy_title}": body.vacancy_title or "",
            "{company_name}": body.company_name or "",
            "{salary_info}": body.salary_info or "",
            "{key_skills}": body.key_skills or "",
            "{vacancy_requirements}": body.vacancy_requirements or "",
        }
        out = tpl
        for k, v in mapping.items():
            out = out.replace(k, v)
        out = out.strip()
        if len(out) > 32_000:
            out = out[:32_000]
        return ExtensionGenerateLetterOut(letter=out, model_used=None, requests_remaining=None)

    if not (st.groq_api_key_enc or "").strip():
        raise HTTPException(status_code=400, detail="Укажите ключ Groq API в настройках HHunter.")
    if not (st.resume_text or "").strip():
        raise HTTPException(status_code=400, detail="Укажите текст резюме в настройках HHunter (или загрузите PDF).")

    vacancy = vacancy_dict_for_extension(
        body.vacancy_title,
        body.vacancy_description,
        body.company_name,
        requirements=body.vacancy_requirements or "",
        key_skills_text=body.key_skills or "",
        salary_info=body.salary_info or "",
    )
    # Relevance gate: if too low — return 422 so content script can treat it as "skipped".
    skills, min_score, profile = _relevance_settings_from_user(st)
    # negative terms are encoded as "-term"
    neg = {s[1:] for s in skills if isinstance(s, str) and s.startswith("-") and len(s) > 1}
    pos = {s for s in skills if isinstance(s, str) and not s.startswith("-")}
    sc = score_vacancy(body.vacancy_description or "", body.vacancy_title or "", skills=pos)
    # apply negative penalties (substring match)
    txt = f"{body.vacancy_title or ''} {body.vacancy_description or ''}".lower()
    neg_hits = [t for t in neg if t and t in txt]
    if neg_hits:
        sc -= 4 * min(len(neg_hits), 3)
    if sc < min_score:
        log_letter_generation(
            user.id,
            {
                "stage": "vacancy_score_skip",
                "score": sc,
                "min_score": min_score,
                "profile": profile,
                "neg_hits": neg_hits[:5] if neg_hits else None,
                "vacancy_title": (body.vacancy_title or "")[:200],
                "company_name": (body.company_name or "")[:200],
            },
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "low_score", "score": sc, "min_score": min_score},
        )
    try:
        api_key = decrypt_secret(st.groq_api_key_enc or "")
        gender = (getattr(st, "gender", None) or "male").strip().lower()
        letter = get_quality_letter(
            vacancy,
            st.resume_text or "",
            api_key,
            max_retries=2,
            user_id=user.id,
            model=(st.groq_model or None),
            gender=gender,
        )
    except RuntimeError as e:
        # Конфигурация шифрования/ключа. Это не 502.
        raise HTTPException(
            status_code=400,
            detail=str(e)
            + " Добавьте GROQ_KEY_FERNET_SECRET в backend/.env (см. backend/.env.example) и перезапустите сервер.",
        ) from e
    except Exception as e:  # noqa: BLE001
        log_letter_generation(
            user.id,
            {
                "stage": "generate_letter_error",
                "error": str(e)[:800],
                "vacancy_title": (body.vacancy_title or "")[:200],
                "company_name": (body.company_name or "")[:200],
                "model": (st.groq_model or None) or settings.groq_default_model,
            },
        )
        log_app(user.id, "ERROR", f"Генерация письма (расширение): {e!s}"[:500], None)
        raise HTTPException(status_code=502, detail=f"Ошибка генерации письма: {e!s}") from e

    if not letter.strip():
        raise HTTPException(status_code=502, detail="Модель вернула пустое письмо — повторите попытку.")

    return ExtensionGenerateLetterOut(letter=letter, model_used=(st.groq_model or None), requests_remaining=None)


@router.post("/save-application", response_model=ExtensionSaveApplicationOut)
def extension_save_application(
    body: ExtensionSaveApplicationIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ExtensionSaveApplicationOut:
    cfg = _latest_search_config(db, user.id)
    daily_limit = int(cfg.daily_limit) if cfg else 200
    daily_limit = min(daily_limit, 500)

    exists = db.scalar(
        select(Application.id).where(Application.user_id == user.id, Application.vacancy_id == body.vacancy_id)
    )
    if exists:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Отклик по этой вакансии уже сохранён в базе.",
        )

    if body.status == "sent":
        sent_today = db.scalar(
            select(func.count(Application.id)).where(
                Application.user_id == user.id,
                Application.status == "sent",
                Application.applied_at >= _utc_day_start(),
            )
        )
        cnt = int(sent_today or 0)
        if cnt >= daily_limit:
            log_app(
                user.id,
                "CRITICAL",
                f"Дневной лимит откликов ({daily_limit}) достигнут — расширение отклонено.",
                (cnt, daily_limit),
            )
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Достигнут дневной лимит откликов ({daily_limit}). Измените лимит в разделе «Поиск» или продолжите завтра.",
            )

        hourly_limit = min(max(int(getattr(cfg, "hourly_limit", 35) or 35), 10), 80) if cfg else 35
        sent_hour = db.scalar(
            select(func.count(Application.id)).where(
                Application.user_id == user.id,
                Application.status == "sent",
                Application.applied_at >= _utc_hour_ago(),
            )
        )
        hcnt = int(sent_hour or 0)
        if hcnt >= hourly_limit:
            log_app(
                user.id,
                "CRITICAL",
                f"Почасовой лимит откликов ({hourly_limit}) достигнут — расширение отклонено.",
                (hcnt, hourly_limit),
            )
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Достигнут лимит откликов за час ({hourly_limit}). Подождите или увеличьте лимит в «Поиск».",
            )

    session_id = body.session_id
    if session_id is not None:
        sess = db.get(DbSession, session_id)
        if not sess or sess.user_id != user.id:
            raise HTTPException(status_code=400, detail="Некорректный session_id.")

    applied_at = dt.datetime.now(dt.UTC)
    app_row = Application(
        user_id=user.id,
        session_id=session_id,
        vacancy_id=body.vacancy_id,
        vacancy_name=body.vacancy_title or None,
        vacancy_url=body.vacancy_url,
        company_name=body.company_name,
        company_url=body.company_url,
        contact_name=body.contact_name,
        contact_phone=body.contact_phone,
        salary_from=body.salary_from,
        salary_to=body.salary_to,
        salary_currency=body.salary_currency,
        cover_letter=body.cover_letter,
        model_used=body.model_used,
        status=body.status,
        skip_reason=body.skip_reason,
        error_message=body.error_message,
        applied_at=applied_at,
    )
    db.add(app_row)
    db.commit()
    db.refresh(app_row)

    log_letter_generation(
        user.id,
        {
            "stage": "save_application",
            "status": body.status,
            "skip_reason": body.skip_reason,
            "vacancy_id": body.vacancy_id,
            "vacancy_title": (body.vacancy_title or "")[:200],
            "company_name": (body.company_name or "")[:200] if body.company_name else None,
            "model_used": body.model_used,
        },
    )

    if body.status == "sent":
        log_app(
            user.id,
            "INFO",
            f'[ext] "{body.vacancy_title or ""}" — {body.company_name or ""} → отправлен',
            None,
        )
    elif body.status == "skipped":
        log_app(
            user.id,
            "INFO",
            f'[ext] "{body.vacancy_title or ""}" — пропуск ({body.skip_reason or "неизвестно"})',
            None,
        )
    elif body.status == "error":
        log_app(
            user.id,
            "ERROR",
            f'[ext] "{body.vacancy_title or ""}" — ошибка: {(body.error_message or "")[:200]}',
            None,
        )

    return ExtensionSaveApplicationOut(id=app_row.id, status=app_row.status)


@router.post("/blacklist-vacancy")
def extension_blacklist_vacancy(
    body: dict,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    vid = str((body or {}).get("vacancy_id") or "").strip()[:64]
    reason = str((body or {}).get("reason") or "error").strip()[:128]
    if not vid:
        raise HTTPException(status_code=400, detail="vacancy_id обязателен")

    error_count = db.scalar(
        select(func.count(Application.id)).where(
            Application.user_id == user.id,
            Application.vacancy_id == vid,
            Application.status == "error",
        )
    )
    threshold = 3
    already_blacklisted = db.scalar(
        select(BlacklistedVacancy.id).where(
            BlacklistedVacancy.user_id == user.id,
            BlacklistedVacancy.vacancy_id == vid,
        )
    )
    if already_blacklisted:
        return {"ok": True, "blacklisted": True, "vacancy_id": vid, "reason": "already_in_blacklist"}

    if int(error_count or 0) >= threshold:
        db.add(BlacklistedVacancy(user_id=user.id, vacancy_id=vid, reason=reason))
        db.commit()
        log_app(
            user.id,
            "WARNING",
            f"[blacklist] Вакансия {vid} добавлена в блэклист после {error_count} ошибок (причина: {reason})",
            None,
        )
        return {"ok": True, "blacklisted": True, "vacancy_id": vid, "error_count": int(error_count or 0)}

    log_app(
        user.id,
        "INFO",
        f"[blacklist] Вакансия {vid} — ошибка {int(error_count or 0)}/{threshold}, блэклист не применён",
        None,
    )
    return {"ok": True, "blacklisted": False, "vacancy_id": vid, "error_count": int(error_count or 0)}


@router.post("/log")
def extension_log(
    body: ExtensionLogIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    ok, retry = limiter.allow(
        key=f"u{user.id}:ext_log",
        capacity=_RL_LOG_PER_MIN,
        refill_per_sec=_RL_LOG_PER_MIN / 60.0,
    )
    if not ok:
        # Не логируем через log_app, чтобы не усугублять спам при DDoS/лупе.
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "rate_limited", "retry_after_s": round(retry, 2)},
        )
    msg = body.message.strip()[:4000]
    src = (body.source or "").strip() or None
    st = (body.step or "").strip() or None
    log_app(user.id, body.level, f"[ext]{f' [{src}]' if src else ''}{f' {st}' if st else ''} {msg}", None)
    row = ActivityLog(
        user_id=user.id,
        level=body.level,
        source=src,
        step=st,
        message=msg,
    )
    db.add(row)
    db.flush()
    _prune_user_activity_logs(db, user.id)
    db.commit()
    return {"ok": "true"}
