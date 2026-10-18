import base64
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from backend.evaluate import evaluate_csv
from backend.server import make_server
from backend.storage import EvidenceStore


class StoreTests(unittest.TestCase):
    def test_create_update_remove_and_statistics(self):
        with tempfile.TemporaryDirectory() as t:
            store = EvidenceStore(Path(t))
            item = store.add_manual_capture(b"\xff\xd8\xff\xd9", "jpg")
            self.assertEqual(item["category"], "REVISION_MANUAL")
            self.assertEqual(store.statistics()["total"], 1)
            image = store.get_image(item["id"])
            self.assertTrue(image.exists())
            self.assertEqual(
                store.update_status(item["id"], "CONFIRMADA")["status"], "CONFIRMADA"
            )
            self.assertTrue(store.remove_alert(item["id"]))
            self.assertFalse(image.exists())
            self.assertEqual(store.statistics()["total"], 0)

    def test_evaluation(self):
        with tempfile.TemporaryDirectory() as t:
            path = Path(t) / "test.csv"
            path.write_text(
                "actual,predicted\nHUMO,HUMO\nFUEGO,HUMO\nNORMAL,NORMAL\n",
                encoding="utf-8",
            )
            result = evaluate_csv(path)
            self.assertEqual(result["samples"], 3)
            self.assertEqual(result["accuracy"], round(2 / 3, 4))
            self.assertEqual(result["classes"]["FUEGO"]["recall"], 0)


class APITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Legacy local API tests intentionally use loopback without an admin password.
        # Production tests exercise password protection in test_security.py.
        from unittest.mock import patch

        cls.env_patch = patch.dict(
            os.environ,
            {
                "BOSQYN_ADMIN_PASSWORD": "",
                "BOSQYN_READ_ONLY": "0",
                "BOSQYN_AUDIO_ENABLED": "0",
            },
        )
        cls.env_patch.start()
        cls.temp = tempfile.TemporaryDirectory()
        base = Path(cls.temp.name)
        front = base / "frontend"
        front.mkdir()
        (front / "index.html").write_text("<h1>BOSQYN TEST</h1>", encoding="utf-8")
        cls.server = make_server(front, base / "data", port=0)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)
        cls.temp.cleanup()
        cls.env_patch.stop()

    def call(self, path, method="GET", payload=None):
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = {"Content-Type": "application/json"} if payload is not None else {}
        request = Request(
            f"http://127.0.0.1:{self.port}{path}",
            data=body,
            headers=headers,
            method=method,
        )
        try:
            with urlopen(request, timeout=4) as response:
                content = response.read()
                if response.headers.get_content_type() == "application/json":
                    return response.status, json.loads(content)
                return response.status, content
        except HTTPError as error:
            return error.code, json.loads(error.read())

    def test_api_flow(self):
        status, health = self.call("/api/health")
        self.assertEqual(status, 200)
        self.assertFalse(health["model_integrated"])
        status, homepage = self.call("/")
        self.assertIn(b"BOSQYN TEST", homepage)
        image = "data:image/jpeg;base64," + base64.b64encode(
            b"\xff\xd8\xff\xd9"
        ).decode("ascii")
        status, row = self.call(
            "/api/alerts", "POST", {"category": "REVISION_MANUAL", "image_data": image}
        )
        self.assertEqual(status, 201)
        alert_id = row["id"]
        self.assertEqual(row["status"], "PENDIENTE")
        status, items = self.call("/api/alerts")
        self.assertTrue(any(x["id"] == alert_id for x in items["items"]))
        status, photo = self.call(row["evidence_url"])
        self.assertEqual(photo, b"\xff\xd8\xff\xd9")
        status, stats = self.call("/api/statistics")
        self.assertGreaterEqual(stats["total"], 1)
        status, confirmed = self.call(
            f"/api/alerts/{alert_id}", "PATCH", {"status": "CONFIRMADA"}
        )
        self.assertEqual(confirmed["status"], "CONFIRMADA")
        status, removed = self.call(f"/api/alerts/{alert_id}", "DELETE")
        self.assertTrue(removed["deleted"])
        self.assertEqual(self.call(row["evidence_url"])[0], 404)

    def test_read_only_blocks_writes(self):
        prior = os.environ.get("BOSQYN_READ_ONLY")
        try:
            os.environ["BOSQYN_READ_ONLY"] = "1"
            status, result = self.call(
                "/api/alerts",
                "POST",
                {
                    "category": "REVISION_MANUAL",
                    "image_data": "data:image/png;base64,YQ==",
                },
            )
            self.assertEqual(status, 403)
            status, result = self.call(
                "/api/alerts/1", "PATCH", {"status": "CONFIRMADA"}
            )
            self.assertEqual(status, 403)
            status, result = self.call("/api/alerts/1", "DELETE")
            self.assertEqual(status, 403)
            status, result = self.call("/api/health")
            self.assertEqual(status, 200)
        finally:
            if prior is None:
                os.environ.pop("BOSQYN_READ_ONLY", None)
            else:
                os.environ["BOSQYN_READ_ONLY"] = prior

    def test_operations_backup_and_automatic_endpoint(self):
        image = (
            "data:image/png;base64,"
            + base64.b64encode(b"\x89PNG\r\n\x1a\napi-test").decode()
        )
        payload = {
            "source": "VISION_AUTOMATICA",
            "category": "TALA",
            "confidence": 0.95,
            "image_data": image,
        }
        code, row = self.call("/api/alerts", "POST", payload)
        self.assertEqual(code, 201)
        code, duplicate = self.call("/api/alerts", "POST", payload)
        self.assertEqual(code, 200)
        self.assertEqual(duplicate["id"], row["id"])
        self.assertTrue(duplicate["duplicate"])
        code, filtered = self.call(
            "/api/alerts?source=VISION_AUTOMATICA&category=TALA&offset=0"
        )
        self.assertEqual(filtered["total"], 1)
        code, backup = self.call("/api/backup")
        self.assertEqual(code, 200)
        self.assertEqual(backup["format"], "bosqyn-server-evidence")
        code, restored = self.call("/api/backup/restore", "POST", backup)
        self.assertEqual(code, 200)
        self.assertEqual(restored["restored"], 0)
        self.assertEqual(self.call("/api/retention", "POST", {"days": 90})[0], 200)
        self.assertEqual(self.call("/api/operations")[0], 200)
        self.call("/api/alerts/" + str(row["id"]), "DELETE")

    def test_rejects_false_ai_claims_and_invalid_images(self):
        status, result = self.call(
            "/api/alerts",
            "POST",
            {"category": "HUMO", "image_data": "data:image/png;base64,YQ=="},
        )
        self.assertEqual(status, 400)
        status, result = self.call(
            "/api/alerts",
            "POST",
            {"category": "REVISION_MANUAL", "image_data": "data:image/png;base64,YQ=="},
        )
        self.assertEqual(status, 400)
        status, result = self.call("/api/alerts/-1", "PATCH", {"status": "CONFIRMADA"})
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main()
