/* BOSQYN IA: real observations + drone telemetry in the existing Leaflet dashboard. */
window.Bosqyn=window.Bosqyn||{};
Bosqyn.satelliteCenter=(()=>{
"use strict";
let panel=null,map=null,heat=null,dronesLayer=null,cleanup=null,records=[],zones=[],drones=[],droneEvents=[],correlations=[],active=false,analyzing=false,lastPrediction=null,lastSaved=0,repeatCount=0,lastClass="",saving=false,hls=null;
const $=(id)=>panel?.querySelector("#"+id);
const asTime=v=>{const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString("es-PE",{timeZone:"UTC"})+" UTC":"sin dato";};
async function json(url){const r=await fetch(url,{cache:"no-store",credentials:"same-origin"});if(!r.ok)throw Error("HTTP "+r.status);return r.json();}
async function post(url,data){const r=await fetch(url,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json","X-Bosqyn-Action":"1"},body:JSON.stringify(data)});const result=await r.json();if(!r.ok)throw Error(result.error||"Solicitud rechazada");return result;}
const status=(msg)=>{if($("sat-action"))$("sat-action").textContent=msg;};
function filtered(){
 const source=$("sat-source")?.value||"all",quality=$("sat-quality")?.value||"all";
 const zone=zones.find(z=>String(z.id)===$("sat-zone")?.value);
 const maxage=Number($("sat-age")?.value||24)*3600000,now=Date.now();
 return records.filter(e=>{
   const t=new Date(e.time).getTime();
   if(!Number.isFinite(t)||now-t>maxage||t>now+300000||source!=="all"&&source!==e.source)return false;
   if(!Number.isFinite(Number(e.lat))||!Number.isFinite(Number(e.lon)))return false;
   if(zone&&(e.lon<zone.west||e.lon>zone.east||e.lat<zone.south||e.lat>zone.north))return false;
   if(quality==="high"){
     if(e.source==="NOAA GOES-19"&&![10,11,30,31].includes(Number(e.confidence)))return false;
     if(e.source==="NASA FIRMS"&&String(e.confidence).toLowerCase()!=="h")return false;
   }
   return true;
 });
}
function popup(e){
 const div=document.createElement("div");
 for(const text of [e.source,"Adquirido: "+asTime(e.time),"Producto: "+e.product,
   "Confianza / código: "+e.confidence,"Calidad DQF: "+(e.quality_code??"no disponible"),
   "FRP (MW): "+(e.frp??"no disponible"),"Observación térmica; verificar en campo"]){
   const p=document.createElement("p");p.textContent=text;div.appendChild(p);
 }
 return div;
}
function render(){
 if(!map||!window.L)return;
 heat?.clearLayers();dronesLayer?.clearLayers();
 const items=filtered();
 for(const e of items){
   const color=e.source==="NASA FIRMS"?"#fa6b4a":"#f5bf52";
   window.L.circleMarker([Number(e.lat),Number(e.lon)],{radius:6,color,fillOpacity:.7,weight:2})
     .bindPopup(popup(e)).addTo(heat);
 }
 for(const d of drones){
   const div=document.createElement("div");
   div.textContent="GPS del dron "+d.drone_name+" ("+asTime(d.observed_at)+"). No es la ubicación del incendio.";
   window.L.circleMarker([Number(d.lat),Number(d.lon)],{radius:8,color:"#65dcff",weight:3})
     .bindPopup(div).addTo(dronesLayer);
 }
 for(const item of droneEvents){
   if(!Number.isFinite(+item.lat)||!Number.isFinite(+item.lon))continue;
   if($("sat-detection-status")?.value!=="all"&&$("sat-detection-status").value!==item.status)continue;
   const label=document.createElement("div");
   label.textContent=item.drone_name+" · "+item.category+" "+Math.round(item.confidence*100)+
     "% · "+asTime(item.observed_at)+" · Estado: "+item.status+
     ". GPS del dron, NO ubicación exacta del incendio.";
   window.L.circleMarker([+item.lat,+item.lon],{
      radius:7,color:item.category==="TALA"?"#eab308":"#fb923c",weight:2,fillOpacity:.3
   }).bindPopup(label).addTo(dronesLayer);
 }
 if($("sat-visible"))$("sat-visible").textContent=items.length+" observaciones visibles; ausencia de puntos no descarta incendios.";
 const history=$("sat-history");if(history){
   history.replaceChildren();
   for(const e of items.slice(0,12)){
     const row=document.createElement("p");
     row.textContent=e.source+" · "+asTime(e.time)+" · "+e.product+
       " · calidad "+e.confidence+" · FRP "+(e.frp??"sin dato");
     history.append(row);
   }
   if(!items.length)history.textContent="Sin observaciones en el filtro seleccionado.";
 }
 const context=$("sat-correlations");
 if(context){
   context.textContent=correlations.filter(c=>c.source_count>=2).length+
      " coincidencias aproximadas NASA/NOAA entre "+correlations.length+
      " grupos. No equivalen a incendios confirmados.";
 }
}
async function load(){
 if(!active)return;
 const results=await Promise.allSettled([
   json("/api/satellite/zones"),json("/api/drone/telemetry"),json("/api/satellite/status"),
   json("/api/drone/detections"),json("/api/satellite/correlations")
 ]);
 if(!active)return;
 if(results[0].status==="fulfilled"){
   zones=results[0].value.zones||[];
   const select=$("sat-zone"),selected=select.value;
   select.replaceChildren(new Option("Todas las zonas","all"));
   for(const z of zones)select.appendChild(new Option(z.name,String(z.id)));
   select.value=zones.some(z=>String(z.id)===selected)?selected:"all";
 }
 if(results[1].status==="fulfilled"){
   drones=results[1].value.items||[];
   $("sat-drone-count").textContent=drones.length+" drones con GPS registrado";
 }
 if(results[2].status==="fulfilled"){
   const feeds=results[2].value.feeds||{};
   $("sat-last").textContent="Última consulta exitosa — NASA: "+asTime(feeds.NASA?.last_success)+
    " | NOAA: "+asTime(feeds.NOAA?.last_success);
 }
 if(results[3].status==="fulfilled")droneEvents=results[3].value.items||[];
 if(results[4].status==="fulfilled")correlations=results[4].value.items||[];
 render();
}
function mount(dashboard,refresh){
 panel=dashboard;active=true;
 const center=dashboard.querySelector("#bosqyn-satellite-center");
 const section=document.createElement("section");section.className="bosqyn-satellite-tools";
 section.innerHTML=
 '<div class="bosqyn-sat-filter"><label>Fuente<select id="sat-source"><option value="all">Todas</option><option>NASA FIRMS</option><option>NOAA GOES-19</option></select></label>'+
 '<label>Periodo<select id="sat-age"><option value="24">24 horas</option><option value="72">72 horas</option><option value="168">7 días</option></select></label>'+
 '<label>Confianza<select id="sat-quality"><option value="all">Todas</option><option value="high">Alta</option></select></label>'+
 '<label>Zona<select id="sat-zone"><option value="all">Todas</option></select></label>'+
 '<label>Estado dron<select id="sat-detection-status"><option value="all">Todos</option><option>PENDIENTE</option><option>CONFIRMADA</option><option>DESCARTADA</option></select></label>'+
 '<button type="button" id="sat-refresh">Actualizar fuentes</button></div>'+
 '<p id="sat-visible" class="bosqyn-sat-caption">Esperando observaciones</p><p id="sat-last" class="bosqyn-sat-caption">Última actualización pendiente</p>'+
 '<details><summary>Historial de observaciones y coincidencias</summary><div id="sat-history" class="bosqyn-sat-history"></div>'+
 '<p id="sat-correlations" class="bosqyn-sat-caption">Correlaciones no disponibles</p></details>'+
 '<details><summary>Guardar zona forestal</summary><form id="sat-zone-form" class="bosqyn-sat-form">'+
 '<input name="name" placeholder="Nombre" maxlength="80" required />'+
 '<input name="west" type="number" step="any" placeholder="Oeste" required />'+
 '<input name="south" type="number" step="any" placeholder="Sur" required />'+
 '<input name="east" type="number" step="any" placeholder="Este" required />'+
 '<input name="north" type="number" step="any" placeholder="Norte" required />'+
 '<button type="submit">Guardar zona</button></form></details>'+
 '<details><summary>Integración de dron · video y GPS</summary>'+
 '<p id="sat-drone-count" class="bosqyn-sat-caption">0 drones registrados</p>'+
 '<p class="bosqyn-sat-caption">GPS del dron, no del objetivo. Necesita controlador autorizado.</p>'+
 '<form id="sat-drone-form" class="bosqyn-sat-form">'+
 '<input name="drone_name" placeholder="Nombre del dron" maxlength="80" required />'+
 '<input name="lat" type="number" step="any" placeholder="Latitud GPS" required />'+
 '<input name="lon" type="number" step="any" placeholder="Longitud GPS" required />'+
 '<input name="altitude_m" type="number" step="any" placeholder="Altitud (m)" />'+
 '<button type="submit">Registrar GPS</button></form>'+
 '<label class="bosqyn-sat-stream">Ruta HLS/MP4 protegida del servidor<input id="sat-drone-src" placeholder="/api/drone/media/live.m3u8" /></label>'+
 '<button type="button" id="sat-play">Abrir video</button> <button type="button" id="sat-stop">Desconectar</button>'+
 '<video id="sat-video" controls muted autoplay playsinline></video>'+
 '<div id="sat-vision" class="bosqyn-sat-ai">'+
 '<strong>IA visual del video del dron</strong> <span data-vision-confidence>--</span>'+
 '<p data-vision-class>ESPERANDO VIDEO REAL</p>'+
 '<img data-vision-logo src="img/deteccion/Bosque.png" alt="" width="35" height="35"/>'+
 '<span data-vision-detail>Sin análisis</span> <span data-vision-warning>SIN ANÁLISIS</span>'+
 '<div class="bosqyn-dominant-progress"><span data-vision-progress></span></div>'+
 '<p id="sat-vision-status" role="status">La IA solo se inicia con video reproducible.</p></div>'+
 '<button type="button" id="sat-start-vision">Analizar video con IA</button> '+
 '<button type="button" id="sat-save-frame">Guardar evidencia con GPS del dron</button>'+
 '<label class="bosqyn-sat-caption"><input id="sat-auto-detect" type="checkbox" /> Registrar automáticamente indicios repetidos ≥85 % (solo administrador)</label>'+
 '<p class="bosqyn-sat-caption">El GPS almacenado corresponde al dron, no a la ubicación del incendio. Se necesita una pasarela HLS autorizada; RTSP/WebRTC no se reproducen directamente.</p></details>'+
 '<p id="sat-action" role="status" class="bosqyn-sat-caption"></p>';
 center.insertBefore(section,center.querySelector("#bosqyn-satellite-map"));
 section.querySelectorAll("select").forEach(el=>el.addEventListener("change",render));
 $("sat-refresh").onclick=async()=>{
   if(!await Bosqyn.auth?.ensureAdmin("Administrador necesario para consultar fuentes."))return;
   try{await post("/api/satellite/refresh",{});status("Actualización solicitada según intervalos permitidos.");await refresh();await load();}
   catch(e){status(e.message);}
 };
 $("sat-zone-form").onsubmit=async e=>{
   e.preventDefault();if(!await Bosqyn.auth?.ensureAdmin("Administrador necesario para guardar zonas."))return;
   const data=new FormData(e.currentTarget);
   try{await post("/api/satellite/zones",{name:data.get("name"),bbox:["west","south","east","north"].map(k=>Number(data.get(k)))});status("Zona guardada.");await load();}
   catch(err){status(err.message);}
 };
 $("sat-drone-form").onsubmit=async e=>{
   e.preventDefault();if(!await Bosqyn.auth?.ensureAdmin("Administrador necesario para registrar GPS."))return;
   const data=new FormData(e.currentTarget),payload={
     drone_name:data.get("drone_name"),lat:Number(data.get("lat")),lon:Number(data.get("lon")),
     observed_at:new Date().toISOString()
   };
   if(data.get("altitude_m")!=="")payload.altitude_m=Number(data.get("altitude_m"));
   try{await post("/api/drone/telemetry",payload);status("GPS registrado: ubicación del dron.");await load();}
   catch(err){status(err.message);}
 };
 async function ensureHls(){
   if(window.Hls)return;
   await new Promise((resolve,reject)=>{
     const script=document.createElement("script");
     script.src="https://cdn.jsdelivr.net/npm/hls.js@1.5.21/dist/hls.min.js";
     script.onload=resolve;script.onerror=()=>reject(Error("No fue posible cargar HLS.js"));
     document.head.appendChild(script);
   });
 }
 function clearHls(){if(hls){hls.destroy();hls=null;}}
 $("sat-play").onclick=async()=>{
   let url;try{url=new URL($("sat-drone-src").value.trim(),location.origin);}
   catch{status("URL de video no válida.");return;}
   if(url.origin!==location.origin||!/^\/api\/drone\/media\/[A-Za-z0-9_.-]+\.(mp4|m3u8)$/.test(url.pathname)||
      url.username||url.password||url.search){
      status("Solo rutas autorizadas /api/drone/media/ sin credenciales ni parámetros.");return;
   }
   const video=$("sat-video");
   clearHls();video.pause();video.removeAttribute("src");video.load();
   if(url.pathname.endsWith(".m3u8")&&!video.canPlayType("application/vnd.apple.mpegurl")){
     try{
       await ensureHls();
       if(!window.Hls?.isSupported())throw Error("HLS no compatible con este navegador");
       hls=new window.Hls({enableWorker:true});
       hls.loadSource(url.pathname);hls.attachMedia(video);
       hls.on(window.Hls.Events.MANIFEST_PARSED,()=>{
         video.play().catch(()=>status("El navegador bloqueó el inicio del video."));
       });
       hls.on(window.Hls.Events.ERROR,(event,data)=>{
         if(data?.fatal)status("Error de HLS; revisa el origen de la transmisión.");
       });
     }catch(err){status(err.message);}
   }else{
     video.src=url.pathname;
     video.play().catch(()=>status("El navegador no pudo reproducir la señal autorizada."));
   }
 };
 async function saveFrame(auto=false){
   const video=$("sat-video"),event=lastPrediction;
   const klass=String(event?.className||"").trim().toUpperCase();
   const current=Date.now();
   if(!video||video.readyState<2||!event||!["HUMO","INCENDIO","TALA"].includes(klass)
      ||event.probability<0.85||current-event.timestamp>6000){
     if(!auto)status("No hay una detección visual reciente con confianza ≥85 % y video activo.");
     return;
   }
   const name=$("sat-drone-form").elements.namedItem("drone_name")?.value.trim();
   const gps=drones.find(d=>d.drone_name===name && current-new Date(d.received_at).getTime()<180000);
   if(!gps){if(!auto)status("Primero registra GPS reciente para el mismo dron.");return;}
   if(auto){
     if(Bosqyn.auth?.role()!=="admin"||current-lastSaved<60000||repeatCount<3)return;
   }else if(!await Bosqyn.auth?.ensureAdmin("Solo un administrador puede archivar evidencia del dron."))return;
   if(saving)return;
   saving=true;
   try{
     const canvas=document.createElement("canvas");
     canvas.width=Math.min(video.videoWidth||0,1280);
     canvas.height=Math.round((video.videoHeight||0)*(canvas.width/(video.videoWidth||1)));
     if(!canvas.width||!canvas.height)throw Error("El video aún no tiene fotogramas disponibles");
     canvas.getContext("2d").drawImage(video,0,0,canvas.width,canvas.height);
     const frame=canvas.toDataURL("image/jpeg",0.78);
     const saved=await post("/api/drone/detections",{drone_name:name,category:klass,
       confidence:event.probability,image_data:frame});
     lastSaved=current;
     status("Evidencia "+saved.evidence.id+" guardada como pendiente. Coordenada: GPS del dron, no del incendio.");
   }catch(err){status("No se guardó evidencia: "+err.message);}
   finally{saving=false;}
 }
 const visionRoot=$("sat-vision");
 visionRoot.addEventListener("bosqyn:visual-detection",e=>{
   const item=e.detail;lastPrediction=item;
   if(lastClass===item.className&&item.probability>=0.85)repeatCount++;
   else repeatCount=item.probability>=0.85?1:0;
   lastClass=item.className;
   if($("sat-auto-detect").checked)saveFrame(true);
 });
 function stopVision(){
   if(analyzing){Bosqyn.vision?.stop();analyzing=false;}
   lastPrediction=null;repeatCount=0;lastClass="";
 }
 $("sat-start-vision").onclick=()=>{
   const video=$("sat-video");
   if(analyzing){stopVision();status("Análisis visual del dron detenido.");return;}
   if(video.readyState<2){status("Conecta primero un video real y reproducible.");return;}
   if(!Bosqyn.vision?.start){status("Modelo visual no disponible.");return;}
   Bosqyn.vision.start(video,visionRoot,$("sat-vision-status"));
   analyzing=true;status("Modelo visual conectado al video. Los porcentajes son predicciones, no precisión.");
 };
 $("sat-save-frame").onclick=()=>saveFrame(false);
 $("sat-stop").onclick=()=>{stopVision();clearHls();const video=$("sat-video");video.pause();video.removeAttribute("src");video.load();status("Video desconectado.");};
 load();
 cleanup=()=>{active=false;stopVision();clearHls();const v=$("sat-video");v?.pause();v?.removeAttribute("src");panel=null;map=null;heat=null;dronesLayer=null;};
 return cleanup;
}
function onMapReady(m){map=m;heat=window.L.layerGroup().addTo(map);dronesLayer=window.L.layerGroup().addTo(map);render();load();}
function updateEvents(items){records=Array.isArray(items)?items:[];render();}
return {mount,onMapReady,updateEvents,load,stopVision:()=>{if(analyzing){Bosqyn.vision?.stop();analyzing=false;}}};
})();