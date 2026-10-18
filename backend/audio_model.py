"""Optional acoustic inference for BOSQYN AI.

Consumes signed PCM16 mono audio at 16 kHz, three-second windows.
Audio is never persisted. The model is loaded from the committed model ZIP.
Activation is opt-in: BOSQYN_AUDIO_ENABLED=1 and requirements-audio.txt.
"""

from __future__ import annotations

import importlib.util
import io
import json
import math
import os
import tempfile
import threading
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "audio" / "BOSQYN_IA_MODELO_KERAS.zip"
MAX_ZIP_BYTES = 80_000_000
MAX_MODEL_BYTES = 60_000_000

# Dos categorías ambientales para el dashboard, sin modificar los pesos del
# clasificador Keras de siete salidas.
TALA_SOUNDS = frozenset({"MOTOSIERRA", "MAQUINARIA_DEFORESTACION"})
DISPLAY_CLASSES = ["Tala", "Normal"]


def aggregate_audio_predictions(original_predictions: list[dict]) -> dict:
    """Combina probabilidades softmax de Keras de 7 clases en Tala/Normal.

    Conserva la distinción original en original_predictions (diagnóstico).
    Agrupar clases no constituye un nuevo entrenamiento ni validación.
    """
    if not original_predictions:
        raise ValueError("El modelo acústico no devolvió predicciones")
    classes_seen = set()
    scores = []
    for item in original_predictions:
        if not isinstance(item, dict):
            raise ValueError("Predicción de audio inválida")
        name = item.get("className")
        if not isinstance(name, str) or not name:
            raise ValueError("Nombre de clase de audio inválido")
        if name in classes_seen:
            raise ValueError("Clase de audio duplicada")
        classes_seen.add(name)
        try:
            probability = float(item["probability"])
        except (KeyError, TypeError, ValueError):
            raise ValueError("Probabilidad de audio inválida") from None
        if not math.isfinite(probability) or not 0 <= probability <= 1:
            raise ValueError("Probabilidad de audio fuera de rango")
        scores.append((name, probability))
    if not TALA_SOUNDS.issubset(classes_seen):
        raise ValueError("El modelo no contiene ambas clases acústicas de tala")
    total = sum(p for _, p in scores)
    if total <= 0 or abs(total - 1.0) > 0.02:
        raise ValueError("Las probabilidades acústicas deben sumar aproximadamente 1")
    tala = sum(p for name, p in scores if name in TALA_SOUNDS) / total
    normal = 1.0 - tala
    predictions = [
        {"className": "Tala", "probability": tala},
        {"className": "Normal", "probability": normal},
    ]
    top = max(predictions, key=lambda item: item["probability"])
    original_top = max(scores, key=lambda item: item[1])
    return {
        "predictions": predictions,
        "top_class": top["className"],
        "confidence": top["probability"],
        "original_predictions": original_predictions,
        "original_top_class": original_top[0],
        "original_confidence": original_top[1],
        "verification_required": True,
        "note": "Agrupación de probabilidades acústicas. Normal significa otras categorías del modelo; no confirma ausencia de riesgos.",
    }


def inspect_archive(path: Path = ARCHIVE) -> dict:
    result = {
        "available": False,
        "asset_present": path.is_file(),
        "enabled": os.environ.get("BOSQYN_AUDIO_ENABLED", "0") == "1",
        "classes": [],
        "display_classes": DISPLAY_CLASSES,
        "class_groups": {"Tala": sorted(TALA_SOUNDS), "Normal": []},
        "reason": "",
        "sample_rate": 16000,
        "duration_seconds": 3,
        "backend": "Keras 3 / NumPy (Python)",
    }
    if not path.is_file():
        result["reason"] = "No se ha subido BOSQYN_IA_MODELO_KERAS.zip."
        return result
    try:
        with zipfile.ZipFile(path) as bundle:
            entries = [entry for entry in bundle.infolist() if not entry.is_dir()]
            if (
                not entries
                or len(entries) > 80
                or sum(entry.file_size for entry in entries) > MAX_ZIP_BYTES
            ):
                raise ValueError("ZIP vacío o demasiado grande")
            for entry in entries:
                name = PurePosixPath(entry.filename)
                if name.is_absolute() or ".." in name.parts:
                    raise ValueError("Ruta ZIP no permitida")
            models = [
                e for e in entries if e.filename.lower().endswith((".keras", ".h5"))
            ]
            if len(models) != 1:
                raise ValueError(
                    "Se requiere exactamente un modelo .keras o .h5 dentro del ZIP."
                )
            if models[0].file_size > MAX_MODEL_BYTES:
                raise ValueError("Modelo demasiado grande")
            candidates = []
            for entry in entries:
                if (
                    not entry.filename.lower().endswith(".json")
                    or entry.file_size > 100_000
                ):
                    continue
                try:
                    parsed = json.loads(bundle.read(entry).decode("utf-8"))
                    if isinstance(parsed, dict) and isinstance(
                        parsed.get("classes"), list
                    ):
                        candidates.append(parsed)
                except (ValueError, UnicodeDecodeError, TypeError):
                    continue
            if len(candidates) != 1:
                raise ValueError(
                    "No se encontró un único archivo de configuración con la lista 'classes'."
                )
            cfg = candidates[0]
            classes = cfg.get("classes")
            if not 2 <= len(classes) <= 40 or not all(
                isinstance(c, str) and c.strip() for c in classes
            ):
                raise ValueError(
                    "Etiquetas acústicas no válidas: se requieren MOTOSIERRA y MAQUINARIA_DEFORESTACION"
                )
            if len(set(classes)) != len(classes):
                raise ValueError(
                    "La configuración contiene etiquetas acústicas duplicadas"
                )
            if not TALA_SOUNDS.issubset(set(classes)):
                raise ValueError(
                    "El modelo requiere clases MOTOSIERRA y MAQUINARIA_DEFORESTACION para generar Tala"
                )
            required = [
                "sample_rate",
                "clip_seconds",
                "n_mels",
                "n_fft",
                "hop_length",
                "fmax",
                "mean",
                "std",
            ]
            missing = [k for k in required if k not in cfg]
            if missing:
                raise ValueError("Configuración incompleta: " + ", ".join(missing))
            if int(cfg["sample_rate"]) != 16000 or float(cfg["clip_seconds"]) != 3:
                raise ValueError(
                    "El modelo requiere frecuencia de 16 kHz y ventanas de 3 segundos."
                )
            if "frames" not in cfg:
                cfg["frames"] = 1 + int(
                    float(cfg["sample_rate"]) * float(cfg["clip_seconds"])
                ) // int(cfg["hop_length"])
            if not 10 <= int(cfg["frames"]) <= 3000:
                raise ValueError("Número de fotogramas acústicos no válido")
            if float(cfg["std"]) <= 0:
                raise ValueError("Normalización acústica inválida")
            result["classes"] = classes
            result["class_groups"]["Normal"] = [
                name for name in classes if name not in TALA_SOUNDS
            ]
            result["model_file"] = PurePosixPath(models[0].filename).name
            result["sample_rate"] = 16000
            result["duration_seconds"] = 3
    except (OSError, ValueError, zipfile.BadZipFile, KeyError, TypeError) as exc:
        result["reason"] = "Error validando el ZIP de audio: " + str(exc)
        return result
    if not result["enabled"]:
        result["reason"] = (
            "El modelo está detectado. La inferencia de audio aún no está habilitada en este servidor (BOSQYN_AUDIO_ENABLED=1)."
        )
        return result
    missing_deps = [
        name
        for name in ("keras", "numpy", "librosa")
        if importlib.util.find_spec(name) is None
    ]
    if missing_deps:
        result["reason"] = "Faltan dependencias de inferencia: " + ", ".join(
            missing_deps
        )
        return result
    result["available"] = True
    result["reason"] = (
        "Motor acústico disponible; pendiente de comprobación con grabaciones independientes."
    )
    return result


class AudioModel:
    """Lazy-loaded Keras model; preprocessed exactly as the Colab training notebook."""

    def __init__(self, path: Path = ARCHIVE):
        self.path = path
        self._info = inspect_archive(path)
        self._lock = threading.RLock()
        self._model = None
        self._config = None

    def info(self):
        return dict(self._info)

    def _load(self):
        if not self._info["available"]:
            raise RuntimeError(self._info["reason"])
        if self._model is not None:
            return
        os.environ.setdefault("KERAS_BACKEND", "numpy")
        import keras

        with zipfile.ZipFile(self.path) as bundle:
            model_entry = next(
                x
                for x in bundle.infolist()
                if x.filename.lower().endswith((".keras", ".h5"))
            )
            cfg = next(
                json.loads(bundle.read(x).decode("utf-8"))
                for x in bundle.infolist()
                if x.filename.lower().endswith(".json")
                and x.file_size < 100_000
                and self._is_training_config(bundle, x)
            )
            if "frames" not in cfg:
                cfg["frames"] = 1 + int(
                    float(cfg["sample_rate"]) * float(cfg["clip_seconds"])
                ) // int(cfg["hop_length"])
            suffix = (
                ".keras" if model_entry.filename.lower().endswith(".keras") else ".h5"
            )
            with tempfile.TemporaryDirectory(prefix="bosqyn_audio_") as folder:
                filename = Path(folder) / ("classifier" + suffix)
                filename.write_bytes(bundle.read(model_entry))
                try:
                    loaded = keras.models.load_model(
                        str(filename), compile=False, safe_mode=True
                    )
                except (OSError, ValueError, TypeError, zipfile.BadZipFile) as exc:
                    raise RuntimeError(
                        "El archivo del modelo acústico es inválido o incompatible"
                    ) from exc
        if int(loaded.output_shape[-1]) != len(cfg["classes"]):
            raise RuntimeError(
                "Número de clases incompatible entre configuración y modelo Keras"
            )
        self._model = loaded
        self._config = cfg

    @staticmethod
    def _is_training_config(bundle, entry):
        try:
            value = json.loads(bundle.read(entry).decode("utf-8"))
            return isinstance(value, dict) and isinstance(value.get("classes"), list)
        except (ValueError, UnicodeDecodeError, TypeError):
            return False

    def predict_pcm16(self, pcm: bytes) -> dict:
        if len(pcm) % 2 or not 32_000 <= len(pcm) <= 128_000:
            raise ValueError("Envía entre 1 y 4 segundos de audio PCM16 mono a 16 kHz.")
        with self._lock:
            self._load()
            import numpy as np
            import librosa

            cfg = self._config
            y = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
            # Clip/pad to the same three-second duration used during training.
            y = librosa.util.fix_length(
                y, size=int(cfg["sample_rate"] * cfg["clip_seconds"])
            )
            mel = librosa.feature.melspectrogram(
                y=y,
                sr=int(cfg["sample_rate"]),
                n_fft=int(cfg["n_fft"]),
                hop_length=int(cfg["hop_length"]),
                n_mels=int(cfg["n_mels"]),
                fmax=float(cfg["fmax"]),
            )
            mel = librosa.power_to_db(mel, ref=1.0)
            mel = librosa.util.fix_length(mel, size=int(cfg["frames"]), axis=1)
            mel = np.clip((mel - float(cfg["mean"])) / float(cfg["std"]), -5, 5)
            batch = mel.astype("float32")[None, :, :, None]
            scores = np.asarray(self._model.predict(batch, verbose=0))[0]
            if len(scores) != len(cfg["classes"]) or not np.isfinite(scores).all():
                raise RuntimeError("El modelo devolvió predicciones inválidas")
            probabilities = [
                {"className": str(name), "probability": float(max(0, min(1, prob)))}
                for name, prob in zip(cfg["classes"], scores)
            ]
            return aggregate_audio_predictions(probabilities)
