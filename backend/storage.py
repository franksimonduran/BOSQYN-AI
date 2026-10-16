"""SQLite persistence for manually captured BOSQYN AI evidence.

This prototype does not make machine-learning claims. The initial app stores
manual webcam captures; AI predictions can be integrated after evaluation.
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

STATUSES = frozenset({"PENDIENTE", "CONFIRMADA", "DESCARTADA"})


class EvidenceStore:
    """Local evidence archive for a single-computer prototype."""

    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir).resolve()
        self.image_dir = self.data_dir / "evidence"
        self.image_dir.mkdir(parents=True, exist_ok=True)
        self.database = self.data_dir / "bosqyn.sqlite3"
        with self.connect() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS alerts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    category TEXT NOT NULL,
                    source TEXT NOT NULL DEFAULT 'CAPTURA_MANUAL',
                    confidence REAL,
                    status TEXT NOT NULL DEFAULT 'PENDIENTE',
                    occurred_at TEXT NOT NULL,
                    evidence_filename TEXT NOT NULL
                )
            """)

    @contextmanager
    def connect(self):
        conn = sqlite3.connect(self.database, timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    @staticmethod
    def to_public(row):
        record = dict(row)
        record["evidence_url"] = f"/api/evidence/{record['id']}"
        record.pop("evidence_filename", None)
        return record

    def add_manual_capture(self, image_bytes: bytes, extension: str):
        if extension not in ("jpg", "png"):
            raise ValueError("Unsupported evidence extension")
        filename = f"{uuid4().hex}.{extension}"
        filepath = self.image_dir / filename
        filepath.write_bytes(image_bytes)
        stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
        try:
            with self.connect() as conn:
                cursor = conn.execute(
                    "INSERT INTO alerts(category, source, confidence, status, occurred_at, evidence_filename) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    ("REVISION_MANUAL", "CAPTURA_MANUAL", None, "PENDIENTE", stamp, filename),
                )
                row = conn.execute("SELECT * FROM alerts WHERE id = ?", (cursor.lastrowid,)).fetchone()
        except Exception:
            filepath.unlink(missing_ok=True)
            raise
        return self.to_public(row)

    def list_alerts(self, limit: int = 100):
        with self.connect() as conn:
            rows = conn.execute("SELECT * FROM alerts ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
            total = conn.execute("SELECT COUNT(*) FROM alerts").fetchone()[0]
        return {"total": total, "items": [self.to_public(row) for row in rows]}

    def get_alert(self, alert_id: int):
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM alerts WHERE id = ?", (alert_id,)).fetchone()
        return self.to_public(row) if row else None

    def get_image(self, alert_id: int):
        with self.connect() as conn:
            row = conn.execute("SELECT evidence_filename FROM alerts WHERE id = ?", (alert_id,)).fetchone()
        if not row:
            return None
        path = self.image_dir / row[0]
        return path if path.is_file() else None

    def update_status(self, alert_id: int, status: str):
        if status not in STATUSES:
            raise ValueError("Invalid alert status")
        with self.connect() as conn:
            cursor = conn.execute("UPDATE alerts SET status = ? WHERE id = ?", (status, alert_id))
            if cursor.rowcount == 0:
                return None
            row = conn.execute("SELECT * FROM alerts WHERE id = ?", (alert_id,)).fetchone()
        return self.to_public(row)

    def remove_alert(self, alert_id: int):
        with self.connect() as conn:
            row = conn.execute("SELECT evidence_filename FROM alerts WHERE id = ?", (alert_id,)).fetchone()
            if not row:
                return False
            conn.execute("DELETE FROM alerts WHERE id = ?", (alert_id,))
        (self.image_dir / row[0]).unlink(missing_ok=True)
        return True

    def activity_by_day(self, days: int = 7):
        """Read-only last-N-UTC-days breakdown of stored manual captures."""
        if not 1 <= days <= 31:
            raise ValueError("El periodo debe tener entre 1 y 31 días")
        today = datetime.now(timezone.utc).date()
        start = today - timedelta(days=days - 1)
        data = {
            (start + timedelta(days=i)).isoformat(): {
                "date": (start + timedelta(days=i)).isoformat(),
                "PENDIENTE": 0,
                "CONFIRMADA": 0,
                "DESCARTADA": 0,
            }
            for i in range(days)
        }
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT substr(occurred_at, 1, 10) AS day, status, COUNT(*) AS total "
                "FROM alerts WHERE occurred_at >= ? "
                "GROUP BY day, status",
                (start.isoformat(),),
            ).fetchall()
        for row in rows:
            day = row["day"]
            status = row["status"]
            if day in data and status in ("PENDIENTE", "CONFIRMADA", "DESCARTADA"):
                data[day][status] = int(row["total"])
        return list(data.values())

    def statistics(self):
        with self.connect() as conn:
            total = conn.execute("SELECT COUNT(*) FROM alerts").fetchone()[0]
            by_status = dict(conn.execute("SELECT status, COUNT(*) FROM alerts GROUP BY status").fetchall())
            by_category = dict(conn.execute("SELECT category, COUNT(*) FROM alerts GROUP BY category").fetchall())
        return {
            "total": total,
            "by_status": by_status,
            "by_category": by_category,
            "notice": "Counts reflect stored records, not accuracy or performance of an AI model.",
        }
