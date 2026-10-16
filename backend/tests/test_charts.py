"""Pruebas del gráfico real de estadísticas generado con Matplotlib."""
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from importlib.util import find_spec

from backend.storage import EvidenceStore


class DailyStatisticsTests(unittest.TestCase):
    def test_empty_data_has_seven_real_days_and_zero_counts(self):
        with tempfile.TemporaryDirectory() as directory:
            store = EvidenceStore(Path(directory))
            rows = store.activity_by_day()
            self.assertEqual(len(rows), 7)
            self.assertTrue(all(r["PENDIENTE"] == 0 and r["CONFIRMADA"] == 0 and r["DESCARTADA"] == 0 for r in rows))
            self.assertEqual(rows[-1]["date"], datetime.now(timezone.utc).date().isoformat())

    def test_manual_capture_changes_chart_data_not_model_predictions(self):
        with tempfile.TemporaryDirectory() as directory:
            store = EvidenceStore(Path(directory))
            item = store.add_manual_capture(b"\x89PNG\r\n\x1a\nsmall test image", "png")
            today = store.activity_by_day()[-1]
            self.assertEqual(today["PENDIENTE"], 1)
            self.assertEqual(today["CONFIRMADA"], 0)
            self.assertEqual(today["DESCARTADA"], 0)
            store.update_status(item["id"], "CONFIRMADA")
            today = store.activity_by_day()[-1]
            self.assertEqual(today["PENDIENTE"], 0)
            self.assertEqual(today["CONFIRMADA"], 1)
            self.assertEqual(store.statistics()["total"], 1)

    def test_ignores_records_older_than_seven_days(self):
        with tempfile.TemporaryDirectory() as directory:
            store = EvidenceStore(Path(directory))
            item = store.add_manual_capture(b"\x89PNG\r\n\x1a\n", "png")
            old = (datetime.now(timezone.utc) - timedelta(days=12)).isoformat(timespec="seconds")
            with store.connect() as conn:
                conn.execute("UPDATE alerts SET occurred_at = ? WHERE id = ?", (old,item["id"]))
            self.assertEqual(sum(sum(row[key] for key in ("PENDIENTE","CONFIRMADA","DESCARTADA")) for row in store.activity_by_day()), 0)

    @unittest.skipUnless(find_spec("matplotlib"), "Matplotlib no está instalado")
    def test_png_has_real_signature_and_no_fake_data(self):
        from backend.charts import render_activity_png
        with tempfile.TemporaryDirectory() as directory:
            store = EvidenceStore(Path(directory))
            image = render_activity_png(store.activity_by_day())
            self.assertTrue(image.startswith(b"\x89PNG\r\n\x1a\n"))
            self.assertGreater(len(image), 1500)
            item = store.add_manual_capture(b"\x89PNG\r\n\x1a\n", "png")
            image2 = render_activity_png(store.activity_by_day())
            self.assertNotEqual(image, image2)
            self.assertEqual(store.statistics()["total"], 1)


if __name__ == "__main__":
    unittest.main()
