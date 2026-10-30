"""NASA FIRMS + NOAA GOES-19 public observations.

No synthetic observations. NASA requires server-only MAP_KEY, NOAA public S3
requires optional NetCDF dependencies. Both sources report true acquisition UTC.
"""
from __future__ import annotations
import csv
import datetime as dt
import hashlib
import io
import os
import threading
import time
from urllib.request import urlopen
from urllib.parse import quote

from .satellite_store import SatelliteStore, normalized_time

_lock=threading.RLock()
_store: SatelliteStore | None = None
_started=False
_last_poll={"NASA":0.0,"NOAA":0.0}
_active=False
NASA_INTERVAL=1800
NOAA_INTERVAL=600
NASA_SOURCES=("VIIRS_NOAA20_NRT","VIIRS_NOAA21_NRT")
FIRE_CODES={10,11,12,13,14,15,30,31,32,33,34,35}


def configure(store: SatelliteStore):
    global _store
    with _lock: _store=store


def _now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def status():
    with _lock:
        feeds={"NASA":{"status":"pendiente"},"NOAA":{"status":"pendiente"}}
        if _store:
            for key,row in _store.statuses().items():
                feeds[key]={
                    "status":row["status"],"checked_at":row["last_attempt"],
                    "last_success":row["last_success"],"last_observed":row["last_observed"],
                    "items":row["count"],"error":row["last_error"],
                }
            zones=_store.zones()
            total=len(_store.observations(500))
        else:
            zones=[]; total=0
    return {"feeds":feeds,"count":total,
            "bbox":[zones[0][k] for k in ("west","south","east","north")] if zones else [],
            "zones":zones,"window_hours":24,"poll_seconds":NASA_INTERVAL,
            "noaa_poll_seconds":NOAA_INTERVAL,
            "note":"Observaciones térmicas no son video ni detecciones confirmadas."}


def events(source=None,limit=500,since=None):
    return {"events":_store.observations(limit,source,since) if _store else []}


def _nasa():
    key=os.getenv("NASA_FIRMS_MAP_KEY","").strip()
    if not _store:return
    if not key:
        _store.sync("NASA","falta clave NASA_FIRMS_MAP_KEY")
        return
    zones=_store.zones()[:4]  # Bounded API usage; per-zone quotas must be considered.
    found=[]; failures=[]; last_observed=None
    for zone in zones:
        bbox=",".join(str(zone[k]) for k in ("west","south","east","north"))
        for sensor in NASA_SOURCES:
            url=("https://firms.modaps.eosdis.nasa.gov/api/area/csv/"
                 +quote(key,safe="")+"/"+sensor+"/"+bbox+"/1")
            try:
                raw=None
                for retry in range(2):
                    try:
                        with urlopen(url,timeout=25) as stream:
                            raw=stream.read(2_000_001)
                        break
                    except (OSError, TimeoutError):
                        if retry:raise
                        time.sleep(1)
                if raw is None or len(raw)>2_000_000:
                    raise ValueError("Respuesta excesiva o vacía")
                reader=csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
                if not {"latitude","longitude","acq_date","acq_time"}.issubset(reader.fieldnames or []):
                    raise ValueError("El formato CSV no contiene las columnas esperadas")
                for row in reader:
                    try:
                        lat,lon=float(row["latitude"]),float(row["longitude"])
                        if not(zone["west"]<=lon<=zone["east"] and zone["south"]<=lat<=zone["north"]):continue
                        observed=normalized_time(dt.datetime.strptime(
                            row["acq_date"]+row["acq_time"].zfill(4),"%Y-%m-%d%H%M"
                        ).replace(tzinfo=dt.timezone.utc).isoformat())
                        identity=f'{sensor}:{row.get("satellite","")}:{lat:.5f}:{lon:.5f}:{observed}'
                        id=hashlib.sha256(identity.encode()).hexdigest()[:24]
                        frp=row.get("frp")
                        try: frp=float(frp) if frp not in ("",None) else None
                        except (ValueError,TypeError):frp=None
                        found.append({"id":id,"source":"NASA FIRMS","lat":lat,"lon":lon,"time":observed,
                                      "confidence":row.get("confidence",""),"frp":frp,
                                      "fetched_at":_now(),"product":sensor,"product_ref":identity,
                                      "zone_id":zone["id"],
                                      "detail":{"satellite":row.get("satellite"),"instrument":row.get("instrument")}})
                        if last_observed is None or observed>last_observed:last_observed=observed
                    except (ValueError,KeyError,OverflowError):
                        continue
            except Exception as exc:
                # Never include request URL (contains MAP_KEY) in logs or stored errors.
                failures.append(f"{sensor}: {type(exc).__name__}")
    _store.upsert(found)
    if failures:
        _store.sync("NASA","parcial" if found else "error",len(found),
                    error="; ".join(failures)[:180],observed=last_observed)
    else:
        _store.sync("NASA","ok",len(found),observed=last_observed)


def _noaa():
    if not _store:return
    if os.getenv("NOAA_ENABLED","false").lower()!="true":
        _store.sync("NOAA","desactivado")
        return
    try:
        import boto3
        import h5py
        import numpy as np
        import tempfile
        from botocore import UNSIGNED
        from botocore.config import Config
        from pyproj import CRS, Transformer
        client=boto3.client("s3",region_name="us-east-1",
              config=Config(signature_version=UNSIGNED,connect_timeout=8,read_timeout=40,retries={"max_attempts":2}))
        latest=None
        now=dt.datetime.now(dt.timezone.utc)
        for back in range(4):
            clock=now-dt.timedelta(hours=back)
            prefix=f"ABI-L2-FDCF/{clock.year:04d}/{clock.timetuple().tm_yday:03d}/{clock.hour:02d}/"
            objects=client.list_objects_v2(Bucket="noaa-goes19",Prefix=prefix,MaxKeys=500).get("Contents",[])
            candidates=[o for o in objects if o["Key"].endswith(".nc") and o["Size"]<=120_000_000]
            if candidates:
                latest=max(candidates,key=lambda x:x["Key"])
                break
        if not latest:raise ValueError("No hay archivos GOES-19 recientes disponibles")
        last_sync=_store.statuses().get("NOAA") or {}
        if latest["Key"]==last_sync.get("last_product_ref"):
            old_time=last_sync.get("last_observed")
            age=(dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(old_time)).total_seconds() if old_time else float("inf")
            _store.sync("NOAA","desactualizado" if age>7200 else "ok",0,ref=latest["Key"])
            return
        found=[]
        with tempfile.TemporaryDirectory() as dirname:
            path=os.path.join(dirname,"fire.nc")
            client.download_file("noaa-goes19",latest["Key"],path)
            with h5py.File(path,"r") as nc:
                when=nc.attrs.get("time_coverage_start","")
                if isinstance(when,bytes):when=when.decode("utf-8")
                observed=normalized_time(str(when))
                mask=nc["Mask"][:]
                if mask.ndim != 2: raise ValueError("Máscara de fuego con dimensiones inesperadas")
                rows,cols=np.where(np.isin(mask,list(FIRE_CODES)))
                a=nc["goes_imager_projection"].attrs
                def scalar(key):return float(np.asarray(a[key]).flat[0])
                height=scalar("perspective_point_height")
                crs=CRS.from_proj4(
                    f'+proj=geos +h={height} +lon_0={scalar("longitude_of_projection_origin")} '
                    f'+a={scalar("semi_major_axis")} +b={scalar("semi_minor_axis")} +sweep=x +units=m'
                )
                def scaled(key):
                    v=nc[key]
                    return np.asarray(v[:],dtype=float)*float(np.asarray(v.attrs.get("scale_factor",1)).flat[0])+float(np.asarray(v.attrs.get("add_offset",0)).flat[0])
                xs=scaled("x"); ys=scaled("y")
                longitude,latitude=Transformer.from_crs(crs,4326,always_xy=True).transform(xs[cols]*height,ys[rows]*height)
                zones=_store.zones()
                quality=nc.get("DQF")
                power=nc.get("Power")
                for index in range(len(rows)):
                    lat,lon=float(latitude[index]),float(longitude[index])
                    if not np.isfinite(lat) or not np.isfinite(lon):continue
                    matches=[z for z in zones if z["west"]<=lon<=z["east"] and z["south"]<=lat<=z["north"]]
                    if not matches:continue
                    row,col=int(rows[index]),int(cols[index])
                    code=int(mask[row,col])
                    dqf=int(quality[row,col]) if quality is not None else None
                    if dqf not in (None,0):continue
                    frp=None
                    if power is not None:
                        raw_power=float(power[row,col])
                        frp=(raw_power*float(np.asarray(power.attrs.get("scale_factor",1)).flat[0])
                             +float(np.asarray(power.attrs.get("add_offset",0)).flat[0]))
                        if not np.isfinite(frp) or frp<0:frp=None
                    token=f'{latest["Key"]}:{row}:{col}'
                    found.append({"id":hashlib.sha256(token.encode()).hexdigest()[:24],
                                  "source":"NOAA GOES-19","lat":lat,"lon":lon,"time":observed,
                                  "confidence":str(code),"quality_code":dqf,"frp":frp,
                                  "fetched_at":_now(),"product":"ABI-L2-FDCF",
                                  "product_ref":token,"zone_id":matches[0]["id"],
                                  "detail":{"mask_code":code,"quality_code":dqf,"file":latest["Key"]}})
                    if len(found)>=500:break
        _store.upsert(found)
        age=(dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(observed)).total_seconds()
        _store.sync("NOAA","desactualizado" if age>7200 else "ok",
                    count=len(found),observed=observed,ref=latest["Key"])
    except Exception as exc:
        # Avoid propagating signed requests, credentials or tracebacks to UI.
        _store.sync("NOAA","error",error=type(exc).__name__)


def poll(source=None,force=False):
    """Bounded in-process polling. Separate next windows for NASA and NOAA."""
    global _active
    with _lock:
        if _active:return False
        _active=True
    try:
        for name,func,interval in (("NASA",_nasa,NASA_INTERVAL),("NOAA",_noaa,NOAA_INTERVAL)):
            if source and name!=source:continue
            with _lock:
                now=time.monotonic()
                if now-_last_poll[name]<interval:continue
                _last_poll[name]=now
            func()
        return True
    finally:
        with _lock:_active=False


def _worker():
    while True:
        try:poll()
        except Exception:pass
        time.sleep(60)


def start(store=None):
    global _started
    if store is not None:configure(store)
    with _lock:
        if _started:return
        _started=True
    threading.Thread(target=_worker,name="bosqyn-satellite",daemon=True).start()
