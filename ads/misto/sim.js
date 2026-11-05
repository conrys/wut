/* Містечко — логіка без екрана: рельєф, будівлі, стрічки, жолоби, підйомники, носії, хати й крамниці.
   Працює лише поки гра відкрита: step(s, dt) викликається з фіксованим кроком. Без DOM — можна ганяти в node. */
(function (root) {
  'use strict';
  const W = 40, H = 40, VER = 1;
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];   // 0 — схід (+x), 1 — південь (+y), 2 — захід, 3 — північ
  const idx = (x, y) => y * W + x, inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

  // товари: c — колір кубика на стрічці, p — ціна в крамниці (мідь)
  const RES = {
    log: { n: 'Колоди', ic: '🪵', c: '#8B5A2B' },
    plank: { n: 'Дошки', ic: '🟫', c: '#D9A45B' },
    stone: { n: 'Камінь', ic: '🪨', c: '#9AA0A6' },
    wheat: { n: 'Пшениця', ic: '🌾', c: '#E8C547' },
    flour: { n: 'Борошно', ic: '🥣', c: '#F3EEE2' },
    bread: { n: 'Хліб', ic: '🍞', c: '#C9813A', p: 3 },
    fire: { n: 'Дрова', ic: '🔥', c: '#A0522D', p: 2 },
  };
  // будівлі: cost — ціна (товари зі складу + cu — мідь), job — потрібен робітник, t — секунд на цикл,
  // in — що бере за цикл, out/q — що й скільки дає, pop — скільки робітників живе
  const B = {
    hall: { n: 'Ратуша', ic: '🏛', stor: 1, pop: 4, nobuild: 1, hint: 'Серце міста: тут склад і перші робітники.' },
    store: { n: 'Склад', ic: '📦', stor: 1, cost: { plank: 8 }, hint: 'Ще одне місце, куди носії зносять товар, і +80 місця для кожного товару.' },
    wood: { n: 'Лісоруб', ic: '🪓', cost: { log: 4 }, job: 1, t: 6, out: 'log', q: 1, near: 'tree', hint: 'Рубає дерева в радіусі 3 клітинок. Пні знову заростають.' },
    quarry: { n: 'Каменярня', ic: '⛏', cost: { log: 6 }, job: 1, t: 8, out: 'stone', q: 1, near: 'rock', hint: 'Ставиться впритул до скелі.' },
    farm: { n: 'Ферма', ic: '🌾', cost: { log: 6 }, job: 1, t: 10, out: 'wheat', q: 2, hint: 'Вирощує пшеницю.' },
    saw: { n: 'Тартак', ic: '🪚', cost: { log: 8, stone: 4 }, job: 1, t: 5, in: { log: 1 }, out: 'plank', q: 1 },
    chop: { n: 'Дровітня', ic: '🔥', cost: { log: 6 }, job: 1, t: 4, in: { log: 1 }, out: 'fire', q: 2 },
    mill: { n: 'Млин', ic: '🌬', cost: { plank: 6, stone: 6 }, job: 1, t: 6, in: { wheat: 2 }, out: 'flour', q: 1 },
    bakery: { n: 'Пекарня', ic: '🍞', cost: { plank: 8, stone: 8, cu: 10 }, job: 1, t: 8, in: { flour: 1 }, out: 'bread', q: 2 },
    market: { n: 'Крамниця', ic: '🏪', cost: { plank: 8, cu: 10 }, sells: ['bread', 'fire'], r: 5, hint: 'Хати в радіусі 5 клітинок купують тут хліб і дрова й платять міддю.' },
    house: { n: 'Хата', ic: '🏠', cost: { log: 6, stone: 2 }, pop: 2, up: { plank: 10, stone: 6, cu: 20 }, hint: 'Живуть 2 робітники (після покращення — 4). Купує в крамниці поруч.' },
  };
  const CONV = {
    belt: { n: 'Стрічка', ic: '➡', cost: { plank: 1 }, sp: 1.2, hint: 'Везе будь-який товар по рівному.' },
    chute: { n: 'Жолоб', ic: '⤵', cost: { log: 1 }, sp: 2.5, hint: 'Швидкий, але лише вниз або по рівному.' },
    lift: { n: 'Підйомник', ic: '⏫', cost: { plank: 3, stone: 2 }, sp: 0.8, hint: 'Піднімає товар на рівень вище.' },
  };
  const NEEDS = [['bread'], ['bread', 'fire']];          // що хоче хата 1-го і 2-го рівня
  const BUY_EVERY = 30, HAPPY_FOR = 90, OUT_CAP = 4, IN_CAP = 4, MK_CAP = 10;
  const storCap = (s) => 100 + 80 * Object.values(s.b).filter((b) => b.k === 'store').length;

  // ---------- випадковість і рельєф ----------
  function rng(seed) { let a = seed | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function noise(seed, scale) {
    const R = rng(seed), g = [], gw = Math.ceil(W / scale) + 2, gh = Math.ceil(H / scale) + 2;
    for (let i = 0; i < gw * gh; i++) g.push(R());
    const sm = (t) => t * t * (3 - 2 * t);
    return (x, y) => { const fx = x / scale, fy = y / scale, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = sm(fx - x0), ty = sm(fy - y0), v = (i, j) => g[(y0 + j) * gw + x0 + i];
      return (v(0, 0) * (1 - tx) + v(1, 0) * tx) * (1 - ty) + (v(0, 1) * (1 - tx) + v(1, 1) * tx) * ty; };
  }
  function create(seed) {
    const s = { v: VER, seed: seed | 0, t: 0, h: [], tr: [], rk: [], pa: [], cv: {}, b: {}, nid: 1, st: { log: 30, stone: 10 }, cu: 30, made: 0 };
    const nh = noise(seed, 9), nh2 = noise(seed + 7, 4), nt = noise(seed + 13, 5), nr = noise(seed + 29, 4);
    const cx = W / 2, cy = H / 2;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - cx, y - cy);
      let v = nh(x, y) * 0.8 + nh2(x, y) * 0.2 + (d < 5 ? 0.5 - nh(x, y) * 0.8 - nh2(x, y) * 0.2 + 0.5 : 0) * 0;
      let hh = v < 0.36 ? 0 : v < 0.6 ? 1 : v < 0.78 ? 2 : 3;
      if (d < 4.5) hh = 1;                                   // рівна площа під ратушу
      s.h.push(hh);
      const free = d > 4.5;
      s.rk.push(free && nr(x, y) > 0.74 ? 1 : 0);
      s.tr.push(free && !s.rk[s.rk.length - 1] && nt(x, y) > 0.6 ? 1 : 0);
      s.pa.push(0);
    }
    // гарантувати ліс і скелю недалеко від ратуші
    const ensure = (arr, other, ox, oy, n) => { let have = 0; for (let y = cy - 9; y < cy + 9; y++) for (let x = cx - 9; x < cx + 9; x++) if (arr[idx(x, y)]) have++;
      if (have >= n) return; for (let k = 0; k < n; k++) { const x = cx + ox + (k % 3), y = cy + oy + Math.floor(k / 3); arr[idx(x, y)] = 1; other[idx(x, y)] = 0; s.h[idx(x, y)] = 1; } };
    ensure(s.tr, s.rk, -8, -3, 6); ensure(s.rk, s.tr, 6, 4, 3);
    addB(s, 'hall', cx, cy);
    return s;
  }

  // ---------- карта й будівлі ----------
  function occ(s) { if (!s._occ) { s._occ = new Map(); for (const id in s.b) s._occ.set(idx(s.b[id].x, s.b[id].y), s.b[id]); } return s._occ; }
  const bAt = (s, x, y) => occ(s).get(idx(x, y)) || null;
  function addB(s, k, x, y) {
    const b = { id: s.nid++, k, x, y, lv: 1, inp: {}, out: [], t: 0 };
    if (B[k].sells) b.mk = {};
    if (k === 'house') b.hb = {};
    s.b[b.id] = b; s._occ = null; return b;
  }
  const freeTile = (s, x, y) => inb(x, y) && !bAt(s, x, y) && !s.tr[idx(x, y)] && !s.rk[idx(x, y)] && !s.cv[idx(x, y)];
  function stumps(s) { if (!s.sp) s.sp = {}; return s.sp; }
  function nearTree(s, b, take) {
    let best = -1, bd = 1e9;
    for (let y = b.y - 3; y <= b.y + 3; y++) for (let x = b.x - 3; x <= b.x + 3; x++) if (inb(x, y) && s.tr[idx(x, y)]) { const d = Math.abs(x - b.x) + Math.abs(y - b.y); if (d < bd) { bd = d; best = idx(x, y); } }
    if (best >= 0 && take) { s.tr[best] = 0; stumps(s)[best] = s.t + 150; }
    return best;
  }
  const nearRock = (s, b) => [0, 1, 2, 3].some((d) => inb(b.x + DX[d], b.y + DY[d]) && s.rk[idx(b.x + DX[d], b.y + DY[d])]);
  const canPay = (s, cost) => Object.keys(cost || {}).every((r) => (r === 'cu' ? s.cu : s.st[r] || 0) >= cost[r]);
  function pay(s, cost, k) { for (const r in cost || {}) { const v = Math.round(cost[r] * (k || 1)); if (r === 'cu') s.cu += k ? v : -cost[r]; else s.st[r] = (s.st[r] || 0) + (k ? v : -cost[r]); } }
  const costTxt = (c) => Object.keys(c || {}).map((r) => (c[r] + ' ' + (r === 'cu' ? '🪙' : RES[r].ic))).join(' · ');

  // ---------- робітники ----------
  function pop(s) { let p = 0; for (const id in s.b) { const b = s.b[id]; if (b.k === 'house') p += b.lv > 1 ? 4 : 2; else if (B[b.k].pop) p += B[b.k].pop; } return p; }
  function jobs(s) { const o = []; for (const id in s.b) { const b = s.b[id]; if (B[b.k].job) { if (b.off) b.on = 0; else o.push(b); } } o.sort((a, b) => a.id - b.id); return o; }
  // хто працює: перші за порядком будови; решта людей — носії
  function staff(s) { const p = pop(s), js = jobs(s); let left = p; for (const b of js) { b.on = left > 0 ? 1 : 0; if (b.on) left--; } return { pop: p, jobs: js.length, free: left }; }

  // ---------- щастя ----------
  function happyOf(s, b) { const need = NEEDS[b.lv > 1 ? 1 : 0]; let n = 0; for (const r of need) if (b.hb[r] && s.t - b.hb[r] < HAPPY_FOR) n++; return n / need.length; }
  function happy(s) { const hs = Object.values(s.b).filter((b) => b.k === 'house'); if (!hs.length) return 0; return hs.reduce((a, b) => a + happyOf(s, b), 0) / hs.length; }
  const speed = (s) => 0.75 + 0.5 * (s._hp === undefined ? happy(s) : s._hp);

  // ---------- що приймає будівля ----------
  function accepts(s, b, r) {
    const d = B[b.k];
    if (d.stor) return (s.st[r] || 0) < storCap(s);
    if (d.in && d.in[r]) return (b.inp[r] || 0) < IN_CAP;
    if (d.sells && d.sells.indexOf(r) >= 0) return (b.mk[r] || 0) < MK_CAP;
    return false;
  }
  function put(s, b, r) {
    const d = B[b.k];
    if (d.stor) s.st[r] = (s.st[r] || 0) + 1;
    else if (d.in) b.inp[r] = (b.inp[r] || 0) + 1;
    else if (d.sells) b.mk[r] = (b.mk[r] || 0) + 1;
  }

  // ---------- стрічки ----------
  // чи може товар перейти з клітинки a (вид k) на клітинку b за висотою
  function hOk(s, k, ia, ib) { const ha = s.h[ia], hb = s.h[ib]; return k === 'chute' ? hb <= ha : k === 'lift' ? hb === ha + 1 || hb === ha : hb === ha; }
  function outConvs(s, b) {   // стрічки, що виходять від будівлі назовні
    const o = []; for (let d = 0; d < 4; d++) { const x = b.x + DX[d], y = b.y + DY[d]; if (!inb(x, y)) continue; const c = s.cv[idx(x, y)]; if (c && c.d === d) { const ok = c.k === 'chute' ? s.h[idx(x, y)] <= s.h[idx(b.x, b.y)] : s.h[idx(x, y)] === s.h[idx(b.x, b.y)]; if (ok) o.push([idx(x, y), c]); } }
    return o;
  }
  const roomAtStart = (c) => !c.it.some((q) => q[1] < 0.5);
  function stepConv(s, dt) {
    const keys = Object.keys(s.cv);
    for (const key of keys) {
      const i = +key, c = s.cv[i]; if (!c || !c.it.length) continue;
      const sp = CONV[c.k].sp * dt, x = i % W, y = (i - x) / W, nx = x + DX[c.d], ny = y + DY[c.d];
      c.it.sort((a, b) => b[1] - a[1]);
      for (let j = 0; j < c.it.length; j++) {
        const q = c.it[j], lim = j === 0 ? 1 : c.it[j - 1][1] - 0.5;
        q[1] = Math.min(lim, q[1] + sp);
      }
      const q = c.it[0];
      if (q[1] < 1 || !inb(nx, ny)) continue;
      const ni = idx(nx, ny), nc = s.cv[ni], nb = bAt(s, nx, ny);
      if (nc && hOk(s, c.k, i, ni) && roomAtStart(nc) && (nc.d + 2) % 4 !== c.d) { c.it.shift(); nc.it.push([q[0], 0]); }
      else if (nb && hOk(s, c.k, i, ni) && accepts(s, nb, q[0])) { c.it.shift(); put(s, nb, q[0]); }
    }
  }

  // ---------- носії ----------
  // ходять клітинками: стежка швидше, трава повільніше, через скелі й будівлі — ні, перепад висоти ≤ 1
  const walk = (s, i) => !s.rk[i] && !occ(s).has(i);
  function bfs(s, from, goals) {
    const gs = new Set(goals); if (gs.has(from)) return [from];
    const cost = new Map([[from, 0]]), prev = new Map(), open = [[0, from]];
    while (open.length) {
      let m = 0; for (let k = 1; k < open.length; k++) if (open[k][0] < open[m][0]) m = k;
      const [c, cur] = open.splice(m, 1)[0]; if (c > cost.get(cur)) continue;
      if (gs.has(cur)) { const p = []; for (let q = cur; q !== undefined; q = prev.get(q)) p.unshift(q); return p; }
      const x = cur % W, y = (cur - x) / W;
      for (let d = 0; d < 4; d++) {
        const X = x + DX[d], Y = y + DY[d]; if (!inb(X, Y)) continue; const n = idx(X, Y);
        if (!walk(s, n) || Math.abs(s.h[n] - s.h[cur]) > 1) continue;
        const nc = c + (s.pa[n] ? 1 : s.tr[n] ? 3 : 2) + (s.h[n] !== s.h[cur] ? 1 : 0);
        if (nc < (cost.has(n) ? cost.get(n) : 1e9)) { cost.set(n, nc); prev.set(n, cur); open.push([nc, n]); }
      }
    }
    return null;
  }
  const around = (s, b) => [0, 1, 2, 3].map((d) => [b.x + DX[d], b.y + DY[d]]).filter(([x, y]) => inb(x, y) && walk(s, idx(x, y)) && Math.abs(s.h[idx(x, y)] - s.h[idx(b.x, b.y)]) <= 1).map(([x, y]) => idx(x, y));
  const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  // сирі запити: хто що хоче отримати
  function requests(s, rsv) {
    const o = [];
    for (const id in s.b) {
      const b = s.b[id], d = B[b.k];
      if (d.in) for (const r in d.in) { const want = IN_CAP - (b.inp[r] || 0) - (rsv[b.id + r] || 0); if (want > 0) o.push({ b, r }); }
      if (d.sells) for (const r of d.sells) { const want = MK_CAP - (b.mk[r] || 0) - (rsv[b.id + r] || 0); if (want > 0) o.push({ b, r }); }
    }
    return o;
  }
  function stores(s) { return Object.values(s.b).filter((b) => B[b.k].stor); }
  function plan(s, cr) {
    const rsv = s._rsv, reqs = requests(s, rsv), st = stores(s), home = st[0];
    const here = { x: cr.i % W, y: Math.floor(cr.i / W) }, cand = [];
    // 1) виробництво без стрічок → кому треба, або на склад
    for (const id in s.b) {
      const b = s.b[id]; if (!b.out.length || b.out.length <= (rsv['o' + b.id] || 0) || outConvs(s, b).length) continue;
      const r = b.out[0], to = reqs.filter((q) => q.r === r && q.b !== b).sort((p, q) => dist(p.b, b) - dist(q.b, b))[0] || (home && accepts(s, home, r) ? { b: st.slice().sort((p, q) => dist(p, b) - dist(q, b))[0], r } : null);
      if (to) cand.push({ from: b, to: to.b, r, d: dist(here, b) + dist(b, to.b) * 0.5 });
    }
    // 2) зі складу → кому треба (лише якщо з виробництва нема чого везти цьому запиту)
    for (const q of reqs) {
      if ((s.st[q.r] || 0) - (rsv['s' + q.r] || 0) <= 0 || cand.some((c) => c.to === q.b && c.r === q.r)) continue;
      const from = st.slice().sort((p, o) => dist(p, q.b) - dist(o, q.b))[0];
      cand.push({ from, to: q.b, r: q.r, st: 1, d: 5 + dist(here, from) + dist(from, q.b) * 0.5 });
    }
    cand.sort((a, b) => a.d - b.d);
    // найближче, до якого справді можна дійти
    for (const c of cand.slice(0, 6)) {
      const p1 = bfs(s, cr.i, around(s, c.from)); if (!p1) { c.from.stuck = s.t; continue; }
      const p2 = bfs(s, p1[p1.length - 1], around(s, c.to)); if (!p2) { c.to.stuck = s.t; continue; }
      return { ...c, p1, p2 };
    }
    return null;
  }
  // маршрут: носій ходить по колу — забирає r у A (з виробництва або зі складу) і несе в B
  function routePlan(s, cr, rt) {
    const a = s.b[rt.a], b = s.b[rt.b]; if (!a || !b) return null;
    let r = rt.r;
    if (B[a.k].stor) { if (!r || (s.st[r] || 0) - ((s._rsv['s' + r]) || 0) <= 0) return null; }
    else { if (!a.out.length) return null; if (r && a.out.indexOf(r) < 0) return null; r = r || a.out[0]; }
    if (!accepts(s, b, r)) return null;
    const p1 = bfs(s, cr.i, around(s, a)); if (!p1) { a.stuck = s.t; return null; }
    const p2 = bfs(s, p1[p1.length - 1], around(s, b)); if (!p2) { b.stuck = s.t; return null; }
    return { from: a, to: b, r, st: B[a.k].stor ? 1 : 0, p1, p2, rt: rt.id };
  }
  function stepCarriers(s, dt) {
    const want = staff(s).free;
    if (!s.cr) s.cr = [];
    const hall = stores(s)[0];
    while (s.cr.length < want && hall) { const a = around(s, hall); s.cr.push({ i: a[0] !== undefined ? a[0] : idx(hall.x, hall.y), f: 0, job: null }); }
    while (s.cr.length > want) { const c = s.cr.pop(); if (c.job && c.it) s.st[c.it] = (s.st[c.it] || 0) + 1; }
    // маршрути: кожному — свій носій; зайвих відв'язати
    if (!s.rt) s.rt = [];
    const live = new Set(s.rt.map((r) => r.id));
    for (const c of s.cr) if (c.rt && !live.has(c.rt)) c.rt = 0;
    for (const r of s.rt) if (!s.cr.some((c) => c.rt === r.id)) { const c = s.cr.find((q) => !q.rt && !q.job) || s.cr.find((q) => !q.rt); if (c) c.rt = r.id; }
    // броні: що вже хтось несе
    s._rsv = {};
    for (const c of s.cr) if (c.job) { const j = c.job; s._rsv[j.to.id + j.r] = (s._rsv[j.to.id + j.r] || 0) + 1; if (!c.it) s._rsv[(j.st ? 's' + j.r : 'o' + j.from.id)] = (s._rsv[(j.st ? 's' + j.r : 'o' + j.from.id)] || 0) + 1; }
    let planned = 0;
    for (const c of s.cr) {
      if (!c.job) { if (c.wait > 0) { c.wait -= dt; continue; } if (planned >= 3) continue; planned++; const rt = c.rt && s.rt.find((r) => r.id === c.rt); const j = rt ? routePlan(s, c, rt) : plan(s, c); if (!j) { c.wait = 1; continue; } c.job = j; c.path = j.p1; c.k = 0; c.f = 0; s._rsv[j.to.id + j.r] = (s._rsv[j.to.id + j.r] || 0) + 1; s._rsv[(j.st ? 's' + j.r : 'o' + j.from.id)] = (s._rsv[(j.st ? 's' + j.r : 'o' + j.from.id)] || 0) + 1; continue; }
      // крок по шляху
      const p = c.path; if (c.k < p.length - 1) {
        const nx = p[c.k + 1], sp = (s.pa[nx] ? 2.2 : s.tr[nx] ? 0.8 : 1.3) * dt;
        c.f += sp; while (c.f >= 1 && c.k < p.length - 1) { c.f -= 1; c.k++; }
        c.i = p[Math.min(c.k, p.length - 1)]; if (c.k < p.length - 1) continue;
      }
      c.f = 0;
      const j = c.job;
      if (!c.it) {   // забрати
        if (!s.b[j.from.id]) { c.job = null; continue; }
        if (j.st) { if ((s.st[j.r] || 0) > 0) { s.st[j.r]--; c.it = j.r; } else { c.job = null; continue; } }
        else { const k = j.from.out.indexOf(j.r); if (k >= 0) { j.from.out.splice(k, 1); c.it = j.r; } else { c.job = null; continue; } }
        c.path = j.p2; c.k = 0; continue;
      }
      // віддати (або на склад, якщо вже не треба)
      const to = s.b[j.to.id];
      if (to && accepts(s, to, c.it)) put(s, to, c.it); else s.st[c.it] = (s.st[c.it] || 0) + 1;
      c.it = null; c.job = null;
    }
  }

  // ---------- будівлі ----------
  function stepBuildings(s, dt) {
    const sp = speed(s);
    for (const id in s.b) {
      const b = s.b[id], d = B[b.k];
      // вихід на стрічки по черзі
      if (b.out.length) { const oc = outConvs(s, b); if (oc.length) { const k = (b.rr = ((b.rr || 0) + 1) % oc.length); const [, c] = oc[k]; if (roomAtStart(c)) c.it.push([b.out.shift(), 0]); } }
      if (d.job) {
        b.why = '';
        if (b.off) { b.why = 'off'; continue; }
        if (!b.on) { b.why = 'worker'; continue; }
        if (b.out.length >= OUT_CAP) { b.why = 'full'; continue; }
        if (d.in && b.t === 0) { for (const r in d.in) if ((b.inp[r] || 0) < d.in[r]) { b.why = r; break; } if (b.why) continue; }
        if (d.near === 'tree' && b.t === 0 && nearTree(s, b, false) < 0) { b.why = 'tree'; continue; }
        if (d.near === 'rock' && !nearRock(s, b)) { b.why = 'rock'; continue; }
        if (b.t === 0 && d.in) for (const r in d.in) b.inp[r] -= d.in[r];
        b.t += dt * sp;
        if (b.t >= d.t) { b.t = 0; if (d.near === 'tree') nearTree(s, b, true); for (let n = 0; n < d.q; n++) b.out.push(d.out); s.made += d.q; }
      }
      if (b.k === 'house') {
        // купує в найближчій крамниці раз на BUY_EVERY секунд кожен потрібний товар
        b.bt = (b.bt || 0) + dt; if (b.bt < BUY_EVERY) continue; b.bt = 0;
        for (const r of NEEDS[b.lv > 1 ? 1 : 0]) {
          const m = Object.values(s.b).find((q) => q.k === 'market' && Math.max(Math.abs(q.x - b.x), Math.abs(q.y - b.y)) <= B.market.r && (q.mk[r] || 0) > 0);
          if (m) { m.mk[r]--; b.hb[r] = s.t; s.cu += RES[r].p * (b.lv > 1 ? 2 : 1); }
        }
      }
    }
    // пні заростають
    for (const i in s.sp || {}) if (s.sp[i] <= s.t) { s.tr[i] = 1; delete s.sp[i]; }
  }
  function step(s, dt) {
    s.t += dt; s._hp = happy(s);
    stepBuildings(s, dt); stepConv(s, dt); stepCarriers(s, dt);
  }

  // ---------- дії гравця ----------
  function act(s, a) {
    const fail = (e) => ({ ok: false, err: e }), x = a.x, y = a.y, i = inb(x, y) ? idx(x, y) : -1;
    switch (a.t) {
      case 'build': {
        const d = B[a.k]; if (!d || d.nobuild) return fail('Нема');
        if (!freeTile(s, x, y)) return fail(i >= 0 && s.tr[i] ? 'Тут дерево — торкнись, щоб зрубати' : 'Тут зайнято');
        if (d.near === 'rock' && ![0, 1, 2, 3].some((k) => inb(x + DX[k], y + DY[k]) && s.rk[idx(x + DX[k], y + DY[k])])) return fail('Каменярню — впритул до скелі');
        if (!canPay(s, d.cost)) return fail('Треба ' + costTxt(d.cost));
        pay(s, d.cost); s.pa[i] = 0; const b = addB(s, a.k, x, y); return { ok: true, b };
      }
      case 'conv': {
        const d = CONV[a.k]; if (!d || i < 0) return fail('Нема');
        const c = s.cv[i];
        if (c) { if (c.k === a.k && c.d === a.d) return { ok: true }; if (c.k === a.k) { c.d = a.d; return { ok: true }; } }
        else if (!freeTile(s, x, y)) return fail('Тут зайнято');
        if (!c && !canPay(s, d.cost)) return fail('Треба ' + costTxt(d.cost));
        if (c) { pay(s, CONV[c.k].cost, 1); c.k = a.k; c.d = a.d; pay(s, d.cost); return { ok: true }; }
        pay(s, d.cost); s.cv[i] = { k: a.k, d: a.d & 3, it: [] }; return { ok: true };
      }
      case 'turn': { const c = s.cv[i]; if (!c) return fail('Нема'); c.d = (c.d + 1) % 4; return { ok: true }; }
      case 'path': { if (i < 0 || bAt(s, x, y) || s.rk[i]) return fail('Не можна'); if (s.tr[i]) return fail('Спершу зрубай дерево'); s.pa[i] = a.off ? 0 : 1; return { ok: true }; }
      case 'clear': { if (i < 0 || !s.tr[i]) return fail('Нема дерева'); s.tr[i] = 0; s.st.log = (s.st.log || 0) + 2; return { ok: true, log: 2 }; }
      case 'erase': {
        if (i < 0) return fail('Нема');
        const b = bAt(s, x, y);
        if (b) { if (b.k === 'hall') return fail('Ратушу не знести'); pay(s, B[b.k].cost, 0.5); delete s.b[b.id]; s._occ = null; if (s.rt) s.rt = s.rt.filter((r) => r.a !== b.id && r.b !== b.id); return { ok: true }; }
        if (s.cv[i]) { pay(s, CONV[s.cv[i].k].cost, 1); delete s.cv[i]; return { ok: true }; }
        if (s.pa[i]) { s.pa[i] = 0; return { ok: true }; }
        return fail('Тут нічого нема');
      }
      case 'off': { const b = s.b[a.id]; if (!b || !B[b.k].job) return fail('Нема'); b.off = b.off ? 0 : 1; return { ok: true }; }
      case 'route': {
        const A = s.b[a.a], Bb = s.b[a.b]; if (!A || !Bb || A === Bb) return fail('Обери дві різні будівлі');
        if (!B[A.k].stor && !B[A.k].out) return fail(B[A.k].n + ' нічого не виробляє');
        if (a.r && !(B[Bb.k].stor || (B[Bb.k].in && B[Bb.k].in[a.r]) || (B[Bb.k].sells && B[Bb.k].sells.indexOf(a.r) >= 0))) return fail(B[Bb.k].n + ' не бере ' + RES[a.r].n.toLowerCase());
        if (!s.rt) s.rt = []; if (!s.rtn) s.rtn = 1;
        const busy = (s.cr || []).filter((c) => c.rt).length; if (busy >= staff(s).free && !a.ci && a.ci !== 0) return fail('Нема вільного носія — збудуй хату');
        const r = { id: s.rtn++, a: A.id, b: Bb.id, r: a.r || (B[A.k].out || null) };
        s.rt.push(r);
        if (a.ci !== undefined && s.cr && s.cr[a.ci]) { const c = s.cr[a.ci]; if (c.rt) s.rt = s.rt.filter((q) => q.id !== c.rt || q === r); c.rt = r.id; if (c.job && !c.it) c.job = null; }
        return { ok: true, rt: r };
      }
      case 'unroute': { if (!s.rt) return fail('Нема'); const n = s.rt.length; s.rt = s.rt.filter((r) => r.id !== a.id); for (const c of s.cr || []) if (c.rt === a.id) c.rt = 0; return n === s.rt.length ? fail('Нема') : { ok: true }; }
      case 'up': {
        const b = s.b[a.id]; if (!b || b.k !== 'house' || b.lv > 1) return fail('Нема');
        if (!canPay(s, B.house.up)) return fail('Треба ' + costTxt(B.house.up));
        pay(s, B.house.up); b.lv = 2; return { ok: true };
      }
    }
    return fail('Невідома дія');
  }

  // для збереження: без тимчасових полів; носії з товаром віддають його на склад
  function pack(s) {
    const o = JSON.parse(JSON.stringify(s, (k, v) => (k[0] === '_' ? undefined : v)));
    for (const c of o.cr || []) if (c.it) o.st[c.it] = (o.st[c.it] || 0) + 1;
    delete o.cr; return o;
  }
  function why(s, b) {
    const w = b.why; if (!w && !(b.stuck && s.t - b.stuck < 5)) return '';
    if (b.stuck && s.t - b.stuck < 5) return 'носії не можуть підійти — залиш вільну клітинку поруч';
    if (w === 'off') return 'зупинено';
    if (w === 'worker') return 'нема вільного робітника — збудуй хату';
    if (w === 'full') return 'повно — забери або постав стрічку';
    if (w === 'tree') return 'нема дерев поруч';
    if (w === 'rock') return 'треба скеля впритул';
    return 'чекає: ' + RES[w].ic + ' ' + RES[w].n.toLowerCase();
  }

  const api = { _plan: (s, c) => plan(s, c), _bfs: (s, a, g) => bfs(s, a, g), W, H, VER, DX, DY, idx, inb, RES, B, CONV, NEEDS, create, step, act, pack, bAt, pop, staff, happy, happyOf, speed, storCap, costTxt, canPay, why, outConvs, MK_CAP, OUT_CAP, IN_CAP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MistoSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
