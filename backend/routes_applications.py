from __future__ import annotations

import datetime as dt
from io import BytesIO

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.orm import Session

from .auth import get_current_user
from .deps import get_db
from .models import Application

router = APIRouter(prefix="/applications", tags=["applications"])


@router.get("/sent-today")
def sent_today_count(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> dict:
    """Один SQL COUNT вместо выборки сотен строк — для панели без лишней нагрузки на БД и сеть."""
    day_start = dt.datetime.now(dt.UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    cnt = db.scalar(
        select(func.count(Application.id)).where(
            Application.user_id == user.id,
            Application.status == "sent",
            Application.applied_at >= day_start,
        )
    )
    return {"count": int(cnt or 0), "date_utc": day_start.date().isoformat()}


@router.get("")
def list_applications(
    status: str | None = None,
    q: str | None = None,
    company: str | None = None,
    date_from: dt.date | None = Query(default=None),
    date_to: dt.date | None = Query(default=None),
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> dict:
    limit = min(max(limit, 1), 500)
    stmt = select(Application).where(Application.user_id == user.id)

    conds = []
    if status:
        conds.append(Application.status == status)
    if q:
        like = f"%{q}%"
        conds.append(or_(Application.vacancy_name.ilike(like), Application.company_name.ilike(like)))
    if company:
        conds.append(Application.company_name.ilike(f"%{company}%"))
    if date_from:
        conds.append(Application.applied_at >= dt.datetime.combine(date_from, dt.time.min, tzinfo=dt.UTC))
    if date_to:
        conds.append(Application.applied_at <= dt.datetime.combine(date_to, dt.time.max, tzinfo=dt.UTC))

    if conds:
        stmt = stmt.where(and_(*conds))

    stmt = stmt.order_by(desc(Application.applied_at)).limit(limit).offset(offset)
    rows = db.scalars(stmt).all()

    return {
        "items": [
            {
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
                "model_used": getattr(r, "model_used", None),
                "status": r.status,
                "skip_reason": r.skip_reason,
                "error_message": r.error_message,
                "applied_at": r.applied_at,
            }
            for r in rows
        ]
    }


@router.get("/export")
def export_excel(
    status: str | None = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> StreamingResponse:
    stmt = select(Application).where(Application.user_id == user.id)
    if status:
        stmt = stmt.where(Application.status == status)
    stmt = stmt.order_by(desc(Application.applied_at)).limit(5000)
    rows = db.scalars(stmt).all()

    wb = Workbook()
    ws = wb.active
    ws.title = "applications"
    ws.append(
        [
            "applied_at",
            "status",
            "skip_reason",
            "vacancy_name",
            "company_name",
            "vacancy_url",
            "salary_from",
            "salary_to",
            "salary_currency",
            "model_used",
            "error_message",
        ]
    )
    for r in rows:
        ws.append(
            [
                r.applied_at.isoformat() if r.applied_at else "",
                r.status,
                r.skip_reason or "",
                r.vacancy_name or "",
                r.company_name or "",
                r.vacancy_url or "",
                r.salary_from or "",
                r.salary_to or "",
                r.salary_currency or "",
                getattr(r, "model_used", "") or "",
                (r.error_message or "")[:500],
            ]
        )

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)

    filename = "applications.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

