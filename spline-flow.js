/* Nexo spline field: dense graphite + indigo strands, optimized for long scrolling catalogs. */
(() => {
  const canvas = document.getElementById('spline-flow');
  const section = document.getElementById('catalogo');
  if (!canvas || !section) return;
  const ctx = canvas.getContext('2d', { alpha: true });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TAU = Math.PI * 2;
  const streams = Array.from({ length: 34 }, (_, i) => ({
    side: i % 2 ? 1 : -1,
    lane: i,
    phase: Math.random() * TAU,
    speed: .00012 + Math.random() * .00013,
    offset: (Math.random() - .5) * .9,
    weight: .45 + Math.random() * .8,
    violet: i % 3 !== 0
  }));
  let width = 1, height = 1, dpr = 1, visible = false, raf = 0, last = 0;
  let scrollEnergy = 0, lastScroll = scrollY;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  function resize() {
    const box = section.getBoundingClientRect();
    width = Math.max(1, box.width); height = Math.max(1, box.height);
    /* A long canvas is expensive at 2x DPR. 1.25 keeps the lines crisp and scroll-friendly. */
    dpr = Math.min(1.25, devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function request() { if (!raf && visible) raf = requestAnimationFrame(frame); }
  function scrollTick() {
    const delta = Math.abs(scrollY - lastScroll);
    lastScroll = scrollY;
    scrollEnergy = clamp(scrollEnergy + delta * .022, 0, 1);
    if (!reduced) request();
  }
  function point(stream, time, centerX, centerY) {
    const side = stream.side;
    const startX = side < 0 ? -width * .1 : width * 1.1;
    const rise = ((time * stream.speed * side + stream.lane * .041 + stream.offset) % 1 + 1) % 1;
    const laneY = height * (1.02 - rise * 1.08);
    const center = centerY + Math.sin(stream.phase + time * .00018) * height * .045;
    const bend = width * (.15 + stream.weight * .055);
    return { startX, laneY, centerX, centerY:center, cp1x:side < 0?width*.23:width*.77, cp1y:laneY-height*.08, cp2x:centerX+(side<0?-bend:bend), cp2y:center+(laneY-center)*.25 };
  }
  function drawDot(x, y, r, color, alpha) {
    ctx.fillStyle = color.replace('ALPHA', alpha.toFixed(3));
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  function draw(time) {
    ctx.clearRect(0, 0, width, height);
    const scrollPhase = clamp((scrollY - section.offsetTop + innerHeight) / (section.offsetHeight + innerHeight), 0, 1);
    const energy = reduced ? 0 : scrollEnergy;
    const centerX = width * (.5 + Math.sin(time * .00012) * .018);
    const centerY = height * (.45 + Math.sin(time * .00016) * .06 + (scrollPhase - .5) * .1);
    ctx.lineCap = 'round';
    streams.forEach((stream, index) => {
      const p = point(stream, time + scrollPhase * 1600, centerX, centerY);
      const alpha = (.07 + stream.weight * .028 + energy * .055) * (stream.violet ? 1 : .82);
      ctx.strokeStyle = stream.violet ? `rgba(98,91,255,${alpha})` : `rgba(26,28,42,${Math.max(.16,alpha*2.2)})`;
      ctx.lineWidth = stream.violet ? .65 + stream.weight*.35 : .8 + stream.weight*.45;
      ctx.beginPath(); ctx.moveTo(p.startX,p.laneY); ctx.bezierCurveTo(p.cp1x,p.cp1y,p.cp2x,p.cp2y,p.centerX,p.centerY); ctx.stroke();
      /* Only a subset gets a travelling glow: many strands, low paint cost. */
      if (index % 2 === 0) {
        const t = (time * stream.speed * .75 + index * .061 + scrollPhase * .8) % 1;
        const inv = 1-t;
        const x=inv*inv*inv*p.startX+3*inv*inv*t*p.cp1x+3*inv*t*t*p.cp2x+t*t*t*p.centerX;
        const y=inv*inv*inv*p.laneY+3*inv*inv*t*p.cp1y+3*inv*t*t*p.cp2y+t*t*t*p.centerY;
        drawDot(x,y,1.05,stream.violet?'rgba(141,132,255,ALPHA)':'rgba(74,78,102,ALPHA)',.18+energy*.18);
      }
    });
    const glow = ctx.createRadialGradient(centerX,centerY,0,centerX,centerY,52);
    glow.addColorStop(0,`rgba(103,217,255,${.22+energy*.12})`); glow.addColorStop(1,'rgba(98,91,255,0)');
    ctx.fillStyle=glow; ctx.beginPath(); ctx.arc(centerX,centerY,52,0,TAU); ctx.fill();
    drawDot(centerX,centerY,3.1+Math.sin(time*.003)*1.1,'rgba(178,240,255,ALPHA)',.62+energy*.18);
    scrollEnergy *= .94;
  }
  function frame(time) { raf=0; if(!visible)return; const elapsed=time-last; if(elapsed>28 || scrollEnergy>.03){draw(time);last=time;} if(!reduced)request(); }
  new ResizeObserver(resize).observe(section);
  new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible){resize();request()}}).observe(section);
  addEventListener('scroll',scrollTick,{passive:true});
  addEventListener('resize',()=>{resize();request()},{passive:true});
  resize(); visible=true; request();
})();
