"""Prepare a Teachable Machine TensorFlow.js ZIP for same-origin browser inference.

Never execute contents of the ZIP. Keep assets public and limited to model metadata,
model.json and manifest-listed weight files.
"""

from __future__ import annotations

import json
from pathlib import Path, PurePosixPath
from zipfile import ZipFile, BadZipFile

MAX_TOTAL_UNCOMPRESSED = 80_000_000
MAX_ENTRIES = 60


def prepare_vision_model(frontend_dir: Path) -> dict:
    directory = Path(frontend_dir).resolve() / "models" / "vision"
    archive = directory / "tm-my-image-model.zip"
    if not archive.is_file():
        return {
            "available": False,
            "reason": "No se encontró tm-my-image-model.zip",
            "classes": [],
        }

    try:
        with ZipFile(archive) as bundle:
            members = [member for member in bundle.infolist() if not member.is_dir()]
            if not members or len(members) > MAX_ENTRIES:
                raise ValueError("Cantidad de archivos de modelo no válida")
            if sum(member.file_size for member in members) > MAX_TOTAL_UNCOMPRESSED:
                raise ValueError("El modelo descomprimido supera el límite admitido")
            for member in members:
                path = PurePosixPath(member.filename)
                if path.is_absolute() or ".." in path.parts:
                    raise ValueError("Ruta insegura dentro del ZIP")

            def pick(basename: str):
                matches = [
                    member
                    for member in members
                    if PurePosixPath(member.filename).name == basename
                ]
                if len(matches) != 1:
                    raise ValueError(
                        f"Se esperaba exactamente un archivo {basename} en el ZIP"
                    )
                return matches[0]

            model = json.loads(bundle.read(pick("model.json")))
            metadata = json.loads(bundle.read(pick("metadata.json")))
            labels = metadata.get("labels", [])
            if (
                not isinstance(labels, list)
                or not labels
                or not all(isinstance(v, str) and v.strip() for v in labels)
            ):
                raise ValueError("metadata.json no contiene etiquetas válidas")
            manifests = model.get("weightsManifest")
            if not isinstance(manifests, list) or not manifests:
                raise ValueError("model.json no contiene el manifiesto de pesos")
            weights = []
            for group in manifests:
                for relative in group.get("paths", []):
                    source_path = PurePosixPath(relative)
                    if source_path.is_absolute() or ".." in source_path.parts:
                        raise ValueError("Ruta insegura de pesos")
                    if source_path.suffix != ".bin" or len(source_path.parts) != 1:
                        raise ValueError(
                            "Ruta de pesos no admitida; exporta TensorFlow.js desde Teachable Machine"
                        )
                    weights.append(relative)
            if not weights:
                raise ValueError("No hay archivos de pesos")
            if len(set(weights)) != len(weights):
                raise ValueError("Archivos de pesos duplicados")
            for filename in weights:
                pick(filename)

            directory.mkdir(parents=True, exist_ok=True)
            for filename in ("model.json", "metadata.json", *weights):
                target = directory / filename
                temp = directory / (filename + ".tmp")
                temp.write_bytes(bundle.read(pick(filename)))
                temp.replace(target)
        return {
            "available": True,
            "format": "tensorflowjs-teachable-machine",
            "classes": labels,
            "class_count": len(labels),
            "model_url": "/models/vision/model.json",
            "metadata_url": "/models/vision/metadata.json",
            "automatic_alerts_enabled": False,
            "inference_location": "navegador",
        }
    except (
        ValueError,
        KeyError,
        TypeError,
        OSError,
        BadZipFile,
        json.JSONDecodeError,
    ) as error:
        return {"available": False, "reason": str(error), "classes": []}


if __name__ == "__main__":
    from .server import ROOT

    info = prepare_vision_model(ROOT / "frontend")
    print(json.dumps(info, ensure_ascii=False, indent=2))
    if not info["available"]:
        raise SystemExit(1)
