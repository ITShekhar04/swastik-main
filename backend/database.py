"""
SWASTIK: SQLite Database Repository
Provides schema definitions and persistent storage for objects, observations,
band activity, scan decisions, signal quality metrics, and simulation alerts.
"""
import sqlite3
import os
import json
import time
from typing import List, Dict, Any, Optional

DB_PATH = os.path.join(os.path.dirname(__file__), "swastik_telemetry.db")

def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_connection()
    cursor = conn.cursor()
    
    # 1. OBJECTS table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS objects (
        object_id TEXT PRIMARY KEY,
        classification TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        distance REAL NOT NULL,
        direction TEXT NOT NULL,
        current_band TEXT NOT NULL,
        confidence REAL NOT NULL,
        status TEXT NOT NULL,
        created_at REAL NOT NULL,
        updated_at REAL NOT NULL
    )
    """)
    
    # 2. OBSERVATIONS table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS observations (
        observation_id INTEGER PRIMARY KEY AUTOINCREMENT,
        object_id TEXT NOT NULL,
        timestamp REAL NOT NULL,
        band TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        signal_strength REAL NOT NULL,
        synthetic_frequency_feature REAL NOT NULL,
        confidence REAL NOT NULL
    )
    """)
    
    # 3. BAND_ACTIVITY table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS band_activity (
        band_id TEXT PRIMARY KEY,
        timestamp REAL NOT NULL,
        activity_score REAL NOT NULL,
        observation_count INTEGER NOT NULL,
        last_active REAL,
        average_interval REAL,
        predicted_next_activity REAL,
        uncertainty REAL NOT NULL
    )
    """)
    
    # 4. SCAN_DECISIONS table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS scan_decisions (
        decision_id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp REAL NOT NULL,
        selected_band TEXT NOT NULL,
        priority_score REAL NOT NULL,
        prediction_score REAL NOT NULL,
        exploration_score REAL NOT NULL,
        exploitation_score REAL NOT NULL,
        uncertainty_score REAL NOT NULL,
        reason TEXT NOT NULL
    )
    """)
    
    # 5. SIGNAL_QUALITY table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS signal_quality (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp REAL NOT NULL,
        band TEXT NOT NULL,
        snr_before REAL NOT NULL,
        snr_after REAL NOT NULL,
        noise_level REAL NOT NULL,
        filter_status TEXT NOT NULL
    )
    """)
    
    # 6. ALERTS table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS alerts (
        alert_id TEXT PRIMARY KEY,
        timestamp REAL NOT NULL,
        object_id TEXT NOT NULL,
        alert_type TEXT NOT NULL,
        distance REAL NOT NULL,
        band TEXT NOT NULL,
        severity TEXT NOT NULL,
        acknowledged INTEGER DEFAULT 0
    )
    """)

    conn.commit()
    conn.close()

class DatabaseRepo:
    def __init__(self):
        init_db()

    def upsert_object(self, obj: Dict[str, Any]):
        conn = get_connection()
        cursor = conn.cursor()
        now = time.time()
        cursor.execute("""
        INSERT INTO objects (object_id, classification, x, y, distance, direction, current_band, confidence, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(object_id) DO UPDATE SET
            x=excluded.x,
            y=excluded.y,
            distance=excluded.distance,
            direction=excluded.direction,
            current_band=excluded.current_band,
            confidence=excluded.confidence,
            status=excluded.status,
            updated_at=excluded.updated_at
        """, (
            obj["object_id"], obj["classification"], obj["x"], obj["y"],
            obj["distance"], obj["direction"], obj["current_band"],
            obj["confidence"], obj["status"], obj.get("created_at", now), now
        ))
        conn.commit()
        conn.close()

    def record_observation(self, obs: Dict[str, Any]):
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("""
        INSERT INTO observations (object_id, timestamp, band, x, y, signal_strength, synthetic_frequency_feature, confidence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            obs["object_id"], obs.get("timestamp", time.time()), obs["band"],
            obs["x"], obs["y"], obs["signal_strength"],
            obs["synthetic_frequency_feature"], obs["confidence"]
        ))
        conn.commit()
        conn.close()

    def get_object_history(self, object_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("""
        SELECT * FROM observations WHERE object_id = ? ORDER BY timestamp DESC LIMIT ?
        """, (object_id, limit))
        rows = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return rows

    def record_scan_decision(self, decision: Dict[str, Any]):
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("""
        INSERT INTO scan_decisions (timestamp, selected_band, priority_score, prediction_score, exploration_score, exploitation_score, uncertainty_score, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            decision.get("timestamp", time.time()), decision["selected_band"],
            decision["priority_score"], decision["prediction_score"],
            decision["exploration_score"], decision["exploitation_score"],
            decision["uncertainty_score"], decision["reason"]
        ))
        conn.commit()
        conn.close()

    def get_recent_decisions(self, limit: int = 20) -> List[Dict[str, Any]]:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("""
        SELECT * FROM scan_decisions ORDER BY timestamp DESC LIMIT ?
        """, (limit,))
        rows = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return rows

    def record_alert(self, alert: Dict[str, Any]):
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("""
        INSERT OR REPLACE INTO alerts (alert_id, timestamp, object_id, alert_type, distance, band, severity, acknowledged)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            alert["alert_id"], alert.get("timestamp", time.time()), alert["object_id"],
            alert["alert_type"], alert["distance"], alert["band"], alert["severity"],
            alert.get("acknowledged", 0)
        ))
        conn.commit()
        conn.close()

    def get_active_alerts(self, limit: int = 25) -> List[Dict[str, Any]]:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("""
        SELECT * FROM alerts ORDER BY timestamp DESC LIMIT ?
        """, (limit,))
        rows = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return rows

DB = DatabaseRepo()
