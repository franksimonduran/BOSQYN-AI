"""No-TensorFlow smoke tests for the optional acoustic recognition adapter."""
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from backend.audio_model import AudioModel, inspect_archive

GOOD = {
    "classes": ["Ambiente", "Motosierra"],
    "sample_rate": 16000,
    "clip_seconds": 3,
    "n_mels": 64,
    "n_fft": 1024,
    "hop_length": 256,
    "frames": 188,
    "fmax": 7600,
    "mean": -31.1,
    "std": 12.8,
}


class AudioAssetsTests(unittest.TestCase):
    def create(self, directory, config=None):
        path = Path(directory) / "BOSQYN_IA_MODELO_KERAS.zip"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("bosqyn_tensorflow.keras", b"sample placeholder for validation only")
            archive.writestr("bosqyn_tensorflow_config.json", json.dumps(config or GOOD))
        return path

    def test_missing_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            info = inspect_archive(Path(directory) / "missing.zip")
            self.assertFalse(info["available"])
            self.assertFalse(info["asset_present"])

    def test_config_is_read_without_tensorflow(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.create(directory)
            with patch.dict(os.environ, {"BOSQYN_AUDIO_ENABLED": "0"}):
                info = inspect_archive(path)
            self.assertTrue(info["asset_present"])
            self.assertEqual(info["classes"], ["Ambiente", "Motosierra"])
            self.assertFalse(info["available"])
            self.assertIn("BOSQYN_AUDIO_ENABLED", info["reason"])
            with self.assertRaises(RuntimeError):
                AudioModel(path).predict_pcm16(b"\x00" * 96000)

    def test_invalid_config_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.create(directory, {"classes": ["Motosierra"]})
            info = inspect_archive(path)
            self.assertFalse(info["available"])
            self.assertIn("Configuración incompleta", info["reason"])

    def test_invalid_archive_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.zip"
            path.write_bytes(b"not a zip")
            info = inspect_archive(path)
            self.assertFalse(info["available"])
            self.assertIn("Error validando", info["reason"])


if __name__ == "__main__":
    unittest.main()
