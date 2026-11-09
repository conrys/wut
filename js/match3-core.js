// ==========================================================================
// «Три в ряд» — чиста логіка без DOM. Кожна дія гравця змінює стан G і
// повертає список подій (swap / clear / fall / ...), які match3-game.js
// програє як анімацію. Той самий файл ганяє бот балансу в Node.
// ==========================================================================
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Match3Core = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const N = 8;
  const DIFF = {
    easy: { colors: 5, mul: 1, boosters: { hammer: 2, shuffle: 2, plus: 2 }, hint: 5000, moves: 25 },
    hard: { colors: 6, mul: 1.5, boosters: { hammer: 1, shuffle: 1, plus: 1 }, hint: 15000, moves: 22 },
  };
  // Вага одного ходу в балах цілі. Підібрано ботом: перші рівні майже завжди
  // проходяться, далі ціль росте сповільнено, щоб забіг не впирався в стіну.
  const TUNE = {
    easy: { ppm0: 110, ppmGrow: 3.2, ppmPow: 1.05, collect0: 20, collectGrow: 0.7, ice0: 10, iceGrow: 0.55, crate0: 8, crateGrow: 0.42, fuseFrom: 14, fuseEvery: 18 },
    hard: { ppm0: 75, ppmGrow: 2.8, ppmPow: 1.05, collect0: 13, collectGrow: 0.55, ice0: 6, iceGrow: 0.35, crate0: 4, crateGrow: 0.34, fuseFrom: 8, fuseEvery: 9 },
  };
  const CHEST_EVERY = 5;
  const FUSE_PENALTY = 3;
  const PERK_CAPS = { moves: 3, line: 3, bomb: 2, greed: 4 };
  const CHEST_POOL = [
    { key: 'hammer', title: 'Два молоти', text: 'Розбивають будь-яку клітинку' },
    { key: 'shuffle', title: 'Два перемішування', text: 'Нова розкладка без витрати ходу' },
    { key: 'plus', title: 'Запас ходів', text: 'Два набори +5 ходів' },
    { key: 'moves', title: 'Довгий подих', text: '+1 хід на кожному рівні', perk: 1 },
    { key: 'line', title: 'Смуга на старт', text: 'Кожен рівень починається зі смугою', perk: 1 },
    { key: 'bomb', title: 'Бомба на старт', text: 'Кожен рівень починається з бомбою', perk: 1 },
    { key: 'greed', title: 'Щедрість', text: '+15% балів до кінця забігу', perk: 1 },
  ];

  // Монети живуть лише в межах забігу, тож рекорди лишаються порівнянними.
  const SHOP = [
    { key: 'plus', title: '+5 ходів', text: 'Набір запасних ходів', price: 40, step: 20 },
    { key: 'hammer', title: 'Молот', text: 'Розбиває будь-яку клітинку', price: 25, step: 10 },
    { key: 'shuffle', title: 'Перемішування', text: 'Нова розкладка без витрати ходу', price: 15, step: 5 },
  ];
  const COIN_LEVEL = 6, COIN_MOVE = 1, COIN_MOVE_CAP = 10, COIN_GOLD = 5, COIN_FUSE = 3;

  const idx = (x, y) => y * N + x;
  const X = (i) => i % N;
  const Y = (i) => (i / N) | 0;
  const adjacent = (a, b) => Math.abs(X(a) - X(b)) + Math.abs(Y(a) - Y(b)) === 1;
  const isGem = (c) => !!c && c.k === 'g';

  // детермінований RNG: стан лежить у G, тому збереження й бот відтворювані
  function rand(G) {
    G.seed = (G.seed + 0x6D2B79F5) | 0;
    let t = G.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const rint = (G, n) => Math.floor(rand(G) * n);
  function shuffled(G, arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = rint(G, i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  function newGem(G, c, extra) { return Object.assign({ id: ++G.nextId, k: 'g', c }, extra || {}); }
  function randomGem(G) {
    const gold = rand(G) < 1 / 80;
    return newGem(G, rint(G, G.colors), gold ? { gold: true } : null);
  }

  // ---------- пошук збігів ----------
  const colorAt = (G, i) => { const c = G.cells[i]; return isGem(c) && c.sp !== 'r' ? c.c : -1; };

  function findGroups(G) {
    const runs = [];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N;) {
        const c = colorAt(G, idx(x, y));
        let e = x + 1;
        if (c >= 0) while (e < N && colorAt(G, idx(e, y)) === c) e++;
        if (c >= 0 && e - x >= 3) { const cells = []; for (let k = x; k < e; k++) cells.push(idx(k, y)); runs.push({ dir: 'h', cells }); }
        x = e;
      }
    }
    for (let x = 0; x < N; x++) {
      for (let y = 0; y < N;) {
        const c = colorAt(G, idx(x, y));
        let e = y + 1;
        if (c >= 0) while (e < N && colorAt(G, idx(x, e)) === c) e++;
        if (c >= 0 && e - y >= 3) { const cells = []; for (let k = y; k < e; k++) cells.push(idx(x, k)); runs.push({ dir: 'v', cells }); }
        y = e;
      }
    }
    // злиття лише тих смуг, що перетинаються (Г- і Т-подібні збіги)
    const groups = [];
    runs.forEach((r) => {
      const hit = groups.filter((g) => r.cells.some((i) => g.cells.has(i)));
      const merged = { cells: new Set(r.cells), runs: [r] };
      hit.forEach((g) => { g.cells.forEach((i) => merged.cells.add(i)); merged.runs.push(...g.runs); groups.splice(groups.indexOf(g), 1); });
      groups.push(merged);
    });
    return groups;
  }

  function classify(g) {
    const max = Math.max(...g.runs.map((r) => r.cells.length));
    const dirs = new Set(g.runs.map((r) => r.dir));
    if (max >= 5) return 'r';
    if (dirs.size > 1) return 'b';
    if (max === 4) return g.runs[0].dir === 'h' ? 'v' : 'h';
    return null;
  }

  function originOf(g, hints) {
    if (hints) for (const h of hints) if (g.cells.has(h)) return h;
    if (g.runs.length > 1) {
      for (const i of g.runs[0].cells) if (g.runs.slice(1).some((r) => r.cells.includes(i))) return i;
    }
    const longest = g.runs.reduce((a, b) => (b.cells.length > a.cells.length ? b : a));
    return longest.cells[(longest.cells.length / 2) | 0];
  }

  function patternOf(G, cell, i) {
    const out = [], x0 = X(i), y0 = Y(i);
    if (cell.sp === 'h') for (let x = 0; x < N; x++) out.push(idx(x, y0));
    else if (cell.sp === 'v') for (let y = 0; y < N; y++) out.push(idx(x0, y));
    else if (cell.sp === 'b') {
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (Math.abs(x - x0) + Math.abs(y - y0) <= 2) out.push(idx(x, y));
    } else if (cell.sp === 'r') {
      const c = commonColor(G);
      G.cells.forEach((o, j) => { if (isGem(o) && o.c === c) out.push(j); });
    }
    return out;
  }
  function commonColor(G) {
    const n = new Array(G.colors).fill(0);
    G.cells.forEach((c) => { if (isGem(c) && c.c >= 0) n[c.c]++; });
    return n.indexOf(Math.max(...n));
  }

  // ---------- один крок очищення ----------
  function step(G, groups, seed, hints, depth) {
    const gone = new Map(), created = new Map(), inGroup = new Set(), crateHit = new Set(), fx = [], fired = new Set(), q = [];
    let raw = 0;
    const setGone = (i, d) => { if (!gone.has(i) || gone.get(i) > d) gone.set(i, d); };

    groups.forEach((g) => {
      const sp = classify(g);
      const max = Math.max(...g.runs.map((r) => r.cells.length));
      raw += sp === 'r' ? 120 : sp === 'b' ? 90 : max === 4 ? 60 : 30;
      if (sp) { const o = originOf(g, hints), c0 = G.cells[o]; created.set(o, { c: sp === 'r' ? -1 : c0.c, sp }); }
      g.cells.forEach((i) => {
        setGone(i, 0); inGroup.add(i);
        if (G.cells[i].sp) q.push([i, 0]);
        [i - N, i + N, X(i) > 0 ? i - 1 : -1, X(i) < N - 1 ? i + 1 : -1].forEach((j) => {
          if (j >= 0 && j < N * N && G.cells[j] && G.cells[j].k === 'x') crateHit.add(j);
        });
      });
    });

    function hit(j, d) {
      if (created.has(j)) return;
      const c = G.cells[j];
      if (!c) return;
      if (c.k === 'x') { crateHit.add(j); return; }
      setGone(j, d);
      if (c.sp && !fired.has(j)) q.push([j, d + 40]);
    }
    if (seed) {
      (seed.convert || []).forEach(({ i, sp }) => { G.cells[i].sp = sp; q.push([i, seed.delay ? seed.delay(i) : 0]); });
      (seed.activate || []).forEach((i) => q.push([i, 0]));
      (seed.custom || []).forEach((p) => {
        fx.push(Object.assign({ d: 0 }, p.fx));
        fired.add(p.origin);
        p.cells.forEach((j) => hit(j, (Math.abs(X(j) - X(p.origin)) + Math.abs(Y(j) - Y(p.origin))) * 22));
        setGone(p.origin, 0);
      });
    }
    while (q.length) {
      const [i, d] = q.shift();
      if (fired.has(i)) continue;
      fired.add(i);
      const cell = G.cells[i];
      if (!isGem(cell) || !cell.sp) continue;
      fx.push({ t: cell.sp, i, d });
      setGone(i, d);
      patternOf(G, cell, i).forEach((j) => hit(j, d + (Math.abs(X(j) - X(i)) + Math.abs(Y(j) - Y(i))) * 22));
    }

    const removed = [], iceEv = [], crates = [];
    let gold = false;
    gone.forEach((d, i) => {
      const c = G.cells[i];
      if (!isGem(c)) return;
      removed.push({ i, id: c.id, c: c.c, d });
      if (!inGroup.has(i)) raw += 12;
      if (c.c >= 0) G.collected[c.c] = (G.collected[c.c] || 0) + 1;
      if (c.gold) { gold = true; G.coins = (G.coins || 0) + COIN_GOLD; }
      if (c.fuse) { raw += 50; G.defused = (G.defused || 0) + 1; G.coins = (G.coins || 0) + COIN_FUSE; }
      if (G.ice[i] > 0) { G.ice[i]--; raw += 20; iceEv.push({ i, hp: G.ice[i] }); }
      G.cells[i] = null;
    });
    crateHit.forEach((i) => {
      const c = G.cells[i];
      if (!c || c.k !== 'x') return;
      c.hp--; raw += 15;
      crates.push({ i, id: c.id, hp: c.hp });
      if (c.hp <= 0) G.cells[i] = null;
    });
    const made = [];
    created.forEach((v, i) => {
      const gem = newGem(G, v.c, { sp: v.sp });
      G.cells[i] = gem;
      made.push({ i, id: gem.id, c: gem.c, sp: gem.sp });
    });

    const mul = Math.min(4, 1 + depth * 0.5) * (gold ? 2 : 1);
    const gained = Math.round(raw * mul);
    G.levelRaw += gained;
    const pts = Math.round(gained * pointsMul(G));
    G.score += pts;
    let at = -1;
    if (inGroup.size) { let sx = 0, sy = 0; inGroup.forEach((i) => { sx += X(i); sy += Y(i); }); at = { x: sx / inGroup.size, y: sy / inGroup.size }; }
    else if (fx.length && fx[0].i != null) at = { x: X(fx[0].i), y: Y(fx[0].i) };
    return { type: 'clear', removed, created: made, crates, ice: iceEv, fx, pts, raw: gained, depth, gold, at, specials: fx.length };
  }

  const pointsMul = (G) => DIFF[G.diff].mul * (1 + 0.15 * G.perks.greed);

  function gravity(G) {
    const moves = [], spawned = [];
    for (let x = 0; x < N; x++) {
      let w = N - 1;
      for (let y = N - 1; y >= 0; y--) {
        const i = idx(x, y), c = G.cells[i];
        if (!c) continue;
        if (y !== w) { G.cells[idx(x, w)] = c; G.cells[i] = null; moves.push({ id: c.id, from: i, to: idx(x, w) }); }
        w--;
      }
      let k = 0;
      for (let y = w; y >= 0; y--) {
        const c = randomGem(G);
        G.cells[idx(x, y)] = c;
        spawned.push({ id: c.id, c: c.c, gold: !!c.gold, to: idx(x, y), startY: -1 - k++ });
      }
    }
    return { type: 'fall', moves, spawned };
  }

  function resolve(G, events, opts) {
    let seed = opts && opts.seed, hints = opts && opts.hints, depth = (opts && opts.depth) || 0;
    for (let guard = 0; guard < 80; guard++) {
      const groups = findGroups(G);
      if (!groups.length && !seed) break;
      events.push(step(G, groups, seed, hints, depth));
      events.push(gravity(G));
      seed = null; hints = null; depth++;
    }
  }

  // ---------- можливі ходи ----------
  function swapCells(G, a, b) { const t = G.cells[a]; G.cells[a] = G.cells[b]; G.cells[b] = t; }
  function matchAt(G, i) {
    const c = colorAt(G, i);
    if (c < 0) return false;
    const x = X(i), y = Y(i);
    let l = x, r = x, u = y, d = y;
    while (l > 0 && colorAt(G, idx(l - 1, y)) === c) l--;
    while (r < N - 1 && colorAt(G, idx(r + 1, y)) === c) r++;
    while (u > 0 && colorAt(G, idx(x, u - 1)) === c) u--;
    while (d < N - 1 && colorAt(G, idx(x, d + 1)) === c) d++;
    return r - l >= 2 || d - u >= 2;
  }
  function validSwap(G, a, b) {
    const A = G.cells[a], B = G.cells[b];
    if (!isGem(A) || !isGem(B) || !adjacent(a, b)) return false;
    if (A.sp === 'r' || B.sp === 'r' || (A.sp && B.sp)) return true;
    swapCells(G, a, b);
    const ok = matchAt(G, a) || matchAt(G, b);
    swapCells(G, a, b);
    return ok;
  }
  function listMoves(G) {
    const out = [];
    for (let i = 0; i < N * N; i++) {
      if (X(i) < N - 1 && validSwap(G, i, i + 1)) out.push([i, i + 1]);
      if (Y(i) < N - 1 && validSwap(G, i, i + N)) out.push([i, i + N]);
    }
    return out;
  }
  function hint(G) {
    const m = listMoves(G);
    return m.length ? m[rint(G, m.length)] : null;
  }

  function reshuffle(G) {
    const spots = [], gems = [];
    G.cells.forEach((c, i) => { if (isGem(c)) { spots.push(i); gems.push(c); } });
    for (let tries = 0; tries < 200; tries++) {
      const order = shuffled(G, gems);
      spots.forEach((s, k) => { G.cells[s] = order[k]; });
      if (!findGroups(G).length && listMoves(G).length) break;
      if (tries > 120) spots.forEach((s) => { const c = G.cells[s]; if (!c.sp) c.c = rint(G, G.colors); });
    }
    const moves = [];
    G.cells.forEach((c, i) => { if (isGem(c)) moves.push({ id: c.id, to: i, c: c.c }); });
    return { type: 'shuffle', moves };
  }

  // ---------- цілі ----------
  function goalState(G) {
    return G.goals.map((g) => {
      if (g.kind === 'score') return { ...g, have: Math.min(g.need, G.levelRaw) };
      if (g.kind === 'collect') return { ...g, have: Math.min(g.need, G.collected[g.c] || 0) };
      if (g.kind === 'ice') { const left = G.ice.filter((v) => v > 0).length; return { ...g, have: g.need - left }; }
      const left = G.cells.filter((c) => c && c.k === 'x').length;
      return { ...g, have: g.need - left };
    });
  }
  const goalsDone = (G) => goalState(G).every((g) => g.have >= g.need);

  function settle(G, events) {
    if (goalsDone(G)) { G.status = 'won'; return; }
    if (G.moves <= 0) { G.status = 'lost'; return; }
    if (!listMoves(G).length) events.push({ type: 'noMoves' }, reshuffle(G));
  }

  function afterMove(G, events) {
    if (goalsDone(G)) { G.status = 'won'; return; }
    const ticked = [];
    let boom = [];
    G.cells.forEach((c, i) => {
      if (isGem(c) && c.fuse) { c.fuse--; ticked.push({ i, id: c.id, fuse: c.fuse }); if (c.fuse <= 0) boom.push(i); }
    });
    if (ticked.length) events.push({ type: 'fuse', list: ticked });
    if (boom.length) {
      const removed = boom.map((i) => ({ i, id: G.cells[i].id }));
      boom.forEach((i) => { G.cells[i] = null; });
      const lost = Math.min(G.moves, FUSE_PENALTY * boom.length);
      G.moves -= lost;
      events.push({ type: 'fuseBoom', removed, lost });
      events.push(gravity(G));
      resolve(G, events);
    }
    settle(G, events);
  }

  // ---------- дії гравця ----------
  function comboSeed(G, a, b) {
    const A = G.cells[a], B = G.cells[b];   // після обміну
    if (!A.sp && !B.sp) return null;
    if (A.sp !== 'r' && B.sp !== 'r' && (!A.sp || !B.sp)) return null;
    const line = (s) => s === 'h' || s === 'v';
    const all = (f) => { const o = []; for (let i = 0; i < N * N; i++) if (f(X(i), Y(i), i)) o.push(i); return o; };
    const x0 = X(b), y0 = Y(b);
    if (A.sp === 'r' && B.sp === 'r') {
      return { custom: [{ origin: b, cells: all(() => true), fx: { t: 'all', i: b } }, { origin: a, cells: [a], fx: { t: 'none', i: a } }] };
    }
    if (A.sp === 'r' || B.sp === 'r') {
      const rb = A.sp === 'r' ? a : b, other = rb === a ? b : a, O = G.cells[other];
      if (!O.sp) {
        const cells = [];
        G.cells.forEach((c, i) => { if (isGem(c) && c.c === O.c) cells.push(i); });
        return { custom: [{ origin: rb, cells, fx: { t: 'rays', i: rb, targets: cells } }] };
      }
      const targets = [];
      G.cells.forEach((c, i) => { if (isGem(c) && c.c === O.c && !c.sp) targets.push(i); });
      return {
        custom: [{ origin: rb, cells: [], fx: { t: 'rays', i: rb, targets } }],
        activate: [other],
        convert: targets.map((i) => ({ i, sp: O.sp === 'b' ? 'b' : rint(G, 2) ? 'h' : 'v' })),
        delay: (i) => (Math.abs(X(i) - X(rb)) + Math.abs(Y(i) - Y(rb))) * 45,
      };
    }
    if (line(A.sp) && line(B.sp)) {
      return { custom: [
        { origin: b, cells: all((x, y) => x === x0 || y === y0), fx: { t: 'cross', i: b, w: 1 } },
        { origin: a, cells: [a], fx: { t: 'none', i: a } },
      ] };
    }
    if (A.sp === 'b' && B.sp === 'b') {
      return { custom: [
        { origin: b, cells: all((x, y) => Math.max(Math.abs(x - x0), Math.abs(y - y0)) <= 3), fx: { t: 'bigBomb', i: b } },
        { origin: a, cells: [a], fx: { t: 'none', i: a } },
      ] };
    }
    return { custom: [
      { origin: b, cells: all((x, y) => Math.abs(x - x0) <= 1 || Math.abs(y - y0) <= 1), fx: { t: 'cross', i: b, w: 3 } },
      { origin: a, cells: [a], fx: { t: 'none', i: a } },
    ] };
  }

  function playSwap(G, a, b) {
    if (G.status !== 'play' || !validSwap(G, a, b)) return { ok: false, events: [] };
    swapCells(G, a, b);
    const events = [{ type: 'swap', a, b }];
    G.moves--;
    resolve(G, events, { seed: comboSeed(G, a, b), hints: [b, a] });
    afterMove(G, events);
    return { ok: true, events };
  }

  function useHammer(G, i) {
    const c = G.cells[i];
    if (G.status !== 'play' || G.boosters.hammer <= 0 || !c) return { ok: false, events: [] };
    G.boosters.hammer--;
    const events = [{ type: 'hammer', i }];
    if (c.k === 'x') {
      c.hp = 1;
      resolve(G, events, { seed: { custom: [{ origin: i, cells: [i], fx: { t: 'none', i } }] } });
    } else if (c.sp) {
      resolve(G, events, { seed: { activate: [i] } });
    } else {
      resolve(G, events, { seed: { custom: [{ origin: i, cells: [i], fx: { t: 'none', i } }] } });
    }
    settle(G, events);
    return { ok: true, events };
  }
  function useShuffle(G) {
    if (G.status !== 'play' || G.boosters.shuffle <= 0) return { ok: false, events: [] };
    G.boosters.shuffle--;
    return { ok: true, events: [reshuffle(G)] };
  }
  function usePlus(G) {
    if ((G.status !== 'play' && G.status !== 'lost') || G.boosters.plus <= 0) return { ok: false, events: [] };
    G.boosters.plus--;
    G.moves += 5;
    G.status = 'play';
    const events = [];
    if (!listMoves(G).length) events.push({ type: 'noMoves' }, reshuffle(G));
    return { ok: true, events };
  }

  // Залишок ходів згорає смугами: це фінальний салют і головне джерело балів за вправну гру.
  function finishLevel(G) {
    const events = [];
    const coins = COIN_LEVEL + Math.min(G.moves, COIN_MOVE_CAP) * COIN_MOVE;
    G.coins = (G.coins || 0) + coins;
    const fire = Math.min(G.moves, 8);
    for (let n = 0; n < fire; n++) {
      const gems = [];
      G.cells.forEach((c, i) => { if (isGem(c) && !c.sp) gems.push(i); });
      if (!gems.length) break;
      const i = gems[rint(G, gems.length)];
      events.push({ type: 'finale', left: G.moves - n - 1 });
      resolve(G, events, { seed: { convert: [{ i, sp: rint(G, 2) ? 'h' : 'v' }] } });
    }
    const rest = G.moves - fire;
    const clearBonus = Math.round((150 + G.level * 25 + Math.max(0, rest) * 40) * pointsMul(G));
    G.score += clearBonus;
    G.moves = 0;
    G.status = 'cleared';
    events.push({ type: 'bonus', pts: clearBonus, coins });
    if (G.level % CHEST_EVERY === 0) G.chest = rollChest(G);
    return events;
  }

  function rollChest(G) {
    const pool = CHEST_POOL.filter((o) => !o.perk || G.perks[o.key] < PERK_CAPS[o.key]);
    return shuffled(G, pool).slice(0, 3).map((o) => o.key);
  }
  const chestOption = (key) => CHEST_POOL.find((o) => o.key === key);
  function pickChest(G, key) {
    if (!G.chest || !G.chest.includes(key)) return false;
    const o = chestOption(key);
    if (o.perk) G.perks[key]++;
    else G.boosters[key] += 2;
    G.chest = null;
    return true;
  }

  // Ціна росте лише в межах рівня: так не вийде викупити безнадійний рівень нескінченно.
  function shopPrice(G, key) {
    const o = SHOP.find((x) => x.key === key);
    return o.price + ((G.bought && G.bought[key]) || 0) * o.step;
  }
  function buy(G, key) {
    const price = shopPrice(G, key);
    if ((G.coins || 0) < price) return false;
    G.coins -= price;
    G.bought = G.bought || {};
    G.bought[key] = (G.bought[key] || 0) + 1;
    G.boosters[key]++;
    return true;
  }

  // ---------- рівні ----------
  function levelPlan(G, level) {
    const t = TUNE[G.diff], d = DIFF[G.diff], L = level - 1;
    const kinds = ['score', 'collect', 'ice', 'crate'];
    const kind = kinds[L % 4];
    const moves = d.moves + G.perks.moves - (kind === 'score' ? 0 : 2);
    const plan = { kind, moves, ice: 0, crates: 0, hp2: 0, ice2: 0, goals: [] };
    const late = Math.max(0, level - 12);
    if (kind === 'score') {
      const base = d.moves + G.perks.moves;
      const need = Math.round(base * (t.ppm0 + t.ppmGrow * Math.pow(L, t.ppmPow)) / 10) * 10;
      plan.goals.push({ kind: 'score', need });
      plan.crates = Math.min(8, Math.floor(late / 3) * 2);
    } else if (kind === 'collect') {
      const count = level >= 26 ? 3 : 2;
      const each = Math.min(60, Math.round(t.collect0 + t.collectGrow * L));
      shuffled(G, Array.from({ length: G.colors }, (_, i) => i)).slice(0, count)
        .forEach((c) => plan.goals.push({ kind: 'collect', c, need: each }));
      plan.crates = Math.min(6, Math.floor(late / 4) * 2);
    } else if (kind === 'ice') {
      plan.ice = Math.min(44, Math.round(t.ice0 + t.iceGrow * L)) & ~1;
      plan.ice2 = level < 15 ? 0 : Math.min(0.5, (level - 14) * 0.03);
      plan.goals.push({ kind: 'ice', need: plan.ice });
    } else {
      plan.crates = Math.min(22, Math.round(t.crate0 + t.crateGrow * L)) & ~1;
      plan.hp2 = level < 12 ? 0 : Math.min(0.55, (level - 11) * 0.035);
      plan.goals.push({ kind: 'crate', need: plan.crates });
    }
    plan.fuses = level < t.fuseFrom ? 0 : 1 + Math.floor((level - t.fuseFrom) / t.fuseEvery);
    plan.fuses = Math.min(3, plan.fuses);
    return plan;
  }

  function mirrored(G, count, minY) {
    const spots = [];
    for (let y = minY; y < N; y++) for (let x = 0; x < N / 2; x++) spots.push([x, y]);
    const out = [];
    shuffled(G, spots).slice(0, Math.ceil(count / 2)).forEach(([x, y]) => { out.push(idx(x, y), idx(N - 1 - x, y)); });
    return out.slice(0, count);
  }

  function fillBoard(G, plan) {
    for (let tries = 0; tries < 60; tries++) {
      G.cells = new Array(N * N).fill(null);
      G.ice = new Array(N * N).fill(0);
      if (plan.ice) mirrored(G, plan.ice, 0).forEach((i) => { G.ice[i] = rand(G) < plan.ice2 ? 2 : 1; });
      if (plan.crates) mirrored(G, plan.crates, 2).forEach((i) => { G.cells[i] = { id: ++G.nextId, k: 'x', hp: rand(G) < plan.hp2 ? 2 : 1 }; });
      for (let i = 0; i < N * N; i++) {
        if (G.cells[i]) continue;
        const banned = new Set();
        if (X(i) >= 2 && isGem(G.cells[i - 1]) && isGem(G.cells[i - 2]) && G.cells[i - 1].c === G.cells[i - 2].c) banned.add(G.cells[i - 1].c);
        if (Y(i) >= 2 && isGem(G.cells[i - N]) && isGem(G.cells[i - 2 * N]) && G.cells[i - N].c === G.cells[i - 2 * N].c) banned.add(G.cells[i - N].c);
        let c;
        do { c = rint(G, G.colors); } while (banned.has(c));
        G.cells[i] = newGem(G, c);
      }
      if (listMoves(G).length >= 4) break;
    }
    const free = shuffled(G, G.cells.map((c, i) => (isGem(c) ? i : -1)).filter((i) => i >= 0));
    let p = 0;
    for (let k = 0; k < G.perks.line && p < free.length; k++) G.cells[free[p++]].sp = rint(G, 2) ? 'h' : 'v';
    for (let k = 0; k < G.perks.bomb && p < free.length; k++) G.cells[free[p++]].sp = 'b';
    for (let k = 0; k < plan.fuses && p < free.length; k++) G.cells[free[p++]].fuse = 8 + rint(G, 4);
  }

  function startLevel(G, level) {
    const plan = levelPlan(G, level);
    G.level = level;
    G.moves = plan.moves;
    G.goals = plan.goals;
    G.kind = plan.kind;
    G.levelRaw = 0;
    G.collected = {};
    G.bought = {};
    G.status = 'play';
    fillBoard(G, plan);
    return G;
  }

  function newGame(diff, seed) {
    const d = DIFF[diff];
    const G = {
      v: 1, diff, seed: seed | 0, nextId: 0, colors: d.colors, level: 1, score: 0, moves: 0,
      boosters: { ...d.boosters }, perks: { moves: 0, line: 0, bomb: 0, greed: 0 },
      goals: [], cells: [], ice: [], collected: {}, levelRaw: 0, status: 'play', chest: null, coins: 0, bought: {},
    };
    return startLevel(G, 1);
  }
  const nextLevel = (G) => startLevel(G, G.level + 1);

  return {
    N, DIFF, TUNE, CHEST_EVERY, FUSE_PENALTY, X, Y, idx, adjacent, isGem,
    newGame, nextLevel, startLevel, playSwap, useHammer, useShuffle, usePlus, finishLevel,
    listMoves, hint, goalState, goalsDone, findGroups, validSwap, pickChest, chestOption, pointsMul, SHOP, shopPrice, buy,
  };
});
