(() => {
  const canvas = document.getElementById("esfera");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const hero = document.getElementById("inicio");
  const top = document.querySelector("header");
  const kicker = document.querySelector("#inicio .kicker");
  const quieto = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let W = 0, H = 0, cx = 0, cy = 0, R = 0, dpr = 1;
  let particles = [];
  let rotationY = 0, rotationX = 0.35, tiltX = 0, tiltY = 0, t = 0;
  let visible = true, running = false;
  const mouse = { x: -9999, y: -9999, active: false };

  function resize() {
    const hr = hero.getBoundingClientRect();
    const y0 = (top ? top.getBoundingClientRect().bottom : 60) - hr.top;
    const y1 = (kicker ? kicker.getBoundingClientRect().top : hr.height * 0.6) - hr.top;
    const gap = Math.max(160, y1 - y0 - 16);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = hr.width; H = gap;
    canvas.style.top = (y0 + 8) + "px";
    canvas.style.height = H + "px";
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = W / 2; cy = H / 2;
    R = Math.min(W * 0.36, H * 0.4);
  }

  function createParticles() {
    const n = W < 700 ? 520 : 900;
    particles = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = golden * i;
      particles.push({
        baseX: Math.cos(th) * r, baseY: y, baseZ: Math.sin(th) * r,
        x: 0, y: 0, z: 0,
        size: 0.9 + Math.random() * 1.4
      });
    }
  }

  function project(x, y, z, ry, rx) {
    const cosY = Math.cos(ry), sinY = Math.sin(ry);
    let x1 = x * cosY - z * sinY;
    let z1 = x * sinY + z * cosY;
    const cosX = Math.cos(rx), sinX = Math.sin(rx);
    let y1 = y * cosX - z1 * sinX;
    let z2 = y * sinX + z1 * cosX;
    const persp = 2.6 / (2.6 - z2);
    return {
      screenX: cx + x1 * R * persp,
      screenY: cy + y1 * R * persp,
      depth: z2,
      scale: persp
    };
  }

  function animate() {
    if (!visible) { running = false; return; }
    running = true;
    t += 0.016;
    rotationY += 0.0045;
    const pulse = 1 + Math.sin(t * 1.6) * 0.035;
    const tx = mouse.active ? ((mouse.y - cy) / H) * 0.5 : 0;
    const ty = mouse.active ? ((mouse.x - cx) / W) * 0.6 : 0;
    tiltX += (tx - tiltX) * 0.05;
    tiltY += (ty - tiltY) * 0.05;

    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";

    for (const p of particles) {
      p.x = p.baseX * pulse;
      p.y = p.baseY * pulse;
      p.z = p.baseZ * pulse;

      const projected = project(p.x, p.y, p.z, rotationY + tiltY, rotationX + tiltX);
      const px = projected.screenX;
      const py = projected.screenY;

      const dx = px - mouse.x;
      const dy = py - mouse.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const interactionRadius = 170;
      let push = 0;
      if (mouse.active && distance < interactionRadius) {
        push = (1 - distance / interactionRadius) * 26;
      }

      const drawX = px + (dx / (distance || 1)) * push;
      const drawY = py + (dy / (distance || 1)) * push;

      const depthAlpha = 0.6 + ((projected.depth + 1) / 2) * 0.4;
      const size = p.size * projected.scale * (1 + push * 0.015);

      // Violeta (atrás) → amarillo dorado (adelante)
      const k = (projected.depth + 1) / 2;
      const li = 1 + push * 0.02;
      const r = Math.min(255, (165 + k * 90) * li) | 0;
      const g = Math.min(255, (130 + k * 80) * li) | 0;
      const b = Math.min(255, (255 - k * 175) * li) | 0;
      const alpha = depthAlpha * (0.6 + push / 60);
      ctx.beginPath();
      ctx.arc(drawX, drawY, size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(alpha, 1)})`;
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    if (!quieto) requestAnimationFrame(animate); else running = false;
  }

  function setMouse(x, y) {
    const r = canvas.getBoundingClientRect();
    mouse.x = x - r.left;
    mouse.y = y - r.top;
    mouse.active = true;
  }

  window.addEventListener("resize", () => { resize(); createParticles(); if (quieto) animate(); });
  window.addEventListener("mousemove", e => setMouse(e.clientX, e.clientY), { passive: true });
  document.addEventListener("mouseleave", () => { mouse.active = false; });
  window.addEventListener("touchmove", e => {
    if (e.touches.length > 0) setMouse(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  window.addEventListener("touchend", () => { mouse.active = false; });

  new IntersectionObserver(es => {
    visible = es[0].isIntersecting;
    if (visible && !running) requestAnimationFrame(animate);
  }).observe(hero);

  resize();
  createParticles();
  requestAnimationFrame(animate);
  const again = () => { resize(); createParticles(); };
  window.addEventListener("load", again);
  if (document.fonts) document.fonts.ready.then(again);
  setTimeout(again, 1200);
})();
