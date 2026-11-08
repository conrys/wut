// Кошмар наяву: бот-майстер проводить усю пригоду різними стилями гри. node bots/local-sim/dnd-botdm-test.js
const path = require('path');
global.window = {};
for (const f of ['rules.js', 'story.js', 'engine.js', 'botdm.js']) require(path.join(__dirname, '../../ads/dnd', f));
const R = window.DND, S = window.DND_STORY, E = window.DNDE, BOT = window.DNDBotDM;
E.delay = 0; BOT.BD.fast = true;
let fails = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('✖ ' + msg); } };

async function play(cls, mates, pick) {
  E.G = E.blank();
  E.G.chars['я'] = E.newChar('Я', cls);
  mates.forEach((c) => E.apply({ t: 'bot', cls: c }, null, true));
  E.apply({ t: 'start' }, null, true);
  BOT.init(E, 'я');
  const g = E.G, scenes = new Set(), fights = new Set(), picks = [];
  let guard = 0, msgs = 0, bad = '';
  while (!g.bd.end && guard++ < 9000) {
    BOT.step(E);
    while (E.botRolls());
    if (g.cb && !g.cb.won && !g.cb.lost) {
      fights.add(g.cb.f);
      const t = E.cur(g);
      if (t.ch === 'я') {
        if (g.chars['я'].hp <= 0) E.apply({ t: 'death', tok: t.id }, 'я', false);
        else { const foe = E.toks(g).filter((o) => o.side === 'foe' && E.alive(g, o)).sort((a, b) => E.dist(t, a) - E.dist(t, b))[0]; const a = E.attacks(g, t), wi = a.findIndex((x) => foe && E.atkCheck(g, t, x, foe).ok); if (wi >= 0) E.apply({ t: 'atk', tok: t.id, tgt: foe.id, w: wi }, 'я', false); }
        E.apply({ t: 'end', tok: t.id }, 'я', false);
      } else await E.autoTurn();
      continue;
    }
    scenes.add(g.bd.sc);
    if (g.ck && !g.ck.done && g.ck.who.includes('я') && !g.ck.res['я']) { E.apply({ t: 'roll' }, 'я', false); continue; }
    const v = BOT.view(g); if (!v) continue;
    if (v.k === 'msg') { msgs++; if (!v.t) bad = 'порожнє повідомлення'; BOT.op(E, { t: 'dmnext' }); }
    else if (v.k === 'choice') { const o = pick(v); picks.push(o ? o : '—'); if (o == null) { if (!v.done) { bad = 'хаб без варіантів і без «далі»: ' + v.ask; break; } BOT.op(E, { t: 'dmdone' }); } else BOT.op(E, { t: 'dmpick', o }); }
  }
  if (!g.bd.end && g.cb) { const cb = g.cb; console.log('ЗАСТРЯГ у бою', cb.f, 'раунд', cb.round, JSON.stringify(Object.values(cb.tk).map((t) => { const i = E.info(g, t); return [i.n, t.x, t.y, i.hp, i.down ? 'down' : '', i.dead ? 'dead' : '', t.cond.sleep ? 'sleep' : '', t.side]; })), 'хід', E.cur(g) && E.info(g, E.cur(g)).n); }
  return { g, guard, scenes, fights, picks, msgs, bad };
}
const curious = (v) => (v.opts.length ? v.opts[0].i : null);
const hasty = (v) => (v.done ? null : v.opts[v.opts.length - 1].i);
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const random = (v) => (v.done && rnd() < 0.3 ? null : v.opts.length ? v.opts[Math.floor(rnd() * v.opts.length)].i : null);
const scnId = (i) => S.SCENES[i].id;

(async () => {
  for (const [name, cls, mates, pick] of [['цікавий (злодійка+маг+жриця)', 'rogue', ['wizard', 'cleric'], curious], ['поспішний (воїн соло)', 'fighter', [], hasty], ['випадковий (маг+воїн)', 'wizard', ['fighter'], random], ['випадковий (жриця+3)', 'cleric', ['fighter', 'rogue', 'ranger'], random]]) {
    const r = await play(cls, mates, pick);
    ok(!r.bad, name + ': ' + r.bad);
    ok(r.g.bd.end, name + ': дійшов до кінця (' + r.guard + ' кроків, сцена ' + scnId(r.g.bd.sc) + ', біт ' + r.g.bd.i + ')');
    ok(r.scenes.size === 6 && r.fights.size === 3, name + ': 6 сцен і 3 бої (' + r.scenes.size + '/' + r.fights.size + ')');
    ok(r.g.end === 'a' || r.g.end === 'b', name + ': фінал ' + r.g.end);
    ok(r.g.goal === 'done', name + ': мета «завершено»');
    if (pick === curious) {
      ok(r.g.lore.length >= 9, name + ': відкрито лору ' + r.g.lore.length + ' (' + r.g.lore.join(',') + ')');
      ok(r.g.journal.length >= 10, name + ': записів журналу ' + r.g.journal.length);
      ok(r.msgs > 60, name + ': повідомлень майстра ' + r.msgs);
    }
    console.log('  ' + name + ': ' + r.msgs + ' повідомлень, ' + r.picks.length + ' виборів, лор ' + r.g.lore.length + ', журнал ' + r.g.journal.length + ', фінал ' + r.g.end);
  }
  // ланцюжок: «чи не договорює» недоступне, поки не поговорили з жерцем
  E.G = E.blank(); E.G.chars['я'] = E.newChar('Я', 'rogue'); E.apply({ t: 'start' }, null, true); BOT.init(E, 'я');
  const g = E.G; let seenHideEarly = false, seenTalk = false, seenName = false, guard = 0;
  while (guard++ < 400 && g.bd.sc < 2) {
    BOT.step(E); while (E.botRolls());
    if (g.ck && !g.ck.done && g.ck.who.includes('я') && !g.ck.res['я']) { E.apply({ t: 'roll' }, 'я', false); continue; }
    const v = BOT.view(g); if (!v) continue;
    if (v.k === 'msg') { if (/Ерандур/.test(v.t) && !seenTalk && g.bd.sc === 1) seenName = true; BOT.op(E, { t: 'dmnext' }); continue; }
    if (v.k === 'choice') {
      const ids = v.opts.map((o) => o.i);
      if (ids.includes('hide') && !g.bd.flags.evasive) seenHideEarly = true;
      const o = ['talk', 'doing', 'how', 'hide', 'go', 'bar', 'what', 'who', 'work', 'yes'].find((x) => ids.includes(x));
      if (o === 'talk') seenTalk = true;
      if (o) BOT.op(E, { t: 'dmpick', o }); else BOT.op(E, { t: 'dmdone' });
    }
  }
  ok(!seenHideEarly, 'варіант «чи не договорює» зʼявляється лише після розмови');
  ok(!seenName, 'імʼя Ерандура не звучить до розмови з ним');
  console.log((fails ? '✖ ' : '✔ ') + (n - fails) + '/' + n + ' перевірок бота-майстра');
  process.exit(fails ? 1 : 0);
})();
