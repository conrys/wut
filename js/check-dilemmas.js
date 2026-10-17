// Запуск з кореня проєкту: node js/check-dilemmas.js   (або шлях до кореня першим аргументом)
const fs=require('fs'),vm=require('vm'); const root=process.argv[2]||'.';
const ctx={window:{}}; vm.createContext(ctx); vm.runInContext(fs.readFileSync(root+'/js/promts/dilemmas-seed.js','utf8'),ctx);
const {STATEMENTS:D,TASKS:T}=ctx.window.DilemmaSeed; const per=(a)=>{const o={};a.forEach(x=>o[x.level]=(o[x.level]||0)+1);return JSON.stringify(o);};
console.log('тверджень:',D.length,per(D),'| «Згоден/Не»:',D.filter(x=>x.kind==='agree').length,'| «Прийнятно/Не»:',D.filter(x=>x.kind==='ok').length,'| завдань:',T.length,per(T));
const issues=[];
D.forEach((d,i)=>{ if(!d.text) issues.push('порожнє твердження #'+i); else if(d.text.length>80) issues.push('довге ('+d.text.length+'): '+d.text); if(!['agree','ok'].includes(d.kind)) issues.push('kind #'+i); if(![1,2,3].includes(d.level)) issues.push('рівень #'+i); });
T.forEach((t)=>{ if(t.text.length>85) issues.push('довге завдання ('+t.text.length+'): '+t.text); });
const dup=(arr,k)=>{const s=new Set();arr.forEach(x=>{const v=k(x);if(s.has(v))issues.push('дубль: '+v);s.add(v);});}; dup(D,d=>d.text); dup(T,t=>t.text);
console.log(issues.length?issues.join('\n'):'проблем не знайдено');
