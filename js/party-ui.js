// ==========================================================================
// Спільний інтерфейс «вечірок» на party-game.js: вхід у кімнату, лобі з
// вибором аватарки, раунд (таймер-кільце, хто ще не відповів, ковток),
// підсумок-подіум. Сцену раунду малює сторінка — PartyUI.mount(cfg):
//
//   title, tagline, emblem (svg), rules: [рядки], timerNote(room, st, sec)
//   sliders: [{ key, label }]            — таймери в налаштуваннях ведучого
//   segs:    [{ id, label, items:[[v, текст]], get(settings), set(v), note }]
//   build(c)  → html сцени; викликається, коли змінився етап (або чи чекають мене)
//   update(el, c)  — необов'язково, живі зміни без перебудови
//   onStage(c)     — необов'язково, звук/вібрація на новому етапі
//   c = { room, st, me, host, iExpected, mine, waiting, avatar(name, opts), esc, icon }
//   Кнопки з data-answer="<значення>" самі відправляють відповідь і підсвічуються.
//
// Аватарки — монстрики Сміхлиста (js/quiplash-avatars.js), звуки — QuiplashSfx.
// Підключати після party-game.js, quiplash-avatars.js, quiplash-sounds.js.
// ==========================================================================
(function () {
  const G = window.PartyGame;
  const A = () => window.QuiplashAvatars;
  const sfx = (n) => { try { if (window.QuiplashSfx) window.QuiplashSfx.play(n); } catch (e) {} };
  const buzz = (p) => { try { if (window.QuiplashSfx) window.QuiplashSfx.vibrate(p); } catch (e) {} };
  const $ = (id) => document.getElementById(id);

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------------- іконки: один штрих, currentColor ----------------
  const ICONS = {
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    hourglass: '<path d="M6 3h12M6 21h12M7 3c0 5 10 6 10 9s-10 4-10 9M17 3c0 5-10 6-10 9s10 4 10 9"/>',
    crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    pepper: '<path class="fill" d="M16.5 7.5c2 1.3 1.6 5-.6 8.2-2.4 3.4-6.6 5.6-11.4 5.3 4-1.6 6.4-4.3 7.6-7.6.9-2.6 2.2-6.9 4.4-5.9z"/><path d="M16 7.6c.3-2 1.4-3.2 3.4-3.6M13.8 8.2c.8-.9 1.8-1.1 2.7-.7"/>',
    glass: '<path d="M6 3h12l-1.6 16.2a2 2 0 0 1-2 1.8H9.6a2 2 0 0 1-2-1.8z"/><path d="M7 9h10"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    swap: '<path d="M4 9h13l-3-3M20 15H7l3 3"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.4 3.5 5.2"/>',
    play: '<path class="fill" d="M8 5.5v13l10.5-6.5z"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>',
    gavel: '<path d="M13.5 4.5l6 6M11 7l6 6M12.2 5.8l-4.4 4.4 6 6 4.4-4.4M10.8 13.2L4 20"/><path d="M3 21h9"/>',
    scales: '<path d="M12 4v16M7 20h10M4 7h16M12 4l-1-1M6 7l-3 7a3 3 0 0 0 6 0zM18 7l-3 7a3 3 0 0 0 6 0z"/>',
    dove: '<path d="M3 13c3 0 5-1 6.5-3.5C11 7 12.5 5 16 5c1.7 0 3 1 3.5 2.5L22 8l-2.4 1.2C19 14 15.5 18 10 18H6l2-2c-2.6-.2-4.3-1.3-5-3z"/>',
    chip: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
    bolt: '<path d="M13 2L4.5 13.5H12L11 22l8.5-11.5H12z"/>',
    flagWhite: '<path d="M5 21V4M5 4c4-2 7 2 11 0v8c-4 2-7-2-11 0"/>',
    eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.7-4.3L4 8M4 4v4h4M4 13a8 8 0 0 0 14.7 4.3L20 16M20 20v-4h-4"/>',
  };
  function icon(name, cls) {
    const body = (ICONS[name] || "").replace(/class="fill"/g, 'style="fill:currentColor;stroke:none"');
    return `<svg class="ic ${cls || ""}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  }
  // Келих, що наповнюється (для «Ковток!»)
  function glassSvg() {
    return `<svg class="glass" viewBox="0 0 44 54" aria-hidden="true"><defs><clipPath id="ppGl"><path d="M6 4h32l-4 42a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4z"/></clipPath></defs>
      <g clip-path="url(#ppGl)"><rect class="liq" x="0" y="16" width="44" height="40" fill="#ffd36b"/><rect class="liq" x="0" y="16" width="44" height="5" fill="#fff6d6"/></g>
      <path d="M6 4h32l-4 42a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4z" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></svg>`;
  }

  // ---------------- аватари ----------------
  function avatar(room, name, opts) {
    opts = opts || {};
    const p = (room && room.players && room.players[name]) || {};
    const inner = A() ? A().html({ character: p.character }, opts.mood || "idle", opts.still ? "qa-still" : "")
      : `<img src="img/char${Number(p.character) || 1}.svg" alt="">`;
    return `<span class="pav ${opts.size || ""} ${opts.cls || ""}" title="${esc(name)}">${inner}${opts.badge || ""}</span>`;
  }

  // ---------------- подіум підсумку ----------------
  function podium(room, which, mood) {
    const t = (room.tally && room.tally[which]) || {};
    const list = Object.entries(t).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    if (!list.length) return '<div class="pp-note">поки порожньо</div>';
    const top = list.slice(0, 3);
    // однаковий рахунок — однакове місце (і висота стовпчика)
    const place = (i) => 1 + top.filter(([, v]) => v > top[i][1]).length;
    const slot = (i) => top[i] ? `<div class="pp-pod p${place(i)}">${avatar(room, top[i][0], { size: place(i) > 1 ? "md" : "lg", mood: place(i) > 1 ? "idle" : mood })}<span class="nm">${esc(top[i][0])}</span><div class="col">${top[i][1]}</div></div>` : "<div></div>";
    return `<div class="pp-podium">${slot(1)}${slot(0)}${slot(2)}</div>` +
      (list.length > 3 ? `<div class="pp-rest">${list.slice(3).map(([n, v]) => `<div>${avatar(room, n, { size: "xs", still: true })}<span class="n">${esc(n)}</span><span class="v">${v}</span></div>`).join("")}</div>` : "");
  }
  // Ковток / бали / хто ще п'є — для етапу-результату (st.penalties, st.points, st.capped)
  function drinkHtml(room, st, me, cap) {
    const pen = st.penalties || {}, pts = st.points || {}, mineSips = pen[me];
    const others = Object.keys(pen).filter((n) => n !== me);
    return (mineSips ? `<div class="pp-drink">${glassSvg()}<div><b>Ковток!${mineSips > 1 ? " ×" + mineSips : ""}</b><small>або будь-який напій — у своєму темпі</small></div></div>` : "") +
      (pts[me] ? `<div class="pp-gain">+${pts[me]} ${pts[me] === 1 ? "бал" : pts[me] < 5 ? "бали" : "балів"}</div>` : "") +
      (others.length ? `<div class="pp-drinkers">${icon("glass")} П'ють:${others.map((n) => avatar(room, n, { size: "sm", mood: "shock", still: true })).join("")}</div>` : "") +
      ((st.capped || []).length ? `<div class="pp-note">Ліміт ${cap || 6} ковтків за набір: ${st.capped.map(esc).join(", ")} — без доданого</div>` : "");
  }

  // ---------------- розмітка ----------------
  function skeleton(cfg) {
    return `<div class="pp-wrap">
  <section class="pp-view pp-center hidden" id="v-locked">
    <span class="pp-big-ic">${icon("lock")}</span>
    <div class="pp-note" style="font-size:16px">Увійди в профіль, щоб грати з друзями</div>
  </section>

  <section class="pp-view hidden" id="v-entry">
    <div class="pp-hero">${cfg.emblem}<h1>${esc(cfg.title)}</h1><p>${esc(cfg.tagline || "")}</p></div>
    <div class="pp-card"><div class="pp-h">${icon("users")} Активні кімнати</div><div class="rooms-list" id="activeRoomsList"></div></div>
    <div class="pp-or">або за кодом</div>
    <div class="pp-join"><input class="pp-field" id="roomCodeInput" maxlength="5" placeholder="КОД" autocomplete="off" />
      <button class="pp-btn" id="joinRoomBtn">Увійти</button></div>
    <button class="pp-btn pp-primary pp-block pp-big" id="createRoomBtn">Створити кімнату</button>
  </section>

  <section class="pp-view pp-center hidden" id="v-waiting">
    <span class="pp-big-ic">${icon("hourglass")}</span>
    <div class="pp-note" style="font-size:16px">Набір уже йде — приєднаєшся до наступного</div>
  </section>

  <section class="pp-view hidden" id="v-lobby">
    <div class="pp-lobby-head">${cfg.emblem}<div class="t"><b>${esc(cfg.title)}</b><small id="lobbyStatus"></small></div>
      <div class="pp-code"><small>Код кімнати</small><b id="roomCodeDisplay"></b></div></div>
    <div class="pp-card"><div class="pp-h">${icon("users")} Гравці <span class="cnt" id="lobbyCount"></span></div>
      <div class="pp-players" id="playersList"></div>
      <div class="pp-note" style="margin-top:10px">Торкнись своєї аватарки, щоб змінити персонажа</div></div>
    <div class="pp-card pp-hostpanel hidden" id="hostPanel"><div class="pp-h">Налаштування</div>
      <div id="settingsArea"></div>
      <div class="pp-label">Гострота</div><div class="pp-seg pp-level" id="levelSeg"></div>
      <button class="pp-btn pp-primary pp-block pp-big" id="startBtn">${icon("play")} Почати</button>
      <div class="pp-err" id="startHint"></div></div>
    <div class="pp-card pp-waithost hidden" id="waitHostLobby"></div>
    <details class="pp-card pp-rules"><summary>Як грати</summary><ol>${(cfg.rules || []).map((r) => `<li>${r}</li>`).join("")}</ol></details>
    <button class="pp-btn pp-ghost pp-block hidden" id="resetBtn">${icon("refresh")} Скинути вечір</button>
  </section>

  <section class="pp-view hidden" id="v-round">
    <div class="pp-topbar">
      <div class="pp-round"><small>Раунд</small><b id="roundNo"></b></div>
      <div class="pp-stagetitle" id="stageTitle"></div>
      <div class="pp-timer off" id="timer"><svg viewBox="0 0 44 44"><circle class="trk" cx="22" cy="22" r="19"/><circle class="bar" cx="22" cy="22" r="19"/></svg><span></span></div>
    </div>
    <div class="pp-stage" id="stage"></div>
    <div class="pp-wait" id="waitInfo"></div>
    <div class="pp-stage" id="drinkArea"></div>
    <div class="pp-hostbar hidden" id="hostBar">
      <button class="pp-btn pp-ghost" id="endSetBtn">${icon("flag")} Завершити</button>
      <button class="pp-btn pp-primary" id="hostNextBtn">Далі</button></div>
  </section>

  <section class="pp-view hidden" id="v-summary">
    <h2 class="pp-sumtitle">Підсумок набору</h2>
    <div class="pp-card"><div class="pp-h">${icon("glass")} Ковтки за вечір</div><div id="sumDrinks"></div></div>
    <div class="pp-card"><div class="pp-h">${icon("star")} Бали за вечір</div><div id="sumPoints"></div></div>
    <button class="pp-btn pp-primary pp-block pp-big hidden" id="toLobbyBtn">Повернутись у лобі</button>
    <div class="pp-note hidden" id="waitHostSummary">Очікуємо ведучого в лобі…</div>
  </section>
</div>`;
  }

  function mount(cfg) {
    const app = $("app");
    app.innerHTML = skeleton(cfg);
    const VIEWS = ["locked", "entry", "waiting", "lobby", "round", "summary"];
    let curView = null;
    function showView(name) {
      if (curView === name) return;
      curView = name;
      VIEWS.forEach((v) => $("v-" + v).classList.toggle("hidden", v !== name));
      document.body.dataset.view = name;
      window.scrollTo(0, 0);
    }

    let lastRoom = null, lastCtx = null, reactionsMounted = false;
    const sig = {};   // підписи блоків: перебудовуємо лише коли змінились (аватарки не «смикаються»)
    function paint(id, key, html) { if (sig[id] === key) return false; sig[id] = key; $(id).innerHTML = html; return true; }

    // ---------------- налаштування ведучого ----------------
    $("settingsArea").innerHTML =
      (cfg.sliders || []).map((s) => `<label class="pp-label" for="sl_${s.key}">${esc(s.label)} <output id="out_${s.key}">60 с</output></label>
        <input class="pp-range" id="sl_${s.key}" type="range" min="${G.MIN_TIMER_SECONDS}" max="${G.MAX_TIMER_SECONDS}" step="5" value="60" />`).join("") +
      (cfg.segs || []).map((s) => `<div class="pp-label">${esc(s.label)}</div><div class="pp-seg" id="seg_${s.id}">${s.items.map(([v, t]) =>
        `<button data-v="${v}">${esc(t)}</button>`).join("")}</div>${s.note ? `<div class="pp-note" style="text-align:left;margin-top:6px">${esc(s.note)}</div>` : ""}`).join("");
    (cfg.sliders || []).forEach((s) => {
      const input = $("sl_" + s.key);
      input.addEventListener("input", () => { $("out_" + s.key).textContent = input.value + " с"; });
      input.addEventListener("change", () => G.updateSettings({ [s.key]: Number(input.value) }));
    });
    (cfg.segs || []).forEach((s) => $("seg_" + s.id).querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => G.updateSettings(s.set(Number(b.dataset.v))))));
    $("levelSeg").innerHTML = [1, 2, 3].map((n) => `<button data-v="${n}" aria-label="Гострота ${n}">${"🌶️".repeat(n)}</button>`).join("");
    $("levelSeg").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => G.updateSettings({ level: Number(b.dataset.v) })));

    // ---------------- лобі ----------------
    function renderLobby(room, ctx) {
      const conn = G.connectedNames(room.players), hostName = G.computeHost(room.players), me = ctx.username;
      $("roomCodeDisplay").textContent = G.roomId || "";
      $("lobbyStatus").textContent = `Онлайн: ${conn.length}`;
      const names = Object.keys(room.players || {}).sort((a, b) => (conn.includes(b) - conn.includes(a)) || ((room.players[a].joinedAt || 0) - (room.players[b].joinedAt || 0)));
      $("lobbyCount").textContent = `${conn.length}`;
      const key = names.map((n) => [n, room.players[n].character, conn.includes(n), n === hostName].join(":")).join("|") + "#" + me;
      if (paint("playersList", key, names.map((n) => {
        const mine = n === me;
        return `<button class="pp-pl ${mine ? "me" : ""} ${conn.includes(n) ? "" : "off"}" ${mine ? 'data-me="1"' : "disabled"}>
          ${avatar(room, n, { size: "lg", mood: mine ? "happy" : "idle" })}<span class="nm">${esc(n)}</span>
          ${n === hostName ? `<span class="tag" title="Ведучий">${icon("crown")}</span>` : ""}${mine ? `<span class="swap">${icon("swap")}</span>` : ""}</button>`;
      }).join("") || '<div class="pp-note">Ще нікого немає</div>')) {
        const mine = $("playersList").querySelector("[data-me]");
        if (mine) mine.addEventListener("click", () => { G.cycleAvatar(1); sfx("pop"); });
      }
      $("hostPanel").classList.toggle("hidden", !ctx.host);
      $("resetBtn").classList.toggle("hidden", !ctx.host);
      $("waitHostLobby").classList.toggle("hidden", !!ctx.host);
      if (!ctx.host) {
        paint("waitHostLobby", "w" + hostName + ((room.players || {})[hostName] || {}).character,
          `${hostName ? avatar(room, hostName, { size: "md", mood: "write" }) : ""}<div class="pp-note"><b style="color:var(--ink)">${esc(hostName || "Ведучий")}</b> налаштовує гру.<br>Почнемо, щойно ведучий натисне «Почати».</div>`);
        return;
      }
      const s = room.settings || {};
      (cfg.sliders || []).forEach((sl) => {
        const input = $("sl_" + sl.key);
        if (document.activeElement === input) return;
        const v = Math.min(G.MAX_TIMER_SECONDS, Math.max(G.MIN_TIMER_SECONDS, Number(s[sl.key]) || G.DEFAULT_TIMER_SECONDS));
        input.value = v; $("out_" + sl.key).textContent = v + " с";
      });
      (cfg.segs || []).forEach((sg) => $("seg_" + sg.id).querySelectorAll("button").forEach((b) => b.classList.toggle("selected", Number(b.dataset.v) === sg.get(s))));
      $("levelSeg").querySelectorAll("button").forEach((b) => b.classList.toggle("selected", Number(b.dataset.v) === (s.level || G.DEFAULT_LEVEL)));
      const mode = window.PartyModes.MODES[s.mode], enough = mode && conn.length >= mode.minPlayers;
      $("startBtn").disabled = !enough;
      $("startHint").textContent = !mode ? "Обери режим" : enough ? "" : `Потрібно мінімум ${mode.minPlayers} гравців онлайн`;
    }

    // ---------------- раунд ----------------
    let builtKey = null, firstStage = true;
    function stageCtx(room, ctx) {
      const st = room.stage, me = ctx.username;
      return { room, st, me, host: ctx.host, iExpected: (st.expect || []).includes(me), mine: G.inputOf(room, me),
        waiting: G.waitingNames(room), avatar: (n, o) => avatar(room, n, o), esc, icon, glassSvg, sfx, buzz };
    }
    function renderRound(room, ctx) {
      const st = room.stage, c = stageCtx(room, ctx);
      $("roundNo").innerHTML = `${room.roundNo + 1}<i>/${room.totalRounds}</i>`;
      $("stageTitle").textContent = (cfg.stageTitle && cfg.stageTitle(c)) || st.title || "";
      const key = st.id + "|" + c.iExpected;
      const stageEl = $("stage");
      if (builtKey !== key) {
        const isNewStage = !builtKey || builtKey.split("|")[0] !== String(st.id);
        builtKey = key;
        stageEl.innerHTML = cfg.build(c);
        stageEl.classList.remove("pp-enter"); void stageEl.offsetWidth; stageEl.classList.add("pp-enter");
        stageEl.querySelectorAll("[data-answer]").forEach((b) => b.addEventListener("click", () => {
          const r = G.answer(b.dataset.answer);
          if (r && r.ok) { sfx("pop"); buzz(15); stageEl.querySelectorAll("[data-answer]").forEach((x) => x.classList.toggle("selected", x === b)); }
        }));
        sig.drinkArea = null; sig.waitInfo = null;
        if (isNewStage && !firstStage) {
          if (cfg.onStage) cfg.onStage(c);
          else if (st.kind === "reveal") sfx("drum");
          else sfx("whoosh");
          if (c.iExpected) buzz(30);
        }
        firstStage = false;
        lastTickSec = null;
      }
      if (cfg.update) cfg.update(stageEl, c);
      stageEl.querySelectorAll("[data-answer]").forEach((b) => b.classList.toggle("selected", b.dataset.answer === c.mine));

      const isReveal = st.kind === "reveal";
      // хто ще не відповів
      const expect = st.expect || [];
      if (!isReveal && expect.length) {
        const done = expect.length - c.waiting.length;
        paint("waitInfo", `${st.id}|${done}|${c.waiting.join(",")}`,
          `<div class="dots">${expect.map((_, i) => `<i class="${i < done ? "on" : ""}"></i>`).join("")}</div>
           <div>Відповіли ${done} з ${expect.length}</div>` +
          (c.waiting.length && c.waiting.length <= 8 ? `<div class="who">${c.waiting.map((n) => avatar(room, n, { size: "sm", mood: "write", still: true })).join("")}</div>` : ""));
      } else paint("waitInfo", "none", "");
      // ковток / бали
      if (isReveal) {
        paint("drinkArea", "r" + st.id, drinkHtml(room, st, c.me, G.SET_CAP));
      } else paint("drinkArea", "none", "");

      $("hostBar").classList.toggle("hidden", !ctx.host);
      $("hostNextBtn").textContent = isReveal ? (room.roundNo + 1 >= room.totalRounds ? "Підсумок" : "Далі") : (st.kind === "show" ? "Далі" : "Показати результат");
      updateTimer();
    }

    let lastTickSec = null;
    const RING = 2 * Math.PI * 19;
    function updateTimer() {
      const el = $("timer"), room = lastRoom, st = room && room.stage;
      if (!room || room.phase !== "round" || !st || st.kind === "reveal" || !st.endsAt) { el.className = "pp-timer off"; return; }
      const total = Math.max(1, st.endsAt - (st.startedAt || st.endsAt - 60000));
      const left = Math.max(0, st.endsAt - G.now()), sec = Math.ceil(left / 1000);
      const bar = el.querySelector(".bar");
      bar.style.strokeDasharray = RING;
      bar.style.strokeDashoffset = RING * (1 - left / total);
      const note = cfg.timerNote && cfg.timerNote(room, st, sec);
      el.querySelector("span").textContent = note || sec;
      el.className = "pp-timer" + (note ? " done" : sec <= 5 ? " urgent" : "");
      if (sec <= 5 && sec > 0 && sec !== lastTickSec && !note) {
        lastTickSec = sec;
        if ((st.expect || []).includes(lastCtx && lastCtx.username) || st.kind === "show") sfx("tick");
      }
    }

    // ---------------- підсумок ----------------
    function renderSummary(room, ctx) {
      const t = room.tally || {};
      paint("sumDrinks", "d" + JSON.stringify(t.drinks || {}), podium(room, "drinks", "shock"));
      paint("sumPoints", "p" + JSON.stringify(t.points || {}), podium(room, "points", "happy"));
      $("toLobbyBtn").classList.toggle("hidden", !ctx.host);
      $("waitHostSummary").classList.toggle("hidden", !!ctx.host);
    }

    function onState(room, ctx) {
      const prevPhase = lastRoom && lastRoom.phase;
      lastRoom = room; lastCtx = ctx;
      if (!ctx.username) { showView("locked"); return; }
      if (!reactionsMounted && window.GameReactions && G.roomRef) { reactionsMounted = true; window.GameReactions.mount(G.roomRef, ctx.username); }
      const iAmIn = room.players && room.players[ctx.username];
      document.body.dataset.phase = room.phase || "lobby";
      if (room.phase === "round" && room.stage) {
        if (!iAmIn || !(room.order || []).includes(ctx.username)) { showView("waiting"); return; }
        showView("round"); renderRound(room, ctx);
      } else if (room.phase === "summary") {
        if (prevPhase === "round") sfx("fanfare");
        showView("summary"); renderSummary(room, ctx);
      } else { builtKey = null; showView("lobby"); renderLobby(room, ctx); }
    }

    $("startBtn").addEventListener("click", () => { G.startSet(lastRoom); });
    $("resetBtn").addEventListener("click", () => { if (confirm("Скинути вечір (рахунок теж)?")) G.resetAll(); });
    $("hostNextBtn").addEventListener("click", () => G.skip());
    $("endSetBtn").addEventListener("click", () => { if (confirm("Завершити набір?")) G.endSet(); });
    $("toLobbyBtn").addEventListener("click", () => G.toLobby());
    setInterval(updateTimer, 250);

    function beginGame(user, roomId) { G.onStateChange = onState; G.start(user, roomId); }
    const session = window.AppAuth && window.AppAuth.getSession();
    if (session && window.rtdbReady) {
      RoomCodeUI.mount({
        containerId: "activeRoomsList", codeInputId: "roomCodeInput", joinBtnId: "joinRoomBtn", createBtnId: "createRoomBtn",
        watchActiveRooms: G.watchActiveRooms,
        emptyListHtml: '<div class="hint-text">Активних кімнат поки нема — створи нову</div>',
        renderRoomItem: (r) => `<div class="pp-room"><b>${esc(r.roomId)}</b><small>${icon("users")} ${r.connectedCount}/${r.playerCount}</small>
          <span class="st ${r.phase === "round" ? "live" : ""}">${r.phase === "lobby" ? "Лобі" : r.phase === "summary" ? "Підсумок" : "Гра йде"}</span></div>`,
        onEnter: (roomId) => beginGame(session.username, roomId),
      });
      showView("entry");
    } else showView("locked");
    window.addEventListener("beforeunload", () => G.stop());
  }

  window.PartyUI = { mount, icon, esc, avatar, glassSvg, podium, drinkHtml };
})();
