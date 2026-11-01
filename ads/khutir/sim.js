/* Хутір — уся логіка гри без екрана: стан, час, дії. Однакова для соло (localStorage) і спільного хутора
   (RTDB, кожна дія — транзакція: advance до «зараз» → застосувати дію → записати).
   Виробництво рахується подіями (кінець циклу будівлі), тож години відсутності дораховуються швидко. */
(function (root) {
  'use strict';
  const N = 48, CH = 4, NC = N / CH;           // карта 48×48, земля купується чанками 4×4
  const VER = 2;                                // версія правил: старі хутори починаються заново
  const MID = 22;                               // центр стартової землі
  const MAX_AWAY = 48 * 3600e3;                 // довше 48 год без нікого — хутір «спить»

  const RES = {
    wheat: { ic: '🌾', n: 'Пшениця', p: 2 },
    corn: { ic: '🌽', n: 'Кукурудза', p: 5 },
    sun: { ic: '🌻', n: 'Соняшник', p: 12 },
    beet: { ic: '🫜', n: 'Буряк', p: 24 },
    pump: { ic: '🎃', n: 'Гарбуз', p: 55 },
    wood: { ic: '🪵', n: 'Колоди', p: 3 },
    flour: { ic: '🥣', n: 'Борошно', p: 8 },
    egg: { ic: '🥚', n: 'Яйця', p: 9 },
    plank: { ic: '🪚', n: 'Дошки', p: 14 },
    milk: { ic: '🥛', n: 'Молоко', p: 16 },
    apple: { ic: '🍎', n: 'Яблука', p: 6 },
    bread: { ic: '🍞', n: 'Хліб', p: 30 },
    honey: { ic: '🍯', n: 'Мед', p: 30 },
    oil: { ic: '🫙', n: 'Олія', p: 40 },
    juice: { ic: '🧃', n: 'Сік', p: 42 },
    cheese: { ic: '🧀', n: 'Сир', p: 62 },
    borsch: { ic: '🍲', n: 'Борщ', p: 150 },
    pie: { ic: '🥧', n: 'Пиріг', p: 150 },
    mead: { ic: '🍺', n: 'Медовуха', p: 190 },
  };
  // культури: d — ріст у секундах, y — врожай
  const CROP = {
    wheat: { lv: 1, d: 120, y: 3 },
    corn: { lv: 2, d: 900, y: 4 },
    sun: { lv: 5, d: 3600, y: 5 },
    beet: { lv: 7, d: 10800, y: 6 },
    pump: { lv: 10, d: 28800, y: 6 },
  };
  // in — що бере за цикл, out — що дає, d — тривалість циклу (с), cap — місце в будівлі, q — черга, lv — з якого рівня хутора, m — у скільки дорожчає кожна наступна
  const B = {
    field: { n: 'Поле', ic: '🌾', lv: 1, c: 10, step: 5, m: 1.5, d: 120, out: ['wheat', 3], cap: 6, kind: 'field', hint: 'Сам обираєш, що сіяти.' },
    mill: { n: 'Млин', ic: '🌬', lv: 1, c: 60, d: 600, in: [['wheat', 2]], out: ['flour', 1], cap: 6, q: 2, wall: '#EFE6D2', roof: '#7A5C3E' },
    market: { n: 'Ринок', ic: '🏪', lv: 2, c: 100, kind: 'market', one: 1, wall: '#E7CFA0', roof: '#B5452E', hint: 'Сюди часто приїздять торговці з інших сіл.' },
    coop: { n: 'Курник', ic: '🐔', lv: 2, c: 80, d: 1200, in: [['corn', 1]], out: ['egg', 1], cap: 6, q: 2, wall: '#E9D9B8', roof: '#C8553D' },
    lumber: { n: 'Лісоруб', ic: '🪓', lv: 2, c: 60, d: 1800, out: ['wood', 2], cap: 4, wall: '#B98A5A', roof: '#5E7D3A' },
    home: { n: 'Хата', ic: '🏠', lv: 999, c: 0, kind: 'home', hint: 'Тут живе селянин. Звідси він ходить по врожай.' },
    barn: { n: 'Комора', ic: '📦', lv: 999, c: 0, kind: 'barn' },
    well: { n: 'Криниця', ic: '💧', lv: 3, c: 120, kind: 'well', hint: '+25% швидкості полям, саду, курнику й корівнику навколо (8 клітинок).' },
    saw: { n: 'Тартак', ic: '🪚', lv: 3, c: 120, d: 2400, in: [['wood', 2]], out: ['plank', 1], cap: 6, q: 2, wall: '#C9A06B', roof: '#6B4A2E' },
    bakery: { n: 'Пекарня', ic: '🍞', lv: 4, c: 250, d: 1800, in: [['flour', 1], ['egg', 1]], out: ['bread', 1], cap: 6, q: 3, wall: '#F2D3A2', roof: '#B5452E' },
    dairy: { n: 'Корівник', ic: '🐄', lv: 4, c: 280, d: 2700, in: [['corn', 2]], out: ['milk', 1], cap: 6, q: 2, wall: '#F4F1EA', roof: '#3D6F9E' },
    orchard: { n: 'Сад', ic: '🍎', lv: 5, c: 200, d: 7200, out: ['apple', 4], cap: 4, kind: 'orchard', hint: 'Яблуні родять самі. Пасіка й криниця поруч пришвидшують.' },
    oilery: { n: 'Олійня', ic: '🫙', lv: 6, c: 400, pl: 5, d: 3600, in: [['sun', 2]], out: ['oil', 1], cap: 6, q: 3, wall: '#EAD9A8', roof: '#8A6D1F' },
    cheese: { n: 'Сироварня', ic: '🧀', lv: 6, c: 450, pl: 8, d: 5400, in: [['milk', 2]], out: ['cheese', 1], cap: 6, q: 3, wall: '#FBE7A1', roof: '#8A6D1F' },
    apiary: { n: 'Пасіка', ic: '🐝', lv: 7, c: 380, pl: 5, d: 10800, out: ['honey', 2], cap: 2, kind: 'apiary', hint: 'Мед. Ще й +30% полям і саду навколо (8 клітинок).' },
    press: { n: 'Пресс', ic: '🧃', lv: 8, c: 550, pl: 10, d: 3600, in: [['apple', 4]], out: ['juice', 1], cap: 6, q: 3, wall: '#E7C6D9', roof: '#7B3D63' },
    kitchen: { n: 'Кухня', ic: '🍲', lv: 9, c: 700, pl: 14, d: 7200, in: [['beet', 2], ['oil', 1]], out: ['borsch', 1], cap: 6, q: 3, wall: '#F4DCC4', roof: '#9E3B2E' },
    pastry: { n: 'Кондитерська', ic: '🥧', lv: 10, c: 900, pl: 18, d: 7200, in: [['pump', 1], ['flour', 1], ['egg', 1]], out: ['pie', 1], cap: 6, q: 3, wall: '#FFD6E0', roof: '#C2477A' },
    meadery: { n: 'Медоварня', ic: '🍺', lv: 12, c: 1400, pl: 28, d: 14400, in: [['honey', 2], ['apple', 2]], out: ['mead', 1], cap: 6, q: 3, wall: '#D9B97A', roof: '#5B3A1E' },
  };
  // прикраси: b — очки краси, shop: false — лише від торговця
  const DECOR = {
    path: { n: 'Стежка', ic: '🟫', lv: 1, c: 2, b: 0.3, hint: 'Малюй пальцем' },
    stone: { n: 'Бруківка', ic: '🪨', lv: 3, c: 6, b: 0.6, hint: 'Малюй пальцем' },
    fence: { n: 'Тин', ic: '🪵', lv: 1, c: 8, b: 1, hint: 'Стоїть на межі клітинок, ставиться вздовж їхніх країв' },
    flower: { n: 'Квітник', ic: '🌸', lv: 1, c: 15, b: 3 },
    spruce: { n: 'Ялинка', ic: '🌲', lv: 2, c: 40, b: 4 },
    hay: { n: 'Копиця', ic: '🌾', lv: 2, c: 30, b: 3, turn: 2 },
    bench: { n: 'Лавка', ic: '🪑', lv: 3, c: 60, b: 5, turn: 4 },
    swing: { n: 'Гойдалка', ic: '🛝', lv: 3, c: 80, b: 6, turn: 2 },
    crane: { n: 'Журавель', ic: '🪣', lv: 5, c: 120, b: 8, turn: 2 },
    stork: { n: 'Гніздо лелеки', ic: '🪺', lv: 6, c: 150, b: 10, turn: 2 },
    oak: { n: 'Дуб', ic: '🌳', lv: 4, c: 90, b: 7 },
    lantern: { n: 'Ліхтар', ic: '🏮', lv: 4, c: 100, b: 7, hint: 'Світить уночі' },
    pot: { n: 'Опішнянський глечик', ic: '🏺', c: 150, b: 12, shop: false },
    baba: { n: 'Кам’яна баба', ic: '🗿', c: 400, b: 30, shop: false },
  };
  const ORDER = Object.keys(B).filter((k) => B[k].kind !== 'home' && B[k].kind !== 'barn');
  // що й скільки дає будівля зараз (поле — залежно від посіяного)
  const outOf = (b) => (b.k === 'field' ? [b.cr || 'wheat', CROP[b.cr || 'wheat'].y] : B[b.k].out);

  // ---------- селяни ----------
  // По одному на гравця (соло — 'me'). Живе в хаті, обходить найближчі будівлі й носить урожай у комору.
  // Обхід — подія в тому самому годиннику, що й урожай, тож селянин «працює», навіть коли нікого нема.
  const LOOK = {
    skin: ['#F1C9A5', '#E0A97E', '#B97F57', '#8A5A3C'],
    shirt: ['#F5F5F5', '#E53935', '#1E88E5', '#43A047', '#FDD835', '#8E24AA', '#FB8C00', '#3E2723'],
    pants: ['#3B4A6B', '#5D4037', '#263238', '#6D8B3A', '#8C2F39'],
    style: ['Сорочка', 'Вишиванка', 'Жилетка', 'Свитка'],
    hat: ['Без шапки', 'Бриль', 'Кашкет', 'Хустка', 'Вінок', 'Смушкова шапка'],
    body: ['Чоловік', 'Жінка'],
    face: ['Вуса', 'Борода', 'Без вусів'],   // старі селяни без b і f — чоловік із вусами
  };
  const VUP = { rt: { n: 'Маршрут', d: '+2 будівлі в обході' }, bk: { n: 'Кошик', d: '+4 місця в кошику' }, sp: { n: 'Чоботи', d: 'обхід на 20% швидший' } };
  const route = (v) => 3 + 2 * (v.u.rt || 0);
  const basket = (v) => 6 + 4 * (v.u.bk || 0);
  // настрій: обходи втомлюють, а лавка, гойдалка чи копиця біля хати повертають сили
  const mood = (v) => (v.m === undefined ? 80 : v.m);
  const moodF = (v) => (mood(v) >= 60 ? 1.2 : mood(v) >= 30 ? 1 : 0.7);
  const REST = ['bench', 'swing', 'hay'];
  // Швидкість стала: час обходу — це довжина справжнього шляху, а не навпаки
  const WALK = 0.6, PAUSE = 1500, SIT = 20000;           // клітинок за секунду, зупинка біля будівлі (мс), відпочинок (мс)
  const speedOf = (v) => (1 + 0.2 * (v.u.sp || 0)) * moodF(v);
  function restSpots(s) { const o = []; for (const i in s.d || {}) if (REST.indexOf(s.d[i]) >= 0) o.push({ x: i % N, y: Math.floor(i / N), k: s.d[i], i: +i }); return o; }
  // найближче до хати місце відпочинку
  function restSpot(s, v) {
    const h = s.b.find((b) => b.id === v.home); let best = null, bd = 1e9;
    if (h) for (const q of restSpots(s)) { const d = Math.abs(q.x - h.x) + Math.abs(q.y - h.y); if (d < bd) { bd = d; best = q; } }
    return best;
  }
  // ---------- стежки: обходить будівлі, дерева й тин, любить дороги, поля переходить неохоче ----------
  function blockedSet(s) {
    const o = new Set(), soft = new Set();
    for (const b of s.b) (b.k === 'field' ? soft : o).add(idx(b.x, b.y));
    for (const i in s.ob) o.add(+i);
    for (const i in s.d) if (s.d[i] !== 'path' && s.d[i] !== 'stone') o.add(+i);
    return { o, soft };
  }
  const edgeShut = (s, x, y, dx, dy) => (dx ? (s.f || {})[fenceKey(dx > 0 ? x : x - 1, y, 0)] : (s.f || {})[fenceKey(x, dy > 0 ? y : y - 1, 1)]);
  function findTiles(s, bl, from, goals) {
    const start = idx(from[0], from[1]), gs = new Set(goals.map((q) => idx(q[0], q[1])));
    if (gs.has(start)) return [from];
    const cost = new Map([[start, 0]]), prev = new Map(), open = [[0, start]];
    while (open.length) {
      let m = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[m][0]) m = i;
      const [c, cur] = open.splice(m, 1)[0]; if (c > cost.get(cur)) continue;
      if (gs.has(cur)) { const out = []; for (let q = cur; q !== undefined; q = prev.get(q)) out.unshift([q % N, Math.floor(q / N)]); return out; }
      const x = cur % N, y = Math.floor(cur / N);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= N || Y >= N) continue;
        const n = idx(X, Y); if (bl.o.has(n) || edgeShut(s, x, y, dx, dy)) continue;
        const nc = c + (s.d[n] === 'path' || s.d[n] === 'stone' ? 0.55 : bl.soft.has(n) ? 3 : 1);
        if (nc < (cost.has(n) ? cost.get(n) : 1e9)) { cost.set(n, nc); prev.set(n, cur); open.push([nc, n]); }
      }
    }
    return null;
  }
  const around = (t, bl) => [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([a, b]) => [t.x + a, t.y + b]).filter(([x, y]) => x >= 0 && y >= 0 && x < N && y < N && !bl.o.has(idx(x, y)));
  const near = (a, t) => [a[0] + (t.x - a[0]) * 0.22, a[1] + (t.y - a[1]) * 0.22];
  const lenOf = (pts) => { let l = 0; for (let i = 0; i + 1 < pts.length; i++) l += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); return l; };
  const planCache = new Map();
  // обхід: хата → будівлі → комора → хата. Недосяжну зупинку пропускає, решта маршруту лишається.
  function walkPlan(s, uid, r) {
    const v = s.vl[uid], h = v && s.b.find((b) => b.id === v.home); if (!h) return { legs: [], ms: 8000 };
    const key = s.seed + '|' + r.map((b) => b.id).join() + '|' + s.b.map((b) => b.x + '.' + b.y).join() + '|' + Object.keys(s.ob).length + '|' + Object.keys(s.d).length + '|' + Object.keys(s.f || {}).length;
    const hit = planCache.get(uid); if (hit && hit.key === key) return hit;
    const barn = s.b.find((b) => b.k === 'barn'), stops = r.length && barn ? r.concat([barn]) : r, bl = blockedSet(s);
    let legs = [], best = 1e9;
    for (const door of around(h, bl)) {
      const o = []; let cur = door, p = near(door, h), total = 0, carry = false;
      for (const t of stops) {
        const goals = around(t, bl), tiles = goals.length ? findTiles(s, bl, cur, goals) : null;
        if (!tiles) continue;
        cur = tiles[tiles.length - 1]; const e = near(cur, t), pts = [p].concat(tiles, [e]);
        o.push({ pts, len: lenOf(pts), bk: carry && t !== barn }); total += lenOf(pts); p = e; carry = t === barn ? false : true;
      }
      const back = findTiles(s, bl, cur, [door]);
      if (!back) continue;
      const end = near(door, h), pts = [p].concat(back, [end]); o.push({ pts, len: lenOf(pts), bk: false }); total += lenOf(pts);
      if (total < best) { best = total; legs = o; }
    }
    const ms = legs.reduce((a, l) => a + (l.len / WALK) * 1000 + PAUSE, 0) || 8000, plan = { key, legs, ms };
    planCache.set(uid, plan); return plan;
  }
  function restPlan(s, v) {
    const h = s.b.find((b) => b.id === v.home), sp = restSpot(s, v); if (!h || !sp) return null;
    const bl = blockedSet(s), door = around(h, bl)[0], goals = around(sp, bl); if (!door || !goals.length) return null;
    const tiles = findTiles(s, bl, door, goals); if (!tiles) return null;
    const pts = [near(door, h)].concat(tiles, [[sp.x, sp.y]]); return { sp, pts, len: lenOf(pts) };
  }
  const restMs = (s, v) => { const q = restPlan(s, v); return q ? (2 * q.len * 1000) / WALK / speedOf(v) + SIT : SIT; };
  // час обходу за стану зараз
  function tripOf(s, uid, r) { const v = s.vl[uid]; return v.rt ? restMs(s, v) : walkPlan(s, uid, r).ms / speedOf(v); }
  function restDone(s, v) { const kinds = new Set(restSpots(s).map((q) => q.k)).size; v.m = Math.min(100, mood(v) + 40 + 20 * kinds); v.rt = 0; }
  const vupCost = (v, k) => { const L = v.u[k] || 0; return { c: Math.round(80 * Math.pow(1.9, L)), pl: L >= 1 ? 3 * L : 0 }; };
  // хто що обходить: по черзі приходу, найближчі вільні будівлі до хати
  function routes(s) {
    const out = {}, taken = new Set();
    for (const uid of s.vo || []) {
      const v = s.vl[uid], h = v && s.b.find((b) => b.id === v.home);
      if (!h) { out[uid] = []; continue; }
      const cand = s.b.filter((b) => B[b.k].d && !b.h && !taken.has(b.id))
        .map((b) => [Math.max(Math.abs(b.x - h.x), Math.abs(b.y - h.y)) * 1000 + Math.abs(b.x - h.x) + Math.abs(b.y - h.y), b])
        .sort((a, b) => a[0] - b[0] || a[1].id - b[1].id).slice(0, route(v)).map((e) => e[1]);
      cand.forEach((b) => taken.add(b.id));
      // порядок обходу — «ланцюжком» від хати, щоб не бігати навхрест
      const ord = []; let cur = h; const left = cand.slice();
      while (left.length) { let bi = 0, bd = 1e9; left.forEach((b, i) => { const d = Math.abs(b.x - cur.x) + Math.abs(b.y - cur.y); if (d < bd) { bd = d; bi = i; } }); cur = left.splice(bi, 1)[0]; ord.push(cur); }
      out[uid] = ord;
    }
    return out;
  }
  function trip(s, v, list) {
    let room = basket(v), got = 0;
    for (const b of list) {
      if (!room) break;
      const take = Math.min(room, b.buf); if (!take) continue;
      const r = outOf(b)[0], fit = Math.min(take, Math.max(0, storeCap(s) - (s.st[r] || 0)));
      if (!fit) continue;
      b.buf -= fit; s.st[r] = (s.st[r] || 0) + fit; s.made += fit; room -= fit; got += fit;
    }
    v.got = (v.got || 0) + got;
    // ставить у чергу будівлі свого маршруту зі своєї комори
    for (const b of list) {
      const d = B[b.k]; if (!d.in || b.noq) continue;
      while ((b.qn || 0) + (b.p >= 0 ? 1 : 0) < qMax(b) && d.in.every(([r, n]) => (s.st[r] || 0) >= n)) { for (const [r, n] of d.in) s.st[r] -= n; b.qn = (b.qn || 0) + 1; }
    }
    v.m = Math.max(15, mood(v) - 2);
    if (mood(v) <= 30 && restSpot(s, v)) v.rt = 1;
    return got;
  }
  function freeTileNear(s, cx, cy) {
    let best = null, bd = 1e9;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (!owned(s, x, y) || at(s, x, y) || s.ob[idx(x, y)] || (s.d && s.d[idx(x, y)])) continue;
      const d = Math.abs(x - cx) + Math.abs(y - cy) + (x + y) * 1e-3;
      if (d < bd) { bd = d; best = [x, y]; }
    }
    return best;
  }
  function addVillager(s, uid, name) {
    if (!s.vl) { s.vl = {}; s.vo = []; }
    if (s.vl[uid]) { s.vl[uid].n = name; return s.vl[uid]; }
    const v = { n: name, c: { s: Math.floor(rnd(s) * 4), sh: Math.floor(rnd(s) * 8), p: Math.floor(rnd(s) * 5), st: Math.floor(rnd(s) * 4), h: Math.floor(rnd(s) * 6) }, u: {}, vp: 0, home: null, got: 0 };
    const t = freeTileNear(s, MID + 1, MID + 1);
    if (t) { const h = { id: s.nid++, k: 'home', x: t[0], y: t[1], lv: 1, buf: 0, p: -1, h: 0, o: uid }; s.b.push(h); v.home = h.id; }
    s.vl[uid] = v; s.vo.push(uid);
    return v;
  }

  // ---------- випадковість: лише з ядра у стані, щоб транзакція при повторі дала те саме ----------
  function rnd(s) { s.r = (s.r + 0x6D2B79F5) | 0; let t = s.r; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  function hash(seed, x, y) { let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

  const idx = (x, y) => y * N + x;
  const fenceKey = (x, y, e) => idx(x, y) * 2 + (e ? 1 : 0);
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
    const s = { v: VER, nm: name || 'Хутір', seed: seed | 0, r: seed | 0, t: 0, coins: 100, xp: 0, lv: 1, sl: 0, st: {}, b: [], nid: 1, ch: [], ob: {}, d: {}, f: {}, inv: {}, o: [], lg: [], pc: {}, made: 0 };
    for (let y = 4; y <= 6; y++) for (let x = 4; x <= 6; x++) { const c = y * NC + x; s.ch.push(c); genChunk(s, c, true); }
    for (let y = MID - 3; y <= MID + 2; y++) for (let x = MID - 3; x <= MID + 2; x++) delete s.ob[idx(x, y)];
    s.b.push({ id: s.nid++, k: 'field', x: MID - 1, y: MID - 1, lv: 1, buf: 0, p: 0, h: 0, cr: 'wheat' });
    s.b.push({ id: s.nid++, k: 'barn', x: MID + 1, y: MID - 2, lv: 1, buf: 0, p: -1, h: 0 });
    fillOrders(s, 0);
    return s;
  }

  // ---------- числа ----------
  const storeCap = (s) => Math.round(100 * Math.pow(1.5, s.sl));
  const xpNeed = (L) => Math.round(25 * Math.pow(L, 1.55));
  const slots = (s) => 3 + (s.lv >= 6) + (s.lv >= 12);
  function buildCost(s, k) { const m = Math.pow(B[k].m || 1.15, B[k].step ? Math.floor(count(s, k) / B[k].step) : count(s, k)); return { c: Math.round(B[k].c * m), pl: B[k].pl ? Math.ceil(B[k].pl * m) : 0 }; }
  function upCost(b) { const d = B[b.k], L = b.lv; return { c: Math.round(d.c * 0.8 * Math.pow(1.7, L)) + 20, pl: L >= 2 ? 3 * L : 0 }; }
  const hireCost = (b) => ({ c: 100 + B[b.k].c * 2, pl: 0 });
  const storeCost = (s) => ({ c: Math.round(150 * Math.pow(1.9, s.sl)), pl: s.sl >= 1 ? 4 * s.sl : 0 });
  const chunkCost = (s) => { const n = s.ch.length; return { c: Math.round(150 * Math.pow(1.55, n - 9)), pl: n >= 11 ? 4 * (n - 10) : 0 }; };
  const ROCK = 30;
  const qMax = (b) => (B[b.k].q || 0) + b.lv - 1;
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
  function durOf(b, bon) { return (b.k === 'field' ? CROP[b.cr || 'wheat'].d : B[b.k].d) * 1000 / ((1 + 0.35 * (b.lv - 1)) * (1 + (bon.get(b.id) || 0))); }

  function canStart(s, b) {
    const d = B[b.k];
    if (!d.d) return false;
    if (d.kind === 'field') return false;                     // поле сіє лише гравець
    if (b.buf + d.out[1] > capOf(b)) return false;
    if (d.in) return (b.qn || 0) > 0;                         // сировину вже взято, коли став у чергу
    return true;
  }
  function flush(s, b) {
    if (!B[b.k].out || !b.buf) return 0;
    const r = outOf(b)[0];
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
      if (b.auto && b.k === 'field' && b.cr && !b.buf && b.p < 0) b.p = 0;   // «Постійно»: сіє те саме, щойно врожай забрали
      if (b.p < 0 && canStart(s, b)) { if (B[b.k].in) b.qn--; b.p = 0; }
    }
  }
  function advance(s, now) {
    if (!s.b.some((b) => b.k === 'barn')) { const t = freeTileNear(s, MID + 1, MID - 2); if (t) s.b.push({ id: s.nid++, k: 'barn', x: t[0], y: t[1], lv: 1, buf: 0, p: -1, h: 0 }); }
    if (!s.f) { s.f = {}; for (const i in s.d || {}) if (s.d[i] === 'fence') delete s.d[i]; }   // тин тепер на межах, а не на клітинках
    if (!s.t) { s.t = now; kick(s); return s; }
    if (now <= s.t) return s;
    let t = Math.max(s.t, now - MAX_AWAY);
    const bon = bonuses(s), dur = new Map(), prod = s.b.filter((b) => B[b.k].d);
    for (const b of prod) dur.set(b.id, durOf(b, bon));
    const rts = routes(s), vs = (s.vo || []).map((u) => [s.vl[u], rts[u], u]).filter(([v, r]) => v && v.home && r.length);
    const T = (v, r, u) => tripOf(s, u, r);
    for (let guard = 0; guard < 3e6; guard++) {
      kick(s);
      if (t >= now) break;
      let m = Infinity;
      for (const b of prod) if (b.p >= 0) m = Math.min(m, dur.get(b.id) - b.p);
      // селянину є сенс іти, лише якщо щось росте або щось чекає в будівлях маршруту
      const busy = m !== Infinity;
      for (const [v, r, u] of vs) if (busy || v.rt || r.some((b) => b.buf)) m = Math.min(m, T(v, r, u) - v.vp);
      if (m === Infinity) break;
      const step = Math.min(Math.max(m, 0), now - t);
      for (const b of prod) if (b.p >= 0) b.p += step;
      for (const [v] of vs) v.vp += step;
      t += step;
      for (const b of prod) if (b.p >= 0 && b.p >= dur.get(b.id) - 1e-6) { b.buf += outOf(b)[1]; b.p = -1; }
      for (const [v, r, u] of vs) if (v.vp >= T(v, r, u) - 1e-6) { v.vp = 0; if (v.rt) restDone(s, v); else trip(s, v, r); }
    }
    // поки нічого не росте й нічого не чекає — селянин удома, але годинник обходу йде далі для показу
    if (t < now) for (const [v, r, u] of vs) v.vp = (v.vp + (now - t)) % T(v, r, u);
    s.t = now;
    return s;
  }

  // ---------- замовлення ----------
  function producible(s) {
    const set = new Set(); for (const b of s.b) if (B[b.k].out && b.k !== 'field') set.add(B[b.k].out[0]);
    if (count(s, 'field')) for (const c in CROP) if (s.lv >= CROP[c].lv) set.add(c);
    return set.size ? [...set] : ['wheat'];
  }
  function newOrder(s, wait) {
    const pool = producible(s).slice(), items = [];
    const k = Math.min(pool.length, s.lv < 3 ? 1 : s.lv < 6 ? 1 + (rnd(s) < 0.5) : 1 + Math.floor(rnd(s) * 3));
    const V = (12 + 28 * s.lv) * (0.7 + 0.6 * rnd(s));
    let val = 0;
    for (let i = 0; i < k; i++) {
      const r = pool.splice(Math.floor(rnd(s) * pool.length), 1)[0];
      const n = Math.max(1, Math.min(storeCap(s), Math.round(V / k / RES[r].p)));
      items.push([r, n]); val += n * RES[r].p;
    }
    return { it: items, c: Math.round(val * 1.6 + 5), xp: Math.round(val * 0.35) + 4, w: wait || 0 };
  }
  function fillOrders(s, now) { while (s.o.length < slots(s)) s.o.push(newOrder(s, 0)); }

  // ---------- краса ----------
  // після 12 однакових прикрас кожна наступна важить утричі менше: красиво — це різноманітно
  function beauty(s) {
    const n = {}; let sum = 0, fc = Object.keys(s.f || {}).length;
    sum += Math.min(fc, 40) * DECOR.fence.b + Math.max(0, fc - 40) * DECOR.fence.b * 0.33;
    for (const i in s.d || {}) { const k = s.d[i], c = (n[k] = (n[k] || 0) + 1); sum += DECOR[k].b * (c > 12 ? 0.33 : 1); }
    return Math.round(sum);
  }
  const tierNeed = (t) => 15 * t * (t + 1) / 2;
  function tier(s) { const b = beauty(s); let t = 0; while (t < 10 && b >= tierNeed(t + 1)) t++; return t; }
  const beautyBonus = (s) => 1 + 0.04 * tier(s);

  // ---------- торговець ----------
  // приїздить кожні 3 години на 90 хвилин; товар залежить від приїзду, тож у всіх на хуторі однаковий
  const MK_EVERY = 3 * 3600e3, MK_STAY = 90 * 60e3;
  const VILLAGES = ['Опішні', 'Решетилівки', 'Диканьки', 'Великих Сорочинців', 'Кобеляк', 'Миргорода'];
  function market(s, t) {
    if (!count(s, 'market')) return null;
    const sl = Math.floor(t / MK_EVERY);
    if (t % MK_EVERY >= MK_STAY) return { here: false, next: (sl + 1) * MK_EVERY };
    if (!s.mk || s.mk.sl !== sl) {
      const pool = producible(s), o = [], tr = tier(s), R = (i) => hash(s.seed ^ sl, i, 77);
      for (let i = 0, nb = 2 + Math.floor(tr / 2); i < nb && pool.length; i++) {
        const r = pool.splice(Math.floor(R(i) * pool.length), 1)[0];
        o.push({ r, p: Math.ceil(RES[r].p * (2 + 0.1 * tr)), n: Math.max(2, Math.round((60 + 30 * s.lv) / RES[r].p)) });
      }
      o.push({ d: R(20) < 0.7 ? 'pot' : 'baba', n: 1 });
      if (tr >= 3) o.push({ d: R(21) < 0.5 ? 'pot' : 'baba', n: 1 });
      s.mk = { sl, v: Math.floor(R(30) * VILLAGES.length), o };
    }
    return { here: true, v: VILLAGES[s.mk.v], o: s.mk.o, end: sl * MK_EVERY + MK_STAY };
  }

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
        if (s.d[idx(a.x, a.y)]) return fail('Спершу прибери прикрасу');
        if (d.one && count(s, a.k)) return fail('Такий уже є');
        const cost = buildCost(s, a.k); if (!canAfford(s, cost)) return fail('Треба ' + fmtCost(cost));
        pay(s, cost);
        const b = { id: s.nid++, k: a.k, x: a.x, y: a.y, lv: 1, buf: 0, p: -1, h: 0, at: s.t, pd: cost };
        s.b.push(b); log(s, who, 'збудував(ла) ' + d.n);
        gainXp(s, 3, res); kick(s);
        res.fx.push([a.x, a.y, '-' + cost.c + ' 💰']); return res;
      }
      case 'collect': {
        const b = s.b.find((q) => q.id === a.id); if (!b) return fail('Нема');
        if (!b.buf) return fail('Ще не готово');
        const r0 = outOf(b)[0], n = flush(s, b); if (!n) return fail('Комора повна — продай щось');
        kick(s);
        res.fx.push([b.x, b.y, '+' + n + ' ' + RES[r0].ic]); res.n = n; return res;
      }
      case 'collectAll': {
        // збирає все дозріле й знову сіє на полях те саме
        let tot = 0, full = false, sown = 0;
        for (const b of s.b) if (b.buf) { const r0 = outOf(b)[0], n = flush(s, b); tot += n; if (n) res.fx.push([b.x, b.y, '+' + n + ' ' + RES[r0].ic]); if (b.buf) full = true; }
        for (const b of s.b) if (b.k === 'field' && b.cr && !b.buf && b.p < 0) { b.p = 0; sown++; }
        if (!tot && !sown) return fail(full ? 'Комора повна — продай щось' : 'Нічого не дозріло');
        kick(s); res.n = tot; return res;
      }
      case 'sow': {
        const b = s.b.find((q) => q.id === a.id), c = CROP[a.c]; if (!b || b.k !== 'field' || !c) return fail('Нема');
        if (s.lv < c.lv) return fail('Відкриється на ' + c.lv + ' рівні');
        if (b.p >= 0 || b.buf) return fail('Поле зайняте');
        b.cr = a.c; b.p = 0; res.fx.push([b.x, b.y, RES[a.c].ic]); return res;
      }
      case 'auto': {
        const b = s.b.find((q) => q.id === a.id); if (!b || b.k !== 'field') return fail('Нема');
        for (const q of a.all ? s.b.filter((f) => f.k === 'field') : [b]) q.auto = a.on ? 1 : 0;
        kick(s); return res;
      }
      case 'noq': {
        const b = s.b.find((q) => q.id === a.id); if (!b || !B[b.k].in) return fail('Нема');
        b.noq = a.on ? 0 : 1; kick(s); return res;
      }
      case 'queue': {
        const b = s.b.find((q) => q.id === a.id), d = b && B[b.k]; if (!b || !d.in) return fail('Нема');
        if ((b.qn || 0) + (b.p >= 0 ? 1 : 0) >= qMax(b)) return fail('Черга повна');
        for (const [r, n] of d.in) if ((s.st[r] || 0) < n) return fail('Бракує ' + RES[r].ic);
        for (const [r, n] of d.in) s.st[r] -= n;
        b.qn = (b.qn || 0) + 1; kick(s); return res;
      }
      case 'deco': {
        const d = DECOR[a.k], i = idx(a.x, a.y); if (!d) return fail('Нема');
        if (!owned(s, a.x, a.y)) return fail('Це не твоя земля');
        if (at(s, a.x, a.y) || s.ob[i] || s.d[i]) return fail('Тут зайнято');
        if (d.shop === false) { if (!s.inv[a.k]) return fail('Привозить лише торговець'); s.inv[a.k]--; }
        else { if (s.lv < d.lv) return fail('Відкриється на ' + d.lv + ' рівні'); if (s.coins < d.c) return fail('Треба ' + d.c + ' 💰'); s.coins -= d.c; }
        s.d[i] = a.k; return res;
      }
      case 'fence': {
        // межа: e = 0 — між (x,y) і (x+1,y), e = 1 — між (x,y) і (x,y+1)
        const e = a.e ? 1 : 0, key = fenceKey(a.x, a.y, e), x2 = a.x + (e ? 0 : 1), y2 = a.y + (e ? 1 : 0);
        if (!owned(s, a.x, a.y) && !owned(s, x2, y2)) return fail('Це не твоя земля');
        if (a.off) { if (!s.f[key]) return fail('Нема'); delete s.f[key]; s.coins += a.full ? DECOR.fence.c : Math.floor(DECOR.fence.c / 2); return res; }
        if (s.f[key]) return fail('Тут уже є');
        if (s.coins < DECOR.fence.c) return fail('Треба ' + DECOR.fence.c + ' 💰');
        s.coins -= DECOR.fence.c; s.f[key] = 1; return res;
      }
      case 'fenceoff': {
        let n = 0; for (const [x, y, e] of a.l || []) if (s.f[fenceKey(x, y, e)]) { delete s.f[fenceKey(x, y, e)]; n++; }
        s.coins += n * DECOR.fence.c; return res;
      }
      case 'restore': {
        // кувалда назад: будівля повертається такою, як була
        if (!a.b || at(s, a.b.x, a.b.y) || s.ob[idx(a.b.x, a.b.y)] || s.d[idx(a.b.x, a.b.y)]) return fail('Місце зайняте');
        if (s.coins < (a.pay || 0)) return fail('Треба ' + a.pay + ' 💰');
        s.coins -= a.pay || 0; s.b.push(a.b); kick(s); return res;
      }
      case 'move': {
        const fr = a.id ? s.b.find((q) => q.id === a.id) : null, i0 = a.id ? -1 : idx(a.x0, a.y0), to = idx(a.x, a.y);
        if (a.id ? !fr : !s.d[i0]) return fail('Нема');
        if (!owned(s, a.x, a.y) || at(s, a.x, a.y) || s.ob[to] || s.d[to]) return fail('Тут зайнято');
        if (fr) { fr.x = a.x; fr.y = a.y; if (fr.k === 'home') for (const u in s.vl || {}) if (s.vl[u].home === fr.id) s.vl[u].vp = 0; }
        else { s.d[to] = s.d[i0]; delete s.d[i0]; if (s.dr && s.dr[i0] !== undefined) { s.dr[to] = s.dr[i0]; delete s.dr[i0]; } }
        return res;
      }
      case 'unbuild': {
        // скасування щойно поставленої будівлі: повертає все сплачене
        const i = s.b.findIndex((q) => q.id === a.id), b = s.b[i]; if (!b || !b.pd) return fail('Уже не скасувати');
        s.coins += b.pd.c; s.st.plank = (s.st.plank || 0) + (b.pd.pl || 0); if (!s.st.plank) delete s.st.plank;
        for (const [r, n] of B[b.k].in || []) s.st[r] = (s.st[r] || 0) + n * ((b.qn || 0) + (b.p >= 0 ? 1 : 0));
        s.b.splice(i, 1); kick(s); return res;
      }
      case 'fences': {
        // весь намальований тин однією дією: гроші списуються разом або ніяк
        const list = (a.l || []).filter(([x, y, e]) => !s.f[fenceKey(x, y, e)] && (owned(s, x, y) || owned(s, x + (e ? 0 : 1), y + (e ? 1 : 0))));
        if (!list.length) return fail('Нема що ставити');
        const c = list.length * DECOR.fence.c; if (s.coins < c) return fail('Треба ' + c + ' 💰');
        s.coins -= c; for (const [x, y, e] of list) s.f[fenceKey(x, y, e)] = 1; return res;
      }
      case 'turn': {
        const i = idx(a.x, a.y), d = DECOR[s.d[i]]; if (!d || !d.turn) return fail('Нема');
        if (!s.dr) s.dr = {}; s.dr[i] = ((s.dr[i] || 0) + 1) % d.turn; return res;
      }
      case 'undeco': {
        const i = idx(a.x, a.y), k = s.d[i]; if (!k) return fail('Нема');
        delete s.d[i]; if (DECOR[k].shop === false) s.inv[k] = (s.inv[k] || 0) + 1; else s.coins += a.full ? DECOR[k].c : Math.floor(DECOR[k].c / 2); return res;
      }
      case 'mk': {
        const m = market(s, now), o = m && m.here && m.o[a.i]; if (!o || !o.n) return fail('Торговець уже поїхав');
        if (o.d) {
          const c = DECOR[o.d].c; if (s.coins < c) return fail('Треба ' + c + ' 💰');
          s.coins -= c; s.inv[o.d] = (s.inv[o.d] || 0) + 1; o.n = 0; log(s, who, 'купив(ла) ' + DECOR[o.d].n); return res;
        }
        const n = Math.min(o.n, Math.max(1, a.n | 0), s.st[o.r] || 0); if (!n) return fail('Нема чого продати');
        s.st[o.r] -= n; o.n -= n; const c = n * o.p; s.coins += c; s.pc[who] = (s.pc[who] || 0) + c; res.c = c; kick(s); return res;
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
        const b = s.b[i]; if (b.k === 'home' || b.k === 'barn') return fail(B[b.k].n + ': не знести, можна лише пересунути');
        flush(s, b); s.b.splice(i, 1);
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
        const pay2 = Math.round(o.c * beautyBonus(s)); s.coins += pay2; s.pc[who] = (s.pc[who] || 0) + pay2;
        log(s, who, 'виконав(ла) замовлення: +' + pay2 + ' 💰');
        s.o[a.i] = newOrder(s, 0); gainXp(s, o.xp, res); res.c = pay2; res.xp = o.xp;
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
      case 'join': {
        const nm = String(a.n || '').replace(/[<>&"]/g, '').trim().slice(0, 16) || 'Селянин';
        const v = addVillager(s, String(a.uid), nm); if (!v.home) res.err = 'Немає місця для хати'; log(s, nm, 'оселився(лась) на хуторі');
        return res;
      }
      case 'look': {
        const v = s.vl && s.vl[a.uid]; if (!v) return fail('Нема селянина');
        const c = a.c || {}, ok = (k, L) => Number.isInteger(c[k]) && c[k] >= 0 && c[k] < L;
        if (!(ok('s', LOOK.skin.length) && ok('sh', LOOK.shirt.length) && ok('p', LOOK.pants.length) && ok('st', LOOK.style.length) && ok('h', LOOK.hat.length) && (c.b === undefined || ok('b', LOOK.body.length)) && (c.f === undefined || ok('f', LOOK.face.length)))) return fail('Не той вигляд');
        v.c = { s: c.s, sh: c.sh, p: c.p, st: c.st, h: c.h, b: c.b || 0, f: c.f || 0 }; return res;
      }
      case 'vup': {
        const v = s.vl && s.vl[a.uid]; if (!v || !VUP[a.k]) return fail('Нема');
        const cost = vupCost(v, a.k); if (!canAfford(s, cost)) return fail('Треба ' + fmtCost(cost));
        pay(s, cost); v.u[a.k] = (v.u[a.k] || 0) + 1; log(s, v.n, 'отримав(ла) ' + VUP[a.k].n.toLowerCase() + ' ' + v.u[a.k] + '-го рівня');
        return res;
      }
      case 'movehome': {
        const v = s.vl && s.vl[a.uid], h = v && s.b.find((b) => b.id === v.home);
        if (!v) return fail('Нема селянина');
        if (!owned(s, a.x, a.y) || at(s, a.x, a.y) || s.ob[idx(a.x, a.y)] || s.d[idx(a.x, a.y)]) return fail('Сюди не можна');
        if (h) { h.x = a.x; h.y = a.y; } else { const nh = { id: s.nid++, k: 'home', x: a.x, y: a.y, lv: 1, buf: 0, p: -1, h: 0, o: a.uid }; s.b.push(nh); v.home = nh.id; }
        v.vp = 0; res.fx.push([a.x, a.y, '🏠']); return res;
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
    if (d.kind === 'field') return b.buf ? '' : 'sow';
    if (b.buf + d.out[1] > capOf(b)) return 'full';
    if (d.in && !(b.qn || 0)) return 'queue';
    return '';
  }

  const api = { mood, moodF, restSpot, restPlan, walkPlan, tripOf, speedOf, WALK, PAUSE, SIT, fenceKey, VER, MID, CROP, DECOR, outOf, qMax, beauty, tier, tierNeed, beautyBonus, market, LOOK, VUP, routes, route, basket, vupCost, addVillager, kick, N, CH, NC, RES, B, ORDER, create, advance, act, why, storeCap, xpNeed, buildCost, upCost, hireCost, storeCost, chunkCost, capOf, durOf, bonuses, slots, owned, chunkOf, idx, at, count, ROCK, fmtCost, canAfford, MAX_AWAY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KhutirSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
