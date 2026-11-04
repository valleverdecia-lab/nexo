/* Nexo — micro-interacciones
   Botones magnéticos · tilt en tarjetas · odómetros · apertura Duo · pasos sticky */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover:hover) and (pointer:fine)').matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ---------- botones magnéticos ---------- */
  if (fine && !reduce) {
    document.addEventListener('pointermove', e => {
      for (const b of $$('.magnet')) {
        const r = b.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const dx = e.clientX - cx, dy = e.clientY - cy;
        const dist = Math.hypot(dx, dy);
        const radio = Math.max(r.width, r.height) * 0.9 + 30;
        if (dist < radio) {
          const f = 1 - dist / radio;
          b.style.transform = `translate(${dx * 0.18 * f}px, ${dy * 0.22 * f}px)`;
        } else if (b.style.transform) {
          b.style.transform = '';
        }
      }
    }, { passive: true });
  }

  /* ---------- tilt en tarjetas de producto ---------- */
  if (fine && !reduce) {
    const vit = $('#vitrina');
    if (vit) {
      vit.addEventListener('pointermove', e => {
        const p = e.target.closest('.pieza');
        if (!p) return;
        const m = p.querySelector('.pieza-marco');
        if (!m) return;
        const r = p.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        m.style.transform = `rotateX(${(-py * 7).toFixed(2)}deg) rotateY(${(px * 7).toFixed(2)}deg)`;
      }, { passive: true });
      vit.addEventListener('pointerout', e => {
        const p = e.target.closest('.pieza');
        if (p && !p.contains(e.relatedTarget)) {
          const m = p.querySelector('.pieza-marco');
          if (m) m.style.transform = '';
        }
      });
    }
  }

  /* ---------- odómetros ---------- */
  const odos = $$('.odo');
  if (odos.length) {
    const io = new IntersectionObserver(es => es.forEach(en => {
      if (!en.isIntersecting) return;
      io.unobserve(en.target);
      const el = en.target;
      const n = +el.dataset.n || 0, suf = el.dataset.suf || '';
      if (reduce) { el.textContent = n + suf; return; }
      const t0 = performance.now(), dur = 1400;
      const paso = t => {
        const k = Math.min(1, (t - t0) / dur);
        const e = 1 - Math.pow(1 - k, 3);
        el.textContent = Math.round(n * e) + (k === 1 ? suf : '');
        if (k < 1) requestAnimationFrame(paso);
      };
      requestAnimationFrame(paso);
    }), { threshold: .4 });
    odos.forEach(o => io.observe(o));
  }

  /* ---------- apertura Duo ---------- */
  const duo = $('.duo-wrap');
  if (duo) {
    new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { duo.classList.add('abierto'); }
    }), { threshold: .6 }).observe(duo);
  }

  /* ---------- pasos sticky (cómo funciona) ---------- */
  const track = $('.como-track');
  if (track) {
    const pasos = $$('.como-paso', track);
    const num = $('#como-num');
    const barra = $('.como-barra i');
    const onScroll = () => {
      const r = track.getBoundingClientRect();
      const total = r.height - innerHeight * 0.55;
      const prog = Math.min(1, Math.max(0, -r.top / Math.max(1, total)));
      const idx = Math.min(pasos.length - 1, Math.floor(prog * pasos.length));
      pasos.forEach((p, i) => p.classList.toggle('activo', i <= idx));
      if (num) num.textContent = String(idx + 1).padStart(2, '0');
      if (barra) barra.style.transform = `scaleY(${prog})`;
    };
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- enlaces del nav: subrayado dibujado ---------- */
  const estilo = document.createElement('style');
  estilo.textContent = `.nav-der .cta-linea{position:relative}
  .nav-der .cta-linea::after{content:"";position:absolute;left:1.05rem;right:1.05rem;bottom:.42rem;height:1px;background:var(--ac);transform:scaleX(0);transform-origin:left;transition:transform .28s var(--ease)}
  .nav-der .cta-linea:hover::after{transform:scaleX(1)}`;
  document.head.appendChild(estilo);
})();

/* ===== card swap ===== */
(function () {
  const zona = document.getElementById('swap');
  if (!zona) return;
  const cards = [...zona.querySelectorAll('.swap-card[data-swap]')];
  const prev = document.getElementById('swap-prev');
  const next = document.getElementById('swap-next');
  const cont = document.getElementById('swap-cont');
  if (cards.length < 2 || !prev || !next) return;
  let pila = cards.slice(); // pila[0] = carta de arriba
  let idx = 0;
  let timer = null;
  let reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function pintar() {
    pila.forEach((c, i) => {
      c.setAttribute('data-swap', String(Math.min(i, 3)));
      c.setAttribute('aria-hidden', i === 0 ? 'false' : 'true');
      c.tabIndex = i === 0 ? 0 : -1;
    });
    if (cont) cont.textContent = (idx + 1) + ' / ' + cards.length;
  }
  function avanza() { pila.push(pila.shift()); idx = (idx + 1) % cards.length; pintar(); }
  function retrocede() { pila.unshift(pila.pop()); idx = (idx - 1 + cards.length) % cards.length; pintar(); }
  function auto(on) {
    if (timer) { clearInterval(timer); timer = null; }
    if (on && !reducido) timer = setInterval(avanza, 5200);
  }
  prev.addEventListener('click', () => { retrocede(); auto(true); });
  next.addEventListener('click', () => { avanza(); auto(true); });
  cards.forEach(c => c.addEventListener('click', () => { avanza(); auto(true); }));
  zona.addEventListener('mouseenter', () => auto(false));
  zona.addEventListener('mouseleave', () => auto(true));
  let tX = null;
  zona.addEventListener('touchstart', e => { tX = e.touches[0].clientX; auto(false); }, { passive: true });
  zona.addEventListener('touchend', e => {
    if (tX === null) return;
    const d = e.changedTouches[0].clientX - tX;
    if (Math.abs(d) > 40) { d < 0 ? avanza() : retrocede(); }
    tX = null; auto(true);
  });
  // pausa cuando no está visible
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(en => {
      en.forEach(x => auto(x.isIntersecting));
    }, { threshold: .35 });
    io.observe(zona);
  }
  pintar();
  auto(true);
})();
