from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
from typing import Any


LOG_DIR = Path("logs")


def ensure_log_dirs(user_id: int | None = None) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    (LOG_DIR / "users").mkdir(parents=True, exist_ok=True)
    if user_id is not None:
        (LOG_DIR / "users" / f"user_{user_id}").mkdir(parents=True, exist_ok=True)


def _ts() -> str:
    return dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _write(path: Path, line: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(line + os.linesep)


def log_line(user_id: int, level: str, message: str, progress: tuple[int, int] | None = None) -> str:
    prog = ""
    if progress:
        prog = f" ({progress[0]}/{progress[1]})"
    return f"[{_ts()}] [user_id:{user_id}] [{level.upper()}]{prog} {message}"


def log_letter_generation(user_id: int | None, record: dict[str, Any]) -> None:
    """
    Подробный журнал генерации писем (одна строка = один JSON).
    Файл: logs/letter_generation.jsonl — не пишет ключ API и полный текст резюме.
    """
    ensure_log_dirs(user_id)
    payload = {
        "ts": dt.datetime.now(dt.UTC).isoformat(),
        "user_id": user_id,
        **record,
    }
    line = json.dumps(payload, ensure_ascii=False, default=str)
    _write(LOG_DIR / "letter_generation.jsonl", line)
    if user_id is not None:
        _write(LOG_DIR / "users" / f"user_{user_id}" / "letter_generation.jsonl", line)


def log_app(user_id: int, level: str, message: str, progress: tuple[int, int] | None = None) -> None:
    ensure_log_dirs(user_id)
    line = log_line(user_id, level, message, progress)
    _write(LOG_DIR / "app.log", line)
    _write(LOG_DIR / "users" / f"user_{user_id}" / f"{dt.date.today().isoformat()}.log", line)
    if level.upper() in {"ERROR", "CRITICAL"}:
        _write(LOG_DIR / "errors.log", line)

