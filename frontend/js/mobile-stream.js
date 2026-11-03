/* BOSQYN AI · Cámara del celular por Internet HTTPS.
   Solo transmite fotogramas JPEG mientras esta pantalla permanezca abierta. */
window.Bosqyn=window.Bosqyn||{};
Bosqyn.mobileStream=(()=>{
  "use strict";
  function mount(panel,onRefresh){
    const start=panel.querySelector("#ip-mobile-start");
    const stopButton=panel.querySelector("#ip-mobile-stop");
    const preview=panel.querySelector("#ip-mobile-preview");
    const notice=panel.querySelector("#ip-mobile-notice");
    const box=panel.querySelector("#ip-mobile-stream");
    if(!start||!stopButton||!preview||!notice||!box)return ()=>{};
    let running=false,busy=false,stream=null,cameraId=null,abort=null,timeout=null,failures=0;
    const canvas=document.createElement("canvas");
    const status=msg=>{notice.textContent=msg;};
    const api=async(path,body)=>{
      const r=await fetch(path,{method:"POST",credentials:"same-origin",cache:"no-store",
        headers:{"Content-Type":"application/json","X-Bosqyn-Action":"1"},
        body:JSON.stringify(body||{})});
      const data=await r.json().catch(()=>({}));
      if(!r.ok)throw Error(data.error||"HTTP "+r.status);
      return data;
    };
    function stopLocal(){
      running=false;
      if(timeout!==null){clearTimeout(timeout);timeout=null;}
      abort?.abort();abort=null;
      stream?.getTracks().forEach(track=>track.stop());stream=null;
      preview.pause();preview.srcObject=null;
      start.disabled=false;start.hidden=false;stopButton.hidden=true;
      box.classList.remove("is-streaming");
    }
    async function stop(){
      const id=cameraId;cameraId=null;
      stopLocal();
      if(id){
        try{await api("/api/ip-cameras/"+id+"/action",{action:"disconnect"});}
        catch{/* La sesión puede haber caducado; los fotogramas expiran solos. */}
        onRefresh?.();
      }
      status("Transmisión detenida. No se envían imágenes con la cámara apagada.");
    }
    const frameBlob=()=>new Promise((resolve,reject)=>{
      canvas.toBlob(blob=>blob?resolve(blob):reject(Error("No se pudo codificar la imagen")),"image/jpeg",0.65);
    });
    async function push(){
      if(!running||!stream?.active||!cameraId)return;
      try{
        if(preview.readyState<2)throw Error("Esperando imagen del celular");
        const w=preview.videoWidth,h=preview.videoHeight;
        if(!w||!h)throw Error("No hay fotograma de cámara");
        canvas.width=Math.round(Math.min(640,w));
        canvas.height=Math.round(canvas.width*h/w);
        canvas.getContext("2d",{alpha:false}).drawImage(preview,0,0,canvas.width,canvas.height);
        const jpeg=await frameBlob();
        if(jpeg.size>480000)throw Error("Imagen demasiado grande");
        if(!running)return;
        abort=new AbortController();
        const response=await fetch("/api/ip-cameras/"+cameraId+"/mobile/frame",{
          method:"POST",credentials:"same-origin",cache:"no-store",
          headers:{"Content-Type":"image/jpeg","X-Bosqyn-Action":"1"},
          body:jpeg,signal:abort.signal
        });
        const result=await response.json().catch(()=>({}));
        if(!response.ok)throw Error(result.error||"HTTP "+response.status);
        failures=0;
        status("Transmitiendo por Internet · 1 imagen por segundo · Mantén esta pestaña abierta.");
      }catch(error){
        if(!running)return;
        failures++;
        status("No se pudo enviar la imagen: "+error.message);
        if(failures>=5){
          await stop();
          status("Transmisión detenida tras varios errores de conexión. Revisa tu Internet e inicia nuevamente.");
          return;
        }
      }finally{abort=null;}
      if(running)timeout=setTimeout(push,failures?2400:1100);
    }
    async function begin(){
      if(running||busy)return;
      if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){
        status("Necesitas HTTPS y un navegador que permita acceso a la cámara.");
        return;
      }
      busy=true;start.disabled=true;
      try{
        if(!await Bosqyn.auth?.ensureAdmin("Inicia sesión como administrador para transmitir desde tu celular.")){
          return;
        }
        status("Solicitando permiso para usar la cámara…");
        stream=await navigator.mediaDevices.getUserMedia({
          video:{facingMode:{ideal:"environment"},width:{ideal:640},height:{ideal:480}},
          audio:false
        });
        preview.srcObject=stream;
        await preview.play();
        status("Registrando cámara móvil segura…");
        const list=await fetch("/api/ip-cameras",{credentials:"same-origin",cache:"no-store"});
        if(!list.ok)throw Error("No se pudo consultar las cámaras registradas");
        const items=(await list.json()).items||[];
        let camera=items.find(c=>c.protocol==="MOVIL/HTTPS"&&c.desired!=="on");
        if(!camera){
          const saved=await api("/api/ip-cameras/mobile",{name:"Celular por Internet"});
          camera=saved.camera;
        }
        cameraId=camera.id;
        await api("/api/ip-cameras/"+cameraId+"/action",{action:"connect"});
        running=true;failures=0;
        start.hidden=true;stopButton.hidden=false;box.classList.add("is-streaming");
        onRefresh?.();
        await push();
      }catch(error){
        const id=cameraId;cameraId=null;stopLocal();
        if(id)api("/api/ip-cameras/"+id+"/action",{action:"disconnect"}).catch(()=>{});
        status("No se pudo iniciar: "+error.message);
      }finally{busy=false;if(!running)start.disabled=false;}
    }
    const leave=()=>{stopLocal();};
    const authChange=()=>{if(running&&Bosqyn.auth?.role()!=="admin")stop();};
    start.addEventListener("click",begin);
    stopButton.addEventListener("click",stop);
    window.addEventListener("pagehide",leave);
    window.addEventListener("bosqyn:auth-changed",authChange);
    return ()=>{
      const id=cameraId;cameraId=null;stopLocal();
      if(id)api("/api/ip-cameras/"+id+"/action",{action:"disconnect"}).catch(()=>{});
      start.removeEventListener("click",begin);
      stopButton.removeEventListener("click",stop);
      window.removeEventListener("pagehide",leave);
      window.removeEventListener("bosqyn:auth-changed",authChange);
    };
  }
  return {mount};
})();
