/* ══ Nexo Particles ════════════════════════════════════════
   Adaptación vanilla Canvas del componente Particles de Bencho.
   MIT licensed source concept: bencho.dev/licence.

   Una sola colección de puntos cambia de forma: círculo, cuadrado y flor.
   El puntero los repele y, al tocar, una onda expansiva los dispersa antes
   de que vuelvan a agruparse en la siguiente forma. Los puntos en movimiento
   se estiran en la dirección de su viaje para que el golpe se lea como una
   salpicadura y no como un simple cambio instantáneo.

   ── ONE SET OF DOTS, MANY SHAPES ─────────────────────────
   Los puntos nunca cambian; solo cambia su hogar. Cada forma se muestrea
   con la misma cantidad de puntos y se empareja por ángulo para que la
   transición barra alrededor del centro sin cruces caóticos.

   ── STRETCHED BY SPEED ───────────────────────────────────
   Un punto quieto es redondo; uno que se mueve se dibuja un poco largo en
   el sentido de su velocidad, como una pequeña pincelada de luz.
*/
(() => {
  const canvas = document.getElementById('esfera');
  const hero = document.getElementById('inicio');
  if (!canvas || !hero) return;

  const ctx = canvas.getContext('2d', { alpha: true });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TAU = Math.PI * 2;
  const W = 480;
  const H = 400;
  const CX = W / 2;
  const CY = H / 2;
  const N = 620;
  const SHAPES = ['Circle', 'Square', 'Flower'];
  const pointer = { x: -9999, y: -9999, active: false };

  let dpr = 1;
  let scale = 1;
  let visible = true;
  let running = false;
  let raf = 0;
  let shapeIndex = 0;
  let transitionAt = 0;
  let previous = 0;
  let homesByShape = [];
  let dots = [];

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const angle = (x, y) => Math.atan2(y - CY, x - CX);

  /* ── one spring, for everything that settles ─────────────
     Frames, not milliseconds: dt is expressed in sixtieths of a
     second and damping is raised to it, so dropped frames do not
     change how much energy the spring loses. */
  function spring(dot, dt) {
    dot.vx = (dot.vx + (dot.hx - dot.x) * 0.055 * dt) * Math.pow(0.82, dt);
    dot.vy = (dot.vy + (dot.hy - dot.y) * 0.055 * dt) * Math.pow(0.82, dt);
    dot.x += dot.vx * dt;
    dot.y += dot.vy * dt;
  }

  function outline(shape) {
    const path = new Path2D();
    if (shape === 'Circle') path.arc(CX, CY, 150, 0, TAU);
    else if (shape === 'Square') path.roundRect(CX - 140, CY - 140, 280, 280, 36);
    else {
      /* cinco pétalos redondos alrededor de un centro más pequeño */
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * TAU) / 5;
        const x = CX + Math.cos(a) * 104;
        const y = CY + 8 + Math.sin(a) * 104;
        path.moveTo(x + 60, y);
        path.arc(x, y, 60, 0, TAU);
      }
      path.moveTo(CX + 58, CY + 8);
      path.arc(CX, CY + 8, 58, 0, TAU);
    }
    return path;
  }

  /* ── N points, spread evenly over the inside of a shape ──
     Hex grid con el mismo número de puntos para cada forma. */
  function homes(shape) {
    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const g = off.getContext('2d');
    const path = outline(shape);
    let area = 0;
    for (let y = 1; y < H; y += 2) {
      for (let x = 1; x < W; x += 2) {
        if (g.isPointInPath(path, x, y)) area += 4;
      }
    }
    const spacing = Math.sqrt((area / N) * (2 / Math.sqrt(3)));
    const rowHeight = spacing * Math.sqrt(3) / 2;
    const points = [];
    for (let y = rowHeight / 2, row = 0; y < H; y += rowHeight, row++) {
      for (let x = spacing / 2 + (row % 2) * (spacing / 2); x < W; x += spacing) {
        if (g.isPointInPath(path, x, y)) points.push([x, y]);
      }
    }
    return Array.from({ length: N }, (_, i) => points[Math.floor((i * points.length) / N)]);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.height = `${rect.height}px`;
    scale = Math.min(rect.width * 0.78, rect.height * 0.62) / W;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    homesByShape = SHAPES.map(homes);
    const first = homesByShape[shapeIndex];
    if (!dots.length) {
      dots = first.map(([x, y]) => ({ x, y, hx: x, hy: y, vx: 0, vy: 0, size: rand(.75, 1.8) }));
    } else {
      dots.forEach((dot, i) => { dot.x = dot.hx = first[i][0]; dot.y = dot.hy = first[i][1]; dot.vx = dot.vy = 0; });
    }
  }

  function localPoint(event) {
    const rect = canvas.getBoundingClientRect();
    const left = (rect.width - W * scale) / 2;
    const top = (rect.height - H * scale) / 2;
    return { x: (event.clientX - rect.left - left) / scale, y: (event.clientY - rect.top - top) / scale };
  }

  function setPointer(event) {
    const p = localPoint(event);
    pointer.x = p.x;
    pointer.y = p.y;
    pointer.active = true;
    run();
  }

  function changeShape() {
    const now = performance.now();
    if (now - transitionAt < 650) return;
    shapeIndex = (shapeIndex + 1) % SHAPES.length;
    const next = homesByShape[shapeIndex];
    const old = dots.map((dot, i) => [angle(dot.x, dot.y), i]).sort((a, b) => a[0] - b[0]);
    const target = next.map((home, i) => [angle(home[0], home[1]), i]).sort((a, b) => a[0] - b[0]);
    old.forEach(([, dotIndex], i) => {
      const home = next[target[i][1]];
      const dot = dots[dotIndex];
      dot.hx = home[0];
      dot.hy = home[1];
      dot.vx += rand(-1.1, 1.1);
      dot.vy += rand(-1.1, 1.1);
    });
    transitionAt = now;
    previous = now;
    run();
  }

  function shockwave(point) {
    const strength = 34;
    for (const dot of dots) {
      const dx = dot.x - point.x;
      const dy = dot.y - point.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 220 || distance < 0.01) continue;
      const force = (1 - distance / 220) * strength;
      dot.vx += dx / distance * force;
      dot.vy += dy / distance * force;
    }
  }

  function draw() {
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    ctx.clearRect(0, 0, width, height);
    const left = (width - W * scale) / 2;
    const top = (height - H * scale) / 2;
    ctx.save();
    ctx.translate(left, top);
    ctx.scale(scale, scale);
    ctx.globalCompositeOperation = 'lighter';
    const elapsed = performance.now() - transitionAt;
    const gather = ease(clamp((elapsed - 180) / 760, 0, 1));
    for (const dot of dots) {
      const speed = Math.hypot(dot.vx, dot.vy);
      const radius = dot.size * (speed < .3 ? 1 : Math.min(2.8, 1 + speed * .12));
      let x = dot.x;
      let y = dot.y;
      if (pointer.active && !reduced) {
        const dx = x - pointer.x;
        const dy = y - pointer.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 78 && distance > .01) {
          const push = Math.pow(1 - distance / 78, 2) * 22;
          x += dx / distance * push;
          y += dy / distance * push;
        }
      }
      const depth = clamp((y - (CY - 155)) / 310, 0, 1);
      const r = Math.round(57 + depth * 55);
      const g = Math.round(188 + depth * 47);
      const b = 255;
      const alpha = .38 + depth * .48;
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx.beginPath();
      if (speed < .3) ctx.arc(x, y, radius, 0, TAU);
      else {
        const rotation = Math.atan2(dot.vy, dot.vx);
        ctx.ellipse(x, y, radius * 1.9, radius * .62, rotation, 0, TAU);
      }
      ctx.fill();
    }
    ctx.restore();
  }

  function run() {
    if (raf || !visible) return;
    raf = requestAnimationFrame(frame);
  }

  function frame(now) {
    raf = 0;
    if (!visible) { running = false; return; }
    running = true;
    const dt = previous ? clamp((now - previous) / 16.67, .5, 2.4) : 1;
    previous = now;
    let busy = pointer.active;
    for (const dot of dots) {
      if (pointer.active && !reduced) {
        const dx = dot.x - pointer.x;
        const dy = dot.y - pointer.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 78 && distance > .01) {
          const force = Math.pow(1 - distance / 78, 2) * 8;
          dot.vx += dx / distance * force * dt;
          dot.vy += dy / distance * force * dt;
        }
      }
      spring(dot, dt);
      if (Math.abs(dot.hx - dot.x) > .04 || Math.abs(dot.hy - dot.y) > .04 || Math.abs(dot.vx) > .02 || Math.abs(dot.vy) > .02) busy = true;
      else { dot.x = dot.hx; dot.y = dot.hy; dot.vx = 0; dot.vy = 0; }
    }
    draw();
    if (busy) run();
    else running = false;
  }

  canvas.addEventListener('pointermove', event => { if (pointer.active) setPointer(event); }, { passive: true });
  canvas.addEventListener('pointerleave', () => { pointer.active = false; run(); }, { passive: true });
  canvas.addEventListener('pointerup', () => { pointer.active = false; run(); }, { passive: true });
  canvas.addEventListener('pointercancel', () => { pointer.active = false; run(); }, { passive: true });
  canvas.addEventListener('pointerdown', event => {
    canvas.setPointerCapture?.(event.pointerId);
    const point = localPoint(event);
    setPointer(event);
    if (!reduced) shockwave(point);
    changeShape();
  }, { passive: true });
  addEventListener('resize', () => { resize(); draw(); run(); }, { passive: true });
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (visible) run(); }).observe(hero);

  resize();
  transitionAt = performance.now();
  draw();
  run();
})();
