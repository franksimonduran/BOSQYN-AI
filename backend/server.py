"""BOSQYN AI local API and frontend server (Python standard library only).

Usage from repository root:
    python -m backend.server
"""

from __future__ import annotations

import argparse
import base64
import binascii
import json
import os
import threading
import time
import shutil
import sqlite3
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from . import satellite
from .satellite_store import SatelliteStore
from .storage import EvidenceStore, validate_wav
from .auth import AdminAuth
from .audio_model import AudioModel
from .vision_model import prepare_vision_model

ROOT = Path(__file__).resolve().parents[1]
MAX_BODY_BYTES = 4_000_000
MAX_IMAGE_BYTES = 2_500_000


class BosqynHandler(SimpleHTTPRequestHandler):
    """Same-origin static frontend plus a small JSON API for local use only."""

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Permissions-Policy", "camera=(self), microphone=(self)")
        # No cachear el shell ni scripts: evita mezclar el HTML nuevo con un mapa JS antiguo.
        static_path = urlsplit(self.path).path
        if (
            static_path == "/" or static_path.endswith((".html", ".js", ".css"))
        ) and not static_path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store, max-age=0")
            self.send_header("Pragma", "no-cache")
        super().end_headers()

    def secure_cookie(self) -> bool:
        host = self.headers.get("Host", "").split(":")[0].lower()
        return host not in ("localhost", "127.0.0.1", "[::1]")

    def authorized(self) -> bool:
        return self.server.auth.session(self.headers, self.secure_cookie()) is not None

    def require_admin(self) -> bool:
        if not self.server.auth.configured():
            self.json_response(503, {"error": "Acceso administrativo sin configurar."})
            return False
        if self.server.auth.role(self.headers, self.secure_cookie()) != "admin":
            self.json_response(
                403 if self.authorized() else 401,
                {
                    "error": "Inicia sesión como administrador para acceder a las evidencias.",
                    "login_required": True,
                },
            )
            return False
        return True

    def require_access(self):
        if self.authorized():
            return True
        self.json_response(
            401,
            {
                "error": "Elige acceso Invitado o Administrador para usar las evidencias.",
                "login_required": True,
            },
        )
        return False

    def guest_login(self):
        if not self.same_origin():
            return self.json_response(403, {"error": "Origen no autorizado"})
        try:
            token = self.server.auth.create_guest()
        except ValueError as error:
            return self.json_response(429, {"error": str(error)})
        body = b'{"authenticated":true,"role":"guest"}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header(
            "Set-Cookie", self.server.auth.cookie_header(token, self.secure_cookie())
        )
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        return self.wfile.write(body)

    def same_origin(self) -> bool:
        # POST/PATCH/DELETE requests are only accepted from this site's own origin.
        # A non-simple header additionally prevents cross-origin form CSRF.
        if self.server.auth.local_mode:
            return True
        origin = self.headers.get("Origin", "")
        host = self.headers.get("Host", "")
        try:
            parsed = urlsplit(origin)
            return (
                parsed.scheme == "https"
                and parsed.netloc.lower() == host.lower()
                and self.headers.get("X-Bosqyn-Action") == "1"
            )
        except ValueError:
            return False

    def json_response(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        if (
            self.headers.get("Content-Type", "").split(";")[0].strip().lower()
            != "application/json"
        ):
            raise ValueError("Se requiere Content-Type: application/json")
        try:
            count = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("Content-Length no válido") from error
        limit = (
            45_000_000
            if urlsplit(self.path).path == "/api/backup/restore"
            else MAX_BODY_BYTES
        )
        if not 0 < count <= limit:
            raise ValueError("El cuerpo JSON es demasiado grande o está vacío")
        try:
            payload = json.loads(self.rfile.read(count))
        except (ValueError, UnicodeDecodeError) as error:
            raise ValueError("JSON no válido") from error
        if not isinstance(payload, dict):
            raise ValueError("Se esperaba un objeto JSON")
        return payload

    @property
    def store(self) -> EvidenceStore:
        return self.server.store

    @staticmethod
    def alert_id(path: str):
        parts = path.split("/")
        if len(parts) != 4 or parts[1] != "api" or parts[2] != "alerts":
            return None
        return int(parts[3]) if parts[3].isdigit() and int(parts[3]) > 0 else None

    def do_GET(self):
        target = urlsplit(self.path)
        route = target.path
        if route == "/api/satellite/status":
            return self.json_response(200, satellite.status())
        if route == "/api/satellite/events":
            return self.json_response(200, satellite.events())
        if route == "/api/satellite/zones":
            if not self.require_access(): return
            return self.json_response(200, {"zones":self.server.satellite_store.zones()})
        if route == "/api/satellite/observations":
            if not self.require_access(): return
            query=parse_qs(target.query)
            try:
                rows=self.server.satellite_store.observations(
                    limit=min(500,max(1,int(query.get("limit",["250"])[0]))),
                    source=query.get("source",[""])[0] or None,
                    since=query.get("since",[""])[0] or None)
                return self.json_response(200,{"items":rows})
            except (ValueError,TypeError):
                return self.json_response(400,{"error":"Filtros de observaciones inválidos"})
        if route == "/api/satellite/correlations":
            if not self.require_access(): return
            return self.json_response(200,{"items":self.server.satellite_store.correlated()})
        if route == "/api/drone/telemetry":
            if not self.require_access(): return
            return self.json_response(200, {"items":self.server.satellite_store.latest_drone()})
        if route == "/api/drone/detections":
            if not self.require_access(): return
            return self.json_response(200, {"items":self.server.satellite_store.drone_events()})
        if route == "/api/auth/status":
            auth = self.server.auth
            return self.json_response(
                200,
                {
                    "authenticated": self.authorized(),
                    "role": self.server.auth.role(self.headers, self.secure_cookie()),
                    "login_required": auth.login_required,
                    "configured": auth.configured(),
                    "persistent_storage": self.server.persistent_storage,
                },
            )
        if route == "/api/audio/model-info":
            return self.json_response(200, self.server.audio_model.info())
        if route == "/api/model-info":
            return self.json_response(200, self.server.vision_model)
        if route == "/api/health":
            return self.json_response(
                200,
                {
                    "status": "ok",
                    "service": "BOSQYN AI",
                    "python_backend": True,
                    "model_integrated": self.server.vision_model["available"],
                    "model_assets_ready": self.server.vision_model["available"],
                    "mode": (
                        "local"
                        if self.server.auth.local_mode
                        else "servidor_autenticado"
                    ),
                    "audio_model_ready": self.server.audio_model.info()["available"],
                },
            )
        if route == "/api/notifications":
            if not self.require_access():
                return
            return self.json_response(
                200,
                self.store.list_alerts(
                    10, status="PENDIENTE", source="VISION_AUTOMATICA"
                ),
            )
        if route.startswith("/api/audio-evidence/"):
            if not self.require_access():
                return
            token = route.rsplit("/", 1)[-1]
            audio = self.store.get_audio(int(token)) if token.isdigit() else None
            if not audio:
                return self.json_response(404, {"error": "Audio no encontrado"})
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(audio)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return self.wfile.write(audio)
        if route == "/api/operations":
            if not self.require_admin():
                return
            disk = shutil.disk_usage(self.store.data_dir)
            return self.json_response(
                200,
                {
                    "persistent_storage": self.server.persistent_storage,
                    "disk_free_bytes": disk.free,
                    "uptime_seconds": int(time.monotonic() - self.server.started_at),
                    "writes_enabled": os.environ.get(
                        "BOSQYN_READ_ONLY", "0" if self.server.auth.local_mode else "1"
                    )
                    != "1",
                    "satellite": satellite.status(),
                    "retention": self.store.retention(),
                },
            )
        if route == "/api/backup":
            if not self.require_admin():
                return
            try:
                return self.json_response(200, self.store.export_backup())
            except (ValueError, OSError) as error:
                return self.json_response(409, {"error": str(error)})
        if route == "/api/alerts":
            if not self.require_access():
                return
            try:
                limit = min(
                    200, max(1, int(parse_qs(target.query).get("limit", ["100"])[0]))
                )
            except ValueError:
                return self.json_response(400, {"error": "limit no válido"})
            query = parse_qs(target.query)
            try:
                offset = max(0, int(query.get("offset", ["0"])[0]))
            except ValueError:
                return self.json_response(400, {"error": "offset no válido"})
            return self.json_response(
                200,
                self.store.list_alerts(
                    limit,
                    offset,
                    **{
                        key: query.get(key, [""])[0]
                        for key in ("category", "status", "source")
                    },
                ),
            )
        if route == "/api/statistics":
            result = self.store.statistics()
            result["activity_by_day"] = self.store.activity_by_day(7)
            return self.json_response(200, result)
        if route == "/api/statistics/chart.png":
            # Modo demo aislado: no almacena ni altera datos reales en SQLite.
            try:
                from .charts import demonstration_activity_by_day, render_activity_png

                demo = parse_qs(target.query).get("demo", ["0"])[0] == "1"
                daily = (
                    demonstration_activity_by_day()
                    if demo
                    else self.store.activity_by_day(7)
                )
                key = (demo,) + tuple(
                    (x["date"], x["PENDIENTE"], x["CONFIRMADA"], x["DESCARTADA"])
                    for x in daily
                )
                with self.server.stats_chart_lock:
                    cached = self.server.stats_chart_cache
                    if cached and cached[0] == key:
                        png = cached[1]
                    else:
                        png = render_activity_png(daily, demo=demo)
                        self.server.stats_chart_cache = (key, png)
            except Exception as error:
                print(
                    "BOSQYN statistics chart error:",
                    type(error).__name__,
                    str(error),
                    flush=True,
                )
                return self.json_response(
                    503, {"error": "Gráfico Matplotlib temporalmente no disponible"}
                )
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(png)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            return self.wfile.write(png)
        if route.startswith("/api/evidence/"):
            if not self.require_access():
                return
            parts = route.split("/")
            if len(parts) != 4 or not parts[3].isdigit():
                return self.json_response(404, {"error": "Evidencia no encontrada"})
            file = self.store.get_image(int(parts[3]))
            if file is None:
                return self.json_response(404, {"error": "Evidencia no encontrada"})
            body = file.read_bytes()
            self.send_response(200)
            self.send_header(
                "Content-Type", "image/jpeg" if file.suffix == ".jpg" else "image/png"
            )
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            return self.wfile.write(body)
        if route.startswith("/api/") or route == "/api":
            return self.json_response(404, {"error": "Endpoint desconocido"})
        return super().do_GET()

    def writes_forbidden(self):
        if (
            os.environ.get(
                "BOSQYN_READ_ONLY", "0" if self.server.auth.local_mode else "1"
            )
            == "1"
        ):
            self.json_response(
                403,
                {
                    "error": "El guardado todavía está deshabilitado en la configuración del servidor."
                },
            )
            return True
        management = self.command == "DELETE" or urlsplit(self.path).path in {
            "/api/backup/restore",
            "/api/retention",
        }
        if not (self.require_admin() if management else self.require_access()):
            return True
        if not self.same_origin():
            self.json_response(403, {"error": "Origen de solicitud no autorizado."})
            return True
        return False

    def authenticate(self):
        if not self.same_origin():
            return self.json_response(403, {"error": "Solicitud no autorizada."})
        try:
            data = self.read_json()
        except ValueError as error:
            return self.json_response(400, {"error": str(error)})
        password = data.get("password")
        if not isinstance(password, str) or len(password) > 256:
            return self.json_response(400, {"error": "Contraseña inválida."})
        ok, token = self.server.auth.check_login(password, self.client_address[0])
        if not ok:
            return self.json_response(
                429 if token == "Demasiados intentos; espera 15 minutos." else 401,
                {"error": token or "Acceso rechazado."},
            )
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header(
            "Set-Cookie", self.server.auth.cookie_header(token, self.secure_cookie())
        )
        body = b'{"authenticated":true}'
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def logout(self):
        if not self.same_origin():
            return self.json_response(403, {"error": "Solicitud no autorizada."})
        self.server.auth.revoke(
            self.server.auth.session(self.headers, self.secure_cookie())
        )
        body = b'{"authenticated":false}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header(
            "Set-Cookie", self.server.auth.clear_cookie_header(self.secure_cookie())
        )
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def predict_audio(self):
        """Stateless microphone classification; never writes evidence or audio to disk."""
        engine = self.server.audio_model
        if not engine.info()["available"]:
            return self.json_response(
                503,
                {
                    "error": engine.info()["reason"],
                    "audio_available": False,
                },
            )
        if (
            self.headers.get("Content-Type", "").split(";")[0].strip().lower()
            != "application/octet-stream"
        ):
            return self.json_response(
                415,
                {"error": "Se requiere application/octet-stream (PCM16 mono 16 kHz)"},
            )
        if self.headers.get("X-Bosqyn-Sample-Rate") != "16000":
            return self.json_response(400, {"error": "Frecuencia requerida: 16000 Hz"})
        # Reject cross-origin browser submissions; this is not a writable API.
        origin = self.headers.get("Origin")
        if origin:
            try:
                parsed = urlsplit(origin)
                if parsed.netloc.lower() != self.headers.get(
                    "Host", ""
                ).lower() or parsed.scheme not in ("http", "https"):
                    return self.json_response(403, {"error": "Origen no autorizado"})
            except ValueError:
                return self.json_response(403, {"error": "Origen inválido"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            size = 0
        if not 32000 <= size <= 128000 or size % 2:
            return self.json_response(
                413, {"error": "Audio fuera de rango: 1 a 4 s PCM16 mono 16 kHz"}
            )
        client = self.client_address[0]
        now = time.monotonic()
        with self.server.audio_rate_lock:
            last = self.server.audio_last_request.get(client, 0)
            if now - last < 2.5:
                return self.json_response(
                    429, {"error": "Espera entre análisis acústicos"}
                )
            self.server.audio_last_request[client] = now
            if len(self.server.audio_last_request) > 1000:
                self.server.audio_last_request = {client: now}
        if not self.server.audio_semaphore.acquire(blocking=False):
            return self.json_response(
                429, {"error": "Motor acústico ocupado; vuelve a intentar"}
            )
        try:
            self.connection.settimeout(20)
            data = self.rfile.read(size)
            if len(data) != size:
                return self.json_response(400, {"error": "Audio incompleto"})
            prediction = engine.predict_pcm16(data)
            return self.json_response(200, prediction)
        except ValueError as error:
            return self.json_response(400, {"error": str(error)})
        except Exception as error:
            print(
                "BOSQYN audio inference failed:",
                type(error).__name__,
                str(error),
                flush=True,
            )
            return self.json_response(
                503,
                {
                    "error": "No se pudo ejecutar el modelo de audio; revisa los registros del servidor"
                },
            )
        finally:
            self.server.audio_semaphore.release()

    def do_POST(self):
        route = urlsplit(self.path).path
        if route == "/api/auth/guest":
            return self.guest_login()
        if route == "/api/auth/login":
            return self.authenticate()
        if route == "/api/auth/logout":
            return self.logout()
        if route == "/api/audio/predict":
            return self.predict_audio()
        if route == "/api/drone/detections":
            if self.writes_forbidden(): return
            if not self.require_admin(): return
            try:
                data = self.read_json()
                category = str(data.get("category","")).upper().strip()
                name = str(data.get("drone_name","")).strip()
                confidence = data.get("confidence")
                if category not in ("INCENDIO","HUMO","TALA"):
                    raise ValueError("La detección requiere una clase visual de riesgo")
                if isinstance(confidence, bool) or not isinstance(confidence,(int,float)) or not 0.85 <= confidence <= 1:
                    raise ValueError("Confianza visual inválida o inferior al umbral")
                candidate = next((d for d in self.server.satellite_store.latest_drone()
                                  if d["drone_name"] == name), None)
                if candidate is None or time.time() - __import__("datetime").datetime.fromisoformat(
                    candidate["received_at"]).timestamp() > 180:
                    raise ValueError("Se necesita GPS reciente del dron, no la ubicación del incendio")
                uri = data.get("image_data")
                if not isinstance(uri,str) or "," not in uri:
                    raise ValueError("Se requiere una captura de video JPEG/PNG")
                prefix,encoded=uri.split(",",1)
                extensions={"data:image/jpeg;base64":"jpg","data:image/png;base64":"png"}
                if prefix not in extensions: raise ValueError("Formato de imagen inválido")
                image=base64.b64decode(encoded,validate=True)
                if not 0 < len(image) <= MAX_IMAGE_BYTES:
                    raise ValueError("Imagen vacía o demasiado grande")
                ext=extensions[prefix]
                if not ((ext=="jpg" and image.startswith(b"\\xff\\xd8\\xff")) or
                        (ext=="png" and image.startswith(b"\\x89PNG\\r\\n\\x1a\\n"))):
                    raise ValueError("Firma de imagen incorrecta")
                evidence=self.store.add_drone_visual_incident(category,confidence,image,ext)
                point=self.server.satellite_store.record_drone_detection(name,category,confidence,evidence["id"])
                return self.json_response(200 if evidence.get("duplicate") else 201,
                    {"evidence":evidence,"telemetry":point,"status":"PENDIENTE"})
            except (ValueError,TypeError,binascii.Error) as exc:
                return self.json_response(400,{"error":str(exc)})
            except (OSError,sqlite3.Error):
                return self.json_response(503,{"error":"No se pudo almacenar la evidencia del dron"})
        if route in {"/api/satellite/zones", "/api/satellite/refresh", "/api/drone/telemetry"}:
            if self.writes_forbidden(): return
            if not self.require_admin(): return
            try:
                data=self.read_json()
                if route == "/api/satellite/zones":
                    result=self.server.satellite_store.save_zone(data)
                    return self.json_response(201,result)
                if route == "/api/drone/telemetry":
                    result=self.server.satellite_store.record_drone(data)
                    return self.json_response(201,result)
                # Avoid background calls from HTTP worker; rate limiting is in satellite.poll.
                import threading as _threading
                _threading.Thread(target=satellite.poll,daemon=True,name="bosqyn-satellite-refresh").start()
                return self.json_response(202,{"status":"Consulta programada si corresponde al intervalo mínimo."})
            except (ValueError,TypeError) as error:
                return self.json_response(400,{"error":str(error)})
            except (OSError,sqlite3.Error):
                return self.json_response(503,{"error":"Almacenamiento satelital temporalmente no disponible"})
        if self.writes_forbidden():
            return
        if route in {"/api/backup/restore", "/api/retention"}:
            try:
                data = self.read_json()
                if route == "/api/backup/restore":
                    result = self.store.restore_backup(data)
                else:
                    result = self.store.retention(
                        data.get("days", 90), data.get("apply") is True
                    )
                return self.json_response(200, result)
            except (ValueError, TypeError, OSError) as error:
                return self.json_response(400, {"error": str(error)})
        if urlsplit(self.path).path != "/api/alerts":
            return self.json_response(404, {"error": "Endpoint desconocido"})
        try:
            data = self.read_json()
            automatic = data.get("source") == "VISION_AUTOMATICA"
            audio = None
            if data.get("audio_data") is not None:
                if not automatic:
                    raise ValueError("El audio requiere un incidente automático")
                try:
                    audio = base64.b64decode(data["audio_data"], validate=True)
                except Exception as error:
                    raise ValueError("Audio base64 inválido") from error
                validate_wav(audio)
            if not automatic and data.get("category") != "REVISION_MANUAL":
                raise ValueError("Una captura manual requiere REVISION_MANUAL")
            uri = data.get("image_data")
            if not isinstance(uri, str) or "," not in uri:
                raise ValueError(
                    "Se requiere una imagen JPEG o PNG en formato data URL"
                )
            prefix, encoded = uri.split(",", 1)
            signatures = {
                "data:image/jpeg;base64": "jpg",
                "data:image/png;base64": "png",
            }
            if prefix not in signatures:
                raise ValueError("Solo se permiten imágenes JPEG y PNG")
            try:
                image = base64.b64decode(encoded, validate=True)
            except (ValueError, binascii.Error) as error:
                raise ValueError("Imagen base64 no válida") from error
            if not 0 < len(image) <= MAX_IMAGE_BYTES:
                raise ValueError("Imagen vacía o superior al límite de 2.5 MB")
            ext = signatures[prefix]
            if (ext == "jpg" and not image.startswith(b"\xff\xd8\xff")) or (
                ext == "png" and not image.startswith(b"\x89PNG\r\n\x1a\n")
            ):
                raise ValueError("El contenido de la imagen no coincide con su formato")
            if shutil.disk_usage(self.store.data_dir).free < len(image) + 10_000_000:
                return self.json_response(
                    507,
                    {
                        "error": "Espacio insuficiente; descarga un respaldo y revisa la retención"
                    },
                )
            # A short per-session cooldown limits accidental repeated captures.
            identity = self.server.auth.session(self.headers, self.secure_cookie())
            with self.server.capture_lock:
                now = time.monotonic()
                if (
                    not automatic
                    and now - self.server.capture_last.get(identity, 0) < 2
                ):
                    return self.json_response(
                        429, {"error": "Espera dos segundos antes de otra captura."}
                    )
                self.server.capture_last[identity] = now
            if data.get("source") == "VISION_AUTOMATICA":
                record = self.store.add_visual_incident(
                    data["category"], data.get("confidence"), image, ext
                )
            else:
                record = self.store.add_manual_capture(image, ext)
            if audio is not None:
                self.store.attach_audio(record["id"], audio)
                record.update(self.store.get_alert(record["id"]))
            return self.json_response(200 if record.get("duplicate") else 201, record)
        except ValueError as error:
            return self.json_response(400, {"error": str(error)})
        except (OSError, sqlite3.Error):
            return self.json_response(
                503, {"error": "Almacenamiento temporalmente no disponible"}
            )

    def do_PATCH(self):
        if self.writes_forbidden():
            return
        alert_id = self.alert_id(urlsplit(self.path).path)
        if alert_id is None:
            return self.json_response(404, {"error": "Endpoint desconocido"})
        try:
            data = self.read_json()
            status = data.get("status")
            if not isinstance(status, str):
                raise ValueError("Estado no válido")
            item = self.store.update_status(alert_id, status)
        except ValueError as error:
            return self.json_response(400, {"error": str(error)})
        if item is None:
            return self.json_response(404, {"error": "Incidencia no encontrada"})
        return self.json_response(200, item)

    def do_DELETE(self):
        if self.writes_forbidden():
            return
        alert_id = self.alert_id(urlsplit(self.path).path)
        if alert_id is None:
            return self.json_response(404, {"error": "Endpoint desconocido"})
        if not self.store.remove_alert(alert_id):
            return self.json_response(404, {"error": "Incidencia no encontrada"})
        return self.json_response(200, {"deleted": True, "id": alert_id})


def make_server(
    frontend_dir: Path, data_dir: Path, port: int = 5500, host: str = "127.0.0.1"
):
    frontend_dir = Path(frontend_dir).resolve()
    if not (frontend_dir / "index.html").is_file():
        raise FileNotFoundError(f"Frontend no encontrado en {frontend_dir}")
    server = ThreadingHTTPServer(
        (host, port), partial(BosqynHandler, directory=str(frontend_dir))
    )
    server.started_at = time.monotonic()
    server.store = EvidenceStore(data_dir)
    server.satellite_store = SatelliteStore(server.store.database)
    satellite.start(server.satellite_store)
    server.auth = AdminAuth(host)
    server.persistent_storage = str(Path(data_dir).resolve()) == "/data" or str(
        Path(data_dir).resolve()
    ).startswith("/data/")
    server.capture_lock = threading.Lock()
    server.capture_last = {}
    if not server.auth.configured():
        print(
            "ADMIN: sin contraseña de al menos 16 caracteres; los registros quedan protegidos.",
            flush=True,
        )
    server.vision_model = prepare_vision_model(frontend_dir)
    server.audio_model = AudioModel()
    print(
        "Modelo acústico:",
        json.dumps(server.audio_model.info(), ensure_ascii=False),
        flush=True,
    )
    server.audio_semaphore = threading.BoundedSemaphore(1)
    server.audio_rate_lock = threading.Lock()
    server.audio_last_request = {}
    server.stats_chart_lock = threading.Lock()
    server.stats_chart_cache = None

    # Self-check is asynchronous so a broken audio model cannot prevent the
    # visual monitoring service from starting or passing its healthcheck.
    if server.audio_model.info()["available"]:

        def validate_audio_model():
            try:
                verification = server.audio_model.predict_pcm16(bytes(96000))
                print(
                    "Modelo acústico: inferencia de arranque verificada con señal silenciosa; clases:",
                    len(verification["predictions"]),
                    flush=True,
                )
            except Exception as error:
                server.audio_model._info["available"] = False
                server.audio_model._info["reason"] = (
                    "Modelo acústico incompatible o no operativo: " + str(error)
                )
                print(
                    "Modelo acústico: error de autoverificación:",
                    type(error).__name__,
                    str(error),
                    flush=True,
                )

        threading.Thread(target=validate_audio_model, daemon=True).start()
    print("Modelo de visión:", json.dumps(server.vision_model, ensure_ascii=False))
    return server


def main():
    parser = argparse.ArgumentParser(
        description="Servidor local BOSQYN AI (Python + SQLite)"
    )
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "5500")))
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    parser.add_argument("--frontend-dir", type=Path, default=ROOT / "frontend")
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path(os.environ.get("BOSQYN_DATA_DIR", str(ROOT / "backend" / "data"))),
    )
    args = parser.parse_args()
    with make_server(
        args.frontend_dir, args.data_dir, args.port, host=args.host
    ) as server:
        print(f"BOSQYN AI disponible en http://127.0.0.1:{server.server_address[1]}")
        print(
            "Servidor de monitoreo activo; modelos disponibles según configuración. Ctrl+C para detener."
        )
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("Servidor detenido.")


if __name__ == "__main__":
    main()
