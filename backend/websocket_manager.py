"""
SWASTIK: WebSocket Manager
Maintains connected client sockets and broadcasts real-time telemetry packets.
"""
from fastapi import WebSocket
from typing import List
import json
import logging

logger = logging.getLogger("swastik_ws")

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WebSocket client connected. Total active: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"WebSocket client disconnected. Total active: {len(self.active_connections)}")

    async def broadcast_json(self, data: dict):
        if not self.active_connections:
            return
        
        text = json.dumps(data)
        stale_sockets = []
        for connection in self.active_connections:
            try:
                await connection.send_text(text)
            except Exception:
                stale_sockets.append(connection)

        for stale in stale_sockets:
            self.disconnect(stale)

WS_MANAGER = ConnectionManager()
