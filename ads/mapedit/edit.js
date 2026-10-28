/* Редактор карт: малюєш зверху (стіни, кімнати, меблі, старт), перевірка прохідності тим самим кодом, що в іграх,
   і «▶ Тест» — аватар у 3D на тій самій карті з тією самою колізією. Публікація — у RTDB /maps/{світ}_{id},
   ігри підтягують через ../maps-remote.js. Світ «hns» — Хованки, Монстр, Агенти; «ph» — Перевтілення. */
(function(){
const $=id=>document.getElementById(id),T3=THREE;
const WORLDS={
  hns:{HW:window.HW_HNS,label:'Хованки · Монстр · Агенти · Цар гори',games:{khovanky:'Хованки',monster:'Монстр',agents:'Агенти',hill:'Цар гори'}},
  ph:{HW:window.HW_PH,label:'Перевтілення',games:{perevtilennia:'Перевтілення'}}};
const SLOT='__edit';
const NAMES={counter:'Прилавок',fridge:'Холодильник',table:'Стіл',chair:'Стілець',sofa:'Диван',armchair:'Крісло',coffee:'Журнальний столик',tvstand:'Тумба з ТВ',bookshelf:'Книжкова шафа',
  plant:'Рослина',lamp:'Торшер',rug:'Килим',bed:'Ліжко',nightstand:'Тумбочка',wardrobe:'Шафа',bench:'Лавка',shoecab:'Взуттєва шафка',bathtub:'Ванна',toilet:'Унітаз',sink:'Раковина',
  washer:'Пральна машина',tallcab:'Висока шафа',bunk:'Двоярусне ліжко',tent:'Намет',toybox:'Скриня з іграшками',ball:'Мʼяч',desk:'Письмовий стіл',shelf:'Стелаж',fridgewall:'Холодильна стіна',
  freezer:'Морозильник',fruit:'Фрукти',checkout:'Каса',cart:'Візок',pallet:'Палета',boxes:'Коробки',cooler:'Кулер',cafetable:'Столик кафе',bin:'Смітник',stool:'Табурет',vase:'Ваза',books:'Книги',crate:'Ящик'};
const EMO={counter:'🧾',fridge:'🧊',table:'🍽',chair:'🪑',sofa:'🛋',armchair:'💺',coffee:'☕',tvstand:'📺',bookshelf:'📚',plant:'🪴',lamp:'💡',rug:'🟫',bed:'🛏',nightstand:'🗄',wardrobe:'🚪',bench:'🪵',
  shoecab:'👟',bathtub:'🛁',toilet:'🚽',sink:'🚰',washer:'🫧',tallcab:'🗄',bunk:'🛏',tent:'⛺',toybox:'🧸',ball:'⚽',desk:'🖥',shelf:'🛒',fridgewall:'🧊',freezer:'❄',fruit:'🍎',checkout:'🧾',cart:'🛒',
  pallet:'📦',boxes:'📦',cooler:'💧',cafetable:'☕',bin:'🗑',stool:'🪑',vase:'🏺',books:'📖',crate:'📦'};
const SMALLD={chair:[0.46,0.44],plant:[0.5,0.5],lamp:[0.36,0.36],ball:[0.44,0.44],cooler:[0.42,0.42],cafetable:[0.82,0.82],bin:[0.42,0.42],stool:[0.42,0.42],vase:[0.34,0.34],books:[0.4,0.32],crate:[0.62,0.62]};
const RESIZE={counter:1,table:1,sofa:1,rug:1,bench:1,bed:1,wardrobe:1,tallcab:1,bookshelf:1,desk:1,shelf:1,fridgewall:1,freezer:1,fruit:1,checkout:1,pallet:1,boxes:1,tvstand:1,shoecab:1,bathtub:1,bunk:1,tent:1,coffee:1,nightstand:1,toybox:1,sink:1,washer:1,fridge:1,armchair:1,toilet:1,cart:1};
const PAT={tile:'Плитка',wood:'Дошки',carpet:'Ковролін'};

/* шаблони меблів — перше використання кожного типу у вбудованих картах */
const TPL={hns:{},ph:{}};
for(const w of['hns','ph'])for(const m of WORLDS[w].HW.MAPS)for(const f of m.furn){if(TPL[w][f.t])continue;const o=Object.assign({},f);delete o.x;delete o.z;delete o.r;TPL[w][f.t]=o}
const BUILTIN={hns:{},ph:{}};for(const w of['hns','ph'])for(const m of WORLDS[w].HW.MAPS)BUILTIN[w][m.id]=JSON.parse(JSON.stringify(m));

/* ---------- стан ---------- */
let D=null,remote={},tool='pan',room='',ftype='chair',sel=-1,undoS=[],redoS=[],dirty=false,check={issues:[],bad:null,warn:null,nav:null,res:null};
const view={s:24,ox:0,oy:0};
const cv=$('cv'),ctx=cv.getContext('2d');let W,H,DPR;
function resize(){W=innerWidth;H=innerHeight;DPR=Math.min(2,devicePixelRatio||1);cv.width=W*DPR;cv.height=H*DPR;ctx.setTransform(DPR,0,0,DPR,0,0);draw()}
addEventListener('resize',resize);
function toast(t,ms=2200){const el=$('toast');el.textContent=t;el.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>el.hidden=true,ms)}
const clone=o=>JSON.parse(JSON.stringify(o));
const HWc=()=>WORLDS[D.world].HW;
const MW=()=>D.rows[0].length,MH=()=>D.rows.length;

function fromDef(world,def,remoteData){
  const src=remoteData||def;
  return{world,id:def.id,name:src.name||def.name||'Карта',rows:src.rows.map(r=>r.split('')),floor:clone(src.floor),furn:clone(src.furn),rooms:clone(src.rooms||guessRooms(src)),spawn:src.spawn.slice(),
    grass:src.grass||'#8FCB72',noHide:src.noHide||'',games:(remoteData&&remoteData.games)||(def.custom?[]:null),builtin:!!BUILTIN[world][def.id]}
}
/* назви кімнат вбудованих карт (у самих картах їх нема, лише в коментарях) */
const ROOM_NAMES={house:WORLDS.hns.HW.ROOMS||{},market:{w:'Склад',o:'Офіс',c:'Кафе',m:'Торговий зал',e:'Каси'},
  school:{c:'Клас',l:'Бібліотека',v:'Вчительська',h:'Коридор',g:'Спортзал',f:'Їдальня',a:'Медпункт'},dacha:{y:'Сад',p:'Теплиця',u:'Сарай',r:'Веранда',n:'Спальня',k:'Кухня'},
  office:{o:'Опенспейс',m:'Переговорна',h:'Коридор',k:'Кухня',b:'Кабінет шефа',s:'Склад'},camp:{a:'«Ромашка»',c:'Їдальня',d:'Душові',y:'Подвірʼя',b:'«Волошка»',s:'Комора',g:'Ігрова'},
  hospital:{r:'Реєстратура',w:'Палата 1',v:'Палата 2',h:'Коридор',o:'Рентген',p:'Аптека',s:'Ординаторська'},mall:{g:'Іграшки',n:'Книгарня',c:'Кавʼярня',l:'Декор',a:'Атріум',w:'Супермаркет',b:'Меблі',u:'Склад'}};
function guessRooms(m){const o={},R=ROOM_NAMES[m.id]||{};for(const ch in m.floor)o[ch]=R[ch]||('Кімната '+ch.toUpperCase());return o}
function newMap(world){
  const w=24,h=18,rows=[];for(let z=0;z<h;z++){const r=[];for(let x=0;x<w;x++)r.push(z===0||x===0||z===h-1||x===w-1?'#':'a');rows.push(r)}
  D={world,id:'u'+Date.now().toString(36),name:'Нова карта',rows,floor:{a:['#DDBA90','#D3AE83','wood']},furn:[],rooms:{a:'Кімната'},spawn:[w/2,h/2],grass:'#8FCB72',noHide:'',games:Object.keys(WORLDS[world].games),builtin:false};
  afterLoad();
}
function openMap(world,id){
  const key=world+'_'+id,def=WORLDS[world].HW.MAPS.find(m=>m.id===id)||null,r=remote[key];
  if(!def&&!r)return;
  const draft=loadDraft(key);
  if(draft){D=draft;toast('Відновлено незбережену чернетку')}
  else D=fromDef(world,def||r,r);
  if(!def)D.builtin=false;
  afterLoad();
}
function afterLoad(){room=Object.keys(D.floor)[0];sel=-1;undoS=[];redoS=[];dirty=false;fit();updUI();runCheck(true);try{localStorage.setItem('mapedit_last',D.world+'_'+D.id)}catch(e){}}
function fit(){const s=Math.min((W-20)/MW(),(H-200)/MH());view.s=Math.max(6,s);view.ox=(W-MW()*view.s)/2;view.oy=70+(H-200-MH()*view.s)/2}
function saveDraft(){try{localStorage.setItem('mapedit_d_'+D.world+'_'+D.id,JSON.stringify(D))}catch(e){}}
function loadDraft(k){try{const d=JSON.parse(localStorage.getItem('mapedit_d_'+k)||'null');return d&&d.rows?d:null}catch(e){return null}}
function dropDraft(){try{localStorage.removeItem('mapedit_d_'+D.world+'_'+D.id)}catch(e){}}

/* ---------- скасування ---------- */
const snap0=()=>JSON.stringify({rows:D.rows,floor:D.floor,furn:D.furn,rooms:D.rooms,spawn:D.spawn,noHide:D.noHide});
let pendingSnap=null;
function begin(){pendingSnap=snap0()}
function commit(){if(pendingSnap===null)return;const now=snap0();if(now!==pendingSnap){undoS.push(pendingSnap);if(undoS.length>60)undoS.shift();redoS=[];changed()}pendingSnap=null}
function restore(s){const o=JSON.parse(s);Object.assign(D,o);sel=-1;changed()}
$('undo').addEventListener('click',()=>{if(!undoS.length)return;redoS.push(snap0());restore(undoS.pop())});
$('redo').addEventListener('click',()=>{if(!redoS.length)return;undoS.push(snap0());restore(redoS.pop())});
function changed(){dirty=true;saveDraft();updUI();draw();clearTimeout(changed.t);changed.t=setTimeout(()=>runCheck(),350)}

/* ---------- карта → формат ігор ---------- */
function defOf(){
  return{id:SLOT,name:D.name,rows:D.rows.map(r=>r.join('')),floor:D.floor,furn:D.furn,grass:D.grass,spawn:D.spawn,noHide:D.noHide,waypoints:[D.spawn],rooms:D.rooms};
}
function slotIndex(){const HW=HWc();let i=HW.MAPS.findIndex(m=>m.id===SLOT);if(i<0){HW.MAPS.push(defOf());i=HW.MAPS.length-1}else HW.MAPS[i]=Object.assign(HW.MAPS[i],defOf());return i}
function buildNow(){const HW=HWc(),i=slotIndex();const res=HW.build(null,{map:i});HW.MAPS.splice(i,1);return res}

/* ---------- перевірка: досяжність, щілини, перекриті двері, старт ---------- */
function runCheck(force){
  if(!D)return;let res;try{res=buildNow()}catch(e){check={issues:[{e:1,t:'Карта не збирається: '+e.message}],bad:null,warn:null,nav:null,res:null};updStat();draw();return}
  const HW=HWc(),nav=HW.walkGrid(res.boxes,0.3),CS=HW.CS,nx=nav.nx,nz=nav.nz,issues=[];
  const ci=(x,z)=>Math.max(0,Math.min(nz-1,Math.floor(z/CS)))*nx+Math.max(0,Math.min(nx-1,Math.floor(x/CS)));
  let s=ci(D.spawn[0],D.spawn[1]);
  if(!nav.free[s]){issues.push({e:1,t:'Старт 📍 у стіні чи в меблях',x:D.spawn[0],z:D.spawn[1]});
    // шукаємо найближчу вільну, щоб перевірити решту
    let bd=1e9;for(let i=0;i<nav.free.length;i++)if(nav.free[i]){const x=(i%nx+.5)*CS,z=(Math.floor(i/nx)+.5)*CS,d=Math.hypot(x-D.spawn[0],z-D.spawn[1]);if(d<bd){bd=d;s=i}}}
  const seen=new Uint8Array(nav.free.length),q=[s];seen[s]=1;
  for(let h=0;h<q.length;h++){const c=q[h],x=c%nx,z=Math.floor(c/nx);for(const [dx,dz] of[[1,0],[-1,0],[0,1],[0,-1]]){const X=x+dx,Z=z+dz;if(X<0||Z<0||X>=nx||Z>=nz)continue;const n=Z*nx+X;if(nav.free[n]&&!seen[n]){seen[n]=1;q.push(n)}}}
  const bad=new Uint8Array(MW()*MH()),warn=new Uint8Array(MW()*MH());
  // недосяжне — по кімнатах
  const lost={};
  for(let i=0;i<nav.free.length;i++)if(nav.free[i]&&!seen[i]){const x=(i%nx+.5)*CS,z=(Math.floor(i/nx)+.5)*CS,tx=Math.floor(x),tz=Math.floor(z);bad[tz*MW()+tx]=1;const ch=D.rows[tz][tx];(lost[ch]=lost[ch]||{n:0,x,z}).n++}
  for(const ch in lost)issues.push({e:1,t:'«'+(D.rooms[ch]||ch)+'»: недосяжно ≈'+Math.max(1,Math.round(lost[ch].n*CS*CS))+' м²',x:lost[ch].x,z:lost[ch].z});
  // двері: проріз у стіні (1–5 клітинок, з обох боків стіна, спереду й ззаду підлога)
  const wall=(x,z)=>!D.rows[z]||D.rows[z][x]===undefined||D.rows[z][x]==='#',mw=MW();
  const tileFree=(tx,tz)=>{let n=0;for(let j=0;j<2;j++)for(let i=0;i<2;i++)if(nav.free[(tz*2+j)*nx+tx*2+i])n++;return n};
  const doorsL=[],used=new Uint8Array(mw*MH());
  for(let tz=1;tz<MH()-1;tz++)for(let tx=1;tx<mw-1;tx++){if(wall(tx,tz)||used[tz*mw+tx])continue;
    for(const [dx,dz] of[[1,0],[0,1]]){// уздовж стіни (dx,dz), поперек — (dz,dx)
      if(!wall(tx-dx,tz-dz))continue;let n=0;while(n<6&&!wall(tx+dx*n,tz+dz*n))n++;if(n>5||!wall(tx+dx*n,tz+dz*n))continue;
      // кожна клітинка прорізу — з підлогою з обох боків; стіна до і після прорізу тонка (з обох боків підлога), інакше це переріз коридору
      let ok=true;for(let k=0;k<n;k++){const x=tx+dx*k,z=tz+dz*k;if(wall(x+dz,z+dx)||wall(x-dz,z-dx))ok=false}
      const ex=tx+dx*n,ez=tz+dz*n;if(!ok||wall(tx-dx+dz,tz-dz+dx)||wall(tx-dx-dz,tz-dz-dx)||wall(ex+dz,ez+dx)||wall(ex-dz,ez-dx))continue;
      const cells=[];for(let k=0;k<n;k++){cells.push([tx+dx*k,tz+dz*k]);used[(tz+dz*k)*mw+tx+dx*k]=1}doorsL.push(cells);break}}
  let doorsBad=0,doorsNarrow=0,d0=null,n0=null;
  for(const dr of doorsL){const fr=dr.map(([x,z])=>tileFree(x,z));const tot=fr.reduce((a,b)=>a+b,0);
    if(!tot){doorsBad++;for(const [x,z] of dr)bad[z*mw+x]=1;if(!d0)d0={x:dr[0][0]+.5,z:dr[0][1]+.5}}
    else if(dr.length>=2&&fr.filter(v=>v).length<Math.min(2,dr.length)){doorsNarrow++;for(const [x,z] of dr)if(!tileFree(x,z))warn[z*mw+x]=1;if(!n0)n0={x:dr[0][0]+.5,z:dr[0][1]+.5}}}
  if(doorsBad)issues.push({e:1,t:'Двері перекриті меблями: '+doorsBad,x:d0.x,z:d0.z});
  if(doorsNarrow)issues.push({e:0,t:'Двері звужені до однієї клітинки: '+doorsNarrow,x:n0.x,z:n0.z});
  // щілини: точка не в меблях, але між двома перешкодами з різних боків прохід вужчий за персонажа — виглядає прохідним, а не пускає
  let gaps=0,g0=null;const R=0.3,inBox=(x,z)=>res.boxes.some(b=>x>b[0]&&x<b[2]&&z>b[1]&&z<b[3]);
  for(let i=0;i<nav.free.length;i++){if(nav.free[i])continue;const x=(i%nx+.5)*CS,z=(Math.floor(i/nx)+.5)*CS;if(inBox(x,z)||wall(Math.floor(x),Math.floor(z)))continue;
    const near=[];for(const b of res.boxes){const cx=Math.max(b[0],Math.min(x,b[2])),cz=Math.max(b[1],Math.min(z,b[3])),d=Math.hypot(x-cx,z-cz);if(d<R+0.02)near.push([cx-x,cz-z,d])}
    let gap=false;for(let a=0;a<near.length&&!gap;a++)for(let c=a+1;c<near.length;c++){const A=near[a],B=near[c],dot=(A[0]*B[0]+A[1]*B[1])/((A[2]||1e-6)*(B[2]||1e-6));if(dot<-0.6&&A[2]+B[2]>0.12){gap=true;break}}
    if(gap){const tx=Math.floor(x),tz=Math.floor(z);if(!warn[tz*mw+tx]){warn[tz*mw+tx]=1;gaps++;if(!g0)g0={x,z}}}}
  if(gaps)issues.push({e:0,t:'Щілини, що виглядають як прохід, але не пускають: '+gaps,x:g0.x,z:g0.z});
  // меблі глибоко в стіні
  const wallB=res.boxes.filter(b=>!res.blockers.some(f=>f.b===b));let inWall=0,w0=null;
  for(const f of res.blockers){const b=f.b;for(const w of wallB){const ox=Math.min(b[2],w[2])-Math.max(b[0],w[0]),oz=Math.min(b[3],w[3])-Math.max(b[1],w[1]);if(ox>0.12&&oz>0.12){inWall++;if(!w0)w0={x:(b[0]+b[2])/2,z:(b[1]+b[3])/2};break}}}
  if(inWall)issues.push({e:0,t:'Меблі заходять у стіну: '+inWall,x:w0.x,z:w0.z});
  // кімнати без підлоги в рядках (зайві записи) — тихо прибираємо
  check={issues,bad,warn,nav,res,seen};updStat();draw();
}
function updStat(){const st=$('stat'),e=check.issues.filter(i=>i.e).length,w=check.issues.length-e;
  st.className='ib '+(e?'bad':w?'warn':'ok');st.textContent=e?'⛔ '+e+(w?' · ⚠ '+w:''):w?'⚠ '+w:'✓';st.setAttribute('aria-label',e||w?'Проблем: '+(e+w):'Проблем немає')}
$('stat').addEventListener('click',()=>{
  const c=sheet('<h2>Перевірка</h2><p>Те саме, що бачать боти й гравці: червоне — недосяжне або перекрите, жовте — щілини, що виглядають як прохід.</p><div class="issues" id="iss"></div><button class="btn sec" id="xClose" type="button">Закрити</button>');
  const box=c.querySelector('#iss');if(!check.issues.length)box.innerHTML='<p>✓ Усе прохідне.</p>';
  check.issues.forEach(it=>{const b=document.createElement('button');b.className=it.e?'e':'w';b.textContent=it.t;b.type='button';b.onclick=()=>{closeSheet();if(it.x!=null){view.s=Math.max(view.s,30);view.ox=W/2-it.x*view.s;view.oy=H/2-it.z*view.s;draw()}};box.append(b)});
  c.querySelector('#xClose').onclick=closeSheet});

/* ---------- малювання ---------- */
function shade(hex,k){return WORLDS.hns.HW.shade(hex,k)}
const TCOL={rug:'#C9B79C',plant:'#4E9B4E',bed:'#F2A0B4',sofa:'#6F8FD8',shelf:'#E7E2D6',counter:'#F6F2EA',fridge:'#E9EEF2',tallcab:'#9FC7B6',wardrobe:'#C99A6B',bookshelf:'#A8794F',
  toilet:'#FFFFFF',bathtub:'#FFFFFF',sink:'#FFFFFF',desk:'#D9B48A',table:'#D9B48A',cafetable:'#FFFFFF',chair:'#7FB7A4',bench:'#9A6B45',checkout:'#5B6F8C',cart:'#B9C2CB',pallet:'#C8A26E',boxes:'#C8A26E',crate:'#C8A26E'};
function fp(f){const s=SMALLD[f.t];let w=s?s[0]:f.w||0.6,d=s?s[1]:f.d||0.6;if((f.r||0)%2)[w,d]=[d,w];return[w,d]}
const sx=x=>view.ox+x*view.s,sy=z=>view.oy+z*view.s;
function draw(){
  if(!D)return;ctx.fillStyle=D.grass;ctx.fillRect(0,0,W,H);
  const s=view.s,mw=MW(),mh=MH();
  for(let z=0;z<mh;z++)for(let x=0;x<mw;x++){const ch=D.rows[z][x],X=sx(x),Y=sy(z);if(X>W||Y>H||X+s<0||Y+s<0)continue;
    if(ch==='#'){ctx.fillStyle='#6B5646';ctx.fillRect(X,Y,s+0.5,s+0.5);continue}
    const F=D.floor[ch]||['#FF00FF','#FF00FF','tile'];ctx.fillStyle=F[2]==='tile'?((x+z)%2?F[0]:F[1]):F[2]==='wood'?((x+(z%2)*0.5|0)%2?F[0]:F[1]):F[0];ctx.fillRect(X,Y,s+0.5,s+0.5);
    if(check.bad&&check.bad[z*mw+x]){ctx.fillStyle='rgba(255,40,40,.45)';ctx.fillRect(X,Y,s,s)}else if(check.warn&&check.warn[z*mw+x]){ctx.fillStyle='rgba(255,181,71,.55)';ctx.fillRect(X,Y,s,s)}}
  if(s>14){ctx.strokeStyle='rgba(0,0,0,.08)';ctx.lineWidth=1;ctx.beginPath();for(let x=0;x<=mw;x++){ctx.moveTo(sx(x),sy(0));ctx.lineTo(sx(x),sy(mh))}for(let z=0;z<=mh;z++){ctx.moveTo(sx(0),sy(z));ctx.lineTo(sx(mw),sy(z))}ctx.stroke()}
  // меблі: килими знизу
  const order=D.furn.map((f,i)=>i).sort((a,b)=>(D.furn[b].flat?1:0)-(D.furn[a].flat?1:0));
  for(const i of order){const f=D.furn[i],[w,d]=fp(f),X=sx(f.x-w/2),Y=sy(f.z-d/2);
    ctx.globalAlpha=f.flat?0.55:0.95;ctx.fillStyle=f.c||TCOL[f.t]||'#B08968';ctx.fillRect(X,Y,w*s,d*s);ctx.globalAlpha=1;
    ctx.strokeStyle=i===sel?'#3DD6C3':f.tall?'#2A1F18':'rgba(0,0,0,.45)';ctx.lineWidth=i===sel?3:f.tall?2.5:1;ctx.strokeRect(X,Y,w*s,d*s);
    // перед меблів (куди дивиться стілець, де відчиняється шафа) — біла риска
    if(!f.flat){const r=(f.r||0)%4,fx=[0,1,0,-1][r],fz=[1,0,-1,0][r];ctx.strokeStyle='rgba(255,255,255,.9)';ctx.lineWidth=Math.max(2,s*0.08);ctx.beginPath();
      if(fz){const yy=sy(f.z+fz*d/2);ctx.moveTo(sx(f.x-w*0.35),yy);ctx.lineTo(sx(f.x+w*0.35),yy)}else{const xx=sx(f.x+fx*w/2);ctx.moveTo(xx,sy(f.z-d*0.35));ctx.lineTo(xx,sy(f.z+d*0.35))}ctx.stroke()}
    if(s>18&&!f.flat){ctx.font=Math.min(s*0.55,18)+'px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(EMO[f.t]||'▪',sx(f.x),sy(f.z))}}
  // назви кімнат
  if(s>10){const acc={};for(let z=0;z<mh;z++)for(let x=0;x<mw;x++){const ch=D.rows[z][x];if(ch==='#')continue;const a=acc[ch]||(acc[ch]={x:0,z:0,n:0});a.x+=x+.5;a.z+=z+.5;a.n++}
    ctx.font='700 '+Math.min(16,s*0.5)+'px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
    for(const ch in acc){const a=acc[ch],t=(D.rooms[ch]||ch)+(D.noHide.includes(ch)?' ⊘':'');ctx.fillStyle='rgba(0,0,0,.45)';const tw=ctx.measureText(t).width+10;ctx.fillRect(sx(a.x/a.n)-tw/2,sy(a.z/a.n)-10,tw,20);ctx.fillStyle='#fff';ctx.fillText(t,sx(a.x/a.n),sy(a.z/a.n))}}
  // старт
  const px=sx(D.spawn[0]),py=sy(D.spawn[1]);ctx.fillStyle='#4CC97A';ctx.beginPath();ctx.arc(px,py-10,9,0,6.283);ctx.fill();ctx.beginPath();ctx.moveTo(px-6,py-6);ctx.lineTo(px,py+2);ctx.lineTo(px+6,py-6);ctx.fill();
  ctx.fillStyle='#04201C';ctx.font='800 11px system-ui';ctx.fillText('S',px,py-10);
}

/* ---------- дотики: один палець — інструмент, два — зсув і масштаб ---------- */
const ptrs=new Map();let gest=null;
const toMap=(x,y)=>[(x-view.ox)/view.s,(y-view.oy)/view.s];
const snap05=v=>Math.round(v*20)/20;
function furnAt(x,z){for(let k=D.furn.length-1;k>=0;k--){const f=D.furn[k];if(f.flat)continue;const [w,d]=fp(f);if(Math.abs(x-f.x)<=w/2+0.08&&Math.abs(z-f.z)<=d/2+0.08)return k}
  for(let k=D.furn.length-1;k>=0;k--){const f=D.furn[k];if(!f.flat)continue;const [w,d]=fp(f);if(Math.abs(x-f.x)<=w/2&&Math.abs(z-f.z)<=d/2)return k}return-1}
function paint(x,z){const tx=Math.floor(x),tz=Math.floor(z);if(tx<0||tz<0||tx>=MW()||tz>=MH())return;const ch=tool==='wall'?'#':room;if(D.rows[tz][tx]!==ch){D.rows[tz][tx]=ch;draw()}}
function line(a,b,fn){const n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/0.3));for(let k=0;k<=n;k++)fn(a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n)}
cv.addEventListener('pointerdown',e=>{cv.setPointerCapture(e.pointerId);ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(ptrs.size===2){if(gest&&gest.kind!=='pinch'&&pendingSnap!==null){const o=JSON.parse(pendingSnap);Object.assign(D,o);pendingSnap=null;sel=-1;updUI();draw()}const [a,b]=[...ptrs.values()];gest={kind:'pinch',d:Math.hypot(a.x-b.x,a.y-b.y),cx:(a.x+b.x)/2,cy:(a.y+b.y)/2,s:view.s,ox:view.ox,oy:view.oy};return}
  if(ptrs.size>2)return;
  const [x,z]=toMap(e.clientX,e.clientY);gest={kind:'none',sx:e.clientX,sy:e.clientY,last:[x,z],t:e.timeStamp,moved:false};
  if(tool==='wall'||tool==='floor'){if(tool==='floor'&&!room)return;begin();gest.kind='paint';gest.began=true;paint(x,z)}
  else if(tool==='pan'||tool==='furn'){const k=furnAt(x,z);if(k>=0){sel=k;begin();gest.kind='move';gest.off=[D.furn[k].x-x,D.furn[k].z-z];updUI();draw()}else gest.kind=tool==='pan'?'pan':'place'}
  else if(tool==='erase'){begin();gest.kind='erase';const k=furnAt(x,z);if(k>=0){D.furn.splice(k,1);sel=-1;draw()}}
  else if(tool==='spawn'){begin();D.spawn=[snap05(x),snap05(z)];gest.kind='spawn';draw()}
});
cv.addEventListener('pointermove',e=>{if(!ptrs.has(e.pointerId))return;ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});if(!gest)return;
  if(gest.kind==='pinch'&&ptrs.size>=2){const [a,b]=[...ptrs.values()],d=Math.hypot(a.x-b.x,a.y-b.y),cx=(a.x+b.x)/2,cy=(a.y+b.y)/2,k=Math.max(4,Math.min(90,gest.s*d/gest.d))/gest.s;
    view.s=gest.s*k;view.ox=cx-(gest.cx-gest.ox)*k;view.oy=cy-(gest.cy-gest.oy)*k;draw();return}
  const [x,z]=toMap(e.clientX,e.clientY);if(Math.hypot(e.clientX-gest.sx,e.clientY-gest.sy)>8)gest.moved=true;
  if(gest.kind==='paint'){line(gest.last,[x,z],paint);gest.last=[x,z]}
  else if(gest.kind==='pan'){if(gest.moved){view.ox+=e.clientX-(gest.px||gest.sx);view.oy+=e.clientY-(gest.py||gest.sy);gest.px=e.clientX;gest.py=e.clientY;draw()}}
  else if(gest.kind==='move'&&gest.moved){const f=D.furn[sel];f.x=snap05(x+gest.off[0]);f.z=snap05(z+gest.off[1]);draw()}
  else if(gest.kind==='erase'){const k=furnAt(x,z);if(k>=0){D.furn.splice(k,1);draw()}}
  else if(gest.kind==='spawn'){D.spawn=[snap05(x),snap05(z)];draw()}
  else if(gest.kind==='place'&&gest.moved){gest.kind='pan';gest.px=gest.sx;gest.py=gest.sy}
});
const up=e=>{if(!ptrs.has(e.pointerId))return;ptrs.delete(e.pointerId);if(!gest)return;
  if(gest.kind==='pinch'){if(ptrs.size===0)gest=null;return}
  if(gest.kind==='place'&&!gest.moved){const [x,z]=toMap(gest.sx,gest.sy);begin();const t=Object.assign({},TPL[D.world][ftype]||{t:ftype});const f=Object.assign(t,{x:snap05(x),z:snap05(z)});if(!f.flat&&!SMALLD[f.t]){f.w=f.w||1;f.d=f.d||1}D.furn.push(f);sel=D.furn.length-1;commit();updUI();draw()}
  else if(gest.kind==='pan'&&!gest.moved&&tool==='pan'){if(sel>=0){sel=-1;updUI();draw()}}
  else commit();
  gest=null};
cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);
cv.addEventListener('wheel',e=>{e.preventDefault();const k=e.deltaY<0?1.12:1/1.12,ns=Math.max(4,Math.min(90,view.s*k));const r=ns/view.s;view.ox=e.clientX-(e.clientX-view.ox)*r;view.oy=e.clientY-(e.clientY-view.oy)*r;view.s=ns;draw()},{passive:false});

/* ---------- панелі ---------- */
document.querySelectorAll('#tools .tool[data-t]').forEach(b=>b.addEventListener('click',()=>{tool=b.dataset.t;if(tool!=='pan'&&tool!=='furn')sel=-1;updUI();draw()}));
function updUI(){
  if(!D)return;$('mapBtn').textContent=D.name+(dirty?' •':'');$('undo').disabled=!undoS.length;$('redo').disabled=!redoS.length;
  document.querySelectorAll('#tools .tool[data-t]').forEach(b=>b.classList.toggle('on',b.dataset.t===tool));
  const sub=$('sub');sub.innerHTML='';sub.hidden=true;
  if(tool==='floor'){sub.hidden=false;
    for(const ch of Object.keys(D.floor)){const b=document.createElement('button');b.type='button';b.className='chip'+(ch===room?' on':'');b.innerHTML='<i style="background:'+D.floor[ch][0]+'"></i>';b.append(D.rooms[ch]||ch);
      b.onclick=()=>{if(room===ch)roomDialog(ch);else{room=ch;updUI()}};sub.append(b)}
    const a=document.createElement('button');a.type='button';a.className='chip';a.textContent='＋ кімната';a.onclick=addRoom;sub.append(a);
    const h=document.createElement('span');h.style.cssText='font-size:12px;opacity:.6;align-self:center;white-space:nowrap';h.textContent='повторний дотик — налаштувати';sub.append(h)}
  if(tool==='furn'){sub.hidden=false;const types=Object.keys(TPL[D.world]).sort((a,b)=>(NAMES[a]||a).localeCompare(NAMES[b]||b,'uk'));
    for(const t of types){const b=document.createElement('button');b.type='button';b.className='chip'+(t===ftype?' on':'');b.textContent=(EMO[t]||'▪')+' '+(NAMES[t]||t);b.onclick=()=>{ftype=t;updUI()};sub.append(b)}
    requestAnimationFrame(()=>{const on=sub.querySelector('.on');if(on)on.scrollIntoView({inline:'center',block:'nearest'})})}
  const pr=$('props');pr.hidden=sel<0||!D.furn[sel];
  if(!pr.hidden){const f=D.furn[sel];pr.innerHTML='';const tt=document.createElement('b');tt.textContent=(EMO[f.t]||'')+' '+(NAMES[f.t]||f.t);pr.append(tt);
    const btn=(txt,lab,fn)=>{const b=document.createElement('button');b.type='button';b.className='ib';b.textContent=txt;b.setAttribute('aria-label',lab);b.onclick=()=>{begin();fn();commit();updUI()};return b};
    pr.append(btn('⟳','Повернути',()=>{f.r=((f.r||0)+1)%4}));
    if(RESIZE[f.t]||f.flat){for(const [k,lab] of[['w','Ш'],['d','Г']]){const n=document.createElement('span');n.className='num';const m=document.createElement('button');m.type='button';m.textContent='−';const v=document.createElement('span');v.textContent=lab+' '+(+(f[k]||1)).toFixed(1);const p=document.createElement('button');p.type='button';p.textContent='+';
      m.onclick=()=>{begin();f[k]=Math.max(0.3,Math.round(((f[k]||1)-0.1)*10)/10);commit();updUI()};p.onclick=()=>{begin();f[k]=Math.min(12,Math.round(((f[k]||1)+0.1)*10)/10);commit();updUI()};n.append(m,v,p);pr.append(n)}}
    const col=document.createElement('input');col.type='color';col.value=/^#[0-9a-f]{6}$/i.test(f.c||'')?f.c:'#B08968';col.setAttribute('aria-label','Колір');col.onchange=()=>{begin();f.c=col.value;commit()};pr.append(col);
    if(!f.flat)pr.append(btn(f.tall?'▮ висока':'▯ низька','Чи закриває огляд',()=>{if(f.tall)delete f.tall;else f.tall=1}));
    pr.append(btn('⧉','Дублювати',()=>{const c=Object.assign({},f);c.x=snap05(f.x+0.5);c.z=snap05(f.z+0.5);D.furn.push(c);sel=D.furn.length-1}));
    pr.append(btn('🗑','Видалити',()=>{D.furn.splice(sel,1);sel=-1}))}
}
const FREE='abcdefgijklmnopqrstuvxyz';
function addRoom(){const ch=[...FREE].find(c=>!D.floor[c]);if(!ch){toast('Більше кімнат не влізе');return}begin();
  const pal=[['#CFA272','#C49465','wood'],['#EEF2F4','#D9E1E7','tile'],['#EDC3CB','#E6B7C0','carpet'],['#C7EBBB','#BCE2AF','carpet'],['#C6E8F1','#AEDCEA','tile'],['#B6C3D4','#AAB8CB','carpet']];
  D.floor[ch]=pal[Object.keys(D.floor).length%pal.length].slice();D.rooms[ch]='Кімната '+(Object.keys(D.floor).length);room=ch;commit();roomDialog(ch)}
function roomDialog(ch){const F=D.floor[ch];
  const c=sheet('<h2>Кімната</h2><div class="row"><label for="rn">Назва</label><input type="text" id="rn" maxlength="24"></div>'+
    '<div class="row"><label>Кольори</label><input type="color" id="rc1"><input type="color" id="rc2"><select id="rp">'+Object.entries(PAT).map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('')+'</select></div>'+
    '<div class="row"><label for="rh">Схованки</label><select id="rh"><option value="">Можна ховатись</option><option value="1">Не можна (коридор)</option></select></div>'+
    '<div class="row"><button class="btn" id="rOk" type="button">Готово</button><button class="btn bad" id="rDel" type="button">Видалити кімнату</button></div>');
  c.querySelector('#rn').value=D.rooms[ch]||'';c.querySelector('#rc1').value=F[0];c.querySelector('#rc2').value=F[1];c.querySelector('#rp').value=F[2];c.querySelector('#rh').value=D.noHide.includes(ch)?'1':'';
  c.querySelector('#rOk').onclick=()=>{begin();D.rooms[ch]=c.querySelector('#rn').value.trim()||D.rooms[ch];D.floor[ch]=[c.querySelector('#rc1').value,c.querySelector('#rc2').value,c.querySelector('#rp').value];
    D.noHide=D.noHide.replace(ch,'')+(c.querySelector('#rh').value?ch:'');commit();closeSheet();updUI()};
  c.querySelector('#rDel').onclick=()=>{if(Object.keys(D.floor).length<2){toast('Має лишитись хоч одна кімната');return}const other=Object.keys(D.floor).find(k=>k!==ch);begin();
    for(const r of D.rows)for(let i=0;i<r.length;i++)if(r[i]===ch)r[i]=other;delete D.floor[ch];delete D.rooms[ch];D.noHide=D.noHide.replace(ch,'');room=other;commit();closeSheet();updUI()}}

function sheet(html){$('sheetCard').innerHTML=html;$('sheet').hidden=false;return $('sheetCard')}
function closeSheet(){$('sheet').hidden=true}
$('sheet').addEventListener('click',e=>{if(e.target===$('sheet'))closeSheet()});

/* ---------- відкрити / нова ---------- */
$('mapBtn').addEventListener('click',mapList);
function mapList(){
  let h='<h2>Карти</h2>';
  for(const w of['hns','ph']){h+='<div class="grp">'+WORLDS[w].label+'</div><div class="list">';
    for(const m of WORLDS[w].HW.MAPS){if(m.id===SLOT)continue;const r=remote[w+'_'+m.id];h+='<button type="button" data-w="'+w+'" data-id="'+m.id+'">'+esc(r&&r.name||m.name)+(r?'<em>змінена ✎</em>':'')+'</button>'}
    for(const k in remote){const r=remote[k];if(r.world!==w||BUILTIN[w][r.id])continue;h+='<button type="button" data-w="'+w+'" data-id="'+esc(r.id)+'">'+esc(r.name||'Карта')+'<em>нова ✎</em></button>'}
    h+='<button type="button" data-new="'+w+'">＋ Нова карта</button></div>'}
  const c=sheet(h);
  c.querySelectorAll('button[data-id]').forEach(b=>b.onclick=()=>{closeSheet();confirmLeave(()=>openMap(b.dataset.w,b.dataset.id))});
  c.querySelectorAll('button[data-new]').forEach(b=>b.onclick=()=>{closeSheet();confirmLeave(()=>newMap(b.dataset.new))});
}
function confirmLeave(fn){fn()} // чернетка й так лишається в телефоні
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ---------- ще: назва, розмір, трава ---------- */
$('moreBtn').addEventListener('click',()=>{
  const c=sheet('<h2>Карта</h2><div class="row"><label for="mn">Назва</label><input type="text" id="mn" maxlength="28"></div>'+
    '<div class="row"><label>Ширина '+MW()+'</label><button class="btn sec" data-r="L-">− зліва</button><button class="btn sec" data-r="L+">＋ зліва</button><button class="btn sec" data-r="R-">− справа</button><button class="btn sec" data-r="R+">＋ справа</button></div>'+
    '<div class="row"><label>Висота '+MH()+'</label><button class="btn sec" data-r="T-">− згори</button><button class="btn sec" data-r="T+">＋ згори</button><button class="btn sec" data-r="B-">− знизу</button><button class="btn sec" data-r="B+">＋ знизу</button></div>'+
    '<div class="row"><label for="mg">Довкола</label><input type="color" id="mg"></div>'+
    (D.builtin&&remote[D.world+'_'+D.id]?'<button class="btn bad" id="mRev" type="button">Повернути вбудовану версію в іграх</button>':'')+
    (!D.builtin&&remote[D.world+'_'+D.id]?'<button class="btn bad" id="mDel" type="button">Видалити карту з ігор</button>':'')+
    '<button class="btn sec" id="mReset" type="button">Скинути чернетку</button><button class="btn" id="mOk" type="button">Готово</button>');
  c.querySelector('#mn').value=D.name;c.querySelector('#mg').value=D.grass;
  c.querySelectorAll('[data-r]').forEach(b=>b.onclick=()=>{begin();resizeMap(b.dataset.r);commit();fit();draw();closeSheet();$('moreBtn').click()});
  c.querySelector('#mOk').onclick=()=>{const n=c.querySelector('#mn').value.trim();if(n&&n!==D.name){D.name=n;changed()}if(c.querySelector('#mg').value!==D.grass){D.grass=c.querySelector('#mg').value;changed()}closeSheet()};
  c.querySelector('#mReset').onclick=()=>{dropDraft();closeSheet();if(D.builtin||remote[D.world+'_'+D.id])openMap(D.world,D.id);else newMap(D.world)};
  const rev=c.querySelector('#mRev');if(rev)rev.onclick=()=>unpublish('Вбудовану версію повернуто');
  const del=c.querySelector('#mDel');if(del)del.onclick=()=>unpublish('Карту прибрано з ігор');
});
function resizeMap(op){const s=op[0],add=op[1]==='+',w=MW(),h=MH();
  if(s==='R'){if(add)D.rows.forEach(r=>r.push('#'));else if(w>6)D.rows.forEach(r=>r.pop())}
  if(s==='B'){if(add)D.rows.push(Array(w).fill('#'));else if(h>6)D.rows.pop()}
  if(s==='L'){if(add){D.rows.forEach(r=>r.unshift('#'));shift(1,0)}else if(w>6){D.rows.forEach(r=>r.shift());shift(-1,0)}}
  if(s==='T'){if(add){D.rows.unshift(Array(w).fill('#'));shift(0,1)}else if(h>6){D.rows.shift();shift(0,-1)}}
  D.furn=D.furn.filter(f=>f.x>0&&f.z>0&&f.x<MW()&&f.z<MH())}
function shift(dx,dz){for(const f of D.furn){f.x+=dx;f.z+=dz}D.spawn[0]+=dx;D.spawn[1]+=dz}

/* ---------- збереження в базу ---------- */
function authed(){return new Promise(res=>{if(!window.firebase||!firebase.auth){res(false);return}const a=firebase.auth(),t=setTimeout(()=>res(false),8000);
  const off=a.onAuthStateChanged(u=>{off();if(u){clearTimeout(t);res(true);return}a.signInAnonymously().then(()=>{clearTimeout(t);res(true)},()=>{clearTimeout(t);res(false)})})})}
/* точки для ботів: по кілька в кожній кімнаті, рознесені */
function waypoints(){const res=check.res||buildNow(),HW=HWc(),nav=check.nav||HW.walkGrid(res.boxes,0.3),CS=HW.CS,nx=nav.nx,seen=check.seen,by={};
  for(let i=0;i<nav.free.length;i++){if(!nav.free[i]||(seen&&!seen[i]))continue;const x=(i%nx+.5)*CS,z=(Math.floor(i/nx)+.5)*CS,ch=D.rows[Math.floor(z)][Math.floor(x)];(by[ch]=by[ch]||[]).push([x,z])}
  const out=[D.spawn.slice()];
  for(const ch in by){const pts=by[ch],n=Math.max(1,Math.min(6,Math.round(pts.length*CS*CS/14)));const c=pts.reduce((a,p)=>[a[0]+p[0]/pts.length,a[1]+p[1]/pts.length],[0,0]);
    let first=pts.reduce((b,p)=>Math.hypot(p[0]-c[0],p[1]-c[1])<Math.hypot(b[0]-c[0],b[1]-c[1])?p:b,pts[0]);const pick=[first];
    while(pick.length<n){let best=null,bd=-1;for(const p of pts){const d=Math.min(...pick.map(q=>Math.hypot(p[0]-q[0],p[1]-q[1])));if(d>bd){bd=d;best=p}}if(bd<2)break;pick.push(best)}
    for(const p of pick)out.push([Math.round(p[0]*10)/10,Math.round(p[1]*10)/10])}
  return out}
$('saveBtn').addEventListener('click',()=>{
  const e=check.issues.filter(i=>i.e).length,games=WORLDS[D.world].games;
  const c=sheet('<h2>Зберегти в ігри</h2>'+
    '<p>'+(D.builtin?'Ця версія замінить вбудовану «'+esc(BUILTIN[D.world][D.id].name)+'» у '+esc(WORLDS[D.world].label)+' — в усіх, хто грає. Повернути можна в «⋯».':'Нова карта зʼявиться в «По черзі» і в списку карт вибраних ігор.')+'</p>'+
    (D.builtin?'':'<div class="grp">Ігри</div>'+Object.entries(games).map(([k,v])=>'<label class="row"><input type="checkbox" data-g="'+k+'"'+((D.games||[]).includes(k)?' checked':'')+'> '+v+'</label>').join(''))+
    (e?'<p style="color:var(--bad)">⛔ Є проблеми прохідності: '+e+'. Краще виправити до публікації.</p>':'')+
    '<div class="row"><button class="btn" id="pOk" type="button">'+(e?'Все одно зберегти':'Зберегти')+'</button><button class="btn sec" id="pNo" type="button">Скасувати</button></div>');
  c.querySelector('#pNo').onclick=closeSheet;
  c.querySelector('#pOk').onclick=async()=>{if(!D.builtin){D.games=[...c.querySelectorAll('[data-g]')].filter(x=>x.checked).map(x=>x.dataset.g);if(!D.games.length){toast('Вибери хоч одну гру');return}}
    closeSheet();await publish()};
});
async function publish(){
  toast('Зберігаю…',8000);
  if(!(await authed())){toast('Немає звʼязку з базою — чернетка лишилась у телефоні');return}
  let who='';try{who=(JSON.parse(localStorage.getItem('games41_session')||'{}').username)||''}catch(e){}
  const data={id:D.id,world:D.world,name:D.name,rows:D.rows.map(r=>r.join('')),floor:D.floor,furn:D.furn.map(f=>{const o={};for(const k in f)if(f[k]!==undefined&&f[k]!==null)o[k]=typeof f[k]==='number'?Math.round(f[k]*100)/100:f[k];return o}),
    rooms:D.rooms,spawn:D.spawn,grass:D.grass,noHide:D.noHide,waypoints:waypoints(),games:D.builtin?null:D.games,by:who,at:Date.now()};
  const key=D.world+'_'+D.id,str=JSON.stringify(data);if(str.length>290000){toast('Карта завелика для збереження');return}
  try{await firebase.database().ref('maps/'+key).set(str);remote[key]=data;cacheLocal();dropDraft();dirty=false;updUI();toast('✓ Збережено. Ігри підхоплять при наступному відкритті')}
  catch(e){toast('Не вдалося зберегти: '+(e&&e.code==='PERMISSION_DENIED'?'немає правила «maps» у базі':e&&e.message||e),5000)}
}
async function unpublish(msg){closeSheet();if(!(await authed())){toast('Немає звʼязку з базою');return}const key=D.world+'_'+D.id;
  try{await firebase.database().ref('maps/'+key).remove();delete remote[key];cacheLocal();dropDraft();toast(msg);if(D.builtin)openMap(D.world,D.id);else newMap(D.world)}catch(e){toast('Не вдалося: '+(e&&e.message||e),4000)}}
/* одразу оновлюємо кеш ігор у цьому телефоні (../maps-remote.js читає його першим) */
function cacheLocal(){for(const w of['hns','ph']){try{localStorage.setItem('maps41_'+w,JSON.stringify(Object.values(remote).filter(r=>r.world===w)))}catch(e){}}}

/* ---------- 3D-тест ---------- */
let R3=null;
function test3d(){
  const res=buildNow(),HW=HWc();if(!R3)R3=initTest();const t=R3;
  if(t.mesh){t.scene.remove(t.mesh);t.mesh.geometry.dispose()}
  t.mesh=res.mesh.mesh(new T3.MeshToonMaterial({vertexColors:true,gradientMap:t.gm}));t.mesh.castShadow=t.mesh.receiveShadow=true;t.scene.add(t.mesh);
  t.boxes=res.boxes;t.nav=HW.walkGrid(res.boxes,0.3);t.W=res.W;t.H=res.H;t.scene.background.set(D.grass);t.ground.position.set(res.W/2,-0.11,res.H/2);
  t.sun.position.set(res.W/2-7,18,res.H/2+9);t.sun.target.position.set(res.W/2,0,res.H/2);const sc=t.sun.shadow.camera,ext=Math.max(res.W,res.H)/2+4;sc.left=-ext;sc.right=ext;sc.top=ext;sc.bottom=-ext;sc.updateProjectionMatrix();
  t.p.x=D.spawn[0];t.p.z=D.spawn[1];t.p.vx=t.p.vz=0;t.cam=null;$('test').hidden=false;t.on=true;t.resize();t.last=performance.now();requestAnimationFrame(t.frame);
}
function initTest(){
  const gl=$('gl3'),fx=$('fx3'),f2=fx.getContext('2d'),renderer=new T3.WebGLRenderer({canvas:gl,antialias:true});renderer.setPixelRatio(Math.min(1.6,devicePixelRatio||1));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T3.PCFSoftShadowMap;
  const scene=new T3.Scene();scene.background=new T3.Color('#8FCB72');const camera=new T3.PerspectiveCamera(46,1,0.5,160);
  scene.add(new T3.HemisphereLight(0xEAF2FF,0xB59C82,0.55));const sun=new T3.DirectionalLight(0xFFF0DC,0.62);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.bias=-0.0006;sun.shadow.normalBias=0.03;scene.add(sun);scene.add(sun.target);
  const gm=new T3.DataTexture(new Uint8Array([120,190,255]),3,1,T3.LuminanceFormat);gm.minFilter=gm.magFilter=T3.NearestFilter;gm.needsUpdate=true;
  const toon=c=>new T3.MeshToonMaterial({color:c,gradientMap:gm});
  const ground=new T3.Mesh(new T3.PlaneGeometry(220,220).rotateX(-Math.PI/2),toon('#8FA08E'));ground.position.y=-0.11;ground.receiveShadow=true;scene.add(ground);
  // аватар — той самий «бобик», що в іграх
  const BEAN=new T3.LatheGeometry([[0,0],[0.17,0.012],[0.25,0.06],[0.285,0.17],[0.29,0.36],[0.285,0.55],[0.26,0.7],[0.21,0.82],[0.13,0.9],[0,0.93]].map(([x,y])=>new T3.Vector2(x,y)),20),SPH=new T3.SphereGeometry(1,12,9);
  const av=new T3.Group(),body=new T3.Mesh(BEAN,toon('#FFC93C'));body.castShadow=true;av.add(body);for(const s of[-1,1]){const e=new T3.Mesh(SPH,toon('#fff'));e.position.set(s*0.095,0.64,0.215);e.scale.set(0.075,0.085,0.05);av.add(e);const p=new T3.Mesh(SPH,toon('#1D1A26'));p.position.set(s*0.095,0.635,0.255);p.scale.set(0.04,0.048,0.025);av.add(p)}
  const ring=new T3.Mesh(new T3.RingGeometry(0.26,0.3,32).rotateX(-Math.PI/2),new T3.MeshBasicMaterial({color:'#FF5C5C'}));ring.position.y=0.02;av.add(ring);
  av.scale.setScalar(1.18);scene.add(av);
  const p={x:0,z:0,vx:0,vz:0,yaw:Math.PI,ph:0};let joy=null,fast=true,far=false;
  const VIEW_LONG=60*Math.PI/180;
  const t={renderer,scene,camera,sun,ground,gm,p,on:false,boxes:[],nav:null,
    resize(){const w=innerWidth,h=innerHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.fov=(w>h?2*Math.atan(Math.tan(VIEW_LONG/2)*h/w):VIEW_LONG)*180/Math.PI;camera.updateProjectionMatrix();const d=Math.min(2,devicePixelRatio||1);fx.width=w*d;fx.height=h*d;f2.setTransform(d,0,0,d,0,0)},
    frame(now){if(!t.on)return;const dt=Math.min(0.05,(now-t.last)/1000);t.last=now;
      let ix=0,iz=0;if(joy&&joy.moved){const dx=joy.x-joy.sx,dy=joy.y-joy.sy,m=Math.hypot(dx,dy);if(m>6){const k=Math.min(1,m/55);ix=dx/m*k;iz=dy/m*k}}
      const sp=fast?3.4:1.4;p.vx+=(ix*sp-p.vx)*Math.min(1,dt*11);p.vz+=(iz*sp-p.vz)*Math.min(1,dt*11);
      for(let k=0;k<2;k++){p.x+=p.vx*dt/2;p.z+=p.vz*dt/2;collide(p,t.boxes)}
      const s2=Math.hypot(p.vx,p.vz);if(s2>0.25)p.yaw+=((Math.atan2(p.vx,p.vz)-p.yaw+Math.PI*3)%(Math.PI*2)-Math.PI)*Math.min(1,dt*12);p.ph+=dt*(4+s2*3.4);
      av.position.set(p.x,0,p.z);av.rotation.y=p.yaw;body.position.y=Math.abs(Math.sin(p.ph))*0.07*Math.min(1,s2/2.6);
      const h=far?[16,10]:[8.4,6.0],want=new T3.Vector3(p.x,h[0],p.z+h[1]),look=new T3.Vector3(p.x,0,p.z-0.4);
      if(!t.cam){t.cam=want.clone();t.look=look.clone()}t.cam.lerp(want,Math.min(1,dt*5));t.look.lerp(look,Math.min(1,dt*6));camera.position.copy(t.cam);camera.lookAt(t.look);
      const CS=0.5,nav=t.nav,ok=nav&&nav.free[Math.max(0,Math.min(nav.nz-1,Math.floor(p.z/CS)))*nav.nx+Math.max(0,Math.min(nav.nx-1,Math.floor(p.x/CS)))];
      $('tinfo').textContent='x '+p.x.toFixed(1)+' · z '+p.z.toFixed(1)+(ok?' · боти тут ходять':' · тут ботам тісно');
      renderer.render(scene,camera);
      f2.clearRect(0,0,innerWidth,innerHeight);if(joy&&joy.moved){const dx=joy.x-joy.sx,dy=joy.y-joy.sy,m=Math.hypot(dx,dy),k=m>55?55/m:1;f2.fillStyle='rgba(255,255,255,.12)';f2.strokeStyle='rgba(255,255,255,.45)';f2.lineWidth=2;f2.beginPath();f2.arc(joy.sx,joy.sy,55,0,6.283);f2.fill();f2.stroke();f2.fillStyle='rgba(255,255,255,.8)';f2.beginPath();f2.arc(joy.sx+dx*k,joy.sy+dy*k,22,0,6.283);f2.fill()}
      requestAnimationFrame(t.frame)}};
  const ray=new T3.Raycaster(),plane=new T3.Plane(new T3.Vector3(0,1,0),0),hit=new T3.Vector3();
  gl.addEventListener('pointerdown',e=>{if(joy)return;joy={id:e.pointerId,sx:e.clientX,sy:e.clientY,x:e.clientX,y:e.clientY,moved:false};try{gl.setPointerCapture(e.pointerId)}catch(_){}});
  gl.addEventListener('pointermove',e=>{if(joy&&e.pointerId===joy.id){joy.x=e.clientX;joy.y=e.clientY;if(Math.hypot(joy.x-joy.sx,joy.y-joy.sy)>10)joy.moved=true}});
  const end=e=>{if(!joy||e.pointerId!==joy.id)return;const j=joy;joy=null;
    // короткий дотик — аватар зʼявляється там
    if(!j.moved&&e.type==='pointerup'){ray.setFromCamera({x:j.sx/innerWidth*2-1,y:-(j.sy/innerHeight*2-1)},camera);if(ray.ray.intersectPlane(plane,hit)){p.x=hit.x;p.z=hit.z;p.vx=p.vz=0;collide(p,t.boxes)}}};
  gl.addEventListener('pointerup',end);gl.addEventListener('pointercancel',end);
  addEventListener('resize',()=>{if(t.on)t.resize()});
  $('tExit').onclick=()=>{t.on=false;$('test').hidden=true;resize()};
  $('tSpeed').onclick=()=>{fast=!fast;$('tSpeed').textContent=fast?'🏃':'🚶'};
  $('tCam').onclick=()=>{far=!far};
  return t;
}
/* та сама колізія, що в Хованках і Агентах (радіус 0.28) */
function collide(ch,boxes){const r=0.28;for(const b of boxes){if(ch.x<b[0]-r||ch.x>b[2]+r||ch.z<b[1]-r||ch.z>b[3]+r)continue;
  const cx=Math.max(b[0],Math.min(ch.x,b[2])),cz=Math.max(b[1],Math.min(ch.z,b[3]));let dx=ch.x-cx,dz=ch.z-cz,d=Math.hypot(dx,dz);
  if(d<r){if(d<1e-5){const l=ch.x-b[0],rr=b[2]-ch.x,t=ch.z-b[1],bb=b[3]-ch.z,m=Math.min(l,rr,t,bb);if(m===l)ch.x=b[0]-r;else if(m===rr)ch.x=b[2]+r;else if(m===t)ch.z=b[1]-r;else ch.z=b[3]+r;continue}
    ch.x=cx+dx/d*r;ch.z=cz+dz/d*r;const vn=(ch.vx*dx+ch.vz*dz)/d;if(vn<0){ch.vx-=vn*dx/d;ch.vz-=vn*dz/d}}}}
$('playBtn').addEventListener('click',()=>{try{test3d()}catch(e){toast('Не вдалося побудувати: '+e.message,4000)}});

/* ---------- старт ---------- */
resize();
(function boot(){
  let last='hns_house';try{last=localStorage.getItem('mapedit_last')||last}catch(e){}
  const [w,...rest]=last.split('_'),id=rest.join('_');
  if(WORLDS[w]&&WORLDS[w].HW.MAPS.some(m=>m.id===id))openMap(w,id);else openMap('hns','house');
  // опубліковані карти з бази
  try{if(window.firebase&&firebase.database)firebase.database().ref('maps').once('value').then(s=>{const v=s.val()||{};remote={};for(const k in v){try{remote[k]=JSON.parse(v[k])}catch(e){}}cacheLocal();
    if(!dirty&&!loadDraft(D.world+'_'+D.id)&&remote[D.world+'_'+D.id])openMap(D.world,D.id);else if(!WORLDS[w].HW.MAPS.some(m=>m.id===id)&&remote[last])openMap(w,id)},()=>{})}catch(e){}
})();
window.MapEdit={get D(){return D},get check(){return check},runCheck,openMap,newMap,get remote(){return remote},test3d,get R3(){return R3},collide,waypoints,view,setTool:t=>{tool=t;updUI()},
  set ftype(v){ftype=v},changed,fromDef,publish};
})();
