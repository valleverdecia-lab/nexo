/* Nexo Concierge: diagnóstico conversacional remoto + fallback local + reveals verticales. */
(()=>{
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const fmt=c=>(Number(c||0)).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:2})+' USD';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const wa='5356865093';
  const AI_ENDPOINT=window.NEXO_AI_ENDPOINT||'https://nexoai-dgvqhy78.manus.space/api/chat';
  const stop=new Set('quiero necesito tengo para con una el la los las un una mi me de del que por y o se en al es hay sin más algo favor no ya pero como poder puede'.split(' '));
  const intents=[
    {id:'event',keys:'fiesta música musica bocina bocinas sonido bailar cumpleaños evento celebración celebracion karaoke mañana',cats:['Entretenimiento'],label:'Música y experiencia para el evento',line:'La necesidad principal es que se escuche bien y que la experiencia esté completa. Primero resolvemos el sonido; después añadimos micrófono, karaoke o ambiente. Una planta solo entra si también falta corriente.'},
    {id:'retention',keys:'niños ninos niñas ninas niño nina clientes se van irse pierdo perder retener atraer entretener diversión diversion jugar espera familias familiar negocio',cats:['Entretenimiento','Artículos infantiles','Negocios'],label:'Retención de clientes y experiencia',line:'Si las familias o los niños se van, la primera solución es crear una razón para quedarse. Primero una actividad que atraiga y retenga; después se optimiza la operación.'},
    {id:'energy',keys:'apagón apagones electricidad luz corriente energía respaldo batería inversor solar',cats:['Energía'],label:'Energía y respaldo eléctrico',line:'La estrategia es construir continuidad por capas: resolver lo urgente, ampliar autonomía y luego añadir recarga solar si tiene sentido.'},
    {id:'business',keys:'negocio tienda local comercio clientes empleados trabajadores restaurante cafetería cafeteria barbería barberia oficina vender mantener personas',cats:['Energía','Electrodomésticos','Climatización'],label:'Operación de negocio',line:'Primero hay que resolver el resultado comercial que busca: atraer, retener, vender, conservar inventario o mantener la operación. La energía es solo una de esas capas.'},
    {id:'people',keys:'transportar gente pasajeros personas llevar transporte colectivo taxi',cats:['Triciclos','Motos'],label:'Movilidad para transportar personas',line:'Para transportar personas conviene priorizar capacidad y seguridad; después se compara una alternativa ágil para trayectos cortos.'},
    {id:'goods',keys:'transportar cosas mercancía mercancia paquetes reparto mensajero delivery domicilios entregar logística logistica',cats:['Triciclos','Motos','Otros vehículos'],label:'Reparto y transporte de mercancías',line:'Para repartir conviene combinar capacidad de carga con un vehículo ligero para entregas rápidas y ampliar el radio de servicio.'},
    {id:'ecoflow',keys:'ecoflow delta cargar cargarla expandir autonomía autonomia paneles',cats:['Energía'],label:'Ampliar una EcoFlow que ya tiene',line:'Si ya tiene una EcoFlow, primero ampliaría autonomía y recarga; no compraría otra estación igual sin saber qué limitación quiere resolver.'},
    {id:'climate',keys:'calor caliente aire enfriar clima habitación cuarto dormir clientes',cats:['Climatización'],label:'Climatización y confort',line:'Para bajar el calor conviene dimensionar el espacio y, si es un negocio, proteger el confort cuando se va la corriente.'},
    {id:'cold',keys:'frío frio comida conservar refrigerador nevera congelador freezer hielo alimentos',cats:['Electrodomésticos'],label:'Refrigeración y conservación',line:'Para conservar alimentos hace falta capacidad de frío y, si hay riesgo eléctrico, una forma de proteger la mercancía.'},
    {id:'home',keys:'lavar ropa limpieza limpiar cocinar cocina comedor sentar descansar sala sillón sofá trabajar escritorio oficina computadora estudiar',cats:['Electrodomésticos','Hogar','Cocina y comedor','Sala y descanso','Oficina'],label:'Resolver una necesidad concreta del hogar',line:'La compra debe resolver el problema completo, no solo mostrar un producto que comparte una palabra con la consulta.'}
  ];
  const catalog=()=>typeof CATALOGO!=='undefined'?CATALOGO:[];
  const hay=p=>norm([p.n,p.c,p.dc,p.dl,p.v,p.g].join(' '));
  const find=regex=>catalog().find(p=>p.e!=='agotado'&&regex.test(hay(p)));
  const findAny=regex=>catalog().find(p=>regex.test(hay(p)));
  function getIntent(text){
    const q=norm(text); let best={score:0,intent:null};
    for(const intent of intents){
      let score=intent.keys.split(' ').reduce((n,k)=>n+(q.includes(k)?1:0),0);
      if(intent.id==='event'&&/(fiesta|musica|bocina|sonido|bailar|cumpleanos|evento|karaoke|celebr)/.test(q))score+=20;
      if(intent.id==='retention'&&/(se van|irse|pierdo|perder|retener|atraer|nin|nina|nino|clientes|familias|jugar)/.test(q))score+=12;
      if(intent.id==='business'&&/(negocio|clientes|local|tienda|comercio|restaurante|barber|cafeter|empleados)/.test(q))score+=4;
      if(intent.id==='ecoflow'&&/ecoflow|delta/.test(q))score+=8;
      if(intent.id==='people'&&/(transportar gente|pasajeros|llevar personas)/.test(q))score+=6;
      if(intent.id==='goods'&&/(transportar cosas|mercancia|mensajero|reparto|delivery)/.test(q))score+=6;
      if(score>best.score)best={score,intent};
    }
    return best.intent||intents[intents.length-1];
  }
  function scoreProduct(p,q,intent){
    const text=hay(p); let score=0;
    for(const word of q.split(/\s+/).filter(w=>w.length>2&&!stop.has(w)))if(text.includes(word))score+=2;
    if(intent.cats?.some(c=>p.c===c||p.g===c))score+=5;
    if(intent.id==='event'&&p.c==='Entretenimiento')score+=22;
    if(intent.id==='retention'&&/(entretenimiento|articulos infantiles|negocios)/.test(norm(p.c)))score+=12;
    if(p.e!=='agotado')score+=1;
    return score;
  }
  function curated(text,intent){
    const out=[],roles=[]; const add=(p,role)=>{if(p&&!out.some(x=>x.s===p.s)){out.push(p);roles.push(role)}};
    if(intent.id==='event'){add(find(/bocina lg xboom|equipo de musica lg xboom/),'Sonido principal · llena el espacio');add(find(/bocina con microfono/),'Micrófono · karaoke y animación');add(find(/bocina mica.*tripode/),'Opción móvil · sonido y micrófono');add(find(/equipo de musica/),'Alternativa de potencia');add(find(/bocina integrada/),'Ambiente · complemento');}
    if(intent.id==='retention'){add(find(/mesa.*ping pong/),'Actividad principal · retiene niños y familias');add(find(/trampolin/),'Atracción de alto impacto · crea tiempo de permanencia');add(find(/piscina.*nino|piscina.*nin/),'Experiencia familiar · convierte espera en diversión');add(find(/maquina.*palomita/),'Venta complementaria · monetiza la espera');add(find(/juego.*mesa alta|juego.*terraza/),'Zona de estancia · acompaña el consumo');}
    if(intent.id==='energy'){add(find(/inversor.*6kw.*bater|bater.*5\.12|inversor 6kw/),'Base de respaldo');add(find(/inversor.*sumry.*bateria|sumry.*bateria/),'Opción equilibrada');add(find(/bateria.*litio 5|bateria de lithuim/),'Más autonomía');add(find(/combo.*solar|panel.*longi|paneles.*bifaciales|paneles/),'Recarga solar');add(find(/planta.*inverter|planta electrica|planta saco/),'Plan alternativo');}
    if(intent.id==='ecoflow'){add(find(/bateria extra.*ecoflow|ecoflow.*delta 2/),'Expansión directa');add(find(/paneles.*longi|paneles.*bifaciales|paneles/),'Recarga solar');add(find(/combo.*solar|must combo solar/),'Sistema completo');add(find(/inversor.*bateria/),'Respaldo de mayor escala');}
    if(intent.id==='business'){add(find(/refrigerador expositor.*milexus/),'Más capacidad de venta');add(find(/inversor.*6kw.*bateria|inversor 6kw/),'Continuidad operativa');add(find(/split.*1\.5|aire.*eko|climat/),'Confort para clientes');add(find(/congelador|freezer/),'Conservar inventario');}
    if(intent.id==='people'){add(findAny(/triciclo/),'Vehículo principal · confirmar disponibilidad');add(find(/moto electrica topmaq/),'Alternativa ágil');add(find(/bicicleta electrica/),'Trayectos cortos');}
    if(intent.id==='goods'){add(findAny(/triciclo/),'Capacidad de carga · confirmar disponibilidad');add(find(/bicicleta electrica/),'Mensajería ligera');add(find(/scooter electrico|patinete electrico/),'Entregas rápidas');add(find(/moto electrica topmaq/),'Ampliar radio');}
    if(intent.id==='climate'){add(find(/split.*1\.5|aire.*eko/),'Climatización principal');add(find(/inversor.*bateria|bateria.*litio/),'Que no se detenga');}
    if(intent.id==='cold'){add(find(/refrigerador.*11|refrigerador lg/),'Frío principal');add(find(/congelador|freezer/),'Más capacidad');add(find(/inversor.*bateria|bateria.*litio/),'Proteger la mercancía');}
    return {out,roles};
  }
  function utilityFor(p,intent,role){
    if(role)return role; const t=hay(p);
    if(intent.id==='event'&&/bocina|musica|entretenimiento/.test(t))return 'Resuelve el sonido del evento';
    if(intent.id==='retention'&&/entretenimiento|trampolin|piscina|ping pong/.test(t))return 'Aumenta permanencia y atractivo';
    if(/inversor|bateria|panel|solar/.test(t))return 'Protege la continuidad';
    if(/refrigerador|congelador|freezer/.test(t))return 'Protege inventario y ventas';
    if(/bicicleta|moto|triciclo|scooter|patinete/.test(t))return 'Amplía el radio de servicio';
    if(/split|aire/.test(t))return 'Mejora el confort';
    if(/palomita/.test(t))return 'Crea una venta complementaria';
    return 'Opción para comparar';
  }
  function localRecommend(text){
    const intent=getIntent(text),q=norm(text),base=curated(text,intent),chosen=[...base.out],roles=[...base.roles],used=new Set(chosen.map(p=>p.s));
    const ranked=catalog().filter(p=>p.e!=='agotado'&&!used.has(p.s)).map(p=>({p,s:scoreProduct(p,q,intent)})).sort((a,b)=>b.s-a.s);
    for(const row of ranked){if(chosen.length>=7)break;chosen.push(row.p);roles.push(chosen.length===base.out.length+1?'Complemento recomendado':'Opción para comparar');}
    return {mode:'recommend',reply:intent.line,diagnosis:intent.label,recommendations:chosen.slice(0,7).map((p,i)=>({slug:p.s,name:p.n,category:p.c,price_usd:p.pv/100,status:p.e,image:(p.fs&&p.fs[0])||p.f||p.s+'.webp',role:utilityFor(p,intent,roles[i]),why:'Puede ayudar a resolver esta parte de la necesidad.',order:i+1})),web_sources:[],missing_info:[],next_question:''};
  }
  const chatHistory=[];
  function showData(data,text){
    const result=$('#nexo-advisor-result'),products=$('#nexo-advisor-products'),category=$('#nexo-advisor-category'),summary=$('#nexo-advisor-summary'),dialog=$('#nexo-advisor-dialog'),diagnosis=$('#nexo-advisor-diagnosis'),followup=$('#nexo-advisor-followup'),sources=$('#nexo-advisor-sources'),waLink=$('#nexo-advisor-wa');
    if(!result||!products)return;
    category.textContent=data.mode==='clarify'?'Necesito afinar una cosa':(data.diagnosis||'Ruta de solución');
    if(dialog)dialog.textContent=data.reply||'';
    if(summary)summary.textContent=data.diagnosis||'';
    if(followup){const questions=[...(data.missing_info||[]),data.next_question].filter(Boolean);followup.innerHTML=questions.length?`<strong>Para afinar:</strong> ${questions.map(esc).join(' · ')}`:'';followup.hidden=!questions.length;}
    products.innerHTML=(data.recommendations||[]).map(p=>`<button class="nexo-advisor-product" type="button" data-advisor-product="${esc(p.slug)}"><img src="fotos/${esc(p.image||p.slug+'.webp')}" alt="${esc(p.name)}" loading="lazy" decoding="async"><strong>${esc(p.name)}</strong><span>${esc(p.role||'Opción recomendada')} · ${fmt((p.price_usd||0)*100)}</span><small>${esc(p.why||'')}</small></button>`).join('');
    if(sources){sources.innerHTML=(data.web_sources||[]).map(s=>`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title||'Fuente consultada')} ↗</a>`).join('');sources.hidden=!(data.web_sources||[]).length;}
    waLink.href=data.whatsapp_url||`https://wa.me/${wa}?text=${encodeURIComponent('Hola, mi situación es: '+text+'. Vi la orientación de Nexo y quiero que me ayuden a elegir la combinación correcta.')}`;
    result.hidden=false;
  }
  async function remotePaint(text){
    const result=$('#nexo-advisor-result'),category=$('#nexo-advisor-category'),dialog=$('#nexo-advisor-dialog');
    result.hidden=false; category.textContent='Entendiendo su situación…'; if(dialog)dialog.textContent='Estoy separando lo urgente de los complementos para no recomendarle algo que no resuelve su problema.';
    const messages=[...chatHistory,{role:'user',content:text}];
    const response=await fetch(AI_ENDPOINT,{method:'POST',headers:{'content-type':'application/json'},credentials:'omit',body:JSON.stringify({messages})});
    const data=await response.json();
    if(data.limit_reached){showData({mode:'clarify',reply:data.error,diagnosis:'Límite semanal alcanzado',recommendations:[],web_sources:[],missing_info:[],next_question:'',whatsapp_url:data.whatsapp_url},text);return data;}
    if(!response.ok||data.error)throw new Error(data.error||'No se pudo consultar el asesor');
    chatHistory.push({role:'user',content:text},{role:'assistant',content:[data.reply,data.diagnosis,data.next_question].filter(Boolean).join(' ')});
    showData(data,text); return data;
  }
  function localPaint(text){const data=localRecommend(text);showData(data,text);const dialog=$('#nexo-advisor-dialog');if(dialog)dialog.textContent='El asesor inteligente no está disponible ahora; le muestro una orientación inicial basada en el catálogo real.';return data;}
  $('#nexo-advisor-form')?.addEventListener('submit',async e=>{e.preventDefault();const input=$('#nexo-advisor-input'),text=input?.value.trim();if(!text){input?.focus();return}const button=e.submitter||$('button[type="submit"]',e.currentTarget);if(button)button.disabled=true;try{await remotePaint(text)}catch(error){console.warn('Nexo AI fallback',error);localPaint(text)}finally{if(button)button.disabled=false}});
  $('#nexo-advisor-clear')?.addEventListener('click',()=>{const r=$('#nexo-advisor-result'),i=$('#nexo-advisor-input'),dialog=$('#nexo-advisor-dialog');if(r)r.hidden=true;if(i){i.value='';i.focus()}if(dialog)dialog.textContent='';chatHistory.length=0});
  $('#nexo-advisor-products')?.addEventListener('click',e=>{const b=e.target.closest('[data-advisor-product]');if(!b)return;const open=window.nexoOpenProduct;if(open)open(b.dataset.advisorProduct);else document.querySelector(`[data-id="${b.dataset.advisorProduct}"]`)?.click()});
  const candidates=$$('.pad .lbl, .pad h2, .pad .sec-nota, .bento-tile, .filtros, .envio-caja, .como-paso, .carrusel, .dato, .cierre-txt, #nexo-advisor');
  candidates.forEach(el=>el.classList.add('growth-reveal','growth-hidden'));
  const io=new IntersectionObserver(entries=>entries.forEach(entry=>{if(!entry.isIntersecting)return;entry.target.classList.remove('growth-hidden');entry.target.classList.add('growth-in');io.unobserve(entry.target)}),{rootMargin:'0px 0px -10% 0px',threshold:.08});
  candidates.forEach(el=>io.observe(el));
})();
