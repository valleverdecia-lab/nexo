/* Nexo — esfera 3D de partículas (hero) + wordmark de partículas (cierre)
   Canvas procedural: rotación con inercia, repulsión del puntero, pausa fuera de pantalla. */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover:hover) and (pointer:fine)').matches;
  const AC = [103, 217, 255];   /* #67D9FF */
  const WH = [235, 244, 255];

  /* ---------- utilidades ---------- */
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const lerp = (a, b, t) => a + (b - a) * t;

  function setupCanvas(canvas) {
    const ctx = canvas.getContext('2d', { alpha: true });
    let w = 1, h = 1, dpr = 1;
    function resize() {
      const box = canvas.parentElement.getBoundingClientRect();
      const size = Math.max(1, Math.round(Math.min(box.width, box.height)));
      dpr = Math.min(2, devicePixelRatio || 1);
      w = size; h = size;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    return { ctx, get w() { return w; }, get h() { return h; }, resize };
  }

  /* ================= ESFERA 3D ================= */
  const canvas = document.getElementById('esfera');
  if (canvas) {
    const S = setupCanvas(canvas);
    const ctx = S.ctx;
    const N = 1100;
    const R = 0.36; /* radio relativo */

    /* distribución de Fibonacci sobre la esfera */
    const pts = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const rad = Math.sqrt(1 - y * y);
      const th = golden * i;
      pts.push({
        x: Math.cos(th) * rad, y, z: Math.sin(th) * rad,
        /* desplazamiento por repulsión (espacio pantalla) */
        dx: 0, dy: 0, ox: 0, oy: 0, tw: Math.random() * Math.PI * 2
      });
    }

    /* estado de rotación con inercia */
    let rotY = 0.6, rotX = -0.25;
    let velY = 0.0016, velX = 0;
    let dragging = false, lastX = 0, lastY = 0;
    let mx = -1e4, my = -1e4; /* puntero en coords del canvas */

    function project(p) {
      /* rotaciones Y luego X */
      const cy = Math.cos(rotY), sy = Math.sin(rotY);
      const cx = Math.cos(rotX), sx = Math.sin(rotX);
      let x = p.x * cy + p.z * sy;
      let z = -p.x * sy + p.z * cy;
      const y = p.y * cx - z * sx;
      z = p.y * sx + z * cx;
      const persp = 1 / (1.6 - z * 0.55); /* profundidad */
      return { sx: S.w / 2 + x * S.w * R * persp * 2.2, sy: S.h / 2 + y * S.w * R * persp * 2.2, z, persp };
    }

    function frame(t) {
      ctx.clearRect(0, 0, S.w, S.h);
      if (!dragging) { rotY += velY; rotX += velX; velX *= 0.96; }
      rotX = clamp(rotX, -1.1, 1.1);

      const projs = pts.map(project);
      /* repulsión del puntero */
      if (fine && !reduce) {
        for (let i = 0; i < N; i++) {
          const p = pts[i], pr = projs[i];
          const ddx = pr.sx - mx, ddy = pr.sy - my;
          const d2 = ddx * ddx + ddy * ddy;
          const R2 = 90 * 90;
          if (d2 < R2) {
            const d = Math.sqrt(d2) || 1;
            const f = (1 - d / 90) * 26;
            p.dx = (ddx / d) * f; p.dy = (ddy / d) * f;
          }
        }
      }
      for (const p of pts) {
        p.dx = lerp(p.dx, 0, 0.12); p.dy = lerp(p.dy, 0, 0.12);
        p.ox = lerp(p.ox, p.dx, 0.2); p.oy = lerp(p.oy, p.dy, 0.2);
      }

      /* halo central */
      const g = ctx.createRadialGradient(S.w / 2, S.h / 2, S.w * 0.05, S.w / 2, S.h / 2, S.w * 0.48);
      g.addColorStop(0, 'rgba(103,217,255,0.10)');
      g.addColorStop(0.55, 'rgba(103,217,255,0.035)');
      g.addColorStop(1, 'rgba(103,217,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S.w, S.h);

      ctx.globalCompositeOperation = 'lighter';
      const order = projs.map((pr, i) => i).sort((a, b) => projs[b].z - projs[a].z);
      for (const i of order) {
        const pr = projs[i], p = pts[i];
        const depth = (pr.z + 1) / 2; /* 0 lejos, 1 cerca */
        const tw = 0.72 + 0.28 * Math.sin(t * 0.002 + p.tw);
        const size = (0.8 + depth * 2.1) * tw;
        const mix = depth * depth;
        const r = Math.round(lerp(AC[0], WH[0], mix * 0.85));
        const gg = Math.round(lerp(AC[1], WH[1], mix * 0.85));
        const b = Math.round(lerp(AC[2], WH[2], mix * 0.85));
        ctx.fillStyle = `rgba(${r},${gg},${b},${(0.18 + depth * 0.8) * tw})`;
        ctx.beginPath();
        ctx.arc(pr.sx + p.ox, pr.sy + p.oy, size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    /* bucle con pausa fuera de pantalla */
    let raf = 0, visible = false;
    function loop(t) {
      if (!visible) { raf = 0; return; }
      frame(t);
      raf = requestAnimationFrame(loop);
    }
    new IntersectionObserver(es => es.forEach(e => {
      visible = e.isIntersecting;
      if (visible && !raf) raf = requestAnimationFrame(loop);
    }), { rootMargin: '80px' }).observe(canvas);

    /* arrastrar para rotar */
    canvas.addEventListener('pointerdown', e => {
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', e => {
      const r = canvas.getBoundingClientRect();
      mx = e.clientX - r.left; my = e.clientY - r.top;
      if (dragging) {
        velY = (e.clientX - lastX) * 0.00035;
        velX = (e.clientY - lastY) * 0.00030;
        rotY += (e.clientX - lastX) * 0.005;
        rotX += (e.clientY - lastY) * 0.004;
        lastX = e.clientX; lastY = e.clientY;
      }
    });
    addEventListener('pointerup', () => { dragging = false; canvas.style.cursor = 'grab'; });
    canvas.addEventListener('pointerleave', () => { mx = my = -1e4; });
    canvas.style.cursor = 'grab';
    canvas.setAttribute('aria-label', 'Esfera de partículas interactiva: arrastre para rotar');
    canvas.setAttribute('role', 'img');

    new ResizeObserver(() => { S.resize(); if (reduce) frame(0); }).observe(canvas.parentElement);
    if (reduce) { frame(0); } else { raf = requestAnimationFrame(loop); visible = true; }
  }

  /* ================= WORDMARK NEXO (cierre) ================= */
  const wc = document.getElementById('nexo-word');
  if (wc) {
    const S = setupCanvas(wc);
    const ctx = S.ctx;

    /* objetivos: píxeles del texto NEXO */
    function targets() {
      const off = document.createElement('canvas');
      off.width = S.w; off.height = S.h;
      const octx = off.getContext('2d');
      octx.fillStyle = '#fff';
      const fs = Math.min(S.w / 4.4, S.h * 0.62);
      octx.font = `800 ${fs}px Outfit, system-ui, sans-serif`;
      octx.textAlign = 'center'; octx.textBaseline = 'middle';
      octx.letterSpacing = '0.06em';
      octx.fillText('NEXO', S.w / 2, S.h / 2);
      const data = octx.getImageData(0, 0, S.w, S.h).data;
      const pts = [];
      const step = Math.max(3, Math.round(S.w / 300));
      for (let y = 0; y < S.h; y += step)
        for (let x = 0; x < S.w; x += step)
          if (data[(y * S.w + x) * 4 + 3] > 128)
            pts.push({ tx: x, ty: y, x: S.w / 2 + (Math.random() - .5) * S.w * 1.4, y: S.h / 2 + (Math.random() - .5) * S.h * 2.2, tw: Math.random() * Math.PI * 2 });
      return pts;
    }
    let P = [];
    let assembled = false;
    let mx = -1e4, my = -1e4;

    function frame(t) {
      ctx.clearRect(0, 0, S.w, S.h);
      ctx.globalCompositeOperation = 'lighter';
      for (const p of P) {
        if (!reduce) {
          /* repulsión suave del puntero */
          const ddx = p.x - mx, ddy = p.y - my;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 < 60 * 60) {
            const d = Math.sqrt(d2) || 1;
            const f = (1 - d / 60) * 34;
            p.x += (ddx / d) * f * 0.14; p.y += (ddy / d) * f * 0.14;
          }
          const ease = assembled ? 0.055 : 0.028;
          p.x = lerp(p.x, p.tx, ease);
          p.y = lerp(p.y, p.ty, ease);
        } else { p.x = p.tx; p.y = p.ty; }
        const tw = 0.7 + 0.3 * Math.sin(t * 0.0022 + p.tw);
        const dHome = Math.hypot(p.x - p.tx, p.y - p.ty);
        const near = clamp(1 - dHome / 60, 0, 1);
        ctx.fillStyle = `rgba(${Math.round(lerp(AC[0], WH[0], near * .8))},${Math.round(lerp(AC[1], WH[1], near * .8))},${Math.round(lerp(AC[2], WH[2], near * .8))},${(0.35 + near * 0.55) * tw})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (1 + near * 0.9) * tw, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    let raf = 0, visible = false;
    function loop(t) {
      if (!visible) { raf = 0; return; }
      frame(t);
      raf = requestAnimationFrame(loop);
    }
    function boot() {
      S.resize();
      P = targets();
      if (reduce) frame(0);
      else { visible = true; raf = requestAnimationFrame(loop); }
    }
    if (document.fonts?.ready) document.fonts.ready.then(boot).catch(boot); else boot();

    new IntersectionObserver(es => es.forEach(e => {
      visible = e.isIntersecting && !reduce;
      if (visible && !raf) raf = requestAnimationFrame(loop);
      if (e.isIntersecting) assembled = true;
    }), { rootMargin: '60px' }).observe(wc);

    wc.addEventListener('pointermove', e => {
      const r = wc.getBoundingClientRect();
      mx = e.clientX - r.left; my = e.clientY - r.top;
    });
    wc.addEventListener('pointerleave', () => { mx = my = -1e4; });

    new ResizeObserver(() => {
      S.resize();
      if (P.length) P = targets();
      if (reduce) frame(0);
    }).observe(wc.parentElement);
  }
})();
