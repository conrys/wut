// ==========================================================================
// Спільна пауза для онлайн-ігор (як у Сміхлисті): будь-хто в кімнаті тисне
// кнопку — у кімнату пишеться { paused: true, pausedAt, pausedByName }, усі
// бачать затемнений екран «Пауза». Рушій ведучого, поки room.paused, нічого не
// рухає (перевірку додано в progress/tick кожної гри). «Продовжити» зсуває всі
// дедлайни етапу на тривалість паузи — таймери продовжують з того ж місця.
//
//   const pause = GamePause.mount({
//     getRef: () => roomRef,          // ref кімнати
//     now: () => серверний час,
//     username: () => ім'я,
//     active: (room) => true/false,   // коли пауза доступна (не в лобі)
//     deadlines: (room) => ["stage/endsAt", ...],  // числові поля, що зсуваються
//     readOnly: true,                 // для ТВ-екранів: лише показ, без кнопок
//   });
//   pause.update(room)  — на кожне оновлення кімнати
//   GamePause.isPaused(room)
// ==========================================================================
(function () {
  const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>';
  const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
  const CSS = `
.gp-btn { position: fixed; left: 12px; bottom: calc(14px + env(safe-area-inset-bottom)); z-index: 850; width: 44px; height: 44px; border-radius: 50%;
  display: grid; place-items: center; border: 1px solid rgba(255,255,255,.25); background: rgba(10,10,20,.55); color: #fff; backdrop-filter: blur(6px);
  box-shadow: 0 4px 14px rgba(0,0,0,.3); cursor: pointer; padding: 0; }
.gp-btn svg { width: 20px; height: 20px; fill: currentColor; }
.gp-btn:active { transform: scale(.92); }
.gp-btn.in-header { position: static; width: 36px; height: 36px; margin: 0 6px 0 0; box-shadow: none; backdrop-filter: none;
  border: 1px solid var(--line, rgba(255,255,255,.2)); background: var(--panel, rgba(255,255,255,.08)); color: var(--ink, #fff); flex: none; }
.gp-btn.in-header svg { width: 16px; height: 16px; }
.gp-btn[hidden], .gp-over[hidden] { display: none !important; }
.gp-over { position: fixed; inset: 0; z-index: 900; display: flex; align-items: center; justify-content: center; padding: 24px;
  background: rgba(8,8,16,.72); backdrop-filter: blur(6px); color: #fff; font-family: inherit; animation: gpIn .25s ease both; }
@keyframes gpIn { from { opacity: 0; } }
.gp-card { display: flex; flex-direction: column; align-items: center; gap: 12px; max-width: 320px; text-align: center; }
.gp-card .ico { width: 88px; height: 88px; border-radius: 50%; display: grid; place-items: center; background: rgba(255,255,255,.12); animation: gpBeat 1.6s ease-in-out infinite; }
.gp-card .ico svg { width: 40px; height: 40px; fill: #fff; }
@keyframes gpBeat { 50% { transform: scale(1.08); background: rgba(255,255,255,.2); } }
.gp-card b { font-size: 26px; font-weight: 900; letter-spacing: .02em; }
.gp-card small { font-size: 14px; opacity: .75; line-height: 1.4; }
.gp-card .clock { font-size: 15px; font-weight: 800; opacity: .9; font-variant-numeric: tabular-nums; }
.gp-card button { margin-top: 6px; min-height: 52px; padding: 0 28px; border-radius: 999px; border: 0; background: #fff; color: #111; font: inherit; font-size: 16px; font-weight: 900;
  display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
.gp-card button svg { width: 18px; height: 18px; fill: currentColor; }
.gp-over.tv .gp-card { max-width: 60vw; } .gp-over.tv .gp-card b { font-size: 6vh; } .gp-over.tv .gp-card small { font-size: 2.6vh; }
.gp-over.tv .gp-card .ico { width: 16vh; height: 16vh; } .gp-over.tv .gp-card .ico svg { width: 7vh; height: 7vh; }`;

  function isPaused(room) { return !!(room && room.paused); }

  function mount(opts) {
    if (!document.getElementById("gpStyle")) {
      const st = document.createElement("style");
      st.id = "gpStyle"; st.textContent = CSS;
      document.head.appendChild(st);
    }
    const btn = document.createElement("button");
    btn.className = "gp-btn"; btn.type = "button"; btn.hidden = true;
    btn.setAttribute("aria-label", "Пауза"); btn.innerHTML = ICON_PAUSE;
    const over = document.createElement("div");
    over.className = "gp-over" + (opts.readOnly ? " tv" : ""); over.hidden = true;
    over.innerHTML = `<div class="gp-card"><div class="ico">${ICON_PAUSE}</div><b>Пауза</b><small class="who"></small><div class="clock"></div>
      ${opts.readOnly ? "" : `<button type="button" class="go">${ICON_PLAY} Продовжити</button>`}</div>`;
    if (!opts.readOnly) {
      // у шапці гри (поруч з реакціями) кнопка нічого не перекриває; без шапки — плаває знизу ліворуч
      let slot = null;
      try { slot = window.GameHeader && GameHeader.slot ? GameHeader.slot("right") : null; } catch (e) { slot = null; }
      if (slot) { btn.classList.add("in-header"); slot.insertBefore(btn, slot.firstChild); }
      else document.body.appendChild(btn);
    }
    document.body.appendChild(over);

    let room = null, clockTimer = null;
    const now = () => (opts.now ? opts.now() : Date.now());

    function setPause(want) {
      const ref = opts.getRef && opts.getRef();
      if (!ref || !room || !!want === isPaused(room)) return;
      if (want) {
        ref.update({ paused: true, pausedAt: now(), pausedByName: (opts.username && opts.username()) || null });
      } else {
        const elapsed = Math.max(0, now() - (room.pausedAt || now()));
        const u = { paused: null, pausedAt: null, pausedByName: null };
        (opts.deadlines ? opts.deadlines(room) : []).forEach((path) => {
          const v = path.split("/").reduce((o, k) => (o == null ? o : o[k]), room);
          if (typeof v === "number" && v > 0) u[path] = v + elapsed;
        });
        ref.update(u);
      }
      try { window.QuiplashSfx && QuiplashSfx.play("pop"); } catch (e) {}
    }
    btn.addEventListener("click", () => setPause(true));
    const go = over.querySelector(".go");
    if (go) go.addEventListener("click", () => setPause(false));

    function tickClock() {
      if (!isPaused(room)) return;
      const s = Math.max(0, Math.floor((now() - (room.pausedAt || now())) / 1000));
      over.querySelector(".clock").textContent = `на паузі ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    }

    function update(r) {
      room = r;
      const can = !!r && (!opts.active || opts.active(r));
      const paused = can && isPaused(r);
      // гру скинули в лобі посеред паузи — знімаємо прапорець, щоб нова гра не стартувала «замороженою»
      if (r && !can && isPaused(r) && !opts.readOnly) {
        const ref = opts.getRef && opts.getRef();
        if (ref) ref.update({ paused: null, pausedAt: null, pausedByName: null });
      }
      btn.hidden = !can || paused;
      over.hidden = !paused;
      if (paused) {
        over.querySelector(".who").textContent = r.pausedByName ? `${r.pausedByName} поставив(ла) гру на паузу` : "";
        tickClock();
        if (!clockTimer) clockTimer = setInterval(tickClock, 1000);
      } else if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
    }
    return { update, setPause };
  }

  window.GamePause = { mount, isPaused };
})();
