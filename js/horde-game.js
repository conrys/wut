// ==========================================================================
// «Орда» — сторінка: ігровий цикл, ввід (джойстик/клавіатура), HUD, меню,
// крамниця, герої, збереження прогресу в localStorage (працює без мережі).
// Рекорд іде в спільні рекорди через AppScore, якщо гравець увійшов.
// ==========================================================================
(function () {
  const D = window.HordeData, C = window.HordeCore, R = window.HordeRender;
  const SAVE_KEY = "hordeSave";
  const STEP = 1 / 60;
  const $ = (id) => document.getElementById(id);

  const canvas = $("game"), ctx = canvas.getContext("2d"), area = $("gameArea");
  let W = 0, H = 0, DPR = 1;
  function resize() {
    W = area.clientWidth; H = area.clientHeight;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    if (state) C.setView(state, W, H);
  }

  // ---------- збереження ----------
  function loadSave() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); } catch (e) { s = null; }
    s = s || {};
    return {
      gold: s.gold | 0, shop: s.shop || {}, chars: Array.isArray(s.chars) ? s.chars : ["knight"],
      char: s.char && D.CHARACTERS[s.char] ? s.char : "knight",
      best: s.best || null, runs: s.runs | 0, wins: s.wins | 0,
    };
  }
  let save = loadSave();
  if (!save.chars.includes("knight")) save.chars.push("knight");
  function writeSave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }

  // ---------- стан ----------
  let state = null;
  let mode = "menu"; // menu | play | modal
  let modalQueue = [];
  let acc = 0, last = 0, T = 0;

  // ---------- ввід ----------
  const keys = new Set();
  const joy = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0, R: 52 };
  function local(e) { const r = area.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  canvas.addEventListener("pointerdown", (e) => {
    if (mode !== "play" || joy.active) return;
    const p = local(e);
    joy.active = true; joy.id = e.pointerId; joy.ox = p.x; joy.oy = p.y; joy.x = 0; joy.y = 0;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!joy.active || e.pointerId !== joy.id) return;
    const p = local(e);
    let dx = p.x - joy.ox, dy = p.y - joy.oy;
    const d = Math.hypot(dx, dy);
    if (d > joy.R) { // база джойстика повзе за пальцем
      joy.ox += dx / d * (d - joy.R); joy.oy += dy / d * (d - joy.R);
      dx = p.x - joy.ox; dy = p.y - joy.oy;
    }
    joy.x = dx / joy.R; joy.y = dy / joy.R;
  });
  const joyEnd = (e) => { if (e.pointerId === joy.id) { joy.active = false; joy.x = joy.y = 0; } };
  canvas.addEventListener("pointerup", joyEnd);
  canvas.addEventListener("pointercancel", joyEnd);
  document.addEventListener("keydown", (e) => {
    keys.add(e.code);
    if ((e.code === "Space" || e.code === "Escape" || e.code === "KeyP") && (mode === "play" || openId === "scrPause")) {
      e.preventDefault();
      if (mode === "play") pause(); else resume();
    }
  });
  document.addEventListener("keyup", (e) => keys.delete(e.code));
  function input() {
    let x = 0, y = 0;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) x -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) x += 1;
    if (keys.has("KeyW") || keys.has("ArrowUp")) y -= 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) y += 1;
    if (joy.active) { x += joy.x; y += joy.y; }
    return { x, y };
  }

  // ---------- екрани ----------
  let openId = "scrMenu";
  function show(id) {
    for (const el of document.querySelectorAll(".screen")) el.classList.toggle("on", el.id === id);
    openId = id;
  }
  function hideScreens() { show(null); }
  for (const b of document.querySelectorAll("[data-back]")) b.addEventListener("click", openMenu);

  function fmtTime(sec) { sec = Math.max(0, Math.floor(sec)); return String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(sec % 60).padStart(2, "0"); }
  function goldText(v) { return "● " + v; }

  function openMenu() {
    mode = "menu";
    $("hud").classList.remove("on");
    $("menuGold").textContent = goldText(save.gold);
    const b = save.best;
    $("menuBest").innerHTML = b
      ? `Найкраще: ${fmtTime(b.time)} · ☠ ${b.kills} · рахунок ${b.score}<br>Забігів: ${save.runs}${save.wins ? ` · перемог: ${save.wins}` : ""}`
      : "Ще жодного забігу";
    const ch = D.CHARACTERS[save.char];
    $("btnPlay").textContent = `Грати · ${ch.name}`;
    show("scrMenu");
  }

  // ---------- герої ----------
  function heroPortrait(c, id) {
    const ch = D.CHARACTERS[id];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = 64 * dpr; c.height = 64 * dpr;
    const g = c.getContext("2d");
    g.scale(dpr * 2, dpr * 2);
    g.translate(16, 18);
    g.fillStyle = "rgba(0,0,0,.3)"; g.beginPath(); g.ellipse(0, 12, 11, 4, 0, 0, 6.283); g.fill();
    g.fillStyle = ch.cape; g.beginPath(); g.moveTo(-6, -6); g.quadraticCurveTo(-15, 4, -11, 12); g.lineTo(4, 12); g.closePath(); g.fill();
    g.fillStyle = ch.color; g.globalAlpha = 0.8; g.fillRect(-8, -2, 16, 14); g.globalAlpha = 1;
    g.beginPath(); g.arc(0, -8, 9, 0, 6.283); g.fill();
    g.fillStyle = "#1a1c22"; g.fillRect(1, -10, 7, 4);
    g.fillStyle = "#fff"; g.fillRect(5, -9.5, 1.6, 1.6);
  }
  function openHeroes() {
    $("heroGold").textContent = goldText(save.gold);
    const list = $("heroList");
    list.innerHTML = "";
    for (const id in D.CHARACTERS) {
      const ch = D.CHARACTERS[id];
      const owned = save.chars.includes(id);
      const el = document.createElement("button");
      el.className = "hero" + (save.char === id ? " sel" : "") + (owned ? "" : " locked");
      const wpn = D.WEAPONS[ch.weapon];
      el.innerHTML = `<canvas></canvas><b>${ch.name}</b><span>${wpn.icon} ${wpn.name}<br>${ch.perk}</span>` +
        (owned ? (save.char === id ? `<div class="price">Обрано</div>` : `<div class="price no">Обрати</div>`)
               : `<div class="price${save.gold >= ch.cost ? "" : " no"}">🔒 ● ${ch.cost}</div>`);
      heroPortrait(el.querySelector("canvas"), id);
      el.addEventListener("click", () => {
        if (owned) { save.char = id; writeSave(); openHeroes(); return; }
        if (save.gold < ch.cost) return;
        save.gold -= ch.cost; save.chars.push(id); save.char = id; writeSave(); openHeroes();
      });
      list.appendChild(el);
    }
    show("scrHeroes");
  }

  // ---------- крамниця ----------
  function shopCost(def, lvl) { return def.cost * (lvl + 1); }
  function openShop() {
    $("shopGold").textContent = goldText(save.gold);
    const list = $("shopList");
    list.innerHTML = "";
    for (const id in D.SHOP) {
      const def = D.SHOP[id];
      const lvl = save.shop[id] | 0;
      const maxed = lvl >= def.max;
      const cost = shopCost(def, lvl);
      const row = document.createElement("div");
      row.className = "row";
      let pips = "";
      for (let i = 0; i < def.max; i++) pips += `<i class="${i < lvl ? "on" : ""}"></i>`;
      row.innerHTML = `<div class="ico">${def.icon}</div><div><b>${def.name}</b><span>${def.desc}</span><div class="pips">${pips}</div></div>` +
        `<button class="buy" ${maxed || save.gold < cost ? "disabled" : ""}>${maxed ? "МАКС" : "● " + cost}</button>`;
      row.querySelector(".buy").addEventListener("click", () => {
        if (maxed || save.gold < cost) return;
        save.gold -= cost; save.shop[id] = lvl + 1; writeSave(); openShop();
      });
      list.appendChild(row);
    }
    show("scrShop");
  }

  // ---------- забіг ----------
  function startRun() {
    resize();
    state = C.create({ charId: save.char, meta: save.shop, viewW: W, viewH: H, seed: (Date.now() ^ (Math.random() * 1e9)) >>> 0 });
    modalQueue = [];
    mode = "play";
    acc = 0;
    hideScreens();
    $("hud").classList.add("on");
    lastHud = {};
    renderSlots();
  }

  function pause() {
    if (mode !== "play") return;
    mode = "modal";
    joy.active = false;
    const s = state;
    $("pauseStats").innerHTML = statBoxes([[fmtTime(s.t), "час"], ["☠ " + s.kills, "вбито"], ["Рів. " + s.player.level, "рівень"], [Math.ceil(s.player.hp) + "/" + s.stats.maxHp, "здоров'я"]]);
    $("pauseBuild").innerHTML = buildList(s);
    show("scrPause");
  }
  function resume() { hideScreens(); mode = "play"; nextModal(); }
  $("pauseBtn").addEventListener("click", pause);
  $("btnResume").addEventListener("click", resume);
  $("btnGiveUp").addEventListener("click", () => { state.over = true; endRun({ type: "gameover", result: C.result(state) }); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });

  function statBoxes(arr, goldIdx) {
    return arr.map((a, i) => `<div class="${i === goldIdx ? "gold" : ""}"><b>${a[0]}</b><span>${a[1]}</span></div>`).join("");
  }
  function buildList(s) {
    let html = "";
    for (const w of s.weapons) {
      const def = D.WEAPONS[w.id];
      const evoName = w.evolved ? def.evo.name : def.name;
      const has = def.evo && s.passives.some((p) => p.id === def.evo.with);
      const hint = !w.evolved && def.evo ? `<small class="${has ? "ready" : ""}">Еволюція: рів. 8 + ${D.PASSIVES[def.evo.with].icon} ${D.PASSIVES[def.evo.with].name}${has ? " ✓" : ""} → ${def.evo.name}</small>` : "";
      html += `<div class="it"><span class="ic">${w.evolved ? def.evo.icon : def.icon}</span><div>${evoName}${hint}</div><em>${w.evolved ? "ЕВО" : "рів. " + w.level}</em></div>`;
    }
    for (const p of s.passives) {
      const def = D.PASSIVES[p.id];
      html += `<div class="it"><span class="ic">${def.icon}</span><div>${def.name}<small>${def.desc}</small></div><em>рів. ${p.level}</em></div>`;
    }
    return html;
  }

  // ---------- описи апгрейдів ----------
  const UNIT = { sword: "удар", wand: "стріла", knife: "кинджал", axe: "сокира", pool: "калюжа", orbit: "книга", bolt: "блискавка", aura: "" };
  function levelText(o) {
    if (o.kind === "passive") return D.PASSIVES[o.id].desc;
    if (o.kind === "gold") return `+${o.v} золота`;
    if (o.kind === "food") return `+${o.v} здоров'я`;
    const def = D.WEAPONS[o.id];
    if (o.kind === "evolve") return def.evo.desc;
    if (o.level === 1) return def.desc;
    const d = def.levels[o.level - 2] || {};
    const parts = [];
    if (d.amount) parts.push(`+${d.amount} ${UNIT[def.behavior] || "снаряд"}`);
    if (d.dmg) parts.push(`+${d.dmg} шкоди`);
    if (d.cd) parts.push(`${d.cd} с перезарядки`);
    if (d.area) parts.push(`+${Math.round(d.area * 100)}% області`);
    if (d.speed) parts.push(`+${Math.round(d.speed * 100)}% швидкості`);
    if (d.duration) parts.push(`+${d.duration} с тривалості`);
    if (d.pierce) parts.push(`+${d.pierce} пробиття`);
    return parts.join(", ");
  }
  function cardHtml(o) {
    let icon, name, tag = "", cls = "card", extra = "";
    if (o.kind === "weapon") {
      const def = D.WEAPONS[o.id];
      icon = def.icon; name = def.name;
      tag = o.level === 1 ? `<small class="new">нове</small>` : `<small>рів. ${o.level}</small>`;
      if (o.level === D.WEAPON_MAX_LEVEL && def.evo) {
        const p = D.PASSIVES[def.evo.with];
        extra = `<div class="evo-hint">Далі еволюція зі скрині, якщо маєш ${p.icon} ${p.name}</div>`;
      }
    } else if (o.kind === "passive") {
      const def = D.PASSIVES[o.id];
      icon = def.icon; name = def.name;
      tag = o.level === 1 ? `<small class="new">нове</small>` : `<small>рів. ${o.level}</small>`;
    } else if (o.kind === "evolve") {
      const def = D.WEAPONS[o.id];
      icon = def.evo.icon; name = def.evo.name; tag = `<small>еволюція</small>`; cls += " evolve";
    } else if (o.kind === "gold") { icon = "💰"; name = "Золото"; }
    else { icon = "🍗"; name = "Окіст"; }
    return { cls, html: `<div class="ico">${icon}</div><div><div class="t">${name} ${tag}</div><div class="d">${levelText(o)}</div>${extra}</div>` };
  }

  function showLevelUp(options) {
    mode = "modal";
    joy.active = false;
    const box = $("levelCards");
    box.innerHTML = "";
    for (const o of options) {
      const c = cardHtml(o);
      const el = document.createElement("button");
      el.className = c.cls; el.innerHTML = c.html;
      el.addEventListener("click", () => {
        C.choose(state, o);
        renderSlots();
        afterModal();
      }, { once: true });
      box.appendChild(el);
    }
    $("levelSub").textContent = `Рівень ${state.player.level - state.pendingLevels}`;
    const rb = $("btnReroll");
    rb.textContent = `🎲 Перекинути (${state.rerollsLeft})`;
    rb.style.display = state.rerollsLeft > 0 ? "" : "none";
    show("scrLevel");
  }
  $("btnReroll").addEventListener("click", () => {
    const opts = C.reroll(state);
    if (opts) showLevelUp(opts);
  });
  $("btnSkip").addEventListener("click", () => { C.skip(state); afterModal(); });

  function showChest(items) {
    mode = "modal";
    joy.active = false;
    const box = $("chestCards");
    box.innerHTML = "";
    for (const o of items) {
      const c = cardHtml(o);
      const el = document.createElement("div");
      el.className = c.cls; el.innerHTML = c.html;
      box.appendChild(el);
    }
    show("scrChest");
  }
  $("btnChestOk").addEventListener("click", () => { C.skip(state); renderSlots(); afterModal(); });

  // Після закриття вікна: новий level-up/скриня могли з'явитись у ядрі.
  function afterModal() {
    hideScreens();
    mode = "play";
    if (state.menu && state.menu.type === "levelup") { showLevelUp(state.menu.options); return; }
    nextModal();
  }
  function nextModal() {
    while (modalQueue.length && mode === "play") {
      const ev = modalQueue.shift();
      if (ev.type === "levelup" && state.menu && state.menu.type === "levelup") showLevelUp(state.menu.options);
      else if (ev.type === "chest") showChest(ev.items);
    }
  }

  let annTimer = 0;
  function announce(text, boss) {
    const el = $("announce");
    el.textContent = text;
    el.className = "on" + (boss ? " boss" : "");
    clearTimeout(annTimer);
    annTimer = setTimeout(() => { el.className = boss ? "boss" : ""; }, 2200);
  }

  let lastHurtBuzz = 0;
  function handleEvents() {
    const evs = state.events;
    if (!evs.length) return;
    state.events = [];
    for (const ev of evs) {
      if (ev.type === "announce") announce(ev.text, ev.boss);
      else if (ev.type === "hurt") {
        const now = performance.now();
        if (navigator.vibrate && now - lastHurtBuzz > 400) { lastHurtBuzz = now; try { navigator.vibrate(25); } catch (_) {} }
      }
      else if (ev.type === "levelup" || ev.type === "chest") modalQueue.push(ev);
      else if (ev.type === "gameover" || ev.type === "victory") { endRun(ev); return; }
    }
    if (mode === "play") nextModal();
  }

  function endRun(ev) {
    mode = "modal";
    modalQueue = [];
    const r = ev.result;
    save.gold += r.gold;
    save.runs++;
    if (r.won) save.wins++;
    const isBest = !save.best || r.score > save.best.score;
    if (isBest) save.best = { score: r.score, time: r.time, kills: r.kills, level: r.level, char: state.charId };
    writeSave();
    if (window.AppScore) { try { window.AppScore.sendScore("horde", r.score); } catch (_) {} }

    $("resTitle").textContent = r.won ? "Перемога!" : "Тебе здолали";
    $("resSub").textContent = r.won ? "Жнець упав. Орда розбіглась — до наступної ночі." : (isBest ? "Новий особистий рекорд!" : `Рахунок: ${r.score}`);
    $("resStats").innerHTML = statBoxes([[fmtTime(r.time), "протримався"], ["☠ " + r.kills, "вбито"], ["Рів. " + r.level, "рівень"], ["+" + r.gold, "золота"]], 3);
    $("resBuild").innerHTML = buildList(state);
    $("hud").classList.remove("on");
    show("scrResult");
  }
  $("btnAgain").addEventListener("click", startRun);
  $("btnMenu").addEventListener("click", openMenu);
  $("btnPlay").addEventListener("click", startRun);
  $("btnHeroes").addEventListener("click", openHeroes);
  $("btnShop").addEventListener("click", openShop);

  // ---------- HUD ----------
  let lastHud = {};
  function setText(id, v) { if (lastHud[id] !== v) { lastHud[id] = v; $(id).textContent = v; } }
  function updateHud() {
    const s = state, p = s.player;
    setText("timer", fmtTime(s.t));
    setText("kills", "☠ " + s.kills);
    setText("coins", "● " + s.coins);
    setText("lvl", "РІВ. " + p.level);
    const w = Math.min(100, (p.xp / p.need) * 100).toFixed(1) + "%";
    if (lastHud.xp !== w) { lastHud.xp = w; $("xpFill").style.width = w; }
    let sig = "";
    for (const x of s.weapons) sig += x.id + x.level + (x.evolved ? "E" : "");
    for (const x of s.passives) sig += x.id + x.level;
    if (lastHud.slots !== sig) { lastHud.slots = sig; renderSlots(); }
  }
  function renderSlots() {
    if (!state) return;
    let html = "";
    for (const w of state.weapons) {
      const def = D.WEAPONS[w.id];
      html += `<span class="${w.evolved ? "evo" : ""}">${w.evolved ? def.evo.icon : def.icon}<em>${w.evolved ? "" : w.level}</em></span>`;
    }
    for (const p of state.passives) html += `<span>${D.PASSIVES[p.id].icon}<em>${p.level}</em></span>`;
    $("slots").innerHTML = html;
  }

  // ---------- фон для меню: порожній світ ----------
  let menuState = null;
  function menuBackdrop(dt) {
    if (!menuState) {
      menuState = C.create({ charId: save.char, viewW: W, viewH: H, seed: 7 });
      menuState.weapons = [];
    }
    menuState.player.x += dt * 30; menuState.player.moving = true; menuState.player.fx = 1;
    menuState.t += dt;
    return menuState;
  }

  // ---------- цикл ----------
  function frame(now) {
    const dt = Math.min(0.1, (now - (last || now)) / 1000);
    last = now;
    T += dt;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (mode === "play" && state) {
      acc += dt;
      let n = 0;
      const inp = input();
      while (acc >= STEP && n < 5) {
        C.step(state, inp, STEP);
        acc -= STEP; n++;
        if (state.events.length) { handleEvents(); if (mode !== "play") { acc = 0; break; } }
      }
      if (n >= 5) acc = 0;
      updateHud();
    }
    const view = { W, H, dpr: DPR };
    if (state && mode !== "menu") R.render(ctx, state, view, T, mode === "play" ? joy : null);
    else R.render(ctx, menuBackdrop(dt), Object.assign({ noPlayer: true }, view), T, null);
    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(area);
  resize();
  openMenu();
  requestAnimationFrame(frame);

  document.addEventListener("contextmenu", (e) => e.preventDefault());
  window.HordeGame = { get state() { return state; }, startRun, get save() { return save; } };
})();
