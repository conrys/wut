/* Цар гори — утримання зони. Поки ти в зоні сам — капає 1 очко за секунду; двоє й більше — ніхто не отримує.
   Зона кожні 30 с переїжджає в іншу кімнату (за 6 с показує, куди). Перший до 60 очок або лідер за 3 хв — цар гори.
   ✋ Поштовх (у всіх) відкидає найближчого; ще одне випадкове вміння на раунд: 💨 ривок, 🛡 щит, 🫧 калюжа.
   Рушій і карти — з Хованок (../khovanky/world.js), персонажі-інстанси й мережа — як в Агентах.
   Авторитет: соло — сам телефон; мережа — хост (стан раунду G, очки, зона, боти). Поштовх/щит/калюжа — запити до хоста;
   відкидання застосовує той, хто керує персонажем (гравець — себе, хост — ботів), коли бачить подію в G.fx. */
(function(){
const T3=THREE,HW=HNSWorld,$=id=>document.getElementById(id);
function onTap(el,fn){let t=0;el.addEventListener('pointerdown',e=>{if(e.button>0)return;e.preventDefault();t=performance.now();fn(e)});el.addEventListener('click',e=>{if(performance.now()-t<700)return;fn(e)})}
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile=Math.min(innerWidth,innerHeight)<700;
const dist=(ax,az,bx,bz)=>Math.hypot(ax-bx,az-bz);
function rng(s){return()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const angDiff=(a,b)=>{let d=(a-b)%(Math.PI*2);if(d>Math.PI)d-=Math.PI*2;if(d<-Math.PI)d+=Math.PI*2;return d};
/* карти: усі карти Хованок + нові з редактора, позначені для «Цар гори» (../maps-remote.js) */
const mapIds=()=>HW.MAPS.map((m,i)=>i);

/* ---------- константи ---------- */
const NMAX=12,SPEED=3.1,BOT_SPEED=2.75,ZR=1.6,ZONE_T=30,WARN=6,GOAL=60,ROUND=180,
  PUSH_R=1.8,PUSH_CD=3,PUSH_V=9.5,STUN=0.8,DASH_V=11,DASH_T=0.24,PD_R=1.4,SLOW=0.4,SHIELD_T=3,PD_T=7;
const ABIL={
  dash:{ic:'💨',name:'Ривок',cd:6,hint:'💨 Ривок: різкий стрибок уперед — доскочити до зони або вирватися з бійки'},
  shield:{ic:'🛡',name:'Щит',cd:12,hint:'🛡 Щит: 3 секунди тебе не виштовхнути, а хто штовхне — відлетить сам'},
  puddle:{ic:'🫧',name:'Калюжа',cd:12,hint:'🫧 Калюжа: мильна пляма під тобою, суперники в ній ледве повзуть 7 секунд'}};
const AB_KEYS=Object.keys(ABIL);
const PAL=['#FF5C5C','#4C8DFF','#4CC97A','#FFC93C','#A779F2','#FF9A3D','#FF7BB0','#3CC8C8','#8BD14B','#F2F2F2','#B5835A','#7D8CA3'];
const BOT_NAMES=['Бублик','Вареник','Пиріжок','Сирник','Млинець','Галушка','Пампух','Кнедлик','Корж'];
const ST={stun:1,push:2,dash:4,shield:8};

/* ---------- renderer ---------- */
const renderer=new T3.WebGLRenderer({canvas:$('gl'),antialias:true});
renderer.setPixelRatio(Math.min(mobile?1.5:2,devicePixelRatio||1));
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T3.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;
const scene=new T3.Scene();scene.background=new T3.Color('#8FCB72');
const camera=new T3.PerspectiveCamera(46,1,0.5,140);
const fx=$('fx'),fctx=fx.getContext('2d');let W,H;
const VIEW_LONG=60*Math.PI/180;
function resize(){W=innerWidth;H=innerHeight;renderer.setSize(W,H,false);camera.aspect=W/H;
  camera.fov=(W>H?2*Math.atan(Math.tan(VIEW_LONG/2)*H/W):VIEW_LONG)*180/Math.PI;camera.updateProjectionMatrix();const d=Math.min(2,devicePixelRatio||1);fx.width=W*d;fx.height=H*d;fctx.setTransform(d,0,0,d,0,0)}
addEventListener('resize',resize);resize();
scene.add(new T3.HemisphereLight(0xEAF2FF,0xB59C82,0.6));
const sun=new T3.DirectionalLight(0xFFF0DC,0.62);sun.castShadow=true;sun.shadow.mapSize.set(mobile?1024:2048,mobile?1024:2048);sun.shadow.bias=-0.0006;sun.shadow.normalBias=0.03;
{const sc=sun.shadow.camera;sc.left=-17;sc.right=17;sc.top=14;sc.bottom=-14;sc.near=1;sc.far=50;sc.updateProjectionMatrix()}
scene.add(sun);scene.add(sun.target);
let sunAt=[1e9,1e9];
function sunFollow(x,z){const sx=Math.round(x/4)*4,sz=Math.round(z/4)*4;if(sx===sunAt[0]&&sz===sunAt[1])return;sunAt=[sx,sz];
  sun.position.set(sx-7,18,sz+9);sun.target.position.set(sx,0,sz);sun.target.updateMatrixWorld();renderer.shadowMap.needsUpdate=true}
const gm=new T3.DataTexture(new Uint8Array([120,190,255]),3,1,T3.LuminanceFormat);gm.minFilter=gm.magFilter=T3.NearestFilter;gm.needsUpdate=true;
const toon=(c,o={})=>new T3.MeshToonMaterial(Object.assign({color:c,gradientMap:gm},o));
const ground=new T3.Mesh(new T3.PlaneGeometry(200,200).rotateX(-Math.PI/2),toon('#8FA08E'));ground.position.y=-0.11;ground.receiveShadow=true;scene.add(ground);

/* ---------- світ і зони ---------- */
let world=null,staticMesh=null,nav=null,mapIdx=-1,mapDef=null,wander=[],zones=[];
function buildWorld(mi,seed){
  if(staticMesh){scene.remove(staticMesh);staticMesh.geometry.dispose()}
  mapIdx=mi;world=HW.build(scene,{map:mi});mapDef=world.def;world.seed=seed;
  ground.position.set(world.W/2,-0.11,world.H/2);scene.background.set(mapDef.grass||'#8FCB72');
  staticMesh=world.mesh.mesh(new T3.MeshToonMaterial({vertexColors:true,gradientMap:gm}));staticMesh.castShadow=staticMesh.receiveShadow=true;scene.add(staticMesh);
  nav=HW.walkGrid(world.boxes,0.3);allocNav();findWander();findZones(seed);
  sunAt=[1e9,1e9];renderer.shadowMap.needsUpdate=true;
}
const roomAt=(x,z)=>{const r=world.grid[Math.floor(z)];return r&&r[Math.floor(x)]!==undefined?r[Math.floor(x)]:'#'};
const roomName=(x,z)=>{const ch=roomAt(x,z);return(mapDef.rooms||{})[ch]||(mapDef.id==='house'?HW.ROOMS[ch]:'')||''};
/* зони: місця, де коло радіусом ~1.5 м майже все — вільна підлога однієї кімнати; по одній на кімнату, далеко одна від одної */
function findZones(seed){
  zones=[];const R=rng((seed|0)^0xC0DE),cand=[];
  for(let z=1.5;z<world.H-1.5;z+=0.5)for(let x=1.5;x<world.W-1.5;x+=0.5){const room=roomAt(x,z);if(room==='#'||!nav.free[ci(x,z)])continue;
    let tot=0,fr=0;for(let dz=-1.5;dz<=1.5;dz+=0.5)for(let dx=-1.5;dx<=1.5;dx+=0.5){if(dx*dx+dz*dz>2.3)continue;tot++;if(nav.free[ci(x+dx,z+dz)]&&roomAt(x+dx,z+dz)===room)fr++}
    const f=fr/tot;if(f>=0.72)cand.push({x,z,room,s:f+R()*0.2})}
  cand.sort((a,b)=>b.s-a.s);
  const rooms=new Set(cand.map(c=>c.room)).size;
  for(const [gap,cap] of[[6,rooms>=4?1:2],[4.5,3]])for(const c of cand){if(zones.length>=12)break;
    if(zones.some(o=>dist(o.x,o.z,c.x,c.z)<gap))continue;if(zones.filter(o=>o.room===c.room).length>=cap)continue;zones.push({x:c.x,z:c.z,room:c.room,i:zones.length})}
  if(!zones.length){const [x,z]=snap(mapDef.spawn[0],mapDef.spawn[1]);zones.push({x,z,room:roomAt(x,z),i:0})}
}
function findWander(){wander=[];for(let j=2;j<nav.nz-2;j+=2)for(let i=2;i<nav.nx-2;i+=2){let ok=1;for(let dj=-1;dj<=1&&ok;dj++)for(let di=-1;di<=1;di++)if(!nav.free[(j+dj)*nav.nx+i+di]){ok=0;break}if(ok)wander.push([(i+0.5)*HW.CS,(j+0.5)*HW.CS])}}

/* ---------- навігація (як в Агентах) ---------- */
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

/* ---------- зона, калюжі, щити: меші ---------- */
const zoneGlow=new T3.Mesh(new T3.CylinderGeometry(ZR,ZR,2.4,40,1,true),new T3.MeshBasicMaterial({color:'#FFE27A',transparent:true,opacity:0.16,side:T3.DoubleSide,depthWrite:false}));
zoneGlow.position.y=1.2;zoneGlow.renderOrder=3;
const zoneDisc=new T3.Mesh(new T3.CircleGeometry(ZR,40).rotateX(-Math.PI/2),new T3.MeshBasicMaterial({color:'#FFE27A',transparent:true,opacity:0.32,depthWrite:false}));zoneDisc.position.y=0.02;zoneDisc.renderOrder=1;
const zoneRing=new T3.Mesh(new T3.RingGeometry(ZR-0.14,ZR,48).rotateX(-Math.PI/2),new T3.MeshBasicMaterial({color:'#FFC93C',transparent:true,opacity:0.95,depthWrite:false}));zoneRing.position.y=0.03;zoneRing.renderOrder=2;
const nextRing=new T3.Mesh(new T3.RingGeometry(ZR-0.1,ZR,48).rotateX(-Math.PI/2),new T3.MeshBasicMaterial({color:'#FFFFFF',transparent:true,opacity:0.6,depthWrite:false}));nextRing.position.y=0.03;nextRing.renderOrder=2;
const zoneG=new T3.Group();zoneG.add(zoneGlow,zoneDisc,zoneRing);scene.add(zoneG,nextRing);zoneG.visible=nextRing.visible=false;
const ZC={free:new T3.Color('#FFE27A'),fight:new T3.Color('#FF5C5C'),tmp:new T3.Color()};
const pdIM=new T3.InstancedMesh(new T3.CircleGeometry(PD_R,28).rotateX(-Math.PI/2),new T3.MeshBasicMaterial({color:'#9BE3FF',transparent:true,opacity:0.55,depthWrite:false}),12);
pdIM.position.y=0.015;pdIM.count=0;pdIM.renderOrder=1;pdIM.frustumCulled=false;scene.add(pdIM);

/* ---------- персонажі: інстанси ---------- */
const BEAN=new T3.LatheGeometry([[0,0],[0.17,0.012],[0.25,0.06],[0.285,0.17],[0.29,0.36],[0.285,0.55],[0.26,0.7],[0.21,0.82],[0.13,0.9],[0,0.93]].map(([x,y])=>new T3.Vector2(x,y)),18);
const SPHS=new T3.SphereGeometry(1,7,5),SPH=new T3.SphereGeometry(1,16,10),CYL=new T3.CylinderGeometry(1,1,1,12,1,true),CONE=new T3.ConeGeometry(1,1,6),DISC=new T3.CircleGeometry(1,18).rotateX(-Math.PI/2),RING=new T3.RingGeometry(0.4,0.5,28).rotateX(-Math.PI/2);
function IM(geo,mat,n,colored){const m=new T3.InstancedMesh(geo,mat,n);m.instanceMatrix.setUsage(T3.DynamicDrawUsage);m.frustumCulled=false;
  if(colored){const w=new T3.Color('#ffffff');for(let i=0;i<n;i++)m.setColorAt(i,w);m.instanceColor.setUsage(T3.DynamicDrawUsage)}m.count=0;m.castShadow=false;scene.add(m);return m}
const gold=toon('#FFC93C',{side:T3.DoubleSide});
const IB={body:IM(BEAN,toon('#ffffff'),NMAX,1),hand:IM(SPHS,toon('#ffffff'),NMAX*2,1),foot:IM(SPHS,toon('#ffffff'),NMAX*2,1),eye:IM(SPHS,toon('#FFFFFF'),NMAX*2),blk:IM(SPHS,toon('#1D1A26'),NMAX*3),
  crown:IM(CYL,gold,2),spike:IM(CONE,gold,10),
  bubble:IM(SPH,new T3.MeshBasicMaterial({color:'#9BD8FF',transparent:true,opacity:0.28,depthWrite:false}),NMAX),
  shadow:IM(DISC,new T3.MeshBasicMaterial({color:'#000000',transparent:true,opacity:0.2,depthWrite:false}),NMAX),
  mark:IM(RING,new T3.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:0.9,depthWrite:false}),NMAX,1)};
IB.shadow.renderOrder=1;IB.mark.renderOrder=2;IB.bubble.renderOrder=4;
const _m=new T3.Matrix4(),_root=new T3.Matrix4(),_body=new T3.Matrix4(),_q=new T3.Quaternion(),_e=new T3.Euler(),_v=new T3.Vector3(),_s=new T3.Vector3(),_c=new T3.Color();
function L(par,x,y,z,sx,sy,sz,rx=0,ry=0,rz=0){_q.setFromEuler(_e.set(rx,ry,rz));_m.compose(_v.set(x,y,z),_q,_s.set(sx,sy,sz));return _m.premultiply(par)}

let chars=[],player=null;
function newChar(id,kind,x,z,colI,nick,ab){
  const c={id,kind,x,z,vx:0,vz:0,kx:0,kz:0,yaw:Math.random()*6.283,ph:Math.random()*6,blinkT:Math.random()*3,stun:0,dashT:0,dx:0,dz:0,pushT:0,cdP:0,cdA:0,
    col:new T3.Color(PAL[colI%PAL.length]),colI,dark:new T3.Color(PAL[colI%PAL.length]).multiplyScalar(0.55),nick:nick||'',ab:ab||'dash',
    path:null,pi:0,remote:false,gone:false,fx0:x,fz0:z,tx:x,tz:z,tyaw:0,it:1,idur:0.15,st:0,off:null,offT:0,rep:0,react:0,rt:0.5,
    bold:0.45+Math.random()*0.55,daze:0};  // bold — характер бота: сміливі лізуть у бійку, обережні чекають на краю
  chars.push(c);return c;
}
const chr=id=>chars.find(c=>c.id===id);
const P=c=>c.remote?[c.tx,c.tz]:[c.x,c.z];
function leaderId(){if(!G||!G.sc)return null;let best=null,bv=0.999;for(const id in G.sc){const v=G.sc[id];if(v>bv){bv=v;best=id}}return best}

function drawChars(dt){
  const n={body:0,hand:0,foot:0,eye:0,blk:0,crown:0,spike:0,bubble:0,shadow:0,mark:0};
  const king=leaderId();
  for(const c of chars){
    if(c.gone)continue;
    const sp=Math.hypot(c.vx+c.kx,c.vz+c.kz),k=Math.min(1,Math.hypot(c.vx,c.vz)/2.6);
    c.ph+=dt*(4+sp*3.4);
    const wob=c.stun>0&&!reduce?Math.sin(T*22)*0.25*Math.min(1,c.stun*2):0;
    _q.setFromEuler(_e.set(0,c.yaw+wob,0));_root.compose(_v.set(c.x,0,c.z),_q,_s.set(1.2,1.2,1.2));
    const bob=reduce?0:Math.abs(Math.sin(c.ph))*0.07*k;
    const lean=c.dashT>0?0.45:c.pushT>0?0.3:k*0.2;
    _q.setFromEuler(_e.set(lean,0,wob*0.6)) ;_body.compose(_v.set(0,bob,0),_q,_s.set(1,1-bob*0.8,1)).premultiply(_root);
    IB.body.setMatrixAt(n.body,_body);IB.body.setColorAt(n.body++,c.col);
    c.blinkT-=dt;if(c.blinkT<0)c.blinkT=2+Math.random()*3;const bl=c.blinkT<0.1?0.12:1,dz=c.stun>0?0.5:1;
    for(const s of[-1,1]){IB.eye.setMatrixAt(n.eye++,L(_body,s*0.095,0.64,0.215,0.075,0.085*bl,0.05));IB.blk.setMatrixAt(n.blk++,L(_body,s*0.095,0.635,0.255,0.04*dz,0.048*bl*dz,0.025))}
    IB.blk.setMatrixAt(n.blk++,L(_body,0,0.53,0.255,c.stun>0?0.03:0.035,c.stun>0?0.03:0.016,0.012));
    const sw=reduce?0:Math.sin(c.ph)*k;
    for(const s of[-1,1]){IB.foot.setMatrixAt(n.foot,L(_root,s*0.11,0.045+Math.max(0,s*Math.sin(c.ph))*0.07*k,0.02-s*sw*0.15,0.085,0.055,0.12));IB.foot.setColorAt(n.foot++,c.dark)}
    let hl=[-0.31,0.36,0.02-sw*0.12],hr=[0.31,0.36,0.02+sw*0.12];
    if(c.pushT>0){hl=[-0.17,0.5,0.42];hr=[0.17,0.5,0.42]}else if(c.stun>0){hl=[-0.34,0.75,0];hr=[0.34,0.75,0]}
    for(const h of[hl,hr]){IB.hand.setMatrixAt(n.hand,L(_body,h[0],h[1],h[2],0.07,0.07,0.07));IB.hand.setColorAt(n.hand++,c.col)}
    if(c.id===king&&n.crown<2){IB.crown.setMatrixAt(n.crown++,L(_body,0,0.93,0,0.2,0.12,0.2));for(let i=0;i<5;i++){const a=i/5*6.283;IB.spike.setMatrixAt(n.spike++,L(_body,Math.sin(a)*0.17,1.05,Math.cos(a)*0.17,0.05,0.12,0.05))}}
    if(G&&G.shd&&(G.shd[c.id]|0)>0){_m.compose(_v.set(c.x,0.6,c.z),_q.set(0,0,0,1),_s.set(0.62,0.72,0.62));IB.bubble.setMatrixAt(n.bubble++,_m)}
    _m.compose(_v.set(c.x,0.012,c.z),_q.set(0,0,0,1),_s.set(0.36,1,0.36));IB.shadow.setMatrixAt(n.shadow++,_m);
    _m.compose(_v.set(c.x,0.025,c.z),_q.set(0,0,0,1),_s.set(1,1,1));IB.mark.setMatrixAt(n.mark,_m);IB.mark.setColorAt(n.mark++,c===player?_c.set('#FFD23F'):c.col);
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
function steerTo(ch,dt,x,z,speed){const dx=x-ch.x,dz=z-ch.z,d=Math.hypot(dx,dz);const sp=Math.min(speed,d*3);const tx=d>0.05?dx/d*sp:0,tz=d>0.05?dz/d*sp:0;
  ch.vx+=(tx-ch.vx)*Math.min(1,dt*9);ch.vz+=(tz-ch.vz)*Math.min(1,dt*9)}
function collide(ch){
  const r=0.28;
  for(const b of world.boxes){if(ch.x<b[0]-r||ch.x>b[2]+r||ch.z<b[1]-r||ch.z>b[3]+r)continue;
    const cx=Math.max(b[0],Math.min(ch.x,b[2])),cz=Math.max(b[1],Math.min(ch.z,b[3]));let dx=ch.x-cx,dz=ch.z-cz,d=Math.hypot(dx,dz);
    if(d<r){if(d<1e-5){const l=ch.x-b[0],rr=b[2]-ch.x,t=ch.z-b[1],bb=b[3]-ch.z,m=Math.min(l,rr,t,bb);if(m===l)ch.x=b[0]-r;else if(m===rr)ch.x=b[2]+r;else if(m===t)ch.z=b[1]-r;else ch.z=b[3]+r;continue}
      ch.x=cx+dx/d*r;ch.z=cz+dz/d*r;const nx=dx/d,nz=dz/d;
      const vn=ch.vx*nx+ch.vz*nz;if(vn<0){ch.vx-=vn*nx;ch.vz-=vn*nz}
      const kn=ch.kx*nx+ch.kz*nz;if(kn<0){ch.kx-=kn*nx*1.5;ch.kz-=kn*nz*1.5}}}  // об стіну відскакує, а не прилипає
}
function integrate(ch,dt){
  const kd=Math.exp(-dt*4.2);ch.x+=(ch.vx+ch.kx)*dt;ch.z+=(ch.vz+ch.kz)*dt;ch.kx*=kd;ch.kz*=kd;if(Math.hypot(ch.kx,ch.kz)<0.05)ch.kx=ch.kz=0;
  collide(ch);const sp=Math.hypot(ch.vx,ch.vz);if(sp>0.25&&ch.stun<=0)ch.yaw+=angDiff(Math.atan2(ch.vx,ch.vz),ch.yaw)*Math.min(1,dt*12)}
/* персонажі не проходять одне крізь одного; штовхаємо лише тих, кого веде цей телефон */
function separate(){
  const mine=c=>c===player||(isAuth()&&c.kind==='bot');
  for(let i=0;i<chars.length;i++){const a=chars[i];if(a.gone)continue;for(let j=i+1;j<chars.length;j++){const b=chars[j];if(b.gone)continue;
    const ex=a.x-b.x,ez=a.z-b.z,d=Math.hypot(ex,ez),R=0.55;if(d>=R||d<1e-4)continue;const pu=(R-d)/2;
    const ma=mine(a),mb=mine(b);if(ma){a.x+=ex/d*pu*(mb?1:2);a.z+=ez/d*pu*(mb?1:2)}if(mb){b.x-=ex/d*pu*(ma?1:2);b.z-=ez/d*pu*(ma?1:2)}}}
}
function slowOf(c){if(!G||!G.pd)return 1;for(const p of G.pd){if(p[2]!==c.id&&dist(p[0],p[1],c.x,c.z)<PD_R)return SLOW}return 1}
function knock(c,dx,dz,k){c.kx=dx*PUSH_V*k;c.kz=dz*PUSH_V*k;c.stun=STUN*k;c.path=null;c.dashT=0;c.vx*=0.2;c.vz*=0.2;if(c.kind==="bot")c.daze=0.8+Math.random()*1.0}
function dash(c,dx,dz){const m=Math.hypot(dx,dz);if(m<1e-3){dx=Math.sin(c.yaw);dz=Math.cos(c.yaw)}else{dx/=m;dz/=m}c.dashT=DASH_T;c.dx=dx;c.dz=dz;c.yaw=Math.atan2(dx,dz);c.path=null}
function pushTarget(c){let best=null,bs=1e9;for(const o of chars){if(o===c||o.gone)continue;const [ox,oz]=[o.x,o.z],d=dist(ox,oz,c.x,c.z);if(d>PUSH_R)continue;
  const a=Math.abs(angDiff(Math.atan2(ox-c.x,oz-c.z),c.yaw)),s=d+a*0.45;if(s<bs){bs=s;best=o}}return best}

/* ---------- боти (соло або хост) ---------- */
function botThink(b,dt){
  if(!G||G.ph!=='play'){b.vx*=0.7;b.vz*=0.7;return}
  if(b.stun>0){b.vx*=0.8;b.vz*=0.8;return}
  if(b.daze>0){b.daze-=dt;b.vx*=0.85;b.vz*=0.85;return}   // після поштовху — мить отямитися
  if(b.dashT>0){b.vx=b.dx*DASH_V;b.vz=b.dz*DASH_V;return}
  const zc=zones[G.zi];if(!zc)return;
  const goal=G.zn>=0&&G.zt<2600&&zones[G.zn]?zones[G.zn]:zc;
  b.offT-=dt;if(!b.off||b.offT<=0){const a=Math.random()*6.283,r=Math.random()*0.9;b.off=[Math.cos(a)*r,Math.sin(a)*r];b.offT=1.5+Math.random()*3}
  let tx=goal.x+b.off[0],tz=goal.z+b.off[1];const dg=dist(b.x,b.z,goal.x,goal.z),inZ=dist(b.x,b.z,zc.x,zc.z)<ZR+0.2;
  // обережний бот чекає на краю, поки в зоні тісно: найобережніші — якщо там хоч хтось, середні — якщо двоє.
  // У тісній зоні з поштовхом на перезарядці теж відступає до краю — так хтось встигає побути царем.
  const others=(G.n|0)-(inZ?1:0),wait=b.bold<0.6?1:b.bold<0.85?2:9;
  b.back=(b.back||0)-dt;if(inZ&&others>=2&&b.cdP>0.8&&b.bold<0.9&&b.back<=0&&Math.random()<dt*0.8)b.back=1.5+Math.random()*1.5;
  if(goal===zc&&(b.back>0||(!inZ&&others>=wait))){const a=Math.atan2(b.x-zc.x,b.z-zc.z);const [ex,ez]=snap(zc.x+Math.sin(a)*(ZR+1.2),zc.z+Math.cos(a)*(ZR+1.2));tx=ex;tz=ez}
  let near=null,nd=1e9;for(const c of chars){if(c===b||c.gone)continue;const [x,z]=P(c),d=dist(x,z,b.x,b.z);if(d<nd){nd=d;near=c}}
  // поштовх: коли суперник поруч і хтось із нас у зоні (з невеликою «реакцією», щоб боти не були ідеальні)
  if(near&&nd<PUSH_R-0.2&&b.cdP<=0){const [nx,nz]=P(near),hot=dist(nx,nz,zc.x,zc.z)<ZR+0.9||inZ;
    if(hot){b.react+=dt;if(b.react>b.rt){b.react=0;b.rt=0.35+Math.random()*0.6;b.cdP=PUSH_CD*(1+Math.random()*0.35);b.pushT=0.25;b.yaw=Math.atan2(nx-b.x,nz-b.z);SFX.whoosh(b);applyPush(b.id,near.id)}}else b.react=0}else b.react=0;
  // вміння
  if(b.cdA<=0){
    if(b.ab==='dash'&&dg>4&&lineFree(b.x,b.z,goal.x,goal.z)&&Math.random()<dt*1.6){b.cdA=ABIL.dash.cd;dash(b,goal.x-b.x,goal.z-b.z);return}
    if(b.ab==='shield'&&inZ&&near&&nd<2.3&&Math.random()<dt*2){b.cdA=ABIL.shield.cd;applyShield(b.id)}
    if(b.ab==='puddle'&&inZ&&near&&nd<4.5&&nd>1.2&&Math.random()<dt*1.4){b.cdA=ABIL.puddle.cd;applyPuddle(b.id,[b.x,b.z])}}
  const sp=BOT_SPEED*slowOf(b);
  if(lineFree(b.x,b.z,tx,tz)){b.path=null;steerTo(b,dt,tx,tz,sp);return}
  b.rep-=dt;const key=goal.i;if(!b.path||b.pi>=b.path.length||b.rep<=0||b.gk!==key){if(pathBudget>0){pathBudget--;b.rep=0.9;b.gk=key;b.path=astar(b.x,b.z,tx,tz);b.pi=0}}
  steerPath(b,dt,sp);
}

/* ---------- звук ---------- */
let AC=null,muted=false,noiseBuf=null;try{muted=localStorage.getItem('hill_mute')==='1'}catch(e){}
function au(){if(!AC){try{AC=new (window.AudioContext||window.webkitAudioContext)()}catch(e){}}if(AC&&AC.state==='suspended')AC.resume();return AC}
const quiet=()=>muted||phase==='menu'||phase==='lobby';
function tone(f,d,{type='sine',vol=0.12,slide=0,delay=0}={}){if(quiet()||vol<0.002)return;const a=au();if(!a)return;const t=a.currentTime+delay,o=a.createOscillator(),g=a.createGain();o.type=type;o.frequency.setValueAtTime(f,t);if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(30,f*slide),t+d);
  g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(vol,t+0.012);g.gain.exponentialRampToValueAtTime(0.0001,t+d);o.connect(g).connect(a.destination);o.start(t);o.stop(t+d+0.02)}
function noise(d,{vol=0.1,f=800,q=0.8,delay=0,kind='bandpass',slide=0}={}){if(quiet()||vol<0.002)return;const a=au();if(!a)return;
  if(!noiseBuf){noiseBuf=a.createBuffer(1,a.sampleRate,a.sampleRate);const ch=noiseBuf.getChannelData(0);for(let i=0;i<ch.length;i++)ch[i]=Math.random()*2-1}
  const t=a.currentTime+delay,s=a.createBufferSource(),bf=a.createBiquadFilter(),g=a.createGain();s.buffer=noiseBuf;bf.type=kind;bf.frequency.setValueAtTime(f,t);if(slide)bf.frequency.exponentialRampToValueAtTime(Math.max(60,f*slide),t+d);bf.Q.value=q;
  g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(vol,t+0.01);g.gain.exponentialRampToValueAtTime(0.0001,t+d);s.connect(bf).connect(g).connect(a.destination);s.start(t,Math.random()*0.5);s.stop(t+d+0.05)}
/* гучність — за відстанню від мене (чужі поштовхи далеко чути тихо) */
const near_=(c)=>{const me=camFollow();if(!c||!me)return 1;return Math.max(0.15,1-dist(c.x,c.z,me.x,me.z)/14)};
const SFX={
  whoosh:c=>noise(0.16,{vol:0.07*near_(c),f:1400,q:0.7,slide:0.4}),
  bonk:c=>{const v=near_(c);tone(180,0.18,{type:'square',vol:0.09*v,slide:0.5});noise(0.1,{vol:0.12*v,f:500})},
  block:c=>{const v=near_(c);tone(1400,0.12,{type:'triangle',vol:0.08*v});tone(2100,0.18,{type:'sine',vol:0.05*v,delay:0.04})},
  coin:()=>tone(1320,0.07,{type:'triangle',vol:0.05}),
  dash:()=>noise(0.22,{vol:0.1,f:2200,q:0.5,slide:0.25}),
  shield:()=>[660,990].forEach((f,i)=>tone(f,0.16,{type:'sine',vol:0.08,delay:i*0.05})),
  splash:()=>{noise(0.3,{vol:0.12,f:900,q:1.2,slide:0.5});tone(300,0.2,{vol:0.05,slide:1.8})},
  move:()=>[784,988,1175].forEach((f,i)=>tone(f,0.16,{type:'triangle',vol:0.08,delay:i*0.08})),
  warn:()=>tone(660,0.1,{vol:0.07}),
  beep:()=>tone(660,0.12,{vol:0.08}),
  win:()=>[523,659,784,1047].forEach((f,i)=>tone(f,0.24,{type:'triangle',vol:0.12,delay:i*0.11})),
  lose:()=>[392,330,262].forEach((f,i)=>tone(f,0.3,{type:'sawtooth',vol:0.05,delay:i*0.15})),
};
$('mute').addEventListener('click',()=>{muted=!muted;$('mute').textContent=muted?'🔇':'🔊';$('mute').setAttribute('aria-label',muted?'Увімкнути звук':'Вимкнути звук');try{localStorage.setItem('hill_mute',muted?'1':'0')}catch(e){}});
$('mute').textContent=muted?'🔇':'🔊';

/* ---------- стан раунду ----------
   G: r раунд, ph фаза, k лічильник фаз, map, seed, pl гравці, bots боти, col кольори, nm імена ботів, ab вміння,
   zi поточна зона, zn наступна (-1), zt мс до переїзду, sc очки, win перемоги, own хто в зоні ('' / id / '*'), shd щити (мс), pd калюжі [x,z,id,мс],
   fx події, rem мс до кінця фази, res переможець, why */
let phase='menu',T=0,G=null,lastKey='',pops=[],confetti=[],shakeT=0,introT=0,lastFx=0,spec=null,rips=[];
const auth={last:{},pu:{}};
const isAuth=()=>!MP.on||MP.host;
const myId=()=>MP.on?MP.me:'me';
const hostNow=()=>T*1000;
function newG(r,map,seed,pl,bots,col,nm,win){
  const ab={},R=rng(seed^0xAB1);for(const id of pl.concat(bots))ab[id]=AB_KEYS[Math.floor(R()*AB_KEYS.length)];
  return{r,ph:'intro',k:1,map,seed,pl,bots,col,nm,ab,zi:0,zn:-1,zt:ZONE_T*1000,sc:{},win:win||{},own:'',shd:{},pd:[],fx:[],fxn:0,rem:5000,res:null,why:''};
}
function setupRound(cfg){
  if(mapIdx!==cfg.map||!world||world.seed!==cfg.seed)buildWorld(cfg.map,cfg.seed);
  chars=[];player=null;spec=null;lastFx=cfg.fxn||0;pops=[];rips=[];auth.pu={};
  const R=rng(cfg.seed),z0=zones[cfg.zi]||zones[0];
  const spots=wander.filter(p=>!z0||dist(p[0],p[1],z0.x,z0.z)>5).map(p=>({p,r:R()})).sort((a,b)=>a.r-b.r).map(o=>o.p),used=[];
  const spot=()=>{for(const p of spots){if(used.some(u=>dist(u[0],u[1],p[0],p[1])<2.2))continue;used.push(p);return p}return spots[used.length%Math.max(1,spots.length)]||[world.W/2,world.H/2]};
  for(const id of cfg.pl.concat(cfg.bots)){const [x,z]=spot(),bot=cfg.bots.includes(id);
    const nick=bot?cfg.nm[id]:MP.on?String((presOf(id)||{}).n||'Гравець').slice(0,14):'Ти';
    const c=newChar(id,bot?'bot':'human',x,z,cfg.col[id]|0,nick,cfg.ab[id]);if(z0)c.yaw=Math.atan2(z0.x-x,z0.z-z);
    if(MP.on&&!bot&&id!==MP.me)c.remote=true;if(id===myId())player=c}
  for(const c of chars){c.tx=c.x;c.tz=c.z;c.fx0=c.x;c.fz0=c.z;c.tyaw=c.yaw}
}

/* ---------- події (поштовх, щит, калюжа) ---------- */
function applyEv(id,t,v){if(!G||G.ph!=='play')return;if(t==='pu')applyPush(id,v);else if(t==='sd')applyShield(id);else if(t==='pd')applyPuddle(id,v)}
const REQ={s:0,ev:[]};
function req(t,v){if(isAuth()){applyEv(myId(),t,v);return}REQ.s++;REQ.ev.push([REQ.s,t,v]);if(REQ.ev.length>12)REQ.ev.shift()}
function hostEvents(){for(const p of peersNow()){if(p.isMe||!G.pl.includes(p.id))continue;const ev=(p.presence||{}).ev;if(!Array.isArray(ev))continue;
  const last=auth.last[p.id]||0;for(const [s,t,v] of ev)if(s>last){applyEv(p.id,t,v);auth.last[p.id]=s}}}
function pushFx(e){G.fxn++;G.fx.push([G.fxn].concat(e));if(G.fx.length>10)G.fx.shift()}
function applyPush(fid,tid){
  const a=chr(fid),b=chr(tid);if(!a||!b||a===b||a.gone||b.gone)return;const now=hostNow();
  if(a.kind==='human'&&auth.pu[fid]&&now-auth.pu[fid]<PUSH_CD*700)return;
  const [ax,az]=P(a),[bx,bz]=P(b);let dx=bx-ax,dz=bz-az,d=Math.hypot(dx,dz);if(d>PUSH_R+0.9)return;
  if(d<0.01){dx=Math.sin(a.yaw);dz=Math.cos(a.yaw);d=1}dx/=d;dz/=d;auth.pu[fid]=now;
  if((G.shd[tid]|0)>0)pushFx(['b',fid,tid,+(-dx).toFixed(2),+(-dz).toFixed(2)]);
  else pushFx(['p',fid,tid,+dx.toFixed(2),+dz.toFixed(2)]);
}
function applyShield(id){const c=chr(id);if(!c)return;G.shd[id]=SHIELD_T*1000;pushFx(['s',id])}
function applyPuddle(id,v){const c=chr(id);if(!c||!Array.isArray(v))return;const [cx,cz]=P(c);if(dist(+v[0],+v[1],cx,cz)>2.5)return;
  G.pd.push([+(+v[0]).toFixed(2),+(+v[1]).toFixed(2),id,PD_T*1000]);if(G.pd.length>6)G.pd.shift();pushFx(['d',id])}
/* нові події з G.fx — ефекти в усіх; відкидання — хто керує персонажем */
function playFx(){
  if(!G)return;for(const e of G.fx){if(e[0]<=lastFx)continue;lastFx=e[0];
    const [,t,a,b,dx,dz]=e,A=chr(a),B=chr(b),ctl=c=>c&&(c===player||(isAuth()&&c.kind==='bot'));
    if(t==='p'){if(ctl(B))knock(B,dx,dz,1);if(B){pop(B,'💫','#FFE27A');SFX.bonk(B)}if(B===player){shakeT=0.25;vib(70)}if(A&&A!==player)A.pushT=0.25}
    else if(t==='b'){if(ctl(A))knock(A,dx,dz,0.75);if(B)pop(B,'🛡','#9BD8FF');if(A)SFX.block(A);if(A===player){say('Щит!','big');vib(60)}}
    else if(t==='s'){if(A){pop(A,'🛡','#9BD8FF');if(A===player||near_(A)>0.4)SFX.shield()}}
    else if(t==='d'){if(A){pop(A,'🫧','#9BE3FF');if(near_(A)>0.3)SFX.splash()}}
    else if(t==='z'){const z=zones[a];SFX.move();if(z){ripple(z.x,z.z,'#FFC93C',2.2);const nm=roomName(z.x,z.z);if(phase==='play')say('👑 '+(nm||'Зона переїхала'),'big gold')}}
  }
}

/* ---------- керування ---------- */
let joy=null;const keys={};
const gl=$('gl');
gl.addEventListener('pointerdown',e=>{au();if(joy)return;joy={id:e.pointerId,sx:e.clientX,sy:e.clientY,x:e.clientX,y:e.clientY,t:e.timeStamp,moved:false};try{gl.setPointerCapture(e.pointerId)}catch(_){}});
gl.addEventListener('pointermove',e=>{if(joy&&e.pointerId===joy.id){joy.x=e.clientX;joy.y=e.clientY;if(Math.hypot(joy.x-joy.sx,joy.y-joy.sy)>12)joy.moved=true}});
const endJoy=e=>{if(!joy||e.pointerId!==joy.id)return;const j=joy;joy=null;if(!j.moved&&e.timeStamp-j.t<450&&e.type==='pointerup')tapAt(j.sx,j.sy)};
gl.addEventListener('pointerup',endJoy);gl.addEventListener('pointercancel',endJoy);
addEventListener('keydown',e=>{const k=e.key.toLowerCase();keys[k]=true;if(k===' '){e.preventDefault();doPush()}else if(k==='e'||k==='shift')doAbil()});addEventListener('keyup',e=>{keys[e.key.toLowerCase()]=false});
function readStick(){let ix=0,iz=0;
  if(joy&&joy.moved){const dx=joy.x-joy.sx,dy=joy.y-joy.sy,m=Math.hypot(dx,dy);if(m>8){ix=dx/m;iz=dy/m}}
  if(keys.a||keys.arrowleft)ix-=1;if(keys.d||keys.arrowright)ix+=1;if(keys.w||keys.arrowup)iz-=1;if(keys.s||keys.arrowdown)iz+=1;
  const im=Math.hypot(ix,iz);if(im>1){ix/=im;iz/=im}return[ix,iz]}
const ray=new T3.Raycaster(),plane=new T3.Plane(new T3.Vector3(0,1,0),0),_hit=new T3.Vector3(),_p=new T3.Vector3();
function scr(x,y,z){_p.set(x,y,z).project(camera);return{x:(_p.x+1)/2*W,y:(1-_p.y)/2*H,z:_p.z}}
function tapAt(sx,sy){const p=player;if(!p||phase!=='play'&&phase!=='intro')return;
  ray.setFromCamera({x:sx/W*2-1,y:-(sy/H*2-1)},camera);if(!ray.ray.intersectPlane(plane,_hit))return;
  const path=astar(p.x,p.z,_hit.x,_hit.z);if(!path)return;p.path=path;p.pi=0;ripple(_hit.x,_hit.z,'#FFFFFF',0.5)}
const pushB=$('push'),abilB=$('abil');
onTap(pushB,()=>doPush());onTap(abilB,()=>doAbil());
function canAct(){const p=player;return p&&phase==='play'&&p.stun<=0}
function doPush(){au();const p=player;if(!canAct()||p.cdP>0)return;const t=pushTarget(p);p.pushT=0.25;SFX.whoosh(p);
  if(!t){p.cdP=0.6;return}p.cdP=PUSH_CD;p.yaw=Math.atan2(t.x-p.x,t.z-p.z);req('pu',t.id)}
function doAbil(){au();const p=player;if(!canAct()||p.cdA>0)return;const ab=ABIL[p.ab];p.cdA=ab.cd;
  if(p.ab==='dash'){const [ix,iz]=readStick();let dx=ix,dz=iz;if(!dx&&!dz&&p.path&&p.pi<p.path.length){dx=p.path[p.pi][0]-p.x;dz=p.path[p.pi][1]-p.z}dash(p,dx,dz);SFX.dash();vib(25)}
  else if(p.ab==='shield')req('sd');
  else req('pd',[+p.x.toFixed(2),+p.z.toFixed(2)])}

/* ---------- оновлення гравця ---------- */
function playerUpdate(p,dt){
  if(p.gone)return;
  const frozen=phase!=='play'||p.stun>0;
  if(p.dashT>0){p.vx=p.dx*DASH_V;p.vz=p.dz*DASH_V;return}
  const [ix,iz]=readStick(),m=Math.hypot(ix,iz),sp=SPEED*slowOf(p);
  if(frozen){p.vx*=0.6;p.vz*=0.6;if(phase!=='play')p.path=null}
  else if(m>0.2){p.path=null;p.vx+=(ix/m*sp-p.vx)*Math.min(1,dt*10);p.vz+=(iz/m*sp-p.vz)*Math.min(1,dt*10)}
  else if(p.path){if(steerPath(p,dt,sp))p.path=null}
  else{p.vx*=Math.max(0,1-dt*12);p.vz*=Math.max(0,1-dt*12)}
}
function timers(c,dt){c.stun=Math.max(0,c.stun-dt);c.dashT=Math.max(0,c.dashT-dt);c.pushT=Math.max(0,c.pushT-dt);c.cdP=Math.max(0,c.cdP-dt);c.cdA=Math.max(0,c.cdA-dt)}

/* ---------- зона й очки (соло або хост) ---------- */
function pickNext(){const cur=zones[G.zi];const far=zones.filter(z=>z.i!==G.zi&&(!cur||dist(z.x,z.z,cur.x,cur.z)>7));const pool=far.length?far:zones.filter(z=>z.i!==G.zi);
  return pool.length?pool[Math.floor(Math.random()*pool.length)].i:G.zi}
function zoneTick(dt){
  const z=zones[G.zi];if(!z)return;
  const inside=[];for(const c of chars){if(c.gone)continue;const [x,zz]=P(c);if(dist(x,zz,z.x,z.z)<=ZR)inside.push(c.id)}
  G.own=inside.length===1?inside[0]:inside.length>1?'*':'';G.n=inside.length;
  if(inside.length===1){const id=inside[0];G.sc[id]=Math.round(((G.sc[id]||0)+dt)*100)/100;if(G.sc[id]>=GOAL){endRound(id,'goal');return}}
  G.zt-=dt*1000;
  if(G.zt<=WARN*1000&&G.zn<0)G.zn=pickNext();
  if(G.zt<=0){G.zi=G.zn>=0?G.zn:pickNext();G.zn=-1;G.zt=ZONE_T*1000;pushFx(['z',G.zi])}
  for(const id in G.shd){G.shd[id]-=dt*1000;if(G.shd[id]<=0)delete G.shd[id]}
  for(const p of G.pd)p[3]-=dt*1000;G.pd=G.pd.filter(p=>p[3]>0);
}
function leaderOf(){let best=null,bv=-1;for(const id of G.pl.concat(G.bots)){const v=G.sc[id]||0;if(v>bv){bv=v;best=id}}return best}
function endRound(win,why){if(G.ph!=='play')return;G.ph='end';G.k++;G.res=win;G.why=why;if(win)G.win[win]=(G.win[win]||0)+1;
  G.rem=9000;if(MP.on)MP.hostEnd=performance.now()+9000;syncPhase()}

/* ---------- фази ---------- */
function onPhase(){
  if(G.ph==='intro'){phase='intro';$('ov').hidden=true;$('mp').hidden=true;
    if(!player){say('Ти глядач','big');tip('Приєднаєшся в наступному раунді')}
    else{const a=ABIL[player.ab];say('Твоє вміння: '+a.ic,'big gold');tip(a.hint)}}
  if(G.ph==='play'){phase='play';say('Вперед!','big')}
  if(G.ph==='end'){phase='end';joy=null;showEnd()}
  updButtons(true);updHud(true);
}
function syncPhase(){const key=G.r+':'+G.ph;if(key!==lastKey){lastKey=key;onPhase()}}
function nameOf(id){if(id===myId())return'Ти';const c=chr(id);return c?c.nick:(G.nm&&G.nm[id])||String((presOf(id)||{}).n||'Гравець').slice(0,14)}
function showEnd(){
  const me=player,myWin=me&&G.res===me.id;
  if(myWin){SFX.win();for(let i=0;i<110;i++)confetti.push({x:W/2+(Math.random()-.5)*W*0.8,y:H*0.3,vx:(Math.random()-.5)*420,vy:-150-Math.random()*380,l:2.6,c:['#FFC93C','#FF5C5C','#4C8DFF','#4CC97A'][i%4],r:Math.random()*6})}else if(me)SFX.lose();
  const title=myWin?'Ти — цар гори!':G.res?nameOf(G.res)+' — цар гори':'Нічия';
  const why=G.why==='goal'?'Перший набрав '+GOAL+' очок.':'Час вийшов — перемагає лідер.';
  setTimeout(()=>{if(phase!=='end')return;$('ovTitle').textContent=title;$('ovTitle').className=myWin?'':'lose';$('ovText').textContent=why+(MP.on?' Наступний раунд за кілька секунд.':'');
    const sl=$('scoreList');sl.innerHTML='';
    const ids=G.pl.concat(G.bots).sort((a,b)=>(G.sc[b]||0)-(G.sc[a]||0));
    for(const id of ids){const li=document.createElement('li');if(id===myId())li.className='me';const d=document.createElement('span');d.className='pdot';d.style.background=PAL[(G.col[id]|0)%PAL.length];
      const nm=document.createElement('span');nm.textContent=nameOf(id)+(id===G.res?' 👑':'');const w=document.createElement('small');w.textContent=MP.on&&G.win[id]?'🏆 '+G.win[id]:'';
      const b=document.createElement('b');b.textContent=Math.floor(G.sc[id]||0);li.append(d,nm,w,b);sl.append(li)}
    sl.hidden=false;$('ovHint').hidden=true;$('soloBox').hidden=MP.on;$('mpOpen').hidden=MP.on;$('mpNote').hidden=true;
    $('ovBtn').hidden=MP.on&&!MP.host;$('ovBtn').textContent=MP.on?'Наступний раунд':'Ще раз';$('ovLeave').hidden=!MP.on;$('ov').hidden=false},myWin?1500:1100);
}
let soloBots=3;
function startSolo(nb){
  au();soloBots=nb||soloBots;const ids=mapIds(),map=ids[Math.floor(Math.random()*ids.length)],seed=Math.floor(Math.random()*1e9);
  const myC=MP.color%PAL.length,col={me:myC},nm={},bots=[];let ci2=0;
  for(let i=0;i<soloBots;i++){const id='b'+i;bots.push(id);while(ci2%PAL.length===myC)ci2++;col[id]=ci2++%PAL.length;nm[id]=BOT_NAMES[i%BOT_NAMES.length]}
  G=newG(Date.now(),map,seed,['me'],bots,col,nm,{});buildWorld(map,seed);G.zi=Math.floor(Math.random()*zones.length);setupRound(G);
  lastKey='';introT=5;camInit=false;syncPhase();
}

/* ---------- головний цикл ---------- */
const camPos=new T3.Vector3(),camLook=new T3.Vector3();let camInit=false,netT=0,lastPt=-1;
function update(dt){
  T+=dt;pathBudget=4;
  if(MP.on)mpTick(dt);
  else if(G){
    if(G.ph==='intro'){const b=Math.ceil(introT);introT-=dt;const n=Math.ceil(introT);if(n!==b&&n>0&&n<=3){say(String(n),'num');SFX.beep()}if(introT<=0){G.ph='play';G.k++;G.rem=ROUND*1000;syncPhase()}}
    else if(G.ph==='play'){G.rem-=dt*1000;zoneTick(dt);if(G.ph==='play'&&G.rem<=0)endRound(leaderOf(),'time')}
    if(G.ph!=='menu')syncPhase();
  }
  if(!G)return;
  for(const c of chars)if(c===player||(isAuth()&&c.kind==='bot'))timers(c,dt);
  if(player)playerUpdate(player,dt);
  if(isAuth())for(const c of chars)if(c.kind==='bot')botThink(c,dt);
  if(MP.on)mpFollow(dt);
  const steps=dt>0.03?2:1;
  for(let k=0;k<steps;k++)for(const c of chars){if(c===player||(isAuth()&&c.kind==='bot'))integrate(c,dt/steps)}
  separate();
  if(MP.on){netT-=dt;if(netT<=0){netT=0.1;mpSend()}}
  playFx();
  // моя монетка: щосекунди, поки зона моя
  if(player&&G.ph==='play'){const pt=Math.floor(G.sc[player.id]||0);if(pt!==lastPt){if(lastPt>=0&&pt>lastPt)SFX.coin();lastPt=pt}}
  if(G.ph==='play'&&G.zn>=0){const s=Math.ceil(G.zt/1000);if(s!==update.ws){update.ws=s;if(s<=WARN&&s>0)SFX.warn()}}
  drawZone();drawChars(dt);
  const fo=camFollow();if(fo){
    const want=new T3.Vector3(fo.x,10.6,fo.z+7.6),look=new T3.Vector3(fo.x,0,fo.z-0.4);
    if(!camInit){camPos.copy(want);camLook.copy(look);camInit=true}
    camPos.lerp(want,Math.min(1,dt*5));camLook.lerp(look,Math.min(1,dt*6));camera.position.copy(camPos);
    if(shakeT>0&&!reduce){shakeT-=dt;camera.position.x+=(Math.random()-.5)*0.18;camera.position.y+=(Math.random()-.5)*0.1}
    camera.lookAt(camLook);sunFollow(fo.x,fo.z)}
  $('stun').style.opacity=player&&player.stun>0?Math.min(1,player.stun*1.4).toFixed(2):0;
  updHud();updButtons();
}
function camFollow(){
  if(player&&!player.gone)return player;
  const lid=G&&leaderOf();if(lid&&chr(lid))return chr(lid);
  if(!spec||!chars.includes(spec))spec=chars[0];return spec;
}
function drawZone(){
  const z=G&&zones[G.zi],live=G&&(G.ph==='play'||G.ph==='intro');zoneG.visible=!!(z&&live);
  if(z&&live){zoneG.position.set(z.x,0,z.z);
    let col=ZC.free;if(G.own==='*')col=Math.floor(T*6)%2?ZC.fight:ZC.free;else if(G.own){const c=chr(G.own);col=c?ZC.tmp.copy(c.col):ZC.free}
    zoneDisc.material.color.copy(col);zoneGlow.material.color.copy(col);zoneRing.material.color.copy(G.own&&G.own!=='*'?col:ZC.free);
    zoneGlow.material.opacity=0.12+(reduce?0:Math.sin(T*3)*0.04);zoneRing.rotation.y=reduce?0:T*0.4}
  const n=G&&G.zn>=0&&live&&zones[G.zn];nextRing.visible=!!n;
  if(n){nextRing.position.set(n.x,0.03,n.z);nextRing.material.opacity=0.35+(reduce?0.25:Math.abs(Math.sin(T*5))*0.5)}
  let k=0;if(G&&G.pd&&live)for(const p of G.pd){if(k>=12)break;const s=Math.min(1,p[3]/600,1);_m.compose(_v.set(p[0],0,p[1]),_q.set(0,0,0,1),_s.set(s,1,s));pdIM.setMatrixAt(k++,_m)}
  pdIM.count=k;pdIM.instanceMatrix.needsUpdate=true;
}

/* ---------- HUD ---------- */
let hudKey='';
function updHud(force){
  if(!G||!G.pl)return;const me=player,rem=G.ph==='play'?Math.max(0,G.rem/1000):G.ph==='intro'?ROUND:0,mm=Math.floor(rem/60),ss=Math.floor(rem%60);
  const mine=me?Math.floor(G.sc[me.id]||0):0,ids=G.pl.concat(G.bots).sort((a,b)=>(G.sc[b]||0)-(G.sc[a]||0)).slice(0,4);
  const zs=G.zn>=0?Math.ceil(G.zt/1000):0;
  const key=[mine,mm,ss,G.own,zs,ids.map(id=>id+(Math.floor(G.sc[id]||0))).join(',')].join(':');if(key===hudKey&&!force)return;hudKey=key;
  $('meChip').textContent=me?'👑 '+mine+'/'+GOAL:'👁 Глядач';
  const tc=$('timeChip');tc.textContent=mm+':'+String(ss).padStart(2,'0');tc.classList.toggle('low',G.ph==='play'&&rem<30);
  const zc=$('zoneChip');let zt='Зона вільна',cls='chip zone';
  if(G.own==='*'){zt='⚔ Бійка';cls+=' fight'}else if(G.own&&me&&G.own===me.id){zt='Твоя!';cls+=' mine'}else if(G.own){zt=nameOf(G.own)}
  if(zs>0)zt+=' · ⏭ '+zs;zc.textContent=zt;zc.className=cls;
  const bd=$('board');bd.innerHTML='';
  for(const id of ids){const li=document.createElement('li');if(me&&id===me.id)li.className='me';const d=document.createElement('i');d.style.background=PAL[(G.col[id]|0)%PAL.length];
    const s=document.createElement('span');s.textContent=nameOf(id)+' '+Math.floor(G.sc[id]||0);li.append(d,s);bd.append(li)}
}
let btnKey='';
function updButtons(force){
  const p=player,live=p&&(phase==='play'||phase==='intro'),ab=p?ABIL[p.ab]:null;
  const key=[live,p&&p.ab,p?Math.ceil(p.cdP*5):0,p?Math.ceil(p.cdA*5):0,p&&p.stun>0].join(':');if(key===btnKey&&!force)return;btnKey=key;
  pushB.hidden=abilB.hidden=!live;if(!live)return;
  pushB.style.setProperty('--cd',Math.round(p.cdP/PUSH_CD*100)+'%');abilB.style.setProperty('--cd',Math.round(p.cdA/ab.cd*100)+'%');
  $('abilIc').textContent=ab.ic;$('abilTxt').textContent=p.cdA>0?Math.ceil(p.cdA)+' с':ab.name;abilB.setAttribute('aria-label',ab.name);
  $('pushTxt').textContent=p.stun>0?'💫':'Поштовх';
}
function say(text,cls){const el=$('say');el.textContent=text;el.className='say '+(cls||'');void el.offsetWidth;el.classList.add('show')}
function tip(t){const el=$('tip');el.textContent=t;el.hidden=false;el.classList.remove('fade');void el.offsetWidth;el.classList.add('fade')}
function pop(ch,text,color){pops.push({ch,text,color,t:0})}
function ripple(x,z,col='#FFC93C',s=1){rips.push({x,z,col,s,t:0})}
function vib(ms){try{navigator.vibrate&&navigator.vibrate(ms)}catch(e){}}

/* ---------- накладка ---------- */
const FONT='"Baloo 2","Arial Rounded MT Bold",sans-serif';
function label(x,y,t,bg,fg='#fff'){fctx.font='800 13px '+FONT;const w=fctx.measureText(t).width+12;fctx.fillStyle=bg;fctx.beginPath();fctx.roundRect(x-w/2,y-10,w,19,9);fctx.fill();fctx.fillStyle=fg;fctx.textAlign='center';fctx.textBaseline='middle';fctx.fillText(t,x,y+1)}
function arrowTo(x,z,col,lab){const s=scr(x,0.5,z);let sx=s.x,sy=s.y;const m=34;if(sx>m&&sx<W-m&&sy>130&&sy<H-m&&s.z<1)return;
  const cx=W/2,cy=H/2;let dx=sx-cx,dy=sy-cy;if(s.z>1){dx=-dx;dy=-dy}const k=Math.min((W/2-m)/Math.abs(dx||1e-6),(H/2-m-60)/Math.abs(dy||1e-6));sx=cx+dx*k;sy=cy+dy*k+30;
  fctx.save();fctx.translate(sx,sy);fctx.fillStyle='rgba(0,0,0,.35)';fctx.beginPath();fctx.arc(0,3,17,0,6.283);fctx.fill();fctx.fillStyle=col;fctx.beginPath();fctx.arc(0,0,17,0,6.283);fctx.fill();
  fctx.font='800 16px '+FONT;fctx.textAlign='center';fctx.textBaseline='middle';fctx.fillStyle='#14121A';fctx.fillText(lab,0,1);fctx.restore()}
function drawFx(dt){
  fctx.clearRect(0,0,W,H);
  const me=player,live=phase==='play'||phase==='intro';
  for(const r of rips){r.t+=dt;const s=scr(r.x,0.05,r.z);if(s.z>1)continue;const k=r.t/0.8;fctx.globalAlpha=Math.max(0,1-k);fctx.strokeStyle=r.col;fctx.lineWidth=3;fctx.beginPath();fctx.ellipse(s.x,s.y,(10+k*40)*r.s,(6+k*24)*r.s,0,0,6.283);fctx.stroke()}
  fctx.globalAlpha=1;rips=rips.filter(r=>r.t<=0.8);
  if(G&&live){
    const z=zones[G.zi];if(z)arrowTo(z.x,z.z,'#FFC93C','👑');
    const n=G.zn>=0&&zones[G.zn];if(n){const s=scr(n.x,0.4,n.z);if(s.z<1)label(s.x,s.y,'Сюди за '+Math.max(1,Math.ceil(G.zt/1000))+' с','rgba(20,18,26,.8)','#FFE27A');arrowTo(n.x,n.z,'#FFFFFF','⏭')}}
  if(G&&phase!=='menu')for(const c of chars){if(c.gone)continue;const s=scr(c.x,1.55,c.z);if(s.z>1)continue;
    label(s.x,s.y,c===me?'Ти':c.nick||'?',c===me?'rgba(160,120,0,.85)':'rgba(20,18,26,.62)',c===me?'#fff':'#'+c.col.getHexString())}
  for(const p of pops){p.t+=dt;if(p.t>1.2||p.ch.gone)continue;const s=scr(p.ch.x,1.85,p.ch.z);if(s.z>1)continue;const y=s.y-p.t*22,e=p.t<0.25?(1-Math.pow(1-p.t/0.25,3))*1.15:1;
    fctx.globalAlpha=p.t>0.9?Math.max(0,1-(p.t-0.9)/0.3):1;fctx.save();fctx.translate(s.x,y);fctx.scale(e,e);fctx.font='800 22px '+FONT;fctx.textAlign='center';fctx.textBaseline='middle';fctx.fillText(p.text,0,0);fctx.restore();fctx.globalAlpha=1}
  pops=pops.filter(p=>p.t<1.2);
  if(joy&&joy.moved&&phase!=='end'){const dx=joy.x-joy.sx,dy=joy.y-joy.sy,m=Math.hypot(dx,dy),k=m>55?55/m:1;
    fctx.fillStyle='rgba(255,255,255,.12)';fctx.strokeStyle='rgba(255,255,255,.45)';fctx.lineWidth=2;fctx.beginPath();fctx.arc(joy.sx,joy.sy,55,0,6.283);fctx.fill();fctx.stroke();
    fctx.fillStyle='rgba(255,255,255,.8)';fctx.beginPath();fctx.arc(joy.sx+dx*k,joy.sy+dy*k,22,0,6.283);fctx.fill()}
  for(const c of confetti){c.l-=dt;c.vy+=520*dt;c.x+=c.vx*dt;c.y+=c.vy*dt;c.r+=dt*8;fctx.globalAlpha=Math.min(1,c.l);fctx.fillStyle=c.c;fctx.save();fctx.translate(c.x,c.y);fctx.rotate(c.r);fctx.fillRect(-5,-3,10,6);fctx.restore()}
  confetti=confetti.filter(c=>c.l>0);fctx.globalAlpha=1;
}

/* ---------- меню ---------- */
onTap($('ovSolo'),()=>startSolo(+$('soloBots').value));
$('ovBtn').addEventListener('click',()=>{au();if(MP.on){if(MP.host&&MP.g&&MP.g.ph==='end')hostStartRound()}else startSolo()});

/* ---------- мультиплеєр ----------
   Транспорт: ../net-firebase.js (вузол RTDB «hill», до 10 гравців). Хост (найраніший) веде G і ботів;
   у його presence: g = G, bs = стиснені боти. Кожен шле x,z,y (кут), s (стан) і ev (поштовхи, вміння). */
const MP={on:false,avail:null,net:null,code:'',me:null,host:false,nick:'',color:0,g:null,round:-1,phKey:'',phEnd:0,mapSel:'auto',bots:2,win:{},lastG:null};
try{MP.nick=localStorage.getItem('hill_nick')||localStorage.getItem('hns_nick')||'';MP.color=+(localStorage.getItem('hill_color'))||Math.floor(Math.random()*PAL.length)}catch(e){}
(async()=>{const t=window.HNS_TRANSPORT;try{MP.avail=t&&await t.ready()?t:null}catch(e){MP.avail=null}$('mpOpen').disabled=!MP.avail;$('mpNote').hidden=!!MP.avail})();
const rcode=()=>Array.from({length:4},()=>'abcdefghjkmnpqrstuvwxyz'[Math.floor(Math.random()*23)]).join('');
function peersNow(){return MP.net?MP.net.peers():[]}
function presOf(id){const p=peersNow().find(p=>p.id===id);return p?p.presence:null}
function humans(){return peersNow().filter(p=>p.presence&&p.presence.n).sort((a,b)=>a.id<b.id?-1:1)}
function hostId(){const ps=humans();const hs=ps.filter(p=>p.presence.h).sort((a,b)=>(+a.presence.h-+b.presence.h)||(a.id<b.id?-1:1));return(hs[0]||ps[0]||{}).id}
const timerLeft=()=>Math.max(0,(MP.phEnd-performance.now())/1000);
function mapOptions(){const s=$('mapSel'),v=s.value;s.innerHTML='<option value="auto">По черзі</option>'+mapIds().map((mi,k)=>'<option value="'+k+'">'+String(HW.MAPS[mi].name||'Карта').replace(/[<&]/g,'')+(HW.MAPS[mi].custom?' ✎':'')+'</option>').join('');if([...s.options].some(o=>o.value===v))s.value=v}
mapOptions();addEventListener('maps41',mapOptions);
$('mpOpen').addEventListener('click',()=>{au();$('ov').hidden=true;$('mp').hidden=false;$('mpA').hidden=false;$('mpB').hidden=true;$('nick').value=MP.nick;$('colorBtn').style.background=PAL[MP.color%PAL.length];
  const h=(location.hash||'').replace('#','');if(/^[a-z]{4}$/.test(h))$('codeIn').value=h.toUpperCase();setTimeout(()=>$('nick').focus(),50)});
$('mpBack').addEventListener('click',()=>{$('mp').hidden=true;$('ov').hidden=false});
$('mpCreate').addEventListener('click',()=>mpJoin(rcode(),true));
$('mpJoinBtn').addEventListener('click',()=>{const c=($('codeIn').value||'').trim().toLowerCase();if(!/^[a-z]{4}$/.test(c)){$('mpErr').textContent='Код має 4 літери, наприклад KQRT.';$('mpErr').hidden=false;return}mpJoin(c)});
$('codeIn').addEventListener('keydown',e=>{if(e.key==='Enter')$('mpJoinBtn').click()});
$('colorBtn').addEventListener('click',()=>{MP.color=(MP.color+1)%PAL.length;$('colorBtn').style.background=PAL[MP.color];try{localStorage.setItem('hill_color',MP.color)}catch(e){}if(MP.net)MP.net.presence({c:MP.color})});
$('mpStart').addEventListener('click',()=>{if(!MP.host)return;MP.mapSel=$('mapSel').value;MP.bots=+$('botSel').value;MP.g=null;MP.win={};hostStartRound()});
$('mpQuit').addEventListener('click',mpLeave);$('ovLeave').addEventListener('click',mpLeave);
$('copyCode').addEventListener('click',()=>{const t=MP.code.toUpperCase();try{navigator.clipboard.writeText(t).then(()=>{$('copyCode').textContent='Скопійовано'},()=>{})}catch(e){}});
async function mpJoin(code,create){
  au();MP.nick=($('nick').value||'').trim().slice(0,14)||'Гравець';try{localStorage.setItem('hill_nick',MP.nick);localStorage.setItem('hill_color',MP.color)}catch(e){}
  $('mpErr').hidden=true;
  try{MP.net=await MP.avail.join(code)}catch(e){$('mpErr').textContent=e&&e.message==='full'?'Кімната повна (до 10).':'Не вдалося увійти в кімнату. Спробуй ще раз.';$('mpErr').hidden=false;return}
  MP.code=code;MP.on=true;MP.joinedAt=performance.now();MP.round=-1;MP.phKey='';MP.g=null;MP.lastG=null;REQ.ev=[];auth.last={};
  MP.net.presence({n:MP.nick,c:MP.color,h:create?Date.now():null});
  location.hash=code;$('roomCode').textContent=code.toUpperCase();$('mpA').hidden=true;$('mpB').hidden=false;
  phase='lobby';mpLobbyRender();   // G лишається заставочним, поки хост не почне раунд
}
function mpLeave(){if(MP.net)MP.net.leave();MP.net=null;MP.on=false;MP.host=false;MP.g=null;MP.lastG=null;MP.me=null;G=null;location.hash='';
  $('mp').hidden=true;resetMenu();bootScene()}
function mpLobbyRender(){
  const list=$('plist');list.innerHTML='';const hid=hostId();
  humans().forEach(p=>{const li=document.createElement('li');const d=document.createElement('span');d.className='pdot';d.style.background=PAL[(p.presence.c|0)%PAL.length];
    const nm=document.createElement('span');nm.textContent=String(p.presence.n).slice(0,14)+(p.isMe?' (ти)':'');li.append(d,nm);
    if(p.id===hid){const t=document.createElement('em');t.textContent='хост';li.append(t)}list.append(li)});
  const me=(peersNow().find(p=>p.isMe)||{}).id,amHost=!!me&&hid===me;$('hostCtl').hidden=!amHost;$('waitHost').hidden=amHost;
}
function hostStartRound(){
  const all=humans();if(!all.length)return;
  const prev=MP.g,r=(prev?prev.r:0)+1,ids=mapIds(),map=MP.mapSel==='auto'?ids[(r-1)%ids.length]:ids[+MP.mapSel]||ids[0];
  const pl=[MP.me].concat(all.map(p=>p.id).filter(i=>i!==MP.me)).slice(0,10),nb=Math.max(0,Math.min(MP.bots,10-pl.length));
  // кольори: свій вибраний, якщо вільний; інакше — наступний вільний
  const col={},used=new Set();for(const id of pl){let c=((presOf(id)||{}).c|0)%PAL.length;while(used.has(c))c=(c+1)%PAL.length;used.add(c);col[id]=c}
  const bots=[],nm={};let c=0;for(let i=0;i<nb;i++){const id='b'+i;bots.push(id);while(used.has(c%PAL.length))c++;col[id]=c%PAL.length;used.add(c%PAL.length);nm[id]=BOT_NAMES[i%BOT_NAMES.length]}
  if(prev)MP.win=prev.win;
  const seed=Math.floor(Math.random()*1e9);MP.g=newG(r,map,seed,pl,bots,col,nm,MP.win);
  if(mapIdx!==map||!world||world.seed!==seed)buildWorld(map,seed);MP.g.zi=Math.floor(Math.random()*zones.length);
  MP.hostEnd=performance.now()+5000;
}
function hostTick(dt){
  const g=MP.g;if(!g)return;G=g;
  const left=MP.hostEnd-performance.now(),at=ms=>{MP.hostEnd=performance.now()+ms;return ms};
  if(g.ph==='intro'&&left<=0){g.ph='play';g.k++;at(ROUND*1000)}
  else if(g.ph==='play'){hostEvents();zoneTick(dt);if(g.ph==='play'&&left<=0)endRound(leaderOf(),'time')}
  else if(g.ph==='end'&&left<=0)hostStartRound();
  if(MP.g)MP.g.rem=Math.max(0,MP.hostEnd-performance.now());
}
function mpTick(dt){
  const hid=hostId();
  if(!MP.me){const mine=peersNow().find(p=>p.isMe);if(mine)MP.me=mine.id}
  MP.host=hid===MP.me&&!!MP.me;
  {const myp=presOf(MP.me);if(myp){if(MP.host&&!myp.h&&performance.now()-MP.joinedAt>1500)MP.net.presence({h:Date.now()});else if(!MP.host&&myp.h&&humans().some(p=>p.id!==MP.me&&p.presence.h&&+p.presence.h<+myp.h))MP.net.presence({h:null})}}
  if(MP.host){if(!MP.g&&MP.lastG){MP.g=JSON.parse(JSON.stringify(MP.lastG));MP.g.k++;MP.hostEnd=performance.now()+Math.max(1000,MP.lastG.rem);MP.win=MP.g.win;
      auth.last={};for(const p of peersNow()){const ev=(p.presence||{}).ev;if(Array.isArray(ev)&&ev.length)auth.last[p.id]=ev[ev.length-1][0]}}
    hostTick(dt)}
  const g=MP.host?MP.g:(presOf(hid)||{}).g;
  if(!MP.host&&g)MP.lastG=g;
  if(phase==='lobby'&&Math.floor(T*4)!==MP.lr){MP.lr=Math.floor(T*4);mpLobbyRender()}
  if(!g||!g.pl)return;
  if(g.r!==MP.round){MP.round=g.r;REQ.ev=[];G=g;setupRound(g);lastKey='';camInit=false;lastPt=-1}
  G=g;if(!G.shd)G.shd={};if(!G.pd)G.pd=[];if(!G.fx)G.fx=[];if(!G.sc)G.sc={};if(!G.win)G.win={};
  const key=g.r+':'+g.k;if(key!==MP.phKey){MP.phKey=key;MP.phEnd=performance.now()+g.rem}
  if(!MP.host&&g.ph==='play')g.rem=timerLeft()*1000;
  if(g.ph==='intro'){const n=Math.ceil(timerLeft());if(n!==MP.lastN&&n>0&&n<=3){MP.lastN=n;say(String(n),'num');SFX.beep()}}
  syncPhase();
}
/* боти: 6 символів на бота — x і z по 12 біт (1/32 м), кут 6 біт, стан 6 біт */
const B64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',B64I={};for(let i=0;i<64;i++)B64I[B64[i]]=i;
const stOf=c=>(c.stun>0?ST.stun:0)|(c.pushT>0?ST.push:0)|(c.dashT>0?ST.dash:0);
function encBots(){let s='';for(const c of chars){if(c.kind!=='bot')continue;const x=Math.max(0,Math.min(4095,Math.round(c.x*32))),z=Math.max(0,Math.min(4095,Math.round(c.z*32))),y=((Math.round(c.yaw/6.283185*64)%64)+64)%64;
  s+=B64[x>>6]+B64[x&63]+B64[z>>6]+B64[z&63]+B64[y]+B64[stOf(c)]}return s}
let lastBs='',lastBsT=0,bsInt=0.14;
function mpFollow(dt){
  if(!G||G.r!==MP.round)return;
  const hp=MP.host?null:presOf(hostId());const bs=hp&&hp.bs;
  if(typeof bs==='string'&&bs!==lastBs){const now=performance.now()/1000;if(lastBsT)bsInt=bsInt*0.8+Math.min(0.5,now-lastBsT)*0.2;lastBsT=now;lastBs=bs;
    let i=0;for(const c of chars){if(c.kind!=='bot')continue;const o=i*6;i++;if(o+6>bs.length)break;
      setTarget(c,((B64I[bs[o]]<<6)|B64I[bs[o+1]])/32,((B64I[bs[o+2]]<<6)|B64I[bs[o+3]])/32,B64I[bs[o+4]]/64*6.283185,B64I[bs[o+5]])}}
  for(const c of chars){if(!c.remote||c.kind!=='human')continue;const p=presOf(c.id);if(!p){c.gone=true;continue}c.gone=false;if(typeof p.x!=='number')continue;
    if(p!==c.lastP){c.lastP=p;const now=performance.now()/1000;if(c.lastPT)c.idur=c.idur*0.8+Math.min(0.5,now-c.lastPT)*0.2;c.lastPT=now;setTarget(c,p.x,p.z,p.y||0,p.s|0)}}
  for(const c of chars){if(c===player||(c.kind==='human'&&!c.remote)||(c.kind==='bot'&&MP.host))continue;
    c.it+=dt;const d=c.kind==='bot'?bsInt:c.idur,k=Math.min(1,c.it/Math.max(0.05,d)),ox=c.x,oz=c.z;
    c.x=c.fx0+(c.tx-c.fx0)*k;c.z=c.fz0+(c.tz-c.fz0)*k;
    const vx=(c.x-ox)/Math.max(dt,1e-3),vz=(c.z-oz)/Math.max(dt,1e-3);c.vx=c.vx*0.6+vx*0.4;c.vz=c.vz*0.6+vz*0.4;if(k>=1&&c.it>d*1.6){c.vx*=0.8;c.vz*=0.8}
    c.yaw+=angDiff(c.tyaw,c.yaw)*Math.min(1,dt*12)}
}
function setTarget(c,x,z,y,st){if(Math.hypot(x-c.x,z-c.z)>4){c.x=x;c.z=z}c.fx0=c.x;c.fz0=c.z;c.tx=x;c.tz=z;c.tyaw=y;c.it=0;
  c.stun=st&ST.stun?0.2:0;c.pushT=st&ST.push?0.2:0;c.dashT=st&ST.dash?0.1:0}
function mpSend(){
  const o={ev:REQ.ev};const me=player;
  if(me&&G&&G.r===MP.round){o.x=+me.x.toFixed(2);o.z=+me.z.toFixed(2);o.y=+me.yaw.toFixed(2);o.s=stOf(me)}
  if(MP.host&&MP.g){o.g=MP.g;o.bs=encBots()}else{o.g=null;o.bs=null}
  MP.net.presence(o);
}

/* ---------- заставка в меню: боти б'ються за зону ---------- */
const MENU_TEXT=$('ovText').textContent;
function resetMenu(){$('ov').hidden=false;$('ovTitle').textContent='Цар гори';$('ovTitle').className='';$('ovText').textContent=MENU_TEXT;$('scoreList').hidden=true;$('ovHint').hidden=false;$('soloBox').hidden=false;$('ovBtn').hidden=true;$('mpOpen').hidden=false;$('mpNote').hidden=!!MP.avail;$('ovLeave').hidden=true}
function bootScene(){
  phase='menu';const seed=4242,ids=mapIds();buildWorld(ids[0],seed);
  const col={},nm={},bots=[];for(let i=0;i<6;i++){const id='b'+i;bots.push(id);col[id]=i;nm[id]=BOT_NAMES[i]}
  G=newG(0,ids[0],seed,[],bots,col,nm,{});G.ph='play';setupRound(G);world.seed=null;
  pushB.hidden=abilB.hidden=true;
}
function menuScene(dt){T+=dt;pathBudget=3;for(const id in G.sc)if(G.sc[id]>GOAL-5){G.sc={};break}zoneTick(dt);
  for(const c of chars){timers(c,dt);botThink(c,dt)}for(const c of chars)integrate(c,dt);separate();playFx();drawZone();drawChars(dt);
  const z=zones[G.zi]||{x:world.W/2,z:world.H/2},cx=z.x+Math.sin(T*0.2)*2.5,cz=z.z+Math.cos(T*0.17)*1.5;camera.position.set(cx,9.5,cz+7);camera.lookAt(cx,0,cz);sunFollow(cx,cz)}
bootScene();
let last=performance.now();
function frame(now){const dt=Math.min(0.1,(now-last)/1000);last=now;
  if(phase==='lobby'){T+=dt;mpTick(dt)}
  if(phase==='menu'||phase==='lobby')menuScene(dt);
  else update(dt);
  renderer.render(scene,camera);drawFx(dt);requestAnimationFrame(frame)}
requestAnimationFrame(frame);

/* для автотестів (bots/local-sim/hill-test.js) */
window.HILLGame={get phase(){return phase},get G(){return G},get player(){return player},get chars(){return chars},get zones(){return zones},get MP(){return MP},get world(){return world},
  startSolo,sim:s=>{for(let t=0;t<s;t+=1/30)update(1/30)},doPush,doAbil,push:(a,b)=>applyPush(a,b),pushTarget,astar,snap,tapAt,keys,encBots,chr,get MAPIDS(){return mapIds()},buildWorld,ZR,GOAL,PUSH_CD};
})();
