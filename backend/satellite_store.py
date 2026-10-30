"""Persistent, verified-source satellite observations and drone telemetry.

All records are observations, never confirmations of illegal logging or fire.
Uses BOSQYN AI's existing SQLite database, with independent additive tables.
"""
from __future__ import annotations
import json
import math
from contextlib import contextmanager
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

DEFAULT_BBOX = (-77.1, -10.5, -75.1, -8.5)
SOURCES = ("NASA FIRMS", "NOAA GOES-19")


def utcnow():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def bbox_valid(values):
    if not isinstance(values, (list, tuple)) or len(values) != 4:
        raise ValueError("Se requieren cuatro coordenadas: oeste, sur, este, norte")
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in values):
        raise ValueError("Coordenadas numéricas inválidas")
    w, s, e, n = [float(v) for v in values]
    if not (-180 <= w < e <= 180 and -90 <= s < n <= 90):
        raise ValueError("Área geográfica fuera de rango")
    if (e - w) * (n - s) > 10:
        raise ValueError("Área demasiado grande: máximo 10 grados cuadrados")
    return w, s, e, n


def normalized_time(value):
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("La observación debe incluir la zona horaria UTC")
    return parsed.astimezone(timezone.utc).isoformat(timespec="milliseconds")


def coordinates(lat, lon):
    if isinstance(lat, bool) or isinstance(lon, bool):
        raise ValueError("Coordenadas inválidas")
    lat, lon = float(lat), float(lon)
    if not math.isfinite(lat) or not math.isfinite(lon) or not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("Coordenadas GPS inválidas")
    return lat, lon


def haversine_km(a, b):
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    delta_lat, delta_lon = lat2-lat1, lon2-lon1
    h = math.sin(delta_lat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(delta_lon/2)**2
    return 6371.0 * 2 * math.asin(min(1, math.sqrt(h)))


class SatelliteStore:
    def __init__(self, database: Path):
        self.database = str(database)
        self.lock = threading.RLock()
        with self.connect() as c:
            c.executescript("""
                CREATE TABLE IF NOT EXISTS forest_zones (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
                    west REAL NOT NULL, south REAL NOT NULL, east REAL NOT NULL, north REAL NOT NULL,
                    created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS satellite_observations (
                    id TEXT PRIMARY KEY, source TEXT NOT NULL, product TEXT NOT NULL,
                    product_ref TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL,
                    observed_at TEXT NOT NULL, fetched_at TEXT NOT NULL,
                    confidence TEXT, frp REAL, quality_code INTEGER,
                    zone_id INTEGER, detail_json TEXT NOT NULL DEFAULT '{}',
                    UNIQUE(source, product_ref, lat, lon, observed_at));
                CREATE INDEX IF NOT EXISTS idx_sat_observed ON satellite_observations(observed_at DESC);
                CREATE TABLE IF NOT EXISTS satellite_sync (
                    source TEXT PRIMARY KEY, status TEXT NOT NULL,
                    last_attempt TEXT, last_success TEXT, last_observed TEXT,
                    last_product_ref TEXT, last_error TEXT, count INTEGER DEFAULT 0);
                CREATE TABLE IF NOT EXISTS drone_telemetry (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, drone_name TEXT NOT NULL,
                    observed_at TEXT NOT NULL, received_at TEXT NOT NULL,
                    lat REAL NOT NULL, lon REAL NOT NULL, altitude_m REAL,
                    yaw_deg REAL, camera_yaw_deg REAL, camera_pitch_deg REAL,
                    position_type TEXT NOT NULL DEFAULT 'DRONE_GPS');
                CREATE INDEX IF NOT EXISTS idx_drone_time ON drone_telemetry(observed_at DESC);
                CREATE TABLE IF NOT EXISTS drone_observations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, drone_name TEXT NOT NULL,
                    category TEXT NOT NULL, confidence REAL NOT NULL, observed_at TEXT NOT NULL,
                    lat REAL NOT NULL, lon REAL NOT NULL, position_type TEXT NOT NULL DEFAULT 'DRONE_GPS',
                    alert_id INTEGER REFERENCES alerts(id) ON DELETE CASCADE,
                    UNIQUE(drone_name, category, observed_at, lat, lon));
                """)
            exists = c.execute("SELECT count(*) FROM forest_zones").fetchone()[0]
            if not exists:
                c.execute("INSERT INTO forest_zones(name,west,south,east,north,created_at) VALUES(?,?,?,?,?,?)",
                          ("Cobertura inicial · Huánuco", *DEFAULT_BBOX, utcnow()))

    @contextmanager
    def connect(self):
        c = sqlite3.connect(self.database, timeout=10)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys=ON")
        try:
            with c:
                yield c
        finally:
            c.close()

    def zones(self):
        with self.lock, self.connect() as c:
            return [dict(r) for r in c.execute("SELECT * FROM forest_zones ORDER BY id")]

    def save_zone(self, data):
        name = str(data.get("name", "")).strip()
        if not 1 <= len(name) <= 80:
            raise ValueError("Nombre de zona inválido")
        bbox = bbox_valid(data.get("bbox"))
        with self.lock, self.connect() as c:
            if c.execute("SELECT COUNT(*) FROM forest_zones").fetchone()[0] >= 12:
                raise ValueError("Máximo doce zonas")
            cur = c.execute("INSERT INTO forest_zones(name,west,south,east,north,created_at) VALUES(?,?,?,?,?,?)",
                            (name, *bbox, utcnow()))
            return {"id": cur.lastrowid, "name": name, "bbox": bbox}

    def upsert(self, events):
        count = 0
        with self.lock, self.connect() as c:
            for e in events:
                lat, lon = coordinates(e["lat"], e["lon"])
                source = str(e["source"])
                if source not in SOURCES:
                    continue
                observed = normalized_time(e["time"])
                try:
                    frp = float(e["frp"]) if e.get("frp") is not None else None
                    if frp is not None and not math.isfinite(frp): frp = None
                except (TypeError, ValueError):
                    frp = None
                cur = c.execute(
                    """INSERT OR IGNORE INTO satellite_observations
                    (id,source,product,product_ref,lat,lon,observed_at,fetched_at,confidence,frp,quality_code,zone_id,detail_json)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (e["id"],source,str(e.get("product","")),str(e.get("product_ref","")),lat,lon,observed,
                     str(e.get("fetched_at", utcnow())),str(e.get("confidence","")),frp,
                     e.get("quality_code"),e.get("zone_id"),json.dumps(e.get("detail",{}))))
                count += cur.rowcount
        return count

    def sync(self, source, status, count=0, error=None, observed=None, ref=None):
        if source not in ("NASA", "NOAA"):
            raise ValueError("Fuente inválida")
        now = utcnow()
        with self.lock, self.connect() as c:
            c.execute("""INSERT INTO satellite_sync(source,status,last_attempt,last_success,last_observed,last_product_ref,last_error,count)
                        VALUES(?,?,?,?,?,?,?,?)
                        ON CONFLICT(source) DO UPDATE SET status=excluded.status,last_attempt=excluded.last_attempt,
                        last_success=CASE WHEN excluded.status='ok' THEN excluded.last_success ELSE satellite_sync.last_success END,
                        last_observed=COALESCE(excluded.last_observed,satellite_sync.last_observed),
                        last_product_ref=COALESCE(excluded.last_product_ref,satellite_sync.last_product_ref),
                        last_error=excluded.last_error,count=excluded.count""",
                      (source,status,now,now if status=="ok" else None,observed,ref,error,count))

    def statuses(self):
        with self.lock, self.connect() as c:
            return {r["source"]: dict(r) for r in c.execute("SELECT * FROM satellite_sync")}

    def observations(self, limit=500, source=None, since=None, min_frp=None):
        q = "SELECT * FROM satellite_observations WHERE 1=1"
        params = []
        if source:
            if source not in SOURCES: raise ValueError("Fuente inválida")
            q += " AND source=?"; params.append(source)
        if since:
            q += " AND observed_at>=?"; params.append(normalized_time(since))
        if min_frp is not None:
            q += " AND frp>=?"; params.append(float(min_frp))
        q += " ORDER BY observed_at DESC LIMIT ?"
        params.append(min(max(int(limit),1),500))
        with self.lock, self.connect() as c:
            records = [dict(r) for r in c.execute(q,params)]
        for item in records:
            item["lat"],item["lon"],item["time"] = item["lat"],item["lon"],item["observed_at"]
            item["fetched_at"] = item["fetched_at"]
            item["quality"] = item["quality_code"]
            item.pop("detail_json",None)
        return records

    def latest_drone(self):
        with self.lock, self.connect() as c:
            return [dict(r) for r in c.execute("SELECT * FROM drone_telemetry WHERE id IN (SELECT MAX(id) FROM drone_telemetry GROUP BY drone_name) ORDER BY observed_at DESC LIMIT 30")]

    def drone_points(self, name, limit=100):
        with self.lock, self.connect() as c:
            return [dict(r) for r in c.execute("SELECT * FROM drone_telemetry WHERE drone_name=? ORDER BY observed_at DESC LIMIT ?",
                    (name,min(500,max(1,int(limit)))))]
    def record_drone(self, data):
        name = str(data.get("drone_name", "")).strip()
        if not (1 <= len(name) <= 80): raise ValueError("Nombre de dron inválido")
        lat,lon = coordinates(data.get("lat"),data.get("lon"))
        stamp = normalized_time(data.get("observed_at"))
        if abs((datetime.now(timezone.utc) - datetime.fromisoformat(stamp)).total_seconds()) > 300:
            raise ValueError("Telemetría fuera de ventana: sincroniza el reloj UTC del dron")
        def angle(key, low, high):
            val = data.get(key)
            if val is None: return None
            val = float(val)
            if not math.isfinite(val) or not low <= val <= high:
                raise ValueError(f"{key} fuera de rango")
            return val
        alt = angle("altitude_m",-500,20000)
        yaw=angle("yaw_deg",-360,360); cy=angle("camera_yaw_deg",-360,360); cp=angle("camera_pitch_deg",-180,180)
        now = utcnow()
        with self.lock, self.connect() as c:
            last = c.execute("SELECT observed_at FROM drone_telemetry WHERE drone_name=? ORDER BY id DESC LIMIT 1",(name,)).fetchone()
            if last and last[0]>=stamp: raise ValueError("Telemetría duplicada o anterior a la última registrada")
            cur=c.execute("""INSERT INTO drone_telemetry(drone_name,observed_at,received_at,lat,lon,altitude_m,yaw_deg,camera_yaw_deg,camera_pitch_deg)
                           VALUES(?,?,?,?,?,?,?,?,?)""", (name,stamp,now,lat,lon,alt,yaw,cy,cp))
            return {"id":cur.lastrowid,"drone_name":name,"lat":lat,"lon":lon,"observed_at":stamp,
                    "position_type":"DRONE_GPS","message":"Ubicación del dron, NO ubicación georreferenciada del objetivo"}

    def record_drone_detection(self, name, category, confidence, alert_id):
        """Attach unverified model evidence to the drone's last real GPS sample."""
        name = str(name).strip()
        if not 1 <= len(name) <= 80:
            raise ValueError("Nombre de dron inválido")
        if category not in ("HUMO", "INCENDIO", "TALA"):
            raise ValueError("Categoría de dron no válida")
        if isinstance(confidence, bool) or not isinstance(confidence, (float, int)) or not math.isfinite(confidence):
            raise ValueError("Probabilidad no válida")
        if not 0.85 <= confidence <= 1:
            raise ValueError("La confianza debe ser al menos 85 %")
        with self.lock, self.connect() as c:
            drone = c.execute(
                "SELECT * FROM drone_telemetry WHERE drone_name=? ORDER BY id DESC LIMIT 1",
                (name,),
            ).fetchone()
            if drone is None:
                raise ValueError("No existe telemetría GPS de este dron")
            last_seen = datetime.fromisoformat(drone["received_at"])
            if datetime.now(timezone.utc) - last_seen > timedelta(seconds=180):
                raise ValueError("Telemetría GPS vencida; espera una posición reciente")
            timestamp=utcnow()
            c.execute(
                "INSERT OR IGNORE INTO drone_observations"
                "(drone_name,category,confidence,observed_at,lat,lon,alert_id)"
                " VALUES(?,?,?,?,?,?,?)",
                (name,category,float(confidence),timestamp,drone["lat"],drone["lon"],alert_id),
            )
        return {"drone_name":name,"category":category,"confidence":confidence,
                "lat":drone["lat"],"lon":drone["lon"],"position_type":"DRONE_GPS",
                "alert_id":alert_id, "observed_at":timestamp,
                "warning":"La ubicación corresponde al dron, no al incendio"}

    def drone_events(self,limit=100):
        with self.lock, self.connect() as c:
            return [dict(row) for row in c.execute(
                "SELECT d.id,d.drone_name,d.category,d.confidence,d.observed_at,"
                "d.lat,d.lon,d.position_type,d.alert_id,a.status "
                "FROM drone_observations d LEFT JOIN alerts a ON a.id=d.alert_id "
                "ORDER BY d.id DESC LIMIT ?",(min(200,max(1,int(limit))),)
            )]

    def correlated(self, max_distance_km=4, hours=3):
        """Groups distinct satellite sources; drone GPS is never the target location."""
        cutoff=(datetime.now(timezone.utc)-timedelta(hours=24)).isoformat()
        rows=self.observations(500,since=cutoff)
        groups=[]
        for p in sorted(rows,key=lambda r:r["time"]):
            when=datetime.fromisoformat(p["time"])
            matching=next((g for g in groups if
                haversine_km((p["lat"],p["lon"]),(g["lat"],g["lon"]))<=max_distance_km and
                abs((when-datetime.fromisoformat(g["time"])).total_seconds())<=hours*3600),None)
            if matching:
                matching["sources"]=sorted(set(matching["sources"]+[p["source"]]))
                matching["evidence_ids"].append(p["id"])
                matching["observations"]+=1
            else:
                groups.append({"lat":p["lat"],"lon":p["lon"],"time":p["time"],
                               "sources":[p["source"]],"evidence_ids":[p["id"]],"observations":1})
        for g in groups:
            g["source_count"]=len(g["sources"])
            g["label"]="Coincidencia de anomalías térmicas, sin confirmación en campo"
        return sorted(groups,key=lambda g:g["time"],reverse=True)[:200]
