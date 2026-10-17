/* Хованки — characters, navigation, vision, AI, game flow. */
(function(){
const T3=THREE,HW=HNSWorld,$=id=>document.getElementById(id);
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile=Math.min(innerWidth,innerHeight)<700;

/* ---------- renderer ---------- */
const renderer=new T3.WebGLRenderer({canvas:$('gl'),antialias:true});
renderer.setPixelRatio(Math.min(mobile?1.6:2,devicePixelRatio||1));
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T3.PCFSoftShadowMap;
const scene=new T3.Scene();scene.background=new T3.Color('#9ED38A');
const camera=new T3.PerspectiveCamera(46,1,0.5,120);
const fx=$('fx'),fctx=fx.getContext('2d');let W,H;
function resize(){W=innerWidth;H=innerHeight;renderer.setSize(W,H,false);camera.aspect=W/H;camera.updateProjectionMatrix();const d=Math.min(2,devicePixelRatio||1);fx.width=W*d;fx.height=H*d;fctx.setTransform(d,0,0,d,0,0)}
addEventListener('resize',resize);resize();

const hemi=new T3.HemisphereLight(0xEAF2FF,0xB59C82,0.52);scene.add(hemi);
const sun=new T3.DirectionalLight(0xFFF0DC,0.62);sun.castShadow=true;
sun.shadow.mapSize.set(mobile?1024:2048,mobile?1024:2048);sun.shadow.bias=-0.0006;sun.shadow.normalBias=0.03;
sun.position.set(HW.MW/2-7,18,HW.MH/2+9);sun.target.position.set(HW.MW/2,0,HW.MH/2);
const sc=sun.shadow.camera;sc.left=-17;sc.right=17;sc.top=14;sc.bottom=-14;sc.near=1;sc.far=50;sc.updateProjectionMatrix();
scene.add(sun);scene.add(sun.target);
const glow=new T3.PointLight(0xA9C8FF,0,3.4,1.6);scene.add(glow);
const flash=new T3.SpotLight(0xFFF1C8,0,9,0.75,0.55,1.1);flash.castShadow=true;flash.shadow.mapSize.set(512,512);flash.shadow.bias=-0.002;flash.shadow.camera.near=0.3;scene.add(flash);scene.add(flash.target);

const gm=new T3.DataTexture(new Uint8Array([120,190,255]),3,1,T3.LuminanceFormat);gm.minFilter=gm.magFilter=T3.NearestFilter;gm.needsUpdate=true;
const toon=(c,o={})=>new T3.MeshToonMaterial(Object.assign({color:c,gradientMap:gm},o));
const grass=new T3.Mesh(new T3.PlaneGeometry(160,160).rotateX(-Math.PI/2),toon('#8FCB72'));grass.position.set(HW.MW/2,-0.11,HW.MH/2);grass.receiveShadow=true;scene.add(grass);

/* ---------- world (rebuilt per level for mirrored layouts) ---------- */
let world=null,staticMesh=null,segs=[],lowSegs=[],nav=null,spots=[],waypoints=[],flipX=false,flipZ=false;
let curW=22,curH=17,mapIdx=0;
const TX=x=>flipX?curW-x:x,TZ=z=>flipZ?curH-z:z;
function buildWorld(mi,fxp,fzp,seed){
  flipX=fxp;flipZ=fzp;mapIdx=mi;
  if(staticMesh){scene.remove(staticMesh);staticMesh.geometry.dispose()}
  world=HW.build(scene,{map:mi,flipX,flipZ,clutter:seed||1});curW=world.W;curH=world.H;
  grass.position.set(curW/2,-0.11,curH/2);grass.material.color.set(world.def.grass);
  sun.position.set(curW/2-7,18,curH/2+9);sun.target.position.set(curW/2,0,curH/2);
  staticMesh=world.mesh.mesh(new T3.MeshToonMaterial({vertexColors:true,gradientMap:gm}));staticMesh.castShadow=staticMesh.receiveShadow=true;scene.add(staticMesh);
  const wallBoxes=world.boxes.filter(b=>!world.blockers.some(f=>f.b===b));
  segs=HW.segmentsOf(wallBoxes.concat(world.tallBoxes));lowSegs=HW.segmentsOf(world.lowBoxes);
  nav=HW.walkGrid(world.boxes,0.3);
  // hiding spots: free cells hugging furniture/walls, outside the hall
  spots=[];
  for(let j=0;j<nav.nz;j++)for(let i=0;i<nav.nx;i++){if(!nav.free[j*nav.nx+i])continue;
    const x=(i+0.5)*HW.CS,z=(j+0.5)*HW.CS,room=world.grid[Math.floor(z)][Math.floor(x)];if(room==='#'||(world.def.noHide&&room===world.def.noHide)||Math.hypot(x-TX(world.def.spawn[0]),z-TZ(world.def.spawn[1]))<3.2)continue;
    let blocked=0;for(let dj=-2;dj<=2;dj++)for(let di=-2;di<=2;di++){const ii=i+di,jj=j+dj;if(ii<0||jj<0||ii>=nav.nx||jj>=nav.nz||!nav.free[jj*nav.nx+ii])blocked++}
    let tall=0;for(const b of world.tallBoxes){const cx=Math.max(b[0],Math.min(x,b[2])),cz=Math.max(b[1],Math.min(z,b[3]));if(Math.hypot(x-cx,z-cz)<0.75)tall++}
    if(blocked>=7)spots.push({x,z,room,score:blocked+tall*5})}
  waypoints=world.def.waypoints.map(([x,z])=>snap(TX(x),TZ(z)));
}

/* ---------- navigation ---------- */
const ci=(x,z)=>Math.max(0,Math.min(nav.nz-1,Math.floor(z/HW.CS)))*nav.nx+Math.max(0,Math.min(nav.nx-1,Math.floor(x/HW.CS)));
const cx_=i=>(i%nav.nx+0.5)*HW.CS,cz_=i=>(Math.floor(i/nav.nx)+0.5)*HW.CS;
function nearestFree(i){if(nav.free[i])return i;const seen=new Uint8Array(nav.free.length),q=[i];seen[i]=1;
  while(q.length){const c=q.shift();if(nav.free[c])return c;const x=c%nav.nx,z=Math.floor(c/nav.nx);for(const [dx,dz] of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,nz=z+dz;if(nx<0||nz<0||nx>=nav.nx||nz>=nav.nz)continue;const n=nz*nav.nx+nx;if(!seen[n]){seen[n]=1;q.push(n)}}}return i}
function snap(x,z){const i=nearestFree(ci(x,z));return[cx_(i),cz_(i)]}
function lineFree(x0,z0,x1,z1){const d=Math.hypot(x1-x0,z1-z0),n=Math.ceil(d/0.18);for(let k=1;k<n;k++){const t=k/n;if(!nav.free[ci(x0+(x1-x0)*t,z0+(z1-z0)*t)])return false}return true}
function astar(x0,z0,x1,z1){
  const s=nearestFree(ci(x0,z0)),t=nearestFree(ci(x1,z1)),N=nav.free.length;
  const g=new Float32Array(N).fill(1e9),came=new Int32Array(N).fill(-1),closed=new Uint8Array(N);
  const heap=[];const push=(i,f)=>{heap.push([f,i]);let k=heap.length-1;while(k){const p=(k-1)>>1;if(heap[p][0]<=heap[k][0])break;[heap[p],heap[k]]=[heap[k],heap[p]];k=p}};
  const pop=()=>{const top=heap[0],last=heap.pop();if(heap.length){heap[0]=last;let k=0;for(;;){const l=2*k+1,r=l+1;let m=k;if(l<heap.length&&heap[l][0]<heap[m][0])m=l;if(r<heap.length&&heap[r][0]<heap[m][0])m=r;if(m===k)break;[heap[m],heap[k]]=[heap[k],heap[m]];k=m}}return top};
  const tx=t%nav.nx,tz=Math.floor(t/nav.nx),hh=i=>{const dx=Math.abs(i%nav.nx-tx),dz=Math.abs(Math.floor(i/nav.nx)-tz);return Math.max(dx,dz)+0.414*Math.min(dx,dz)};
  g[s]=0;push(s,hh(s));
  while(heap.length){const [,c]=pop();if(c===t)break;if(closed[c])continue;closed[c]=1;const x=c%nav.nx,z=Math.floor(c/nav.nx);
    for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dz)continue;const nx=x+dx,nz=z+dz;if(nx<0||nz<0||nx>=nav.nx||nz>=nav.nz)continue;const n=nz*nav.nx+nx;if(!nav.free[n])continue;
      if(dx&&dz&&(!nav.free[z*nav.nx+nx]||!nav.free[nz*nav.nx+x]))continue;const ng=g[c]+(dx&&dz?1.414:1);if(ng<g[n]){g[n]=ng;came[n]=c;push(n,ng+hh(n))}}}
  if(came[t]<0&&t!==s)return null;
  const raw=[];for(let c=t;c>=0&&c!==s;c=came[c])raw.push([cx_(c),cz_(c)]);raw.reverse();
  // string-pull: keep only points we cannot see past
  const out=[];let ax=x0,az=z0;
  for(let k=0;k<raw.length;k++){const nxt=raw[k+1];if(nxt&&lineFree(ax,az,nxt[0],nxt[1]))continue;out.push(raw[k]);[ax,az]=raw[k]}
  return out;
}

/* ---------- vision ---------- */
function rayHit(ox,oz,ang,range){
  const dx=Math.sin(ang)*range,dz=Math.cos(ang)*range;let best=1;
  for(const s of segs){const sx=s[2]-s[0],sz=s[3]-s[1],den=dx*sz-dz*sx;if(Math.abs(den)<1e-9)continue;
    const qx=s[0]-ox,qz=s[1]-oz,t=(qx*sz-qz*sx)/den,u=(qx*dz-qz*dx)/den;if(t>0&&t<best&&u>=0&&u<=1)best=t}
  return best*range;
}
function los(ax,az,bx,bz,list=segs){const dx=bx-ax,dz=bz-az;for(const s of list){const sx=s[2]-s[0],sz=s[3]-s[1],den=dx*sz-dz*sx;if(Math.abs(den)<1e-9)continue;
  const qx=s[0]-ax,qz=s[1]-az,t=(qx*sz-qz*sx)/den,u=(qx*dz-qz*dx)/den;if(t>0.001&&t<0.999&&u>=0&&u<=1)return false}return true}
const angDiff=(a,b)=>{let d=(a-b)%(Math.PI*2);if(d>Math.PI)d-=Math.PI*2;if(d<-Math.PI)d+=Math.PI*2;return d};
function sees(s,h){
  const ex=s.x+Math.sin(s.look)*0.15,ez=s.z+Math.cos(s.look)*0.15,dx=h.x-ex,dz=h.z-ez,d=Math.hypot(dx,dz);
  if(d>s.range+0.2)return false;if(d<0.55)return true;
  if(Math.abs(angDiff(Math.atan2(dx,dz),s.look))>s.fov/2+0.05)return false;
  if(!los(ex,ez,h.x,h.z))return false;
  // crouching behind a sofa, bed or table hides you from the beam
  if(h.crouch>0.5&&!los(ex,ez,h.x,h.z,lowSegs))return false;
  return true;
}

/* cone mesh: fan of rays clipped by walls and tall furniture, alpha fading outward */
const NR=60;
const coneGeo=new T3.BufferGeometry();
coneGeo.setAttribute('position',new T3.BufferAttribute(new Float32Array((NR+2)*3),3));
coneGeo.setAttribute('alpha',new T3.BufferAttribute(new Float32Array(NR+2),1));
{const idx=[];for(let i=0;i<NR;i++)idx.push(0,i+2,i+1);coneGeo.setIndex(idx)}
const coneMat=new T3.ShaderMaterial({uniforms:{color:{value:new T3.Color('#FF4D5E')},opacity:{value:0.38}},transparent:true,depthWrite:false,side:T3.DoubleSide,
  vertexShader:'attribute float alpha;varying float vA;void main(){vA=alpha;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader:'uniform vec3 color;uniform float opacity;varying float vA;void main(){gl_FragColor=vec4(color,vA*opacity);}'});
const cone=new T3.Mesh(coneGeo,coneMat);cone.frustumCulled=false;cone.renderOrder=2;scene.add(cone);
function updateCone(s){
  const p=coneGeo.attributes.position.array,a=coneGeo.attributes.alpha.array,ex=s.x+Math.sin(s.look)*0.12,ez=s.z+Math.cos(s.look)*0.12;
  p[0]=ex;p[1]=0.035;p[2]=ez;a[0]=1;
  for(let i=0;i<=NR;i++){const ang=s.look-s.fov/2+s.fov*i/NR,r=rayHit(ex,ez,ang,s.range);
    p[(i+1)*3]=ex+Math.sin(ang)*r;p[(i+1)*3+1]=0.035;p[(i+1)*3+2]=ez+Math.cos(ang)*r;a[i+1]=0.12+0.5*(1-r/s.range)}
  coneGeo.attributes.position.needsUpdate=true;coneGeo.attributes.alpha.needsUpdate=true;coneGeo.computeBoundingSphere();
}

/* ---------- characters ---------- */
const BEAN=new T3.LatheGeometry([[0,0],[0.17,0.012],[0.25,0.06],[0.285,0.17],[0.29,0.36],[0.285,0.55],[0.26,0.7],[0.21,0.82],[0.13,0.9],[0,0.93]].map(([x,y])=>new T3.Vector2(x,y)),22);
const SPH=new T3.SphereGeometry(1,16,12),CYL=new T3.CylinderGeometry(1,1,1,10),HALF=new T3.SphereGeometry(1,16,8,0,Math.PI*2,0,Math.PI/2);
const COLORS=['#4CC97A','#FFC93C','#A779F2','#FF9A3D','#FF7BB0','#3CC8C8','#8BD14B'];
function makeBean(color,kind){
  const root=new T3.Group(),body=new T3.Group();root.add(body);const mats=[];
  const m=(c,o)=>{const mm=toon(c,o);mats.push(mm);return mm};
  const bodyMat=m(color),dark=new T3.Color(color).multiplyScalar(0.55),white=m('#FFFFFF'),black=m('#1D1A26'),cheek=m('#FF8FA3');
  const add=(geo,mat,x,y,z,sx,sy,sz,parent=body,shadow=true)=>{const me=new T3.Mesh(geo,mat);me.position.set(x,y,z);me.scale.set(sx,sy,sz);me.castShadow=shadow;parent.add(me);return me};
  add(BEAN,bodyMat,0,0,0,1,1,1);
  add(SPH,m(HW.shade(color,0.35)),0,0.36,0.17,0.17,0.2,0.12,body,false);
  const eyes=new T3.Group();eyes.position.set(0,0.64,0.215);body.add(eyes);
  const eL=add(SPH,white,-0.095,0,0,0.075,0.085,0.05,eyes,false),eR=add(SPH,white,0.095,0,0,0.075,0.085,0.05,eyes,false);
  const pL=add(SPH,black,-0.095,-0.005,0.04,0.04,0.048,0.025,eyes,false),pR=add(SPH,black,0.095,-0.005,0.04,0.04,0.048,0.025,eyes,false);
  add(SPH,white,-0.08,0.018,0.06,0.013,0.013,0.01,eyes,false);add(SPH,white,0.11,0.018,0.06,0.013,0.013,0.01,eyes,false);
  add(SPH,cheek,-0.17,0.53,0.205,0.045,0.03,0.02,body,false);add(SPH,cheek,0.17,0.53,0.205,0.045,0.03,0.02,body,false);
  const mouth=add(SPH,black,0,0.53,0.255,0.035,0.016,0.012,body,false);
  const footMat=m('#'+dark.getHexString());
  const fL=add(SPH,footMat,-0.11,0.045,0.02,0.085,0.055,0.12,root),fR=add(SPH,footMat,0.11,0.045,0.02,0.085,0.055,0.12,root);
  const hL=add(SPH,bodyMat,-0.31,0.36,0.02,0.065,0.065,0.065),hR=add(SPH,bodyMat,0.31,0.36,0.02,0.065,0.065,0.065);
  let extra={};
  if(kind==='seeker'){
    const cap=m('#2A2F45');add(HALF,cap,0,0.79,0,0.24,0.17,0.24);add(CYL,cap,0,0.8,0.2,0.17,0.02,0.14);
    add(CYL,m('#E8453C'),0,0.81,0,0.245,0.035,0.245);
    const torch=new T3.Group();hR.add(torch);torch.scale.setScalar(1/0.065);
    add(CYL,m('#2F80ED'),0,0,0.1,0.045,0.2,0.045,torch).rotation.x=Math.PI/2;add(CYL,m('#F2994A'),0,0.07,0.04,0.05,0.1,0.05,torch);
    add(CYL,m('#7CC3FF',{emissive:'#7CC3FF',emissiveIntensity:0.5}),0,0,0.21,0.02,0.04,0.02,torch,false).rotation.x=Math.PI/2;
    extra.torch=torch;
  }
  if(kind==='player'){
    add(CYL,m('#3A3F4B'),0,0.98,0,0.012,0.14,0.012);extra.star=add(SPH,m('#FFD23F',{emissive:'#FFB800',emissiveIntensity:0.35}),0,1.07,0,0.055,0.055,0.055);
  }
  return {root,body,eyes,eL,eR,pL,pR,fL,fR,hL,hR,mouth,mats,bodyMat,...extra};
}
const ringGeo=new T3.RingGeometry(0.34,0.44,32).rotateX(-Math.PI/2);
const cageGeo={bar:new T3.CylinderGeometry(0.022,0.022,1.05,6),ring:new T3.TorusGeometry(0.44,0.035,6,24).rotateX(Math.PI/2),knob:new T3.SphereGeometry(0.08,10,8),base:new T3.CylinderGeometry(0.47,0.5,0.06,24)};
const cageMat=toon('#F2C94C'),cageBase=toon('#C98A2E');
function makeCage(){const g=new T3.Group();for(let i=0;i<12;i++){const a=i/12*Math.PI*2,b=new T3.Mesh(cageGeo.bar,cageMat);b.position.set(Math.cos(a)*0.44,0.55,Math.sin(a)*0.44);b.castShadow=true;g.add(b)}
  for(const y of[0.04,1.06]){const r=new T3.Mesh(cageGeo.ring,cageMat);r.position.y=y;g.add(r)}const k=new T3.Mesh(cageGeo.knob,cageMat);k.position.y=1.12;g.add(k);
  const base=new T3.Mesh(cageGeo.base,cageBase);base.position.y=0.03;base.receiveShadow=true;g.add(base);scene.add(g);return g}

/* ---------- puffs ---------- */
const puffGeo=new T3.IcosahedronGeometry(1,0),puffs=[];
for(let i=0;i<40;i++){const p=new T3.Mesh(puffGeo,new T3.MeshBasicMaterial({color:'#FFFFFF',transparent:true,opacity:0,depthWrite:false}));p.visible=false;scene.add(p);puffs.push({m:p,l:0})}
let puffI=0;
function puff(x,z,s=0.12,vy=0.6,col='#FFFFFF'){const p=puffs[puffI++%puffs.length];p.m.visible=true;p.m.position.set(x+(Math.random()-.5)*0.15,0.08,z+(Math.random()-.5)*0.15);p.s=s;p.vy=vy;p.l=1;p.m.material.color.set(col);p.vx=(Math.random()-.5)*0.6;p.vz=(Math.random()-.5)*0.6}
function puffRing(x,z,n=14,col='#FFFFFF'){for(let i=0;i<n;i++){const a=i/n*6.283,p=puffs[puffI++%puffs.length];p.m.visible=true;p.m.position.set(x+Math.cos(a)*0.35,0.08,z+Math.sin(a)*0.35);p.s=0.14;p.vy=0.4;p.vx=Math.cos(a)*1.6;p.vz=Math.sin(a)*1.6;p.l=1;p.m.material.color.set(col)}}
function updPuffs(dt){for(const p of puffs){if(p.l<=0)continue;p.l-=dt*1.8;const k=Math.max(0,p.l);p.m.position.x+=p.vx*dt;p.m.position.z+=p.vz*dt;p.m.position.y+=p.vy*dt;p.m.scale.setScalar(p.s*(1.6-k*0.6));p.m.material.opacity=k*0.75;if(p.l<=0)p.m.visible=false}}

/* ---------- footstep ripples: in the dark, nearby movement shows on the floor ---------- */
const ripGeo=new T3.RingGeometry(0.7,1,32).rotateX(-Math.PI/2),rips=[];
for(let i=0;i<36;i++){const m=new T3.Mesh(ripGeo,new T3.MeshBasicMaterial({color:'#FFFFFF',transparent:true,opacity:0,depthWrite:false,blending:T3.AdditiveBlending}));m.visible=false;m.renderOrder=3;scene.add(m);rips.push({m,l:0})}
let ripI=0;
function ripple(x,z,col){const r=rips[ripI++%rips.length];r.m.visible=true;r.m.position.set(x,0.05,z);r.m.material.color.set(col);r.l=1}
function updRipples(dt){for(const r of rips){if(r.l<=0)continue;r.l-=dt*1.4;const k=Math.max(0,r.l);r.m.scale.setScalar(0.3+(1-k)*1.0);r.m.material.opacity=Math.min(1,k*1.3);if(r.l<=0)r.m.visible=false}}
/* ---------- audio ---------- */
let AC=null,muted=false;try{muted=localStorage.getItem('hns_mute')==='1'}catch(e){}
function au(){if(!AC){try{AC=new (window.AudioContext||window.webkitAudioContext)()}catch(e){}}if(AC&&AC.state==='suspended')AC.resume();return AC}
function tone(f,d,{type='sine',vol=0.12,slide=0,delay=0}={}){if(muted)return;const a=au();if(!a)return;const t=a.currentTime+delay,o=a.createOscillator(),g=a.createGain();o.type=type;o.frequency.setValueAtTime(f,t);if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(40,f*slide),t+d);
  g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(vol,t+0.012);g.gain.exponentialRampToValueAtTime(0.0001,t+d);o.connect(g).connect(a.destination);o.start(t);o.stop(t+d+0.02)}
const SFX={
  step:()=>tone(160+Math.random()*40,0.05,{type:'triangle',vol:0.035}),
  spot:()=>{tone(620,0.09,{type:'square',vol:0.06});tone(930,0.14,{type:'square',vol:0.06,delay:0.08})},
  catch:()=>{tone(520,0.25,{type:'triangle',vol:0.14,slide:0.45});tone(1200,0.08,{type:'sine',vol:0.06,delay:0.05})},
  cage:()=>tone(180,0.22,{type:'sine',vol:0.16,slide:0.6}),
  free:()=>[523,659,784].forEach((f,i)=>tone(f,0.14,{type:'triangle',vol:0.1,delay:i*0.07})),
  beep:()=>tone(660,0.12,{type:'sine',vol:0.1}),go:()=>tone(990,0.3,{type:'triangle',vol:0.12}),
  tick:()=>tone(1400,0.03,{type:'square',vol:0.03}),
  win:()=>[523,659,784,1047].forEach((f,i)=>tone(f,0.22,{type:'triangle',vol:0.12,delay:i*0.1})),
  lose:()=>[392,330,262].forEach((f,i)=>tone(f,0.26,{type:'triangle',vol:0.12,delay:i*0.14})),
  squirt:()=>{tone(900,0.12,{type:'sawtooth',vol:0.035,slide:0.4});tone(300,0.18,{type:'triangle',vol:0.05,slide:0.6,delay:0.03})},
  squeak:(v=1)=>{tone(1500,0.07,{type:'sine',vol:0.09*v,slide:1.3});tone(1900,0.08,{type:'sine',vol:0.07*v,slide:0.8,delay:0.09})},
  click:()=>{tone(120,0.05,{type:'square',vol:0.12});tone(80,0.12,{type:'sine',vol:0.1,delay:0.03})},
  achoo:()=>{tone(700,0.08,{type:'sine',vol:0.05,slide:1.4});tone(500,0.18,{type:'sawtooth',vol:0.04,slide:0.5,delay:0.12})},
};
let musicT=0,musicStep=0;const PENTA=[0,2,4,7,9,12,14,16];
function music(dt){if(muted||!AC||phase==='menu')return;musicT-=dt;if(musicT>0)return;
  const tense=(mode==='hide'&&seeker&&seeker.state==='hunt'&&seeker.target===player)||(phase==='play'&&timer<10);const base=tense?330:262,beat=tense?0.2:0.34;musicT=beat;musicStep++;
  if(phase==='end')return;
  const n=PENTA[(musicStep*3+Math.floor(musicStep/8)*2)%PENTA.length],f=base*Math.pow(2,n/12);
  if(musicStep%2===0||tense)tone(f,beat*1.6,{type:'triangle',vol:tense?0.035:0.028});
  if(musicStep%8===0)tone(base/2,beat*6,{type:'sine',vol:0.05});
}
$('mute').addEventListener('click',()=>{muted=!muted;$('mute').textContent=muted?'🔇':'🔊';$('mute').setAttribute('aria-label',muted?'Увімкнути звук':'Вимкнути звук');try{localStorage.setItem('hns_mute',muted?'1':'0')}catch(e){}});
$('mute').textContent=muted?'🔇':'🔊';

/* ---------- game state ---------- */
let lightsOff=false,flickerT=0,crouchOn=false,level=1,mode='hide',phase='menu',timer=0,introT=0,T=0,chars=[],player=null,seeker=null,pops=[],confetti=[],stats={},shakeT=0,darkK=0,lastTick=0,achooT=0;
try{level=Math.max(1,parseInt(localStorage.getItem('ph_level'))||1)}catch(e){}
function setCrouch(){}
function setAct(){const b=$('crouch'),hunter=player&&player.role==='seeker';b.classList.toggle('hunter',hunter);
  let label='Бризнути',ic='💦',off=false;
  if(!hunter){if(phase==='play'){const cd=Math.max(0,Math.ceil(player.tauntT||0));label=cd?'Пискнути · '+cd:'Пискнути +15';ic='📣';off=cd>0}else{label=(player&&player.rerolls>0)?'Інший предмет':'Без замін';ic='🎲';off=!(player&&player.rerolls>0)}}
  const sp=b.querySelector('span:not(.ic)');if(sp.textContent!==label)sp.textContent=label;b.querySelector('.ic').textContent=ic;b.classList.toggle('off',off)}
$('crouch').addEventListener('click',()=>{au();act()});
addEventListener('keydown',e=>{if((e.key===' '||e.key==='e'||e.key==='E')&&!e.repeat&&(phase==='play'||phase==='intro')){e.preventDefault();act()}});

function newChar(role,isPlayer,color,x,z){
  const kind=role==='seeker'?'seeker':isPlayer?'player':'hider';
  const mdl=makeBean(color,kind);mdl.root.scale.setScalar(1.18);scene.add(mdl.root);
  const ch={dis:-1,sus:0,crouch:0,role,isPlayer,color,x,z,vx:0,vz:0,yaw:Math.PI,look:Math.PI,speed:2.6,path:null,pi:0,mdl,state:'idle',caught:false,cage:null,vis:1,ph:Math.random()*6,blinkT:1+Math.random()*3,stepT:0,alertT:0,cover:0,cheer:0,repathT:0};
  if(isPlayer){const ring=new T3.Mesh(ringGeo,new T3.MeshBasicMaterial({color:role==='seeker'?'#FFE38A':'#FFFFFF',transparent:true,opacity:0.85,depthWrite:false}));ring.position.y=0.03;mdl.root.add(ring);ch.ring=ring}
  chars.push(ch);return ch;
}
function clearChars(){for(const c of chars){scene.remove(c.mdl.root);if(c.cage)scene.remove(c.cage);if(c.prop)scene.remove(c.prop);if(c.pring)scene.remove(c.pring);if(c.cageLift)scene.remove(c.cageLift)}chars=[];pops=[]}

function startLevel(){
  const v=Math.floor((level-1)/4)%4;buildWorld(Math.floor((level-1)/2)%2,!!(v&1),!!(v&2),level*977+13);
  clearChars();mode=level%2?'hide':'seek';
  const hx=TX(world.def.spawn[0]),hz=TZ(world.def.spawn[1]);
  if(mode==='hide'){
    seeker=newChar('seeker',false,'#FF5A5F',hx,hz);seeker.range=Math.min(6,4.6+level*0.1);seeker.fov=1.2;
    seeker.chase=2.9;seeker.patrol=Math.min(2.6,2.1+level*0.05);seeker.state='count';seeker.visited=[];seeker.sharp=Math.min(1.6,0.9+level*0.06);
    player=newChar('hider',true,'#4C8DFF',...snap(hx-1.4,hz+0.6));player.speed=3.4;
    const n=Math.min(4,1+Math.floor(level/2));for(let i=0;i<n;i++){const a=i/n*6.283;newChar('hider',false,COLORS[i%COLORS.length],...snap(hx+Math.cos(a)*1.3,hz+Math.sin(a)*0.5))}
    timer=120;introT=15;
  }else{
    seeker=player=newChar('seeker',true,'#FF5A5F',hx,hz);player.speed=3.4;player.range=4.8;player.fov=0.62;player.state='count';
    const n=Math.min(6,3+Math.floor(level/3));for(let i=0;i<n;i++){const a=i/n*6.283;newChar('hider',false,COLORS[i%COLORS.length],...snap(hx+Math.cos(a)*1.3,hz+Math.sin(a)*0.5))}
    timer=150;introT=9;
  }
  planProps(chars.filter(c=>c.role==='hider'&&!c.isPlayer));
  if(mode==='hide'){const it=randomProp(player,-1);player.rerolls=1;player.taunts=0;setTimeout(()=>pop(player,'Ти — '+PROPABLE[it.t],'#FFD23F'),300)}
  stats={caught:0,freed:0,total:chars.filter(c=>c.role==='hider').length,time:timer,miss:0,hunted:0};
  phase='intro';darkK=0;lastTick=0;squeakAt=0;
  for(const c of chars){c.yaw=c===seeker?0:Math.PI;c.look=c.yaw}
  seeker.yaw=seeker.look=Math.PI;seeker.cover=1;
  coneStyle();camBlend=0;setAct();$('crouch').hidden=false;
  $('ov').hidden=true;$('ovBtn').hidden=false;$('ovLeave').hidden=true;$('timer').hidden=false;$('modeChip').textContent=mode==='hide'?'Ти предмет':'Ти шукач';$('modeChip').className='chip mode '+mode;
  $('lvl').textContent='Рівень '+level+' · '+world.def.name;renderDots();
  if(mode==='seek')blind(true);
  say(mode==='hide'?'Ховайся!':'Заплющ очі…','big');SFX.beep();
  tip(mode==='hide'?'Ти випадковий предмет. Знайди, де такий виглядає природно: поруч зі схожими речами':'Предмети ховаються. За мить шукай зайві речі й бризкай по них');
}
function coneStyle(){const hunt=mode==='seek';coneMat.uniforms.color.value.set(hunt?'#7CC3FF':'#FF4D5E');coneMat.blending=T3.NormalBlending;coneMat.uniforms.opacity.value=hunt?0.32:0.42;coneMat.needsUpdate=true}
function tip(t){const el=$('tip');el.textContent=t;el.hidden=false;el.classList.remove('fade');void el.offsetWidth;el.classList.add('fade')}
function blind(on){$('blind').hidden=!on}
function renderDots(){
  const box=$('dots');box.innerHTML='';
  for(const c of chars){if(c.role!=='hider')continue;const d=document.createElement('span');d.className='dot'+(c.caught?' out':'')+(c.isPlayer?' me':'');d.style.background=c.color;box.appendChild(d)}
}
function say(text,cls){const el=$('say');el.textContent=text;el.className='say '+(cls||'');void el.offsetWidth;el.classList.add('show')}

/* ---------- input ---------- */
let joy=null;const keys={};
const gl=$('gl');
gl.addEventListener('pointerdown',e=>{au();joy={sx:e.clientX,sy:e.clientY,x:e.clientX,y:e.clientY};try{gl.setPointerCapture(e.pointerId)}catch(_){}});
gl.addEventListener('pointermove',e=>{if(joy){joy.x=e.clientX;joy.y=e.clientY}});
const endJoy=()=>joy=null;gl.addEventListener('pointerup',endJoy);gl.addEventListener('pointercancel',endJoy);
addEventListener('keydown',e=>{keys[e.key.toLowerCase()]=true});addEventListener('keyup',e=>{keys[e.key.toLowerCase()]=false});
$('ovBtn').addEventListener('click',()=>{au();if(MP.on){if(MP.host&&MP.g&&MP.g.ph==='end')hostStartRound();return}startLevel()});
$('mpOpen').addEventListener('click',()=>{au();$('ov').hidden=true;$('mp').hidden=false;$('mpA').hidden=false;$('mpB').hidden=true;$('nick').value=MP.nick;$('colorBtn').style.background=PCOL[MP.color];
  const h=(location.hash||'').replace('#','');if(/^[a-z]{4}$/.test(h))$('codeIn').value=h.toUpperCase();setTimeout(()=>$('nick').focus(),50)});
$('mpBack').addEventListener('click',()=>{$('mp').hidden=true;$('ov').hidden=false});
$('mpCreate').addEventListener('click',()=>mpJoin(rcode(),true));
$('mpJoinBtn').addEventListener('click',()=>{const c=($('codeIn').value||'').trim().toLowerCase();if(!/^[a-z]{4}$/.test(c)){$('mpErr').textContent='Код має 4 літери, наприклад KQRT.';$('mpErr').hidden=false;return}mpJoin(c)});
$('codeIn').addEventListener('keydown',e=>{if(e.key==='Enter')$('mpJoinBtn').click()});
$('colorBtn').addEventListener('click',mpCycleColor);
$('mpStart').addEventListener('click',()=>{if(MP.host){MP.botCount=+$('botSel').value;MP.mapSel=$('mapSel').value;hostStartRound()}});
$('mpQuit').addEventListener('click',mpLeave);$('ovLeave').addEventListener('click',mpLeave);
$('copyCode').addEventListener('click',()=>{const t=MP.code.toUpperCase();try{navigator.clipboard.writeText(t).then(()=>{$('copyCode').textContent='Скопійовано'},()=>{})}catch(e){}});

/* ---------- movement ---------- */
function steerPath(ch,dt,speed){
  let tx=0,tz=0;
  if(ch.path&&ch.pi<ch.path.length){const p=ch.path[ch.pi],dx=p[0]-ch.x,dz=p[1]-ch.z,d=Math.hypot(dx,dz);
    if(d<0.22){ch.pi++;}else{const last=ch.pi===ch.path.length-1,sp=last?Math.min(speed,d*3+0.6):speed;tx=dx/d*sp;tz=dz/d*sp}}
  ch.vx+=(tx-ch.vx)*Math.min(1,dt*9);ch.vz+=(tz-ch.vz)*Math.min(1,dt*9);
  return !ch.path||ch.pi>=ch.path.length;
}
function collide(ch){
  const r=0.28;
  for(const b of world.boxes){if(ch.x<b[0]-r||ch.x>b[2]+r||ch.z<b[1]-r||ch.z>b[3]+r)continue;
    const cx=Math.max(b[0],Math.min(ch.x,b[2])),cz=Math.max(b[1],Math.min(ch.z,b[3]));let dx=ch.x-cx,dz=ch.z-cz,d=Math.hypot(dx,dz);
    if(d<r){if(d<1e-5){const l=ch.x-b[0],rr=b[2]-ch.x,t=ch.z-b[1],bb=b[3]-ch.z,m=Math.min(l,rr,t,bb);if(m===l)ch.x=b[0]-r;else if(m===rr)ch.x=b[2]+r;else if(m===t)ch.z=b[1]-r;else ch.z=b[3]+r;continue}
      ch.x=cx+dx/d*r;ch.z=cz+dz/d*r;const vn=(ch.vx*dx+ch.vz*dz)/d;if(vn<0){ch.vx-=vn*dx/d;ch.vz-=vn*dz/d}}}
  for(const o of chars){if(o===ch||o.caught||o.role!==ch.role)continue;if(ch.isPlayer)continue;const dx=ch.x-o.x,dz=ch.z-o.z,d=Math.hypot(dx,dz),m=0.5;
    if(d<m&&d>1e-4){const k=(m-d)*(o.isPlayer?1:0.5);ch.x+=dx/d*k;ch.z+=dz/d*k}}
}
function integrate(ch,dt){
  if(ch.caught){ch.vx=ch.vz=0;return}
  ch.x+=ch.vx*dt;ch.z+=ch.vz*dt;collide(ch);
  const sp=Math.hypot(ch.vx,ch.vz);
  if(sp>0.25){const ty=Math.atan2(ch.vx,ch.vz);ch.yaw+=angDiff(ty,ch.yaw)*Math.min(1,dt*12)}
}

/* ---------- disguises ---------- */
const PROPABLE={bin:'смітник',stool:'табурет',vase:'ваза',books:'книжки',crate:'ящик',plant:'вазон',chair:'стілець',ball:'м’яч',lamp:'лампа',nightstand:'тумбочка',toybox:'скриня',cart:'візок',boxes:'коробки',cooler:'кулер',cafetable:'столик',washer:'пралка',toilet:'унітаз',bench:'лавка',coffee:'столик'};
const geoCache=new Map(),propMat=new T3.MeshToonMaterial({vertexColors:true,gradientMap:gm});
function propItems(){return world.items.filter(i=>PROPABLE[i.t])}
function itemYaw(it){const r=(it.rot||0)*Math.PI/2;return flipX!==flipZ?-r:r}
function setDisguise(c,idx,quiet){
  if(c.dis===idx)return;
  if(c.prop){scene.remove(c.prop);c.prop=null}
  c.dis=idx;
  if(idx>=0){const it=world.items[idx];let geo=geoCache.get(mapIdx+':'+idx);if(!geo){geo=HW.propGeometry(it.f);geoCache.set(mapIdx+':'+idx,geo)}
    const grp=new T3.Group(),mesh=new T3.Mesh(geo,propMat);mesh.castShadow=mesh.receiveShadow=true;mesh.scale.set(flipX?-1:1,1,flipZ?-1:1);grp.add(mesh);scene.add(grp);c.prop=grp;c.propT=it.t;
    c.yaw=Math.round(Math.random()*3)*Math.PI/2;c.sus=0}
  if(!quiet){puffRing(c.x,c.z,12,'#FFFFFF');SFX.free()}
}
/* the real thing of the same kind close by makes a disguise believable */
function blends(c){if(c.dis<0)return false;const t=world.items[c.dis].t;return world.items.some(i=>i.t===t&&Math.hypot(i.x-c.x,i.z-c.z)<2.4)}
function act(){
  if(!player||player.caught||(MP.on&&MP.spectator)||!(phase==='play'||phase==='intro'))return;
  if(player.role==='seeker'){shoot(player);return}
  if(phase==='intro'){if(player.rerolls>0){player.rerolls--;randomProp(player,player.dis);pop(player,'Ти — '+PROPABLE[world.items[player.dis].t],'#FFD23F')}return}
  if((player.tauntT||0)>0)return;
  player.tauntT=8;player.taunts=(player.taunts||0)+1;squeakFx(player,true);
  if(!MP.on&&mode==='hide'&&seeker.state!=='hunt'&&Math.hypot(player.x-seeker.x,player.z-seeker.z)<10){player.sus=(player.sus||0)+0.45;if(Math.random()<0.7){seeker.state='search';seeker.path=astar(seeker.x,seeker.z,player.x,player.z);seeker.pi=0}}
}
/* a random kind of thing, preferring kinds that have look-alikes on this map */
function randomProp(c,avoid){
  const items=propItems(),avoidT=avoid>=0?world.items[avoid].t:null;
  const counts={};for(const i of items)counts[i.t]=(counts[i.t]||0)+1;
  const pool=items.filter(i=>i.t!==avoidT&&counts[i.t]>=2&&i.t!=='cart'&&i.t!=='boxes');
  const it=(pool.length?pool:items)[Math.floor(Math.random()*(pool.length||items.length))];
  setDisguise(c,it.idx);return it;
}
function squeakFx(c,loud){pop(c,loud?'ПІК!':'Пік!','#A779F2');ripple(c.x,c.z,'#A779F2');const d=player?Math.hypot(c.x-player.x,c.z-player.z):5;SFX.squeak(Math.max(0.2,(loud?1.3:1)-d/14))}
function disguiseNear(c){
  const cand=propItems().filter(i=>Math.hypot(i.x-c.x,i.z-c.z)<3.2&&los(c.x,c.z,i.x,i.z)).sort((a,b)=>Math.hypot(a.x-c.x,a.z-c.z)-Math.hypot(b.x-c.x,b.z-c.z));
  const uniq=[];for(const i of cand)if(!uniq.some(u=>u.t===i.t&&(u.f.c||'')===(i.f.c||'')&&!!u.f.big===!!i.f.big))uniq.push(i);
  if(!uniq.length){pop(c,'Поруч нема речей','#FFFFFF');return}
  const cur=uniq.findIndex(u=>u.idx===c.dis);const next=uniq[(cur+1)%uniq.length];
  setDisguise(c,next.idx);pop(c,'Ти — '+PROPABLE[next.t],'#FFD23F');
}
/* water pistol: short narrow squirt; the nearest thing in it gets wet */
const squirtGeo=new T3.SphereGeometry(1,8,6),drops=[];
for(let i=0;i<60;i++){const m=new T3.Mesh(squirtGeo,new T3.MeshBasicMaterial({color:'#7CC3FF',transparent:true,opacity:0.9,depthWrite:false}));m.visible=false;scene.add(m);drops.push({m,l:0})}
let dropI=0;
function squirtFx(x,z,yaw,len){for(let i=0;i<18;i++){const d=drops[dropI++%drops.length],t=i/18;d.m.visible=true;d.l=0.35+t*0.25;d.m.position.set(x+Math.sin(yaw)*0.4,0.75,z+Math.cos(yaw)*0.4);
  const sp=len/0.4*(0.6+Math.random()*0.5),j=(Math.random()-.5)*0.18;d.vx=Math.sin(yaw+j)*sp;d.vz=Math.cos(yaw+j)*sp;d.vy=1.2+Math.random()*1.2;d.m.scale.setScalar(0.05+Math.random()*0.04)}
  SFX.squirt()}
function updDrops(dt){for(const d of drops){if(d.l<=0)continue;d.l-=dt;d.vy-=9*dt;d.m.position.x+=d.vx*dt;d.m.position.z+=d.vz*dt;d.m.position.y=Math.max(0.03,d.m.position.y+d.vy*dt);d.m.material.opacity=Math.min(0.9,d.l*3);if(d.l<=0)d.m.visible=false}}
function splash(x,z){for(let i=0;i<10;i++)puff(x,z,0.07,0.9,'#9FD6FF');ripple(x,z,'#7CC3FF')}
function shootTarget(s,yaw,range){
  let best=null,bd=1e9;
  for(const h of chars){if(h.role!=='hider'||h.caught)continue;const dx=h.x-s.x,dz=h.z-s.z,d=Math.hypot(dx,dz);if(d>range)continue;
    if(Math.abs(angDiff(Math.atan2(dx,dz),yaw))>(d<1.2?0.9:0.32))continue;if(!los(s.x,s.z,h.x,h.z))continue;if(d<bd){bd=d;best=h}}
  return best;
}
function shoot(s,forced){
  if(phase!=='play'||(s.gunT||0)>0)return;
  const yaw=s.look,range=4.8;s.gunT=s.isPlayer?0.55:0.9;s.shots=(s.shots||0)+1;
  const h=forced===undefined?shootTarget(s,yaw,range):forced;
  // how far the stream flies: up to the target, a wall or the range
  const reach=h?Math.hypot(h.x-s.x,h.z-s.z):Math.min(range,rayHit(s.x,s.z,yaw,range));
  squirtFx(s.x,s.z,yaw,reach);
  if(h){splash(h.x,h.z);if(MP.on)MP.cg.add(h.id);else catchHider(h);return}
  const ex=s.x+Math.sin(yaw)*reach,ez=s.z+Math.cos(yaw)*reach;splash(ex,ez);
  pops.push({ch:{x:ex,z:ez,vis:1},text:'Мимо!',color:'#FFFFFF',t:0});
  if(s.isPlayer){if(MP.on){s.gunT=2;tip('Мимо! Пістолет перезаряджається')}else{timer=Math.max(0,timer-3);stats.miss++;floatHud('−3 с')}}
  // props hit nearby by the splash may panic
  for(const c of chars)if(c.role==='hider'&&!c.caught&&!c.isPlayer&&Math.hypot(c.x-ex,c.z-ez)<1.4&&Math.random()<0.5)panic(c);
}
function floatHud(t){const el=$('pen');el.textContent=t;el.classList.remove('show');void el.offsetWidth;el.classList.add('show')}

/* ---------- AI ---------- */
function freeSpotNear(it,taken){
  for(let k=0;k<24;k++){const a=Math.random()*6.283,r=0.75+Math.random()*0.7,[x,z]=snap(it.x+Math.cos(a)*r,it.z+Math.sin(a)*r);
    if(Math.hypot(x-it.x,z-it.z)>1.7)continue;if(taken.some(t=>Math.hypot(t[0]-x,t[1]-z)<1.1))continue;
    if(world.items.some(i=>Math.hypot(i.x-x,i.z-z)<0.55))continue;return[x,z]}
  return null;
}
/* bots pick a kind of thing that has look-alikes around, in a room of their own, and park beside one */
function planProps(bots){
  const items=propItems(),taken=[];
  const sx=TX(world.def.spawn[0]),sz=TZ(world.def.spawn[1]);
  for(const b of bots){
    const it=randomProp(b,-1);b.dis=it.idx;
    const twins=items.filter(o=>o.t===it.t&&Math.hypot(o.x-sx,o.z-sz)>3.5).sort(()=>Math.random()-0.5);
    for(const o of twins){const p=freeSpotNear(o,taken);if(!p)continue;taken.push(p);b.plan={it:o,x:p[0],z:p[1]};break}
    if(!b.plan){const sp=spots.filter(s=>Math.hypot(s.x-sx,s.z-sz)>4&&taken.every(t=>Math.hypot(t[0]-s.x,t[1]-s.z)>1.2)).sort((a,c)=>c.score-a.score+(Math.random()-.5)*8)[0];if(sp){taken.push([sp.x,sp.z]);b.plan={it:world.items[b.dis],x:sp.x,z:sp.z}}}
    b.state='toSpot';b.speed=2.6;b.flee=2.5;if(b.plan){b.path=astar(b.x,b.z,b.plan.x,b.plan.z);b.pi=0}
  }
}
function panic(h){if(h.state==='flee'||h.isPlayer)return;h.state='flee';pop(h,'!','#FFD23F');const t=fleeTarget(h,seeker);if(t){h.path=astar(h.x,h.z,t[0],t[1]);h.pi=0}}
function fleeTarget(h,s){
  let best=null,bs=-1e9;
  for(let k=0;k<40;k++){const a=Math.random()*6.283,r=2.5+Math.random()*6,[x,z]=snap(h.x+Math.cos(a)*r,h.z+Math.sin(a)*r);
    const ds=Math.hypot(x-s.x,z-s.z),dh=Math.hypot(x-h.x,z-h.z),toward=((x-h.x)*(s.x-h.x)+(z-h.z)*(s.z-h.z))/(dh*Math.hypot(s.x-h.x,s.z-h.z)+1e-6);
    let sc=ds-dh*0.3-(toward>0.35?6:0)+(los(s.x,s.z,x,z)?-3:1.5);
    if(sc>bs){bs=sc;best=[x,z]}}
  return best;
}
function hiderAI(h,dt){
  if(h.caught)return;
  const s=seeker,d=Math.hypot(s.x-h.x,s.z-h.z);
  if(h.state==='toSpot'){const done=steerPath(h,dt,h.speed);
    if(done){h.state='prop';h.vx=h.vz=0;if(h.plan)h.yaw=itemYaw(h.plan.it)+(Math.random()<0.3?Math.PI/2:0)}
    return}
  if(phase==='intro')return;
  if(h.state==='flee'){const done=steerPath(h,dt,h.flee);if(Math.random()<dt*6)puff(h.x,h.z,0.07,0.4);
    if(done){const t=h.dis>=0?world.items[h.dis].t:null;const items=propItems().filter(i=>(!t||i.t===t)&&Math.hypot(i.x-h.x,i.z-h.z)<8&&Math.hypot(i.x-s.x,i.z-s.z)>4);const it=items[Math.floor(Math.random()*items.length)];
      const p=it&&freeSpotNear(it,chars.filter(c=>c!==h).map(c=>[c.x,c.z]));if(p){h.plan={it,x:p[0],z:p[1]};h.path=astar(h.x,h.z,p[0],p[1]);h.pi=0;h.state='toSpot';h.speed=2.4}else h.state='prop'}
    return}
  // a prop holds still; if the hunter is right on top of it and looking, it may bolt
  h.vx*=0.6;h.vz*=0.6;
  if(d<1.8&&s.state!=='count'&&Math.abs(angDiff(Math.atan2(h.x-s.x,h.z-s.z),s.look))<0.7){h.nerve=(h.nerve||0)+dt;if(h.nerve>0.6&&Math.random()<dt*1.6){h.nerve=0;panic(h)}}else h.nerve=0;
}
/* the hunter remembers the room; things that move or have no look-alikes around grow suspicious */
function seekerAI(s,dt){
  if(s.state==='count'){s.vx*=0.8;s.vz*=0.8;return}
  s.gunT=(s.gunT||0)-dt;
  let tgt=null,best=0;
  for(const h of chars){if(h.role!=='hider'||h.caught)continue;
    if(sees(s,h)){const d=Math.hypot(h.x-s.x,h.z-s.z),mv=Math.hypot(h.vx,h.vz)>0.4;
      const rate=h.dis<0?6:(mv?3:(blends(h)?0.19:0.6))*Math.max(0.3,1.6-d/s.range)*s.sharp;h.sus=(h.sus||0)+rate*dt}
    else h.sus=Math.max(0,(h.sus||0)-dt*0.12);
    if(h.sus>1&&h.sus>best){best=h.sus;tgt=h}}
  if(tgt&&s.state!=='hunt'){s.state='hunt';s.target=tgt;s.aimT=0.5;pop(s,'?','#FFD23F');SFX.spot()}
  if(s.state==='hunt'){const t=s.target;if(!t||t.caught){s.state='look';s.lookT=1.2;s.lookBase=s.yaw;s.path=null;return}
    const d=Math.hypot(t.x-s.x,t.z-s.z),aim=Math.atan2(t.x-s.x,t.z-s.z);
    if(d>3.2||!los(s.x,s.z,t.x,t.z)){s.repathT=(s.repathT||0)-dt;if(s.repathT<=0){s.path=astar(s.x,s.z,t.x,t.z);s.pi=0;s.repathT=0.4}steerPath(s,dt,s.chase);s.look=s.yaw;
      if(!sees(s,t)){s.lost=(s.lost||0)+dt;if(s.lost>3){s.state='patrol';s.path=null;s.lost=0;t.sus=0.5}}else s.lost=0;return}
    s.vx*=0.7;s.vz*=0.7;s.look+=angDiff(aim,s.look)*Math.min(1,dt*8);s.yaw=s.look;s.aimT-=dt;
    if(s.aimT<=0&&Math.abs(angDiff(aim,s.look))<0.15){
      // not a sniper: a still, well-blended prop can be missed
      const miss=Math.random()<(t.dis>=0&&blends(t)&&Math.hypot(t.vx,t.vz)<0.4?0.3:0.1);
      if(miss){s.look+=(Math.random()<0.5?-1:1)*0.45;shoot(s,null);t.sus=0.55}else shoot(s,t);
      s.aimT=0.8;if(!t.caught&&miss){s.state='look';s.lookT=1.2;s.lookBase=s.yaw}}
    return}
  if(s.state==='look'){s.lookT-=dt;s.vx*=0.85;s.vz*=0.85;s.look=s.lookBase+Math.sin((2.4-s.lookT)*2.4)*1.2;
    // now and then it tests a real thing, just in case
    if(!s.tested&&s.lookT<0.8&&Math.random()<0.25){s.tested=true;const it=world.items.find(i=>PROPABLE[i.t]&&Math.hypot(i.x-s.x,i.z-s.z)<3.5&&los(s.x,s.z,i.x,i.z));if(it){s.look=Math.atan2(it.x-s.x,it.z-s.z);shoot(s,null)}}
    if(s.lookT<=0){s.state='patrol';s.path=null;s.tested=false}return}
  if(!s.path||s.pi>=s.path.length){
    if(s.state==='search'||s.path){s.state='look';s.lookT=2.4;s.lookBase=s.yaw;s.path=null;return}
    const opts=waypoints.filter(w=>!s.visited.some(v=>v===w)&&Math.hypot(w[0]-s.x,w[1]-s.z)>2.5);
    const pickFrom=opts.length?opts:waypoints;const w=pickFrom[Math.floor(Math.random()*pickFrom.length)];
    s.visited.push(w);if(s.visited.length>6)s.visited.shift();
    s.path=astar(s.x,s.z,w[0],w[1]);s.pi=0;s.state='patrol';
  }
  steerPath(s,dt,s.state==='search'?s.chase*0.85:s.patrol);
  s.look=s.yaw+(reduce?0:Math.sin(T*1.7)*0.4);
}
/* every 20 s each prop squeaks; the hunter bot may come to check */
let squeakAt=0;
function squeaks(){
  const el=(phase==='play')?Math.floor((stats.time-timer)/20):-1;if(el<1||el===squeakAt)return;squeakAt=el;
  chars.filter(c=>c.role==='hider'&&!c.caught).forEach((c,i)=>setTimeout(()=>{if(c.caught||phase!=='play')return;squeakFx(c,false);
    if(!MP.on&&mode==='hide'&&seeker.state!=='hunt'&&Math.random()<0.55&&Math.hypot(c.x-seeker.x,c.z-seeker.z)<9){seeker.state='search';seeker.path=astar(seeker.x,seeker.z,c.x,c.z);seeker.pi=0;c.sus=(c.sus||0)+0.35}},400+i*650));
}
function catchHider(h){
  if(h.caught)return;
  h.caught=true;h.vx=h.vz=0;h.path=null;h.state='caught';stats.caught++;
  if(h.dis>=0){setDisguise(h,-1,true);puffRing(h.x,h.z,16,'#9FD6FF')}
  h.cage=makeCage();h.cage.position.set(h.x,3.4,h.z);h.cageT=0;pop(h,h.isPlayer?'Ой!':'+1',h.isPlayer?'#FF5A5F':'#4CC97A');
  SFX.catch();try{navigator.vibrate&&navigator.vibrate(40)}catch(e){}
  renderDots();
  if(MP.on)return;
  if(h.isPlayer)endLevel(false);
  else if(mode==='seek'&&chars.every(c=>c.role!=='hider'||c.caught))endLevel(true);
}
function free(h){if(!h.caught)return;h.caught=false;h.state='prop';h.cageLift=h.cage;h.cage=null;stats.caught--;renderDots()}

/* ---------- pops ---------- */
function pop(ch,text,color){pops.push({ch,text,color,t:0})}

/* ---------- flow ---------- */
function endLevel(won){
  if(phase!=='play')return;phase='end';joy=null;$('crouch').hidden=true;blind(false);
  const n=stats.total-(mode==='hide'?1:0);
  if(won){(mode==='hide'?player:seeker).cheer=1;SFX.win();for(let i=0;i<120;i++)confetti.push({x:W/2+(Math.random()-.5)*W*0.8,y:H*0.3+(Math.random()-.5)*60,vx:(Math.random()-.5)*420,vy:-150-Math.random()*380,l:2.6,c:COLORS[i%COLORS.length],r:Math.random()*6})}
  else SFX.lose();
  let title,text,stars=0;
  if(mode==='hide'){
    const freeNow=chars.filter(c=>c.role==='hider'&&!c.isPlayer&&!c.caught).length;
    const score=Math.floor(stats.time-timer)+15*(player.taunts||0)+Math.round(stats.hunted*2);let best=0;try{best=+localStorage.getItem('ph_best')||0;if(score>best){localStorage.setItem('ph_best',score)}}catch(e){}
    const sline=' Очки: '+score+(score>best?' — новий рекорд!':' (рекорд '+best+')')+'.';
    if(won){title='Тебе не впізнали!';stars=1+((player.taunts||0)>=2?1:0)+(stats.hunted>3?1:0);text='Ти протримався всі '+Math.round(stats.time)+' с.'+sline+' Зірки дають писки й моменти під поглядом шукача.'}
    else{title='Тебе облили!';text='Протримався '+Math.floor(stats.time-timer)+' с.'+sline+' Шукай місце, де «Схожих поруч» хоча б 2, і не ворушись під його поглядом.'}
  }else{
    if(won){title='Усіх облив!';const k=timer/stats.time;stars=(k>0.4?2:1)+(stats.miss<=2?1:0);text='Залишилось '+Math.ceil(timer)+' с, промахів: '+stats.miss+'. Наступного разу предмети хитріші.'}
    else{title='Час вийшов';text='Знайдено '+stats.caught+' з '+n+'. Шукай речі без «пари» і слухай, звідки пищить.'}
  }
  if(won){level++;try{localStorage.setItem('ph_level',level)}catch(e){}}
  setTimeout(()=>{$('ovTitle').textContent=title;$('ovText').textContent=text;$('stars').hidden=!won;$('stars').innerHTML=[0,1,2].map(i=>'<span class="'+(i<stars?'on':'')+'">★</span>').join('');
    $('ovHint').hidden=true;document.querySelector('.card .hint').hidden=true;$('ovBtn').textContent=won?'Далі':'Ще раз';$('ovTitle').classList.toggle('lose',!won);$('ov').hidden=false;setTimeout(()=>$('ovBtn').focus({preventScroll:true}),50)},won?1500:1200);
}

/* ---------- main update ---------- */
let camBlend=0;const camPos=new T3.Vector3(),camLook=new T3.Vector3();
function update(dt){
  T+=dt;
  if(MP.on)mpTick(dt);
  else if(phase==='intro'){
    const before=Math.ceil(introT);introT-=dt;const now=Math.ceil(introT);timer=timer;
    if(now!==before&&now>0&&now<=3){say(String(now),'num');SFX.beep()}
    if(mode==='seek')$('blindN').textContent=Math.max(1,now);
    if(introT<=0){phase='play';seeker.state=mode==='hide'?'patrol':'idle';seeker.cover=0;blind(false);
      say(mode==='hide'?'Шукаю!':'Шукай!','big go');SFX.go();if(mode==='hide')seeker.path=null}
  }else if(phase==='play'){
    timer-=dt;
    if(timer<=10&&Math.ceil(timer)!==lastTick){lastTick=Math.ceil(timer);SFX.tick()}
    if(timer<=0){timer=0;endLevel(mode==='hide')}
  }
  if(player){player.gunT=(player.gunT||0)-dt;player.tauntT=Math.max(0,(player.tauntT||0)-dt);if(phase==='play'||phase==='intro')setAct()}
  hints(dt);
  // player control
  if(player&&!player.caught&&!(MP.on&&MP.spectator)){
    let ix=0,iz=0;
    if(joy){const dx=joy.x-joy.sx,dy=joy.y-joy.sy,m=Math.hypot(dx,dy);if(m>6){const k=Math.min(1,m/55);ix=dx/m*k;iz=dy/m*k}}
    if(keys.a||keys.arrowleft)ix-=1;if(keys.d||keys.arrowright)ix+=1;if(keys.w||keys.arrowup)iz-=1;if(keys.s||keys.arrowdown)iz+=1;
    const im=Math.hypot(ix,iz);if(im>1){ix/=im;iz/=im}
    const frozen=phase==='end'||(player.role==='seeker'&&phase==='intro')||phase==='menu';
    const sp=frozen?0:player.speed*(player.dis>=0?0.7:1);
    player.vx+=(ix*sp-player.vx)*Math.min(1,dt*11);player.vz+=(iz*sp-player.vz)*Math.min(1,dt*11);
    if(player.role==='seeker')player.look=player.yaw;
  }
  if(phase==='intro'||phase==='play'){
    if(!MP.on||MP.host)for(const c of chars){if(c.role==='hider'&&!c.isPlayer&&!c.remote)hiderAI(c,dt)}
    if(mode==='hide'&&!MP.on)seekerAI(seeker,dt);
  }
  const steps=dt>0.03?2:1;for(let k=0;k<steps;k++)for(const c of chars)if(!c.remote&&!c.netBot)integrate(c,dt/steps);
  if(MP.on)mpFollow(dt);
  squeaks();
  // a still prop settles square, the way furniture stands
  for(const c of chars)if(c.dis>=0&&Math.hypot(c.vx,c.vz)<0.2&&!c.remote&&!c.netBot){const q=Math.round(c.yaw/(Math.PI/2))*(Math.PI/2);c.yaw+=angDiff(q,c.yaw)*Math.min(1,dt*6)}
  for(const c of chars){c.vis=1;const sp=Math.hypot(c.vx,c.vz);c.stepT-=dt*sp;if(sp>1.8&&c.stepT<=0){c.stepT=0.55;puff(c.x-c.vx*0.05,c.z-c.vz*0.05,0.07,0.35);if(c.isPlayer)SFX.step()}}
  for(const c of chars)animate(c,dt);
  // cages
  for(const c of chars){
    if(c.cage){c.cageT+=dt;const t=Math.min(1,c.cageT/0.55),y=3.4*(1-t*t);let b=0;if(t>=1){const u=(c.cageT-0.55)*7;b=u<Math.PI?Math.sin(u)*0.12*Math.exp(-u*0.6):0}
      c.cage.position.set(c.x,Math.max(0,y)+b,c.z);if(t>=1&&!c.cageLanded){c.cageLanded=true;puffRing(c.x,c.z);SFX.cage();shakeT=0.18}}
    if(c.cageLift){c.cageLift.position.y+=dt*5;c.cageLift.rotation.y+=dt*4;if(c.cageLift.position.y>5){scene.remove(c.cageLift);c.cageLift=null}c.cageLanded=false}
  }
  updPuffs(dt);updRipples(dt);updDrops(dt);
  // view cone: red for a bot hunter, a short blue aim guide for you
  const coneOwner=seeker;cone.visible=phase!=='menu'&&coneOwner.state!=='count'&&coneOwner.cover<0.5&&phase!=='end'&&(mode==='seek'?coneOwner===player:!MP.on);
  if(cone.visible)updateCone(coneOwner);
  hemi.intensity=0.52;sun.intensity=0.62;flash.intensity=0;glow.intensity=0;
  // camera
  const a=W/H,far=(a<0.8?1.3:1)*(player&&player.role==='hider'?1.18:1);
  const fol=player,oy=9.2*far,oz=6.6*far;
  const want=new T3.Vector3(fol.x,oy,fol.z+oz),lookAt=new T3.Vector3(fol.x,0,fol.z-0.4);
  camPos.lerp(want,Math.min(1,dt*(camBlend<1?60:5)));camLook.lerp(lookAt,Math.min(1,dt*(camBlend<1?60:6)));camBlend=1;
  camera.position.copy(camPos);if(shakeT>0&&!reduce){shakeT-=dt;camera.position.x+=(Math.random()-.5)*0.12;camera.position.y+=(Math.random()-.5)*0.08}
  camera.lookAt(camLook);
  if(phase==='play'||phase==='intro'){const t=Math.ceil(phase==='intro'&&!MP.on?introT:timer);$('timer').textContent=Math.floor(t/60)+':'+String(t%60).padStart(2,'0');$('timer').classList.toggle('hot',phase==='play'&&timer<=10)}
}

/* prop-side feedback: how natural the spot is, and whether the hunter is onto you */
function hints(dt){
  const show=player&&player.role==='hider'&&!player.caught&&(phase==='intro'||phase==='play')&&!(MP.on&&MP.spectator)&&player.dis>=0;
  $('hints').hidden=!show;if(!show)return;
  const t=world.items[player.dis].t,n=world.items.filter(i=>i.t===t&&Math.hypot(i.x-player.x,i.z-player.z)<2.4).length;
  const b=$('blend');b.textContent=n?'Схожих поруч: '+n:'Поруч нема схожих';b.className='hchip '+(n>=2?'good':n===1?'ok':'bad');
  let v=0,seen=false;if(phase==='play'){seen=sees(seeker,player);v=MP.on?(seen?1:0):Math.min(1,player.sus||0)}
  if(!MP.on&&seen&&phase==='play')stats.hunted+=dt;
  const s=$('sus');s.hidden=phase!=='play';s.classList.toggle('hot',seen);$('susBar').style.width=Math.round(v*100)+'%';$('susTxt').textContent=seen?'Шукач дивиться':'Підозра';
}
/* ---------- character animation ---------- */
function animate(c,dt){
  const m=c.mdl,sp=Math.hypot(c.vx,c.vz),k=Math.min(1,sp/2.6);
  m.root.position.set(c.x,0,c.z);m.root.rotation.y=c.yaw;
  if(c.prop){m.root.visible=false;c.ph+=dt*(4+sp*3.4);const hop=reduce?0:Math.abs(Math.sin(c.ph*1.4))*0.12*k;
    c.prop.position.set(c.x,hop,c.z);c.prop.rotation.set(reduce?0:Math.sin(c.ph*1.4)*0.08*k,c.yaw,0);
    if(c.ring){c.ring.visible=false}if(c.isPlayer&&!c.pring){c.pring=new T3.Mesh(ringGeo,c.ring.material);c.pring.position.y=0.03;scene.add(c.pring)}
    if(c.pring){c.pring.visible=true;c.pring.position.x=c.x;c.pring.position.z=c.z;c.pring.scale.setScalar(1.5)}return}
  if(c.pring)c.pring.visible=false;
  m.root.visible=true;
  c.ph+=dt*(4+sp*3.4);
  const bob=reduce?0:Math.abs(Math.sin(c.ph))*0.07*k,breathe=reduce?0:Math.sin(T*3+c.ph*0.1)*0.015;
  let jump=0;if(c.cheer>0&&!reduce)jump=Math.abs(Math.sin(T*8))*0.35;
  const cr=c.crouch||0;
  m.body.position.y=(bob+jump)*(1-cr*0.6);m.body.scale.set((1+bob*0.6-breathe*0.5)*(1+cr*0.14),(1-bob*0.8+breathe)*(1-cr*0.36),(1+bob*0.6-breathe*0.5)*(1+cr*0.14));m.body.rotation.x=k*0.2*(1-cr)+cr*0.12;
  const sw=reduce?0:Math.sin(c.ph)*k;
  m.fL.position.set(-0.11,0.045+Math.max(0,Math.sin(c.ph))*0.07*k,0.02+sw*0.15);m.fR.position.set(0.11,0.045+Math.max(0,-Math.sin(c.ph))*0.07*k,0.02-sw*0.15);
  // hands: swing / cover eyes / cheer / hold the bars when caged
  const cover=c.cover||0;
  let hx=0.31,hy=0.36+bob,hz=0.02-sw*0.12;
  if(c.caught){hx=0.24;hy=0.62;hz=0.24}
  hy*=1-cr*0.45;hx+=cr*0.03;
  if(c.cheer>0){hy=0.9+Math.sin(T*16)*0.05;hx=0.3}
  m.hL.position.set(-(hx+(0.1-hx)*cover),hy+(0.66-hy)*cover,hz+(0.27-hz)*cover);m.hR.position.set(hx+(0.1-hx)*cover,hy+(0.66-hy)*cover,-hz+(0.27+hz)*cover);
  if(m.torch)m.torch.rotation.x=cover>0.5?-1.2:0;
  // face
  c.blinkT-=dt;const blink=c.blinkT<0.1?0.1:1;if(c.blinkT<0)c.blinkT=2+Math.random()*3;
  m.eyes.scale.y=blink;
  const sad=c.caught,scared=c.state==='flee'||(c.alertT>0);
  m.pL.position.y=m.pR.position.y=sad?-0.03:-0.005;m.pL.scale.setScalar(scared?0.032:0.04);m.pR.scale.setScalar(scared?0.032:0.04);m.pL.scale.y*=1.2;m.pR.scale.y*=1.2;
  m.mouth.scale.set(scared||sad?0.03:c.cheer>0?0.06:0.035,scared?0.03:0.016,0.012);
  if(m.star)m.star.position.y=1.07+(reduce?0:Math.sin(T*4)*0.02);
  if(c.ring){c.ring.material.opacity=0.6+Math.sin(T*4)*0.2;c.ring.visible=!c.caught}
  // fog fade
  const v=c.vis;
  for(const mm of m.mats){const tr=v<0.99;if(mm.transparent!==tr){mm.transparent=tr;mm.needsUpdate=true}mm.opacity=v}
}

/* ---------- overlay: pops, joystick, confetti ---------- */
const FONT='"Baloo 2","Arial Rounded MT Bold",sans-serif';
const _p=new T3.Vector3();
function drawFx(dt){
  fctx.clearRect(0,0,W,H);
  for(const p of pops){p.t+=dt;if(p.t>1.3)continue;_p.set(p.ch.x,1.25,p.ch.z).project(camera);if(_p.z>1)continue;
    const x=(_p.x+1)/2*W,y=(1-_p.y)/2*H-p.t*22,e=p.t<0.25?(1-Math.pow(1-p.t/0.25,3))*1.15:1-(p.t>1.0?(p.t-1.0)/0.3:0)*0.2;
    fctx.globalAlpha=p.t>1.0?Math.max(0,1-(p.t-1.0)/0.3):1;fctx.save();fctx.translate(x,y);fctx.scale(e,e);
    fctx.font='800 '+(p.text.length>2?18:26)+'px '+FONT;const w=Math.max(34,fctx.measureText(p.text).width+20),h=34;
    fctx.fillStyle='rgba(0,0,0,.18)';fctx.beginPath();fctx.roundRect(-w/2,-h/2+3,w,h,17);fctx.fill();
    fctx.fillStyle=p.color;fctx.beginPath();fctx.roundRect(-w/2,-h/2,w,h,17);fctx.fill();
    fctx.beginPath();fctx.moveTo(-6,h/2-1);fctx.lineTo(0,h/2+7);fctx.lineTo(6,h/2-1);fctx.fill();
    fctx.fillStyle='#1D1A26';fctx.textAlign='center';fctx.textBaseline='middle';fctx.fillText(p.text,0,2);fctx.restore();fctx.globalAlpha=1}
  pops=pops.filter(p=>p.t<1.3);
  if(MP.on&&(phase==='play'||phase==='intro'||phase==='end'))for(const c of chars){if(!c.nick||c.vis<0.5)continue;_p.set(c.x,1.45,c.z).project(camera);if(_p.z>1)continue;
    const x=(_p.x+1)/2*W,y=(1-_p.y)/2*H;fctx.font='800 13px '+FONT;const t=c.isPlayer?'Ти':c.nick,w=fctx.measureText(t).width+12;
    fctx.fillStyle='rgba(29,26,38,.55)';fctx.beginPath();fctx.roundRect(x-w/2,y-10,w,19,9);fctx.fill();fctx.fillStyle='#fff';fctx.textAlign='center';fctx.textBaseline='middle';fctx.fillText(t,x,y+1)}
  if(phase==='play'){
    const targets=[];
    if(mode==='hide'&&seeker.state==='hunt'&&seeker.target===player)targets.push([seeker,'#FF5A5F']);
    for(const [c,col] of targets){_p.set(c.x,0.5,c.z).project(camera);let x=(_p.x+1)/2*W,y=(1-_p.y)/2*H;const m=34;
      if(x>m&&x<W-m&&y>90&&y<H-m&&_p.z<1)continue;
      const cx=W/2,cy=H/2;let dx=x-cx,dy=y-cy;if(_p.z>1){dx=-dx;dy=-dy}const s=Math.min((W/2-m)/Math.abs(dx||1e-6),(H/2-m-40)/Math.abs(dy||1e-6));x=cx+dx*s;y=cy+dy*s+20;
      const a=Math.atan2(dy,dx),pulse=reduce?1:1+Math.sin(T*6)*0.08;fctx.save();fctx.translate(x,y);fctx.scale(pulse,pulse);
      fctx.fillStyle='rgba(0,0,0,.2)';fctx.beginPath();fctx.arc(0,3,17,0,6.283);fctx.fill();fctx.fillStyle=col;fctx.beginPath();fctx.arc(0,0,17,0,6.283);fctx.fill();
      fctx.rotate(a);fctx.fillStyle='#1D1A26';fctx.beginPath();fctx.moveTo(10,0);fctx.lineTo(-5,-7);fctx.lineTo(-2,0);fctx.lineTo(-5,7);fctx.fill();fctx.restore()}
  }
  if(joy&&phase!=='end'){const dx=joy.x-joy.sx,dy=joy.y-joy.sy,m=Math.hypot(dx,dy),k=m>55?55/m:1;
    fctx.fillStyle='rgba(255,255,255,.18)';fctx.strokeStyle='rgba(255,255,255,.55)';fctx.lineWidth=2;fctx.beginPath();fctx.arc(joy.sx,joy.sy,55,0,6.283);fctx.fill();fctx.stroke();
    fctx.fillStyle='rgba(255,255,255,.9)';fctx.beginPath();fctx.arc(joy.sx+dx*k,joy.sy+dy*k,22,0,6.283);fctx.fill()}
  for(const c of confetti){c.l-=dt;c.vy+=520*dt;c.x+=c.vx*dt;c.y+=c.vy*dt;c.r+=dt*8;fctx.globalAlpha=Math.min(1,c.l);fctx.fillStyle=c.c;fctx.save();fctx.translate(c.x,c.y);fctx.rotate(c.r);fctx.fillRect(-5,-3,10,6);fctx.restore()}
  confetti=confetti.filter(c=>c.l>0);fctx.globalAlpha=1;
}


/* ---------- multiplayer ----------
   Transport-agnostic: anything with join(code) -> {presence(patch), peers(), leave()} works.
   Here: the Claude artifact room. In your own app: set window.HNS_TRANSPORT (see net-firebase.js).
   Authority: the HOST (first in the room) runs phases, rounds and bots; the SEEKER owns the caught list;
   everyone owns their own position. All of it travels as presence (absolute state, no events). */
const MP={on:false,avail:null,net:null,code:'',me:null,host:false,nick:'',color:0,g:null,hostT:0,round:-1,phKey:'',phEnd:0,
  spectator:false,cg:new Set(),bf:new Set(),botCount:2,mapSel:'auto',sent:0};
try{MP.nick=localStorage.getItem('hns_nick')||'';MP.color=+localStorage.getItem('hns_color')||Math.floor(Math.random()*6)}catch(e){}
const PCOL=['#4C8DFF','#4CC97A','#FFC93C','#A779F2','#FF9A3D','#FF7BB0','#3CC8C8','#8BD14B'];
const claudeTransport={async ready(){const r=window.claude&&window.claude.use?await window.claude.use('room'):null;this.r=r;return !!r},
  async join(code){const nr=await this.r.join('ph-'+code);return{presence:p=>nr.presence(p).catch(()=>{}),
    peers:()=>nr.peers().map(p=>({id:p.peer,isMe:p.sameTab,presence:p.presence||{},updatedAt:p.updatedAt})),leave:()=>nr.leave().catch(()=>{})}}};
(async()=>{const t=window.HNS_TRANSPORT||claudeTransport;try{MP.avail=await t.ready()?t:null}catch(e){MP.avail=null}mpMenuState()})();
function mpMenuState(){const b=$('mpOpen');b.disabled=!MP.avail;$('mpNote').hidden=!!MP.avail;if(!MP.avail&&!window.claude)$('mpNote').textContent='Гра з друзями зʼявиться згодом. Поки що — з ботами.'}
const rcode=()=>Array.from({length:4},()=>'abcdefghjkmnpqrstuvwxyz'[Math.floor(Math.random()*23)]).join('');
function peersNow(){return MP.net?MP.net.peers():[]}
function presOf(id){const p=peersNow().find(p=>p.id===id);return p?p.presence:null}
function humans(){return peersNow().filter(p=>p.presence&&p.presence.n).sort((a,b)=>a.id<b.id?-1:1)}
/* the earliest claim wins; a newcomer only claims after it has had time to hear the room */
function hostId(){const ps=humans();const hs=ps.filter(p=>p.presence.h).sort((a,b)=>(+a.presence.h-+b.presence.h)||(a.id<b.id?-1:1));return(hs[0]||ps[0]||{}).id}

async function mpJoin(code,create){
  au();MP.nick=($('nick').value||'').trim().slice(0,14)||'Гравець';try{localStorage.setItem('hns_nick',MP.nick);localStorage.setItem('hns_color',MP.color)}catch(e){}
  $('mpErr').hidden=true;
  try{MP.net=await MP.avail.join(code)}catch(e){$('mpErr').textContent='Не вдалося увійти в кімнату. Спробуй ще раз.';$('mpErr').hidden=false;return}
  MP.code=code;MP.on=true;MP.joinedAt=performance.now();MP.round=-1;MP.phKey='';MP.g=null;MP.cg=new Set();MP.bf=new Set();
  MP.net.presence({n:MP.nick,c:MP.color,h:create?Date.now():null,g:null,b:null,cg:null,d:null,sh:null,q:null});
  $('roomCode').textContent=code.toUpperCase();$('mpA').hidden=true;$('mpB').hidden=false;
  phase='lobby';mpLobbyRender();
}
function mpLeave(){if(MP.net)MP.net.leave();MP.net=null;MP.on=false;MP.host=false;MP.g=null;MP.lastG=null;MP.me=null;phase='menu';$('ovBtn').hidden=false;$('ovBtn').textContent='Грати';$('ovLeave').hidden=true;$('ovTitle').textContent='Перевтілення';$('ovTitle').classList.remove('lose');$('ovHint').hidden=false;document.querySelector('.card .hint').hidden=false;clearChars();$('mp').hidden=true;$('ov').hidden=false;$('crouch').hidden=true;$('timer').hidden=true;
  location.hash='';buildWorld(0,false,false);player=seeker=newChar('seeker',false,'#FF5A5F',TX(11),TZ(8.6));seeker.range=5;seeker.fov=1.25;seeker.state='idle';seeker.cover=0}
function mpLobbyRender(){
  const list=$('plist');list.innerHTML='';const hid=hostId();
  for(const p of humans()){const li=document.createElement('li');const d=document.createElement('span');d.className='pdot';d.style.background=PCOL[(p.presence.c|0)%PCOL.length];
    const nm=document.createElement('span');nm.textContent=String(p.presence.n).slice(0,14)+(p.isMe?' (ти)':'');li.append(d,nm);
    if(p.id===hid){const t=document.createElement('em');t.textContent='хост';li.append(t)}list.append(li)}
  const me=(peersNow().find(p=>p.isMe)||{}).id,amHost=!!me&&hid===me;$('hostCtl').hidden=!amHost;$('waitHost').hidden=amHost;
  $('mpStart').disabled=humans().length<1;
}
function mpCycleColor(){MP.color=(MP.color+1)%PCOL.length;$('colorBtn').style.background=PCOL[MP.color];if(MP.net)MP.net.presence({c:MP.color})}

/* host: rounds and phases */
function hostStartRound(){
  const pl=humans().map(p=>p.id);if(!pl.length)return;
  const r=(MP.g?MP.g.r:0)+1,map=MP.mapSel==='auto'?(r-1)%2:+MP.mapSel;
  MP.g={r,cl:Math.floor(Math.random()*1e6),ph:'intro',k:1,map,fx:Math.random()<0.5?1:0,fz:Math.random()<0.5?1:0,sk:pl[(r-1)%pl.length],pl,bots:MP.botCount,dark:0,rem:15000,dur:150,res:null};
  MP.hostEnd=performance.now()+15000;
}
function hostTick(dt){
  const G=MP.g;if(!G||G.ph==='lobby')return;
  const left=MP.hostEnd-performance.now(),at=ms=>{MP.hostEnd=performance.now()+ms;return ms};
  if(G.ph==='intro'&&left<=0){G.ph='play';G.k++;G.rem=at(G.dur*1000)}
  else if(G.ph==='play'){
    const sk=presOf(G.sk),cg=new Set(G.sk===MP.me?[...MP.cg]:(sk&&sk.cg)||[]);
    const ids=G.pl.filter(i=>i!==G.sk).concat(Array.from({length:G.bots},(_,i)=>'b'+i));
    const alive=G.pl.filter(id=>peersNow().some(p=>p.id===id));
    if(!alive.includes(G.sk)){G.ph='end';G.k++;G.res='left';G.rem=at(6000)}
    else if(ids.length&&ids.every(i=>cg.has(i)||(!i.startsWith('b')&&!alive.includes(i)))){G.ph='end';G.k++;G.res='seek';G.rem=at(6000)}
    else if(left<=0){G.ph='end';G.k++;G.res='hide';G.rem=at(6000)}
  }else if(G.ph==='end'&&left<=0)hostStartRound();
}

/* everyone: follow the host's game state */
function mpTick(dt){
  const hid=hostId();MP.host=hid===MP.me&&!!MP.me;
  if(!MP.me){const mine=peersNow().find(p=>p.isMe);if(mine)MP.me=mine.id}
  {const myp=presOf(MP.me);if(myp){if(MP.host&&!myp.h&&performance.now()-MP.joinedAt>1500)MP.net.presence({h:Date.now()});else if(!MP.host&&myp.h&&humans().some(p=>p.id!==MP.me&&p.presence.h&&+p.presence.h<+myp.h))MP.net.presence({h:null})}}
  if(MP.host){
    if(!MP.g&&MP.lastG){MP.g=JSON.parse(JSON.stringify(MP.lastG));MP.g.k++;MP.g.rem=Math.max(1000,timer*1000);MP.hostEnd=performance.now()+MP.g.rem}
    hostTick(dt)}
  const G=MP.host?MP.g:(presOf(hid)||{}).g;
  if(!MP.host&&G)MP.lastG=G;
  if(phase==='lobby'&&Math.floor(T*4)!==MP.lr){MP.lr=Math.floor(T*4);mpLobbyRender()}
  if(!G||G.ph==='lobby'){return}
  if(G.r!==MP.round){mpSetupRound(G);MP.round=G.r}
  const key=G.r+':'+G.k;
  if(key!==MP.phKey){MP.phKey=key;MP.phEnd=performance.now()+G.rem;mpPhase(G)}
  timer=Math.max(0,(MP.phEnd-performance.now())/1000);
  if(G.ph==='play'&&timer<=10&&Math.ceil(timer)!==lastTick){lastTick=Math.ceil(timer);SFX.tick()}
  if(G.ph==='intro'){const n=Math.ceil(timer);if(n!==MP.lastN&&n<=3&&n>0){MP.lastN=n;say(String(n),'num');SFX.beep()}if(mode==='seek')$('blindN').textContent=Math.max(1,n)}
}
function mpSetupRound(G){
  buildWorld(G.map,!!G.fx,!!G.fz,G.cl||1);clearChars();
  MP.spectator=!G.pl.includes(MP.me);mode=G.sk===MP.me?'seek':'hide';
  MP.cg=new Set();MP.shots={};
  const sx=TX(world.def.spawn[0]),sz=TZ(world.def.spawn[1]);
  G.pl.forEach((id,i)=>{const p=presOf(id)||{},isSk=id===G.sk,a=i/Math.max(1,G.pl.length)*6.283;
    const [x,z]=isSk?[sx,sz]:snap(sx+Math.cos(a)*1.4,sz+Math.sin(a)*0.7);
    const c=newChar(isSk?'seeker':'hider',id===MP.me,isSk?'#FF5A5F':PCOL[(p.c|0)%PCOL.length],x,z);c.id=id;c.nick=String(p.n||'').slice(0,14);
    if(id!==MP.me)c.remote=true;
    if(isSk){c.range=4.8;c.fov=0.62;c.speed=3.4;c.state='count';c.cover=1;seeker=c}else c.speed=3.4;
    if(id===MP.me)player=c});
  for(let i=0;i<G.bots;i++){const a=(i+0.5)/Math.max(1,G.bots)*6.283;const c=newChar('hider',false,COLORS[i%COLORS.length],...snap(sx+Math.cos(a)*1.2,sz+Math.sin(a)*0.5));c.id='b'+i;c.nick='';
    if(!MP.host)c.netBot=true}
  if(MP.spectator)player=seeker;
  if(MP.host)planProps(chars.filter(c=>c.id&&c.id[0]==='b'));
  if(!MP.spectator&&player.role==='hider'){randomProp(player,-1);player.rerolls=1}
  MP.q={};
  for(const c of chars){c.yaw=c.look=Math.PI}
  stats={caught:0,freed:0,total:chars.filter(c=>c.role==='hider').length,time:G.dur,miss:0};squeakAt=0;
  coneStyle();camBlend=0;setAct();$('crouch').hidden=MP.spectator;
  $('mp').hidden=true;$('ov').hidden=true;$('timer').hidden=false;
  $('modeChip').textContent=MP.spectator?'Глядач':mode==='hide'?'Ти предмет':'Ти шукач';$('modeChip').className='chip mode '+(MP.spectator?'':mode);
  $('lvl').textContent='Кімната '+MP.code.toUpperCase()+' · раунд '+G.r;renderDots();
}
let lightsOffRound=false;
function mpPhase(G){
  if(G.ph==='intro'){phase='intro';MP.lastN=0;blind(mode==='seek'&&!MP.spectator);say(MP.spectator?'Раунд почався':mode==='seek'?'Заплющ очі…':'Ховайся!','big');SFX.beep();
    tip(MP.spectator?'Ти глядач. Приєднаєшся в наступному раунді':mode==='seek'?'Усі перевтілюються. Потім шукай зайві речі й бризкай по них':'Ти випадковий предмет. Знайди йому природне місце, поки '+(seeker.nick||'шукач')+' не дивиться')}
  if(G.ph==='play'){phase='play';seeker.state='idle';seeker.cover=0;blind(false);say(mode==='seek'?'Шукай!':'Шукає!','big go');SFX.go()}
  if(G.ph==='end'){phase='end';joy=null;blind(false);$('crouch').hidden=true;
    const seekWon=G.res==='seek',iWon=MP.spectator?null:(mode==='seek')===seekWon;
    if(G.res==='left'){$('ovTitle').textContent='Шукач вийшов';$('ovText').textContent='Раунд скасовано. Наступний почнеться за кілька секунд.'}
    else{$('ovTitle').textContent=seekWon?(seeker.nick||'Шукач')+' облив усіх!':'Предмети перемогли!';
      const free=chars.filter(c=>c.role==='hider'&&!c.caught).map(c=>c.nick).filter(Boolean);
      $('ovText').textContent=seekWon?'Нікого не впізнали. Наступний раунд за кілька секунд, шукач зміниться.':'Не впізнали: '+(free.join(', ')||'боти')+'. Наступний раунд за кілька секунд.'}
    if(iWon){SFX.win();(mode==='hide'?player:seeker).cheer=1;if(player.prop)setDisguise(player,-1);for(let i=0;i<90;i++)confetti.push({x:W/2+(Math.random()-.5)*W*0.8,y:H*0.3,vx:(Math.random()-.5)*420,vy:-150-Math.random()*380,l:2.6,c:COLORS[i%COLORS.length],r:Math.random()*6})}else if(iWon===false)SFX.lose();
    $('ovTitle').classList.toggle('lose',iWon===false);$('stars').hidden=true;$('ovHint').hidden=true;document.querySelector('.card .hint').hidden=true;
    $('ovBtn').hidden=!MP.host;$('ovBtn').textContent='Наступний раунд';$('ovLeave').hidden=false;$('ov').hidden=false}
}
/* positions in, positions out; caught list owned by the hunter, who is the one shooting */
function mpFollow(dt){
  const G=MP.host?MP.g:(presOf(hostId())||{}).g;if(!G||G.ph==='lobby'||G.r!==MP.round)return;
  const hp=MP.host?null:presOf(hostId());
  for(const c of chars){
    let s=null,p=null;
    if(c.remote){p=presOf(c.id);if(p&&typeof p.x==='number')s=[p.x,p.z,p.y,0,p.d]}
    else if(c.netBot&&hp&&Array.isArray(hp.b))s=hp.b[+c.id.slice(1)];
    if(!s)continue;
    const ox=c.x,oz=c.z,k=Math.min(1,dt*14);c.x+=(s[0]-c.x)*k;c.z+=(s[1]-c.z)*k;
    c.vx=c.vx*0.7+((c.x-ox)/Math.max(dt,1e-3))*0.3;c.vz=c.vz*0.7+((c.z-oz)/Math.max(dt,1e-3))*0.3;
    c.yaw+=angDiff(s[2]||0,c.yaw)*Math.min(1,dt*12);if(c.role==='seeker')c.look=c.yaw;
    const d=typeof s[4]==='number'?s[4]:-1;if(!c.caught&&d!==c.dis)setDisguise(c,d,true);
    // someone else's squirt
    if(c.role==='hider'&&p&&typeof p.q==='number'){if(MP.q[c.id]===undefined)MP.q[c.id]=p.q;else if(p.q>MP.q[c.id]){MP.q[c.id]=p.q;squeakFx(c,true)}}
    if(c.role==='seeker'&&p&&typeof p.sh==='number'){if(MP.shots[c.id]===undefined)MP.shots[c.id]=p.sh;else if(p.sh>MP.shots[c.id]){MP.shots[c.id]=p.sh;squirtFx(c.x,c.z,c.look,Math.min(4.8,rayHit(c.x,c.z,c.look,4.8)))}}
  }
  const iSeek=seeker&&seeker.id===MP.me;
  const cg=iSeek?MP.cg:new Set((presOf(seeker&&seeker.id)||{}).cg||[]);
  for(const c of chars){if(c.role!=='hider')continue;const want=cg.has(c.id);
    if(want&&!c.caught)mpCatchFx(c);else if(!want&&c.caught)free(c)}
  const me=player&&!MP.spectator?player:null,out={};
  if(me){out.x=+me.x.toFixed(2);out.z=+me.z.toFixed(2);out.y=+(me.role==='seeker'?me.look:me.yaw).toFixed(2);out.d=me.dis;out.q=me.taunts||0;
    if(iSeek){out.cg=[...MP.cg];out.sh=me.shots||0}}
  if(MP.host){out.g=MP.g;out.b=chars.filter(c=>c.id&&c.id[0]==='b').sort((a,b)=>+a.id.slice(1)-+b.id.slice(1)).map(c=>[+c.x.toFixed(2),+c.z.toFixed(2),+c.yaw.toFixed(2),0,c.dis])}
  MP.net.presence(out);
}
function mpCatchFx(h){catchHider(h)}
/* ---------- boot ---------- */
buildWorld(0,false,false);
player=seeker=newChar('seeker',false,'#FF5A5F',TX(11),TZ(8.6));seeker.range=5;seeker.fov=1.25;seeker.state='idle';seeker.cover=0;seeker.look=seeker.yaw=Math.PI*0.9;
{const its=propItems().filter(i=>Math.hypot(i.x-11,i.z-8.6)<7).slice(0,3);its.forEach((it,i)=>{const c=newChar('hider',false,COLORS[i],...snap(it.x+0.8,it.z+0.3));setDisguise(c,it.idx,true)})}
setAct();
camPos.set(11,12,17);camLook.set(11,0,8.5);
$('lvl').textContent='Рівень '+level;$('modeChip').textContent=level%2?'Ти предмет':'Ти шукач';$('modeChip').className='chip mode '+(level%2?'hide':'seek');$('timer').hidden=true;
if(level>1)$('ovText').textContent='Продовжуємо з рівня '+level+'. Цього разу: '+(level%2?'ти предмет.':'ти шукач з водяним пістолетом.');
let last=performance.now();
function frame(now){const dt=Math.min(0.1,(now-last)/1000);last=now;
  if(phase==='lobby'){T+=dt;mpTick(dt)}
  if(phase==='menu'||(phase==='lobby'&&seeker&&!MP.g)){if(phase==='menu')T+=dt;seeker.look=seeker.yaw=Math.PI+Math.sin(T*0.8)*0.9;updateCone(seeker);cone.visible=true;for(const c of chars)animate(c,dt);
    const a=W/H,far=a<0.8?1.3:1;camera.position.set(TX(11)+Math.sin(T*0.15)*1.5,9.5*far,TZ(8.6)+7.5*far);camera.lookAt(TX(11),0,TZ(8.6)-0.6)}
  else if(phase!=='lobby')update(dt);
  music(dt);
  renderer.render(scene,camera);drawFx(dt);requestAnimationFrame(frame)}
requestAnimationFrame(frame);
window.HNS={shoot:()=>shoot(player),disguise:()=>disguiseNear(player),get seeker(){return seeker},propItems,MP,get map(){return mapIdx},crouch:v=>setCrouch(v),info:()=>renderer.info.render,sim:(sec)=>{for(let t=0;t<sec;t+=1/30)update(1/30)},get chars(){return chars},get phase(){return phase},get mode(){return mode},get timer(){return timer},set timer(v){timer=v},startLevel,get level(){return level},set level(v){level=v},astar,sees,catchHider};
})();
