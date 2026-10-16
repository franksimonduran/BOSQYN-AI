/* Admin-only capture and evidence access. Password never stored in JS or localStorage. */
window.Bosqyn = window.Bosqyn || {};
Bosqyn.auth = (() => {
  "use strict";
  let authenticated = false, configured = false, loginRequired = true;
  let pending = null;
  const trigger = document.getElementById("bosqyn-auth-button");
  const name = document.getElementById("bosqyn-auth-label");
  const overlay = document.createElement("div");
  overlay.id = "bosqyn-auth-overlay";
  overlay.className = "bosqyn-auth-overlay";
  overlay.hidden = true;
  const dialog = document.createElement("section");
  dialog.className = "bosqyn-auth-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Acceso de administrador");
  const title = document.createElement("h2"); title.textContent = "Acceso de administrador";
  const info = document.createElement("p"); info.textContent = "Inicia sesión para guardar y revisar las evidencias de BOSQYN AI.";
  const form = document.createElement("form");
  const label = document.createElement("label");label.textContent = "Contraseña de administrador";
  const password = document.createElement("input");
  password.type = "password";password.required = true;password.autocomplete = "current-password";
  password.placeholder = "Contraseña";password.minLength = 16;
  label.append(password);
  const message = document.createElement("p");message.className = "bosqyn-auth-message";message.setAttribute("role","status");
  const controls = document.createElement("div");controls.className = "bosqyn-auth-controls";
  const submit = document.createElement("button");submit.type = "submit";submit.textContent = "Entrar";submit.className = "bosqyn-auth-primary";
  const cancel = document.createElement("button");cancel.type = "button";cancel.textContent = "Cancelar";
  controls.append(cancel,submit);
  form.append(label,message,controls);
  dialog.append(title,info,form);
  overlay.append(dialog);
  document.body.append(overlay);

  function refreshButton(){
    if(name)name.textContent = authenticated ? "Administrador · Salir" : "Acceder";
    if(trigger)trigger.setAttribute("aria-label",authenticated ? "Cerrar sesión de administrador" : "Iniciar sesión de administrador");
  }
  function emit(){
    window.dispatchEvent(new CustomEvent("bosqyn:auth-changed",{detail:{authenticated}}));
  }
  function close(success=false){
    overlay.hidden = true;
    password.value = "";
    message.textContent = "";
    if(pending){pending(success);pending=null;}
  }
  function display(reason){
    if(pending)close(false);
    overlay.hidden = false;
    info.textContent=reason||"Solo un administrador autorizado puede guardar y gestionar evidencias.";
    if(!configured && loginRequired){
      message.textContent="El administrador aún no está configurado en el servidor. Revisa Railway.";
      submit.disabled=true;
    }else{
      message.textContent="";
      submit.disabled=false;
    }
    password.focus();
    return new Promise(resolve=>pending=resolve);
  }
  async function status(){
    try{
      const response = await fetch("/api/auth/status",{cache:"no-store",credentials:"same-origin"});
      if(!response.ok)throw new Error("No se pudo consultar la sesión");
      const data=await response.json();
      authenticated=!!data.authenticated;
      configured=!!data.configured;
      loginRequired=!!data.login_required;
    }catch(error){
      console.warn("BOSQYN auth:",error);
      authenticated=false;configured=false;loginRequired=true;
    }
    refreshButton();
    return authenticated;
  }
  async function ensure(reason){
    if(await status())return true;
    return display(reason);
  }
  async function signout(){
    try{
      await fetch("/api/auth/logout",{method:"POST",headers:{"X-Bosqyn-Action":"1"},credentials:"same-origin"});
    }catch(error){console.error(error);}
    authenticated=false;refreshButton();emit();
  }
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    if(!password.value)return;
    submit.disabled=true;message.textContent="Verificando credenciales…";
    const pass=password.value;
    password.value="";
    try{
      const response=await fetch("/api/auth/login",{
        method:"POST",headers:{"Content-Type":"application/json","X-Bosqyn-Action":"1"},
        body:JSON.stringify({password:pass}),credentials:"same-origin"
      });
      const result=await response.json();
      if(!response.ok)throw Error(result.error||"Acceso denegado");
      authenticated=true;configured=true;refreshButton();close(true);emit();
    }catch(error){
      message.textContent=error.message||"No se pudo iniciar sesión.";
      password.focus();
    }finally{submit.disabled=false;}
  });
  cancel.addEventListener("click",()=>close(false));
  overlay.addEventListener("click",e=>{if(e.target===overlay)close(false);});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!overlay.hidden)close(false);});
  trigger?.addEventListener("click",()=>authenticated?signout():ensure());
  status();
  return {status,ensure,signout,isAuthenticated:()=>authenticated};
})();
