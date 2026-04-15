from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from .apply import is_running, stop_background_session
from .auth import decode_token, get_current_user
from .deps import get_db
from .letter_demo import build_letter_demo_payload_api, build_letter_demo_payload_web
from .models import Session as DbSession, UserSettings
from .ws import manager

router = APIRouter(prefix="/session", tags=["session"])


@router.post("/letter-demo")
def letter_demo(db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict[str, Any]:
    """
    Тест письма: одна случайная вакансия из выдачи hh.ru по вашим параметрам «Поиск» + Groq. Отклик не выполняется.
    """
    s = db.get(UserSettings, user.id)
    if not s:
        raise HTTPException(status_code=400, detail="Нет настроек пользователя.")
    try:
        try:
            return build_letter_demo_payload_web(db, user.id, s)
        except Exception:
            return build_letter_demo_payload_api(db, user.id, s)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Ошибка генерации: {e}") from e


@router.post("/start")
def start_session(db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:  # noqa: ARG001
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="Автоотклик с сервера не поддерживается. Установите расширение HHunter и откликайтесь в браузере.",
    )


@router.post("/stop")
def stop_session(db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:  # noqa: ARG001
    stop_background_session(user.id)
    return {"status": "idle", "message": "Серверная сессия не используется."}


@router.get("/status")
def session_status(db: Session = Depends(get_db), user=Depends(get_current_user)) -> dict:
    sess = db.scalar(select(DbSession).where(DbSession.user_id == user.id).order_by(desc(DbSession.started_at)))
    if not sess:
        return {"running": False}
    return {
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


@router.websocket("/logs")
async def session_logs(websocket: WebSocket) -> None:
    token = websocket.query_params.get("token")
    if not token:
        auth = websocket.headers.get("authorization") or ""
        if auth.lower().startswith("bearer "):
            token = auth[7:]

    if not token:
        await websocket.close(code=4401)
        return

    try:
        payload = decode_token(token)
        user_id = int(payload["sub"])
    except Exception:
        await websocket.close(code=4401)
        return

    await manager.connect(user_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await manager.disconnect(user_id, websocket)
