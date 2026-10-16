window.Bosqyn=window.Bosqyn||{};Bosqyn.pages=Bosqyn.pages||{};
Bosqyn.pages.monitoreo=function(root){
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
return function(){stop();if(typeof audioController==='function')audioController();};
};