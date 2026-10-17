/* Pin-pull simulation: particles (gold, lava, water, stone), pins, ramps, hero and monster.
   Pure logic, no drawing, so levels can be checked headlessly. Logical field is 360x640. */
(function(root){
const R=6,GRAV=980,CELL=12;
const BASE=[[32,80,16,530],[312,80,16,530],[32,594,296,16]];

const LEVELS=[
  { name:'Золотий дощ', tip:'Витягни шпильку, щоб золото впало до лицаря.',
    walls:[],
    pins:[[40,300,342,300]],
    fills:[['gold',54,262,306,292]],
    hero:180 },
  { name:'Яку тягнути?', tip:'Лава спалить лицаря. Обирай уважно.',
    walls:[[174,80,12,226]],
    pins:[[184,312,18,312],[176,312,342,312]],
    fills:[['lava',52,250,170,302],['gold',190,250,308,302]],
    hero:180 },
  { name:'Вода гасить лаву', tip:'Вода й лава разом стають каменем.',
    walls:[[174,80,12,270]],
    pins:[[184,206,18,206],[184,358,18,358],[176,358,342,358]],
    fills:[['water',52,110,170,198],['lava',52,302,170,350],['gold',190,292,308,350]],
    hero:236 },
  { name:'Вартовий скарбу', tip:'Монстр стереже золото. Не відчиняй двері зарано.',
    walls:[[174,80,12,392]],
    pins:[[180,470,180,626],[176,166,342,166],[176,280,342,280]],
    ramps:[[186,586,312,500]],
    fills:[['water',190,96,308,160],['lava',190,226,308,274],['gold',244,420,300,492]],
    monster:214, hero:150 },
  { name:'Три ключі', tip:'Порядок має значення.',
    walls:[[98,80,12,100],[250,80,12,172]],
    pins:[[256,186,18,186],[256,258,346,186],[40,404,342,404]],
    fills:[['gold',114,110,246,178],['water',266,96,306,206],['lava',52,344,308,398]],
    hero:180 },
  { name:'Інший бік',
    tip:'Тепер лава праворуч. Не тягни навмання.',
    walls:[[174,80,12,226]],
    pins:[[176,312,342,312],[184,312,18,312]],
    fills:[['lava',190,250,308,302],['gold',52,250,170,302]],
    hero:180 },
  { name:'Три колодязі',
    tip:'Золото лише в одному. Решта — лава.',
    walls:[[120,80,12,230],[228,80,12,230]],
    pins:[[126,316,18,316],[126,316,234,316],[234,316,342,316]],
    fills:[['lava',52,250,116,310],['gold',136,250,224,310],['lava',244,250,308,310]],
    hero:180 },
  { name:'Мокра справа',
    tip:'Вода гасить лаву — але спершу подумай, яку шпильку тягнути.',
    walls:[[174,80,12,270]],
    pins:[[176,206,342,206],[176,358,342,358],[184,358,18,358]],
    fills:[['water',190,110,308,198],['lava',190,302,308,350],['gold',52,292,170,350]],
    hero:124 },
  { name:'Лава над золотом',
    tip:'Над скарбом — лава. Встигни забрати золото першим.',
    walls:[[120,80,12,330]],
    pins:[[126,200,342,200],[126,330,342,330],[126,300,18,300]],
    fills:[['lava',140,140,306,192],['gold',140,262,306,322],['water',52,150,116,292]],
    hero:220 },
  { name:'Подвійний скарб',
    tip:'Золото з обох боків, лава посередині.',
    walls:[[120,80,12,300],[228,80,12,300]],
    pins:[[126,386,18,386],[234,386,342,386],[126,300,234,300]],
    ramps:[[48,520,150,588],[312,520,210,588]],
    fills:[['gold',52,320,116,380],['gold',244,320,308,380],['lava',136,230,224,294]],
    hero:180 },
  { name:'Сторож ліворуч',
    tip:'Монстр знову стереже золото. Спершу розберися з ним.',
    walls:[[174,80,12,392]],
    pins:[[180,470,180,626],[184,166,18,166],[184,280,18,280]],
    ramps:[[174,586,48,500]],
    fills:[['water',52,96,170,160],['lava',52,226,170,274],['gold',60,420,116,492]],
    monster:146,
    hero:204 },
  { name:'Ключі навиворіт',
    tip:'Три шпильки — і порядок знову має значення.',
    walls:[[250,80,12,100],[98,80,12,172]],
    pins:[[104,186,342,186],[104,258,14,186],[320,404,18,404]],
    fills:[['gold',114,110,246,178],['water',54,96,94,206],['lava',52,344,308,398]],
    hero:180 },
];

function segDist(px,py,x1,y1,x2,y2){
  const dx=x2-x1,dy=y2-y1,l=dx*dx+dy*dy;let t=l?((px-x1)*dx+(py-y1)*dy)/l:0;t=Math.max(0,Math.min(1,t));
  const cx=x1+dx*t,cy=y1+dy*t;return{d:Math.hypot(px-cx,py-cy),cx,cy};
}
function segsCross(a,b,c,d){
  const o=(p,q,r)=>Math.sign((q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]));
  return o(a,b,c)!==o(a,b,d)&&o(c,d,a)!==o(c,d,b);
}

class Sim{
  constructor(i){
    const L=LEVELS[i];this.def=L;this.idx=i;
    this.walls=BASE.concat(L.walls).map(([x,y,w,h])=>({x,y,w,h}));
    this.ramps=(L.ramps||[]).map(([x1,y1,x2,y2])=>({x1,y1,x2,y2}));
    this.pins=L.pins.map(([x1,y1,x2,y2])=>{const l=Math.hypot(x2-x1,y2-y1);return{x1,y1,x2,y2,ux:(x2-x1)/l,uy:(y2-y1)/l,len:l,off:0,state:'in'}});
    this.ps=[];
    for(const [t,x0,y0,x1,y1] of L.fills){let row=0;for(let y=y1-R;y>=y0+R-0.1;y-=R*1.75,row++)for(let x=x0+R+(row&1?R:0);x<=x1-R;x+=R*2)this.ps.push({x,y,vx:0,vy:0,t,f:0})}
    this.gold=this.ps.filter(p=>p.t==='gold').length;this.target=Math.max(5,Math.ceil(this.gold*0.5));this.got=0;
    this.hero={x:L.hero-17,y:594-46,w:34,h:46,alive:true};
    this.monster=null;
    if(L.monster!=null){const m={x:L.monster-22,w:44,h:52,vy:0,alive:true,dead:0,y:L.monsterY||470};m.y=this.groundAt(m)-m.h;this.monster=m}
    this.state='play';this.reason='';this.time=0;this.events=[];
  }
  pull(i){const p=this.pins[i];if(p&&p.state==='in'){p.state='out';this.events.push({e:'pull',i});return true}return false}
  pinSeg(p){return[p.x1+p.ux*p.off,p.y1+p.uy*p.off,p.x2+p.ux*p.off,p.y2+p.uy*p.off]}
  solids(){const s=[];for(const p of this.pins)if(p.state!=='gone'){const g=this.pinSeg(p);s.push({x1:g[0],y1:g[1],x2:g[2],y2:g[3],r:5})}for(const r of this.ramps)s.push({x1:r.x1,y1:r.y1,x2:r.x2,y2:r.y2,r:5});return s}
  /* top surface under a body (walls, pins, ramps) */
  groundAt(b){
    let best=1e9;const cx=b.x+b.w/2,bot=b.y!=null?b.y+b.h:-1e9;
    for(const w of this.walls)if(b.x+b.w-4>w.x&&b.x+4<w.x+w.w&&w.y>=bot-3&&w.y<best)best=w.y;
    for(const s of this.solids()){
      const lo=Math.min(s.x1,s.x2),hi=Math.max(s.x1,s.x2);if(cx<lo-2||cx>hi+2)continue;
      const y=(Math.abs(s.x2-s.x1)<1?Math.min(s.y1,s.y2):s.y1+(s.y2-s.y1)*(cx-s.x1)/(s.x2-s.x1))-s.r;
      if(Math.abs(s.x2-s.x1)<1)continue;
      if(y>=bot-3&&y<best)best=y;
    }
    return best;
  }
  blocked(a,b){
    for(const w of this.walls){const r=[[w.x,w.y],[w.x+w.w,w.y],[w.x+w.w,w.y+w.h],[w.x,w.y+w.h]];for(let k=0;k<4;k++)if(segsCross(a,b,r[k],r[(k+1)%4]))return true}
    for(const p of this.pins)if(p.state!=='gone'){const g=this.pinSeg(p);if(segsCross(a,b,[g[0],g[1]],[g[2],g[3]]))return true}
    return false;
  }
  step(dt){
    if(this.state==='win')return;
    this.time+=dt;
    for(const p of this.pins)if(p.state==='out'){p.off+=dt*(p.len+80)/0.35;if(p.off>p.len+70)p.state='gone'}
    const ps=this.ps,sol=this.solids();
    for(const p of ps){p.vy+=GRAV*dt;const damp=p.t==='water'?0.9995:p.t==='lava'?0.996:0.995;p.vx*=damp;p.x+=p.vx*dt;p.y+=p.vy*dt;if(p.f>0)p.f-=dt}
    const bodies=[];if(this.hero.alive)bodies.push(this.hero);if(this.monster&&this.monster.alive)bodies.push(this.monster);
    for(let it=0;it<3;it++){
      const grid=new Map();
      for(let i=0;i<ps.length;i++){const p=ps[i],k=((p.x/CELL)|0)*1000+((p.y/CELL)|0);let c=grid.get(k);if(!c)grid.set(k,c=[]);c.push(i)}
      for(let i=0;i<ps.length;i++){
        const a=ps[i],gx=(a.x/CELL)|0,gy=(a.y/CELL)|0;
        for(let ox=-1;ox<=1;ox++)for(let oy=-1;oy<=1;oy++){const c=grid.get((gx+ox)*1000+gy+oy);if(!c)continue;
          for(const j of c){if(j<=i)continue;const b=ps[j];let dx=b.x-a.x,dy=b.y-a.y,d2=dx*dx+dy*dy;if(d2>=4*R*R||d2===0)continue;
            const d=Math.sqrt(d2),nx=dx/d,ny=dy/d,ov=(2*R-d)/2;a.x-=nx*ov;a.y-=ny*ov;b.x+=nx*ov;b.y+=ny*ov;
            const vn=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;if(vn<0){const im=vn*0.5;a.vx+=im*nx;a.vy+=im*ny;b.vx-=im*nx;b.vy-=im*ny}
            if(it===0){this.react(a,b);
              /* liquids: tiny sideways nudge so stacked drops slide off each other and the surface levels out */
              if((a.t==='water'||a.t==='lava')&&a.t===b.t&&Math.abs(ny)>0.6){const k=a.t==='water'?26:12,s=(Math.random()<0.5?-1:1)*k;a.vx+=s;b.vx-=s}}
          }}
      }
      for(const p of ps){
        for(const w of this.walls){const cx=Math.max(w.x,Math.min(p.x,w.x+w.w)),cy=Math.max(w.y,Math.min(p.y,w.y+w.h));let dx=p.x-cx,dy=p.y-cy,d=Math.hypot(dx,dy);
          if(d<R){if(d===0){dy=-1;dx=0;d=1}const nx=dx/d,ny=dy/d;p.x=cx+nx*R;p.y=cy+ny*R;this.bounce(p,nx,ny)}}
        for(const s of sol){const q=segDist(p.x,p.y,s.x1,s.y1,s.x2,s.y2),m=R+s.r;if(q.d<m){let nx=(p.x-q.cx)/(q.d||1),ny=(p.y-q.cy)/(q.d||1);if(!q.d){nx=0;ny=-1}p.x=q.cx+nx*m;p.y=q.cy+ny*m;this.bounce(p,nx,ny)}}
        for(const b of bodies){const cx=Math.max(b.x,Math.min(p.x,b.x+b.w)),cy=Math.max(b.y,Math.min(p.y,b.y+b.h));let dx=p.x-cx,dy=p.y-cy,d=Math.hypot(dx,dy);
          if(d<R+0.5){this.touch(p,b);if(p.dead)continue;if(d===0){dy=-1;d=1}const nx=dx/d,ny=dy/d;p.x=cx+nx*R;p.y=cy+ny*R;this.bounce(p,nx,ny)}}
      }
    }
    this.ps=ps.filter(p=>!p.dead&&p.y<700);
    this.bodiesStep(dt);
    if(this.state==='play'&&this.got>=this.target){this.winT=(this.winT||0)+dt;this.tgtT=(this.tgtT||0)+dt;if(this.winT>1.2||this.tgtT>4){this.state='win';this.events.push({e:'win'})}}
    if(this.state==='play'&&this.hero.alive){const h=this.hero;for(const p of this.ps)if(p.t==='gold'&&!p.dead&&p.x>h.x-18&&p.x<h.x+h.w+18&&p.y>h.y-56&&p.y<h.y+h.h+8){p.dead=true;this.got++;this.winT=0;this.events.push({e:'coin',x:p.x,y:p.y})}this.ps=this.ps.filter(p=>!p.dead)}
  }
  bounce(p,nx,ny){const vn=p.vx*nx+p.vy*ny;if(vn<0){p.vx-=vn*nx*1.1;p.vy-=vn*ny*1.1}const fr=p.t==='water'?0.9995:p.t==='lava'?0.995:p.t==='gold'?0.96:0.97;p.vx*=fr;p.vy*=fr}
  react(a,b){
    const pair=(t1,t2)=>(a.t===t1&&b.t===t2)||(a.t===t2&&b.t===t1);
    if(pair('water','lava')){a.t=b.t='stone';a.f=b.f=1.6;this.events.push({e:'steam',x:(a.x+b.x)/2,y:(a.y+b.y)/2})}
    else if(a.t==='stone'&&a.f>0&&b.t==='lava'){b.t='stone';b.f=1.6}
    else if(b.t==='stone'&&b.f>0&&a.t==='lava'){a.t='stone';a.f=1.6}
  }
  touch(p,b){
    if(b===this.hero){
      if(p.t==='gold'&&this.state==='play'){p.dead=true;this.got++;this.winT=0;this.events.push({e:'coin',x:p.x,y:p.y})}
      else if(p.t==='lava'&&this.state==='play'){this.lose('lava')}
    }else if(b===this.monster){
      if(p.t==='lava'||(p.t==='stone'&&p.vy>220)){b.alive=false;b.dead=1;this.events.push({e:'monster',x:b.x+b.w/2,y:b.y+b.h/2})}
    }
  }
  lose(r){if(this.state!=='play')return;this.state='lose';this.reason=r;this.hero.alive=r!=='lava'?true:false;this.events.push({e:'lose',r})}
  bodiesStep(dt){
    const m=this.monster;if(!m)return;
    if(!m.alive){if(m.dead>0)m.dead-=dt;return}
    for(const p of this.ps)if(p.t==='lava'&&p.x>m.x-20&&p.x<m.x+m.w+20&&p.y>m.y-22&&p.y<m.y+m.h+10){m.alive=false;m.dead=1;this.events.push({e:'monster',x:m.x+m.w/2,y:m.y+m.h/2});return}
    const g=this.groundAt(m);m.vy=(m.vy||0)+GRAV*dt;m.y+=m.vy*dt;if(m.y+m.h>=g){m.y=g-m.h;m.vy=0;m.ground=true}else m.ground=false;
    if(m.y>700){m.alive=false;return}
    const h=this.hero,a=[m.x+m.w/2,m.y+m.h*0.55],b=[h.x+h.w/2,h.y+h.h*0.5];
    if(m.ground&&this.state==='play'&&!this.blocked(a,b)){
      const dir=Math.sign(b[0]-a[0]);m.x+=dir*55*dt;m.walking=true;m.face=dir;
      const ng=this.groundAt(m);if(ng<m.y+m.h-14)m.x-=dir*55*dt;else if(ng<m.y+m.h)m.y=ng-m.h;
    }else m.walking=false;
    if(this.state==='play'&&m.x<h.x+h.w+2&&m.x+m.w>h.x-2&&m.y<h.y+h.h&&m.y+m.h>h.y)this.lose('monster');
  }
}
root.PinSim={Sim,LEVELS,R};
})(typeof window!=='undefined'?window:globalThis);
