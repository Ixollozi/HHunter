from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
from typing import Any

from .config import settings

_BACKEND_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _BACKEND_DIR.parent

# Абсолютный путь, чтобы не зависеть от cwd (start.py, uvicorn, тесты).
LOG_DIR = (_REPO_ROOT / "logs").resolve()

_CLEANUP_EVERY_SECONDS = 300
_last_cleanup_at: float = 0.0


def _as_int(v: object, default: int) -> int:
    try:
        return int(v)  # type: ignore[arg-type]
    except Exception:
        return default


def _max_bytes() -> int:
    mb = _as_int(getattr(settings, "log_max_mb", 10), 10)
    if mb <= 0:
        return 0
    return int(mb) * 1024 * 1024


def _retention_days() -> int:
    d = _as_int(getattr(settings, "log_retention_days", 7), 7)
    return int(d)


def _cleanup_due() -> bool:
    global _last_cleanup_at
    now = dt.datetime.now().timestamp()
    return (now - _last_cleanup_at) >= _CLEANUP_EVERY_SECONDS


def _maybe_cleanup_logs() -> None:
    """Лёгкая уборка раз в несколько минут: удаляем слишком старые файлы логов."""
    global _last_cleanup_at
    if not _cleanup_due():
        return
    _last_cleanup_at = dt.datetime.now().timestamp()
    days = _retention_days()
    if days <= 0:
        return
    cutoff = dt.datetime.now().timestamp() - (days * 86400)
    try:
        if not LOG_DIR.exists():
            return
        for p in LOG_DIR.rglob("*"):
            if not p.is_file():
                continue
            try:
                if p.stat().st_mtime < cutoff:
                    p.unlink(missing_ok=True)
            except OSError:
                continue
    except Exception:
        # Не ломаем работу приложения из-за уборки логов.
        return


def _rotate_if_needed(path: Path) -> None:
    """Ротация по размеру: file -> file.YYYYmmdd-HHMMSS.bak"""
    max_b = _max_bytes()
    if max_b <= 0:
        return
    try:
        if not path.exists():
            return
        sz = path.stat().st_size
        if sz < max_b:
            return
        ts = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        rotated = path.with_name(path.name + f".{ts}.bak")
        try:
            path.replace(rotated)
        except OSError:
            # На Windows файл мог быть занят на мгновение — в худшем случае просто не ротируем.
            return
    except OSError:
        return


def ensure_log_dirs(user_id: int | None = None) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    (LOG_DIR / "users").mkdir(parents=True, exist_ok=True)
    if user_id is not None:
        (LOG_DIR / "users" / f"user_{user_id}").mkdir(parents=True, exist_ok=True)


def _ts() -> str:
    return dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _write(path: Path, line: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    _rotate_if_needed(path)
    with open(path, "a", encoding="utf-8") as f:
        f.write(line + os.linesep)
    _maybe_cleanup_logs()


def prune_logs_now() -> None:
    """Форс-уборка (например при старте приложения)."""
    global _last_cleanup_at
    _last_cleanup_at = 0.0
    _maybe_cleanup_logs()


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
    # В прод-режиме (LOG_DEBUG=0) не пишем самые "шумные" и потенциально чувствительные стадии.
    if not bool(getattr(settings, "log_debug", False)):
        st = str((record or {}).get("stage") or "")
        if st in {"model_raw", "resume_block_preview"}:
            return
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

