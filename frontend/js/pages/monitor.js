window.Bosqyn=window.Bosqyn||{};Bosqyn.pages=Bosqyn.pages||{};
Bosqyn.pages.monitoreo=function(root){
const button=root.querySelector('#btn-live'),image=root.querySelector('#live-img'),badge=root.querySelector('#live-badge'),soundButton=root.querySelector('#btn-sound');
const captureButton=[...root.querySelectorAll('button')].find(el=>el.textContent.includes('Capturar imagen'));
const status=document.createElement('div');status.className='bosqyn-camera-status';status.setAttribute('role','status');status.textContent='Puedes activar la webcam y el micrófono por separado o al mismo tiempo. Las detecciones requieren verificación.';root.prepend(status);
let stream=null,video=null,starting=false,sound=true;
function stop(){if(Bosqyn.vision)Bosqyn.vision.stop();if(stream)stream.getTracks().forEach(track=>track.stop());stream=null;if(video){video.pause();video.srcObject=null;video.remove();video=null}if(image)image.style.display='';if(badge)badge.style.display='none';if(button)button.innerHTML=Bosqyn.icons.play+' Iniciar cámara'}
async function start(){if(starting||stream)return;if(!navigator.mediaDevices?.getUserMedia){status.textContent='La webcam requiere HTTPS o localhost.';status.classList.add('bosqyn-camera-error');return}
starting=true;button.disabled=true;
try{let opened=await navigator.mediaDevices.getUserMedia({video:true,audio:false});if(!root.isConnected){opened.getTracks().forEach(track=>track.stop());return}
stream=opened;video=document.createElement('video');video.className=image.className;video.autoplay=true;video.playsInline=true;video.muted=true;video.style.width='100%';video.style.height='100%';video.style.objectFit='cover';image.after(video);video.srcObject=stream;await video.play();image.style.display='none';if(badge)badge.style.display='';button.innerHTML=Bosqyn.icons.square+' Detener cámara';status.classList.remove('bosqyn-camera-error');status.textContent='Webcam encendida. Iniciando el modelo de visión…';if(Bosqyn.vision)Bosqyn.vision.start(video,root,status)
}catch(err){stop();status.textContent='No se pudo abrir la webcam. Revisa permisos.';status.classList.add('bosqyn-camera-error');console.error(err)}finally{starting=false;button.disabled=false}}
if(button){button.innerHTML=Bosqyn.icons.play+' Iniciar cámara';button.addEventListener('click',()=>{if(stream){stop();status.classList.remove('bosqyn-camera-error');status.textContent='Cámara detenida; inferencia interrumpida.';if(Bosqyn.vision)Bosqyn.vision.reset(root)}else start()})}
if(badge)badge.style.display='none';

if(captureButton)captureButton.addEventListener('click',async()=>{
  if(!stream||!video||!video.videoWidth){status.textContent='Inicia la webcam para registrar una captura.';status.classList.add('bosqyn-camera-error');return}
  const ratio=Math.min(1,1280/Math.max(video.videoWidth,video.videoHeight));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(video.videoWidth*ratio));
  canvas.height=Math.max(1,Math.round(video.videoHeight*ratio));
  canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
  const image_data=canvas.toDataURL('image/jpeg',0.82);
  captureButton.disabled=true;
  status.classList.remove('bosqyn-camera-error');status.textContent='Guardando captura manual en Python...';
  try{
    const response=await fetch('/api/alerts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category:'REVISION_MANUAL',image_data})});
    const result=await response.json();
    if(!response.ok)throw Error(result.error||'Error de almacenamiento');
    status.textContent='Captura #'+result.id+' guardada en SQLite como REVISIÓN MANUAL. Consúltala en Alertas.';
  }catch(error){
    status.textContent='No se pudo guardar: '+error.message+'. El sitio público de Railway no permite escritura.';status.classList.add('bosqyn-camera-error');
    console.error('BOSQYN AI',error);
  }finally{captureButton.disabled=false}
});
if(soundButton)soundButton.addEventListener('click',()=>{sound=!sound;let knob=soundButton.firstElementChild;soundButton.classList.toggle('bg-[#22c55e]',sound);soundButton.classList.toggle('bg-white/15',!sound);if(knob){knob.classList.toggle('left-[14px]',sound);knob.classList.toggle('left-[2px]',!sound)}status.textContent='Sonido '+(sound?'activado':'desactivado')+'. Las alertas automáticas están pendientes.'});
// La vista integrada permite iniciar cámara y micrófono en paralelo.
// Ambos recursos se cierran al abandonar Monitoreo.
const stopAudio = Bosqyn.audio && typeof Bosqyn.audio.mount === 'function' ? Bosqyn.audio.mount(root) : null;
return function(){ if(typeof stopAudio === 'function') stopAudio(); stop(); };
};