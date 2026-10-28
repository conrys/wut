/* Тихо-голосно — «червоне світло, зелене світло». Лялька на дальньому кінці арени співає, дивлячись у стіну (🟢 біжи),
   і раптом обертається (🔴 завмри). Хто рухається після короткої поблажки (0,25 с від повного повороту) і кого вона бачить — вибуває.
   За високими укриттями (ящики, намети) лялька не бачить. Обманки: лялька смикає головою й не обертається.
   ✋ Поштовх (перезарядка 5 с): на «червоне» відкинутий сусід рухається — і вибуває, якщо його видно.
   Раунди (3 або 5), бали за місце на фініші: 5, 3, 2, далі по 1. Вибулий — 0.
   Авторитет: соло — сам телефон; мережа — хост (лялька, раунд, боти, бали). Свій рух кожен перевіряє сам на своєму телефоні
   (лаг мережі не карає): помітив, що рухався на «червоне», — шле хосту «вибув». */
(function(){
const T3=THREE,HW=HNSWorld,$=id=>document.getElementById(id);
function onTap(el,fn){let t=0;el.addEventListener('pointerdown',e=>{if(e.button>0)return;e.preventDefault();t=performance.now();fn(e)});el.addEventListener('click',e=>{if(performance.now()-t<700)return;fn(e)})}
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile=Math.min(innerWidth,innerHeight)<700;
const dist=(ax,az,bx,bz)=>Math.hypot(ax-bx,az-bz);
function rng(s){return()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const hash=s=>{let h=2166136261;for(const ch of String(s))h=Math.imul(h^ch.charCodeAt(0),16777619);return h>>>0};
const angDiff=(a,b)=>{let d=(a-b)%(Math.PI*2);if(d>Math.PI)d-=Math.PI*2;if(d<-Math.PI)d+=Math.PI*2;return d};
const rand=(a,b)=>a+Math.random()*(b-a);
const mapIds=()=>HW.MAPS.map((m,i)=>m.arena?i:-1).filter(i=>i>=0);

/* ---------- константи ---------- */
const NMAX=12,SPEED=3.2,TURN=0.35,GRACE=0.25,MOVE_EPS=0.45,ROUND_T=70,PUSH_R=1.5,PUSH_CD=5,PUSH_V=7,STUN=0.6;
const PLACE=[5,3,2];
const PAL=['#FF5C5C','#4C8DFF','#4CC97A','#FFC93C','#A779F2','#FF9A3D','#FF7BB0','#3CC8C8','#8BD14B','#F2F2F2','#B5835A','#7D8CA3'];
const BOT_NAMES=['Бублик','Вареник','Пиріжок','Сирник','Млинець','Галушка','Пампух','Кнедлик','Корж'];
const ST={stun:1,push:2,out:4,fin:8};

/* ---------- renderer ---------- */
const renderer=new T3.WebGLRenderer({canvas:$('gl'),antialias:true});
renderer.setPixelRatio(Math.min(mobile?1.5:2,devicePixelRatio||1));
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T3.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;
const scene=new T3.Scene();scene.background=new T3.Color('#9AA7AE');
const camera=new T3.PerspectiveCamera(46,1,0.5,160);
const fx=$('fx'),fctx=fx.getContext('2d');let W,H;
const VIEW_LONG=60*Math.PI/180;
function resize(){W=innerWidth;H=innerHeight;renderer.setSize(W,H,false);camera.aspect=W/H;
  camera.fov=(W>H?2*Math.atan(Math.tan(VIEW_LONG/2)*H/W):VIEW_LONG)*180/Math.PI;camera.updateProjectionMatrix();const d=Math.min(2,devicePixelRatio||1);fx.width=W*d;fx.height=H*d;fctx.setTransform(d,0,0,d,0,0)}
addEventListener('resize',resize);resize();
scene.add(new T3.HemisphereLight(0xEAF2FF,0xB59C82,0.6));
const sun=new T3.DirectionalLight(0xFFF0DC,0.62);sun.castShadow=true;sun.shadow.mapSize.set(mobile?1024:2048,mobile?1024:2048);sun.shadow.bias=-0.0006;sun.shadow.normalBias=0.03;
{const sc=sun.shadow.camera;sc.left=-17;sc.right=17;sc.top=17;sc.bottom=-17;sc.near=1;sc.far=60;sc.updateProjectionMatrix()}
scene.add(sun);scene.add(sun.target);
let sunAt=[1e9,1e9];
function sunFollow(x,z){const sx=Math.round(x/4)*4,sz=Math.round(z/4)*4;if(sx===sunAt[0]&&sz===sunAt[1])return;sunAt=[sx,sz];
  sun.position.set(sx-7,18,sz+9);sun.target.position.set(sx,0,sz);sun.target.updateMatrixWorld();renderer.shadowMap.needsUpdate=true}
const gm=new T3.DataTexture(new Uint8Array([120,190,255]),3,1,T3.LuminanceFormat);gm.minFilter=gm.magFilter=T3.NearestFilter;gm.needsUpdate=true;
const toon=(c,o={})=>new T3.MeshToonMaterial(Object.assign({color:c,gradientMap:gm},o));
const ground=new T3.Mesh(new T3.PlaneGeometry(240,240).rotateX(-Math.PI/2),toon('#8FA08E'));ground.position.y=-0.11;ground.receiveShadow=true;scene.add(ground);

/* ---------- лялька ---------- */
const doll=new T3.Group();
{const dress=new T3.Mesh(new T3.LatheGeometry([[0,0],[0.95,0.02],[0.86,0.6],[0.62,1.3],[0.42,1.75],[0.3,1.95],[0,2.0]].map(([x,y])=>new T3.Vector2(x,y)),24),toon('#FF8A3D'));
  const collar=new T3.Mesh(new T3.CylinderGeometry(0.34,0.42,0.18,20),toon('#FFE27A'));collar.position.y=1.98;
  const head=new T3.Group();head.position.y=2.55;
  const face=new T3.Mesh(new T3.SphereGeometry(0.58,24,16),toon('#FFD9B8'));
  const hair=new T3.Mesh(new T3.SphereGeometry(0.62,24,16,0,Math.PI*2,0,Math.PI*0.55),toon('#2B2238'));hair.rotation.x=-0.35;hair.position.set(0,0.05,-0.06);
  const back=new T3.Mesh(new T3.SphereGeometry(0.6,20,14),toon('#2B2238'));back.scale.set(1,1,0.75);back.position.set(0,-0.02,-0.16);
  head.add(face,hair,back);
  for(const s of[-1,1]){const pt=new T3.Mesh(new T3.SphereGeometry(0.22,14,10),toon('#2B2238'));pt.position.set(s*0.62,-0.18,-0.1);head.add(pt);
    const bow=new T3.Mesh(new T3.SphereGeometry(0.1,10,8),toon('#E8453C'));bow.position.set(s*0.58,0.0,-0.02);head.add(bow)}
  const eyeM=new T3.MeshBasicMaterial({color:'#1D1A26'});doll.eyeM=eyeM;
  for(const s of[-1,1]){const e=new T3.Mesh(new T3.SphereGeometry(0.085,12,10),eyeM);e.position.set(s*0.2,0.06,0.52);head.add(e)}
  const blush=toon('#FF9AA8');for(const s of[-1,1]){const b=new T3.Mesh(new T3.SphereGeometry(0.08,10,8),blush);b.scale.set(1.3,0.6,0.4);b.position.set(s*0.33,-0.1,0.47);head.add(b)}
  const mouth=new T3.Mesh(new T3.SphereGeometry(0.06,10,8),toon('#C2414E'));mouth.scale.set(1.4,0.6,0.5);mouth.position.set(0,-0.18,0.54);head.add(mouth);
  for(const s of[-1,1]){const arm=new T3.Mesh(new T3.CylinderGeometry(0.11,0.09,1,10),toon('#FFD9B8'));arm.position.set(s*0.52,1.35,0);arm.rotation.z=s*0.25;doll.add(arm)}
  doll.add(dress,collar,head);doll.head=head;doll.traverse(o=>{if(o.isMesh)o.castShadow=true});doll.scale.setScalar(1.25);scene.add(doll)}

/* ---------- світ ---------- */
let world=null,staticMesh=null,nav=null,mapIdx=-1,mapDef=null,segs=[],FIN=4.6,START=39.5,DX=7,DZ=1.6;
function buildWorld(mi,seed){
  if(staticMesh){scene.remove(staticMesh);staticMesh.geometry.dispose()}
  mapIdx=mi;world=HW.build(scene,{map:mi});mapDef=world.def;world.seed=seed;
  FIN=mapDef.fin||4.6;START=mapDef.start||world.H-4.5;DX=world.W/2;DZ=1.7;
  world.boxes.push([DX-1.1,1,DX+1.1,2.6]);   // лялька — тверда
  ground.position.set(world.W/2,-0.11,world.H/2);scene.background.set(mapDef.grass||'#9AA7AE');
  staticMesh=world.mesh.mesh(new T3.MeshToonMaterial({vertexColors:true,gradientMap:gm}));staticMesh.castShadow=staticMesh.receiveShadow=true;scene.add(staticMesh);
  nav=HW.walkGrid(world.boxes,0.3);allocNav();segs=HW.segmentsOf(world.tallBoxes);
  doll.position.set(DX,0,DZ);
  sunAt=[1e9,1e9];renderer.shadowMap.needsUpdate=true;
}
/* лялька бачить персонажа, якщо між ними немає високого укриття */
function seen(x,z){const ax=DX,az=DZ+0.6,dx=x-ax,dz=z-az;for(const s of segs){const sx=s[2]-s[0],sz=s[3]-s[1],den=dx*sz-dz*sx;if(Math.abs(den)<1e-9)continue;
  const qx=s[0]-ax,qz=s[1]-az,t=(qx*sz-qz*sx)/den,u=(qx*dz-qz*dx)/den;if(t>0.001&&t<0.999&&u>=0&&u<=1)return false}return true}

/* ---------- навігація ---------- */
let AG=null,AC_=null,ACL=null;const HEAP=[];
function allocNav(){const N=nav.free.length;AG=new Float32Array(N);AC_=new Int32Array(N);ACL=new Uint8Array(N)}
const ci=(x,z)=>Math.max(0,Math.min(nav.nz-1,Math.floor(z/HW.CS)))*nav.nx+Math.max(0,Math.min(nav.nx-1,Math.floor(x/HW.CS)));
const cx_=i=>(i%nav.nx+0.5)*HW.CS,cz_=i=>(Math.floor(i/nav.nx)+0.5)*HW.CS;
function nearestFree(i){if(nav.free[i])return i;const seen_=new Uint8Array(nav.free.length),q=[i];seen_[i]=1;
  for(let h=0;h<q.length;h++){const c=q[h];if(nav.free[c])return c;const x=c%nav.nx,z=Math.floor(c/nav.nx);for(const [dx,dz] of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,nz=z+dz;if(nx<0||nz<0||nx>=nav.nx||nz>=nav.nz)continue;const n=nz*nav.nx+nx;if(!seen_[n]){seen_[n]=1;q.push(n)}}}return i}
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

/* ---------- персонажі: інстанси ---------- */
const BEAN=new T3.LatheGeometry([[0,0],[0.17,0.012],[0.25,0.06],[0.285,0.17],[0.29,0.36],[0.285,0.55],[0.26,0.7],[0.21,0.82],[0.13,0.9],[0,0.93]].map(([x,y])=>new T3.Vector2(x,y)),18);
const SPHS=new T3.SphereGeometry(1,7,5),DISC=new T3.CircleGeometry(1,18).rotateX(-Math.PI/2),RING=new T3.RingGeometry(0.4,0.5,28).rotateX(-Math.PI/2);
function IM(geo,mat,n,colored){const m=new T3.InstancedMesh(geo,mat,n);m.instanceMatrix.setUsage(T3.DynamicDrawUsage);m.frustumCulled=false;
  if(colored){const w=new T3.Color('#ffffff');for(let i=0;i<n;i++)m.setColorAt(i,w);m.instanceColor.setUsage(T3.DynamicDrawUsage)}m.count=0;m.castShadow=false;scene.add(m);return m}
const IB={body:IM(BEAN,toon('#ffffff'),NMAX,1),hand:IM(SPHS,toon('#ffffff'),NMAX*2,1),foot:IM(SPHS,toon('#ffffff'),NMAX*2,1),eye:IM(SPHS,toon('#FFFFFF'),NMAX*2),blk:IM(SPHS,toon('#1D1A26'),NMAX*3),
  shadow:IM(DISC,new T3.MeshBasicMaterial({color:'#000000',transparent:true,opacity:0.2,depthWrite:false}),NMAX),
  mark:IM(RING,new T3.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:0.9,depthWrite:false}),NMAX,1)};
IB.shadow.renderOrder=1;IB.mark.renderOrder=2;
const _m=new T3.Matrix4(),_root=new T3.Matrix4(),_body=new T3.Matrix4(),_q=new T3.Quaternion(),_e=new T3.Euler(),_v=new T3.Vector3(),_s=new T3.Vector3(),_c=new T3.Color(),GREY=new T3.Color('#8B8F99');

let chars=[],player=null;
function newChar(id,kind,x,z,colI,nick){
  const c={id,kind,x,z,vx:0,vz:0,kx:0,kz:0,yaw:Math.PI,ph:Math.random()*6,blinkT:Math.random()*3,stun:0,pushT:0,cdP:0,lie:0,out:false,fin:false,
    col:new T3.Color(PAL[colI%PAL.length]),colI,dark:new T3.Color(PAL[colI%PAL.length]).multiplyScalar(0.55),nick:nick||'',
    path:null,pi:0,remote:false,gone:false,fx0:x,fz0:z,tx:x,tz:z,tyaw:Math.PI,it:1,idur:0.15,
    go:false,goAt:0,lane:x,rep:0};
  chars.push(c);return c;
}
const chr=id=>chars.find(c=>c.id===id);
const P=c=>c.remote?[c.tx,c.tz]:[c.x,c.z];
function drawChars(dt){
  const n={body:0,hand:0,foot:0,eye:0,blk:0,shadow:0,mark:0};
  for(const c of chars){
    if(c.gone)continue;
    const k=Math.min(1,Math.hypot(c.vx,c.vz)/2.6),sp=Math.hypot(c.vx+c.kx,c.vz+c.kz);
    c.ph+=dt*(4+sp*3.4);c.lie+=((c.out?1:0)-c.lie)*Math.min(1,dt*7);
    const col=c.out?_c.copy(c.col).lerp(GREY,0.55):c.col;
    _q.setFromEuler(_e.set(0,c.yaw,0));_root.compose(_v.set(c.x,0,c.z),_q,_s.set(1.2,1.2,1.2));
    const bob=reduce||c.out?0:Math.abs(Math.sin(c.ph))*0.07*k,cheer=c.fin&&!reduce?Math.abs(Math.sin(T*8+c.ph))*0.12:0;
    _q.setFromEuler(_e.set(k*0.2*(1-c.lie)+(c.pushT>0?0.3:0)-c.lie*1.4,0,0));_body.compose(_v.set(0,bob+cheer+c.lie*0.12,-c.lie*0.25),_q,_s.set(1,1-bob*0.8,1)).premultiply(_root);
    IB.body.setMatrixAt(n.body,_body);IB.body.setColorAt(n.body++,col);
    c.blinkT-=dt;if(c.blinkT<0)c.blinkT=2+Math.random()*3;const bl=c.blinkT<0.1||c.out?0.12:1;
    for(const s of[-1,1]){IB.eye.setMatrixAt(n.eye++,_m.compose(_v.set(s*0.095,0.64,0.215),_q.set(0,0,0,1),_s.set(0.075,0.085*bl,0.05)).premultiply(_body));
      IB.blk.setMatrixAt(n.blk++,_m.compose(_v.set(s*0.095,0.635,0.255),_q.set(0,0,0,1),_s.set(0.04,0.048*bl,0.025)).premultiply(_body))}
    IB.blk.setMatrixAt(n.blk++,_m.compose(_v.set(0,0.53,0.255),_q.set(0,0,0,1),_s.set(0.035,c.out?0.03:0.016,0.012)).premultiply(_body));
    const sw=reduce?0:Math.sin(c.ph)*k;
    for(const s of[-1,1]){IB.foot.setMatrixAt(n.foot,_m.compose(_v.set(s*0.11,0.045+Math.max(0,s*Math.sin(c.ph))*0.07*k,0.02-s*sw*0.15),_q.set(0,0,0,1),_s.set(0.085,0.055,0.12)).premultiply(_root));IB.foot.setColorAt(n.foot++,c.dark)}
    let hl=[-0.31,0.36,0.02-sw*0.12],hr=[0.31,0.36,0.02+sw*0.12];
    if(c.pushT>0){hl=[-0.17,0.5,0.42];hr=[0.17,0.5,0.42]}else if(c.fin){const w=reduce?0:Math.sin(T*10)*0.06;hl=[-0.34,0.86+w,0.02];hr=[0.34,0.86-w,0.02]}else if(c.stun>0){hl=[-0.34,0.75,0];hr=[0.34,0.75,0]}
    for(const h of[hl,hr]){IB.hand.setMatrixAt(n.hand,_m.compose(_v.set(h[0],h[1],h[2]),_q.set(0,0,0,1),_s.set(0.07,0.07,0.07)).premultiply(_body));IB.hand.setColorAt(n.hand++,col)}
    _m.compose(_v.set(c.x,0.012,c.z),_q.set(0,0,0,1),_s.set(0.36,1,0.36));IB.shadow.setMatrixAt(n.shadow++,_m);
    if(!c.out){_m.compose(_v.set(c.x,0.025,c.z),_q.set(0,0,0,1),_s.set(1,1,1));IB.mark.setMatrixAt(n.mark,_m);IB.mark.setColorAt(n.mark++,c===player?_c.set('#FFD23F'):c.col)}
  }
  for(const k in n){const m=IB[k];m.count=n[k];m.instanceMatrix.needsUpdate=true;if(m.instanceColor)m.instanceColor.needsUpdate=true}
}

/* ---------- рух ---------- */
function steerPath(ch,dt,speed){
  let tx=0,tz=0;
  if(ch.path&&ch.pi<ch.path.length){const p=ch.path[ch.pi],dx=p[0]-ch.x,dz=p[1]-ch.z,d=Math.hypot(dx,dz);
    if(d<0.22){ch.pi++}else{tx=dx/d*speed;tz=dz/d*speed}}
  ch.vx+=(tx-ch.vx)*Math.min(1,dt*10);ch.vz+=(tz-ch.vz)*Math.min(1,dt*10);
  return !ch.path||ch.pi>=ch.path.length;
}
function collide(ch){
  const r=0.28;
  for(const b of world.boxes){if(ch.x<b[0]-r||ch.x>b[2]+r||ch.z<b[1]-r||ch.z>b[3]+r)continue;
    const cx=Math.max(b[0],Math.min(ch.x,b[2])),cz=Math.max(b[1],Math.min(ch.z,b[3]));let dx=ch.x-cx,dz=ch.z-cz,d=Math.hypot(dx,dz);
    if(d<r){if(d<1e-5){const l=ch.x-b[0],rr=b[2]-ch.x,t=ch.z-b[1],bb=b[3]-ch.z,m=Math.min(l,rr,t,bb);if(m===l)ch.x=b[0]-r;else if(m===rr)ch.x=b[2]+r;else if(m===t)ch.z=b[1]-r;else ch.z=b[3]+r;continue}
      ch.x=cx+dx/d*r;ch.z=cz+dz/d*r;const nx=dx/d,nz=dz/d;
      const vn=ch.vx*nx+ch.vz*nz;if(vn<0){ch.vx-=vn*nx;ch.vz-=vn*nz}
      const kn=ch.kx*nx+ch.kz*nz;if(kn<0){ch.kx-=kn*nx*1.5;ch.kz-=kn*nz*1.5}}}
}
function integrate(ch,dt){
  const kd=Math.exp(-dt*4.5);ch.x+=(ch.vx+ch.kx)*dt;ch.z+=(ch.vz+ch.kz)*dt;ch.kx*=kd;ch.kz*=kd;if(Math.hypot(ch.kx,ch.kz)<0.05)ch.kx=ch.kz=0;
  collide(ch);const sp=Math.hypot(ch.vx,ch.vz);if(sp>0.25&&ch.stun<=0)ch.yaw+=angDiff(Math.atan2(ch.vx,ch.vz),ch.yaw)*Math.min(1,dt*12)}
function separate(){
  const mine=c=>c===player||(isAuth()&&c.kind==='bot');
  for(let i=0;i<chars.length;i++){const a=chars[i];if(a.gone||a.out)continue;for(let j=i+1;j<chars.length;j++){const b=chars[j];if(b.gone||b.out)continue;
    const ex=a.x-b.x,ez=a.z-b.z,d=Math.hypot(ex,ez),R=0.55;if(d>=R||d<1e-4)continue;const pu=(R-d)/2;
    const ma=mine(a),mb=mine(b);if(ma){a.x+=ex/d*pu*(mb?1:2);a.z+=ez/d*pu*(mb?1:2)}if(mb){b.x-=ex/d*pu*(ma?1:2);b.z-=ez/d*pu*(ma?1:2)}}}
}
const moving=c=>Math.hypot(c.vx+c.kx,c.vz+c.kz)>MOVE_EPS;
function knock(c,dx,dz,k){c.kx=dx*PUSH_V*k;c.kz=dz*PUSH_V*k;c.stun=STUN*k;c.path=null;c.vx*=0.2;c.vz*=0.2}
function pushTarget(c){let best=null,bs=1e9;for(const o of chars){if(o===c||o.gone||o.out||o.fin)continue;const d=dist(o.x,o.z,c.x,c.z);if(d>PUSH_R)continue;
  const a=Math.abs(angDiff(Math.atan2(o.x-c.x,o.z-c.z),c.yaw)),s=d+a*0.4;if(s<bs){bs=s;best=o}}return best}

/* ---------- лялька: стан (соло або хост) ----------
   dl: g — співає, дивиться в стіну · f — обманка (смикнула головою) · t — обертається · r — дивиться (червоне) · b — відвертається */
function setDl(s,ms){G.dl=s;G.dlT=ms;G.dlD=ms;G.dlN=(G.dlN||0)+1}
function dollTick(dt){
  G.dlT-=dt*1000;if(G.dlT>0)return;
  const late=1-Math.max(0,G.rem)/(ROUND_T*1000);   // під кінець раунду — швидше й підступніше
  switch(G.dl){
    case 'g':if(!G.fk&&Math.random()<0.24){G.fk=1;setDl('f',650)}else{G.fk=0;setDl('t',TURN*1000)}break;
    case 'f':setDl('g',rand(600,1600));break;
    case 't':setDl('r',rand(2000,3600));break;
    case 'r':setDl('b',300);break;
    default:setDl('g',rand(1400,4600)*(1-late*0.35));
  }
}
/* локальний відлік стану ляльки — для анімації й поблажки (кожен телефон рахує від моменту, коли сам побачив зміну) */
const DL={n:-1,at:0,s:'g',d:1000};
function dlLocal(){if(!G)return;if(G.dlN!==DL.n){DL.n=G.dlN;DL.at=performance.now();DL.s=G.dl;DL.d=G.dlD||1000;onDoll(G.dl)}}
const dlProg=()=>Math.min(1,(performance.now()-DL.at)/DL.d);
function dollYaw(){const p=dlProg(),e=p<0.5?2*p*p:1-Math.pow(-2*p+2,2)/2;
  switch(DL.s){case 'f':return Math.PI-Math.sin(p*Math.PI)*0.75;case 't':return Math.PI*(1-e);case 'r':return 0;case 'b':return Math.PI*e;default:return Math.PI}}
const watching=()=>DL.s==='r'&&performance.now()-DL.at>GRACE*1000;   // поблажка після повного повороту
const red=()=>DL.s==='t'||DL.s==='r';

/* ---------- боти (соло або хост) ---------- */
function skill(id){const R=rng(hash(id)^(G.seed|0));return{re:0.08+R()*0.2,sp:2.6+R()*0.55,mean:R()<0.25,fake:R()<0.5,err:0.06+R()*0.12}}
function botThink(b,dt){
  if(!G||G.ph!=='play'||b.out||b.fin){b.vx*=0.6;b.vz*=0.6;return}
  if(b.stun>0){b.vx*=0.85;b.vz*=0.85;return}
  const sk=b.sk||(b.sk=skill(b.id)),now=hostNow();
  // реакція на ляльку: перемкнулась — бот зупиняється/рушає з запізненням (іноді запізно — і вибуває)
  if(b.dlN!==G.dlN){b.dlN=G.dlN;const s=G.dl;
    if(s==='t'||(s==='f'&&!sk.fake)){b.goAt=now+(s==='t'&&Math.random()<sk.err?0.75+Math.random()*0.5:sk.re+Math.random()*0.2)*1000;b.want=false}   // sk.err — шанс прогавити поворот
    else if(s==='g'||s==='b'){b.goAt=now+(0.12+Math.random()*0.4)*1000;b.want=true}}
  if(now>=b.goAt)b.go=b.want!==false;
  // поштовх: на зелене — того, хто попереду поруч; підлі боти — на червоне (щоб сусід ворухнувся)
  if(b.cdP<=0){const t=pushTarget(b);if(t){const ahead=t.z<b.z+0.2,r=Math.random();
    if((G.dl==='g'&&ahead&&r<dt*0.35)||(sk.mean&&G.dl==='r'&&r<dt*0.6)){b.cdP=PUSH_CD*(1+Math.random()*0.5);b.pushT=0.25;b.yaw=Math.atan2(t.x-b.x,t.z-b.z);SFX.whoosh(b);applyPush(b.id,t.id)}}}
  if(!b.go){b.vx*=Math.max(0,1-dt*14);b.vz*=Math.max(0,1-dt*14);return}
  b.rep-=dt;if(!b.path||b.pi>=b.path.length||b.rep<=0){if(pathBudget>0){pathBudget--;b.rep=2+Math.random();const [tx,tz]=snap(b.lane,FIN-1.3);b.path=astar(b.x,b.z,tx,tz);b.pi=0}}
  steerPath(b,dt,sk.sp);
}

/* ---------- звук ---------- */
let AC=null,muted=false,noiseBuf=null;try{muted=localStorage.getItem('rl_mute')==='1'}catch(e){}
function au(){if(!AC){try{AC=new (window.AudioContext||window.webkitAudioContext)()}catch(e){}}if(AC&&AC.state==='suspended')AC.resume();return AC}
const quiet=()=>muted||phase==='menu'||phase==='lobby';
function tone(f,d,{type='sine',vol=0.12,slide=0,delay=0}={}){if(quiet()||vol<0.002)return;const a=au();if(!a)return;const t=a.currentTime+delay,o=a.createOscillator(),g=a.createGain();o.type=type;o.frequency.setValueAtTime(f,t);if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(30,f*slide),t+d);
  g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(vol,t+0.012);g.gain.exponentialRampToValueAtTime(0.0001,t+d);o.connect(g).connect(a.destination);o.start(t);o.stop(t+d+0.02)}
function noise(d,{vol=0.1,f=800,q=0.8,delay=0,kind='bandpass',slide=0}={}){if(quiet()||vol<0.002)return;const a=au();if(!a)return;
  if(!noiseBuf){noiseBuf=a.createBuffer(1,a.sampleRate,a.sampleRate);const ch=noiseBuf.getChannelData(0);for(let i=0;i<ch.length;i++)ch[i]=Math.random()*2-1}
  const t=a.currentTime+delay,s=a.createBufferSource(),bf=a.createBiquadFilter(),g=a.createGain();s.buffer=noiseBuf;bf.type=kind;bf.frequency.setValueAtTime(f,t);if(slide)bf.frequency.exponentialRampToValueAtTime(Math.max(60,f*slide),t+d);bf.Q.value=q;
  g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(vol,t+0.01);g.gain.exponentialRampToValueAtTime(0.0001,t+d);s.connect(bf).connect(g).connect(a.destination);s.start(t,Math.random()*0.5);s.stop(t+d+0.05)}
const near_=c=>{const me=camFollow();if(!c||!me)return 1;return Math.max(0.15,1-dist(c.x,c.z,me.x,me.z)/14)};
/* пісенька ляльки: «тихо-тихо, ніхто не дихай…» — поки зелене, нота за нотою */
const SONG=[659,659,784,659,587,523,587,659,523,0,659,784,880,784,659,587];let songI=0,songT=0;
const SFX={
  whoosh:c=>noise(0.16,{vol:0.07*near_(c),f:1400,q:0.7,slide:0.4}),
  bonk:c=>{const v=near_(c);tone(180,0.18,{type:'square',vol:0.09*v,slide:0.5});noise(0.1,{vol:0.12*v,f:500})},
  turn:()=>{tone(196,0.55,{type:'sawtooth',vol:0.11,slide:0.98});tone(98,0.6,{type:'square',vol:0.07});noise(0.25,{vol:0.08,f:300})},
  hm:()=>tone(330,0.25,{type:'triangle',vol:0.09,slide:1.25}),
  out:()=>{tone(392,0.18,{type:'triangle',vol:0.08});tone(311,0.22,{type:'triangle',vol:0.08,delay:0.15});tone(233,0.5,{type:'sawtooth',vol:0.06,delay:0.32,slide:0.8})},
  fin:()=>[523,659,784].forEach((f,i)=>tone(f,0.18,{type:'triangle',vol:0.1,delay:i*0.08})),
  beep:()=>tone(660,0.12,{vol:0.08}),
  win:()=>[523,659,784,1047].forEach((f,i)=>tone(f,0.24,{type:'triangle',vol:0.12,delay:i*0.11})),
  lose:()=>[392,330,262].forEach((f,i)=>tone(f,0.3,{type:'sawtooth',vol:0.05,delay:i*0.15})),
};
function sing(dt){if(!G||G.ph!=='play'||DL.s!=='g'){songT=0;return}songT-=dt;if(songT>0)return;songT=0.26;const f=SONG[songI++%SONG.length];if(f)tone(f,0.22,{type:'triangle',vol:0.05})}
$('mute').addEventListener('click',()=>{muted=!muted;$('mute').textContent=muted?'🔇':'🔊';$('mute').setAttribute('aria-label',muted?'Увімкнути звук':'Вимкнути звук');try{localStorage.setItem('rl_mute',muted?'1':'0')}catch(e){}});
$('mute').textContent=muted?'🔇':'🔊';

/* ---------- стан раунду ----------
   G: r лічильник раундів (для розстановки), rd номер раунду в грі, nr скільки раундів, ph intro/play/end/over, k, map, seed,
   pl гравці, bots, col кольори, nm імена ботів, dl/dlT/dlD/dlN лялька, out вибулі, fin фінішували (по порядку),
   sc бали за гру, rs бали за раунд, fx події, rem мс до кінця фази */
let phase='menu',T=0,G=null,lastKey='',pops=[],confetti=[],shakeT=0,introT=0,lastFx=0,spec=null,rips=[],flash=0;
const auth={last:{},pu:{}};
const isAuth=()=>!MP.on||MP.host;
const myId=()=>MP.on?MP.me:'me';
const hostNow=()=>T*1000;
function newG(r,rd,nr,map,seed,pl,bots,col,nm,sc){return{r,rd,nr,ph:'intro',k:1,map,seed,pl,bots,col,nm,dl:'g',dlT:3000,dlD:3000,dlN:1,fk:0,out:[],fin:[],sc:sc||{},rs:{},fx:[],fxn:0,rem:4000}}
function setupRound(cfg){
  if(mapIdx!==cfg.map||!world||world.seed!==cfg.seed)buildWorld(cfg.map,cfg.seed);
  chars=[];player=null;spec=null;lastFx=cfg.fxn||0;pops=[];rips=[];auth.pu={};DL.n=-1;
  const ids=cfg.pl.concat(cfg.bots),n=ids.length,R=rng(cfg.seed);
  const order=ids.map(id=>({id,r:R()})).sort((a,b)=>a.r-b.r).map(o=>o.id);
  order.forEach((id,i)=>{const x=1.8+(world.W-3.6)*(n>1?i/(n-1):0.5),[sx,sz]=snap(x,START+0.9+(i%2)*0.5),bot=cfg.bots.includes(id);
    const nick=bot?cfg.nm[id]:MP.on?String((presOf(id)||{}).n||'Гравець').slice(0,14):'Ти';
    const c=newChar(id,bot?'bot':'human',sx,sz,cfg.col[id]|0,nick);c.lane=Math.max(1.6,Math.min(world.W-1.6,sx+(R()-0.5)*2));
    if(MP.on&&!bot&&id!==MP.me)c.remote=true;if(id===myId())player=c;
    if(cfg.out.includes(id))c.out=true;if(cfg.fin.includes(id))c.fin=true});
  for(const c of chars){c.tx=c.x;c.tz=c.z;c.fx0=c.x;c.fz0=c.z;c.tyaw=c.yaw}
}

/* ---------- події: поштовх, вибув, фініш ---------- */
function applyEv(id,t,v){if(!G||G.ph!=='play')return;if(t==='pu')applyPush(id,v);else if(t==='out')applyOut(id);else if(t==='fin')applyFin(id)}
const REQ={s:0,ev:[]};
function req(t,v){if(isAuth()){applyEv(myId(),t,v);return}REQ.s++;REQ.ev.push([REQ.s,t,v]);if(REQ.ev.length>12)REQ.ev.shift()}
function hostEvents(){for(const p of peersNow()){if(p.isMe||!G.pl.includes(p.id))continue;const ev=(p.presence||{}).ev;if(!Array.isArray(ev))continue;
  const last=auth.last[p.id]||0;for(const [s,t,v] of ev)if(s>last){applyEv(p.id,t,v);auth.last[p.id]=s}}}
function pushFx(e){G.fxn++;G.fx.push([G.fxn].concat(e));if(G.fx.length>10)G.fx.shift()}
const done=id=>G.out.includes(id)||G.fin.includes(id);
function applyPush(fid,tid){
  const a=chr(fid),b=chr(tid);if(!a||!b||a===b||a.gone||b.gone||done(fid)||done(tid))return;const now=hostNow();
  if(a.kind==='human'&&auth.pu[fid]&&now-auth.pu[fid]<PUSH_CD*700)return;
  const [ax,az]=P(a),[bx,bz]=P(b);let dx=bx-ax,dz=bz-az,d=Math.hypot(dx,dz);if(d>PUSH_R+0.9)return;
  if(d<0.01){dx=Math.sin(a.yaw);dz=Math.cos(a.yaw);d=1}dx/=d;dz/=d;auth.pu[fid]=now;
  pushFx(['p',fid,tid,+dx.toFixed(2),+dz.toFixed(2)]);
}
function applyOut(id){if(done(id))return;const c=chr(id);if(!c)return;G.out.push(id);G.rs[id]=0;pushFx(['o',id]);checkEnd()}
function applyFin(id){if(done(id))return;const c=chr(id);if(!c)return;const [,z]=P(c);if(z>FIN+0.8)return;
  const place=G.fin.length,pts=PLACE[place]||1;G.fin.push(id);G.rs[id]=pts;G.sc[id]=(G.sc[id]||0)+pts;pushFx(['f',id,place+1]);checkEnd()}
function playFx(){
  if(!G)return;for(const e of G.fx){if(e[0]<=lastFx)continue;lastFx=e[0];
    const [,t,a,b,dx,dz]=e,A=chr(a),B=chr(b),ctl=c=>c&&(c===player||(isAuth()&&c.kind==='bot'));
    if(t==='p'){if(ctl(B))knock(B,dx,dz,1);if(B){pop(B,'💥','#FFE27A');SFX.bonk(B)}if(B===player){shakeT=0.25;vib(70)}if(A&&A!==player)A.pushT=0.25}
    else if(t==='o'){if(A){A.out=true;A.path=null;pop(A,'💀','#fff');if(near_(A)>0.3||A===player)SFX.out()}if(A===player){say('Вибув!','big red');vib([80,60,160]);shakeT=0.35}}
    else if(t==='f'){if(A){A.fin=true;pop(A,'🏁 '+b,'#FFE27A')}if(A===player){SFX.fin();say(b===1?'Перший! +5':'Фініш! '+b+'-й','big gold');vib(60)}}
  }
}
function onDoll(s){if(phase!=='play')return;
  if(s==='t'){SFX.turn();flash=1;if(player&&!player.out&&!player.fin){vib(40)}}
  else if(s==='f'){SFX.hm()}
  else if(s==='g'){songI=0}}

/* ---------- керування ---------- */
let joy=null;const keys={};
const gl=$('gl');
gl.addEventListener('pointerdown',e=>{au();if(joy)return;joy={id:e.pointerId,sx:e.clientX,sy:e.clientY,x:e.clientX,y:e.clientY,t:e.timeStamp,moved:false};try{gl.setPointerCapture(e.pointerId)}catch(_){}});
gl.addEventListener('pointermove',e=>{if(joy&&e.pointerId===joy.id){joy.x=e.clientX;joy.y=e.clientY;if(Math.hypot(joy.x-joy.sx,joy.y-joy.sy)>12)joy.moved=true}});
const endJoy=e=>{if(!joy||e.pointerId!==joy.id)return;joy=null};
gl.addEventListener('pointerup',endJoy);gl.addEventListener('pointercancel',endJoy);
addEventListener('keydown',e=>{const k=e.key.toLowerCase();keys[k]=true;if(k===' '){e.preventDefault();doPush()}});addEventListener('keyup',e=>{keys[e.key.toLowerCase()]=false});
function readStick(){let ix=0,iz=0;
  if(joy&&joy.moved){const dx=joy.x-joy.sx,dy=joy.y-joy.sy,m=Math.hypot(dx,dy);if(m>8){ix=dx/m;iz=dy/m}}
  if(keys.a||keys.arrowleft)ix-=1;if(keys.d||keys.arrowright)ix+=1;if(keys.w||keys.arrowup)iz-=1;if(keys.s||keys.arrowdown)iz+=1;
  const im=Math.hypot(ix,iz);if(im>1){ix/=im;iz/=im}return[ix,iz]}
const _p=new T3.Vector3();
function scr(x,y,z){_p.set(x,y,z).project(camera);return{x:(_p.x+1)/2*W,y:(1-_p.y)/2*H,z:_p.z}}
const pushB=$('push');
onTap(pushB,()=>doPush());
function canAct(){const p=player;return p&&phase==='play'&&p.stun<=0&&!p.out&&!p.fin}
function doPush(){au();const p=player;if(!canAct()||p.cdP>0)return;const t=pushTarget(p);p.pushT=0.25;SFX.whoosh(p);
  if(!t){p.cdP=0.8;return}p.cdP=PUSH_CD;p.yaw=Math.atan2(t.x-p.x,t.z-p.z);req('pu',t.id)}

/* ---------- оновлення гравця: рух, самоперевірка на «червоне», фініш ---------- */
function playerUpdate(p,dt){
  if(p.gone)return;
  if(p.out){p.vx*=0.5;p.vz*=0.5;return}
  const frozen=phase!=='play'||p.stun>0;
  const [ix,iz]=readStick(),m=Math.hypot(ix,iz);
  if(frozen){p.vx*=0.6;p.vz*=0.6}
  else if(m>0.2){p.vx+=(ix/m*SPEED-p.vx)*Math.min(1,dt*12);p.vz+=(iz/m*SPEED-p.vz)*Math.min(1,dt*12)}
  else{p.vx*=Math.max(0,1-dt*16);p.vz*=Math.max(0,1-dt*16);if(Math.hypot(p.vx,p.vz)<0.15)p.vx=p.vz=0}
  if(phase!=='play'||p.fin)return;
  if(p.z<FIN&&!p.finReq){p.finReq=true;req('fin');return}
  if(watching()&&moving(p)&&seen(p.x,p.z)&&!p.outReq){p.outReq=true;p.out=true;req('out')}
}
function timers(c,dt){c.stun=Math.max(0,c.stun-dt);c.pushT=Math.max(0,c.pushT-dt);c.cdP=Math.max(0,c.cdP-dt)}
/* хост/соло: боти, що ворухнулися на «червоне», і боти на фініші */
function judgeBots(){if(G.ph!=='play')return;const watch=G.dl==='r'&&G.dlD-G.dlT>GRACE*1000;
  for(const c of chars){if(c.kind!=='bot'||c.out||c.fin||done(c.id))continue;
    if(c.z<FIN){applyFin(c.id);continue}
    if(watch&&moving(c)&&seen(c.x,c.z))applyOut(c.id)}}
function alive(){return G.pl.concat(G.bots).filter(id=>{const c=chr(id);return c&&!c.gone&&!done(id)})}
function checkEnd(){if(phase==='menu'||phase==='lobby')return;if(G.ph==='play'&&!alive().length)endRound('all')}
function endRound(why){if(G.ph!=='play')return;G.ph=G.rd>=G.nr?'over':'end';G.k++;G.why=why;
  for(const id of G.pl.concat(G.bots))if(!(id in G.rs))G.rs[id]=0;
  G.rem=G.ph==='over'?12000:6000;if(MP.on)MP.hostEnd=performance.now()+G.rem;syncPhase()}

/* ---------- фази ---------- */
function onPhase(){
  if(G.ph==='intro'){phase='intro';$('ov').hidden=true;$('mp').hidden=true;say('Раунд '+G.rd+(G.nr?' з '+G.nr:''),'big');
    if(!player)tip('Ти глядач — приєднаєшся в наступній грі');else if(G.rd===1)tip('Біжи, поки лялька співає. Обернулась — відпусти палець і завмри!')}
  if(G.ph==='play'){phase='play';say('Біжи!','big')}
  if(G.ph==='end'||G.ph==='over'){phase=G.ph;joy=null;showEnd()}
  updButtons(true);updHud(true);
}
function syncPhase(){const key=G.r+':'+G.ph;if(key!==lastKey){lastKey=key;onPhase()}}
function nameOf(id){if(id===myId())return'Ти';const c=chr(id);return c?c.nick:(G.nm&&G.nm[id])||String((presOf(id)||{}).n||'Гравець').slice(0,14)}
function showEnd(){
  const over=G.ph==='over',me=player,ids=G.pl.concat(G.bots).sort((a,b)=>(G.sc[b]||0)-(G.sc[a]||0)||(G.rs[b]||0)-(G.rs[a]||0));
  const top=ids[0],myWin=over&&me&&top===me.id&&(G.sc[top]||0)>0;
  if(over){if(myWin){SFX.win();for(let i=0;i<110;i++)confetti.push({x:W/2+(Math.random()-.5)*W*0.8,y:H*0.3,vx:(Math.random()-.5)*420,vy:-150-Math.random()*380,l:2.6,c:['#FFC93C','#FF4D5E','#3DDC84','#4C8DFF'][i%4],r:Math.random()*6})}else if(me)SFX.lose()}
  const title=over?(myWin?'Ти переміг!':(G.sc[top]||0)>0?nameOf(top)+' перемагає':'Ніхто не дійшов'):'Раунд '+G.rd+' з '+G.nr;
  const mine=me?G.rs[me.id]:null,myLine=!me?'':G.out.includes(me.id)?'Ти вибув — 0 балів.':G.fin.includes(me.id)?'Ти фінішував '+(G.fin.indexOf(me.id)+1)+'-м: +'+mine+'.':'Не встиг до фінішу — 0 балів.';
  setTimeout(()=>{if(phase!=='end'&&phase!=='over')return;$('ovTitle').textContent=title;$('ovTitle').className=over&&!myWin?'lose':'';
    $('ovText').textContent=myLine+(over?'':' Наступний раунд за кілька секунд.');
    const sl=$('scoreList');sl.innerHTML='';
    for(const id of ids){const li=document.createElement('li');if(id===myId())li.className='me';const d=document.createElement('span');d.className='pdot';d.style.background=PAL[(G.col[id]|0)%PAL.length];
      const nm=document.createElement('span');nm.textContent=nameOf(id);const w=document.createElement('small');w.textContent=G.out.includes(id)?'💀':G.fin.includes(id)?'🏁 +'+G.rs[id]:'⏱';
      const b=document.createElement('b');b.textContent=G.sc[id]||0;li.append(d,nm,w,b);sl.append(li)}
    sl.hidden=false;$('ovHint').hidden=true;$('soloBox').hidden=!(over&&!MP.on);$('mpOpen').hidden=MP.on||!over;$('mpNote').hidden=true;
    $('ovBtn').hidden=!over||(MP.on&&!MP.host);$('ovBtn').textContent=MP.on?'Нова гра':'Ще раз';$('ovLeave').hidden=!MP.on;$('ov').hidden=false},over?1400:700);
}
let soloBots=5,soloG=null;
function soloRound(rd,sc){
  const ids=mapIds(),map=ids[(rd-1+(soloG?soloG.m0:0))%ids.length],seed=Math.floor(Math.random()*1e9);
  G=newG(Date.now(),rd,3,map,seed,['me'],soloG.bots,soloG.col,soloG.nm,sc);setupRound(G);lastKey='';introT=4;camInit=false;syncPhase();
}
function startSolo(nb){
  au();soloBots=nb||soloBots;const myC=MP.color%PAL.length,col={me:myC},nm={},bots=[];let ci2=0;
  for(let i=0;i<soloBots;i++){const id='b'+i;bots.push(id);while(ci2%PAL.length===myC)ci2++;col[id]=ci2++%PAL.length;nm[id]=BOT_NAMES[i%BOT_NAMES.length]}
  soloG={bots,col,nm,m0:Math.floor(Math.random()*2)};soloRound(1,{});
}

/* ---------- головний цикл ---------- */
const camPos=new T3.Vector3(),camLook=new T3.Vector3();let camInit=false,netT=0;
function update(dt){
  T+=dt;pathBudget=4;
  if(MP.on)mpTick(dt);
  else if(G){
    if(G.ph==='intro'){const b=Math.ceil(introT);introT-=dt;const n=Math.ceil(introT);if(n!==b&&n>0&&n<=3){say(String(n),'num');SFX.beep()}if(introT<=0){G.ph='play';G.k++;G.rem=ROUND_T*1000;setDl('g',rand(2200,3600));syncPhase()}}
    else if(G.ph==='play'){G.rem-=dt*1000;dollTick(dt);if(G.rem<=0)endRound('time')}
    else if(G.ph==='end'){G.rem-=dt*1000;if(G.rem<=0)soloRound(G.rd+1,G.sc)}
    syncPhase();
  }
  if(!G)return;
  dlLocal();
  for(const c of chars)if(c===player||(isAuth()&&c.kind==='bot'))timers(c,dt);
  if(player)playerUpdate(player,dt);
  if(isAuth())for(const c of chars)if(c.kind==='bot')botThink(c,dt);
  if(MP.on)mpFollow(dt);
  const steps=dt>0.03?2:1;
  for(let k=0;k<steps;k++)for(const c of chars){if((c===player||(isAuth()&&c.kind==='bot'))&&!c.out)integrate(c,dt/steps)}
  separate();
  if(isAuth())judgeBots();
  if(MP.on){netT-=dt;if(netT<=0){netT=0.1;mpSend()}}
  playFx();sing(dt);
  drawChars(dt);drawDoll(dt);
  const fo=camFollow();if(fo){
    const want=new T3.Vector3(fo.x*0.5+DX*0.5,13.5,fo.z+6.5),look=new T3.Vector3(fo.x*0.5+DX*0.5,0,fo.z-9);   // дивимось уперед, на ляльку
    if(!camInit){camPos.copy(want);camLook.copy(look);camInit=true}
    camPos.lerp(want,Math.min(1,dt*5));camLook.lerp(look,Math.min(1,dt*6));camera.position.copy(camPos);
    if(shakeT>0&&!reduce){shakeT-=dt;camera.position.x+=(Math.random()-.5)*0.18;camera.position.y+=(Math.random()-.5)*0.1}
    camera.lookAt(camLook);sunFollow(fo.x,fo.z-4)}
  $('stun').style.opacity=player&&player.stun>0?Math.min(1,player.stun*1.4).toFixed(2):0;
  updHud();updButtons();
}
function camFollow(){
  if(player&&!player.gone&&!player.out)return player;
  // вибув — дивимось на найближчого до фінішу живого
  let best=null;for(const c of chars){if(c.gone||c.out||c.fin)continue;if(!best||c.z<best.z)best=c}
  return best||player||chars[0];
}
function drawDoll(dt){
  doll.rotation.y=dollYaw();
  const looking=DL.s==='r'||(DL.s==='t'&&dlProg()>0.6);
  doll.eyeM.color.set(looking?(Math.floor(T*8)%2?'#FF2A3C':'#FF6A78'):'#1D1A26');
  doll.head.rotation.z=DL.s==='g'&&!reduce?Math.sin(T*3.2)*0.1:0;   // гойдається в такт пісеньці
  flash=Math.max(0,flash-dt*2);
}

/* ---------- HUD ---------- */
let hudKey='';
function updHud(force){
  if(!G||!G.pl)return;const me=player,rem=G.ph==='play'?Math.max(0,G.rem/1000):G.ph==='intro'?ROUND_T:0,mm=Math.floor(rem/60),ss=Math.floor(rem%60);
  const ids=G.pl.concat(G.bots).sort((a,b)=>(G.sc[b]||0)-(G.sc[a]||0)).slice(0,4);
  const hidden=me&&!me.out&&!me.fin&&!seen(me.x,me.z);
  const lightS=!me?'':me.out?'out':me.fin?'fin':G.ph!=='play'?'':red()?(hidden?'hide':'stop'):'go';
  const key=[me?G.sc[me.id]||0:0,mm,ss,G.rd,G.fin.length,G.out.length,lightS,ids.map(id=>id+(G.sc[id]||0)).join(',')].join(':');if(key===hudKey&&!force)return;hudKey=key;
  $('meChip').textContent=me?'⭐ '+(G.sc[me.id]||0):'👁 Глядач';
  const tc=$('timeChip');tc.textContent=mm+':'+String(ss).padStart(2,'0');tc.classList.toggle('low',G.ph==='play'&&rem<15);
  $('zoneChip').textContent='Раунд '+G.rd+'/'+G.nr+' · 🏁 '+G.fin.length+(G.out.length?' · 💀 '+G.out.length:'');
  const L=$('light');L.hidden=!lightS;L.className='light '+lightS;
  L.textContent={go:'🟢 Біжи!',stop:'🔴 Завмри!',hide:'🫣 Сховався — можна',out:'💀 Вибув',fin:'🏁 Фініш!'}[lightS]||'';
  $('red').classList.toggle('on',G.ph==='play'&&red()&&!hidden&&!!me&&!me.out&&!me.fin);
  const bd=$('board');bd.innerHTML='';
  for(const id of ids){const li=document.createElement('li');if(me&&id===me.id)li.className='me';const d=document.createElement('i');d.style.background=PAL[(G.col[id]|0)%PAL.length];
    const s=document.createElement('span');s.textContent=nameOf(id)+' '+(G.sc[id]||0);li.append(d,s);bd.append(li)}
}
let btnKey='';
function updButtons(force){
  const p=player,live=p&&!p.out&&!p.fin&&(phase==='play'||phase==='intro');
  const key=[live,p?Math.ceil(p.cdP*5):0,p&&p.stun>0].join(':');if(key===btnKey&&!force)return;btnKey=key;
  pushB.hidden=!live;if(!live)return;
  pushB.style.setProperty('--cd',Math.round(p.cdP/PUSH_CD*100)+'%');$('pushTxt').textContent=p.stun>0?'💫':'Поштовх';
}
function say(text,cls){const el=$('say');el.textContent=text;el.className='say '+(cls||'');void el.offsetWidth;el.classList.add('show')}
function tip(t){const el=$('tip');el.textContent=t;el.hidden=false;el.classList.remove('fade');void el.offsetWidth;el.classList.add('fade')}
function pop(ch,text,color){pops.push({ch,text,color,t:0})}
function vib(ms){try{navigator.vibrate&&navigator.vibrate(ms)}catch(e){}}

/* ---------- накладка ---------- */
const FONT='"Baloo 2","Arial Rounded MT Bold",sans-serif';
function label(x,y,t,bg,fg='#fff'){fctx.font='800 13px '+FONT;const w=fctx.measureText(t).width+12;fctx.fillStyle=bg;fctx.beginPath();fctx.roundRect(x-w/2,y-10,w,19,9);fctx.fill();fctx.fillStyle=fg;fctx.textAlign='center';fctx.textBaseline='middle';fctx.fillText(t,x,y+1)}
function drawFx(dt){
  fctx.clearRect(0,0,W,H);
  const me=player;
  if(G&&phase!=='menu'){
    // лінія фінішу підписана
    const f=scr(DX,0.1,FIN);if(f.z<1&&f.y>0&&f.y<H)label(f.x,f.y,'🏁 ФІНІШ','rgba(232,69,60,.9)');
    for(const c of chars){if(c.gone)continue;const s=scr(c.x,c.out?0.7:1.55,c.z);if(s.z>1)continue;
      const t=(c===me?'Ти':c.nick||'?')+(c.out?' 💀':c.fin?' 🏁':'');label(s.x,s.y,t,c===me?'rgba(160,120,0,.85)':'rgba(20,18,26,.62)',c===me||c.out?'#fff':'#'+c.col.getHexString())}}
  for(const p of pops){p.t+=dt;if(p.t>1.2||p.ch.gone)continue;const s=scr(p.ch.x,1.85,p.ch.z);if(s.z>1)continue;const y=s.y-p.t*22,e=p.t<0.25?(1-Math.pow(1-p.t/0.25,3))*1.15:1;
    fctx.globalAlpha=p.t>0.9?Math.max(0,1-(p.t-0.9)/0.3):1;fctx.save();fctx.translate(s.x,y);fctx.scale(e,e);fctx.font='800 22px '+FONT;fctx.textAlign='center';fctx.textBaseline='middle';fctx.fillStyle='#fff';fctx.strokeStyle='rgba(0,0,0,.5)';fctx.lineWidth=4;fctx.strokeText(p.text,0,0);fctx.fillText(p.text,0,0);fctx.restore();fctx.globalAlpha=1}
  pops=pops.filter(p=>p.t<1.2);
  if(flash>0&&!reduce){fctx.fillStyle='rgba(255,40,60,'+(flash*0.25).toFixed(3)+')';fctx.fillRect(0,0,W,H)}
  if(joy&&joy.moved&&phase!=='end'&&phase!=='over'){const dx=joy.x-joy.sx,dy=joy.y-joy.sy,m=Math.hypot(dx,dy),k=m>55?55/m:1;
    fctx.fillStyle='rgba(255,255,255,.12)';fctx.strokeStyle='rgba(255,255,255,.45)';fctx.lineWidth=2;fctx.beginPath();fctx.arc(joy.sx,joy.sy,55,0,6.283);fctx.fill();fctx.stroke();
    fctx.fillStyle='rgba(255,255,255,.8)';fctx.beginPath();fctx.arc(joy.sx+dx*k,joy.sy+dy*k,22,0,6.283);fctx.fill()}
  for(const c of confetti){c.l-=dt;c.vy+=520*dt;c.x+=c.vx*dt;c.y+=c.vy*dt;c.r+=dt*8;fctx.globalAlpha=Math.min(1,c.l);fctx.fillStyle=c.c;fctx.save();fctx.translate(c.x,c.y);fctx.rotate(c.r);fctx.fillRect(-5,-3,10,6);fctx.restore()}
  confetti=confetti.filter(c=>c.l>0);fctx.globalAlpha=1;
}

/* ---------- меню ---------- */
onTap($('ovSolo'),()=>startSolo(+$('soloBots').value));
$('ovBtn').addEventListener('click',()=>{au();if(MP.on){if(MP.host&&MP.g&&MP.g.ph==='over'){MP.g=null;hostStartRound(true)}}else startSolo()});

/* ---------- мультиплеєр (як у «Цар гори»: вузол RTDB «redlight», хост веде G і ботів) ---------- */
const MP={on:false,avail:null,net:null,code:'',me:null,host:false,nick:'',color:0,g:null,round:-1,phKey:'',phEnd:0,mapSel:'auto',bots:2,nr:3,lastG:null};
try{MP.nick=localStorage.getItem('rl_nick')||localStorage.getItem('hill_nick')||localStorage.getItem('hns_nick')||'';MP.color=+(localStorage.getItem('rl_color')||localStorage.getItem('hill_color'))||Math.floor(Math.random()*PAL.length)}catch(e){}
(async()=>{const t=window.HNS_TRANSPORT;try{MP.avail=t&&await t.ready()?t:null}catch(e){MP.avail=null}$('mpOpen').disabled=!MP.avail;$('mpNote').hidden=!!MP.avail})();
const rcode=()=>Array.from({length:4},()=>'abcdefghjkmnpqrstuvwxyz'[Math.floor(Math.random()*23)]).join('');
function peersNow(){return MP.net?MP.net.peers():[]}
function presOf(id){const p=peersNow().find(p=>p.id===id);return p?p.presence:null}
function humans(){return peersNow().filter(p=>p.presence&&p.presence.n).sort((a,b)=>a.id<b.id?-1:1)}
function hostId(){const ps=humans();const hs=ps.filter(p=>p.presence.h).sort((a,b)=>(+a.presence.h-+b.presence.h)||(a.id<b.id?-1:1));return(hs[0]||ps[0]||{}).id}
const timerLeft=()=>Math.max(0,(MP.phEnd-performance.now())/1000);
{const s=$('mapSel');s.innerHTML='<option value="auto">По черзі</option>'+mapIds().map((mi,k)=>'<option value="'+k+'">'+HW.MAPS[mi].name+'</option>').join('')}
$('mpOpen').addEventListener('click',()=>{au();$('ov').hidden=true;$('mp').hidden=false;$('mpA').hidden=false;$('mpB').hidden=true;$('nick').value=MP.nick;$('colorBtn').style.background=PAL[MP.color%PAL.length];
  const h=(location.hash||'').replace('#','');if(/^[a-z]{4}$/.test(h))$('codeIn').value=h.toUpperCase();setTimeout(()=>$('nick').focus(),50)});
$('mpBack').addEventListener('click',()=>{$('mp').hidden=true;$('ov').hidden=false});
$('mpCreate').addEventListener('click',()=>mpJoin(rcode(),true));
$('mpJoinBtn').addEventListener('click',()=>{const c=($('codeIn').value||'').trim().toLowerCase();if(!/^[a-z]{4}$/.test(c)){$('mpErr').textContent='Код має 4 літери, наприклад KQRT.';$('mpErr').hidden=false;return}mpJoin(c)});
$('codeIn').addEventListener('keydown',e=>{if(e.key==='Enter')$('mpJoinBtn').click()});
$('colorBtn').addEventListener('click',()=>{MP.color=(MP.color+1)%PAL.length;$('colorBtn').style.background=PAL[MP.color];try{localStorage.setItem('rl_color',MP.color)}catch(e){}if(MP.net)MP.net.presence({c:MP.color})});
$('mpStart').addEventListener('click',()=>{if(!MP.host)return;MP.mapSel=$('mapSel').value;MP.bots=+$('botSel').value;MP.nr=+$('rdSel').value;MP.g=null;hostStartRound(true)});
$('mpQuit').addEventListener('click',mpLeave);$('ovLeave').addEventListener('click',mpLeave);
$('copyCode').addEventListener('click',()=>{const t=MP.code.toUpperCase();try{navigator.clipboard.writeText(t).then(()=>{$('copyCode').textContent='Скопійовано'},()=>{})}catch(e){}});
async function mpJoin(code,create){
  au();MP.nick=($('nick').value||'').trim().slice(0,14)||'Гравець';try{localStorage.setItem('rl_nick',MP.nick);localStorage.setItem('rl_color',MP.color)}catch(e){}
  $('mpErr').hidden=true;
  try{MP.net=await MP.avail.join(code)}catch(e){$('mpErr').textContent=e&&e.message==='full'?'Кімната повна (до 10).':'Не вдалося увійти в кімнату. Спробуй ще раз.';$('mpErr').hidden=false;return}
  MP.code=code;MP.on=true;MP.joinedAt=performance.now();MP.round=-1;MP.phKey='';MP.g=null;MP.lastG=null;REQ.ev=[];auth.last={};
  MP.net.presence({n:MP.nick,c:MP.color,h:create?Date.now():null});
  location.hash=code;$('roomCode').textContent=code.toUpperCase();$('mpA').hidden=true;$('mpB').hidden=false;
  phase='lobby';mpLobbyRender();   // G лишається заставочним, поки хост не почне
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
function hostStartRound(fresh){
  const all=humans();if(!all.length)return;
  const prev=fresh?null:MP.g,rd=prev?prev.rd+1:1,r=(MP.lastR||0)+1;MP.lastR=r;
  const ids=mapIds(),map=MP.mapSel==='auto'?ids[(rd-1)%ids.length]:ids[+MP.mapSel]||ids[0];
  let pl,bots,col,nm;
  if(prev){pl=prev.pl;bots=prev.bots;col=prev.col;nm=prev.nm}
  else{pl=[MP.me].concat(all.map(p=>p.id).filter(i=>i!==MP.me)).slice(0,10);const nb=Math.max(0,Math.min(MP.bots,10-pl.length));
    col={};const used=new Set();for(const id of pl){let c=((presOf(id)||{}).c|0)%PAL.length;while(used.has(c))c=(c+1)%PAL.length;used.add(c);col[id]=c}
    bots=[];nm={};let c=0;for(let i=0;i<nb;i++){const id='b'+i;bots.push(id);while(used.has(c%PAL.length))c++;col[id]=c%PAL.length;used.add(c%PAL.length);nm[id]=BOT_NAMES[i%BOT_NAMES.length]}}
  MP.g=newG(r,rd,prev?prev.nr:MP.nr,map,Math.floor(Math.random()*1e9),pl,bots,col,nm,prev?prev.sc:{});
  MP.hostEnd=performance.now()+4000;
}
function hostTick(dt){
  const g=MP.g;if(!g)return;G=g;
  const left=MP.hostEnd-performance.now(),at=ms=>{MP.hostEnd=performance.now()+ms};
  if(g.ph==='intro'&&left<=0){g.ph='play';g.k++;at(ROUND_T*1000);g.rem=ROUND_T*1000;setDl('g',rand(2200,3600))}
  else if(g.ph==='play'){hostEvents();g.rem=Math.max(0,left);dollTick(dt);
    for(const id of g.pl)if(!presOf(id)&&!done(id)){const c=chr(id);if(c)c.gone=true}checkEnd();if(g.ph==='play'&&left<=0)endRound('time')}
  else if(g.ph==='end'&&left<=0)hostStartRound(false);
  if(MP.g&&MP.g.ph!=='play')MP.g.rem=Math.max(0,MP.hostEnd-performance.now());
}
function mpTick(dt){
  const hid=hostId();
  if(!MP.me){const mine=peersNow().find(p=>p.isMe);if(mine)MP.me=mine.id}
  MP.host=hid===MP.me&&!!MP.me;
  {const myp=presOf(MP.me);if(myp){if(MP.host&&!myp.h&&performance.now()-MP.joinedAt>1500)MP.net.presence({h:Date.now()});else if(!MP.host&&myp.h&&humans().some(p=>p.id!==MP.me&&p.presence.h&&+p.presence.h<+myp.h))MP.net.presence({h:null})}}
  if(MP.host){if(!MP.g&&MP.lastG){MP.g=JSON.parse(JSON.stringify(MP.lastG));MP.g.k++;MP.hostEnd=performance.now()+Math.max(1000,MP.lastG.rem);MP.lastR=MP.g.r;
      auth.last={};for(const p of peersNow()){const ev=(p.presence||{}).ev;if(Array.isArray(ev)&&ev.length)auth.last[p.id]=ev[ev.length-1][0]}}
    hostTick(dt)}
  const g=MP.host?MP.g:(presOf(hid)||{}).g;
  if(!MP.host&&g)MP.lastG=g;
  if(phase==='lobby'&&Math.floor(T*4)!==MP.lr){MP.lr=Math.floor(T*4);mpLobbyRender()}
  if(!g||!g.pl)return;
  if(g.r!==MP.round){MP.round=g.r;REQ.ev=[];G=g;setupRound(g);lastKey='';camInit=false}
  G=g;for(const k of['out','fin','fx','pl','bots'])if(!G[k])G[k]=[];if(!G.sc)G.sc={};if(!G.rs)G.rs={};
  if(!MP.host){for(const id of G.out){const c=chr(id);if(c)c.out=true}for(const id of G.fin){const c=chr(id);if(c)c.fin=true}}
  const key=g.r+':'+g.k;if(key!==MP.phKey){MP.phKey=key;MP.phEnd=performance.now()+g.rem}
  if(!MP.host&&g.ph==='play')g.rem=timerLeft()*1000;
  if(g.ph==='intro'){const n=Math.ceil(timerLeft());if(n!==MP.lastN&&n>0&&n<=3){MP.lastN=n;say(String(n),'num');SFX.beep()}}
  syncPhase();
}
const B64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',B64I={};for(let i=0;i<64;i++)B64I[B64[i]]=i;
const stOf=c=>(c.stun>0?ST.stun:0)|(c.pushT>0?ST.push:0);
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
function setTarget(c,x,z,y,st){if(Math.hypot(x-c.x,z-c.z)>4){c.x=x;c.z=z}c.fx0=c.x;c.fz0=c.z;c.tx=x;c.tz=z;c.tyaw=y;c.it=0;c.stun=st&ST.stun?0.2:0;c.pushT=st&ST.push?0.2:0}
function mpSend(){
  const o={ev:REQ.ev};const me=player;
  if(me&&G&&G.r===MP.round){o.x=+me.x.toFixed(2);o.z=+me.z.toFixed(2);o.y=+me.yaw.toFixed(2);o.s=stOf(me)}
  if(MP.host&&MP.g){o.g=MP.g;o.bs=encBots()}else{o.g=null;o.bs=null}
  MP.net.presence(o);
}

/* ---------- заставка: боти грають самі ---------- */
const MENU_TEXT=$('ovText').textContent;
function resetMenu(){$('ov').hidden=false;$('ovTitle').textContent='Тихо-голосно';$('ovTitle').className='';$('ovText').textContent=MENU_TEXT;$('scoreList').hidden=true;$('ovHint').hidden=false;$('soloBox').hidden=false;$('ovBtn').hidden=true;$('mpOpen').hidden=false;$('mpNote').hidden=!!MP.avail;$('ovLeave').hidden=true}
function bootScene(){
  phase='menu';const seed=777,ids=mapIds();
  const col={},nm={},bots=[];for(let i=0;i<7;i++){const id='b'+i;bots.push(id);col[id]=i;nm[id]=BOT_NAMES[i]}
  G=newG(0,1,1,ids[0],seed,[],bots,col,nm,{});setupRound(G);world.seed=null;G.ph='play';G.rem=ROUND_T*1000;setDl('g',2500);
  pushB.hidden=true;$('light').hidden=true;
}
function menuScene(dt){T+=dt;pathBudget=3;dlLocal();dollTick(dt);
  if(!alive().length||G.rem<=0){G.out=[];G.fin=[];setupRound(G);G.rem=ROUND_T*1000}G.rem-=dt*1000;
  for(const c of chars){timers(c,dt);botThink(c,dt)}for(const c of chars)if(!c.out)integrate(c,dt);separate();judgeBots();playFx();drawChars(dt);drawDoll(dt);
  const cz=world.H*0.55+Math.sin(T*0.1)*6;camera.position.set(DX+Math.sin(T*0.13)*2,13,cz+9);camera.lookAt(DX,0,cz-3);sunFollow(DX,cz)}
bootScene();
let last=performance.now();
function frame(now){const dt=Math.min(0.1,(now-last)/1000);last=now;
  if(phase==='lobby'){T+=dt;mpTick(dt)}
  if(phase==='menu'||phase==='lobby')menuScene(dt);
  else update(dt);
  renderer.render(scene,camera);drawFx(dt);requestAnimationFrame(frame)}
requestAnimationFrame(frame);

/* для автотестів (bots/local-sim/redlight-test.js) */
window.RLGame={get phase(){return phase},get G(){return G},get player(){return player},get chars(){return chars},get MP(){return MP},get world(){return world},get DL(){return DL},
  startSolo,sim:s=>{for(let t=0;t<s;t+=1/30)update(1/30)},doPush,pushTarget,seen,keys,chr,setDl:(s,ms)=>setDl(s,ms),get FIN(){return FIN},get START(){return START},get MAPIDS(){return mapIds()},buildWorld,push:(a,b)=>applyPush(a,b)};
})();
