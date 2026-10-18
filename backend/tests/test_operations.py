import base64
import copy
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from backend.storage import EvidenceStore
from backend import satellite

IMAGE=b'\x89PNG\r\n\x1a\noperation-test'

class OperationsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.store=EvidenceStore(Path(self.temp.name))
    def tearDown(self): self.temp.cleanup()
    def test_incident_deduplication_is_transactional(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            rows=list(pool.map(lambda _:self.store.add_visual_incident('HUMO',.93,IMAGE,'png'),range(4)))
        self.assertEqual(len({r['id'] for r in rows}),1)
        self.assertEqual(sum(not r['duplicate'] for r in rows),1)
        self.assertEqual(self.store.statistics()['by_source']['VISION_AUTOMATICA'],1)
    def test_invalid_automatic_scores_do_not_store(self):
        for score in [None,float('nan'),1.1,.84,True]:
            with self.assertRaises(ValueError):self.store.add_visual_incident('HUMO',score,IMAGE,'png')
        self.assertEqual(self.store.statistics()['total'],0)
    def test_backup_roundtrip_and_duplicates(self):
        row=self.store.add_manual_capture(IMAGE,'png')
        self.store.update_status(row['id'],'CONFIRMADA')
        backup=self.store.export_backup()
        self.assertEqual(self.store.restore_backup(backup),{'restored':0,'duplicates':1})
        self.store.remove_alert(row['id'])
        self.assertEqual(self.store.restore_backup(backup)['restored'],1)
        item=self.store.list_alerts()['items'][0]
        self.assertEqual(item['status'],'CONFIRMADA')
        self.assertEqual(self.store.get_image(item['id']).read_bytes(),IMAGE)
    def test_invalid_backup_is_atomic(self):
        self.store.add_manual_capture(IMAGE,'png')
        data=self.store.export_backup();data['records'].append({**data['records'][0],'image_data':'data:image/png;base64,YQ=='})
        with self.assertRaises(ValueError):self.store.restore_backup(data)
        self.assertEqual(self.store.statistics()['total'],1)
    def test_retention_preserves_pending_and_confirmed(self):
        old=(datetime.now(timezone.utc)-timedelta(days=100)).isoformat()
        for status in ['PENDIENTE','CONFIRMADA','DESCARTADA']:
            row=self.store.add_manual_capture(IMAGE,'png');self.store.update_status(row['id'],status)
            with self.store.connect() as conn:conn.execute('UPDATE alerts SET occurred_at=? WHERE id=?',(old,row['id']))
        self.assertEqual(self.store.retention()['eligible'],1)
        self.assertEqual(self.store.statistics()['total'],3)
        self.assertEqual(self.store.retention(apply=True)['removed'],1)
        self.assertEqual(self.store.statistics()['total'],2)
    def test_audio_evidence_backup_and_delete(self):
        import io, wave
        buffer=io.BytesIO()
        with wave.open(buffer,"wb") as wav:
            wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(16000);wav.writeframes(bytes(96000))
        audio=buffer.getvalue()
        row=self.store.add_visual_incident("TALA",.93,IMAGE,"png")
        self.store.attach_audio(row["id"],audio)
        self.assertEqual(self.store.get_audio(row["id"]),audio)
        self.assertIn("audio_url",self.store.get_alert(row["id"]))
        backup=self.store.export_backup()
        self.store.remove_alert(row["id"])
        self.assertIsNone(self.store.get_audio(row["id"]))
        self.store.restore_backup(backup)
        restored=self.store.list_alerts()["items"][0]
        self.assertEqual(self.store.get_audio(restored["id"]),audio)
        with self.assertRaises(ValueError):self.store.attach_audio(restored["id"],b"not audio")

    def test_filtered_pagination(self):
        self.store.add_manual_capture(IMAGE,'png');self.store.add_visual_incident('TALA',.9,IMAGE,'png')
        self.assertEqual(self.store.list_alerts(source='CAPTURA_MANUAL')['total'],1)
        self.assertEqual(self.store.list_alerts(category='TALA')['items'][0]['source'],'VISION_AUTOMATICA')
        self.assertEqual(len(self.store.list_alerts(limit=1,offset=1)['items']),1)
    def test_satellite_window_removes_stale_and_invalid(self):
        now=datetime.now(timezone.utc)
        with satellite._lock:
            previous=copy.deepcopy(satellite._events)
            try:
                satellite._events.clear()
                satellite._events.update({'old':{'id':'old','time':(now-timedelta(days=2)).isoformat()},'bad':{'id':'bad','time':'invalid'},'new':{'id':'new','time':now.isoformat()}})
                self.assertEqual([x['id'] for x in satellite.events()['events']],['new'])
                self.assertEqual(satellite.status()['window_hours'],24)
            finally:satellite._events.clear();satellite._events.update(previous)
