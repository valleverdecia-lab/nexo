(() => {
  const canvas = document.getElementById('esfera');
  const hero = document.getElementById('inicio');
  if (!canvas || !hero) return;
  const ctx = canvas.getContext('2d', { alpha: true });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const top = document.querySelector('header');
  const kicker = document.querySelector('#inicio .kicker');
  const TAU = Math.PI * 2;
  const mouse = { x: -9999, y: -9999, active: false };
  let W = 0, H = 0, cx = 0, cy = 0, R = 0, dpr = 1;
  let particles = [], shapes = [], shapeIndex = 0, transitionAt = 0, nextChange = 0;
  let visible = true, running = false, rotation = 0, tiltX = .32, tiltY = 0, targetTiltX = .32, targetTiltY = 0;

  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const rand = (a, b) => a + Math.random() * (b - a);

  function resize() {
    const hr = hero.getBoundingClientRect();
    const y0 = (top ? top.getBoundingClientRect().bottom : 60) - hr.top;
    const y1 = (kicker ? kicker.getBoundingClientRect().top : hr.height * .6) - hr.top;
    const gap = Math.max(160, y1 - y0 - 16);
    dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    W = hr.width; H = hr.height;
    canvas.style.top = '0px'; canvas.style.height = `${H}px`;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = W / 2; cy = y0 + 8 + gap / 2; R = Math.min(W * .36, gap * .4);
  }

  function sampleText(text, fontSize = 150) {
    const c = document.createElement('canvas'); c.width = 900; c.height = 220;
    const x = c.getContext('2d'); x.fillStyle = '#fff';
    x.font = `900 ${fontSize}px Inter, Arial, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, c.width / 2, c.height / 2);
    const data = x.getImageData(0, 0, c.width, c.height).data, points = [];
    const step = W < 700 ? 7 : 6;
    for (let y = 0; y < c.height; y += step) for (let xx = 0; xx < c.width; xx += step) {
      if (data[(y * c.width + xx) * 4 + 3] > 70) points.push({ x: (xx / 450) - 1, y: (y / 110) - 1, z: rand(-.08, .08) });
    }
    return points;
  }

  function sphere() {
    const points = [], n = 760, golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) { const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), a = golden * i; points.push({ x: Math.cos(a) * r, y, z: Math.sin(a) * r }); }
    return points;
  }
  function tree() {
    const points = [], add = (x, y, z = 0) => points.push({x, y, z});
    for (let i = 0; i < 170; i++) add(rand(-.07, .07), .8 - i / 170 * 1.4, rand(-.06, .06));
    const branches = [[-.02,-.15,-.72,-.55],[.02,-.05,.72,-.55],[-.03,-.35,-.55,-.2],[.03,-.28,.55,-.2],[0,.05,0,-.85]];
    branches.forEach(([x1,y1,x2,y2]) => { for(let i=0;i<110;i++){const t=i/109; add(x1+(x2-x1)*t+rand(-.025,.025),y1+(y2-y1)*t+rand(-.025,.025),rand(-.05,.05));} });
    for (let i=0;i<360;i++){const a=rand(0,TAU), r=Math.sqrt(Math.random())*.36, y=rand(-.98,.15)+(r*.25); add(Math.cos(a)*r,y,Math.sin(a)*r);}
    return points;
  }
  function house() {
    const points = [], line=(x1,y1,x2,y2,n=100)=>{for(let i=0;i<n;i++){const t=i/(n-1);points.push({x:x1+(x2-x1)*t+rand(-.015,.015),y:y1+(y2-y1)*t+rand(-.015,.015),z:rand(-.08,.08)});};};
    line(-.9,.7,.9,.7); line(-.72,.7,-.72,-.25); line(.72,.7,.72,-.25); line(-.72,-.25,.72,-.25); line(-.88,-.25,0,-.92); line(0,-.92,.88,-.25); line(-.2,.7,-.2,.05); line(.2,.7,.2,.05); line(-.2,.05,.2,.05); line(-.13,-.25,-.13,.35); line(.13,-.25,.13,.35); line(-.13,.35,.13,.35); return points;
  }

  function createShapes() {
    const fit = pts => pts.map(p => ({ x: p.x * .95, y: p.y * .78, z: p.z }));
    shapes = [fit(sphere()), fit(sampleText('NEXO', 154)), fit(sampleText('BIENVENIDOS', 104)), fit(tree()), fit(house())];
    const n = W < 700 ? 470 : 700;
    particles = Array.from({length:n}, (_, i) => { const p = shapes[0][i % shapes[0].length]; return { x:p.x, y:p.y, z:p.z, tx:p.x, ty:p.y, tz:p.z, vx:0, vy:0, vz:0, size:rand(.75,1.9) }; });
    transitionAt = performance.now(); nextChange = transitionAt + 5200;
  }
  function project(x, y, z) {
    const cyy=Math.cos(rotation+tiltY), sy=Math.sin(rotation+tiltY), cxx=Math.cos(tiltX), sx=Math.sin(tiltX);
    const xx=x*cyy-z*sy, zz=x*sy+z*cyy, yy=y*cxx-zz*sx, depth=y*sx+zz*cxx;
    const persp=2.6/Math.max(1,2.6-depth); return {x:cx+xx*R*persp,y:cy+yy*R*persp,d:clamp((depth+1)/2),s:persp};
  }
  function changeShape(index) {
    if (!particles.length) return;
    shapeIndex = (index + shapes.length) % shapes.length; const target = shapes[shapeIndex];
    particles.forEach((p,i) => { const q=target[i % target.length]; p.tx=q.x; p.ty=q.y; p.tz=q.z; p.vx=rand(-.45,.45); p.vy=rand(-.45,.45); p.vz=rand(-.35,.35); });
    transitionAt=performance.now(); nextChange=transitionAt+5200;
    if (!running && visible) requestAnimationFrame(frame);
  }
  function frame(now) {
    if (!visible) { running=false; return; }
    running=true; const elapsed=now-transitionAt, morph=ease(clamp(elapsed/1050)), burst=1-clamp(elapsed/900);
    rotation += .0028; targetTiltX += (mouse.active ? ((mouse.y-cy)/(R*3))*.28 : .32-targetTiltX)*.035; targetTiltY += (mouse.active ? ((mouse.x-cx)/W)*.42 : -targetTiltY)*.035; tiltX += (targetTiltX-tiltX)*.08; tiltY += (targetTiltY-tiltY)*.08;
    if (!reduced && now>nextChange) changeShape(shapeIndex+1);
    ctx.clearRect(0,0,W,H); ctx.globalCompositeOperation='lighter';
    particles.forEach(p=>{
      p.x += (p.tx-p.x)*morph*.12 + p.vx*burst*.018; p.y += (p.ty-p.y)*morph*.12 + p.vy*burst*.018; p.z += (p.tz-p.z)*morph*.12 + p.vz*burst*.018;
      const q=project(p.x,p.y,p.z), dx=q.x-mouse.x, dy=q.y-mouse.y, dist=Math.hypot(dx,dy), push=mouse.active&&dist<150?(1-dist/150)*12:0;
      const x=q.x+(dx/(dist||1))*push, y=q.y+(dy/(dist||1))*push, k=q.d, size=Math.max(.35,Math.min(4.5,p.size*q.s*(1+push*.01)));
      const r=Math.round(110+k*145), g=Math.round(220+k*35), b=Math.round(218-k*20), a=.42+k*.5;
      ctx.beginPath(); ctx.arc(x,y,size,0,TAU); ctx.fillStyle=`rgba(${r},${g},${b},${a})`; ctx.fill();
    });
    ctx.globalCompositeOperation='source-over'; if (!reduced) requestAnimationFrame(frame); else running=false;
  }
  function pointer(x,y) { const r=canvas.getBoundingClientRect(); mouse.x=x-r.left; mouse.y=y-r.top; mouse.active=true; }
  canvas.addEventListener('pointermove', e=>pointer(e.clientX,e.clientY), {passive:true});
  canvas.addEventListener('pointerleave', ()=>{mouse.active=false}, {passive:true});
  canvas.addEventListener('pointerdown', e=>{ pointer(e.clientX,e.clientY); changeShape(shapeIndex+1); }, {passive:true});
  window.addEventListener('resize', ()=>{resize();createShapes();if(reduced)frame(performance.now())},{passive:true});
  new IntersectionObserver(es=>{visible=es[0].isIntersecting;if(visible&&!running)requestAnimationFrame(frame)}).observe(hero);
  resize(); createShapes(); requestAnimationFrame(frame);
})();
