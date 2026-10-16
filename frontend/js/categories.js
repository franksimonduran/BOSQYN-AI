/* BOSQYN AI — categoría/iconografía compartida en las pantallas.
   Mantiene los archivos originales subidos a frontend/img/deteccion/. */
window.Bosqyn=window.Bosqyn||{};
Bosqyn.categories=(()=>{
  'use strict';
  const map={
    'HUMO':{label:'Humo',icon:'Humo.png'},
    'INCENDIO':{label:'Incendio',icon:'Fuego.png'},
    'FUEGO':{label:'Incendio',icon:'Fuego.png'},
    'NORMAL':{label:'Normal',icon:'Bosque.png'},
    'IR AL BOSQUE':{label:'Ir al bosque',icon:'Ir%20al%20bosque.png'},
    'TALA':{label:'Tala',icon:'Tala.png'},
    'INDICIOS TALA':{label:'Tala',icon:'Tala.png'},
    'INDICIOS DE TALA':{label:'Tala',icon:'Tala.png'},
    'NEBLINA':{label:'Neblina (ejemplo)',icon:'Bosque.png'},
    'NEBLINA/NUBES':{label:'Neblina (ejemplo)',icon:'Bosque.png'},
    'REVISION MANUAL':{label:'Revisión manual',icon:'Bosque.png'}
  };
  const canonical=name=>String(name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/[_-]+/g,' ').replace(/\s+/g,' ').toUpperCase();
  const info=name=>map[canonical(name)]||null;
  function icon(name,cssClass='bosqyn-category-inline-icon'){
    const data=info(name);
    if(!data)return null;
    const img=document.createElement('img');
    img.src='img/deteccion/'+data.icon;
    img.alt='';
    img.setAttribute('aria-hidden','true');
    img.className=cssClass;
    return img;
  }
  function decorate(root){
    if(!root)return;
    root.querySelectorAll('span,b,strong').forEach(element=>{
      if(element.closest('.bosqyn-detection-options,.bosqyn-logo-inline,.bosqyn-combined-title,.bosqyn-category-tag'))return;
      if(element.children.length)return;
      const label=element.textContent.trim();
      if(!info(label))return;
      const image=icon(label);
      if(!image)return;
      element.classList.add('bosqyn-category-tag');
      element.replaceChildren(image,document.createTextNode(label));
    });
  }
  return {canonical,info,icon,decorate};
})();
