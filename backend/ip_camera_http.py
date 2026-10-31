"""HTTP routes for private IP camera registry and HTTPS outbound bridge.

No remote URL fetches are performed inside this API (SSRF prevention).
"""
from __future__ import annotations
import binascii
import json
import os
import sqlite3
from urllib.parse import urlsplit

from .ip_cameras import MAX_FRAME_BYTES

def camera_id(path):
    parts=path.strip("/").split("/")
    if len(parts)<3 or parts[:2]!=["api","ip-cameras"] or not parts[2].isdigit():
        return None
    return int(parts[2]) if int(parts[2])>0 else None

class CameraAPI:
    def camera_admin(self):
        if not self.require_admin():return False
        if self.command in ("POST","DELETE"):
            if os.environ.get("BOSQYN_READ_ONLY","1")=="1":
                self.json_response(403,{"error":"El guardado está deshabilitado en Railway"})
                return False
            if not self.same_origin():
                self.json_response(403,{"error":"Origen no autorizado"})
                return False
        return True

    def camera_bridge(self):
        if not self.server.cameras.bridge_ok(self.headers.get("X-Bosqyn-Bridge-Token","")):
            self.json_response(401,{"error":"Pasarela no autorizada"})
            return False
        return True

    def camera_binary(self,limit):
        try:size=int(self.headers.get("Content-Length","0"))
        except ValueError:size=0
        if not 1<=size<=limit:
            self.json_response(413,{"error":"Datos de cámara fuera de límite"})
            return None
        return self.rfile.read(size)

    def camera_get(self,path):
        registry=self.server.cameras
        if path=="/api/ip-cameras/agent/config":
            if not self.camera_bridge():return
            try:return self.json_response(200,{"cameras":registry.agent_config()})
            except RuntimeError:return self.json_response(503,{"error":"Cifrado de cámaras sin configurar"})
        if not self.camera_admin():return
        if path=="/api/ip-cameras":return self.json_response(200,{"items":registry.list()})
        if path=="/api/ip-cameras/events":return self.json_response(200,{"items":registry.events()})
        id=camera_id(path)
        if id is None:return self.json_response(404,{"error":"Ruta de cámara desconocida"})
        if path==f"/api/ip-cameras/{id}/snapshot":
            try:data=registry.snapshot(id)
            except KeyError:return self.json_response(404,{"error":"Cámara no encontrada"})
            if data is None:return self.json_response(503,{"error":"Sin fotograma reciente"})
            self.send_response(200)
            self.send_header("Content-Type","image/jpeg")
            self.send_header("Content-Length",str(len(data)))
            self.send_header("Cache-Control","no-store")
            self.end_headers()
            return self.wfile.write(data)
        return self.json_response(404,{"error":"Ruta de cámara desconocida"})

    def camera_post(self,path):
        registry=self.server.cameras
        # Bridge writes have a separate scoped token, never browser cookies.
        if path.startswith("/api/ip-cameras/agent/"):
            if not self.camera_bridge():return
            parts=path.split("/")
            if len(parts)!=6 or not parts[4].isdigit() or parts[5] not in ("frame","test","audio"):
                return self.json_response(404,{"error":"Ruta de pasarela desconocida"})
            id=int(parts[4]);op=parts[5]
            if registry.get(id) is None:return self.json_response(404,{"error":"Cámara no registrada"})
            if op=="frame":
                if self.headers.get("Content-Type","").split(";")[0]!="image/jpeg":
                    return self.json_response(415,{"error":"Formato JPEG requerido"})
                raw=self.camera_binary(MAX_FRAME_BYTES)
                if raw is None:return
                try:registry.frame(id,raw)
                except (ValueError,PermissionError) as exc:
                    return self.json_response(400,{"error":str(exc)})
                return self.json_response(200,{"received":True})
            if op=="test":
                try:
                    body=self.read_json()
                    registry.state(id,test_seq=body.get("test_seq"),ok=body.get("ok") is True)
                    return self.json_response(200,{"received":True})
                except (ValueError,TypeError):
                    return self.json_response(400,{"error":"Estado de prueba inválido"})
            if op=="audio":
                if self.headers.get("Content-Type")!="application/octet-stream" or self.headers.get("X-Bosqyn-Sample-Rate")!="16000":
                    return self.json_response(415,{"error":"Audio requerido: PCM16 mono 16000 Hz"})
                data=self.camera_binary(96000)
                if data is None:return
                if len(data)!=96000 or not self.server.audio_model.info().get("available"):
                    return self.json_response(503,{"error":"Audio de 3 s no disponible o modelo inactivo"})
                if not self.server.audio_semaphore.acquire(blocking=False):
                    return self.json_response(429,{"error":"Motor acústico ocupado"})
                try:
                    prediction=self.server.audio_model.predict_pcm16(data)
                    registry.set_audio(id,prediction)
                    return self.json_response(200,{"prediction":prediction})
                except (ValueError,RuntimeError) as exc:
                    return self.json_response(400,{"error":type(exc).__name__})
                finally:self.server.audio_semaphore.release()
        if not self.camera_admin():return
        try:
            if path=="/api/ip-cameras":
                value=registry.register(self.read_json())
                return self.json_response(201,{"camera":value})
            id=camera_id(path)
            if id is None:return self.json_response(404,{"error":"Ruta desconocida"})
            if path==f"/api/ip-cameras/{id}/action":
                data=self.read_json()
                return self.json_response(200,{"camera":registry.action(id,data.get("action"))})
            if path==f"/api/ip-cameras/{id}/capture":
                raw=registry.snapshot(id)
                if raw is None:return self.json_response(409,{"error":"No hay imagen de una cámara conectada"})
                alert=self.store.add_manual_capture(raw,"jpg")
                registry.event(id,"CAPTURA_MANUAL",alert_id=alert["id"])
                return self.json_response(201,{"alert":alert})
            return self.json_response(404,{"error":"Ruta desconocida"})
        except KeyError:
            return self.json_response(404,{"error":"Cámara no encontrada"})
        except (ValueError,TypeError) as exc:
            return self.json_response(400,{"error":str(exc)})
        except RuntimeError:
            return self.json_response(503,{"error":"Configura la clave de cifrado para cámaras IP"})
        except sqlite3.Error:
            return self.json_response(503,{"error":"Registro de cámaras no disponible"})

    def camera_delete(self,path):
        if not self.camera_admin():return
        id=camera_id(path)
        if id is None or path!=f"/api/ip-cameras/{id}":
            return self.json_response(404,{"error":"Ruta desconocida"})
        if self.server.cameras.remove(id):
            return self.json_response(200,{"deleted":True})
        return self.json_response(404,{"error":"Cámara no encontrada"})
