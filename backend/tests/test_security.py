"""Secure evidence authorization + persistence tests for BOSQYN AI Railway."""
import base64
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

from backend.server import make_server
from backend.storage import EvidenceStore


class SecuredAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.env = patch.dict(os.environ, {
            "BOSQYN_ADMIN_PASSWORD": "integration-test-secret-password-only",
            "BOSQYN_READ_ONLY": "0",
            "BOSQYN_AUDIO_ENABLED": "0",
        })
        cls.env.start()
        cls.temp = tempfile.TemporaryDirectory()
        cls.data_dir = Path(cls.temp.name) / "persistent"
        front = Path(cls.temp.name) / "frontend"
        front.mkdir()
        (front / "index.html").write_text("BOSQYN", encoding="utf-8")
        cls.server = make_server(front, cls.data_dir, port=0)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)
        cls.temp.cleanup()
        cls.env.stop()

    def setUp(self):
        self.cookie = ""

    def request(self, route, method="GET", payload=None, cookie=None, origin=True):
        headers = {}
        if payload is not None:
            headers["Content-Type"] = "application/json"
            body = json.dumps(payload).encode()
        else:
            body = None
        if method in ("POST", "PATCH", "DELETE") and origin:
            headers["Origin"] = "https://127.0.0.1:" + str(self.port)
            headers["X-Bosqyn-Action"] = "1"
        if cookie:
            headers["Cookie"] = cookie
        req = Request("http://127.0.0.1:" + str(self.port) + route,
                      data=body, headers=headers, method=method)
        try:
            with urlopen(req, timeout=15) as response:
                content = response.read()
                value = json.loads(content) if response.headers.get_content_type() == "application/json" else content
                return response.status, value, response.headers.get("Set-Cookie")
        except HTTPError as exc:
            raw = exc.read()
            return exc.code, json.loads(raw), None

    def login(self):
        status, result, cookie = self.request("/api/auth/login", "POST",
                                             {"password": "integration-test-secret-password-only"})
        self.assertEqual(status, 200, result)
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Strict", cookie)
        self.cookie = cookie.split(";", 1)[0]

    def test_01_requires_admin_and_prevents_leaking_images(self):
        status, state, _ = self.request("/api/auth/status")
        self.assertEqual(status, 200)
        self.assertTrue(state["configured"])
        self.assertFalse(state["authenticated"])
        for path in ("/api/alerts", "/api/evidence/1", "/api/backup", "/api/operations"):
            self.assertEqual(self.request(path)[0], 401)
        self.assertEqual(self.request("/api/alerts", "POST", {"category": "REVISION_MANUAL"})[0], 401)
        self.assertEqual(self.request("/api/alerts/1", "PATCH", {"status": "CONFIRMADA"})[0], 401)
        self.assertEqual(self.request("/api/alerts/1", "DELETE")[0], 401)

    def test_02_wrong_password_origin_and_successful_login(self):
        self.assertEqual(self.request("/api/auth/login", "POST", {"password": "incorrect-password"})[0], 401)
        self.assertEqual(self.request("/api/auth/login", "POST",
                                      {"password": "integration-test-secret-password-only"},
                                      origin=False)[0], 403)
        self.login()
        self.assertTrue(self.request("/api/auth/status", cookie=self.cookie)[1]["authenticated"])
        self.assertEqual(self.request("/api/alerts", "POST",
                                      {"category": "REVISION_MANUAL"},
                                      cookie=self.cookie, origin=False)[0], 403)
        self.assertEqual(self.request("/api/auth/logout", "POST", cookie=self.cookie)[0], 200)
        self.assertEqual(self.request("/api/alerts", cookie=self.cookie)[0], 401)

    def test_03_capture_update_delete_and_volume_persistence(self):
        self.login()
        image_bytes = b"\xff\xd8\xff\xe0BOSQYN test JPEG"
        payload = {
            "category": "REVISION_MANUAL",
            "image_data": "data:image/jpeg;base64," + base64.b64encode(image_bytes).decode(),
        }
        status, item, _ = self.request("/api/alerts", "POST", payload, self.cookie)
        self.assertEqual(status, 201, item)
        self.assertEqual(self.request("/api/alerts", cookie=self.cookie)[0], 200)
        status, retrieved, _ = self.request(item["evidence_url"], cookie=self.cookie)
        self.assertEqual(status, 200)
        self.assertEqual(retrieved, image_bytes)
        reopened = EvidenceStore(self.data_dir)
        self.assertIsNotNone(reopened.get_alert(item["id"]))
        self.assertTrue(reopened.get_image(item["id"]).exists())
        status, result, _ = self.request("/api/alerts/" + str(item["id"]), "PATCH",
                                         {"status": "CONFIRMADA"}, self.cookie)
        self.assertEqual(status, 200)
        self.assertEqual(result["status"], "CONFIRMADA")
        self.assertGreaterEqual(self.request("/api/statistics")[1]["total"], 1)
        status, deleted, _ = self.request("/api/alerts/" + str(item["id"]),
                                          "DELETE", cookie=self.cookie)
        self.assertEqual(status, 200)
        self.assertTrue(deleted["deleted"])
        self.assertEqual(self.request(item["evidence_url"], cookie=self.cookie)[0], 404)


class AuthFailsClosedTests(unittest.TestCase):
    def test_public_server_requires_long_secret(self):
        from backend.auth import AdminAuth
        with patch.dict(os.environ, {"BOSQYN_ADMIN_PASSWORD": "short"}, clear=False):
            manager = AdminAuth("0.0.0.0")
        self.assertFalse(manager.configured())
        self.assertFalse(manager.local_mode)


if __name__ == "__main__":
    unittest.main()
