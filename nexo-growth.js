/* Nexo growth layer: recomendación local + motion mix 65/35. */
(()=>{
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const fmt=c=>(c/100).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:2})+' USD';
  const wa='5356865093';
  const stop=new Set('quiero necesito tengo para con una el la los las un una mi me de del que por y o se en al es hay sin más algo favor'.split(' '));
  const intents=[
    {keys:'apagón apagones electricidad luz corriente energía respaldo batería inversor solar',cats:['Energía'],label:'Energía y respaldo eléctrico',line:'Para que la casa siga funcionando cuando la corriente falla, empezaría por estas opciones de energía y respaldo.'},
    {keys:'calor caliente caloría aire enfriar clima habitación cuarto dormir',cats:['Climatización'],label:'Climatización',line:'Para bajar el calor sin comprar a ciegas, estas son las opciones que mejor encajan para empezar.'},
    {keys:'frío comida conservar refrigerador nevera congelador freezer hielo',cats:['Electrodomésticos'],label:'Refrigeración y conservación',line:'Para conservar alimentos y ganar espacio, estas opciones resuelven el problema desde distintos tamaños y presupuestos.'},
    {keys:'lavar ropa lavadora limpieza limpiar',cats:['Electrodomésticos','Hogar'],label:'Limpieza y ropa',line:'Para quitar trabajo de encima en casa, le recomiendo mirar primero estas alternativas.'},
    {keys:'mover transporte triciclo moto bicicleta carro movilidad',cats:['Triciclos','Motos','Otros vehículos'],label:'Movilidad',line:'Para moverse o transportar cosas, estas son las opciones del catálogo que conviene comparar.'},
    {keys:'cocinar cocina comida comedor mueble',cats:['Cocina y comedor'],label:'Cocina y comedor',line:'Para hacer más práctico el espacio donde cocina y comparte, empezaría por estas opciones.'},
    {keys:'sentar descansar sala sillón sofá mueble',cats:['Sala y descanso'],label:'Sala y descanso',line:'Para descansar mejor y transformar la sala, estas son las opciones más prometedoras.'},
    {keys:'trabajar escritorio oficina computadora estudiar',cats:['Oficina'],label:'Trabajo y estudio',line:'Para crear un espacio de trabajo más cómodo, estas opciones son las mejores entradas al catálogo.'}
  ];
  function getIntent(text){const q=norm(text);let best={score:0,intent:null};for(const intent of intents){const score=intent.keys.split(' ').reduce((n,k)=>n+(q.includes(k)?1:0),0);if(score>best.score)best={score,intent};}return best.intent||{cats:[],label:'Una selección para empezar',line:'Le dejo siete opciones variadas para que compare con calma; si me cuenta un poco más, afinamos la recomendación.'};}
  function scoreProduct(p,q,intent){const hay=norm([p.n,p.c,p.dc,p.dl,p.v,p.g].join(' '));let score=0;const words=q.split(/\s+/).filter(w=>w.length>2&&!stop.has(w));for(const word of words)if(hay.includes(word))score+=2;if(intent.cats?.some(c=>p.c===c||p.g===c))score+=6;if(p.e!=='agotado')score+=1;if(p.fs?.length)score+=.25;return score;}
  function recommend(text){const intent=getIntent(text),q=norm(text);const catalog=(typeof CATALOGO!=='undefined'?CATALOGO:[]);let pool=catalog.filter(p=>p.e!=='agotado');const ranked=pool.map(p=>({p,s:scoreProduct(p,q,intent)})).sort((a,b)=>b.s-a.s);const chosen=[],seen=new Set();for(const row of ranked){if(chosen.length>=7)break;const key=row.p.s;if(!seen.has(key)){seen.add(key);chosen.push(row.p)}}if(chosen.length<7){for(const p of pool){if(chosen.length>=7)break;if(!seen.has(p.s)){seen.add(p.s);chosen.push(p)}}}return {intent,products:chosen};}
  function paint(text){const result=$('#nexo-advisor-result'),products=$('#nexo-advisor-products'),category=$('#nexo-advisor-category'),summary=$('#nexo-advisor-summary'),waLink=$('#nexo-advisor-wa');if(!result||!products)return;const data=recommend(text);category.textContent=data.intent.label;summary.textContent=data.intent.line+' Elija una ficha y, si todavía duda, le ayudamos a confirmarlo por WhatsApp.';products.innerHTML=data.products.map(p=>{const f=(p.fs&&p.fs[0])||p.f||p.s+'.webp';return `<button class="nexo-advisor-product" type="button" data-advisor-product="${String(p.s).replace(/"/g,'&quot;')}"><img src="fotos/${f}" alt="${String(p.n).replace(/"/g,'&quot;')}" loading="lazy" decoding="async"><strong>${p.n}</strong><span>${fmt(p.pv)} · ${p.c}</span></button>`}).join('');waLink.href=`https://wa.me/${wa}?text=${encodeURIComponent('Hola, tengo este problema: '+text+'. Vi la recomendación de Nexo y quisiera que me ayuden a elegir entre las opciones.')}`;result.hidden=false;result.scrollIntoView({behavior:'smooth',block:'nearest'});}
  $('#nexo-advisor-form')?.addEventListener('submit',e=>{e.preventDefault();const input=$('#nexo-advisor-input');const text=input?.value.trim();if(text)paint(text);else input?.focus()});
  $('#nexo-advisor-clear')?.addEventListener('click',()=>{const r=$('#nexo-advisor-result'),i=$('#nexo-advisor-input');if(r)r.hidden=true;if(i){i.value='';i.focus()}});
  $('#nexo-advisor-products')?.addEventListener('click',e=>{const b=e.target.closest('[data-advisor-product]');if(!b)return;const open=window.nexoOpenProduct;if(open)open(b.dataset.advisorProduct);else document.querySelector(`[data-id="${b.dataset.advisorProduct}"]`)?.click()});

  // 65% appear from below; 35% arrive laterally. Existing palette and layout stay untouched.
  const candidates=$$('.pad .lbl, .pad h2, .pad .sec-nota, .bento-tile, .filtros, .envio-caja, .como-paso, .carrusel, .dato, .cierre-txt, #nexo-advisor');
  candidates.forEach((el,i)=>{const side=(i%20)<7;el.classList.add('growth-reveal','growth-hidden');if(side){el.classList.add('growth-side');if(i%2)el.classList.add('growth-left')}});
  const io=new IntersectionObserver(entries=>entries.forEach(entry=>{if(!entry.isIntersecting)return;entry.target.classList.remove('growth-hidden');entry.target.classList.add('growth-in');io.unobserve(entry.target)}),{rootMargin:'0px 0px -10% 0px',threshold:.08});
  candidates.forEach(el=>io.observe(el));
})();
