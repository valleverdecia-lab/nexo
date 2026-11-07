/* Nexo Push: permiso visible después de 2:01 y recuperación de carrito. */
(()=>{
  const API='https://nexoai-dgvqhy78.manus.space/api/push';
  const WAIT_MS=121000;
  const $=s=>document.querySelector(s);
  const ls=(()=>{try{return localStorage}catch(_){return null}})();
  const key='nexo-push-enabled';
  const base64ToBytes=value=>{const pad='='.repeat((4-value.length%4)%4),raw=atob((value+pad).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from([...raw],c=>c.charCodeAt(0));};
  const cart=()=>{try{return JSON.parse(ls?.getItem('nexo-carro')||'{}')||{}}catch(_){return {}}};
  async function catalogInfo(){const list=Array.isArray(window.CATALOGO)?window.CATALOGO:[];const raw=list.map(p=>p.s).join('|');const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));const fingerprint=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');const product=list.find(p=>p.e!=='agotado');return {fingerprint,productName:product?.n||''};}
  const prompt=document.createElement('aside');
  prompt.id='nexo-push-prompt';
  prompt.hidden=true;
  prompt.setAttribute('role','dialog');
  prompt.setAttribute('aria-live','polite');
  prompt.innerHTML='<div><p class="mono nexo-push-kicker">[ Avisos de Nexo ]</p><h3>¿Quiere que le guardemos el camino?</h3><p>Podemos avisarle si deja un pedido a medias o aparece una novedad del catálogo. Máximo un aviso cada 12 horas.</p><div class="nexo-push-actions"><button type="button" data-push-allow class="cta cta-llena">Activar avisos</button><button type="button" data-push-later>Ahora no</button></div></div>';
  document.body.append(prompt);
  const show=()=>{if(!('Notification' in window)||!('serviceWorker' in navigator)||ls?.getItem(key)==='denied')return;if(Notification.permission==='granted'){enable().catch(()=>{});return}prompt.hidden=false;};
  const hide=()=>{prompt.hidden=true;};
  async function enable(){
    hide();
    const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
    if(permission!=='granted'){try{ls?.setItem(key,'denied')}catch(_){}return}
    const reg=await navigator.serviceWorker.register('./sw.js?v=1',{scope:'./'});
    const publicKey=(await (await fetch(`${API}/public-key`,{credentials:'omit'})).json()).publicKey;
    if(!publicKey)throw new Error('No public key');
    let sub=await reg.pushManager.getSubscription();
    if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:base64ToBytes(publicKey)});
    await fetch(`${API}/subscribe`,{method:'POST',headers:{'content-type':'application/json'},credentials:'omit',body:JSON.stringify({subscription:sub.toJSON()}),keepalive:true});
    const catalog=await catalogInfo();
    await fetch(`${API}/catalog-seen`,{method:'POST',headers:{'content-type':'application/json'},credentials:'omit',body:JSON.stringify({subscription:sub.toJSON(),...catalog}),keepalive:true});
    try{ls?.setItem(key,'enabled')}catch(_){}
    window.__nexoPushSubscription=sub;
  }
  async function scheduleCart(){
    const items=cart(); if(!Object.keys(items).length)return;
    let sub=window.__nexoPushSubscription;
    if(!sub){const reg=await navigator.serviceWorker.getRegistration('./');sub=await reg?.pushManager.getSubscription();}
    if(!sub)return;
    const names=Object.entries(items).slice(0,6).map(([slug,count])=>`${count} × ${slug}`).join(', ');
    await fetch(`${API}/cart`,{method:'POST',headers:{'content-type':'application/json'},credentials:'omit',body:JSON.stringify({subscription:sub.toJSON(),items:names}),keepalive:true});
  }
  $('[data-push-allow]')?.addEventListener('click',()=>enable().catch(()=>{prompt.hidden=false}));
  $('[data-push-later]')?.addEventListener('click',()=>{hide();try{ls?.setItem(key,'later')}catch(_){} });
  setTimeout(show,WAIT_MS);
  addEventListener('pagehide',()=>{scheduleCart().catch(()=>{})});
  addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')scheduleCart().catch(()=>{})});
})();
