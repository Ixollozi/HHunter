"""Один ответ для главной: меньше HTTP-запросов и нагрузки на браузер и БД."""

from __future__ import annotations

import datetime as dt
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from .apply import is_running
from .auth import get_current_user
from .deps import get_db
from .models import Application, SearchConfig, Session as DbSession, User

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _application_row(r: Application) -> dict[str, Any]:
    return {
        "id": r.id,
        "session_id": r.session_id,
        "vacancy_id": r.vacancy_id,
        "vacancy_name": r.vacancy_name,
        "vacancy_url": r.vacancy_url,
        "company_name": r.company_name,
        "company_url": r.company_url,
        "salary_from": r.salary_from,
        "salary_to": r.salary_to,
        "salary_currency": r.salary_currency,
        "status": r.status,
        "skip_reason": r.skip_reason,
        "error_message": r.error_message,
        "applied_at": r.applied_at,
    }


@router.get("/summary")
def dashboard_summary(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict[str, Any]:
    sess = db.scalar(select(DbSession).where(DbSession.user_id == user.id).order_by(desc(DbSession.started_at)))
    if not sess:
        status_block: dict[str, Any] = {"running": False, "session": None}
    else:
        status_block = {
            "running": is_running(user.id),
            "session": {
                "id": sess.id,
                "status": sess.status,
                "started_at": sess.started_at,
                "finished_at": sess.finished_at,
                "total_found": sess.total_found,
                "total_sent": sess.total_sent,
                "total_skipped": sess.total_skipped,
                "total_errors": sess.total_errors,
            },
        }

    recent = db.scalars(
        select(Application)
        .where(Application.user_id == user.id)
        .order_by(desc(Application.applied_at))
        .limit(5)
    ).all()

    day_start = dt.datetime.now(dt.UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    sent_cnt = db.scalar(
        select(func.count(Application.id)).where(
            Application.user_id == user.id,
            Application.status == "sent",
            Application.applied_at >= day_start,
        )
    )

    cfg = db.scalar(
        select(SearchConfig).where(SearchConfig.user_id == user.id).order_by(desc(SearchConfig.created_at))
    )
    extension: dict[str, Any] | None
    if cfg:
        extension = {
            "daily_limit": int(cfg.daily_limit or 200),
            "delay_min": int(cfg.delay_min),
            "delay_max": int(cfg.delay_max),
            "username": user.username,
        }
    else:
        extension = None

    return {
        "status": status_block,
        "recent_applications": [_application_row(r) for r in recent],
        "sent_today": {"count": int(sent_cnt or 0), "date_utc": day_start.date().isoformat()},
        "extension": extension,
    }
