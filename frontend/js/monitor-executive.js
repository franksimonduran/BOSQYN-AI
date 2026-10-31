/* BOSQYN AI · Executive monitoring overview. Real data, existing map and models. */
window.Bosqyn=window.Bosqyn||{};
Bosqyn.monitorExecutive=(()=>{
 "use strict";
 const elem=(tag,cls,txt)=>{
   const el=document.createElement(tag);
   if(cls)el.className=cls;
   if(txt!==undefined)el.textContent=txt;
   return el;
 };
 const count=n=>Number.isFinite(Number(n))?Number(n).toLocaleString("es-PE"):"—";
 const date=s=>{const d=new Date(s);return s&&Number.isFinite(d.getTime())?d.toLocaleString("es-PE"):"Sin fecha";};
 const json=async url=>{
   const response=await fetch(url,{credentials:"same-origin",cache:"no-store"});
   if(!response.ok)throw Error("HTTP "+response.status);
   return response.json();
 };
 function mount({root,dashboard,livePanel,satCenter,modeLive,modeSat,getMap}){
   const tabs=dashboard.querySelector(".bosqyn-satellite-cards");
   const ipTab=dashboard.querySelector("#bosqyn-mode-ip");
   if(!tabs||!satCenter||!livePanel)return ()=>{};
   let active=true,task=null,serial=0;
   document.body.classList.add("bosqyn-monitor-page");
   root.classList.add("bosqyn-executive-monitor");

   const hero=elem("header","bosqyn-exec-hero");
   hero.innerHTML=[
     '<div class="bx-identity"><span class="bx-hero-icon" aria-hidden="true">◉</span><div>',
     '<span class="bx-overline">BOSQYN AI · GUARDIANES DE NUESTROS BOSQUES</span>',
     '<h1>Centro de Monitoreo</h1>',
     '<p>Sistema inteligente de vigilancia forestal y alerta temprana</p></div></div>',
     '<div class="bx-hero-status"><span class="bx-online"><i></i>Sistema en línea</span>',
     '<span id="bx-updated">Consultando fuentes…</span></div>'
   ].join("");
   const kpis=elem("section","bosqyn-exec-kpis");
   kpis.setAttribute("aria-label","Indicadores reales de BOSQYN IA");
   kpis.innerHTML=[
     '<article class="bx-kpi"><span class="bx-kpi-icon">▣</span><div><span>Cámaras IP conectadas</span><strong id="bx-cameras">—</strong><small id="bx-cameras-note">Acceso administrador</small></div></article>',
     '<article class="bx-kpi bx-danger"><span class="bx-kpi-icon">♧</span><div><span>Alertas pendientes</span><strong id="bx-pending">—</strong><small>Por verificar en historial</small></div></article>',
     '<article class="bx-kpi"><span class="bx-kpi-icon">◈</span><div><span>Evidencias registradas</span><strong id="bx-total">—</strong><small>Base de datos real</small></div></article>',
     '<article class="bx-kpi bx-satellite"><span class="bx-kpi-icon">◎</span><div><span>Observaciones satelitales</span><strong id="bx-sat-count">—</strong><small>NASA FIRMS + NOAA GOES-19</small></div></article>'
   ].join("");
   dashboard.prepend(kpis);dashboard.prepend(hero);

   const overview=elem("button","bosqyn-satellite-choice bx-overview-tab");
   overview.type="button";overview.id="bosqyn-mode-overview";
   overview.setAttribute("role","tab");overview.setAttribute("aria-selected","true");
   overview.innerHTML='<span class="choice-title">◈ &nbsp; Vista general</span><span class="choice-art" aria-hidden="true">▦</span><span class="choice-desc">Centro de control</span>';
   tabs.prepend(overview);

   const stage=elem("div","bosqyn-exec-stage");
   stage.setAttribute("aria-label","Cámara, satélite y alertas");
   const side=elem("aside","bosqyn-exec-alerts");
   side.innerHTML=[
      '<div class="bx-widget-head"><h2>Alertas recientes</h2><a href="#alertas">Ver todas ↗</a></div>',
      '<div id="bx-alert-feed" class="bx-alert-feed"><p class="bx-empty">Consultando evidencias…</p></div>',
      '<p class="bx-caption">Clasificaciones sujetas a revisión humana.</p>'
   ].join("");
   stage.append(livePanel,satCenter,side);
   tabs.after(stage);
   const status=root.querySelector(".bosqyn-camera-status");
   if(status)livePanel.prepend(status);

   const lower=elem("section","bosqyn-exec-lower");
   lower.setAttribute("aria-label","Resumen de actividad real");
   lower.innerHTML=[
     '<article class="bx-widget"><div class="bx-widget-head"><h2>Tendencias de evidencias</h2><span>7 días · UTC</span></div>',
     '<div class="bx-graph"><img id="bx-chart" alt="Gráfico real Matplotlib de evidencias de siete días" src="/api/statistics/chart.png?demo=0"></div>',
     '<p class="bx-caption">Matplotlib · registros de SQLite, sin datos simulados.</p></article>',
     '<article class="bx-widget"><div class="bx-widget-head"><h2>Distribución de evidencias</h2><span>Registros recientes</span></div>',
     '<div id="bx-classes" class="bx-class-list"><p class="bx-empty">Consultando clases…</p></div>',
     '<p class="bx-caption">Categorías observadas, no precisión de la IA.</p></article>',
     '<article class="bx-widget"><div class="bx-widget-head"><h2>Ecosistema BOSQYN</h2><span>Acceso rápido</span></div>',
     '<div class="bx-systems"><button type="button" data-bx-open="ip"><b>▣</b><strong>Cámaras IP</strong><small id="bx-sys-cams">Por consultar</small></button>',
     '<button type="button" data-bx-open="live"><b>◉</b><strong>Cámara + audio</strong><small>IA unificada</small></button>',
     '<button type="button" data-bx-open="satellite"><b>◎</b><strong>Satélites</strong><small id="bx-sys-sat">NASA y NOAA</small></button></div>',
     '<p class="bx-caption">El video de drones requiere una conexión real.</p></article>'
   ].join("");
   stage.after(lower);
   const $=id=>dashboard.querySelector("#"+id);
   const invalidate=()=>{
     const map=getMap?.();
     if(map)requestAnimationFrame(()=>setTimeout(()=>map.invalidateSize(),110));
   };
   function setMode(value){
     dashboard.dataset.executiveMode=value;
     [[overview,"overview"],[modeLive,"live"],[modeSat,"satellite"],[ipTab,"ip"]].forEach(([button,key])=>{
       button?.setAttribute("aria-selected",String(key===value));
     });
     lower.hidden=value!=="overview";
     side.hidden=value!=="overview";
     if(value==="overview"||value==="satellite")invalidate();
   }
   const showOverview=()=>{
     // Reuse the original mode switch to hide the IP panel and release the webcam.
     modeSat.click();
     livePanel.hidden=false;satCenter.hidden=false;
     setMode("overview");
   };
   const showLive=()=>setMode("live");
   const showSat=()=>setMode("satellite");
   const showIP=()=>setMode("ip");
   overview.addEventListener("click",showOverview);
   modeLive.addEventListener("click",showLive);
   modeSat.addEventListener("click",showSat);
   ipTab?.addEventListener("click",showIP);
   lower.querySelectorAll("[data-bx-open]").forEach(btn=>btn.addEventListener("click",()=>{
     const to=btn.dataset.bxOpen;
     if(to==="ip")ipTab?.click();
     else if(to==="live")modeLive.click();
     else modeSat.click();
     dashboard.scrollIntoView({behavior:"smooth",block:"start"});
   }));

   function displayAlerts(items){
     const target=$("bx-alert-feed");target.replaceChildren();
     if(!items.length){target.append(elem("p","bx-empty","Sin alertas. Las evidencias reales aparecerán aquí."));return;}
     const symbols={INCENDIO:"♨",HUMO:"☁",TALA:"♧",NORMAL:"✧"};
     for(const item of items.slice(0,5)){
       const link=elem("a","bx-alert-row");link.href="#alertas";
       const icon=elem("span","bx-alert-icon "+String(item.category||"").toLowerCase(),symbols[item.category]||"!");
       const info=elem("span","bx-alert-info");
       info.append(elem("strong",null,String(item.category||"EVENTO")+" · "+String(item.status||"PENDIENTE")));
       info.append(elem("small",null,date(item.occurred_at)+(item.confidence==null?" · captura": " · "+Math.round(Number(item.confidence)*100)+"% del modelo")));
       link.append(icon,info);target.append(link);
     }
   }
   function displayDistribution(items){
     const target=$("bx-classes");target.replaceChildren();
     if(!items.length){target.append(elem("p","bx-empty","Sin evidencias para calcular proporciones."));return;}
     const groups=new Map();
     for(const item of items){
       const key=String(item.category||"SIN CLASE").toUpperCase();
       groups.set(key,(groups.get(key)||0)+1);
     }
     [...groups.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).forEach(([key,n])=>{
       const row=elem("div","bx-class-row");
       const name=elem("span","bx-class-name",key),track=elem("span","bx-class-track");
       const fill=elem("span","bx-class-fill "+key.toLowerCase());
       fill.style.width=(n/items.length*100).toFixed(1)+"%";
       track.append(fill);row.append(name,track,elem("b",null,String(n)));target.append(row);
     });
   }
   async function reload(){
     if(!active)return;
     const request=++serial;
     const results=await Promise.allSettled([
       json("/api/statistics"),
       json("/api/alerts?limit=200"),
       json("/api/satellite/events"),
       Bosqyn.auth?.role()==="admin"?json("/api/ip-cameras"):Promise.resolve(null),
       json("/api/satellite/status")
     ]);
     if(!active||request!==serial)return;
     const [stats,alerts,events,cameras,source]=results;
     $("bx-total").textContent=stats.status==="fulfilled"?count(stats.value.total):"—";
     $("bx-pending").textContent=stats.status==="fulfilled"?count(stats.value.by_status?.PENDIENTE||0):"—";
     if(alerts.status==="fulfilled"){
       displayAlerts(alerts.value.items||[]);
       displayDistribution(alerts.value.items||[]);
     }else{
       $("bx-alert-feed").replaceChildren(elem("p","bx-empty","Inicia sesión para consultar el historial."));
       $("bx-classes").replaceChildren(elem("p","bx-empty","Distribución no disponible."));
     }
     $("bx-sat-count").textContent=events.status==="fulfilled"?count(events.value.events?.length||0):"—";
     if(cameras.status==="fulfilled"&&cameras.value){
       const all=cameras.value.items||[],online=all.filter(v=>v.connected).length;
       $("bx-cameras").textContent=online+" / "+all.length;
       $("bx-cameras-note").textContent="Conectadas / registradas";
       $("bx-sys-cams").textContent=online+" conectadas · "+all.length+" registradas";
     }else{
       $("bx-cameras").textContent="—";$("bx-cameras-note").textContent="Acceso administrador";
       $("bx-sys-cams").textContent="Acceso administrador";
     }
     if(source.status==="fulfilled"){
       const feeds=source.value.feeds||{};
       $("bx-sys-sat").textContent="NASA: "+(feeds.NASA?.status||"sin datos")+" · NOAA: "+(feeds.NOAA?.status||"sin datos");
     }
     $("bx-updated").textContent="Consultado: "+new Date().toLocaleTimeString("es-PE");
   }
   const chart=$("bx-chart");
   chart.addEventListener("error",()=>{
     chart.hidden=true;
     chart.parentElement.append(elem("p","bx-empty","Gráfico real no disponible temporalmente."));
   },{once:true});
   const onAuth=()=>reload();
   window.addEventListener("bosqyn:auth-changed",onAuth);
   task=setInterval(reload,60000);
   overview.click();reload();
   return ()=>{
     active=false;serial++;clearInterval(task);
     window.removeEventListener("bosqyn:auth-changed",onAuth);
     overview.removeEventListener("click",showOverview);
     modeLive.removeEventListener("click",showLive);
     modeSat.removeEventListener("click",showSat);
     ipTab?.removeEventListener("click",showIP);
     document.body.classList.remove("bosqyn-monitor-page");
     root.classList.remove("bosqyn-executive-monitor");
   };
 }
 return {mount};
})();