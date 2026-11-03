window.Bosqyn = window.Bosqyn || {};
Bosqyn.pages = Bosqyn.pages || {};
Bosqyn.pages.estadisticas = function (root) {
  "use strict";
  const $ = id => root.querySelector("#" + id);
  const names = [
    ["INCENDIO", "Incendio", "img/deteccion/Fuego.png", "#fb8876"],
    ["HUMO", "Humo", "img/deteccion/Humo.png", "#92b7ee"],
    ["TALA", "Tala", "img/deteccion/Tala.png", "#e4ba6c"],
    ["NORMAL", "Normal", "img/deteccion/Bosque.png", "#49d894"],
    ["IR_AL_BOSQUE", "Ir al bosque", "img/deteccion/Ir%20al%20bosque.png", "#7bc5b0"]
  ];
  const sources = {
    VISION_AUTOMATICA:"Visión automática",
    CAPTURA_MANUAL:"Captura manual",
    AUDIO_AUTOMATICO:"Audio automático",
    CAMARA_IP:"Cámara IP"
  };
  const labels = {PENDIENTE:"Pendientes",CONFIRMADA:"Confirmadas",DESCARTADA:"Descartadas"};
  const colors = {PENDIENTE:"#e8b969",CONFIRMADA:"#43d58c",DESCARTADA:"#f18a80"};
  const period = $("stats-days"), chart = $("stats-chart"), message = $("stats-message");
  const button = $("stats-refresh");
  let active = true, controller = null, seq = 0, objectURL = null;

  function number(v) { return Number(v || 0).toLocaleString("es-PE"); }
  function div(className) { const e=document.createElement("div");e.className=className;return e; }
  function plain(tag, value, className) {
    const e=document.createElement(tag);
    e.textContent=value;
    if(className)e.className=className;
    return e;
  }
  function barRow(label, count, total, color, image) {
    const row=div("bsd-bar-row");
    const heading=div("bsd-bar-heading");
    const title=div("bsd-bar-title");
    if(image) {
      const img=document.createElement("img");img.src=image;img.alt="";img.loading="lazy";
      title.append(img);
    }
    title.append(plain("span",label));
    heading.append(title,plain("strong",number(count)+" · "+(total? (100*count/total).toFixed(1):"0")+"%"));
    const track=div("bsd-track"), fill=div("bsd-fill");
    fill.style.background=color;
    fill.style.width=(total?100*count/total:0)+"%";
    track.append(fill);row.append(heading,track);return row;
  }
  function renderCategories(data) {
    const target=$("stats-categories");target.replaceChildren();
    const counts=data.by_category||{}, total=Number(data.total)||0;
    const known=new Set(names.map(([id])=>id));
    for(const [id,label,img,color] of names) {
      target.append(barRow(label,Number(counts[id]||0),total,color,img));
    }
    const others=Object.entries(counts).filter(([key])=>!known.has(key))
      .reduce((sum,[,value])=>sum+Number(value||0),0);
    if(others)target.append(barRow("Otras / sin clasificación",others,total,"#9bb4a6"));
    if(!total)target.append(plain("p","No hay evidencias registradas en este período.","bsd-muted"));
  }
  function renderReviews(data) {
    const counts=data.by_status||{},total=Number(data.total)||0;
    $("stats-pending").textContent=number(counts.PENDIENTE);
    $("stats-confirmed").textContent=number(counts.CONFIRMADA);
    $("stats-discarded").textContent=number(counts.DESCARTADA);
    const target=$("stats-review-bars");target.replaceChildren();
    for(const id of ["PENDIENTE","CONFIRMADA","DESCARTADA"]) {
      target.append(barRow(labels[id],Number(counts[id]||0),total,colors[id]));
    }
  }
  function renderSources(data) {
    const target=$("stats-sources");target.replaceChildren();
    const entries=Object.entries(data.by_source||{}).sort((a,b)=>b[1]-a[1]);
    if(!entries.length) {target.append(plain("p","Sin fuentes con evidencias registradas.","bsd-muted"));return;}
    for(const [key,value] of entries) {
      target.append(barRow(sources[key]||key.replaceAll("_"," ").toLowerCase(),Number(value),Number(data.total)||0,"#5ad9a1"));
    }
  }
  async function renderCameras(signal) {
    const target=$("stats-cameras");
    if(Bosqyn.auth?.role()!=="admin") {
      target.textContent="Accede como administrador para consultar las cámaras IP.";
      return;
    }
    try {
      const r=await fetch("/api/ip-cameras",{cache:"no-store",credentials:"same-origin",signal});
      if(!r.ok)throw Error("Sin acceso a cámaras");
      const data=await r.json();
      if(!active||signal.aborted)return;
      const cameras=data.items||[], online=cameras.filter(c=>c.connected).length;
      target.replaceChildren();
      target.append(plain("strong",online+" / "+cameras.length+" conectadas"));
      target.append(plain("p","Cámaras conectadas / registradas","bsd-muted"));
      for(const camera of cameras.slice(0,8)) {
        const item=div("bsd-camera-item");
        item.append(plain("span",camera.name),plain("span",camera.connected?"Conectada":"Sin señal",camera.connected?"bsd-connected":"bsd-offline"));
        target.append(item);
      }
    } catch(err) {
      if(!signal.aborted&&active)target.textContent="Estado de cámaras no disponible.";
    }
  }
  async function refresh() {
    const current=++seq;
    controller?.abort();
    controller=new AbortController();
    const signal=controller.signal;
    const days=Number(period.value);
    button.disabled=true;
    message.textContent="Actualizando registros…";
    $("stats-period").textContent="Evidencias del historial · últimos "+days+" días · UTC";
    try {
      const response=await fetch("/api/statistics?days="+days,{cache:"no-store",signal,credentials:"same-origin"});
      if(!response.ok)throw Error("No se pudieron consultar estadísticas");
      const data=await response.json();
      if(!active||current!==seq)return;
      const cat=data.by_category||{};
      $("stats-total").textContent=number(data.total);
      $("stats-fire").textContent=number(Number(cat.INCENDIO||0)+Number(cat.HUMO||0));
      $("stats-logging").textContent=number(cat.TALA);
      renderCategories(data);
      renderReviews(data);
      renderSources(data);
      const cameraTask=renderCameras(signal);
      const graphic=await fetch("/api/statistics/chart.png?days="+days+"&demo=0",{cache:"no-store",credentials:"same-origin",signal});
      if(!graphic.ok||!graphic.headers.get("Content-Type")?.includes("image/png"))throw Error("Gráfico Matplotlib no disponible");
      const blob=await graphic.blob();
      if(!active||current!==seq)return;
      const url=URL.createObjectURL(blob),previous=objectURL;
      chart.src=url;objectURL=url;
      if(previous)URL.revokeObjectURL(previous);
      message.textContent=Number(data.total)?"Datos actualizados · Registros reales.":"Sin evidencias guardadas para este período.";
      await cameraTask;
    }catch(err) {
      if(err.name!=="AbortError"&&active&&current===seq)message.textContent="No se pudo actualizar: "+err.message;
    }finally {if(active&&current===seq)button.disabled=false;}
  }
  const onAuth=()=>refresh();
  period.addEventListener("change",refresh);
  button.addEventListener("click",refresh);
  window.addEventListener("bosqyn:auth-changed",onAuth);
  refresh();
  return ()=>{
    active=false;seq++;controller?.abort();
    window.removeEventListener("bosqyn:auth-changed",onAuth);
    if(objectURL)URL.revokeObjectURL(objectURL);
  };
};
