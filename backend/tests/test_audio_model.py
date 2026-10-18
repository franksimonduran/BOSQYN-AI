"""No-TensorFlow smoke tests for the optional acoustic recognition adapter."""

import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from backend.audio_model import AudioModel, inspect_archive, aggregate_audio_predictions

GOOD = {
    "classes": [
        "AMBIENTE_SELVA",
        "ANIMALES_SELVA",
        "CARRO",
        "MAQUINARIA_DEFORESTACION",
        "MOTOCICLETA",
        "MOTOSIERRA",
        "RUIDO_DRON",
    ],
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
            archive.writestr(
                "bosqyn_tensorflow.keras", b"sample placeholder for validation only"
            )
            archive.writestr(
                "bosqyn_tensorflow_config.json", json.dumps(config or GOOD)
            )
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
            self.assertEqual(info["classes"], GOOD["classes"])
            self.assertEqual(info["display_classes"], ["Tala", "Normal"])
            self.assertEqual(
                set(info["class_groups"]["Tala"]),
                {"MOTOSIERRA", "MAQUINARIA_DEFORESTACION"},
            )
            self.assertEqual(len(info["class_groups"]["Normal"]), 5)
            self.assertFalse(info["available"])
            self.assertIn("BOSQYN_AUDIO_ENABLED", info["reason"])
            with self.assertRaises(RuntimeError):
                AudioModel(path).predict_pcm16(b"\x00" * 96000)

    def test_invalid_config_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.create(directory, {"classes": ["Motosierra"]})
            info = inspect_archive(path)
            self.assertFalse(info["available"])
            self.assertIn("MAQUINARIA_DEFORESTACION", info["reason"])

    def test_valid_labels_with_missing_audio_preprocessing_config(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.create(directory, {"classes": GOOD["classes"]})
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


class BinaryAudioClassificationTests(unittest.TestCase):
    def test_groups_seven_trained_classes_by_probability_sum(self):
        original = [
            {"className": "AMBIENTE_SELVA", "probability": 0.1},
            {"className": "ANIMALES_SELVA", "probability": 0.05},
            {"className": "CARRO", "probability": 0.1},
            {"className": "MAQUINARIA_DEFORESTACION", "probability": 0.3},
            {"className": "MOTOCICLETA", "probability": 0.05},
            {"className": "MOTOSIERRA", "probability": 0.35},
            {"className": "RUIDO_DRON", "probability": 0.05},
        ]
        result = aggregate_audio_predictions(original)
        self.assertEqual(
            [r["className"] for r in result["predictions"]], ["Tala", "Normal"]
        )
        self.assertAlmostEqual(result["predictions"][0]["probability"], 0.65)
        self.assertAlmostEqual(result["predictions"][1]["probability"], 0.35)
        self.assertEqual(result["top_class"], "Tala")
        self.assertEqual(result["original_top_class"], "MOTOSIERRA")
        self.assertEqual(result["original_predictions"], original)

    def test_aggregation_can_override_seven_class_argmax(self):
        original = [
            {"className": "CARRO", "probability": 0.38},
            {"className": "MOTOSIERRA", "probability": 0.32},
            {"className": "MAQUINARIA_DEFORESTACION", "probability": 0.30},
        ]
        result = aggregate_audio_predictions(original)
        self.assertEqual(result["original_top_class"], "CARRO")
        self.assertEqual(result["top_class"], "Tala")
        self.assertAlmostEqual(result["confidence"], 0.62)

    def test_other_sounds_are_normal_not_tala(self):
        original = [
            {"className": "MOTOSIERRA", "probability": 0.05},
            {"className": "MAQUINARIA_DEFORESTACION", "probability": 0.01},
            {"className": "AMBIENTE_SELVA", "probability": 0.94},
        ]
        result = aggregate_audio_predictions(original)
        self.assertEqual(result["top_class"], "Normal")
        self.assertAlmostEqual(result["confidence"], 0.94)

    def test_rejects_missing_positive_label_and_invalid_probabilities(self):
        with self.assertRaises(ValueError):
            aggregate_audio_predictions(
                [
                    {"className": "MOTOSIERRA", "probability": 0.5},
                    {"className": "CARRO", "probability": 0.5},
                ]
            )
        with self.assertRaises(ValueError):
            aggregate_audio_predictions(
                [
                    {"className": "MOTOSIERRA", "probability": 0.6},
                    {
                        "className": "MAQUINARIA_DEFORESTACION",
                        "probability": float("nan"),
                    },
                    {"className": "CARRO", "probability": 0.4},
                ]
            )

    def test_rejects_incompatible_audio_model_labels(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "incorrect.zip"
            wrong = {**GOOD, "classes": ["MOTOSIERRA", "CARRO", "ANIMALES_SELVA"]}
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("audio.keras", b"fake model")
                archive.writestr("config.json", json.dumps(wrong))
            result = inspect_archive(path)
            self.assertFalse(result["available"])
            self.assertIn("MAQUINARIA_DEFORESTACION", result["reason"])


if __name__ == "__main__":
    unittest.main()
