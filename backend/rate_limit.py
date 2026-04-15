from __future__ import annotations

import time
from dataclasses import dataclass


@dataclass
class _Bucket:
    tokens: float
    updated_at: float


class TokenBucketLimiter:
    """
    Простая in-memory реализация token bucket.

    Важно: per-process (если uvicorn/gunicorn с несколькими воркерами — лимит не глобальный).
    Для HHunter (локально/одиночный сервер) этого достаточно как защиты от случайного спама.
    """

    def __init__(self) -> None:
        self._buckets: dict[str, _Bucket] = {}

    def allow(self, *, key: str, capacity: int, refill_per_sec: float, cost: float = 1.0) -> tuple[bool, float]:
        """
        Возвращает (ok, retry_after_seconds).
        """
        now = time.time()
        b = self._buckets.get(key)
        if b is None:
            b = _Bucket(tokens=float(capacity), updated_at=now)
            self._buckets[key] = b

        # refill
        dt = max(0.0, now - b.updated_at)
        b.updated_at = now
        b.tokens = min(float(capacity), b.tokens + dt * float(refill_per_sec))

        if b.tokens >= cost:
            b.tokens -= cost
            return True, 0.0

        need = max(0.0, cost - b.tokens)
        if refill_per_sec <= 0:
            return False, 60.0
        retry_after = need / float(refill_per_sec)
        return False, float(retry_after)


limiter = TokenBucketLimiter()

