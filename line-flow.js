/* Nexo Line Flow
   Lightweight Canvas equivalent of the requested React background animation.
   Configure with <canvas data-direction="up|down"> or at runtime:
   window.NexoLineFlow.setDirection('up' | 'down')
*/
(() => {
  const canvas = document.getElementById('line-flow');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: true });
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const COLOR = '98,91,255'; // Nexo electric indigo
  const lines = [];
  const state = { direction: canvas.dataset.direction === 'down' ? 'down' : 'up', width: 0, height: 0, dpr: 1, raf: 0, last: 0 };
  const count = 24;

  const random = (a, b) => a + Math.random() * (b - a);
  const sign = () => state.direction === 'down' ? 1 : -1;

  function resize() {
    state.width = window.innerWidth;
    state.height = window.innerHeight;
    state.dpr = Math.min(window.devicePixelRatio || 1, 1.35);
    canvas.width = Math.round(state.width * state.dpr);
    canvas.height = Math.round(state.height * state.dpr);
    canvas.style.width = `${state.width}px`;
    canvas.style.height = `${state.height}px`;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    if (!lines.length) {
      for (let i = 0; i < count; i++) lines.push({
        x: random(-state.width * .15, state.width * 1.15),
        y: random(-state.height, state.height),
        length: random(120, 360),
        width: random(.5, 1.35),
        speed: random(8, 22),
        amplitude: random(18, 90),
        frequency: random(.0015, .004),
        phase: random(0, Math.PI * 2),
        alpha: random(.08, .24),
        hue: Math.random() > .55 ? '103,217,255' : COLOR
      });
    }
  }

  function draw(now) {
    state.raf = 0;
    const dt = state.last ? Math.min(2, (now - state.last) / 1000) : 1 / 60;
    state.last = now;
    ctx.clearRect(0, 0, state.width, state.height);
    const direction = sign();
    for (const line of lines) {
      line.y += direction * line.speed * dt;
      const margin = line.length + 80;
      if (direction < 0 && line.y < -margin) line.y = state.height + margin;
      if (direction > 0 && line.y > state.height + margin) line.y = -margin;
      ctx.beginPath();
      const start = line.y - direction * line.length;
      for (let i = 0; i <= 22; i++) {
        const t = i / 22;
        const y = start + direction * line.length * t;
        const x = line.x + Math.sin(now * .00028 + line.phase + y * line.frequency) * line.amplitude;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(${line.hue},${line.alpha})`;
      ctx.lineWidth = line.width;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    if (!reduce) state.raf = requestAnimationFrame(draw);
  }

  window.NexoLineFlow = {
    setDirection(direction) {
      state.direction = direction === 'down' ? 'down' : 'up';
      canvas.dataset.direction = state.direction;
      if (!state.raf && !reduce) state.raf = requestAnimationFrame(draw);
    },
    getDirection() { return state.direction; }
  };

  addEventListener('resize', resize, { passive: true });
  resize();
  draw(performance.now());
})();
