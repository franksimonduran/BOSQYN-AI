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
 const title=mk("strong",camera.name);
 const tag=mk("span","Sin señal","bosqyn-ip-tag");
 head.append(title,tag);
 const frame=mk("div",undefined,"bosqyn-ip-screen");
 const image=mk("img");image.alt="Fotogramas de "+camera.name;image.hidden=true;
 const empty=mk("p","Sin conexión con la pasarela local");
 frame.append(image,empty);
 const meta=mk("p",camera.protocol+" · "+camera.kind+" · Puerto "+camera.port,"bosqyn-ip-muted");
 const test=mk("p","Prueba pendiente de solicitar","bosqyn-ip-muted");
 const audio=mk("p","Audio: sin análisis","bosqyn-ip-muted");
 const detection=mk("div",undefined,"bosqyn-ip-detection");
 detection.innerHTML='<div><img data-vision-logo src="img/deteccion/Bosque.png" alt="" width="35" height="35"/>'+
   '<strong data-vision-class>ESPERANDO IA</strong> <b data-vision-confidence>--</b></div>'+
   '<p data-vision-detail>Clasificador detenido</p><span data-vision-warning>SIN ANÁLISIS</span>'+
   '<div class="bosqyn-dominant-progress"><span data-vision-progress></span></div>';
 const buttons=mk("div",undefined,"bosqyn-ip-buttons");
 const labels=[
  ["test","Probar conexión"],["connect","Conectar cámara"],["disconnect","Desconectar"],
  ["capture","Capturar foto"],["ai","IA visual"],["fullscreen","Pantalla completa"],
  ["record","Grabar video"],["delete","Eliminar"]
 ];
 for(const [action,label] of labels){
   const button=mk("button",label);button.type="button";button.dataset.action=action;
   buttons.append(button);
 }
 const modelStatus=mk("p","IA en espera","bosqyn-ip-muted");
 const canvas=document.createElement("canvas");canvas.hidden=true;
 item.append(head,frame,meta,test,audio,detection,buttons,modelStatus,canvas);
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
 buttons.addEventListener("click",async event=>{
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
     if(!current?.connected||!canvas.captureStream||!window.MediaRecorder){
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
          "Conexión solicitada. La pasarela local enviará fotogramas si puede acceder al dispositivo.":
          "Cámara desconectada.");
       if(action==="disconnect"){if(visionId===id)stopVision();stopRecording();}
       update(result.camera);
     }
   }catch(err){status(err.message);}
   finally{button.disabled=false;}
 });
 function update(c){
   current=c;
   title.textContent=c.name;
   tag.textContent=c.connected?"Conectada":c.desired==="on"?"Sin señal / reconectando":"Desconectada";
   tag.classList.toggle("is-online",!!c.connected);
   test.textContent="Prueba: "+(c.last_test?.status||"no realizada");
   audio.textContent=c.audio_result?
     "Audio "+c.audio_result.class+" "+Math.round(Number(c.audio_result.confidence||0)*100)+
       "% · clase original "+c.audio_result.original_class:
     (c.audio_enabled?"Audio: habilitado; esperando clasificador":"Audio: desactivado");
   empty.hidden=!!c.connected;
   image.hidden=!c.connected;
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
 if(!items.length&& !area.querySelector("[data-ip-empty]")){
   const hint=mk("p","Todavía no hay cámaras guardadas. Agrega una dirección IP privada y ejecuta la pasarela local.","bosqyn-ip-muted");
   hint.dataset.ipEmpty="1";area.append(hint);
 }else if(items.length)area.querySelector("[data-ip-empty]")?.remove();
}
async function refresh(){
 if(!active)return;
 try{
   const [cameras,history]=await Promise.all([api("/api/ip-cameras"),api("/api/ip-cameras/events")]);
   if(!active)return;
   render(cameras.items||[]);
   const events=$("ip-events");
   events.replaceChildren();
   for(const e of (history.items||[]).slice(0,10)){
     const line=mk("p",fmt(e.occurred_at)+" · "+e.camera_name+" · "+e.category+
       (e.confidence===null?"":" · "+Math.round(e.confidence*100)+"%"));
     events.append(line);
   }
 }catch(err){
   if(active)status("Para consultar cámaras IP, inicia sesión como administrador. "+err.message);
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
  '<h2>Cámaras IP · monitoreo forestal</h2>'+
  '<p class="bosqyn-ip-muted">Las IP privadas funcionan mediante la pasarela en tu Wi-Fi. Railway nunca accede directamente a la cámara.</p>'+
  '<form id="ip-form" class="bosqyn-ip-form">'+
   '<label>Nombre<input name="name" required maxlength="80" placeholder="Cámara forestal 01"></label>'+
   '<label>Dispositivo<select name="kind"><option value="telefono">Teléfono Android</option><option value="camara_ip">Cámara IP</option><option value="seguridad">Seguridad</option></select></label>'+
   '<label>Protocolo<select name="protocol"><option>HTTP/MJPEG</option><option>RTSP</option><option>ONVIF</option></select></label>'+
   '<label>URL privada<input name="url" required maxlength="1024" placeholder="http://192.168.1.100:8080/video" autocomplete="off"></label>'+
   '<label>Puerto<input name="port" type="number" min="1" max="65535" placeholder="Puerto de la URL"></label>'+
   '<label>Usuario<input name="username" autocomplete="off" maxlength="120" placeholder="Opcional"></label>'+
   '<label>Contraseña<input name="password" type="password" autocomplete="new-password" maxlength="200" placeholder="Opcional"></label>'+
   '<label>Umbral acústico<input name="threshold" type="number" min=".5" max=".99" step=".01" value=".85"></label>'+
   '<label class="bosqyn-ip-check"><input type="checkbox" name="audio_enabled"> Analizar audio de la cámara</label>'+
   '<button type="submit">Guardar cámara</button></form>'+
  '<p id="ip-status" class="bosqyn-ip-muted" role="status">Accede como administrador para añadir cámaras.</p>'+
  '<div id="ip-grid" class="bosqyn-ip-grid"></div>'+
  '<details><summary>Historial de conexiones y eventos</summary><div id="ip-events" class="bosqyn-ip-events"></div></details>'+
  '<p class="bosqyn-ip-muted">La webcam y el mapa satelital son independientes. Una motosierra es un indicio acústico, no prueba de tala ilegal. La pasarela procesa como máximo un fotograma por segundo por cámara.</p>';
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
 const form=$("ip-form");
 form.addEventListener("submit",async event=>{
   event.preventDefault();if(!await admin())return;
   const data=new FormData(form);
   const fields=Object.fromEntries(data);
   fields.audio_enabled=form.elements.audio_enabled.checked;
   fields.port=data.get("port")||null;
   fields.threshold=Number(data.get("threshold"));
   try{
     const saved=await api("/api/ip-cameras","POST",fields);
     form.elements.password.value="";form.elements.username.value="";
     status("Cámara "+saved.camera.name+" guardada. Inicia la pasarela local y pulsa Probar conexión.");
     await refresh();
   }catch(err){status(err.message);}
 });
 timer=setInterval(()=>{if(!panel.hidden)refresh();},1600);
 return ()=>{
   active=false;clearInterval(timer);stopVision();stopRecording();
   window.removeEventListener("bosqyn:auth-changed",onAuth);
   tabLive?.removeEventListener("click",onOther);tabSat?.removeEventListener("click",onOther);
   panel.remove();tab.remove();nodes.clear();panel=null;
   tabs.style.gridTemplateColumns="";
 };
}
return {mount};
})();
