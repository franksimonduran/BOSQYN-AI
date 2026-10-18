"use strict";
const $ = id => document.getElementById(id);
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const colors = { "Humo":"#ffb45e", "Incendio":"#fa6060", "Fuego":"#fa6060", "Normal":"#39dc92", "Tala":"#e4c95e", "Ir al bosque":"#99b8ff" };
const alertClasses = new Set(["Humo","Incendio","Fuego","Tala"]);
let model = null;
let labels = [];
let stream = null;
let running = false;
let busy = false;
let lastTick = 0;
let lastLabel = "";
let consecutive = 0;
let records = [];
let audioCtx = null;
let starting = false;
let cameraSession = 0;
let predictionLoop = 0;
let storageReady = true;
const SETTINGS_KEY = "bosqyn-settings-v1";
const categoryAssets = {Bosque:"Bosque",Normal:"Bosque",Fuego:"Fuego",Incendio:"Fuego",Humo:"Humo",Tala:"Tala","Ir al bosque":"Ir al bosque"};
function categoryIcon(label) {
  const asset=categoryAssets[label];
  return asset ? '<img class="category-icon" alt="" src="/assets/logos/'+encodeURIComponent(asset)+'.png">' : '<span class="category-icon fallback" aria-hidden="true">▣</span>';
}
function report(message,level="") {
  $("operationMessage").textContent=message;
  $("operationMessage").className="notice"+(level?" "+level:"");
}
function saveSettings() {
  try {localStorage.setItem(SETTINGS_KEY,JSON.stringify(config)); $("settingsState").textContent="Configuración guardada en este navegador.";}
  catch {$("settingsState").textContent="No se pudo guardar la configuración; se conservará solo durante esta sesión.";}
}
function loadSettings() {
  try {
    const saved=JSON.parse(localStorage.getItem(SETTINGS_KEY)||"null");
    if (!saved || typeof saved!=="object") return;
    for (const [key,min,max] of [["threshold",.5,.99],["persistence",1,10],["cooldown",10,300]]) {
      if (Number.isFinite(saved[key]) && saved[key]>=min && saved[key]<=max) config[key]=key==="threshold"?saved[key]:Math.round(saved[key]);
    }
    if (typeof saved.sound==="boolean") config.sound=saved.sound;
  } catch {$("settingsState").textContent="Se usarán los ajustes iniciales; la configuración anterior no es válida.";}
}
function resetPredictions() {
  lastLabel="";consecutive=0;
  $("dominantClass").textContent="Sin detección";
  $("dominantClass").style.color="";
  $("dominantScore").textContent="Inicia la cámara";
  renderPredictions(labels.map(className=>({className,probability:0})));
}
function refreshClassFilter() {
  const previous=$("filterClass").value;
  const classes=[...new Set([...labels,...records.map(r=>r.label)])].sort((a,b)=>a.localeCompare(b,"es"));
  $("filterClass").innerHTML='<option value="all">Todas</option>'+classes.map(c=>'<option value="'+escapeHTML(c)+'">'+escapeHTML(c)+'</option>').join("");
  $("filterClass").value=classes.includes(previous)?previous:"all";
}
const lastSavedByClass = new Map();
const config = { threshold: .85, persistence: 3, cooldown: 60, sound: true };
const DB_NAME = "bosqyn-monitor-v1";

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("records")) db.createObjectStore("records", {keyPath:"id"});
      if (!db.objectStoreNames.contains("models")) db.createObjectStore("models", {keyPath:"key"});
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function dbAction(storeName, mode, callback) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const request = callback(tx.objectStore(storeName));
      let result;
      if (request) {
        request.onsuccess = () => {result=request.result;};
        request.onerror = () => reject(request.error);
      }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Operación local interrumpida"));
    });
  } finally {
    db.close();
  }
}
const fecha = time => new Date(time).toLocaleString("es-PE",{dateStyle:"short",timeStyle:"medium"});
function showPage(page) {
  document.querySelectorAll(".page").forEach(el => el.classList.toggle("active",el.id==="page-"+page));
  document.querySelectorAll(".nav").forEach(el => el.classList.toggle("active",el.dataset.page===page));
  const names={inicio:"Centro de control",monitor:"Monitoreo en vivo",alertas:"Alertas y evidencias",stats:"Estadísticas",config:"Configuración"};
  $("screenTitle").textContent=names[page] || "BOSQYN AI";
  document.querySelectorAll(".nav").forEach(el=>el.setAttribute("aria-current",el.dataset.page===page?"page":"false"));
  renderAll();
}
document.querySelectorAll("[data-page]").forEach(el=>el.addEventListener("click",()=>showPage(el.dataset.page)));
function status(message, level="") {
  $("liveAlert").textContent=message;
  $("liveAlert").className="notice"+(level?" "+level:"");
}
function updateModelState(message,ok) {
  $("modelState").textContent=message;
  $("modelState").className="pill"+(ok?"":" yellow");
  $("systemStatus").textContent=ok?"IA preparada":"Sin modelo";
  $("systemDetail").textContent=ok?"Lista para activar webcam":"Importa tu ZIP de Teachable Machine";
}
function setModel(newModel, source) {
  model=newModel;
  labels=model.getClassLabels();
  if (!labels.length) throw new Error("El modelo no contiene clases");
  $("classCount").textContent=labels.length;
  $("modelInfo").textContent=JSON.stringify({clases:labels,origen:source,tipo:"Teachable Machine Image"},null,2);
  updateModelState("● Modelo listo",true);
  $("setup").style.display="none";
  const previous=$("filterClass").value;
  $("filterClass").innerHTML='<option value="all">Todas</option>'+labels.map(s=>'<option value="'+escapeHTML(s)+'">'+escapeHTML(s)+'</option>').join("");
  $("filterClass").value=labels.includes(previous)?previous:"all";
  renderPredictions(labels.map(className=>({className, probability:0})));
  status("Modelo cargado. Inicia la cámara para comenzar.","");
  renderAll();
}
async function modelFromZip(blob, source) {
  if (!window.JSZip || !window.tmImage || !window.tf) throw new Error("No se cargaron las bibliotecas de IA. Comprueba tu conexión a internet.");
  const zip=await JSZip.loadAsync(blob);
  const find=name=>Object.values(zip.files).find(f=>!f.dir && f.name.split("/").pop().toLowerCase()===name);
  const modelEntry=find("model.json"), metadataEntry=find("metadata.json"), weightsEntry=find("weights.bin");
  if (!modelEntry || !metadataEntry || !weightsEntry) throw new Error("ZIP inválido: deben existir model.json, metadata.json y weights.bin.");
  const modelFile=new File([await modelEntry.async("blob")],"model.json",{type:"application/json"});
  const weightsFile=new File([await weightsEntry.async("blob")],"weights.bin",{type:"application/octet-stream"});
  const metadataFile=new File([await metadataEntry.async("blob")],"metadata.json",{type:"application/json"});
  const loaded=await tmImage.loadFromFiles(modelFile,weightsFile,metadataFile);
  setModel(loaded,source);
}
async function importZip(file) {
  if (!file) return;
  if (file.size>35*1024*1024) {status("El ZIP supera el límite de 35 MB.","danger");return;}
  $("setupMessage").textContent="Cargando y comprobando el modelo...";
  try {
    stopCamera();
    await modelFromZip(file,"ZIP importado en el navegador");
    await dbAction("models","readwrite",store=>store.put({key:"active",blob:file,name:file.name}));
    $("setupMessage").textContent="Modelo guardado localmente.";
  } catch (error) {
    $("setup").style.display="flex";
    $("setupMessage").textContent=error.message;
    status("No se pudo importar el modelo: "+error.message,"danger");
    console.error(error);
  } finally {
    $("zipInput").value="";
  }
}
async function initializeModel() {
  $("setupMessage").textContent="Buscando un modelo publicado o guardado localmente...";
  try {
    if (!window.tmImage || !window.tf) throw new Error("Error cargando TensorFlow.js o Teachable Machine.");
    const res=await fetch("/model/metadata.json",{cache:"no-store"});
    if (res.ok) {
      const loaded=await tmImage.load("/model/model.json","/model/metadata.json");
      setModel(loaded,"Archivos publicados en GitHub");
      return;
    }
    const saved=await dbAction("models","readonly",store=>store.get("active"));
    if (saved && saved.blob) {
      await modelFromZip(saved.blob,"ZIP guardado en este navegador");
      return;
    }
    updateModelState("Modelo pendiente",false);
    $("setupMessage").textContent="Selecciona tm-my-image-model.zip para activar la detección. Lo necesitarás una sola vez por navegador.";
  } catch (error) {
    updateModelState("Revisar modelo",false);
    $("setupMessage").textContent=error.message;
    $("modelInfo").textContent=error.message;
    console.error(error);
  }
}
async function startCamera() {
  if (stream || starting) return;
  if (!model) {status("Primero carga tu modelo ZIP.","warning");return;}
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    status("La webcam requiere un sitio HTTPS o http://localhost y navegador compatible.","danger");return;
  }
  starting=true;
  const session=++cameraSession;
  $("startCamera").disabled=true;
  try {
    const acquired=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720}},audio:false});
    if (session!==cameraSession) {acquired.getTracks().forEach(t=>t.stop());return;}
    stream=acquired;
    stream.getVideoTracks().forEach(t=>t.addEventListener("ended",()=>{if(session===cameraSession){stopCamera();status("La cámara se desconectó. Vuelve a iniciarla.","warning");}}));
    const video=$("webcam");
    video.srcObject=stream;
    await video.play();
    if (session!==cameraSession) return;
    video.style.display="block";
    $("cameraEmpty").style.display="none";
    $("startCamera").disabled=true;
    $("stopCamera").disabled=false;
    $("capture").disabled=false;
    $("cameraState").textContent="● Cámara activa";
    $("liveBadge").textContent="● EN VIVO";
    $("liveBadge").className="pill";
    $("systemStatus").textContent="Monitoreando";
    $("systemDetail").textContent="Cámara activa · análisis visual local";
    lastLabel="";
    consecutive=0;
    lastTick=0;
    running=true;
    status("Webcam conectada. Analizando imágenes en tiempo real.");
    const loop=++predictionLoop;
    requestAnimationFrame(now=>tick(now,loop));
  } catch (error) {
    if (session===cameraSession) {stopCamera();status("No se pudo iniciar la webcam: "+error.message,"danger");}
  } finally {if(session===cameraSession) starting=false;}
}
function stopCamera() {
  cameraSession++; predictionLoop++; starting=false;
  running=false;
  stream?.getTracks().forEach(track=>track.stop());
  stream=null;
  const video=$("webcam");
  video.pause();
  video.srcObject=null;
  video.style.display="none";
  $("cameraEmpty").style.display="block";
  $("startCamera").disabled=false;
  $("stopCamera").disabled=true;
  $("capture").disabled=true;
  $("cameraState").textContent="Cámara detenida";
  $("liveBadge").className="pill red";
  $("liveBadge").textContent="● SIN SEÑAL";
  $("fps").textContent="—";
  $("systemStatus").textContent=model?"IA preparada":"Sin modelo";
  $("systemDetail").textContent=model?"Lista para activar webcam":"Importa tu ZIP de Teachable Machine";
  resetPredictions();
  status("Monitoreo detenido.");
}
function renderPredictions(preds) {
  $("bars").innerHTML=preds.map(p=>{
    const width=Math.min(100,Math.max(0,p.probability*100));
    const color=colors[p.className] || "#37daa0";
    return '<div class="pred"><div class="pred-head"><span>'+escapeHTML(p.className)+'</span><b>'+width.toFixed(1)+' %</b></div><div class="track"><div class="fill" style="width:'+width+'%;background:'+color+'"></div></div></div>';
  }).join("");
}
async function tick(now,loop) {
  if (!running || loop!==predictionLoop) return;
  requestAnimationFrame(next=>tick(next,loop));
  if (busy || !stream || !model || now-lastTick<250 || $("webcam").readyState<2) return;
  lastTick=now;
  busy=true;
  try {
    const predictions=(await model.predict($("webcam"),false)).sort((a,b)=>b.probability-a.probability);
    if (!running || loop!==predictionLoop || !predictions.length) return;
    renderPredictions(predictions);
    const best=predictions[0], label=best.className, probability=best.probability;
    $("dominantClass").textContent=label;
    $("dominantClass").style.color=colors[label] || "#e6fff1";
    $("dominantScore").textContent="Confianza del modelo: "+(100*probability).toFixed(1)+" %";
    $("fps").textContent="Actualización ~4/s";
    if (label===lastLabel && probability>=config.threshold) consecutive+=1;
    else {lastLabel=label;consecutive=probability>=config.threshold?1:0;}
    if (alertClasses.has(label) && consecutive>=config.persistence) {
      status("Posibles indicios de "+label.toLowerCase()+". Revisa y verifica la evidencia.",label==="Incendio" || label==="Fuego"?"danger":"warning");
      const time=Date.now();
      if (time-(lastSavedByClass.get(label)||0)>config.cooldown*1000) {
        const record=await saveCapture(label,probability,true);
        if (record) {
          lastSavedByClass.set(label,time);
          if (config.sound) beep();
        }
      }
    } else if (probability<config.threshold) {
      status("Sin clasificación concluyente. Monitoreo activo.","warning");
    } else if (alertClasses.has(label)) {
      status("Verificando persistencia de "+label.toLowerCase()+"…","warning");
    } else if (["Normal","Bosque"].includes(label)) {
      status("Sin indicios de alerta en la clasificación actual. Monitoreo activo.");
    } else {
      status("Clase observada: "+label+". Sin alerta automática configurada.");
    }
  } catch (error) {
    console.error(error);
    status("Error procesando la imagen: "+error.message,"danger");
  } finally {busy=false;}
}
function imageFromVideo() {
  const video=$("webcam"), canvas=$("captureCanvas");
  if (!stream || !video.videoWidth) throw new Error("No hay un fotograma válido disponible.");
  const scale=Math.min(1,720/video.videoWidth);
  canvas.width=Math.round(video.videoWidth*scale);
  canvas.height=Math.round(video.videoHeight*scale);
  canvas.getContext("2d").drawImage(video,0,0,canvas.width,canvas.height);
  return canvas.toDataURL("image/jpeg",.73);
}
async function saveCapture(label="Captura manual",score=null,automatic=false) {
  try {
    const image=imageFromVideo();
    const entry={id:crypto.randomUUID(),time:Date.now(),label,score,image,status:"Pendiente",automatic};
    await dbAction("records","readwrite",store=>store.put(entry));
    records.unshift(entry);
    renderAll();
    if (!automatic) status("Evidencia guardada localmente. Revisa el historial.");
    return entry;
  } catch (error) {
    status("No se pudo guardar la evidencia: "+error.message,"danger");
    console.error(error);
    return null;
  }
}
function beep() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state==="suspended") audioCtx.resume();
    const oscillator=audioCtx.createOscillator(), gain=audioCtx.createGain(), time=audioCtx.currentTime;
    oscillator.frequency.value=740;
    gain.gain.setValueAtTime(.0001,time);
    gain.gain.exponentialRampToValueAtTime(.11,time+.03);
    gain.gain.exponentialRampToValueAtTime(.0001,time+.3);
    oscillator.connect(gain);gain.connect(audioCtx.destination);
    oscillator.start();oscillator.stop(time+.33);
  } catch(error) {console.warn("Audio no disponible",error);}
}
function renderOverview() {
  $("overviewTotal").textContent=records.filter(r=>r.automatic).length;
  $("manualTotal").textContent=records.filter(r=>!r.automatic).length;
  $("overviewPending").textContent=records.filter(r=>r.status==="Pendiente").length;
  const recent=records.slice(0,3);
  $("recent").innerHTML=recent.length?recent.map(r=>'<article class="card">'+categoryIcon(r.label)+'<strong style="color:'+(colors[r.label]||"#e7fff2")+'">'+escapeHTML(r.label)+'</strong><small>'+fecha(r.time)+'</small><small>'+escapeHTML(r.status)+'</small></article>').join(""):'<div class="empty">Todavía no hay incidencias. Inicia la webcam desde Monitoreo.</div>';
}
function renderHistory() {
  const cls=$("filterClass").value, stat=$("filterStatus").value, origin=$("filterOrigin").value;
  const filtered=records.filter(r=>(cls==="all"||cls===r.label)&&(stat==="all"||stat===r.status)&&(origin==="all"||(origin==="auto")===r.automatic));
  $("historyCount").textContent=filtered.length+" de "+records.length+" registros";
  $("incidentList").innerHTML=filtered.length?filtered.map(r=>
    '<article class="record panel"><img alt="Evidencia" src="'+r.image+'"><div><div class="record-title">'+categoryIcon(r.label)+'<strong>'+escapeHTML(r.label)+'</strong></div><small>'+fecha(r.time)+' · '+(r.automatic?'Alerta automática':'Captura manual')+' · '+escapeHTML(r.status)+' · '+(r.score==null?"Captura manual":(100*r.score).toFixed(1)+" % de confianza")+'</small><div class="buttons"><button class="btn" data-action="download" data-id="'+r.id+'">↓ Imagen</button><button class="btn" data-action="confirm" data-id="'+r.id+'">✓ Confirmar</button><button class="btn" data-action="dismiss" data-id="'+r.id+'">× Descartar</button><button class="btn danger" data-action="delete" data-id="'+r.id+'">Eliminar</button></div></div></article>'
  ).join(""):'<div class="empty">No existen registros con esos filtros.</div>';
}
function renderStats() {
  $("sTotal").textContent=records.length;
  $("sConfirm").textContent=records.filter(r=>r.status==="Confirmada").length;
  $("sDiscard").textContent=records.filter(r=>r.status==="Descartada").length;
  $("sPending").textContent=records.filter(r=>r.status==="Pendiente").length;
  const unique=[...new Set([...labels,...records.map(r=>r.label)])];
  const counts=unique.map(label=>({label,count:records.filter(r=>r.label===label).length}));
  const max=Math.max(1,...counts.map(x=>x.count));
  $("chart").innerHTML=counts.length?counts.map(x=>'<div class="chart-row"><span>'+escapeHTML(x.label)+'</span><div class="track"><div class="fill" style="width:'+(100*x.count/max)+'%;background:'+(colors[x.label]||"#26d88e")+'"></div></div><strong>'+x.count+'</strong></div>').join(""):'<div class="empty">No hay incidentes para mostrar.</div>';
}
function renderAll() {refreshClassFilter();renderOverview();renderHistory();renderStats();
  for(const id of ["exportCSV","exportBackup","clearHistory"]) $(id).disabled=!records.length;
}
async function updateRecord(id,action) {
  const record=records.find(r=>r.id===id);
  if (!record) return;
  if (action==="download") {downloadBlob(dataImageBlob(record.image),"bosqyn-"+record.id+(record.image.startsWith("data:image/png")?".png":".jpg"));return;}
  if (action==="delete") {
    if (!confirm("¿Eliminar definitivamente esta evidencia?")) return;
    await dbAction("records","readwrite",store=>store.delete(id));
    records=records.filter(r=>r.id!==id);
  } else {
    const updated={...record,status:action==="confirm"?"Confirmada":"Descartada"};
    await dbAction("records","readwrite",store=>store.put(updated));
    records=records.map(r=>r.id===id?updated:r);
  }
  renderAll();
  report(action==="delete"?"Evidencia eliminada.":"Estado de la evidencia actualizado.");
}
function downloadCSV() {
  const rows=[["ID","Fecha","Clase","Confianza","Estado","Origen"],...records.map(r=>[r.id,fecha(r.time),r.label,r.score==null?"":(r.score*100).toFixed(1),r.status,r.automatic?"Automática":"Manual"])];
  const content="\ufeff"+rows.map(r=>r.map(value=>'"'+String(value).replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"').join(",")).join("\r\n");
  const url=URL.createObjectURL(new Blob([content],{type:"text/csv;charset=utf-8"}));
  const a=document.createElement("a");
  a.href=url;a.download="bosqyn-alertas.csv";a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function bindRange(id,out,key,scale=1,suffix="") {
  const element=$(id);
  element.oninput=()=>{config[key]=Number(element.value)*scale;$(out).textContent=element.value+suffix;};
  element.addEventListener("change",saveSettings);
  element.oninput();
}
$("zipInput").addEventListener("change",e=>importZip(e.target.files[0]));
$("startCamera").addEventListener("click",startCamera);
$("stopCamera").addEventListener("click",()=>{stopCamera();status("Monitoreo detenido.");});
$("capture").addEventListener("click",()=>saveCapture());
$("exportCSV").addEventListener("click",downloadCSV);
$("incidentList").addEventListener("click",e=>{
  const button=e.target.closest("[data-action]");
  if (button) updateRecord(button.dataset.id,button.dataset.action).catch(error=>report("No se pudo actualizar la evidencia: "+error.message,"danger"));
});
$("filterClass").addEventListener("change",renderHistory);
$("filterStatus").addEventListener("change",renderHistory);
$("filterOrigin").addEventListener("change",renderHistory);
$("clearHistory").addEventListener("click",async()=>{
  if (!records.length || !confirm("¿Eliminar TODAS las evidencias locales?")) return;
  try {
    await dbAction("records","readwrite",store=>store.clear());
    records=[];renderAll();report("Historial local eliminado.");
  } catch(error) {report("No se pudo eliminar el historial: "+error.message,"danger");}
});
$("forgetModel").addEventListener("click",async()=>{
  if (!confirm("¿Olvidar el modelo ZIP guardado en este navegador?")) return;
  stopCamera();
  try {await dbAction("models","readwrite",store=>store.delete("active"));}
  catch(error) {$("setupMessage").textContent="No se pudo borrar el modelo local: "+error.message;return;}
  model=null;labels=[];$("setup").style.display="flex";
  $("setupMessage").textContent="Selecciona un nuevo ZIP para reactivar el modelo.";
  $("modelInfo").textContent="Modelo local borrado. Si existe un modelo publicado en el servidor, se cargará al recargar.";
  updateModelState("Modelo pendiente",false);
  $("classCount").textContent="—";resetPredictions();renderAll();
});
loadSettings();
$("threshold").value=Math.round(config.threshold*100);
$("persistence").value=config.persistence;
$("cooldown").value=config.cooldown;
$("sound").checked=config.sound;
bindRange("threshold","outThreshold","threshold",.01," %");
bindRange("persistence","outPersistence","persistence");
bindRange("cooldown","outCooldown","cooldown",1," s");
$("sound").addEventListener("change",e=>{config.sound=e.target.checked;saveSettings();});
window.addEventListener("pagehide",stopCamera);
setInterval(()=>$("clock").textContent=new Date().toLocaleTimeString("es-PE"),1000);
(async()=>{
  try {
    records=(await dbAction("records","readonly",store=>store.getAll())).sort((a,b)=>b.time-a.time);
    renderAll();
  } catch(error) {
    storageReady=false;
    report("Almacenamiento local no disponible. No se podrán guardar ni restaurar evidencias.","danger");
    console.error(error);
    $("recent").innerHTML='<div class="empty">No se pudo abrir el almacenamiento local. Revisa los permisos del navegador.</div>';
  }
  await initializeModel();
})();
function downloadBlob(blob,name) {
  const url=URL.createObjectURL(blob), a=document.createElement("a");
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function dataImageBlob(data) {
  const [header,body]=data.split(",");
  const bytes=Uint8Array.from(atob(body),c=>c.charCodeAt(0));
  return new Blob([bytes],{type:header.includes("image/png")?"image/png":"image/jpeg"});
}
function validatedBackup(data) {
  if (!data || data.format!=="bosqyn-evidence" || data.version!==1 || !Array.isArray(data.records) || data.records.length>5000) throw new Error("Formato de respaldo no compatible.");
  const ids=new Set();
  return data.records.map(r=>{
    if (!r || typeof r.id!=="string" || !/^[a-zA-Z0-9-]{1,80}$/.test(r.id) || ids.has(r.id) || typeof r.label!=="string" || !r.label.trim() || r.label.length>120 || !Number.isFinite(r.time) || r.time<0 || r.time>8640000000000000 || !["Pendiente","Confirmada","Descartada"].includes(r.status) || typeof r.automatic!=="boolean" || !(r.score===null || (Number.isFinite(r.score)&&r.score>=0&&r.score<=1)) || typeof r.image!=="string" || r.image.length>4000000 || !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(r.image)) throw new Error("El respaldo contiene un registro inválido.");
    dataImageBlob(r.image);ids.add(r.id);
    return {id:r.id,label:r.label,time:r.time,status:r.status,automatic:r.automatic,score:r.score,image:r.image};
  });
}
$("exportBackup").addEventListener("click",()=>{
  downloadBlob(new Blob([JSON.stringify({format:"bosqyn-evidence",version:1,exportedAt:new Date().toISOString(),records})],{type:"application/json"}),"bosqyn-evidencias-"+new Date().toISOString().slice(0,10)+".json");
  report("Respaldo descargado con imágenes y metadatos. Consérvalo para recuperar las evidencias.");
});
$("importBackup").addEventListener("click",()=>$("backupInput").click());
$("backupInput").addEventListener("change",async e=>{
  const file=e.target.files[0];if(!file)return;
  $("importBackup").disabled=true;
  try {
    if (!storageReady) throw new Error("Almacenamiento local no disponible.");
    if(file.size>50*1024*1024)throw new Error("El respaldo supera el límite de 50 MB.");
    const incoming=validatedBackup(JSON.parse(await file.text()));
    const existing=new Set(records.map(r=>r.id)), fresh=incoming.filter(r=>!existing.has(r.id));
    await dbAction("records","readwrite",store=>{fresh.forEach(r=>store.add(r));});
    records=[...records,...fresh].sort((a,b)=>b.time-a.time);renderAll();
    report(fresh.length+" evidencias restauradas; "+(incoming.length-fresh.length)+" duplicadas omitidas. Los registros existentes se conservan.");
  } catch(error) {report("No se pudo restaurar el respaldo: "+error.message,"danger");}
  finally {e.target.value="";$("importBackup").disabled=false;}
});
$("resetSettings").addEventListener("click",()=>{
  Object.assign(config,{threshold:.85,persistence:3,cooldown:60,sound:true});
  for(const [id,value] of [["threshold",85],["persistence",3],["cooldown",60]]){$(id).value=value;$(id).oninput();}
  $("sound").checked=true;saveSettings();
});
