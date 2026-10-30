/* BOSQYN IA: real observations + drone telemetry in the existing Leaflet dashboard. */
window.Bosqyn=window.Bosqyn||{};
Bosqyn.satelliteCenter=(()=>{
"use strict";
let panel=null,map=null,heat=null,dronesLayer=null,cleanup=null,records=[],zones=[],drones=[],active=false;
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
     if(e.source==="NASA FIRMS"&&!["h","n"].includes(String(e.confidence).toLowerCase()))return false;
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
 if($("sat-visible"))$("sat-visible").textContent=items.length+" observaciones visibles; ausencia de puntos no descarta incendios.";
}
async function load(){
 if(!active)return;
 const results=await Promise.allSettled([json("/api/satellite/zones"),json("/api/drone/telemetry"),json("/api/satellite/status")]);
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
 '<button type="button" id="sat-refresh">Actualizar fuentes</button></div>'+
 '<p id="sat-visible" class="bosqyn-sat-caption">Esperando observaciones</p><p id="sat-last" class="bosqyn-sat-caption">Última actualización pendiente</p>'+
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
 '<label class="bosqyn-sat-stream">Ruta HLS/MP4 del mismo servidor<input id="sat-drone-src" placeholder="/media/dron/live.m3u8" /></label>'+
 '<button type="button" id="sat-play">Abrir video</button> <button type="button" id="sat-stop">Desconectar</button>'+
 '<video id="sat-video" controls muted autoplay playsinline></video>'+
 '<p class="bosqyn-sat-caption">Se necesita una pasarela HLS autorizada; RTSP/WebRTC no se reproducen directamente. Sin señal real no hay IA activa del dron.</p></details>'+
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
 $("sat-play").onclick=()=>{
   let url;try{url=new URL($("sat-drone-src").value.trim(),location.origin);}
   catch{status("URL de video no válida.");return;}
   if(url.origin!==location.origin||!/^\/(media|stream)\//.test(url.pathname)||
      !/\.(mp4|m3u8)$/.test(url.pathname)||url.username||url.password){
      status("Solo rutas de video autorizadas en el mismo origen (/media/ o /stream/).");return;
   }
   const video=$("sat-video");video.src=url.pathname+url.search;
   video.play().catch(()=>status("El navegador no puede reproducir el flujo; comprueba la pasarela."));
 };
 $("sat-stop").onclick=()=>{const video=$("sat-video");video.pause();video.removeAttribute("src");video.load();status("Video desconectado.");};
 load();
 cleanup=()=>{active=false;const v=$("sat-video");v?.pause();v?.removeAttribute("src");panel=null;map=null;heat=null;dronesLayer=null;};
 return cleanup;
}
function onMapReady(m){map=m;heat=window.L.layerGroup().addTo(map);dronesLayer=window.L.layerGroup().addTo(map);render();load();}
function updateEvents(items){records=Array.isArray(items)?items:[];render();}
return {mount,onMapReady,updateEvents,load};
})();