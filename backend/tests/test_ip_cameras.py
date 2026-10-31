"""IP camera unit + HTTP integration tests, without requesting any real camera."""
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request,urlopen
from unittest.mock import patch

from cryptography.fernet import Fernet
from backend.ip_cameras import CameraRegistry,validate_source
from backend.ip_camera_bridge import ffmpeg_cmd,read_jpegs,Bridge
from backend.server import make_server

TOKEN="bridge-token-1234567890-1234567890-1234567890"
JPEG=b"\xff\xd8\xff"+b"test-image-payload"*12+b"\xff\xd9"

class CameraValidationTests(unittest.TestCase):
    def test_private_sources_only(self):
        url,port=validate_source("rtsp://192.168.1.101:554/stream1","RTSP",554)
        self.assertEqual(port,554)
        self.assertEqual(url,"rtsp://192.168.1.101:554/stream1")
        for src,protocol in [
            ("http://127.0.0.1:8080/video","HTTP/MJPEG"),
            ("http://169.254.169.254/latest/meta-data","HTTP/MJPEG"),
            ("http://8.8.8.8/video","HTTP/MJPEG"),
            ("http://example.com/video","HTTP/MJPEG"),
            ("http://user:pass@192.168.1.2:8080/video","HTTP/MJPEG"),
            ("file:///etc/passwd","RTSP"),
            ("rtsp://192.168.1.3:554/live","HTTP/MJPEG"),
        ]:
            with self.subTest(src=src),self.assertRaises(ValueError):
                validate_source(src,protocol,None)
        with self.assertRaises(ValueError):
            validate_source("http://192.168.1.100:8080/video","HTTP/MJPEG",9000)

    def test_agent_ffmpeg_and_non_https_rejected(self):
        self.assertIn("-frames:v",ffmpeg_cmd("rtsp://192.168.1.20/live",single=True))
        self.assertIn("-rtsp_transport",ffmpeg_cmd("rtsp://192.168.1.20/live"))
        with patch("backend.ip_camera_bridge.shutil.which",return_value="/usr/bin/ffmpeg"):
            with self.assertRaises(ValueError):
                Bridge("http://example.com",TOKEN)

class CameraRegistryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.env=patch.dict(os.environ,{"BOSQYN_IP_CAMERA_KEY":Fernet.generate_key().decode(),
                                     "BOSQYN_IP_BRIDGE_TOKEN":TOKEN})
        self.env.start()
        from backend.storage import EvidenceStore
        evidence=EvidenceStore(Path(self.temp.name))
        self.store=CameraRegistry(evidence.database)
    def tearDown(self):
        self.env.stop();self.temp.cleanup()
    def test_credentials_encrypted_and_never_in_list(self):
        saved=self.store.register({"name":"Android","kind":"telefono","protocol":"HTTP/MJPEG",
            "url":"http://192.168.1.100:8080/video","port":8080,"username":"camerauser",
            "password":"SUPER-PRIVATE-CAMERA-PASSWORD"})
        self.assertNotIn("password",saved)
        self.assertNotIn("url",saved)
        self.assertEqual(self.store.agent_config()[0]["password"],"SUPER-PRIVATE-CAMERA-PASSWORD")
        with open(self.store.database,"rb") as file:
            database=file.read()
        self.assertNotIn(b"SUPER-PRIVATE-CAMERA-PASSWORD",database)
        self.assertNotIn(b"192.168.1.100",database)
        self.assertFalse(self.store.bridge_ok("incorrect"))
        self.assertTrue(self.store.bridge_ok(TOKEN))

    def test_connect_disconnect_recovery_snapshot_and_history(self):
        camera=self.store.register({"name":"Bosque","kind":"seguridad","protocol":"RTSP",
            "url":"rtsp://10.1.2.3:554/stream1"})
        id=camera["id"]
        self.store.action(id,"test")
        self.store.state(id,test_seq=1,ok=True)
        self.assertEqual(self.store.get(id)["last_test"]["status"],"conectada")
        self.assertFalse(self.store.get(id)["connected"])
        self.store.action(id,"connect")
        self.store.frame(id,JPEG)
        self.assertTrue(self.store.get(id)["connected"])
        self.assertEqual(self.store.snapshot(id),JPEG)
        self.assertEqual(self.store.events(id)[0]["category"],"CONEXION_RECUPERADA")
        self.store.action(id,"disconnect")
        self.assertFalse(self.store.get(id)["connected"])
        self.assertIsNone(self.store.snapshot(id))
        self.assertTrue(self.store.remove(id))

class CameraHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory()
        cls.env=patch.dict(os.environ,{"BOSQYN_ADMIN_PASSWORD":"camera-tests-password-long-enough",
                "BOSQYN_READ_ONLY":"0","BOSQYN_AUDIO_ENABLED":"0",
                "BOSQYN_IP_CAMERA_KEY":Fernet.generate_key().decode(),
                "BOSQYN_IP_BRIDGE_TOKEN":TOKEN})
        cls.env.start()
        front=Path(cls.temp.name)/"frontend";front.mkdir()
        (front/"index.html").write_text("BOSQYN",encoding="utf-8")
        cls.server=make_server(front,Path(cls.temp.name)/"data",port=0)
        cls.port=cls.server.server_address[1]
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True)
        cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join(timeout=4)
        cls.env.stop();cls.temp.cleanup()
    def call(self,path,method="GET",body=None,cookie="",token="",binary=False):
        headers={}
        if body is not None:
            if binary:
                headers["Content-Type"]="image/jpeg"
                payload=body
            else:
                headers["Content-Type"]="application/json"
                payload=json.dumps(body).encode()
        else:payload=None
        if method in ("POST","DELETE"):
            headers["Origin"]=f"https://127.0.0.1:{self.port}"
            headers["X-Bosqyn-Action"]="1"
        if token:headers["X-Bosqyn-Bridge-Token"]=token
        if cookie:headers["Cookie"]=cookie
        req=Request(f"http://127.0.0.1:{self.port}"+path,data=payload,
                    headers=headers,method=method)
        try:
            with urlopen(req,timeout=10) as response:
                raw=response.read()
                value=json.loads(raw) if response.headers.get_content_type()=="application/json" else raw
                return response.status,value,response.headers.get("Set-Cookie")
        except HTTPError as exc:
            raw=exc.read()
            try:raw=json.loads(raw)
            except ValueError:pass
            return exc.code,raw,None
    def login(self):
        code,_,set_cookie=self.call("/api/auth/login","POST",{"password":"camera-tests-password-long-enough"})
        self.assertEqual(code,200)
        return set_cookie.split(";",1)[0]
    def test_privacy_and_agent_auth(self):
        self.assertEqual(self.call("/api/ip-cameras")[0],401)
        self.assertEqual(self.call("/api/ip-cameras/agent/config")[0],401)
        self.assertEqual(self.call("/api/ip-cameras/agent/config",token=TOKEN)[0],200)
        self.assertEqual(self.call("/api/satellite/status")[0],200)
    def test_camera_flow_real_backend_with_fake_jpeg(self):
        cookie=self.login()
        code,data,_=self.call("/api/ip-cameras","POST",{
            "name":"Celular local","kind":"telefono","protocol":"HTTP/MJPEG",
            "url":"http://192.168.1.100:8080/video","port":8080,
            "username":"camuser","password":"cam-private-password"},cookie=cookie)
        self.assertEqual(code,201,data)
        id=data["camera"]["id"]
        self.assertNotIn("password",json.dumps(data))
        self.assertNotIn("192.168",json.dumps(data))
        code,agent,_=self.call("/api/ip-cameras/agent/config",token=TOKEN)
        self.assertEqual(code,200)
        self.assertTrue(any(x["id"]==id and x["password"]=="cam-private-password" for x in agent["cameras"]))
        self.assertEqual(self.call(f"/api/ip-cameras/{id}/action","POST",{"action":"test"},cookie=cookie)[0],200)
        self.assertEqual(self.call(f"/api/ip-cameras/agent/{id}/test","POST",{"test_seq":1,"ok":True},token=TOKEN)[0],200)
        self.assertEqual(self.call("/api/ip-cameras",cookie=cookie)[1]["items"][-1]["last_test"]["status"],"conectada")
        self.assertEqual(self.call(f"/api/ip-cameras/{id}/action","POST",{"action":"connect"},cookie=cookie)[0],200)
        self.assertEqual(self.call(f"/api/ip-cameras/agent/{id}/frame","POST",JPEG,binary=True)[0],401)
        self.assertEqual(self.call(f"/api/ip-cameras/agent/{id}/frame","POST",JPEG,token=TOKEN,binary=True)[0],200)
        self.assertEqual(self.call(f"/api/ip-cameras/{id}/snapshot",cookie=cookie)[1],JPEG)
        code,alert,_=self.call(f"/api/ip-cameras/{id}/capture","POST",{},cookie=cookie)
        self.assertEqual(code,201,alert)
        self.assertEqual(alert["alert"]["source"],"CAPTURA_MANUAL")
        self.assertEqual(self.call(f"/api/ip-cameras/{id}/action","POST",{"action":"disconnect"},cookie=cookie)[0],200)
        self.assertEqual(self.call(f"/api/ip-cameras/{id}/snapshot",cookie=cookie)[0],503)
        self.assertEqual(self.call(f"/api/ip-cameras/{id}","DELETE",cookie=cookie)[0],200)
