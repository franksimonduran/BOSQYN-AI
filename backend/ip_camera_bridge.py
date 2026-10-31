"""BOSQYN IP Camera Bridge: run on a trusted PC/Raspberry Pi on camera LAN.

Requires ffmpeg in PATH. Cameras initiate NO inbound connections to Railway:
this agent reads private RTSP/MJPEG locally and pushes sanitized JPEG over HTTPS.
Secrets are read from environment and encrypted configuration via scoped API.
"""
from __future__ import annotations
import argparse
import base64
import json
import os
import shutil
import subprocess
import threading
import time
from urllib.parse import quote,urlsplit,urlunsplit
from urllib.request import Request,urlopen
from urllib.error import HTTPError,URLError

from .ip_cameras import validate_source,MAX_FRAME_BYTES

def endpoint(base,path):
    return base.rstrip("/")+path

def request(base,token,path,method="GET",payload=None,binary=False,pcm=False):
    url=endpoint(base,path)
    headers={"X-Bosqyn-Bridge-Token":token}
    if payload is not None:
        if binary:
            body=payload
            headers["Content-Type"]="application/octet-stream" if pcm else "image/jpeg"
            if pcm:headers["X-Bosqyn-Sample-Rate"]="16000"
        else:
            body=json.dumps(payload).encode()
            headers["Content-Type"]="application/json"
    else:body=None
    query=Request(url,data=body,headers=headers,method=method)
    with urlopen(query,timeout=20) as response:
        raw=response.read(2_000_000)
        return json.loads(raw) if raw else {}

def media_uri(camera):
    """Server-validated RFC1918 stream, ONVIF discovery stays on same IP."""
    url,_=validate_source(camera["url"],camera["protocol"],camera["port"])
    p=urlsplit(url)
    if camera["protocol"]=="ONVIF":
        try:
            from onvif import ONVIFCamera
        except ImportError as error:
            raise RuntimeError("ONVIF requiere instalar onvif-zeep en la pasarela") from error
        device=ONVIFCamera(p.hostname,p.port,camera.get("username",""),camera.get("password",""))
        media=device.create_media_service()
        profiles=media.GetProfiles()
        if not profiles:raise RuntimeError("ONVIF no devolvió perfiles de video")
        response=media.GetStreamUri({"StreamSetup":{"Stream":"RTP-Unicast","Transport":{"Protocol":"RTSP"}},"ProfileToken":profiles[0].token})
        stream=response.Uri
        parsed=urlsplit(stream)
        if parsed.hostname!=p.hostname:
            raise RuntimeError("ONVIF devolvió un destino distinto a la IP autorizada")
        url,_=validate_source(stream,"RTSP",parsed.port)
        p=urlsplit(url)
    user=camera.get("username","")
    pw=camera.get("password","")
    if user:
        auth=quote(user,safe="")+":"+quote(pw,safe="")+"@"
        url=urlunsplit((p.scheme,auth+p.netloc,p.path,p.query,""))
    return url

def ffmpeg_cmd(source,fps=1,single=False):
    cmd=["ffmpeg","-hide_banner","-loglevel","error","-nostdin","-rw_timeout","8000000"]
    if source.startswith("rtsp://"):cmd.extend(["-rtsp_transport","tcp"])
    return cmd+["-i",source,"-an","-vf",f"fps={fps}"]+ (["-frames:v","1"] if single else []) + ["-q:v","7","-f","image2pipe","-vcodec","mjpeg","pipe:1"]

def one_frame(source):
    try:
        result=subprocess.run(ffmpeg_cmd(source,single=True),stdin=subprocess.DEVNULL,
                              stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
                              timeout=14,check=False)
    except subprocess.TimeoutExpired:
        return None
    data=result.stdout
    start=data.find(b"\xff\xd8\xff")
    stop=data.find(b"\xff\xd9",start+3)
    if start<0 or stop<0:return None
    frame=data[start:stop+2]
    return frame if len(frame)<=MAX_FRAME_BYTES else None

def read_jpegs(stream,stop):
    """Parse FFmpeg image2pipe byte stream with a strict bounded buffer."""
    buffer=bytearray()
    while not stop.is_set():
        chunk=stream.read(8192)
        if not chunk:break
        buffer.extend(chunk)
        while True:
            start=buffer.find(b"\xff\xd8\xff")
            if start<0:
                if len(buffer)>4:del buffer[:-4]
                break
            if start:del buffer[:start]
            end=buffer.find(b"\xff\xd9",3)
            if end<0:
                if len(buffer)>MAX_FRAME_BYTES:buffer.clear()
                break
            frame=bytes(buffer[:end+2])
            del buffer[:end+2]
            if 100<len(frame)<=MAX_FRAME_BYTES:
                yield frame

def audio_pcm(source):
    """Use exact training input: 3 seconds, signed PCM16 mono, 16kHz."""
    cmd=["ffmpeg","-hide_banner","-loglevel","error","-nostdin","-rw_timeout","8000000"]
    if source.startswith("rtsp://"):cmd+=["-rtsp_transport","tcp"]
    cmd+=["-i",source,"-vn","-t","3","-ac","1","-ar","16000","-f","s16le","pipe:1"]
    try:
        result=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
                              stdin=subprocess.DEVNULL,timeout=16,check=False)
    except subprocess.TimeoutExpired:return None
    return result.stdout if len(result.stdout)==96000 else None

class Bridge:
    def __init__(self,base,token,poll=4):
        p=urlsplit(base)
        if p.scheme!="https" and not (p.scheme=="http" and p.hostname in ("127.0.0.1","localhost")):
            raise ValueError("La pasarela solo puede enviar a HTTPS o servidor local de desarrollo")
        if p.username or p.password or p.query or p.fragment:
            raise ValueError("URL de BOSQYN IA inválida")
        if len(token)<32:raise ValueError("BOSQYN_IP_BRIDGE_TOKEN requiere al menos 32 caracteres")
        if not shutil.which("ffmpeg"):raise RuntimeError("Instala ffmpeg en la pasarela local")
        self.base=base.rstrip("/")
        self.token=token
        self.poll=poll
        self.workers={}
        self.tests={}
        self.alive=True
    def handle_test(self,config):
        id=config["id"]
        seq=config["test_seq"]
        if self.tests.get(id)==seq:return
        self.tests[id]=seq
        try:
            source=media_uri(config)
            ok=one_frame(source) is not None
        except (ValueError,RuntimeError,OSError):ok=False
        try:request(self.base,self.token,f"/api/ip-cameras/agent/{id}/test","POST",{"test_seq":seq,"ok":ok})
        except (OSError,HTTPError):pass
    def run_camera(self,config,stop):
        id=config["id"]
        reconnect=2
        audio_last=0.0
        while not stop.is_set():
            try:
                source=media_uri(config)
                cmd=ffmpeg_cmd(source)
                with subprocess.Popen(cmd,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,
                                      stderr=subprocess.DEVNULL) as process:
                    try:
                        for frame in read_jpegs(process.stdout,stop):
                            if stop.is_set():break
                            request(self.base,self.token,f"/api/ip-cameras/agent/{id}/frame",
                                    "POST",frame,binary=True)
                            if config.get("audio_enabled") and time.monotonic()-audio_last>15:
                                audio_last=time.monotonic()
                                # Audio decoding on a separate call; the video reader continues.
                                threading.Thread(target=self.upload_audio,
                                    args=(id,source),daemon=True).start()
                            reconnect=2
                    finally:
                        process.terminate()
                        try:process.wait(timeout=2)
                        except subprocess.TimeoutExpired:process.kill()
            except (HTTPError,URLError,OSError,ValueError,RuntimeError):
                pass
            if not stop.is_set():
                stop.wait(reconnect)
                reconnect=min(30,reconnect*2)
    def upload_audio(self,id,source):
        sample=audio_pcm(source)
        if sample:
            try:request(self.base,self.token,f"/api/ip-cameras/agent/{id}/audio",
                        "POST",sample,binary=True,pcm=True)
            except (OSError,HTTPError,ValueError):pass
    def step(self):
        configs=request(self.base,self.token,"/api/ip-cameras/agent/config")["cameras"]
        by_id={x["id"]:x for x in configs}
        for id,(stop,thread) in list(self.workers.items()):
            conf=by_id.get(id)
            if not conf or conf["desired"]!="on":
                stop.set();thread.join(timeout=.5)
                self.workers.pop(id,None)
        for item in configs:
            id=item["id"]
            if item["test_seq"]>0 and self.tests.get(id)!=item["test_seq"]:
                threading.Thread(target=self.handle_test,args=(item,),daemon=True).start()
            if item["desired"]=="on" and id not in self.workers:
                stop=threading.Event()
                worker=threading.Thread(target=self.run_camera,args=(item,stop),daemon=True)
                self.workers[id]=(stop,worker);worker.start()
    def run(self):
        try:
            while self.alive:
                try:self.step()
                except (OSError,ValueError,KeyError,HTTPError,URLError):
                    pass
                time.sleep(self.poll)
        except KeyboardInterrupt:pass
        finally:
            for stop,thread in self.workers.values():stop.set()

def main():
    parser=argparse.ArgumentParser(description="BOSQYN IA - puente de cámaras LAN a HTTPS")
    parser.add_argument("--url",default=os.getenv("BOSQYN_IP_BRIDGE_URL",""))
    parser.add_argument("--token",default=os.getenv("BOSQYN_IP_BRIDGE_TOKEN",""))
    args=parser.parse_args()
    Bridge(args.url,args.token).run()

if __name__=="__main__":main()
