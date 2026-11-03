/* BOSQYN AI · Cámara de celular por Wi-Fi con salida HTTPS.
   No requiere IP Webcam ni puente LAN. El Wi-Fi debe tener Internet para Render. */
window.Bosqyn=window.Bosqyn||{};
Bosqyn.mobileStream=(()=>{
  "use strict";
  function mount(panel,onRefresh){
    const start=panel.querySelector("#ip-mobile-start");
    const stopButton=panel.querySelector("#ip-mobile-stop");
    const preview=panel.querySelector("#ip-mobile-preview");
    const notice=panel.querySelector("#ip-mobile-notice");
    const permissionHelp=panel.querySelector("#ip-mobile-permission-help");
    const steps=Array.from(panel.querySelectorAll(".bosqyn-ip-steps span"));
    const audioOption=panel.querySelector("#ip-mobile-audio");
    const wifiConfirm=panel.querySelector("#ip-mobile-wifi-confirm");
    const box=panel.querySelector("#ip-mobile-stream");
    if(!start||!stopButton||!preview||!notice||!box)return ()=>{};
    let running=false,busy=false,stream=null,cameraId=null,abort=null,timeout=null,failures=0;
    let audioContext=null,audioSource=null,audioProcessor=null,audioSamples=0,audioChunks=[],audioSending=false,audioDisabled=false;
    const canvas=document.createElement("canvas");
    const status=(msg,level="info")=>{
      notice.textContent=msg;
      notice.dataset.level=level;
    };
    function stage(index){
      steps.forEach((step,i)=>{
        step.classList.toggle("is-current",i===index);
        step.classList.toggle("is-done",i<index);
      });
    }
    function explainError(error){
      const name=String(error?.name||"");
      const message=String(error?.message||"");
      if(name==="NotAllowedError"||name==="PermissionDeniedError"||/permission denied|permission dismissed|notallowed/i.test(message)){
        if(permissionHelp)permissionHelp.hidden=false;
        return "Permiso de cámara denegado. Habilita la cámara para este sitio en Chrome y en los permisos de Android; después vuelve a intentarlo.";
      }
      if(name==="NotFoundError"||name==="DevicesNotFoundError")
        return "No se detecta una cámara disponible en este dispositivo.";
      if(name==="NotReadableError"||name==="TrackStartError")
        return "La cámara está ocupada por otra aplicación o no puede iniciarse. Cierra otras aplicaciones de cámara.";
      if(name==="OverconstrainedError")return "Este dispositivo no admite la configuración solicitada para la cámara.";
      if(name==="SecurityError")return "El navegador bloqueó el acceso. Abre BOSQYN AI directamente por HTTPS.";
      if(name==="AbortError")return "La cámara interrumpió la inicialización. Comprueba sus permisos.";
      return message||"Error desconocido al abrir la cámara";
    }
    const networkType=()=>navigator.connection?.type||navigator.mozConnection?.type||navigator.webkitConnection?.type||"";
    function validateWifi(){
      // connection.type no existe en gran parte de Android/iOS: confirmación
      // explícita en la interfaz, sin fingir una detección fiable del Wi-Fi.
      if(!wifiConfirm?.checked)throw Error("Conecta el celular a Wi-Fi, desactiva los datos móviles y marca la confirmación.");
      if(networkType()==="cellular")throw Error("El navegador indica una red celular. Desactiva los datos móviles y conecta Wi-Fi.");
    }
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
      stage(0);
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
      if(!running||!cameraId)return;
      // Si el navegador detecta una transición a red celular, no enviar datos.
      if(networkType()==="cellular"){
        await stop();
        status("Transmisión detenida: se detectó una conexión celular. Conéctate de nuevo al Wi-Fi.");
        return;
      }
      if(!stream?.active||stream.getVideoTracks().every(track=>track.readyState!=="live")){
        await stop();
        status("La cámara del celular dejó de enviar imagen. Desbloquea el teléfono, revisa los permisos y vuelve a pulsar Transmitir.");
        return;
      }
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
        stage(3);
        status("Cámara Wi-Fi #"+cameraId+" conectada · Imágenes recibidas por BOSQYN AI. Mantén esta página abierta en el teléfono.","success");
      }catch(error){
        if(!running)return;
        failures++;
        status("No se pudo enviar la imagen: "+error.message);
        if(failures>=5){
          await stop();
          status("Transmisión detenida. Comprueba que el Wi-Fi tenga Internet y vuelve a iniciar.");
          return;
        }
      }finally{abort=null;}
      if(running)timeout=setTimeout(push,failures?2400:1100);
    }
    async function begin(){
      if(running||busy)return;
      // La transmisión se inicia únicamente desde el teléfono emisor, nunca
      // desde la computadora que supervisa. No solicitar permisos en escritorio.
      if(!/Android|iPhone|iPod/i.test(navigator.userAgent)){
        status("Abre esta página en tu celular para transmitir. La cámara de esta computadora no se utilizará.","error");
        return;
      }
      if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){
        status("Necesitas HTTPS y un navegador que permita acceso a la cámara.");
        return;
      }
      busy=true;start.disabled=true;
      if(permissionHelp)permissionHelp.hidden=true;
      stage(0);
      try{
        validateWifi();
        stage(1);
        if(!await Bosqyn.auth?.ensureAdmin("Inicia sesión como administrador para transmitir desde tu celular.")){
          return;
        }
        status("Solicitando acceso a la cámara. Acepta el permiso en tu teléfono.");
        const videoConstraints={facingMode:{ideal:"environment"},width:{ideal:640},height:{ideal:480}};
        try{
          stream=await navigator.mediaDevices.getUserMedia({
            video:videoConstraints,
            audio:audioOption?.checked?{echoCancellation:false,noiseSuppression:false,autoGainControl:false}:false
          });
        }catch(mediaError){
          // Un permiso de micrófono denegado no debe impedir la cámara Wi-Fi.
          if(!audioOption?.checked||!["NotAllowedError","NotFoundError","OverconstrainedError"].includes(mediaError.name))throw mediaError;
          stream=await navigator.mediaDevices.getUserMedia({video:videoConstraints,audio:false});
          audioOption.checked=false;
          status("Micrófono no disponible; se continuará solo con la cámara.");
        }
        // Mostrar la vista previa antes de play(): algunos Android no inician
        // videoWidth/videoHeight cuando el elemento está en display:none.
        box.classList.add("is-streaming");
        stage(2);
        preview.srcObject=stream;
        await preview.play();
        status("Registrando cámara Wi-Fi por HTTPS… No necesitas dirección IP.");
        const list=await fetch("/api/ip-cameras",{credentials:"same-origin",cache:"no-store"});
        if(!list.ok)throw Error("No se pudo consultar las cámaras registradas");
        const items=(await list.json()).items||[];
        let camera=items.find(c=>c.protocol==="MOVIL/HTTPS"&&c.desired!=="on"&&Boolean(c.audio_enabled)===Boolean(audioOption?.checked));
        if(!camera){
          const saved=await api("/api/ip-cameras/mobile",{name:"Celular Wi-Fi",audio_enabled:Boolean(audioOption?.checked)});
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
        status("No se pudo iniciar: "+explainError(error),"error");
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
    const networkChange=()=>{
      if(!running)return;
      if(networkType()==="cellular"){
        stop().then(()=>status("Transmisión detenida: el navegador cambió a datos móviles. Vuelve a conectarte a Wi-Fi."));
      }
    };
    start.addEventListener("click",begin);
    stopButton.addEventListener("click",stop);
    window.addEventListener("pagehide",leave);
    window.addEventListener("bosqyn:auth-changed",authChange);
    (navigator.connection||navigator.mozConnection||navigator.webkitConnection)?.addEventListener?.("change",networkChange);
    return ()=>{
      const id=cameraId;cameraId=null;stopLocal();
      if(id)api("/api/ip-cameras/"+id+"/action",{action:"disconnect"}).catch(()=>{});
      start.removeEventListener("click",begin);
      stopButton.removeEventListener("click",stop);
      window.removeEventListener("pagehide",leave);
      window.removeEventListener("bosqyn:auth-changed",authChange);
      (navigator.connection||navigator.mozConnection||navigator.webkitConnection)?.removeEventListener?.("change",networkChange);
    };
  }
  return {mount};
})();
