/* Монстр — кооператив 1–6 гравців проти монстра (бот або гравець) на картах Хованок (../khovanky/world.js).
   Знайди запобіжники → віднеси по одному в щиток (далеко від виходу) → відчиняються двері → тікай.
   Темрява, ліхтарики з зарядом (можна засліпити монстра), шафи, падіння й підйом.
   Авторитет: соло — сам телефон; мережа — хост (стан раунду G, бот-монстр, хто впав, засліплення).
   Кожен веде свою позицію; дії інших — події з номером (REQ.ev), хост застосовує кожну раз. */
(function(){
const T3=THREE,HW=HNSWorld,$=id=>document.getElementById(id);
/* Мультитач: кнопки — на pointerdown будь-яким пальцем (click браузер шле лише для «першого» пальця). */
function onTap(el,fn){let t=0;el.addEventListener('pointerdown',e=>{if(e.button>0)return;e.preventDefault();t=performance.now();fn(e)});el.addEventListener('click',e=>{if(performance.now()-t<700)return;fn(e)})}
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile=Math.min(innerWidth,innerHeight)<700;
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function rng(s){return()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

/* ---------- renderer ---------- */
const renderer=new T3.WebGLRenderer({canvas:$('gl'),antialias:true});
renderer.setPixelRatio(Math.min(mobile?1.6:2,devicePixelRatio||1));
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T3.PCFSoftShadowMap;
const scene=new T3.Scene();scene.background=new T3.Color('#040308');
const camera=new T3.PerspectiveCamera(46,1,0.5,120);
const fx=$('fx'),fctx=fx.getContext('2d');let W,H;
// огляд 60° по довшій стороні екрана — у портреті й ландшафті видно стільки ж карти
const VIEW_LONG=60*Math.PI/180;
function resize(){W=innerWidth;H=innerHeight;renderer.setSize(W,H,false);camera.aspect=W/H;
  camera.fov=(W>H?2*Math.atan(Math.tan(VIEW_LONG/2)*H/W):VIEW_LONG)*180/Math.PI;camera.updateProjectionMatrix();const d=Math.min(2,devicePixelRatio||1);fx.width=W*d;fx.height=H*d;fctx.setTransform(d,0,0,d,0,0)}
addEventListener('resize',resize);resize();

// майже темно: видно лише те, що світить ліхтар, і маленький ореол навколо себе
const DARK=0.035,DARK_MON=0.1;
const hemi=new T3.HemisphereLight(0x8090D0,0x241C2C,DARK);scene.add(hemi);
const moon=new T3.DirectionalLight(0x9AAAFF,0.02);moon.position.set(5,18,8);scene.add(moon);scene.add(moon.target);
const glow=new T3.PointLight(0xB8C8FF,0.6,2.4,1.6);scene.add(glow);
// ліхтарики: сталий пул, щоб шейдери не перекомпілювались; тінь — лише від мого
const MAXP=6,FL=[];
for(let i=0;i<MAXP;i++){const s=new T3.SpotLight(0xFFF1C8,0,9,0.6,0.5,1.1);if(i===0){s.castShadow=true;s.shadow.mapSize.set(mobile?512:1024,mobile?512:1024);s.shadow.bias=-0.002;s.shadow.camera.near=0.3}scene.add(s);scene.add(s.target);FL.push(s)}

const gm=new T3.DataTexture(new Uint8Array([90,170,255]),3,1,T3.LuminanceFormat);gm.minFilter=gm.magFilter=T3.NearestFilter;gm.needsUpdate=true;
const toon=(c,o={})=>new T3.MeshToonMaterial(Object.assign({color:c,gradientMap:gm},o));
const ground=new T3.Mesh(new T3.PlaneGeometry(160,160).rotateX(-Math.PI/2),toon('#1A1E1A'));ground.position.y=-0.11;ground.receiveShadow=true;scene.add(ground);

/* ---------- world ---------- */
let world=null,staticMesh=null,segs=[],lowSegs=[],nav=null,spots=[],waypoints=[],hides=[],exit=null,box=null,flipX=false,flipZ=false,curW=22,curH=17,mapIdx=0;
const TX=x=>flipX?curW-x:x,TZ=z=>flipZ?curH-z:z;
const HIDE_T={wardrobe:'в шафу',tallcab:'в шафу',bed:'під ліжко',bunk:'під ліжко',tent:'в намет'};
function buildWorld(mi,fxp,fzp){
  flipX=fxp;flipZ=fzp;mapIdx=mi;
  if(staticMesh){scene.remove(staticMesh);staticMesh.geometry.dispose()}
  world=HW.build(scene,{map:mi,flipX,flipZ});curW=world.W;curH=world.H;
  ground.position.set(curW/2,-0.11,curH/2);
  moon.position.set(curW/2-6,18,curH/2+8);moon.target.position.set(curW/2,0,curH/2);
  staticMesh=world.mesh.mesh(new T3.MeshToonMaterial({vertexColors:true,gradientMap:gm}));staticMesh.castShadow=staticMesh.receiveShadow=true;scene.add(staticMesh);
  const wallBoxes=world.boxes.filter(b=>!world.blockers.some(f=>f.b===b));
  segs=HW.segmentsOf(wallBoxes.concat(world.tallBoxes));lowSegs=HW.segmentsOf(world.lowBoxes);
  nav=HW.walkGrid(world.boxes,0.3);
  const sp=[TX(world.def.spawn[0]),TZ(world.def.spawn[1])];
  // місця для речей: вільні клітинки біля меблів і стін
  spots=[];
  for(let j=0;j<nav.nz;j++)for(let i=0;i<nav.nx;i++){if(!nav.free[j*nav.nx+i])continue;
    const x=(i+0.5)*HW.CS,z=(j+0.5)*HW.CS,room=world.grid[Math.floor(z)][Math.floor(x)];if(room==='#'||dist([x,z],sp)<3.5)continue;
    let blocked=0;for(let dj=-2;dj<=2;dj++)for(let di=-2;di<=2;di++){const ii=i+di,jj=j+dj;if(ii<0||jj<0||ii>=nav.nx||jj>=nav.nz||!nav.free[jj*nav.nx+ii])blocked++}
    if(blocked>=6)spots.push({x,z,room})}
  waypoints=world.def.waypoints.map(([x,z])=>snap(TX(x),TZ(z)));
  // схованки: шафи, ліжка, намети, до яких можна підійти
  hides=[];
  for(const f of world.blockers){const how=HIDE_T[f.t];if(!how)continue;const b=f.b,cx=(b[0]+b[2])/2,cz=(b[1]+b[3])/2;
    let best=null,bd=9;for(let j=0;j<nav.nz;j++)for(let i=0;i<nav.nx;i++){if(!nav.free[j*nav.nx+i])continue;const x=(i+0.5)*HW.CS,z=(j+0.5)*HW.CS,d=boxDist(b,x,z);if(d<bd){bd=d;best=[x,z]}}
    if(best&&bd<0.75)hides.push({b,x:cx,z:cz,ex:best[0],ez:best[1],how,t:f.t})}
  findExit(sp);findBox(sp);
}
function boxDist(b,x,z){const cx=Math.max(b[0],Math.min(x,b[2])),cz=Math.max(b[1],Math.min(z,b[3]));return Math.hypot(x-cx,z-cz)}

/* ---------- navigation (як у Хованках) ---------- */
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
  const out=[];let ax=x0,az=z0;
  for(let k=0;k<raw.length;k++){const nxt=raw[k+1];if(nxt&&lineFree(ax,az,nxt[0],nxt[1]))continue;out.push(raw[k]);[ax,az]=raw[k]}
  return out;
}
function pathLen(x0,z0,x1,z1){const p=astar(x0,z0,x1,z1);if(!p)return 0;let l=0,a=[x0,z0];for(const q of p){l+=dist(a,q);a=q}return l}

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

/* промінь ліхтарика на підлозі: віяло променів, обрізане стінами й шафами */
const NR=34,BEAM=6.5,BEAM_FOV=1.0;
const beamMat=new T3.ShaderMaterial({uniforms:{color:{value:new T3.Color('#FFE9A8')},opacity:{value:0.22}},transparent:true,depthWrite:false,side:T3.DoubleSide,blending:T3.AdditiveBlending,
  vertexShader:'attribute float alpha;varying float vA;void main(){vA=alpha;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader:'uniform vec3 color;uniform float opacity;varying float vA;void main(){gl_FragColor=vec4(color,vA*opacity);}'});
function makeBeam(){const g=new T3.BufferGeometry();g.setAttribute('position',new T3.BufferAttribute(new Float32Array((NR+2)*3),3));g.setAttribute('alpha',new T3.BufferAttribute(new Float32Array(NR+2),1));
  const idx=[];for(let i=0;i<NR;i++)idx.push(0,i+2,i+1);g.setIndex(idx);const m=new T3.Mesh(g,beamMat);m.frustumCulled=false;m.renderOrder=2;m.visible=false;scene.add(m);return m}
function updBeam(m,c,range){const g=m.geometry,p=g.attributes.position.array,a=g.attributes.alpha.array,ex=c.x+Math.sin(c.yaw)*0.2,ez=c.z+Math.cos(c.yaw)*0.2;
  p[0]=ex;p[1]=0.04;p[2]=ez;a[0]=1;
  for(let i=0;i<=NR;i++){const ang=c.yaw-BEAM_FOV/2+BEAM_FOV*i/NR,r=rayHit(ex,ez,ang,range);p[(i+1)*3]=ex+Math.sin(ang)*r;p[(i+1)*3+1]=0.04;p[(i+1)*3+2]=ez+Math.cos(ang)*r;a[i+1]=0.1+0.6*(1-r/range)}
  g.attributes.position.needsUpdate=true;g.attributes.alpha.needsUpdate=true}
/* чи світить c ліхтарем на точку (x,z) */
function inBeam(c,x,z,range=BEAM){if(!c.lightOn||c.down||c.escaped||c.hidden>=0)return false;const dx=x-c.x,dz=z-c.z,d=Math.hypot(dx,dz);if(d>range)return false;if(d<0.05)return true;
  if(Math.abs(angDiff(Math.atan2(dx,dz),c.yaw))>BEAM_FOV/2+0.08)return false;return los(c.x,c.z,x,z)}

/* ---------- персонажі ---------- */
const BEAN=new T3.LatheGeometry([[0,0],[0.17,0.012],[0.25,0.06],[0.285,0.17],[0.29,0.36],[0.285,0.55],[0.26,0.7],[0.21,0.82],[0.13,0.9],[0,0.93]].map(([x,y])=>new T3.Vector2(x,y)),22);
const SPH=new T3.SphereGeometry(1,16,12),CYL=new T3.CylinderGeometry(1,1,1,10),CONE=new T3.ConeGeometry(1,1,8);
const PCOL=['#4C8DFF','#4CC97A','#FFC93C','#A779F2','#FF9A3D','#FF7BB0','#3CC8C8','#8BD14B','#F2F2F2','#B5835A'];
function makeBean(color,me){
  const root=new T3.Group(),body=new T3.Group();root.add(body);const mats=[];
  const m=(c,o)=>{const mm=toon(c,o);mats.push(mm);return mm};
  const bodyMat=m(color),dark=new T3.Color(color).multiplyScalar(0.55),white=m('#FFFFFF'),black=m('#1D1A26');
  const add=(geo,mat,x,y,z,sx,sy,sz,parent=body,shadow=true)=>{const me=new T3.Mesh(geo,mat);me.position.set(x,y,z);me.scale.set(sx,sy,sz);me.castShadow=shadow;parent.add(me);return me};
  add(BEAN,bodyMat,0,0,0,1,1,1);
  const eyes=new T3.Group();eyes.position.set(0,0.64,0.215);body.add(eyes);
  add(SPH,white,-0.095,0,0,0.075,0.085,0.05,eyes,false);add(SPH,white,0.095,0,0,0.075,0.085,0.05,eyes,false);
  const pL=add(SPH,black,-0.095,-0.005,0.04,0.04,0.048,0.025,eyes,false),pR=add(SPH,black,0.095,-0.005,0.04,0.04,0.048,0.025,eyes,false);
  const mouth=add(SPH,black,0,0.53,0.255,0.035,0.016,0.012,body,false);
  const footMat=m('#'+dark.getHexString());
  const fL=add(SPH,footMat,-0.11,0.045,0.02,0.085,0.055,0.12,root),fR=add(SPH,footMat,0.11,0.045,0.02,0.085,0.055,0.12,root);
  const hL=add(SPH,bodyMat,-0.31,0.36,0.02,0.065,0.065,0.065),hR=add(SPH,bodyMat,0.31,0.36,0.02,0.065,0.065,0.065);
  const torch=new T3.Group();hR.add(torch);torch.scale.setScalar(1/0.065);
  add(CYL,m('#3A3F4B'),0,0,0.08,0.035,0.16,0.035,torch).rotation.x=Math.PI/2;
  const lens=new T3.MeshBasicMaterial({color:'#FFF3B0'});const ln=new T3.Mesh(CYL,lens);ln.position.set(0,0,0.165);ln.scale.set(0.045,0.02,0.045);ln.rotation.x=Math.PI/2;torch.add(ln);
  let star=null;if(me){add(CYL,m('#3A3F4B'),0,0.98,0,0.012,0.14,0.012);star=add(SPH,m('#FFD23F',{emissive:'#FFB800',emissiveIntensity:0.6}),0,1.07,0,0.055,0.055,0.055)}
  // запобіжник у руках — над головою, щоб було видно, хто несе
  const carry=new T3.Group();carry.position.set(0,1.28,0);root.add(carry);
  const cf=new T3.Mesh(CYL,new T3.MeshBasicMaterial({color:'#FFC93C'}));cf.scale.set(0.07,0.22,0.07);cf.rotation.z=0.5;carry.add(cf);
  const cg=new T3.Sprite(new T3.SpriteMaterial({map:softTex('rgba(255,210,80,.9)'),transparent:true,depthWrite:false,blending:T3.AdditiveBlending}));cg.scale.set(0.7,0.7,1);carry.add(cg);carry.visible=false;
  return {root,body,eyes,pL,pR,fL,fR,hL,hR,mouth,mats,lens,star,carry};
}
function softTex(col){const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d'),r=g.createRadialGradient(32,32,0,32,32,32);r.addColorStop(0,col);r.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=r;g.fillRect(0,0,64,64);return new T3.CanvasTexture(c)}
/* монстр: високий, сутулий, довгі руки, світні очі */
const MON_BODY=new T3.LatheGeometry([[0,0],[0.2,0.02],[0.33,0.16],[0.37,0.46],[0.35,0.78],[0.3,1.0],[0.2,1.14],[0,1.2]].map(([x,y])=>new T3.Vector2(x,y)),18);
const eyeGlowTex=softTex('rgba(255,60,40,1)');
function makeMonster(){
  const root=new T3.Group(),body=new T3.Group();root.add(body);const mats=[];
  const m=(c,o)=>{const mm=toon(c,o);mats.push(mm);return mm};
  const skin=m('#2A2134'),dark=m('#17111D'),bone=m('#E6DFCF');
  const add=(geo,mat,x,y,z,sx,sy,sz,parent=body,shadow=true)=>{const me=new T3.Mesh(geo,mat);me.position.set(x,y,z);me.scale.set(sx,sy,sz);me.castShadow=shadow;parent.add(me);return me};
  add(MON_BODY,skin,0,0,0,1,1,1);
  add(SPH,dark,0,0.62,0.2,0.22,0.3,0.14);
  const head=new T3.Group();head.position.set(0,1.12,0.12);body.add(head);
  add(SPH,skin,0,0,0,0.27,0.22,0.27,head);
  for(const s of[-1,1])add(CONE,dark,s*0.17,0.2,-0.05,0.05,0.22,0.05,head).rotation.z=-s*0.5;
  const mouth=add(SPH,m('#0A0710'),0,-0.08,0.22,0.15,0.06,0.05,head,false);
  for(let i=-2;i<=2;i++)add(CONE,bone,i*0.05,-0.05,0.25,0.018,0.06,0.018,head,false).rotation.x=Math.PI;
  const eyeMats=[];
  for(const s of[-1,1]){const em=new T3.MeshBasicMaterial({color:'#FF4A36',transparent:true});eyeMats.push(em);const e=new T3.Mesh(SPH,em);e.position.set(s*0.1,0.03,0.22);e.scale.set(0.05,0.035,0.03);head.add(e);
    const gm2=new T3.SpriteMaterial({map:eyeGlowTex,transparent:true,depthWrite:false,blending:T3.AdditiveBlending});eyeMats.push(gm2);const sp=new T3.Sprite(gm2);sp.scale.set(0.38,0.38,1);sp.position.set(s*0.1,0.03,0.26);head.add(sp)}
  const arms=[];
  for(const s of[-1,1]){const sh=new T3.Group();sh.position.set(s*0.34,0.98,0.02);body.add(sh);
    add(CYL,skin,0,-0.38,0,0.06,0.78,0.06,sh);const hand=new T3.Group();hand.position.set(0,-0.8,0.02);sh.add(hand);add(SPH,dark,0,0,0,0.09,0.08,0.09,hand);
    for(let k=-1;k<=1;k++)add(CONE,bone,k*0.04,-0.1,0.03,0.018,0.12,0.018,hand).rotation.x=Math.PI;
    arms.push(sh)}
  const legs=[];for(const s of[-1,1])legs.push(add(SPH,dark,s*0.15,0.05,0.04,0.11,0.07,0.16,root));
  root.scale.setScalar(1.25);
  return {root,body,head,mouth,mats,eyeMats,arms,legs};
}
const downRingGeo=new T3.RingGeometry(0.42,0.5,32).rotateX(-Math.PI/2);

/* ---------- ефекти: дим/іскри, хвилі звуку ---------- */
const puffGeo=new T3.IcosahedronGeometry(1,0),puffs=[];
for(let i=0;i<40;i++){const p=new T3.Mesh(puffGeo,new T3.MeshBasicMaterial({color:'#FFFFFF',transparent:true,opacity:0,depthWrite:false}));p.visible=false;scene.add(p);puffs.push({m:p,l:0})}
let puffI=0;
function puffRing(x,z,n=14,col='#FFFFFF'){for(let i=0;i<n;i++){const a=i/n*6.283,p=puffs[puffI++%puffs.length];p.m.visible=true;p.m.position.set(x+Math.cos(a)*0.35,0.12,z+Math.sin(a)*0.35);p.s=0.12;p.vy=0.6;p.vx=Math.cos(a)*1.6;p.vz=Math.sin(a)*1.6;p.l=1;p.m.material.color.set(col)}}
function updPuffs(dt){for(const p of puffs){if(p.l<=0)continue;p.l-=dt*1.8;const k=Math.max(0,p.l);p.m.position.x+=p.vx*dt;p.m.position.z+=p.vz*dt;p.m.position.y+=p.vy*dt;p.m.scale.setScalar(p.s*(1.6-k*0.6));p.m.material.opacity=k*0.8;if(p.l<=0)p.m.visible=false}}
const ripGeo=new T3.RingGeometry(0.7,1,32).rotateX(-Math.PI/2),rips=[];
for(let i=0;i<40;i++){const m=new T3.Mesh(ripGeo,new T3.MeshBasicMaterial({color:'#FFFFFF',transparent:true,opacity:0,depthWrite:false,blending:T3.AdditiveBlending}));m.visible=false;m.renderOrder=3;scene.add(m);rips.push({m,l:0})}
let ripI=0;
function ripple(x,z,col,size=1){const r=rips[ripI++%rips.length];r.m.visible=true;r.m.position.set(x,0.05,z);r.m.material.color.set(col);r.l=1;r.s=size}
function updRipples(dt){for(const r of rips){if(r.l<=0)continue;r.l-=dt*1.4;const k=Math.max(0,r.l);r.m.scale.setScalar((0.3+(1-k)*1.0)*r.s);r.m.material.opacity=Math.min(1,k*1.2);if(r.l<=0)r.m.visible=false}}

/* ---------- звук ----------
   Динамік телефона майже не грає нижче ~250 Гц, тому все важливе — у середніх частотах (шум, «клацання»),
   а низ лише додає ваги в навушниках. */
let AC=null,muted=false,noiseBuf=null;try{muted=localStorage.getItem('mon_mute')==='1'}catch(e){}
function au(){if(!AC){try{AC=new (window.AudioContext||window.webkitAudioContext)()}catch(e){}}if(AC&&AC.state==='suspended')AC.resume();return AC}
function out(a,pan){if(pan&&a.createStereoPanner){const p=a.createStereoPanner();p.pan.value=Math.max(-1,Math.min(1,pan));p.connect(a.destination);return p}return a.destination}
function tone(f,d,{type='sine',vol=0.12,slide=0,delay=0,pan=0}={}){if(muted||vol<0.002)return;const a=au();if(!a)return;const t=a.currentTime+delay,o=a.createOscillator(),g=a.createGain();o.type=type;o.frequency.setValueAtTime(f,t);if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(30,f*slide),t+d);
  g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(vol,t+0.012);g.gain.exponentialRampToValueAtTime(0.0001,t+d);o.connect(g).connect(out(a,pan));o.start(t);o.stop(t+d+0.02)}
function noise(d,{vol=0.1,f=800,q=0.8,delay=0,pan=0,kind='bandpass',slide=0}={}){if(muted||vol<0.002)return;const a=au();if(!a)return;
  if(!noiseBuf){noiseBuf=a.createBuffer(1,a.sampleRate,a.sampleRate);const ch=noiseBuf.getChannelData(0);for(let i=0;i<ch.length;i++)ch[i]=Math.random()*2-1}
  const t=a.currentTime+delay,s=a.createBufferSource(),bf=a.createBiquadFilter(),g=a.createGain();s.buffer=noiseBuf;bf.type=kind;bf.frequency.setValueAtTime(f,t);if(slide)bf.frequency.exponentialRampToValueAtTime(Math.max(60,f*slide),t+d);bf.Q.value=q;
  g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(vol,t+0.01);g.gain.exponentialRampToValueAtTime(0.0001,t+d);s.connect(bf).connect(g).connect(out(a,pan));s.start(t,Math.random()*0.5);s.stop(t+d+0.05)}
const SFX={
  step:()=>noise(0.05,{vol:0.05,f:1600,q:1}),
  // важкий крок монстра: глухий удар + «скрип» підлоги (чутно з динаміка)
  thud:(v,pan)=>{noise(0.12,{vol:v,f:520,q:1.4,pan});tone(190,0.12,{type:'triangle',vol:v*0.7,slide:0.6,pan});tone(70,0.16,{vol:v*0.6,pan});if(Math.random()<0.3)tone(820+Math.random()*300,0.18,{type:'sawtooth',vol:v*0.12,slide:0.85,delay:0.05,pan})},
  // серце: «тук-тук» з клацанням зверху, щоб було чути на телефоні
  heart:(v)=>{for(const [d,k] of[[0,1],[0.2,0.75]]){tone(150,0.1,{type:'triangle',vol:v*k,slide:0.6,delay:d});noise(0.05,{vol:v*k*0.7,f:900,q:1.2,delay:d});tone(60,0.12,{vol:v*k*0.6,delay:d})}},
  growl:(pan,v=0.16)=>{tone(170,0.8,{type:'sawtooth',vol:v*0.35,slide:0.6,pan});tone(255,0.7,{type:'sawtooth',vol:v*0.2,slide:0.55,pan});noise(0.85,{vol:v,f:700,q:3,slide:0.55,pan})},
  scream:()=>{tone(520,0.6,{type:'sawtooth',vol:0.09,slide:1.8});noise(0.6,{vol:0.2,f:1800,q:2,slide:0.4});tone(140,0.5,{type:'square',vol:0.06,slide:0.5})},
  sting:()=>{tone(1250,0.6,{type:'triangle',vol:0.05,slide:0.96});tone(1330,0.6,{type:'triangle',vol:0.05,slide:1.04});noise(0.5,{vol:0.05,f:3000,q:4})},
  fuse:()=>[523,659,784].forEach((f,i)=>tone(f,0.16,{type:'triangle',vol:0.09,delay:i*0.07})),
  insert:()=>{tone(180,0.25,{type:'square',vol:0.08,slide:3});[784,1047,1319].forEach((f,i)=>tone(f,0.2,{type:'triangle',vol:0.1,delay:0.2+i*0.08}))},
  bat:()=>{tone(700,0.08,{type:'square',vol:0.05});tone(1100,0.14,{type:'square',vol:0.05,delay:0.07})},
  click:()=>{tone(1800,0.02,{type:'square',vol:0.05});noise(0.03,{vol:0.05,f:3000,kind:'highpass'})},
  buzz:()=>{tone(120,0.12,{type:'sawtooth',vol:0.05});tone(240,0.12,{type:'square',vol:0.03})},
  door:()=>{tone(260,0.9,{type:'sawtooth',vol:0.05,slide:1.5});[392,523,659,784].forEach((f,i)=>tone(f,0.3,{type:'triangle',vol:0.09,delay:0.35+i*0.1}))},
  hide:()=>noise(0.25,{vol:0.1,f:900,slide:0.5}),
  blind:()=>{noise(0.5,{vol:0.18,f:2400,q:0.7,slide:0.5});tone(900,0.6,{type:'sawtooth',vol:0.07,slide:0.4});tone(330,0.7,{type:'sawtooth',vol:0.08,slide:0.5,delay:0.1})},
  dash:()=>{noise(0.35,{vol:0.12,f:500,slide:3});tone(200,0.3,{type:'sawtooth',vol:0.06,slide:2})},
  up:()=>[392,523,659].forEach((f,i)=>tone(f,0.16,{type:'triangle',vol:0.09,delay:i*0.08})),
  win:()=>[523,659,784,1047].forEach((f,i)=>tone(f,0.24,{type:'triangle',vol:0.12,delay:i*0.11})),
  lose:()=>[330,277,220,165].forEach((f,i)=>tone(f,0.34,{type:'sawtooth',vol:0.06,delay:i*0.16})),
  beep:()=>tone(660,0.12,{type:'sine',vol:0.08}),
};
// гул на тлі: розстроєні тони в середніх частотах, тихо
let drone=null;
function droneSet(v){const a=AC;if(!a)return;if(!drone&&v>0&&!muted){const g=a.createGain();g.gain.value=0;const lp=a.createBiquadFilter();lp.type='lowpass';lp.frequency.value=700;
    const o1=a.createOscillator(),o2=a.createOscillator();o1.type=o2.type='sawtooth';o1.frequency.value=110;o2.frequency.value=116.5;o1.connect(lp);o2.connect(lp);lp.connect(g).connect(a.destination);o1.start();o2.start();drone={g}}
  if(drone){drone.g.gain.setTargetAtTime(muted?0:v,a.currentTime,0.6)}}
$('mute').addEventListener('click',()=>{muted=!muted;$('mute').textContent=muted?'🔇':'🔊';$('mute').setAttribute('aria-label',muted?'Увімкнути звук':'Вимкнути звук');try{localStorage.setItem('mon_mute',muted?'1':'0')}catch(e){}droneSet(0)});
$('mute').textContent=muted?'🔇':'🔊';

/* ---------- предмети: запобіжники й батарейки ---------- */
const fuseGlow=softTex('rgba(255,210,80,.9)'),batGlow=softTex('rgba(120,255,160,.85)'),exitGlow=softTex('rgba(80,255,150,.9)'),boxGlow=softTex('rgba(255,200,60,.8)');
let items=[],itemGroup=null;
function makeItem(kind){
  const g=new T3.Group(),mats=[];const m=(c,o)=>{const mm=new T3.MeshToonMaterial(Object.assign({color:c,gradientMap:gm,transparent:true},o));mats.push(mm);return mm};
  const inner=new T3.Group();g.add(inner);
  if(kind==='f'){const a=new T3.Mesh(CYL,m('#FFC93C',{emissive:'#FFB000',emissiveIntensity:0.8}));a.scale.set(0.09,0.3,0.09);inner.add(a);
    for(const y of[-0.17,0.17]){const c=new T3.Mesh(CYL,m('#C9CED6',{emissive:'#555',emissiveIntensity:0.5}));c.scale.set(0.1,0.06,0.1);c.position.y=y;inner.add(c)}}
  else{const a=new T3.Mesh(CYL,m('#3FE08F',{emissive:'#1FA060',emissiveIntensity:0.7}));a.scale.set(0.08,0.24,0.08);inner.add(a);
    const c=new T3.Mesh(CYL,m('#C9CED6'));c.scale.set(0.04,0.04,0.04);c.position.y=0.14;inner.add(c)}
  inner.rotation.z=0.5;
  const sm=new T3.SpriteMaterial({map:kind==='f'?fuseGlow:batGlow,transparent:true,depthWrite:false,blending:T3.AdditiveBlending});mats.push(sm);
  const sp=new T3.Sprite(sm);sp.scale.set(1.1,1.1,1);g.add(sp);
  return {g,inner,mats};
}
function placeItems(seed,nf,nb){
  if(itemGroup)scene.remove(itemGroup);itemGroup=new T3.Group();scene.add(itemGroup);items=[];
  const R=rng(seed),sp=[TX(world.def.spawn[0]),TZ(world.def.spawn[1])],ex=[exit.ix,exit.iz],bx=[box.x,box.z];
  const pool=spots.filter(s=>dist([s.x,s.z],sp)>4.5&&dist([s.x,s.z],ex)>3&&dist([s.x,s.z],bx)>3.5).map(s=>({s,r:R()})).sort((a,b)=>a.r-b.r).map(o=>o.s);
  const pick=[],rooms=new Set();
  const ok=(s,min)=>pick.every(p=>dist([p.x,p.z],[s.x,s.z])>min);
  for(const pass of[0,1,2,3])for(const s of pool){if(pick.length>=nf)break;if(pass===0&&rooms.has(s.room))continue;if(!ok(s,[5,4,3,1.5][pass]))continue;pick.push(s);rooms.add(s.room)}
  const nF=pick.length;
  for(const s of pool){if(pick.length>=nF+nb)break;if(ok(s,3))pick.push(s)}
  pick.forEach((s,i)=>{const kind=i<nF?'f':'b',id=kind+i,m=makeItem(kind);m.g.position.set(s.x,0.35,s.z);itemGroup.add(m.g);
    items.push({id,kind,x0:s.x,z0:s.z,x:s.x,z:s.z,mdl:m,vis:0,gone:false,ph:R()*6})});
}

/* ---------- вихід і щиток ---------- */
let exitGroup=null,exitPanel=null,exitFloor=null,boxGroup=null,boxLeds=[];
function findExit(sp){
  const g=world.grid,Hh=g.length,Ww=g[0].length,c=[];
  const fr=(x,z)=>g[z]&&g[z][x]&&g[z][x]!=='#';
  for(let x=1;x<Ww-2;x++){if(fr(x,1)&&fr(x+1,1))c.push({x:x+1,z:0.5,ix:x+1,iz:1.55,ry:0});if(fr(x,Hh-2)&&fr(x+1,Hh-2))c.push({x:x+1,z:Hh-0.5,ix:x+1,iz:Hh-1.55,ry:Math.PI})}
  for(let z=1;z<Hh-2;z++){if(fr(1,z)&&fr(1,z+1))c.push({x:0.5,z:z+1,ix:1.55,iz:z+1,ry:Math.PI/2});if(fr(Ww-2,z)&&fr(Ww-2,z+1))c.push({x:Ww-0.5,z:z+1,ix:Ww-1.55,iz:z+1,ry:-Math.PI/2})}
  const side=e=>e.ry%Math.PI?[0,0.45]:[0.45,0];
  const good=c.filter(e=>{const [ox,oz]=side(e);return nav.free[ci(e.ix,e.iz)]&&nav.free[ci(e.ix-ox,e.iz-oz)]&&nav.free[ci(e.ix+ox,e.iz+oz)]});
  const list=(good.length?good:c).map(e=>Object.assign(e,{d:dist([e.ix,e.iz],sp)})).sort((a,b)=>b.d-a.d).slice(0,6);
  for(const e of list)e.pl=pathLen(sp[0],sp[1],e.ix,e.iz);
  exit=list.sort((a,b)=>b.pl-a.pl)[0]||{x:1,z:0.5,ix:1,iz:1.5,ry:0};
  const [sx,sz]=snap(exit.ix,exit.iz);exit.ix=sx;exit.iz=sz;
  if(exitGroup)scene.remove(exitGroup);exitGroup=new T3.Group();exitGroup.position.set(exit.x,0,exit.z);exitGroup.rotation.y=exit.ry;scene.add(exitGroup);
  const frame=new T3.Mesh(new T3.BoxGeometry(2.1,1.12,1.06),toon('#3A2E3E'));frame.position.y=0.56;exitGroup.add(frame);
  exitPanel=new T3.Mesh(new T3.BoxGeometry(1.8,1.0,0.05),new T3.MeshBasicMaterial({color:'#7A1E22'}));exitPanel.position.set(0,0.52,0.54);exitGroup.add(exitPanel);
  const sc=document.createElement('canvas');sc.width=256;sc.height=96;const x2=sc.getContext('2d');x2.fillStyle='#0F3A22';x2.fillRect(0,0,256,96);x2.fillStyle='#5CFF9E';x2.font='800 58px "Baloo 2",sans-serif';x2.textAlign='center';x2.textBaseline='middle';x2.fillText('ВИХІД',128,52);
  const sign=new T3.Sprite(new T3.SpriteMaterial({map:new T3.CanvasTexture(sc),transparent:true}));sign.scale.set(1.1,0.42,1);sign.position.set(0,1.35,0.4);exitGroup.add(sign);
  exitFloor=new T3.Sprite(new T3.SpriteMaterial({map:exitGlow,transparent:true,depthWrite:false,blending:T3.AdditiveBlending,opacity:0}));exitFloor.scale.set(3,3,1);exitFloor.position.set(0,0.3,1.0);exitGroup.add(exitFloor);
}
/* щиток — найдалі від виходу по шляху, біля стіни */
function findBox(sp){
  const ex=[exit.ix,exit.iz];
  const cand=spots.filter(s=>dist([s.x,s.z],sp)>4).map(s=>({s,d:dist([s.x,s.z],ex)})).sort((a,b)=>b.d-a.d).slice(0,40).filter((o,i,a)=>a.findIndex(q=>q.s.room===o.s.room)===i).slice(0,6);
  for(const o of cand)o.pl=pathLen(ex[0],ex[1],o.s.x,o.s.z);
  const best=cand.sort((a,b)=>b.pl-a.pl)[0];box=best?{x:best.s.x,z:best.s.z,room:best.s.room}:{x:sp[0]+3,z:sp[1]};
  if(boxGroup)scene.remove(boxGroup);boxGroup=new T3.Group();boxGroup.position.set(box.x,0,box.z);scene.add(boxGroup);
  const body=new T3.Mesh(new T3.BoxGeometry(0.62,0.95,0.42),toon('#59606E'));body.position.y=0.48;boxGroup.add(body);
  const lid=new T3.Mesh(new T3.BoxGeometry(0.66,0.05,0.46),toon('#3B404B'));lid.position.y=0.97;boxGroup.add(lid);
  const bolt=new T3.Sprite(new T3.SpriteMaterial({map:boxGlow,transparent:true,depthWrite:false,blending:T3.AdditiveBlending,opacity:0.6}));bolt.scale.set(1.6,1.6,1);bolt.position.y=0.9;boxGroup.add(bolt);box.glow=bolt;
  const sc=document.createElement('canvas');sc.width=256;sc.height=96;const x2=sc.getContext('2d');x2.fillStyle='rgba(40,32,0,.85)';x2.fillRect(0,0,256,96);x2.fillStyle='#FFC93C';x2.font='800 54px "Baloo 2",sans-serif';x2.textAlign='center';x2.textBaseline='middle';x2.fillText('⚡ ЩИТОК',128,52);
  const sign=new T3.Sprite(new T3.SpriteMaterial({map:new T3.CanvasTexture(sc),transparent:true}));sign.scale.set(1.1,0.42,1);sign.position.y=1.45;boxGroup.add(sign);box.sign=sign;
  boxLeds=[];
}
function boxSlots(n){for(const l of boxLeds)boxGroup.remove(l);boxLeds=[];
  for(let i=0;i<n;i++){const l=new T3.Mesh(SPH,new T3.MeshBasicMaterial({color:'#5A1A1A'}));l.scale.set(0.045,0.03,0.045);l.position.set(-0.24+0.48*(n>1?i/(n-1):0.5),1.01,0);boxGroup.add(l);boxLeds.push(l)}}

/* ---------- стан ---------- */
let phase='menu',level=1,T=0,introT=0,playT=0,chars=[],player=null,mon=null,G=null,lastKey='',crouchOn=false,pops=[],confetti=[],shakeT=0,beams=[],spec=null,
  myGot=new Set(),pend=null,hold={on:false,id:null,p:0,ctx:''},downT=0,bleedSent=false,stats={},prev={op:0,bl:0,mk:0,ins:0},camBlend=0,blindT=0,slowT=0,dashT=0,dashCd=0,chkCd=0,
  auth={kCd:0,imm:0,bacc:{},last:{}};
try{level=Math.max(1,parseInt(localStorage.getItem('mon_level'))||1)}catch(e){}
const DOWN_MAX=45,SELF_T=5,REV_T=2.5,INS_T=2.5,BLIND_HOLD=0,BLIND_T=3,BLIND_IMM=12,BLIND_R=5;
const MON_SPD=3.25,PL_SPD=3.4;
const fuseN=(l,n)=>Math.min(7,Math.min(5,3+Math.floor((l-1)/2))+Math.max(0,(n||1)-2));
const isAuth=()=>!MP.on||MP.host;
const iAmMon=()=>!!(MP.on&&G&&G.mm&&G.mm===MP.me);

function newChar(id,isPlayer,color,x,z){
  const mdl=makeBean(color,isPlayer);mdl.root.scale.setScalar(1.18);scene.add(mdl.root);
  const ring=new T3.Mesh(downRingGeo,new T3.MeshBasicMaterial({color:'#E5484D',transparent:true,opacity:0,depthWrite:false}));ring.position.y=0.03;mdl.root.add(ring);
  const ch={id,isPlayer,color,x,z,vx:0,vz:0,yaw:Math.PI,crouch:0,lightOn:true,battery:100,hidden:-1,down:false,escaped:false,selfUsed:false,out:false,inserting:false,mdl,ring,ph:Math.random()*6,blinkT:2,stepT:0,ripT:0,vis:1,lie:0,escT:0,nick:''};
  chars.push(ch);return ch;
}
function clearChars(){for(const c of chars)scene.remove(c.mdl.root);chars=[];pops=[];for(const b of beams)b.visible=false}
function clearMon(){if(mon){scene.remove(mon.mdl.root);mon=null}}
function newMon(x,z){const mdl=makeMonster();scene.add(mdl.root);mon={x,z,vx:0,vz:0,yaw:0,look:0,state:'sleep',path:null,pi:0,target:null,lastSeen:null,lostT:0,repathT:0,hearCd:0,leaveT:0,lookT:0,visited:[],glare:0,mdl,vis:0,eyeVis:0,ph:0,stepT:0,pull:null,stCode:0,blindT:0};return mon}

/* раунд: однаково для соло і мережі (cfg = G) */
function setupRound(cfg){
  buildWorld(cfg.map,!!cfg.fx,!!cfg.fz);clearChars();clearMon();player=null;
  placeItems(cfg.seed,cfg.nf,cfg.nb);boxSlots(cfg.nf);myGot=new Set();pend=null;
  const sx=TX(world.def.spawn[0]),sz=TZ(world.def.spawn[1]),surv=cfg.pl.filter(id=>id!==cfg.mm);
  surv.forEach((id,i)=>{const a=i/Math.max(1,surv.length)*6.283,[x,z]=surv.length>1?snap(sx+Math.cos(a)*0.9,sz+Math.sin(a)*0.6):snap(sx,sz);
    const p=MP.on?presOf(id)||{}:{},c=newChar(id,id===myId(),MP.on?PCOL[(p.c|0)%PCOL.length]:'#4C8DFF',x,z);c.nick=MP.on?String(p.n||'').slice(0,14):'';if(MP.on&&id!==MP.me)c.remote=true;if(c.isPlayer)player=c});
  // монстр — у найдальшій від старту точці
  const far=waypoints.slice().sort((a,b)=>dist(b,[sx,sz])-dist(a,[sx,sz]))[0]||[sx+5,sz];newMon(far[0],far[1]);mon.yaw=mon.look=Math.atan2(sx-far[0],sz-far[1]);
  monParams(cfg.lvl,0);
  for(let i=0;i<MAXP;i++){if(!beams[i])beams[i]=makeBeam();beams[i].visible=false}
  spec=null;hold.p=0;hold.on=false;downT=0;bleedSent=false;prev={op:0,bl:cfg.bl|0,mk:cfg.mk|0,ins:0};camBlend=0;crouchOn=false;setCrouch(false);blindT=slowT=dashT=dashCd=chkCd=0;
  auth.kCd=0;auth.imm=0;auth.bacc={};
  stats={downs:0};playT=0;
  exitPanel.material.color.set('#7A1E22');exitFloor.material.opacity=0;
  for(const c of chars)c.yaw=Math.PI;
  $('ov').hidden=true;$('mp').hidden=true;
  $('lvl').textContent=iAmMon()?'Ти — монстр · '+world.def.name:(MP.on?'Кімната '+MP.code.toUpperCase()+' · ':'Рівень '+cfg.lvl+' · ')+world.def.name;
  hudKey='';btnKey='';renderDots();updHud(true);
}
function monParams(l,prog,rage){mon.patrol=Math.min(2.0,1.5+l*0.05);mon.chase=Math.min(3.25,2.85+l*0.05)+0.4*prog+(rage?0.3:0);mon.hearRun=4+2.5*prog+(rage?1.5:0);mon.sight=3.3+1.2*prog+(rage?0.8:0)}

/* ---------- ввід ---------- */
let joy=null;const keys={};
const gl=$('gl');
gl.addEventListener('pointerdown',e=>{au();if(joy)return;joy={id:e.pointerId,sx:e.clientX,sy:e.clientY,x:e.clientX,y:e.clientY};try{gl.setPointerCapture(e.pointerId)}catch(_){}});
gl.addEventListener('pointermove',e=>{if(joy&&e.pointerId===joy.id){joy.x=e.clientX;joy.y=e.clientY}});
const endJoy=e=>{if(joy&&e.pointerId===joy.id)joy=null};gl.addEventListener('pointerup',endJoy);gl.addEventListener('pointercancel',endJoy);
addEventListener('keydown',e=>{keys[e.key.toLowerCase()]=true});addEventListener('keyup',e=>{keys[e.key.toLowerCase()]=false});
function setCrouch(v){crouchOn=v;const b=$('crouch');b.querySelector('span').textContent=v?'Встати':'Присісти';b.setAttribute('aria-pressed',v?'true':'false');b.classList.toggle('on',v)}
function canAct(){return (phase==='play'||phase==='intro')&&(iAmMon()||(player&&!(MP.on&&MP.spectator)&&!player.escaped))}
const surv=()=>player&&!iAmMon()&&!(MP.on&&MP.spectator);
onTap($('crouch'),()=>{au();if(canAct()&&surv()&&!player.down&&player.hidden<0)setCrouch(!crouchOn)});
function toggleLight(){au();if(!canAct()||!surv()||player.down||player.hidden>=0)return;if(!player.lightOn&&player.battery<=0){tip('Батарейка сіла. Пошукай 🔋');return}player.lightOn=!player.lightOn;SFX.click();updLightBtn()}
onTap($('light'),toggleLight);
function updLightBtn(){const b=$('light'),on=!!(player&&player.lightOn);b.classList.toggle('on',on);b.classList.toggle('off',!!player&&player.battery<=0);b.setAttribute('aria-pressed',on?'true':'false')}
function doDash(){au();if(!canAct()||!iAmMon()||phase!=='play'||dashCd>0||blindT>0)return;dashT=1;dashCd=8;SFX.dash();puffRing(mon.x,mon.z,10,'#5A3A6A');vib(30)}
onTap($('dash'),doDash);
// «Дія»: сховатись/вилізти/відчинити — дотиком; підняти друга / підвестись / вставити — утриманням (будь-яким пальцем)
const actB=$('act');
actB.addEventListener('pointerdown',e=>{if(e.button>0)return;e.preventDefault();au();hold.id=e.pointerId;actDown()});
const actUpE=e=>{if(e.pointerId===hold.id){hold.id=null;hold.on=false}};addEventListener('pointerup',actUpE);addEventListener('pointercancel',actUpE);
actB.addEventListener('click',e=>{if(e.detail===0){actDown();setTimeout(()=>{hold.on=false},60)}});
addEventListener('keydown',e=>{const k=e.key.toLowerCase();if(e.repeat)return;if(k==='c'||k==='с'||e.key==='Control'){if(canAct()&&surv()&&!player.down&&player.hidden<0)setCrouch(!crouchOn)}if(k==='f'||k==='а')toggleLight();if(k==='e'||k==='у')actDown();if(k==='q'||k==='й'||k===' ')doDash()});
addEventListener('keyup',e=>{const k=e.key.toLowerCase();if(k==='e'||k==='у')hold.on=false});
function actDown(){if(!canAct())return;const c=actCtx();if(!c)return;
  if(c.k==='hide')doHide(c.h);else if(c.k==='out')doUnhide();else if(c.k==='chk')doCheck(c.h);else{hold.on=true;hold.ctx=c.k+(c.t?c.t.id:'')}}
function nearHide(x,z,r,free){let best=null,bd=r;hides.forEach((h,i)=>{const d=boxDist(h.b,x,z);if(d<bd&&(!free||!chars.some(c=>c!==player&&c.hidden===i))){bd=d;best=i}});return best}
const myCarry=()=>(G&&G.hold&&G.hold[myId()])||(pend&&pend.id)||null;
function actCtx(){
  if(!canAct())return null;
  if(iAmMon()){if(phase!=='play'||blindT>0)return null;const h=nearHide(mon.x,mon.z,0.9);return h!=null?{k:'chk',h,label:'Відчинити',ic:'🚪'}:null}
  const p=player;if(!p||(MP.on&&MP.spectator))return null;
  if(p.down)return p.selfUsed?null:{k:'self',label:'Підвестись',ic:'💪'};
  if(p.hidden>=0)return {k:'out',label:'Вилізти',ic:'🚪'};
  for(const c of chars)if(c!==p&&c.down&&!c.out&&!c.escaped&&Math.hypot(c.x-p.x,c.z-p.z)<1.15)return {k:'rev',t:c,label:'Підняти'+(c.nick?' '+c.nick:''),ic:'🤝'};
  if(phase==='play'&&myCarry()&&G.hold[myId()]&&Math.hypot(box.x-p.x,box.z-p.z)<1.1)return {k:'ins',label:'Вставити',ic:'⚡'};
  if(phase==='play'){const h=nearHide(p.x,p.z,0.75,true);if(h!=null)return {k:'hide',h,label:'Сховатись '+hides[h].how,ic:'🫣'}}
  return null;
}
function doHide(i){const p=player,h=hides[i];p.hidePrev=[p.x,p.z];p.hidden=i;p.x=h.x;p.z=h.z;p.vx=p.vz=0;p.wasLit=p.lightOn;p.lightOn=false;setCrouch(false);SFX.hide();puffRing(h.ex,h.ez,8,'#8C7AA8');updLightBtn();
  tip('Ти сховався. Монстр не знайде, якщо не бачив, як ти заліз')}
function doUnhide(){const p=player,h=hides[p.hidden];if(!h){p.hidden=-1;return}p.hidden=-1;const [x,z]=p.hidePrev&&boxDist(h.b,p.hidePrev[0],p.hidePrev[1])<1.2?snap(p.hidePrev[0],p.hidePrev[1]):[h.ex,h.ez];p.x=x;p.z=z;SFX.hide();if(p.wasLit&&p.battery>0)p.lightOn=true;updLightBtn()}
/* гравець-монстр відчиняє шафу */
function doCheck(i){if(chkCd>0)return;chkCd=1.5;SFX.hide();const h=hides[i];puffRing(h.ex,h.ez,8,'#E5484D');
  if(!chars.some(c=>c.hidden===i))pop(mon,'Порожньо','#8C7AA8');req('ck',i)}

/* ---------- рух ---------- */
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
}
function integrate(ch,dt){ch.x+=ch.vx*dt;ch.z+=ch.vz*dt;collide(ch);const sp=Math.hypot(ch.vx,ch.vz);if(sp>0.25){const ty=Math.atan2(ch.vx,ch.vz);ch.yaw+=angDiff(ty,ch.yaw)*Math.min(1,dt*12)}}
function readStick(){let ix=0,iz=0;
  if(joy){const dx=joy.x-joy.sx,dy=joy.y-joy.sy,m=Math.hypot(dx,dy);if(m>6){const k=Math.min(1,m/55);ix=dx/m*k;iz=dy/m*k}}
  if(keys.a||keys.arrowleft)ix-=1;if(keys.d||keys.arrowright)ix+=1;if(keys.w||keys.arrowup)iz-=1;if(keys.s||keys.arrowdown)iz+=1;
  const im=Math.hypot(ix,iz);if(im>1){ix/=im;iz/=im}return[ix,iz]}

/* ---------- бот-монстр (соло або хост) ---------- */
const ST={sleep:0,patrol:1,hear:2,chase:3,search:4,look:5,leave:6,pull:7,blind:8,player:9};
const active=c=>!c.down&&!c.escaped&&c.hidden<0&&!c.out;
function monSees(m,c){
  if(!active(c))return false;
  const dx=c.x-m.x,dz=c.z-m.z,d=Math.hypot(dx,dz);
  if(d<1.1)return los(m.x,m.z,c.x,c.z);
  if(c.lightOn&&d<5.5&&los(m.x,m.z,c.x,c.z))return true;     // увімкнений ліхтар видно з будь-якого боку
  const R=c.lightOn?m.sight+4.5:c.crouch>0.5?2.0:m.sight;
  if(d>R)return false;
  if(Math.abs(angDiff(Math.atan2(dx,dz),m.look))>1.0)return false;
  if(!los(m.x,m.z,c.x,c.z))return false;
  if(c.crouch>0.5&&!c.lightOn&&d>1.9&&!los(m.x,m.z,c.x,c.z,lowSegs))return false;
  return true;
}
function monGo(m,x,z){m.path=astar(m.x,m.z,x,z);m.pi=0}
function monNotice(m,c){if(m.state!=='chase'){growlFx();pop(m,'!','#E5484D')}m.state='chase';m.target=c;m.lastSeen=[c.x,c.z];m.lostT=0;m.repathT=0}
function monHear(m,x,z){if(m.state==='chase'||m.state==='blind'||m.state==='leave'||m.state==='pull')return;pop(m,'?','#FFC93C');m.state='hear';m.lastSeen=[x,z];monGo(m,x,z);m.hearCd=1.2;growlFx(0.08)}
function monAI(m,dt){
  const prog=G?G.ins.length/Math.max(1,G.nf):0,rage=!!(G&&G.op);monParams(G?G.lvl:level,prog,rage);
  if(m.state==='sleep'){m.vx*=0.8;m.vz*=0.8;return}
  if(m.state==='blind'){m.blindT-=dt;m.vx*=0.8;m.vz*=0.8;m.look=m.yaw+(reduce?0:Math.sin(T*9)*0.6);if(m.blindT<=0){m.state='look';m.lookT=1.5;m.lookBase=m.yaw;m.path=null}return}
  if(m.state==='leave'){m.leaveT-=dt;const done=steerPath(m,dt,m.patrol*1.25);m.look=m.yaw;if(m.leaveT<=0||done){m.state='patrol';m.path=null}return}
  if(m.state==='pull'){const c=m.pull,h=c&&hides[c.hidden];if(!c||!h||c.down){m.state='look';m.lookT=1.6;m.lookBase=m.yaw;m.path=null;return}
    const done=steerPath(m,dt,m.chase);m.look=m.yaw;if(done||boxDist(h.b,m.x,m.z)<0.75){applyDown(c.id,[h.ex,h.ez]);monAfterKnock(m,h.ex,h.ez)}return}
  let tgt=null,bd=1e9;for(const c of chars)if(monSees(m,c)){const d=Math.hypot(c.x-m.x,c.z-m.z);if(d<bd){bd=d;tgt=c}}
  // світять у нього ліхтарем довше 0,35 с — помічає, хто світить (засліплює — довше, див. blindCheck)
  let lit=null;for(const c of chars)if(active(c)&&inBeam(c,m.x,m.z)){lit=c;break}
  if(lit){m.glare+=dt;if(m.glare>0.35&&!tgt)tgt=lit}else m.glare=Math.max(0,m.glare-dt*2);
  if(tgt){if(m.state!=='chase'||m.target!==tgt)monNotice(m,tgt);else{m.lastSeen=[tgt.x,tgt.z];m.lostT=0}}
  if(m.state!=='chase'){m.hearCd-=dt;
    if(m.hearCd<=0)for(const c of chars){if(!active(c)&&!c.inserting)continue;const d=Math.hypot(c.x-m.x,c.z-m.z),sp=Math.hypot(c.vx,c.vz);
      const R=c.inserting?7:c.crouch>0.5?0:sp>2.4?m.hearRun:sp>0.7?1.7:0;   // вставляти в щиток — гучно
      if(d<R){monHear(m,c.x,c.z);break}}}
  if(m.state==='chase'){
    const t=m.target;
    if(t&&t.hidden>=0&&m.lostT<0.8&&Math.hypot(t.x-m.x,t.z-m.z)<6){m.state='pull';m.pull=t;const h=hides[t.hidden];monGo(m,h.ex,h.ez);pop(m,'!!','#E5484D');return}
    if(!t||!active(t)){m.state='search';monGo(m,m.lastSeen[0],m.lastSeen[1]);return}
    if(!tgt||tgt!==t)m.lostT+=dt;
    if(m.lostT>1.6){m.state='search';monGo(m,m.lastSeen[0],m.lastSeen[1]);return}
    m.repathT-=dt;if(m.repathT<=0){const aim=m.lostT>0?m.lastSeen:[t.x,t.z];if(lineFree(m.x,m.z,aim[0],aim[1]))m.path=[aim];else monGo(m,aim[0],aim[1]);m.pi=0;m.repathT=0.3}
    steerPath(m,dt,m.chase);m.look=m.yaw;return}
  if(m.state==='look'){m.lookT-=dt;m.vx*=0.85;m.vz*=0.85;m.look=m.lookBase+(1-Math.max(0,m.lookT)/2)*Math.PI*2;if(m.lookT<=0){m.state='patrol';m.path=null}return}
  if(!m.path||m.pi>=m.path.length){
    if(m.state==='search'||m.state==='hear'){m.state='look';m.lookT=2;m.lookBase=m.yaw;m.path=null;return}
    // патруль: частіше туди, де хтось є, і до щитка, коли несуть запобіжник
    const act=chars.filter(active);let w;
    if(G&&Object.keys(G.hold).length&&Math.random()<0.3)w=snap(box.x,box.z);
    else if(act.length&&Math.random()<0.4){const c=act[Math.floor(Math.random()*act.length)];w=waypoints.slice().sort((a,b)=>dist(a,[c.x,c.z])-dist(b,[c.x,c.z]))[Math.floor(Math.random()*3)]}
    else{const opts=waypoints.filter(w=>!m.visited.includes(w)&&dist(w,[m.x,m.z])>2.5);const from=opts.length?opts:waypoints;w=from[Math.floor(Math.random()*from.length)]}
    m.visited.push(w);if(m.visited.length>5)m.visited.shift();monGo(m,w[0],w[1]);m.state='patrol'}
  steerPath(m,dt,m.state==='hear'||m.state==='search'?m.chase*0.8:m.patrol);
  m.look=m.yaw+(reduce?0:Math.sin(T*1.5)*0.45);
}
function monAfterKnock(m,x,z){m.state='leave';m.leaveT=5;m.target=null;m.pull=null;const far=waypoints.slice().sort((a,b)=>dist(b,[x,z])-dist(a,[x,z]))[Math.floor(Math.random()*3)];monGo(m,far[0],far[1])}
function growlFx(v){const fo=camFollow(),pan=fo?Math.max(-1,Math.min(1,(mon.x-fo.x)/7)):0,d=fo?Math.hypot(mon.x-fo.x,mon.z-fo.z):5;SFX.growl(pan,(v||0.18)*Math.max(0.3,1-d/16))}

/* ---------- хост/соло: удари й засліплення (для бота й для гравця-монстра) ---------- */
function authMonster(dt){
  const m=mon;if(!m||G.ph!=='play')return;
  auth.kCd-=dt;
  const blind=G.mm?(T<auth.blindUntil):m.state==='blind';
  // удар: дотик до монстра
  if(auth.kCd<=0&&!blind&&!(!G.mm&&m.state==='leave')&&!(!G.mm&&m.state==='sleep'))for(const c of chars)if(active(c)&&Math.hypot(c.x-m.x,c.z-m.z)<(G.mm?0.7:0.62)){applyDown(c.id);auth.kCd=G.mm?2.5:0.5;G.mk=(G.mk|0)+1;if(!G.mm)monAfterKnock(m,c.x,c.z);break}
  // засліплення: світиш в обличчя зблизька — одразу
  if(T<auth.imm||blind)return;
  for(const c of chars){const k=c.id;if(!active(c)){auth.bacc[k]=0;continue}
    const d=Math.hypot(m.x-c.x,m.z-c.z),face=Math.abs(angDiff(Math.atan2(c.x-m.x,c.z-m.z),m.look))<1.5;
    // миттєво: промінь в обличчя зблизька — і засліп
    const hit=d<BLIND_R&&face&&inBeam(c,m.x,m.z,BLIND_R);if(hit)auth.bacc[k]=(auth.bacc[k]||0)+dt;else auth.bacc[k]=0;
    if(hit&&auth.bacc[k]>=BLIND_HOLD){auth.bacc={};auth.imm=T+BLIND_T+BLIND_IMM;auth.blindUntil=T+BLIND_T;G.bl=(G.bl|0)+1;G.blb=c.id;
      if(!G.mm){m.state='blind';m.blindT=BLIND_T;m.target=null;m.path=null}break}}
}

/* ---------- стан раунду G (соло або хост — пишуть; решта — читають) ---------- */
function applyDown(id,pos){if(G.dn.includes(id))return;G.dn.push(id);G.dc[id]=(G.dc[id]|0)+1;
  const c=chars.find(c=>c.id===id);if(pos&&c){c.x=pos[0];c.z=pos[1];c.hidden=-1}
  const f=G.hold[id];if(f){delete G.hold[id];G.drop[f]=c?[+c.x.toFixed(2),+c.z.toFixed(2)]:null}}
function applyRevive(id,dc){const i=G.dn.indexOf(id);if(i>=0&&(G.dc[id]|0)===dc&&!G.out.includes(id))G.dn.splice(i,1)}
function applySelf(id){const i=G.dn.indexOf(id);if(i>=0&&!G.sr.includes(id)&&!G.out.includes(id)){G.dn.splice(i,1);G.sr.push(id)}}
function applyBleed(id,dc){if(G.dn.includes(id)&&!G.out.includes(id)&&(G.dc[id]|0)===dc)G.out.push(id)}
function applyEscape(id){if(G.op&&!G.esc.includes(id)&&!G.dn.includes(id))G.esc.push(id)}
const holderOf=f=>Object.keys(G.hold).find(k=>G.hold[k]===f);
function applyPick(id,f){if(G.ins.includes(f)||holderOf(f)||G.hold[id]||G.dn.includes(id))return;G.hold[id]=f;delete G.drop[f]}
function applyBat(f){if(!G.got.includes(f))G.got.push(f)}
function applyIns(id,f){if(G.hold[id]!==f)return;delete G.hold[id];G.ins.push(f);if(G.ins.length>=G.nf)G.op=1}
function applyCheck(id,i){if(id!==G.mm)return;const c=chars.find(c=>c.hidden===i&&!c.down);const h=hides[i];if(c&&h)applyDown(c.id,[h.ex,h.ez])}
function applyEv(id,t,v){
  if(G.ph!=='play')return;
  if(t==='pk')applyPick(id,v);else if(t==='bt')applyBat(v);else if(t==='in')applyIns(id,v);else if(t==='rv')applyRevive(v[0],v[1]);
  else if(t==='sv')applySelf(id);else if(t==='bo')applyBleed(id,v);else if(t==='e')applyEscape(id);else if(t==='ck')applyCheck(id,v);
}
/* мої дії: соло/хост — одразу; гравець — подією з номером у presence (хост застосує кожну раз) */
const REQ={s:0,ev:[]};
function req(t,v){if(isAuth()){applyEv(myId(),t,v);return}REQ.s++;REQ.ev.push([REQ.s,t,v]);if(REQ.ev.length>16)REQ.ev.shift()}
function hostEvents(){for(const p of peersNow()){if(p.isMe||!G.pl.includes(p.id))continue;const ev=(p.presence||{}).ev;if(!Array.isArray(ev))continue;
  const last=auth.last[p.id]||0;
  for(const [s,t,v] of ev)if(s>last){applyEv(p.id,t,v);auth.last[p.id]=s}}}
function newG(r,map,fx,fz,lvl,pl,mm){const n=pl.filter(i=>i!==mm).length,nf=fuseN(lvl,n);
  return{r,ph:'intro',k:1,map,fx,fz,seed:Math.floor(Math.random()*1e9),nf,nb:nf>=5?4:3,lvl,pl,mm:mm||'',got:[],hold:{},drop:{},ins:[],dn:[],dc:{},sr:[],out:[],esc:[],op:0,bl:0,blb:'',mk:0,res:null,rem:6000}}
/* застосувати G до персонажів і предметів (у всіх) */
function syncFromG(){
  for(const c of chars){
    const dn=G.dn.includes(c.id),esc=G.esc.includes(c.id);
    if(dn&&!c.down){if(c.hidden>=0&&hides[c.hidden]){c.x=hides[c.hidden].ex;c.z=hides[c.hidden].ez}c.down=true;c.hidden=-1;c.vx=c.vz=0;c.inserting=false;stats.downs++;
      if(c.isPlayer){downT=0;bleedSent=false;setCrouch(false);hold.on=false;pend=null;say('Тебе збили!','big red');SFX.scream();shakeT=0.4;vib(120);tip(G.sr.includes(c.id)?'Чекай, поки друг підніме тебе':'Утримуй «Підвестись», або чекай допомоги')}
      else{pop(c,'Допоможіть!','#E5484D');SFX.scream()}puffRing(c.x,c.z,12,'#E5484D')}
    if(!dn&&c.down){c.down=false;if(c.isPlayer){say('На ногах!','big green');SFX.up()}else pop(c,'Дякую!','#5BD38A');puffRing(c.x,c.z,10,'#5BD38A')}
    if(esc&&!c.escaped){c.escaped=true;c.escT=0;c.lightOn=false;if(c.isPlayer){say('Ти втік!','big green');SFX.win()}else pop(c,'Втік!','#3FE08F')}
    c.selfUsed=G.sr.includes(c.id);c.out=G.out.includes(c.id);c.mdl.carry.visible=!!G.hold[c.id]&&!c.escaped&&c.hidden<0;
  }
  if(player&&pend){if(G.hold[player.id]===pend.id)pend=null;else if(T-pend.t>2){const it=items.find(i=>i.id===pend.id);pend=null;if(it)it.mine=false}}
  if(player&&pend)player.mdl.carry.visible=true;
  // предмети: на підлозі (на старті або там, де впустили), у руках, у щитку, батарейка взята
  for(const it of items){let gone,x=it.x0,z=it.z0;
    if(it.kind==='b')gone=G.got.includes(it.id)||myGot.has(it.id);
    else{gone=G.ins.includes(it.id)||!!holderOf(it.id)||(pend&&pend.id===it.id);const d=G.drop[it.id];if(d){x=d[0];z=d[1]}}
    if(gone&&!it.gone){it.gone=true;if(!it.mine)puffRing(it.x,it.z,10,it.kind==='f'?'#FFC93C':'#3FE08F');it.mine=false}
    if(!gone&&it.gone){it.gone=false;it.vis=0;it.mdl.g.scale.setScalar(1)}
    it.x=x;it.z=z}
  if(G.ins.length>prev.ins){prev.ins=G.ins.length;SFX.insert();ripple(box.x,box.z,'#FFC93C',1.4);if(!G.op)say('⚡ '+G.ins.length+'/'+G.nf,'big')}
  boxLeds.forEach((l,i)=>l.material.color.set(i<G.ins.length?'#3FE08F':'#5A1A1A'));
  if(G.op&&!prev.op){prev.op=1;exitOpenFx()}
  if((G.bl|0)>prev.bl){prev.bl=G.bl;blindFx()}
  if((G.mk|0)>prev.mk){prev.mk=G.mk;if(iAmMon())slowT=2}
  updHud();
}
function exitOpenFx(){SFX.door();say('Вихід відчинено!','big green');tip(iAmMon()?'Вони біжать до виходу — перехопи їх':'Біжи до зелених дверей «ВИХІД». Монстр розлютився');exitPanel.material.color.set('#2BD178');shakeT=0.3;if(mon)growlFx(0.25)}
function blindFx(){SFX.blind();if(mon){pop(mon,'Засліплено!','#FFE9A8');puffRing(mon.x,mon.z,12,'#FFE9A8')}
  if(iAmMon()){blindT=BLIND_T;$('blind').style.opacity=1;vib(200);say('Тебе засліпили!','big')}
  else{const c=chars.find(c=>c.id===G.blb);if(c&&c.isPlayer){say('Засліпив! Тікай','big green');vib(40)}}}

/* ---------- кінець раунду (соло або хост) ---------- */
function checkEnd(){
  const ps=chars.filter(c=>!MP.on||peersNow().some(p=>p.id===c.id));
  const still=ps.filter(c=>!c.escaped&&!c.out&&!(c.down&&c.selfUsed&&!ps.some(o=>o!==c&&active(o))));
  if(still.length)return false;
  return {res:G.esc.length?'win':'lose'};
}

/* ---------- фази ---------- */
function onPhase(){
  if(G.ph==='intro'){phase='intro';say(iAmMon()?'Ти — монстр':'Він десь тут…','big');SFX.sting();
    tip(MP.on&&MP.spectator?'Ти глядач. Приєднаєшся в наступному раунді':iAmMon()?'Лови їх, поки не вставили '+G.nf+' запобіжники в щиток. Світло засліплює тебе':'Знайди 🔌 '+G.nf+' і віднеси по одному в ⚡ щиток. Тоді відчиниться вихід')}
  if(G.ph==='play'){phase='play';if(mon&&isAuth()&&!G.mm)mon.state='patrol';growlFx(0.14);droneSet(0.02)}
  if(G.ph==='end'){phase='end';joy=null;hold.on=false;droneSet(0);$('blind').style.opacity=0;showEnd()}
  btnKey='';updButtons();
}
function showEnd(){
  const win=G.res==='win',n=G.pl.filter(i=>i!==G.mm).length,e=G.esc.length,me=iAmMon(),iWin=me?!win:win;
  if(iWin){SFX.win();for(let i=0;i<110;i++)confetti.push({x:W/2+(Math.random()-.5)*W*0.8,y:H*0.3,vx:(Math.random()-.5)*420,vy:-150-Math.random()*380,l:2.6,c:['#FFC93C','#3FE08F','#4C8DFF','#FF7BB0'][i%4],r:Math.random()*6})}else SFX.lose();
  let title,text,stars=0;
  if(MP.on){const monName=G.mm?(presOf(G.mm)||{}).n||'Монстр':'Монстр';
    title=me?(win?'Утекли '+e+' з '+n:'Ніхто не втік!'):(win?(e===n?'Утекли всі!':'Утекли '+e+' з '+n):monName+' переміг');
    const names=chars.filter(c=>G.esc.includes(c.id)).map(c=>c.isPlayer?'ти':c.nick).filter(Boolean);
    text=(win?'Вибрались: '+names.join(', ')+'.':'Ніхто не вибрався.')+' Наступний раунд за кілька секунд'+(G.mm?', монстром буде інший.':'.')}
  else{title=win?'Ти втік!':'Монстр тебе дістав';
    stars=win?1+(stats.downs===0?1:0)+(playT<180?1:0):0;
    text=win?'За '+Math.floor(playT/60)+':'+String(Math.floor(playT%60)).padStart(2,'0')+(stats.downs?', падав '+stats.downs+' раз.':' і жодного разу не впав.')+' Далі монстр буде швидшим.':'У щитку '+G.ins.length+' з '+G.nf+'. Ховайся в шафах і вимикай ліхтар, коли монстр поруч. А якщо наздоганяє — посвіти йому в очі.'}
  if(win&&!MP.on){level++;try{localStorage.setItem('mon_level',level)}catch(e){}}
  setTimeout(()=>{if(phase!=='end')return;$('ovTitle').textContent=title;$('ovText').textContent=text;$('stars').hidden=MP.on||!win;$('stars').innerHTML=[0,1,2].map(i=>'<span class="'+(i<stars?'on':'')+'">★</span>').join('');
    $('ovLegend').hidden=true;$('ovHint').hidden=true;$('ovTitle').className=iWin?'win':'lose';$('mpOpen').hidden=MP.on;$('mpNote').hidden=true;
    $('ovBtn').hidden=MP.on&&!MP.host;$('ovBtn').textContent=MP.on?'Наступний раунд':win?'Далі':'Ще раз';$('ovLeave').hidden=!MP.on;$('ov').hidden=false;setTimeout(()=>$('ovBtn').focus({preventScroll:true}),50)},iWin?1500:1300);
}
function startSolo(){
  const v=Math.floor((level-1)/HW.MAPS.length)%4;
  G=newG(Date.now(),(level-1)%HW.MAPS.length,v&1,v&2?1:0,level,['me'],'');
  setupRound(G);lastKey='';introT=6;syncPhase();
}
function syncPhase(){const key=G.r+':'+G.ph;if(key!==lastKey){lastKey=key;onPhase()}}

/* ---------- головний цикл ---------- */
const camPos=new T3.Vector3(),camLook=new T3.Vector3();
function update(dt){
  T+=dt;
  if(MP.on)mpTick(dt);
  else if(G){
    if(G.ph==='intro'){const b=Math.ceil(introT);introT-=dt;const n=Math.ceil(introT);if(n!==b&&n>0&&n<=3){say(String(n),'num');SFX.beep()}if(introT<=0){G.ph='play';syncPhase()}}
    else if(G.ph==='play'){const e=checkEnd();if(e){G.ph='end';G.res=e.res;syncPhase()}}
  }
  if(!G||(!player&&!iAmMon()&&!(MP.on&&MP.spectator)))return;
  if(phase==='play')playT+=dt;
  syncFromG();
  const p=player;
  if(surv())survivorUpdate(p,dt);
  if(iAmMon())monPlayerUpdate(dt);
  blindT=Math.max(0,blindT-dt);slowT=Math.max(0,slowT-dt);dashT=Math.max(0,dashT-dt);dashCd=Math.max(0,dashCd-dt);chkCd=Math.max(0,chkCd-dt);
  if(iAmMon())$('blind').style.opacity=Math.min(1,blindT/1.2).toFixed(2);
  if(isAuth()&&mon&&(phase==='play'||phase==='intro')){if(!G.mm)monAI(mon,dt);if(phase==='play')authMonster(dt)}
  const steps=dt>0.03?2:1;
  for(let k=0;k<steps;k++){if(surv())integrate(p,dt/steps);if(mon&&((isAuth()&&!G.mm)||iAmMon()))integrate(mon,dt/steps)}
  if(p&&p.hidden>=0&&hides[p.hidden]){p.x=hides[p.hidden].x;p.z=hides[p.hidden].z}
  if(MP.on)mpFollow(dt);
  if(mon&&isAuth())mon.stCode=G.mm?ST.player:ST[mon.state];
  monSense(dt);
  for(const c of chars){
    const sp=Math.hypot(c.vx,c.vz);c.stepT-=dt*sp;
    if(sp>1.8&&c.stepT<=0){c.stepT=0.55;if(c.isPlayer)SFX.step()}
    // біг гучний: свій — білими хвилями; гравцю-монстру чужий біг видно крізь стіни
    const loud=sp>2.4&&c.crouch<0.5&&!c.escaped;
    if(phase==='play'&&(loud||c.inserting)&&(c.isPlayer||(iAmMon()&&Math.hypot(c.x-mon.x,c.z-mon.z)<(c.inserting?9:7)))){c.ripT-=dt;if(c.ripT<=0){c.ripT=0.45;ripple(c.x,c.z,iAmMon()?'#FF6A5A':'#FFFFFF',c.inserting?1.3:0.8)}}
    animChar(c,dt);
  }
  if(mon)animMon(mon,dt);
  for(const it of items)animItem(it,dt);
  updPuffs(dt);updRipples(dt);
  lights();
  // камера
  const fo=camFollow();glow.position.set(fo.x,1.0,fo.z);glow.intensity=0.6;glow.color.set(iAmMon()?'#FF8C7A':'#B8C8FF');hemi.intensity=iAmMon()?DARK_MON:DARK;
  const want=new T3.Vector3(fo.x,8.4,fo.z+6.0),lookAt=new T3.Vector3(fo.x,0,fo.z-0.4);
  if(phase==='intro'&&mon&&!iAmMon()){const el=MP.on?6-timerLeft():6-introT,k=Math.max(0,Math.min(1,(el-1.2)/2.8)),e=k*k*(3-2*k);
    want.lerpVectors(new T3.Vector3(mon.x,11,mon.z+7.5),want,e);lookAt.lerpVectors(new T3.Vector3(mon.x,0,mon.z-0.6),lookAt,e)}
  camPos.lerp(want,Math.min(1,dt*(camBlend<1?60:5)));camLook.lerp(lookAt,Math.min(1,dt*(camBlend<1?60:6)));camBlend=1;
  camera.position.copy(camPos);if(shakeT>0&&!reduce){shakeT-=dt;camera.position.x+=(Math.random()-.5)*0.16;camera.position.y+=(Math.random()-.5)*0.1}
  camera.lookAt(camLook);
  updHud();updButtons();
}
function survivorUpdate(p,dt){
  const [ix,iz]=readStick();
  const frozen=phase==='end'||phase==='menu'||p.down||p.hidden>=0||p.escaped||hold.on&&(hold.ctx==='ins'||hold.ctx.startsWith('rev'));
  p.crouch+=((crouchOn?1:0)-p.crouch)*Math.min(1,dt*12);
  const sp=frozen?0:PL_SPD*(1-0.55*p.crouch);
  p.vx+=(ix*sp-p.vx)*Math.min(1,dt*11);p.vz+=(iz*sp-p.vz)*Math.min(1,dt*11);
  if(frozen){p.vx=p.vz=0}
  if(p.lightOn&&phase==='play'){p.battery=Math.max(0,p.battery-dt*1.25);if(p.battery<=0){p.lightOn=false;say('Ліхтар сів','big red');updLightBtn()}}
  // підбираю: батарейки — завжди; запобіжник — якщо руки вільні
  if(phase==='play'&&active(p))for(const it of items){if(it.gone||Math.hypot(it.x-p.x,it.z-p.z)>0.62)continue;
    if(it.kind==='b'){myGot.add(it.id);it.mine=true;req('bt',it.id);p.battery=Math.min(100,p.battery+45);SFX.bat();pop(p,'+🔋','#3FE08F');updLightBtn()}
    else if(!myCarry()){it.mine=true;pend={id:it.id,t:T};req('pk',it.id);SFX.fuse();vib(30);pop(p,'+🔌','#FFC93C');tip('Неси в ⚡ щиток — жовта стрілка покаже, куди. Носити можна лише один')}
    else if(!p.fullHint||T-p.fullHint>6){p.fullHint=T;pop(p,'Руки зайняті','#FFC93C')}}
  if(phase==='play'&&G.op&&active(p)&&Math.hypot(exit.ix-p.x,exit.iz-p.z)<0.9&&!G.esc.includes(p.id)&&!p.escReq){p.escReq=1;req('e',1);setTimeout(()=>{p.escReq=0},1500)}
  // дії з утриманням
  const c=actCtx(),ck=c?c.k+(c.t?c.t.id:''):'';
  p.inserting=false;
  if(hold.on&&c&&ck===hold.ctx&&(c.k==='rev'||c.k==='self'||c.k==='ins')){
    const near=c.k==='self'&&mon&&Math.hypot(mon.x-p.x,mon.z-p.z)<4.5;
    if(c.k==='ins')p.inserting=true;
    if(near){hold.p=0;if(!hold.warned){hold.warned=1;tip('Монстр поруч — зачекай')}}
    else{hold.p+=dt/(c.k==='self'?SELF_T:c.k==='ins'?INS_T:REV_T);if(Math.floor(T*4)!==hold.tk){hold.tk=Math.floor(T*4);if(c.k==='ins')SFX.buzz();else tone(400+hold.p*500,0.05,{type:'triangle',vol:0.05})}}
    if(hold.p>=1){hold.p=0;hold.on=false;if(c.k==='self')req('sv',1);else if(c.k==='ins')req('in',G.hold[p.id]);else req('rv',[c.t.id,G.dc[c.t.id]|0])}}
  else{hold.p=0;hold.warned=0}
  if(p.down&&!p.out){downT+=dt;if(downT>=DOWN_MAX&&!bleedSent){bleedSent=true;req('bo',G.dc[p.id]|0)}}
}
function monPlayerUpdate(dt){
  const m=mon,[ix,iz]=readStick(),frozen=phase!=='play'||blindT>0;
  const sp=frozen?0:MON_SPD*(G.op?1.08:1)*(dashT>0?1.55:1)*(slowT>0?0.5:1);
  m.vx+=(ix*sp-m.vx)*Math.min(1,dt*10);m.vz+=(iz*sp-m.vz)*Math.min(1,dt*10);if(frozen){m.vx*=0.7;m.vz*=0.7}
  m.look=m.yaw;m.stCode=ST.player;
}
function lights(){
  let li=1;
  for(const c of chars){const on=c.lightOn&&!c.escaped&&!c.down&&c.hidden<0;let s=null,b=null;
    if(c.isPlayer){s=FL[0];b=beams[0]}else if(li<MAXP){s=FL[li];b=beams[li];li++}
    if(!s)continue;
    const flick=c.battery<15&&!reduce?(Math.random()<0.15?0.2:1):1;
    s.intensity=on?2.8*flick:0;s.position.set(c.x,1.15,c.z);s.target.position.set(c.x+Math.sin(c.yaw)*3,0,c.z+Math.cos(c.yaw)*3);s.distance=BEAM+1.5;
    b.visible=on;if(on&&(c.isPlayer||Math.floor(T*30)%2===0))updBeam(b,c,BEAM);
    c.mdl.lens.color.set(on?'#FFF3B0':'#3A3F4B')}
  for(;li<MAXP;li++){FL[li].intensity=0;beams[li].visible=false}
  if(!player||!player.lightOn||player.escaped||player.down||player.hidden>=0){FL[0].intensity=0;beams[0].visible=false}
}
function camFollow(){
  if(iAmMon())return mon;
  if(player&&!player.escaped&&!(MP.on&&MP.spectator))return player;
  if(!spec||spec.escaped||!chars.includes(spec))spec=chars.find(c=>!c.escaped&&!c.out)||player||chars[0]||mon;
  return spec;
}
/* кроки монстра (стерео), серцебиття, червоний край екрана, хвилі кроків у темряві */
let heartT=0,vigK=0;
function monSense(dt){
  if(!mon||phase==='menu')return;
  const fo=camFollow();if(!fo)return;
  const d=fo===mon?99:Math.hypot(mon.x-fo.x,mon.z-fo.z),sp=Math.hypot(mon.vx,mon.vz),pan=fo===mon?0:Math.max(-1,Math.min(1,(mon.x-fo.x)/7));
  if(phase==='play'||phase==='intro'){
    mon.stepT-=dt*sp;if(sp>0.6&&mon.stepT<=0){mon.stepT=0.62;const v=fo===mon?0.07:Math.max(0,0.24*(1-d/13));if(v>0.005)SFX.thud(v,pan);if(d<8&&mon.vis<0.5)ripple(mon.x,mon.z,'#E5484D',1.25)}
    if(phase==='play'&&d<9&&!fo.escaped){heartT-=dt;if(heartT<=0){heartT=0.3+0.65*(d/9);SFX.heart(0.06+0.14*(1-d/9))}}
  }
  const chasing=mon.stCode===ST.chase&&(mon.target===player||mon.tid===(player&&player.id));
  const want=phase==='play'&&fo!==mon?Math.max(chasing?0.6:0,d<6?(1-d/6)*0.8:0):0;vigK+=(want-vigK)*Math.min(1,dt*4);$('vig').style.opacity=vigK.toFixed(2);
}

/* ---------- анімація ---------- */
function animChar(c,dt){
  const m=c.mdl,sp=Math.hypot(c.vx,c.vz),k=Math.min(1,sp/2.6);
  m.root.position.set(c.x,0,c.z);m.root.rotation.y=c.yaw;
  c.ph+=dt*(4+sp*3.4);
  c.lie+=((c.down?1:0)-c.lie)*Math.min(1,dt*8);
  const bob=reduce?0:Math.abs(Math.sin(c.ph))*0.07*k,cr=c.crouch||0;
  m.body.position.y=bob*(1-cr*0.6)+c.lie*0.1;m.body.scale.set(1+cr*0.14,(1-bob*0.8)*(1-cr*0.36),1+cr*0.14);m.body.rotation.x=k*0.2*(1-cr)+cr*0.12-c.lie*1.35;
  m.body.position.z=-c.lie*0.25;
  const sw=reduce?0:Math.sin(c.ph)*k;
  m.fL.position.set(-0.11,0.045+Math.max(0,Math.sin(c.ph))*0.07*k,0.02+sw*0.15);m.fR.position.set(0.11,0.045+Math.max(0,-Math.sin(c.ph))*0.07*k,0.02-sw*0.15);
  m.hL.position.set(-0.31,0.36+bob,0.02-sw*0.12);m.hR.position.set(0.31,0.4+bob,0.12);
  if(c.inserting&&!reduce){m.hL.position.set(-0.2,0.55+Math.sin(T*20)*0.03,0.25);m.hR.position.set(0.2,0.55+Math.cos(T*20)*0.03,0.25)}
  c.blinkT-=dt;if(c.blinkT<0)c.blinkT=2+Math.random()*3;m.eyes.scale.y=c.blinkT<0.1?0.1:1;
  const scared=c.down||(mon&&Math.hypot(mon.x-c.x,mon.z-c.z)<4);
  m.pL.scale.setScalar(scared?0.03:0.04);m.pR.scale.setScalar(scared?0.03:0.04);m.mouth.scale.set(scared?0.03:0.035,scared?0.03:0.016,0.012);
  if(m.star)m.star.position.y=1.07+(reduce?0:Math.sin(T*4)*0.02);
  m.carry.position.y=1.28+(reduce?0:Math.sin(T*3)*0.04);m.carry.rotation.y+=dt*2;
  c.ring.material.opacity=c.down&&!c.out?0.5+Math.sin(T*6)*0.3:0;
  // видимість: сховався — нема; втік — розчиняється в дверях; гравцю-монстру — лише зі світлом або зблизька
  let v=c.hidden>=0?0:1;if(c.escaped){c.escT+=dt;v=Math.max(0,1-c.escT/0.8);if(exit&&c.escT<0.8&&!c.remote){c.x+=(exit.x-c.x)*Math.min(1,dt*3);c.z+=(exit.z-c.z)*Math.min(1,dt*3)}}
  if(c.out)v=Math.min(v,0.45);
  if(iAmMon()&&v>0&&phase!=='end'){const d=Math.hypot(c.x-mon.x,c.z-mon.z),see=los(mon.x,mon.z,c.x,c.z);v=see&&(d<2.6||(c.lightOn&&!c.down&&d<11)||(c.down&&d<6))?1:0}
  c.vis+=(v-c.vis)*Math.min(1,dt*(v>c.vis?10:4));m.root.visible=c.vis>0.02;
  for(const mm of m.mats){const tr=c.vis<0.99;if(mm.transparent!==tr){mm.transparent=tr;mm.needsUpdate=true}mm.opacity=c.vis}
}
function animMon(m,dt){
  const md=m.mdl,sp=Math.hypot(m.vx,m.vz),k=Math.min(1,sp/3);
  md.root.position.set(m.x,0,m.z);md.root.rotation.y=m.yaw;m.ph+=dt*(2.5+sp*2.6);
  const ch=m.stCode===ST.chase||m.stCode===ST.pull||(m.stCode===ST.player&&sp>2.5),bl=m.stCode===ST.blind||(iAmMon()&&blindT>0);
  md.body.rotation.x=(ch?0.38:0.18)*(0.6+k*0.4)+(reduce?0:Math.sin(m.ph*0.5)*0.03)-(bl?0.35:0);
  md.body.position.y=reduce?0:Math.abs(Math.sin(m.ph))*0.05*k;
  md.head.rotation.y=angDiff(m.look,m.yaw)*0.8;md.head.rotation.z=reduce?0:Math.sin(T*(bl?7:0.9))*(bl?0.25:0.08);
  md.mouth.scale.y=ch||bl?0.1:0.06;
  md.arms.forEach((a,i)=>{a.rotation.x=bl?-2.3:(reduce?0:Math.sin(m.ph+(i?Math.PI:0))*0.5*k)-(ch?0.9:0.15);a.rotation.z=(i?-1:1)*(bl?0.5:0.12)});
  md.legs.forEach((l,i)=>{l.position.z=0.04+(reduce?0:Math.sin(m.ph+(i?Math.PI:0))*0.18*k)});
  // видно: у промені будь-чийого ліхтаря або зовсім поруч; очі — коли є пряма видимість
  const fo=camFollow();let v=0,ev=0;
  if(phase==='menu'||fo===m)v=ev=1;
  else if(fo){const d=Math.hypot(m.x-fo.x,m.z-fo.z),see=los(fo.x,fo.z,m.x,m.z);
    if(see&&d<2.3)v=1;for(const c of chars)if(inBeam(c,m.x,m.z,BEAM+0.5))v=1;
    if(phase==='intro')v=1;ev=v||(see&&d<10)?1:0;if(m.stCode===ST.sleep&&phase!=='intro')ev=0.3}
  m.vis+=(v-m.vis)*Math.min(1,dt*(v>m.vis?12:3));m.eyeVis+=(Math.max(ev,m.vis)-m.eyeVis)*Math.min(1,dt*8);
  md.root.visible=m.eyeVis>0.02;
  for(const mm of md.mats){const tr=m.vis<0.99;if(mm.transparent!==tr){mm.transparent=tr;mm.needsUpdate=true}mm.opacity=m.vis}
  const pulse=reduce?1:0.8+Math.sin(T*5)*0.2;md.eyeMats.forEach(e=>{e.opacity=m.eyeVis*(bl?0.25:1)*(e.isSpriteMaterial?pulse:1)});
}
function animItem(it,dt){
  const g=it.mdl.g;if(it.gone){g.visible=false;return}
  const fo=camFollow();let v=0;
  if(fo){const d=Math.hypot(it.x-fo.x,it.z-fo.z);if(d<1.6)v=1;else if(d<7&&los(fo.x,fo.z,it.x,it.z))v=d<4.5?1:0.55;for(const c of chars)if(inBeam(c,it.x,it.z,BEAM+1))v=1}
  it.vis+=(v-it.vis)*Math.min(1,dt*4);g.visible=it.vis>0.02;g.position.set(it.x,0.35+(reduce?0:Math.sin((it.ph+=dt)*2.4)*0.06),it.z);it.mdl.inner.rotation.y+=dt*1.6;
  for(const m of it.mdl.mats)m.opacity=it.vis*(m.isSpriteMaterial?(reduce?0.7:0.55+Math.sin(it.ph*3)*0.25):1);
  if(box){box.glow.material.opacity=0.35+(myCarry()&&!reduce?0.35+Math.sin(T*5)*0.2:0)}
}
function vib(ms){try{navigator.vibrate&&navigator.vibrate(ms)}catch(e){}}

/* ---------- HUD ---------- */
let hudKey='';
function updHud(force){
  if(!G)return;const n=G.ins.length,b=player?Math.ceil(player.battery):0,cr=!!myCarry();
  const key=n+':'+G.nf+':'+G.op+':'+b+':'+cr+':'+chars.map(c=>(c.down?1:0)+(c.escaped?2:0)+(c.out?4:0)).join('');
  if(key===hudKey&&!force)return;hudKey=key;
  const fc=$('fuseChip');fc.textContent=G.op?'🚪 Вихід!':'⚡ '+n+'/'+G.nf+(cr?' · 🔌':'');fc.classList.toggle('done',!!G.op);
  const bc=$('batChip');bc.hidden=!surv();bc.querySelector('b').style.setProperty('--b',b+'%');bc.classList.toggle('low',b<20);bc.setAttribute('aria-label','Заряд ліхтарика '+b+'%');
  updLightBtn();renderDots();
}
function renderDots(){const box=$('dots');box.innerHTML='';if(chars.length<2&&!iAmMon())return;
  for(const c of chars){const d=document.createElement('span');d.className='dot'+(c.isPlayer?' me':'')+(c.down&&!c.out?' down':'')+(c.out?' out':'')+(c.escaped?' esc':'');d.style.background=c.color;d.title=c.nick||'';box.appendChild(d)}}
let btnKey='';
function updButtons(){
  const show=canAct()&&phase!=='end',mm=iAmMon(),p=player,c=show?actCtx():null;
  const key=show+':'+mm+':'+(p&&p.down)+':'+(p&&p.hidden)+':'+(c?c.k+c.label:'')+':'+Math.round(hold.p*20)+':'+Math.ceil(dashCd)+':'+(blindT>0);
  if(key===btnKey)return;btnKey=key;
  const sv=show&&!mm&&p;
  $('light').hidden=!sv||p.down||p.hidden>=0;$('crouch').hidden=!sv||p.down||p.hidden>=0;
  const d=$('dash');d.hidden=!(show&&mm);if(!d.hidden){d.querySelector('span').textContent=dashCd>0?'Ривок · '+Math.ceil(dashCd):'Ривок';d.classList.toggle('off',dashCd>0||blindT>0)}
  const a=$('act');a.hidden=!c;if(c){a.querySelector('.ic').textContent=c.ic;$('actTxt').textContent=c.label+(c.k==='self'||c.k==='rev'||c.k==='ins'?' · тримай':'');a.className='pad'+(c.k==='self'?' self':c.k==='hide'||c.k==='out'?' hide':c.k==='ins'?' ins':c.k==='chk'?' self':'');a.style.setProperty('--p',Math.round(hold.p*100)+'%');a.setAttribute('aria-label',c.label)}
}
function say(text,cls){const el=$('say');el.textContent=text;el.className='say '+(cls||'');void el.offsetWidth;el.classList.add('show')}
function tip(t){const el=$('tip');el.textContent=t;el.hidden=false;el.classList.remove('fade');void el.offsetWidth;el.classList.add('fade')}
function pop(ch,text,color){pops.push({ch,text,color,t:0})}

/* ---------- накладка: підказки над головами, стрілки, джойстик ---------- */
const FONT='"Baloo 2","Arial Rounded MT Bold",sans-serif';const _p=new T3.Vector3();
function arrowTo(x,z,col,label){_p.set(x,0.5,z).project(camera);let sx=(_p.x+1)/2*W,sy=(1-_p.y)/2*H;const m=34;
  if(sx>m&&sx<W-m&&sy>90&&sy<H-m&&_p.z<1)return;
  const cx=W/2,cy=H/2;let dx=sx-cx,dy=sy-cy;if(_p.z>1){dx=-dx;dy=-dy}const s=Math.min((W/2-m)/Math.abs(dx||1e-6),(H/2-m-40)/Math.abs(dy||1e-6));sx=cx+dx*s;sy=cy+dy*s+20;
  const a=Math.atan2(dy,dx),pulse=reduce?1:1+Math.sin(T*6)*0.08;fctx.save();fctx.translate(sx,sy);fctx.scale(pulse,pulse);
  fctx.fillStyle='rgba(0,0,0,.35)';fctx.beginPath();fctx.arc(0,3,17,0,6.283);fctx.fill();fctx.fillStyle=col;fctx.beginPath();fctx.arc(0,0,17,0,6.283);fctx.fill();
  fctx.font='800 15px '+FONT;fctx.textAlign='center';fctx.textBaseline='middle';fctx.fillStyle='#10131A';
  if(label){fctx.fillText(label,0,1)}else{fctx.rotate(a);fctx.beginPath();fctx.moveTo(10,0);fctx.lineTo(-5,-7);fctx.lineTo(-2,0);fctx.lineTo(-5,7);fctx.fill()}fctx.restore()}
function drawFx(dt){
  fctx.clearRect(0,0,W,H);
  for(const p of pops){p.t+=dt;if(p.t>1.3)continue;const vis=p.ch.mdl?Math.max(p.ch.vis||0,p.ch.eyeVis||0):1;if(vis<0.3)continue;_p.set(p.ch.x,p.ch===mon?2.0:1.25,p.ch.z).project(camera);if(_p.z>1)continue;
    const x=(_p.x+1)/2*W,y=(1-_p.y)/2*H-p.t*22,e=p.t<0.25?(1-Math.pow(1-p.t/0.25,3))*1.15:1;
    fctx.globalAlpha=p.t>1.0?Math.max(0,1-(p.t-1.0)/0.3):1;fctx.save();fctx.translate(x,y);fctx.scale(e,e);
    fctx.font='800 '+(p.text.length>2?18:26)+'px '+FONT;const w=Math.max(34,fctx.measureText(p.text).width+20),h=34;
    fctx.fillStyle=p.color;fctx.beginPath();fctx.roundRect(-w/2,-h/2,w,h,17);fctx.fill();fctx.beginPath();fctx.moveTo(-6,h/2-1);fctx.lineTo(0,h/2+7);fctx.lineTo(6,h/2-1);fctx.fill();
    fctx.fillStyle='#10131A';fctx.textAlign='center';fctx.textBaseline='middle';fctx.fillText(p.text,0,2);fctx.restore();fctx.globalAlpha=1}
  pops=pops.filter(p=>p.t<1.3);
  if(MP.on&&phase!=='menu'&&phase!=='lobby')for(const c of chars){if(c.vis<0.5)continue;_p.set(c.x,1.45,c.z).project(camera);if(_p.z>1)continue;
    const x=(_p.x+1)/2*W,y=(1-_p.y)/2*H;fctx.font='800 13px '+FONT;const t=c.isPlayer?'Ти':c.nick,w=fctx.measureText(t).width+12;
    fctx.fillStyle='rgba(10,9,16,.6)';fctx.beginPath();fctx.roundRect(x-w/2,y-10,w,19,9);fctx.fill();fctx.fillStyle='#fff';fctx.textAlign='center';fctx.textBaseline='middle';fctx.fillText(t,x,y+1)}
  if(player&&player.down&&!player.out&&phase==='play'){_p.set(player.x,1.2,player.z).project(camera);const x=(_p.x+1)/2*W,y=(1-_p.y)/2*H-30;
    fctx.font='800 22px '+FONT;fctx.textAlign='center';fctx.fillStyle='#E5484D';fctx.fillText(Math.max(0,Math.ceil(DOWN_MAX-downT))+' с',x,y)}
  if(phase==='play'&&!iAmMon()){
    for(const c of chars)if(c!==player&&c.down&&!c.out&&!c.escaped)arrowTo(c.x,c.z,'#E5484D','!');
    if(G&&G.op&&exit&&player&&!player.escaped)arrowTo(exit.ix,exit.iz,'#3FE08F',null);
    else if(myCarry()&&box)arrowTo(box.x,box.z,'#FFC93C','⚡');
  }
  if(joy&&phase!=='end'){const dx=joy.x-joy.sx,dy=joy.y-joy.sy,m=Math.hypot(dx,dy),k=m>55?55/m:1;
    fctx.fillStyle='rgba(255,255,255,.12)';fctx.strokeStyle='rgba(255,255,255,.45)';fctx.lineWidth=2;fctx.beginPath();fctx.arc(joy.sx,joy.sy,55,0,6.283);fctx.fill();fctx.stroke();
    fctx.fillStyle='rgba(255,255,255,.8)';fctx.beginPath();fctx.arc(joy.sx+dx*k,joy.sy+dy*k,22,0,6.283);fctx.fill()}
  for(const c of confetti){c.l-=dt;c.vy+=520*dt;c.x+=c.vx*dt;c.y+=c.vy*dt;c.r+=dt*8;fctx.globalAlpha=Math.min(1,c.l);fctx.fillStyle=c.c;fctx.save();fctx.translate(c.x,c.y);fctx.rotate(c.r);fctx.fillRect(-5,-3,10,6);fctx.restore()}
  confetti=confetti.filter(c=>c.l>0);fctx.globalAlpha=1;
}

/* ---------- меню ---------- */
$('ovBtn').addEventListener('click',()=>{au();if(MP.on){if(MP.host&&MP.g&&MP.g.ph==='end')hostStartRound();return}startSolo()});

/* ---------- мультиплеєр ----------
   Транспорт: ../net-firebase.js (вузол RTDB «mon»): join(code) -> {presence(patch), peers(), leave()}.
   Хост (найраніший у кімнаті) веде G і бота-монстра; кожен — свою позицію й події (ev). Гравець-монстр — свою позицію монстра. */
const MP={on:false,avail:null,net:null,code:'',me:null,host:false,nick:'',color:0,g:null,round:-1,phKey:'',phEnd:0,spectator:false,mapSel:'auto',lvlSel:3,monSel:'bot'};
try{MP.nick=localStorage.getItem('mon_nick')||localStorage.getItem('hns_nick')||'';MP.color=+(localStorage.getItem('mon_color')||localStorage.getItem('hns_color'))||Math.floor(Math.random()*6)}catch(e){}
const myId=()=>MP.on?MP.me:'me';
(async()=>{const t=window.HNS_TRANSPORT;try{MP.avail=t&&await t.ready()?t:null}catch(e){MP.avail=null}$('mpOpen').disabled=!MP.avail;$('mpNote').hidden=!!MP.avail})();
const rcode=()=>Array.from({length:4},()=>'abcdefghjkmnpqrstuvwxyz'[Math.floor(Math.random()*23)]).join('');
function peersNow(){return MP.net?MP.net.peers():[]}
function presOf(id){const p=peersNow().find(p=>p.id===id);return p?p.presence:null}
function humans(){return peersNow().filter(p=>p.presence&&p.presence.n).sort((a,b)=>a.id<b.id?-1:1)}
function hostId(){const ps=humans();const hs=ps.filter(p=>p.presence.h).sort((a,b)=>(+a.presence.h-+b.presence.h)||(a.id<b.id?-1:1));return(hs[0]||ps[0]||{}).id}
const timerLeft=()=>Math.max(0,(MP.phEnd-performance.now())/1000);
$('mpOpen').addEventListener('click',()=>{au();$('ov').hidden=true;$('mp').hidden=false;$('mpA').hidden=false;$('mpB').hidden=true;$('nick').value=MP.nick;$('colorBtn').style.background=PCOL[MP.color];
  const h=(location.hash||'').replace('#','');if(/^[a-z]{4}$/.test(h))$('codeIn').value=h.toUpperCase();setTimeout(()=>$('nick').focus(),50)});
$('mpBack').addEventListener('click',()=>{$('mp').hidden=true;$('ov').hidden=false});
$('mpCreate').addEventListener('click',()=>mpJoin(rcode(),true));
$('mpJoinBtn').addEventListener('click',()=>{const c=($('codeIn').value||'').trim().toLowerCase();if(!/^[a-z]{4}$/.test(c)){$('mpErr').textContent='Код має 4 літери, наприклад KQRT.';$('mpErr').hidden=false;return}mpJoin(c)});
$('codeIn').addEventListener('keydown',e=>{if(e.key==='Enter')$('mpJoinBtn').click()});
$('colorBtn').addEventListener('click',()=>{MP.color=(MP.color+1)%PCOL.length;$('colorBtn').style.background=PCOL[MP.color];if(MP.net)MP.net.presence({c:MP.color})});
$('mpStart').addEventListener('click',()=>{if(MP.host){MP.mapSel=$('mapSel').value;MP.lvlSel=+$('lvlSel').value;MP.monSel=$('monSel').value;MP.g=null;MP.monTurn=0;hostStartRound()}});
$('mpQuit').addEventListener('click',mpLeave);$('ovLeave').addEventListener('click',mpLeave);
$('copyCode').addEventListener('click',()=>{const t=MP.code.toUpperCase();try{navigator.clipboard.writeText(t).then(()=>{$('copyCode').textContent='Скопійовано'},()=>{})}catch(e){}});
async function mpJoin(code,create){
  au();MP.nick=($('nick').value||'').trim().slice(0,14)||'Гравець';try{localStorage.setItem('mon_nick',MP.nick);localStorage.setItem('mon_color',MP.color)}catch(e){}
  $('mpErr').hidden=true;
  try{MP.net=await MP.avail.join(code)}catch(e){$('mpErr').textContent=e&&e.message==='full'?'Кімната повна.':'Не вдалося увійти в кімнату. Спробуй ще раз.';$('mpErr').hidden=false;return}
  MP.code=code;MP.on=true;MP.joinedAt=performance.now();MP.round=-1;MP.phKey='';MP.g=null;MP.lastG=null;REQ.ev=[];auth.last={};
  MP.net.presence({n:MP.nick,c:MP.color,h:create?Date.now():null});
  location.hash=code;$('roomCode').textContent=code.toUpperCase();$('mpA').hidden=true;$('mpB').hidden=false;
  phase='lobby';mpLobbyRender();
}
function mpLeave(){if(MP.net)MP.net.leave();MP.net=null;MP.on=false;MP.host=false;MP.g=null;MP.lastG=null;MP.me=null;G=null;droneSet(0);location.hash='';$('blind').style.opacity=0;
  $('mp').hidden=true;$('ov').hidden=false;$('ovTitle').textContent='Монстр';$('ovTitle').className='';$('ovText').textContent=MENU_TEXT;
  $('ovLegend').hidden=false;$('ovHint').hidden=false;$('stars').hidden=true;$('ovBtn').hidden=false;$('ovBtn').textContent='Грати';$('mpOpen').hidden=false;$('ovLeave').hidden=true;bootScene()}
function mpLobbyRender(){
  const list=$('plist');list.innerHTML='';const hid=hostId();
  humans().forEach((p,i)=>{const li=document.createElement('li');const d=document.createElement('span');d.className='pdot';d.style.background=PCOL[(p.presence.c|0)%PCOL.length];
    const nm=document.createElement('span');nm.textContent=String(p.presence.n).slice(0,14)+(p.isMe?' (ти)':'');li.append(d,nm);
    const t=document.createElement('em');t.textContent=p.id===hid?'хост':i>=MAXP+1?'глядач':'';if(t.textContent)li.append(t);list.append(li)});
  const me=(peersNow().find(p=>p.isMe)||{}).id,amHost=!!me&&hid===me;$('hostCtl').hidden=!amHost;$('waitHost').hidden=amHost;
  const two=humans().length>=2;$('monSel').disabled=!two;if(!two)$('monSel').value='bot';
}
function hostStartRound(){
  const all=humans().map(p=>p.id);if(!all.length)return;
  const prev=MP.g,r=(prev?prev.r:0)+1,map=MP.mapSel==='auto'?(r-1)%HW.MAPS.length:+MP.mapSel;
  const pl=[MP.me].concat(all.filter(i=>i!==MP.me)).slice(0,MAXP+(MP.monSel==='player'?1:0));
  // гравець-монстр — по черзі
  let mm='';if(MP.monSel==='player'&&pl.length>=2){const order=pl.slice().sort();mm=order[(MP.monTurn=(MP.monTurn||0)+1)%order.length]}
  const lvl=prev?prev.lvl+(prev.res==='win'&&!prev.mm?1:0):MP.lvlSel;
  MP.g=newG(r,map,Math.random()<0.5?1:0,Math.random()<0.5?1:0,lvl,pl,mm);MP.hostEnd=performance.now()+6000;
}
function hostTick(){
  const g=MP.g;if(!g)return;
  const left=MP.hostEnd-performance.now(),at=ms=>{MP.hostEnd=performance.now()+ms;return ms};
  if(g.ph==='intro'&&left<=0){g.ph='play';g.k++;g.rem=at(30*60000)}
  else if(g.ph==='play'){
    hostEvents();
    // гравець-монстр вийшов — далі монстром керує бот
    if(g.mm&&!peersNow().some(p=>p.id===g.mm)){g.mm='';if(mon){mon.state='patrol';mon.path=null}}
    const e=checkEnd();if(e){g.ph='end';g.k++;g.res=e.res;g.rem=at(9000)}}
  else if(g.ph==='end'&&left<=0)hostStartRound();
  g.rem=Math.max(0,MP.hostEnd-performance.now());
}
function mpTick(dt){
  const hid=hostId();MP.host=hid===MP.me&&!!MP.me;
  if(!MP.me){const mine=peersNow().find(p=>p.isMe);if(mine)MP.me=mine.id}
  {const myp=presOf(MP.me);if(myp){if(MP.host&&!myp.h&&performance.now()-MP.joinedAt>1500)MP.net.presence({h:Date.now()});else if(!MP.host&&myp.h&&humans().some(p=>p.id!==MP.me&&p.presence.h&&+p.presence.h<+myp.h))MP.net.presence({h:null})}}
  if(MP.host){if(!MP.g&&MP.lastG){MP.g=JSON.parse(JSON.stringify(MP.lastG));MP.g.k++;MP.hostEnd=performance.now()+Math.max(1000,MP.lastG.rem);G=MP.g;
    // новий хост не повторює старі події гравців
    auth.last={};for(const p of peersNow()){const ev=(p.presence||{}).ev;if(Array.isArray(ev)&&ev.length)auth.last[p.id]=ev[ev.length-1][0]}if(mon&&!MP.g.mm){mon.state=MP.g.ph==='play'?'patrol':'sleep';mon.path=null}}hostTick()}
  const g=MP.host?MP.g:(presOf(hid)||{}).g;
  if(!MP.host&&g)MP.lastG=g;
  if(phase==='lobby'&&Math.floor(T*4)!==MP.lr){MP.lr=Math.floor(T*4);mpLobbyRender()}
  if(!g)return;
  if(g.r!==MP.round){MP.round=g.r;MP.spectator=!g.pl.includes(MP.me);REQ.ev=[];G=g;setupRound(g);lastKey='';if(mon&&MP.host)mon.state='sleep'}
  G=g;
  const key=g.r+':'+g.k;if(key!==MP.phKey){MP.phKey=key;MP.phEnd=performance.now()+g.rem}
  if(g.ph==='intro'){const n=Math.ceil(timerLeft());if(n!==MP.lastN&&n>0&&n<=3){MP.lastN=n;say(String(n),'num');SFX.beep()}}
  syncPhase();
}
/* позиції: свої — назовні; чужі й монстр — до себе */
function mpFollow(dt){
  if(!G||G.r!==MP.round)return;
  for(const c of chars){if(!c.remote)continue;const p=presOf(c.id);if(!p||typeof p.x!=='number')continue;
    const ox=c.x,oz=c.z,k=Math.min(1,dt*14);if(Math.hypot(p.x-c.x,p.z-c.z)>3){c.x=p.x;c.z=p.z}c.x+=(p.x-c.x)*k;c.z+=(p.z-c.z)*k;
    c.vx=c.vx*0.7+((c.x-ox)/Math.max(dt,1e-3))*0.3;c.vz=c.vz*0.7+((c.z-oz)/Math.max(dt,1e-3))*0.3;
    c.yaw+=angDiff(p.y||0,c.yaw)*Math.min(1,dt*12);c.crouch+=((p.k?1:0)-c.crouch)*Math.min(1,dt*10);c.lightOn=!!p.l;c.battery=p.b==null?100:p.b;c.hidden=p.hd==null?-1:p.hd;c.inserting=!!p.ia}
  // монстр: гравець-монстр шле сам; бота веде хост
  let s=null;
  if(G.mm&&G.mm!==MP.me){const p=presOf(G.mm);if(p&&p.mo&&typeof p.x==='number')s=[p.x,p.z,p.y,p.y,ST.player,'']}
  else if(!G.mm&&!MP.host){const hp=presOf(hostId());if(hp&&Array.isArray(hp.m))s=hp.m}
  if(s&&mon){const k=Math.min(1,dt*12),ox=mon.x,oz=mon.z;if(Math.hypot(s[0]-mon.x,s[1]-mon.z)>3){mon.x=s[0];mon.z=s[1]}
    mon.x+=(s[0]-mon.x)*k;mon.z+=(s[1]-mon.z)*k;mon.vx=(mon.x-ox)/Math.max(dt,1e-3);mon.vz=(mon.z-oz)/Math.max(dt,1e-3);mon.yaw+=angDiff(s[2],mon.yaw)*Math.min(1,dt*10);mon.look+=angDiff(s[3],mon.look)*Math.min(1,dt*10);
    if(s[4]===ST.chase&&mon.stCode!==ST.chase&&s[5]===MP.me){growlFx();pop(mon,'!','#E5484D')}mon.stCode=s[4];mon.tid=s[5]}
  const o={ev:REQ.ev};
  const me=surv()?player:null;
  if(me){o.x=+me.x.toFixed(2);o.z=+me.z.toFixed(2);o.y=+me.yaw.toFixed(2);o.k=me.crouch>0.5?1:0;o.l=me.lightOn?1:0;o.b=Math.round(me.battery);o.hd=me.hidden;o.ia=me.inserting?1:0}
  if(iAmMon()&&mon){o.x=+mon.x.toFixed(2);o.z=+mon.z.toFixed(2);o.y=+mon.yaw.toFixed(2);o.mo=1}else o.mo=null;
  if(MP.host){o.g=MP.g;if(mon&&!G.mm)o.m=[+mon.x.toFixed(2),+mon.z.toFixed(2),+mon.yaw.toFixed(2),+mon.look.toFixed(2),ST[mon.state],mon.target?mon.target.id:''];else o.m=null}
  MP.net.presence(o);
}

/* ---------- заставка в меню ---------- */
const MENU_TEXT='Темний будинок, у ньому щось ходить. Знайди запобіжники, віднеси в щиток, увімкни вихід і тікай.';
function bootScene(){
  phase='menu';G=null;buildWorld(0,false,false);clearChars();clearMon();
  if(itemGroup)scene.remove(itemGroup);items=[];boxSlots(0);
  player=null;newMon(TX(11),TZ(8.6));mon.state='sleep';
  for(let i=0;i<MAXP;i++){if(!beams[i])beams[i]=makeBeam();beams[i].visible=false;FL[i].intensity=0}
  exitPanel.material.color.set('#7A1E22');hemi.intensity=DARK;
  for(const id of['light','crouch','act','dash'])$(id).hidden=true;$('fuseChip').textContent='⚡ '+fuseN(level,1);$('batChip').hidden=true;$('dots').innerHTML='';$('vig').style.opacity=0;$('blind').style.opacity=0;
  $('lvl').textContent='Рівень '+level;
}
bootScene();
$('ovText').textContent=level>1?'Продовжуємо з рівня '+level+': запобіжників '+fuseN(level,1)+', монстр швидший.':MENU_TEXT;
let last=performance.now();
function frame(now){const dt=Math.min(0.1,(now-last)/1000);last=now;
  if(phase==='lobby'){T+=dt;mpTick(dt)}
  if(phase==='menu'||phase==='lobby'){T+=dt;menuScene(dt)}
  else update(dt);
  renderer.render(scene,camera);drawFx(dt);requestAnimationFrame(frame)}
function menuScene(dt){if(!mon)return;mon.look=mon.yaw=Math.PI+Math.sin(T*0.5)*0.7;mon.stCode=0;animMon(mon,dt);
  glow.intensity=0;
  FL[0].intensity=2.4;FL[0].position.set(mon.x-1.5,1.6,mon.z+4);FL[0].target.position.set(mon.x,0.8,mon.z);
  camera.position.set(mon.x+Math.sin(T*0.15)*1.2,6.5,mon.z+6.5);camera.lookAt(mon.x,0.6,mon.z-0.3)}
requestAnimationFrame(frame);

/* для автотестів (bots/local-sim/monster-test.js) */
window.MONGame={get joy(){return joy},get phase(){return phase},get G(){return G},get player(){return player},get mon(){return mon},get chars(){return chars},get items(){return items},get exit(){return exit},get box(){return box},get hides(){return hides},get MP(){return MP},
  get level(){return level},set level(v){level=v},startSolo,sim:s=>{for(let t=0;t<s;t+=1/30)update(1/30)},actCtx,monSees,knock:c=>{c=c||player;if(isAuth())applyDown(c.id);if(mon&&!G.mm)monAfterKnock(mon,c.x,c.z)},
  get hold(){return hold},get map(){return mapIdx},astar,sees:monSees,get blindT(){return blindT},get dashT(){return dashT},myCarry,snap};
})();
