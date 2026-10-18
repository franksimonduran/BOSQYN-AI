import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from backend.vision_model import prepare_vision_model


class VisionModelTests(unittest.TestCase):
    def test_valid_tensorflowjs_archive_is_extracted(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            target = root / "models" / "vision"
            target.mkdir(parents=True)
            archive = target / "tm-my-image-model.zip"
            with zipfile.ZipFile(archive, "w") as z:
                z.writestr(
                    "tm-my-image-model/model.json",
                    json.dumps(
                        {"weightsManifest": [{"paths": ["weights.bin"], "weights": []}]}
                    ),
                )
                z.writestr(
                    "tm-my-image-model/metadata.json",
                    json.dumps(
                        {
                            "labels": [
                                "NORMAL",
                                "HUMO",
                                "FUEGO",
                                "NEBLINA_NUBES",
                                "INDICIOS_TALA",
                            ]
                        }
                    ),
                )
                z.writestr("tm-my-image-model/weights.bin", b"\x00\x01")
            result = prepare_vision_model(root)
            self.assertTrue(result["available"], result)
            self.assertEqual(result["class_count"], 5)
            self.assertEqual((target / "weights.bin").read_bytes(), b"\x00\x01")

    def test_rejects_keras_archive(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            target = root / "models" / "vision"
            target.mkdir(parents=True)
            with zipfile.ZipFile(target / "tm-my-image-model.zip", "w") as z:
                z.writestr("keras_model.h5", b"not tensor flow js")
            result = prepare_vision_model(root)
            self.assertFalse(result["available"])

    def test_rejects_unsafe_path(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            target = root / "models" / "vision"
            target.mkdir(parents=True)
            with zipfile.ZipFile(target / "tm-my-image-model.zip", "w") as z:
                z.writestr("../model.json", "{}")
            result = prepare_vision_model(root)
            self.assertFalse(result["available"])
