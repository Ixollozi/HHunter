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
from .models import Application, BlacklistedVacancy

router = APIRouter(prefix="/applications", tags=["applications"])

_MIN_UTC = dt.datetime.min.replace(tzinfo=dt.UTC)


def _contact_phone_for_excel(raw: str | None) -> str:
    """Для Excel: только цифры, без пробелов и тире; ведущий + сохраняем, если был в исходной строке."""
    if not raw:
        return ""
    s = str(raw).strip()
    if not s:
        return ""
    want_plus = s.startswith("+")
    digits = "".join(ch for ch in s if ch.isdigit())
    if not digits:
        return ""
    return f"+{digits}" if want_plus else digits


def _application_row_dict(r: Application) -> dict:
    return {
        "id": r.id,
        "source": "application",
        "session_id": r.session_id,
        "vacancy_id": r.vacancy_id,
        "vacancy_name": r.vacancy_name,
        "vacancy_url": r.vacancy_url,
        "company_name": r.company_name,
        "company_url": r.company_url,
        "contact_name": r.contact_name,
        "contact_phone": r.contact_phone,
        "salary_from": r.salary_from,
        "salary_to": r.salary_to,
        "salary_currency": r.salary_currency,
        "model_used": getattr(r, "model_used", None),
        "status": r.status,
        "skip_reason": r.skip_reason,
        "error_message": r.error_message,
        "applied_at": r.applied_at,
    }


def _blacklist_row_dict(r: BlacklistedVacancy) -> dict:
    return {
        "id": r.id,
        "source": "blacklist",
        "session_id": None,
        "vacancy_id": r.vacancy_id,
        "vacancy_name": f"Вакансия {r.vacancy_id}",
        "vacancy_url": None,
        "company_name": None,
        "company_url": None,
        "contact_name": None,
        "contact_phone": None,
        "salary_from": None,
        "salary_to": None,
        "salary_currency": None,
        "model_used": None,
        "status": "blacklisted",
        "skip_reason": None,
        "error_message": r.reason,
        "applied_at": r.created_at,
    }


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
    offset = max(offset, 0)
    st = (status or "").strip() or None

    if st == "blacklisted":
        bl_stmt = select(BlacklistedVacancy).where(BlacklistedVacancy.user_id == user.id)
        bl_conds: list = []
        if q and (t := q.strip()):
            bl_conds.append(BlacklistedVacancy.vacancy_id.ilike(f"%{t}%"))
        if date_from:
            bl_conds.append(
                BlacklistedVacancy.created_at >= dt.datetime.combine(date_from, dt.time.min, tzinfo=dt.UTC)
            )
        if date_to:
            bl_conds.append(
                BlacklistedVacancy.created_at <= dt.datetime.combine(date_to, dt.time.max, tzinfo=dt.UTC)
            )
        if bl_conds:
            bl_stmt = bl_stmt.where(and_(*bl_conds))
        bl_stmt = bl_stmt.order_by(desc(BlacklistedVacancy.created_at)).limit(limit).offset(offset)
        bl_rows = db.scalars(bl_stmt).all()
        return {"items": [_blacklist_row_dict(r) for r in bl_rows]}

    stmt = select(Application).where(Application.user_id == user.id)

    conds = []
    if st:
        conds.append(Application.status == st)
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

    if st:
        stmt = stmt.order_by(desc(Application.applied_at)).limit(limit).offset(offset)
        rows = db.scalars(stmt).all()
        return {"items": [_application_row_dict(r) for r in rows]}

    # Все статусы: отклики + блэклист, общая сортировка по дате
    app_stmt = select(Application).where(Application.user_id == user.id)
    app_conds = []
    if q:
        like = f"%{q}%"
        app_conds.append(or_(Application.vacancy_name.ilike(like), Application.company_name.ilike(like)))
    if company:
        app_conds.append(Application.company_name.ilike(f"%{company}%"))
    if date_from:
        app_conds.append(Application.applied_at >= dt.datetime.combine(date_from, dt.time.min, tzinfo=dt.UTC))
    if date_to:
        app_conds.append(Application.applied_at <= dt.datetime.combine(date_to, dt.time.max, tzinfo=dt.UTC))
    if app_conds:
        app_stmt = app_stmt.where(and_(*app_conds))
    app_rows = db.scalars(app_stmt.order_by(desc(Application.applied_at)).limit(800)).all()

    bl_stmt = select(BlacklistedVacancy).where(BlacklistedVacancy.user_id == user.id)
    bl_conds2: list = []
    if q and (t2 := q.strip()):
        bl_conds2.append(BlacklistedVacancy.vacancy_id.ilike(f"%{t2}%"))
    if date_from:
        bl_conds2.append(
            BlacklistedVacancy.created_at >= dt.datetime.combine(date_from, dt.time.min, tzinfo=dt.UTC)
        )
    if date_to:
        bl_conds2.append(
            BlacklistedVacancy.created_at <= dt.datetime.combine(date_to, dt.time.max, tzinfo=dt.UTC)
        )
    if bl_conds2:
        bl_stmt = bl_stmt.where(and_(*bl_conds2))
    bl_rows = db.scalars(bl_stmt.order_by(desc(BlacklistedVacancy.created_at)).limit(500)).all()

    merged: list[dict] = [_application_row_dict(r) for r in app_rows] + [_blacklist_row_dict(r) for r in bl_rows]
    merged.sort(key=lambda x: x.get("applied_at") or _MIN_UTC, reverse=True)
    merged = merged[offset : offset + limit]

    return {"items": merged}


@router.get("/export")
def export_excel(
    status: str | None = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> StreamingResponse:
    st = (status or "").strip() or None
    headers = [
        "applied_at",
        "status",
        "skip_reason",
        "vacancy_name",
        "company_name",
        "contact_name",
        "contact_phone",
        "vacancy_url",
        "salary_from",
        "salary_to",
        "salary_currency",
        "model_used",
        "error_message",
    ]

    wb = Workbook()
    ws = wb.active
    ws.title = "applications"
    ws.append(headers)

    if st == "blacklisted":
        bl_rows = db.scalars(
            select(BlacklistedVacancy)
            .where(BlacklistedVacancy.user_id == user.id)
            .order_by(desc(BlacklistedVacancy.created_at))
            .limit(5000)
        ).all()
        for r in bl_rows:
            d = _blacklist_row_dict(r)
            ws.append(
                [
                    d["applied_at"].isoformat() if d.get("applied_at") else "",
                    d["status"],
                    "",
                    d.get("vacancy_name") or "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    (d.get("error_message") or "")[:500],
                ]
            )
    elif st:
        stmt = select(Application).where(Application.user_id == user.id, Application.status == st)
        stmt = stmt.order_by(desc(Application.applied_at)).limit(5000)
        rows = db.scalars(stmt).all()
        for r in rows:
            ws.append(
                [
                    r.applied_at.isoformat() if r.applied_at else "",
                    r.status,
                    r.skip_reason or "",
                    r.vacancy_name or "",
                    r.company_name or "",
                    r.contact_name or "",
                    _contact_phone_for_excel(r.contact_phone),
                    r.vacancy_url or "",
                    r.salary_from or "",
                    r.salary_to or "",
                    r.salary_currency or "",
                    getattr(r, "model_used", "") or "",
                    (r.error_message or "")[:500],
                ]
            )
    else:
        rows = db.scalars(
            select(Application)
            .where(Application.user_id == user.id)
            .order_by(desc(Application.applied_at))
            .limit(5000)
        ).all()
        for r in rows:
            ws.append(
                [
                    r.applied_at.isoformat() if r.applied_at else "",
                    r.status,
                    r.skip_reason or "",
                    r.vacancy_name or "",
                    r.company_name or "",
                    r.contact_name or "",
                    _contact_phone_for_excel(r.contact_phone),
                    r.vacancy_url or "",
                    r.salary_from or "",
                    r.salary_to or "",
                    r.salary_currency or "",
                    getattr(r, "model_used", "") or "",
                    (r.error_message or "")[:500],
                ]
            )
        bl_rows = db.scalars(
            select(BlacklistedVacancy)
            .where(BlacklistedVacancy.user_id == user.id)
            .order_by(desc(BlacklistedVacancy.created_at))
            .limit(2000)
        ).all()
        for r in bl_rows:
            d = _blacklist_row_dict(r)
            ws.append(
                [
                    d["applied_at"].isoformat() if d.get("applied_at") else "",
                    d["status"],
                    "",
                    d.get("vacancy_name") or "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    (d.get("error_message") or "")[:500],
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

