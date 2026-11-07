// Кошмар наяву: рушій правил без браузера. node bots/local-sim/dnd-engine-test.js
const path = require('path');
global.window = {};
for (const f of ['rules.js', 'story.js', 'engine.js']) require(path.join(__dirname, '../../ads/dnd', f));
const R = window.DND, S = window.DND_STORY, E = window.DNDE;
E.delay = 0;
let fails = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('✖ ' + msg); } };
const fresh = (players) => { E.G = E.blank(); E.syncChars(players); E.apply({ t: 'start' }, null, true); return E.G; };
const G = () => E.G;

// 1. карти: кожна клітинка-спавн досяжна, стіни по краях кімнат
for (const k in S.MAPS) {
  const m = S.MAPS[k];
  ok(m.length === E.H && m.every((r) => r.length === E.W), 'розмір мапи ' + k);
  ok(m.join('').includes('1'), 'мапа ' + k + ' має старт героїв');
}

// 2. бонуси навичок
{
  const g = fresh([{ n: 'Ліса', cls: 'rogue' }, { n: 'Бйорн', cls: 'fighter' }]);
  const b = E.skillB(g.chars['ліса'], 'stealth');
  ok(b.m === 3 && b.p === 4, 'злодійка: Скритність = +3 і експертність +4');
  ok(E.skillB(g.chars['бйорн'], 'stealth').p === 0, 'воїн: Скритність без майстерності');
  ok(E.passive(g.chars['бйорн']) === 13, 'пасивне сприйняття воїна 13');
  ok(E.spellDC(R.CLASSES.wizard) === 13 && E.spellAtk(R.CLASSES.cleric) === 5, 'СЛ і атака чарами');
}

// 3. перевірка: кидають тільки ті, кого назвали; групова
{
  const g = fresh([{ n: 'Ліса', cls: 'rogue' }, { n: 'Бйорн', cls: 'fighter' }, { n: 'Мара', cls: 'cleric' }]);
  E.apply({ t: 'ck', cfg: { kind: 'sk', key: 'stealth', dc: 12, who: ['ліса', 'бйорн', 'мара'], mode: 'group' } }, null, true);
  ok(g.ck && g.ck.mode === 'group', 'групова перевірка створена');
  E.apply({ t: 'roll' }, 'чужий', false);
  ok(!Object.keys(g.ck.res).length, 'чужий не кидає');
  for (const k of ['ліса', 'бйорн', 'мара']) E.apply({ t: 'roll' }, k, false);
  E.apply({ t: 'roll' }, 'ліса', false);
  ok(g.ck.done && typeof g.ck.gok === 'boolean', 'групова завершена');
  const r = g.ck.res['ліса'];
  ok(r.tot === r.v + 7, 'Ліса: к20 + 7');
  ok(g.seen.includes('check') && g.seen.includes('group'), 'уроки перевірки');
  E.apply({ t: 'ckclose' }, null, true);
  ok(!g.ck, 'перевірку закрито');
  E.apply({ t: 'ck', cfg: { kind: 'sv', key: 'con', dc: 12, who: ['бйорн'], gd: true } }, null, true);
  E.apply({ t: 'roll', k: 'бйорн' }, null, true);
  const rb = g.ck.res['бйорн'];
  ok(rb.parts.some((p) => p[0] === 'Майстерність') && rb.parts.some((p) => p[0] === 'Настанова'), 'рятівний Статури воїна з майстерністю й настановою');
}

// 4. бій: старт, ініціатива, рух, атака при нагоді, вихід за межі руху
{
  const g = fresh([{ n: 'Ліса', cls: 'rogue' }, { n: 'Бйорн', cls: 'fighter' }]);
  E.apply({ t: 'fight', f: 'wolves' }, null, true);
  const cb = g.cb;
  ok(cb && cb.order.length === 4, 'вовки: 2 герої + 2 вовки');
  ok(E.cur(g), 'є поточний хід');
  // ставимо руками для детермінованості
  const lisa = cb.tk['p_ліса'], wolf = cb.tk.m0, wolf2 = cb.tk.m1;
  Object.assign(lisa, { x: 5, y: 8 }); Object.assign(wolf, { x: 6, y: 8 }); Object.assign(wolf2, { x: 11, y: 0 });
  cb.turn = cb.order.indexOf('p_ліса');
  lisa.mv = 6; lisa.act = 1; lisa.bon = 1; lisa.atkLeft = 0; wolf.react = 1;
  // хтось інший не може рухати Лісу
  E.apply({ t: 'move', tok: 'p_ліса', x: 5, y: 10 }, 'бйорн', false);
  ok(lisa.y === 8, 'Бйорн не рухає Лісу');
  // занадто далеко
  E.apply({ t: 'move', tok: 'p_ліса', x: 5, y: 15 }, 'ліса', false);
  ok(lisa.y === 8, 'далі за швидкість не піти');
  const hpBefore = g.chars['ліса'].hp;
  E.apply({ t: 'move', tok: 'p_ліса', x: 4, y: 11 }, 'ліса', false);
  ok(lisa.x === 4 && lisa.y === 11 || g.chars['ліса'].hp <= 0, 'Ліса пішла');
  ok(wolf.react === 0, 'вовк витратив реакцію на атаку при нагоді');
  ok(g.seen.includes('oa'), 'урок атаки при нагоді');
  ok(lisa.mv === 3, 'лишилось 3 клітинки руху (було ' + lisa.mv + ')');
  // стрільба впритул — перешкода; далеко — перешкода
  Object.assign(wolf, { x: 4, y: 12 });
  const bow = E.attacks(g, lisa).findIndex((a) => a.range);
  const c1 = E.atkCheck(g, lisa, E.attacks(g, lisa)[bow], wolf);
  ok(c1.ok && c1.dis.includes('стріляєш, коли ворог поруч'), 'стрільба поруч з ворогом — перешкода');
  E.apply({ t: 'atk', tok: 'p_ліса', tgt: 'm0', w: 0 }, 'ліса', false);
  ok(lisa.act === 0, 'атака витратила дію');
  E.apply({ t: 'atk', tok: 'p_ліса', tgt: 'm0', w: 0 }, 'ліса', false);
  const lastRolls = g.log.filter((e) => e.c === 'roll').length;
  ok(lastRolls >= 1, 'є кидок атаки');
  E.apply({ t: 'feat', tok: 'p_ліса', f: 'cunning', a: 'dis' }, 'ліса', false);
  ok(lisa.dis && lisa.bon === 0, 'хитра дія: відступ');
  const id = E.cur(g).id;
  E.apply({ t: 'end', tok: 'p_ліса' }, 'ліса', false);
  ok(E.cur(g).id !== id || g.cb.won, 'хід перейшов');
  void hpBefore;
}

// 5. заклинання: конус, сон, лікування піднімає
{
  const g = fresh([{ n: 'Корвін', cls: 'wizard' }, { n: 'Мара', cls: 'cleric' }]);
  E.apply({ t: 'fight', f: 'wolves' }, null, true);
  const cb = g.cb, kor = cb.tk['p_корвін'], mara = cb.tk['p_мара'], w0 = cb.tk.m0, w1 = cb.tk.m1;
  Object.assign(kor, { x: 5, y: 10 }); Object.assign(w0, { x: 5, y: 8 }); Object.assign(w1, { x: 0, y: 3 }); Object.assign(mara, { x: 9, y: 13 });
  cb.turn = cb.order.indexOf('p_корвін'); Object.assign(kor, { mv: 6, act: 1, bon: 1, atkLeft: 0 });
  const cells = E.coneCells(kor, 5, 8, 3);
  ok(cells.some(([x, y]) => x === 5 && y === 8) && !cells.some(([x, y]) => x === 5 && y === 12), 'конус дивиться вгору');
  E.apply({ t: 'spell', tok: 'p_корвін', sp: 'hands', x: 5, y: 8 }, 'корвін', false);
  ok(g.chars['корвін'].slots === 2 && kor.act === 0, 'Палючі долоні: комірка і дія');
  ok(g.log.some((e) => e.r && /Рятівний Спритність/.test(e.r.lbl)), 'вовк кидав рятівний Спритності');
  // сон: у колі слабкий вовк
  Object.assign(kor, { act: 1 }); w1.hp = 3; Object.assign(w1, { x: 2, y: 4 });
  g.chars['корвін'].slots = 2;
  E.apply({ t: 'spell', tok: 'p_корвін', sp: 'sleep', x: 2, y: 4 }, 'корвін', false);
  ok(w1.cond.sleep === true, 'Сон приспав вовка з 3 хітами');
  // атака по сплячому з перевагою
  const chk = E.atkCheck(g, mara, E.attacks(g, mara)[0], w1);
  ok(!chk.ok || chk.adv.includes('ціль спить'), 'перевага проти сплячого');
  // лікування піднімає
  g.chars['корвін'].hp = 0;
  cb.turn = cb.order.indexOf('p_мара'); Object.assign(mara, { act: 1, bon: 1, x: 6, y: 10 });
  E.apply({ t: 'spell', tok: 'p_мара', sp: 'hword', tgt: 'p_корвін' }, 'мара', false);
  ok(g.chars['корвін'].hp >= 7, 'Слово зцілення підняло Корвіна (' + g.chars['корвін'].hp + ')');
  // благословення + концентрація
  E.apply({ t: 'spell', tok: 'p_мара', sp: 'bless', tgts: ['p_корвін', 'p_мара'] }, 'мара', false);
  ok(kor.cond.bless === 'p_мара' && mara.conc === 'bless', 'Благословення з концентрацією');
}

// 6. 0 хітів і кидки від смерті
{
  const g = fresh([{ n: 'Бйорн', cls: 'fighter' }]);
  E.apply({ t: 'fight', f: 'wolves' }, null, true);
  const cb = g.cb, b = cb.tk['p_бйорн'];
  g.chars['бйорн'].hp = 2;
  E.apply({ t: 'hp', k: 'бйорн', d: -5 }, null, true);
  ok(g.chars['бйорн'].hp === 0 && !g.chars['бйорн'].dead, 'Бйорн без тями');
  ok(cb.lost, 'усі герої впали — поразка');
  cb.lost = false;
  cb.turn = cb.order.indexOf('p_бйорн'); b.act = 1;
  for (let i = 0; i < 6 && !g.chars['бйорн'].dead && !g.chars['бйорн'].stable && g.chars['бйорн'].hp <= 0; i++) { b.act = 1; E.apply({ t: 'death', tok: 'p_бйорн' }, 'бйорн', false); }
  const ch = g.chars['бйорн'];
  ok(ch.dead || ch.stable || ch.hp === 1, 'кидки від смерті дійшли до кінця');
}

// 7. авто-хід вовків доходить до кінця бою або ходу
(async () => {
  const g = fresh([{ n: 'Бйорн', cls: 'fighter' }, { n: 'Ейла', cls: 'ranger' }, { n: 'Мара', cls: 'cleric' }]);
  E.apply({ t: 'fight', f: 'hall' }, null, true);
  ok(Object.values(g.cb.tk).some((t) => t.mt === 'erandur' && t.side === 'pc'), 'Ерандур на боці героїв');
  ok(Object.values(g.cb.tk).filter((t) => t.side === 'foe').length === 4, 'зала: 2 орки + 2 культисти');
  let guard = 0;
  while (g.cb && !g.cb.won && !g.cb.lost && guard++ < 400) {
    const t = E.cur(g);
    if (t.ch) { // герої теж «ходять» найпростіше: б'ють найближчого, інакше кінець ходу
      const foe = E.toks(g).filter((o) => o.side === 'foe' && E.alive(g, o)).sort((a, b) => E.dist(t, a) - E.dist(t, b))[0];
      const a = E.attacks(g, t), wi = a.findIndex((x) => foe && E.atkCheck(g, t, x, foe).ok);
      if (g.chars[t.ch].hp <= 0) E.apply({ t: 'death', tok: t.id }, t.ch, false);
      else if (wi >= 0) E.apply({ t: 'atk', tok: t.id, tgt: foe.id, w: wi }, t.ch, false);
      E.apply({ t: 'end', tok: t.id }, t.ch, false);
    } else await E.autoTurn();
  }
  ok(g.cb.won || g.cb.lost, 'бій у залі дійшов до кінця за ' + guard + ' ходів');
  // боти-гравці: кидають самі й воюють самі
  const gb = E.G = E.blank();
  E.apply({ t: 'bot', cls: 'fighter' }, null, true); E.apply({ t: 'bot', cls: 'wizard' }, null, true); E.apply({ t: 'bot', cls: 'cleric' }, null, true);
  E.syncChars([]);
  ok(Object.keys(gb.chars).length === 3 && Object.values(gb.chars).every((c) => c.bot), 'троє ботів пережили синхронізацію лобі');
  E.apply({ t: 'start' }, null, true);
  E.apply({ t: 'ck', cfg: { kind: 'sk', key: 'stealth', dc: 12, who: Object.keys(gb.chars), mode: 'group' } }, null, true);
  while (E.botRolls());
  ok(gb.ck.done, 'боти кинули групову перевірку');
  E.apply({ t: 'fight', f: 'shrine' }, null, true);
  let gg = 0;
  while (gb.cb && !gb.cb.won && !gb.cb.lost && gg++ < 400) { await E.autoTurn(); }
  ok(gb.cb.won || gb.cb.lost, 'боти й монстри довоювали фінальний бій самі за ' + gg + ' ходів (' + (gb.cb.won ? 'перемога' : 'поразка') + ')');
  ok(gb.log.some((e) => e.r && /Вогняна стріла/.test(e.r.lbl)), 'бот-маг стріляє Вогняною стрілою');
  ok(JSON.stringify(g).length < 30000, 'стан вміщається в запис бази (' + JSON.stringify(g).length + ')');
  console.log((fails ? '✖ ' : '✔ ') + (n - fails) + '/' + n + ' перевірок рушія');
  process.exit(fails ? 1 : 0);
})();
