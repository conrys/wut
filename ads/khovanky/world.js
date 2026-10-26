/* Хованки — world: map, merged toon-shaded static geometry, furniture models, collision boxes,
   vision-blocking segments and the walk grid. Everything static lives in ONE mesh. */
(function(){
const T3=THREE;
const HOUSE_ROWS=[
"######################",
"#kkkkkk#llllllll#bbbb#",
"#kkkkkk#llllllll#bbbb#",
"#kkkkkkkllllllll#bbbb#",
"#kkkkkkkllllllllbbbbb#",
"#kkkkkk#llllllllbbbbb#",
"#kkkkkk#llllllll#bbbb#",
"###kk#####lll#####bb##",
"#hhhhhhhhhhhhhhhhhhhh#",
"#hhhhhhhhhhhhhhhhhhhh#",
"###tt####hh#####ss####",
"#tttttt#dddddd#ssssss#",
"#tttttttdddddd#ssssss#",
"#ttttttdddddddsssssss#",
"#tttttt#ddddddsssssss#",
"#tttttt#dddddd#ssssss#",
"######################"];
const ROOMS={k:'Кухня',l:'Вітальня',b:'Спальня',h:'Коридор',t:'Ванна',d:'Їдальня',s:'Дитяча'};
const HOUSE_FLOOR={k:['#EEF2F4','#D9E1E7','tile'],l:['#CFA272','#C49465','wood'],b:['#EDC3CB','#E6B7C0','carpet'],h:['#DDBA90','#D3AE83','wood'],
  t:['#C6E8F1','#AEDCEA','tile'],d:['#B07E55','#A4724A','wood'],s:['#C7EBBB','#BCE2AF','carpet']};
/* furniture: centre x,z (world units = tiles), footprint w×d, rot in quarter turns, tall = blocks the seeker's view */
const HOUSE_FURN=[
  {t:'counter',x:3.5,z:1.38,w:5,d:0.72},{t:'fridge',x:6.5,z:1.42,w:0.9,d:0.8,tall:1},
  {t:'table',x:3.6,z:4.2,w:2.0,d:1.1,c:'#D9B48A'},{t:'chair',x:2.9,z:3.35,r:0,c:'#7FB7A4'},{t:'chair',x:4.3,z:3.35,r:0,c:'#7FB7A4'},{t:'chair',x:2.9,z:5.05,r:2,c:'#7FB7A4'},{t:'chair',x:4.3,z:5.05,r:2,c:'#7FB7A4'},
  {t:'tallcab',x:1.3,z:4.4,w:0.55,d:1.4,tall:1,c:'#9FC7B6'},{t:'plant',x:1.5,z:6.45},{t:'plant',x:6.5,z:6.45,big:1},
  {t:'rug',x:11.5,z:3.3,w:4.2,d:2.8,c:'#E9D9B5',c2:'#D97B5E',flat:1},
  {t:'tvstand',x:11.5,z:1.35,w:2.4,d:0.6},{t:'bookshelf',x:15.6,z:2.5,w:0.6,d:2.0,tall:1,r:0},
  {t:'sofa',x:11.5,z:4.65,w:3.0,d:0.95,r:2,c:'#6F8FD8'},{t:'coffee',x:11.5,z:3.2,w:1.4,d:0.7},
  {t:'armchair',x:9.0,z:3.3,w:0.95,d:0.95,r:1,c:'#E8A25C'},{t:'plant',x:8.6,z:1.55,big:1},{t:'plant',x:15.4,z:6.4},{t:'lamp',x:14.2,z:5.0},
  {t:'rug',x:18.6,z:4.9,w:2.2,d:1.6,c:'#FFF4E6',c2:'#E6A5B4',flat:1},
  {t:'bed',x:18.2,z:2.4,w:1.8,d:2.6,c:'#F2A0B4'},{t:'nightstand',x:19.75,z:1.5,w:0.6,d:0.55},
  {t:'wardrobe',x:20.6,z:4.6,w:0.7,d:1.8,tall:1,r:2},
  {t:'bench',x:6.0,z:8.32,w:1.6,d:0.5},{t:'plant',x:1.5,z:8.5,big:1},{t:'plant',x:20.5,z:9.5,big:1},{t:'shoecab',x:13.5,z:9.68,w:1.2,d:0.5,r:2},
  {t:'rug',x:11,z:9,w:5,d:1.3,c:'#C9E3F5',c2:'#5B8FC9',flat:1},
  {t:'bathtub',x:1.75,z:13.5,w:1.3,d:2.6},{t:'toilet',x:3.6,z:11.55,w:0.7,d:0.62},{t:'sink',x:6.2,z:11.4,w:0.9,d:0.5},
  {t:'tallcab',x:6.6,z:15.3,w:0.6,d:1.2,tall:1,c:'#FFFFFF',r:2},{t:'washer',x:3.6,z:15.55,w:0.8,d:0.7,r:2},
  {t:'rug',x:4.2,z:13.4,w:1.4,d:1.0,c:'#FFFFFF',c2:'#7CC3D9',flat:1},
  {t:'table',x:11,z:13.4,w:2.6,d:1.35,c:'#8F5E3B',big:1},{t:'chair',x:10.2,z:12.5,r:0,c:'#E7D2B0'},{t:'chair',x:11.8,z:12.5,r:0,c:'#E7D2B0'},{t:'chair',x:10.2,z:14.3,r:2,c:'#E7D2B0'},{t:'chair',x:11.8,z:14.3,r:2,c:'#E7D2B0'},
  {t:'tallcab',x:8.35,z:15.0,w:0.6,d:1.5,tall:1,c:'#C99A6B'},{t:'plant',x:13.5,z:15.5,big:1},{t:'plant',x:13.5,z:11.5},
  {t:'bunk',x:20.1,z:12.6,w:1.6,d:2.4,tall:1},{t:'tent',x:17.6,z:15.1,w:1.4,d:1.4,tall:1,r:2},{t:'toybox',x:15.6,z:13.0,w:0.6,d:1.0},
  {t:'ball',x:18.2,z:13.4},{t:'desk',x:19.9,z:15.5,w:1.1,d:0.6,r:2},{t:'rug',x:17.4,z:12.7,w:2.0,d:2.0,c:'#FFE8A3',c2:'#F29E4C',flat:1,round:1},
];
const MARKET_ROWS=[
"########################",
"#wwwwwwwww#ooooo#cccccc#",
"#wwwwwwwwwwoooooccccccc#",
"#wwwwwwwwwwoooooccccccc#",
"#wwwwwwwww#ooooo#cccccc#",
"####mm#######mm#####cc##",
"#mmmmmmmmmmmmmmmmmmmmmm#",
"#mmmmmmmmmmmmmmmmmmmmmm#",
"#mmmmmmmmmmmmmmmmmmmmmm#",
"#mmmmmmmmmmmmmmmmmmmmmm#",
"#mmmmmmmmmmmmmmmmmmmmmm#",
"#mmmmmmmmmmmmmmmmmmmmmm#",
"#mmmmmmmmmmmmmmmmmmmmmm#",
"#mmmmmmmmmmmmmmmmmmmmmm#",
"#eeeeeeeeeeeeeeeeeeeeee#",
"#eeeeeeeeeeeeeeeeeeeeee#",
"#eeeeeeeeeeeeeeeeeeeeee#",
"########################"];
const MARKET_FLOOR={w:['#B9BCC2','#AEB2B8','tile'],o:['#9DB4CF','#93AAC6','carpet'],c:['#C99B6D','#BF905F','wood'],m:['#F3F2EC','#E3E5DF','tile'],e:['#D6DBE2','#C8CED7','tile']};
const SHELF_X=[3.5,7,10.5,14,17.5];
const MARKET_FURN=[
  ...SHELF_X.flatMap((x,i)=>[{t:'shelf',x,z:8.35,w:0.9,d:2.1,tall:1,seed:i*2},{t:'shelf',x,z:11.45,w:0.9,d:2.1,tall:1,seed:i*2+1}]),
  {t:'fridgewall',x:22.6,z:9.9,w:0.7,d:5.4,tall:1,r:2},{t:'freezer',x:20.4,z:9.9,w:1.0,d:3.4},
  {t:'fruit',x:6.5,z:12.96,w:2.2,d:0.9},{t:'fruit',x:14.5,z:12.96,w:2.2,d:0.9,alt:1},
  {t:'checkout',x:5,z:15.2,w:0.8,d:2.0},{t:'checkout',x:10,z:15.2,w:0.8,d:2.0},{t:'checkout',x:15,z:15.2,w:0.8,d:2.0},
  {t:'chair',x:5.64,z:15.6,r:3,c:'#E8453C'},{t:'chair',x:10.64,z:15.6,r:3,c:'#E8453C'},{t:'chair',x:15.64,z:15.6,r:3,c:'#E8453C'},
  {t:'cart',x:19.8,z:15.9,w:0.6,d:0.9},{t:'cart',x:20.41,z:15.9,w:0.6,d:0.9},{t:'cart',x:21.02,z:15.9,w:0.6,d:0.9},{t:'cart',x:12.8,z:7.0,w:0.6,d:0.9,r:1},
  {t:'plant',x:1.6,z:16.4,big:1},{t:'plant',x:22.4,z:14.4,big:1},
  {t:'rug',x:12,z:16.55,w:5,d:0.8,c:'#6B7A8F',c2:'#3E4A5C',flat:1},
  {t:'pallet',x:2.4,z:2.2,w:1.4,d:1.4,tall:1},{t:'pallet',x:5.2,z:1.9,w:1.4,d:1.2,tall:1,low:1},{t:'pallet',x:8.6,z:2.4,w:1.4,d:1.4,tall:1},
  {t:'boxes',x:3.2,z:4.4,w:1.2,d:0.8},{t:'boxes',x:7.6,z:4.5,w:1.0,d:0.8,alt:1},{t:'tallcab',x:10.6,z:1.7,w:0.55,d:1.2,tall:1,c:'#7E8794',r:2},
  {t:'desk',x:13.2,z:1.45,w:1.6,d:0.7},{t:'chair',x:13.2,z:1.97,r:2,c:'#3A3F4B'},{t:'tallcab',x:15.6,z:2.9,w:0.6,d:1.2,tall:1,c:'#B9C2CB',r:2},{t:'cooler',x:11.6,z:4.4},{t:'plant',x:15.4,z:1.5},
  {t:'rug',x:13.4,z:3.2,w:2.6,d:1.6,c:'#C9D6E8',c2:'#5B6F8C',flat:1},
  {t:'counter',x:20,z:1.38,w:4,d:0.72},{t:'cafetable',x:18.6,z:3.4,c:'#FFFFFF'},{t:'cafetable',x:21.5,z:3.3,c:'#FFFFFF'},
  {t:'chair',x:18.0,z:3.4,r:1,c:'#F2994A'},{t:'chair',x:19.2,z:3.4,r:3,c:'#F2994A'},{t:'chair',x:21.5,z:2.62,r:0,c:'#27AE60'},
];
/* ---------- Школа: клас, бібліотека, вчительська, коридор, спортзал, їдальня, медпункт ---------- */
const SCHOOL_ROWS=[
"########################",
"#cccccccc#llllll#vvvvvv#",
"#cccccccc#llllll#vvvvvv#",
"#ccccccccclllllllvvvvvv#",
"#ccccccccclllllllvvvvvv#",
"#cccccccc#llllll#vvvvvv#",
"####cc######ll#####vv###",
"#hhhhhhhhhhhhhhhhhhhhhh#",
"#hhhhhhhhhhhhhhhhhhhhhh#",
"####gg######ff#####aa###",
"#gggggggggg#ffffff#aaaa#",
"#gggggggggg#ffffff#aaaa#",
"#ggggggggggfffffffaaaaa#",
"#ggggggggggfffffffaaaaa#",
"#gggggggggg#ffffff#aaaa#",
"#gggggggggg#ffffff#aaaa#",
"########################"];
const SCHOOL_FLOOR={c:['#D9B07E','#CDA372','wood'],l:['#B7C9A8','#AABD9B','carpet'],v:['#C9B8E0','#BDABD6','carpet'],h:['#E4E7EA','#D3D8DD','tile'],
  g:['#E8C48A','#DDB77D','wood'],f:['#F2EBDD','#E3D9C6','tile'],a:['#DFF1F4','#CFE6EB','tile']};
const SCHOOL_FURN=[
  // клас: дошка по центру, стіл учителя збоку; два ряди парт, стільці впритул, між рядами й біля стін — проходи 0.65+
  {t:'tvstand',x:4.0,z:1.25,w:1.6,d:0.4},{t:'desk',x:7.7,z:1.9,w:1.2,d:0.6,r:2},{t:'chair',x:7.7,z:1.25,r:0,c:'#3A3F4B'},
  ...[2.65,4.65,6.65].flatMap((x)=>[{t:'desk',x,z:2.7,w:1.1,d:0.6},{t:'chair',x,z:3.22,r:2,c:'#5B8FC9'},{t:'desk',x,z:4.4,w:1.1,d:0.6},{t:'chair',x,z:4.92,r:2,c:'#5B8FC9'}]),
  {t:'plant',x:8.4,z:5.5,big:1},
  {t:'tallcab',x:10.6,z:5.2,w:0.6,d:1.4,tall:1,c:'#8B5E3C'},{t:'tallcab',x:15.4,z:5.2,w:0.6,d:1.4,tall:1,c:'#8B5E3C'},
  {t:'bookshelf',x:13.0,z:1.32,w:2.0,d:0.5,tall:1},{t:'table',x:13,z:4.0,w:1.8,d:1.0,c:'#C9A27A'},
  {t:'chair',x:12.4,z:3.25,r:0,c:'#7FB7A4'},{t:'chair',x:13.6,z:3.25,r:0,c:'#7FB7A4'},{t:'chair',x:12.4,z:4.75,r:2,c:'#7FB7A4'},{t:'chair',x:13.6,z:4.75,r:2,c:'#7FB7A4'},
  {t:'plant',x:15.5,z:1.5},
  {t:'sofa',x:20,z:1.55,w:2.6,d:0.9,r:0,c:'#8F6FD8'},{t:'coffee',x:20,z:3.05,w:1.2,d:0.6},{t:'cafetable',x:19.4,z:4.75,c:'#FFFFFF'},
  {t:'chair',x:18.8,z:4.75,r:1,c:'#F2994A'},{t:'chair',x:20.0,z:4.75,r:3,c:'#F2994A'},{t:'tallcab',x:22.6,z:4.3,w:0.55,d:1.4,tall:1,c:'#B9C2CB',r:2},
  {t:'plant',x:17.6,z:1.6},{t:'lamp',x:22.4,z:1.6},{t:'rug',x:20,z:3.3,w:3,d:1.8,c:'#EDE3F7',c2:'#8F6FD8',flat:1},
  {t:'bench',x:7,z:7.35,w:1.6,d:0.5},{t:'bench',x:16,z:7.35,w:1.6,d:0.5},{t:'plant',x:1.6,z:8.4,big:1},{t:'plant',x:22.4,z:8.4,big:1},
  {t:'shoecab',x:9.5,z:8.68,w:1.2,d:0.5,r:2},{t:'shoecab',x:16.5,z:8.68,w:1.2,d:0.5,r:2},
  {t:'rug',x:5.5,z:13,w:4,d:2.5,c:'#4C8DFF',c2:'#2A5FC4',flat:1},{t:'ball',x:3,z:11.5},{t:'ball',x:8.5,z:15},
  {t:'boxes',x:9.5,z:11.2,w:1.0,d:0.8},{t:'pallet',x:2,z:15.3,w:1.4,d:1.2,tall:1,low:1},{t:'bench',x:5.5,z:15.6,w:2.4,d:0.5},
  {t:'tallcab',x:10.5,z:15,w:0.55,d:1.4,tall:1,c:'#7E8794'},
  {t:'counter',x:16,z:10.38,w:3,d:0.72},
  ...[[13.6,12.6],[16.3,12.6],[13.6,15],[16.3,15]].flatMap(([x,z])=>[{t:'cafetable',x,z,c:'#FFFFFF'},{t:'chair',x:x-0.6,z,r:1,c:'#E8453C'},{t:'chair',x:x+0.6,z,r:3,c:'#E8453C'}]),
  {t:'plant',x:17.5,z:15.6},
  {t:'bed',x:21.5,z:12.2,w:1.6,d:2.4,c:'#FFFFFF'},{t:'sink',x:19.6,z:15.6,w:0.9,d:0.5,r:2},{t:'tallcab',x:22.6,z:15,w:0.55,d:1.4,tall:1,c:'#FFFFFF',r:2},
  {t:'plant',x:22.5,z:10.6},
];
/* ---------- Дача: сад, теплиця, сарай, веранда, спальня, кухня ---------- */
const DACHA_ROWS=[
"######################",
"#yyyyyyyyyyy#pppppppp#",
"#yyyyyyyyyyyypppppppp#",
"#yyyyyyyyyyyypppppppp#",
"#yyyyyyyyyyy#pppppppp#",
"#yyyyyyyyyyy#pppppppp#",
"#yyyyyyyyyyy####pp####",
"#yyyyyyyyyyy#uuuuuuuu#",
"#yyyyyyyyyyyyuuuuuuuu#",
"#yyyyyyyyyyyyuuuuuuuu#",
"#####rr#######uu######",
"#rrrrrrr#nnnn#kkkkkkk#",
"#rrrrrrrrnnnnkkkkkkkk#",
"#rrrrrrrrnnnnkkkkkkkk#",
"#rrrrrrr#nnnn#kkkkkkk#",
"#rrrrrrr#nnnn#kkkkkkk#",
"######################"];
const DACHA_FLOOR={y:['#8CC56E','#7FBA62','carpet'],p:['#D9E8C8','#CCDDB9','tile'],u:['#A08060','#94755A','wood'],r:['#D7B489','#CDA97D','wood'],
  n:['#E7D3F0','#DCC6E8','carpet'],k:['#F3EEDF','#E5DFCC','tile']};
const DACHA_FURN=[
  {t:'plant',x:2,z:2,big:1},{t:'plant',x:5,z:1.6,big:1},{t:'plant',x:9.5,z:2.2,big:1},{t:'plant',x:2,z:8.5,big:1},{t:'plant',x:6,z:6,big:1},{t:'plant',x:10.5,z:8.8,big:1},
  {t:'bench',x:7,z:4.5,w:1.6,d:0.5},{t:'cafetable',x:4,z:5,c:'#FFFFFF'},{t:'chair',x:3.4,z:5,r:1,c:'#27AE60'},{t:'chair',x:4.6,z:5,r:3,c:'#27AE60'},
  {t:'tent',x:9.5,z:5.5,w:1.4,d:1.4,tall:1},{t:'ball',x:7.5,z:8},
  {t:'rug',x:3,z:8,w:2.2,d:1.2,c:'#7A5A3C',c2:'#5E8C3A',flat:1},{t:'rug',x:8.5,z:2.6,w:2.0,d:1.0,c:'#7A5A3C',c2:'#5E8C3A',flat:1},
  {t:'fruit',x:15.5,z:2.2,w:2.2,d:0.9},{t:'fruit',x:19,z:2.2,w:2.2,d:0.9,alt:1},
  {t:'plant',x:14,z:4.6},{t:'plant',x:16,z:5.0,big:1},{t:'plant',x:20.4,z:4.6,big:1},
  {t:'boxes',x:14.2,z:7.6,w:1.0,d:0.8},{t:'pallet',x:20,z:7.8,w:1.4,d:1.2,tall:1,low:1},{t:'tallcab',x:20.6,z:9.52,w:0.55,d:0.9,tall:1,c:'#7E8794',r:2},
  {t:'cooler',x:17.8,z:9.5},
  {t:'sofa',x:4,z:15.5,w:2.6,d:0.9,r:2,c:'#D98A5E'},{t:'coffee',x:4,z:14,w:1.2,d:0.6},{t:'armchair',x:1.6,z:12,w:0.95,d:0.95,r:1,c:'#E8C25C'},
  {t:'plant',x:7.4,z:11.6,big:1},{t:'lamp',x:7.4,z:15.4},{t:'rug',x:4,z:13.6,w:3.2,d:2,c:'#F3E3C3',c2:'#C97B4E',flat:1},
  {t:'bed',x:10.9,z:12.1,w:1.8,d:2.0,c:'#9BC4E8'},{t:'nightstand',x:12.1,z:11.5,w:0.55,d:0.5},
  {t:'tallcab',x:12.6,z:15.2,w:0.55,d:1.4,tall:1,c:'#C99A6B'},{t:'desk',x:10,z:15.5,w:1.1,d:0.6,r:2},{t:'chair',x:10,z:15.08,r:0,c:'#7FB7A4'},
  {t:'table',x:17,z:13.7,w:2.0,d:1.1,c:'#D9B48A'},{t:'chair',x:16.3,z:12.85,r:0,c:'#E7D2B0'},{t:'chair',x:17.7,z:12.85,r:0,c:'#E7D2B0'},
  {t:'chair',x:16.3,z:14.45,r:2,c:'#E7D2B0'},{t:'chair',x:17.7,z:14.45,r:2,c:'#E7D2B0'},
  {t:'counter',x:18.5,z:11.38,w:4,d:0.72},{t:'fridge',x:20.5,z:15.4,w:0.9,d:0.8,tall:1},{t:'plant',x:14.6,z:15.4},
];
/* ---------- Офіс: опенспейс, переговорна, кухня, кабінет шефа, склад ---------- */
const OFFICE_ROWS=[
"########################",
"#oooooooooooo#mmmmmmmmm#",
"#oooooooooooo#mmmmmmmmm#",
"#ooooooooooooommmmmmmmm#",
"#ooooooooooooommmmmmmmm#",
"#oooooooooooo#mmmmmmmmm#",
"###oo#####oo#####mm#####",
"#hhhhhhhhhhhhhhhhhhhhhh#",
"#hhhhhhhhhhhhhhhhhhhhhh#",
"###kk######bb######ss###",
"#kkkkkkk#bbbbbbb#ssssss#",
"#kkkkkkk#bbbbbbb#ssssss#",
"#kkkkkkkkbbbbbbb#ssssss#",
"#kkkkkkkkbbbbbbbbssssss#",
"#kkkkkkk#bbbbbbbbssssss#",
"#kkkkkkk#bbbbbbb#ssssss#",
"########################"];
const OFFICE_FLOOR={o:['#B8C4D6','#ADB9CC','carpet'],m:['#C79B6E','#BC8F62','wood'],h:['#E2E5E9','#D2D7DD','tile'],
  k:['#F1E9D6','#E2D8C0','tile'],b:['#B5595F','#A94E55','carpet'],s:['#AEB3BA','#A1A7AF','tile']};
const OFFICE_FURN=[
  // опенспейс: два «острівці» по 4 місця, стільці впритул до столів, навколо — широкі проходи
  ...[3.5,7.5].flatMap((x)=>[{t:'desk',x,z:2.6,w:2.0,d:0.6},{t:'desk',x,z:3.2,w:2.0,d:0.6,r:2},
    {t:'chair',x:x-0.6,z:2.1,r:0,c:'#3A3F4B'},{t:'chair',x:x+0.6,z:2.1,r:0,c:'#3A3F4B'},{t:'chair',x:x-0.6,z:3.7,r:2,c:'#3A3F4B'},{t:'chair',x:x+0.6,z:3.7,r:2,c:'#3A3F4B'}]),
  {t:'tallcab',x:1.3,z:5.2,w:0.55,d:1.4,tall:1,c:'#B9C2CB'},{t:'boxes',x:7.5,z:5.6,w:0.8,d:0.6},{t:'cooler',x:12.6,z:1.4},{t:'plant',x:12.6,z:5.6,big:1},
  {t:'rug',x:5.5,z:2.9,w:7.4,d:3.4,c:'#C9D3E3',c2:'#5B8FC9',flat:1},
  // переговорна
  {t:'table',x:18.5,z:3.1,w:3.2,d:1.2,c:'#8F5E3B',big:1},
  {t:'chair',x:17.6,z:2.28,r:0,c:'#E8453C'},{t:'chair',x:19.4,z:2.28,r:0,c:'#E8453C'},{t:'chair',x:17.6,z:3.92,r:2,c:'#E8453C'},{t:'chair',x:19.4,z:3.92,r:2,c:'#E8453C'},
  {t:'tvstand',x:22.75,z:3.0,w:2.0,d:0.4,r:1},{t:'plant',x:14.6,z:1.6,big:1},{t:'plant',x:22.4,z:5.4},
  // коридор
  {t:'bench',x:7,z:7.35,w:1.6,d:0.5},{t:'bench',x:17,z:7.35,w:1.6,d:0.5},{t:'plant',x:1.6,z:8.4,big:1},{t:'plant',x:22.4,z:8.4,big:1},{t:'cooler',x:12,z:7.3},
  // кухня
  {t:'counter',x:6.6,z:10.38,w:2.0,d:0.72},{t:'fridge',x:1.5,z:10.45,w:0.9,d:0.8,tall:1},
  {t:'cafetable',x:3,z:13.5,c:'#FFFFFF'},{t:'chair',x:2.4,z:13.5,r:1,c:'#F2994A'},{t:'chair',x:3.6,z:13.5,r:3,c:'#F2994A'},
  {t:'cafetable',x:5.6,z:14.6,c:'#FFFFFF'},{t:'chair',x:5.0,z:14.6,r:1,c:'#27AE60'},{t:'chair',x:6.2,z:14.6,r:3,c:'#27AE60'},
  {t:'plant',x:7.4,z:15.4},
  // кабінет шефа
  {t:'desk',x:12.5,z:13.6,w:2.0,d:0.8,big:1},{t:'chair',x:12.5,z:14.22,r:2,c:'#2B2B2B'},{t:'chair',x:11.85,z:12.98,r:0,c:'#C9A27A'},{t:'chair',x:13.15,z:12.98,r:0,c:'#C9A27A'},
  {t:'sofa',x:14.6,z:10.5,w:1.8,d:0.9,r:0,c:'#3A3F4B'},{t:'tallcab',x:9.3,z:15.2,w:0.55,d:1.4,tall:1,c:'#8B5E3C'},{t:'plant',x:15.5,z:15.5,big:1},
  {t:'rug',x:12.5,z:13.6,w:3.4,d:2.4,c:'#E9D9B5',c2:'#8F5E3B',flat:1},
  // склад
  {t:'shelf',x:18,z:11.3,w:0.9,d:2.1,tall:1,seed:3},{t:'shelf',x:22.5,z:11.4,w:0.9,d:2.1,tall:1,seed:5},
  {t:'boxes',x:20,z:14,w:1.0,d:0.8},{t:'pallet',x:21.8,z:15.2,w:1.4,d:1.2,tall:1,low:1},{t:'tallcab',x:17.3,z:15.25,w:0.55,d:1.2,tall:1,c:'#7E8794'},
];
/* ---------- Табір: два будиночки, їдальня, душові, комора, ігрова; посередині — подвір'я ---------- */
const CAMP_ROWS=[
"######################",
"#aaaaaa#cccccc#dddddd#",
"#aaaaaa#ccccccddddddd#",
"#aaaaaaaccccccddddddd#",
"#aaaaaaacccccc#dddddd#",
"#aaaaaa#cccccc#dddddd#",
"###aa#####cc#####dd###",
"#yyyyyyyyyyyyyyyyyyyy#",
"#yyyyyyyyyyyyyyyyyyyy#",
"#yyyyyyyyyyyyyyyyyyyy#",
"###bb#####ss####gg####",
"#bbbbbbb#ssss#ggggggg#",
"#bbbbbbbbssss#ggggggg#",
"#bbbbbbbbsssssggggggg#",
"#bbbbbbb#sssssggggggg#",
"#bbbbbbb#ssss#ggggggg#",
"######################"];
const CAMP_FLOOR={a:['#CFA06A','#C39361','wood'],c:['#D9B07E','#CDA372','wood'],d:['#DCEFF3','#CBE3E9','tile'],y:['#8CC56E','#7FBA62','carpet'],
  b:['#C8946A','#BC885F','wood'],s:['#A08060','#94755A','wood'],g:['#7FB2D9','#73A6CE','carpet']};
const CAMP_FURN=[
  // будиночок «Ромашка»
  {t:'bunk',x:1.9,z:2.3,w:1.6,d:2.4,tall:1},{t:'bunk',x:4.2,z:2.3,w:1.6,d:2.4,tall:1},{t:'toybox',x:1.5,z:5.4,w:0.6,d:1.0},{t:'lamp',x:6.5,z:1.5},
  {t:'rug',x:4.2,z:4.6,w:2.2,d:1.2,c:'#FFF4E6',c2:'#F29E4C',flat:1},
  // їдальня
  {t:'counter',x:11,z:1.38,w:3,d:0.72},{t:'table',x:11,z:3.84,w:2.6,d:1.0,c:'#C9A27A'},
  {t:'bench',x:11,z:3.09,w:2.4,d:0.5},{t:'bench',x:11,z:4.59,w:2.4,d:0.5},{t:'plant',x:13.5,z:5.5},
  // душові
  {t:'sink',x:16.5,z:1.3,w:0.9,d:0.5},{t:'sink',x:17.4,z:1.3,w:0.9,d:0.5},{t:'toilet',x:20.6,z:2.6,w:0.7,d:0.62,r:3},{t:'toilet',x:20.6,z:4.0,w:0.7,d:0.62,r:3},
  {t:'washer',x:15.5,z:5.4,w:0.8,d:0.7},{t:'rug',x:17.6,z:3.6,w:1.6,d:1.0,c:'#FFFFFF',c2:'#7CC3D9',flat:1},
  // подвір'я
  {t:'plant',x:2,z:8.5,big:1},{t:'plant',x:20,z:8.5,big:1},{t:'tent',x:7,z:8.5,w:1.4,d:1.4,tall:1},{t:'bench',x:14,z:8.5,w:1.6,d:0.5},{t:'ball',x:16.5,z:7.8},
  {t:'rug',x:11,z:8.5,w:2.4,d:1.6,c:'#7A5A3C',c2:'#5E8C3A',flat:1,round:1},
  // будиночок «Волошка»
  {t:'bunk',x:1.9,z:14.7,w:1.6,d:2.4,tall:1},{t:'bunk',x:5.3,z:14.7,w:1.6,d:2.4,tall:1},{t:'toybox',x:1.5,z:11.8,w:0.6,d:1.0},{t:'lamp',x:7.4,z:11.5},
  // комора
  {t:'boxes',x:10,z:15.4,w:1.0,d:0.8},{t:'boxes',x:12,z:15.4,w:1.0,d:0.8},{t:'tallcab',x:12.7,z:11.8,w:0.55,d:1.2,tall:1,c:'#7E8794'},
  // ігрова
  {t:'table',x:18,z:13.5,w:2.0,d:1.1,c:'#2E9A57'},{t:'sofa',x:17.5,z:15.5,w:2.4,d:0.9,r:2,c:'#F2994A'},{t:'tvstand',x:20.7,z:13.5,w:2.0,d:0.4,r:1},
  {t:'ball',x:15,z:12},{t:'armchair',x:14.7,z:15.4,w:0.95,d:0.95,r:1,c:'#E8C25C'},
];
const MAPS=[
  {id:'house',name:'Будинок',rows:HOUSE_ROWS,floor:HOUSE_FLOOR,furn:HOUSE_FURN,grass:'#8FCB72',
   spawn:[11,8.6],noHide:'h',waypoints:[[4,6],[3.5,2.6],[9.6,5.8],[14,4.2],[18.6,5.6],[3,9],[19,9],[11,8.6],[4.5,13.5],[9.2,13],[13,14.6],[17,13],[16.4,11.6]]},
  {id:'market',name:'Супермаркет',rows:MARKET_ROWS,floor:MARKET_FLOOR,furn:MARKET_FURN,grass:'#9AA7AE',
   spawn:[12.25,9.9],noHide:'',waypoints:[[2,9.9],[5.25,7.5],[5.25,12],[8.75,9.9],[12.25,7],[12.25,12.6],[15.75,8],[15.75,11.8],[19.2,9.9],[21.6,7.2],[21.6,12.6],[7.5,14.2],[17.5,15.6],[4,3.2],[9,4.2],[13.4,3.4],[19.8,3.2],[2.2,13.4]]},
  {id:'school',name:'Школа',rows:SCHOOL_ROWS,floor:SCHOOL_FLOOR,furn:SCHOOL_FURN,grass:'#8FCB72',
   spawn:[12,8],noHide:'h',waypoints:[[3.4,2.2],[8.3,4],[13,3],[11.5,5.2],[20,3.8],[18,5.6],[3,8],[21,8],[5.5,12.5],[2.5,13.5],[9.8,14],[14.8,13.6],[17.5,11.4],[20,14.5],[20,10.6]]},
  {id:'dacha',name:'Дача',rows:DACHA_ROWS,floor:DACHA_FLOOR,furn:DACHA_FURN,grass:'#7DB861',
   spawn:[6.5,9.5],noHide:'',waypoints:[[3,3],[7.5,2.8],[11,4.5],[4,7],[8.5,9.5],[11.2,1.6],[15.5,3.8],[18.5,5],[15.8,8.6],[19,9],[3,13],[6,12],[10.8,14.2],[15,12],[19,13.6],[18,15.6]]},
  {id:'office',name:'Офіс',rows:OFFICE_ROWS,floor:OFFICE_FLOOR,furn:OFFICE_FURN,grass:'#9AA7AE',
   spawn:[12,8],noHide:'h',waypoints:[[5.5,4.6],[10.5,2.5],[1.8,2.5],[15.5,4.8],[21.5,1.8],[18.5,5.0],[3,8],[21,8],[3,11.5],[6,15],[10,11],[14.8,12],[10.5,15.3],[18.5,13.5],[21,12.8]]},
  {id:'camp',name:'Табір',rows:CAMP_ROWS,floor:CAMP_FLOOR,furn:CAMP_FURN,grass:'#7DB861',
   spawn:[11,8.5],noHide:'y',waypoints:[[2,4.5],[5.8,1.6],[8.8,4.8],[13.2,2.4],[16,3.5],[19,4.5],[3,8.5],[19,8.2],[4,12.5],[7,15],[11,13.5],[15,12],[15.5,14.2],[20,15.5]]},
];
let MAP=HOUSE_ROWS,MW=22,MH=17,FLOOR=HOUSE_FLOOR,FURN=HOUSE_FURN;
function useMap(i){const m=MAPS[i];MAP=m.rows;MW=MAP[0].length;MH=MAP.length;FLOOR=m.floor;FURN=m.furn;return m}


/* ---------- merged geometry builder ---------- */
const BASE={box:new T3.BoxGeometry(1,1,1).toNonIndexed(),cyl:new T3.CylinderGeometry(0.5,0.5,1,14).toNonIndexed(),cyl6:new T3.CylinderGeometry(0.5,0.5,1,6).toNonIndexed(),
  sph:new T3.IcosahedronGeometry(0.5,1).toNonIndexed(),ball:new T3.SphereGeometry(0.5,14,10).toNonIndexed(),cone:new T3.ConeGeometry(0.5,1,14).toNonIndexed(),
  pyr:new T3.ConeGeometry(0.5,1,4).toNonIndexed(),tor:new T3.TorusGeometry(0.5,0.08,6,18).toNonIndexed()};
class Merge{
  constructor(){this.pos=[];this.nor=[];this.col=[]}
  add(kind,m,color){
    const g=BASE[kind],p=g.attributes.position.array,n=g.attributes.normal.array,nm=new T3.Matrix3().getNormalMatrix(m),flip=m.determinant()<0;
    const c=new T3.Color(color),v=new T3.Vector3();
    for(let t=0;t<p.length;t+=9){
      const order=flip?[0,6,3]:[0,3,6];
      for(const o of order){
        v.set(p[t+o],p[t+o+1],p[t+o+2]).applyMatrix4(m);this.pos.push(v.x,v.y,v.z);
        v.set(n[t+o],n[t+o+1],n[t+o+2]).applyMatrix3(nm).normalize();this.nor.push(v.x,v.y,v.z);
        this.col.push(c.r,c.g,c.b);
      }
    }
  }
  mesh(mat){
    const g=new T3.BufferGeometry();g.setAttribute('position',new T3.Float32BufferAttribute(this.pos,3));g.setAttribute('normal',new T3.Float32BufferAttribute(this.nor,3));
    g.setAttribute('color',new T3.Float32BufferAttribute(this.col,3));g.computeBoundingSphere();return new T3.Mesh(g,mat);
  }
}
const _m=new T3.Matrix4(),_q=new T3.Quaternion(),_e=new T3.Euler(),_v=new T3.Vector3(),_s=new T3.Vector3();
function shade(hex,k){const c=new T3.Color(hex);if(k>0)c.lerp(new T3.Color('#ffffff'),k);else c.multiplyScalar(1+k);return '#'+c.getHexString()}

/* furniture parts in local space: P(kind, x, yCentre, z, sx, sy, sz, color, rx, ry, rz) */
function furnitureParts(f){
  const L=[],P=(k,x,y,z,sx,sy,sz,c,rx=0,ry=0,rz=0)=>L.push([k,x,y,z,sx,sy,sz,c,rx,ry,rz]);
  const w=f.w||1,d=f.d||1,c=f.c;
  const legs=(w,d,h,r,col,inset=0.08)=>{for(const sx of[-1,1])for(const sz of[-1,1])P('cyl',sx*(w/2-inset),h/2,sz*(d/2-inset),r,h,r,col)};
  switch(f.t){
    case 'counter':
      P('box',0,0.42,0,w,0.84,d,'#F6F2EA');P('box',0,0.87,0,w+0.05,0.07,d+0.05,'#7A5A44');
      for(let i=1;i<w;i++)P('box',-w/2+i,0.42,d/2+0.006,0.02,0.7,0.01,'#D8D0C2');
      for(let i=0;i<w;i++)P('box',-w/2+i+0.5,0.72,d/2+0.02,0.22,0.035,0.03,'#A9A29A');
      P('box',w*0.18,0.905,0,0.62,0.02,0.4,'#AFC0CB');P('cyl',w*0.18,1.0,-0.18,0.04,0.2,0.04,'#C9D3DA');
      P('box',-w*0.3,0.94,-0.05,0.5,0.06,0.36,'#3B3F46');for(const k of[-0.12,0.12])P('cyl',-w*0.3+k,0.98,-0.05,0.13,0.015,0.13,'#55595F');
      P('cyl',-w*0.05,0.98,0.05,0.14,0.16,0.14,'#E8573F');P('cyl',w*0.38,0.97,0.08,0.09,0.12,0.09,'#F2C94C');
      break;
    case 'fridge':
      P('box',0,0.95,0,w,1.9,d,'#F7FAFC');P('box',0,1.3,d/2+0.006,w*0.96,0.02,0.01,'#C8D1D8');
      P('box',w*0.36,1.55,d/2+0.04,0.05,0.4,0.05,'#AEB7BE');P('box',w*0.36,0.8,d/2+0.04,0.05,0.5,0.05,'#AEB7BE');
      P('box',-w*0.2,1.5,d/2+0.012,0.12,0.12,0.02,'#EB5FA8');P('box',-w*0.05,1.62,d/2+0.012,0.1,0.1,0.02,'#2F80ED');P('box',-w*0.25,0.9,d/2+0.012,0.22,0.28,0.01,'#FFF2A8');
      break;
    case 'table':{
      const top=f.big?0.76:0.74;P('box',0,top,0,w,0.07,d,c);P('box',0,top-0.05,0,w-0.12,0.04,d-0.12,shade(c,-0.15));legs(w,d,top-0.04,0.05,shade(c,-0.2));
      P('cyl',0,top+0.13,0,0.1,0.2,0.1,'#FFFFFF');P('sph',0,top+0.3,0,0.18,0.14,0.18,'#F2994A');P('sph',0.06,top+0.33,0.04,0.1,0.1,0.1,'#EB5FA8');
      if(f.big){P('cyl',-0.7,top+0.05,0.2,0.24,0.02,0.24,'#FFFFFF');P('cyl',0.7,top+0.05,-0.2,0.24,0.02,0.24,'#FFFFFF');P('ball',0.7,top+0.09,-0.2,0.12,0.08,0.12,'#E8453C')}
      break}
    case 'chair':
      P('box',0,0.46,0,0.44,0.06,0.42,c);P('box',0,0.75,-0.19,0.44,0.5,0.06,c);legs(0.44,0.42,0.44,0.035,shade(c,-0.3),0.05);
      break;
    case 'sofa':
      P('box',0,0.22,0,w,0.3,d,shade(c,-0.12));P('box',0,0.4,0.05,w-0.36,0.14,d-0.18,c);
      P('box',0,0.62,-d/2+0.15,w,0.62,0.3,shade(c,-0.05));
      for(const s of[-1,1])P('box',s*(w/2-0.12),0.42,0,0.24,0.5,d,shade(c,-0.1));
      for(let i=0;i<3;i++)P('box',-w/3+i*w/3,0.5,0.06,w/3-0.1,0.08,d-0.3,shade(c,0.08));
      P('box',-w*0.3,0.62,-d/2+0.38,0.38,0.32,0.12,'#F2C94C',0.25,0,0.2);P('box',w*0.32,0.62,-d/2+0.38,0.36,0.3,0.12,'#FFFFFF',0.25,0,-0.15);
      for(const sx of[-1,1])for(const sz of[-1,1])P('cyl',sx*(w/2-0.1),0.04,sz*(d/2-0.1),0.06,0.08,0.06,'#3A2E26');
      break;
    case 'armchair':
      P('box',0,0.22,0,w,0.3,d,shade(c,-0.12));P('box',0,0.42,0.05,w-0.3,0.12,d-0.2,c);P('box',0,0.62,-d/2+0.13,w,0.6,0.26,shade(c,-0.05));
      for(const s of[-1,1])P('box',s*(w/2-0.1),0.42,0,0.2,0.46,d,shade(c,-0.1));
      break;
    case 'coffee':
      P('box',0,0.4,0,w,0.06,d,'#6B4A35');legs(w,d,0.38,0.035,'#4A3428');P('box',-0.3,0.46,0,0.3,0.05,0.22,'#2F80ED');P('box',-0.28,0.5,0.02,0.26,0.04,0.2,'#F2C94C');P('cyl',0.35,0.48,0,0.07,0.1,0.07,'#FFFFFF');
      break;
    case 'tvstand':
      P('box',0,0.24,0,w,0.48,d,'#5A4636');for(const s of[-1,1])P('box',s*w*0.25,0.24,d/2+0.006,w*0.42,0.36,0.01,'#6E5744');
      P('box',0,0.52,0,0.3,0.06,0.2,'#22262C');P('cyl',0,0.6,0,0.04,0.12,0.04,'#22262C');
      P('box',0,0.98,0,w*0.78,0.72,0.06,'#1C2026');P('box',0,0.98,0.032,w*0.74,0.66,0.01,'#34506E');P('box',-w*0.15,1.1,0.04,w*0.25,0.18,0.005,'#4E7AA3');
      P('box',w*0.42,0.62,0,0.14,0.28,0.16,'#2B2F36');P('box',-w*0.42,0.55,0,0.16,0.14,0.16,'#7CC35A');
      break;
    case 'bookshelf':{
      const h=1.85,BC=['#E8453C','#2F80ED','#F2C94C','#27AE60','#9B51E0','#F2994A','#EB5FA8','#20B2AA'];
      // local: wide axis along z (d), shallow along x (w); open side faces -x (into the room)
      P('box',0.02,h/2,0,w-0.04,h,d,'#9A6B45');P('box',-w/2+0.06,h/2,0,0.02,h-0.1,d-0.1,'#7E5532');
      for(let s=0;s<4;s++){const y=0.12+s*0.44;P('box',-0.03,y,0,w-0.1,0.04,d-0.08,'#B88358');
        let z=-d/2+0.1;let i=s*3;while(z<d/2-0.15){const bw=0.07+((i*37)%5)*0.012,bh=0.26+((i*13)%4)*0.03;P('box',-0.05,y+0.02+bh/2,z+bw/2,w*0.62,bh,bw,BC[i%BC.length]);z+=bw+0.015;i++;if(i%7===0)z+=0.12}}
      break}
    case 'plant':{
      const b=f.big?1.25:1;P('cyl',0,0.17*b,0,0.36*b,0.34*b,0.36*b,'#D9774E');P('cyl',0,0.34*b,0,0.4*b,0.05*b,0.4*b,'#C4673F');P('cyl',0,0.35*b,0,0.32*b,0.02,0.32*b,'#5B3C2A');
      P('sph',0,0.62*b,0,0.42*b,0.5*b,0.42*b,'#4E9B4E');P('sph',0.12*b,0.86*b,0.05*b,0.3*b,0.38*b,0.3*b,'#62B562');P('sph',-0.1*b,0.78*b,-0.1*b,0.26*b,0.32*b,0.26*b,'#3E8A45');
      if(f.big)P('sph',0.02,1.12,-0.02,0.2,0.26,0.2,'#74C474');
      break}
    case 'lamp':P('cyl',0,0.02,0,0.34,0.04,0.34,'#3A3F4B');P('cyl',0,0.7,0,0.04,1.4,0.04,'#3A3F4B');P('cone',0,1.45,0,0.46,0.34,0.46,'#FFE7A8',Math.PI);break;
    case 'rug':
      if(f.round){P('cyl',0,0.012,0,w,0.02,d,f.c2);P('cyl',0,0.02,0,w-0.25,0.02,d-0.25,f.c);P('cyl',0,0.026,0,w*0.4,0.02,d*0.4,f.c2)}
      else{P('box',0,0.012,0,w,0.02,d,f.c2);P('box',0,0.02,0,w-0.2,0.02,d-0.2,f.c);P('box',0,0.026,0,w-0.7,0.02,0.08,f.c2)}
      break;
    case 'bed':
      P('box',0,0.17,0,w,0.3,d,'#A97B55');P('box',0,0.4,0.03,w-0.1,0.18,d-0.12,'#FFFFFF');
      P('box',0,0.52,d*0.14,w-0.04,0.12,d*0.66,c);P('box',0,0.47,d*0.14+d*0.33,w-0.04,0.18,0.06,shade(c,-0.1));
      for(const s of[-1,1])P('box',s*w*0.22,0.55,-d/2+0.32,w*0.36,0.13,0.36,'#F7F2EA');
      P('box',0,0.6,-d/2+0.04,w+0.06,0.95,0.08,'#8C6142');P('box',0,1.04,-d/2+0.04,w+0.12,0.08,0.12,'#A97B55');
      break;
    case 'nightstand':
      P('box',0,0.25,0,w,0.5,d,'#C99A6B');P('box',0,0.33,d/2+0.006,w*0.8,0.02,0.01,'#A97B55');P('ball',0,0.33,d/2+0.02,0.05,0.05,0.04,'#7A5A44');
      P('cyl',0,0.55,0,0.14,0.08,0.14,'#F2C94C');P('cyl',0,0.66,0,0.03,0.18,0.03,'#F2C94C');P('cone',0,0.82,0,0.28,0.2,0.28,'#FFF2C9',Math.PI);
      break;
    case 'wardrobe':
      P('box',0,0.97,0,w,1.94,d,'#B88A5E');P('box',w/2+0.006,0.97,0,0.01,1.8,0.02,'#8C6142');
      for(const s of[-1,1])P('box',w/2+0.02,1.0,s*0.1,0.04,0.28,0.04,'#E6D3B3');P('box',0,1.97,0,w+0.08,0.07,d+0.08,'#9A6B45');
      P('box',0,2.07,-0.3,w*0.6,0.13,0.4,'#E8A25C');P('box',0,2.07,0.3,w*0.6,0.13,0.34,'#7FB7A4');
      break;
    case 'bench':P('box',0,0.44,0,w,0.07,d,'#9A6B45');legs(w,d,0.42,0.04,'#5A4636');P('box',-0.4,0.52,0,0.32,0.1,0.28,'#E8453C');P('box',0.3,0.5,0.02,0.36,0.06,0.3,'#2F80ED');break;
    case 'shoecab':P('box',0,0.3,0,w,0.6,d,'#F6F2EA');P('box',0,0.62,0,w+0.04,0.04,d+0.04,'#C99A6B');for(const s of[-1,1])P('box',s*w*0.25,0.3,d/2+0.006,w*0.45,0.5,0.01,'#E6DED0');P('box',-0.3,0.7,0,0.24,0.12,0.36,'#E8453C');P('box',0.05,0.7,0,0.22,0.12,0.34,'#3A3F4B');break;
    case 'bathtub':
      P('box',0,0.28,0,w,0.56,d,'#FFFFFF');P('box',0,0.5,0,w-0.18,0.08,d-0.2,'#8FD0E6');P('box',0,0.58,0,w+0.03,0.04,d+0.03,'#EEF4F7');
      P('cyl',0,0.75,-d/2+0.12,0.05,0.35,0.05,'#C9D3DA');P('box',0,0.9,-d/2+0.2,0.06,0.05,0.18,'#C9D3DA');
      P('sph',0.15,0.58,0.3,0.24,0.1,0.24,'#FFFFFF');P('sph',-0.1,0.58,0.5,0.18,0.08,0.18,'#FFFFFF');P('sph',0.0,0.6,-0.4,0.12,0.12,0.12,'#F2C94C');
      break;
    case 'toilet':P('box',0,0.2,0.04,0.42,0.4,0.48,'#FFFFFF');P('cyl',0,0.42,0.08,0.44,0.06,0.5,'#F1F5F7');P('box',0,0.55,-0.22,0.48,0.45,0.18,'#FFFFFF');break;
    case 'sink':P('box',0,0.4,0,w,0.8,d,'#9FC7B6');P('box',0,0.82,0,w+0.04,0.05,d+0.04,'#FFFFFF');P('cyl',0,0.84,0.02,0.44,0.03,0.3,'#DDEBF0');P('cyl',0,0.92,-0.18,0.04,0.14,0.04,'#C9D3DA');P('box',0,1.5,-d/2+0.02,0.6,0.7,0.03,'#BFE3EE');break;
    case 'washer':P('box',0,0.43,0,w,0.86,d,'#FFFFFF');P('cyl',0,0.42,d/2+0.01,0.48,0.04,0.48,'#C9D3DA',Math.PI/2);P('cyl',0,0.42,d/2+0.03,0.38,0.02,0.38,'#5E8CA8',Math.PI/2);P('box',0.2,0.78,d/2+0.006,0.2,0.06,0.01,'#7CC3D9');break;
    case 'tallcab':P('box',0,0.9,0,w,1.8,d,c);P('box',w/2+0.006,0.9,0,0.01,1.7,0.02,shade(c,-0.2));for(const s of[-1,1])P('box',w/2+0.02,0.95,s*0.08,0.035,0.22,0.035,'#B9A88E');P('box',0,1.84,0,w+0.06,0.06,d+0.06,shade(c,-0.12));break;
    case 'bunk':{
      for(const sx of[-1,1])for(const sz of[-1,1])P('box',sx*(w/2-0.05),0.88,sz*(d/2-0.05),0.1,1.76,0.1,'#E8A25C');
      for(const y of[0.32,1.22]){P('box',0,y,0,w,0.1,d,'#E8A25C');P('box',0,y+0.12,0,w-0.12,0.14,d-0.12,'#FFFFFF');P('box',0,y+0.22,0.25,w-0.1,0.08,d*0.6,y<1?'#5B8CFF':'#27AE60');P('box',0,y+0.24,-d/2+0.25,w*0.6,0.1,0.28,'#F7F2EA')}
      for(const s of[-1,1])P('box',s*(w/2-0.05),1.55,0,0.06,0.18,d-0.1,'#E8A25C');
      for(let i=0;i<4;i++)P('box',-w/2-0.02,0.45+i*0.3,d/2-0.3,0.06,0.05,0.4,'#C98A47');
      break}
    case 'tent':P('pyr',0,0.75,0,w*1.35,1.5,d*1.35,'#F29E4C',0,Math.PI/4);P('pyr',0,0.75,0.002,w*1.2,1.42,d*1.2,'#FFE8A3',0,Math.PI/4);P('box',0,0.38,d*0.48,0.5,0.76,0.02,'#5A3A2A');P('cone',0,1.62,0,0.08,0.3,0.08,'#E8453C');break;
    case 'toybox':P('box',0,0.26,0,w,0.52,d,'#E8453C');P('box',0,0.55,0,w+0.04,0.06,d+0.04,'#F2C94C');P('box',w/2+0.006,0.28,0,0.01,0.2,0.4,'#FFFFFF');P('sph',0.05,0.66,0.2,0.16,0.16,0.16,'#2F80ED');break;
    case 'ball':P('ball',0,0.22,0,0.44,0.44,0.44,'#F2C94C');P('ball',0,0.22,0.001,0.45,0.1,0.45,'#E8453C');break;
    case 'shelf':{
      const h=1.75,GC=['#E8453C','#2F80ED','#F2C94C','#27AE60','#9B51E0','#F2994A','#EB5FA8','#20B2AA','#FFFFFF','#8B5A2B'];
      P('box',0,h/2,0,w*0.16,h,d,'#C9CED6');P('box',0,0.06,0,w,0.12,d,'#5E6673');P('box',0,h+0.03,0,w,0.06,d,['#E8453C','#2F80ED','#27AE60','#F2994A','#9B51E0'][((f.seed||0)>>1)%5]);P('box',0,h+0.065,0,w*0.6,0.01,d*0.85,'#FFFFFF');
      for(const side of[-1,1])for(let s=0;s<4;s++){const y=0.14+s*0.42;P('box',side*w*0.3,y,0,w*0.42,0.03,d-0.04,'#AEB4BD');
        P('box',side*(w/2-0.005),y+0.02,0,0.01,0.05,d-0.04,['#E8453C','#2F80ED','#F2C94C','#27AE60'][(s+(f.seed||0))%4]);
        let z=-d/2+0.08,i=(f.seed||0)*7+s*5+(side>0?3:0);
        while(z<d/2-0.12){const kind=i%4,bw=0.14+((i*37)%4)*0.03,col=GC[(i*13+s)%GC.length];
          if(kind===0)P('box',side*w*0.3,y+0.17,z+bw/2,w*0.32,0.3,bw,col);
          else if(kind===1)P('cyl6',side*w*0.3,y+0.13,z+bw/2,bw*0.85,0.24,bw*0.85,col);
          else if(kind===2){P('cyl6',side*w*0.3,y+0.15,z+bw/2,bw*0.6,0.28,bw*0.6,col);P('cyl6',side*w*0.3,y+0.33,z+bw/2,bw*0.25,0.08,bw*0.25,'#FFFFFF')}
          else P('box',side*w*0.3,y+0.1,z+bw/2,w*0.34,0.16,bw,col);
          z+=bw+0.025;i++}}
      break}
    case 'fridgewall':{
      P('box',0,1.0,0,w,2.0,d,'#E9EEF2');const n=Math.round(d/0.9);
      for(let i=0;i<n;i++){const z=-d/2+(i+0.5)*d/n;P('box',w/2+0.01,1.0,z,0.02,1.8,d/n-0.08,'#BFE3F2');P('box',w/2+0.04,1.0,z+d/n*0.36,0.04,0.5,0.04,'#C9D3DA');
        for(let s=0;s<4;s++)for(let k=0;k<3;k++)P('cyl6',w*0.1,0.35+s*0.42,z-d/n*0.3+k*d/n*0.3,0.13,0.3,0.13,['#E8453C','#27AE60','#F2C94C','#2F80ED','#FFFFFF'][(i+s+k)%5])}
      P('box',0,2.05,0,w+0.04,0.12,d+0.04,'#2F80ED');
      break}
    case 'freezer':
      P('box',0,0.42,0,w,0.84,d,'#FFFFFF');P('box',0,0.86,0,w-0.08,0.03,d-0.08,'#BFE3F2');P('box',0,0.6,0,w-0.16,0.3,d-0.16,'#9FD3EA');
      for(let i=0;i<8;i++)P('box',-w*0.25+(i%2)*w*0.5,0.78,-d/2+0.3+i*0.38,w*0.36,0.08,0.28,['#F2994A','#EB5FA8','#FFFFFF','#2F80ED'][i%4]);
      P('box',0,0.5,d/2+0.006,w*0.8,0.08,0.01,'#2F80ED');P('box',0,0.5,-d/2-0.006,w*0.8,0.08,0.01,'#2F80ED');
      break;
    case 'fruit':{
      P('box',0,0.3,0,w,0.6,d,'#B07B4A');P('box',0,0.62,0,w+0.06,0.05,d+0.06,'#8C6142');
      const F=f.alt?['#E8453C','#F2C94C','#A3D930']:['#F2994A','#27AE60','#9B51E0'];
      for(let b=0;b<3;b++){const x=-w/2+(b+0.5)*w/3;P('box',x,0.68,0,w/3-0.08,0.08,d-0.12,'#D8B88E');
        for(let k=0;k<6;k++)P('sph',x-0.18+(k%3)*0.18,0.78+(k>2?0.08:0),-0.12+(k>2?0.14:0)+(k%2)*0.05,0.16,0.15,0.16,F[b])}
      break}
    case 'checkout':
      P('box',0,0.42,0,w,0.84,d,'#5E6673');P('box',0,0.86,0.05,w-0.12,0.03,d-0.4,'#2B2F36');for(let i=0;i<5;i++)P('box',0,0.875,-d/2+0.5+i*0.24,w-0.14,0.004,0.04,'#4A5060');
      P('box',0,0.95,-d/2+0.18,0.42,0.18,0.3,'#E9EEF2');P('box',0,1.12,-d/2+0.2,0.3,0.16,0.04,'#2F80ED');
      P('box',0,0.9,d/2-0.25,0.24,0.1,0.3,'#F2C94C');P('box',0.1,0.94,0.2,0.18,0.12,0.14,'#E8453C');
      break;
    case 'cart':
      P('box',0,0.55,0,w,0.04,d,'#C9D3DA');for(const s of[-1,1]){P('box',s*w/2,0.72,0,0.03,0.36,d,'#C9D3DA');P('box',0,0.72,s*d/2,w,0.36,0.03,'#C9D3DA')}
      P('box',0,1.0,-d/2-0.05,w,0.04,0.04,'#E8453C');for(const sx of[-1,1])for(const sz of[-1,1]){P('cyl',sx*w*0.4,0.27,sz*d*0.4,0.03,0.5,0.03,'#9AA4AE');P('ball',sx*w*0.4,0.05,sz*d*0.4,0.1,0.1,0.06,'#2B2F36')}
      if(f.x>12&&f.x<13)P('box',0,0.68,0.1,0.3,0.22,0.3,'#F2994A');
      break;
    case 'pallet':{
      P('box',0,0.07,0,w,0.14,d,'#B98F5E');const L=f.low?2:3,C=['#C8A26E','#BF955F','#D3AF7C'];
      for(let y=0;y<L;y++)for(let i=0;i<2;i++)for(let j=0;j<2;j++){const ox=(i-0.5)*w*0.5,oz=(j-0.5)*d*0.5;P('box',ox,0.14+y*0.5+0.24,oz,w*0.48,0.47,d*0.48,C[(i+j+y)%3]);
        P('box',ox,0.14+y*0.5+0.24,oz+d*0.24+0.002,w*0.48,0.06,0.005,'#A8834F')}
      break}
    case 'boxes':{const C=['#C8A26E','#BF955F','#D3AF7C'];P('box',-w*0.2,0.22,0,w*0.5,0.44,d*0.9,C[0]);P('box',w*0.25,0.18,0.05,w*0.42,0.36,d*0.7,C[1]);P('box',-w*0.15,0.6,0,w*0.42,0.32,d*0.6,C[2],0,0.2,0);break}
    case 'cooler':P('box',0,0.45,0,0.4,0.9,0.4,'#E9EEF2');P('cyl',0,1.12,0,0.3,0.44,0.3,'#7CC3D9');P('box',0,0.7,0.21,0.08,0.08,0.04,'#2F80ED');break;
    case 'cafetable':P('cyl',0,0.74,0,0.8,0.05,0.8,c||'#FFFFFF');P('cyl',0,0.37,0,0.07,0.72,0.07,'#3A3F4B');P('cyl',0,0.02,0,0.5,0.04,0.5,'#3A3F4B');P('cyl',0.12,0.82,0,0.12,0.12,0.12,'#FFFFFF');P('cyl',0.12,0.89,0,0.1,0.02,0.1,'#6B4A35');break;
    case 'desk':P('box',0,0.6,0,w,0.05,d,'#FFFFFF');legs(w,d,0.58,0.03,'#5B8CFF');P('box',-0.25,0.66,0,0.3,0.06,0.22,'#F2994A');P('cyl',0.35,0.7,-0.1,0.06,0.16,0.06,'#27AE60');P('box',0,0.92,-d/2+0.03,w*0.7,0.5,0.02,'#FFE8A3');break;
  }
  return L;
}
function footprint(f){const r=(f.r||0)%2;return r?[f.d||0.6,f.w||0.6]:[f.w||0.6,f.d||0.6]}
const SMALL={chair:[0.46,0.44],plant:[0.5,0.5],lamp:[0.36,0.36],ball:[0.44,0.44],cooler:[0.42,0.42],cafetable:[0.82,0.82]};

/* ---------- build ---------- */
function build(scene,opt){
  const def=useMap(opt.map||0);
  const fx=opt.flipX,fz=opt.flipZ,TX=x=>fx?MW-x:x,TZ=z=>fz?MH-z:z;
  const grid=[];for(let r=0;r<MH;r++){grid.push([]);for(let c=0;c<MW;c++){const sr=fz?MH-1-r:r,sc=fx?MW-1-c:c;grid[r].push(MAP[sr][sc])}}
  const M=new Merge(),boxes=[],tallBoxes=[],lowBoxes=[];
  const put=(kind,x,y,z,sx,sy,sz,c,rx=0,ry=0,rz=0)=>{_q.setFromEuler(_e.set(rx,ry,rz));_m.compose(_v.set(x,y,z),_q,_s.set(sx,sy,sz));M.add(kind,_m,c)};
  // floors (per tile, shaded for wood planks / tile checker / carpet speckle)
  const tileCol=[];for(let r=0;r<MH;r++)tileCol.push([]);
  for(let r=0;r<MH;r++)for(let c=0;c<MW;c++){const ch=grid[r][c];if(ch==='#')continue;const F=FLOOR[ch];
    let col=F[0];if(F[2]==='tile')col=(r+c)%2?F[0]:F[1];else if(F[2]==='wood')col=((fx?MW-c:c)+(r%2)*0.5|0)%2?F[0]:F[1];else col=((r*7+c*3)%5===0)?F[1]:F[0];
    tileCol[r][c]=col;
    if(F[2]==='wood'){put('box',c+0.5,-0.05,r+0.25,1,0.1,0.49,col);put('box',c+0.5,-0.05,r+0.75,1,0.1,0.49,(r+c)%3?col:shade(col,-0.04))}
    else put('box',c+0.5,-0.05,r+0.5,0.99,0.1,0.99,col)}
  // walls: merged runs per row, body + lighter cap + soft base shadow strip on the floor
  for(let r=0;r<MH;r++){let c=0;while(c<MW){if(grid[r][c]!=='#'){c++;continue}let e=c;while(e<MW&&grid[r][e]==='#')e++;
    const x=(c+e)/2,w=e-c;put('box',x,0.45,r+0.5,w,0.9,1,'#E3C9A6');put('box',x,0.93,r+0.5,w+0.04,0.08,1.04,'#F7EBDA');put('box',x,0.06,r+0.5,w+0.03,0.12,1.03,'#B98F68');
    boxes.push([c,r,e,r+1]);c=e}}
  for(let r=0;r<MH;r++)for(let c=0;c<MW;c++){if(grid[r][c]==='#')continue;
    const n=[[0,-1],[0,1],[-1,0],[1,0]];for(const [dx,dz] of n){const rr=r+dz,cc=c+dx;if(rr<0||cc<0||rr>=MH||cc>=MW||grid[rr][cc]!=='#')continue;
      const sc=shade(tileCol[r][c],-0.16);if(dx)put('box',c+0.5+dx*0.43,0.002,r+0.5,0.14,0.004,1,sc);else put('box',c+0.5,0.002,r+0.5+dz*0.43,1,0.004,0.14,sc)}}
  // furniture
  const blockers=[],wallBoxes=boxes.slice();
  for(const f0 of FURN){
    const f=Object.assign({},f0);let x=TX(f.x),z=TZ(f.z),rot=(f.r||0)*Math.PI/2;
    // Меблі ближче до стіни, ніж пролізе гравець (0.62), присуваємо впритул: щілина, що виглядає як прохід,
    // але не пропускає, — найдратівливіше місце на карті.
    if(!f.flat){const [w0,d0]=SMALL[f.t]||footprint(f);let bx=0,bz=0;
      for(const wb of wallBoxes){const ovZ=Math.min(z+d0/2,wb[3])-Math.max(z-d0/2,wb[1]),ovX=Math.min(x+w0/2,wb[2])-Math.max(x-w0/2,wb[0]);
        if(ovZ>0.15){const g1=wb[0]-(x+w0/2),g2=(x-w0/2)-wb[2];if(g1>0.03&&g1<0.62&&(!bx||Math.abs(g1-0.03)<Math.abs(bx)))bx=g1-0.03;if(g2>0.03&&g2<0.62&&(!bx||Math.abs(g2-0.03)<Math.abs(bx)))bx=-(g2-0.03)}
        if(ovX>0.15){const g1=wb[1]-(z+d0/2),g2=(z-d0/2)-wb[3];if(g1>0.03&&g1<0.62&&(!bz||Math.abs(g1-0.03)<Math.abs(bz)))bz=g1-0.03;if(g2>0.03&&g2<0.62&&(!bz||Math.abs(g2-0.03)<Math.abs(bz)))bz=-(g2-0.03)}}
      x+=bx;z+=bz}
    const parts=furnitureParts(f);
    const mx=fx?-1:1,mz=fz?-1:1,base=new T3.Matrix4().makeTranslation(x,0,z).multiply(new T3.Matrix4().makeScale(mx,1,mz)).multiply(new T3.Matrix4().makeRotationY(rot));
    for(const [k,px,py,pz,sx,sy,sz,c,rx,ry,rz] of parts){_q.setFromEuler(_e.set(rx,ry,rz));_m.compose(_v.set(px,py,pz),_q,_s.set(sx,sy,sz));_m.premultiply(base);M.add(k,_m,c)}
    if(f.flat)continue;
    let [w,d]=SMALL[f.t]||footprint(f);
    const b=[x-w/2,z-d/2,x+w/2,z+d/2];boxes.push(b);if(f.tall)tallBoxes.push(b);else if(!SMALL[f.t])lowBoxes.push(b);
    blockers.push({b,tall:!!f.tall,t:f.t});
  }
  // garden: fence, trees, bushes, stepping stones
  const fenceC='#FFFFFF',pad=1.6;
  for(let x=-pad;x<=MW+pad+0.01;x+=1){for(const z of[-pad,MH+pad]){put('box',x,0.35,z,0.1,0.7,0.1,fenceC);if(x<MW+pad)put('box',x+0.5,0.5,z,1,0.07,0.05,fenceC),put('box',x+0.5,0.25,z,1,0.07,0.05,fenceC)}}
  for(let z=-pad;z<=MH+pad+0.01;z+=1){for(const x of[-pad,MW+pad]){put('box',x,0.35,z,0.1,0.7,0.1,fenceC);if(z<MH+pad)put('box',x,0.5,z+0.5,0.05,0.07,1,fenceC),put('box',x,0.25,z+0.5,0.05,0.07,1,fenceC)}}
  const R=G3rng(77);
  for(let i=0;i<46;i++){const side=i%4;let x,z;const t=R();
    if(side===0){x=-pad-1.5-R()*6;z=-4+t*(MH+8)}else if(side===1){x=MW+pad+1.5+R()*6;z=-4+t*(MH+8)}else if(side===2){x=-4+t*(MW+8);z=-pad-1.5-R()*6}else{x=-4+t*(MW+8);z=MH+pad+1.5+R()*6}
    if(R()<0.55){const h=0.8+R()*0.6,s=0.9+R()*0.7;put('cyl',x,h/2,z,0.22,h,0.22,'#8A5A36');put('sph',x,h+0.5*s,z,1.5*s,1.4*s,1.5*s,R()<0.5?'#4E9B4E':'#5BAF55');put('sph',x+0.25*s,h+0.85*s,z-0.15*s,0.9*s,0.9*s,0.9*s,'#6CC266')}
    else{const s=0.5+R()*0.5;put('sph',x,0.3*s,z,1.1*s,0.8*s,1.1*s,'#5BAF55');if(R()<0.4)put('sph',x+0.2,0.55*s,z+0.15,0.14,0.14,0.14,R()<0.5?'#F5B3CF':'#FFF2A8')}}
  return {grid,mesh:M,boxes,tallBoxes,lowBoxes,blockers,W:MW,H:MH,def};
}
function G3rng(s){return()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

/* vision blockers as line segments */
function segmentsOf(boxes){const S=[];for(const [x0,z0,x1,z1] of boxes){S.push([x0,z0,x1,z0],[x1,z0,x1,z1],[x1,z1,x0,z1],[x0,z1,x0,z0])}return S}

/* walk grid at 0.5 resolution; a cell is free if a character of radius r fits at its centre */
const CS=0.5;
function walkGrid(boxes,r){
  const nx=MW/CS,nz=MH/CS,free=new Uint8Array(nx*nz);
  for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){const x=(i+0.5)*CS,z=(j+0.5)*CS;let ok=true;
    for(const [x0,z0,x1,z1] of boxes){const cx=Math.max(x0,Math.min(x,x1)),cz=Math.max(z0,Math.min(z,z1));if((x-cx)**2+(z-cz)**2<r*r){ok=false;break}}
    free[j*nx+i]=ok?1:0}
  return {nx,nz,free};
}

window.HNSWorld={MAPS,ROOMS,build,segmentsOf,walkGrid,CS,shade,get MW(){return MW},get MH(){return MH}};
})();
