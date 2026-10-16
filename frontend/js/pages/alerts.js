window.Bosqyn=window.Bosqyn||{};Bosqyn.pages=Bosqyn.pages||{};
Bosqyn.pages.alertas=function(root){

  const panel=document.createElement('section');
  panel.className='bosqyn-real-panel';
  const heading=document.createElement('h2');heading.textContent='Capturas reales guardadas en Python';
  const explanation=document.createElement('p');explanation.textContent='Registros de webcam almacenados en SQLite. Una captura manual no significa detección automática.';
  const status=document.createElement('p');status.className='bosqyn-real-status';status.setAttribute('role','status');
  const list=document.createElement('div');list.className='bosqyn-real-list';
  const refresh=document.createElement('button');refresh.type='button';refresh.className='bosqyn-action';refresh.textContent='Actualizar registros';
  panel.append(heading,explanation,refresh,status,list);
  root.prepend(panel);
  const demo=document.createElement('div');demo.className='bosqyn-demo-label';
  demo.textContent='TABLA DE EJEMPLO · ESTAS FILAS NO PROCEDEN DEL MODELO DE IA';
  panel.after(demo);
  function button(text,callback){
    const b=document.createElement('button');b.type='button';b.className='bosqyn-action';b.textContent=text;b.addEventListener('click',callback);return b;
  }
  async function change(id,method,payload){
    try{
      const response=await fetch('/api/alerts/'+id,{
        method,headers:payload?{'Content-Type':'application/json'}:{},
        body:payload?JSON.stringify(payload):undefined
      });
      if(!response.ok)throw Error('No se pudo modificar el registro');
      await load();
    }catch(error){status.textContent='Error: '+error.message}
  }
  async function load(){
    status.textContent='Consultando Python...';
    try{
      const response=await fetch('/api/alerts?limit=100',{cache:'no-store'});
      if(!response.ok)throw Error('API no disponible');
      const data=await response.json();
      if(!panel.isConnected)return;
      list.replaceChildren();
      status.textContent=data.total+' captura(s) manual(es) guardada(s).';
      if(!data.items.length){
        const empty=document.createElement('p');
        empty.textContent='Todavía no hay capturas. Ve a Monitoreo e inicia la webcam.';
        list.append(empty);
      }
      for(const item of data.items){
        const card=document.createElement('article');card.className='bosqyn-real-card';
        const img=document.createElement('img');img.src=item.evidence_url;img.alt='Captura manual '+item.id;img.loading='lazy';
        const content=document.createElement('div');
        const title=document.createElement('strong');title.textContent='#'+item.id+' · '+item.category;
        const info=document.createElement('p');info.textContent=item.occurred_at+' · '+item.status;
        const actions=document.createElement('div');actions.className='bosqyn-real-actions';
        actions.append(button('Confirmar',()=>change(item.id,'PATCH',{status:'CONFIRMADA'})),
          button('Descartar',()=>change(item.id,'PATCH',{status:'DESCARTADA'})),
          button('Eliminar',()=>{if(window.confirm('¿Eliminar esta captura y su imagen?'))change(item.id,'DELETE')}));
        content.append(title,info,actions);card.append(img,content);list.append(card);
      }
    }catch(error){
      if(panel.isConnected)status.textContent='Inicia el servidor con python -m backend.server. La tabla de abajo es ilustrativa.';
    }
  }
  refresh.addEventListener('click',load);load();

const FBASE='h-[27px] rounded-[7px] border px-[12px] text-[9.5px] font-medium ',FON='border-[#22c55e] bg-[#16a34a] text-white',FOFF='border-white/10 bg-white/[0.05] text-[#dbe6e0]',PBASE='flex h-[28px] w-[28px] items-center justify-center rounded-[6px] border text-[10px] ',PON='border-[#22c55e] bg-[#16a34a] font-bold text-white',POFF='border-white/10 bg-white/[0.05] text-[#dbe6e0]';
let rows=[...root.querySelectorAll('[data-row]')],filters=[...root.querySelectorAll('[data-filter]')],pages=[...root.querySelectorAll('[data-pg]')],counter=root.querySelector('#count'),filter='todas',page=1;
function category(row){let src=row.querySelector('img')?.getAttribute('src')||'';return (src.match(/a-(\w+)\.jpg/)||[])[1]||'desconocido'}
function render(){let match=rows.filter(r=>filter==='todas'||category(r)===filter),max=Math.max(1,Math.ceil(match.length/5));page=Math.min(page,max);let shown=match.slice((page-1)*5,page*5);rows.forEach(r=>r.style.display=shown.includes(r)?'':'none');if(counter)counter.textContent='Mostrando '+shown.length+' de '+match.length+' registros de ejemplo';filters.forEach(b=>b.className=FBASE+(b.dataset.filter===filter?FON:FOFF));pages.forEach(b=>{let key=b.dataset.pg,n=Number(key);b.style.display=(key==='prev'||key==='next'||n<=max)?'':'none';b.disabled=key==='prev'&&page===1||key==='next'&&page===max;b.className=PBASE+(n===page?PON:POFF)})}
filters.forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.filter;page=1;render()}));
pages.forEach(b=>b.addEventListener('click',()=>{let key=b.dataset.pg,max=Math.max(1,Math.ceil(rows.filter(r=>filter==='todas'||category(r)===filter).length/5));page=key==='prev'?Math.max(1,page-1):key==='next'?Math.min(max,page+1):Math.min(max,Number(key));render()}));
rows.forEach(row=>{let acts=row.querySelectorAll('[data-act]');if(acts[0])acts[0].addEventListener('click',()=>{let img=row.querySelector('img');if(img)window.open(img.src,'_blank','noopener')});if(acts[1])acts[1].addEventListener('click',()=>{let st=row.querySelector('[data-estado]');if(st){st.className='inline-flex h-[20px] items-center rounded-[5px] border px-[9px] text-[9px] not-italic border-[#15803d]/60 bg-[#14532d]/50 text-[#4ade80]';st.textContent='Confirmada'}});if(acts[2])acts[2].addEventListener('click',()=>{row.remove();rows=rows.filter(x=>x!==row);render()})});render();
};