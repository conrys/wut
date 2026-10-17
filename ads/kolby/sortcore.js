/* Colour-sort core: level generator + solver. Pure logic so it can be checked headlessly.
   A tube is an array of colour indices, bottom → top. */
(function(root){
const CAP=4;
function rng(s){return()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const topRun=t=>{if(!t.length)return 0;let n=1;while(n<t.length&&t[t.length-1-n]===t[t.length-1])n++;return n};
const done=t=>t.length===0||(t.length===CAP&&topRun(t)===CAP);
const solved=ts=>ts.every(done);
function canPour(ts,i,j){
  const a=ts[i],b=ts[j];
  if(i===j||!a.length||b.length>=CAP)return 0;
  if(b.length&&b[b.length-1]!==a[a.length-1])return 0;
  return Math.min(topRun(a),CAP-b.length);
}
function pour(ts,i,j){const n=canPour(ts,i,j);for(let k=0;k<n;k++)ts[j].push(ts[i].pop());return n}
const key=ts=>ts.map(t=>t.join(',')).sort().join('|');

/* depth-first search with a visited set; returns the move list or null */
function solve(start,limit=250000){
  const seen=new Set([key(start)]);const stack=[{ts:start.map(t=>t.slice()),path:[]}];let nodes=0;
  while(stack.length){
    const {ts,path}=stack.pop();if(solved(ts))return path;
    if(++nodes>limit)return null;
    const moves=[];
    for(let i=0;i<ts.length;i++){
      if(done(ts[i]))continue;
      for(let j=0;j<ts.length;j++){
        const n=canPour(ts,i,j);if(!n)continue;
        if(!ts[j].length&&topRun(ts[i])===ts[i].length)continue; // moving a whole uniform tube into an empty one gains nothing
        const score=(ts[j].length?2:0)+(ts[j].length+n===CAP&&ts[j].length?3:0)+(n===topRun(ts[i])?1:0);
        moves.push([score,i,j]);
      }
    }
    moves.sort((a,b)=>a[0]-b[0]); // best move last → popped first
    for(const [,i,j] of moves){const nt=ts.map(t=>t.slice());pour(nt,i,j);const k=key(nt);if(seen.has(k))continue;seen.add(k);stack.push({ts:nt,path:path.concat([[i,j]])})}
  }
  return null;
}
function colorsFor(level){return Math.min(11,3+Math.floor((level-1)/2))}
function generate(level){
  const n=colorsFor(level),R=rng(level*1013+7);
  for(let attempt=0;attempt<60;attempt++){
    const pool=[];for(let c=0;c<n;c++)for(let k=0;k<CAP;k++)pool.push(c);
    for(let i=pool.length-1;i>0;i--){const j=Math.floor(R()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]]}
    const ts=[];for(let t=0;t<n;t++)ts.push(pool.slice(t*CAP,t*CAP+CAP));
    if(ts.some(t=>topRun(t)>=3))continue;
    ts.push([],[]);
    const sol=solve(ts);if(sol)return{tubes:ts,par:sol.length};
  }
  throw new Error('no level');
}
root.SortCore={CAP,generate,solve,canPour,pour,done,solved,topRun,colorsFor};
})(typeof window!=='undefined'?window:globalThis);
