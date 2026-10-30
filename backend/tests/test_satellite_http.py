"""HTTP integration tests for satellite/drone auth, storage and HLS protection."""
import base64
import json
import os
import tempfile
import threading
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from backend.server import make_server


class SatelliteHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder=tempfile.TemporaryDirectory()
        cls.tmp=Path(cls.folder.name)
        cls.front=cls.tmp/"frontend"
        cls.front.mkdir()
        (cls.front/"index.html").write_text("BOSQYN",encoding="utf-8")
        cls.media=cls.tmp/"media"
        cls.media.mkdir()
        (cls.media/"live.m3u8").write_text("#EXTM3U\n#EXT-X-VERSION:3\n",encoding="utf-8")
        cls.env=patch.dict(os.environ,{
            "BOSQYN_ADMIN_PASSWORD":"test-integration-password-very-long",
            "BOSQYN_READ_ONLY":"0","BOSQYN_AUDIO_ENABLED":"0",
            "NASA_FIRMS_MAP_KEY":"","NOAA_ENABLED":"false",
            "BOSQYN_DRONE_MEDIA_DIR":str(cls.media)
        })
        cls.env.start()
        cls.server=make_server(cls.front,cls.tmp,port=0)
        cls.port=cls.server.server_address[1]
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join(timeout=5)
        cls.env.stop();cls.folder.cleanup()

    def request(self,path,method="GET",payload=None,cookie=""):
        headers={}
        body=None
        if payload is not None:
            body=json.dumps(payload).encode()
            headers["Content-Type"]="application/json"
        if method in ("POST","PATCH","DELETE"):
            headers["Origin"]=f"https://127.0.0.1:{self.port}"
            headers["X-Bosqyn-Action"]="1"
        if cookie:headers["Cookie"]=cookie
        req=Request(f"http://127.0.0.1:{self.port}"+path,headers=headers,data=body,method=method)
        try:
            with urlopen(req,timeout=10) as response:
                data=response.read()
                if response.headers.get_content_type()=="application/json":data=json.loads(data)
                return response.status,data,response.headers.get("Set-Cookie")
        except HTTPError as error:
            raw=error.read()
            try:raw=json.loads(raw)
            except ValueError:pass
            return error.code,raw,None

    def admin(self):
        code,_,cookie=self.request("/api/auth/login","POST",{"password":"test-integration-password-very-long"})
        self.assertEqual(code,200)
        return cookie.split(";",1)[0]

    def guest(self):
        code,_,cookie=self.request("/api/auth/guest","POST",{})
        self.assertEqual(code,200)
        return cookie.split(";",1)[0]

    def test_01_satellite_and_media_need_login(self):
        for route in ("/api/satellite/status","/api/satellite/events",
                      "/api/satellite/zones","/api/drone/telemetry",
                      "/api/drone/media/live.m3u8"):
            self.assertEqual(self.request(route)[0],401,route)

    def test_02_guest_may_read_but_not_register_sources(self):
        cookie=self.guest()
        self.assertEqual(self.request("/api/satellite/status",cookie=cookie)[0],200)
        self.assertEqual(self.request("/api/satellite/events",cookie=cookie)[0],200)
        self.assertEqual(self.request("/api/drone/media/live.m3u8",cookie=cookie)[0],200)
        self.assertEqual(self.request("/api/satellite/zones","POST",
                           {"name":"Prueba","bbox":[-77,-10,-76,-9]},cookie)[0],403)
        self.assertEqual(self.request("/api/drone/telemetry","POST",
                           {"drone_name":"Dron","lat":-9,"lon":-76,
                            "observed_at":datetime.now(timezone.utc).isoformat()},cookie)[0],403)

    def test_03_admin_creates_zone_telemetry_and_visual_evidence(self):
        cookie=self.admin()
        code,zone,_=self.request("/api/satellite/zones","POST",
                                 {"name":"Zona adicional","bbox":[-77,-10,-76,-9]},cookie)
        self.assertEqual(code,201,zone)
        self.assertEqual(self.request("/api/satellite/zones","POST",
                           {"name":"Inválida","bbox":[-180,-90,180,90]},cookie)[0],400)
        name="DronApi"
        stamp=datetime.now(timezone.utc).isoformat()
        code,gps,_=self.request("/api/drone/telemetry","POST",
                                {"drone_name":name,"lat":-9.5,"lon":-76,"altitude_m":110,
                                 "observed_at":stamp},cookie)
        self.assertEqual(code,201,gps)
        self.assertEqual(gps["position_type"],"DRONE_GPS")
        image=base64.b64encode(b"\xff\xd8\xff test visual frame").decode()
        code,event,_=self.request("/api/drone/detections","POST",
                                  {"drone_name":name,"category":"HUMO",
                                   "confidence":0.96,"image_data":"data:image/jpeg;base64,"+image},cookie)
        self.assertEqual(code,201,event)
        self.assertEqual(event["evidence"]["source"],"DRON_VISUAL")
        self.assertEqual(event["telemetry"]["position_type"],"DRONE_GPS")
        self.assertEqual(self.request(event["evidence"]["evidence_url"],cookie=cookie)[0],200)
        self.assertEqual(self.request("/api/drone/detections",cookie=cookie)[0],200)

    def test_04_unapproved_media_is_not_public_or_network_proxy(self):
        cookie=self.admin()
        self.assertEqual(self.request("/api/drone/media/live.m3u8",cookie=cookie)[0],200)
        self.assertEqual(self.request("/api/drone/media/%2e%2e",cookie=cookie)[0],404)
        self.assertEqual(self.request("/api/drone/media/does-not-exist.ts",cookie=cookie)[0],404)


if __name__=="__main__":
    unittest.main()
