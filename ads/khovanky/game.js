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
function buildWorld(mi,fxp,fzp){
  flipX=fxp;flipZ=fzp;mapIdx=mi;
  if(staticMesh){scene.remove(staticMesh);staticMesh.geometry.dispose()}
  world=HW.build(scene,{map:mi,flipX,flipZ});curW=world.W;curH=world.H;
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
    add(CYL,m('#3A3F4B'),0,0,0.08,0.035,0.16,0.035,torch).rotation.x=Math.PI/2;
    add(CYL,m('#FFF3B0',{emissive:'#FFE38A',emissiveIntensity:0.9}),0,0,0.165,0.045,0.02,0.045,torch,false).rotation.x=Math.PI/2;
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
  click:()=>{tone(120,0.05,{type:'square',vol:0.12});tone(80,0.12,{type:'sine',vol:0.1,delay:0.03})},
  achoo:()=>{tone(700,0.08,{type:'sine',vol:0.05,slide:1.4});tone(500,0.18,{type:'sawtooth',vol:0.04,slide:0.5,delay:0.12})},
};
let musicT=0,musicStep=0;const PENTA=[0,2,4,7,9,12,14,16];
function music(dt){if(muted||!AC||phase==='menu')return;musicT-=dt;if(musicT>0)return;
  const tense=(mode==='hide'&&seeker&&seeker.state==='chase')||(phase==='play'&&timer<10);const base=tense?330:262,beat=tense?0.2:0.34;musicT=beat;musicStep++;
  if(phase==='end')return;
  const n=PENTA[(musicStep*3+Math.floor(musicStep/8)*2)%PENTA.length],f=base*Math.pow(2,n/12);
  if(musicStep%2===0||tense)tone(f,beat*1.6,{type:'triangle',vol:tense?0.035:0.028});
  if(musicStep%8===0)tone(base/2,beat*6,{type:'sine',vol:0.05});
}
$('mute').addEventListener('click',()=>{muted=!muted;$('mute').textContent=muted?'🔇':'🔊';$('mute').setAttribute('aria-label',muted?'Увімкнути звук':'Вимкнути звук');try{localStorage.setItem('hns_mute',muted?'1':'0')}catch(e){}});
$('mute').textContent=muted?'🔇':'🔊';

/* ---------- game state ---------- */
let lightsOff=true,flickerT=0,crouchOn=false,level=1,mode='hide',phase='menu',timer=0,introT=0,T=0,chars=[],player=null,seeker=null,pops=[],confetti=[],stats={},shakeT=0,darkK=0,lastTick=0,achooT=0;
try{level=Math.max(1,parseInt(localStorage.getItem('hns_level'))||1);lightsOff=localStorage.getItem('hns_dark')!=='0'}catch(e){}
$('lightsOff').checked=lightsOff;$('lightsOff').addEventListener('change',e=>{lightsOff=e.target.checked;try{localStorage.setItem('hns_dark',lightsOff?'1':'0')}catch(_){}});
function setCrouch(v){crouchOn=v;$('crouch').querySelector('span').textContent=v?'Встати':'Присісти';$('crouch').setAttribute('aria-pressed',v?'true':'false');$('crouch').classList.toggle('on',v)}
$('crouch').addEventListener('click',()=>{au();if(mode==='hide')setCrouch(!crouchOn)});
addEventListener('keydown',e=>{if((e.key==='c'||e.key==='C'||e.key==='Control')&&mode==='hide'&&!e.repeat)setCrouch(!crouchOn)});

function newChar(role,isPlayer,color,x,z){
  const kind=role==='seeker'?'seeker':isPlayer?'player':'hider';
  const mdl=makeBean(color,kind);mdl.root.scale.setScalar(1.18);scene.add(mdl.root);
  const ch={crouch:0,role,isPlayer,color,x,z,vx:0,vz:0,yaw:Math.PI,look:Math.PI,speed:2.6,path:null,pi:0,mdl,state:'idle',caught:false,cage:null,vis:1,ph:Math.random()*6,blinkT:1+Math.random()*3,stepT:0,alertT:0,cover:0,cheer:0,repathT:0};
  if(isPlayer){const ring=new T3.Mesh(ringGeo,new T3.MeshBasicMaterial({color:role==='seeker'?'#FFE38A':'#FFFFFF',transparent:true,opacity:0.85,depthWrite:false}));ring.position.y=0.03;mdl.root.add(ring);ch.ring=ring}
  chars.push(ch);return ch;
}
function clearChars(){for(const c of chars){scene.remove(c.mdl.root);if(c.cage)scene.remove(c.cage)}chars=[];pops=[]}

function startLevel(){
  const v=Math.floor((level-1)/4)%4;buildWorld(Math.floor((level-1)/2)%2,!!(v&1),!!(v&2));
  clearChars();mode=level%2?'hide':'seek';
  const hx=TX(world.def.spawn[0]),hz=TZ(world.def.spawn[1]);
  if(mode==='hide'){
    seeker=newChar('seeker',false,'#FF5A5F',hx,hz);seeker.range=Math.min(6.2,4.8+level*0.12);seeker.fov=1.25;
    seeker.chase=Math.min(3.45,2.95+level*0.05);seeker.patrol=Math.min(2.8,2.35+level*0.05);seeker.state='count';seeker.visited=[];
    player=newChar('hider',true,'#4C8DFF',...snap(hx-1.4,hz+0.6));player.speed=3.6;
    const n=Math.min(5,2+Math.floor(level/2));for(let i=0;i<n;i++){const a=i/n*6.283;newChar('hider',false,COLORS[i%COLORS.length],...snap(hx+Math.cos(a)*1.3,hz+Math.sin(a)*0.5))}
    timer=lightsOff?120:Math.min(45,28+level*1.5);introT=5;
  }else{
    seeker=player=newChar('seeker',true,'#FF5A5F',hx,hz);player.speed=3.5;player.range=5.6;player.fov=1.45;player.state='count';
    const n=Math.min(6,3+Math.floor(level/3));for(let i=0;i<n;i++){const a=i/n*6.283;newChar('hider',false,COLORS[i%COLORS.length],...snap(hx+Math.cos(a)*1.3,hz+Math.sin(a)*0.5))}
    timer=120;introT=4.5;
  }
  const hiders=chars.filter(c=>c.role==='hider'&&!c.isPlayer),fs=Math.min(3.3,2.75+level*0.04);
  // spread bots over different rooms
  const rooms=[...new Set(spots.map(s=>s.room))].sort(()=>Math.random()-0.5),taken=[];
  hiders.forEach((h,i)=>{h.flee=fs;const room=rooms[i%rooms.length];
    const cand=spots.filter(s=>s.room===room&&taken.every(t=>Math.hypot(t.x-s.x,t.z-s.z)>2)).sort((a,b)=>b.score-a.score+(Math.random()-.5)*6);
    const sp=cand[0]||spots[Math.floor(Math.random()*spots.length)];taken.push(sp);h.spot=sp;h.state='toSpot';h.speed=3.0;h.path=astar(h.x,h.z,sp.x,sp.z);h.pi=0});
  stats={caught:0,freed:0,total:hiders.length+(mode==='hide'?1:0),time:timer};
  phase='intro';darkK=0;achooT=12;lastTick=0;rescuer=null;
  for(const c of chars){c.yaw=c===seeker?0:Math.PI;c.look=c.yaw}
  seeker.yaw=seeker.look=Math.PI;seeker.cover=1;
  coneMat.uniforms.color.value.set(mode==='hide'?'#FF4D5E':'#FFE6A0');coneMat.blending=mode==='hide'?T3.NormalBlending:T3.AdditiveBlending;coneMat.uniforms.opacity.value=mode==='hide'?0.5:0.3;coneMat.needsUpdate=true;
  camBlend=0;
  setCrouch(false);$('crouch').hidden=mode!=='hide';
  $('ov').hidden=true;$('ovBtn').hidden=false;$('ovLeave').hidden=true;$('timer').hidden=false;$('modeChip').textContent=mode==='hide'?'Ховайся':'Шукай';$('modeChip').className='chip mode '+mode;
  $('lvl').textContent='Рівень '+level+' · '+world.def.name;renderDots();
  say(mode==='hide'?'Ховайся!':'Рахую до трьох…','big');SFX.beep();
  const tip=$('tip');tip.textContent=mode==='hide'?'Тікай і сховайся, поки шукач рахує':'Хованці розбігаються. Шукай їх променем ліхтарика';tip.hidden=false;tip.classList.remove('fade');void tip.offsetWidth;tip.classList.add('fade');
}
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

/* ---------- AI ---------- */
function fleeTarget(h,s){
  let best=null,bs=-1e9;
  for(let k=0;k<40;k++){const a=Math.random()*6.283,r=2.5+Math.random()*6,[x,z]=snap(h.x+Math.cos(a)*r,h.z+Math.sin(a)*r);
    const ds=Math.hypot(x-s.x,z-s.z),dh=Math.hypot(x-h.x,z-h.z),toward=((x-h.x)*(s.x-h.x)+(z-h.z)*(s.z-h.z))/(dh*Math.hypot(s.x-h.x,s.z-h.z)+1e-6);
    let sc=ds-dh*0.3-(toward>0.35?6:0)+(los(s.x,s.z,x,z)?-3:1.5);
    if(sc>bs){bs=sc;best=[x,z]}}
  return best;
}
/* a good nook near me, away from the seeker */
function nookFor(h,s){
  let best=null,bs=-1e9;
  for(let k=0;k<60;k++){const sp=spots[Math.floor(Math.random()*spots.length)];if(!sp)break;
    const dh=Math.hypot(sp.x-h.x,sp.z-h.z),ds=Math.hypot(sp.x-s.x,sp.z-s.z);if(dh>9||ds<5)continue;
    const sc=sp.score*0.6+ds*0.8-dh*0.5-(los(s.x,s.z,sp.x,sp.z)?4:0)-(chars.some(c=>c!==h&&!c.caught&&c.role==='hider'&&c.spot===sp)?6:0);
    if(sc>bs){bs=sc;best=sp}}
  return best;
}
let rescuer=null;
function hiderAI(h,dt){
  if(h.caught){if(rescuer===h)rescuer=null;return}
  const s=seeker,d=Math.hypot(s.x-h.x,s.z-h.z);
  if(phase==='intro'){steerPath(h,dt,h.speed);return}
  const seen=s.state!=='count'&&sees(s,h);
  h.cool=(h.cool||0)-dt;
  if(seen&&h.state!=='flee'){pop(h,'!','#FFD23F');if(mode==='seek')SFX.spot()}
  h.repathT-=dt;
  if((seen||d<2.2)&&h.repathT<=0){
    if(rescuer===h){rescuer=null;h.cool=12}
    const t=fleeTarget(h,s);if(t){h.path=astar(h.x,h.z,t[0],t[1]);h.pi=0}h.state='flee';h.repathT=seen?0.9:1.4}
  if(h.state==='flee'){
    const done=steerPath(h,dt,h.flee);if(Math.random()<dt*7)puff(h.x,h.z,0.08,0.5);
    // once out of sight, slip into a proper nook instead of freezing in the open
    if(done&&!seen&&d>3.2){const sp=nookFor(h,s);if(sp){h.spot=sp;h.path=astar(h.x,h.z,sp.x,sp.z);h.pi=0;h.state='toSpot'}else{h.state='hidden';h.restT=3}}
    return}
  if(h.state==='rescue'){
    const t=h.target,abort=()=>{rescuer=null;h.cool=10+Math.random()*6;const sp=nookFor(h,s);if(sp){h.spot=sp;h.path=astar(h.x,h.z,sp.x,sp.z);h.pi=0;h.state='toSpot'}else h.state='hidden'};
    if(!t||!t.caught){abort();return}
    // give up if the seeker comes back toward me or the cage
    if(Math.hypot(s.x-t.x,s.z-t.z)<5||d<4.5){abort();return}
    if(Math.hypot(t.x-h.x,t.z-h.z)<0.8){if(MP.on)MP.bf.add(t.id);else free(t,h);rescuer=null;h.cool=8;h.state='flee';h.repathT=0;return}
    steerPath(h,dt,h.flee);return}
  const arrived=steerPath(h,dt,h.speed);if(h.state==='toSpot'&&arrived){h.state='hidden';h.restT=3+Math.random()*4}
  if(h.state==='hidden'){h.restT-=dt;
    if(h.restT<=0){h.restT=2.5+Math.random()*3;
      if((mode==='hide'||MP.on)&&!rescuer&&h.cool<=0){
        // only one rescuer at a time, only when the seeker is far from both the cage and me
        const cagedF=chars.filter(c=>c.caught&&c!==h&&!c.isPlayer&&Math.hypot(s.x-c.x,s.z-c.z)>8&&Math.hypot(c.x-h.x,c.z-h.z)<10).sort((a,b)=>Math.hypot(a.x-h.x,a.z-h.z)-Math.hypot(b.x-h.x,b.z-h.z))[0]
          ||chars.find(c=>c.caught&&c.isPlayer&&Math.hypot(s.x-c.x,s.z-c.z)>8&&Math.hypot(c.x-h.x,c.z-h.z)<10);
        if(cagedF&&d>7&&Math.random()<0.4){h.state='rescue';h.target=cagedF;rescuer=h;h.path=astar(h.x,h.z,cagedF.x,cagedF.z);h.pi=0}else h.cool=4}}}
}
function seekerAI(s,dt){
  if(s.state==='count'){s.vx*=0.8;s.vz*=0.8;return}
  // pick the nearest hider we can see
  let tgt=null,bd=1e9;for(const h of chars)if(h.role==='hider'&&!h.caught&&sees(s,h)){const d=Math.hypot(h.x-s.x,h.z-s.z);if(d<bd){bd=d;tgt=h}}
  if(tgt){if(s.state!=='chase'){pop(s,'!','#FF5A5F');SFX.spot();s.repathT=0}s.state='chase';s.target=tgt;s.lastSeen=[tgt.x,tgt.z];s.lostT=0}
  // hearing: running close by gives you away; sneaking (small joystick tilt) does not
  if(s.state==='patrol'||s.state==='look'){s.hearCd=(s.hearCd||0)-dt;
    if(s.hearCd<=0)for(const h of chars){if(h.role!=='hider'||h.caught)continue;const d=Math.hypot(h.x-s.x,h.z-s.z),sp=Math.hypot(h.vx,h.vz);
      if(d<3.4&&sp>2.5&&h.crouch<0.5){pop(s,'?','#FFD23F');s.state='search';s.lastSeen=[h.x,h.z];s.path=astar(s.x,s.z,h.x,h.z);s.pi=0;s.hearCd=2.5;break}}}
  if(s.state==='chase'){
    s.repathT-=dt;if(!tgt)s.lostT+=dt;
    if(s.lostT>1.3){s.state='search';s.path=astar(s.x,s.z,s.lastSeen[0],s.lastSeen[1]);s.pi=0}
    else if(s.repathT<=0){const t=s.target;s.path=astar(s.x,s.z,tgt?t.x:s.lastSeen[0],tgt?t.z:s.lastSeen[1]);s.pi=0;s.repathT=0.3}
    steerPath(s,dt,s.chase);s.look=s.yaw;return;
  }
  if(s.state==='look'){s.lookT-=dt;s.vx*=0.85;s.vz*=0.85;s.look=s.lookBase+Math.sin((1.6-s.lookT)*3.2)*1.15;if(s.lookT<=0){s.state='patrol';s.path=null}return}
  if(!s.path||s.pi>=s.path.length){
    if(s.state==='search'||s.path){s.state='look';s.lookT=1.6;s.lookBase=s.yaw;s.path=null;return}
    const opts=waypoints.filter(w=>!s.visited.some(v=>v===w)&&Math.hypot(w[0]-s.x,w[1]-s.z)>2.5);
    const pickFrom=opts.length?opts:waypoints;const w=pickFrom[Math.floor(Math.random()*pickFrom.length)];
    s.visited.push(w);if(s.visited.length>5)s.visited.shift();
    s.path=astar(s.x,s.z,w[0],w[1]);s.pi=0;s.state='patrol';
  }
  steerPath(s,dt,s.state==='search'?s.chase*0.85:s.patrol);
  s.look=s.yaw+(reduce?0:Math.sin(T*1.7)*0.32);
}
function catchHider(h){
  if(h.caught)return;
  if(!MP.on&&seeker&&!seeker.isPlayer){seeker.state='look';seeker.lookT=0.9;seeker.lookBase=seeker.yaw;seeker.path=null;seeker.target=null;seeker.visited.push(waypoints.reduce((a,w)=>Math.hypot(w[0]-h.x,w[1]-h.z)<Math.hypot(a[0]-h.x,a[1]-h.z)?w:a,waypoints[0]))}h.caught=true;h.vx=h.vz=0;h.path=null;h.state='caught';stats.caught++;
  h.cage=makeCage();h.cage.position.set(h.x,3.4,h.z);h.cageT=0;pop(h,mode==='seek'?'+1':'Ой!',mode==='seek'?'#4CC97A':'#FF5A5F');
  SFX.catch();try{navigator.vibrate&&navigator.vibrate(40)}catch(e){}
  renderDots();
  if(h.isPlayer)endLevel(false);
  else if(mode==='seek'&&chars.every(c=>c.role!=='hider'||c.caught))endLevel(true);
}
function free(h,by){
  if(!h.caught)return;h.caught=false;h.state='flee';h.repathT=0;h.freeT=1;h.cageLift=h.cage;h.cage=null;stats.caught--;if(by&&by.isPlayer)stats.freed++;
  pop(h,'Дякую!','#4CC97A');SFX.free();renderDots();
}

/* ---------- pops ---------- */
function pop(ch,text,color){pops.push({ch,text,color,t:0})}

/* ---------- flow ---------- */
function endLevel(won){
  if(phase!=='play')return;phase='end';joy=null;$('crouch').hidden=true;setCrouch(false);
  const n=stats.total-(mode==='hide'?1:0);
  if(won){(mode==='hide'?player:seeker).cheer=1;SFX.win();for(let i=0;i<120;i++)confetti.push({x:W/2+(Math.random()-.5)*W*0.8,y:H*0.3+(Math.random()-.5)*60,vx:(Math.random()-.5)*420,vy:-150-Math.random()*380,l:2.6,c:COLORS[i%COLORS.length],r:Math.random()*6})}
  else SFX.lose();
  let title,text,stars=0;
  if(mode==='hide'){
    const freeNow=chars.filter(c=>c.role==='hider'&&!c.isPlayer&&!c.caught).length;
    if(won){title='Тебе не знайшли!';stars=1+(freeNow>=Math.ceil(n/2)?1:0)+(stats.freed>0||freeNow===n?1:0);text='Вільних друзів: '+freeNow+' з '+n+(stats.freed?'. Ти врятував '+stats.freed+'.':'.')}
    else{title='Попався!';text='Протримався '+Math.floor(stats.time-timer)+' с з '+Math.round(stats.time)+'. Ховайся за шафами й високими меблями: крізь них не видно.'}
  }else{
    if(won){title='Знайшов усіх!';const k=timer/120;stars=k>0.45?3:k>0.2?2:1;text='Залишилось '+Math.ceil(timer)+' с. Наступного разу хованці будуть спритніші.'}
    else{title='Час вийшов';text='Знайдено '+stats.caught+' з '+n+'. Перевіряй кути й місця за високими меблями.'}
  }
  if(won){level++;try{localStorage.setItem('hns_level',level)}catch(e){}}
  setTimeout(()=>{$('ovTitle').textContent=title;$('ovText').textContent=text;$('stars').hidden=!won;$('stars').innerHTML=[0,1,2].map(i=>'<span class="'+(i<stars?'on':'')+'">★</span>').join('');
    $('ovHint').hidden=true;document.querySelector('.card .hint').hidden=true;$('ovBtn').textContent=won?'Далі':'Ще раз';$('ovTitle').classList.toggle('lose',!won);$('ov').hidden=false;setTimeout(()=>$('ovBtn').focus({preventScroll:true}),50)},won?1500:1200);
}

/* ---------- main update ---------- */
let camBlend=0;const camPos=new T3.Vector3(),camLook=new T3.Vector3();
function update(dt){
  T+=dt;
  if(MP.on)mpTick(dt);
  else if(phase==='intro'){
    const before=Math.ceil(introT);introT-=dt;const now=Math.ceil(introT);
    if(now!==before&&now>0&&now<=3){say(String(now),'num');SFX.beep()}
    if(introT<=0){phase='play';seeker.state=mode==='hide'?'patrol':'idle';seeker.cover=0;
      if(mode==='hide'&&lightsOff){say('Світло вимкнули!','big go');flickerT=0.8;SFX.click()}else say(mode==='hide'?'Шукаю!':'Шукай!','big go');SFX.go();
      if(mode==='hide')seeker.path=null}
  }else if(phase==='play'){
    timer-=dt;
    if(timer<=10&&Math.ceil(timer)!==lastTick){lastTick=Math.ceil(timer);SFX.tick()}
    if(timer<=0){timer=0;endLevel(mode==='hide')}
  }
  // player control
  if(player&&!player.caught&&!(MP.on&&MP.spectator)){
    let ix=0,iz=0;
    if(joy){const dx=joy.x-joy.sx,dy=joy.y-joy.sy,m=Math.hypot(dx,dy);if(m>6){const k=Math.min(1,m/55);ix=dx/m*k;iz=dy/m*k}}
    if(keys.a||keys.arrowleft)ix-=1;if(keys.d||keys.arrowright)ix+=1;if(keys.w||keys.arrowup)iz-=1;if(keys.s||keys.arrowdown)iz+=1;
    const im=Math.hypot(ix,iz);if(im>1){ix/=im;iz/=im}
    const frozen=phase==='end'||(mode==='seek'&&phase==='intro')||phase==='menu';
    player.crouch+=((crouchOn&&mode==='hide'?1:0)-player.crouch)*Math.min(1,dt*12);
    const sp=frozen?0:player.speed*(1-0.55*player.crouch);
    player.vx+=(ix*sp-player.vx)*Math.min(1,dt*11);player.vz+=(iz*sp-player.vz)*Math.min(1,dt*11);
    if(mode==='seek')player.look=player.yaw;
  }
  if(phase==='intro'||phase==='play'){
    if(!MP.on||MP.host)for(const c of chars){if(c.role==='hider'&&!c.isPlayer&&!c.remote)hiderAI(c,dt)}
    if(mode==='hide'&&!MP.on)seekerAI(seeker,dt);
  }
  const steps=dt>0.03?2:1;for(let k=0;k<steps;k++)for(const c of chars)if(!c.remote&&!c.netBot)integrate(c,dt/steps);
  if(MP.on)mpFollow(dt);
  // catches and rescues
  if(phase==='play'&&!MP.on){
    for(const h of chars){if(h.role!=='hider'||h.caught)continue;if(Math.hypot(h.x-seeker.x,h.z-seeker.z)<0.62)catchHider(h)}
    if(mode==='hide'&&!player.caught)for(const h of chars)if(h.caught&&h!==player&&Math.hypot(h.x-player.x,h.z-player.z)<0.8)free(h,player);
    if(mode==='seek'){achooT-=dt;if(achooT<=0){achooT=11;const hid=chars.filter(c=>c.role==='hider'&&!c.caught&&c.vis<0.5);if(hid.length){const h=hid[Math.floor(Math.random()*hid.length)];pop(h,'Апчхи!','#A779F2');h.achoo=1.4;SFX.achoo()}}}
  }
  // seek-mode fog: hiders show only inside your beam or right next to you
  for(const h of chars){if(h.role!=='hider')continue;
    let target=1;if(mode==='seek'&&phase==='play'&&!h.caught)target=(sees(player,h)||Math.hypot(h.x-player.x,h.z-player.z)<1.3)?1:0;
    if(h.achoo>0){h.achoo-=dt;target=Math.max(target,0.55)}
    h.vis+=(target-h.vis)*Math.min(1,dt*(target>h.vis?10:4))}
  // footsteps + dust
  for(const c of chars){const sp=Math.hypot(c.vx,c.vz);c.stepT-=dt*sp;if(sp>1.8&&c.stepT<=0){c.stepT=0.55;if(c.vis>0.5)puff(c.x-c.vx*0.05,c.z-c.vz*0.05,0.07,0.35);if(c.isPlayer)SFX.step()}}
  for(const c of chars)if(!c.isPlayer&&c.role==='hider'){const want=(c.state==='hidden'||c.state==='toSpot'&&!c.path)&&phase==='play'?1:0;c.crouch+=(want-c.crouch)*Math.min(1,dt*8)}
  for(const c of chars)animate(c,dt);
  // cages
  for(const c of chars){
    if(c.cage){c.cageT+=dt;const t=Math.min(1,c.cageT/0.55),y=3.4*(1-t*t);let b=0;if(t>=1){const u=(c.cageT-0.55)*7;b=u<Math.PI?Math.sin(u)*0.12*Math.exp(-u*0.6):0}
      c.cage.position.set(c.x,Math.max(0,y)+b,c.z);if(t>=1&&!c.cageLanded){c.cageLanded=true;puffRing(c.x,c.z);SFX.cage();shakeT=0.18}}
    if(c.cageLift){c.cageLift.position.y+=dt*5;c.cageLift.rotation.y+=dt*4;if(c.cageLift.position.y>5){scene.remove(c.cageLift);c.cageLift=null}c.cageLanded=false}
  }
  updPuffs(dt);
  if(darkK>0.5&&player)for(const c of chars){if(c===player||c.caught||(c.crouch||0)>0.5)continue;const sp=Math.hypot(c.vx,c.vz);if(sp<1.1)continue;
    const d=Math.hypot(c.x-player.x,c.z-player.z);if(d>6.5)continue;c.ripT=(c.ripT||0)-dt;if(c.ripT<=0){c.ripT=0.42;ripple(c.x,c.z,c.role==='seeker'?'#FF5A5F':c.color)}}
  updRipples(dt);
  // cone + flashlight + darkness
  const coneOwner=seeker;cone.visible=phase!=='menu'&&coneOwner.state!=='count'&&coneOwner.cover<0.5;
  if(cone.visible)updateCone(coneOwner);
  const wantDark=phase==='play'&&(mode==='seek'||(MP.on?lightsOffRound:lightsOff))?1:0;darkK+=(wantDark-darkK)*Math.min(1,dt*(wantDark?6:1.5));
  let dk=darkK;if(flickerT>0){flickerT-=dt;dk=(reduce?flickerT<0.4:Math.random()<0.5)?0.1:1;if(flickerT<=0)dk=darkK}
  const hideDark=mode==='hide';
  hemi.intensity=0.52-(hideDark?0.4:0.37)*dk;sun.intensity=0.62-(hideDark?0.56:0.5)*dk;
  const fo=seeker;flash.intensity=(hideDark?1.9:1.55)*dk;flash.position.set(fo.x,1.4,fo.z);flash.target.position.set(fo.x+Math.sin(fo.look)*3,0,fo.z+Math.cos(fo.look)*3);flash.distance=fo.range?fo.range+1.5:8;
  glow.intensity=hideDark?0.9*dk:0;glow.position.set(player.x,1.1,player.z);
  // camera
  const a=W/H,far=a<0.8?1.3:1;
  const fol=player,ox=0,oy=9.2*far,oz=6.6*far;
  const want=new T3.Vector3(fol.x+ox,oy,fol.z+oz),lookAt=new T3.Vector3(fol.x,0,fol.z-0.4);
  if(phase==='intro'){const s=seeker;const ov=new T3.Vector3(s.x,15*far,s.z+10.5*far),ol=new T3.Vector3(s.x,0,s.z-1);
    const k=Math.max(0,Math.min(1,1-(introT-0.4)/(mode==='hide'?4.6:4.1)));want.lerpVectors(ov,want,k*k*(3-2*k));lookAt.lerpVectors(ol,lookAt,k*k*(3-2*k))}
  camPos.lerp(want,Math.min(1,dt*(camBlend<1?60:5)));camLook.lerp(lookAt,Math.min(1,dt*(camBlend<1?60:6)));camBlend=1;
  camera.position.copy(camPos);if(shakeT>0&&!reduce){shakeT-=dt;camera.position.x+=(Math.random()-.5)*0.12;camera.position.y+=(Math.random()-.5)*0.08}
  camera.lookAt(camLook);
  // HUD
  if(phase==='play'||phase==='intro'){const t=Math.ceil(phase==='intro'?timer:timer);$('timer').textContent=Math.floor(t/60)+':'+String(t%60).padStart(2,'0');$('timer').classList.toggle('hot',phase==='play'&&timer<=10)}
}

/* ---------- character animation ---------- */
function animate(c,dt){
  const m=c.mdl,sp=Math.hypot(c.vx,c.vz),k=Math.min(1,sp/2.6);
  m.root.position.set(c.x,0,c.z);m.root.rotation.y=c.yaw;
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
  const v=c.vis;m.root.visible=v>0.02;
  for(const mm of m.mats){const tr=v<0.99;if(mm.transparent!==tr){mm.transparent=tr;mm.needsUpdate=true}mm.opacity=v}
}

/* ---------- overlay: pops, joystick, confetti ---------- */
const FONT='"Baloo 2","Arial Rounded MT Bold",sans-serif';
const _p=new T3.Vector3();
function drawFx(dt){
  fctx.clearRect(0,0,W,H);
  for(const p of pops){p.t+=dt;if(p.t>1.3||(p.ch.vis<0.3&&p.text!=='Апчхи!'))continue;_p.set(p.ch.x,1.25,p.ch.z).project(camera);if(_p.z>1)continue;
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
    if(mode==='hide'){for(const c of chars)if(c.caught&&!c.isPlayer)targets.push([c,'#F2C94C']);if(seeker.state==='chase'&&seeker.target===player)targets.push([seeker,'#FF5A5F'])}
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
  async join(code){const nr=await this.r.join('hns-'+code);return{presence:p=>nr.presence(p).catch(()=>{}),
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
  MP.net.presence({n:MP.nick,c:MP.color,h:create?Date.now():null,g:null,b:null,cg:null,f:null});
  $('roomCode').textContent=code.toUpperCase();$('mpA').hidden=true;$('mpB').hidden=false;
  phase='lobby';mpLobbyRender();
}
function mpLeave(){if(MP.net)MP.net.leave();MP.net=null;MP.on=false;MP.host=false;MP.g=null;MP.lastG=null;MP.me=null;phase='menu';$('ovBtn').hidden=false;$('ovBtn').textContent='Грати';$('ovLeave').hidden=true;$('ovTitle').textContent='Хованки';$('ovTitle').classList.remove('lose');$('ovHint').hidden=false;document.querySelector('.card .hint').hidden=false;clearChars();$('mp').hidden=true;$('ov').hidden=false;$('crouch').hidden=true;$('timer').hidden=true;
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
  MP.g={r,ph:'intro',k:1,map,fx:Math.random()<0.5?1:0,fz:Math.random()<0.5?1:0,sk:pl[(r-1)%pl.length],pl,bots:MP.botCount,dark:lightsOff?1:0,rem:5000,dur:lightsOff?120:Math.round(40+8*(pl.length-1+MP.botCount)),res:null};
  MP.hostEnd=performance.now()+5000;
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
  if(G.ph==='intro'){const n=Math.ceil(timer);if(n!==MP.lastN&&n<=3&&n>0){MP.lastN=n;say(String(n),'num');SFX.beep()}}
}
function mpSetupRound(G){
  const v=G;buildWorld(v.map,!!v.fx,!!v.fz);clearChars();
  MP.spectator=!G.pl.includes(MP.me);mode=G.sk===MP.me?'seek':'hide';lightsOffRound=!!G.dark;
  MP.cg=new Set();MP.bf=new Set();rescuer=null;
  const sx=TX(world.def.spawn[0]),sz=TZ(world.def.spawn[1]);
  G.pl.forEach((id,i)=>{const p=presOf(id)||{},isSk=id===G.sk,a=i/Math.max(1,G.pl.length)*6.283;
    const [x,z]=isSk?[sx,sz]:snap(sx+Math.cos(a)*1.4,sz+Math.sin(a)*0.7);
    const c=newChar(isSk?'seeker':'hider',id===MP.me,isSk?'#FF5A5F':PCOL[(p.c|0)%PCOL.length],x,z);c.id=id;c.nick=String(p.n||'').slice(0,14);
    if(id!==MP.me)c.remote=true;
    if(isSk){c.range=5.6;c.fov=1.45;c.speed=3.5;c.state='count';c.cover=1;seeker=c}else c.speed=3.6;
    if(id===MP.me)player=c});
  for(let i=0;i<G.bots;i++){const a=(i+0.5)/Math.max(1,G.bots)*6.283;const c=newChar('hider',false,COLORS[i%COLORS.length],...snap(sx+Math.cos(a)*1.2,sz+Math.sin(a)*0.5));c.id='b'+i;c.nick='';
    if(!MP.host)c.netBot=true;else{c.flee=2.9;c.speed=3.0}}
  if(MP.spectator)player=seeker;
  if(MP.host){const rooms=[...new Set(spots.map(s=>s.room))].sort(()=>Math.random()-0.5),taken=[];
    chars.filter(c=>c.id&&c.id[0]==='b').forEach((h,i)=>{const room=rooms[i%rooms.length];const cand=spots.filter(s=>s.room===room&&taken.every(t=>Math.hypot(t.x-s.x,t.z-s.z)>2)).sort((a,b)=>b.score-a.score+(Math.random()-.5)*6);
      const sp=cand[0]||spots[Math.floor(Math.random()*spots.length)];taken.push(sp);h.spot=sp;h.state='toSpot';h.path=astar(h.x,h.z,sp.x,sp.z);h.pi=0})}
  for(const c of chars){c.yaw=c.look=Math.PI}
  stats={caught:0,freed:0,total:chars.filter(c=>c.role==='hider').length,time:G.dur};
  coneMat.uniforms.color.value.set(mode==='hide'?'#FF4D5E':'#FFE6A0');coneMat.blending=mode==='hide'?T3.NormalBlending:T3.AdditiveBlending;coneMat.uniforms.opacity.value=mode==='hide'?0.5:0.3;coneMat.needsUpdate=true;
  camBlend=0;darkK=0;setCrouch(false);$('crouch').hidden=mode!=='hide'||MP.spectator;
  $('mp').hidden=true;$('ov').hidden=true;$('timer').hidden=false;
  $('modeChip').textContent=MP.spectator?'Глядач':mode==='hide'?'Ховайся':'Шукай';$('modeChip').className='chip mode '+(MP.spectator?'':mode);
  $('lvl').textContent='Кімната '+MP.code.toUpperCase()+' · раунд '+G.r;renderDots();
}
let lightsOffRound=true;
function mpPhase(G){
  if(G.ph==='intro'){phase='intro';MP.lastN=0;say(MP.spectator?'Раунд почався':mode==='seek'?'Ти шукаєш!':'Ховайся!','big');SFX.beep();
    const tip=$('tip');tip.textContent=MP.spectator?'Ти глядач. Приєднаєшся в наступному раунді':mode==='seek'?'Рахуєш до п’яти. Потім шукай усіх променем':'Тікай і сховайся, поки '+(seeker.nick||'шукач')+' рахує';tip.hidden=false;tip.classList.remove('fade');void tip.offsetWidth;tip.classList.add('fade')}
  if(G.ph==='play'){phase='play';seeker.state='idle';seeker.cover=0;
    if(mode==='hide'&&lightsOffRound){say('Світло вимкнули!','big go');flickerT=0.8;SFX.click()}else say(mode==='seek'?'Шукай!':'Шукаю!','big go');SFX.go()}
  if(G.ph==='end'){phase='end';joy=null;$('crouch').hidden=true;
    const seekWon=G.res==='seek',iWon=MP.spectator?null:(mode==='seek')===seekWon;
    if(G.res==='left'){$('ovTitle').textContent='Шукач вийшов';$('ovText').textContent='Раунд скасовано. Наступний почнеться за кілька секунд.'}
    else{$('ovTitle').textContent=seekWon?(seeker.nick||'Шукач')+' знайшов усіх!':'Хованці перемогли!';
      const free=chars.filter(c=>c.role==='hider'&&!c.caught).map(c=>c.nick).filter(Boolean);
      $('ovText').textContent=seekWon?'Ніхто не втік. Наступний раунд за кілька секунд, шукач зміниться.':'Не знайшли: '+(free.join(', ')||'боти')+'. Наступний раунд за кілька секунд.'}
    if(iWon){SFX.win();(mode==='hide'?player:seeker).cheer=1;for(let i=0;i<90;i++)confetti.push({x:W/2+(Math.random()-.5)*W*0.8,y:H*0.3,vx:(Math.random()-.5)*420,vy:-150-Math.random()*380,l:2.6,c:COLORS[i%COLORS.length],r:Math.random()*6})}else if(iWon===false)SFX.lose();
    $('ovTitle').classList.toggle('lose',iWon===false);$('stars').hidden=true;$('ovHint').hidden=true;document.querySelector('.card .hint').hidden=true;
    $('ovBtn').hidden=!MP.host;$('ovBtn').textContent='Наступний раунд';$('ovLeave').hidden=false;$('ov').hidden=false}
}
/* positions in, positions out; caught list owned by the seeker */
function mpFollow(dt){
  const G=MP.host?MP.g:(presOf(hostId())||{}).g;if(!G||G.ph==='lobby'||G.r!==MP.round)return;
  const hp=MP.host?null:presOf(hostId());
  for(const c of chars){
    let s=null;
    if(c.remote){const p=presOf(c.id);if(p&&typeof p.x==='number')s=[p.x,p.z,p.y,p.k]}
    else if(c.netBot&&hp&&Array.isArray(hp.b))s=hp.b[+c.id.slice(1)];
    if(!s)continue;
    const ox=c.x,oz=c.z,k=Math.min(1,dt*14);c.x+=(s[0]-c.x)*k;c.z+=(s[1]-c.z)*k;
    c.vx=c.vx*0.7+((c.x-ox)/Math.max(dt,1e-3))*0.3;c.vz=c.vz*0.7+((c.z-oz)/Math.max(dt,1e-3))*0.3;
    c.yaw+=angDiff(s[2]||0,c.yaw)*Math.min(1,dt*12);if(c.role==='seeker')c.look=c.yaw;c.crouch+=((s[3]?1:0)-c.crouch)*Math.min(1,dt*10);
  }
  // the seeker decides who is caught; touching a cage asks the seeker to let them out
  const iSeek=seeker&&seeker.id===MP.me;
  if(iSeek&&phase==='play'){
    for(const h of chars){if(h.role!=='hider'||MP.cg.has(h.id))continue;if(Math.hypot(h.x-seeker.x,h.z-seeker.z)<0.66)MP.cg.add(h.id)}
    for(const p of peersNow()){const pr=p.presence||{},asks=(pr.f||[]).concat(pr.bf||[]);
      if(asks.length&&(p.id===hostId()||!MP.cg.has(p.id)))for(const id of asks)if(MP.cg.has(id)&&(pr.bf||[]).concat(pr.f||[]).includes(id))MP.cg.delete(id)}
  }
  const cg=iSeek?MP.cg:new Set((presOf(seeker&&seeker.id)||{}).cg||[]);
  for(const c of chars){if(c.role!=='hider')continue;const want=cg.has(c.id);
    if(want&&!c.caught)mpCatchFx(c);else if(!want&&c.caught)free(c,null)}
  // what I send
  const me=player&&!MP.spectator?player:null,out={};
  if(me){out.x=+me.x.toFixed(2);out.z=+me.z.toFixed(2);out.y=+(me.role==='seeker'?me.look:me.yaw).toFixed(2);out.k=me.crouch>0.5?1:0;
    out.f=me.role==='hider'&&!me.caught?chars.filter(c=>c.caught&&c!==me&&Math.hypot(c.x-me.x,c.z-me.z)<0.85).map(c=>c.id):[];
    if(iSeek)out.cg=[...MP.cg]}
  if(MP.host){out.g=MP.g;out.b=chars.filter(c=>c.id&&c.id[0]==='b').sort((a,b)=>+a.id.slice(1)-+b.id.slice(1)).map(c=>[+c.x.toFixed(2),+c.z.toFixed(2),+c.yaw.toFixed(2),c.crouch>0.5?1:0]);out.bf=[...MP.bf];if(T-(MP.bfT||0)>1.2){MP.bf.clear();MP.bfT=T}}
  MP.net.presence(out);
}
function mpCatchFx(h){
  h.caught=true;h.vx=h.vz=0;h.path=null;h.state='caught';stats.caught++;
  h.cage=makeCage();h.cage.position.set(h.x,3.4,h.z);h.cageT=0;pop(h,h===player?'Ой!':'+1',h===player?'#FF5A5F':'#4CC97A');SFX.catch();renderDots();
}
/* ---------- boot ---------- */
buildWorld(0,false,false);
player=seeker=newChar('seeker',false,'#FF5A5F',TX(11),TZ(8.6));seeker.range=5;seeker.fov=1.25;seeker.state='idle';seeker.cover=0;seeker.look=seeker.yaw=Math.PI*0.9;
for(let i=0;i<3;i++)newChar('hider',false,COLORS[i],...snap(TX(9+i*2),TZ(9.3)));
camPos.set(11,12,17);camLook.set(11,0,8.5);
$('lvl').textContent='Рівень '+level;$('modeChip').textContent=level%2?'Ховайся':'Шукай';$('modeChip').className='chip mode '+(level%2?'hide':'seek');$('timer').hidden=true;
if(level>1)$('ovText').textContent='Продовжуємо з рівня '+level+'. Цього разу: '+(level%2?'ховаєшся ти.':'шукаєш ти.');
let last=performance.now();
function frame(now){const dt=Math.min(0.1,(now-last)/1000);last=now;
  if(phase==='lobby'){T+=dt;mpTick(dt)}
  if(phase==='menu'||(phase==='lobby'&&seeker&&!MP.g)){if(phase==='menu')T+=dt;seeker.look=seeker.yaw=Math.PI+Math.sin(T*0.8)*0.9;updateCone(seeker);cone.visible=true;for(const c of chars)animate(c,dt);
    const a=W/H,far=a<0.8?1.3:1;camera.position.set(TX(11)+Math.sin(T*0.15)*1.5,9.5*far,TZ(8.6)+7.5*far);camera.lookAt(TX(11),0,TZ(8.6)-0.6)}
  else if(phase!=='lobby')update(dt);
  music(dt);
  renderer.render(scene,camera);drawFx(dt);requestAnimationFrame(frame)}
requestAnimationFrame(frame);
window.HNS={MP,get map(){return mapIdx},crouch:v=>setCrouch(v),info:()=>renderer.info.render,sim:(sec)=>{for(let t=0;t<sec;t+=1/30)update(1/30)},get chars(){return chars},get phase(){return phase},get mode(){return mode},get timer(){return timer},set timer(v){timer=v},startLevel,get level(){return level},set level(v){level=v},astar,sees,catchHider};
})();
