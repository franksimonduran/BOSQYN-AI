window.Bosqyn=window.Bosqyn||{};Bosqyn.pages=Bosqyn.pages||{};
Bosqyn.pages.monitoreo=function(root){
const button=root.querySelector('#btn-live'),image=root.querySelector('#live-img'),badge=root.querySelector('#live-badge'),soundButton=root.querySelector('#btn-sound');
const captureButton=[...root.querySelectorAll('button')].find(el=>el.textContent.includes('Capturar imagen'));
const status=document.createElement('div');status.className='bosqyn-camera-status';status.setAttribute('role','status');status.textContent='Vista de ejemplo. Pulsa Iniciar cámara para usar la webcam sin predicción de IA.';root.prepend(status);
let stream=null,video=null,starting=false,sound=true;
function stop(){if(stream)stream.getTracks().forEach(track=>track.stop());stream=null;if(video){video.pause();video.srcObject=null;video.remove();video=null}if(image)image.style.display='';if(badge)badge.style.display='none';if(button)button.innerHTML=Bosqyn.icons.play+' Iniciar cámara'}
async function start(){if(starting||stream)return;if(!navigator.mediaDevices?.getUserMedia){status.textContent='La webcam requiere HTTPS o localhost.';return}
starting=true;button.disabled=true;
try{let opened=await navigator.mediaDevices.getUserMedia({video:true,audio:false});if(!root.isConnected){opened.getTracks().forEach(track=>track.stop());return}
stream=opened;video=document.createElement('video');video.className=image.className;video.autoplay=true;video.playsInline=true;video.muted=true;video.style.width='100%';video.style.height='100%';video.style.objectFit='cover';image.after(video);video.srcObject=stream;await video.play();image.style.display='none';if(badge)badge.style.display='';button.innerHTML=Bosqyn.icons.square+' Detener cámara';status.textContent='Webcam encendida. Los porcentajes de IA visibles siguen siendo ejemplos.'
}catch(err){stop();status.textContent='No se pudo abrir la webcam. Revisa permisos.';console.error(err)}finally{starting=false;button.disabled=false}}
if(button){button.innerHTML=Bosqyn.icons.play+' Iniciar cámara';button.addEventListener('click',()=>{if(stream){stop();status.textContent='Cámara detenida; mostrando imagen de ejemplo.'}else start()})}
if(badge)badge.style.display='none';
if(captureButton)captureButton.addEventListener('click',()=>{if(!stream||!video||!video.videoWidth){status.textContent='Inicia la webcam para capturar una imagen.';return}let canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0);canvas.toBlob(blob=>{if(!blob)return;let url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='bosqyn-captura-'+Date.now()+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)},'image/png');status.textContent='Captura solicitada. Todavía no existe historial persistente.'});
if(soundButton)soundButton.addEventListener('click',()=>{sound=!sound;let knob=soundButton.firstElementChild;soundButton.classList.toggle('bg-[#22c55e]',sound);soundButton.classList.toggle('bg-white/15',!sound);if(knob){knob.classList.toggle('left-[14px]',sound);knob.classList.toggle('left-[2px]',!sound)}status.textContent='Sonido '+(sound?'activado':'desactivado')+'. Las alertas automáticas están pendientes.'});
return stop;
};