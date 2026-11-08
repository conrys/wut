// Кошмар наяву: бот-майстер проводить усю пригоду від Данстара до фіналу. node bots/local-sim/dnd-botdm-test.js
const path = require('path');
global.window = {};
for (const f of ['rules.js', 'story.js', 'engine.js', 'botdm.js']) require(path.join(__dirname, '../../ads/dnd', f));
const R = window.DND, E = window.DNDE, BOT = window.DNDBotDM;
E.delay = 0; BOT.BD.fast = true;
let fails = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('✖ ' + msg); } };

async function play(cls, mates, pick) {
  E.G = E.blank();
  E.G.chars['я'] = E.newChar('Я', cls);
  mates.forEach((c) => E.apply({ t: 'bot', cls: c }, null, true));
  E.apply({ t: 'start' }, null, true);
  BOT.init(E, 'я');
  const g = E.G, seenScenes = new Set(), kinds = new Set(), fights = new Set();
  let guard = 0;
  while (!g.bd.end && guard++ < 6000) {
    BOT.step(E);
    while (E.botRolls());
    const v = BOT.view(g);
    seenScenes.add(g.bd.sc); if (g.cb) fights.add(g.cb.f);
    if (g.cb && !g.cb.won && !g.cb.lost) {
      const t = E.cur(g);
      if (t.ch === 'я') { // «я» граю просто: б'ю, хто в зоні, інакше кінець ходу
        if (g.chars['я'].hp <= 0) E.apply({ t: 'death', tok: t.id }, 'я', false);
        else { const foe = E.toks(g).filter((o) => o.side === 'foe' && E.alive(g, o)).sort((a, b) => E.dist(t, a) - E.dist(t, b))[0]; const a = E.attacks(g, t), wi = a.findIndex((x) => foe && E.atkCheck(g, t, x, foe).ok); if (wi >= 0) E.apply({ t: 'atk', tok: t.id, tgt: foe.id, w: wi }, 'я', false); }
        E.apply({ t: 'end', tok: t.id }, 'я', false);
      } else await E.autoTurn();
      continue;
    }
    if (g.ck && !g.ck.done && g.ck.who.includes('я') && !g.ck.res['я']) { E.apply({ t: 'roll' }, 'я', false); continue; }
    if (!v) continue;
    kinds.add(v.k);
    if (v.k === 'msg') BOT.op(E, { t: 'dmnext' });
    else if (v.k === 'choice') { const o = pick(v); if (o == null) BOT.op(E, { t: 'dmdone' }); else BOT.op(E, { t: 'dmpick', o }); }
  }
  return { g, guard, seenScenes, kinds, fights };
}
(async () => {
  // 1) злодійка з магом і жрицею, обирає все підряд
  const r1 = await play('rogue', ['wizard', 'cleric'], (v) => { const o = v.opts.find((x) => !x.used); return v.multi && v.opts.filter((x) => x.used).length >= 3 ? null : o ? o.i : null; });
  ok(r1.g.bd.end, 'пригода 1 дійшла до кінця (' + r1.guard + ' кроків)');
  ok(r1.seenScenes.size === 6, 'пройдено всі 6 сцен');
  ok(r1.g.end === 'a' || r1.g.end === 'b', 'є фінал: ' + r1.g.end);
  ok(['msg', 'choice'].every((k) => r1.kinds.has(k)), 'були і розповідь, і вибір');
  ok(r1.fights.size === 3, 'три бої: ' + [...r1.fights].join(', '));
  ok(r1.g.log.some((e) => e.r && /Вогняна стріла|Палючі|Магічна/.test(e.r.lbl) || /Вогняна стріла/.test(e.t)), 'бот-маг чаклував');
  ok(['check', 'save', 'init', 'turn', 'passive'].every((k) => r1.g.seen.includes(k)), 'уроки: ' + r1.g.seen.join(','));
  // 2) воїн соло без злодія — двері лише виламати, пастку не знешкодити; обирає останні варіанти (сила)
  const r2 = await play('fighter', [], (v) => { const o = v.opts.filter((x) => !x.used).pop(); return v.multi && v.opts.some((x) => x.used) ? null : o ? o.i : null; });
  ok(r2.g.bd.end, 'пригода 2 (соло воїн) дійшла до кінця (' + r2.guard + ' кроків)');
  ok(!r2.g.log.some((e) => /Злодійські|Відімкнути/.test(e.t || '') || (e.r && /Злодійські/.test(e.r.lbl))), 'без злодія — жодних перевірок відмичок');
  ok(JSON.stringify(r1.g).length < 30000, 'стан вміщається (' + JSON.stringify(r1.g).length + ')');
  console.log((fails ? '✖ ' : '✔ ') + (n - fails) + '/' + n + ' перевірок бота-майстра');
  process.exit(fails ? 1 : 0);
})();
