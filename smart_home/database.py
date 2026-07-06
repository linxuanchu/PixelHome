import sqlite3
from contextlib import contextmanager
from pathlib import Path


SCHEMA = """
CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'resident',
    authorized INTEGER NOT NULL DEFAULT 1,
    face_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device TEXT NOT NULL,
    metric TEXT NOT NULL,
    value TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT '',
    recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS detections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    labels TEXT NOT NULL,
    confidence REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS access_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_key TEXT NOT NULL,
    person_id INTEGER,
    authorized INTEGER NOT NULL,
    confidence REAL NOT NULL DEFAULT 0,
    snapshot_path TEXT,
    occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(person_id) REFERENCES people(id)
);
CREATE TABLE IF NOT EXISTS suspicious_people (
    subject_key TEXT PRIMARY KEY,
    failure_count INTEGER NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    latest_snapshot_path TEXT,
    status TEXT NOT NULL DEFAULT 'open'
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_telemetry_metric_time ON telemetry(metric, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_category_time ON events(category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_subject_time ON access_attempts(subject_key, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_people_authorized ON people(authorized);
"""


class Database:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.executescript(SCHEMA)
            defaults = {
                "access.failure_threshold": "3",
                "access.failure_window_minutes": "10",
                "storage.retention_days": "30",
                "climate.mode": "auto",
                "climate.target_temperature": "25",
                "climate.hysteresis": "1",
                "climate.actuator": "fan",
                "network.mode": "offline",
                "network.primary": "ethernet",
                "network.internet_available": "false",
                "features.llm_enabled": "false",
                "features.energy_enabled": "false",
                "features.occupancy_enabled": "false",
                "features.auto_lighting_enabled": "false",
                "features.custom_yolo_model": "yolo11n.pt",
            }
            connection.executemany(
                "INSERT OR IGNORE INTO settings(key, value) VALUES(?, ?)", defaults.items()
            )

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()

    def rows(self, query, params=()):
        with self.connect() as connection:
            return [dict(row) for row in connection.execute(query, params).fetchall()]

    def execute(self, query, params=()):
        with self.connect() as connection:
            cursor = connection.execute(query, params)
            return cursor.lastrowid

    def execute_many(self, query, values):
        with self.connect() as connection:
            connection.executemany(query, values)

    def scalar(self, query, params=(), default=None):
        with self.connect() as connection:
            row = connection.execute(query, params).fetchone()
            return row[0] if row else default
