"""Offline tests for persisted satellite observations and drone GPS."""
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from backend.storage import EvidenceStore
from backend.satellite_store import SatelliteStore, bbox_valid, haversine_km, normalized_time
from backend import satellite


class SatelliteStoreTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.store = SatelliteStore(Path(self.folder.name) / "bosqyn.sqlite3")

    def tearDown(self):
        self.folder.cleanup()

    def record(self, source, reference, lat=-9.5, lon=-76.0):
        return {
            "id": reference, "source": source, "lat": lat, "lon": lon,
            "time": datetime.now(timezone.utc).isoformat(),
            "product": "VIIRS_NOAA20_NRT" if source=="NASA FIRMS" else "ABI-L2-FDCF",
            "product_ref": reference, "confidence": "h" if source=="NASA FIRMS" else "10",
        }

    def test_zone_validation_and_persistent_storage(self):
        self.assertEqual(len(self.store.zones()), 1)
        zone=self.store.save_zone({"name":"Zona de ensayo","bbox":[-77,-10,-76,-9]})
        self.assertEqual(zone["id"],2)
        reloaded=SatelliteStore(Path(self.folder.name) / "bosqyn.sqlite3")
        self.assertEqual(len(reloaded.zones()),2)
        for bbox in ([10,20,9,21],[-180,-90,180,90],["a",0,1,2]):
            with self.assertRaises(ValueError): bbox_valid(bbox)

    def test_no_duplicate_satellite_observations(self):
        record=self.record("NASA FIRMS","nasa-unique")
        self.assertEqual(self.store.upsert([record,record]),1)
        self.assertEqual(self.store.upsert([record]),0)
        self.assertEqual(len(self.store.observations()),1)
        self.assertEqual(len(SatelliteStore(Path(self.folder.name)/"bosqyn.sqlite3").observations()),1)

    def test_correlation_counts_distinct_sources(self):
        self.store.upsert([self.record("NASA FIRMS","n1"),
                           self.record("NASA FIRMS","n2"),
                           self.record("NOAA GOES-19","g1")])
        groups=self.store.correlated()
        self.assertEqual(len(groups),1)
        self.assertEqual(groups[0]["source_count"],2)
        self.assertEqual(groups[0]["observations"],3)
        self.assertEqual(haversine_km((-9.5,-76),(-9.5,-76)),0)

    def test_drone_gps_is_not_incident_position(self):
        now=datetime.now(timezone.utc).isoformat()
        item=self.store.record_drone({"drone_name":"Prueba","lat":-9.5,"lon":-76,
                                      "observed_at":now,"altitude_m":50})
        self.assertEqual(item["position_type"],"DRONE_GPS")
        self.assertIn("NO",item["message"])
        self.assertEqual(len(self.store.latest_drone()),1)
        self.assertEqual(len(self.store.correlated()),0)
        with self.assertRaises(ValueError):
            self.store.record_drone({"drone_name":"Prueba","lat":-9.5,"lon":-76,"observed_at":now})

    def test_visual_drone_capture_links_unverified_alert_and_drone_gps(self):
        store = EvidenceStore(Path(self.folder.name))
        now = datetime.now(timezone.utc).isoformat()
        self.store.record_drone({"drone_name":"Dron de prueba","lat":-9.5,"lon":-76,
                                 "observed_at":now,"altitude_m":100})
        saved = store.add_drone_visual_incident(
            "HUMO",0.91,b"\xff\xd8\xff imagen real de prueba","jpg")
        point = self.store.record_drone_detection("Dron de prueba","HUMO",0.91,saved["id"])
        self.assertEqual(point["position_type"],"DRONE_GPS")
        self.assertEqual(store.get_alert(saved["id"])["source"],"DRON_VISUAL")
        self.assertEqual(self.store.drone_events()[0]["alert_id"],saved["id"])
        store.update_status(saved["id"],"DESCARTADA")
        self.assertEqual(self.store.drone_events()[0]["status"],"DESCARTADA")

    def test_utc_validation(self):
        with self.assertRaises(ValueError): normalized_time("2026-10-30T12:00:00")
        with self.assertRaises(ValueError): self.store.record_drone(
            {"drone_name":"Prueba","lat":999,"lon":-76,
             "observed_at":datetime.now(timezone.utc).isoformat()})


class SatelliteFeedOfflineTests(unittest.TestCase):
    def test_nasa_missing_key_and_noaa_disabled(self):
        with tempfile.TemporaryDirectory() as directory:
            store=SatelliteStore(Path(directory)/"bosqyn.sqlite3")
            with patch.dict(os.environ,{"NASA_FIRMS_MAP_KEY":"","NOAA_ENABLED":"false"}):
                satellite.configure(store)
                satellite._nasa()
                satellite._noaa()
            status=store.statuses()
            self.assertIn("falta clave",status["NASA"]["status"])
            self.assertEqual(status["NOAA"]["status"],"desactivado")
            self.assertEqual(store.observations(),[])


if __name__ == "__main__":
    unittest.main()
