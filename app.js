/* Nexo — lógica del catálogo */
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const WA="5356865093";
const TOTAL=CATALOGO.length;
const fmt=c=>(c/100).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:2})+" USD";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>"&#"+c.charCodeAt(0)+";");

/* grupos: g -> {nombre, subs:[nombres]} */
const GRUPO_NOMBRE={...Object.fromEntries(Object.entries(GRUPOS).map(([g,d])=>[g,d.nombre]))};
const SUBS_TODOS=Object.values(GRUPOS).flatMap(d=>d.subs);

/* estado */
let g="", sub="", q="", orden="rel", visibles=36;
const porId=Object.fromEntries(CATALOGO.map(p=>[p.s,p]));
let lista=[...CATALOGO];

/* ---------- carrito ---------- */
const LS=(()=>{try{return window["local"+"Storage"]}catch(e){return null}})();
let carro={};
try{carro=LS?JSON.parse(LS.getItem("nexo-carro")||"{}")||{}:{}}catch(e){}
const guardarCarro=()=>{try{LS&&LS.setItem("nexo-carro",JSON.stringify(carro))}catch(e){}};
const nCarro=()=>Object.values(carro).reduce((a,b)=>a+b,0);
function pintarCarroN(){const n=nCarro(),el=$("#carro-n");el.hidden=!n;el.textContent=n}
function addCarro(id){carro[id]=(carro[id]||0)+1;guardarCarro();pintarCarroN();pintarCarro()}
function delCarro(id){delete carro[id];guardarCarro();pintarCarroN();pintarCarro()}
function setCarro(id,cant){if(cant<=0)delCarro(id);else{carro[id]=cant;guardarCarro();pintarCarroN();pintarCarro()}}
function totalCarro(){return Object.keys(carro).reduce((a,id)=>{const p=porId[id];return p?a+carro[id]*p.pv:0},0)}
function pintarCarro(){
  const ul=$("#carro-lista"), ids=Object.keys(carro).filter(id=>porId[id]);
  $("#carro-vacio").hidden=ids.length>0;
  $("#carro-pie").style.display=ids.length?"":"none";
  ul.innerHTML=ids.map(id=>{const p=porId[id],cant=carro[id];
    return `<li class="carro-item">
      <img src="fotos/${p.s}.webp" alt="" loading="lazy" decoding="async">
      <div class="carro-info">
        <p class="carro-nombre">${esc(p.n)}</p>
        <p class="m carro-precio">${fmt(p.pv)} × ${cant} = ${fmt(p.pv*cant)}</p>
        <div class="carro-cant">
          <button data-cant="${p.s}" data-q="${cant-1}" aria-label="Quitar uno">−</button>
          <span class="m">${cant}</span>
          <button data-cant="${p.s}" data-q="${cant+1}" aria-label="Añadir uno">+</button>
        </div>
      </div>
      <button class="carro-x" data-del="${p.s}" aria-label="Eliminar">✕</button>
    </li>`}).join("");
  const tot=totalCarro();
  $("#carro-total").textContent=fmt(tot);
  const lineas=ids.map(id=>{const p=porId[id];return `• ${carro[id]} × ${p.n} — ${fmt(carro[id]*p.pv)}`});
  const msg=`Hola, quiero hacer un pedido:\n${lineas.join("\n")}\nTotal: ${fmt(tot)}`;
  $("#carro-wa").href=`https://wa.me/${WA}?text=${encodeURIComponent(msg)}`;
}
const carroEl=$("#carro"), carroFondo=$("#carro-fondo");
function abrirCarro(o){carroEl.hidden=!o;carroFondo.hidden=!o;document.body.style.overflow=o?"hidden":""}
$("#carro-btn").addEventListener("click",()=>{pintarCarro();abrirCarro(true)});
$("#carro-cerrar").addEventListener("click",()=>abrirCarro(false));
carroFondo.addEventListener("click",()=>abrirCarro(false));
$("#carro-lista").addEventListener("click",e=>{
  const d=e.target.closest("[data-del]"); if(d){delCarro(d.dataset.del);return}
  const c=e.target.closest("[data-cant]"); if(c)setCarro(c.dataset.cant,+c.dataset.q);
});
addEventListener("keydown",e=>{if(e.key==="Escape"&&!carroEl.hidden)abrirCarro(false)});

/* ---------- filtros ---------- */
function aplicar(){
  lista=CATALOGO.filter(p=>
    (g===""||p.g===g) && (sub===""||p.c===sub) &&
    (!q||(p.n+" "+p.c+" "+p.dc).toLowerCase().includes(q))
  );
  if(orden==="asc") lista.sort((a,b)=>a.pv-b.pv);
  else if(orden==="desc") lista.sort((a,b)=>b.pv-a.pv);
  else if(orden==="nombre") lista.sort((a,b)=>a.n.localeCompare(b.n,'es'));
  visibles=36;
  render();
}

function tarjeta(p,i){
  const agotado=p.e==="agotado";
  const oro=(i%4===0||i%4===3);
  return `<article class="pieza${oro?" pieza-oro":""}" data-id="${p.s}" style="transition-delay:${Math.min(i,12)*.03}s" tabindex="0" role="button" aria-label="${esc(p.n)}">
    <div class="pieza-marco">
      <img src="fotos/${p.s}.webp" alt="${esc(p.n)}" loading="lazy" decoding="async" width="1000" height="1000">
      <button class="pieza-add" data-add="${p.s}" aria-label="Añadir al carrito: ${esc(p.n)}" title="Añadir al carrito">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
      </button>
    </div>
    <p class="pieza-estado"><span class="estado estado--${agotado?"agotado":"hay"}">${agotado?"Agotado":"Disponible"}</span></p>
    <h3 class="pieza-nombre d">${esc(p.n)}</h3>
    <div class="pieza-pie"><span class="pieza-cat">${esc(p.c)}</span><span class="pieza-precio">${fmt(p.pv)}</span></div>
  </article>`;
}

function render(){
  const v=$("#vitrina");
  const total=lista.length;
  v.innerHTML=total?lista.slice(0,visibles).map(tarjeta).join(""):"";
  const vac=$("#vacio");
  vac.hidden=total>0;
  $("#mas").style.display=total>visibles?"":"none";
  const vacioWa=$("#vacio-wa");
  const catVacia=!!sub && !CATALOGO.some(p=>p.c===sub);
  if(total===0&&catVacia){
    $("#vacio-t").textContent="Sin disponibilidad por ahora.";
    $("#vacio-n").textContent="Estamos reponiendo esta categoría. Escríbanos y le avisamos en cuanto llegue mercancía nueva.";
    vacioWa.hidden=false;
  }else{
    $("#vacio-t").textContent="Sin resultados.";
    $("#vacio-n").textContent="Pruebe otra palabra o quite los filtros.";
    vacioWa.hidden=true;
  }
  $("#cuenta").textContent=`${Math.min(visibles,total)} de ${total} productos${total<TOTAL?` (${TOTAL} en total)`:""}`;
  $$(".pieza",v).forEach((el,i)=>{ if(i<visibles) requestAnimationFrame(()=>requestAnimationFrame(()=>el.classList.add("in"))); });
}

$("#tabs").addEventListener("click",e=>{
  const t=e.target.closest(".tab"); if(!t)return;
  $$(".tab").forEach(x=>x.classList.toggle("on",x===t));
  g=t.dataset.g; sub=""; pintarChips(); aplicar();
});
function pintarChips(){
  const subs=g===""?SUBS_TODOS:GRUPOS[g].subs;
  $("#chips").innerHTML=`<button class="chip${sub?"":" on"}" data-sub="">Todas</button>`+subs.map(s=>{
    const n=CATALOGO.filter(p=>p.c===s).length;
    return `<button class="chip${sub===s?" on":""}" data-sub="${esc(s)}">${esc(s)}${n?" · "+n:""}</button>`;
  }).join("");
}
$("#chips").addEventListener("click",e=>{
  const c=e.target.closest(".chip"); if(!c)return;
  $$("#chips .chip").forEach(x=>x.classList.toggle("on",x===c));
  sub=c.dataset.sub; aplicar();
});
let tq; $("#buscar").addEventListener("input",e=>{clearTimeout(tq);tq=setTimeout(()=>{q=e.target.value.trim().toLowerCase();aplicar()},180)});
$("#orden").addEventListener("change",e=>{orden=e.target.value;aplicar()});

/* mostrar más */
$("#mas").addEventListener("click",()=>{
  const antes=visibles; visibles+=36; render();
  const sig=$$("#vitrina .pieza")[antes]; if(sig) sig.scrollIntoView({block:"center",behavior:reduce?"auto":"smooth"});
});

/* ---------- modal ---------- */
const modal=$("#modal");
let abierto="";
function abrir(id){
  const p=porId[id]; if(!p)return;
  abierto=id;
  $("#m-img").src=`fotos/${p.s}.webp`; $("#m-img").alt=p.n;
  $("#m-cat").textContent=`${GRUPO_NOMBRE[p.g]} · ${p.c}`;
  $("#m-nombre").textContent=p.n;
  const est=$("#m-estado"); est.className="estado estado--"+(p.e==="agotado"?"agotado":"hay");
  est.textContent=p.e==="agotado"?"Agotado":"Disponible";
  $("#m-precio").textContent=fmt(p.pv);
  $("#m-desc-c").textContent=p.dc||"";
  $("#m-desc-l").textContent=p.dl||"";
  $("#m-venta").textContent=p.v||"";
  $("#m-specs").innerHTML=(p.sp||[]).map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");
  $("#m-wa").href=`https://wa.me/${WA}?text=${encodeURIComponent(`Hola, me interesa: ${p.n} — ${fmt(p.pv)}`)}`;
  const b=$("#m-add"); b.textContent="Añadir al carrito"; b.disabled=false;
  modal.showModal(); document.body.style.overflow="hidden";
}
$("#vitrina").addEventListener("click",e=>{
  const add=e.target.closest("[data-add]");
  if(add){
    addCarro(add.dataset.add);
    add.classList.add("ok");
    setTimeout(()=>add.classList.remove("ok"),900);
    return;
  }
  const c=e.target.closest(".pieza");if(c)abrir(c.dataset.id);
});
$("#vitrina").addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){if(e.target.closest("button"))return;const c=e.target.closest(".pieza");if(c){e.preventDefault();abrir(c.dataset.id)}}});
$("#m-add").addEventListener("click",()=>{
  if(!abierto)return;
  addCarro(abierto);
  const b=$("#m-add"); b.textContent="Añadido ✓"; b.disabled=true;
  setTimeout(()=>{b.textContent="Añadir al carrito";b.disabled=false},1400);
});
function cerrarModal(){modal.close()}
$("#cerrar").addEventListener("click",cerrarModal);
modal.addEventListener("click",e=>{if(e.target===modal)cerrarModal()});
modal.addEventListener("close",()=>{document.body.style.overflow=""});

/* ---------- testimonios ---------- */
const RESENAS=[
 {t:"Era mi primera compra por internet y tenía mis dudas, pero como ya antes le había comprado alimentos a la tienda, me decidí a confiar. La mensajería gratuita fue una maravilla y mi split llegó ese mismo día. Enfría súper bien y me ha aliviado muchísimo con este calor.",n:"Yanet",r:"Cliente",l:"El Luyanó, La Habana",i:"Y",p:"Split de aire acondicionado",cal:"4.9 de 5"},
 {t:"Compré el sillón reclinable de cuero y llegó al otro día. Venía igual a la foto, sin un rasguño. El muchacho del reparto me ayudó a subirlo hasta el tercer piso.",n:"Laura",r:"Cliente",l:"La Habana Vieja, La Habana",i:"L",p:"Sillón reclinable de cuero",cal:"5 de 5"},
 {t:"El combo del inversor con las cuatro baterías me resolvió los apagones en la casa. Me explicaron por WhatsApp cómo conectarlo y quedó andando esa misma tarde, con una calidad enorme.",n:"Luis Ramírez",r:"Cliente",l:"Playa, La Habana",i:"LR",p:"Combo de inversor con cuatro baterías",cal:"4.7 de 5"},
 {t:"Lo que más me gustó es que le puedes escribir por WhatsApp y te contesta una persona, no un robot. Ya me he acostumbrado a comprar con ellos: una garantía asegurada.",n:"Dayana Fonseca",r:"Cliente",l:"Marianao, La Habana",i:"DF",p:"Paneles solares",cal:"5 de 5"},
 {t:"Bueno, estuve un poco disgustada porque la primera vez que decidí comunicarme con ellos demoraron en responder, pero me pudieron atender con mensajería gratuita e incluso me ayudaron con la instalación del producto y todo. Me encantó todo.",n:"Cliente",r:"Compra verificada",l:"",i:"✓",p:"",cal:"4.6 de 5"},
];
$("#riel").innerHTML=RESENAS.map(r=>`<li>
  <p><span class="resena-est" aria-hidden="true">★★★★★</span><span class="resena-nota m">${esc(r.cal)}</span></p>
  <blockquote class="resena-texto">“${esc(r.t)}”</blockquote>
  ${r.p?`<p class="resena-prod">${esc(r.p)}</p>`:""}
  <div class="resena-quien"><span class="resena-retrato" aria-hidden="true">${r.i}</span><span><strong>${esc(r.n)}</strong><span class="resena-meta">${esc(r.r)}${r.l?" · "+esc(r.l):""}</span></span></div>
</li>`).join("");
let ri=0;
const porVista=()=>matchMedia("(min-width:900px)").matches?2:1;
function paso(dir){
  const max=RESENAS.length-porVista();
  ri=Math.max(0,Math.min(ri+dir,max));
  $("#riel").style.transform=`translateX(-${ri*(100/porVista())}%)`;
}
$("#prev").addEventListener("click",()=>paso(-1));
$("#next").addEventListener("click",()=>paso(1));
addEventListener("resize",()=>paso(0));

/* ---------- menú móvil ---------- */
const menu=$("#menu-movil");
$("#menu-grupos").innerHTML=Object.entries(GRUPOS).map(([gk,d])=>`
  <div><a class="menu-grupo" href="#catalogo" data-g="${gk}">${esc(d.nombre)}<span class="menu-n">${CATALOGO.filter(p=>p.g===gk).length}</span></a>
  <div class="menu-subs">${d.subs.map(s=>`<a class="menu-sub" href="#catalogo" data-g="${gk}" data-sub="${esc(s)}">${esc(s)}</a>`).join("")}</div></div>`).join("");
$("#mn-todo").textContent=TOTAL;
function toggleMenu(open){
  menu.hidden=!open; $("#menu-btn").setAttribute("aria-expanded",open); document.body.style.overflow=open?"hidden":"";
}
$("#menu-btn").addEventListener("click",()=>toggleMenu(menu.hidden));
menu.addEventListener("click",e=>{
  const a=e.target.closest("a"); if(!a)return;
  toggleMenu(false);
  if(a.dataset.g!==undefined){
    g=a.dataset.g||""; sub=a.dataset.sub||"";
    $$("#tabs .tab").forEach(t=>t.classList.toggle("on",t.dataset.g===g));
    pintarChips(); aplicar();
  }
});

/* footer categorías */
$("#f-cats").innerHTML=Object.entries(GRUPOS).map(([gk,d])=>`<a href="#catalogo" data-fg="${gk}">${esc(d.nombre)}</a>`).join("");
$("#f-cats").addEventListener("click",e=>{
  const a=e.target.closest("a[data-fg]"); if(!a)return;
  g=a.dataset.fg; sub="";
  $$("#tabs .tab").forEach(t=>t.classList.toggle("on",t.dataset.g===g));
  pintarChips(); aplicar();
});

/* ---------- flecha subir ---------- */
const subir=$("#subir");
new IntersectionObserver(es=>es.forEach(x=>{subir.hidden=!x.isIntersecting}),{rootMargin:"-120px 0px 0px 0px"}).observe($("#catalogo"));
subir.addEventListener("click",()=>$("#catalogo").scrollIntoView({block:"start",behavior:reduce?"auto":"smooth"}));

/* barra de progreso + sección visible */
addEventListener("scroll",()=>{
  $("#bar").style.transform=`scaleX(${scrollY/(document.body.scrollHeight-innerHeight||1)})`;
  document.querySelector("header").classList.toggle("scr",scrollY>40);
},{passive:true});
new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)$("#sec").textContent=e.target.id==="inicio"?"":e.target.id==="catalogo"?"Catálogo":e.target.id==="resenas"?"Testimonios":"Contacto"}),{rootMargin:"-40% 0px -40% 0px"}).observe($("#inicio"));
["catalogo","resenas","contacto"].forEach(id=>new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)$("#sec").textContent=id==="catalogo"?"Catálogo":id==="resenas"?"Testimonios":"Contacto"}),{rootMargin:"-40% 0px -40% 0px"}).observe($("#"+id)));

/* reveal al hacer scroll */
const ro=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.style.opacity=1;e.target.style.transform="none";ro.unobserve(e.target)}}),{rootMargin:"-40px"});
[".pad .lbl",".pad h2",".carrusel",".filtros",".sec-nota"].forEach(sel=>$$(sel).forEach(el=>{el.style.opacity=0;el.style.transform="translateY(24px)";el.style.transition="opacity .7s,transform .7s cubic-bezier(.22,1,.36,1)";ro.observe(el)}));

/* cursor custom (escritorio) */
if(matchMedia('(hover:hover) and (pointer:fine)').matches){
  document.documentElement.classList.add("hc");
  let mx=-99,my=-99,rx=-99,ry=-99;
  addEventListener("pointermove",e=>{mx=e.clientX;my=e.clientY;$("#ring").classList.toggle("h",!!e.target.closest("a,button,input,select,.pieza"))});
  (function loop(){rx+=(mx-rx)*.2;ry+=(my-ry)*.2;
    $("#cur").style.transform=`translate(${mx}px,${my}px)`;
    $("#ring").style.transform=`translate(${rx}px,${ry}px)`;
    requestAnimationFrame(loop)})();
}

/* intro: reveal del titular */
addEventListener("load",()=>setTimeout(()=>document.body.classList.add("go"),reduce?0:300));

pintarChips(); pintarCarroN(); aplicar();
