window.Bosqyn=window.Bosqyn||{};
Bosqyn.operations=(function(){
 const key='bosqyn-monitor-preferences-v1';let prefs={automatic:false,notifications:false,sound:true};
 try{const data=JSON.parse(localStorage.getItem(key)||'null');if(data&&typeof data.automatic==='boolean')prefs.automatic=data.automatic;if(data&&typeof data.notifications==='boolean')prefs.notifications=data.notifications;if(data&&typeof data.sound==='boolean')prefs.sound=data.sound;}catch{}
 let audioContext=null;
 function soundReady(){try{audioContext ||= new (window.AudioContext||window.webkitAudioContext)();audioContext.resume();}catch{}}
 function beep(){if(!prefs.sound)return;try{soundReady();const o=audioContext.createOscillator(),g=audioContext.createGain();o.connect(g);g.connect(audioContext.destination);g.gain.setValueAtTime(.08,audioContext.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+.25);o.frequency.value=740;o.start();o.stop(audioContext.currentTime+.25);}catch{}}
 function save(){try{localStorage.setItem(key,JSON.stringify(prefs));}catch{}}
 function mount(root,getVideo){
  const panel=document.createElement('section');panel.className='bosqyn-operations';
  panel.innerHTML='<div class="bosqyn-monitor-settings"><label><input type="checkbox" data-auto> Guardar indicios visuales automáticamente</label><button class="bosqyn-action" data-notifications>Activar avisos del navegador</button><button class="bosqyn-action" data-system>Comprobar sistema</button></div><p data-operation-status role="status" aria-live="polite">Las alertas requieren sesión administrativa, confianza ≥85 % y tres predicciones consecutivas. No confirman un evento.</p>';
  root.prepend(panel);const message=panel.querySelector('[data-operation-status]'),auto=panel.querySelector('[data-auto]');auto.checked=prefs.automatic;
  let active=true,busy=false,label='',count=0,lastTimestamp=0;const saved=new Map();
  auto.onchange=async()=>{soundReady();if(auto.checked&&!await Bosqyn.auth.ensure('Accede para registrar incidentes automáticos.'))auto.checked=false;prefs.automatic=auto.checked;save();};
  panel.querySelector('[data-notifications]').onclick=async()=>{try{if(!('Notification' in window))throw Error('Este navegador no admite avisos');const permission=await Notification.requestPermission();prefs.notifications=permission==='granted';save();message.textContent=prefs.notifications?'Avisos activados mientras esta página esté abierta.':'Avisos no autorizados; revisa los permisos del navegador.';}catch(e){message.textContent=e.message;}};
  panel.querySelector('[data-system]').onclick=async()=>{try{if(!await Bosqyn.auth.ensure())return;const response=await fetch('/api/operations',{cache:'no-store'}),data=await response.json();if(!response.ok)throw Error(data.error);message.textContent=(data.persistent_storage?'Volumen persistente':'Almacenamiento local')+' · Escritura '+(data.writes_enabled?'habilitada':'deshabilitada')+' · Libre '+Math.round(data.disk_free_bytes/1048576)+' MB · Servidor activo '+data.uptime_seconds+' s';}catch(e){message.textContent=e.message;}};
  async function onDetection(event){
   const d=event.detail||{},name=String(d.className||'').toUpperCase(),time=Number(d.timestamp);
   if(!prefs.automatic||!['HUMO','INCENDIO','TALA'].includes(name)||d.probability<.85||!Number.isFinite(time)||Date.now()-time>3000){count=0;label='';return;}
   count=name===label&&time-lastTimestamp<3000?count+1:1;label=name;lastTimestamp=time;
   if(count<3||busy||Date.now()-(saved.get(name)||0)<60000)return;
   const video=getVideo();if(!video||!video.videoWidth||!active)return;
   busy=true;
   try{
    const authenticated=await Bosqyn.auth.status();if(!active)return;if(!authenticated){message.textContent='Accede como administrador para guardar los indicios automáticos.';saved.set(name,Date.now()-45000);return;}
    const canvas=document.createElement('canvas'),scale=Math.min(1,1280/video.videoWidth);canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
    const response=await fetch('/api/alerts',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Bosqyn-Action':'1'},body:JSON.stringify({source:'VISION_AUTOMATICA',category:name,confidence:d.probability,image_data:canvas.toDataURL('image/jpeg',.8)})});const data=await response.json();if(!response.ok)throw Error(data.error||'No se pudo guardar');saved.set(name,Date.now());if(!active)return;message.textContent=(data.duplicate?'Incidente existente':'Nuevo indicio visual')+' #'+data.id+' · '+name+' · pendiente de revisión';
    if(!data.duplicate)beep();
    if(!data.duplicate&&prefs.notifications&&'Notification'in window&&Notification.permission==='granted')new Notification('BOSQYN AI: indicio de '+name,{body:'Evidencia #'+data.id+' guardada. Requiere revisión humana.',tag:'bosqyn-'+data.id});
   }catch(e){if(active)message.textContent='Guardado automático: '+e.message;saved.set(name,Date.now()-45000);}finally{busy=false;}
  }
  root.addEventListener('bosqyn:visual-detection',onDetection);
  return()=>{active=false;root.removeEventListener('bosqyn:visual-detection',onDetection);};
 }
 return {mount,setSound:value=>{prefs.sound=!!value;save();soundReady();},getSound:()=>prefs.sound};
})();
