// Запуск з кореня проєкту: node js/check-party.js   (або шлях до кореня першим аргументом)
const fs=require('fs'),vm=require('vm'); const root=process.argv[2]||'.';
const ctx={window:{}}; vm.createContext(ctx); vm.runInContext(fs.readFileSync(root+'/js/promts/party-seed.js','utf8'),ctx);
const S=ctx.window.PartySeed; const issues=[];
for(const [k,list] of Object.entries(S)){ const per={}; list.forEach(x=>per[x.level]=(per[x.level]||0)+1); console.log(k.padEnd(8),list.length,JSON.stringify(per));
  const seen=new Set(); list.forEach((x)=>{ if(!x.text||x.text.length>110) issues.push(k+': довге/порожнє: '+x.text); if(![1,2,3].includes(x.level)) issues.push(k+': рівень: '+x.text); if(seen.has(x.text)) issues.push(k+': дубль: '+x.text); seen.add(x.text); });
}
S.WHOFROM.forEach(x=>{ if(!/^Хто з нас .*\?$/.test(x.text)) issues.push('WHOFROM: формат: '+x.text); });
console.log(issues.length?issues.join('\n'):'проблем не знайдено');
