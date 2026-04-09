"""Один ответ для главной: меньше HTTP-запросов и нагрузки на браузер и БД."""

from __future__ import annotations

import datetime as dt
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import delete, desc, func, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from .apply import is_running
from .auth import get_current_user
from .deps import get_db
from .models import ActivityLog, Application, SearchConfig, Session as DbSession, User

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
    skipped_cnt = db.scalar(
        select(func.count(Application.id)).where(
            Application.user_id == user.id,
            Application.status == "skipped",
            Application.applied_at >= day_start,
        )
    )
    error_cnt = db.scalar(
        select(func.count(Application.id)).where(
            Application.user_id == user.id,
            Application.status == "error",
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
            "hourly_limit": int(getattr(cfg, "hourly_limit", 35) or 35),
            "username": user.username,
        }
    else:
        extension = None

    return {
        "status": status_block,
        "recent_applications": [_application_row(r) for r in recent],
        "sent_today": {"count": int(sent_cnt or 0), "date_utc": day_start.date().isoformat()},
        "activity_today": {
            "sent": int(sent_cnt or 0),
            "skipped": int(skipped_cnt or 0),
            "errors": int(error_cnt or 0),
            "date_utc": day_start.date().isoformat(),
        },
        "extension": extension,
    }


def _activity_row(r: ActivityLog) -> dict[str, Any]:
    return {
        "id": r.id,
        "created_at": r.created_at,
        "level": r.level,
        "source": r.source,
        "step": r.step,
        "message": r.message,
    }


@router.get("/activity-logs")
def dashboard_activity_logs(
    since_id: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Журнал: свежие сверху (order id DESC). Polling: since_id = max(id), приходят только более новые строки."""
    lim = max(1, min(int(limit or 200), 500))
    try:
        q = select(ActivityLog).where(ActivityLog.user_id == user.id)
        if since_id > 0:
            q = q.where(ActivityLog.id > since_id).order_by(desc(ActivityLog.id)).limit(lim)
            rows = db.scalars(q).all()
        else:
            rows = db.scalars(
                select(ActivityLog)
                .where(ActivityLog.user_id == user.id)
                .order_by(desc(ActivityLog.id))
                .limit(lim)
            ).all()
        return {"items": [_activity_row(r) for r in rows]}
    except OperationalError:
        # Старая БД без таблицы activity_logs — перезапуск бэкенда создаст её (create_all).
        return {"items": []}


@router.delete("/activity-logs")
def dashboard_activity_logs_clear(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Удалить все записи журнала расширения текущего пользователя."""
    try:
        n = db.scalar(select(func.count(ActivityLog.id)).where(ActivityLog.user_id == user.id)) or 0
        if n:
            db.execute(delete(ActivityLog).where(ActivityLog.user_id == user.id))
            db.commit()
        return {"ok": True, "deleted": int(n)}
    except OperationalError:
        db.rollback()
        return {"ok": True, "deleted": 0}
