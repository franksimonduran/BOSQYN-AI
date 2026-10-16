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
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from .storage import EvidenceStore

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
        if route == "/api/health":
            return self.json_response(200, {
                "status": "ok", "service": "BOSQYN AI", "python_backend": True,
                "model_integrated": False, "mode": "prototipo_local",
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

    def do_POST(self):
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
        print("Servidor local; IA sin conectar. Ctrl+C para detener.")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("Servidor detenido.")


if __name__ == "__main__":
    main()
