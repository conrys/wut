/* Повзуни — змійки на арені (у дусі slither.io): соло з ботами або кімната з друзями.
   Мережа — Firebase RTDB /povzun/{код}/{peerId} = { p: швидкий стан (JSON, ~10/с), k: тіло (JSON, раз на ~1.5 с), t }.
   Кожен телефон рахує свою змію сам (і сам вирішує, що вріcався); ботів веде хост кімнати (хто зайшов першим).
   Їжа на полі детермінована від коду кімнати: позиція = f(seed, слот, покоління); зʼїли — подія «f слот.покоління»,
   усі піднімають покоління. Хост раз на кілька секунд розсилає знімок поколінь для тих, хто зайшов пізніше. */
(function () {
  const $ = (id) => document.getElementById(id);
  const cv = $('cv'), ctx = cv.getContext('2d');
  let W = 0, H = 0, DPR = 1;
  function resize() { DPR = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight; cv.width = W * DPR; cv.height = H * DPR; }
  addEventListener('resize', resize); resize();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------- константи ----------------
  const R = 2600, SP = 7, FOOD_N = 800, SPEED = 175, BOOST = 345, MIN_MASS = 10, START_MASS = 12;
  const SKINS = [['#FF5A5F', '#FFC2C3'], ['#4CC97A', '#C3F2D3'], ['#4C8DFF', '#C2D7FF'], ['#FFC93C', '#FFF0B8'], ['#A779F2', '#E2D2FF'],
    ['#FF9A3D', '#FFDCB8'], ['#3CC8C8', '#BFF3F3'], ['#FF7BB0', '#FFD0E3'], ['#8BD14B', '#DDF3C4'], ['#E8E8F0', '#9AA0B4']];
  const BOT_NAMES = ['Шипучка', 'Ковбаска', 'Вуж Петро', 'Локшина', 'Батон', 'Мурчик', 'Каша', 'Гусінь', 'Слизень', 'Хробачок', 'Пиріжок', 'Бублик',
    'Макаронина', 'Шнурок', 'Котлета', 'Гадюка Галя', 'Полоз', 'Тістечко', 'Вермішель', 'Ковзун', 'Зміюка', 'Кабель', 'Шланг', 'Лакриця'];
  const mulberry = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
  const radiusOf = (m) => 9 + Math.min(19, Math.sqrt(Math.max(0, m - MIN_MASS)) * 0.95);
  const lenOf = (m) => Math.min(950, Math.floor(16 + m * 0.85));

  // ---------------- змії ----------------
  function makeSnake(id, name, skin, x, y, ang, mass) {
    const s = { id, name, skin, ang, ta: ang, mass, boost: false, dead: false, kills: 0, deathN: 0, pts: [], hx: x, hy: y };
    const n = lenOf(mass);
    for (let i = 0; i < n; i++) s.pts.push([x - Math.cos(ang) * SP * i, y - Math.sin(ang) * SP * i]);
    return s;
  }
  function follow(s) {
    const p = s.pts;
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1], b = p[i], dx = a[0] - b[0], dy = a[1] - b[1], d = Math.hypot(dx, dy);
      if (d > SP) { const k = (d - SP) / d; b[0] += dx * k; b[1] += dy * k; }
    }
  }
  function fitLength(s) {
    const want = lenOf(s.mass), p = s.pts;
    if (p.length > want) p.length = Math.max(4, want);
    else while (p.length < want) { const t = p[p.length - 1]; p.push([t[0], t[1]]); }
  }
  // рух власної змії/бота (не мережевої)
  function stepSnake(s, dt) {
    const r = radiusOf(s.mass), turn = Math.max(2.1, 4.2 - r * 0.07);
    const d = angDiff(s.ta, s.ang); s.ang += Math.max(-turn * dt, Math.min(turn * dt, d));
    const boosting = s.boost && s.mass > MIN_MASS + 1;
    const sp = boosting ? BOOST : SPEED;
    if (boosting) { s.mass = Math.max(MIN_MASS, s.mass - dt * (2.2 + s.mass * 0.012)); s.dropT = (s.dropT || 0) + dt; }
    const h = s.pts[0]; h[0] += Math.cos(s.ang) * sp * dt; h[1] += Math.sin(s.ang) * sp * dt;
    s.hx = h[0]; s.hy = h[1]; s.boosting = boosting;
    follow(s); fitLength(s);
  }

  // ---------------- їжа ----------------
  let seed = 1, gens = new Uint32Array(FOOD_N), field = [], deathFood = new Map();   // id → {x,y,v,c,t}
  function fieldPellet(slot, gen) {
    const r = mulberry(seed * 31 + slot * 7919 + gen * 104729), a = r() * Math.PI * 2, d = Math.sqrt(r()) * (R - 70), u = r();
    return { x: Math.cos(a) * d, y: Math.sin(a) * d, v: u < 0.06 ? 4 : u < 0.22 ? 2 : 1, c: (r() * SKINS.length) | 0, slot, gen };
  }
  function resetFood(sd) { seed = sd >>> 0; gens = new Uint32Array(FOOD_N); field = []; for (let i = 0; i < FOOD_N; i++) field.push(fieldPellet(i, 0)); deathFood.clear(); }
  const applied = new Map();   // токен події → час (щоб не застосувати двічі)
  function applyEat(tok) {
    if (applied.has(tok)) return; applied.set(tok, now);
    if (tok[0] === 'f') { const [slot, gen] = tok.slice(1).split('.').map(Number); if (slot >= 0 && slot < FOOD_N && gens[slot] === gen) { gens[slot] = gen + 1; field[slot] = fieldPellet(slot, gen + 1); } }
    else deathFood.delete(tok);
  }
  function syncGens(snap) {   // знімок від хоста: { слот: покоління }
    for (const k in snap) { const i = +k, g = snap[k] | 0; if (i >= 0 && i < FOOD_N && g > gens[i]) { gens[i] = g; field[i] = fieldPellet(i, g); } }
  }
  // смерть: тіло розсипається на їжу — однаково на всіх телефонах (позиції з тіла + детермінований розкид)
  const deathsSeen = new Set();
  function spawnDeath(sid, n, flat, value, skin) {
    const key = sid + '_' + n; if (deathsSeen.has(key)) return; deathsSeen.add(key);
    const r = mulberry(hashStr(key));
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const id = 'd' + key + '_' + (i >> 1);
      deathFood.set(id, { x: flat[i] + (r() - 0.5) * 18, y: flat[i + 1] + (r() - 0.5) * 18, v: value, c: skin, t: now });
    }
  }
  function bodyFlat(s, step) { const out = []; for (let i = 0; i < s.pts.length; i += step) out.push(Math.round(s.pts[i][0]), Math.round(s.pts[i][1])); return out; }
  function deathInfo(s) { const step = Math.max(2, Math.round(s.pts.length / 60)), flat = bodyFlat(s, step); return { n: s.deathN, p: flat, v: Math.max(1, Math.round(s.mass * 0.75 / (flat.length / 2))), c: s.skin }; }

  // ---------------- сітка для колізій ----------------
  const CELL = 80, grid = new Map();
  const ck = (x, y) => ((Math.floor(x / CELL) + 1000) * 4096 + (Math.floor(y / CELL) + 1000));
  function buildGrid(all) {
    grid.clear();
    for (const s of all) { if (s.dead) continue; const r = radiusOf(s.mass);
      for (let i = 3; i < s.pts.length; i += 2) { const p = s.pts[i], k = ck(p[0], p[1]); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(s, p, r); } }
  }
  function hitBody(x, y, rad, self) {   // повертає змію, в тіло якої влучили
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const a = grid.get((cx + i + 1000) * 4096 + (cy + j + 1000)); if (!a) continue;
      for (let q = 0; q < a.length; q += 3) { const s = a[q]; if (s === self) continue; const p = a[q + 1], rr = rad + a[q + 2];
        const dx = p[0] - x, dy = p[1] - y; if (dx * dx + dy * dy < rr * rr) return s; }
    }
    return null;
  }

  // ---------------- стан гри ----------------
  let myDeathN = 0, now = 0, state = 'menu', me = null, bots = [], remotes = new Map(), lastKiller = null, best = 0, feed = [];
  try { best = +localStorage.getItem('povzun_best') || 0; } catch (e) {}
  let myName = '', mySkin = 0;
  try { myName = localStorage.getItem('povzun_nick') || ''; mySkin = +localStorage.getItem('povzun_skin') || Math.floor(Math.random() * SKINS.length); } catch (e) {}
  const myEats = [];   // [токен, час] — розсилаємо 2 с
  function allSnakes() { const a = []; if (me && !me.dead) a.push(me); for (const b of bots) if (!b.dead) a.push(b); for (const r of remotes.values()) if (!r.dead) a.push(r); return a; }
  function safeSpot() {
    const all = allSnakes();
    for (let k = 0; k < 40; k++) { const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * (R - 500);
      const x = Math.cos(a) * d, y = Math.sin(a) * d; if (all.every((s) => Math.hypot(s.hx - x, s.hy - y) > 450)) return [x, y]; }
    return [0, 0];
  }

  // ---------------- боти ----------------
  let botSeq = 0;
  function spawnBot(state0) {
    const [x, y] = state0 ? [state0.x, state0.y] : safeSpot();
    const id = state0 ? state0.id : 'b' + (botSeq++) + '_' + Math.floor(Math.random() * 1e4);
    const name = state0 ? state0.name : BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    const b = makeSnake(id, name, state0 ? state0.skin : Math.floor(Math.random() * SKINS.length), x, y, state0 ? state0.ang : Math.random() * 6.283,
      state0 ? state0.mass : START_MASS + Math.random() * 40);
    if (state0 && state0.pts && state0.pts.length > 4) b.pts = state0.pts.map((p) => [p[0], p[1]]);
    b.bot = true; b.think = Math.random() * 0.2; b.skill = 0.6 + Math.random() * 0.4; bots.push(b); return b;
  }
  function botThink(b, dt) {
    b.think -= dt; if (b.think > 0) return; b.think = 0.1 + Math.random() * 0.08;
    const r = radiusOf(b.mass), hx = b.hx, hy = b.hy;
    // їжа: найвигідніша поруч
    let fx = null, fy = null, fs = 0;
    const scan = (p) => { const d = Math.hypot(p.x - hx, p.y - hy); if (d > 520) return; const s = p.v / (d + 60); if (s > fs) { fs = s; fx = p.x; fy = p.y; } };
    for (const p of field) scan(p); for (const p of deathFood.values()) scan(p);
    let want = fx === null ? b.ang + (Math.random() - 0.5) * 0.6 : Math.atan2(fy - hy, fx - hx);
    // полювання: менша змія попереду — підрізати
    let hunt = false;
    for (const s of allSnakes()) { if (s === b || s.mass * 1.25 > b.mass) continue; const d = Math.hypot(s.hx - hx, s.hy - hy);
      if (d < 260 && Math.random() < b.skill * 0.5) { want = Math.atan2(s.hy + Math.sin(s.ang) * 120 - hy, s.hx + Math.cos(s.ang) * 120 - hx); hunt = true; break; } }
    // небезпека: тіла й край арени по променях
    let bestA = b.ang, bestS = -1e9, danger0 = 0;
    for (let k = -5; k <= 5; k++) {
      const a = b.ang + k * 0.32; let danger = 0;
      for (const dd of [r + 25, r + 60, r + 110, r + 170]) {
        const x = hx + Math.cos(a) * dd, y = hy + Math.sin(a) * dd, w = 60 / dd;
        if (Math.hypot(x, y) > R - r - 30) danger += 5 * w;
        if (hitBody(x, y, r + 10, b)) danger += 6 * w;
      }
      if (k === 0) danger0 = danger;
      const sc = -danger * 10 * b.skill + Math.cos(angDiff(a, want)) * 1.6 - Math.abs(k) * 0.05;
      if (sc > bestS) { bestS = sc; bestA = a; }
    }
    b.ta = bestA;
    b.boost = b.mass > 30 && danger0 < 0.5 && (hunt || (fs > 0.025 && Math.random() < 0.15)) && Math.random() < 0.85;
  }

  // ---------------- поїдання й смерті (локальні змії) ----------------
  const pg = new Map(), PCELL = 120;
  function buildPelletGrid() {
    pg.clear(); const add = (key, p) => { const k = ck(p.x * CELL / PCELL, p.y * CELL / PCELL); let a = pg.get(k); if (!a) pg.set(k, a = []); a.push(key, p); };
    for (const p of field) add('f' + p.slot + '.' + p.gen, p); for (const [id, p] of deathFood) add(id, p);
  }
  function eatAround(s, out) {
    const r = radiusOf(s.mass) + 16, x = s.hx * CELL / PCELL, y = s.hy * CELL / PCELL, cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const a = pg.get((cx + i + 1000) * 4096 + (cy + j + 1000)); if (!a) continue;
      for (let q = 0; q < a.length; q += 2) { const tok = a[q], p = a[q + 1]; if (applied.has(tok)) continue;
        if (Math.hypot(p.x - s.hx, p.y - s.hy) < r + p.v * 1.5) { s.mass += p.v * (tok[0] === 'f' ? 1 : 0.9); applyEat(tok); out.push([tok, now]); if (s === me) eatPop(); } }
    }
  }
  function die(s, killer) {
    if (s.dead) return; s.dead = true; s.deathN++; if (s === me) myDeathN = s.deathN;
    const info = deathInfo(s); spawnDeath(s.bot ? 'bot:' + s.id : s.id, info.n, info.p, info.v, info.c);   // той самий ключ, що й у мережі
    if (killer) { killer.kills = (killer.kills || 0) + (killer.bot || killer === me ? 1 : 0); }
    pushFeed(killer ? `${killer.name} зʼїв ${s.name}` : `${s.name} врізався в край`);
    if (s === me) { me.deathInfo = info; me.deathAt = now; me.killedBy = killer ? killer.id : null; lastKiller = killer; onMyDeath(killer); }
    else if (s.bot) { s.deathInfoOut = info; s.deathAt = now; botDeaths.push({ id: s.id, ...info, at: now, by: killer ? killer.id : null, name: s.name }); }
  }
  const botDeaths = [];

  // ---------------- мережа ----------------
  const NET = { on: false, code: '', id: null, host: false, room: null, meRef: null, peers: new Map(), joinTs: 0, lastP: 0, lastK: 0, lastG: 0, hostWas: false };
  function netAvailable() { return !!(window.firebase && firebase.database && firebase.auth && window.firebaseReady !== false); }
  function signedIn() {
    return new Promise((resolve) => { const auth = firebase.auth(), done = setTimeout(() => resolve(false), 8000);
      const off = auth.onAuthStateChanged((u) => { off(); if (u) { clearTimeout(done); resolve(true); return; }
        auth.signInAnonymously().then(() => { clearTimeout(done); resolve(true); }, () => { clearTimeout(done); resolve(false); }); }); });
  }
  async function netJoin(code) {
    if (!(await signedIn())) throw new Error('auth');
    const db = firebase.database(), room = db.ref('povzun/' + code);
    const before = (await room.once('value')).val() || {};
    const fresh = Object.values(before).filter((v) => v && typeof v.p === 'string' && Date.now() - (v.t || 0) < 30000).length;
    if (fresh >= 10) throw new Error('full');
    NET.id = db.ref().push().key; NET.meRef = room.child(NET.id); NET.room = room; NET.code = code; NET.joinTs = Date.now(); NET.on = true; NET.peers.clear();
    NET.meRef.onDisconnect().remove();
    const upd = (snap) => { if (snap.key === NET.id) return; const v = snap.val() || {}; let P = null, K = null;
      try { P = typeof v.p === 'string' ? JSON.parse(v.p) : null; } catch (e) {} try { K = typeof v.k === 'string' ? JSON.parse(v.k) : null; } catch (e) {}
      const old = NET.peers.get(snap.key) || {}; NET.peers.set(snap.key, { P: P || old.P, K: K || old.K, kAt: K && v.k !== old.kRaw ? now : old.kAt, kRaw: v.k, at: now }); onPeer(snap.key); };
    room.on('child_added', upd); room.on('child_changed', upd);
    room.on('child_removed', (snap) => { NET.peers.delete(snap.key); const r = remotes.get(snap.key); if (r) remotes.delete(snap.key); });
    seed = hashStr('povzun:' + code); resetFood(seed);
  }
  function netLeave() {
    if (!NET.on) return; NET.on = false; try { NET.room.off(); NET.meRef.onDisconnect().cancel(); NET.meRef.remove(); } catch (e) {}
    NET.peers.clear(); remotes.clear(); NET.host = false;
  }
  function hostIdNow() {
    let bid = NET.id, bts = NET.joinTs;
    for (const [id, p] of NET.peers) { if (!p.P || !p.P.j) continue; if (p.P.j < bts || (p.P.j === bts && id < bid)) { bid = id; bts = p.P.j; } }
    return bid;
  }
  // дані від інших
  const credited = new Set();
  function onPeer(id) {
    const p = NET.peers.get(id); if (!p || !p.P) return; const P = p.P;
    (P.e || []).forEach(applyEat);
    if (P.X) spawnDeath(id, P.X.n, P.X.p, P.X.v, P.X.c);
    if (P.X && P.X.by === NET.id && me && !me.dead && !p.creditedN?.[P.X.n]) { p.creditedN = Object.assign(p.creditedN || {}, { [P.X.n]: 1 }); me.kills++; }
    (P.BD || []).forEach((d) => { spawnDeath(d.id, d.n, d.p, d.v, d.c); if (d.by === NET.id && me && !me.dead && !credited.has(d.id + '_' + d.n)) { credited.add(d.id + '_' + d.n); me.kills++; pushFeed('Ти зʼїв ' + d.name); } });
    if (P.G) syncGens(P.G);
  }
  // мережеві змії: голова тягнеться до отриманої позиції, тіло — ланцюгом, раз на ~1.5 с звіряємо з тілом із k
  function upsertRemote(key, name, skin, x, y, a, m, boost, alive, bodyFlatArr, bodyAt) {
    let r = remotes.get(key);
    if (!alive) { if (r) r.dead = true; return; }
    if (!r || r.dead) { r = makeSnake(key, name, skin, x, y, a, m); r.remote = true; remotes.set(key, r); if (bodyFlatArr) setBody(r, bodyFlatArr); r.bodyAt = bodyAt; }
    r.name = name; r.skin = skin; r.tx = x; r.ty = y; r.ang = a; r.mass = m; r.boosting = !!boost; r.seen = now;
    if (bodyFlatArr && bodyAt && bodyAt !== r.bodyAt) { r.bodyAt = bodyAt; const t = r.pts[r.pts.length - 1], bx = bodyFlatArr[bodyFlatArr.length - 2], by = bodyFlatArr[bodyFlatArr.length - 1];
      if (Math.hypot(t[0] - bx, t[1] - by) > SP * 6) setBody(r, bodyFlatArr); }
  }
  function setBody(s, flat) {   // тіло з рідких точок → ланцюг із кроком SP
    const pts = [];
    for (let i = 0; i + 3 < flat.length; i += 2) { const ax = flat[i], ay = flat[i + 1], bx = flat[i + 2], by = flat[i + 3], d = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(d / SP));
      for (let k = 0; k < n; k++) pts.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]); }
    if (pts.length > 3) { s.pts = pts; fitLength(s); s.hx = s.pts[0][0]; s.hy = s.pts[0][1]; }
  }
  function stepRemote(r, dt) {
    if (r.tx === undefined) return;
    const h = r.pts[0], sp = (r.boosting ? BOOST : SPEED);
    // передбачаємо рух уперед, щоб не відставати на півсекунди
    const age = Math.min(0.25, now - (r.seen || now)), px = r.tx + Math.cos(r.ang) * sp * age, py = r.ty + Math.sin(r.ang) * sp * age;
    if (Math.hypot(px - h[0], py - h[1]) > 400) { h[0] = px; h[1] = py; } else { const k = Math.min(1, dt * 12); h[0] += (px - h[0]) * k; h[1] += (py - h[1]) * k; }
    r.hx = h[0]; r.hy = h[1]; follow(r); fitLength(r);
    if (now - (r.seen || 0) > 6) r.dead = true;   // зник без прощання
  }
  function netPull() {
    const hid = hostIdNow(), iHost = hid === NET.id;
    if (iHost && !NET.host) becomeHost(); else if (!iHost && NET.host) loseHost();
    NET.host = iHost;
    for (const [id, p] of NET.peers) {
      const P = p.P; if (!P) continue;
      upsertRemote(id, String(P.n || 'Гравець').slice(0, 14), (P.s | 0) % SKINS.length, P.x, P.y, P.a, P.m, P.b, P.l === 1, p.K && p.K.me, p.kAt);
      if (id === hid && !iHost) {   // боти від хоста
        const alive = new Set();
        (P.B || []).forEach((q) => { const key = 'bot:' + q[0]; alive.add(key); const body = p.K && p.K.bots && p.K.bots[q[0]];
          upsertRemote(key, q[6], q[5] | 0, q[1], q[2], q[3], q[4], q[7], true, body, p.kAt); const rr = remotes.get(key); if (rr) rr.bot = true; });
        for (const [k2, r] of remotes) if (k2.startsWith('bot:') && !alive.has(k2)) r.dead = true;
      }
    }
    for (const [k2, r] of remotes) if (k2.startsWith('bot:') && iHost) remotes.delete(k2);
  }
  function becomeHost() {   // підхоплюємо ботів попереднього хоста з їхніми тілами
    const inherited = [...remotes.entries()].filter(([k, r]) => k.startsWith('bot:') && !r.dead);
    bots = inherited.map(([k, r]) => spawnBotFrom(k.slice(4), r)).filter(Boolean);
    for (const [k] of inherited) remotes.delete(k);
    if (state !== 'menu') fillBots();
  }
  function spawnBotFrom(id, r) { bots = bots || []; const b = spawnBot({ id, name: r.name, skin: r.skin, x: r.hx, y: r.hy, ang: r.ang, mass: r.mass, pts: r.pts }); bots.pop(); return b; }
  function loseHost() { bots = []; }
  function botTarget() { const humans = 1 + [...NET.peers.values()].filter((p) => p.P && p.P.l !== undefined).length; return NET.on ? Math.max(5, 16 - humans * 2) : 16; }
  function fillBots() { while (bots.filter((b) => !b.dead).length < botTarget()) spawnBot(); }
  function netPush() {
    if (!NET.on) return;
    while (myEats.length && now - myEats[0][1] > 2) myEats.shift();
    const t = performance.now(), dueP = t - NET.lastP >= 100, dueK = t - NET.lastK >= 1500;
    if (!dueP && !dueK) return;
    const P = { n: myName || 'Гравець', s: mySkin, j: NET.joinTs, l: me && !me.dead ? 1 : 0, kl: me ? me.kills : 0 };
    if (me && !me.dead) Object.assign(P, { x: Math.round(me.hx), y: Math.round(me.hy), a: +me.ang.toFixed(2), m: Math.round(me.mass), b: me.boosting ? 1 : 0 });
    if (me && me.dead && me.deathInfo && now - me.deathAt < 4) P.X = Object.assign({ by: me.killedBy }, me.deathInfo);
    P.e = myEats.map((e) => e[0]);
    if (NET.host) {
      P.B = bots.filter((b) => !b.dead).map((b) => [b.id, Math.round(b.hx), Math.round(b.hy), +b.ang.toFixed(2), Math.round(b.mass), b.skin, b.name, b.boosting ? 1 : 0]);
      while (botDeaths.length && now - botDeaths[0].at > 4) botDeaths.shift();
      P.BD = botDeaths.map((d) => ({ id: 'bot:' + d.id, n: d.n, p: d.p, v: d.v, c: d.c, by: d.by, name: d.name }));
      if (now - NET.lastG > 4) { NET.lastG = now; const g = {}; for (let i = 0; i < FOOD_N; i++) if (gens[i]) g[i] = gens[i]; P.G = g; }
    }
    if (dueP) { NET.lastP = t; NET.meRef.update({ p: JSON.stringify(P), t: firebase.database.ServerValue.TIMESTAMP }).catch(() => {}); }
    if (dueK) { NET.lastK = t; const K = {};
      if (me && !me.dead) K.me = bodyFlat(me, 4);
      if (NET.host) { K.bots = {}; for (const b of bots) if (!b.dead) K.bots[b.id] = bodyFlat(b, 5); }
      NET.meRef.update({ k: JSON.stringify(K) }).catch(() => {}); }
  }

  // ---------------- керування ----------------
  let pointerAng = null, boostHeld = false, touches = new Map(), keyTurn = 0;
  cv.addEventListener('pointerdown', (e) => { touches.set(e.pointerId, e); if (e.pointerType === 'mouse') { if (e.button === 0) boostHeld = true; } else if (touches.size >= 2) boostHeld = true; aim(e); });
  cv.addEventListener('pointermove', (e) => { if (touches.has(e.pointerId) && e.pointerType !== 'mouse' && touches.size >= 2 && [...touches.keys()][0] !== e.pointerId) return; aim(e); if (touches.has(e.pointerId)) touches.set(e.pointerId, e); });
  const up = (e) => { touches.delete(e.pointerId); if (e.pointerType === 'mouse' || touches.size < 2) boostHeld = false; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  function aim(e) { pointerAng = Math.atan2(e.clientY - H / 2, e.clientX - W / 2); }
  const bb = $('boostBtn');
  bb.addEventListener('pointerdown', (e) => { e.preventDefault(); boostHeld = true; bb.classList.add('on'); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((n) => bb.addEventListener(n, () => { boostHeld = false; bb.classList.remove('on'); }));
  const keys = {};
  addEventListener('keydown', (e) => { keys[e.key] = true; if (e.key === ' ') boostHeld = true; });
  addEventListener('keyup', (e) => { keys[e.key] = false; if (e.key === ' ') boostHeld = false; });

  // ---------------- цикл ----------------
  let last = performance.now(), camX = 0, camY = 0, zoom = 1, uiT = 0;
  function tick(t) {
    const dt = Math.min(0.05, (t - last) / 1000); last = t; now += dt;
    if (state !== 'menu') update(dt);
    draw();
    requestAnimationFrame(tick);
  }
  function update(dt) {
    if (NET.on) netPull();
    const solo = !NET.on, runBots = solo || NET.host;
    // я
    if (me && !me.dead) {
      if (keys.ArrowLeft || keys.a) me.ta = me.ang - 1; else if (keys.ArrowRight || keys.d) me.ta = me.ang + 1; else if (pointerAng !== null) me.ta = pointerAng;
      me.boost = boostHeld; stepSnake(me, dt);
    }
    if (runBots) { for (const b of bots) if (!b.dead) { botThink(b, dt); stepSnake(b, dt); } }
    for (const r of remotes.values()) if (!r.dead) stepRemote(r, dt);
    const all = allSnakes(); buildGrid(all); buildPelletGrid();
    // колізії: свою змію перевіряю я, ботів — хост
    const check = (s) => { const r = radiusOf(s.mass);
      if (Math.hypot(s.hx, s.hy) > R - r) return die(s, null);
      const hit = hitBody(s.hx, s.hy, r * 0.62, s); if (hit) die(s, hit); };
    if (me && !me.dead) { check(me); if (!me.dead) eatAround(me, myEats); }
    if (runBots) for (const b of bots) if (!b.dead) { check(b); if (!b.dead) eatAround(b, myEats); }
    if (runBots) { bots = bots.filter((b) => !b.dead || now - b.deathAt < 0.1); if (Math.floor(now * 2) !== Math.floor((now - dt) * 2)) fillBots(); }
    for (const [k, r] of remotes) if (r.dead && now - (r.seen || 0) > 1 && (k.startsWith('bot:') || !NET.peers.has(k))) remotes.delete(k);   // загиблих ботів і тих, хто вийшов, прибираємо
    // їжа смерті зникає за 40 с
    for (const [id, p] of deathFood) if (now - p.t > 40) deathFood.delete(id);
    for (const [k, t0] of applied) if (now - t0 > 30) applied.delete(k);
    if (NET.on) netPush();
    // камера
    const target = me && !me.dead ? me : leader();
    if (target) { camX += (target.hx - camX) * Math.min(1, dt * 6); camY += (target.hy - camY) * Math.min(1, dt * 6); }
    const r = me ? radiusOf(me.mass) : 10;
    const wantZoom = Math.min(W, H) / 820 * Math.max(0.55, 1.12 - (r - 9) * 0.022);
    zoom += (wantZoom - zoom) * Math.min(1, dt * 2);
    uiT -= dt; if (uiT <= 0) { uiT = 0.4; renderHud(); }
    if (me && !me.dead && Math.round(me.mass) > best) { best = Math.round(me.mass); }
  }
  function leader() { let b = null; for (const s of allSnakes()) if (!b || s.mass > b.mass) b = s; return b; }

  // ---------------- малювання ----------------
  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#10131F'; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(zoom, zoom); ctx.translate(-camX, -camY);
    const vw = W / 2 / zoom + 60, vh = H / 2 / zoom + 60, x0 = camX - vw, x1 = camX + vw, y0 = camY - vh, y1 = camY + vh;
    // арена
    ctx.fillStyle = '#171B2C'; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.045)';
    const g = 56; for (let x = Math.floor(x0 / g) * g; x < x1; x += g) for (let y = Math.floor(y0 / g) * g; y < y1; y += g) { const ox = (Math.floor(y / g) & 1) * g / 2; if ((x + ox) * (x + ox) + y * y < R * R) ctx.fillRect(x + ox - 2, y - 2, 4, 4); }
    ctx.strokeStyle = 'rgba(255,80,96,.55)'; ctx.lineWidth = 14; ctx.beginPath(); ctx.arc(0, 0, R + 7, 0, Math.PI * 2); ctx.stroke();
    // їжа
    const pulse = reduce ? 1 : 1 + Math.sin(now * 5) * 0.12;
    const dot = (p) => { if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) return; const rr = (3 + p.v * 1.6) * pulse;
      ctx.fillStyle = SKINS[p.c % SKINS.length][1]; ctx.globalAlpha = 0.28; ctx.beginPath(); ctx.arc(p.x, p.y, rr * 2.1, 0, 6.283); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = SKINS[p.c % SKINS.length][0]; ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, 6.283); ctx.fill(); };
    for (const p of field) if (!applied.has('f' + p.slot + '.' + p.gen)) dot(p);
    for (const p of deathFood.values()) dot(p);
    // змії: більші зверху
    const all = allSnakes().sort((a, b) => a.mass - b.mass);
    for (const s of all) drawSnake(s, x0, x1, y0, y1);
    ctx.restore();
    // фід
    ctx.font = '700 13px "Baloo 2",system-ui,sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    feed = feed.filter((f) => now - f.t < 5); feed.forEach((f, i) => { ctx.globalAlpha = Math.min(1, 5 - (now - f.t)); ctx.fillStyle = 'rgba(0,0,0,.45)';
      const w = ctx.measureText(f.text).width + 14; ctx.fillRect(12, 56 + i * 22, w, 20); ctx.fillStyle = '#fff'; ctx.fillText(f.text, 19, 59 + i * 22); }); ctx.globalAlpha = 1;
  }
  function drawSnake(s, x0, x1, y0, y1) {
    const p = s.pts, r = radiusOf(s.mass), sk = SKINS[s.skin % SKINS.length];
    let vis = false; for (let i = 0; i < p.length; i += 6) { const q = p[i]; if (q[0] > x0 - r && q[0] < x1 + r && q[1] > y0 - r && q[1] < y1 + r) { vis = true; break; } }
    if (!vis) return;
    const path = () => { ctx.beginPath(); ctx.moveTo(p[p.length - 1][0], p[p.length - 1][1]); for (let i = p.length - 2; i >= 0; i--) ctx.lineTo(p[i][0], p[i][1]); };
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (s.boosting) { ctx.globalAlpha = 0.25; ctx.strokeStyle = sk[1]; ctx.lineWidth = r * 2 + 16; path(); ctx.stroke(); ctx.globalAlpha = 1; }
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = r * 2 + 4; path(); ctx.stroke();
    ctx.strokeStyle = sk[0]; ctx.lineWidth = r * 2; path(); ctx.stroke();
    ctx.setLineDash([SP * 1.6, SP * 2.4]); ctx.strokeStyle = sk[1]; ctx.globalAlpha = 0.55; ctx.lineWidth = r * 1.3; path(); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    // голова
    const h = p[0], a = s.ang, ex = Math.cos(a), ey = Math.sin(a);
    ctx.fillStyle = sk[0]; ctx.beginPath(); ctx.arc(h[0], h[1], r * 1.08, 0, 6.283); ctx.fill();
    for (const side of [-1, 1]) { const bx = h[0] + ex * r * 0.35 - ey * side * r * 0.48, by = h[1] + ey * r * 0.35 + ex * side * r * 0.48;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(bx, by, r * 0.42, 0, 6.283); ctx.fill();
      const la = s === me && pointerAng !== null ? pointerAng : s.ta !== undefined ? s.ta : a;
      ctx.fillStyle = '#141420'; ctx.beginPath(); ctx.arc(bx + Math.cos(la) * r * 0.16, by + Math.sin(la) * r * 0.16, r * 0.22, 0, 6.283); ctx.fill(); }
    if (s !== me) { ctx.font = '800 ' + Math.max(12, r * 0.9) + 'px "Baloo 2",system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillText(s.name, h[0], h[1] - r * 1.5); }
  }

  // ---------------- HUD ----------------
  const mm = $('mini'), mctx = mm.getContext('2d');
  function renderHud() {
    const all = allSnakes().sort((a, b) => b.mass - a.mass);
    const rank = me && !me.dead ? all.indexOf(me) + 1 : 0;
    $('board').innerHTML = all.slice(0, 8).map((s, i) => `<li class="${s === me ? 'me' : ''}"><b>${i + 1}</b><span>${esc(s.name)}</span><i>${Math.round(s.mass)}</i></li>`).join('')
      + (rank > 8 ? `<li class="me"><b>${rank}</b><span>${esc(me.name)}</span><i>${Math.round(me.mass)}</i></li>` : '');
    $('len').textContent = me && !me.dead ? Math.round(me.mass) : '—';
    $('kills').textContent = me ? me.kills : 0;
    // мінікарта
    const S = mm.width, k = S / 2 / R; mctx.clearRect(0, 0, S, S);
    mctx.fillStyle = 'rgba(255,255,255,.08)'; mctx.beginPath(); mctx.arc(S / 2, S / 2, S / 2 - 1, 0, 6.283); mctx.fill();
    for (const s of all) { mctx.fillStyle = s === me ? '#fff' : SKINS[s.skin % SKINS.length][0]; const rr = s === me ? 4 : 1.5 + Math.min(3, s.mass / 150);
      mctx.beginPath(); mctx.arc(S / 2 + s.hx * k, S / 2 + s.hy * k, rr, 0, 6.283); mctx.fill(); }
  }
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function pushFeed(text) { feed.push({ text, t: now }); if (feed.length > 4) feed.shift(); }
  let eatSnd = 0;
  function eatPop() { const t = performance.now(); if (t - eatSnd < 70) return; eatSnd = t; tone(520 + Math.random() * 240, 0.05, 0.035); }
  let AC = null, muted = false; try { muted = localStorage.getItem('povzun_mute') === '1'; } catch (e) {}
  function tone(f, d, vol, slide) { if (muted) return; try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume();
    const o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime; o.type = 'sine'; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(f * slide, t + d);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g).connect(AC.destination); o.start(t); o.stop(t + d + 0.02); } catch (e) {} }
  $('mute').addEventListener('click', () => { muted = !muted; $('mute').textContent = muted ? '🔇' : '🔊'; try { localStorage.setItem('povzun_mute', muted ? '1' : '0'); } catch (e) {} });
  $('mute').textContent = muted ? '🔇' : '🔊';

  // ---------------- меню / смерть ----------------
  function onMyDeath(killer) {
    tone(300, 0.4, 0.12, 0.4);
    try { navigator.vibrate && navigator.vibrate([40, 40, 80]); } catch (e) {}
    const mass = Math.round(me.mass);
    try { if (mass > (+localStorage.getItem('povzun_best') || 0)) localStorage.setItem('povzun_best', String(mass)); } catch (e) {}
    setTimeout(() => {
      $('deadTitle').textContent = killer ? `Тебе зʼїв ${killer.name}` : 'Ти врізався в край арени';
      $('deadStats').textContent = `Довжина ${mass} · зʼїдено змій: ${me.kills} · рекорд ${Math.max(best, mass)}`;
      $('dead').hidden = false; state = 'dead';
    }, 900);
  }
  function startPlay() {
    const [x, y] = safeSpot();
    const kills = 0;
    me = makeSnake(NET.on ? NET.id : 'me', myName || 'Ти', mySkin, x, y, Math.random() * 6.283, START_MASS); me.kills = kills; me.deathN = myDeathN;   // номер смерті росте між життями
    camX = x; camY = y; state = 'play'; $('menu').hidden = true; $('dead').hidden = true; $('hud').hidden = false;
    if (NET.on && !NET.host) bots = [];   // ботів веде хост — у мене лише його копії
    if (!NET.on || NET.host) fillBots();
    tone(660, 0.12, 0.08); tone(990, 0.2, 0.08);
  }
  function startSolo() {
    netLeave(); bots = []; remotes.clear(); resetFood(Math.floor(Math.random() * 1e9)); $('roomChip').hidden = true; startPlay();
  }
  async function enterRoom(code) {
    $('mpErr').textContent = ''; $('mpBusy').hidden = false;
    try {
      state = 'joining'; bots = []; remotes.clear(); await netJoin(code);
      location.hash = code; $('roomChip').hidden = false; $('roomCode').textContent = code.toUpperCase();
      // невелика пауза, щоб побачити, хто вже в кімнаті (хост, боти, знімок їжі)
      await new Promise((r) => setTimeout(r, 900)); netPull(); startPlay();
    } catch (e) {
      netLeave(); state = 'menu';
      $('mpErr').textContent = e && e.message === 'full' ? 'Кімната повна (10 гравців)' : e && e.message === 'auth' ? 'Немає звʼязку з сервером — грай з ботами' : 'Не вдалося зайти. Перевір інтернет.';
    } finally { $('mpBusy').hidden = true; }
  }
  const rcode = () => Array.from({ length: 4 }, () => 'abcdefghjkmnpqrstuvwxyz'[Math.floor(Math.random() * 23)]).join('');
  function saveProfile() { myName = ($('nick').value || '').trim().slice(0, 14); try { localStorage.setItem('povzun_nick', myName); localStorage.setItem('povzun_skin', String(mySkin)); } catch (e) {} }
  function renderSkins() { $('skins').innerHTML = SKINS.map((s, i) => `<button class="sk ${i === mySkin ? 'on' : ''}" data-i="${i}" style="background:linear-gradient(90deg,${s[0]} 0 50%,${s[1]} 50% 100%)" aria-label="Колір ${i + 1}"></button>`).join('');
    $('skins').querySelectorAll('.sk').forEach((b) => b.onclick = () => { mySkin = +b.dataset.i; renderSkins(); }); }
  $('nick').value = myName; renderSkins();
  $('soloBtn').onclick = () => { saveProfile(); startSolo(); };
  $('createBtn').onclick = () => { saveProfile(); if (!netAvailable()) { $('mpErr').textContent = 'Онлайн недоступний — грай з ботами'; return; } enterRoom(rcode()); };
  $('joinBtn').onclick = () => { saveProfile(); const c = ($('codeIn').value || '').trim().toLowerCase(); if (!/^[a-z]{4}$/.test(c)) { $('mpErr').textContent = 'Код — 4 латинські літери'; return; } enterRoom(c); };
  $('codeIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });
  $('againBtn').onclick = () => { $('dead').hidden = true; startPlay(); };
  $('menuBtn').onclick = () => { netLeave(); state = 'menu'; me = null; bots = []; $('dead').hidden = true; $('hud').hidden = true; $('menu').hidden = false; location.hash = ''; };
  $('shareBtn').onclick = async () => { const url = location.href.split('#')[0] + '#' + NET.code;
    try { if (navigator.share) await navigator.share({ title: 'Повзуни', text: 'Заходь у кімнату ' + NET.code.toUpperCase(), url }); else { await navigator.clipboard.writeText(url); $('shareBtn').textContent = 'Скопійовано'; setTimeout(() => $('shareBtn').textContent = 'Запросити', 1500); } } catch (e) {} };
  if (!netAvailable()) { $('createBtn').disabled = true; $('joinBtn').disabled = true; $('mpErr').textContent = 'Онлайн недоступний — грай з ботами'; }
  const h0 = (location.hash || '').replace('#', '').toLowerCase(); if (/^[a-z]{4}$/.test(h0)) $('codeIn').value = h0.toUpperCase();
  addEventListener('beforeunload', () => netLeave());

  // фон меню: боти повзають позаду
  resetFood(12345); for (let i = 0; i < 10; i++) spawnBot();
  (function menuLoop() { if (state === 'menu' && !NET.on) { for (const b of bots) if (!b.dead) { botThink(b, 1 / 60); stepSnake(b, 1 / 60); } const l = leader(); if (l) { camX += (l.hx - camX) * 0.02; camY += (l.hy - camY) * 0.02; } zoom = Math.min(W, H) / 1000; buildGrid(allSnakes()); buildPelletGrid(); for (const b of bots) if (!b.dead) eatAround(b, []); bots = bots.filter((b) => !b.dead); while (bots.length < 10) spawnBot(); } setTimeout(menuLoop, 16); })();
  requestAnimationFrame(tick);

  window.Povzun = { get me() { return me; }, get bots() { return bots; }, get remotes() { return remotes; }, get NET() { return NET; }, get state() { return state; },
    get field() { return field; }, get gens() { return gens; }, get deathFood() { return deathFood; }, die: (s) => die(s, null) };   // для тестів
})();
