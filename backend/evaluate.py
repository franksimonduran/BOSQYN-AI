"""Evaluate Teachable Machine results exported to CSV without third-party libs.

CSV columns: actual,predicted; use genuinely held-out test images.
"""
from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from pathlib import Path


def evaluate_csv(path: Path):
    with Path(path).open("r", newline="", encoding="utf-8-sig") as source:
        reader = csv.DictReader(source)
        if not reader.fieldnames or not {"actual", "predicted"}.issubset(reader.fieldnames):
            raise ValueError("El CSV debe contener las columnas: actual,predicted")
        pairs = []
        for row in reader:
            actual = (row["actual"] or "").strip()
            predicted = (row["predicted"] or "").strip()
            if not actual or not predicted:
                raise ValueError("No se admiten etiquetas vacías")
            pairs.append((actual, predicted))
    if not pairs:
        raise ValueError("El CSV no contiene ejemplos")
    classes = sorted({value for pair in pairs for value in pair})
    matrix = {actual: Counter(pred for true, pred in pairs if true == actual) for actual in classes}
    by_class = {}
    for label in classes:
        true_positive = matrix[label][label]
        false_positive = sum(matrix[other][label] for other in classes if other != label)
        false_negative = sum(matrix[label][other] for other in classes if other != label)
        precision = true_positive / (true_positive + false_positive) if (true_positive + false_positive) else 0.0
        recall = true_positive / (true_positive + false_negative) if (true_positive + false_negative) else 0.0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
        by_class[label] = {
            "support": sum(matrix[label].values()),
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
        }
    return {
        "samples": len(pairs),
        "accuracy": round(sum(a == b for a, b in pairs) / len(pairs), 4),
        "macro_f1": round(sum(v["f1"] for v in by_class.values()) / len(classes), 4),
        "classes": by_class,
        "confusion_matrix": {a: {b: matrix[a][b] for b in classes} for a in classes},
        "notice": "Estas métricas reflejan únicamente las etiquetas del CSV suministrado.",
    }


def main():
    parser = argparse.ArgumentParser(description="Evalúa predicciones de BOSQYN AI")
    parser.add_argument("csv", type=Path, help="CSV con columnas actual,predicted")
    args = parser.parse_args()
    try:
        print(json.dumps(evaluate_csv(args.csv), indent=2, ensure_ascii=False))
    except (ValueError, OSError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
