from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .auth import get_current_user
from .deps import get_db
from .models import Application, Session as DbSession

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/summary")
def summary(db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:
    day = func.date(Application.applied_at)
    stmt = (
        select(
            day.label("day"),
            Application.status,
            func.count(Application.id).label("cnt"),
        )
        .where(Application.user_id == user.id)
        .group_by(day, Application.status)
        .order_by(day)
    )

    rows = db.execute(stmt).all()
    by_day: dict[str, dict[str, int]] = {}
    totals = {"sent": 0, "skipped": 0, "error": 0}
    for d, status, cnt in rows:
        key = str(d)
        by_day.setdefault(key, {"sent": 0, "skipped": 0, "error": 0})
        by_day[key][status] = int(cnt)
        if status in totals:
            totals[status] += int(cnt)

    series = [{"day": d, **vals} for d, vals in by_day.items()]
    return {"totals": totals, "series": series}


@router.get("/sessions")
def sessions(db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:
    stmt = (
        select(DbSession)
        .where(DbSession.user_id == user.id)
        .order_by(DbSession.started_at.desc())
        .limit(200)
    )
    rows = db.scalars(stmt).all()
    return {
        "items": [
            {
                "id": s.id,
                "status": s.status,
                "started_at": s.started_at,
                "finished_at": s.finished_at,
                "total_found": s.total_found,
                "total_sent": s.total_sent,
                "total_skipped": s.total_skipped,
                "total_errors": s.total_errors,
            }
            for s in rows
        ]
    }

