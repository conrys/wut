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
  function hpMul(s) { return 1 + (s.t / 60) * 0.16; }

  function spawnEnemy(s, type, x, y, opt) {
    const def = D.ENEMIES[type];
    const o = opt || {};
    const elite = !!o.elite, boss = !!def.boss;
    const mul = boss ? 1 : hpMul(s) * (elite ? 12 : 1);
    const e = {
      id: s.nextId++, type, x, y,
      r: def.r * (elite ? 1.8 : 1),
      hp: def.hp * mul, maxHp: def.hp * mul,
      spd: def.spd * (elite ? 0.9 : 1),
      dmg: def.dmg * (elite ? 1.5 : 1) * (boss ? 1 : 1 + s.t / 900),
      xp: def.xp * (elite ? 10 : 1),
      fly: !!def.fly, heavy: !!def.heavy || elite, elite, boss,
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

  function updateSpawning(s, dt) {
    const minute = Math.min(D.WAVES.length - 1, Math.floor(s.t / 60));
    const wave = D.WAVES[minute];
    // після фінальної хвилини орда товщає далі
    const over = Math.max(0, s.t - D.RUN_SECONDS);
    // на більшому огляді — більше ворогів, але на старті ліміт росте поступово
    const area = Math.min(2.4, Math.max(1, (s.viewW * s.viewH) / (390 * 720)));
    const ramp = Math.min(1, s.t / 240);
    const max = Math.round((wave.max + Math.floor(over / 10) * 5) * (1 + (area - 1) * ramp));
    let normal = 0;
    for (const e of s.enemies) if (!e.dead && !e.boss && !e.dirX && !e.dirY) normal++;
    s.spawnAcc += dt;
    // перші хвилини вороги підходять рідше: інтервал 0.7 с → 0.2 с до 5-ї хвилини
    const interval = Math.max(0.2, 0.7 - (s.t / 300) * 0.5);
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
      const e = spawnEnemy(s, ev.type, pos.x, pos.y, { elite: ev.kind === "elite" });
      s.events.push({ type: "announce", text: ev.kind === "boss" ? `Бос: ${D.ENEMIES[ev.type].name}!` : `Еліта: ${D.ENEMIES[ev.type].name}` , boss: ev.kind === "boss" });
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
        spawnEnemy(s, "skeleton", e.x + Math.cos(a) * 50, e.y + Math.sin(a) * 50);
      }
      s.fx.push({ kind: "ring", x: e.x, y: e.y, r: 70, t: 0, life: 0.5, color: "#7fd0ff" });
    }
    if (def.boss === "final" && e.ai > 4) { e.ai = 0; e.dash = 0.4; }
  }

  // Розштовхування натовпу — щоб не злипались в одну точку.
  function separate(s) {
    for (const e of s.enemies) {
      if (e.dead || e.fly) continue;
      forNear(s, e.x, e.y, e.r * 2, (o) => {
        if (o === e || o.fly || o.id < e.id) return;
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
    if (s.nums.length < 50) s.nums.push({ x: e.x + (s.rand() - 0.5) * 10, y: e.y - e.r, v: Math.round(dmg), t: 0 });
    if (e.hp <= 0) killEnemy(s, e);
    return dmg;
  }

  function killEnemy(s, e) {
    e.dead = true;
    s.kills++;
    s.fx.push({ kind: "puff", x: e.x, y: e.y, r: e.r, t: 0, life: 0.35, color: D.ENEMIES[e.type].color });
    const luck = s.stats.luck;
    if (e.boss) {
      s.bossAlive = null;
      dropPickup(s, "chest", e.x, e.y, 1);
      for (let i = 0; i < 8; i++) dropPickup(s, "coin", e.x + (s.rand() - 0.5) * 80, e.y + (s.rand() - 0.5) * 80, 10);
      if (D.ENEMIES[e.type].boss === "final") { s.won = true; finish(s, "victory"); return; }
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
      const items = openChest(s);
      s.menu = { type: "chest", items };
      s.events.push({ type: "chest", items });
    }
  }

  function gainXp(s, v) {
    const p = s.player;
    p.xp += v * s.stats.growth;
    while (p.xp >= p.need) {
      p.xp -= p.need;
      p.level++;
      p.need = xpNeed(p.level);
      s.pendingLevels++;
    }
  }
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
      if (e.dead) continue;
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
              if (ws.flags.lifesteal && healed < 4) { heal(s, 1); healed++; }
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
      const vis = s.enemies.filter((e) => !e.dead && onScreen(s, e));
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
      const vis = s.enemies.filter((e) => !e.dead && onScreen(s, e));
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
              if (e.dead) continue;
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
        if (ws.flags.heal && hits) heal(s, Math.min(3, hits * 0.25));
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
    const gold = Math.floor((s.coins + time * 0.4 + s.kills / 20 + (s.won ? 300 : 0)) * s.stats.greed);
    const score = time * 10 + s.kills + (s.won ? 5000 : 0);
    return { time, kills: s.kills, level: s.player.level, gold, score, won: s.won };
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
  function openChest(s) {
    const items = [];
    const count = s.rand() < 0.12 * s.stats.luck ? 3 : 1;
    for (let i = 0; i < count; i++) {
      const evo = s.weapons.find((w) => !w.evolved && w.level >= D.WEAPON_MAX_LEVEL && D.WEAPONS[w.id].evo &&
        s.passives.some((p) => p.id === D.WEAPONS[w.id].evo.with));
      if (evo) { const o = { kind: "evolve", id: evo.id }; apply(s, o); items.push(o); continue; }
      const pool = upgradePool(s).filter((o) => o.level > 1);
      if (pool.length) { const o = pool[Math.floor(s.rand() * pool.length)]; apply(s, o); items.push(o); continue; }
      const o = { kind: "gold", v: 50 }; apply(s, o); items.push(o);
    }
    return items;
  }

  function setView(s, w, h) { s.viewW = w; s.viewH = h; }

  window.HordeCore = { create, step, choose, reroll, skip, openChest, weaponStats, recomputeStats, setView, result, xpNeed };
})();
