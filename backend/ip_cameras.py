"""Private-network IP cameras: encrypted configuration + outbound-only bridge.

Railway never requests user-supplied URLs. The installed LAN bridge connects to
registered RFC1918 addresses; browser reads only same-origin authenticated JPEGs.
"""
from __future__ import annotations
import hmac
import ipaddress
import json
import os
import re
import sqlite3
import threading
import time
from datetime import datetime, timezone
from urllib.parse import urlsplit

NETWORKS=tuple(ipaddress.ip_network(x) for x in ("10.0.0.0/8","172.16.0.0/12","192.168.0.0/16"))
PROTOCOLS={"RTSP":"rtsp","HTTP/MJPEG":"http","ONVIF":"http"}
KINDS={"telefono","camara_ip","seguridad"}
MAX_CAMERAS=6
MAX_FRAME_BYTES=480_000

def stamp():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")

def validate_source(url,protocol,port):
    """Explicit literal RFC1918 IPv4 only: no DNS, cloud metadata or public SSRF."""
    if not isinstance(url,str) or len(url)>1024 or any(ord(c)<32 for c in url):
        raise ValueError("Dirección de cámara inválida")
    if protocol not in PROTOCOLS: raise ValueError("Protocolo no admitido")
    p=urlsplit(url)
    if p.scheme.lower()!=PROTOCOLS[protocol] and not (protocol=="HTTP/MJPEG" and p.scheme.lower()=="https"):
        raise ValueError("El protocolo no coincide con la URL")
    if p.username is not None or p.password is not None or p.fragment:
        raise ValueError("No incluyas credenciales ni fragmentos dentro de la URL")
    try:
        addr=ipaddress.ip_address(p.hostname or "")
    except ValueError as exc:
        raise ValueError("Introduce una dirección IPv4 privada de tu propia red") from exc
    if addr.version!=4 or not any(addr in net for net in NETWORKS):
        raise ValueError("Solo IP privadas autorizadas de la LAN o VPN")
    try: parsed_port=p.port
    except ValueError as exc: raise ValueError("Puerto inválido") from exc
    try: supplied=int(port) if port not in (None,"") else parsed_port
    except (TypeError,ValueError) as exc:raise ValueError("Puerto inválido") from exc
    if supplied is None: supplied=554 if protocol=="RTSP" else 80
    if not 1<=supplied<=65535: raise ValueError("Puerto fuera de rango")
    if parsed_port is not None and supplied!=parsed_port:
        raise ValueError("El puerto indicado no coincide con el de la URL")
    if not p.path.startswith("/") and p.path: raise ValueError("Ruta inválida")
    if protocol=="ONVIF" and not p.path:
        raise ValueError("Especifica la ruta ONVIF, p. ej. /onvif/device_service")
    netloc=f"{addr}:{supplied}"
    return f"{p.scheme.lower()}://{netloc}{p.path or '/'}"+(("?"+p.query) if p.query else ""), supplied

class CameraRegistry:
    def __init__(self,database):
        self.database=str(database)
        self.lock=threading.RLock()
        self.latest={}
        with self.connect() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS ip_cameras (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,kind TEXT NOT NULL, protocol TEXT NOT NULL,
                port INTEGER NOT NULL, source_ciphertext TEXT NOT NULL,
                desired TEXT NOT NULL DEFAULT 'off',
                test_seq INTEGER NOT NULL DEFAULT 0,
                audio_enabled INTEGER NOT NULL DEFAULT 0,
                threshold REAL NOT NULL DEFAULT 0.85,
                created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS ip_camera_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                camera_id INTEGER NOT NULL REFERENCES ip_cameras(id) ON DELETE CASCADE,
                occurred_at TEXT NOT NULL,
                category TEXT NOT NULL,
                confidence REAL,
                alert_id INTEGER REFERENCES alerts(id) ON DELETE SET NULL);
            CREATE INDEX IF NOT EXISTS idx_camera_event ON ip_camera_events(camera_id,id DESC);
            """)
    def connect(self):
        from contextlib import contextmanager
        @contextmanager
        def session():
            db=sqlite3.connect(self.database,timeout=8)
            db.row_factory=sqlite3.Row
            db.execute("PRAGMA foreign_keys=ON")
            try:
                with db: yield db
            finally: db.close()
        return session()
    @staticmethod
    def crypt():
        key=os.environ.get("BOSQYN_IP_CAMERA_KEY","")
        if not key: raise RuntimeError("Falta BOSQYN_IP_CAMERA_KEY en el servidor")
        try:
            from cryptography.fernet import Fernet
            return Fernet(key.encode("ascii"))
        except (ValueError,ImportError,TypeError) as exc:
            raise RuntimeError("La clave Fernet de cámaras es inválida o falta cryptography") from exc
    def bridge_ok(self,token):
        expected=os.environ.get("BOSQYN_IP_BRIDGE_TOKEN","")
        return len(expected)>=32 and isinstance(token,str) and hmac.compare_digest(token,expected)
    def list(self):
        with self.lock,self.connect() as db:
            rows=[dict(x) for x in db.execute("SELECT id,name,kind,protocol,port,desired,test_seq,audio_enabled,threshold,created_at FROM ip_cameras ORDER BY id")]
        now=time.monotonic()
        for row in rows:
            item=self.latest.get(row["id"],{})
            age=now-item.get("at",-1e9)
            row["connected"]=row["desired"]=="on" and age<12
            row["last_frame_at"]=item.get("time") if age<7200 else None
            row["last_test"]=item.get("test")
            row["audio_result"]=item.get("audio") if age<120 else None
            row["bridge_online"]=age<40
        return rows
    def get(self,id):
        return next((x for x in self.list() if x["id"]==id),None)
    def register(self,body):
        name=str(body.get("name","")).strip()
        kind=body.get("kind")
        protocol=body.get("protocol")
        if not 1<=len(name)<=80 or kind not in KINDS:raise ValueError("Nombre o dispositivo inválido")
        source,port=validate_source(body.get("url"),protocol,body.get("port"))
        username=body.get("username","")
        password=body.get("password","")
        if not isinstance(username,str) or not isinstance(password,str) or len(username)>120 or len(password)>200:
            raise ValueError("Credenciales de cámara inválidas")
        try: threshold=float(body.get("threshold",0.85))
        except (ValueError,TypeError) as exc:raise ValueError("Umbral inválido") from exc
        if not 0.5<=threshold<=0.99:raise ValueError("Umbral entre 0.5 y 0.99")
        secret=self.crypt().encrypt(json.dumps({"url":source,"username":username,"password":password}).encode()).decode()
        with self.lock,self.connect() as db:
            if db.execute("SELECT COUNT(*) FROM ip_cameras").fetchone()[0]>=MAX_CAMERAS:
                raise ValueError("Límite de seis cámaras alcanzado")
            cur=db.execute("INSERT INTO ip_cameras(name,kind,protocol,port,source_ciphertext,audio_enabled,threshold,created_at) VALUES(?,?,?,?,?,?,?,?)",
                (name,kind,protocol,port,secret,int(body.get("audio_enabled") is True),threshold,stamp()))
            id=cur.lastrowid
        return self.get(id)
    def action(self,id,action):
        if action not in ("test","connect","disconnect"):raise ValueError("Acción desconocida")
        with self.lock,self.connect() as db:
            if action=="test":
                cur=db.execute("UPDATE ip_cameras SET test_seq=test_seq+1 WHERE id=?",(id,))
            else:
                cur=db.execute("UPDATE ip_cameras SET desired=? WHERE id=?",("on" if action=="connect" else "off",id))
            if not cur.rowcount:raise KeyError(id)
            if action=="disconnect":self.latest.pop(id,None)
            elif action=="test":
                self.latest.setdefault(id,{})["test"]={"status":"pendiente","time":stamp()}
        return self.get(id)
    def remove(self,id):
        with self.lock,self.connect() as db:
            cur=db.execute("DELETE FROM ip_cameras WHERE id=?",(id,))
            self.latest.pop(id,None)
        return bool(cur.rowcount)
    def agent_config(self):
        cipher=self.crypt()
        with self.lock,self.connect() as db:
            rows=[dict(r) for r in db.execute("SELECT id,name,kind,protocol,port,source_ciphertext,desired,test_seq,audio_enabled FROM ip_cameras")]
        for row in rows:
            secrets=json.loads(cipher.decrypt(row.pop("source_ciphertext").encode()).decode())
            row.update(secrets)
        return rows
    def event(self,id,category,confidence=None,alert_id=None):
        with self.lock,self.connect() as db:
            last=db.execute("SELECT category,occurred_at FROM ip_camera_events WHERE camera_id=? ORDER BY id DESC LIMIT 1",(id,)).fetchone()
            if last and last["category"]==category:
                try:
                    if (datetime.now(timezone.utc)-datetime.fromisoformat(last["occurred_at"])).total_seconds()<60:return False
                except ValueError:pass
            db.execute("INSERT INTO ip_camera_events(camera_id,occurred_at,category,confidence,alert_id) VALUES(?,?,?,?,?)",
                       (id,stamp(),category,confidence,alert_id))
        return True
    def events(self,id=None):
        with self.lock,self.connect() as db:
            q="""SELECT e.id,e.camera_id,c.name camera_name,e.occurred_at,e.category,e.confidence,
                 e.alert_id FROM ip_camera_events e JOIN ip_cameras c ON c.id=e.camera_id"""
            params=[]
            if id is not None:q+=" WHERE e.camera_id=?";params.append(id)
            q+=" ORDER BY e.id DESC LIMIT 100"
            return [dict(x) for x in db.execute(q,params)]
    def state(self,id,test_seq=None,ok=None):
        if self.get(id) is None:raise KeyError(id)
        with self.lock:
            state=self.latest.setdefault(id,{})
            state["at"]=time.monotonic()
            if test_seq is not None:
                with self.connect() as db:
                    row=db.execute("SELECT test_seq FROM ip_cameras WHERE id=?",(id,)).fetchone()
                if row and int(test_seq)==row["test_seq"]:
                    state["test"]={"status":"conectada" if ok else "sin conexión","time":stamp()}
    def frame(self,id,raw):
        row=self.get(id)
        if row is None:raise KeyError(id)
        if row["desired"]!="on":raise PermissionError("La cámara está desconectada")
        if not (100 < len(raw)<=MAX_FRAME_BYTES and raw[:3]==b"\xff\xd8\xff" and raw[-2:]==b"\xff\xd9"):
            raise ValueError("Fotograma JPEG inválido")
        with self.lock:
            was=self.latest.get(id,{})
            recently=was.get("at",-1e9)>time.monotonic()-12
            self.latest[id]={**was,"at":time.monotonic(),"frame":raw,"time":stamp()}
        if not recently:self.event(id,"CONEXION_RECUPERADA")
    def snapshot(self,id):
        row=self.get(id)
        if row is None:raise KeyError(id)
        value=self.latest.get(id,{})
        if row["desired"]=="on" and time.monotonic()-value.get("at",-1e9)<12:
            return value.get("frame")
        if row["desired"]=="on" and value.get("at") is not None:
            self.event(id,"CONEXION_PERDIDA")
        return None
    def set_audio(self,id,prediction):
        with self.lock:
            state=self.latest.setdefault(id,{})
            state["audio"]={"class":prediction.get("top_class"),"confidence":prediction.get("confidence"),"time":stamp(),
                            "original_class":prediction.get("original_top_class")}
        row=self.get(id)
        if row and prediction.get("original_top_class") in {"MOTOSIERRA","MAQUINARIA_DEFORESTACION"}:
            conf=float(prediction.get("original_confidence") or 0)
            if conf>=row["threshold"]:
                self.event(id,prediction["original_top_class"],conf)
