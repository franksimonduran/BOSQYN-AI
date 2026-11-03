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
    const audioOption=panel.querySelector("#ip-mobile-audio");
    const box=panel.querySelector("#ip-mobile-stream");
    if(!start||!stopButton||!preview||!notice||!box)return ()=>{};
    let running=false,busy=false,stream=null,cameraId=null,abort=null,timeout=null,failures=0;
    let audioContext=null,audioSource=null,audioProcessor=null,audioSamples=0,audioChunks=[],audioSending=false,audioDisabled=false;
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
    function closeAudio(){
      audioDisabled=true;
      if(audioProcessor){audioProcessor.disconnect();audioProcessor.onaudioprocess=null;audioProcessor=null;}
      audioSource?.disconnect();audioSource=null;
      if(audioContext){audioContext.close().catch(()=>{});audioContext=null;}
      audioChunks=[];audioSamples=0;audioSending=false;
    }
    function pcm16(samples,sourceRate){
      const length=48000; // 3 segundos a 16 kHz = 96000 bytes PCM16 mono.
      const result=new ArrayBuffer(length*2);
      const view=new DataView(result);
      for(let i=0;i<length;i++){
        const pos=i*sourceRate/16000,low=Math.min(samples.length-1,Math.floor(pos));
        const high=Math.min(samples.length-1,low+1),fraction=pos-low;
        const sample=Math.max(-1,Math.min(1,samples[low]*(1-fraction)+samples[high]*fraction));
        view.setInt16(i*2,sample<0?sample*32768:sample*32767,true);
      }
      return result;
    }
    async function sendAudio(buffer){
      if(!running||!cameraId||audioSending||audioDisabled)return;
      audioSending=true;
      try{
        const response=await fetch("/api/ip-cameras/"+cameraId+"/mobile/audio",{
          method:"POST",credentials:"same-origin",cache:"no-store",
          headers:{"Content-Type":"application/octet-stream","X-Bosqyn-Action":"1","X-Bosqyn-Sample-Rate":"16000"},
          body:buffer
        });
        const reply=await response.json().catch(()=>({}));
        if(!response.ok)throw Error(reply.error||"HTTP "+response.status);
      }catch(error){
        // La cámara visual sigue funcionando si el modelo acústico no está disponible.
        if(running){
          status("Video activo; audio no disponible: "+error.message);
          closeAudio();
          stream?.getAudioTracks().forEach(track=>track.stop());
        }
      }finally{audioSending=false;}
    }
    async function openAudio(){
      if(!stream?.getAudioTracks().length)return;
      const Context=window.AudioContext||window.webkitAudioContext;
      if(!Context)throw Error("Tu navegador no admite procesamiento de audio");
      audioContext=new Context();
      if(audioContext.state==="suspended")await audioContext.resume();
      audioSource=audioContext.createMediaStreamSource(stream);
      audioProcessor=audioContext.createScriptProcessor(4096,1,1);
      audioDisabled=false;
      audioProcessor.onaudioprocess=event=>{
        if(!running||audioDisabled)return;
        const values=event.inputBuffer.getChannelData(0);
        audioChunks.push(new Float32Array(values));
        audioSamples+=values.length;
        const needed=Math.round(audioContext.sampleRate*3);
        if(audioSamples<needed)return;
        const gathered=new Float32Array(needed);
        let offset=0;
        for(const chunk of audioChunks){
          const amount=Math.min(chunk.length,needed-offset);
          gathered.set(chunk.subarray(0,amount),offset);
          offset+=amount;
          if(offset>=needed)break;
        }
        audioChunks=[];audioSamples=0;
        if(!audioSending)sendAudio(pcm16(gathered,audioContext.sampleRate));
      };
      audioSource.connect(audioProcessor);
      audioProcessor.connect(audioContext.destination);
    }
    function stopLocal(){
      running=false;
      if(timeout!==null){clearTimeout(timeout);timeout=null;}
      abort?.abort();abort=null;
      closeAudio();
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
        status("Cámara móvil #"+cameraId+" · Imágenes recibidas por BOSQYN AI · Mantén esta pestaña abierta en el celular y utiliza otro dispositivo para visualizar.");
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
          audio:audioOption?.checked?{echoCancellation:false,noiseSuppression:false,autoGainControl:false}:false
        });
        preview.srcObject=stream;
        await preview.play();
        status("Registrando cámara móvil segura… No necesitas URL 192.168.x.x.");
        const list=await fetch("/api/ip-cameras",{credentials:"same-origin",cache:"no-store"});
        if(!list.ok)throw Error("No se pudo consultar las cámaras registradas");
        const items=(await list.json()).items||[];
        let camera=items.find(c=>c.protocol==="MOVIL/HTTPS"&&c.desired!=="on"&&Boolean(c.audio_enabled)===Boolean(audioOption?.checked));
        if(!camera){
          const saved=await api("/api/ip-cameras/mobile",{name:"Celular por Internet",audio_enabled:Boolean(audioOption?.checked)});
          camera=saved.camera;
        }
        cameraId=camera.id;
        await api("/api/ip-cameras/"+cameraId+"/action",{action:"connect"});
        running=true;failures=0;
        if(audioOption?.checked) {
          try { await openAudio(); }
          catch(audioError) {
            closeAudio();
            stream?.getAudioTracks().forEach(track=>track.stop());
            status("Micrófono no disponible: "+audioError.message+". Continuamos con video.");
          }
        }
        start.hidden=true;stopButton.hidden=false;box.classList.add("is-streaming");
        onRefresh?.();
        await push();
      }catch(error){
        const id=cameraId;cameraId=null;stopLocal();
        if(id)api("/api/ip-cameras/"+id+"/action",{action:"disconnect"}).catch(()=>{});
        status("No se pudo iniciar la transmisión 4G/5G: "+error.message+". Verifica permisos de cámara, Internet y sesión de administrador.");
      }finally{busy=false;if(!running)start.disabled=false;}
    }
    const leave=()=>{
      const id=cameraId;cameraId=null;
      if(id)fetch("/api/ip-cameras/"+id+"/action",{
        method:"POST",credentials:"same-origin",keepalive:true,
        headers:{"Content-Type":"application/json","X-Bosqyn-Action":"1"},
        body:JSON.stringify({action:"disconnect"})
      }).catch(()=>{});
      stopLocal();
    };
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
