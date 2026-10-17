/* Parking (Rush Hour) core: generator + solver. Pure logic so it can be checked headlessly.
   Board N×N, exit on the right edge of row EXIT. Car 0 is red, horizontal, nose to the exit.
   Other cars only slide along their axis inside the lot — they never leave.
   A move = one car slides any distance. Moves are reversible, so every state reachable from a
   solved one is solvable; the generator picks the state farthest from the exit. */
(function(root){
const N=6,EXIT=2;
function rng(s){return()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const COLORS=['#2F80ED','#F2C94C','#27AE60','#9B51E0','#F2994A','#EB5FA8','#20B2AA','#FFFFFF','#3A3F4B','#8D6E63','#56CCF2','#B7D334'];
const RED='#E8453C';
/* fixed[i] = {h,len,line} (line = row for horizontal, column for vertical); pos[i] = coordinate along the axis */
function occ(fixed,pos){const g=new Int8Array(N*N).fill(-1);
  for(let i=0;i<fixed.length;i++){const f=fixed[i];for(let k=0;k<f.len;k++)g[f.h?f.line*N+pos[i]+k:(pos[i]+k)*N+f.line]=i}return g}
function range(fixed,pos,g,i){const f=fixed[i],at=f.h?(v=>g[f.line*N+v]):(v=>g[v*N+f.line]);
  let lo=pos[i],hi=pos[i];while(lo>0&&at(lo-1)<0)lo--;while(hi+f.len<N&&at(hi+f.len)<0)hi++;return[lo,hi]}
/* red can drive straight out */
function goal(fixed,pos,g){for(let x=pos[0]+fixed[0].len;x<N;x++)if(g[EXIT*N+x]>=0)return false;return true}
const key=p=>String.fromCharCode.apply(null,p.map(v=>v+48));

/* min number of moves to free the red car (the final drive-out not counted); -1 if impossible */
function solve(fixed,pos0,cap=200000){
  const seen=new Set([key(pos0)]);let cur=[pos0],d=0;
  while(cur.length){
    const next=[];
    for(const p of cur){const g=occ(fixed,p);if(goal(fixed,p,g))return d;
      for(let i=0;i<fixed.length;i++){const [lo,hi]=range(fixed,p,g,i);
        for(let v=lo;v<=hi;v++){if(v===p[i])continue;const q=p.slice();q[i]=v;const k=key(q);if(seen.has(k))continue;seen.add(k);next.push(q)}}}
    if(seen.size>cap)return-1;cur=next;d++;
  }
  return-1;
}

/* whole connected component from a start state; null if it is too big */
function component(fixed,start,cap){
  const states=[start],idx=new Map([[key(start),0]]),adj=[],isGoal=[];
  for(let s=0;s<states.length;s++){
    if(states.length>cap)return null;
    const p=states[s],g=occ(fixed,p),nb=[];isGoal.push(goal(fixed,p,g));
    for(let i=0;i<fixed.length;i++){const [lo,hi]=range(fixed,p,g,i);
      for(let v=lo;v<=hi;v++){if(v===p[i])continue;const q=p.slice();q[i]=v;const k=key(q);let j=idx.get(k);
        if(j===undefined){j=states.length;states.push(q);idx.set(k,j)}nb.push(j)}}
    adj.push(nb);
  }
  return{states,adj,isGoal};
}

function carsFor(level){return Math.min(13,4+Math.floor(level*0.6))}
function wantFor(level){return Math.min(40,2+Math.round(level*1.4))}

function generate(level){
  const R=rng(level*7717+5),nCars=carsFor(level),want=wantFor(level);
  let best=null;
  for(let attempt=0;attempt<24;attempt++){
    // solved layout: red at the exit, others random
    const fixed=[{h:true,len:2,line:EXIT}],pos=[N-2],taken=new Int8Array(N*N);taken[EXIT*N+N-2]=taken[EXIT*N+N-1]=1;
    for(let t=0;t<400&&fixed.length<nCars+1;t++){
      const h=R()<0.5,len=R()<0.3?3:2,line=Math.floor(R()*N),p=Math.floor(R()*(N-len+1));
      if(h&&line===EXIT)continue; // no trucks in the red car's lane
      const cs=[];for(let k=0;k<len;k++)cs.push(h?line*N+p+k:(p+k)*N+line);
      if(cs.some(c=>taken[c]))continue;cs.forEach(c=>taken[c]=1);fixed.push({h,len,line});pos.push(p);
    }
    const comp=component(fixed,pos,60000);if(!comp)continue;
    // distance from every state to the nearest solved state
    const dist=new Int16Array(comp.states.length).fill(-1);let q=[];
    comp.isGoal.forEach((g,i)=>{if(g){dist[i]=0;q.push(i)}});
    let maxD=0;
    while(q.length){const nq=[];for(const s of q)for(const j of comp.adj[s])if(dist[j]<0){dist[j]=dist[s]+1;nq.push(j);if(dist[j]>maxD)maxD=dist[j]}q=nq}
    if(maxD<1)continue;
    const target=Math.min(want,maxD),pool=[];for(let i=0;i<dist.length;i++)if(dist[i]===target)pool.push(i);
    const pick=comp.states[pool[Math.floor(R()*pool.length)]];
    const lv={fixed,pos:pick.slice(),par:target+1};
    if(!best||target>best.par-1)best=lv;
    if(target>=want)break;
  }
  if(!best)best={fixed:[{h:true,len:2,line:EXIT},{h:false,len:2,line:5}],pos:[0,1],par:2}; // never expected
  const cars=best.fixed.map((f,i)=>({h:f.h,len:f.len,x:f.h?best.pos[i]:f.line,y:f.h?f.line:best.pos[i],
    nose:i===0?1:(f.h?1:-1)*(R()<0.5?1:-1),red:i===0,color:i===0?RED:COLORS[(i-1)%COLORS.length]}));
  return{N,EXIT,cars,par:best.par};
}

/* validator for a generated level: returns the minimal number of moves including the drive-out, or -1 */
function validate(lv){
  const fixed=lv.cars.map(c=>({h:c.h,len:c.len,line:c.h?c.y:c.x})),pos=lv.cars.map(c=>c.h?c.x:c.y);
  if(!lv.cars[0].red||!lv.cars[0].h||lv.cars[0].y!==EXIT)return-1;
  const d=solve(fixed,pos);return d<0?-1:d+1;
}
/* заготовлений рівень із levels.js: "H222V302…" → машини */
function decode(code,par,level){
  const R=rng(level*31+1),cars=[];
  for(let i=0;i<code.length;i+=4){const h=code[i]==='H',len=+code[i+1],line=+code[i+2],p=+code[i+3],k=cars.length;
    cars.push({h,len,x:h?p:line,y:h?line:p,nose:k===0?1:(R()<0.5?1:-1),red:k===0,color:k===0?RED:COLORS[(k-1)%COLORS.length]})}
  return{N,EXIT,cars,par};
}
root.ParkCore={N,EXIT,generate,validate,decode,solve,occ,range,goal};
})(typeof window!=='undefined'?window:globalThis);
