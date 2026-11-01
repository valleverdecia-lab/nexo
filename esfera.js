(() => {
  const canvas = document.getElementById('esfera'), hero = document.getElementById('inicio');
  if (!canvas || !hero) return;
  const ctx = canvas.getContext('2d', {alpha:true});
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const top = document.querySelector('header'), kicker = document.querySelector('#inicio .kicker');
  const TAU = Math.PI * 2, mouse = {x:-9999,y:-9999,active:false};
  let W=0,H=0,cx=0,cy=0,R=0,dpr=1,particles=[],sphere=[],word=[];
  let mode='sphere', visible=true, running=false, transitionAt=0, nextCycle=0, rotation=0, tiltX=.32,tiltY=0,targetTiltX=.32,targetTiltY=0,lastTap=0;
  const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
  const ease=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
  const rand=(a,b)=>a+Math.random()*(b-a);
  function resize(){
    const hr=hero.getBoundingClientRect(), y0=(top?top.getBoundingClientRect().bottom:60)-hr.top, y1=(kicker?kicker.getBoundingClientRect().top:hr.height*.6)-hr.top;
    const gap=Math.max(160,y1-y0-16); dpr=Math.min(devicePixelRatio||1,1.7); W=hr.width;H=hr.height;
    canvas.style.top='0px';canvas.style.height=H+'px';canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
    cx=W/2;cy=y0+8+gap/2;R=Math.min(W*.36,gap*.4);
  }
  function makeSphere(){const a=[],n=W<700?400:640,g=Math.PI*(3-Math.sqrt(5));for(let i=0;i<n;i++){const y=1-(i/(n-1))*2,r=Math.sqrt(1-y*y),t=g*i;a.push({x:Math.cos(t)*r,y,z:Math.sin(t)*r});}return a;}
  function makeWord(){
    const c=document.createElement('canvas');c.width=900;c.height=220;const x=c.getContext('2d');x.fillStyle='#fff';x.font='900 154px Inter,Arial,sans-serif';x.textAlign='center';x.textBaseline='middle';x.fillText('NEXO',450,110);
    const d=x.getImageData(0,0,c.width,c.height).data,a=[],step=W<700?7:6;for(let y=0;y<c.height;y+=step)for(let xx=0;xx<c.width;xx+=step)if(d[(y*c.width+xx)*4+3]>70)a.push({x:xx/450-1,y:y/110-1,z:rand(-.08,.08)});return a;
  }
  function setup(){sphere=makeSphere().map(p=>({x:p.x*.95,y:p.y*.78,z:p.z}));word=makeWord().map(p=>({x:p.x*.95,y:p.y*.78,z:p.z}));const n=sphere.length;particles=Array.from({length:n},(_,i)=>{const p=sphere[i%sphere.length];return {x:p.x,y:p.y,z:p.z,tx:p.x,ty:p.y,tz:p.z,vx:0,vy:0,vz:0,size:rand(.75,1.9)};});transitionAt=performance.now();nextCycle=transitionAt+4300;}
  function project(x,y,z){const cyy=Math.cos(rotation+tiltY),sy=Math.sin(rotation+tiltY),cxx=Math.cos(tiltX),sx=Math.sin(tiltX),xx=x*cyy-z*sy,zz=x*sy+z*cyy,yy=y*cxx-zz*sx,depth=y*sx+zz*cxx,p=2.6/Math.max(1,2.6-depth);return{x:cx+xx*R*p,y:cy+yy*R*p,d:clamp((depth+1)/2),s:p};}
  function change(){
    const now=performance.now();if(now-lastTap<450)return;lastTap=now;mode=mode==='sphere'?'word':'sphere';const target=mode==='sphere'?sphere:word;particles.forEach((p,i)=>{const q=target[i%target.length];p.tx=q.x;p.ty=q.y;p.tz=q.z;p.vx=rand(-.55,.55);p.vy=rand(-.55,.55);p.vz=rand(-.4,.4);});transitionAt=now;nextCycle=now+4300;if(!running&&visible)requestAnimationFrame(frame);
  }
  function frame(now){
    if(!visible){running=false;return;}running=true;const elapsed=now-transitionAt,morph=ease(clamp(elapsed/760)),burst=1-clamp(elapsed/620);
    rotation+=.0048;targetTiltX+=(mouse.active?((mouse.y-cy)/(R*3))*.28:.32-targetTiltX)*.08;targetTiltY+=(mouse.active?((mouse.x-cx)/W)*.42:-targetTiltY)*.08;tiltX+=(targetTiltX-tiltX)*.1;tiltY+=(targetTiltY-tiltY)*.1;
    if(!reduced&&now>nextCycle)change();ctx.clearRect(0,0,W,H);ctx.globalCompositeOperation='lighter';
    particles.forEach(p=>{p.x+=(p.tx-p.x)*morph*.18+p.vx*burst*.025;p.y+=(p.ty-p.y)*morph*.18+p.vy*burst*.025;p.z+=(p.tz-p.z)*morph*.18+p.vz*burst*.025;const q=project(p.x,p.y,p.z),dx=q.x-mouse.x,dy=q.y-mouse.y,dist=Math.hypot(dx,dy),push=mouse.active&&dist<155?(1-dist/155)*14:0,x=q.x+(dx/(dist||1))*push,y=q.y+(dy/(dist||1))*push,size=Math.max(.35,Math.min(4.5,p.size*q.s*(1+push*.012))),k=q.d;const r=Math.round(72+k*70),g=Math.round(160+k*70),b=255,a=.45+k*.45;ctx.beginPath();ctx.arc(x,y,size,0,TAU);ctx.fillStyle=`rgba(${r},${g},${b},${a})`;ctx.fill();});
    ctx.globalCompositeOperation='source-over';if(!reduced)requestAnimationFrame(frame);else running=false;
  }
  function pointer(x,y){const r=canvas.getBoundingClientRect();mouse.x=x-r.left;mouse.y=y-r.top;mouse.active=true;}
  canvas.addEventListener('pointermove',e=>pointer(e.clientX,e.clientY),{passive:true});canvas.addEventListener('pointerleave',()=>{mouse.active=false},{passive:true});canvas.addEventListener('pointerdown',e=>{pointer(e.clientX,e.clientY);change()},{passive:true});
  addEventListener('resize',()=>{resize();setup();if(reduced)frame(performance.now())},{passive:true});new IntersectionObserver(es=>{visible=es[0].isIntersecting;if(visible&&!running)requestAnimationFrame(frame)}).observe(hero);
  resize();setup();requestAnimationFrame(frame);
})();
