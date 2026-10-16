window.Bosqyn=window.Bosqyn||{};Bosqyn.pages=Bosqyn.pages||{};
Bosqyn.pages.estadisticas=function(root){
 const panel=document.createElement('section');panel.className='bosqyn-stats-compact';
 const title=document.createElement('h2');title.textContent='Estadísticas reales del servidor Python';
 const value=document.createElement('p');value.setAttribute('role','status');value.textContent='Consultando SQLite...';
 const notice=document.createElement('p');notice.textContent='Los contadores son capturas manuales; no representan precisión ni eficacia del modelo de IA.';
 panel.append(value,notice);root.prepend(panel);
 fetch('/api/statistics',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Sin API');return r.json()}).then(data=>{
  if(!panel.isConnected)return;
  const s=data.by_status;value.textContent=data.total+' capturas guardadas · '+(s.PENDIENTE||0)+' pendientes · '+(s.CONFIRMADA||0)+' confirmadas · '+(s.DESCARTADA||0)+' descartadas.';
 }).catch(()=>{if(panel.isConnected)value.textContent='Para ver los datos reales ejecuta python -m backend.server.'});
};