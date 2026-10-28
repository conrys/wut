/* Тихо-голосно — дві довгі арени: «Спортзал» і «Двір». Додаються до списку карт Хованок (../khovanky/world.js)
   лише на сторінці цієї гри; сама гра бере тільки карти з arena:1. Лялька стоїть на півночі (мале z), старт — на півдні.
   Високі меблі (tall:1) — укриття: за ними лялька не бачить, і рухатися можна навіть на «червоне». */
(function(){
const HW=window.HNSWorld;if(!HW)return;
function arena(ch,W,H){const g=[];for(let z=0;z<H;z++)g.push((z===0||z===H-1?'#'.repeat(W):'#'+ch.repeat(W-2)+'#'));return g}
const W=14,H=44,FIN=4.6,START=H-4.5;
const line=(z,c,c2)=>({t:'rug',x:W/2,z,w:W-2.2,d:0.55,c,c2,flat:1});

/* ---------- Спортзал ---------- */
const GYM=[line(FIN,'#FFFFFF','#E8453C'),line(START,'#FFFFFF','#3D7BE0'),
  {t:'rug',x:W/2,z:24,w:4,d:4,c:'#E9D9B5',c2:'#C9A06A',flat:1},
  // укриття — козли й стоси матів (високі), шаховим порядком
  {t:'pallet',x:3.4,z:35,w:1.6,d:0.9,tall:1},{t:'pallet',x:10.6,z:31,w:1.6,d:0.9,tall:1},{t:'pallet',x:7,z:27,w:1.6,d:0.9,tall:1},
  {t:'pallet',x:3,z:21,w:1.6,d:0.9,tall:1},{t:'pallet',x:11,z:17.5,w:1.6,d:0.9,tall:1},{t:'pallet',x:6.6,z:13,w:1.6,d:0.9,tall:1},
  {t:'pallet',x:10,z:8.6,w:1.4,d:0.8,tall:1},
  // низькі лави — не ховають, лише заважають
  {t:'bench',x:8.6,z:37,w:2.4,d:0.5},{t:'bench',x:4.6,z:30,w:2.4,d:0.5},{t:'bench',x:9.4,z:22.6,w:2.4,d:0.5},{t:'bench',x:4.4,z:10.6,w:2.4,d:0.5},
  {t:'ball',x:1.7,z:29},{t:'ball',x:12.3,z:15},{t:'ball',x:1.8,z:16.4},{t:'boxes',x:12.2,z:39,w:1.2,d:0.8}];
HW.MAPS.push({id:'gym',name:'Спортзал',arena:1,rows:arena('g',W,H),floor:{g:['#D9B07E','#CDA372','wood']},furn:GYM,grass:'#9AA7AE',spawn:[W/2,START+1.5],noHide:'',fin:FIN,start:START,rooms:{g:'Спортзал'}});

/* ---------- Двір ---------- */
const YARD=[line(FIN,'#FFFFFF','#E8453C'),line(START,'#FFFFFF','#3D7BE0'),
  {t:'rug',x:W/2,z:20,w:11,d:2.4,c:'#C9B79A',c2:'#B5A383',flat:1},
  // укриття — стоси ящиків, намет, візки
  {t:'pallet',x:10.8,z:36,w:1.6,d:0.9,tall:1},{t:'tent',x:3.6,z:32,w:1.6,d:1.6,tall:1},{t:'pallet',x:8.4,z:28,w:1.4,d:0.9,tall:1},
  {t:'pallet',x:3,z:24,w:1.6,d:0.9,tall:1},{t:'tent',x:10.6,z:19.6,w:1.6,d:1.6,tall:1},{t:'pallet',x:5.4,z:15,w:1.6,d:0.9,tall:1},
  {t:'pallet',x:11,z:11,w:1.4,d:0.9,tall:1},{t:'pallet',x:3.4,z:8.4,w:1.4,d:0.8,tall:1},
  {t:'cart',x:6.6,z:34,w:0.6,d:0.9},{t:'cart',x:7.6,z:16.8,w:0.6,d:0.9,r:1},{t:'boxes',x:12,z:26,w:1,d:0.8},{t:'boxes',x:2,z:13,w:1,d:0.8,alt:1},
  {t:'plant',x:1.7,z:38,big:1},{t:'plant',x:12.3,z:23},{t:'plant',x:1.7,z:19},{t:'plant',x:12.3,z:7}];
HW.MAPS.push({id:'yard',name:'Двір',arena:1,rows:arena('y',W,H),floor:{y:['#A6D58E','#9CCB84','carpet']},furn:YARD,grass:'#7DB861',spawn:[W/2,START+1.5],noHide:'',fin:FIN,start:START,rooms:{y:'Двір'}});
})();
