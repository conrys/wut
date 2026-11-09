/* Кошмар наяву — рушій правил. Працює лише на телефоні майстра: він тримає стан G,
   гравці надсилають наміри (op), майстер їх застосовує й розсилає новий G.
   Немає DOM — тож тестується в node (bots/local-sim/dnd-engine-test.js). */
(function () {
  const R = window.DND, S = window.DND_STORY;
  const W = 12, H = 16;
  const uid = () => Math.random().toString(36).slice(2, 9);
  const keyOf = (n) => String(n || '').trim().toLowerCase();

  /* ---------- герой: похідні числа ---------- */
  // клас героя з урахуванням власного героя (ch.h — навички походження тощо)
  const C = (ch) => (ch && ch.h ? Object.assign({}, R.CLASSES[ch.cls], ch.h) : R.CLASSES[ch.cls]);
  function skillB(ch, sk) {
    const c = C(ch), s = R.SKILLS[sk];
    let p = 0;
    if (c.skills.includes(sk)) p = R.PROF;
    if ((c.expert || []).includes(sk)) p = R.PROF * 2;
    return { m: R.mod(c.st[s.st]), p, st: s.st };
  }
  const saveB = (ch, st) => { const c = C(ch); return { m: R.mod(c.st[st]), p: c.saves.includes(st) ? R.PROF : 0 }; };
  const passive = (ch) => { const b = skillB(ch, 'perception'); return 10 + b.m + b.p; };
  function wAtk(c, w) {
    let m = R.mod(c.st[w.st]);
    if (w.finesse) m = Math.max(m, R.mod(c.st.dex));
    return { b: m + R.PROF + (w.archery ? 2 : 0), m };
  }
  const spellAtk = (c) => R.mod(c.st[c.cast]) + R.PROF;
  const spellDC = (c) => 8 + R.PROF + R.mod(c.st[c.cast]);
  function newChar(n, cls, hero) { // hero: {n, bg, look, story, ip, ii} — власний герой гравця
    const c = R.CLASSES[cls];
    const ch = { n: String(hero && hero.n ? hero.n : n).slice(0, 20), cls, hp: c.hp, slots: c.slots || 0, uses: { wind: 1, surge: 1 }, ds: { s: 0, f: 0 }, stable: false, dead: false };
    if (hero) {
      const h = R.buildHero({ cls, bg: hero.bg });
      if (h) ch.h = { skills: h.skills };
      ch.hero = { bg: h ? h.bg : '', look: String(hero.look || '').slice(0, 300), story: String(hero.story || '').slice(0, 500), ip: hero.ip || '', ii: hero.ii || '', id: hero.id || '' };
    }
    return ch;
  }

  /* ---------- токени ---------- */
  function info(g, t) {
    if (t.ch) {
      const ch = g.chars[t.ch], c = C(ch);
      return { n: ch.n, ic: c.ic, col: c.col, hp: ch.hp, mhp: c.hp, ac: c.ac, sp: c.sp, st: c.st, down: ch.hp <= 0 && !ch.dead, dead: !!ch.dead, pc: true, ch, c };
    }
    const m = R.MONSTERS[t.mt];
    return { n: t.n, ic: m.ic, col: m.col, hp: t.hp, mhp: t.mhp, ac: m.ac, sp: m.sp, st: m.st, down: false, dead: t.hp <= 0, pc: false, m };
  }
  const alive = (g, t) => !info(g, t).dead;
  const active = (g, t) => { const i = info(g, t); return !i.dead && !i.down && !t.cond.sleep; };
  const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  const toks = (g) => (g.cb ? Object.values(g.cb.tk) : []);
  const cur = (g) => (g.cb && g.cb.turn >= 0 ? g.cb.tk[g.cb.order[g.cb.turn]] : null);
  function attacks(g, t) { // уніфікований список атак токена
    const i = info(g, t);
    if (i.pc) return i.c.weapons.map((w) => {
      const a = wAtk(i.c, w);
      return { n: w.n, b: a.b, dmg: w.dmg + (a.m ? (a.m > 0 ? '+' : '') + a.m : ''), reach: w.reach || (w.thrown ? 1 : 0), range: w.range || 0, long: w.long || 0, finesse: !!w.finesse || !!w.range };
    });
    return i.m.atk.map((a) => ({ n: a.n, b: a.bonus, dmg: a.dmg, reach: a.reach || 0, range: a.range || 0, long: a.long || a.range || 0, spell: !!a.spell }));
  }

  /* ---------- мапа ---------- */
  const tile = (g, x, y) => (x < 0 || y < 0 || x >= W || y >= H ? '#' : S.MAPS[g.cb.map][y][x]);
  const blocksMove = (c) => '#TrPBS'.includes(c);
  const blocksLos = (c) => '#TP'.includes(c);
  function occ(g, x, y, except) {
    for (const t of toks(g)) if (t.id !== except && t.x === x && t.y === y && alive(g, t)) return t;
    return null;
  }
  /* Дейкстра по клітинках: діагональ = 1, кучугури = 2, ворогів не обійти, через своїх — можна (але не стати). */
  function reach(g, t, budget) {
    const K = (x, y) => x + ',' + y, d = new Map([[K(t.x, t.y), 0]]), prev = new Map(), q = [[0, t.x, t.y]];
    while (q.length) {
      q.sort((a, b) => a[0] - b[0]);
      const [c0, x, y] = q.shift();
      if (c0 > d.get(K(x, y))) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy, c = tile(g, nx, ny);
        if (blocksMove(c)) continue;
        if (dx && dy && blocksMove(tile(g, nx, y)) && blocksMove(tile(g, x, ny))) continue;
        const o = occ(g, nx, ny, t.id);
        if (o && o.side !== t.side) continue;
        const nc = c0 + (c === '~' ? 2 : 1);
        if (nc > budget) continue;
        const k = K(nx, ny);
        if (d.has(k) && d.get(k) <= nc) continue;
        d.set(k, nc); prev.set(k, [x, y]); q.push([nc, nx, ny]);
      }
    }
    for (const k of [...d.keys()]) { const [x, y] = k.split(',').map(Number); if ((x !== t.x || y !== t.y) && occ(g, x, y, t.id)) d.set(k, -1); }
    return { d, prev, K };
  }
  function pathTo(r, t, x, y) {
    const out = []; let k = r.K(x, y);
    if (!r.d.has(k) || r.d.get(k) < 0) return null;
    let p = [x, y];
    while (p && !(p[0] === t.x && p[1] === t.y)) { out.unshift(p); p = r.prev.get(r.K(p[0], p[1])); }
    return out;
  }
  function los(g, a, b) {
    const n = Math.ceil(dist(a, b) * 4) + 1;
    for (let i = 1; i < n; i++) {
      const x = Math.floor(a.x + 0.5 + (b.x - a.x) * i / n), y = Math.floor(a.y + 0.5 + (b.y - a.y) * i / n);
      if ((x === a.x && y === a.y) || (x === b.x && y === b.y)) continue;
      if (blocksLos(tile(g, x, y))) return false;
    }
    return true;
  }
  function coneCells(o, tx, ty, size) {
    let vx = tx - o.x, vy = ty - o.y; const l = Math.hypot(vx, vy) || 1; vx /= l; vy /= l;
    const out = [];
    for (let y = o.y - size; y <= o.y + size; y++) for (let x = o.x - size; x <= o.x + size; x++) {
      const wx = x - o.x, wy = y - o.y, len = Math.hypot(wx, wy);
      if (!len || len > size + 0.5 || x < 0 || y < 0 || x >= W || y >= H) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, (wx * vx + wy * vy) / len)));
      if (ang <= 0.5 + 0.35 / len) out.push([x, y]);
    }
    return out;
  }
  function sphereCells(cx, cy, size) {
    const out = [];
    for (let y = cy - size; y <= cy + size; y++) for (let x = cx - size; x <= cx + size; x++)
      if (x >= 0 && y >= 0 && x < W && y < H && Math.hypot(x - cx, y - cy) <= size + 0.25) out.push([x, y]);
    return out;
  }
  const enemyNear = (g, t) => toks(g).some((o) => o.side !== t.side && active(g, o) && dist(o, t) <= 1);

  /* Чи можна атакувати ціль цією атакою і з якими перевагами/перешкодами (для показу до кидка). */
  function atkCheck(g, t, a, tgt) {
    const d = dist(t, tgt), ti = info(g, tgt);
    if (!alive(g, tgt) || tgt.id === t.id) return { ok: false, why: 'Не ціль' };
    const melee = a.reach && d <= a.reach;
    if (!melee) {
      if (!a.range) return { ok: false, why: 'Треба підійти впритул' };
      if (d > a.long) return { ok: false, why: 'Задалеко' };
      if (!los(g, t, tgt)) return { ok: false, why: 'Не видно — заважає стіна' };
    }
    const adv = [], dis = [];
    const helpless = tgt.cond.sleep || ti.down;
    if (helpless) adv.push(tgt.cond.sleep ? 'ціль спить' : 'ціль без тями');
    if (t.hidden) adv.push('ти схований');
    if (!melee && d > a.range) dis.push('далека дистанція');
    if (!melee && enemyNear(g, t)) dis.push('стріляєш, коли ворог поруч');
    if (tgt.cond.dodge && !helpless) dis.push('ціль ухиляється');
    const m = !info(g, t).pc && info(g, t).m;
    if (m && m.pack && toks(g).some((o) => o.id !== t.id && o.side === t.side && active(g, o) && dist(o, tgt) <= 1)) adv.push('тактика зграї');
    return { ok: true, melee, adv, dis, n: (adv.length ? 1 : 0) - (dis.length ? 1 : 0), autoCrit: helpless && d <= 1 };
  }

  /* ---------- прогноз: шанс і очікувана шкода (показуємо при прицілюванні) ---------- */
  function dstat(expr, crit) { const p = R.parse(expr), n = crit ? p.n * 2 : p.n; return { min: n + p.b, max: n * p.s + p.b, avg: n * (p.s + 1) / 2 + p.b, dice: n * (p.s + 1) / 2 }; }
  function hitChance(bonus, ac, adv) { // нат 1 — промах, нат 20 — влучання
    const p = Math.min(0.95, Math.max(0.05, (21 - (ac - bonus)) / 20));
    return adv > 0 ? 1 - (1 - p) * (1 - p) : adv < 0 ? p * p : p;
  }
  function saveFail(t, st, dc, g0) {
    const g = g0 || E.G, i = info(g, t);
    if ((st === 'dex' || st === 'str') && (t.cond.sleep || i.down)) return 1;
    const b = R.mod(i.st[st]) + (i.pc && i.c.saves.includes(st) ? R.PROF : 0) + (t.cond.bless ? 2.5 : 0);
    return Math.min(1, Math.max(0, (dc - 1 - b) / 20));
  }
  function attackPreview(t, a, tgt, g0) { // g0 — стан гри (на телефоні гравця E.G порожній)
    const g = g0 || E.G, ac = atkCheck(g, t, a, tgt); if (!ac.ok) return null;
    const ti = info(g, tgt), ai = info(g, t);
    const bonus = a.b + (t.cond.bless ? 2.5 : 0), p = ac.autoCrit ? hitChance(bonus, ti.ac, ac.n) : hitChance(bonus, ti.ac, ac.n);
    const pc = ac.autoCrit ? p : (ac.n > 0 ? 1 - 0.95 * 0.95 : ac.n < 0 ? 0.0025 : 0.05);
    let ex = [];
    if (ai.pc && ai.ch.cls === 'rogue' && !t.sneak && a.finesse && ac.n >= 0 && (ac.n > 0 || toks(g).some((o) => o.id !== t.id && o.side === t.side && active(g, o) && dist(o, tgt) <= 1))) ex.push(['Підступна атака', '1d6']);
    if (t.markT === tgt.id && !a.spell) ex.push(['Мітка мисливця', '1d6']);
    const base = dstat(a.dmg, ac.autoCrit), exs = ex.map((x) => dstat(x[1], ac.autoCrit));
    const min = base.min + exs.reduce((s, x) => s + x.min, 0), max = base.max + exs.reduce((s, x) => s + x.max, 0), avg = base.avg + exs.reduce((s, x) => s + x.avg, 0);
    const critBonus = ac.autoCrit ? 0 : base.dice + exs.reduce((s, x) => s + x.dice, 0); // крит подвоює кубики
    const expected = p * avg + pc * critBonus;
    return { p, min, max, avg, expected, dmg: a.dmg, extra: ex.map((x) => x[0]), autoCrit: ac.autoCrit, kills: min >= ti.hp, mayKill: max >= ti.hp, hp: ti.hp, ac: ti.ac, bonus: a.b };
  }

  /* ==================== Хост ==================== */
  const E = { G: null, dirty: false, busy: false, onChange: null, wait: (ms) => new Promise((r) => setTimeout(r, ms)), delay: 1100 };

  function blank() {
    return { v: 1, started: false, sc: 0, chars: {}, ck: null, cb: null, log: [], seen: [], les: [], lore: [], journal: [], goal: null, pid: [], fx: [], lessonsOn: true, end: null };
  }
  function log(t, c, extra) {
    const e = Object.assign({ i: uid(), t, c: c || '' }, extra || {});
    E.G.log.push(e); if (E.G.log.length > 36) E.G.log.splice(0, E.G.log.length - 36);
    E.dirty = true; return e;
  }
  function lesson(k) {
    const g = E.G; if (!g.lessonsOn || g.seen.includes(k) || !R.LESSONS[k]) return;
    g.seen.push(k); g.les = (g.les || []).concat({ i: uid(), k }).slice(-4); E.dirty = true;
  }
  function fx(o) { o.i = uid(); E.G.fx.push(o); if (E.G.fx.length > 24) E.G.fx.shift(); E.dirty = true; }
  const P = (n, v) => [n, v];
  function rollEntry(who, lbl, r, parts, vs, vsL, ok, extra) {
    const tot = r.v + parts.reduce((a, p) => a + p[1], 0);
    return Object.assign({ who, lbl, d: r.d, v: r.v, parts, tot, vs, vsL, ok }, extra || {});
  }
  function rollFx(at, e, extra) { // кубик на мапі: к20, бонус, проти чого, вердикт
    fx(Object.assign({ k: 'roll', at, d: e.d, v: e.v, b: e.parts.reduce((s, p) => s + p[1], 0), tot: e.tot, vs: e.vs, vsL: e.vsL, ok: e.ok, crit: !!e.crit, adv: e.adv || 0, who: e.who }, extra || {}));
  }
  function blessD4(t, parts) { if (t && t.cond && t.cond.bless) parts.push(P('Благословення', R.rnd(4))); }

  /* ---------- перевірки поза боєм ---------- */
  function checkStart(cfg) {
    const g = E.G;
    g.ck = { id: uid(), t: cfg.t || '', kind: cfg.kind, key: cfg.key, dc: +cfg.dc || 10, show: cfg.show !== false, adv: +cfg.adv || 0, gd: !!cfg.gd,
      who: (cfg.who || []).filter((k) => g.chars[k]), mode: cfg.mode || 'one', sid: cfg.sid || null, why: cfg.why || '', res: {}, done: false };
    if (!g.ck.who.length) { g.ck = null; return; }
    if (g.ck.who.length < 2 && g.ck.mode === 'group') g.ck.mode = 'one';
    log('Майстер просить: ' + checkName(g.ck) + ' (' + g.ck.who.map((k) => g.chars[k].n).join(', ') + ')', 'ck');
    lesson(cfg.kind === 'sv' ? 'save' : 'check');
    if (g.ck.mode === 'group') lesson('group');
    if (g.ck.adv) lesson('adv');
  }
  function checkName(ck) {
    if (ck.kind === 'sk') return R.SKILLS[ck.key].n + ' (' + R.STATS[R.SKILLS[ck.key].st].n + ')';
    if (ck.kind === 'st') return 'Перевірка: ' + R.STATS[ck.key].n;
    return 'Рятівний кидок: ' + R.STATS[ck.key].n;
  }
  function checkParts(ch, ck) {
    const parts = [];
    if (ck.kind === 'sk') {
      const b = skillB(ch, ck.key);
      parts.push(P(R.STATS[b.st].n, b.m));
      if (b.p) parts.push(P(b.p > R.PROF ? 'Експертність' : 'Майстерність', b.p));
    } else if (ck.kind === 'st') parts.push(P(R.STATS[ck.key].n, R.mod(C(ch).st[ck.key])));
    else { const b = saveB(ch, ck.key); parts.push(P(R.STATS[ck.key].n, b.m)); if (b.p) parts.push(P('Майстерність', b.p)); }
    return parts;
  }
  function checkRoll(k) {
    const g = E.G, ck = g.ck;
    if (!ck || ck.done || !ck.who.includes(k) || ck.res[k]) return;
    const ch = g.chars[k], parts = checkParts(ch, ck);
    if (ck.gd) parts.push(P('Настанова', R.rnd(4)));
    const r = R.d20(ck.adv), e = rollEntry(ch.n, checkName(ck), r, parts, ck.dc, 'СЛ', false, { adv: ck.adv });
    e.ok = e.tot >= ck.dc;
    ck.res[k] = { d: e.d, v: e.v, parts, tot: e.tot, ok: e.ok };
    log(ch.n + ': ' + checkName(ck), 'roll', { r: e });
    if (r.v === 20) lesson('nat20'); if (r.v === 1) lesson('nat1');
    if (ck.who.every((w) => ck.res[w])) {
      ck.done = true;
      if (ck.mode === 'group') {
        const okN = ck.who.filter((w) => ck.res[w].ok).length;
        ck.gok = okN * 2 >= ck.who.length;
        log('Групова перевірка: ' + okN + ' з ' + ck.who.length + ' — ' + (ck.gok ? 'успіх' : 'провал'), ck.gok ? 'ok' : 'bad');
      }
    }
  }

  /* ---------- бій ---------- */
  function fightStart(fid, surp) {
    const g = E.G, F = S.FIGHTS[fid]; if (!F) return;
    const map = S.MAPS[F.map], tk = {}, keys = Object.keys(g.chars).filter((k) => !g.chars[k].dead);
    const spots = {}; // буква → список клітинок
    map.forEach((row, y) => [...row].forEach((c, x) => { if (/[1-5wocVKE]/.test(c)) (spots[c] = spots[c] || []).push([x, y]); }));
    g.cb = { f: fid, map: F.map, theme: F.theme, round: 1, turn: -1, order: [], tk, auto: !!(g.cb && g.cb.auto), won: false, lost: false };
    const free = (x, y) => !blocksMove(map[y][x]) && !Object.values(tk).some((t) => t.x === x && t.y === y);
    const near = (sx, sy) => { for (let r = 0; r < 8; r++) for (let y = sy - r; y <= sy + r; y++) for (let x = sx - r; x <= sx + r; x++) if (x >= 0 && y >= 0 && x < W && y < H && free(x, y)) return [x, y]; return [sx, sy]; };
    const base = () => ({ cond: {}, mv: 0, act: 0, bon: 0, react: 1, atkLeft: 0, init: 0 });
    keys.forEach((k, i) => {
      const s = (spots[String(i + 1)] || [])[0] || spots['1'][0], p = free(s[0], s[1]) ? s : near(s[0], s[1]);
      tk['p_' + k] = Object.assign(base(), { id: 'p_' + k, ch: k, x: p[0], y: p[1], side: 'pc' });
    });
    const used = {}, count = {};
    F.foes(keys.length).forEach((L, i) => {
      const mt = S.LETTER[L], m = R.MONSTERS[mt], list = spots[L] || spots['1'], j = used[L] = (used[L] || 0);
      used[L]++;
      const s = list[j % list.length], p = free(s[0], s[1]) ? s : near(s[0], s[1]);
      count[mt] = (count[mt] || 0) + 1;
      const same = F.foes(keys.length).filter((x) => x === L).length;
      tk['m' + i] = Object.assign(base(), { id: 'm' + i, mt, n: m.n + (same > 1 ? ' ' + count[mt] : ''), x: p[0], y: p[1], side: m.ally ? 'pc' : 'foe', hp: m.hp, mhp: m.hp });
    });
    const inits = [];
    for (const t of Object.values(tk)) {
      const i = info(g, t), m = R.mod(i.st.dex), r = R.rnd(20);
      t.init = r + m; t.dex = i.st.dex; inits.push(i.n + ' ' + t.init);
      if ((surp === 'foe' && t.side === 'foe' && !(t.mt && R.MONSTERS[t.mt].ally)) || (surp === 'pc' && t.side === 'pc')) t.surp = true;
    }
    g.cb.order = Object.values(tk).sort((a, b) => b.init - a.init || b.dex - a.dex).map((t) => t.id);
    log('⚔️ Бій: ' + F.n + '. ' + F.intro, 'fight');
    log('Ініціатива (к20 + Спритність): ' + g.cb.order.map((id) => info(g, tk[id]).n + ' ' + tk[id].init).join(', '), 'sys');
    if (surp) log(surp === 'foe' ? 'Вороги заскочені — пропускають перший хід.' : 'Героїв заскочено — вони пропускають перший хід.', 'sys');
    lesson('init');
    nextTurn();
  }
  function startTurn(t) {
    const i = info(g0(), t);
    t.mv = Math.max(0, i.sp - (t.cond.slow || 0)); if (t.cond.slow) t.cond.slowEnd = true;
    t.act = 1; t.bon = 1; t.react = 1; t.atkLeft = 0; t.sneak = false; t.dis = false;
    delete t.cond.dodge;
    if (i.pc) lesson('turn');
  }
  const g0 = () => E.G;
  function nextTurn() {
    const g = E.G, cb = g.cb;
    for (let guard = 0; guard < cb.order.length * 2 + 2; guard++) {
      cb.turn++;
      if (cb.turn >= cb.order.length) { cb.turn = 0; cb.round++; }
      const t = cb.tk[cb.order[cb.turn]], i = info(g, t);
      if (i.dead) continue;
      if (i.pc && i.down && i.ch.stable) continue;
      if (t.surp) { delete t.surp; log(i.n + ' заскочений і пропускає хід.', 'sys'); continue; }
      if (t.cond.sleep) { log('💤 ' + i.n + ' спить і пропускає хід.', 'sys'); continue; }
      startTurn(t);
      log('Хід: ' + i.n + (cb.turn === 0 ? ' · раунд ' + cb.round : ''), 'turn');
      E.dirty = true;
      return;
    }
  }
  function endTurn(t) {
    t.dis = false; t.act = 0; t.bon = 0; t.mv = 0;
    if (t.cond.slowEnd) { delete t.cond.slow; delete t.cond.slowEnd; }
    if (endCheck()) return;
    nextTurn();
  }
  function endCheck() {
    const g = E.G, cb = g.cb; if (!cb || cb.won || cb.lost) return !!cb && (cb.won || cb.lost);
    const all = toks(g);
    if (!all.some((t) => t.side === 'foe' && alive(g, t))) { cb.won = true; log('🏆 Перемога! Усіх ворогів подолано.', 'ok'); return true; }
    if (!all.some((t) => t.ch && active(g, t))) { cb.lost = true; log('☠️ Усі герої впали. Майстре, вирішуй, що далі: полон, порятунок Ерандуром чи кінець.', 'bad'); return true; }
    return false;
  }

  function saveRoll(t, st, dc, lbl) {
    const g = E.G, i = info(g, t);
    if ((st === 'dex' || st === 'str') && (t.cond.sleep || i.down)) {
      log(i.n + ': рятівний кидок ' + R.STATS[st].n + ' — автопровал (без тями)', 'roll', { r: { who: i.n, lbl: 'Рятівний ' + R.STATS[st].n, d: [], v: 0, parts: [], tot: 0, vs: dc, vsL: 'СЛ', ok: false, auto: true } });
      return false;
    }
    const parts = [P(R.STATS[st].n, R.mod(i.st[st]))];
    if (i.pc && i.c.saves.includes(st)) parts.push(P('Майстерність', R.PROF));
    blessD4(t, parts);
    const r = R.d20(0), e = rollEntry(i.n, 'Рятівний ' + R.STATS[st].n + (lbl ? ' · ' + lbl : ''), r, parts, dc, 'СЛ', false);
    e.ok = e.tot >= dc;
    log(i.n + ': рятівний кидок ' + R.STATS[st].n, 'roll', { r: e });
    if (E.G.cb) rollFx([t.x, t.y], e, { t: i.n + ': рятівний ' + R.STATS[st].n });
    return e.ok;
  }
  function dropConc(t, why) {
    const g = E.G; if (!t.conc) return;
    const sp = R.SPELLS[t.conc];
    if (t.conc === 'bless') toks(g).forEach((o) => { if (o.cond.bless === t.id) delete o.cond.bless; });
    if (t.conc === 'mark') t.markT = null;
    t.conc = null;
    log('✖ ' + info(g, t).n + ' втрачає концентрацію: «' + sp.n + '» зникає' + (why ? ' (' + why + ')' : ''), 'bad');
  }
  function damage(t, n, crit, src, sub) {
    const g = E.G, i = info(g, t);
    if (n <= 0 || i.dead) return;
    fx({ k: 'float', id: t.id, n: -n, b: [t.x, t.y], txt: (crit ? '💥 ' : '−') + n, c: crit ? 'crit' : 'dmg', sub: sub || '' });
    if (t.cond.sleep) { delete t.cond.sleep; log('😳 ' + i.n + ' прокидається від удару.', 'sys'); }
    if (i.pc) {
      const ch = i.ch;
      if (ch.hp <= 0) {
        ch.ds.f += crit ? 2 : 1;
        log(ch.n + ' отримує удар без тями: ' + (crit ? '2 провали' : 'провал') + ' кидка від смерті (' + ch.ds.f + '/3)', 'bad');
        if (ch.ds.f >= 3) { ch.dead = true; log('💀 ' + ch.n + ' загинув.', 'bad'); }
        ch.stable = false;
      } else {
        ch.hp -= n;
        if (ch.hp <= 0) {
          const over = -ch.hp; ch.hp = 0; ch.ds = { s: 0, f: 0 }; ch.stable = false;
          if (over >= i.mhp) { ch.dead = true; log('💀 ' + ch.n + ' загинув на місці — надто сильний удар.', 'bad'); }
          else { log('🩸 ' + ch.n + ' падає без тями!', 'bad'); lesson('down'); }
          if (t.conc) dropConc(t, 'без тями');
        }
      }
    } else {
      t.hp -= n;
      if (t.hp <= 0) { t.hp = 0; log('☠️ ' + t.n + ' падає.', 'ok'); if (t.conc) dropConc(t); }
    }
    if (t.conc && active(g, t)) {
      const dc = Math.max(10, Math.floor(n / 2));
      lesson('conc');
      if (!saveRoll(t, 'con', dc, 'концентрація')) dropConc(t, 'збили');
    }
    endCheck();
  }
  function heal(t, n) {
    const g = E.G, i = info(g, t);
    if (i.dead) return;
    fx({ k: 'float', id: t.id, n: Math.min(n, i.mhp - Math.max(0, i.hp)), b: [t.x, t.y], txt: '+' + n, c: 'heal' });
    if (i.pc) {
      const ch = i.ch, was = ch.hp;
      ch.hp = Math.min(i.mhp, ch.hp + n);
      if (was <= 0) { ch.ds = { s: 0, f: 0 }; ch.stable = false; log('✨ ' + ch.n + ' приходить до тями!', 'ok'); }
      log('💚 ' + ch.n + ': +' + (ch.hp - was) + ' хітів (' + ch.hp + '/' + i.mhp + ')', 'ok');
    } else { const was = t.hp; t.hp = Math.min(t.mhp, t.hp + n); log('💚 ' + t.n + ': +' + (t.hp - was) + ' хітів', 'ok'); }
  }

  function attack(t, a, tgt, spellLbl) {
    const g = E.G, ac = atkCheck(g, t, a, tgt);
    if (!ac.ok) return false;
    const ti = info(g, tgt), ai = info(g, t);
    if (ac.adv.length || ac.dis.length) lesson('adv');
    if (ac.dis.includes('далека дистанція') || ac.dis.includes('стріляєш, коли ворог поруч')) lesson('range');
    lesson('attack');
    if (ac.autoCrit) lesson('sleep');
    const parts = [P('бонус атаки', a.b)]; blessD4(t, parts);
    const r = R.d20(ac.n);
    const nat20 = r.v === 20, nat1 = r.v === 1;
    const tot = r.v + parts.reduce((s, p) => s + p[1], 0);
    const hit = !nat1 && (nat20 || tot >= ti.ac), crit = hit && (nat20 || ac.autoCrit);
    if (nat20) lesson('nat20'); if (nat1) lesson('nat1');
    const e = rollEntry(ai.n, ai.n + ' → ' + ti.n + ': ' + (spellLbl || a.n), r, parts, ti.ac, 'КБ', hit, { adv: ac.n, why: ac.adv.map((s) => '▲ ' + s).concat(ac.dis.map((s) => '▼ ' + s)), crit, nat1 });
    log(e.lbl, 'roll', { r: e });
    if (t.hidden) delete t.hidden;
    const rf = { t: (spellLbl || a.n), nat1 };
    fx({ k: 'aim', a: [t.x, t.y], b: [tgt.x, tgt.y], foe: t.side === 'foe', txt: ai.n + ' → ' + ti.n });
    rollFx([t.x, t.y], e, rf);
    fx({ k: a.fx || (ac.melee ? 'slash' : (a.spell ? 'bolt' : 'arrow')), a: [t.x, t.y], b: [tgt.x, tgt.y], hit });
    if (!hit) { fx({ k: 'float', b: [tgt.x, tgt.y], txt: nat1 ? 'Нат 1!' : 'Промах', c: 'miss' }); log((nat1 ? 'Натуральна 1 — ' : '') + 'Промах.', 'miss'); return false; }
    const d = R.roll(a.dmg, crit), extra = [];
    if (ai.pc && ai.ch.cls === 'rogue' && !t.sneak && a.finesse && ac.n >= 0 &&
      (ac.n > 0 || toks(g).some((o) => o.id !== t.id && o.side === t.side && active(g, o) && dist(o, tgt) <= 1))) {
      const s = R.roll('1d6', crit); extra.push(['Підступна атака', s]); t.sneak = true;
    }
    if (t.markT === tgt.id && !a.spell) extra.push(['Мітка мисливця', R.roll('1d6', crit)]);
    const total = Math.max(0, d.t + extra.reduce((s, x) => s + x[1].t, 0));
    log('Шкода: ' + a.dmg.replace(/d/g, 'к') + (crit ? ' (крит — кубики ×2)' : '') + ' = [' + d.r.join(', ') + ']' + (d.b ? (d.b > 0 ? '+' : '') + d.b : '') +
      extra.map((x) => ' + ' + x[0] + ' [' + x[1].r.join(', ') + ']').join('') + ' = ' + total, crit ? 'crit' : 'dmg');
    damage(tgt, total, crit, t, a.dmg.replace(/(\d)d(\d)/g, '$1к$2') + (crit ? ' ×2' : '') + extra.map((x) => ' +' + (x[0] === 'Підступна атака' ? 'підступ' : 'мітка')).join(''));
    return true;
  }

  /* ---------- дії, які присилають гравці ---------- */
  function canAct(t, from, isDM) {
    const g = E.G;
    if (!g.cb || !t || g.cb.won || g.cb.lost) return false;
    if (cur(g) !== t) return false;
    return isDM || t.ch === from;
  }
  function useAction(t) {
    if (t.atkLeft > 0) return false; // уже атакує цією дією
    if (t.act <= 0) return false; t.act--; return true;
  }
  function move(t, x, y) {
    const g = E.G, r = reach(g, t, t.mv), p = pathTo(r, t, x, y);
    if (!p || !p.length) return false;
    let seg = [[t.x, t.y]], stop = false;
    if (p.some(([px, py]) => tile(g, px, py) === '~')) lesson('difficult');
    for (const [nx, ny] of p) {
      // атака при нагоді: виходиш із досяжності ворога без «Відступу»
      if (!t.dis) for (const o of toks(g)) {
        if (o.side === t.side || !active(g, o) || o.react <= 0) continue;
        const a = attacks(g, o).find((q) => q.reach);
        if (!a) continue;
        if (dist(o, t) <= a.reach && Math.max(Math.abs(o.x - nx), Math.abs(o.y - ny)) > a.reach) {
          if (seg.length > 1) fx({ k: 'move', id: t.id, path: seg });
          seg = [[t.x, t.y]];
          o.react = 0;
          log('⚠️ ' + info(g, t).n + ' виходить із досяжності — ' + info(g, o).n + ' бʼє при нагоді!', 'warn');
          lesson('oa');
          attack(o, a, t);
          if (!active(g, t)) { stop = true; break; }
        }
      }
      if (stop) break;
      t.mv -= tile(g, nx, ny) === '~' ? 2 : 1;
      t.x = nx; t.y = ny; seg.push([nx, ny]);
    }
    if (seg.length > 1) fx({ k: 'move', id: t.id, path: seg });
    t.mv = Math.max(0, t.mv);
    if (t.hidden && enemyNear(g, t)) delete t.hidden;
    E.dirty = true;
    return true;
  }

  function cast(t, op) {
    const g = E.G, i = info(g, t), sp = R.SPELLS[op.sp];
    if (!i.pc || !sp || !(i.c.spells || []).includes(op.sp)) return;
    if (sp.lvl > 0 && i.ch.slots <= 0) { log('Немає комірок заклинань — відпочиньте.', 'warn'); return; }
    // перевірка цілей до витрати дії/комірки
    const T = (id) => g.cb.tk[id];
    const inRange = (o) => dist(t, o) <= Math.max(1, sp.range) && (sp.range <= 1 || los(g, t, o));
    let tgt = op.tgt ? T(op.tgt) : null, tgts = (op.tgts || []).map(T).filter(Boolean);
    if ((sp.kind === 'atk' || sp.kind === 'save1' || sp.kind === 'heal' || sp.kind === 'mark') && (!tgt || !alive(g, tgt) || !inRange(tgt))) return;
    if ((sp.kind === 'darts' || sp.kind === 'buff') && (!tgts.length || tgts.some((o) => !alive(g, o) || !inRange(o)))) return;
    if (sp.kind === 'sleep' && (op.x == null || Math.max(Math.abs(op.x - t.x), Math.abs(op.y - t.y)) > sp.range)) return;
    if (sp.kind === 'area' && op.x == null) return;
    if (sp.time === 'b') { if (t.bon <= 0) return; t.bon--; } else if (!useAction(t)) return;
    if (sp.lvl > 0) i.ch.slots--;
    if (sp.conc) { if (t.conc) dropConc(t, 'нові чари'); t.conc = op.sp; lesson('conc'); }
    log('🪄 ' + i.n + ' читає «' + sp.n + '»' + (sp.lvl ? ' (комірка, лишилось ' + i.ch.slots + ')' : ''), 'spell');
    const dc = spellDC(i.c), mod = R.mod(i.c.st[i.c.cast]);
    if (sp.kind === 'atk') {
      const hit = attack(t, { n: sp.n, b: spellAtk(i.c), dmg: sp.dmg, reach: 0, range: sp.range, long: sp.range, spell: true, fx: sp.fx }, tgt, sp.n);
      if (hit && sp.slow && alive(g, tgt)) { tgt.cond.slow = sp.slow; delete tgt.cond.slowEnd; log(info(g, tgt).n + ' сповільнений (−' + sp.slow + ' кл.)', 'sys'); }
    } else if (sp.kind === 'darts') {
      fx({ k: 'darts', a: [t.x, t.y], bs: tgts.map((o) => [o.x, o.y]) });
      tgts.forEach((o) => { if (!alive(g, o)) return; const d = R.roll(sp.dmg); log('✦ Снаряд → ' + info(g, o).n + ': 1к4+1 = ' + d.t + ' (не промахується)', 'dmg'); damage(o, d.t, false, t); });
    } else if (sp.kind === 'area') {
      const cells = coneCells(t, op.x, op.y, sp.size);
      fx({ k: 'fire', a: [t.x, t.y], cells });
      const hitT = toks(g).filter((o) => o.id !== t.id && alive(g, o) && cells.some(([x, y]) => x === o.x && y === o.y));
      if (!hitT.length) log('Нікого не зачепило.', 'miss');
      const d = R.roll(sp.dmg);
      log('Шкода: ' + sp.dmg.replace(/d/g, 'к') + ' = [' + d.r.join(', ') + '] = ' + d.t + ', успіх рятівного — половина', 'dmg');
      lesson('save');
      hitT.forEach((o) => { const ok = saveRoll(o, sp.save, dc); damage(o, ok ? Math.floor(d.t / 2) : d.t, false, t); });
    } else if (sp.kind === 'sleep') {
      const cells = sphereCells(op.x, op.y, sp.size), pool = R.roll(sp.pool);
      fx({ k: 'sleep', a: [t.x, t.y], c: [op.x, op.y], cells });
      let left = pool.t;
      log('Сон: 5к8 = [' + pool.r.join(', ') + '] = ' + pool.t + ' хітів істот засинає, від найслабших', 'spell');
      const inA = toks(g).filter((o) => active(g, o) && cells.some(([x, y]) => x === o.x && y === o.y)).sort((a, b) => info(g, a).hp - info(g, b).hp);
      for (const o of inA) {
        const h = info(g, o).hp; if (h > left) break;
        left -= h; o.cond.sleep = true; log('💤 ' + info(g, o).n + ' засинає (' + h + ' хітів, лишилось ' + left + ')', o.side === t.side ? 'warn' : 'ok');
      }
      if (inA.length && !inA[0].cond.sleep) log('Ніхто не заснув — найслабший у колі має більше хітів, ніж випало.', 'miss');
      lesson('sleep');
    } else if (sp.kind === 'save1') {
      fx({ k: 'pillar', a: [t.x, t.y], b: [tgt.x, tgt.y] });
      lesson('save');
      if (!saveRoll(tgt, sp.save, dc, sp.n)) { const d = R.roll(sp.dmg); log('Шкода: ' + sp.dmg.replace(/d/g, 'к') + ' = ' + d.t, 'dmg'); damage(tgt, d.t, false, t); }
      else log(info(g, tgt).n + ' ухилився від полумʼя.', 'miss');
    } else if (sp.kind === 'heal') {
      fx({ k: 'heal', a: [t.x, t.y], b: [tgt.x, tgt.y] });
      const d = R.roll(sp.dmg), bonus = mod + (i.ch.cls === 'cleric' ? 3 : 0);
      log('Лікування: ' + sp.dmg.replace(/d/g, 'к') + ' [' + d.r.join(', ') + '] + ' + bonus + ' = ' + (d.t + bonus), 'ok');
      heal(tgt, d.t + bonus);
    } else if (sp.kind === 'buff') {
      tgts.slice(0, sp.max).forEach((o) => { o.cond.bless = t.id; });
      fx({ k: 'bless', a: [t.x, t.y], bs: tgts.map((o) => [o.x, o.y]) });
      log('✦ Благословенні: ' + tgts.map((o) => info(g, o).n).join(', ') + ' (+1к4 до атак і рятівних)', 'ok');
    } else if (sp.kind === 'mark') {
      t.markT = tgt.id;
      fx({ k: 'mark', a: [t.x, t.y], b: [tgt.x, tgt.y] });
      log('🎯 ' + info(g, tgt).n + ' позначений: +1к6 до кожного влучання ' + i.n, 'sys');
    }
    E.dirty = true;
  }

  function hide(t) {
    const g = E.G, i = info(g, t);
    if (enemyNear(g, t)) { log('Не сховатись, коли ворог поруч і дивиться на тебе.', 'warn'); return false; }
    const pp = Math.max(0, ...toks(g).filter((o) => o.side !== t.side && active(g, o)).map((o) => (o.mt ? R.MONSTERS[o.mt].pp : 10)));
    const b = skillB(i.ch, 'stealth'), parts = [P('Спритність', b.m)]; if (b.p) parts.push(P(b.p > R.PROF ? 'Експертність' : 'Майстерність', b.p));
    const r = R.d20(0), e = rollEntry(i.n, 'Сховатись (Скритність) проти пасивного сприйняття ворогів', r, parts, pp, 'СЛ', false);
    e.ok = e.tot >= pp;
    log(e.lbl, 'roll', { r: e });
    if (e.ok) { t.hidden = true; log('🫥 ' + i.n + ' схована: наступна атака з перевагою.', 'ok'); }
    return true;
  }

  function apply(op, from, isDM) {
    const g = E.G; if (!g || !op) return;
    const T = (id) => g.cb && g.cb.tk[id];
    switch (op.t) {
      case 'roll': checkRoll(isDM && op.k ? op.k : from); break;
      case 'move': { const t = T(op.tok); if (canAct(t, from, isDM) && active(g, t)) move(t, +op.x, +op.y); break; }
      case 'atk': {
        const t = T(op.tok), tgt = T(op.tgt);
        if (!canAct(t, from, isDM) || !active(g, t) || !tgt) break;
        const a = attacks(g, t)[op.w]; if (!a || !atkCheck(g, t, a, tgt).ok) break;
        if (t.atkLeft <= 0) { if (t.act <= 0) break; t.act--; t.atkLeft = (!t.ch && R.MONSTERS[t.mt].multi) || 1; }
        t.atkLeft--;
        attack(t, a, tgt);
        break;
      }
      case 'spell': { const t = T(op.tok); if (canAct(t, from, isDM) && active(g, t)) cast(t, op); break; }
      case 'feat': {
        const t = T(op.tok); if (!canAct(t, from, isDM) || !active(g, t) || !t.ch) break;
        const ch = g.chars[t.ch];
        if (op.f === 'wind' && ch.cls === 'fighter' && ch.uses.wind > 0 && t.bon > 0) { t.bon--; ch.uses.wind--; const d = R.roll('1d10+2'); log('💨 ' + ch.n + ': Друге дихання 1к10+2 = ' + d.t, 'ok'); heal(t, d.t); }
        if (op.f === 'surge' && ch.cls === 'fighter' && ch.uses.surge > 0) { ch.uses.surge--; t.act++; log('⚡ ' + ch.n + ': Сплеск дій — ще одна дія!', 'ok'); }
        if (op.f === 'cunning' && ch.cls === 'rogue' && t.bon > 0) {
          if (op.a === 'dash') { t.bon--; t.mv += info(g, t).sp; log(ch.n + ': Хитра дія — Ривок (+6 кл.)', 'sys'); }
          if (op.a === 'dis') { t.bon--; t.dis = true; log(ch.n + ': Хитра дія — Відступ (без атак при нагоді)', 'sys'); }
          if (op.a === 'hide') { if (hide(t)) t.bon--; }
        }
        break;
      }
      case 'std': {
        const t = T(op.tok); if (!canAct(t, from, isDM) || !active(g, t)) break;
        const n = info(g, t).n;
        if (op.a === 'wake') { const o = T(op.tgt); if (!o || !o.cond.sleep || dist(o, t) > 1 || !useAction(t)) break; delete o.cond.sleep; log(n + ' будить ' + info(g, o).n + '.', 'sys'); break; }
        if (op.a === 'hide') { if (t.act > 0 && t.atkLeft <= 0 && hide(t)) t.act--; break; }
        if (!useAction(t)) break;
        if (op.a === 'dash') { t.mv += info(g, t).sp; log(n + ': Ривок — ще ' + info(g, t).sp + ' кл. руху.', 'sys'); }
        if (op.a === 'dis') { t.dis = true; log(n + ': Відступ — цей хід без атак при нагоді.', 'sys'); }
        if (op.a === 'dodge') { t.cond.dodge = true; log(n + ': Ухилення — атаки по ньому з перешкодою до його наступного ходу.', 'sys'); }
        break;
      }
      case 'death': {
        const t = T(op.tok); if (!canAct(t, from, isDM) || !t.ch) break;
        const ch = g.chars[t.ch]; if (ch.hp > 0 || ch.dead || ch.stable || t.act <= 0) break;
        t.act = 0; lesson('down');
        const r = R.d20(0), e = rollEntry(ch.n, 'Кидок від смерті', r, [], 10, 'СЛ', r.v >= 10);
        log(e.lbl, 'roll', { r: e });
        rollFx([t.x, t.y], e, { t: 'Кидок від смерті' });
        if (r.v === 20) { ch.hp = 1; ch.ds = { s: 0, f: 0 }; log('✨ Натуральна 20! ' + ch.n + ' встає з 1 хітом.', 'ok'); }
        else if (r.v === 1) ch.ds.f += 2;
        else if (r.v >= 10) ch.ds.s++; else ch.ds.f++;
        if (ch.ds.f >= 3) { ch.dead = true; log('💀 ' + ch.n + ' загинув.', 'bad'); endCheck(); }
        else if (ch.ds.s >= 3) { ch.stable = true; log(ch.n + ' стабілізувався: живий, але без тями.', 'ok'); }
        else if (ch.hp <= 0) log('Кидки від смерті: ✔' + ch.ds.s + ' ✖' + ch.ds.f, 'sys');
        break;
      }
      case 'end': { const t = T(op.tok); if (canAct(t, from, isDM)) endTurn(t); break; }
      default: if (isDM) dmOp(op);
    }
    E.dirty = true;
  }

  function dmOp(op) {
    const g = E.G;
    switch (op.t) {
      case 'start': g.started = true; g.sc = 0; log('Пригода «' + S.title + '» починається!', 'sys'); break;
      case 'scene': g.sc = Math.max(0, Math.min(S.SCENES.length - 1, +op.sc)); log(S.SCENES[g.sc].icon + ' Сцена: ' + S.SCENES[g.sc].t, 'scene'); if (S.SCENES[g.sc].goal && S.GOALS) setGoal(S.SCENES[g.sc].goal); break;
      case 'lore': [].concat(op.k).forEach((k) => { if (S.LORE[k] && !(g.lore = g.lore || []).includes(k)) { g.lore.push(k); log('📖 Новий запис у лорі: ' + S.LORE[k].t, 'lore'); } }); break;
      case 'journal': [].concat(op.k).forEach((k) => { if (S.JOURNAL[k] && !(g.journal = g.journal || []).includes(k)) { g.journal.push(k); log('📝 Журнал: ' + S.JOURNAL[k], 'lore'); } }); break;
      case 'goal': setGoal(op.k); break;
      case 'ck': checkStart(op.cfg); break;
      case 'ckclose': if (g.ck) { if (!g.ck.done) log('Майстер закрив перевірку.', 'sys'); g.ck = null; } break;
      case 'fight': fightStart(op.f, op.surp); break;
      case 'fightend':
        if (g.cb) {
          toks(g).forEach((t) => { if (t.conc) t.conc = null; });
          g.cb = null; log('Бій завершено.', 'sys');
        }
        break;
      case 'hp': {
        const ch = g.chars[op.k]; if (!ch) break;
        const mhp = C(ch).hp, was = ch.hp;
        if (op.d < 0 && g.cb && g.cb.tk['p_' + op.k]) damage(g.cb.tk['p_' + op.k], -op.d, false, null);
        else if (op.d > 0 && g.cb && g.cb.tk['p_' + op.k]) heal(g.cb.tk['p_' + op.k], op.d);
        else { ch.hp = Math.max(0, Math.min(mhp, ch.hp + op.d)); if (was <= 0 && ch.hp > 0) { ch.ds = { s: 0, f: 0 }; ch.stable = false; } if (ch.dead && op.d > 0) ch.dead = false; }
        break;
      }
      case 'mhp': { const t = g.cb && g.cb.tk[op.tok]; if (t && t.mt) { t.hp = Math.max(0, Math.min(t.mhp, t.hp + op.d)); endCheck(); } break; }
      case 'slot': { const ch = g.chars[op.k]; if (ch) ch.slots = Math.max(0, Math.min(C(ch).slots || 0, ch.slots + op.d)); break; }
      case 'rest':
        for (const k in g.chars) {
          const ch = g.chars[k], c = C(ch); if (ch.dead) continue;
          if (op.kind === 'long') { ch.hp = c.hp; ch.slots = c.slots || 0; ch.uses = { wind: 1, surge: 1 }; ch.ds = { s: 0, f: 0 }; ch.stable = false; }
          else { const d = R.roll('1d' + c.hd); const h = Math.max(1, d.t + R.mod(c.st.con)); const was = ch.hp; ch.hp = Math.min(c.hp, Math.max(ch.hp, 0) + h); ch.uses = { wind: 1, surge: 1 }; if (was <= 0) { ch.ds = { s: 0, f: 0 }; ch.stable = false; } log(ch.n + ': ' + (was >= c.hp ? 'хіти вже повні' : 'кістка хітів 1к' + c.hd + ' + Статура = +' + (ch.hp - Math.max(was, 0))), 'ok'); }
        }
        log(op.kind === 'long' ? '🌙 Довгий відпочинок (8 год): усі хіти й комірки відновлено.' : '☕ Короткий відпочинок (1 год): кожен витратив кістку хітів, Друге дихання й Сплеск дій відновлено.', 'sys');
        break;
      case 'auto': if (g.cb) g.cb.auto = !!op.on; break;
      case 'lessons': g.lessonsOn = !!op.on; break;
      case 'teach': if (R.LESSONS[op.k]) { g.les = (g.les || []).concat({ i: uid(), k: op.k }).slice(-4); if (!g.seen.includes(op.k)) g.seen.push(op.k); } break;
      case 'finale': g.end = op.v || null; if (op.v) log(op.v === 'a' ? '🕯️ Ерандур розбиває Череп порчі. Кошмари в Данстарі зникають.' : '💀 Жезл «Череп порчі» тепер ваш. Але в Данстарі досі не сплять…', 'scene'); break;
      case 'kick': delete g.chars[op.k]; break;
      case 'bot': {
        const c = R.CLASSES[op.cls]; if (!c) break;
        let n = c.who + ' (бот)', i = 2; while (g.chars[keyOf(n)]) n = c.who + ' ' + (i++) + ' (бот)';
        g.chars[keyOf(n)] = Object.assign(newChar(n, op.cls), { bot: true });
        if (g.started) log('🤖 До гри приєднується ' + n + ' — ' + c.n.toLowerCase() + '.', 'sys');
        break;
      }
      case 'unbot': if (g.chars[op.k] && g.chars[op.k].bot && !(g.cb && g.cb.tk['p_' + op.k])) delete g.chars[op.k]; break;
    }
  }

  /* боти-гравці кидають свої перевірки самі */
  function botRolls() {
    const g = E.G, ck = g && g.ck; if (!ck || ck.done) return false;
    const k = ck.who.find((w) => g.chars[w] && g.chars[w].bot && !ck.res[w]);
    if (!k) return false;
    checkRoll(k); E.dirty = true; return true;
  }
  const isBotTurn = (g) => { const t = cur(g); return !!(t && t.ch && g.chars[t.ch] && g.chars[t.ch].bot); };

  function setGoal(k) { const g = E.G; if (!S.GOALS[k] || g.goal === k) return; g.goal = k; log('🎯 Мета: ' + S.GOALS[k], 'lore'); }

  /* ---------- синхронізація героїв із лобі ---------- */
  const heroSig = (h) => (h ? [h.id, h.rev || 0, h.n, h.bg, h.ip, h.ii].join('|') : '');
  function syncChars(players) { // players: [{n, cls, hero?}] — hero: власний герой гравця
    const g = E.G; let ch = false;
    for (const p of players) {
      const k = keyOf(p.n); if (!k || !p.cls || !R.CLASSES[p.cls]) continue;
      const c = g.chars[k], sig = heroSig(p.hero);
      if (!c || (!g.started && (c.cls !== p.cls || (c.hsig || '') !== sig))) { g.chars[k] = Object.assign(newChar(p.n, p.cls, p.hero), { hsig: sig, pn: String(p.n).slice(0, 16) }); ch = true; }
      else if (g.started && c.hero && p.hero && (c.hero.ip !== (p.hero.ip || '') || c.hero.ii !== (p.hero.ii || ''))) { c.hero.ip = p.hero.ip || ''; c.hero.ii = p.hero.ii || ''; ch = true; } // нова картинка посеред гри
    }
    if (!g.started) for (const k of Object.keys(g.chars)) if (!g.chars[k].bot && !players.some((p) => keyOf(p.n) === k)) { delete g.chars[k]; ch = true; }
    if (ch) E.dirty = true;
  }

  /* ---------- авто-хід монстра / Ерандура ---------- */
  async function autoTurn() {
    const g = E.G; if (E.busy || !g.cb) return;
    const t = cur(g); if (!t || (t.ch && !(g.chars[t.ch] && g.chars[t.ch].bot))) return;
    E.busy = true;
    const push = () => { E.dirty = true; if (E.onChange) E.onChange(); };
    try {
      const atks = attacks(g, t), melee = atks.findIndex((a) => a.reach), ranged = atks.findIndex((a) => a.range);
      if (!active(g, t) && !(t.ch && info(g, t).down)) { endTurn(t); push(); return; }
      let m = t.mt ? R.MONSTERS[t.mt] : null;
      if (t.ch) { // бот-гравець
        const ch = g.chars[t.ch], i = info(g, t);
        m = { keep: ['rogue', 'ranger'].includes(ch.cls), multi: 1 };
        if (i.down) { apply({ t: 'death', tok: t.id }, t.ch, false); push(); await E.wait(E.delay); if (g.cb && cur(g) === t) endTurn(t); push(); return; }
        const sp = i.c.spells || [];
        if (sp.includes('hword') && ch.slots > 0) { // жриця піднімає того, хто впав
          const down = toks(g).find((o) => o.ch && o.side === t.side && info(g, o).down && dist(t, o) <= 12 && los(g, t, o));
          if (down) { apply({ t: 'spell', tok: t.id, sp: 'hword', tgt: down.id }, t.ch, false); push(); await E.wait(E.delay); }
        }
        if (sp.includes('firebolt')) { // маг стріляє вогнем, а не б'є посохом
          const foes = toks(g).filter((o) => o.side !== t.side && active(g, o) && dist(t, o) <= 24 && los(g, t, o)).sort((a, b) => info(g, a).hp - info(g, b).hp);
          if (foes.length && t.act > 0) { apply({ t: 'spell', tok: t.id, sp: 'firebolt', tgt: foes[0].id }, t.ch, false); push(); await E.wait(E.delay); if (g.cb && cur(g) === t) endTurn(t); push(); return; }
        }
      }
      const targets = () => toks(g).filter((o) => o.side !== t.side && alive(g, o)).sort((a, b) => (active(g, b) - active(g, a)) || dist(t, a) - dist(t, b));
      let tg = targets()[0];
      if (!tg) { endTurn(t); push(); return; }
      const shoot = (o) => ranged >= 0 && atkCheck(g, t, atks[ranged], o).ok && dist(t, o) > 1;
      if (m.keep && shoot(tg) && !enemyNear(g, t)) { /* стріляє з місця */ }
      else if (melee >= 0 && dist(t, tg) > 1) {
        const r = reach(g, t, t.mv);
        let best = null, bd = 1e9;
        for (const [k, c] of r.d) {
          if (c < 0) continue;
          const [x, y] = k.split(',').map(Number);
          for (const o of targets()) { const dd = Math.max(Math.abs(o.x - x), Math.abs(o.y - y)); const sc = dd * 10 + c * 0.1 + (active(g, o) ? 0 : 30); if (sc < bd) { bd = sc; best = [x, y]; } }
        }
        const adjacentReach = best && targets().some((o) => Math.max(Math.abs(o.x - best[0]), Math.abs(o.y - best[1])) <= 1);
        if (!adjacentReach && ranged >= 0 && shoot(tg)) { /* кидає спис */ }
        else if (best && (best[0] !== t.x || best[1] !== t.y)) { move(t, best[0], best[1]); push(); await E.wait(E.delay); }
      }
      if (!g.cb) return;
      if (!active(g, t)) { if (cur(g) === t) endTurn(t); push(); return; } // загинув від атаки при нагоді посеред ходу
      const n = (m.multi || 1);
      for (let k = 0; k < n; k++) {
        tg = targets().filter((o) => dist(t, o) <= 1)[0] || targets()[0];
        if (!tg) break;
        let w = melee >= 0 && dist(t, tg) <= 1 ? melee : (ranged >= 0 && atkCheck(g, t, atks[ranged], tg).ok ? ranged : -1);
        if (w < 0) break;
        apply({ t: 'atk', tok: t.id, tgt: tg.id, w }, null, true); push();
        await E.wait(E.delay);
        if (!g.cb || g.cb.won || g.cb.lost) return;
      }
      if (g.cb && cur(g) === t) endTurn(t);
      push();
    } finally { E.busy = false; }
  }

  Object.assign(E, {
    W, H, uid, keyOf, C, skillB, saveB, passive, wAtk, spellAtk, spellDC, newChar, info, alive, active, dist, toks, cur, attacks,
    tile, blocksMove, blocksLos, occ, reach, pathTo, los, coneCells, sphereCells, enemyNear, atkCheck, checkName, checkParts,
    blank, apply, syncChars, autoTurn, log, botRolls, isBotTurn, attackPreview, dstat, hitChance, saveFail,
  });
  window.DNDE = E;
})();
