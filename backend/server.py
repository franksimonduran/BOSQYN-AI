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
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from .storage import EvidenceStore
from .audio_model import AudioModel
from .vision_model import prepare_vision_model

ROOT = Path(__file__).resolve().parents[1]
MAX_BODY_BYTES = 4_000_000
MAX_IMAGE_BYTES = 2_500_000


class BosqynHandler(SimpleHTTPRequestHandler):
    """Same-origin static frontend plus a small JSON API for local use only."""

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
        if self.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json":
            raise ValueError("Se requiere Content-Type: application/json")
        try:
            count = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("Content-Length no válido") from error
        if not 0 < count <= MAX_BODY_BYTES:
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
        if route == "/api/audio/model-info":
            return self.json_response(200, self.server.audio_model.info())
        if route == "/api/model-info":
            return self.json_response(200, self.server.vision_model)
        if route == "/api/health":
            return self.json_response(200, {
                "status": "ok", "service": "BOSQYN AI", "python_backend": True,
                "model_integrated": self.server.vision_model["available"], "model_assets_ready": self.server.vision_model["available"], "mode": "prototipo_local",
                "audio_model_ready": self.server.audio_model.info()["available"],
            })
        if route == "/api/alerts":
            try:
                limit = min(200, max(1, int(parse_qs(target.query).get("limit", ["100"])[0])))
            except ValueError:
                return self.json_response(400, {"error": "limit no válido"})
            return self.json_response(200, self.store.list_alerts(limit))
        if route == "/api/statistics":
            return self.json_response(200, self.store.statistics())
        if route.startswith("/api/evidence/"):
            parts = route.split("/")
            if len(parts) != 4 or not parts[3].isdigit():
                return self.json_response(404, {"error": "Evidencia no encontrada"})
            file = self.store.get_image(int(parts[3]))
            if file is None:
                return self.json_response(404, {"error": "Evidencia no encontrada"})
            body = file.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg" if file.suffix == ".jpg" else "image/png")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            return self.wfile.write(body)
        if route.startswith("/api/") or route == "/api":
            return self.json_response(404, {"error": "Endpoint desconocido"})
        return super().do_GET()

    def writes_forbidden(self):
        if os.environ.get('BOSQYN_READ_ONLY', '0') == '1':
            self.json_response(403, {'error': 'Este despliegue público es de solo lectura. Las operaciones de escritura están deshabilitadas.'})
            return True
        return False

    def predict_audio(self):
        """Stateless microphone classification; never writes evidence or audio to disk."""
        engine = self.server.audio_model
        if not engine.info()["available"]:
            return self.json_response(503, {
                "error": engine.info()["reason"],
                "audio_available": False,
            })
        if self.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/octet-stream":
            return self.json_response(415, {"error": "Se requiere application/octet-stream (PCM16 mono 16 kHz)"})
        if self.headers.get("X-Bosqyn-Sample-Rate") != "16000":
            return self.json_response(400, {"error": "Frecuencia requerida: 16000 Hz"})
        # Reject cross-origin browser submissions; this is not a writable API.
        origin = self.headers.get("Origin")
        if origin:
            try:
                parsed = urlsplit(origin)
                if parsed.netloc.lower() != self.headers.get("Host", "").lower() or parsed.scheme not in ("http", "https"):
                    return self.json_response(403, {"error": "Origen no autorizado"})
            except ValueError:
                return self.json_response(403, {"error": "Origen inválido"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            size = 0
        if not 32000 <= size <= 128000 or size % 2:
            return self.json_response(413, {"error": "Audio fuera de rango: 1 a 4 s PCM16 mono 16 kHz"})
        client = self.client_address[0]
        now = time.monotonic()
        with self.server.audio_rate_lock:
            last = self.server.audio_last_request.get(client, 0)
            if now - last < 2.5:
                return self.json_response(429, {"error": "Espera entre análisis acústicos"})
            self.server.audio_last_request[client] = now
            if len(self.server.audio_last_request) > 1000:
                self.server.audio_last_request = {client: now}
        if not self.server.audio_semaphore.acquire(blocking=False):
            return self.json_response(429, {"error": "Motor acústico ocupado; vuelve a intentar"})
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
            print("BOSQYN audio inference failed:", type(error).__name__, str(error), flush=True)
            return self.json_response(503, {"error": "No se pudo ejecutar el modelo de audio; revisa los registros del servidor"})
        finally:
            self.server.audio_semaphore.release()

    def do_POST(self):
        if urlsplit(self.path).path == "/api/audio/predict":
            return self.predict_audio()
        if self.writes_forbidden():
            return
        if urlsplit(self.path).path != "/api/alerts":
            return self.json_response(404, {"error": "Endpoint desconocido"})
        try:
            data = self.read_json()
            if data.get("category") != "REVISION_MANUAL":
                raise ValueError("Por ahora solo se admiten capturas manuales, no predicciones automáticas")
            uri = data.get("image_data")
            if not isinstance(uri, str) or "," not in uri:
                raise ValueError("Se requiere una imagen JPEG o PNG en formato data URL")
            prefix, encoded = uri.split(",", 1)
            signatures = {"data:image/jpeg;base64": "jpg", "data:image/png;base64": "png"}
            if prefix not in signatures:
                raise ValueError("Solo se permiten imágenes JPEG y PNG")
            try:
                image = base64.b64decode(encoded, validate=True)
            except (ValueError, binascii.Error) as error:
                raise ValueError("Imagen base64 no válida") from error
            if not 0 < len(image) <= MAX_IMAGE_BYTES:
                raise ValueError("Imagen vacía o superior al límite de 2.5 MB")
            ext = signatures[prefix]
            if (ext == "jpg" and not image.startswith(b"\xff\xd8\xff")) or (ext == "png" and not image.startswith(b"\x89PNG\r\n\x1a\n")):
                raise ValueError("El contenido de la imagen no coincide con su formato")
            record = self.store.add_manual_capture(image, ext)
            return self.json_response(201, record)
        except ValueError as error:
            return self.json_response(400, {"error": str(error)})

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


def make_server(frontend_dir: Path, data_dir: Path, port: int = 5500, host: str = "127.0.0.1"):
    frontend_dir = Path(frontend_dir).resolve()
    if not (frontend_dir / "index.html").is_file():
        raise FileNotFoundError(f"Frontend no encontrado en {frontend_dir}")
    server = ThreadingHTTPServer((host, port), partial(BosqynHandler, directory=str(frontend_dir)))
    server.store = EvidenceStore(data_dir)
    server.vision_model = prepare_vision_model(frontend_dir)
    server.audio_model = AudioModel()
    print('Modelo acústico:', json.dumps(server.audio_model.info(), ensure_ascii=False), flush=True)
    server.audio_semaphore = threading.BoundedSemaphore(1)
    server.audio_rate_lock = threading.Lock()
    server.audio_last_request = {}
    print('Modelo de visión:', json.dumps(server.vision_model, ensure_ascii=False))
    return server


def main():
    parser = argparse.ArgumentParser(description="Servidor local BOSQYN AI (Python + SQLite)")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "5500")))
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    parser.add_argument("--frontend-dir", type=Path, default=ROOT / "frontend")
    parser.add_argument("--data-dir", type=Path, default=ROOT / "backend" / "data")
    args = parser.parse_args()
    with make_server(args.frontend_dir, args.data_dir, args.port, host=args.host) as server:
        print(f"BOSQYN AI disponible en http://127.0.0.1:{server.server_address[1]}")
        print("Servidor de monitoreo activo; modelos disponibles según configuración. Ctrl+C para detener.")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("Servidor detenido.")


if __name__ == "__main__":
    main()
