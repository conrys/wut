const fs=require('fs'),vm=require('vm');
// Запуск з кореня проєкту: node tools/check-seed.js   (або вкажи кореню шлях аргументом)
const root=process.argv[2]||'.';
const ctx={window:{}}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(root+'/js/fact-seed.js','utf8'),ctx);
vm.runInContext(fs.readFileSync(root+'/js/fact-pool.js','utf8'),ctx);
const S=ctx.window.FactSeed, F=ctx.window.FactPool;
const per={}; S.forEach(s=>per[s.level]=(per[s.level]||0)+1);
console.log('всього',S.length,'| за рівнями',JSON.stringify(per));
const issues=[];
S.forEach((s,i)=>{ const t=s.text;
  if(t.length>56) issues.push(`довга (${t.length}): ${t}`);
  if(/^(я|не)(\s|$)/i.test(t)) issues.push(`починається з я/не: ${t}`);
  if(/(^|[\s,.«»])не([\s,.«»]|$)/i.test(t)) issues.push(`містить «не» (подвійне заперечення з «ніколи не»?): ${t}`);
  if(t!==t.trim()||/[A-Z]/.test(t[0])) issues.push(`регістр/пробіли: ${t}`);
  if(!/(в|вся)$/.test(t.split(' ')[0].replace(/,$/,''))) issues.push(`перше слово не схоже на минулий час: ${t}`);
});
// дублі й близькі фрази
for(let i=0;i<S.length;i++)for(let j=i+1;j<S.length;j++){const sc=F.wordOverlapScore(S[i].text,S[j].text); if(sc>=0.5) issues.push(`схожі (${sc.toFixed(2)}): «${S[i].text}» ~ «${S[j].text}»`);}
const exact=S.length-new Set(S.map(s=>s.text)).size; if(exact) issues.push('точні дублі: '+exact);
console.log(issues.length?issues.join('\n'):'проблем не знайдено');
process.exit(0);
