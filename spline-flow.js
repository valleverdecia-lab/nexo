/* Nexo spline data field: strands enter from both sides and converge at a living node. */
(() => {
  const canvas = document.getElementById('spline-flow');
  const section = document.getElementById('catalogo');
  if (!canvas || !section) return;
  const ctx = canvas.getContext('2d', { alpha: true });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TAU = Math.PI * 2;
  const streams = Array.from({ length: 18 }, (_, i) => ({
    side: i % 2 ? 1 : -1,
    lane: i,
    phase: Math.random() * TAU,
    speed: 0.00018 + Math.random() * 0.00016,
    offset: (Math.random() - .5) * .84,
    weight: .55 + Math.random() * .9
  }));
  let width = 1, height = 1, dpr = 1, visible = false, raf = 0, scrollEnergy = 0, lastScroll = 0;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const ease = n => n * n * (3 - 2 * n);
  function resize() {
    const box = section.getBoundingClientRect();
    width = Math.max(1, box.width); height = Math.max(1, box.height);
    dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function scrollTick() {
    const now = performance.now();
    scrollEnergy = clamp(scrollEnergy + Math.abs(scrollY - lastScroll) * .018, 0, 1);
    lastScroll = scrollY;
    if (!reduced) request();
    window.setTimeout(() => { scrollEnergy *= .72; }, 90);
    void now;
  }
  function strand(stream, time, side) {
    const centerX = width * (.5 + Math.sin(stream.phase + time * stream.speed) * .018);
    const startX = side < 0 ? -width * .08 : width * 1.08;
    const laneY = height * (.23 + ((stream.lane * 0.073 + stream.offset + time * stream.speed * side) % .62));
    const centerY = height * (.44 + Math.sin(stream.phase + time * .00023) * .18);
    const bend = width * (.18 + stream.weight * .045);
    const cp1x = side < 0 ? width * .22 : width * .78;
    const cp2x = centerX + (side < 0 ? -bend : bend);
    const cp1y = laneY + Math.sin(stream.phase + time * .0004) * height * .06;
    const cp2y = centerY + (laneY - centerY) * .28;
    return { startX, laneY, centerX, centerY, cp1x, cp1y, cp2x, cp2y };
  }
  function drawNode(x, y, radius, alpha, pulse) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 7);
    glow.addColorStop(0, `rgba(103,217,255,${alpha * .9})`);
    glow.addColorStop(.35, `rgba(98,91,255,${alpha * .34})`);
    glow.addColorStop(1, 'rgba(98,91,255,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, radius * 7, 0, TAU); ctx.fill();
    ctx.fillStyle = `rgba(170,239,255,${alpha})`; ctx.beginPath(); ctx.arc(x, y, radius + pulse, 0, TAU); ctx.fill();
  }
  function draw(time) {
    ctx.clearRect(0, 0, width, height);
    const progress = clamp((scrollY - section.offsetTop + innerHeight * .55) / (section.offsetHeight + innerHeight), 0, 1);
    const energy = reduced ? 0 : scrollEnergy;
    const centerX = width * (.5 + Math.sin(time * .00012) * .012);
    const centerY = height * (.45 + Math.sin(time * .0002) * .07 + (progress - .5) * .12);
    ctx.lineCap = 'round';
    streams.forEach(stream => {
      const p = strand(stream, time + progress * 900, stream.side);
      const alpha = .09 + stream.weight * .035 + energy * .08;
      const gradient = ctx.createLinearGradient(p.startX, p.laneY, p.centerX, p.centerY);
      gradient.addColorStop(0, `rgba(98,91,255,0)`);
      gradient.addColorStop(.45, `rgba(98,91,255,${alpha})`);
      gradient.addColorStop(1, `rgba(103,217,255,${alpha * 1.8})`);
      ctx.strokeStyle = gradient; ctx.lineWidth = .7 + stream.weight * .45;
      ctx.beginPath(); ctx.moveTo(p.startX, p.laneY);
      ctx.bezierCurveTo(p.cp1x, p.cp1y, p.cp2x, p.cp2y, centerX, centerY); ctx.stroke();
      const t = (time * stream.speed * .9 + stream.lane * .063 + progress * .6) % 1;
      const inv = 1 - t;
      const x = inv*inv*inv*p.startX + 3*inv*inv*t*p.cp1x + 3*inv*t*t*p.cp2x + t*t*t*centerX;
      const y = inv*inv*inv*p.laneY + 3*inv*inv*t*p.cp1y + 3*inv*t*t*p.cp2y + t*t*t*centerY;
      drawNode(x, y, 1.1 + stream.weight * .35, .24 + energy * .22, Math.sin(time*.004 + stream.phase) * .35);
    });
    drawNode(centerX, centerY, 3.2, .75, Math.sin(time*.003) * 1.3);
  }
  function frame(time) { raf = 0; if (!visible) return; draw(time); if (!reduced) request(); }
  function request() { if (!raf && visible) raf = requestAnimationFrame(frame); }
  new ResizeObserver(resize).observe(section);
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (visible) { resize(); request(); } }).observe(section);
  addEventListener('scroll', scrollTick, { passive: true });
  addEventListener('resize', () => { resize(); request(); }, { passive: true });
  resize(); visible = true; request();
})();
