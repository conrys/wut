/* G3 — tiny 3D kit for ad-style mobile games on top of three.js r128.
   Pieces: world setup (renderer, lights, shadows that follow the action), instanced "parts" kit
   with animated pivots (cheap crowds), cube particles, drag input, 2D overlay for labels. */
(function(){
const G={};
const THREE=window.THREE;

G.rng=s=>()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
G.reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
G.mobile=Math.min(innerWidth,innerHeight)<700;

/* ---------- world ---------- */
G.world=function(opt){
  const w={};
  w.renderer=new THREE.WebGLRenderer({canvas:opt.canvas,antialias:true,stencil:!!opt.stencil});
  w.renderer.setPixelRatio(Math.min(G.mobile?1.5:2,devicePixelRatio||1));
  w.renderer.shadowMap.enabled=opt.shadows!==false;w.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  w.scene=new THREE.Scene();
  if(opt.skyGradient){
    const c=document.createElement('canvas');c.width=2;c.height=256;const g=c.getContext('2d'),gr=g.createLinearGradient(0,0,0,256);
    opt.skyGradient.forEach((col,i,a)=>gr.addColorStop(i/(a.length-1),col));g.fillStyle=gr;g.fillRect(0,0,2,256);
    w.scene.background=new THREE.CanvasTexture(c);
  }else w.scene.background=new THREE.Color(opt.sky||'#BFE3F7');
  if(opt.fog)w.scene.fog=new THREE.Fog(opt.fog,opt.fogNear||100,opt.fogFar||400);
  w.camera=new THREE.PerspectiveCamera(opt.fov||50,1,opt.near||0.5,opt.far||2000);
  w.hemi=new THREE.HemisphereLight(opt.hemiSky||0xffffff,opt.hemiGround||0x9ccf7e,opt.hemiI??0.62);w.scene.add(w.hemi);
  w.sun=new THREE.DirectionalLight(opt.sunColor||0xfff1dc,opt.sunI??0.8);
  w.sun.castShadow=opt.shadows!==false;const ms=G.mobile?1024:2048;w.sun.shadow.mapSize.set(ms,ms);
  w.sun.shadow.bias=-0.0004;w.scene.add(w.sun);w.scene.add(w.sun.target);
  w.sunDir=new THREE.Vector3(...(opt.sunDir||[-0.6,1.6,0.5]));
  w.fx=opt.fx;w.fctx=opt.fx?opt.fx.getContext('2d'):null;
  w.resize=()=>{w.W=innerWidth;w.H=innerHeight;w.renderer.setSize(w.W,w.H,false);w.camera.aspect=w.W/w.H;w.camera.updateProjectionMatrix();
    if(w.fx){const d=Math.min(2,devicePixelRatio||1);w.fx.width=w.W*d;w.fx.height=w.H*d;w.fctx.setTransform(d,0,0,d,0,0)}};
  addEventListener('resize',w.resize);w.resize();
  /* keep the shadow box centred on the action, sized to what is on screen */
  w.followSun=(x,z,ext)=>{
    w.sun.target.position.set(x,0,z);w.sun.position.set(x+w.sunDir.x*ext,w.sunDir.y*ext,z+w.sunDir.z*ext);
    const sc=w.sun.shadow.camera;
    if(Math.abs(sc.right-ext)>ext*0.1){sc.left=-ext;sc.right=ext;sc.top=ext;sc.bottom=-ext;sc.near=0.5;sc.far=ext*5;sc.updateProjectionMatrix();w.sun.shadow.normalBias=ext*0.003}
  };
  const _p=new THREE.Vector3();
  w.toScreen=(x,y,z)=>{_p.set(x,y,z).project(w.camera);return{x:(_p.x+1)/2*w.W,y:(1-_p.y)/2*w.H,vis:_p.z<1}};
  w.render=()=>w.renderer.render(w.scene,w.camera);
  return w;
};

/* ---------- loop ---------- */
G.loop=function(fn){let last=performance.now();const f=now=>{const dt=Math.min(0.1,(now-last)/1000);last=now;fn(dt);requestAnimationFrame(f)};requestAnimationFrame(f)};

/* ---------- instanced parts kit ----------
   An object is {x,y,z,yaw, sx,sy,sz (optional scale), tilt+tx/tz (lean axis), parts:[...] }.
   A part: G.part(kind,x,y,z,sx,sy,sz,color,{rx,ry,rz, pivot:[x,y,z], axis:'x'|'y'|'z', anim:(o,T)=>angle}).
   Kinds share one InstancedMesh each, so a crowd of hundreds is a handful of draw calls. */
G.part=(k,x,y,z,sx,sy,sz,c,o={})=>Object.assign({k,x,y,z,sx,sy,sz,c},o);
G.KINDS={
  box:{geo:()=>new THREE.BoxGeometry(1,1,1),mat:()=>new THREE.MeshLambertMaterial()},
  cyl:{geo:()=>new THREE.CylinderGeometry(1,1,1,12),mat:()=>new THREE.MeshLambertMaterial()},
  cyl6:{geo:()=>new THREE.CylinderGeometry(1,1,1,7),mat:()=>new THREE.MeshPhongMaterial({flatShading:true,shininess:4})},
  sph:{geo:()=>new THREE.IcosahedronGeometry(1,1),mat:()=>new THREE.MeshPhongMaterial({flatShading:true,shininess:6})},
  ball:{geo:()=>new THREE.SphereGeometry(1,14,10),mat:()=>new THREE.MeshPhongMaterial({shininess:30})},
  cone:{geo:()=>new THREE.ConeGeometry(1,1,12),mat:()=>new THREE.MeshPhongMaterial({flatShading:true,shininess:10})},
  metal:{geo:()=>new THREE.BoxGeometry(1,1,1),mat:()=>new THREE.MeshPhongMaterial({shininess:90,specular:0x888888})},
};
const _m=new THREE.Matrix4(),_mm=new THREE.Matrix4(),_pa=new THREE.Matrix4(),_q=new THREE.Quaternion(),_q2=new THREE.Quaternion(),
  _v=new THREE.Vector3(),_s=new THREE.Vector3(),_ax=new THREE.Vector3(),_e=new THREE.Euler(),_c=new THREE.Color(),
  UP=new THREE.Vector3(0,1,0),AX={x:new THREE.Vector3(1,0,0),y:new THREE.Vector3(0,1,0),z:new THREE.Vector3(0,0,1)};
const ZERO=new THREE.Matrix4().makeScale(0,0,0);
G.Kit=class{
  constructor(scene,opt={}){this.scene=scene;this.objs=[];this.ims={};this.T=0;this.shadow=opt.shadow!==false;this.geos={};this.mats={}}
  add(o){this.objs.push(o);return o}
  build(){
    for(const k in this.ims){this.scene.remove(this.ims[k]);this.ims[k].dispose()}
    this.ims={};const cnt={};
    for(const o of this.objs)for(const p of o.parts)cnt[p.k]=(cnt[p.k]||0)+1;
    for(const k in cnt){
      const K=G.KINDS[k];this.geos[k]=this.geos[k]||K.geo();this.mats[k]=this.mats[k]||K.mat();
      const im=new THREE.InstancedMesh(this.geos[k],this.mats[k],cnt[k]);
      im.castShadow=this.shadow;im.receiveShadow=true;im.frustumCulled=false;im.n=0;this.ims[k]=im;this.scene.add(im);
    }
    for(const o of this.objs)for(const p of o.parts){
      const im=this.ims[p.k];p.im=im;p.i=im.n++;
      _e.set(p.rx||0,p.ry||0,p.rz||0);_q.setFromEuler(_e);
      p.m=new THREE.Matrix4().compose(_v.set(p.x,p.y,p.z),_q,_s.set(p.sx,p.sy,p.sz));
      if(p.anim){p.pv=new THREE.Vector3(...(p.pivot||[p.x,p.y,p.z]));p.ax=AX[p.axis||'x']}
      im.setColorAt(p.i,_c.set(p.c));
    }
    for(const o of this.objs)this.place(o);
    this.flush(true);
  }
  place(o){
    if(o.hidden){if(!o._hid){for(const p of o.parts){p.im.setMatrixAt(p.i,ZERO);p.im.dirty=true}o._hid=true}return}
    o._hid=false;
    _q.setFromAxisAngle(UP,o.yaw||0);
    if(o.tilt){_q2.setFromAxisAngle(_ax.set(o.tz||0,0,-(o.tx||0.0001)).normalize(),o.tilt);_q.premultiply(_q2)}
    _m.compose(_v.set(o.x,o.y||0,o.z),_q,_s.set(o.sx||o.s||1,o.sy||o.s||1,o.sz||o.s||1));
    for(const p of o.parts){
      if(p.anim){
        const a=p.anim(o,this.T)||0;
        _pa.makeTranslation(p.pv.x,p.pv.y,p.pv.z);_mm.makeRotationAxis(p.ax,a);_pa.multiply(_mm);
        _mm.makeTranslation(-p.pv.x,-p.pv.y,-p.pv.z);_pa.multiply(_mm);_pa.multiply(p.m);
        _mm.multiplyMatrices(_m,_pa);
      }else _mm.multiplyMatrices(_m,p.m);
      p.im.setMatrixAt(p.i,_mm);p.im.dirty=true;
    }
  }
  recolor(o,fn){for(const p of o.parts){const c=fn(p);if(c){p.im.setColorAt(p.i,_c.set(c));p.im.instanceColor.needsUpdate=true}}}
  /* upload only the meshes something moved in, so static scenery costs nothing per frame */
  flush(colors){for(const k in this.ims){const im=this.ims[k];if(im.dirty||colors){im.instanceMatrix.needsUpdate=true;im.dirty=false}if(colors&&im.instanceColor)im.instanceColor.needsUpdate=true}}
  clear(){this.objs=[]}
};

/* ---------- cube particles ---------- */
G.Particles=class{
  constructor(scene,cap=300,size=0.18){
    this.cap=cap;this.list=[];this.free=[];
    this.im=new THREE.InstancedMesh(new THREE.BoxGeometry(size,size,size),new THREE.MeshLambertMaterial(),cap);
    this.im.frustumCulled=false;scene.add(this.im);
    for(let i=0;i<cap;i++){this.im.setMatrixAt(i,ZERO);this.im.setColorAt(i,_c.set('#fff'));this.free.push(i)}
  }
  burst(x,y,z,color,n,power=6,up=4){
    for(let k=0;k<n;k++){
      const i=this.free.length?this.free.pop():(this.list.length?this.list.shift().i:-1);if(i<0)return;
      const a=Math.random()*6.283,v=power*(0.4+Math.random()*0.8);
      this.list.push({i,x,y,z,vx:Math.cos(a)*v,vy:up*(0.5+Math.random()),vz:Math.sin(a)*v,l:0.6+Math.random()*0.5,r:Math.random()*6});
      this.im.setColorAt(i,_c.set(Array.isArray(color)?color[k%color.length]:color));
    }
    this.im.instanceColor.needsUpdate=true;
  }
  update(dt){
    const keep=[];
    for(const p of this.list){
      p.l-=dt;if(p.l<=0||p.y<-1){this.im.setMatrixAt(p.i,ZERO);this.free.push(p.i);continue}
      p.vy-=22*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;if(p.y<0.1){p.y=0.1;p.vy*=-0.35;p.vx*=0.7;p.vz*=0.7}
      p.r+=dt*8;const s=Math.min(1,p.l*2);
      _q.setFromEuler(_e.set(p.r,p.r*0.7,0));_m.compose(_v.set(p.x,p.y,p.z),_q,_s.set(s,s,s));this.im.setMatrixAt(p.i,_m);keep.push(p);
    }
    this.list=keep;this.im.instanceMatrix.needsUpdate=true;
  }
};

/* ---------- input ---------- */
G.drag=function(el){
  const d={active:false,sx:0,sy:0,x:0,y:0,get dx(){return this.x-this.sx},get dy(){return this.y-this.sy},onDown:null};
  el.addEventListener('pointerdown',e=>{d.active=true;d.sx=d.x=e.clientX;d.sy=d.y=e.clientY;try{el.setPointerCapture(e.pointerId)}catch(_){};d.onDown&&d.onDown(d)});
  el.addEventListener('pointermove',e=>{if(d.active){d.x=e.clientX;d.y=e.clientY}});
  const up=()=>{d.active=false};el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);
  d.keys={};addEventListener('keydown',e=>d.keys[e.key]=true);addEventListener('keyup',e=>d.keys[e.key]=false);
  return d;
};

/* ---------- overlay labels ---------- */
G.pill=function(ctx,text,x,y,size,bg,fg,font,scale=1){
  size*=scale;ctx.font=size+'px '+font;
  const w=ctx.measureText(text).width+size,h=size*1.5;
  ctx.fillStyle='rgba(30,20,10,.28)';ctx.beginPath();ctx.roundRect(x-w/2,y-h/2+size*0.18,w,h,h/2);ctx.fill();
  ctx.fillStyle=bg;ctx.beginPath();ctx.roundRect(x-w/2,y-h/2,w,h,h/2);ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,.55)';ctx.lineWidth=Math.max(1.5,size*0.1);ctx.stroke();
  ctx.fillStyle=fg;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,x,y+size*0.06);
};
G.Floats=class{
  constructor(){this.list=[]}
  add(text,x,y,z,color,big){this.list.push({text,x,y,z,color,big,l:1})}
  update(dt){for(const f of this.list)f.l-=dt*0.9;this.list=this.list.filter(f=>f.l>0)}
  draw(w,font){
    const ctx=w.fctx;
    for(const f of this.list){const p=w.toScreen(f.x,f.y,f.z);if(!p.vis)continue;
      ctx.globalAlpha=Math.min(1,f.l*1.6);G.pill(ctx,f.text,p.x,p.y-(1-f.l)*60,f.big?30:24,f.color,'#fff',font,1+Math.max(0,f.l-0.8)*1.5)}
    ctx.globalAlpha=1;
  }
};

/* ---------- canvas textures ---------- */
G.canvasTex=function(w,h,draw,repeat){
  const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);
  const t=new THREE.CanvasTexture(c);if(repeat){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(repeat[0],repeat[1])}
  return t;
};

window.G3=G;
})();
