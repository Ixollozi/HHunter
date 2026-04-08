from __future__ import annotations

import asyncio
import datetime as dt

from .database import SessionLocal
from .logger import log_app
from .models import Session as DbSession


_tasks: dict[int, asyncio.Task] = {}
_stop_flags: dict[int, asyncio.Event] = {}


async def run_session(user_id: int, session_id: int) -> None:
    """Серверный цикл откликов отключён. Оставлено для совместимости, если задача ещё жива."""
    db = SessionLocal()
    try:
        db_sess = db.get(DbSession, session_id)
        if db_sess:
            db_sess.status = "stopped"
            db_sess.finished_at = dt.datetime.now(dt.UTC)
            db.commit()
        log_app(
            user_id,
            "WARNING",
            "Серверная сессия откликов отключена — используйте расширение HHunter на hh.ru.",
            None,
        )
    finally:
        db.close()
        _tasks.pop(user_id, None)


def stop_background_session(user_id: int) -> None:
    event = _stop_flags.setdefault(user_id, asyncio.Event())
    event.set()


def is_running(user_id: int) -> bool:
    t = _tasks.get(user_id)
    return bool(t and not t.done())
