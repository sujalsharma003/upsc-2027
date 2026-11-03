/* Syllabus Club V4 cloud bridge. No secret keys are shipped to the browser:
   SUPABASE_ANON_KEY is intentionally public, service-role key is server-only. */
(()=>{
'use strict';
const STORE='upsc-command-center-v1', SESSION='syllabus-v4-session', META='syllabus-v4-meta';
let config=null, session=null, user=null, revision=0, enabled=false, inFlight=false;
let dirty=false, timer=null, conflict=false, message='Cloud connecting…', changeEpoch=0, booting=true;
let readyResolve, bootFinished=false;
const ready=new Promise(resolve=>{readyResolve=resolve});
function notifyReady(){
 if(!bootFinished){bootFinished=true;readyResolve()}
 window.dispatchEvent(new Event('syllabus-cloud-ready'));
}
async function fetchWithTimeout(url, options={}, milliseconds=20000){
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),milliseconds);
 try{return await fetch(url,{...options,signal:controller.signal})}
 catch(err){
   if(controller.signal.aborted)throw Error('Cloud request timed out. Please retry the connection.');
   throw err;
 }finally{clearTimeout(timeout)}
}
const root=document.createElement('div');root.id='cloud-root';document.body.appendChild(root);
const esc=x=>String(x??'').replace(/[&<>"']/g,a=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[a]));
const snapshot=()=>{try{return JSON.parse(localStorage.getItem(STORE)||'null')}catch{return null}};
const setState=v=>localStorage.setItem(STORE,JSON.stringify(v));
const meta=()=>{try{return JSON.parse(localStorage.getItem(META)||'{}')}catch{return {}}};
const setMeta=v=>localStorage.setItem(META,JSON.stringify(v));
const authHeaders=()=>session?{'Authorization':'Bearer '+session.access_token}:{};
function showStatus(){
 const status=booting?'CHECKING…':conflict?'CONFLICT':enabled?'SYNC ON':user?'RECONNECT':config?.configured?'NOT SIGNED IN':'SETUP NEEDED';
 const dot=enabled?'ready':conflict?'alert':'idle';
 root.innerHTML=`<button class="cloud-trigger" id="cloud-open" type="button" aria-label="Open cloud account">☁ <span>${esc(status)}</span><i class="cloud-dot ${dot}"></i></button><div id="cloud-modal-host"></div>`;
 root.querySelector('#cloud-open').addEventListener('click',openModal);
}
async function authRequest(path, payload){
 const response=await fetchWithTimeout(config.supabase_url+'/auth/v1/'+path,{method:'POST',headers:{'apikey':config.supabase_anon_key,'Content-Type':'application/json'},body:JSON.stringify(payload)},18000);
 const obj=await response.json().catch(()=>({}));
 if(!response.ok){const error=Error(obj.error_description||obj.msg||obj.message||obj.error||'Authentication failed');error.status=response.status;throw error}
 return obj;
}
async function refreshSession(){
 if(!session?.refresh_token)return false;
 try{
   const next=await authRequest('token?grant_type=refresh_token',{refresh_token:session.refresh_token});
   session=next;localStorage.setItem(SESSION,JSON.stringify(session));return true;
 }catch(err){
   if(err.status===400||err.status===401){
     session=null;user=null;enabled=false;localStorage.removeItem(SESSION);
     return false;
   }
   // Network failures must not erase a valid refresh token or study session.
   throw err;
 }
}
async function api(path, options={}, retry=true){
 if(!session?.access_token)throw Error('Sign in to sync your UPSC data');
 if(session.expires_at && Date.now()/1000>session.expires_at-90)await refreshSession();
 const headers={...authHeaders(),...(options.headers||{})};
 const response=await fetchWithTimeout(path,{...options,headers},path.endsWith('/analyze')?90000:30000);
 if(response.status===401 && retry && await refreshSession())return api(path,options,false);
 let obj;try{obj=await response.json()}catch{obj={detail:'Unexpected server response'}}
 if(!response.ok){const e=new Error(obj.detail||`Request failed (${response.status})`);e.status=response.status;throw e}
 return obj;
}
async function connect(){
 const remote=await api('/api/state');
 if(!remote.data){
   revision=0;enabled=true;message='Creating your private study backup…';
   await flush(true);return;
 }
 const m=meta(), sameUser=m.user_id===user.id;
 if(sameUser && m.revision===remote.revision){
   revision=remote.revision;enabled=true;message='Cloud synced';showStatus();if(m.dirty){dirty=true;setTimeout(()=>flush(true),1000)}return;
 }
 // Protect previous local work: require a choice when switching devices/accounts.
 if(!sameUser && localStorage.getItem(STORE)){
   const ok=window.confirm('Cloud study data exists. Load it here? Your browser-only progress will be replaced. Export a JSON backup first if you need it. Cancel to keep local work and resolve manually.');
   if(!ok){revision=remote.revision;enabled=false;conflict=true;message='Choose cloud or local version in cloud settings';showStatus();return;}
 }
 if(sameUser && m.revision !== remote.revision && m.dirty){
   revision=remote.revision;enabled=false;conflict=true;message='Cloud changed on another device while local edits were pending';showStatus();return;
 }
 localStorage.setItem(META,JSON.stringify({user_id:user.id,revision:remote.revision,dirty:false}));
 setState(remote.data);revision=remote.revision;enabled=true;message='Cloud progress loaded';location.reload();
}
async function identify(){
 try{
   const res=await api('/api/health');
   if(!res.online)throw Error('Cloud backend unavailable');
   user=session.user||null;
   if(!user?.id){ // Supabase /auth/v1/user verifies token, not a user ID from local storage.
      const a=await fetchWithTimeout(config.supabase_url+'/auth/v1/user',{headers:{'apikey':config.supabase_anon_key,...authHeaders()}},18000);
      if(!a.ok)throw Error('Session expired');user=await a.json();
   }
   await connect();
 }catch(e){enabled=false;message=e.message;showStatus();}
}
async function signIn(email,password,register){
 const raw=await authRequest(register?'signup':'token?grant_type=password',{email,password});
 const obj=raw.session?.access_token?{...raw.session,user:raw.user}:raw;
 if(register && !obj.access_token){message='Account created. Confirm your email, then sign in.';return false;}
 if(!obj.access_token)throw Error('No session returned. Check email confirmation.');
 session=obj;user=obj.user;session.expires_at ||= Math.floor(Date.now()/1000)+Number(session.expires_in||3600);
 localStorage.setItem(SESSION,JSON.stringify(session));try{await connect()}finally{notifyReady()}return true;
}
async function flush(force=false){
 if(!user||!session||inFlight||(!enabled&&!force))return;
 const payload=snapshot();if(!payload)return;
 inFlight=true;const writingEpoch=changeEpoch;
 try{
   const r=await api('/api/state',{method:'POST',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({data:payload,expected_revision:revision})});
   revision=r.revision;dirty=changeEpoch!==writingEpoch;conflict=false;enabled=true;
   setMeta({user_id:user.id,revision,dirty});message=dirty?'Syncing latest changes…':'All study progress synced';showStatus();
   if(dirty && !timer)timer=setTimeout(()=>{timer=null;flush()},2200);
 }catch(e){
   dirty=true;setMeta({user_id:user.id,revision,dirty:true});
   if(e.status===409){conflict=true;enabled=false;message='A newer cloud copy exists. Resolve conflict before saving.';}
   else message='Offline: changes saved in this browser. Retry sync later.';
   showStatus();
 }finally{inFlight=false}
}
function scheduleSave(){
 if(!session||!user||!enabled)return;
 dirty=true;changeEpoch++;setMeta({user_id:user.id,revision,dirty:true});
 if(timer)return;
 timer=setTimeout(()=>{timer=null;flush()},6000);
}
async function changeToCloud(){
 const r=await api('/api/state');if(!r.data)throw Error('No cloud study backup exists');
 setMeta({user_id:user.id,revision:r.revision,dirty:false});setState(r.data);revision=r.revision;enabled=true;location.reload();
}
async function changeToLocal(){
 const r=await api('/api/state');revision=r.revision;
 if(!window.confirm('Overwrite the stored cloud snapshot with this browser’s current study data? Make sure you exported a backup of the cloud version.'))return;
 enabled=true;conflict=false;await flush(true);
}
function signOut(){
 if(!window.confirm('Sign out? Your cloud study data is retained, but this browser will reset to the original demo profile. Export unsynced changes before signing out.'))return;
 session=null;user=null;enabled=false;localStorage.removeItem(SESSION);localStorage.removeItem(META);
 localStorage.removeItem(STORE);location.reload();
}
async function reconnect(){
 await ready;
 if(!config?.configured){message='Cloud configuration is unavailable';showStatus();notifyReady();return}
 if(!session){message='Sign in to reconnect your study plan';showStatus();notifyReady();return}
 await identify();
 notifyReady();
}
function openModal(){
 const host=root.querySelector('#cloud-modal-host');if(!host)return;
 const logged=Boolean(user?.id);
 host.innerHTML=`<div class="cloud-backdrop" id="cloud-close-backdrop"><section class="cloud-panel" role="dialog" aria-modal="true" aria-label="Cloud account"><button class="cloud-x" id="cloud-close">✕</button><div class="cloud-kicker">✳ SYLLABUS CLUB / CLOUD EDITION</div><h2>${logged?'Your study data. Everywhere.':'Your space. Synced.'}</h2><p class="cloud-copy">${esc(message)}. Your private notes, daily sessions, completed tasks and revisions stay together across devices.</p>${!config?.configured?'<div class="cloud-warning">Set your Supabase environment variables and run the included SQL migration before cloud features can be used.</div>':logged?`<p class="cloud-account">Signed in as <strong>${esc(user.email||'your account')}</strong></p><div class="cloud-actions"><button class="cloud-primary" id="cloud-sync">↻ Sync now</button>${!enabled?'<button class="cloud-primary" id="cloud-retry" type="button">↻ Reconnect cloud</button>':''}<button id="cloud-download">↓ Download browser backup</button></div>${conflict?'<div class="cloud-warning">Two versions exist. Choose which copy to keep. Download a backup first.</div><div class="cloud-actions"><button id="cloud-remote">Use cloud version</button><button id="cloud-local">Replace cloud with local version</button></div>':''}<button class="cloud-signout" id="cloud-signout">Sign out</button>`:`<form id="cloud-login"><label>Email<input type="email" name="email" autocomplete="email" required placeholder="you@example.com"></label><label>Password<input type="password" name="password" autocomplete="current-password" required minlength="6" placeholder="Your account password"></label><div class="cloud-actions"><button class="cloud-primary" type="submit" data-mode="login">Sign in</button><button type="submit" data-mode="signup">Create account</button></div></form><small>New accounts may require email confirmation. Use a unique password.</small>`}<p id="cloud-feedback" role="status" class="cloud-feedback"></p></section></div>`;
 const f=host.querySelector('#cloud-feedback'), say=t=>{f.textContent=t};
 host.querySelector('#cloud-close').onclick=()=>host.innerHTML='';
 host.querySelector('#cloud-close-backdrop').addEventListener('click',e=>{if(e.target.id==='cloud-close-backdrop')host.innerHTML=''});
 if(!config?.configured)return;
 if(!logged){
   const form=host.querySelector('#cloud-login');let mode='login';
   form.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>mode=b.dataset.mode));
   form.onsubmit=async e=>{e.preventDefault();say(mode==='signup'?'Creating account…':'Signing in…');
      try{const o=new FormData(form);await signIn(o.get('email').trim(),o.get('password'),mode==='signup');say(message);showStatus();}
      catch(err){say(err.message)}};
 } else {
   host.querySelector('#cloud-sync').onclick=async()=>{say(enabled?'Syncing…':'Reconnecting…');try{if(enabled)await flush(true);else await reconnect();say(message)}catch(err){say(err.message)}};
   if(host.querySelector('#cloud-retry'))host.querySelector('#cloud-retry').onclick=async()=>{say('Checking connection…');try{await reconnect();say(message)}catch(err){say(err.message)}};
   host.querySelector('#cloud-download').onclick=()=>{const b=new Blob([JSON.stringify({data:snapshot(),exportedAt:new Date().toISOString()},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='syllabus-club-local-backup.json';a.click();URL.revokeObjectURL(a.href);say('Backup downloaded')};
   host.querySelector('#cloud-signout').onclick=signOut;
   if(conflict){host.querySelector('#cloud-remote').onclick=async()=>{try{await changeToCloud()}catch(e){say(e.message)}};
     host.querySelector('#cloud-local').onclick=async()=>{try{await changeToLocal();say(message)}catch(e){say(e.message)}};}
 }
}
const bridge={
 api, scheduleSave, open:openModal, reconnect, ready,
 get loggedIn(){return Boolean(enabled&&user)},
 get status(){return message},
 async uploadDocument(id,file){if(!enabled)throw Error('Sign in to upload files to private cloud storage');
  const form=new FormData();form.append('doc_id',id);form.append('file',file);return api('/api/documents/upload',{method:'POST',body:form})},
 async documentUrl(id){return (await api('/api/documents/'+id+'/url')).url},
 async deleteDocument(id){return api('/api/documents/'+id,{method:'DELETE'})},
 async articleFileUrl(id){return (await api('/api/articles/'+id+'/file')).url}
};
window.SYLLABUS_CLOUD=bridge;
async function boot(){
 showStatus();
 try{
   const r=await fetchWithTimeout('/api/config',{cache:'no-store'},12000);
   if(!r.ok)throw Error('Cloud config request failed ('+r.status+')');
   config=await r.json();
   if(!config?.configured){message='Cloud configuration needed';return}
   session=JSON.parse(localStorage.getItem(SESSION)||'null');
   if(!session){message='Sign in to sync your study plan';return}
   await identify();
 }catch(e){message='Cloud unavailable: '+e.message+'. Your browser study data remains safe.'}
 finally{
   booting=false;
   showStatus();
   notifyReady();
 }
}
window.addEventListener('online',()=>{
 if(enabled&&dirty)flush(true);
 else if(!enabled&&session)reconnect().catch(()=>{});
});
boot();
})();
