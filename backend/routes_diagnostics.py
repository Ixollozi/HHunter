from __future__ import annotations

import datetime as dt
import json
from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi import HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from .auth import get_current_user
from .deps import get_db
from .rate_limit import limiter
from .letter_demo import (
    build_letter_demo_payload_api,
    build_letter_demo_payload_web,
    build_vacancy_preview_payload_api,
    build_vacancy_preview_payload_web,
)
from .models import Application, SearchConfig, Session as DbSession, User, UserSettings
from .search_params import search_config_dict_from_row

router = APIRouter(prefix="/diagnostics", tags=["diagnostics"])

_RL_DIAG_PER_MIN = 6


def _ndjson_line(obj: dict[str, Any]) -> bytes:
    return (json.dumps(obj, ensure_ascii=False, default=str) + "\n").encode("utf-8")


@router.post("/run-stream")
def run_diagnostics_stream(
    include_letter: bool = Query(
        default=False,
        description="Если true — один запрос к Groq для демо-письма. По умолчанию выкл., чтобы не расходовать квоту.",
    ),
    letter_mode: str = Query(
        default="ai",
        description="Режим письма для демо: 'ai' (Groq) или 'custom' (своё письмо из настроек, без Groq).",
    ),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    ok, retry = limiter.allow(
        key=f"u{user.id}:diagnostics_stream",
        capacity=_RL_DIAG_PER_MIN,
        refill_per_sec=_RL_DIAG_PER_MIN / 60.0,
    )
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "rate_limited", "retry_after_s": round(retry, 2)},
        )
    """
    Потоковая диагностика (NDJSON): отдаёт шаги проверки в реальном времени.
    Клиент читает построчно и обновляет UI.
    """

    def gen():
        t0 = dt.datetime.now(dt.UTC)
        run_id = t0.strftime("%Y%m%dT%H%M%S") + f"-u{user.id}"

        def emit(stage: str, payload: dict[str, Any]) -> bytes:
            now = dt.datetime.now(dt.UTC)
            ms = int((now - t0).total_seconds() * 1000)
            return _ndjson_line({"run_id": run_id, "t_ms": ms, "stage": stage, **payload})

        # --- start ---
        yield emit("start", {"message": "Старт диагностики"})

        ran_at = t0.isoformat()
        checks: list[dict[str, Any]] = []
        letter_demo: dict[str, Any] | None = None
        vacancy_preview: dict[str, Any] | None = None
        search_snapshot: dict[str, Any] | None = None
        extra: dict[str, Any] = {}

        s = db.get(UserSettings, user.id)
        checks.append(
            {
                "id": "user_settings_row",
                "ok": s is not None,
                "label": "Строка настроек в БД",
                "detail": "" if s else "Нет user_settings — сохраните настройки в интерфейсе",
            }
        )
        yield emit("check", {"check": checks[-1]})

        mode = str(letter_mode or "ai").strip().lower()
        force_custom = mode == "custom"
        groq_ok = bool(s and (s.groq_api_key_enc or "").strip())
        resume_ok = bool(s and (s.resume_text or "").strip())
        resume_len = len((s.resume_text or "").strip()) if s else 0

        checks.append(
            {
                "id": "groq_key",
                "ok": True if force_custom else groq_ok,
                "skipped": True if force_custom else False,
                "label": "Ключ Groq в настройках",
                "detail": (
                    "Пропущено: выбран режим «своё письмо»"
                    if force_custom
                    else ("Заполнено" if groq_ok else "Раздел «Настройки» → Groq API key")
                ),
            }
        )
        yield emit("check", {"check": checks[-1]})

        checks.append(
            {
                "id": "resume_text",
                "ok": True if force_custom else resume_ok,
                "skipped": True if force_custom else False,
                "label": "Текст резюме",
                "detail": (
                    "Пропущено: выбран режим «своё письмо»"
                    if force_custom
                    else (f"{resume_len} симв." if resume_ok else "Вставьте текст или загрузите PDF")
                ),
            }
        )
        yield emit("check", {"check": checks[-1]})

        cfg = db.scalar(
            select(SearchConfig).where(SearchConfig.user_id == user.id).order_by(desc(SearchConfig.created_at))
        )
        search_ok = cfg is not None
        if cfg:
            search_snapshot = search_config_dict_from_row(cfg)

        checks.append(
            {
                "id": "search_config",
                "ok": search_ok,
                "label": "Параметры поиска (лимиты для расширения)",
                "detail": (
                    f"Лимит {cfg.daily_limit}/день, {getattr(cfg, 'hourly_limit', 35)}/час, пауза {cfg.delay_min}–{cfg.delay_max} с"
                    if cfg
                    else "Сохраните раздел «Поиск»"
                ),
            }
        )
        yield emit("check", {"check": checks[-1], "search_snapshot": search_snapshot})

        app_total = db.scalar(select(func.count(Application.id)).where(Application.user_id == user.id)) or 0
        checks.append(
            {
                "id": "applications_table",
                "ok": True,
                "label": "Таблица откликов доступна",
                "detail": f"Записей в истории: {app_total}",
            }
        )
        yield emit("check", {"check": checks[-1]})

        sess_total = db.scalar(select(func.count(DbSession.id)).where(DbSession.user_id == user.id)) or 0
        checks.append(
            {
                "id": "sessions_table",
                "ok": True,
                "label": "История сессий в БД",
                "detail": f"Сессий: {sess_total}",
            }
        )
        yield emit("check", {"check": checks[-1]})

        search_text_ok = bool(cfg and (cfg.search_text or "").strip())
        checks.append(
            {
                "id": "search_text_hh",
                "ok": search_text_ok,
                "label": "Текст поиска",
                "detail": (
                    f"«{(cfg.search_text or '').strip()[:80]}{'…' if len((cfg.search_text or '').strip()) > 80 else ''}»"
                    if search_text_ok
                    else ("Заполните поле запроса в разделе «Поиск»" if cfg else "Сохраните раздел «Поиск»")
                ),
            }
        )
        yield emit("check", {"check": checks[-1]})

        # vacancy preview (primary: web SERP)
        yield emit("step", {"message": "Ищем вакансию через веб‑выдачу hh.ru (HTML)…"})
        vacancy_preview_web = None
        vacancy_preview_api = None
        if search_ok and search_text_ok:
            try:
                vacancy_preview_web = build_vacancy_preview_payload_web(db, user.id)
                checks.append(
                    {
                        "id": "hh_web_vacancy_preview",
                        "ok": True,
                        "label": "hh.ru web: вакансия из выдачи",
                        "detail": "Получено из веб‑выдачи (HTML)",
                    }
                )
                yield emit("check", {"check": checks[-1], "vacancy_preview_web": vacancy_preview_web})
            except Exception as e:  # noqa: BLE001
                checks.append(
                    {
                        "id": "hh_web_vacancy_preview",
                        "ok": False,
                        "label": "hh.ru web: вакансия из выдачи",
                        "detail": str(e)[:500],
                    }
                )
                yield emit("check", {"check": checks[-1]})
        else:
            checks.append(
                {
                    "id": "hh_web_vacancy_preview",
                    "ok": False,
                    "skipped": True,
                    "label": "hh.ru web: вакансия из выдачи",
                    "detail": "Пропущено: нужен сохранённый поиск и текст запроса",
                }
            )
            yield emit("check", {"check": checks[-1]})

        # reserve: api.hh.ru
        yield emit("step", {"message": "Резервная проверка: ищем вакансию через API hh.ru…"})
        if search_ok and search_text_ok:
            try:
                vacancy_preview_api = build_vacancy_preview_payload_api(db, user.id)
                checks.append(
                    {
                        "id": "hh_api_vacancy_preview",
                        "ok": True,
                        "label": "hh.ru API: вакансия из поиска",
                        "detail": "Получено из api.hh.ru",
                    }
                )
                yield emit("check", {"check": checks[-1], "vacancy_preview_api": vacancy_preview_api})
            except Exception as e:  # noqa: BLE001
                msg = str(e)[:500]
                # 403 forbidden у hh.ru API — частый случай; не ломаем основной сценарий (web уже проверен выше)
                if "hh.ru API ответил с кодом 403" in msg and '"type":"forbidden"' in msg.replace(" ", ""):
                    msg = (
                        "hh.ru API вернул 403 forbidden (ограничение HeadHunter). Это не влияет на web‑поиск/расширение. "
                        "Можно настроить HH_API_USER_AGENT в backend/.env и попробовать другую сеть."
                    )
                    checks.append(
                        {
                            "id": "hh_api_vacancy_preview",
                            "ok": True,
                            "skipped": True,
                            "label": "hh.ru API: вакансия из поиска",
                            "detail": msg,
                        }
                    )
                    yield emit("check", {"check": checks[-1]})
                else:
                    checks.append(
                        {
                            "id": "hh_api_vacancy_preview",
                            "ok": False,
                            "label": "hh.ru API: вакансия из поиска",
                            "detail": msg,
                        }
                    )
                    yield emit("check", {"check": checks[-1]})
        else:
            checks.append(
                {
                    "id": "hh_api_vacancy_preview",
                    "ok": False,
                    "skipped": True,
                    "label": "hh.ru API: вакансия из поиска",
                    "detail": "Пропущено: нужен сохранённый поиск и текст запроса",
                }
            )
            yield emit("check", {"check": checks[-1]})

        # Для финального payload оставляем "главную" превьюшку как web (если есть),
        # чтобы UI мог показывать единообразно.
        vacancy_preview = vacancy_preview_web or vacancy_preview_api

        # AI letter (optional; Groq quota — only when include_letter=true)
        if not include_letter:
            checks.append(
                {
                    "id": "ai_letter_demo",
                    "ok": True,
                    "skipped": True,
                    "label": "AI: письмо к вакансии с hh.ru",
                    "detail": "Пропущено: включите «Демо-письмо Groq» в проверке, чтобы сделать один запрос к модели",
                }
            )
            yield emit("check", {"check": checks[-1]})
        elif s and (force_custom or (groq_ok and resume_ok)):
            yield emit(
                "step",
                {
                    "message": (
                        "Собираем письмо из вашего шаблона…"
                        if force_custom
                        else "Генерируем письмо через Groq… (это может занять 3–20 сек)"
                    )
                },
            )
            try:
                # Основной: web
                try:
                    letter_demo = build_letter_demo_payload_web(db, user.id, s, force_custom=force_custom)
                except Exception:
                    # Резерв: api.hh.ru (чисто чтобы не ломать тест)
                    letter_demo = build_letter_demo_payload_api(db, user.id, s, force_custom=force_custom)
                checks.append(
                    {
                        "id": "ai_letter_demo",
                        "ok": True,
                        "label": "Письмо к вакансии с hh.ru",
                        "detail": "Собрано из шаблона" if force_custom else "Сгенерировано по вашему поиску (Groq)",
                    }
                )
                yield emit("check", {"check": checks[-1], "letter_demo": letter_demo})
                if not letter_demo.get("validation_ok"):
                    checks.append(
                        {
                            "id": "letter_quality_hint",
                            "ok": False,
                            "label": "Проверка текста письма",
                            "detail": str(letter_demo.get("validation_message") or "Есть замечания"),
                        }
                    )
                    yield emit("check", {"check": checks[-1]})
            except Exception as e:  # noqa: BLE001
                checks.append(
                    {
                        "id": "ai_letter_demo",
                        "ok": False,
                        "label": "AI: письмо к вакансии с hh.ru",
                        "detail": str(e)[:500],
                    }
                )
                yield emit("check", {"check": checks[-1]})
        else:
            checks.append(
                {
                    "id": "ai_letter_demo",
                    "ok": False,
                    "skipped": True,
                    "label": "AI: письмо к вакансии с hh.ru",
                    "detail": "Пропущено: нужен ключ Groq и резюме",
                }
            )
            yield emit("check", {"check": checks[-1]})

        all_critical_ok = all(
            c.get("ok")
            for c in checks
            if c["id"] in {"groq_key", "resume_text", "search_config", "user_settings_row", "search_text_hh"}
        )
        letter_block_ok = next((c for c in checks if c["id"] == "ai_letter_demo"), {}).get("ok", False)
        extra["summary_ok"] = all_critical_ok and (letter_block_ok or not (groq_ok and resume_ok))

        final = {
            "ran_at": ran_at,
            "checks": checks,
            "letter_demo": letter_demo,
            "vacancy_preview": vacancy_preview,
            "vacancy_preview_web": vacancy_preview_web,
            "vacancy_preview_api": vacancy_preview_api,
            "search_snapshot": search_snapshot,
            "extra": extra,
        }
        yield emit("final", {"data": final, "message": "Диагностика завершена"})

    return StreamingResponse(gen(), media_type="application/x-ndjson")


@router.post("/run")
def run_diagnostics(
    include_letter: bool = Query(default=False),
    letter_mode: str = Query(default="ai"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Сводная проверка приложения: настройки, поиск, БД; демо-письмо Groq только при include_letter=true.
    """
    ran_at = dt.datetime.now(dt.UTC).isoformat()
    checks: list[dict[str, Any]] = []
    letter_demo: dict[str, Any] | None = None
    vacancy_preview: dict[str, Any] | None = None
    search_snapshot: dict[str, Any] | None = None
    extra: dict[str, Any] = {}

    s = db.get(UserSettings, user.id)
    checks.append(
        {
            "id": "user_settings_row",
            "ok": s is not None,
            "label": "Строка настроек в БД",
            "detail": "" if s else "Нет user_settings — сохраните настройки в интерфейсе",
        }
    )

    mode = str(letter_mode or "ai").strip().lower()
    force_custom = mode == "custom"
    groq_ok = bool(s and (s.groq_api_key_enc or "").strip())
    resume_ok = bool(s and (s.resume_text or "").strip())
    resume_len = len((s.resume_text or "").strip()) if s else 0

    checks.append(
        {
            "id": "groq_key",
            "ok": True if force_custom else groq_ok,
            "skipped": True if force_custom else False,
            "label": "Ключ Groq в настройках",
            "detail": (
                "Пропущено: выбран режим «своё письмо»"
                if force_custom
                else ("Заполнено" if groq_ok else "Раздел «Настройки» → Groq API key")
            ),
        }
    )
    checks.append(
        {
            "id": "resume_text",
            "ok": True if force_custom else resume_ok,
            "skipped": True if force_custom else False,
            "label": "Текст резюме",
            "detail": (
                "Пропущено: выбран режим «своё письмо»"
                if force_custom
                else (f"{resume_len} симв." if resume_ok else "Вставьте текст или загрузите PDF")
            ),
        }
    )

    cfg = db.scalar(
        select(SearchConfig).where(SearchConfig.user_id == user.id).order_by(desc(SearchConfig.created_at))
    )
    search_ok = cfg is not None
    if cfg:
        search_snapshot = search_config_dict_from_row(cfg)

    checks.append(
        {
            "id": "search_config",
            "ok": search_ok,
            "label": "Параметры поиска (лимиты для расширения)",
            "detail": (
                f"Лимит {cfg.daily_limit}/день, {getattr(cfg, 'hourly_limit', 35)}/час, пауза {cfg.delay_min}–{cfg.delay_max} с"
                if cfg
                else "Сохраните раздел «Поиск»"
            ),
        }
    )

    app_total = db.scalar(select(func.count(Application.id)).where(Application.user_id == user.id)) or 0
    checks.append(
        {
            "id": "applications_table",
            "ok": True,
            "label": "Таблица откликов доступна",
            "detail": f"Записей в истории: {app_total}",
        }
    )

    sess_total = db.scalar(select(func.count(DbSession.id)).where(DbSession.user_id == user.id)) or 0
    checks.append(
        {
            "id": "sessions_table",
            "ok": True,
            "label": "История сессий в БД",
            "detail": f"Сессий: {sess_total}",
        }
    )

    search_text_ok = bool(cfg and (cfg.search_text or "").strip())
    checks.append(
        {
            "id": "search_text_hh",
            "ok": search_text_ok,
            "label": "Текст поиска",
            "detail": (
                f"«{(cfg.search_text or '').strip()[:80]}{'…' if len((cfg.search_text or '').strip()) > 80 else ''}»"
                if search_text_ok
                else ("Заполните поле запроса в разделе «Поиск»" if cfg else "Сохраните раздел «Поиск»")
            ),
        }
    )

    vacancy_preview_web = None
    vacancy_preview_api = None
    if search_ok and search_text_ok:
        try:
            vacancy_preview_web = build_vacancy_preview_payload_web(db, user.id)
            checks.append(
                {
                    "id": "hh_web_vacancy_preview",
                    "ok": True,
                    "label": "hh.ru web: вакансия из выдачи",
                    "detail": "Получено из веб‑выдачи (HTML)",
                }
            )
        except Exception as e:  # noqa: BLE001
            checks.append(
                {
                    "id": "hh_web_vacancy_preview",
                    "ok": False,
                    "label": "hh.ru web: вакансия из выдачи",
                    "detail": str(e)[:500],
                }
            )
        try:
            vacancy_preview_api = build_vacancy_preview_payload_api(db, user.id)
            checks.append(
                {
                    "id": "hh_api_vacancy_preview",
                    "ok": True,
                    "label": "hh.ru API: вакансия из поиска",
                    "detail": "Получено из api.hh.ru",
                }
            )
        except Exception as e:  # noqa: BLE001
            msg = str(e)[:500]
            if "hh.ru API ответил с кодом 403" in msg and '"type":"forbidden"' in msg.replace(" ", ""):
                msg = (
                    "hh.ru API вернул 403 forbidden (ограничение HeadHunter). Это не влияет на web‑поиск/расширение. "
                    "Можно настроить HH_API_USER_AGENT в backend/.env и попробовать другую сеть."
                )
                checks.append(
                    {
                        "id": "hh_api_vacancy_preview",
                        "ok": True,
                        "skipped": True,
                        "label": "hh.ru API: вакансия из поиска",
                        "detail": msg,
                    }
                )
            else:
                checks.append(
                    {
                        "id": "hh_api_vacancy_preview",
                        "ok": False,
                        "label": "hh.ru API: вакансия из поиска",
                        "detail": msg,
                    }
                )
    else:
        checks.append(
            {
                "id": "hh_web_vacancy_preview",
                "ok": False,
                "skipped": True,
                "label": "hh.ru web: вакансия из выдачи",
                "detail": "Пропущено: нужен сохранённый поиск и текст запроса",
            }
        )
        checks.append(
            {
                "id": "hh_api_vacancy_preview",
                "ok": False,
                "skipped": True,
                "label": "hh.ru API: вакансия из поиска",
                "detail": "Пропущено: нужен сохранённый поиск и текст запроса",
            }
        )

    vacancy_preview = vacancy_preview_web or vacancy_preview_api

    if not include_letter:
        checks.append(
            {
                "id": "ai_letter_demo",
                "ok": True,
                "skipped": True,
                "label": "AI: письмо к вакансии с hh.ru",
                "detail": "Пропущено: передайте include_letter=true для одного запроса к Groq",
            }
        )
    elif s and (force_custom or (groq_ok and resume_ok)):
        try:
            try:
                letter_demo = build_letter_demo_payload_web(db, user.id, s, force_custom=force_custom)
            except Exception:
                letter_demo = build_letter_demo_payload_api(db, user.id, s, force_custom=force_custom)
            checks.append(
                {
                    "id": "ai_letter_demo",
                    "ok": True,
                    "label": "Письмо к вакансии с hh.ru",
                    "detail": "Собрано из шаблона" if force_custom else "Сгенерировано по вашему поиску (Groq)",
                }
            )
            if not letter_demo.get("validation_ok"):
                checks.append(
                    {
                        "id": "letter_quality_hint",
                        "ok": False,
                        "label": "Проверка текста письма",
                        "detail": str(letter_demo.get("validation_message") or "Есть замечания"),
                    }
                )
        except Exception as e:  # noqa: BLE001
            checks.append(
                {
                    "id": "ai_letter_demo",
                    "ok": False,
                    "label": "AI: письмо к вакансии с hh.ru",
                    "detail": str(e)[:500],
                }
            )
    else:
        checks.append(
            {
                "id": "ai_letter_demo",
                "ok": False,
                "skipped": True,
                "label": "AI: письмо к вакансии с hh.ru",
                "detail": "Пропущено: нужен ключ Groq и резюме",
            }
        )

    all_critical_ok = all(
        c.get("ok")
        for c in checks
        if c["id"] in {"groq_key", "resume_text", "search_config", "user_settings_row", "search_text_hh"}
    )
    letter_block_ok = next((c for c in checks if c["id"] == "ai_letter_demo"), {}).get("ok", False)
    extra["summary_ok"] = all_critical_ok and (letter_block_ok or not (groq_ok and resume_ok))

    return {
        "ran_at": ran_at,
        "checks": checks,
        "letter_demo": letter_demo,
        "vacancy_preview": vacancy_preview,
        "vacancy_preview_web": vacancy_preview_web,
        "vacancy_preview_api": vacancy_preview_api,
        "search_snapshot": search_snapshot,
        "extra": extra,
    }
