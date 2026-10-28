/* Хутір — уся логіка гри без екрана: стан, час, дії. Однакова для соло (localStorage) і спільного хутора
   (RTDB, кожна дія — транзакція: advance до «зараз» → застосувати дію → записати).
   Виробництво рахується подіями (кінець циклу будівлі), тож години відсутності дораховуються швидко. */
(function (root) {
  'use strict';
  const N = 32, CH = 4, NC = N / CH;           // карта 32×32, земля купується чанками 4×4
  const MAX_AWAY = 48 * 3600e3;                 // довше 48 год без нікого — хутір «спить»

  const RES = {
    wheat: { ic: '🌾', n: 'Пшениця', p: 2 },
    egg: { ic: '🥚', n: 'Яйця', p: 4 },
    wood: { ic: '🪵', n: 'Колоди', p: 2 },
    flour: { ic: '🥣', n: 'Борошно', p: 5 },
    plank: { ic: '🪚', n: 'Дошки', p: 6 },
    milk: { ic: '🥛', n: 'Молоко', p: 7 },
    bread: { ic: '🍞', n: 'Хліб', p: 16 },
    apple: { ic: '🍎', n: 'Яблука', p: 3 },
    cheese: { ic: '🧀', n: 'Сир', p: 22 },
    honey: { ic: '🍯', n: 'Мед', p: 12 },
    juice: { ic: '🧃', n: 'Сік', p: 15 },
    pie: { ic: '🥧', n: 'Пиріг', p: 42 },
    mead: { ic: '🍺', n: 'Медовуха', p: 55 },
  };
  // in — що бере за цикл, out — що дає, d — тривалість циклу (с), cap — місце в будівлі, lv — з якого рівня хутора
  const B = {
    field: { n: 'Поле', ic: '🌾', lv: 1, c: 10, d: 20, out: ['wheat', 2], cap: 12, kind: 'field', hint: 'Росте саме. Збирай — і знову сіється.' },
    coop: { n: 'Курник', ic: '🐔', lv: 1, c: 40, d: 30, in: [['wheat', 1]], out: ['egg', 1], cap: 6, wall: '#E9D9B8', roof: '#C8553D' },
    mill: { n: 'Млин', ic: '🌬', lv: 2, c: 90, d: 40, in: [['wheat', 2]], out: ['flour', 1], cap: 6, wall: '#EFE6D2', roof: '#7A5C3E' },
    lumber: { n: 'Лісоруб', ic: '🪓', lv: 2, c: 60, d: 30, out: ['wood', 1], cap: 8, wall: '#B98A5A', roof: '#5E7D3A' },
    well: { n: 'Криниця', ic: '💧', lv: 3, c: 120, kind: 'well', hint: '+25% швидкості полям, саду, курнику й корівнику навколо (8 клітинок).' },
    saw: { n: 'Тартак', ic: '🪚', lv: 3, c: 120, d: 40, in: [['wood', 2]], out: ['plank', 1], cap: 6, wall: '#C9A06B', roof: '#6B4A2E' },
    bakery: { n: 'Пекарня', ic: '🍞', lv: 4, c: 250, d: 60, in: [['flour', 1], ['egg', 1]], out: ['bread', 1], cap: 5, wall: '#F2D3A2', roof: '#B5452E' },
    dairy: { n: 'Корівник', ic: '🐄', lv: 4, c: 280, d: 45, in: [['wheat', 2]], out: ['milk', 1], cap: 6, wall: '#F4F1EA', roof: '#3D6F9E' },
    orchard: { n: 'Сад', ic: '🍎', lv: 5, c: 200, d: 40, out: ['apple', 1], cap: 8, kind: 'orchard', hint: 'Яблуні родять самі. Пасіка й криниця поруч пришвидшують.' },
    cheese: { n: 'Сироварня', ic: '🧀', lv: 6, c: 450, pl: 8, d: 90, in: [['milk', 2]], out: ['cheese', 1], cap: 4, wall: '#FBE7A1', roof: '#8A6D1F' },
    apiary: { n: 'Пасіка', ic: '🐝', lv: 7, c: 380, pl: 5, d: 120, out: ['honey', 1], cap: 4, kind: 'apiary', hint: 'Мед. Ще й +30% полям і саду навколо (8 клітинок).' },
    press: { n: 'Пресс', ic: '🧃', lv: 8, c: 550, pl: 10, d: 60, in: [['apple', 3]], out: ['juice', 1], cap: 4, wall: '#E7C6D9', roof: '#7B3D63' },
    pastry: { n: 'Кондитерська', ic: '🥧', lv: 10, c: 900, pl: 18, d: 90, in: [['flour', 1], ['apple', 1], ['egg', 1]], out: ['pie', 1], cap: 4, wall: '#FFD6E0', roof: '#C2477A' },
    meadery: { n: 'Медоварня', ic: '🍺', lv: 12, c: 1400, pl: 28, d: 120, in: [['honey', 2], ['apple', 1]], out: ['mead', 1], cap: 4, wall: '#D9B97A', roof: '#5B3A1E' },
  };
  const ORDER = Object.keys(B);

  // ---------- випадковість: лише з ядра у стані, щоб транзакція при повторі дала те саме ----------
  function rnd(s) { s.r = (s.r + 0x6D2B79F5) | 0; let t = s.r; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  function hash(seed, x, y) { let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

  const idx = (x, y) => y * N + x;
  const chunkOf = (x, y) => Math.floor(y / CH) * NC + Math.floor(x / CH);
  const owned = (s, x, y) => x >= 0 && y >= 0 && x < N && y < N && s.ch.indexOf(chunkOf(x, y)) >= 0;
  const count = (s, k) => s.b.reduce((n, b) => n + (b.k === k), 0);
  const at = (s, x, y) => s.b.find((b) => b.x === x && b.y === y) || null;

  function genChunk(s, c, sparse) {
    const cx = (c % NC) * CH, cy = Math.floor(c / NC) * CH;
    for (let y = cy; y < cy + CH; y++) for (let x = cx; x < cx + CH; x++) {
      const h = hash(s.seed, x, y);
      if (h < (sparse ? 0.07 : 0.17)) s.ob[idx(x, y)] = 't';
      else if (h < (sparse ? 0.09 : 0.22)) s.ob[idx(x, y)] = 'r';
    }
  }

  function create(seed, name) {
    const s = { v: 1, nm: name || 'Хутір', seed: seed | 0, r: seed | 0, t: 0, coins: 60, xp: 0, lv: 1, sl: 0, st: {}, b: [], nid: 1, ch: [], ob: {}, o: [], lg: [], pc: {}, made: 0 };
    for (const c of [27, 28, 35, 36]) { s.ch.push(c); genChunk(s, c, true); }
    const mid = N / 2;
    for (let y = mid - 2; y <= mid + 1; y++) for (let x = mid - 2; x <= mid + 1; x++) delete s.ob[idx(x, y)];
    s.b.push({ id: s.nid++, k: 'field', x: mid - 1, y: mid - 1, lv: 1, buf: 0, p: -1, h: 0 });
    fillOrders(s, 0);
    return s;
  }

  // ---------- числа ----------
  const storeCap = (s) => Math.round(40 * Math.pow(1.5, s.sl));
  const xpNeed = (L) => Math.round(25 * Math.pow(L, 1.55));
  const slots = (s) => 3 + (s.lv >= 6) + (s.lv >= 12);
  function buildCost(s, k) { const m = Math.pow(1.15, count(s, k)); return { c: Math.round(B[k].c * m), pl: B[k].pl ? Math.ceil(B[k].pl * m) : 0 }; }
  function upCost(b) { const d = B[b.k], L = b.lv; return { c: Math.round(d.c * 0.8 * Math.pow(1.7, L)) + 20, pl: L >= 2 ? 3 * L : 0 }; }
  const hireCost = (b) => ({ c: 100 + B[b.k].c * 2, pl: 0 });
  const storeCost = (s) => ({ c: Math.round(150 * Math.pow(1.9, s.sl)), pl: s.sl >= 1 ? 4 * s.sl : 0 });
  const chunkCost = (s) => { const n = s.ch.length; return { c: Math.round(150 * Math.pow(1.55, n - 4)), pl: n >= 6 ? 4 * (n - 5) : 0 }; };
  const ROCK = 30;
  function capOf(b) { return Math.round(B[b.k].cap * (1 + 0.5 * (b.lv - 1))); }
  function canAfford(s, cost) { return s.coins >= cost.c && (s.st.plank || 0) >= cost.pl; }
  function pay(s, cost) { s.coins -= cost.c; if (cost.pl) s.st.plank -= cost.pl; }

  // бонуси сусідства: криниця +25% (поле, сад, курник, корівник), пасіка +30% (поле, сад)
  function bonuses(s) {
    const map = new Map(); for (const b of s.b) map.set(idx(b.x, b.y), b);
    const out = new Map();
    for (const b of s.b) {
      if (b.k !== 'well' && b.k !== 'apiary') continue;
      const v = b.k === 'well' ? 0.25 : 0.3, ok = b.k === 'well' ? ['field', 'orchard', 'coop', 'dairy'] : ['field', 'orchard'];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const n = map.get(idx(b.x + dx, b.y + dy));
        if (n && ok.indexOf(n.k) >= 0) out.set(n.id, Math.min(1, (out.get(n.id) || 0) + v));
      }
    }
    return out;
  }
  function durOf(b, bon) { return B[b.k].d * 1000 / ((1 + 0.35 * (b.lv - 1)) * (1 + (bon.get(b.id) || 0))); }

  function canStart(s, b) {
    const d = B[b.k];
    if (!d.d) return false;
    if (b.buf + d.out[1] > capOf(b)) return false;
    if (d.in) for (const [r, n] of d.in) if ((s.st[r] || 0) < n) return false;
    return true;
  }
  function flush(s, b) {
    const r = B[b.k].out && B[b.k].out[0]; if (!r || !b.buf) return 0;
    const room = Math.max(0, storeCap(s) - (s.st[r] || 0)), n = Math.min(room, b.buf);
    if (n > 0) { s.st[r] = (s.st[r] || 0) + n; b.buf -= n; s.made += n; }
    return n;
  }

  // ---------- час ----------
  // запустити все, що може працювати зараз (після збору, продажу, будівництва)
  function kick(s) {
    for (const b of s.b) {
      if (!B[b.k].d) continue;
      if (b.h) flush(s, b);
      if (b.p < 0 && canStart(s, b)) { const d = B[b.k]; if (d.in) for (const [r, n] of d.in) s.st[r] -= n; b.p = 0; }
    }
  }
  function advance(s, now) {
    if (!s.t) { s.t = now; kick(s); return s; }
    if (now <= s.t) return s;
    let t = Math.max(s.t, now - MAX_AWAY);
    const bon = bonuses(s), dur = new Map(), prod = s.b.filter((b) => B[b.k].d);
    for (const b of prod) dur.set(b.id, durOf(b, bon));
    for (let guard = 0; guard < 3e6; guard++) {
      kick(s);
      if (t >= now) break;
      let m = Infinity;
      for (const b of prod) if (b.p >= 0) m = Math.min(m, dur.get(b.id) - b.p);
      if (m === Infinity) break;
      const step = Math.min(Math.max(m, 0), now - t);
      for (const b of prod) if (b.p >= 0) b.p += step;
      t += step;
      for (const b of prod) if (b.p >= 0 && b.p >= dur.get(b.id) - 1e-6) { b.buf += B[b.k].out[1]; b.p = -1; }
    }
    s.t = now;
    return s;
  }

  // ---------- замовлення ----------
  function producible(s) {
    const set = new Set(); for (const b of s.b) if (B[b.k].out) set.add(B[b.k].out[0]);
    return set.size ? [...set] : ['wheat'];
  }
  function newOrder(s, wait) {
    const pool = producible(s).slice(), items = [];
    const k = Math.min(pool.length, s.lv < 3 ? 1 : s.lv < 6 ? 1 + (rnd(s) < 0.5) : 1 + Math.floor(rnd(s) * 3));
    const V = (8 + 14 * s.lv) * (0.7 + 0.6 * rnd(s));
    let val = 0;
    for (let i = 0; i < k; i++) {
      const r = pool.splice(Math.floor(rnd(s) * pool.length), 1)[0];
      const n = Math.max(1, Math.min(storeCap(s), Math.round(V / k / RES[r].p)));
      items.push([r, n]); val += n * RES[r].p;
    }
    return { it: items, c: Math.round(val * 1.5 + 5), xp: Math.round(val * 0.35) + 4, w: wait || 0 };
  }
  function fillOrders(s, now) { while (s.o.length < slots(s)) s.o.push(newOrder(s, 0)); }

  function gainXp(s, n, out) {
    s.xp += n;
    while (s.xp >= xpNeed(s.lv)) { s.xp -= xpNeed(s.lv); s.lv++; if (out) out.lvUp = s.lv; }
    fillOrders(s);
  }
  function log(s, who, text) { s.lg.push([s.t, who || '', text]); if (s.lg.length > 30) s.lg.splice(0, s.lg.length - 30); }
  const fmtCost = (c) => (c.c ? c.c + ' 💰' : '') + (c.pl ? ' + ' + c.pl + ' 🪚' : '');

  // ---------- дії ----------
  // act повертає { ok, err?, fx? }; стан змінює на місці. who — імʼя гравця (журнал і внески).
  function act(s, a, now, who) {
    advance(s, now);
    const fail = (err) => ({ ok: false, err });
    const res = { ok: true, fx: [] };
    switch (a.t) {
      case 'build': {
        const d = B[a.k]; if (!d) return fail('Нема такої будівлі');
        if (s.lv < d.lv) return fail('Відкриється на ' + d.lv + ' рівні');
        if (!owned(s, a.x, a.y)) return fail('Це не твоя земля');
        if (at(s, a.x, a.y)) return fail('Тут уже щось стоїть');
        if (s.ob[idx(a.x, a.y)]) return fail(s.ob[idx(a.x, a.y)] === 't' ? 'Спершу зрубай дерево' : 'Спершу прибери камінь');
        const cost = buildCost(s, a.k); if (!canAfford(s, cost)) return fail('Треба ' + fmtCost(cost));
        pay(s, cost);
        const b = { id: s.nid++, k: a.k, x: a.x, y: a.y, lv: 1, buf: 0, p: -1, h: 0 };
        s.b.push(b); log(s, who, 'збудував(ла) ' + d.n);
        gainXp(s, 3, res); kick(s);
        res.fx.push([a.x, a.y, '-' + cost.c + ' 💰']); return res;
      }
      case 'collect': {
        const b = s.b.find((q) => q.id === a.id); if (!b) return fail('Нема');
        if (!b.buf) return fail('Ще не готово');
        const n = flush(s, b); if (!n) return fail('Комора повна — продай щось');
        kick(s);
        res.fx.push([b.x, b.y, '+' + n + ' ' + RES[B[b.k].out[0]].ic]); res.n = n; return res;
      }
      case 'collectAll': {
        let tot = 0, full = false;
        for (const b of s.b) if (b.buf) { const n = flush(s, b); tot += n; if (n) res.fx.push([b.x, b.y, '+' + n + ' ' + RES[B[b.k].out[0]].ic]); if (b.buf) full = true; }
        if (!tot) return fail(full ? 'Комора повна — продай щось' : 'Нічого не дозріло');
        kick(s); res.n = tot; return res;
      }
      case 'upgrade': {
        const b = s.b.find((q) => q.id === a.id); if (!b || !B[b.k].d) return fail('Не покращується');
        const cost = upCost(b); if (!canAfford(s, cost)) return fail('Треба ' + fmtCost(cost));
        pay(s, cost); b.lv++; kick(s); log(s, who, 'покращив(ла) ' + B[b.k].n + ' до ' + b.lv + ' рівня');
        gainXp(s, 2 + b.lv, res); res.fx.push([b.x, b.y, '⬆ ' + b.lv]); return res;
      }
      case 'hire': {
        const b = s.b.find((q) => q.id === a.id); if (!b || !B[b.k].d || b.h) return fail('Не можна');
        if (s.lv < 3) return fail('Наймити — з 3 рівня');
        const cost = hireCost(b); if (!canAfford(s, cost)) return fail('Треба ' + fmtCost(cost));
        pay(s, cost); b.h = 1; flush(s, b); log(s, who, 'найняв(ла) наймита на ' + B[b.k].n);
        kick(s); res.fx.push([b.x, b.y, '🧑‍🌾']); return res;
      }
      case 'demolish': {
        const i = s.b.findIndex((q) => q.id === a.id); if (i < 0) return fail('Нема');
        const b = s.b[i]; flush(s, b); s.b.splice(i, 1);
        const back = Math.round(buildCost(s, b.k).c / 1.15 * 0.5); s.coins += back;
        log(s, who, 'зніс(ла) ' + B[b.k].n); res.fx.push([b.x, b.y, '+' + back + ' 💰']);
        kick(s); return res;
      }
      case 'sell': {
        const have = s.st[a.r] || 0, n = Math.min(have, Math.max(1, a.n | 0)); if (!RES[a.r] || !n) return fail('Нема чого продати');
        s.st[a.r] -= n; const c = n * RES[a.r].p; s.coins += c; s.pc[who] = (s.pc[who] || 0) + c;
        kick(s); res.c = c; return res;
      }
      case 'order': {
        const o = s.o[a.i]; if (!o) return fail('Нема');
        if (o.w > now) return fail('Замовник ще в дорозі');
        for (const [r, n] of o.it) if ((s.st[r] || 0) < n) return fail('Бракує ' + RES[r].ic);
        for (const [r, n] of o.it) s.st[r] -= n;
        s.coins += o.c; s.pc[who] = (s.pc[who] || 0) + o.c;
        log(s, who, 'виконав(ла) замовлення: +' + o.c + ' 💰');
        s.o[a.i] = newOrder(s, 0); gainXp(s, o.xp, res); res.c = o.c; res.xp = o.xp;
        kick(s); return res;
      }
      case 'skip': {
        const o = s.o[a.i]; if (!o) return fail('Нема');
        if (o.w > now) return fail('Вже чекаємо нового');
        s.o[a.i] = newOrder(s, now + 90e3); return res;
      }
      case 'clear': {
        const k = s.ob[idx(a.x, a.y)]; if (!k || !owned(s, a.x, a.y)) return fail('Нема що прибирати');
        if (k === 'r') { if (s.coins < ROCK) return fail('Треба ' + ROCK + ' 💰'); s.coins -= ROCK; res.fx.push([a.x, a.y, '-' + ROCK + ' 💰']); }
        else { const room = Math.max(0, storeCap(s) - (s.st.wood || 0)), n = Math.min(2, room); s.st.wood = (s.st.wood || 0) + n; res.fx.push([a.x, a.y, n ? '+' + n + ' 🪵' : '🪓']); }
        delete s.ob[idx(a.x, a.y)]; gainXp(s, 1, res); return res;
      }
      case 'chunk': {
        const c = a.c; if (s.ch.indexOf(c) >= 0 || c < 0 || c >= NC * NC) return fail('Не можна');
        const cx = c % NC, cy = Math.floor(c / NC);
        const adj = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const x = cx + dx, y = cy + dy; return x >= 0 && y >= 0 && x < NC && y < NC && s.ch.indexOf(y * NC + x) >= 0; });
        if (!adj) return fail('Купуй землю поруч зі своєю');
        const cost = chunkCost(s); if (!canAfford(s, cost)) return fail('Треба ' + fmtCost(cost));
        pay(s, cost); s.ch.push(c); genChunk(s, c, false); log(s, who, 'прикупив(ла) землі');
        gainXp(s, 10, res); return res;
      }
      case 'store': {
        const cost = storeCost(s); if (!canAfford(s, cost)) return fail('Треба ' + fmtCost(cost));
        pay(s, cost); s.sl++; log(s, who, 'розширив(ла) комору до ' + storeCap(s));
        gainXp(s, 5, res); kick(s); return res;
      }
      case 'rename': {
        const nm = String(a.nm || '').replace(/[<>&"]/g, '').trim().slice(0, 24); if (!nm) return fail('Порожня назва');
        s.nm = nm; return res;
      }
    }
    return fail('Невідома дія');
  }

  // що бракує будівлі, щоб працювати (для бульбашки «нема 🌾» і панелі)
  function why(s, b) {
    const d = B[b.k]; if (!d.d || b.p >= 0) return '';
    if (b.buf + d.out[1] > capOf(b)) return 'full';
    if (d.in) for (const [r, n] of d.in) if ((s.st[r] || 0) < n) return r;
    return '';
  }

  const api = { kick, N, CH, NC, RES, B, ORDER, create, advance, act, why, storeCap, xpNeed, buildCost, upCost, hireCost, storeCost, chunkCost, capOf, durOf, bonuses, slots, owned, chunkOf, idx, at, count, ROCK, fmtCost, canAfford, MAX_AWAY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KhutirSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
