from __future__ import annotations

import asyncio
from collections import defaultdict

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[int, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, user_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections[user_id].add(websocket)

    async def disconnect(self, user_id: int, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections[user_id].discard(websocket)

    async def send_json(self, user_id: int, data: dict) -> None:
        async with self._lock:
            conns = list(self._connections.get(user_id, set()))
        for ws in conns:
            try:
                await ws.send_json(data)
            except Exception:
                await self.disconnect(user_id, ws)


manager = ConnectionManager()

