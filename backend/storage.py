"""SQLite archive of manual evidence and unverified visual incidents."""

from __future__ import annotations

import sqlite3
import base64
import math
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
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS alerts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    category TEXT NOT NULL,
                    source TEXT NOT NULL DEFAULT 'CAPTURA_MANUAL',
                    confidence REAL,
                    status TEXT NOT NULL DEFAULT 'PENDIENTE',
                    occurred_at TEXT NOT NULL,
                    evidence_filename TEXT NOT NULL
                )
            """
            )

            conn.execute(
                "CREATE TABLE IF NOT EXISTS alert_audio (alert_id INTEGER PRIMARY KEY REFERENCES alerts(id) ON DELETE CASCADE, wav BLOB NOT NULL)"
            )

    @contextmanager
    def connect(self):
        conn = sqlite3.connect(self.database, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def to_public(self, row):
        record = dict(row)
        record["evidence_url"] = f"/api/evidence/{record['id']}"
        with self.connect() as conn:
            if conn.execute(
                "SELECT 1 FROM alert_audio WHERE alert_id=?", (record["id"],)
            ).fetchone():
                record["audio_url"] = f"/api/audio-evidence/{record['id']}"
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
                    (
                        "REVISION_MANUAL",
                        "CAPTURA_MANUAL",
                        None,
                        "PENDIENTE",
                        stamp,
                        filename,
                    ),
                )
                row = conn.execute(
                    "SELECT * FROM alerts WHERE id = ?", (cursor.lastrowid,)
                ).fetchone()
        except Exception:
            filepath.unlink(missing_ok=True)
            raise
        return self.to_public(row)

    def list_alerts(self, limit=100, offset=0, category="", status="", source=""):
        clauses = []
        values = []
        for key, value in [
            ("category", category),
            ("status", status),
            ("source", source),
        ]:
            if value:
                clauses.append(key + " = ?")
                values.append(value)
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM alerts" + where + " ORDER BY id DESC LIMIT ? OFFSET ?",
                (*values, limit, offset),
            ).fetchall()
            total = conn.execute(
                "SELECT COUNT(*) FROM alerts" + where, values
            ).fetchone()[0]
        return {"total": total, "items": [self.to_public(row) for row in rows]}

    def get_alert(self, alert_id: int):
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM alerts WHERE id = ?", (alert_id,)
            ).fetchone()
        return self.to_public(row) if row else None

    def get_image(self, alert_id: int):
        with self.connect() as conn:
            row = conn.execute(
                "SELECT evidence_filename FROM alerts WHERE id = ?", (alert_id,)
            ).fetchone()
        if not row:
            return None
        path = self.image_dir / row[0]
        return path if path.is_file() else None

    def update_status(self, alert_id: int, status: str):
        if status not in STATUSES:
            raise ValueError("Invalid alert status")
        with self.connect() as conn:
            cursor = conn.execute(
                "UPDATE alerts SET status = ? WHERE id = ?", (status, alert_id)
            )
            if cursor.rowcount == 0:
                return None
            row = conn.execute(
                "SELECT * FROM alerts WHERE id = ?", (alert_id,)
            ).fetchone()
        return self.to_public(row)

    def remove_alert(self, alert_id: int):
        with self.connect() as conn:
            row = conn.execute(
                "SELECT evidence_filename FROM alerts WHERE id = ?", (alert_id,)
            ).fetchone()
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
            by_status = dict(
                conn.execute(
                    "SELECT status, COUNT(*) FROM alerts GROUP BY status"
                ).fetchall()
            )
            by_category = dict(
                conn.execute(
                    "SELECT category, COUNT(*) FROM alerts GROUP BY category"
                ).fetchall()
            )
        return {
            "total": total,
            "by_status": by_status,
            "by_category": by_category,
            "by_source": self.source_counts(),
            "notice": "Counts reflect stored records, not accuracy or performance of an AI model.",
        }

    def add_visual_incident(self, category, confidence, image_bytes, extension):
        if category not in {"HUMO", "INCENDIO", "TALA"}:
            raise ValueError("Categoría automática no admitida")
        if (
            isinstance(confidence, bool)
            or not isinstance(confidence, (int, float))
            or not math.isfinite(confidence)
            or not 0.85 <= confidence <= 1
        ):
            raise ValueError("Confianza automática fuera de rango")
        if extension not in {"jpg", "png"}:
            raise ValueError("Formato no admitido")
        now = datetime.now(timezone.utc)
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            prior = conn.execute(
                "SELECT * FROM alerts WHERE source='VISION_AUTOMATICA' AND category=? AND occurred_at>=? ORDER BY id DESC LIMIT 1",
                (category, (now - timedelta(seconds=60)).isoformat()),
            ).fetchone()
            if prior:
                return {**self.to_public(prior), "duplicate": True}
            filename = f"{uuid4().hex}.{extension}"
            path = self.image_dir / filename
            path.write_bytes(image_bytes)
            try:
                cur = conn.execute(
                    "INSERT INTO alerts(category,source,confidence,status,occurred_at,evidence_filename) VALUES (?,?,?,'PENDIENTE',?,?)",
                    (
                        category,
                        "VISION_AUTOMATICA",
                        confidence,
                        now.isoformat(),
                        filename,
                    ),
                )
                row = conn.execute(
                    "SELECT * FROM alerts WHERE id=?", (cur.lastrowid,)
                ).fetchone()
            except Exception:
                path.unlink(missing_ok=True)
                raise
        return {**self.to_public(row), "duplicate": False}

    def add_drone_visual_incident(self, category, confidence, image_bytes, extension):
        """Save real model frame as unverified drone evidence with DRON_VISUAL source."""
        if category not in {"HUMO", "INCENDIO", "TALA"}:
            raise ValueError("Categoría visual del dron no admitida")
        if (isinstance(confidence, bool) or not isinstance(confidence, (int, float))
                or not math.isfinite(confidence) or not 0.85 <= confidence <= 1.0):
            raise ValueError("Confianza insuficiente o inválida")
        if extension not in {"jpg", "png"}:
            raise ValueError("Extensión de evidencia inválida")
        now = datetime.now(timezone.utc)
        filename = f"{uuid4().hex}.{extension}"
        path = self.image_dir / filename
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            prior = conn.execute(
                "SELECT * FROM alerts WHERE source='DRON_VISUAL' AND category=? AND occurred_at>=? ORDER BY id DESC LIMIT 1",
                (category, (now - timedelta(seconds=60)).isoformat()),
            ).fetchone()
            if prior:
                return {**self.to_public(prior), "duplicate": True}
            path.write_bytes(image_bytes)
            try:
                cur = conn.execute(
                    "INSERT INTO alerts(category,source,confidence,status,occurred_at,evidence_filename) "
                    "VALUES (?, 'DRON_VISUAL', ?, 'PENDIENTE', ?, ?)",
                    (category, confidence, now.isoformat(), filename),
                )
                row = conn.execute("SELECT * FROM alerts WHERE id=?", (cur.lastrowid,)).fetchone()
            except Exception:
                path.unlink(missing_ok=True)
                raise
        return {**self.to_public(row), "duplicate": False}

    def export_backup(self):
        records = []
        size = 0
        with self.connect() as conn:
            conn.execute("BEGIN")
            for row in conn.execute("SELECT * FROM alerts ORDER BY id"):
                record = dict(row)
                path = self.image_dir / record.pop("evidence_filename")
                raw = path.read_bytes()
                size += len(raw)
                if size > 30_000_000:
                    raise ValueError(
                        "El respaldo supera 30 MB de imágenes; conserva una copia del volumen antes de continuar"
                    )
                record["image_data"] = (
                    "data:image/"
                    + ("jpeg" if path.suffix == ".jpg" else "png")
                    + ";base64,"
                    + base64.b64encode(raw).decode()
                )
                audio = self.get_audio(record["id"])
                if audio:
                    size += len(audio)
                    if size > 30_000_000:
                        raise ValueError("El respaldo supera 30 MB")
                    record["audio_data"] = base64.b64encode(audio).decode()
                records.append(record)
        return {
            "format": "bosqyn-server-evidence",
            "version": 1,
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "records": records,
        }

    def restore_backup(self, payload):
        if (
            payload.get("format") != "bosqyn-server-evidence"
            or payload.get("version") != 1
            or not isinstance(payload.get("records"), list)
            or len(payload["records"]) > 5000
        ):
            raise ValueError("Respaldo no compatible")
        prepared = []
        for r in payload["records"]:
            if (
                not isinstance(r, dict)
                or r.get("status") not in STATUSES
                or r.get("source") not in {"CAPTURA_MANUAL", "VISION_AUTOMATICA"}
            ):
                raise ValueError("Registro de respaldo inválido")
            category = r.get("category")
            if category not in {"REVISION_MANUAL", "HUMO", "INCENDIO", "TALA"} or (
                r["source"] == "CAPTURA_MANUAL"
            ) != (category == "REVISION_MANUAL"):
                raise ValueError("Categoría inválida")
            score = r.get("confidence")
            if score is not None and (
                isinstance(score, bool)
                or not isinstance(score, (int, float))
                or not math.isfinite(score)
                or not 0 <= score <= 1
            ):
                raise ValueError("Confianza inválida")
            stamp = datetime.fromisoformat(r.get("occurred_at", ""))
            if stamp.tzinfo is None:
                raise ValueError("La fecha requiere zona horaria")
            image = r.get("image_data", "")
            if not isinstance(image, str) or "," not in image:
                raise ValueError("Imagen inválida")
            prefix, encoded = image.split(",", 1)
            ext = {"data:image/jpeg;base64": "jpg", "data:image/png;base64": "png"}.get(
                prefix
            )
            try:
                raw = base64.b64decode(encoded, validate=True)
            except Exception as error:
                raise ValueError("Imagen inválida") from error
            if (
                ext is None
                or not 0 < len(raw) <= 2_500_000
                or not raw.startswith(
                    b"\xff\xd8\xff" if ext == "jpg" else b"\x89PNG\r\n\x1a\n"
                )
            ):
                raise ValueError("Imagen inválida")
            audio_raw = None
            if r.get("audio_data") is not None:
                try:
                    audio_raw = base64.b64decode(r["audio_data"], validate=True)
                except Exception as error:
                    raise ValueError("Audio de respaldo inválido") from error
                validate_wav(audio_raw)
                if r["source"] != "VISION_AUTOMATICA":
                    raise ValueError("Audio sin incidente automático")
            prepared.append(
                (
                    audio_raw,
                    category,
                    r["source"],
                    score,
                    r["status"],
                    stamp.astimezone(timezone.utc).isoformat(),
                    raw,
                    ext,
                )
            )
        created = []
        inserted = 0
        try:
            with self.connect() as conn:
                conn.execute("BEGIN IMMEDIATE")
                for audio_raw, cat, source, score, status, stamp, raw, ext in prepared:
                    candidates = conn.execute(
                        "SELECT evidence_filename FROM alerts WHERE category=? AND source=? AND occurred_at=?",
                        (cat, source, stamp),
                    ).fetchall()
                    if any(
                        (self.image_dir / x[0]).read_bytes() == raw for x in candidates
                    ):
                        continue
                    filename = f"{uuid4().hex}.{ext}"
                    path = self.image_dir / filename
                    path.write_bytes(raw)
                    created.append(path)
                    cur = conn.execute(
                        "INSERT INTO alerts(category,source,confidence,status,occurred_at,evidence_filename) VALUES (?,?,?,?,?,?)",
                        (cat, source, score, status, stamp, filename),
                    )
                    if audio_raw:
                        conn.execute(
                            "INSERT INTO alert_audio(alert_id,wav) VALUES (?,?)",
                            (cur.lastrowid, audio_raw),
                        )
                    inserted += 1
        except Exception:
            for path in created:
                path.unlink(missing_ok=True)
            raise
        return {"restored": inserted, "duplicates": len(prepared) - inserted}

    def retention(self, days=90, apply=False):
        if not isinstance(days, int) or isinstance(days, bool) or not 7 <= days <= 3650:
            raise ValueError("La retención debe estar entre 7 y 3650 días")
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        with self.connect() as conn:
            if apply:
                conn.execute("BEGIN IMMEDIATE")
            rows = conn.execute(
                "SELECT id,evidence_filename FROM alerts WHERE status='DESCARTADA' AND occurred_at<?",
                (cutoff,),
            ).fetchall()
            if apply:
                conn.executemany(
                    "DELETE FROM alerts WHERE id=?", [(r["id"],) for r in rows]
                )
        if apply:
            for row in rows:
                (self.image_dir / row["evidence_filename"]).unlink(missing_ok=True)
        return {
            "eligible": len(rows),
            "removed": len(rows) if apply else 0,
            "days": days,
            "policy": "Solo descartadas; pendientes y confirmadas se conservan",
        }

    def source_counts(self):
        with self.connect() as conn:
            return dict(
                conn.execute(
                    "SELECT source, COUNT(*) FROM alerts GROUP BY source"
                ).fetchall()
            )

    def attach_audio(self, alert_id, wav):
        validate_wav(wav)
        with self.connect() as conn:
            row = conn.execute(
                "SELECT category,source FROM alerts WHERE id=?", (alert_id,)
            ).fetchone()
            if (
                not row
                or row["source"] != "VISION_AUTOMATICA"
                or row["category"] not in {"HUMO", "INCENDIO", "TALA"}
            ):
                raise ValueError("El audio solo se adjunta a incidentes de amenaza")
            conn.execute(
                "INSERT OR IGNORE INTO alert_audio(alert_id,wav) VALUES (?,?)",
                (alert_id, wav),
            )

    def get_audio(self, alert_id):
        with self.connect() as conn:
            row = conn.execute(
                "SELECT wav FROM alert_audio WHERE alert_id=?", (alert_id,)
            ).fetchone()
        return bytes(row[0]) if row else None


def validate_wav(wav):
    import io, wave

    try:
        with wave.open(io.BytesIO(wav), "rb") as audio:
            if (
                audio.getnchannels() != 1
                or audio.getframerate() != 16000
                or audio.getsampwidth() != 2
                or not 16000 <= audio.getnframes() <= 64000
                or len(audio.readframes(audio.getnframes())) != audio.getnframes() * 2
            ):
                raise ValueError(
                    "Clip WAV inválido: se requiere mono PCM16, 16 kHz y 1–4 segundos"
                )
    except (wave.Error, EOFError) as error:
        raise ValueError("Archivo WAV inválido") from error
    if len(wav) > 130000:
        raise ValueError("Clip demasiado grande")
