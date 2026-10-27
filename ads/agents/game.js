/* Агенти — шпигуни в натовпі. 1–2 мисливці проти шпигунів, яких не відрізнити від перехожих-ботів.
   Шпигуни зламують термінали (утримання), мисливець має обмежені постріли: влучив у перехожого — промах і оглушення.
   Натовп малюється інстансами (один виклик малювання на частину тіла для всіх персонажів),
   тож 48 перехожих + 10 гравців коштують телефону стільки ж, скільки 2–3 звичайні персонажі.
   Авторитет: соло — сам телефон; мережа — хост (стан раунду G, боти, злами й постріли).
   Боти йдуть до всіх стисненим рядком (6 символів на бота, ~7 разів/с); кожен гравець шле свою позицію. */
(function(){
const T3=THREE,HW=HNSWorld,$=id=>document.getElementById(id);
function onTap(el,fn){let t=0;el.addEventListener('pointerdown',e=>{if(e.button>0)return;e.preventDefault();t=performance.now();fn(e)});el.addEventListener('click',e=>{if(performance.now()-t<700)return;fn(e)})}
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile=Math.min(innerWidth,innerHeight)<700;
const dist=(ax,az,bx,bz)=>Math.hypot(ax-bx,az-bz);
function rng(s){return()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const angDiff=(a,b)=>{let d=(a-b)%(Math.PI*2);if(d>Math.PI)d-=Math.PI*2;if(d<-Math.PI)d+=Math.PI*2;return d};
const MAPIDS=['station','mall'].map(id=>HW.MAPS.findIndex(m=>m.id===id)).filter(i=>i>=0);

/* ---------- константи ---------- */
const NMAX=72,WALK=1.4,RUN=3.0,H_WALK=1.6,H_RUN=3.1,HACK_T=3.2,SHOT_R=7.5,SHOT_CD=1.3,STUN_T=3,SEAT_Y={chair:0.47,bench:0.47,sofa:0.5,armchair:0.48};
const PAL=['#4C8DFF','#4CC97A','#FFC93C','#A779F2','#FF9A3D','#FF7BB0','#3CC8C8','#8BD14B','#F2F2F2','#B5835A','#E86A5C','#7D8CA3'];
const HATC=['#2F3A56','#C0392B','#F2F2F2','#27AE60','#F2C94C','#8E44AD','#1ABC9C'],BAGC=['#5A4636','#2F3A56','#C0392B','#7D8CA3','#27AE60'];
const HUNT_C='#2E3440',ST={walk:0,sit:1,work:2,phone:3,wave:4,down:5,out:6};

/* ---------- renderer ---------- */
const renderer=new T3.WebGLRenderer({canvas:$('gl'),antialias:true});
renderer.setPixelRatio(Math.min(mobile?1.5:2,devicePixelRatio||1));
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T3.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;
const scene=new T3.Scene();scene.background=new T3.Color('#9AA7AE');
const camera=new T3.PerspectiveCamera(46,1,0.5,140);
const fx=$('fx'),fctx=fx.getContext('2d');let W,H;
const VIEW_LONG=60*Math.PI/180;
function resize(){W=innerWidth;H=innerHeight;renderer.setSize(W,H,false);camera.aspect=W/H;
  camera.fov=(W>H?2*Math.atan(Math.tan(VIEW_LONG/2)*H/W):VIEW_LONG)*180/Math.PI;camera.updateProjectionMatrix();const d=Math.min(2,devicePixelRatio||1);fx.width=W*d;fx.height=H*d;fctx.setTransform(d,0,0,d,0,0)}
addEventListener('resize',resize);resize();
const hemi=new T3.HemisphereLight(0xEAF2FF,0xB59C82,0.55);scene.add(hemi);
const sun=new T3.DirectionalLight(0xFFF0DC,0.62);sun.castShadow=true;sun.shadow.mapSize.set(mobile?1024:2048,mobile?1024:2048);sun.shadow.bias=-0.0006;sun.shadow.normalBias=0.03;
{const sc=sun.shadow.camera;sc.left=-17;sc.right=17;sc.top=14;sc.bottom=-14;sc.near=1;sc.far=50;sc.updateProjectionMatrix()}
scene.add(sun);scene.add(sun.target);
/* тінь — лише від карти (персонажам — плями), і перераховується, лише коли камера переїхала на 4 м: велика карта не гальмує */
let sunAt=[1e9,1e9];
function sunFollow(x,z){const sx=Math.round(x/4)*4,sz=Math.round(z/4)*4;if(sx===sunAt[0]&&sz===sunAt[1])return;sunAt=[sx,sz];
  sun.position.set(sx-7,18,sz+9);sun.target.position.set(sx,0,sz);sun.target.updateMatrixWorld();renderer.shadowMap.needsUpdate=true}
const gm=new T3.DataTexture(new Uint8Array([120,190,255]),3,1,T3.LuminanceFormat);gm.minFilter=gm.magFilter=T3.NearestFilter;gm.needsUpdate=true;
const toon=(c,o={})=>new T3.MeshToonMaterial(Object.assign({color:c,gradientMap:gm},o));
const ground=new T3.Mesh(new T3.PlaneGeometry(200,200).rotateX(-Math.PI/2),toon('#8FA08E'));ground.position.y=-0.11;ground.receiveShadow=true;scene.add(ground);

/* ---------- світ ---------- */
let world=null,staticMesh=null,segs=[],nav=null,mapIdx=-1,mapDef=null,seats=[],works=[],terms=[],wander=[],spawnPt=[0,0];
function buildWorld(mi,seed){
  if(staticMesh){scene.remove(staticMesh);staticMesh.geometry.dispose()}
  mapIdx=mi;world=HW.build(scene,{map:mi});mapDef=world.def;
  ground.position.set(world.W/2,-0.11,world.H/2);scene.background.set(mapDef.grass||'#9AA7AE');
  staticMesh=world.mesh.mesh(new T3.MeshToonMaterial({vertexColors:true,gradientMap:gm}));staticMesh.castShadow=staticMesh.receiveShadow=true;scene.add(staticMesh);
  nav=HW.walkGrid(world.boxes,0.3);allocNav();
  spawnPt=snap(mapDef.spawn[0],mapDef.spawn[1]);
  placeTerms(seed);
  nav=HW.walkGrid(world.boxes,0.3);allocNav();
  const wallBoxes=world.boxes.filter(b=>!world.blockers.some(f=>f.b===b)&&!b.term);
  segs=HW.segmentsOf(wallBoxes.concat(world.tallBoxes));
  findSeats();findWorks();findWander();
  sunAt=[1e9,1e9];renderer.shadowMap.needsUpdate=true;
}
const roomAt=(x,z)=>{const r=world.grid[Math.floor(z)];return r?r[Math.floor(x)]:'#'};
const roomName=(x,z)=>(mapDef.rooms||{})[roomAt(x,z)]||'';

/* ---------- навігація ---------- */
let AG=null,AC_=null,ACL=null;const HEAP=[];
function allocNav(){const N=nav.free.length;AG=new Float32Array(N);AC_=new Int32Array(N);ACL=new Uint8Array(N)}
const ci=(x,z)=>Math.max(0,Math.min(nav.nz-1,Math.floor(z/HW.CS)))*nav.nx+Math.max(0,Math.min(nav.nx-1,Math.floor(x/HW.CS)));
const cx_=i=>(i%nav.nx+0.5)*HW.CS,cz_=i=>(Math.floor(i/nav.nx)+0.5)*HW.CS;
function nearestFree(i){if(nav.free[i])return i;const seen=new Uint8Array(nav.free.length),q=[i];seen[i]=1;
  for(let h=0;h<q.length;h++){const c=q[h];if(nav.free[c])return c;const x=c%nav.nx,z=Math.floor(c/nav.nx);for(const [dx,dz] of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,nz=z+dz;if(nx<0||nz<0||nx>=nav.nx||nz>=nav.nz)continue;const n=nz*nav.nx+nx;if(!seen[n]){seen[n]=1;q.push(n)}}}return i}
function snap(x,z){const i=nearestFree(ci(x,z));return[cx_(i),cz_(i)]}
function lineFree(x0,z0,x1,z1){const d=Math.hypot(x1-x0,z1-z0),n=Math.ceil(d/0.18);for(let k=1;k<n;k++){const t=k/n;if(!nav.free[ci(x0+(x1-x0)*t,z0+(z1-z0)*t)])return false}return true}
let pathBudget=99;
function astar(x0,z0,x1,z1){
  const s=nearestFree(ci(x0,z0)),t=nearestFree(ci(x1,z1));AG.fill(1e9);AC_.fill(-1);ACL.fill(0);HEAP.length=0;
  const g=AG,came=AC_,closed=ACL,heap=HEAP;
  const push=(i,f)=>{heap.push([f,i]);let k=heap.length-1;while(k){const p=(k-1)>>1;if(heap[p][0]<=heap[k][0])break;[heap[p],heap[k]]=[heap[k],heap[p]];k=p}};
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
function los(ax,az,bx,bz){const dx=bx-ax,dz=bz-az;for(const s of segs){const sx=s[2]-s[0],sz=s[3]-s[1],den=dx*sz-dz*sx;if(Math.abs(den)<1e-9)continue;
  const qx=s[0]-ax,qz=s[1]-az,t=(qx*sz-qz*sx)/den,u=(qx*dz-qz*dx)/den;if(t>0.001&&t<0.999&&u>=0&&u<=1)return false}return true}
function boxDist(b,x,z){const cx=Math.max(b[0],Math.min(x,b[2])),cz=Math.max(b[1],Math.min(z,b[3]));return Math.hypot(x-cx,z-cz)}

/* ---------- термінали: біля стін, по кімнатах, далеко один від одного ---------- */
const TERM_GEO={body:new T3.BoxGeometry(0.62,1.2,0.42),scr:new T3.BoxGeometry(0.46,0.32,0.03),led:new T3.BoxGeometry(0.6,0.06,0.2)};
const termIM={body:new T3.InstancedMesh(TERM_GEO.body,toon('#34405A'),16),scr:new T3.InstancedMesh(TERM_GEO.scr,new T3.MeshBasicMaterial({color:'#59E0FF'}),16),led:new T3.InstancedMesh(TERM_GEO.led,toon('#6B7891'),16)};
for(const k in termIM){const m=termIM[k];m.castShadow=k==='body';m.count=0;scene.add(m)}
function placeTerms(seed){
  terms=[];const R=rng(seed^0x51A7),g=world.grid,Hh=g.length,Ww=g[0].length,want=mapDef.id==='station'?10:8;
  const wallAt=(c,r)=>!g[r]||g[r][c]===undefined||g[r][c]==='#';
  const cand=[];
  for(let r=1;r<Hh-1;r++)for(let c=1;c<Ww-1;c++){if(wallAt(c,r))continue;
    for(const [dx,dz,ry] of[[-1,0,Math.PI/2],[1,0,-Math.PI/2],[0,-1,0],[0,1,Math.PI]]){
      if(!wallAt(c+dx,r+dz))continue;
      // стіна має тягнутись в обидва боки (не край дверей), спереду — 2 вільні клітинки
      const px=-dz,pz=dx;if(!wallAt(c+dx+px,r+dz+pz)||!wallAt(c+dx-px,r+dz-pz)||wallAt(c+px,r+pz)||wallAt(c-px,r-pz))continue;
      if(wallAt(c-dx,r-dz)||wallAt(c-2*dx,r-2*dz))continue;
      const mx=c+0.5+dx*0.27,mz=r+0.5+dz*0.27,sx=c+0.5-dx*0.45,sz=r+0.5-dz*0.45;
      const w=Math.abs(dx)?0.42:0.62,d=Math.abs(dx)?0.62:0.42,b=[mx-w/2,mz-d/2,mx+w/2,mz+d/2];
      if(world.boxes.some(o=>o[0]<b[2]+0.15&&o[2]>b[0]-0.15&&o[1]<b[3]+0.15&&o[3]>b[1]-0.15&&!(o[2]-o[0]>=0.99&&o[3]-o[1]>=0.99&&(wallAt(Math.floor((o[0]+o[2])/2),Math.floor((o[1]+o[3])/2))))))continue;
      if(!nav.free[ci(sx,sz)]||!nav.free[ci(sx-dx*0.6,sz-dz*0.6)])continue;
      if(dist(sx,sz,spawnPt[0],spawnPt[1])<5)continue;
      cand.push({x:mx,z:mz,sx,sz,ry,b,room:g[r][c],r:R()})}}
  cand.sort((a,b)=>a.r-b.r);
  const per={};for(const row of g)for(const ch of row)if(ch!=='#')per[ch]=(per[ch]||0)+1;
  for(const pass of[0,1,2])for(const t of cand){if(terms.length>=want)break;
    const cap=pass===0?1:pass===1?Math.max(1,Math.round(per[t.room]/110)):9;
    if(terms.filter(o=>o.room===t.room).length>=cap)continue;
    if(terms.some(o=>dist(o.x,o.z,t.x,t.z)<[7,5.5,3.5][pass]))continue;terms.push(t)}
  const m4=new T3.Matrix4(),q=new T3.Quaternion(),e=new T3.Euler(),v=new T3.Vector3(),s=new T3.Vector3(1,1,1),base=new T3.Matrix4();
  terms.forEach((t,i)=>{t.i=i;t.b.term=1;world.boxes.push(t.b);
    base.compose(v.set(t.x,0,t.z),q.setFromEuler(e.set(0,t.ry,0)),s.set(1,1,1));
    termIM.body.setMatrixAt(i,m4.compose(v.set(0,0.6,0),q.set(0,0,0,1),s.set(1,1,1)).premultiply(base));
    termIM.scr.setMatrixAt(i,m4.compose(v.set(0,0.95,0.215),q.setFromEuler(e.set(-0.3,0,0)),s.set(1,1,1)).premultiply(base));
    termIM.led.setMatrixAt(i,m4.compose(v.set(0,0.74,0.27),q.set(0,0,0,1),s.set(1,1,1)).premultiply(base))});
  for(const k in termIM){termIM[k].count=terms.length;termIM[k].instanceMatrix.needsUpdate=true}
}
/* сидіння: стільці, лавки, дивани, крісла (порядок blockers = порядок меблів без килимів) */
function findSeats(){
  seats=[];const furn=mapDef.furn.filter(f=>!f.flat);
  world.blockers.forEach((bl,i)=>{const f=furn[i];if(!f||!SEAT_Y[f.t])return;
    const b=bl.b,cx=(b[0]+b[2])/2,cz=(b[1]+b[3])/2,yaw=((f.r||0)%4)*Math.PI/2,n=f.t==='bench'||f.t==='sofa'?Math.max(1,Math.round((f.w||1.6)/0.85)):1;
    const ax=Math.cos(yaw),az=-Math.sin(yaw),w=f.w||1;
    for(let k=0;k<n;k++){const off=n>1?(-w/2+w*(k+0.5)/n):0,x=cx+ax*off,z=cz+az*off;
      // підхід: спереду, а якщо там стіл — збоку чи ззаду
      let best=null,bd=0.45;for(const [a,r] of[[0,0.62],[Math.PI/2,0.6],[-Math.PI/2,0.6],[Math.PI,0.6]]){const fx=x+Math.sin(yaw+a)*r,fz=z+Math.cos(yaw+a)*r,[sx,sz]=snap(fx,fz),d=dist(sx,sz,fx,fz);if(d<bd){bd=d;best=[sx,sz]}if(best&&a===0)break}
      if(!best)continue;seats.push({x,z,yaw,y:SEAT_Y[f.t],ax:best[0],az:best[1],res:null,i:seats.length})}});
}
const WORK_T={counter:1,shelf:1,checkout:1,desk:1,fridge:1,fridgewall:1,freezer:1,fruit:1,cooler:1,bookshelf:1,tvstand:1,sink:1,pallet:1,boxes:1};
function findWorks(){
  works=terms.map(t=>({x:t.sx,z:t.sz,yaw:Math.atan2(t.x-t.sx,t.z-t.sz),term:t.i,res:null}));
  const furn=mapDef.furn.filter(f=>!f.flat);
  world.blockers.forEach((bl,i)=>{const f=furn[i];if(!f||!WORK_T[f.t])return;const b=bl.b,len=Math.max(b[2]-b[0],b[3]-b[1]),n=Math.min(3,Math.max(1,Math.round(len/2)));
    const got=[];const R=rng(i*31+7);
    for(let k=0;k<40&&got.length<n;k++){const a=R()*6.283,cx=(b[0]+b[2])/2+Math.cos(a)*(b[2]-b[0]),cz=(b[1]+b[3])/2+Math.sin(a)*(b[3]-b[1]);const [x,z]=snap(cx,cz),d=boxDist(b,x,z);
      if(d<0.25||d>0.75||got.some(o=>dist(o.x,o.z,x,z)<1))continue;const px=Math.max(b[0],Math.min(x,b[2])),pz=Math.max(b[1],Math.min(z,b[3]));got.push({x,z,yaw:Math.atan2(px-x,pz-z),term:-1,res:null})}
    works.push(...got)});
}
function findWander(){wander=[];for(let j=2;j<nav.nz-2;j+=2)for(let i=2;i<nav.nx-2;i+=2){let ok=1;for(let dj=-2;dj<=2&&ok;dj++)for(let di=-2;di<=2;di++)if(!nav.free[(j+dj)*nav.nx+i+di]){ok=0;break}if(ok)wander.push([(i+0.5)*HW.CS,(j+0.5)*HW.CS])}}

/* ---------- персонажі: інстанси ---------- */
const BEAN=new T3.LatheGeometry([[0,0],[0.17,0.012],[0.25,0.06],[0.285,0.17],[0.29,0.36],[0.285,0.55],[0.26,0.7],[0.21,0.82],[0.13,0.9],[0,0.93]].map(([x,y])=>new T3.Vector2(x,y)),18);
const SPH=new T3.SphereGeometry(1,10,7),SPHS=new T3.SphereGeometry(1,7,5),CYL=new T3.CylinderGeometry(1,1,1,12),BOX=new T3.BoxGeometry(1,1,1),DISC=new T3.CircleGeometry(1,18).rotateX(-Math.PI/2),RING=new T3.RingGeometry(0.4,0.5,28).rotateX(-Math.PI/2);
function IM(geo,mat,n,colored,shadow){const m=new T3.InstancedMesh(geo,mat,n);m.instanceMatrix.setUsage(T3.DynamicDrawUsage);m.frustumCulled=false;
  if(colored){const w=new T3.Color('#ffffff');for(let i=0;i<n;i++)m.setColorAt(i,w);m.instanceColor.setUsage(T3.DynamicDrawUsage)}m.count=0;m.castShadow=false;m.receiveShadow=!!shadow;scene.add(m);return m}
const IB={body:IM(BEAN,toon('#ffffff'),NMAX,1,1),hand:IM(SPHS,toon('#ffffff'),NMAX*2,1),foot:IM(SPHS,toon('#ffffff'),NMAX*2,1),eye:IM(SPHS,toon('#FFFFFF'),NMAX*2),blk:IM(SPHS,toon('#1D1A26'),NMAX*3),
  hat:IM(SPH,toon('#ffffff'),NMAX,1),brim:IM(BOX,toon('#ffffff'),NMAX,1),fed:IM(CYL,toon('#3B2F2A'),8),bag:IM(BOX,toon('#ffffff'),NMAX,1),phone:IM(BOX,toon('#22252E'),NMAX),
  shadow:IM(DISC,new T3.MeshBasicMaterial({color:'#000000',transparent:true,opacity:0.2,depthWrite:false}),NMAX),
  mark:IM(RING,new T3.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:0.9,depthWrite:false}),NMAX,1)};
IB.shadow.renderOrder=1;IB.mark.renderOrder=2;
const _m=new T3.Matrix4(),_root=new T3.Matrix4(),_body=new T3.Matrix4(),_q=new T3.Quaternion(),_e=new T3.Euler(),_v=new T3.Vector3(),_s=new T3.Vector3(),_c=new T3.Color();
function L(par,x,y,z,sx,sy,sz,rx=0,ry=0,rz=0){_q.setFromEuler(_e.set(rx,ry,rz));_m.compose(_v.set(x,y,z),_q,_s.set(sx,sy,sz));return _m.premultiply(par)}

let chars=[],player=null;
function appOf(R){return[Math.floor(R()*PAL.length),R()<0.3?1:R()<0.4?2:0,R()<0.3?1:0,Math.floor(R()*HATC.length),Math.floor(R()*BAGC.length)]}
function newChar(id,kind,role,x,z,app){
  const hunter=role==='hunter';
  const c={id,kind,role,x,z,vx:0,vz:0,yaw:Math.random()*6.283,st:0,ph:Math.random()*6,blinkT:Math.random()*3,sit:0,lie:0,shown:true,out:false,outT:0,
    col:new T3.Color(hunter?HUNT_C:PAL[app[0]]),dark:new T3.Color(hunter?'#1B1F27':PAL[app[0]]).multiplyScalar(hunter?1:0.55),hat:hunter?3:app[1],hatC:new T3.Color(HATC[app[3]]),bag:hunter?0:app[2],bagC:new T3.Color(BAGC[app[4]]),
    plan:null,path:null,pi:0,t:0,seat:null,spot:null,spd:1.25+Math.random()*0.3,run:false,chk:0,chkX:x,chkZ:z,jit:0,head:0,
    fx0:x,fz0:z,tx:x,tz:z,tyaw:0,it:1,idur:0.15,nick:'',remote:false,seatY:0.47};
  chars.push(c);return c;
}
function clearChars(){chars=[];player=null;for(const s of seats)s.res=null;for(const w of works)w.res=null}
const chr=id=>chars.find(c=>c.id===id);

function drawChars(dt){
  const n={body:0,hand:0,foot:0,eye:0,blk:0,hat:0,brim:0,fed:0,bag:0,phone:0,shadow:0,mark:0};
  const me=player,myRole=me?me.role:'';
  for(const c of chars){
    if(!c.shown)continue;
    const sp=Math.hypot(c.vx,c.vz),k=Math.min(1,sp/2.6);
    c.ph+=dt*(4+sp*3.4);
    const sitW=c.st===ST.sit?1:0,lieW=c.st===ST.down||c.st===ST.out?1:0;
    c.sit+=(sitW-c.sit)*Math.min(1,dt*10);c.lie+=(lieW-c.lie)*Math.min(1,dt*8);
    const S=c.role==='hunter'?1.24:1.18,y0=c.sit*c.seatY;
    _q.setFromEuler(_e.set(0,c.yaw,0));_root.compose(_v.set(c.x,y0,c.z),_q,_s.set(S,S,S));
    const bob=reduce?0:Math.abs(Math.sin(c.ph))*0.07*k*(1-c.sit);
    _q.setFromEuler(_e.set(k*0.2*(1-c.sit)-c.lie*1.35-c.sit*0.06,0,0));_body.compose(_v.set(0,bob+c.lie*0.1,-c.lie*0.25),_q,_s.set(1,1-bob*0.8,1)).premultiply(_root);
    IB.body.setMatrixAt(n.body,_body);IB.body.setColorAt(n.body++,c.col);
    // очі, зіниці, рот
    c.blinkT-=dt;if(c.blinkT<0)c.blinkT=2+Math.random()*3;const bl=c.blinkT<0.1||c.lie>0.5?0.12:1;
    for(const s of[-1,1]){IB.eye.setMatrixAt(n.eye++,L(_body,s*0.095,0.64,0.215,0.075,0.085*bl,0.05));IB.blk.setMatrixAt(n.blk++,L(_body,s*0.095,0.635,0.255,0.04,0.048*bl,0.025))}
    IB.blk.setMatrixAt(n.blk++,L(_body,0,0.53,0.255,0.035,c.lie>0.5?0.03:0.016,0.012));
    // ступні
    const sw=reduce?0:Math.sin(c.ph)*k;
    for(const s of[-1,1]){const fy=c.sit>0.5?0.06:0.045+Math.max(0,s*Math.sin(c.ph))*0.07*k,fz=c.sit>0.5?0.3:0.02-s*sw*0.15;
      IB.foot.setMatrixAt(n.foot,L(_root,s*0.11,fy,fz,0.085,0.055,0.12));IB.foot.setColorAt(n.foot++,c.dark)}
    // руки за станом
    let hl=[-0.31,0.36,0.02-sw*0.12],hr=[0.31,0.36,0.02+sw*0.12],ph=null;
    if(c.st===ST.work){const j=reduce?0:0.03;hl=[-0.2,0.55+Math.sin(T*20+c.ph)*j,0.25];hr=[0.2,0.55+Math.cos(T*20+c.ph)*j,0.25]}
    else if(c.st===ST.phone){hr=[0.22,0.66,0.13];ph=hr}
    else if(c.st===ST.wave){hr=[0.36,0.88+(reduce?0:Math.sin(T*10)*0.05),0.05]}
    else if(c.role==='hunter'&&c===aimer){hr=[0.18,0.5,0.32];hl=[-0.12,0.5,0.32]}
    for(const h of[hl,hr]){IB.hand.setMatrixAt(n.hand,L(_body,h[0],h[1],h[2],0.065,0.065,0.065));IB.hand.setColorAt(n.hand++,c.col)}
    if(ph)IB.phone.setMatrixAt(n.phone++,L(_body,ph[0]-0.03,ph[1]+0.03,ph[2]+0.04,0.05,0.09,0.016));
    // шапки, рюкзак
    if(c.hat===1){IB.hat.setMatrixAt(n.hat,L(_body,0,0.84,0,0.235,0.15,0.235));IB.hat.setColorAt(n.hat++,c.hatC)}
    else if(c.hat===2){IB.hat.setMatrixAt(n.hat,L(_body,0,0.85,-0.01,0.225,0.11,0.225));IB.hat.setColorAt(n.hat++,c.hatC);IB.brim.setMatrixAt(n.brim,L(_body,0,0.86,0.18,0.28,0.025,0.17));IB.brim.setColorAt(n.brim++,c.hatC)}
    else if(c.hat===3){IB.fed.setMatrixAt(n.fed++,L(_body,0,0.98,0,0.2,0.18,0.2));IB.fed.setMatrixAt(n.fed++,L(_body,0,0.9,0,0.38,0.025,0.38))}
    if(c.bag){IB.bag.setMatrixAt(n.bag,L(_body,0,0.45,-0.27,0.32,0.36,0.14));IB.bag.setColorAt(n.bag++,c.bagC)}
    _m.compose(_v.set(c.x,0.012,c.z),_q.set(0,0,0,1),_s.set(0.36,1,0.36));IB.shadow.setMatrixAt(n.shadow++,_m);
    // позначки: я — жовте коло, свої шпигуни — бірюзові, мисливці — червоні (видно всім)
    let mk=null;if(c===player&&!c.out)mk='#FFD23F';else if(c.role==='hunter')mk='#FF5C5C';else if(myRole==='spy'&&c.role==='spy'&&c.kind==='human'&&!c.out)mk='#3DD6C3';
    if(mk){_m.compose(_v.set(c.x,0.025,c.z),_q.set(0,0,0,1),_s.set(1,1,1));IB.mark.setMatrixAt(n.mark,_m);IB.mark.setColorAt(n.mark++,_c.set(mk))}
  }
  for(const k in n){const m=IB[k];m.count=n[k];m.instanceMatrix.needsUpdate=true;if(m.instanceColor)m.instanceColor.needsUpdate=true}
}

/* ---------- рух ---------- */
function steerPath(ch,dt,speed){
  let tx=0,tz=0;
  if(ch.path&&ch.pi<ch.path.length){const p=ch.path[ch.pi],dx=p[0]-ch.x,dz=p[1]-ch.z,d=Math.hypot(dx,dz);
    if(d<0.22){ch.pi++}else{const last=ch.pi===ch.path.length-1,sp=last?Math.min(speed,d*3+0.6):speed;tx=dx/d*sp;tz=dz/d*sp}}
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
function integrate(ch,dt){ch.x+=ch.vx*dt;ch.z+=ch.vz*dt;collide(ch);const sp=Math.hypot(ch.vx,ch.vz);if(sp>0.25){const ty=Math.atan2(ch.vx,ch.vz);ch.yaw+=angDiff(ty,ch.yaw)*Math.min(1,dt*10)}}
/* персонажі не проходять одне крізь одного: сітка 1 м, штовхаємо лише тих, кого веде цей телефон */
const HASH=new Map();
function separate(){
  HASH.clear();
  for(const c of chars){if(!c.shown||c.st===ST.sit||c.lie>0.5)continue;const k=(Math.floor(c.x)<<8)|Math.floor(c.z);let a=HASH.get(k);if(!a)HASH.set(k,a=[]);a.push(c)}
  const mine=c=>c===player||(isAuth()&&c.kind==='bot');
  for(const c of chars){if(!c.shown||c.st===ST.sit||c.lie>0.5||!mine(c))continue;const gx=Math.floor(c.x),gz=Math.floor(c.z);
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){const a=HASH.get(((gx+dx)<<8)|(gz+dz));if(!a)continue;
      for(const o of a){if(o===c)continue;const ex=c.x-o.x,ez=c.z-o.z,d=Math.hypot(ex,ez),R=0.5;if(d>=R||d<1e-4)continue;
        const push=(R-d)*(mine(o)&&o!==player&&c!==player?0.5:c===player?0.6:0.9);c.x+=ex/d*push;c.z+=ez/d*push}}}
}

/* ---------- боти-перехожі (соло або хост) ---------- */
function seatFree(s,self){return !chars.some(c=>c!==self&&c.shown&&c.st===ST.sit&&dist(c.x,c.z,s.x,s.z)<0.3)&&(!s.res||s.res===self.id)}
function workFree(w,self){return(!w.res||w.res===self.id)&&!chars.some(c=>c!==self&&c.shown&&dist(c.x,c.z,w.x,w.z)<0.45)}
function release(b){if(b.seat&&b.seat.res===b.id)b.seat.res=null;if(b.spot&&b.spot.res===b.id)b.spot.res=null}
function goTo(b,x,z,next,dur){if(pathBudget<=0){b.plan='idle';b.t=0.15+Math.random()*0.3;b.st=0;return}pathBudget--;
  const p=astar(b.x,b.z,x,z);if(!p){b.plan='idle';b.t=1;b.st=0;return}b.path=p;b.pi=0;b.plan='go';b.next=next;b.dur=dur;b.chk=1.5;b.chkX=b.x;b.chkZ=b.z;b.st=0}
const pick=(R,arr)=>arr[Math.floor(R()*arr.length)];
function nearish(list,b,maxD){const ok=list.filter(o=>dist(o.x!==undefined?o.x:o[0],o.z!==undefined?o.z:o[1],b.x,b.z)<maxD);return ok.length?ok:list}
function choose(b){
  release(b);b.seat=null;b.spot=null;b.run=Math.random()<0.05;
  const r=Math.random(),spyBot=b.role==='spy';
  if(spyBot&&G&&G.ph==='play'){const open=works.filter(w=>w.term>=0&&!G.done.includes(w.term)&&workFree(w,b));
    if(open.length&&r<0.5){const w=nearish(open,b,22)[Math.floor(Math.random()*Math.min(3,open.length))]||open[0];w.res=b.id;b.spot=w;b.run=false;goTo(b,w.x,w.z,'work',HACK_T+0.4);return}}
  if(r<0.27){const s=nearish(seats,b,20).filter(s=>seatFree(s,b));if(s.length){const st=pick(Math.random,s);st.res=b.id;b.seat=st;b.run=false;goTo(b,st.ax,st.az,'sit',6+Math.random()*14);return}}
  if(r<0.6){const w=nearish(works,b,22).filter(w=>workFree(w,b));if(w.length){const ww=pick(Math.random,w);ww.res=b.id;b.spot=ww;goTo(b,ww.x,ww.z,'work',2+Math.random()*5);return}}
  if(r<0.72){b.plan=Math.random()<0.85?'phone':'wave';b.t=b.plan==='wave'?1.5+Math.random():3+Math.random()*6;b.st=b.plan==='phone'?ST.phone:ST.wave;return}
  const p=pick(Math.random,nearish(wander,b,26));goTo(b,p[0],p[1],Math.random()<0.4?'phone':'idle',1+Math.random()*4);
}
function botThink(b,dt){
  if(b.out)return;
  if(b.role==='hunter'){hunterAI(b,dt);return}
  switch(b.plan){
    case 'go':{const sp=b.run?RUN:b.spd;const done=steerPath(b,dt,sp);
      b.chk-=dt;if(b.chk<=0){if(dist(b.x,b.z,b.chkX,b.chkZ)<0.3){release(b);b.plan=null;break}b.chk=1.5;b.chkX=b.x;b.chkZ=b.z}
      if(done){b.path=null;b.vx=b.vz=0;const nx=b.next;b.run=false;
        if(nx==='sit'){if(b.seat&&seatFree(b.seat,b)){b.plan='sit';b.t=b.dur;b.st=ST.sit;b.x=b.seat.x;b.z=b.seat.z;b.yaw=b.seat.yaw;b.seatY=b.seat.y}else b.plan=null}
        else if(nx==='work'){if(b.spot){b.plan='work';b.t=b.dur;b.st=ST.work;b.yaw=b.spot.yaw}else b.plan=null}
        else if(nx==='flee'){b.plan='idle';b.t=1+Math.random()*2;b.st=0}
        else{b.plan=nx;b.t=b.dur;b.st=nx==='phone'?ST.phone:0}}
      break}
    case 'sit':b.vx=b.vz=0;if(b.seat){b.x=b.seat.x;b.z=b.seat.z;b.yaw=b.seat.yaw}b.t-=dt;
      if(b.t<=0){b.st=0;if(b.seat){b.x=b.seat.ax;b.z=b.seat.az}choose(b)}break;
    case 'work':b.vx=b.vz=0;if(b.spot){b.yaw+=angDiff(b.spot.yaw,b.yaw)*Math.min(1,dt*8)}b.t-=dt;
      if(b.t<=0){b.st=0;if(b.role==='spy'&&b.spot&&b.spot.term>=0)applyHack(b.id,b.spot.term);
        if(b.role==='spy'&&Math.random()<0.3){release(b);const p=pick(Math.random,nearish(wander,b,14));goTo(b,p[0],p[1],'idle',1);b.run=true}else choose(b)}break;
    case 'down':b.vx=b.vz=0;b.t-=dt;if(b.t<=0){b.st=0;choose(b)}break;
    case 'idle':case 'phone':case 'wave':b.vx*=0.8;b.vz*=0.8;b.t-=dt;if(b.plan==='idle'&&!reduce&&Math.random()<dt*0.4)b.yaw+=(Math.random()-0.5)*1.4;if(b.t<=0){b.st=0;choose(b)}break;
    default:choose(b);
  }
}
/* постріл поруч: перехожі розбігаються */
function panic(x,z,except){for(const b of chars){if(b.kind!=='bot'||b.role==='hunter'||b.out||b.st===ST.down||b===except)continue;const d=dist(b.x,b.z,x,z);if(d>4.5)continue;
  if(b.st===ST.sit&&b.seat){b.x=b.seat.ax;b.z=b.seat.az}release(b);b.seat=null;b.spot=null;b.st=0;const a=Math.atan2(b.x-x,b.z-z)+(Math.random()-0.5)*0.8,[tx,tz]=snap(b.x+Math.sin(a)*7,b.z+Math.cos(a)*7);pathBudget++;goTo(b,tx,tz,'flee',1);b.run=true}}

/* бот-мисливець: підозрює тих, хто біжить, смикано повертає, стоїть біля терміналів; бачить конусом */
const susp=new Map();
function jitterTrack(c,dt){const sp=Math.hypot(c.vx,c.vz);if(sp>0.5){const h=Math.atan2(c.vx,c.vz);if(Math.abs(angDiff(h,c.head))>0.14)c.jit+=1;c.head=h}c.jit*=Math.exp(-dt/2.5)}
function hunterAI(h,dt){
  if(G.ph!=='play'||stunLeft(h.id)>0){h.vx*=0.7;h.vz*=0.7;return}
  h.scan=(h.scan||0)-dt;
  if(h.scan<=0){h.scan=0.25;
    for(const [id,v] of susp){const nv=v*0.97-0.01;if(nv<=0)susp.delete(id);else susp.set(id,nv)}
    for(const c of chars){if(c===h||c.role==='hunter'||c.out||c.st===ST.down||!c.shown)continue;const d=dist(c.x,c.z,h.x,h.z);if(d>10)continue;
      const ang=Math.abs(angDiff(Math.atan2(c.x-h.x,c.z-h.z),h.yaw));if(ang>1.25&&d>2.5)continue;if(!los(h.x,h.z,c.x,c.z))continue;
      let s=0;const sp=Math.hypot(c.vx,c.vz);if(sp>2.2)s+=0.45;if(c.st===ST.work&&works.some(w=>w.term>=0&&!G.done.includes(w.term)&&dist(w.x,w.z,c.x,c.z)<0.8))s+=0.12;
      s+=Math.min(1,c.jit/6)*0.22;if(s>0)susp.set(c.id,(susp.get(c.id)||0)+s)}}
  let best=null,bv=0;for(const [id,v] of susp){if(v>bv){const c=chr(id);if(c&&!c.out&&c.st!==ST.down){best=c;bv=v}}}
  if(best&&bv>=1.1){
    const d=dist(best.x,best.z,h.x,h.z);
    if(d>5||!los(h.x,h.z,best.x,best.z)){h.aim=0;h.repath=(h.repath||0)-dt;if(h.repath<=0||!h.path){h.repath=0.8;pathBudget++;const p=astar(h.x,h.z,best.x,best.z);h.path=p;h.pi=0}steerPath(h,dt,d>8?H_RUN:H_WALK)}
    else{h.path=null;h.vx*=0.6;h.vz*=0.6;h.yaw+=angDiff(Math.atan2(best.x-h.x,best.z-h.z),h.yaw)*Math.min(1,dt*8);h.aim=(h.aim||0)+dt;h.aimId=best.id;
      if(h.aim>1.1){h.aim=0;susp.delete(best.id);applyShot(h.id,best.id)}}
    return}
  h.aim=0;h.aimId=null;
  if(!h.path||h.pi>=h.path.length){h.wait=(h.wait||0)-dt;h.vx*=0.7;h.vz*=0.7;if(!reduce&&Math.random()<dt*0.8)h.yaw+=(Math.random()-0.5)*1.6;
    if(h.wait<=0){h.wait=1+Math.random()*2.5;const open=terms.filter(t=>!G.done.includes(t.i));const tg=open.length&&Math.random()<0.6?pick(Math.random,open):null;
      const p=tg?[tg.sx+(Math.random()-0.5)*4,tg.sz+(Math.random()-0.5)*4]:pick(Math.random,wander);const [x,z]=snap(p[0],p[1]);pathBudget++;h.path=astar(h.x,h.z,x,z);h.pi=0}}
  else steerPath(h,dt,H_WALK);
}

/* ---------- звук ---------- */
let AC=null,muted=false,noiseBuf=null;try{muted=localStorage.getItem('agt_mute')==='1'}catch(e){}
function au(){if(!AC){try{AC=new (window.AudioContext||window.webkitAudioContext)()}catch(e){}}if(AC&&AC.state==='suspended')AC.resume();return AC}
function tone(f,d,{type='sine',vol=0.12,slide=0,delay=0}={}){if(muted||vol<0.002)return;const a=au();if(!a)return;const t=a.currentTime+delay,o=a.createOscillator(),g=a.createGain();o.type=type;o.frequency.setValueAtTime(f,t);if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(30,f*slide),t+d);
  g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(vol,t+0.012);g.gain.exponentialRampToValueAtTime(0.0001,t+d);o.connect(g).connect(a.destination);o.start(t);o.stop(t+d+0.02)}
function noise(d,{vol=0.1,f=800,q=0.8,delay=0,kind='bandpass',slide=0}={}){if(muted||vol<0.002)return;const a=au();if(!a)return;
  if(!noiseBuf){noiseBuf=a.createBuffer(1,a.sampleRate,a.sampleRate);const ch=noiseBuf.getChannelData(0);for(let i=0;i<ch.length;i++)ch[i]=Math.random()*2-1}
  const t=a.currentTime+delay,s=a.createBufferSource(),bf=a.createBiquadFilter(),g=a.createGain();s.buffer=noiseBuf;bf.type=kind;bf.frequency.setValueAtTime(f,t);if(slide)bf.frequency.exponentialRampToValueAtTime(Math.max(60,f*slide),t+d);bf.Q.value=q;
  g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(vol,t+0.01);g.gain.exponentialRampToValueAtTime(0.0001,t+d);s.connect(bf).connect(g).connect(a.destination);s.start(t,Math.random()*0.5);s.stop(t+d+0.05)}
const SFX={
  hack:()=>[880,1175,1568].forEach((f,i)=>tone(f,0.14,{type:'square',vol:0.05,delay:i*0.07})),
  tick:p=>tone(500+p*700,0.04,{type:'triangle',vol:0.05}),
  shot:()=>{noise(0.18,{vol:0.22,f:2600,q:0.6,slide:0.3});tone(900,0.12,{type:'square',vol:0.05,slide:0.4})},
  caught:()=>[523,659,784,1047].forEach((f,i)=>tone(f,0.2,{type:'triangle',vol:0.1,delay:i*0.08})),
  miss:()=>{tone(220,0.35,{type:'sawtooth',vol:0.08,slide:0.6});tone(165,0.4,{type:'square',vol:0.05,delay:0.1})},
  beep:()=>tone(660,0.12,{vol:0.08}),
  click:()=>{tone(1800,0.02,{type:'square',vol:0.05});noise(0.03,{vol:0.05,f:3000,kind:'highpass'})},
  sit:()=>noise(0.12,{vol:0.06,f:600}),
  win:()=>[523,659,784,1047].forEach((f,i)=>tone(f,0.24,{type:'triangle',vol:0.12,delay:i*0.11})),
  lose:()=>[330,277,220,165].forEach((f,i)=>tone(f,0.34,{type:'sawtooth',vol:0.06,delay:i*0.16})),
};
$('mute').addEventListener('click',()=>{muted=!muted;$('mute').textContent=muted?'🔇':'🔊';$('mute').setAttribute('aria-label',muted?'Увімкнути звук':'Вимкнути звук');try{localStorage.setItem('agt_mute',muted?'1':'0')}catch(e){}});
$('mute').textContent=muted?'🔇':'🔊';

/* ---------- стан раунду ---------- */
let phase='menu',T=0,G=null,lastKey='',pops=[],darts=[],confetti=[],shakeT=0,introT=0,myStun=0,shotCd=0,runOn=false,phoneOn=false,aimer=null,selT=null,lastFx=0,spec=null;
const hold={on:false,id:null,p:0,ti:-1};
const auth={last:{},shotAt:{},stun:{}};
const isAuth=()=>!MP.on||MP.host;
const myId=()=>MP.on?MP.me:'me';
const hostNow=()=>T*1000; // ігровий час: у тестах sim() прискорює його
function stunLeft(id){if(id===myId())return myStun;return Math.max(0,((auth.stun[id]||0)-hostNow())/1000)}
const spiesOf=()=>G?G.pl.filter(id=>!G.hu.includes(id)).concat(G.bs||[]):[];
const aliveSpies=()=>spiesOf().filter(id=>!G.out.includes(id)&&(!MP.on||id[0]==='s'&&G.bs&&G.bs.includes(id)||presOf(id)));
/* G: r раунд, ph фаза, k лічильник фаз, map, seed, pl гравці, hu мисливці (може бути 'bh'), bs боти-шпигуни, nb перехожі,
   goal скільки зламати, done зламані, out спіймані, am набої, fx події, sc бали, tl секунд, res, rem */
function newG(r,map,seed,pl,hu,bs,nb,tl,sc){
  const spies=pl.filter(id=>!hu.includes(id)).length+bs.length,am={},per=Math.ceil((spies+2)/Math.max(1,hu.length));for(const h of hu)am[h]=per;
  const nt=MAPIDS.length&&HW.MAPS[map].id==='station'?10:8;
  return{r,ph:'intro',k:1,map,seed,pl,hu,bs,nb,goal:Math.max(3,Math.min(nt-2,2+spies)),done:[],out:[],am,fx:[],fxn:0,sc:sc||{},tl,res:null,rem:7000};
}
function setupRound(cfg){
  if(mapIdx!==cfg.map||!world||world.seed!==cfg.seed){buildWorld(cfg.map,cfg.seed);world.seed=cfg.seed}
  clearChars();susp.clear();auth.stun={};auth.shotAt={};lastFx=cfg.fxn||0;hold.on=false;myStun=0;shotCd=0;runOn=false;phoneOn=false;selT=null;spec=null;darts=[];pops=[];
  const R=rng(cfg.seed),spots=wander.filter(p=>dist(p[0],p[1],spawnPt[0],spawnPt[1])>6).map(p=>({p,r:R()})).sort((a,b)=>a.r-b.r).map(o=>o.p);let si=0;
  const nextSpot=()=>{const p=spots[si++%spots.length];return[p[0]+(R()-0.5)*0.6,p[1]+(R()-0.5)*0.6]};
  // перехожі
  for(let i=0;i<cfg.nb;i++){const [x,z]=nextSpot(),c=newChar('b'+i,'bot','bot',x,z,appOf(R));c.plan=null}
  // боти-шпигуни (соло-мисливець)
  for(const id of cfg.bs){const [x,z]=nextSpot();newChar(id,'bot','spy',x,z,appOf(R))}
  // гравці-шпигуни виглядають як перехожі; мисливці — на вході
  cfg.pl.forEach((id,i)=>{const hunter=cfg.hu.includes(id),[x,z]=hunter?snap(spawnPt[0]+i*0.7-0.35,spawnPt[1]):nextSpot(),app=appOf(R);
    const c=newChar(id,'human',hunter?'hunter':'spy',x,z,app);if(MP.on){const p=presOf(id)||{};c.nick=String(p.n||'').slice(0,14);if(id!==MP.me)c.remote=true}
    if(id===myId())player=c});
  if(cfg.hu.includes('bh')){const [x,z]=snap(spawnPt[0],spawnPt[1]);newChar('bh','bot','hunter',x,z,[0,0,0,0,0]).yaw=Math.PI}
  for(const c of chars){c.tx=c.x;c.tz=c.z;c.fx0=c.x;c.fz0=c.z;c.tyaw=c.yaw}
  // на старті боти вже «живуть»: частина сидить, частина працює
  if(isAuth())for(let k=0;k<3;k++)for(const b of chars)if(b.kind==='bot'&&b.role!=='hunter'){pathBudget=99;if(!b.plan)choose(b);if(b.plan==='go'&&b.path&&b.path.length){const e=b.path[b.path.length-1];if(dist(e[0],e[1],b.x,b.z)<9&&Math.random()<0.6){b.x=e[0];b.z=e[1];b.pi=b.path.length}}}
}

/* ---------- події (злам, постріл) ---------- */
function applyEv(id,t,v){if(!G||G.ph!=='play')return;if(t==='hk')applyHack(id,v);else if(t==='sh')applyShot(id,v)}
const REQ={s:0,ev:[]};
function req(t,v){if(isAuth()){applyEv(myId(),t,v);return}REQ.s++;REQ.ev.push([REQ.s,t,v]);if(REQ.ev.length>12)REQ.ev.shift()}
function hostEvents(){for(const p of peersNow()){if(p.isMe||!G.pl.includes(p.id))continue;const ev=(p.presence||{}).ev;if(!Array.isArray(ev))continue;
  const last=auth.last[p.id]||0;for(const [s,t,v] of ev)if(s>last){applyEv(p.id,t,v);auth.last[p.id]=s}}}
function pushFx(e){G.fxn++;G.fx.push([G.fxn].concat(e));if(G.fx.length>8)G.fx.shift()}
const addSc=(id,n)=>{G.sc[id]=(G.sc[id]||0)+n};
function applyHack(id,ti){
  const c=chr(id);if(!c||c.role!=='spy'||G.out.includes(id)||G.done.includes(ti))return;const tm=terms[ti];if(!tm||dist(c.x,c.z,tm.sx,tm.sz)>1.6)return;
  G.done.push(ti);addSc(id,2);pushFx(['h',ti,id]);
  if(G.done.length>=G.goal)endRound('spy','hack');
}
function applyShot(hid,tid){
  const h=chr(hid),c=chr(tid);if(!h||!G.hu.includes(hid)||(G.am[hid]|0)<=0)return;const now=hostNow();
  if(auth.shotAt[hid]&&now-auth.shotAt[hid]<SHOT_CD*800)return;if((auth.stun[hid]||0)>now)return;
  if(!c||c.out||c.role==='hunter'||c.st===ST.down||dist(c.x,c.z,h.x,h.z)>SHOT_R+1.5)return;
  auth.shotAt[hid]=now;G.am[hid]--;const spy=c.role==='spy';
  if(spy){G.out.push(tid);addSc(hid,3);c.out=true;if(c.kind==='bot'){release(c);c.plan='out'}}
  else{auth.stun[hid]=now+STUN_T*1000;if(c.kind==='bot'){release(c);c.seat=null;c.spot=null;c.plan='down';c.t=6;c.st=ST.down;c.vx=c.vz=0}}
  panic(c.x,c.z,c);
  pushFx(['s',hid,tid,spy?1:0,+c.x.toFixed(2),+c.z.toFixed(2)]);
  if(!aliveSpies().length)endRound('hunt','all');
  else if(G.hu.every(h=>(G.am[h]|0)<=0))endRound('spy','ammo');
}
function endRound(res,why){if(G.ph!=='play')return;G.ph='end';G.k++;G.res=res;G.why=why;
  if(res==='spy'){for(const id of spiesOf())if(!G.out.includes(id))addSc(id,3)}else for(const h of G.hu)addSc(h,4);
  G.rem=9000;if(MP.on)MP.hostEnd=performance.now()+9000;syncPhase()}
/* нові події з G.fx — ефекти в усіх */
function playFx(){
  if(!G)return;for(const e of G.fx){if(e[0]<=lastFx)continue;lastFx=e[0];
    if(e[1]==='h'){const [,,ti,id]=e,c=chr(id),t=terms[ti];SFX.hack();
      const mine=player&&player.id===id;say('💾 '+G.done.length+'/'+G.goal,mine||(player&&player.role==='spy')?'big green':'big');
      if(mine){tip('Термінал зламано! Відійди спокійно — не біжи');vib(40)}
      if(player&&player.role==='hunter'&&c&&!c.out&&dist(c.x,c.z,player.x,player.z)<8&&los(player.x,player.z,c.x,c.z))pop(c,'?','#FFC93C');
      if(player&&player.role==='spy'&&t)ripple(t.sx,t.sz)}
    else if(e[1]==='s'){const [,,hid,tid,hit,x,z]=e,h=chr(hid),c=chr(tid);SFX.shot();if(h)darts.push({ax:h.x,az:h.z,bx:x,bz:z,t:0});
      if(c&&!isAuth()){if(hit){c.out=true}}
      if(hit){if(c){pop(c,'Спіймано!','#FF5C5C')}SFX.caught();if(player&&player.id===tid){say('Тебе спіймали','big red');vib(200)}else if(player&&player.id===hid){say('Шпигун!','big green')}else say('Спіймано шпигуна','big')}
      else{if(c)pop(c,'💤','#EEF3F8');SFX.miss();if(player&&player.id===hid){myStun=STUN_T;say('Це перехожий!','big red');shakeT=0.3;vib(120)}}}
  }
}

/* ---------- керування ---------- */
let joy=null;const keys={};
const gl=$('gl');
gl.addEventListener('pointerdown',e=>{au();if(joy)return;joy={id:e.pointerId,sx:e.clientX,sy:e.clientY,x:e.clientX,y:e.clientY,t:e.timeStamp,moved:false};try{gl.setPointerCapture(e.pointerId)}catch(_){}});
gl.addEventListener('pointermove',e=>{if(joy&&e.pointerId===joy.id){joy.x=e.clientX;joy.y=e.clientY;if(Math.hypot(joy.x-joy.sx,joy.y-joy.sy)>12)joy.moved=true}});
const endJoy=e=>{if(!joy||e.pointerId!==joy.id)return;const j=joy;joy=null;if(!j.moved&&e.timeStamp-j.t<450&&e.type==='pointerup')tapAt(j.sx,j.sy)};
gl.addEventListener('pointerup',endJoy);gl.addEventListener('pointercancel',endJoy);
addEventListener('keydown',e=>{keys[e.key.toLowerCase()]=true;if(e.key===' '&&player&&player.role==='hunter')shoot()});addEventListener('keyup',e=>{keys[e.key.toLowerCase()]=false});
function readStick(){let ix=0,iz=0;
  if(joy&&joy.moved){const dx=joy.x-joy.sx,dy=joy.y-joy.sy,m=Math.hypot(dx,dy);if(m>8){ix=dx/m;iz=dy/m}}
  if(keys.a||keys.arrowleft)ix-=1;if(keys.d||keys.arrowright)ix+=1;if(keys.w||keys.arrowup)iz-=1;if(keys.s||keys.arrowdown)iz+=1;
  const im=Math.hypot(ix,iz);if(im>1){ix/=im;iz/=im}return[ix,iz]}
const ray=new T3.Raycaster(),plane=new T3.Plane(new T3.Vector3(0,1,0),0),_hit=new T3.Vector3(),_p=new T3.Vector3();
function scr(x,y,z){_p.set(x,y,z).project(camera);return{x:(_p.x+1)/2*W,y:(1-_p.y)/2*H,z:_p.z}}
/* дотик: мисливець — вибрати ціль; інакше — іти туди пішки, як перехожі */
function tapAt(sx,sy){
  const p=player;if(!p||p.out||phase!=='play'&&phase!=='intro')return;
  if(p.role==='hunter'){let best=null,bd=46;for(const c of chars){if(c===p||c.role==='hunter'||c.out||!c.shown||c.st===ST.down)continue;const s=scr(c.x,0.6,c.z);if(s.z>1)continue;const d=Math.hypot(s.x-sx,s.y-sy);if(d<bd){bd=d;best=c}}
    if(best){selT=best.id;SFX.click();return}}
  if(p.role==='hunter'&&phase==='intro')return;
  ray.setFromCamera({x:sx/W*2-1,y:-(sy/H*2-1)},camera);if(!ray.ray.intersectPlane(plane,_hit))return;
  const path=astar(p.x,p.z,_hit.x,_hit.z);if(!path)return;standUp(p);hold.on=false;phoneOn=false;p.path=path;p.pi=0;ripple(_hit.x,_hit.z,'#FFFFFF',0.5)}
const runB=$('run'),phoneB=$('phone'),actB=$('act'),shootB=$('shoot');
onTap(runB,()=>{runOn=!runOn;runB.classList.toggle('on',runOn);runB.setAttribute('aria-pressed',runOn)});
onTap(phoneB,()=>{if(!player)return;phoneOn=!phoneOn;if(phoneOn){standUp(player);player.path=null}phoneB.classList.toggle('on',phoneOn);phoneB.setAttribute('aria-pressed',phoneOn)});
onTap(shootB,()=>shoot());
actB.addEventListener('pointerdown',e=>{if(e.button>0)return;e.preventDefault();au();const c=actCtx();if(!c)return;
  if(c.k==='hack'){hold.on=true;hold.id=e.pointerId;hold.ti=c.t.i;try{actB.setPointerCapture(e.pointerId)}catch(_){}}else if(c.k==='sit')sitDown(player,c.s);else if(c.k==='up')standUp(player)});
const actUp=e=>{if(hold.id===e.pointerId){hold.on=false;hold.id=null}};actB.addEventListener('pointerup',actUp);actB.addEventListener('pointercancel',actUp);
actB.addEventListener('click',e=>{if(e.detail!==0)return;const c=actCtx();if(c&&c.k==='sit')sitDown(player,c.s);else if(c&&c.k==='up')standUp(player)});
function actCtx(){const p=player;if(!p||p.role!=='spy'||p.out||phase!=='play'&&phase!=='intro')return null;
  if(p.seat)return{k:'up',ic:'🪑',label:'Встати'};
  if(phase==='play')for(const t of terms){if(G.done.includes(t.i))continue;if(dist(t.sx,t.sz,p.x,p.z)<0.95)return{k:'hack',t,ic:'💾',label:'Злам · тримай'}}
  let bs=null,bd=1.3;for(const s of seats){const d=dist(s.ax,s.az,p.x,p.z);if(d<bd&&seatFree(s,p)){bd=d;bs=s}}if(bs)return{k:'sit',s:bs,ic:'🪑',label:'Сісти'};
  return null}
function sitDown(p,s){if(!p||!s||!seatFree(s,p))return;p.seat=s;p.path=null;p.vx=p.vz=0;p.x=s.x;p.z=s.z;p.yaw=s.yaw;p.seatY=s.y;phoneOn=false;phoneB.classList.remove('on');SFX.sit()}
function standUp(p){if(!p||!p.seat)return;p.x=p.seat.ax;p.z=p.seat.az;p.seat=null}
/* ціль мисливця: вибрана дотиком або найближча попереду */
function aimTarget(){const p=player;if(!p||p.role!=='hunter')return null;
  let c=selT?chr(selT):null;if(c&&(c.out||c.st===ST.down||!c.shown||dist(c.x,c.z,p.x,p.z)>SHOT_R+2))c=selT=null;if(c)return c;
  let best=null,bs=1e9;for(const o of chars){if(o===p||o.role==='hunter'||o.out||!o.shown||o.st===ST.down)continue;const d=dist(o.x,o.z,p.x,p.z);if(d>SHOT_R)continue;
    const a=Math.abs(angDiff(Math.atan2(o.x-p.x,o.z-p.z),p.yaw));if(a>0.6)continue;const s=d+a*4;if(s<bs&&los(p.x,p.z,o.x,o.z)){bs=s;best=o}}return best}
function shoot(){const p=player;if(!p||p.role!=='hunter'||phase!=='play')return;au();
  if(myStun>0){tip('Оглушений — зачекай');return}if(shotCd>0)return;if((G.am[p.id]|0)<=0){tip('Набої скінчились');return}
  const t=aimTarget();if(!t){tip('Нікого поруч. Торкнись перехожого, щоб вибрати ціль');return}
  if(dist(t.x,t.z,p.x,p.z)>SHOT_R){tip('Задалеко — підійди ближче');return}
  if(!los(p.x,p.z,t.x,t.z)){tip('Ціль за стіною');return}
  shotCd=SHOT_CD;p.yaw=Math.atan2(t.x-p.x,t.z-p.z);selT=null;req('sh',t.id)}

/* ---------- оновлення гравця ---------- */
function playerUpdate(p,dt){
  if(p.out){p.st=ST.out;p.vx=p.vz=0;return}
  const hunter=p.role==='hunter',frozen=phase==='end'||phase==='menu'||(hunter&&(phase==='intro'||myStun>0));
  const [ix,iz]=readStick(),m=Math.hypot(ix,iz);
  const walk=hunter?H_WALK:WALK,rs=hunter?H_RUN:RUN,sp=runOn?rs:walk;
  if(frozen){p.vx*=0.6;p.vz*=0.6;p.path=null}
  else if(m>0.2){if(p.seat)standUp(p);p.path=null;hold.on=false;if(phoneOn){phoneOn=false;phoneB.classList.remove('on')}
    // швидкість стала, як у перехожих: напрям — з джойстика, темп — крок або біг
    p.vx+=(ix/m*sp-p.vx)*Math.min(1,dt*9);p.vz+=(iz/m*sp-p.vz)*Math.min(1,dt*9)}
  else if(p.path){if(steerPath(p,dt,sp))p.path=null}
  else{p.vx*=Math.max(0,1-dt*12);p.vz*=Math.max(0,1-dt*12)}
  if(p.seat){p.x=p.seat.x;p.z=p.seat.z;p.yaw=p.seat.yaw;p.vx=p.vz=0}
  // злам
  const c=actCtx();
  if(hold.on&&c&&c.k==='hack'&&c.t.i===hold.ti&&Math.hypot(p.vx,p.vz)<0.4){hold.p+=dt/HACK_T;p.yaw+=angDiff(Math.atan2(c.t.x-p.x,c.t.z-p.z),p.yaw)*Math.min(1,dt*8);
    if(Math.floor(hold.p*10)!==hold.tk){hold.tk=Math.floor(hold.p*10);SFX.tick(hold.p)}
    if(hold.p>=1){hold.p=0;hold.on=false;req('hk',c.t.i)}}
  else{hold.p=0}
  p.st=p.seat?ST.sit:hold.on&&hold.p>0?ST.work:phoneOn&&Math.hypot(p.vx,p.vz)<0.3?ST.phone:0;
}

/* ---------- фази ---------- */
function onPhase(){
  if(G.ph==='intro'){phase='intro';$('ov').hidden=true;$('mp').hidden=true;
    if(!player){say('Ти глядач','big');tip('Приєднаєшся в наступному раунді')}
    else if(player.role==='hunter'){say('Ти — мисливець','big red');tip('Шпигуни серед перехожих. Торкнись підозрілого й тисни 🎯. Промах по перехожому — оглушення й мінус набій')}
    else{say('Ти — шпигун','big green');tip('Зламай '+G.goal+' терміналів 💾 разом з іншими. Ходи як перехожі: не бігай без потреби, сідай, бери телефон')}}
  if(G.ph==='play'){phase='play';say('Почали!','big')}
  if(G.ph==='end'){phase='end';joy=null;hold.on=false;showEnd()}
  updButtons(true);updHud(true);
}
function syncPhase(){const key=G.r+':'+G.ph;if(key!==lastKey){lastKey=key;onPhase()}}
function showEnd(){
  const spyWin=G.res==='spy',me=player,myWin=me?(me.role==='hunter'?!spyWin:spyWin):false;
  if(myWin){SFX.win();for(let i=0;i<110;i++)confetti.push({x:W/2+(Math.random()-.5)*W*0.8,y:H*0.3,vx:(Math.random()-.5)*420,vy:-150-Math.random()*380,l:2.6,c:['#3DD6C3','#FFC93C','#4C8DFF','#FF7BB0'][i%4],r:Math.random()*6})}else if(me)SFX.lose();
  const why={hack:'Зламано '+G.done.length+' з '+G.goal+' терміналів.',ammo:'У мисливця скінчились набої.',time:'Час вийшов — шпигуни протрималися.',all:'Усіх шпигунів спіймано.',left:'Мисливець вийшов з гри.'}[G.why]||'';
  const title=spyWin?'Шпигуни перемогли':'Мисливець переміг';
  setTimeout(()=>{if(phase!=='end')return;$('ovTitle').textContent=title;$('ovTitle').className=myWin?'win':'lose';$('ovText').textContent=why+(MP.on?' Наступний раунд за кілька секунд.':'');
    const sl=$('scoreList');sl.innerHTML='';
    if(MP.on){const ids=Object.keys(G.sc).filter(id=>G.pl.includes(id)).sort((a,b)=>(G.sc[b]||0)-(G.sc[a]||0));
      for(const id of ids){const li=document.createElement('li');if(id===MP.me)li.className='me';const nm=document.createElement('span');nm.textContent=(id===MP.me?'Ти':String((presOf(id)||{}).n||'Гравець').slice(0,14))+(G.hu.includes(id)?' 🎯':' 🕵');
        const b=document.createElement('b');b.textContent=G.sc[id]||0;li.append(nm,b);sl.append(li)}}
    sl.hidden=!MP.on;$('ovHint').hidden=true;$('soloBtns').hidden=MP.on;$('mpOpen').hidden=MP.on;$('mpNote').hidden=true;
    $('ovBtn').hidden=!(MP.on&&MP.host);$('ovBtn').textContent='Наступний раунд';$('ovLeave').hidden=!MP.on;$('ov').hidden=false},myWin?1500:1200);
}
function startSolo(role){
  au();const map=MAPIDS[Math.floor(Math.random()*MAPIDS.length)],seed=Math.floor(Math.random()*1e9);
  G=role==='hunter'?newG(Date.now(),map,seed,['me'],['me'],['s0','s1','s2'],34,180):newG(Date.now(),map,seed,['me'],['bh'],[],34,180);
  if(role!=='hunter'){G.am.bh=3;G.goal=4}else{G.goal=5;G.am.me=5}
  setupRound(G);lastKey='';introT=6;syncPhase();
}

/* ---------- головний цикл ---------- */
const camPos=new T3.Vector3(),camLook=new T3.Vector3();let camInit=false;
let netT=0;
function update(dt){
  T+=dt;pathBudget=6;
  if(MP.on)mpTick(dt);
  else if(G){
    if(G.ph==='intro'){const b=Math.ceil(introT);introT-=dt;const n=Math.ceil(introT);if(n!==b&&n>0&&n<=3){say(String(n),'num');SFX.beep()}if(introT<=0){G.ph='play';G.rem=G.tl*1000;syncPhase()}}
    else if(G.ph==='play'){G.rem-=dt*1000;if(G.rem<=0)endRound('spy','time')}
    if(G.ph!=='menu')syncPhase();
  }
  if(!G)return;
  myStun=Math.max(0,myStun-dt);shotCd=Math.max(0,shotCd-dt);
  if(player)playerUpdate(player,dt);
  if(isAuth())for(const c of chars){if(c.kind==='bot')botThink(c,dt);jitterTrack(c,dt)}
  if(MP.on)mpFollow(dt);
  const steps=dt>0.03?2:1;
  for(let k=0;k<steps;k++)for(const c of chars){if(c.st===ST.sit||c.out||c.st===ST.down)continue;if(c===player||(isAuth()&&c.kind==='bot'))integrate(c,dt/steps)}
  separate();
  for(const c of chars){if(c.out){c.st=ST.out;c.outT+=dt;if(c.outT>4)c.shown=false}}
  if(MP.on){netT-=dt;if(netT<=0){netT=0.1;mpSend()}}
  playFx();
  aimer=player&&player.role==='hunter'?player:(chars.find(c=>c.id==='bh'&&c.aim>0)||null);
  drawChars(dt);
  // камера
  const fo=camFollow();if(fo){const hi=player&&player.role==='hunter'?[10.4,7.4]:[8.8,6.4];
    const want=new T3.Vector3(fo.x,hi[0],fo.z+hi[1]),look=new T3.Vector3(fo.x,0,fo.z-0.4);
    if(!camInit){camPos.copy(want);camLook.copy(look);camInit=true}
    camPos.lerp(want,Math.min(1,dt*5));camLook.lerp(look,Math.min(1,dt*6));camera.position.copy(camPos);
    if(shakeT>0&&!reduce){shakeT-=dt;camera.position.x+=(Math.random()-.5)*0.16;camera.position.y+=(Math.random()-.5)*0.1}
    camera.lookAt(camLook);sunFollow(fo.x,fo.z)}
  $('stun').style.opacity=myStun>0?Math.min(1,myStun).toFixed(2):0;
  updHud();updButtons();
}
function camFollow(){
  if(player&&!player.out)return player;
  if(!spec||spec.out||!chars.includes(spec))spec=chars.find(c=>c.kind==='human'&&c.role==='spy'&&!c.out)||chars.find(c=>c.role==='hunter')||player||chars[0];
  return spec;
}

/* ---------- HUD ---------- */
let hudKey='';
function updHud(force){
  if(!G)return;const me=player,rem=G.ph==='play'?Math.max(0,G.rem/1000):G.ph==='intro'?G.tl:0,mm=Math.floor(rem/60),ss=Math.floor(rem%60);
  const alive=aliveSpies().length,tot=spiesOf().length,am=me&&me.role==='hunter'?G.am[me.id]|0:-1;
  const key=[G.done.length,G.goal,alive,tot,am,mm,ss,me&&me.role,me&&me.out].join(':');if(key===hudKey&&!force)return;hudKey=key;
  const rc=$('roleChip');rc.textContent=!me?'👁 Глядач':me.out?'💤 Спійманий':me.role==='hunter'?'🎯 Мисливець':'🕵 Шпигун';rc.className='chip role '+(me&&me.role==='hunter'?'hunt':'spy');
  const tc=$('timeChip');tc.textContent=mm+':'+String(ss).padStart(2,'0');tc.classList.toggle('low',G.ph==='play'&&rem<30);
  $('progChip').textContent='💾 '+G.done.length+'/'+G.goal;$('spyChip').textContent='🕵 '+alive+(tot!==alive?'/'+tot:'');
  const ac=$('ammoChip');ac.hidden=am<0;ac.textContent='🎯 '+Math.max(0,am);
}
let btnKey='';
function updButtons(force){
  const p=player,live=p&&!p.out&&(phase==='play'||phase==='intro'),spy=live&&p.role==='spy',hunt=live&&p.role==='hunter',c=spy?actCtx():null,t=hunt?aimTarget():null;
  const key=[spy,hunt,c?c.k+c.label:'',Math.round(hold.p*20),Math.ceil(myStun),Math.ceil(shotCd*2),t?1:0,hunt?G.am[p.id]:0].join(':');if(key===btnKey&&!force)return;btnKey=key;
  runB.hidden=!live;phoneB.hidden=!spy;shootB.hidden=!hunt;
  actB.hidden=!c;if(c){actB.querySelector('.ic').textContent=c.ic;$('actTxt').textContent=c.label;actB.className='pad'+(c.k!=='hack'?' sit':'');actB.style.setProperty('--p',Math.round(hold.p*100)+'%');actB.setAttribute('aria-label',c.label)}
  if(hunt){const off=myStun>0||shotCd>0||(G.am[p.id]|0)<=0||phase!=='play';shootB.classList.toggle('off',off||!t);$('shootTxt').textContent=myStun>0?'Оглушений':(G.am[p.id]|0)<=0?'Порожньо':'Постріл'}
}
function say(text,cls){const el=$('say');el.textContent=text;el.className='say '+(cls||'');void el.offsetWidth;el.classList.add('show')}
function tip(t){const el=$('tip');el.textContent=t;el.hidden=false;el.classList.remove('fade');void el.offsetWidth;el.classList.add('fade')}
function pop(ch,text,color){pops.push({ch,text,color,t:0})}
const rips=[];function ripple(x,z,col='#3DD6C3',s=1){rips.push({x,z,col,s,t:0})}
function vib(ms){try{navigator.vibrate&&navigator.vibrate(ms)}catch(e){}}

/* ---------- накладка ---------- */
const FONT='"Baloo 2","Arial Rounded MT Bold",sans-serif';
function label(x,y,t,bg,fg='#fff'){fctx.font='800 13px '+FONT;const w=fctx.measureText(t).width+12;fctx.fillStyle=bg;fctx.beginPath();fctx.roundRect(x-w/2,y-10,w,19,9);fctx.fill();fctx.fillStyle=fg;fctx.textAlign='center';fctx.textBaseline='middle';fctx.fillText(t,x,y+1)}
function arrowTo(x,z,col,lab){const s=scr(x,0.5,z);let sx=s.x,sy=s.y;const m=34;if(sx>m&&sx<W-m&&sy>110&&sy<H-m&&s.z<1)return;
  const cx=W/2,cy=H/2;let dx=sx-cx,dy=sy-cy;if(s.z>1){dx=-dx;dy=-dy}const k=Math.min((W/2-m)/Math.abs(dx||1e-6),(H/2-m-50)/Math.abs(dy||1e-6));sx=cx+dx*k;sy=cy+dy*k+25;
  fctx.save();fctx.translate(sx,sy);fctx.fillStyle='rgba(0,0,0,.35)';fctx.beginPath();fctx.arc(0,3,16,0,6.283);fctx.fill();fctx.fillStyle=col;fctx.beginPath();fctx.arc(0,0,16,0,6.283);fctx.fill();
  fctx.font='800 15px '+FONT;fctx.textAlign='center';fctx.textBaseline='middle';fctx.fillStyle='#10131A';fctx.fillText(lab,0,1);fctx.restore()}
function drawFx(dt){
  fctx.clearRect(0,0,W,H);
  const me=player,live=phase==='play'||phase==='intro';
  // кола від дотику/зламу
  for(const r of rips){r.t+=dt;const s=scr(r.x,0.05,r.z);if(s.z>1)continue;const k=r.t/0.7;fctx.globalAlpha=Math.max(0,1-k);fctx.strokeStyle=r.col;fctx.lineWidth=3;fctx.beginPath();fctx.ellipse(s.x,s.y,(10+k*40)*r.s,(6+k*24)*r.s,0,0,6.283);fctx.stroke()}
  fctx.globalAlpha=1;for(let i=rips.length-1;i>=0;i--)if(rips[i].t>0.7)rips.splice(i,1);
  if(G&&live&&me&&me.role==='spy'&&!me.out){
    // шпигун бачить, які термінали ще треба зламати
    const open=[];for(const t of terms){const s=scr(t.x,1.55,t.z);const done=G.done.includes(t.i);if(!done)open.push(t);if(s.z>1||s.x<-20||s.x>W+20||s.y<-20||s.y>H+20)continue;label(s.x,s.y,done?'✓':'💾',done?'rgba(30,140,90,.85)':'rgba(10,14,20,.7)')}
    open.sort((a,b)=>dist(a.x,a.z,me.x,me.z)-dist(b.x,b.z,me.x,me.z)).slice(0,2).forEach(t=>arrowTo(t.sx,t.sz,'#3DD6C3','💾'))}
  // підписи: мисливці — усім; свої шпигуни — шпигунам; «Ти» — над собою
  if(G&&phase!=='menu')for(const c of chars){if(!c.shown)continue;let t=null,bg='rgba(10,14,20,.6)';
    if(c===me){t='Ти';bg='rgba(160,120,0,.75)'}else if(c.role==='hunter'){t=c.nick||'Мисливець';bg='rgba(184,52,58,.85)'}else if(me&&me.role==='spy'&&c.role==='spy'&&c.kind==='human'&&MP.on){t=c.nick;bg='rgba(31,156,140,.85)'}
    if(!t)continue;const s=scr(c.x,1.5,c.z);if(s.z>1)continue;label(s.x,s.y,t,bg)}
  // приціл мисливця
  if(me&&me.role==='hunter'&&!me.out&&live){const t=aimTarget();if(t){const s=scr(t.x,0.6,t.z),ok=dist(t.x,t.z,me.x,me.z)<=SHOT_R&&los(me.x,me.z,t.x,t.z);
    fctx.strokeStyle=ok?'#FF5C5C':'rgba(255,255,255,.6)';fctx.lineWidth=3;const r=24+(reduce?0:Math.sin(T*6)*2);fctx.beginPath();fctx.arc(s.x,s.y,r,0,6.283);fctx.stroke();
    for(let i=0;i<4;i++){const a=i*Math.PI/2;fctx.beginPath();fctx.moveTo(s.x+Math.cos(a)*(r-6),s.y+Math.sin(a)*(r-6));fctx.lineTo(s.x+Math.cos(a)*(r+7),s.y+Math.sin(a)*(r+7));fctx.stroke()}}}
  // бот-мисливець цілиться — видно всім (чесно)
  const bh=chars.find(c=>c.id==='bh');if(bh&&bh.aimId&&bh.aim>0&&live){const t=chr(bh.aimId);if(t){const s=scr(t.x,0.6,t.z);fctx.strokeStyle='rgba(255,92,92,'+Math.min(1,bh.aim).toFixed(2)+')';fctx.lineWidth=3;fctx.beginPath();fctx.arc(s.x,s.y,22,0,6.283);fctx.stroke()}}
  // постріли
  for(const d of darts){d.t+=dt;const a=scr(d.ax,0.9,d.az),b=scr(d.bx,0.7,d.bz);fctx.globalAlpha=Math.max(0,1-d.t/0.4);fctx.strokeStyle='#FFE9A8';fctx.lineWidth=4;fctx.beginPath();fctx.moveTo(a.x,a.y);fctx.lineTo(b.x,b.y);fctx.stroke()}
  fctx.globalAlpha=1;darts=darts.filter(d=>d.t<0.4);
  for(const p of pops){p.t+=dt;if(p.t>1.4||!p.ch.shown)continue;const s=scr(p.ch.x,1.35,p.ch.z);if(s.z>1)continue;const y=s.y-p.t*22,e=p.t<0.25?(1-Math.pow(1-p.t/0.25,3))*1.15:1;
    fctx.globalAlpha=p.t>1.1?Math.max(0,1-(p.t-1.1)/0.3):1;fctx.save();fctx.translate(s.x,y);fctx.scale(e,e);fctx.font='800 '+(p.text.length>2?18:26)+'px '+FONT;const w=Math.max(34,fctx.measureText(p.text).width+20),h=34;
    fctx.fillStyle=p.color;fctx.beginPath();fctx.roundRect(-w/2,-h/2,w,h,17);fctx.fill();fctx.beginPath();fctx.moveTo(-6,h/2-1);fctx.lineTo(0,h/2+7);fctx.lineTo(6,h/2-1);fctx.fill();
    fctx.fillStyle='#10131A';fctx.textAlign='center';fctx.textBaseline='middle';fctx.fillText(p.text,0,2);fctx.restore();fctx.globalAlpha=1}
  pops=pops.filter(p=>p.t<1.4);
  if(joy&&joy.moved&&phase!=='end'){const dx=joy.x-joy.sx,dy=joy.y-joy.sy,m=Math.hypot(dx,dy),k=m>55?55/m:1;
    fctx.fillStyle='rgba(255,255,255,.12)';fctx.strokeStyle='rgba(255,255,255,.45)';fctx.lineWidth=2;fctx.beginPath();fctx.arc(joy.sx,joy.sy,55,0,6.283);fctx.fill();fctx.stroke();
    fctx.fillStyle='rgba(255,255,255,.8)';fctx.beginPath();fctx.arc(joy.sx+dx*k,joy.sy+dy*k,22,0,6.283);fctx.fill()}
  for(const c of confetti){c.l-=dt;c.vy+=520*dt;c.x+=c.vx*dt;c.y+=c.vy*dt;c.r+=dt*8;fctx.globalAlpha=Math.min(1,c.l);fctx.fillStyle=c.c;fctx.save();fctx.translate(c.x,c.y);fctx.rotate(c.r);fctx.fillRect(-5,-3,10,6);fctx.restore()}
  confetti=confetti.filter(c=>c.l>0);fctx.globalAlpha=1;
}

/* ---------- меню ---------- */
onTap($('ovSpy'),()=>startSolo('spy'));onTap($('ovHunt'),()=>startSolo('hunter'));
$('ovBtn').addEventListener('click',()=>{au();if(MP.on&&MP.host&&MP.g&&MP.g.ph==='end')hostStartRound()});

/* ---------- мультиплеєр ----------
   Транспорт: ../net-firebase.js (вузол RTDB «agt», до 10 гравців). Хост (найраніший) веде G і всіх ботів;
   у його presence: g = G, bs = стиснені боти. Кожен шле x,z,y (кут), s (стан) і ev (злами, постріли). */
const MP={on:false,avail:null,net:null,code:'',me:null,host:false,nick:'',color:0,g:null,round:-1,phKey:'',phEnd:0,spectator:false,mapSel:'auto',huntSel:'player',crowd:36,tl:240,turn:0,sc:{}};
try{MP.nick=localStorage.getItem('agt_nick')||localStorage.getItem('hns_nick')||'';MP.color=+(localStorage.getItem('agt_color')||localStorage.getItem('hns_color'))||Math.floor(Math.random()*6)}catch(e){}
(async()=>{const t=window.HNS_TRANSPORT;try{MP.avail=t&&await t.ready()?t:null}catch(e){MP.avail=null}$('mpOpen').disabled=!MP.avail;$('mpNote').hidden=!!MP.avail})();
const rcode=()=>Array.from({length:4},()=>'abcdefghjkmnpqrstuvwxyz'[Math.floor(Math.random()*23)]).join('');
function peersNow(){return MP.net?MP.net.peers():[]}
function presOf(id){const p=peersNow().find(p=>p.id===id);return p?p.presence:null}
function humans(){return peersNow().filter(p=>p.presence&&p.presence.n).sort((a,b)=>a.id<b.id?-1:1)}
function hostId(){const ps=humans();const hs=ps.filter(p=>p.presence.h).sort((a,b)=>(+a.presence.h-+b.presence.h)||(a.id<b.id?-1:1));return(hs[0]||ps[0]||{}).id}
const timerLeft=()=>Math.max(0,(MP.phEnd-performance.now())/1000);
$('mpOpen').addEventListener('click',()=>{au();$('ov').hidden=true;$('mp').hidden=false;$('mpA').hidden=false;$('mpB').hidden=true;$('nick').value=MP.nick;$('colorBtn').style.background=PAL[MP.color%PAL.length];
  const h=(location.hash||'').replace('#','');if(/^[a-z]{4}$/.test(h))$('codeIn').value=h.toUpperCase();setTimeout(()=>$('nick').focus(),50)});
$('mpBack').addEventListener('click',()=>{$('mp').hidden=true;$('ov').hidden=false});
$('mpCreate').addEventListener('click',()=>mpJoin(rcode(),true));
$('mpJoinBtn').addEventListener('click',()=>{const c=($('codeIn').value||'').trim().toLowerCase();if(!/^[a-z]{4}$/.test(c)){$('mpErr').textContent='Код має 4 літери, наприклад KQRT.';$('mpErr').hidden=false;return}mpJoin(c)});
$('codeIn').addEventListener('keydown',e=>{if(e.key==='Enter')$('mpJoinBtn').click()});
$('colorBtn').addEventListener('click',()=>{MP.color=(MP.color+1)%PAL.length;$('colorBtn').style.background=PAL[MP.color];if(MP.net)MP.net.presence({c:MP.color})});
$('mpStart').addEventListener('click',()=>{if(!MP.host)return;MP.mapSel=$('mapSel').value;MP.huntSel=$('huntSel').value;MP.crowd=+$('crowdSel').value;MP.tl=+$('timeSel').value;MP.g=null;MP.sc={};hostStartRound()});
$('mpQuit').addEventListener('click',mpLeave);$('ovLeave').addEventListener('click',mpLeave);
$('copyCode').addEventListener('click',()=>{const t=MP.code.toUpperCase();try{navigator.clipboard.writeText(t).then(()=>{$('copyCode').textContent='Скопійовано'},()=>{})}catch(e){}});
async function mpJoin(code,create){
  au();MP.nick=($('nick').value||'').trim().slice(0,14)||'Гравець';try{localStorage.setItem('agt_nick',MP.nick);localStorage.setItem('agt_color',MP.color)}catch(e){}
  $('mpErr').hidden=true;
  try{MP.net=await MP.avail.join(code)}catch(e){$('mpErr').textContent=e&&e.message==='full'?'Кімната повна (до 10).':'Не вдалося увійти в кімнату. Спробуй ще раз.';$('mpErr').hidden=false;return}
  MP.code=code;MP.on=true;MP.joinedAt=performance.now();MP.round=-1;MP.phKey='';MP.g=null;MP.lastG=null;REQ.ev=[];auth.last={};
  MP.net.presence({n:MP.nick,c:MP.color,h:create?Date.now():null});
  location.hash=code;$('roomCode').textContent=code.toUpperCase();$('mpA').hidden=true;$('mpB').hidden=false;
  phase='lobby';G=null;mpLobbyRender();
}
function mpLeave(){if(MP.net)MP.net.leave();MP.net=null;MP.on=false;MP.host=false;MP.g=null;MP.lastG=null;MP.me=null;G=null;location.hash='';
  $('mp').hidden=true;resetMenu();bootScene()}
function mpLobbyRender(){
  const list=$('plist');list.innerHTML='';const hid=hostId();
  humans().forEach(p=>{const li=document.createElement('li');const d=document.createElement('span');d.className='pdot';d.style.background=PAL[(p.presence.c|0)%PAL.length];
    const nm=document.createElement('span');nm.textContent=String(p.presence.n).slice(0,14)+(p.isMe?' (ти)':'');li.append(d,nm);
    if(p.id===hid){const t=document.createElement('em');t.textContent='хост';li.append(t)}list.append(li)});
  const me=(peersNow().find(p=>p.isMe)||{}).id,amHost=!!me&&hid===me;$('hostCtl').hidden=!amHost;$('waitHost').hidden=amHost;
  const two=humans().length>=2;$('huntSel').disabled=!two;if(!two)$('huntSel').value='bot';
}
function hostStartRound(){
  const all=humans().map(p=>p.id);if(!all.length)return;
  const prev=MP.g,r=(prev?prev.r:0)+1,map=MP.mapSel==='auto'?MAPIDS[(r-1)%MAPIDS.length]:MAPIDS[+MP.mapSel]||MAPIDS[0];
  const pl=[MP.me].concat(all.filter(i=>i!==MP.me)).slice(0,10);
  let hu=['bh'];
  if(MP.huntSel==='player'&&pl.length>=2){const order=pl.slice().sort(),n=pl.length>=7?2:1;hu=[];for(let k=0;k<n;k++)hu.push(order[(MP.turn+k)%order.length]);MP.turn=(MP.turn+n)%order.length}
  if(prev)MP.sc=prev.sc;
  MP.g=newG(r,map,Math.floor(Math.random()*1e9),pl,hu,[],MP.crowd,MP.tl,MP.sc);if(hu[0]==='bh'){MP.g.am.bh=Math.max(3,Math.ceil(pl.length*0.8)+1)}
  MP.hostEnd=performance.now()+7000;
}
function hostTick(){
  const g=MP.g;if(!g)return;G=g;
  const left=MP.hostEnd-performance.now(),at=ms=>{MP.hostEnd=performance.now()+ms;return ms};
  if(g.ph==='intro'&&left<=0){g.ph='play';g.k++;g.rem=at(g.tl*1000)}
  else if(g.ph==='play'){
    hostEvents();
    if(left<=0)endRound('spy','time');
    else{const hum=g.hu.filter(h=>h!=='bh');if(hum.length&&!hum.some(h=>presOf(h)))endRound('spy','left');else if(!aliveSpies().length)endRound('hunt','all')}}
  else if(g.ph==='end'&&left<=0)hostStartRound();
  if(MP.g)MP.g.rem=Math.max(0,MP.hostEnd-performance.now());
}
function mpTick(dt){
  const hid=hostId();
  if(!MP.me){const mine=peersNow().find(p=>p.isMe);if(mine)MP.me=mine.id}
  const wasHost=MP.host;MP.host=hid===MP.me&&!!MP.me;
  {const myp=presOf(MP.me);if(myp){if(MP.host&&!myp.h&&performance.now()-MP.joinedAt>1500)MP.net.presence({h:Date.now()});else if(!MP.host&&myp.h&&humans().some(p=>p.id!==MP.me&&p.presence.h&&+p.presence.h<+myp.h))MP.net.presence({h:null})}}
  if(MP.host){if(!MP.g&&MP.lastG){MP.g=JSON.parse(JSON.stringify(MP.lastG));MP.g.k++;MP.hostEnd=performance.now()+Math.max(1000,MP.lastG.rem);MP.sc=MP.g.sc;
      auth.last={};for(const p of peersNow()){const ev=(p.presence||{}).ev;if(Array.isArray(ev)&&ev.length)auth.last[p.id]=ev[ev.length-1][0]}}
    // став хостом посеред раунду: боти отримують нові плани з місць, де стоять зараз
    if(!wasHost&&MP.round>=0)for(const c of chars)if(c.kind==='bot'){c.plan=c.st===ST.down?'down':null;c.t=2;c.path=null;if(c.st===ST.sit){c.st=0}}
    hostTick()}
  const g=MP.host?MP.g:(presOf(hid)||{}).g;
  if(!MP.host&&g)MP.lastG=g;
  if(phase==='lobby'&&Math.floor(T*4)!==MP.lr){MP.lr=Math.floor(T*4);mpLobbyRender()}
  if(!g)return;
  if(g.r!==MP.round){MP.round=g.r;MP.spectator=!g.pl.includes(MP.me);REQ.ev=[];G=g;setupRound(g);lastKey='';camInit=false}
  G=g;
  if(!MP.host){for(const id of g.out){const c=chr(id);if(c)c.out=true}}
  const key=g.r+':'+g.k;if(key!==MP.phKey){MP.phKey=key;MP.phEnd=performance.now()+g.rem}
  if(!MP.host&&g.ph==='play')g.rem=timerLeft()*1000;
  if(g.ph==='intro'){const n=Math.ceil(timerLeft());if(n!==MP.lastN&&n>0&&n<=3){MP.lastN=n;say(String(n),'num');SFX.beep()}}
  syncPhase();
}
/* боти: 6 символів на бота — x і z по 12 біт (1/32 м), кут 6 біт, стан 4 біти + біг */
const B64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',B64I={};for(let i=0;i<64;i++)B64I[B64[i]]=i;
function encBots(){let s='';for(const c of chars){if(c.kind!=='bot')continue;const x=Math.max(0,Math.min(4095,Math.round(c.x*32))),z=Math.max(0,Math.min(4095,Math.round(c.z*32))),y=((Math.round(c.yaw/6.283185*64)%64)+64)%64,st=(c.st&15)|(Math.hypot(c.vx,c.vz)>2.2?16:0);
  s+=B64[x>>6]+B64[x&63]+B64[z>>6]+B64[z&63]+B64[y]+B64[st]}return s}
let lastBs='',lastBsT=0,bsInt=0.14;
function mpFollow(dt){
  if(!G||G.r!==MP.round)return;
  const hp=MP.host?null:presOf(hostId());const bs=hp&&hp.bs;
  if(typeof bs==='string'&&bs!==lastBs){const now=performance.now()/1000;if(lastBsT)bsInt=bsInt*0.8+Math.min(0.5,now-lastBsT)*0.2;lastBsT=now;lastBs=bs;
    let i=0;for(const c of chars){if(c.kind!=='bot')continue;const o=i*6;i++;if(o+6>bs.length)break;
      const x=((B64I[bs[o]]<<6)|B64I[bs[o+1]])/32,z=((B64I[bs[o+2]]<<6)|B64I[bs[o+3]])/32,y=B64I[bs[o+4]]/64*6.283185,st=B64I[bs[o+5]];
      setTarget(c,x,z,y,st&15)}}
  for(const c of chars){if(!c.remote||c.kind!=='human')continue;const p=presOf(c.id);if(!p||typeof p.x!=='number')continue;
    if(p!==c.lastP){c.lastP=p;const now=performance.now()/1000;if(c.lastPT)c.idur=c.idur*0.8+Math.min(0.5,now-c.lastPT)*0.2;c.lastPT=now;setTarget(c,p.x,p.z,p.y||0,p.s|0)}}
  for(const c of chars){if(c===player||(c.kind==='human'&&!c.remote)||(c.kind==='bot'&&MP.host))continue;
    c.it+=dt;const d=c.kind==='bot'?bsInt:c.idur,k=Math.min(1,c.it/Math.max(0.05,d)),ox=c.x,oz=c.z;
    c.x=c.fx0+(c.tx-c.fx0)*k;c.z=c.fz0+(c.tz-c.fz0)*k;
    if(c.st===ST.sit){c.x=c.tx;c.z=c.tz}
    const vx=(c.x-ox)/Math.max(dt,1e-3),vz=(c.z-oz)/Math.max(dt,1e-3);c.vx=c.vx*0.6+vx*0.4;c.vz=c.vz*0.6+vz*0.4;if(k>=1&&c.it>d*1.6){c.vx*=0.8;c.vz*=0.8}
    c.yaw+=angDiff(c.tyaw,c.yaw)*Math.min(1,dt*12)}
}
function setTarget(c,x,z,y,st){if(Math.hypot(x-c.x,z-c.z)>3||st===ST.sit&&c.st!==ST.sit){c.x=x;c.z=z}c.fx0=c.x;c.fz0=c.z;c.tx=x;c.tz=z;c.tyaw=y;c.it=0;if(!c.out){c.st=st;if(st===ST.sit){const s=seats.find(s=>dist(s.x,s.z,x,z)<0.3);c.seatY=s?s.y:0.47}}}
function mpSend(){
  const o={ev:REQ.ev};const me=player;
  if(me&&G&&G.r===MP.round){o.x=+me.x.toFixed(2);o.z=+me.z.toFixed(2);o.y=+me.yaw.toFixed(2);o.s=me.st}
  if(MP.host&&MP.g){o.g=MP.g;o.bs=encBots()}else{o.g=null;o.bs=null}
  MP.net.presence(o);
}

/* ---------- заставка в меню: вокзал живе ---------- */
function resetMenu(){$('ov').hidden=false;$('ovTitle').textContent='Агенти';$('ovTitle').className='';$('ovText').textContent=MENU_TEXT;$('scoreList').hidden=true;$('ovHint').hidden=false;$('soloBtns').hidden=false;$('ovBtn').hidden=true;$('mpOpen').hidden=false;$('mpNote').hidden=!!MP.avail;$('ovLeave').hidden=true}
const MENU_TEXT=$('ovText').textContent;
function bootScene(){
  phase='menu';const seed=12345;G={r:0,ph:'menu',done:[],out:[],hu:[],pl:[],bs:[],am:{},fx:[],fxn:0,goal:0,sc:{},tl:0};
  buildWorld(MAPIDS[0],seed);world.seed=null;clearChars();
  const R=rng(7);for(let i=0;i<30;i++){const p=wander[Math.floor(R()*wander.length)];newChar('b'+i,'bot','bot',p[0],p[1],appOf(R))}
  for(let k=0;k<2;k++)for(const b of chars){pathBudget=99;if(!b.plan)choose(b)}
  for(const id of['run','phone','act','shoot'])$(id).hidden=true;
}
function menuScene(dt){T+=dt;pathBudget=4;for(const b of chars)botThink(b,dt);for(const c of chars){if(c.st!==ST.sit&&c.st!==ST.down)integrate(c,dt)}separate();drawChars(dt);
  const cx=world.W/2+Math.sin(T*0.05)*12,cz=world.H/2+Math.cos(T*0.07)*6;camera.position.set(cx,13,cz+9);camera.lookAt(cx,0,cz);sunFollow(cx,cz)}
bootScene();
let last=performance.now();
function frame(now){const dt=Math.min(0.1,(now-last)/1000);last=now;
  if(phase==='lobby'){T+=dt;mpTick(dt)}
  if(phase==='menu'||phase==='lobby')menuScene(dt);
  else update(dt);
  renderer.render(scene,camera);drawFx(dt);requestAnimationFrame(frame)}
requestAnimationFrame(frame);

/* для автотестів (bots/local-sim/agents-test.js) */
window.AGTGame={get phase(){return phase},get G(){return G},get player(){return player},get chars(){return chars},get terms(){return terms},get seats(){return seats},get works(){return works},get MP(){return MP},
  get nav(){return nav},get world(){return world},get hold(){return hold},get myStun(){return myStun},startSolo,sim:s=>{for(let t=0;t<s;t+=1/30)update(1/30)},actCtx,aimTarget,shoot,sitDown,standUp,astar,snap,los,tapAt,
  select:id=>{selT=id},susp,set run(v){runOn=v},keys,encBots,renderer,MAPIDS,buildWorld,get spawn(){return spawnPt},chr};
})();
