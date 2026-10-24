// ==========================================================================
// «Орда» — логіка гри без DOM і без canvas. Лише стан + крок симуляції.
//
//   const s = HordeCore.create({ charId, meta, viewW, viewH, seed });
//   HordeCore.step(s, { x, y }, dt);    // фіксований крок 1/60 с
//   s.events — черга подій для UI: levelup / chest / gameover / victory
//   HordeCore.choose(s, option) / HordeCore.reroll(s) / HordeCore.skip(s)
//
// Чому окремо: цей файл — майже прямий шаблон для нативної версії (Kotlin):
// стан — data-класи, step() — update() у ігровому циклі, рендер — окремо.
// ==========================================================================
(function () {
  const D = window.HordeData;
  const TAU = Math.PI * 2;
  const CELL = 48; // розмір клітинки просторової сітки

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function baseStats() {
    return {
      might: 1, cooldown: 1, area: 1, speed: 1, duration: 1, amount: 0,
      maxHp: 100, armor: 0, regen: 0, moveSpeed: 1, magnet: 1, growth: 1,
      greed: 1, luck: 1, rerolls: 0, revivals: 0,
    };
  }

  // ---------------------------------------------------------------- create
  function create(opts) {
    const ch = D.CHARACTERS[opts.charId] || D.CHARACTERS.knight;
    const s = {
      charId: opts.charId in D.CHARACTERS ? opts.charId : "knight",
      night: Math.max(0, Math.min(D.NIGHTS.length - 1, opts.night | 0)),
      meta: opts.meta || {},
      rand: rng(opts.seed || (Date.now() & 0xffffffff)),
      viewW: opts.viewW || 400, viewH: opts.viewH || 700,
      t: 0, kills: 0, coins: 0, over: false, won: false,
      player: { x: 0, y: 0, r: 12, hp: ch.hp, inv: 0, fx: 1, fy: 0, mx: 1, my: 0, moving: false, level: 1, xp: 0, need: 5, hurt: 0 },
      stats: baseStats(),
      weapons: [],   // { id, level, evolved, cd, active, angle }
      passives: [],  // { id, level }
      enemies: [], projectiles: [], zones: [], pickups: [], fx: [], nums: [], delayed: [],
      grid: new Map(),
      spawnAcc: 0, eventIdx: 0, nextId: 1,
      pendingLevels: 0, menu: null, events: [],
      rerollsLeft: 0, revivesLeft: 0, bossAlive: null,
    };
    recomputeStats(s);
    s.player.hp = s.stats.maxHp;
    s.rerollsLeft = s.stats.rerolls;
    s.revivesLeft = s.stats.revivals;
    addWeapon(s, ch.weapon);
    return s;
  }

  function recomputeStats(s) {
    const ch = D.CHARACTERS[s.charId];
    const prevMax = s.stats.maxHp;
    const st = baseStats();
    st.maxHp = ch.hp;
    const add = (stat, v) => { st[stat] += v; };
    for (const k in ch.bonus) add(k, ch.bonus[k]);
    for (const id in s.meta) {
      const def = D.SHOP[id];
      if (def && s.meta[id] > 0) add(def.stat, def.per * s.meta[id]);
    }
    for (const p of s.passives) {
      const def = D.PASSIVES[p.id];
      add(def.stat, def.per * p.level);
    }
    // бонуси після повного білду (коли прокачувати вже нічого)
    if (s.bonus) for (const k in s.bonus) add(k, s.bonus[k]);
    st.cooldown = Math.max(0.35, st.cooldown);
    s.stats = st;
    if (s.player && st.maxHp > prevMax) s.player.hp += st.maxHp - prevMax;
    if (s.player) s.player.hp = Math.min(s.player.hp, st.maxHp);
  }

  // Підсумкові стати зброї з урахуванням рівня, еволюції та статів гравця.
  function weaponStats(s, w) {
    const def = D.WEAPONS[w.id];
    const b = Object.assign({ dmg: 0, cd: 1, amount: 1, area: 1, speed: 1, duration: 1, pierce: 1 }, def.base);
    for (let i = 0; i < w.level - 1 && i < def.levels.length; i++) {
      const lv = def.levels[i];
      for (const k in lv) if (typeof lv[k] === "number") b[k] += lv[k];
    }
    let flags = {};
    if (w.evolved && def.evo) {
      for (const k in def.evo.mods) b[k] += def.evo.mods[k];
      if (def.evo.cdMul) b.cd *= def.evo.cdMul;
      flags = def.evo.flags || {};
    }
    const st = s.stats;
    return {
      dmg: b.dmg * st.might,
      cd: Math.max(0.05, b.cd * st.cooldown),
      amount: Math.max(1, Math.round(b.amount + st.amount)),
      area: b.area * st.area,
      speed: b.speed * st.speed,
      duration: b.duration * st.duration,
      pierce: b.pierce,
      flags,
    };
  }

  function addWeapon(s, id) {
    s.weapons.push({ id, level: 1, evolved: false, cd: 0.3, active: 0, angle: 0 });
  }

  // --------------------------------------------------------- spatial grid
  function cellKey(cx, cy) { return ((cx & 0xffff) << 16) | (cy & 0xffff); }
  function rebuildGrid(s) {
    const g = s.grid;
    for (const arr of g.values()) arr.length = 0;
    for (const e of s.enemies) {
      if (e.dead) continue;
      const k = cellKey(Math.floor(e.x / CELL), Math.floor(e.y / CELL));
      let arr = g.get(k);
      if (!arr) { arr = []; g.set(k, arr); }
      arr.push(e);
    }
    if (g.size > 4000) g.clear(); // чистимо порожні клітинки, що набіглись
  }
  function forNear(s, x, y, r, cb) {
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const arr = s.grid.get(cellKey(cx, cy));
      if (!arr) continue;
      for (let i = 0; i < arr.length; i++) { const e = arr[i]; if (!e.dead && cb(e) === false) return; }
    }
  }

  // ------------------------------------------------------------- enemies
  // здоров'я ворогів росте швидше з часом (квадратично), щоб пізня гра не ставала прогулянкою
  function hpMul(s) { const m = s.t / 60, late = Math.max(0, m - 8), end = Math.max(0, m - 10); return 1 + m * 0.16 + late * late * 0.06 + end * end * 0.12; }

  function spawnEnemy(s, type, x, y, opt) {
    const def = D.ENEMIES[type];
    const o = opt || {};
    const elite = !!o.elite, boss = !!def.boss;
    // боси теж ростуть з часом: фінальний на 15-й хв ≈ ×9 від бази (раніше лопався за 2 с)
    const mul = hpMul(s) * (boss ? 1 : elite ? 12 : 1) * (def.prop ? 1 : D.NIGHTS[s.night].hp);
    const e = {
      id: s.nextId++, type, x, y,
      r: def.r * (elite ? 1.8 : 1),
      hp: def.hp * mul, maxHp: def.hp * mul,
      spd: def.spd * (elite ? 0.9 : 1),
      dmg: def.dmg * (elite ? 1.5 : 1) * (boss ? 1 : 1 + s.t / 900 + Math.max(0, s.t - 480) / 420) * D.NIGHTS[s.night].dmg,
      xp: def.xp * (elite ? 10 : 1),
      fly: !!def.fly, heavy: !!def.heavy || elite, elite, boss, prop: !!def.prop,
      vx: 0, vy: 0, kbx: 0, kby: 0, flash: 0, dead: false,
      dirX: o.dirX || 0, dirY: o.dirY || 0, // для роїв — летять прямо
      cdOrbit: 0, life: o.life || 0, phase: s.rand() * TAU, ai: 0, dash: 0,
    };
    s.enemies.push(e);
    if (boss) s.bossAlive = e;
    return e;
  }

  function spawnRingPos(s, extra) {
    const p = s.player;
    const R = Math.hypot(s.viewW, s.viewH) / 2 + 40 + (extra || 0);
    // трохи частіше — попереду руху, щоб натовп не лише наздоганяв
    let a = s.rand() * TAU;
    if (p.moving && s.rand() < 0.5) a = Math.atan2(p.my, p.mx) + (s.rand() - 0.5) * 1.6;
    return { x: p.x + Math.cos(a) * R, y: p.y + Math.sin(a) * R };
  }

  function pickWeighted(s, weights) {
    let total = 0;
    for (const k in weights) total += weights[k];
    let r = s.rand() * total;
    for (const k in weights) { r -= weights[k]; if (r <= 0) return k; }
    return Object.keys(weights)[0];
  }

  function waveFor(s, minute) {
    const w = D.WAVES[Math.min(D.WAVES.length - 1, minute)];
    const n = D.NIGHTS[s.night];
    if (!n.add || minute < 2) return w;
    const k = Math.min(1, (minute - 1) / 4); // нові вороги входять поступово
    const types = Object.assign({}, w.types);
    for (const id in n.add) types[id] = (types[id] || 0) + n.add[id] * k;
    return { max: w.max, types };
  }

  function updateSpawning(s, dt) {
    const minute = Math.min(D.WAVES.length - 1, Math.floor(s.t / 60));
    const wave = waveFor(s, minute);
    // після фінальної хвилини орда товщає далі
    const over = Math.max(0, s.t - D.RUN_SECONDS);
    // на більшому огляді — більше ворогів, але на старті ліміт росте поступово
    const area = Math.min(2.4, Math.max(1, (s.viewW * s.viewH) / (390 * 720)));
    const ramp = Math.min(1, s.t / 240);
    const late = s.t > 480 ? 1 + Math.min(0.6, (s.t - 480) / 600) : 1; // після 8-ї хвилини орда густішає
    const max = Math.round((wave.max + Math.floor(over / 10) * 5) * (1 + (area - 1) * ramp) * late * (s.challenge ? 1.6 : 1));
    let normal = 0;
    for (const e of s.enemies) if (!e.dead && !e.boss && !e.prop && !e.dirX && !e.dirY) normal++;
    s.spawnAcc += dt;
    // перші хвилини вороги підходять рідше: інтервал 0.7 с → 0.2 с до 5-ї хвилини
    let interval = Math.max(0.2, 0.7 - (s.t / 300) * 0.5);
    if (s.challenge) interval *= 0.5;
    if (s.spawnAcc >= interval) {
      s.spawnAcc = 0;
      const want = Math.min(s.t < 120 ? 2 : 6, max - normal);
      for (let i = 0; i < want; i++) {
        const pos = spawnRingPos(s);
        spawnEnemy(s, pickWeighted(s, wave.types), pos.x, pos.y);
      }
    }
    // події за розкладом
    while (s.eventIdx < D.EVENTS.length && s.t >= D.EVENTS[s.eventIdx].t) {
      runEvent(s, D.EVENTS[s.eventIdx]);
      s.eventIdx++;
    }
  }

  function runEvent(s, ev) {
    const p = s.player;
    if (ev.kind === "elite" || ev.kind === "boss") {
      const pos = spawnRingPos(s, 20);
      const type = ev.kind === "boss" ? (D.NIGHTS[s.night].bosses[ev.type] || ev.type) : ev.type;
      const e = spawnEnemy(s, type, pos.x, pos.y, { elite: ev.kind === "elite" });
      if (ev.final) e.final = true;
      s.events.push({ type: "announce", text: ev.kind === "boss" ? `Бос: ${D.ENEMIES[type].name}!` : `Еліта: ${D.ENEMIES[type].name}` , boss: ev.kind === "boss" });
      return e;
    }
    if (ev.kind === "ring") {
      const R = Math.hypot(s.viewW, s.viewH) / 2 + 20;
      for (let i = 0; i < ev.n; i++) {
        const a = (i / ev.n) * TAU;
        spawnEnemy(s, ev.type, p.x + Math.cos(a) * R, p.y + Math.sin(a) * R);
      }
      s.events.push({ type: "announce", text: "Тебе оточують!" });
      return;
    }
    if (ev.kind === "swarm") {
      const a = s.rand() * TAU;
      const dx = Math.cos(a), dy = Math.sin(a);
      const R = Math.hypot(s.viewW, s.viewH) / 2 + 60;
      const sx = p.x - dx * R, sy = p.y - dy * R;
      for (let i = 0; i < ev.n; i++) {
        const off = (i - ev.n / 2) * 14 + (s.rand() - 0.5) * 10;
        const back = s.rand() * 120;
        const e = spawnEnemy(s, ev.type, sx - dy * off - dx * back, sy + dx * off - dy * back, { dirX: dx, dirY: dy, life: 14 });
        e.spd *= 1.4;
      }
      s.events.push({ type: "announce", text: "Рій!" });
    }
  }

  function updateEnemies(s, dt) {
    const p = s.player;
    const farR = Math.hypot(s.viewW, s.viewH) * 0.75 + 140;
    for (const e of s.enemies) {
      if (e.dead) continue;
      if (e.flash > 0) e.flash -= dt;
      e.phase += dt * 6;
      if (e.prop) { if (Math.hypot(e.x - p.x, e.y - p.y) > 1600) e.dead = true; continue; }
      let mx, my;
      if (e.dirX || e.dirY) {
        mx = e.dirX; my = e.dirY;
        e.life -= dt;
        if (e.life <= 0) { e.dead = true; continue; }
      } else {
        const dx = p.x - e.x, dy = p.y - e.y;
        const d = Math.hypot(dx, dy) || 1;
        mx = dx / d; my = dy / d;
        // далеко відстали — переносимо вперед (як у VS), крім босів
        if (d > farR && !e.boss) {
          const pos = spawnRingPos(s);
          e.x = pos.x; e.y = pos.y;
          continue;
        }
      }
      let spd = e.spd;
      if (e.boss) bossAI(s, e, dt);
      if (e.dash > 0) { spd *= 3.2; e.dash -= dt; }
      e.x += (mx * spd + e.kbx) * dt;
      e.y += (my * spd + e.kby) * dt;
      const kbDecay = Math.exp(-dt * 10);
      e.kbx *= kbDecay; e.kby *= kbDecay;
    }
  }

  function bossAI(s, e, dt) {
    const def = D.ENEMIES[e.type];
    e.ai += dt;
    if (def.boss === "dash" && e.ai > 5) { e.ai = 0; e.dash = 0.6; }
    if (def.boss === "summon" && e.ai > 6) {
      e.ai = 0;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        spawnEnemy(s, def.summon || "skeleton", e.x + Math.cos(a) * 50, e.y + Math.sin(a) * 50);
      }
      s.fx.push({ kind: "ring", x: e.x, y: e.y, r: 70, t: 0, life: 0.5, color: "#7fd0ff" });
    }
    if (def.boss === "final" && e.ai > 4) { e.ai = 0; e.dash = 0.4; }
  }

  // Розштовхування натовпу — щоб не злипались в одну точку.
  function separate(s) {
    for (const e of s.enemies) {
      if (e.dead || e.fly || e.prop) continue;
      forNear(s, e.x, e.y, e.r * 2, (o) => {
        if (o === e || o.fly || o.prop || o.id < e.id) return;
        const dx = o.x - e.x, dy = o.y - e.y;
        const min = e.r + o.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 === 0) return;
        const d = Math.sqrt(d2);
        const push = (min - d) * 0.5;
        const nx = dx / d, ny = dy / d;
        const we = e.heavy ? 0.2 : 1, wo = o.heavy ? 0.2 : 1;
        const sum = we + wo;
        e.x -= nx * push * (we / sum) * 2 * 0.5;
        e.y -= ny * push * (we / sum) * 2 * 0.5;
        o.x += nx * push * (wo / sum) * 2 * 0.5;
        o.y += ny * push * (wo / sum) * 2 * 0.5;
      });
    }
  }

  function damageEnemy(s, e, dmg, kx, ky, kb) {
    if (e.dead) return 0;
    e.hp -= dmg;
    e.flash = 0.1;
    if (!e.heavy && kb) { e.kbx += kx * kb; e.kby += ky * kb; }
    else if (kb) { e.kbx += kx * kb * 0.15; e.kby += ky * kb * 0.15; }
    if (!e.prop && s.nums.length < 50) s.nums.push({ x: e.x + (s.rand() - 0.5) * 10, y: e.y - e.r, v: Math.round(dmg), t: 0 });
    if (e.hp <= 0) killEnemy(s, e);
    return dmg;
  }

  function killEnemy(s, e) {
    e.dead = true;
    if (e.prop) { breakProp(s, e); return; }
    s.kills++;
    s.fx.push({ kind: "puff", x: e.x, y: e.y, r: e.r, t: 0, life: 0.35, color: D.ENEMIES[e.type].color });
    const luck = s.stats.luck;
    if (e.boss) {
      s.bossAlive = null;
      dropPickup(s, "chest", e.x, e.y, 1);
      for (let i = 0; i < 8; i++) dropPickup(s, "coin", e.x + (s.rand() - 0.5) * 80, e.y + (s.rand() - 0.5) * 80, 10);
      if (e.final || D.ENEMIES[e.type].boss === "final") { s.won = true; finish(s, "victory"); return; }
    } else if (e.elite) {
      dropPickup(s, "chest", e.x, e.y, 1);
      dropPickup(s, "coin", e.x + 20, e.y, 10);
    }
    if (e.xp > 0) dropPickup(s, "gem", e.x, e.y, e.xp);
    const r = s.rand();
    if (r < 0.03 * luck) dropPickup(s, "coin", e.x + 6, e.y + 6, 1 + Math.floor(s.rand() * 3));
    else if (r < 0.03 * luck + 0.002 * luck) dropPickup(s, "food", e.x, e.y, 30);
    else if (r < 0.03 * luck + 0.002 * luck + 0.0012 * luck) dropPickup(s, "vortex", e.x, e.y, 0);
  }

  // Жаровня: основне джерело лікування на мапі (як підсмажене м'ясо у VS)
  function breakProp(s, e) {
    s.fx.push({ kind: "puff", x: e.x, y: e.y, r: 10, t: 0, life: 0.4, color: "#e8853a" });
    const r = s.rand() / Math.min(1.5, s.stats.luck);
    if (r < 0.38) dropPickup(s, "food", e.x, e.y, 30);
    else if (r < 0.68) dropPickup(s, "coin", e.x, e.y, 3 + Math.floor(s.rand() * 4));
    else if (r < 0.80) dropPickup(s, "gem", e.x, e.y, 5);
    else if (r < 0.90) dropPickup(s, "vortex", e.x, e.y, 0);
    else for (let i = 0; i < 5; i++) dropPickup(s, "coin", e.x + (s.rand() - 0.5) * 30, e.y + (s.rand() - 0.5) * 30, 4);
  }

  // ------------------------------------------------------------- pickups
  function dropPickup(s, kind, x, y, v) {
    if (kind === "gem") {
      let gems = 0;
      for (const pk of s.pickups) if (pk.kind === "gem") gems++;
      if (gems > 350) {
        // забагато кристалів — додаємо досвід до випадкового наявного
        for (let i = 0; i < 6; i++) {
          const pk = s.pickups[Math.floor(s.rand() * s.pickups.length)];
          if (pk && pk.kind === "gem" && !pk.pull) { pk.v += v; return; }
        }
      }
    }
    s.pickups.push({ kind, x, y, v, pull: false, sp: 0, t: 0 });
  }

  function updatePickups(s, dt) {
    const p = s.player;
    const magR = 70 * s.stats.magnet;
    const keep = [];
    for (const pk of s.pickups) {
      pk.t += dt;
      const dx = p.x - pk.x, dy = p.y - pk.y;
      const d = Math.hypot(dx, dy);
      if (!pk.pull && d < magR && pk.kind !== "chest") pk.pull = true;
      if (pk.kind === "chest" && d < magR * 0.6) pk.pull = true;
      if (pk.pull) {
        pk.sp = Math.min(900, pk.sp + 1400 * dt);
        const step = Math.min(d, pk.sp * dt);
        if (d > 0) { pk.x += (dx / d) * step; pk.y += (dy / d) * step; }
      }
      if (d < p.r + 8) { collect(s, pk); continue; }
      keep.push(pk);
    }
    s.pickups = keep;
  }

  function collect(s, pk) {
    const p = s.player;
    if (pk.kind === "gem") gainXp(s, pk.v);
    else if (pk.kind === "coin") s.coins += pk.v;
    else if (pk.kind === "food") { p.hp = Math.min(s.stats.maxHp, p.hp + pk.v); s.fx.push({ kind: "heal", x: p.x, y: p.y, t: 0, life: 0.6 }); }
    else if (pk.kind === "vortex") { for (const o of s.pickups) if (o.kind === "gem") o.pull = true; }
    else if (pk.kind === "chest") {
      const r = openChest(s);
      if (r.evolve) { s.menu = { type: "evolve", options: r.evolve, extra: r.extra }; s.events.push({ type: "evolve", options: r.evolve }); }
      else { s.menu = { type: "chest", items: r.items }; s.events.push({ type: "chest", items: r.items }); }
    }
  }

  function gainXp(s, v) {
    const p = s.player;
    p.xp += v * s.stats.growth;
    while (p.xp >= p.need) {
      p.xp -= p.need;
      p.level++;
      p.need = buildMaxed(s) ? CAP_NEED : xpNeed(p.level);
      s.pendingLevels++;
    }
  }
  // Коли білд повністю прокачано (≈60-й рівень), кожен наступний рівень коштує
  // стільки ж досвіду, скільки рівні 1–30 разом, і дає випадково золото або лікування.
  let CAP_NEED = 0;
  function buildMaxed(s) { return upgradePool(s).length === 0; }
  function xpNeed(level) {
    if (level < 20) return 5 + (level - 1) * 8;
    if (level < 40) return 157 + (level - 20) * 12;
    return 397 + (level - 40) * 16;
  }

  // ------------------------------------------------------------- weapons
  function nearestEnemies(s, n, maxR) {
    const p = s.player;
    const list = [];
    const R2 = maxR * maxR;
    for (const e of s.enemies) {
      if (e.dead || e.prop) continue;
      const d2 = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
      if (d2 < R2) list.push({ e, d2 });
    }
    list.sort((a, b) => a.d2 - b.d2);
    return list.slice(0, n).map((o) => o.e);
  }
  function onScreen(s, e) {
    const p = s.player;
    return Math.abs(e.x - p.x) < s.viewW / 2 + 10 && Math.abs(e.y - p.y) < s.viewH / 2 + 10;
  }
  function later(s, delay, fn) { s.delayed.push({ t: delay, fn }); }

  function heal(s, v) {
    const p = s.player;
    p.hp = Math.min(s.stats.maxHp, p.hp + v);
  }

  const FIRE = {
    sword(s, w, ws) {
      const p = s.player;
      // б'є в бік найближчого ворога (на телефоні зручніше, ніж лише «куди дивишся»)
      const near = nearestEnemies(s, 1, 220)[0];
      const face = near ? (near.x >= p.x ? 1 : -1) : (p.fx >= 0 ? 1 : -1);
      for (let i = 0; i < ws.amount; i++) {
        later(s, i * 0.12, () => {
          const side = i % 2 === 0 ? face : -face;
          const W = 120 * ws.area, H = 34 * ws.area;
          const cx = p.x + side * (W / 2 + 6), cy = p.y - Math.floor(i / 2) * 22;
          let healed = 0;
          for (const e of s.enemies) {
            if (e.dead) continue;
            if (Math.abs(e.x - cx) < W / 2 + e.r && Math.abs(e.y - cy) < H / 2 + e.r) {
              damageEnemy(s, e, ws.dmg, side, 0, 160);
              if (ws.flags.lifesteal && healed < 3) { heal(s, 0.75); healed++; }
            }
          }
          s.fx.push({ kind: "slash", x: cx, y: cy, w: W, h: H, side, t: 0, life: 0.18, evo: !!ws.flags.lifesteal });
        });
      }
    },
    wand(s, w, ws) {
      const p = s.player;
      const targets = nearestEnemies(s, ws.amount, 520);
      if (!targets.length) return false;
      for (let i = 0; i < ws.amount; i++) {
        const t = targets[i % targets.length];
        later(s, i * 0.07, () => {
          const tx = t.dead ? p.x + p.fx * 100 : t.x, ty = t.dead ? p.y + p.fy * 100 : t.y;
          const d = Math.hypot(tx - p.x, ty - p.y) || 1;
          const sp = 380 * ws.speed;
          s.projectiles.push({ kind: "arrow", x: p.x, y: p.y, vx: (tx - p.x) / d * sp, vy: (ty - p.y) / d * sp, r: 6, dmg: ws.dmg, pierce: ws.pierce, life: 2, hit: [], g: 0, kb: 60 });
        });
      }
    },
    knife(s, w, ws) {
      const p = s.player;
      // віялом: у найближчого ворога поруч, інакше — куди біжиш
      const near = nearestEnemies(s, 1, 240)[0];
      let dx, dy;
      if (near) { const d = Math.hypot(near.x - p.x, near.y - p.y) || 1; dx = (near.x - p.x) / d; dy = (near.y - p.y) / d; }
      else { const d = Math.hypot(p.mx, p.my) || 1; dx = p.mx / d; dy = p.my / d; }
      for (let i = 0; i < ws.amount; i++) {
        later(s, i * 0.06, () => {
          const off = (i - (ws.amount - 1) / 2) * 12 + (s.rand() - 0.5) * 6;
          const sp = 540 * ws.speed;
          s.projectiles.push({ kind: "knife", x: p.x - dy * off, y: p.y + dx * off, vx: dx * sp, vy: dy * sp, r: 5, dmg: ws.dmg, pierce: ws.pierce, life: 1.3, hit: [], g: 0, kb: 40 });
        });
      }
    },
    axe(s, w, ws) {
      const p = s.player;
      if (ws.flags.spiral) {
        w.angle += 0.6;
        for (let i = 0; i < ws.amount + 2; i++) {
          const a = w.angle + (i / (ws.amount + 2)) * TAU;
          const sp = 240 * ws.speed;
          s.projectiles.push({ kind: "axe", x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 13 * ws.area, dmg: ws.dmg, pierce: 999, life: 2.6, hit: [], g: 0, kb: 120, spin: 0 });
        }
        return;
      }
      for (let i = 0; i < ws.amount; i++) {
        later(s, i * 0.12, () => {
          const vx = (s.rand() - 0.5) * 260 + (p.fx >= 0 ? 1 : -1) * 50 * (i % 2 ? -1 : 1);
          s.projectiles.push({ kind: "axe", x: p.x, y: p.y, vx, vy: -470 * Math.sqrt(ws.speed), r: 11 * ws.area, dmg: ws.dmg, pierce: ws.pierce, life: 3, hit: [], g: 900, kb: 120, spin: 0 });
        });
      }
    },
    pool(s, w, ws) {
      const p = s.player;
      const vis = s.enemies.filter((e) => !e.dead && !e.prop && onScreen(s, e));
      for (let i = 0; i < ws.amount; i++) {
        later(s, i * 0.15, () => {
          let x, y;
          if (ws.flags.follow) { x = p.x + (s.rand() - 0.5) * 60; y = p.y + (s.rand() - 0.5) * 60; }
          else if (vis.length) { const t = vis[Math.floor(s.rand() * vis.length)]; x = t.x; y = t.y; }
          else { const a = s.rand() * TAU; x = p.x + Math.cos(a) * 90; y = p.y + Math.sin(a) * 90; }
          s.zones.push({ kind: "water", x, y, r: 38 * ws.area, life: ws.duration, max: ws.duration, tick: 0, every: 0.3, dmg: ws.dmg, follow: !!ws.flags.follow });
        });
      }
    },
    orbit(s, w, ws) {
      w.active = ws.flags.permanent ? 1e9 : ws.duration;
    },
    bolt(s, w, ws) {
      const vis = s.enemies.filter((e) => !e.dead && !e.prop && onScreen(s, e));
      if (!vis.length) return false;
      for (let i = 0; i < ws.amount; i++) {
        later(s, i * 0.08, () => {
          const live = vis.filter((e) => !e.dead);
          if (!live.length) return;
          let t = live[Math.floor(s.rand() * live.length)];
          const strikes = ws.flags.chain ? 3 : 1;
          let prev = null;
          for (let k = 0; k < strikes && t; k++) {
            const R = 26 * ws.area;
            const cx = t.x, cy = t.y;
            forNear(s, cx, cy, R + 30, (e) => {
              if (Math.hypot(e.x - cx, e.y - cy) < R + e.r) damageEnemy(s, e, ws.dmg, 0, 0, 0);
            });
            s.fx.push({ kind: "bolt", x: cx, y: cy, fromX: prev ? prev.x : null, fromY: prev ? prev.y : null, r: R, t: 0, life: 0.25 });
            prev = { x: cx, y: cy };
            // наступна ціль ланцюга — найближча жива
            let best = null, bd = 160 * 160;
            for (const e of s.enemies) {
              if (e.dead || e.prop) continue;
              const d2 = (e.x - cx) ** 2 + (e.y - cy) ** 2;
              if (d2 > 100 && d2 < bd) { bd = d2; best = e; }
            }
            t = best;
          }
        });
      }
    },
  };

  // Шкода по площі (аура, калюжі): ворог, що щойно зайшов у радіус, отримує
  // удар одразу; далі — за спільним таймером джерела (tickNow).
  // Щоб відкинутий і повернутий ворог не ловив удар щоразу, повторний «вхід»
  // б'є не частіше ніж раз на півінтервалу.
  function areaTick(s, src, cx, cy, R, rK, tickNow, every, hit) {
    const prev = src.inside || new Map();
    const last = src.hits || (src.hits = new Map());
    const next = new Map();
    forNear(s, cx, cy, R + 40, (e) => {
      if (Math.hypot(e.x - cx, e.y - cy) >= R + e.r * rK) return;
      const lh = last.has(e.id) ? last.get(e.id) : -1e9;
      const entered = !prev.has(e.id);
      if ((entered && s.t - lh >= every * 0.5) || (!entered && tickNow && s.t - lh >= 0.1)) {
        hit(e);
        last.set(e.id, s.t);
      }
      next.set(e.id, 1);
    });
    src.inside = next;
    if (last.size > 400) for (const [id, t] of last) if (s.t - t > every * 2) last.delete(id);
  }

  function updateWeapons(s, dt) {
    const p = s.player;
    for (const w of s.weapons) {
      const def = D.WEAPONS[w.id];
      const ws = weaponStats(s, w);
      if (def.behavior === "orbit") {
        w.angle += dt * 3.2 * ws.speed;
        if (w.active > 0) {
          w.active -= dt;
          const R = 72 * ws.area, br = 11 * ws.area;
          for (let i = 0; i < ws.amount; i++) {
            const a = w.angle + (i / ws.amount) * TAU;
            const ox = p.x + Math.cos(a) * R, oy = p.y + Math.sin(a) * R;
            forNear(s, ox, oy, br + 30, (e) => {
              if (e.cdOrbit > s.t) return;
              if (Math.hypot(e.x - ox, e.y - oy) < br + e.r) {
                e.cdOrbit = s.t + 0.4;
                const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
                damageEnemy(s, e, ws.dmg, dx / d, dy / d, 140);
              }
            });
          }
          if (w.active <= 0) w.cd = ws.cd;
          continue;
        }
      }
      if (w.pulse) w.pulse = Math.max(0, w.pulse - dt * 3);
      if (def.behavior === "aura") {
        w.cd -= dt;
        const tickNow = w.cd <= 0;
        if (tickNow) { w.cd = ws.cd; w.pulse = 1; }
        const R = 52 * ws.area;
        let hits = 0;
        areaTick(s, w, p.x, p.y, R, 1, tickNow, ws.cd, (e) => {
          const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
          damageEnemy(s, e, ws.dmg, dx / d, dy / d, 110);
          hits++;
        });
        if (ws.flags.heal && hits) heal(s, Math.min(2, hits * 0.15));
        continue;
      }
      w.cd -= dt;
      if (w.cd <= 0) {
        const res = FIRE[def.behavior](s, w, ws);
        w.cd = res === false ? 0.25 : ws.cd; // нема цілей — спробуємо скоро знову
      }
    }
  }

  function updateProjectiles(s, dt) {
    const keep = [];
    for (const pr of s.projectiles) {
      pr.life -= dt;
      pr.vy += pr.g * dt;
      pr.x += pr.vx * dt; pr.y += pr.vy * dt;
      if (pr.spin !== undefined) pr.spin += dt * 14;
      let alive = pr.life > 0;
      if (alive) {
        forNear(s, pr.x, pr.y, pr.r + 30, (e) => {
          if (pr.hit.indexOf(e.id) >= 0) return;
          if (Math.hypot(e.x - pr.x, e.y - pr.y) < pr.r + e.r) {
            pr.hit.push(e.id);
            const sp = Math.hypot(pr.vx, pr.vy) || 1;
            damageEnemy(s, e, pr.dmg, pr.vx / sp, pr.vy / sp, pr.kb);
            if (pr.hit.length >= pr.pierce) { alive = false; return false; }
          }
        });
      }
      if (alive) keep.push(pr);
    }
    s.projectiles = keep;
  }

  function updateZones(s, dt) {
    const p = s.player;
    const keep = [];
    for (const z of s.zones) {
      z.life -= dt;
      if (z.follow) {
        const dx = p.x - z.x, dy = p.y - z.y, d = Math.hypot(dx, dy) || 1;
        z.x += dx / d * 45 * dt; z.y += dy / d * 45 * dt;
      }
      z.tick -= dt;
      const tickNow = z.tick <= 0;
      if (tickNow) z.tick = z.every;
      areaTick(s, z, z.x, z.y, z.r, 0.5, tickNow, z.every, (e) => damageEnemy(s, e, z.dmg, 0, 0, 0));
      if (z.life > 0) keep.push(z);
    }
    s.zones = keep;
  }

  // -------------------------------------------------------------- player
  function updatePlayer(s, input, dt) {
    const p = s.player;
    let ix = input.x || 0, iy = input.y || 0;
    const m = Math.hypot(ix, iy);
    if (m > 1) { ix /= m; iy /= m; }
    p.moving = m > 0.05;
    if (p.moving) {
      p.mx = ix; p.my = iy;
      if (Math.abs(ix) > 0.15) p.fx = ix > 0 ? 1 : -1;
      p.fy = iy;
    }
    const spd = 135 * s.stats.moveSpeed;
    p.x += ix * spd * dt;
    p.y += iy * spd * dt;
    if (p.inv > 0) p.inv -= dt;
    if (p.hurt > 0) p.hurt -= dt;
    if (s.stats.regen > 0) heal(s, s.stats.regen * dt);

    // дотик ворогів
    if (p.inv <= 0) {
      let worst = 0;
      forNear(s, p.x, p.y, p.r + 50, (e) => {
        if (Math.hypot(e.x - p.x, e.y - p.y) < p.r + e.r * 0.85) worst = Math.max(worst, e.dmg);
      });
      if (worst > 0) {
        const dmg = Math.max(1, worst - s.stats.armor);
        p.hp -= dmg;
        p.inv = 0.45;
        p.hurt = 0.2;
        s.events.push({ type: "hurt" });
        if (p.hp <= 0) die(s);
      }
    }
  }

  function die(s) {
    const p = s.player;
    if (s.revivesLeft > 0) {
      s.revivesLeft--;
      p.hp = s.stats.maxHp * 0.6;
      p.inv = 2;
      for (const e of s.enemies) {
        if (e.boss || e.dead) continue;
        if (Math.hypot(e.x - p.x, e.y - p.y) < 260) killEnemy(s, e);
      }
      s.fx.push({ kind: "ring", x: p.x, y: p.y, r: 260, t: 0, life: 0.7, color: "#fff4c2" });
      s.events.push({ type: "announce", text: "Друге життя!" });
      return;
    }
    p.hp = 0;
    finish(s, "gameover");
  }

  function finish(s, kind) {
    if (s.over) return;
    s.over = true;
    s.events.push({ type: kind, result: result(s) });
  }

  function result(s) {
    const time = Math.floor(s.t);
    const n = D.NIGHTS[s.night];
    const gold = Math.floor((s.coins + time * 0.4 + s.kills / 20 + (s.won ? 300 : 0)) * s.stats.greed * n.gold);
    const score = Math.floor((time * 10 + s.kills + (s.won ? 5000 : 0)) * (1 + s.night * 0.5));
    return { time, kills: s.kills, level: s.player.level, gold, score, won: s.won, night: s.night };
  }

  // ------------------------------------------------------- точки інтересу
  function updatePois(s, dt) {
    const p = s.player, R = D.POI_RULES;
    s.pois = s.pois || [];
    // жаровні довкола гравця
    s.propTimer = (s.propTimer || 0) - dt;
    if (s.propTimer <= 0) {
      s.propTimer = 3;
      let near = 0;
      for (const e of s.enemies) if (e.prop && !e.dead && Math.hypot(e.x - p.x, e.y - p.y) < 1100) near++;
      if (near < R.braziers) {
        const a = s.rand() * TAU, d = 380 + s.rand() * 380;
        spawnEnemy(s, "brazier", p.x + Math.cos(a) * d, p.y + Math.sin(a) * d);
      }
    }
    // нові точки
    s.poiTimer = (s.poiTimer == null ? R.first : s.poiTimer) - dt;
    if (s.poiTimer <= 0) {
      s.poiTimer = R.every;
      if (s.pois.length < R.max) {
        const w = {};
        for (const k in D.POIS) w[k] = D.POIS[k].weight * (k === "well" && p.hp < s.stats.maxHp * 0.6 ? 2 : 1) * (k === "obelisk" && s.challenge ? 0 : 1);
        const kind = pickWeighted(s, w);
        for (let tries = 0; tries < 8; tries++) {
          const a = s.rand() * TAU, d = R.minDist + s.rand() * (R.maxDist - R.minDist);
          const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
          if (s.pois.some((o) => Math.hypot(o.x - x, o.y - y) < 260)) continue;
          const def = D.POIS[kind];
          s.pois.push({ id: s.nextId++, kind, x, y, r: def.r, progress: 0, pool: def.pool || 0, dry: 0, done: false });
          s.events.push({ type: "announce", text: `${def.name} поруч`, small: true });
          break;
        }
      }
    }
    // взаємодія
    for (const o of s.pois) {
      const def = D.POIS[o.kind];
      const inside = Math.hypot(p.x - o.x, p.y - o.y) < o.r + p.r * 0.5;
      if (o.kind === "well") {
        if (o.pool <= 0) { o.dry += dt; if (o.dry > 4) o.done = true; continue; }
        if (inside && p.hp < s.stats.maxHp) {
          const h = Math.min(def.rate * dt, o.pool, s.stats.maxHp - p.hp);
          p.hp += h; o.pool -= h;
          o.fxT = (o.fxT || 0) - dt;
          if (o.fxT <= 0) { o.fxT = 0.5; s.fx.push({ kind: "heal", x: p.x, y: p.y, t: 0, life: 0.6 }); }
        }
      } else if (o.kind === "shrine") {
        o.progress = inside ? o.progress + dt / def.channel : Math.max(0, o.progress - dt / (def.channel * 2));
        if (o.progress >= 1) {
          o.done = true;
          dropPickup(s, "chest", o.x, o.y, 1);
          s.fx.push({ kind: "ring", x: o.x, y: o.y, r: 90, t: 0, life: 0.6, color: "#f4cc4c" });
          s.events.push({ type: "announce", text: "Вівтар дарує скриню!" });
        }
      } else if (o.kind === "obelisk") {
        if (!s.challenge && inside) {
          o.progress += dt;
          if (o.progress >= 0.6) {
            o.done = true;
            s.challenge = { t: def.duration, x: o.x, y: o.y };
            const pos = spawnRingPos(s, 20);
            const wave = waveFor(s, Math.floor(s.t / 60));
            spawnEnemy(s, pickWeighted(s, wave.types), pos.x, pos.y, { elite: true });
            s.fx.push({ kind: "ring", x: o.x, y: o.y, r: 120, t: 0, life: 0.7, color: "#ff4636" });
            s.events.push({ type: "announce", text: `Виклик! Протримайся ${def.duration} с`, boss: true });
          }
        } else if (!inside) o.progress = 0;
      }
    }
    s.pois = s.pois.filter((o) => !o.done && Math.hypot(o.x - p.x, o.y - p.y) < R.despawn);
    // виклик
    if (s.challenge) {
      s.challenge.t -= dt;
      if (s.challenge.t <= 0) {
        const c = s.challenge;
        s.challenge = null;
        dropPickup(s, "chest", p.x + 30, p.y, 1);
        for (let i = 0; i < 6; i++) dropPickup(s, "coin", p.x + (s.rand() - 0.5) * 70, p.y + (s.rand() - 0.5) * 70, 5);
        dropPickup(s, "food", p.x - 30, p.y, 30);
        s.events.push({ type: "announce", text: "Виклик виконано!" });
      }
    }
  }

  // --------------------------------------------------------------- step
  function step(s, input, dt) {
    if (s.over || s.menu) return;
    s.t += dt;
    // попередні позиції — рендер інтерполює між кроками (плавно на 90/120 Гц)
    const pl = s.player; pl.px = pl.x; pl.py = pl.y;
    for (const e of s.enemies) { e.px = e.x; e.py = e.y; }
    for (const pr of s.projectiles) { pr.px = pr.x; pr.py = pr.y; }

    // відкладені дії (серії ударів/пострілів)
    if (s.delayed.length) {
      const now = s.delayed;
      s.delayed = [];
      for (const d of now) {
        d.t -= dt;
        if (d.t <= 0) d.fn(); else s.delayed.push(d);
      }
    }

    updateSpawning(s, dt);
    rebuildGrid(s);
    updatePlayer(s, input, dt);
    if (s.over) return;
    updateWeapons(s, dt);
    updateProjectiles(s, dt);
    updateZones(s, dt);
    updateEnemies(s, dt);
    rebuildGrid(s);
    separate(s);
    updatePickups(s, dt);
    updatePois(s, dt);

    // прибираємо мертвих
    if (s.enemies.some((e) => e.dead)) s.enemies = s.enemies.filter((e) => !e.dead);

    for (const f of s.fx) f.t += dt;
    s.fx = s.fx.filter((f) => f.t < f.life);
    for (const n of s.nums) n.t += dt;
    s.nums = s.nums.filter((n) => n.t < 0.6);

    if (!s.over && !s.menu && s.pendingLevels > 0) openLevelUp(s);
  }

  // ------------------------------------------------------------ level up
  function upgradePool(s) {
    const pool = [];
    for (const w of s.weapons) {
      if (!w.evolved && w.level < D.WEAPON_MAX_LEVEL) pool.push({ kind: "weapon", id: w.id, level: w.level + 1, weight: 10 });
    }
    for (const p of s.passives) {
      if (p.level < D.PASSIVES[p.id].max) pool.push({ kind: "passive", id: p.id, level: p.level + 1, weight: 8 });
    }
    if (s.weapons.length < D.MAX_WEAPONS) {
      for (const id in D.WEAPONS) if (!s.weapons.some((w) => w.id === id)) pool.push({ kind: "weapon", id, level: 1, weight: 7 });
    }
    if (s.passives.length < D.MAX_PASSIVES) {
      for (const id in D.PASSIVES) if (!s.passives.some((p) => p.id === id)) pool.push({ kind: "passive", id, level: 1, weight: 6 });
    }
    return pool;
  }

  function rollOptions(s) {
    const pool = upgradePool(s);
    const n = s.rand() < Math.min(0.5, s.stats.luck - 1) ? 4 : 3;
    const out = [];
    while (out.length < n && pool.length) {
      let total = 0;
      for (const o of pool) total += o.weight;
      let r = s.rand() * total, idx = 0;
      for (; idx < pool.length; idx++) { r -= pool[idx].weight; if (r <= 0) break; }
      idx = Math.min(idx, pool.length - 1);
      out.push(pool[idx]);
      pool.splice(idx, 1);
    }
    if (!out.length) {
      out.push({ kind: "gold", v: 25 }, { kind: "food", v: 30 });
    }
    return out;
  }

  function openLevelUp(s) {
    s.pendingLevels--;
    if (buildMaxed(s)) {
      const p = s.player;
      if (p.need < CAP_NEED) p.need = CAP_NEED;
      if (s.rand() < 0.5 || p.hp >= s.stats.maxHp) {
        const v = 30 + Math.floor(s.rand() * 31);
        s.coins += v;
        s.events.push({ type: "announce", text: `Рівень ${p.level}: +${v} золота`, small: true });
      } else {
        heal(s, 40);
        s.fx.push({ kind: "heal", x: p.x, y: p.y, t: 0, life: 0.6 });
        s.events.push({ type: "announce", text: `Рівень ${p.level}: +40 здоров'я`, small: true });
      }
      return;
    }
    s.menu = { type: "levelup", options: rollOptions(s) };
    s.events.push({ type: "levelup", options: s.menu.options });
  }

  function apply(s, o) {
    if (o.kind === "weapon") {
      const w = s.weapons.find((x) => x.id === o.id);
      if (w) w.level = Math.min(D.WEAPON_MAX_LEVEL, w.level + 1); else addWeapon(s, o.id);
    } else if (o.kind === "passive") {
      const p = s.passives.find((x) => x.id === o.id);
      if (p) p.level++; else s.passives.push({ id: o.id, level: 1 });
      recomputeStats(s);
    } else if (o.kind === "bonus") {
      s.bonus = s.bonus || {};
      s.bonus[o.stat] = (s.bonus[o.stat] || 0) + o.v;
      recomputeStats(s);
      if (o.stat === "maxHp") heal(s, o.v);
    } else if (o.kind === "gold") {
      s.coins += o.v;
    } else if (o.kind === "food") {
      heal(s, o.v);
    } else if (o.kind === "evolve") {
      const w = s.weapons.find((x) => x.id === o.id);
      if (w) w.evolved = true;
    }
  }

  function choose(s, o) {
    if (!s.menu) return;
    apply(s, o);
    s.menu = null;
    if (s.pendingLevels > 0) openLevelUp(s);
  }
  function reroll(s) {
    if (!s.menu || s.menu.type !== "levelup" || s.rerollsLeft <= 0) return null;
    s.rerollsLeft--;
    s.menu.options = rollOptions(s);
    return s.menu.options;
  }
  function skip(s) {
    if (!s.menu) return;
    s.menu = null;
    if (s.pendingLevels > 0) openLevelUp(s);
  }

  // Скриня: еволюція, якщо можна, інакше 1 або 3 підвищення.
  // Зброя, яку можна еволюціонувати зараз (за забіг — лише одна еволюція).
  function evoCandidates(s) {
    if (s.weapons.some((w) => w.evolved)) return [];
    return s.weapons.filter((w) => !w.evolved && w.level >= D.WEAPON_MAX_LEVEL && D.WEAPONS[w.id].evo &&
      s.passives.some((p) => p.id === D.WEAPONS[w.id].evo.with)).map((w) => ({ kind: "evolve", id: w.id }));
  }
  function chestItem(s) {
    const pool = upgradePool(s).filter((o) => o.level > 1);
    const o = pool.length ? pool[Math.floor(s.rand() * pool.length)] : { kind: "gold", v: 50 };
    apply(s, o);
    return o;
  }
  // Скриня. Якщо можна еволюціонувати — гравець обирає, яку зброю (або відмовляється),
  // тож повертаємо варіанти замість автоматичного застосування.
  function openChest(s) {
    const count = s.rand() < 0.12 * s.stats.luck ? 3 : 1;
    const evos = evoCandidates(s);
    if (evos.length) return { evolve: evos, extra: count - 1 };
    const items = [];
    for (let i = 0; i < count; i++) items.push(chestItem(s));
    return { items };
  }
  // Вибір у скрині з еволюцією: id зброї або null — «не еволюціонувати» (тоді звичайне посилення).
  function chooseEvolve(s, id) {
    if (!s.menu || s.menu.type !== "evolve") return [];
    const got = [];
    if (id) { const o = { kind: "evolve", id }; apply(s, o); got.push(o); }
    else got.push(chestItem(s));
    for (let i = 0; i < (s.menu.extra || 0); i++) got.push(chestItem(s));
    s.menu = null;
    if (s.pendingLevels > 0) openLevelUp(s);
    return got;
  }

  function setView(s, w, h) { s.viewW = w; s.viewH = h; }

  // ------------------------------------------------- збереження забігу
  // Знімок стану як простий JSON (без функцій, Map і генератора випадковості),
  // щоб забіг переживав оновлення сторінки й нову версію гри.
  const SNAP_VERSION = 1;
  function serialize(s) {
    const strip = (o) => { const c = Object.assign({}, o); delete c.inside; delete c.hits; return c; };
    return JSON.stringify({
      v: SNAP_VERSION, charId: s.charId, night: s.night, meta: s.meta, t: s.t, kills: s.kills, coins: s.coins,
      player: s.player, weapons: s.weapons.map(strip), passives: s.passives,
      enemies: s.enemies.filter((e) => !e.dead), projectiles: s.projectiles, zones: s.zones.map(strip),
      pickups: s.pickups, spawnAcc: s.spawnAcc, eventIdx: s.eventIdx, nextId: s.nextId,
      pendingLevels: s.pendingLevels + (s.menu && s.menu.type === "levelup" ? 1 : 0),
      rerollsLeft: s.rerollsLeft, revivesLeft: s.revivesLeft, won: s.won,
      bonus: s.bonus || {}, pois: s.pois || [], poiTimer: s.poiTimer, propTimer: s.propTimer, challenge: s.challenge || null,
    });
  }
  function restore(json, opts) {
    let d;
    try { d = typeof json === "string" ? JSON.parse(json) : json; } catch (e) { return null; }
    if (!d || d.v !== SNAP_VERSION || !D.CHARACTERS[d.charId]) return null;
    // контент гри міг змінитись у новій версії — відкидаємо те, чого вже нема
    d.weapons = (d.weapons || []).filter((w) => D.WEAPONS[w.id]);
    d.passives = (d.passives || []).filter((p) => D.PASSIVES[p.id]);
    d.enemies = (d.enemies || []).filter((e) => D.ENEMIES[e.type]);
    d.pois = (d.pois || []).filter((o) => D.POIS[o.kind]);
    // зброя, яка більше не еволюціонує (блискавка), повертається до звичайної;
    // бонуси «понад межу» з минулих версій прибрано
    for (const w of d.weapons) if (w.evolved && !D.WEAPONS[w.id].evo) w.evolved = false;
    d.bonus = {};
    const s = create({ charId: d.charId, night: d.night || 0, meta: d.meta, viewW: opts.viewW, viewH: opts.viewH, seed: opts.seed });
    for (const k of ["t", "kills", "coins", "weapons", "passives", "enemies", "projectiles", "zones", "pickups", "spawnAcc",
      "eventIdx", "nextId", "pendingLevels", "rerollsLeft", "revivesLeft", "won", "bonus", "pois", "poiTimer", "propTimer", "challenge"]) if (d[k] !== undefined) s[k] = d[k];
    Object.assign(s.player, d.player);
    recomputeStats(s);
    s.player.hp = Math.min(Math.max(1, s.player.hp), s.stats.maxHp);
    s.player.inv = 2; // коротка невразливість після відновлення
    s.bossAlive = s.enemies.find((e) => e.boss) || null;
    for (const pr of s.projectiles) if (!Array.isArray(pr.hit)) pr.hit = [];
    return s;
  }

  // поріг досвіду після повного білду = сума рівнів 1–30
  for (let l = 1; l <= 30; l++) CAP_NEED += xpNeed(l);

  window.HordeCore = { create, step, choose, reroll, skip, openChest, chooseEvolve, evoCandidates, weaponStats, recomputeStats, setView, result, xpNeed, serialize, restore };
})();
