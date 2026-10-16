import os, csv, io, math, time, threading, datetime, hashlib, tempfile
import requests
from fastapi import FastAPI, Query
from fastapi.responses import HTMLResponse
from contextlib import asynccontextmanager

W,S,E,N = [float(v) for v in os.getenv("SAT_BBOX","-77.1,-10.5,-75.1,-8.5").split(",")]
if not (-180<=W<E<=180 and -90<=S<N<=90 and E-W<=8 and N-S<=8):
    raise ValueError("SAT_BBOX invalida")
KEY=os.getenv("NASA_FIRMS_MAP_KEY","").strip()
SENSOR=os.getenv("NASA_SENSOR","VIIRS_NOAA20_NRT")
if SENSOR not in ("VIIRS_NOAA20_NRT","VIIRS_NOAA21_NRT","VIIRS_SNPP_NRT"):
    raise ValueError("NASA_SENSOR no soportado")
NOAA=os.getenv("NOAA_ENABLED","false").lower()=="true"
INTERVAL=max(10,int(os.getenv("SAT_REFRESH_MINUTES","30")))
observations={}
state={"NASA":{"status":"sin clave" if not KEY else "pendiente"},"NOAA":{"status":"pendiente" if NOAA else "desactivado"}}
mutex=threading.Lock()
stop=threading.Event()

def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def nasa_fetch():
    if not KEY:return
    bbox=",".join(map(str,[W,S,E,N]))
    url=f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{KEY}/{SENSOR}/{bbox}/1"
    try:
        r=requests.get(url,timeout=30,allow_redirects=False)
        if r.status_code!=200:raise RuntimeError(f"NASA HTTP {r.status_code}")
        if len(r.content)>5000000:raise RuntimeError("respuesta demasiado extensa")
        reader=csv.DictReader(io.StringIO(r.text.lstrip("\ufeff")))
        if not set(("latitude","longitude","acq_date","acq_time")).issubset(reader.fieldnames or []):
            raise RuntimeError("NASA no devolvio CSV de observaciones")
        incoming=[]
        for item in reader:
            try:
                lat,lon=float(item["latitude"]),float(item["longitude"])
                if not (S<=lat<=N and W<=lon<=E):continue
                d=item["acq_date"];t=item["acq_time"].zfill(4)
                timestamp=datetime.datetime.strptime(d+t,"%Y-%m-%d%H%M").replace(tzinfo=datetime.timezone.utc).isoformat()
                id=hashlib.sha256(f"NASA:{SENSOR}:{lat:.5f}:{lon:.5f}:{timestamp}".encode()).hexdigest()[:24]
                frp=float(item["frp"]) if item.get("frp") else None
                incoming.append(dict(id=id,source="NASA FIRMS",lat=lat,lon=lon,time=timestamp,confidence=str(item.get("confidence","")),frp=frp))
            except (ValueError,KeyError):continue
        with mutex:
            for item in incoming:observations[item["id"]]=item
            state["NASA"]={"status":"ok","checked_at":utc(),"items":len(incoming)}
    except Exception:
        # Never leak the key or a URL with it.
        with mutex:state["NASA"]={"status":"error de consulta","checked_at":utc()}

def noaa_fetch():
    if not NOAA:return
    try:
        import boto3,numpy as np,h5py
        from botocore import UNSIGNED
        from botocore.config import Config
        from pyproj import Transformer,CRS
        now=datetime.datetime.now(datetime.timezone.utc)
        s3=boto3.client("s3",region_name="us-east-1",config=Config(signature_version=UNSIGNED,connect_timeout=8,read_timeout=35))
        objects=[]
        for hours in range(4):
            moment=now-datetime.timedelta(hours=hours)
            prefix=f"ABI-L2-FDCF/{moment.year:04d}/{moment.timetuple().tm_yday:03d}/{moment.hour:02d}/"
            objects.extend(x for x in s3.list_objects_v2(Bucket="noaa-goes19",Prefix=prefix,MaxKeys=150).get("Contents",[]) if x["Key"].endswith(".nc"))
            if objects:break
        if not objects:raise RuntimeError("sin archivos recientes")
        obj=max(objects,key=lambda x:x["Key"])
        if obj["Size"]>120000000:raise RuntimeError("archivo supera limite")
        with tempfile.NamedTemporaryFile(suffix=".nc") as f:
            s3.download_file("noaa-goes19",obj["Key"],f.name)
            with h5py.File(f.name,"r") as nc:
                mask=nc["Mask"][:]
                rows,cols=np.where(np.isin(mask,list(range(10,16))+list(range(30,36))))
                if len(rows)>12000:rows,cols=rows[:12000],cols[:12000]
                a=nc["goes_imager_projection"].attrs
                def av(x):return float(np.asarray(a[x]).flat[0])
                h=av("perspective_point_height")
                crs=CRS.from_proj4(f'+proj=geos +h={h} +lon_0={av("longitude_of_projection_origin")} +a={av("semi_major_axis")} +b={av("semi_minor_axis")} +sweep=x +units=m')
                x,y=nc["x"],nc["y"]
                def coord(d,idx):return np.asarray(d[:])[idx]*float(np.asarray(d.attrs.get("scale_factor",1)).flat[0])+float(np.asarray(d.attrs.get("add_offset",0)).flat[0])
                lon,lat=Transformer.from_crs(crs,4326,always_xy=True).transform(coord(x,cols)*h,coord(y,rows)*h)
                incoming=[]
                for i in range(len(rows)):
                    if not (np.isfinite(lon[i]) and np.isfinite(lat[i]) and W<=lon[i]<=E and S<=lat[i]<=N):continue
                    tag=f'{obj["Key"]}:{rows[i]}:{cols[i]}'
                    incoming.append(dict(id=hashlib.sha256(tag.encode()).hexdigest()[:24],source="NOAA GOES-19",lat=round(float(lat[i]),5),lon=round(float(lon[i]),5),time=now.isoformat(),confidence=f'mask {int(mask[rows[i],cols[i]])}',frp=None))
                    if len(incoming)>=500:break
        with mutex:
            for item in incoming:observations[item["id"]]=item
            state["NOAA"]={"status":"ok","checked_at":utc(),"items":len(incoming)}
    except Exception:
        with mutex:state["NOAA"]={"status":"error de consulta","checked_at":utc()}

def worker():
    while not stop.is_set():
        nasa_fetch()
        noaa_fetch()
        stop.wait(INTERVAL*60)

@asynccontextmanager
async def life(app):
    stop.clear()
    thread=threading.Thread(target=worker,daemon=True)
    thread.start()
    yield
    stop.set()

app=FastAPI(title="BOSQYN IA Satelital",docs_url=None,redoc_url=None,lifespan=life)

@app.get("/api/health")
def health():return {"ok":True,"service":"bosqyn-satelital"}

@app.get("/api/status")
def status():
    with mutex:return {"feeds":dict(state),"count":len(observations),"bbox":[W,S,E,N],"note":"Observaciones periodicas; no video en vivo"}

@app.get("/api/events")
def events(limit:int=Query(400,ge=1,le=500)):
    with mutex:items=list(observations.values())
    return {"events":sorted(items,key=lambda x:x["time"],reverse=True)[:limit]}

PAGE='''<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BOSQYN IA · Satelital</title><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"><style>body{background:#081c16;color:#ecfff3;font-family:system-ui;margin:0}header{background:#102f24;padding:22px}h1{margin:0;color:#43dda4}main{padding:18px;max-width:1300px;margin:auto}.cards{display:flex;gap:14px;flex-wrap:wrap}.card{flex:1;min-width:190px;background:#153428;border:1px solid #37634d;border-radius:12px;padding:14px;margin-bottom:16px}#map{height:65vh;min-height:400px;border-radius:12px}small,p{color:#b4ccbc}button{background:#236e4b;color:white;border:0;padding:10px;border-radius:8px;cursor:pointer}</style></head><body><header><h1>BOSQYN IA · Visión satelital</h1><small>NASA FIRMS y NOAA GOES-19 — fuentes independientes del monitoreo en vivo</small></header><main><div class="cards"><div class="card"><b>NASA FIRMS</b><p id="nasa">Consultando…</p></div><div class="card"><b>NOAA GOES-19</b><p id="noaa">Consultando…</p></div><div class="card"><b>Observaciones almacenadas</b><p id="count">0</p></div></div><button onclick="refresh()">Actualizar vista</button><p>Las observaciones pueden tener retrasos; no son incendios confirmados. La ausencia de puntos no descarta incendios.</p><div id="map"></div><p>© OpenStreetMap contributors. Servicio satelital independiente de BOSQYN IA.</p></main><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>let map=L.map("map").setView([-9.5,-76.1],8);L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap",maxZoom:16}).addTo(map);let group=L.layerGroup().addTo(map);async function refresh(){try{let [s,r]=await Promise.all([fetch("/api/status").then(x=>x.json()),fetch("/api/events").then(x=>x.json())]);document.getElementById("nasa").textContent=s.feeds.NASA.status;document.getElementById("noaa").textContent=s.feeds.NOAA.status;document.getElementById("count").textContent=s.count;let b=s.bbox;map.fitBounds([[b[1],b[0]],[b[3],b[2]]]);group.clearLayers();for(let e of r.events){let c=e.source.startsWith("NASA")?"#f97316":"#facc15";let m=L.circleMarker([e.lat,e.lon],{color:c,radius:6}).addTo(group);m.bindPopup(e.source+" | "+e.time+" | Indicador: "+e.confidence)}}catch(err){document.getElementById("nasa").textContent="Error de servidor"}}refresh();setInterval(refresh,60000)</script></body></html>'''

@app.get("/",response_class=HTMLResponse)
def dashboard():return PAGE
