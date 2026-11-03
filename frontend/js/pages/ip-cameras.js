/* BOSQYN IA · IP cameras using an authenticated outbound LAN bridge.
   This module is independent from the original webcam and satellite maps. */
window.Bosqyn=window.Bosqyn||{};
Bosqyn.ipCameras=(()=>{
"use strict";
let mounted=null,panel=null,timer=null,active=false,visionId=null,visionVideo=null,recorder=null,recordPieces=[];
const nodes=new Map();
const $=id=>panel?.querySelector("#"+id);
async function api(path,method="GET",body){
 const opts={method,credentials:"same-origin",cache:"no-store"};
 if(method!=="GET"){opts.headers={"Content-Type":"application/json","X-Bosqyn-Action":"1"};opts.body=JSON.stringify(body||{});}
 const response=await fetch(path,opts);
 let result={};try{result=await response.json();}catch{}
 if(!response.ok)throw Error(result.error||"HTTP "+response.status);
 return result;
}
function status(message){if($("ip-status"))$("ip-status").textContent=message;}
function mk(tag,text,cls){
 const node=document.createElement(tag);
 if(text!==undefined)node.textContent=text;
 if(cls)node.className=cls;
 return node;
}
function fmt(stamp){
 if(!stamp)return "Sin datos";
 const date=new Date(stamp);
 return Number.isFinite(date.getTime())?date.toLocaleString("es-PE"):"Sin fecha";
}
async function admin(){
 if(!await Bosqyn.auth?.ensureAdmin("Solo el administrador puede acceder a las cámaras IP."))return false;
 return true;
}
function stopVision(){
 if(visionId!==null)Bosqyn.vision?.stop();
 visionId=null;
 if(visionVideo){visionVideo.pause();visionVideo.srcObject?.getTracks().forEach(t=>t.stop());visionVideo.remove();visionVideo=null;}
}
function stopRecording(){
 if(recorder&&recorder.state!=="inactive")recorder.stop();
 recorder=null;
}
function card(camera){
 const id=camera.id;
 const item=mk("article",undefined,"bosqyn-ip-card");
 item.dataset.id=String(id);
 const head=mk("div",undefined,"bosqyn-ip-head");
 const titleWrap=mk("div",undefined,"bosqyn-ip-name");
 const title=mk("strong",camera.name);
 const subtitle=mk("span",camera.protocol==="MOVIL/HTTPS"?"CELULAR WI-FI · HTTPS":"CÁMARA IP · RED LOCAL","bosqyn-ip-source");
 titleWrap.append(title,subtitle);
 const tag=mk("span","Sin señal","bosqyn-ip-tag");
 head.append(titleWrap,tag);
 const frame=mk("div",undefined,"bosqyn-ip-screen");
 const frameDecor=mk("div",undefined,"bosqyn-ip-screen-label");
 frameDecor.innerHTML='<span class="bosqyn-ip-screen-pulse" aria-hidden="true"></span> BOSQYN AI · VIGILANCIA FORESTAL';
 frame.append(frameDecor);
 const image=mk("img");image.alt="Fotogramas de "+camera.name;image.hidden=true;
 const emptyWrap=mk("div",undefined,"bosqyn-ip-empty-screen");
 emptyWrap.innerHTML='<span class="bosqyn-ip-video-icon" aria-hidden="true">▣</span><strong>Esperando señal</strong>';
 const empty=mk("p","Sin conexión con la pasarela local");
 emptyWrap.append(empty);
 frame.append(image,emptyWrap);
 const meta=mk("p",camera.protocol+" · "+camera.kind+" · Puerto "+camera.port,"bosqyn-ip-muted");
 const test=mk("p","Prueba pendiente de solicitar","bosqyn-ip-muted");
 const audio=mk("p","Audio en espera","bosqyn-ip-muted");
 const detailsStatus=mk("div",undefined,"bosqyn-ip-ai-status");
 const visualStat=mk("div",undefined,"bosqyn-ip-ai-stat");
 visualStat.innerHTML='<span class="bosqyn-ip-ai-icon" aria-hidden="true">◎</span><span><small>IA VISUAL</small><strong>En espera</strong></span>';
 const soundStat=mk("div",undefined,"bosqyn-ip-ai-stat");
 soundStat.innerHTML='<span class="bosqyn-ip-ai-icon" aria-hidden="true">◉</span><span><small>IA ACÚSTICA</small></span>';
 soundStat.lastElementChild.append(audio);
 detailsStatus.append(visualStat,soundStat);
 const detection=mk("div",undefined,"bosqyn-ip-detection");
 detection.innerHTML='<div><img data-vision-logo src="img/deteccion/Bosque.png" alt="" width="35" height="35"/>'+
   '<strong data-vision-class>ESPERANDO IA</strong> <b data-vision-confidence>--</b></div>'+
   '<p data-vision-detail>Clasificador detenido</p><span data-vision-warning>SIN ANÁLISIS</span>'+
   '<div class="bosqyn-dominant-progress"><span data-vision-progress></span></div>';
 const buttons=mk("div",undefined,"bosqyn-ip-buttons");
 const secondary=mk("details",undefined,"bosqyn-ip-secondary");
 secondary.innerHTML='<summary>Más opciones <span aria-hidden="true">⌄</span></summary>';
 const secondaryButtons=mk("div",undefined,"bosqyn-ip-secondary-buttons");
 secondary.append(secondaryButtons);
 const labels=[
  ["test","Probar conexión"],["connect","Conectar cámara"],["disconnect","Desconectar"],
  ["capture","Capturar foto"],["ai","IA visual"],["fullscreen","Pantalla completa"],
  ["record","Grabar video"],["delete","Eliminar"]
 ];
 for(const [action,label] of labels){
   const button=mk("button",label);button.type="button";button.dataset.action=action;
   (["connect","disconnect","ai","capture"].includes(action)?buttons:secondaryButtons).append(button);
 }
 const modelStatus=mk("p","IA en espera","bosqyn-ip-muted");
 const canvas=document.createElement("canvas");canvas.hidden=true;
 item.append(head,frame,meta,detailsStatus,detection,buttons,secondary,test,modelStatus,canvas);
 let current=null,lastFrame=0;
 const video=()=>visionVideo;
 function draw(){
   if(!image.complete||!image.naturalWidth)return;
   const width=Math.min(image.naturalWidth,960);
   if(!width)return;
   canvas.width=width;canvas.height=Math.round(image.naturalHeight*width/image.naturalWidth);
   canvas.getContext("2d").drawImage(image,0,0,canvas.width,canvas.height);
 }
 image.addEventListener("load",draw);
 const handleAction=async event=>{
   const button=event.target.closest("[data-action]");
   if(!button)return;
   const action=button.dataset.action;
   if(action==="fullscreen"){frame.requestFullscreen?.();return;}
   if(action==="ai"){
     if(visionId===id){stopVision();modelStatus.textContent="IA detenida";return;}
     if(!current?.connected||!canvas.captureStream){status("Se necesita video activo y un navegador con canvas.captureStream.");return;}
     stopVision();
     if(canvas.width===0){status("Espera el primer fotograma de la cámara.");return;}
     const movie=document.createElement("video");
     movie.muted=true;movie.playsInline=true;movie.autoplay=true;
     movie.srcObject=canvas.captureStream(3);movie.hidden=true;item.append(movie);
     try{await movie.play();visionVideo=movie;visionId=id;Bosqyn.vision.start(movie,detection,modelStatus);}
     catch{movie.srcObject?.getTracks().forEach(t=>t.stop());movie.remove();status("No se pudo iniciar IA visual.");}
     return;
   }
   if(action==="record"){
     if(recorder?.state==="recording"){stopRecording();button.textContent="Grabar video";return;}
     if(!current?.connected||!canvas.captureStream||!window.MediaRecorder||!canvas.width){
       status("Grabación no disponible sin cámara conectada y MediaRecorder.");return;
     }
     try{
       const stream=canvas.captureStream(3);
       recordPieces=[];recorder=new MediaRecorder(stream);
       recorder.ondataavailable=e=>{if(e.data.size)recordPieces.push(e.data);};
       recorder.onstop=()=>{
         stream.getTracks().forEach(t=>t.stop());
         const data=new Blob(recordPieces,{type:recorder?.mimeType||"video/webm"});
         if(!data.size)return;
         const url=URL.createObjectURL(data),a=document.createElement("a");
         a.href=url;a.download="bosqyn-camara-"+id+"-"+Date.now()+".webm";a.click();
         setTimeout(()=>URL.revokeObjectURL(url),2000);
       };
       recorder.start(1000);button.textContent="Detener grabación";
       status("Grabación local iniciada; el archivo se descargará en este navegador.");
     }catch(err){status("No se pudo iniciar grabación: "+err.message);}
     return;
   }
   if(!await admin())return;
   if(action==="connect" && current?.protocol==="MOVIL/HTTPS" && !current.connected){
     status("Para conectar esta cámara, abre BOSQYN AI desde el celular emisor y pulsa «Transmitir por Wi-Fi». El botón Conectar no activa remotamente la cámara del teléfono.");
     panel?.querySelector("#ip-mobile-stream")?.scrollIntoView({behavior:"smooth",block:"center"});
     return;
   }
   button.disabled=true;
   try{
     if(action==="delete"){
       if(!window.confirm("¿Eliminar "+camera.name+"? Se perderá su configuración cifrada."))return;
       await api("/api/ip-cameras/"+id,"DELETE");
       if(visionId===id)stopVision();
       item.remove();nodes.delete(id);status("Cámara eliminada.");
     }else if(action==="capture"){
       const result=await api("/api/ip-cameras/"+id+"/capture","POST",{});
       status("Evidencia #"+result.alert.id+" guardada en Alertas para revisión humana.");
     }else{
       const result=await api("/api/ip-cameras/"+id+"/action","POST",{action});
       status(action==="test"?"Prueba solicitada a la pasarela local.":action==="connect"?
          "Conexión solicitada. La cámara IP privada necesita una pasarela local; para emitir desde el celular conectado a Wi-Fi pulsa «Transmitir por Wi-Fi».":
          "Cámara desconectada.");
       if(action==="disconnect"){if(visionId===id)stopVision();stopRecording();}
       update(result.camera);
     }
   }catch(err){status(err.message);}
   finally{button.disabled=false;}
 };
 buttons.addEventListener("click",handleAction);
 secondaryButtons.addEventListener("click",handleAction);
 function update(c){
   current=c;
   title.textContent=c.name;
   subtitle.textContent=c.protocol==="MOVIL/HTTPS"?"CELULAR WI-FI · HTTPS":"CÁMARA IP · RED LOCAL";
   const mobile=c.protocol==="MOVIL/HTTPS";
   tag.textContent=c.connected?"Transmitiendo":mobile?"Esperando celular":c.desired==="on"?"Sin señal / reconectando":"Desconectada";
   tag.classList.toggle("is-online",!!c.connected);
   empty.textContent=mobile
     ?"Sin imágenes del celular. En ese teléfono abre BOSQYN AI y pulsa «Transmitir por Wi-Fi»."
     : "Sin conexión con la pasarela local. Las cámaras con dirección 192.168.x.x necesitan la pasarela local de BOSQYN.";
   meta.textContent=(mobile?"Celular Wi-Fi · HTTPS · Sin pasarela":"Cámara IP local · "+c.protocol+" · Puerto "+c.port)+
     " · Última imagen: "+fmt(c.last_frame_at);
   const connectButton=buttons.querySelector('[data-action="connect"]');
   if(connectButton){
     connectButton.textContent=mobile?"Cómo activar en el celular":"Conectar cámara IP";
     connectButton.title=mobile?"Inicia la transmisión desde el teléfono que tiene la cámara":"Requiere una pasarela local activa";
   }
   test.textContent=c.protocol==="MOVIL/HTTPS"?"Conexión: transmisión segura desde navegador":
     "Prueba: "+(c.last_test?.status||"no realizada");
   const testButton=buttons.querySelector('[data-action="test"]');
   if(testButton){testButton.disabled=c.protocol==="MOVIL/HTTPS";testButton.title=c.protocol==="MOVIL/HTTPS"?"La prueba se hace enviando imágenes desde el celular":"";}
   visualStat.querySelector("strong").textContent=visionId===id?"Analizando":c.connected?"Disponible":"En espera";
   item.classList.toggle("is-connected",!!c.connected);
   audio.textContent=c.audio_result?
     "Audio "+c.audio_result.class+" "+Math.round(Number(c.audio_result.confidence||0)*100)+
       "% · clase original "+c.audio_result.original_class:
     (c.audio_enabled?"Audio: habilitado; esperando clasificador":"Audio: desactivado");
   emptyWrap.hidden=!!c.connected;
   image.hidden=!c.connected;
   const connectBtn=buttons.querySelector('[data-action="connect"]');
   const disconnectBtn=buttons.querySelector('[data-action="disconnect"]');
   if(connectBtn)connectBtn.hidden=!!c.connected;
   if(disconnectBtn)disconnectBtn.hidden=!c.connected;
   buttons.querySelector('[data-action="ai"]').disabled=!c.connected;
   buttons.querySelector('[data-action="capture"]').disabled=!c.connected;
   if(!c.connected){
     image.removeAttribute("src");
     if(visionId===id)stopVision();
     return;
   }
   if(Date.now()-lastFrame>1000){
     lastFrame=Date.now();
     image.src="/api/ip-cameras/"+id+"/snapshot?t="+lastFrame;
   }
 }
 return {item,update};
}
function render(items){
 if(!panel)return;
 const area=$("ip-grid"),ids=new Set(items.map(c=>c.id));
 for(const [id,node] of nodes)if(!ids.has(id)){
   node.item.remove();nodes.delete(id);
 }
 for(const camera of items){
   let node=nodes.get(camera.id);
   if(!node){node=card(camera);nodes.set(camera.id,node);area.append(node.item);}
   node.update(camera);
 }
 const total=$("ip-count-total"),connected=$("ip-count-online"),activity=$("ip-count-events");
 if(total)total.textContent=String(items.length).padStart(2,"0");
 if(connected)connected.textContent=String(items.filter(c=>c.connected).length).padStart(2,"0");
 if(!items.length&& !area.querySelector("[data-ip-empty]")){
   const hint=mk("p","Sin cámaras registradas. Añade una cámara IP para comenzar.","bosqyn-ip-muted");
   hint.dataset.ipEmpty="1";area.append(hint);
 }else if(items.length)area.querySelector("[data-ip-empty]")?.remove();
}
async function refresh(){
 if(!active)return;
 // El listado requiere administrador: no consultar continuamente con sesión invitada.
 if(Bosqyn.auth?.role()!=="admin"){
   render([]);
   $("ip-events")?.replaceChildren();
   status("Inicia sesión como administrador para gestionar cámaras IP.");
   return;
 }
 try{
   const [cameras,history]=await Promise.all([api("/api/ip-cameras"),api("/api/ip-cameras/events")]);
   if(!active)return;
   render(cameras.items||[]);
   const events=$("ip-events");
   events.replaceChildren();
   const historyItems=(history.items||[]);
   const activity=$("ip-count-events");
   if(activity)activity.textContent=String(historyItems.length).padStart(2,"0");
   if(!historyItems.length){
     const placeholder=mk("p","Todavía no hay eventos de cámaras registrados. Aquí aparecerán conexiones y detecciones reales.","bosqyn-ip-no-events");
     events.append(placeholder);
   }
   for(const e of historyItems.slice(0,10)){
     const line=mk("p",fmt(e.occurred_at)+" · "+e.camera_name+" · "+e.category+
       (e.confidence===null?"":" · "+Math.round(e.confidence*100)+"%"));
     events.append(line);
   }
 }catch(err){
   if(active)status("No se pudo consultar las cámaras: "+err.message);
 }
}
function mount(dashboard,stopWebcam){
 const tabs=dashboard.querySelector(".bosqyn-satellite-cards"),
       live=dashboard.querySelector("#bosqyn-live-panel")||dashboard.parentElement.querySelector("#bosqyn-live-panel"),
       satellite=dashboard.querySelector("#bosqyn-satellite-center"),
       tabLive=dashboard.querySelector("#bosqyn-mode-live"),
       tabSat=dashboard.querySelector("#bosqyn-mode-satellite");
 if(!tabs||!satellite)return ()=>{};
 active=true;
 const tab=mk("button",undefined,"bosqyn-satellite-choice");
 tab.type="button";tab.id="bosqyn-mode-ip";tab.setAttribute("role","tab");
 tab.setAttribute("aria-selected","false");
 tab.innerHTML='<span class="choice-title">◉ &nbsp; Cámaras IP</span>'+
 '<span class="choice-art" aria-hidden="true">▤</span>'+
 '<span class="choice-desc">Android · RTSP · MJPEG · ONVIF</span>';
 tabs.append(tab);tabs.style.gridTemplateColumns="repeat(3,minmax(0,1fr))";
 panel=mk("section",undefined,"bosqyn-ip-panel bosqyn-satellite-center");
 panel.hidden=true;panel.id="bosqyn-ip-panel";
 panel.innerHTML=
  '<header class="bosqyn-ip-dashboard-head"><div class="bosqyn-ip-heading-kicker">BOSQYN AI &nbsp; / &nbsp; CENTRO DE VIGILANCIA</div>'+
   '<div class="bosqyn-ip-toolbar"><div><h2>Centro de Cámaras <span>Inteligentes</span></h2>'+
   '<p>Monitoreo visual y acústico forestal · Hasta 24 registradas, 4 simultáneas</p></div>'+
   '<span class="bosqyn-ip-dashboard-mark" aria-hidden="true">▣</span></div>'+
   '<div class="bosqyn-ip-kpis" aria-label="Resumen de cámaras">'+
    '<div class="bosqyn-ip-kpi"><span>◫</span><strong id="ip-count-total">00</strong><small>Registradas</small></div>'+
    '<div class="bosqyn-ip-kpi"><span>◉</span><strong id="ip-count-online">00</strong><small>En línea</small></div>'+
    '<div class="bosqyn-ip-kpi"><span>◎</span><strong id="ip-count-events">00</strong><small>Eventos recientes</small></div>'+
   '</div></header>'+
  '<section class="bosqyn-ip-onboarding"><div class="bosqyn-ip-onboarding-head"><div><span class="bosqyn-ip-section-number">01 / CONECTIVIDAD</span><h3>Conectar un dispositivo</h3>'+
   '<p>Elige cómo deseas llevar la señal a BOSQYN AI.</p></div></div>'+
   '<div class="bosqyn-ip-methods"><button id="ip-show-mobile" type="button" class="bosqyn-ip-method is-active" aria-pressed="true" aria-controls="ip-mobile-stream">'+
    '<span class="bosqyn-ip-method-icon">▯</span><strong>Celular por Wi-Fi</strong><small>Sin IP · Transmisión HTTPS</small></button>'+
    '<button id="ip-add-camera" type="button" class="bosqyn-ip-method" aria-controls="ip-form" aria-expanded="false">'+
    '<span class="bosqyn-ip-method-icon">▣</span><strong>Cámara IP local</strong><small>RTSP · MJPEG · ONVIF</small></button></div></section>'+
  '<section id="ip-mobile-stream" class="bosqyn-mobile-stream">'+
    '<div class="bosqyn-ip-steps"><span class="is-current">01 · Red Wi-Fi</span><span>02 · Permisos</span><span>03 · Vista previa</span><span>04 · Transmisión</span></div>'+
    '<div class="bosqyn-mobile-stream-top"><div><h3>Conectar celular por Wi-Fi</h3>'+
    '<p>Usa la cámara de este teléfono mediante una red Wi-Fi con Internet. No necesita IP ni computadora intermediaria.</p></div>'+
    '<div class="bosqyn-mobile-actions"><button type="button" id="ip-mobile-start">Transmitir por Wi-Fi</button>'+
    '<button type="button" id="ip-mobile-stop" hidden>Detener transmisión</button></div></div>'+
    '<label class="bosqyn-mobile-wifi-confirm"><input type="checkbox" id="ip-mobile-wifi-confirm"> Confirmo que estoy conectado a Wi-Fi y desactivé los datos móviles</label>'+ 
    '<video id="ip-mobile-preview" autoplay muted playsinline aria-label="Vista previa de cámara móvil"></video>'+
    '<label class="bosqyn-mobile-audio-option"><input type="checkbox" id="ip-mobile-audio"> Transmitir también el micrófono (análisis de sonidos forestales)</label>'+
    '<p id="ip-mobile-notice" role="status">Usa este botón desde el teléfono emisor. Para ver las imágenes en otro equipo, deja abierta esta página en el celular y entra a Monitoreo desde el segundo dispositivo.</p>'+
    '<p class="bosqyn-ip-muted">Envía aproximadamente una imagen por segundo mediante HTTPS. No necesitas introducir una IP 192.168.x.x para este modo. El audio es opcional y depende del modelo del servidor.</p>'+
   '</section>'+
  '<form id="ip-form" class="bosqyn-ip-form bosqyn-ip-quick-form" hidden>'+
   '<p class="bosqyn-ip-intro">Solo para cámaras IP dentro de una red local con pasarela activa. Si usas Wi-Fi con acceso a Internet, utiliza el botón «Transmitir por Wi-Fi» de arriba.</p>'+
   '<label class="bosqyn-ip-url-field">Enlace de cámara IP<input name="url" required maxlength="1024" inputmode="url" placeholder="http://192.168.1.100:8080/video" autocomplete="off"></label>'+
   '<label class="bosqyn-ip-name-field">Nombre (opcional)<input name="name" maxlength="80" placeholder="Cámara forestal 01"></label>'+
   '<details class="bosqyn-ip-advanced"><summary>Configuración avanzada (opcional)</summary><div class="bosqyn-ip-advanced-grid">'+
     '<label>Dispositivo<select name="kind"><option value="telefono">Teléfono Android</option><option value="camara_ip">Cámara IP</option><option value="seguridad">Seguridad</option></select></label>'+
     '<label>Protocolo<select name="protocol"><option value="auto">Automático según enlace</option><option>HTTP/MJPEG</option><option>RTSP</option><option>ONVIF</option></select></label>'+
     '<label>Usuario<input name="username" autocomplete="off" maxlength="120" placeholder="Solo si la cámara lo exige"></label>'+
     '<label>Contraseña<input name="password" type="password" autocomplete="new-password" maxlength="200" placeholder="Solo si la cámara lo exige"></label>'+
     '<label>Umbral acústico<input name="threshold" type="number" min=".5" max=".99" step=".01" value=".85"></label>'+
     '<label class="bosqyn-ip-check"><input type="checkbox" name="audio_enabled"> Analizar audio (si la cámara lo transmite)</label>'+
   '</div></details>'+
   '<div class="bosqyn-ip-form-actions"><button type="submit">Guardar y conectar</button><button type="button" id="ip-cancel-camera" class="bosqyn-ip-cancel">Cancelar</button></div>'+
   '<p class="bosqyn-ip-form-note">Se necesita acceso administrador y una pasarela local activa en la misma red que la cámara. Nunca compartas contraseñas en el enlace.</p>'+
  '</form>'+
  '<p id="ip-status" class="bosqyn-ip-muted" role="status">Accede como administrador para añadir cámaras.</p>'+
  '<div class="bosqyn-ip-section-heading"><div><span class="bosqyn-ip-section-number">02 / DISPOSITIVOS</span><h3>Cámaras registradas</h3></div><span class="bosqyn-ip-device-count">Panel de vigilancia</span></div>'+
  '<div id="ip-grid" class="bosqyn-ip-grid"></div>'+
  '<details class="bosqyn-ip-history"><summary>Historial de conexiones y eventos</summary><div id="ip-events" class="bosqyn-ip-events"></div></details>'+
  '<p class="bosqyn-ip-muted">Detecciones sujetas a verificación humana.</p>';
 satellite.after(panel);
 const onEnter=()=>{
   stopWebcam?.();
   if(live)live.hidden=true;
   satellite.hidden=true;panel.hidden=false;
   tab.setAttribute("aria-selected","true");
   tabLive?.setAttribute("aria-selected","false");
   tabSat?.setAttribute("aria-selected","false");
   refresh();
 };
 tab.onclick=onEnter;
 const onOther=()=>{panel.hidden=true;tab.setAttribute("aria-selected","false");stopVision();stopRecording();};
 tabLive?.addEventListener("click",onOther);tabSat?.addEventListener("click",onOther);
 const onAuth=()=>{if(!panel.hidden)refresh();};
 window.addEventListener("bosqyn:auth-changed",onAuth);
 const mobileCleanup=Bosqyn.mobileStream?.mount(panel,refresh);
 const form=$("ip-form");
 const addButton=$("ip-add-camera");
 const toggleForm=show=>{
   form.hidden=!show;
   addButton.setAttribute("aria-expanded",String(show));
   const mobileSection=$("ip-mobile-stream"),mobileChoice=$("ip-show-mobile");
   addButton.classList.toggle("is-active",show);
   mobileChoice.classList.toggle("is-active",!show);
   mobileChoice.setAttribute("aria-pressed",String(!show));
   if(mobileSection)mobileSection.hidden=show;
   if(show)form.elements.url?.focus();
 };
 addButton.addEventListener("click",()=>toggleForm(true));
 $("ip-show-mobile").addEventListener("click",()=>toggleForm(false));
 $("ip-cancel-camera").addEventListener("click",()=>toggleForm(false));
 form.addEventListener("submit",async event=>{
   event.preventDefault();if(!await admin())return;
   const data=new FormData(form);
   const url=String(data.get("url")||"").trim();
   let scheme="";
   try{scheme=new URL(url).protocol.toLowerCase();}
   catch{status("Introduce una URL completa, por ejemplo http://192.168.1.100:8080/video");return;}
   if(!["http:","https:","rtsp:"].includes(scheme)){
     status("Solo se admiten enlaces HTTP, HTTPS o RTSP a una IP privada.");return;
   }
   const requested=String(data.get("protocol")||"auto");
   const protocol=requested==="auto"?(scheme==="rtsp:"?"RTSP":"HTTP/MJPEG"):requested;
   const fields={
     url,name:String(data.get("name")||"").trim()||"Cámara forestal "+String(nodes.size+1).padStart(2,"0"),
     kind:String(data.get("kind")||"telefono"),protocol,
     port:null,username:String(data.get("username")||""),
     password:String(data.get("password")||""),
     threshold:Number(data.get("threshold")||0.85),
     audio_enabled:form.elements.audio_enabled.checked
   };
   const submit=form.querySelector('button[type="submit"]');
   submit.disabled=true;
   try{
     const saved=await api("/api/ip-cameras","POST",fields);
     let connectMessage="Cámara registrada. ";
     try{
       await api("/api/ip-cameras/"+saved.camera.id+"/action","POST",{action:"connect"});
       connectMessage+="Conexión solicitada; esperando señal de la pasarela local.";
     }catch(connectError){
       connectMessage+="No se pudo solicitar conexión: "+connectError.message;
     }
     form.reset();
     toggleForm(false);
     status(connectMessage);
     await refresh();
   }catch(err){status(err.message);}
   finally{submit.disabled=false;}
 });
 timer=setInterval(()=>{if(!panel.hidden)refresh();},1600);
 return ()=>{
   active=false;clearInterval(timer);stopVision();stopRecording();mobileCleanup?.();
   window.removeEventListener("bosqyn:auth-changed",onAuth);
   tabLive?.removeEventListener("click",onOther);tabSat?.removeEventListener("click",onOther);
   panel.remove();tab.remove();nodes.clear();panel=null;
   tabs.style.gridTemplateColumns="";
 };
}
return {mount};
})();
