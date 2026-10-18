"""Read-only satellite feed for BOSQYN's primary Python service.
No satellite credentials are sent to the browser.
"""
import csv,datetime as dt,hashlib,io,os,threading,time,json
from pathlib import Path
from urllib.request import urlopen
from urllib.error import HTTPError
from urllib.parse import quote

_BBOX=(-77.1,-10.5,-75.1,-8.5)
_lock=threading.RLock()
_events={}
_status={"NASA":{"status":"pendiente"},"NOAA":{"status":"pendiente"}}
_started=False

def _trim_events():
    cutoff = dt.datetime.now(dt.timezone.utc)-dt.timedelta(hours=24)
    for key,event in list(_events.items()):
        try:
            observed=dt.datetime.fromisoformat(event["time"].replace("Z","+00:00"))
            if observed.tzinfo is None or observed<cutoff: _events.pop(key,None)
        except (ValueError,KeyError,TypeError): _events.pop(key,None)
    if len(_events)>5000:
        keep=sorted(_events.values(),key=lambda e:e["time"],reverse=True)[:5000]
        _events.clear();_events.update({e["id"]:e for e in keep})

def status():
    with _lock:
        _trim_events()
        return {"feeds":dict(_status),"count":len(_events),"bbox":list(_BBOX),"window_hours":24,"poll_seconds":1800}

def events():
    with _lock:
        _trim_events()
        return {"events":sorted(_events.values(),key=lambda e:e["time"],reverse=True)[:500]}

def _nasa():
    key=os.environ.get("NASA_FIRMS_MAP_KEY","").strip()
    if not key:
        with _lock:_status["NASA"]={"status":"Falta clave NASA"}
        return
    sensor="VIIRS_NOAA20_NRT"
    bbox=",".join(map(str,_BBOX))
    try:
        url="https://firms.modaps.eosdis.nasa.gov/api/area/csv/"+quote(key,safe="")+"/"+sensor+"/"+bbox+"/1"
        with urlopen(url,timeout=28) as response:
            if response.status!=200:raise ValueError("HTTP")
            raw=response.read(4000001)
            if len(raw)>4000000:raise ValueError("Large response")
        rows=list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
        if rows and not {"latitude","longitude","acq_date","acq_time"}.issubset(rows[0]):raise ValueError("CSV")
        found=[]
        for row in rows:
            try:
                lat,lon=float(row["latitude"]),float(row["longitude"])
                if not (_BBOX[0]<=lon<=_BBOX[2] and _BBOX[1]<=lat<=_BBOX[3]):continue
                t=dt.datetime.strptime(row["acq_date"]+row["acq_time"].zfill(4),"%Y-%m-%d%H%M").replace(tzinfo=dt.timezone.utc).isoformat()
                label=f"NASA:{lat:.5f}:{lon:.5f}:{t}"
                found.append({"id":hashlib.sha256(label.encode()).hexdigest()[:24],"source":"NASA FIRMS","lat":lat,"lon":lon,"time":t,"confidence":str(row.get("confidence","")),"frp":row.get("frp"),"fetched_at":dt.datetime.now(dt.timezone.utc).isoformat(),"product":sensor,"product_ref":label})
            except (ValueError,KeyError):pass
        with _lock:
            for e in found:_events[e["id"]]=e
            _status["NASA"]={"status":"ok","items":len(found),"checked_at":dt.datetime.now(dt.timezone.utc).isoformat()}
    except Exception:
        with _lock:_status["NASA"]={"status":"error de consulta","checked_at":dt.datetime.now(dt.timezone.utc).isoformat()}

def _noaa():
    if os.environ.get("NOAA_ENABLED","false").lower()!="true":
        with _lock:_status["NOAA"]={"status":"desactivado"}
        return
    try:
        import boto3,numpy as np,h5py,tempfile
        from botocore import UNSIGNED
        from botocore.config import Config
        from pyproj import CRS,Transformer
        s3=boto3.client("s3",region_name="us-east-1",config=Config(signature_version=UNSIGNED,connect_timeout=8,read_timeout=30))
        now=dt.datetime.now(dt.timezone.utc)
        objects=[]
        for back in range(3):
            moment=now-dt.timedelta(hours=back)
            prefix=f"ABI-L2-FDCF/{moment.year:04d}/{moment.timetuple().tm_yday:03d}/{moment.hour:02d}/"
            objects=[o for o in s3.list_objects_v2(Bucket="noaa-goes19",Prefix=prefix,MaxKeys=200).get("Contents",[]) if o["Key"].endswith(".nc")]
            if objects:break
        if not objects:raise ValueError("no data")
        obj=max(objects,key=lambda o:o["Key"])
        if obj["Size"]>120000000:raise ValueError("oversized")
        found=[]
        with tempfile.NamedTemporaryFile(suffix=".nc") as tmp:
            s3.download_file("noaa-goes19",obj["Key"],tmp.name)
            with h5py.File(tmp.name,"r") as nc:
                observed=nc.attrs.get("time_coverage_start", "")
                if isinstance(observed,bytes): observed=observed.decode("utf-8")
                observed=str(observed)
                stamp=dt.datetime.fromisoformat(observed.replace("Z","+00:00"))
                if stamp.tzinfo is None: raise ValueError("Missing satellite timezone")
                observed=stamp.astimezone(dt.timezone.utc).isoformat()
                mask=nc["Mask"][:]
                rows,cols=np.where(np.isin(mask,list(range(10,16))+list(range(30,36))))
                a=nc["goes_imager_projection"].attrs
                def val(k):return float(np.asarray(a[k]).flat[0])
                h=val("perspective_point_height")
                projection=CRS.from_proj4(f'+proj=geos +h={h} +lon_0={val("longitude_of_projection_origin")} +a={val("semi_major_axis")} +b={val("semi_minor_axis")} +sweep=x +units=m')
                x=np.asarray(nc["x"][:],dtype=float)*float(np.asarray(nc["x"].attrs.get("scale_factor",1)).flat[0])+float(np.asarray(nc["x"].attrs.get("add_offset",0)).flat[0])
                y=np.asarray(nc["y"][:],dtype=float)*float(np.asarray(nc["y"].attrs.get("scale_factor",1)).flat[0])+float(np.asarray(nc["y"].attrs.get("add_offset",0)).flat[0])
                lon,lat=Transformer.from_crs(projection,4326,always_xy=True).transform(x[cols]*h,y[rows]*h)
                for i in range(len(rows)):
                    if not (np.isfinite(lat[i]) and np.isfinite(lon[i]) and _BBOX[0]<=lon[i]<=_BBOX[2] and _BBOX[1]<=lat[i]<=_BBOX[3]):continue
                    token=f'{obj["Key"]}:{rows[i]}:{cols[i]}'
                    found.append({"id":hashlib.sha256(token.encode()).hexdigest()[:24],"source":"NOAA GOES-19","lat":round(float(lat[i]),5),"lon":round(float(lon[i]),5),"time":observed,"confidence":str(int(mask[rows[i],cols[i]])),"frp":None,"fetched_at":now.isoformat(),"product":"ABI-L2-FDCF","product_ref":obj["Key"]})
                    if len(found)>=500:break
        with _lock:
            for item in found:_events[item["id"]]=item
            _status["NOAA"]={"status":"ok","items":len(found),"checked_at":dt.datetime.now(dt.timezone.utc).isoformat()}
    except Exception:
        with _lock:_status["NOAA"]={"status":"error de consulta","checked_at":dt.datetime.now(dt.timezone.utc).isoformat()}

def _worker():
    while True:
        _nasa()
        _noaa()
        time.sleep(1800)

def start():
    global _started
    if _started:return
    _started=True
    threading.Thread(target=_worker,daemon=True,name="bosqyn-satellite").start()
