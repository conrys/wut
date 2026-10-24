// ==========================================================================
// «Орда» — сторінка: ігровий цикл, ввід (джойстик/клавіатура), HUD, меню,
// налаштування, крамниця, герої, збереження прогресу в localStorage
// (працює без мережі). Рекорд іде в спільні рекорди через AppScore.
// ==========================================================================
(function () {
  const D = window.HordeData, C = window.HordeCore, HR = window.HordeRender;
  const SAVE_KEY = "hordeSave";
  const STEP = 1 / 60;
  const $ = (id) => document.getElementById(id);

  const canvas = $("game"), area = $("gameArea");
  const R = HR.create(canvas);
  let W = 0, H = 0, view = { viewW: 560, viewH: 1000 };
  function resize() {
    W = area.clientWidth; H = area.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    view = R.resize(W, H, dpr);
    frozenDrawn = false;
    if (state) C.setView(state, view.viewW, view.viewH);
    if (menuState) C.setView(menuState, view.viewW, view.viewH);
  }

  // ---------- збереження ----------
  const DEFAULT_SETTINGS = { joy: "touch", joySize: "m", numbers: true, shake: true, vibrate: true };
  function loadSave() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); } catch (e) { s = null; }
    s = s || {};
    return {
      gold: s.gold | 0, shop: s.shop || {}, chars: Array.isArray(s.chars) ? s.chars : ["knight"],
      char: s.char && D.CHARACTERS[s.char] ? s.char : "knight",
      best: s.best || null, runs: s.runs | 0, wins: s.wins | 0,
      settings: Object.assign({}, DEFAULT_SETTINGS, s.settings || {}),
    };
  }
  let save = loadSave();
  if (!save.chars.includes("knight")) save.chars.push("knight");
  function writeSave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }
  // просимо браузер не чистити сховище сайту самому (де підтримується)
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}

  // Поточний забіг зберігається окремим ключем кожні 3 с, при згортанні й
  // закритті сторінки. Оновлення сторінки чи нова версія гри повертають у той
  // самий забіг (на екран паузи). Прогрес крамниці/героїв — у hordeSave.
  const RUN_KEY = "hordeRun";
  function applyResult(r) {
    save.gold += r.gold;
    save.runs++;
    if (r.won) save.wins++;
    const isBest = !save.best || r.score > save.best.score;
    if (isBest) save.best = { score: r.score, time: r.time, kills: r.kills, level: r.level, char: r.char };
    return isBest;
  }
  function saveRun() {
    if (!state || state.over || mode === "menu") return;
    try { localStorage.setItem(RUN_KEY, C.serialize(state)); } catch (e) {}
  }
  function clearRun() { try { localStorage.removeItem(RUN_KEY); } catch (e) {} }
  function loadRun() { try { return localStorage.getItem(RUN_KEY); } catch (e) { return null; } }
  setInterval(saveRun, 3000);
  window.addEventListener("pagehide", saveRun);
  // стара версія збереження (лише результат) — зараховуємо, щоб не пропало
  if (save.pending) { save.pending.char = save.pending.char || save.char; applyResult(save.pending); delete save.pending; writeSave(); }
  const set = () => save.settings;

  // ---------- стан ----------
  let state = null, menuState = null;
  let mode = "menu"; // menu | play | modal
  let modalQueue = [];
  let acc = 0, last = 0, T = 0;

  // ---------- іконки ----------
  const SHOP_ICON = { might: "might", maxHp: "heart", armor: "armor", regen: "regen", cooldown: "tome", area: "candle", moveSpeed: "boots",
    magnet: "magnet", growth: "scroll", greed: "greed", luck: "clover", rerolls: "dice", revivals: "feather" };
  const img = (name, gold, cls) => `<img class="px ${cls || ""}" alt="" src="${HR.iconURL(name, gold)}">`;

  // ---------- ввід: джойстик у трьох режимах ----------
  const JOY_SIZES = { s: 40, m: 52, l: 66 };
  const keys = new Set();
  const joy = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0, R: 52, always: false };
  function local(e) { const r = area.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function fixedBase() { return { x: W / 2, y: H - JOY_SIZES[set().joySize] - 46 }; }
  function syncJoy() {
    joy.R = JOY_SIZES[set().joySize] || 52;
    joy.always = set().joy === "fixed";
    if (joy.always && !joy.active) { const b = fixedBase(); joy.ox = b.x; joy.oy = b.y; joy.x = joy.y = 0; }
  }
  function aim(p) {
    let dx = p.x - joy.ox, dy = p.y - joy.oy;
    const d = Math.hypot(dx, dy);
    if (set().joy === "follow" && d > joy.R) { // база повзе за пальцем
      joy.ox += dx / d * (d - joy.R); joy.oy += dy / d * (d - joy.R);
      dx = p.x - joy.ox; dy = p.y - joy.oy;
    }
    const m = Math.hypot(dx, dy) / joy.R;
    if (m > 1) { dx /= m; dy /= m; }
    joy.x = dx / joy.R; joy.y = dy / joy.R;
    if (Math.hypot(joy.x, joy.y) < 0.12) joy.x = joy.y = 0; // мертва зона
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (mode !== "play" || joy.active) return;
    const p = local(e);
    joy.active = true; joy.id = e.pointerId;
    if (set().joy === "fixed") { const b = fixedBase(); joy.ox = b.x; joy.oy = b.y; aim(p); }
    else { joy.ox = p.x; joy.oy = p.y; joy.x = joy.y = 0; }
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!joy.active || e.pointerId !== joy.id) return;
    aim(local(e));
  });
  const joyEnd = (e) => { if (e.pointerId === joy.id) { joy.active = false; joy.x = joy.y = 0; syncJoy(); } };
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
    if (id) $("announce").className = "";
  }
  function hideScreens() { show(null); }
  for (const b of document.querySelectorAll("[data-back]")) b.addEventListener("click", openMenu);

  function fmtTime(sec) { sec = Math.max(0, Math.floor(sec)); return String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(sec % 60).padStart(2, "0"); }
  function goldHtml(v) { return img("gold") + `<span>${v}</span>`; }

  function openMenu() {
    mode = "menu";
    $("challenge").hidden = true;
    $("hud").classList.remove("on");
    $("menuGold").innerHTML = goldHtml(save.gold);
    const b = save.best;
    $("menuBest").innerHTML = b
      ? `Найкраще: ${fmtTime(b.time)} · ${b.kills} вбито · рахунок ${b.score}<br>Забігів: ${save.runs}${save.wins ? ` · перемог: ${save.wins}` : ""}`
      : "Ще жодного забігу";
    const canBuy = Object.keys(D.SHOP).some((id) => (save.shop[id] | 0) < D.SHOP[id].max && save.gold >= shopCost(D.SHOP[id], save.shop[id] | 0))
      || Object.keys(D.CHARACTERS).some((id) => !save.chars.includes(id) && save.gold >= D.CHARACTERS[id].cost);
    $("btnShop").classList.toggle("badge", canBuy);
    $("btnHeroes").classList.toggle("badge", Object.keys(D.CHARACTERS).some((id) => !save.chars.includes(id) && save.gold >= D.CHARACTERS[id].cost));
    const saved = loadRun();
    let savedInfo = null;
    if (saved) { try { const d = JSON.parse(saved); savedInfo = d && d.t > 0 ? d : null; } catch (e) {} }
    $("btnContinue").hidden = !savedInfo;
    if (savedInfo) $("btnContinue").textContent = `Продовжити забіг · ${fmtTime(savedInfo.t)}`;
    $("btnPlay").textContent = savedInfo ? "Новий забіг" : "Грати";
    $("btnPlay").classList.toggle("main", !savedInfo);
    $("menuHero").innerHTML = `<img class="px hero-big" alt="" src="${HR.heroURL(save.char)}"><b>${D.CHARACTERS[save.char].name}</b>`;
    show("scrMenu");
  }

  // ---------- налаштування ----------
  let settingsBack = "menu";
  const SETTINGS_UI = [
    { key: "joy", label: "Джойстик", opts: [["touch", "Під пальцем"], ["fixed", "Фіксований"], ["follow", "Тягнеться"]],
      hint: { touch: "З'являється там, де торкнувся, і стоїть на місці.", fixed: "Завжди внизу екрана. Керуй, торкаючись будь-де.", follow: "Основа повзе за пальцем, якщо відвести далеко." } },
    { key: "joySize", label: "Розмір джойстика", opts: [["s", "Малий"], ["m", "Середній"], ["l", "Великий"]] },
    { key: "numbers", label: "Цифри шкоди", opts: [[true, "Так"], [false, "Ні"]] },
    { key: "shake", label: "Тремтіння екрана", opts: [[true, "Так"], [false, "Ні"]] },
    { key: "vibrate", label: "Вібрація", opts: [[true, "Так"], [false, "Ні"]] },
  ];
  function openSettings(from) {
    settingsBack = from || "menu";
    const box = $("settingsList");
    box.innerHTML = "";
    for (const row of SETTINGS_UI) {
      const el = document.createElement("div");
      el.className = "set-row";
      const cur = set()[row.key];
      el.innerHTML = `<div class="set-label">${row.label}</div><div class="seg">${row.opts.map(([v, t]) =>
        `<button type="button" class="${v === cur ? "on" : ""}" data-v="${v}">${t}</button>`).join("")}</div>` +
        (row.hint ? `<div class="set-hint">${row.hint[cur] || ""}</div>` : "");
      el.querySelectorAll("button").forEach((b, i) => b.addEventListener("click", () => {
        set()[row.key] = row.opts[i][0];
        writeSave(); syncJoy(); openSettings(settingsBack);
      }));
      box.appendChild(el);
    }
    show("scrSettings");
  }
  $("btnSettings").addEventListener("click", () => openSettings("menu"));
  $("btnPauseSettings").addEventListener("click", () => openSettings("pause"));
  $("btnSettingsBack").addEventListener("click", () => { if (settingsBack === "pause") show("scrPause"); else openMenu(); });

  // ---------- герої ----------
  function openHeroes() {
    $("heroGold").innerHTML = goldHtml(save.gold);
    const list = $("heroList");
    list.innerHTML = "";
    for (const id in D.CHARACTERS) {
      const ch = D.CHARACTERS[id];
      const owned = save.chars.includes(id);
      const el = document.createElement("button");
      el.type = "button";
      el.className = "hero" + (save.char === id ? " sel" : "") + (owned ? "" : " locked");
      const wpn = D.WEAPONS[ch.weapon];
      el.innerHTML = `<img class="px hero-img" alt="" src="${HR.heroURL(id)}"><b>${ch.name}</b>` +
        `<span class="hero-wpn">${img(ch.weapon, false, "sm")}${wpn.name}</span><span>${ch.perk}</span>` +
        (owned ? `<div class="price">${save.char === id ? "Обрано" : "Обрати"}</div>`
               : `<div class="price${save.gold >= ch.cost ? " can" : ""}">${img("gold", false, "sm")}${ch.cost}</div>`);
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
    $("shopGold").innerHTML = goldHtml(save.gold);
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
      row.innerHTML = `${img(SHOP_ICON[id] || "skull", false, "ico")}<div class="row-txt"><b>${def.name}</b><span>${def.desc}</span><div class="pips">${pips}</div></div>` +
        `<button type="button" class="buy" ${maxed || save.gold < cost ? "disabled" : ""}>${maxed ? "МАКС" : img("gold", false, "sm") + cost}</button>`;
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
    // почали новий, а старий не дограли — зараховуємо його результат
    const old = loadRun() && C.restore(loadRun(), { viewW: view.viewW, viewH: view.viewH, seed: 1 });
    if (old && !(state && state.over === false && mode !== "menu")) { const r = C.result(old); r.char = old.charId; applyResult(r); writeSave(); }
    clearRun();
    state = C.create({ charId: save.char, meta: save.shop, viewW: view.viewW, viewH: view.viewH, seed: (Date.now() ^ (Math.random() * 1e9)) >>> 0 });
    modalQueue = [];
    mode = "play";
    acc = 0;
    syncJoy();
    hideScreens();
    $("hud").classList.add("on");
    lastHud = {};
  }

  function pause() {
    if (mode !== "play") return;
    mode = "modal";
    joy.active = false; syncJoy();
    const s = state;
    $("pauseStats").innerHTML = statBoxes([[fmtTime(s.t), "час"], [s.kills, "вбито"], [s.player.level, "рівень"], [Math.ceil(s.player.hp), "здоров'я"]]);
    $("pauseStrip").innerHTML = stripHtml(s);
    $("pauseBuild").innerHTML = buildList(s);
    $("pauseHero").innerHTML = statsHtml(s);
    setDetails("pause", false);
    show("scrPause");
  }
  function resume() { hideScreens(); mode = "play"; nextModal(); }
  $("pauseBtn").addEventListener("click", pause);
  $("btnResume").addEventListener("click", resume);
  $("btnGiveUp").addEventListener("click", () => { state.over = true; endRun({ type: "gameover", result: C.result(state) }); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { saveRun(); pause(); } });

  // Стисло — значки спорядження; розгорнута статистика лише по кнопці «Детальніше».
  function stripHtml(s) {
    let html = "";
    for (const w of s.weapons) html += `<span class="${w.evolved ? "evo" : ""}">${img(w.id, w.evolved)}<em>${w.evolved ? "" : w.level}</em></span>`;
    if (s.passives.length) html += `<i class="gap"></i>`;
    for (const p of s.passives) html += `<span>${img(p.id)}<em>${p.level}</em></span>`;
    return html;
  }
  function setDetails(which, open) {
    const box = $(which + "Details"), btn = $(which === "pause" ? "btnPauseMore" : "btnResMore");
    box.hidden = !open;
    btn.textContent = open ? "Сховати деталі" : "Детальніше";
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  }
  $("btnPauseMore").addEventListener("click", () => setDetails("pause", $("pauseDetails").hidden));
  $("btnResMore").addEventListener("click", () => setDetails("res", $("resDetails").hidden));
  function statBoxes(arr, goldIdx) {
    return arr.map((a, i) => `<div class="${i === goldIdx ? "gold" : ""}"><b>${a[0]}</b><span>${a[1]}</span></div>`).join("");
  }
  function buildList(s) {
    let html = "";
    for (const w of s.weapons) {
      const def = D.WEAPONS[w.id];
      const has = def.evo && s.passives.some((p) => p.id === def.evo.with);
      const ev = def.evo && D.PASSIVES[def.evo.with];
      const hint = !w.evolved && def.evo ? `<small class="${has ? "ready" : ""}">Еволюція: рів. 8 + ${ev.name}${has ? " ✓" : ""} → ${def.evo.name}</small>` : "";
      html += `<div class="it">${img(w.id, w.evolved)}<div class="it-txt">${w.evolved ? def.evo.name : def.name}${hint}</div><em>${w.evolved ? "ЕВО" : "рів. " + w.level}</em></div>`;
    }
    for (const p of s.passives) {
      const def = D.PASSIVES[p.id];
      html += `<div class="it">${img(p.id)}<div class="it-txt">${def.name}<small>${def.desc}</small></div><em>рів. ${p.level}</em></div>`;
    }
    return html;
  }

  // ---------- описи апгрейдів ----------
  const UNIT = { sword: "удар", wand: "стріла", knife: "кинджал", axe: "сокира", pool: "калюжа", orbit: "книга", bolt: "блискавка", aura: "" };
  const fmt = (v) => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));
  // Що зміниться насправді, з урахуванням усіх посилень: «Шкода 22 → 28».
  function weaponDelta(o) {
    const cur = C.weaponStats(state, { id: o.id, level: o.level - 1, evolved: false });
    const nxt = C.weaponStats(state, { id: o.id, level: o.level, evolved: false });
    const def = D.WEAPONS[o.id];
    const parts = [];
    if (nxt.dmg !== cur.dmg) parts.push(`Шкода ${fmt(cur.dmg)} → <b>${fmt(nxt.dmg)}</b>`);
    if (nxt.amount !== cur.amount) parts.push(`${UNIT_CAP[def.behavior] || "Снарядів"} ${cur.amount} → <b>${nxt.amount}</b>`);
    if (nxt.cd !== cur.cd) parts.push(`${def.behavior === "aura" ? "Тік" : "Перезарядка"} ${cur.cd.toFixed(2)} → <b>${nxt.cd.toFixed(2)} с</b>`);
    if (nxt.area !== cur.area) parts.push(`Область +${Math.round((nxt.area / cur.area - 1) * 100)}%`);
    if (nxt.speed !== cur.speed) parts.push(`Швидкість +${Math.round((nxt.speed / cur.speed - 1) * 100)}%`);
    if (nxt.duration !== cur.duration) parts.push(`Тривалість ${fmt(cur.duration)} → <b>${fmt(nxt.duration)} с</b>`);
    if (nxt.pierce !== cur.pierce && nxt.pierce < 500) parts.push(`Пробиття ${cur.pierce} → <b>${nxt.pierce}</b>`);
    return parts.join(" · ");
  }
  const UNIT_CAP = { sword: "Ударів", wand: "Стріл", knife: "Кинджалів", axe: "Сокир", pool: "Калюж", orbit: "Книг", bolt: "Блискавок", aura: "" };
  function levelText(o) {
    if (o.kind === "passive") {
      const def = D.PASSIVES[o.id];
      const v = state.stats[def.stat];
      const show = (x) => STAT_FMT[def.stat] ? STAT_FMT[def.stat](x) : fmt(x);
      return `${def.desc}<br><span class="now">${STAT_NAME[def.stat]}: ${show(v)} → <b>${show(v + def.per)}</b></span>`;
    }
    if (o.kind === "bonus") return o.text || "";
    if (o.kind === "gold") return `+${o.v} золота`;
    if (o.kind === "food") return `+${o.v} здоров'я`;
    const def = D.WEAPONS[o.id];
    if (o.kind === "evolve") return def.evo.desc;
    if (o.level === 1) {
      const ws = C.weaponStats(state, { id: o.id, level: 1, evolved: false });
      return `${def.desc}<br><span class="now">Шкода ${fmt(ws.dmg)} · кожні ${ws.cd.toFixed(1)} с</span>`;
    }
    return weaponDelta(o);
  }
  // Характеристики героя: назви й формат (множники — у відсотках від бази)
  const pct = (x) => (x >= 1 ? "+" : "−") + Math.round(Math.abs(x - 1) * 100) + "%";
  const STAT_NAME = { might: "Шкода", cooldown: "Перезарядка", area: "Область", speed: "Швидкість снарядів", duration: "Тривалість",
    amount: "Додаткові снаряди", maxHp: "Здоров'я", armor: "Броня", regen: "Відновлення", moveSpeed: "Швидкість руху",
    magnet: "Радіус збору", growth: "Досвід", greed: "Золото", luck: "Удача" };
  const STAT_FMT = { might: pct, cooldown: pct, area: pct, speed: pct, duration: pct, moveSpeed: pct, magnet: pct, growth: pct, greed: pct, luck: pct,
    amount: (x) => "+" + fmt(x), armor: (x) => fmt(x), maxHp: (x) => fmt(x), regen: (x) => fmt(x) + "/с" };
  function statsHtml(s) {
    const st = s.stats, base = { might: 1, cooldown: 1, area: 1, speed: 1, duration: 1, amount: 0, armor: 0, regen: 0, moveSpeed: 1, magnet: 1, growth: 1, greed: 1, luck: 1 };
    const keys = ["might", "cooldown", "area", "amount", "speed", "duration", "maxHp", "armor", "regen", "moveSpeed", "magnet", "growth", "greed", "luck"];
    return keys.map((k) => {
      const changed = k === "maxHp" ? true : Math.abs(st[k] - base[k]) > 1e-6;
      return `<div class="${changed ? "on" : ""}"><span>${STAT_NAME[k]}</span><b>${STAT_FMT[k](st[k])}</b></div>`;
    }).join("");
  }
  function cardHtml(o) {
    let icon, name, tag = "", cls = "card", extra = "";
    if (o.kind === "weapon") {
      const def = D.WEAPONS[o.id];
      icon = img(o.id); name = def.name;
      tag = o.level === 1 ? `<small class="new">нове</small>` : `<small>рів. ${o.level}</small>`;
      if (o.level === D.WEAPON_MAX_LEVEL && def.evo) {
        const p = D.PASSIVES[def.evo.with];
        extra = `<div class="evo-hint">Далі — еволюція зі скрині, якщо маєш «${p.name}»</div>`;
      }
    } else if (o.kind === "passive") {
      const def = D.PASSIVES[o.id];
      icon = img(o.id); name = def.name;
      tag = o.level === 1 ? `<small class="new">нове</small>` : `<small>рів. ${o.level}</small>`;
    } else if (o.kind === "evolve") {
      const def = D.WEAPONS[o.id];
      icon = img(o.id, true); name = def.evo.name; tag = `<small>еволюція</small>`; cls += " evolve";
    } else if (o.kind === "bonus") {
      const B = { might: ["might", "Сила понад межу", `+${Math.round(o.v * 100)}% шкоди`], maxHp: ["heart", "Загартування", `+${o.v} до макс. здоров'я`],
        cooldown: ["hourglass", "Швидкі руки", `−${Math.round(-o.v * 100)}% перезарядки`] }[o.stat] || ["skull", "Бонус", ""];
      icon = img(B[0], true); name = B[1]; tag = `<small>понад межу</small>`; o.text = B[2];
    } else if (o.kind === "gold") { icon = img("gold"); name = "Золото"; }
    else { icon = img("food"); name = "Зілля здоров'я"; }
    return { cls, html: `<div class="ico">${icon}</div><div class="card-txt"><div class="t">${name} ${tag}</div><div class="d">${levelText(o)}</div>${extra}</div>` };
  }

  function showLevelUp(options) {
    mode = "modal";
    joy.active = false; syncJoy();
    const box = $("levelCards");
    box.innerHTML = "";
    for (const o of options) {
      const c = cardHtml(o);
      const el = document.createElement("button");
      el.type = "button";
      el.className = c.cls; el.innerHTML = c.html;
      el.addEventListener("click", () => { C.choose(state, o); afterModal(); }, { once: true });
      box.appendChild(el);
    }
    $("levelSub").textContent = `Рівень ${state.player.level - state.pendingLevels} · обери одне`;
    const rb = $("btnReroll");
    rb.textContent = `Перекинути (${state.rerollsLeft})`;
    rb.hidden = state.rerollsLeft <= 0;
    show("scrLevel");
  }
  $("btnReroll").addEventListener("click", () => { const opts = C.reroll(state); if (opts) showLevelUp(opts); });
  $("btnSkip").addEventListener("click", () => { C.skip(state); afterModal(); });

  function showChest(items) {
    mode = "modal";
    joy.active = false; syncJoy();
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
  $("btnChestOk").addEventListener("click", () => { C.skip(state); afterModal(); });

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
  function announce(text, boss, small) {
    const el = $("announce");
    el.textContent = text;
    el.className = "on" + (boss ? " boss" : "") + (small ? " small" : "");
    clearTimeout(annTimer);
    annTimer = setTimeout(() => { el.className = boss ? "boss" : ""; }, 2200);
  }

  let lastHurtBuzz = 0;
  function handleEvents() {
    const evs = state.events;
    if (!evs.length) return;
    state.events = [];
    for (const ev of evs) {
      if (ev.type === "announce") { announce(ev.text, ev.boss, ev.small); if (ev.boss) R.shake(2); }
      else if (ev.type === "hurt") {
        const now = performance.now();
        if (set().vibrate && navigator.vibrate && now - lastHurtBuzz > 400) { lastHurtBuzz = now; try { navigator.vibrate(25); } catch (_) {} }
      }
      else if (ev.type === "levelup" || ev.type === "chest") modalQueue.push(ev);
      else if (ev.type === "gameover" || ev.type === "victory") { endRun(ev); return; }
    }
    if (mode === "play") nextModal();
  }

  function endRun(ev) {
    mode = "modal";
    modalQueue = [];
    joy.active = false;
    const r = ev.result;
    r.char = state.charId;
    clearRun();
    const isBest = applyResult(r);
    writeSave();
    if (window.AppScore) { try { window.AppScore.sendScore("horde", r.score); } catch (_) {} }

    $("resTitle").textContent = r.won ? "Перемога!" : "Тебе здолали";
    $("resSub").textContent = r.won ? "Демон упав. Орда розбіглась до наступної ночі." : (isBest ? "Новий особистий рекорд!" : `Рахунок: ${r.score}`);
    $("resStats").innerHTML = statBoxes([[fmtTime(r.time), "час"], [r.kills, "вбито"], [r.level, "рівень"], ["+" + r.gold, "золото"]], 3);
    $("resStrip").innerHTML = stripHtml(state);
    $("resBuild").innerHTML = buildList(state);
    $("resHero").innerHTML = statsHtml(state);
    setDetails("res", false);
    $("hud").classList.remove("on");
    $("challenge").hidden = true;
    show("scrResult");
  }
  $("btnAgain").addEventListener("click", startRun);
  $("btnMenu").addEventListener("click", openMenu);
  $("btnPlay").addEventListener("click", startRun);
  function resumeRun() {
    resize();
    const s = C.restore(loadRun(), { viewW: view.viewW, viewH: view.viewH, seed: (Date.now() ^ (Math.random() * 1e9)) >>> 0 });
    if (!s) { clearRun(); openMenu(); return; }
    state = s; modalQueue = []; acc = 0; syncJoy(); lastHud = {};
    $("hud").classList.add("on");
    mode = "play";
    updateHud();
    pause(); // відновлюємо на паузі: гравець сам натисне «Продовжити»
  }
  $("btnContinue").addEventListener("click", resumeRun);
  $("btnHeroes").addEventListener("click", openHeroes);
  $("btnShop").addEventListener("click", openShop);
  $("btnResShop").addEventListener("click", openShop);

  // ---------- HUD ----------
  let lastHud = {};
  function setHtml(id, v) { if (lastHud[id] !== v) { lastHud[id] = v; $(id).innerHTML = v; } }
  function updateHud() {
    const s = state, p = s.player;
    setHtml("timer", fmtTime(s.t));
    setHtml("killsN", String(s.kills));
    setHtml("coinsN", String(s.coins));
    setHtml("lvl", "РІВ. " + p.level);
    const w = Math.min(100, (p.xp / p.need) * 100).toFixed(1) + "%";
    if (lastHud.xp !== w) { lastHud.xp = w; $("xpFill").style.width = w; }
    let sig = "";
    for (const x of s.weapons) sig += x.id + x.level + (x.evolved ? "E" : "");
    for (const x of s.passives) sig += x.id + x.level;
    if (lastHud.slots !== sig) { lastHud.slots = sig; renderSlots(); }
    const ch = s.challenge ? `Виклик · ${Math.ceil(s.challenge.t)} с` : "";
    if (lastHud.ch !== ch) { lastHud.ch = ch; $("challenge").textContent = ch; $("challenge").hidden = !ch; }
  }
  function renderSlots() {
    let html = "";
    for (const w of state.weapons) html += `<span class="${w.evolved ? "evo" : ""}">${img(w.id, w.evolved)}<em>${w.evolved ? "" : w.level}</em></span>`;
    html += `<i class="gap"></i>`;
    for (const p of state.passives) html += `<span>${img(p.id)}<em>${p.level}</em></span>`;
    $("slots").innerHTML = html;
  }
  $("killsIco").innerHTML = img("skull", false, "sm");
  $("coinsIco").innerHTML = img("gold", false, "sm");

  // ---------- фон для меню: світ без героя ----------
  function menuBackdrop(dt) {
    if (!menuState) {
      menuState = C.create({ charId: save.char, viewW: view.viewW, viewH: view.viewH, seed: 7 });
      menuState.weapons = [];
    }
    menuState.player.x += dt * 24; menuState.player.y += dt * 8;
    menuState.t += dt;
    return menuState;
  }

  // ---------- цикл ----------
  var frozenDrawn = false; // var: resize() звертається до неї раніше за оголошення
  function frame(now) {
    const dt = Math.min(0.1, (now - (last || now)) / 1000);
    last = now;
    T += dt;
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
    const ui = { numbers: set().numbers, shake: set().shake, joy: mode === "play" ? joy : null, alpha: mode === "play" ? Math.min(1, acc / STEP) : 1 };
    if (state && mode === "play") { R.render(state, T, ui); frozenDrawn = false; }
    else if (state && mode !== "menu") { if (!frozenDrawn) { R.render(state, T, ui); frozenDrawn = true; } } // під вікном кадр стоїть
    else R.render(menuBackdrop(dt), T, { noPlayer: true });
    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", () => { resize(); syncJoy(); });
  if (window.ResizeObserver) new ResizeObserver(() => { resize(); syncJoy(); }).observe(area);
  resize();
  syncJoy();
  // атлас спрайтів довантажився — оновлюємо портрети героїв у відкритому меню
  HR.onReady(() => { if (openId === "scrMenu") openMenu(); else if (openId === "scrHeroes") openHeroes(); });
  // була незавершена гра — одразу повертаємо в неї (на паузі)
  if (loadRun()) resumeRun(); else openMenu();
  requestAnimationFrame(frame);

  document.addEventListener("contextmenu", (e) => e.preventDefault());
  window.HordeGame = { get state() { return state; }, startRun, get save() { return save; }, renderer: R };
})();
