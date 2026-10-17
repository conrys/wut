/* Parking Jam core: board generator + solvability check. A car slides along its axis;
   if nothing is in the way it leaves the lot. Removing a car never blocks anything,
   so "keep removing any car with a clear lane" is a complete solvability test. */
(function(root){
function rng(s){return()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const cells=c=>{const o=[];for(let k=0;k<c.len;k++)o.push(c.h?[c.x+k,c.y]:[c.x,c.y+k]);return o};
function grid(C,R,cars){const g=Array.from({length:R},()=>new Array(C).fill(-1));cars.forEach((c,i)=>{if(!c.gone)for(const [x,y] of cells(c))g[y][x]=i});return g}
/* how far a car can slide in direction s (+1/-1); returns {steps, exits} */
function slide(C,R,g,c,s){
  let steps=0;
  for(;;){
    const hx=c.h?(s>0?c.x+c.len-1+steps+1:c.x-steps-1):c.x,hy=c.h?c.y:(s>0?c.y+c.len-1+steps+1:c.y-steps-1);
    if(hx<0||hy<0||hx>=C||hy>=R)return{steps,exits:true};
    if(g[hy][hx]!==-1)return{steps,exits:false,hit:g[hy][hx]};
    steps++;
  }
}
function solveRounds(C,R,cars0){
  const cars=cars0.map(c=>Object.assign({},c));let left=cars.length,rounds=0;
  while(left){
    const g=grid(C,R,cars),out=[];
    cars.forEach((c,i)=>{if(!c.gone&&(slide(C,R,g,c,1).exits||slide(C,R,g,c,-1).exits))out.push(i)});
    if(!out.length)return-1;
    for(const i of out)cars[i].gone=true;left-=out.length;rounds++;
  }
  return rounds;
}
const COLORS=['#E8453C','#2F80ED','#F2C94C','#27AE60','#9B51E0','#F2994A','#EB5FA8','#20B2AA','#FFFFFF','#3A3F4B'];
function generate(level){
  const C=Math.min(8,5+Math.floor((level-1)/3)),R=Math.min(10,6+Math.floor((level-1)/2));
  const R_=rng(level*7717+5),need=Math.min(6,2+Math.floor(level/2)),density=Math.min(0.78,0.58+level*0.012);
  let best=null;
  for(let attempt=0;attempt<400;attempt++){
    const cars=[],occ=Array.from({length:R},()=>new Array(C).fill(false));let filled=0;
    for(let t=0;t<600&&filled<C*R*density;t++){
      const h=R_()<0.5,len=R_()<0.18?3:2,x=Math.floor(R_()*(h?C-len+1:C)),y=Math.floor(R_()*(h?R:R-len+1));
      const c={x,y,len,h,nose:R_()<0.5?1:-1};
      if(cells(c).some(([a,b])=>occ[b][a]))continue;
      for(const [a,b] of cells(c))occ[b][a]=true;filled+=len;c.color=COLORS[cars.length%COLORS.length];cars.push(c);
    }
    const r=solveRounds(C,R,cars);
    if(r>=need){return{C,R,cars,rounds:r}}
    if(r>0&&(!best||r>best.rounds))best={C,R,cars,rounds:r};
  }
  return best;
}
root.ParkCore={generate,slide,grid,cells,solveRounds};
})(typeof window!=='undefined'?window:globalThis);
