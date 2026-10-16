window.Bosqyn=window.Bosqyn||{};Bosqyn.pages=Bosqyn.pages||{};
Bosqyn.pages.monitoreo=function(root){
/* Integración nativa: un menú Monitoreo, dos modos, un solo backend. */
const livePanel=document.createElement('section');
livePanel.id='bosqyn-live-panel';
livePanel.hidden=true;
while(root.firstChild)livePanel.appendChild(root.firstChild);
const dashboard=document.createElement('div');
dashboard.className='bosqyn-satellite-dashboard';
dashboard.innerHTML=`
<style>
.bosqyn-satellite-dashboard{color:#e5f7ec}
.bosqyn-satellite-cards{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:12px}
.bosqyn-satellite-choice{background:#11382b;border:1px solid #255641;border-radius:9px;padding:12px;text-align:left;color:#e8f8ed;cursor:pointer;transition:background .2s}
.bosqyn-satellite-choice[aria-selected="true"]{background:#194635;border-color:#36a773}
.bosqyn-satellite-choice:focus-visible{outline:2px solid #64e6aa}
.bosqyn-satellite-choice .choice-title{display:block;font-size:12px;font-weight:600;margin-bottom:9px}
.bosqyn-satellite-choice .choice-art{display:flex;align-items:center;justify-content:center;background:#061e16;border-radius:7px;height:75px;font-size:25px;color:#4ae4a0}
.bosqyn-satellite-choice .choice-desc{display:block;color:#a5c8b6;font-size:10px;margin-top:8px}
.bosqyn-satellite-center{background:#0c2b21;border:1px solid #173e30;border-radius:10px;padding:13px}
.bosqyn-satellite-center h2{font-size:14px;font-weight:700}
.bosqyn-satellite-heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.bosqyn-satellite-map{min-height:300px;height:48vh;border-radius:8px;background:#164333;overflow:hidden}
.bosqyn-feed-status{display:flex;gap:12px;justify-content:space-between;flex-wrap:wrap;font-size:11px;color:#cce6d6;margin-top:12px}
.bosqyn-source-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px}
.bosqyn-footnote{font-size:10px;color:#92bca6;margin-top:10px}
@media(max-width:640px){.bosqyn-satellite-cards{grid-template-columns:1fr}.bosqyn-satellite-map{height:40vh}}
</style>
<div class="bosqyn-satellite-cards" role="tablist" aria-label="Fuente de monitoreo">
 <button type="button" class="bosqyn-satellite-choice" id="bosqyn-mode-live" role="tab" aria-selected="false" aria-controls="bosqyn-live-panel">
  <span class="choice-title">▣ &nbsp; Monitoreo en vivo</span><span class="choice-art" aria-hidden="true">▣</span><span class="choice-desc">Cámaras / Drones</span>
 </button>
 <button type="button" class="bosqyn-satellite-choice" id="bosqyn-mode-satellite" role="tab" aria-selected="true" aria-controls="bosqyn-satellite-center">
  <span class="choice-title">◈ &nbsp; Monitoreo satelital</span><span class="choice-art" aria-hidden="true">◎</span><span class="choice-desc">NASA FIRMS / NOAA</span>
 </button>
</div>
<section class="bosqyn-satellite-center" id="bosqyn-satellite-center" role="tabpanel">
 <div class="bosqyn-satellite-heading"><h2>Centro de vigilancia satelital</h2><span style="background:#07492c;color:#46e58b;border-radius:15px;padding:4px 10px;font-size:10px">Nuevo módulo</span></div>
 <div id="bosqyn-satellite-map" class="bosqyn-satellite-map" aria-label="Mapa de observaciones térmicas"><div style="padding:55px 10px;text-align:center;color:#a6d8be;font-size:12px">Cargando mapa de focos de calor y observaciones…</div></div>
 <div class="bosqyn-feed-status">
  <span><i class="bosqyn-source-dot" style="background:#fb6749"></i> NASA FIRMS: <b id="bosqyn-nasa-status">consultando</b></span>
  <span><i class="bosqyn-source-dot" style="background:#efbe56"></i> NOAA GOES-19: <b id="bosqyn-noaa-status">consultando</b></span>
  <span><b id="bosqyn-events-count">0</b> observaciones</span>
 </div>
 <p class="bosqyn-footnote">Observaciones periódicas, no detecciones confirmadas ni video en tiempo real. La ausencia de puntos no descarta incendios.</p>
</section>`;
root.append(dashboard,livePanel);
const modeLive=dashboard.querySelector('#bosqyn-mode-live');
const modeSat=dashboard.querySelector('#bosqyn-mode-satellite');
const satCenter=dashboard.querySelector('#bosqyn-satellite-center');
let satelliteMap=null,satelliteLayer=null,satelliteTimer=null,activeSatellite=true,disposed=false;
function selectMode(live){
  activeSatellite=!live;livePanel.hidden=!live;satCenter.hidden=live;
  modeLive.setAttribute('aria-selected',String(live));modeSat.setAttribute('aria-selected',String(!live));
  if(live&&typeof stop==='function'){} 
  if(!live&&satelliteMap)setTimeout(()=>satelliteMap.invalidateSize(),50);
}
modeLive.addEventListener('click',()=>selectMode(true));
modeSat.addEventListener('click',()=>{if(typeof stop==='function')stop();selectMode(false)});
function loadLeaflet(){
 return new Promise((resolve,reject)=>{
  if(window.L)return resolve();
  if(!document.querySelector('#bosqyn-leaflet-css')){
    const css=document.createElement('link');css.id='bosqyn-leaflet-css';css.rel='stylesheet';css.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';document.head.append(css);
  }
  const present=document.querySelector('#bosqyn-leaflet-js');
  if(present){present.addEventListener('load',resolve,{once:true});present.addEventListener('error',reject,{once:true});return;}
  const script=document.createElement('script');script.id='bosqyn-leaflet-js';script.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';script.onload=resolve;script.onerror=reject;document.head.append(script);
 });
}
async function refreshSatellite(){
 if(disposed)return;
 try{
  const [statusResponse,eventResponse]=await Promise.all([fetch('/api/satellite/status'),fetch('/api/satellite/events')]);
  if(!statusResponse.ok||!eventResponse.ok)throw Error('Servicio satelital no disponible');
  const state=await statusResponse.json(),data=await eventResponse.json();
  if(disposed)return;
  dashboard.querySelector('#bosqyn-nasa-status').textContent=state.feeds?.NASA?.status||'sin datos';
  dashboard.querySelector('#bosqyn-noaa-status').textContent=state.feeds?.NOAA?.status||'sin datos';
  dashboard.querySelector('#bosqyn-events-count').textContent=String(data.events?.length||0);
  if(!satelliteMap)return;
  satelliteLayer.clearLayers();
  for(const e of (data.events||[])){
   if(!Number.isFinite(Number(e.lat))||!Number.isFinite(Number(e.lon)))continue;
   const nasa=e.source==='NASA FIRMS';
   const point=window.L.circleMarker([+e.lat,+e.lon],{radius:6,weight:2,color:nasa?'#fc7b49':'#f6d16b',fillOpacity:.7}).addTo(satelliteLayer);
   const detail=document.createElement('div');
   const strong=document.createElement('b');strong.textContent=e.source;detail.append(strong,document.createElement('br'),document.createTextNode(e.time||''));
   point.bindPopup(detail);
  }
 }catch(err){
  if(disposed)return;
  dashboard.querySelector('#bosqyn-nasa-status').textContent='sin conexión';
  dashboard.querySelector('#bosqyn-noaa-status').textContent='sin conexión';
 }
}
loadLeaflet().then(()=>{
 if(disposed)return;
 const mapNode=dashboard.querySelector('#bosqyn-satellite-map');
 mapNode.textContent='';
 satelliteMap=window.L.map(mapNode).setView([-9.5,-76.1],8);
 window.L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{subdomains:'abcd',maxZoom:19,attribution:'&copy; OpenStreetMap contributors &copy; CARTO'}).addTo(satelliteMap);
 satelliteLayer=window.L.layerGroup().addTo(satelliteMap);
 refreshSatellite();
}).catch(()=>{
 const target=dashboard.querySelector('#bosqyn-satellite-map');
 if(!disposed)target.textContent='No se pudo cargar el mapa. Revisa la conexión de internet.';
});
refreshSatellite();
satelliteTimer=setInterval(refreshSatellite,60000);

const button=root.querySelector('#btn-live'),image=root.querySelector('#live-img'),badge=root.querySelector('#live-badge'),soundButton=root.querySelector('#btn-sound');
const captureButton=[...root.querySelectorAll('button')].find(el=>el.textContent.includes('Capturar imagen'));
const status=document.createElement('div');status.className='bosqyn-camera-status';status.setAttribute('role','status');status.textContent='Un solo botón inicia la webcam y su micrófono disponible. Las detecciones requieren verificación.';root.prepend(status);
const audioController=Bosqyn.audio && typeof Bosqyn.audio.mount==='function' ? Bosqyn.audio.mount(root) : null;
const mediaSource=root.querySelector('#combined-source');
const fused=root.querySelector('#multimodal-insight');
let lastVisual=null,lastAudio=null;
function updateJointState(){
  if(!fused)return;
  const recent=Date.now()-10000;
  if(lastVisual?.className?.toLowerCase()==='tala' &&
     lastAudio?.className?.toLowerCase()==='tala' &&
     lastVisual.probability>=.8 && lastAudio.probability>=.8 &&
     lastVisual.timestamp>=recent && lastAudio.timestamp>=recent){
    fused.textContent='Coincidencia de indicios de tala en cámara y audio: priorizar revisión humana. No confirma ilegalidad.';
    fused.classList.add('bosqyn-multimodal-warning');
  }else{
    fused.textContent='Predicciones independientes de cámara y micrófono. Una coincidencia de tala se destacará aquí.';
    fused.classList.remove('bosqyn-multimodal-warning');
  }
}
root.addEventListener('bosqyn:visual-detection',event=>{lastVisual=event.detail;updateJointState();});
root.addEventListener('bosqyn:audio-detection',event=>{lastAudio=event.detail;updateJointState();});
root.addEventListener('bosqyn:audio-stopped',()=>{lastAudio=null;updateJointState();});

let stream=null,video=null,starting=false,sound=true;
async function selectCameraMicrophone(opened){
  const camera=opened.getVideoTracks()[0],mic=opened.getAudioTracks()[0];
  if(!camera||!mic)return 'Solo cámara';
  try{
    const devices=await navigator.mediaDevices.enumerateDevices();
    const videoInfo=devices.find(d=>d.kind==='videoinput'&&d.deviceId===camera.getSettings().deviceId);
    const matched=videoInfo?.groupId && devices.find(d=>d.kind==='audioinput'&&d.groupId===videoInfo.groupId);
    if(!matched)return 'Cámara + micrófono predeterminado';
    if(matched.deviceId===mic.getSettings().deviceId)return 'Webcam con micrófono integrado';
    const other=await navigator.mediaDevices.getUserMedia({video:false,audio:{deviceId:{exact:matched.deviceId},echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    const track=other.getAudioTracks()[0];
    if(!track){other.getTracks().forEach(t=>t.stop());return 'Cámara + micrófono predeterminado';}
    opened.removeTrack(mic);mic.stop();opened.addTrack(track);
    return 'Webcam con micrófono integrado';
  }catch(error){
    console.info('Usando micrófono predeterminado:',error);
    return 'Cámara + micrófono predeterminado';
  }
}

function stop(){lastVisual=null;lastAudio=null;updateJointState();if(audioController?.stopAudio)audioController.stopAudio();if(Bosqyn.vision)Bosqyn.vision.stop();if(stream)stream.getTracks().forEach(track=>track.stop());stream=null;if(video){video.pause();video.srcObject=null;video.remove();video=null}if(image)image.style.display='';if(badge)badge.style.display='none';if(mediaSource)mediaSource.textContent='Cámara y micrófono inactivos';if(button)button.innerHTML=Bosqyn.icons.play+' Iniciar cámara y audio'}
async function start(){if(starting||stream)return;if(!navigator.mediaDevices?.getUserMedia){status.textContent='La webcam requiere HTTPS o localhost.';status.classList.add('bosqyn-camera-error');return}
starting=true;button.disabled=true;
try{
let opened=null,sourceLabel='Webcam + micrófono';
try{
  opened=await navigator.mediaDevices.getUserMedia({video:true,audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
  sourceLabel=await selectCameraMicrophone(opened);
}catch(micError){
  if(opened)opened.getTracks().forEach(t=>t.stop());
  opened=await navigator.mediaDevices.getUserMedia({video:true,audio:false});
  sourceLabel='Solo webcam; pulsa Activar micrófono para añadir audio';
}
if(!root.isConnected){opened.getTracks().forEach(track=>track.stop());return}
stream=opened;video=document.createElement('video');video.className=image.className;video.autoplay=true;video.playsInline=true;video.muted=true;video.style.width='100%';video.style.height='100%';video.style.objectFit='cover';image.after(video);video.srcObject=stream;await video.play();image.style.display='none';if(badge)badge.style.display='';button.innerHTML=Bosqyn.icons.square+' Detener monitoreo';if(mediaSource)mediaSource.textContent=sourceLabel;status.classList.remove('bosqyn-camera-error');status.textContent='Webcam encendida. Iniciando el modelo de visión…';if(Bosqyn.vision)Bosqyn.vision.start(video,root,status);
if(opened.getAudioTracks().some(t=>t.readyState==='live')&&audioController?.startWithStream){
  audioController.startWithStream(opened).then(ok=>{
    if(!ok&&stream===opened){opened.getAudioTracks().forEach(t=>t.stop());if(mediaSource)mediaSource.textContent='Solo webcam · micrófono no habilitado';}
  }).catch(error=>console.error('Detector acústico:',error));
}
}catch(err){stop();status.textContent='No se pudo abrir la webcam. Revisa permisos.';status.classList.add('bosqyn-camera-error');console.error(err)}finally{starting=false;button.disabled=false}}
if(button){button.innerHTML=Bosqyn.icons.play+' Iniciar cámara y audio';button.addEventListener('click',()=>{if(stream){stop();status.classList.remove('bosqyn-camera-error');status.textContent='Webcam y micrófono detenidos; inferencia interrumpida.';if(Bosqyn.vision)Bosqyn.vision.reset(root)}else start()})}
if(badge)badge.style.display='none';

if(captureButton)captureButton.addEventListener('click',async()=>{
  if(!stream||!video||!video.videoWidth){status.textContent='Inicia la webcam para registrar una captura.';status.classList.add('bosqyn-camera-error');return}
  if(!await Bosqyn.auth.ensure('Inicia sesión como administrador para guardar la captura en BOSQYN AI.')){
    status.textContent='Captura cancelada: solo los administradores pueden guardar evidencias.';
    return;
  }
  const ratio=Math.min(1,1280/Math.max(video.videoWidth,video.videoHeight));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(video.videoWidth*ratio));
  canvas.height=Math.max(1,Math.round(video.videoHeight*ratio));
  canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
  const image_data=canvas.toDataURL('image/jpeg',0.82);
  captureButton.disabled=true;
  status.classList.remove('bosqyn-camera-error');status.textContent='Guardando captura manual en Python...';
  try{
    const response=await fetch('/api/alerts',{method:'POST',headers:{'Content-Type':'application/json','X-Bosqyn-Action':'1'},credentials:'same-origin',body:JSON.stringify({category:'REVISION_MANUAL',image_data})});
    const result=await response.json();
    if(!response.ok)throw Error(result.error||'Error de almacenamiento');
    status.textContent='Captura #'+result.id+' guardada en SQLite como REVISIÓN MANUAL. Consúltala en Alertas.';
  }catch(error){
    status.textContent='No se pudo guardar: '+error.message+'. Revisa la sesión de administrador y el almacenamiento.';status.classList.add('bosqyn-camera-error');
    console.error('BOSQYN AI',error);
  }finally{captureButton.disabled=false}
});
if(soundButton)soundButton.addEventListener('click',()=>{sound=!sound;let knob=soundButton.firstElementChild;soundButton.classList.toggle('bg-[#22c55e]',sound);soundButton.classList.toggle('bg-white/15',!sound);if(knob){knob.classList.toggle('left-[14px]',sound);knob.classList.toggle('left-[2px]',!sound)}status.textContent='Sonido '+(sound?'activado':'desactivado')+'. Las alertas automáticas están pendientes.'});
// Se limpian las pistas de video y audio al abandonar Monitoreo.
return function(){disposed=true;if(satelliteTimer)clearInterval(satelliteTimer);if(satelliteMap)satelliteMap.remove();stop();if(typeof audioController==='function')audioController();};
};