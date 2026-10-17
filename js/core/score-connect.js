// ==========================================================================
// Відправка рекорду у Firestore. Викликати в кожній грі в момент game over:
//   window.AppScore && window.AppScore.sendScore('tetris', score);
// Новий особистий рекорд сам показує плашку «Поділитися» (offerShare нижче) —
// новим іграм більше нічого підключати не треба.
// Якщо юзер не залогінений або немає мережі — просто нічого не відправляє,
// сама гра при цьому не ламається.
//
// ОНОВЛЕННЯ (профіль 2.0): getUserProfile() тепер додатково повертає
// - total / ts / place по кожній грі (потрібно для "#4 з 12" та "3 дні тому"
//   у новому екрані "Мій профіль" в login.js);
// - joinedAt — дату реєстрації з games41_users, одним додатковим get()
//   лише коли профіль реально відкривають (не при кожному завантаженні
//   сторінки).
// ==========================================================================
(function () {
  async function sendScore(gameName, score) {
    const session = window.AppAuth && window.AppAuth.getSession();
    if (!session) return { saved: false, reason: "not-logged-in" };
    if (session.guest) return { saved: false, reason: "guest" }; // гості не потрапляють у рекорди
    if (!window.firebaseReady || !db) return { saved: false, reason: "no-connection" };

    try {
      const docId = `${session.username}__${gameName}`;
      const ref = db.collection(SCORES_COLLECTION).doc(docId);
      const snap = await ref.get();
      const best = snap.exists ? snap.data().score : -Infinity;
      if (score <= best) return { saved: false, reason: "not-a-new-best", best };

      await ref.set({
        gameName,
        player: session.username,
        score,
        ts: Date.now(),
      });
      offerShare(gameName, score, session.username);
      return { saved: true, best: score };
    } catch (e) {
      console.warn("score-connect error:", e);
      return { saved: false, reason: "error", error: e.message };
    }
  }

  async function getTopScores(gameName, limit) {
    limit = limit || 10;
    if (!window.firebaseReady || !db) return [];
    try {
      const snap = await db.collection(SCORES_COLLECTION).where("gameName", "==", gameName).get();
      const rows = [];
      snap.forEach((doc) => rows.push(doc.data()));
      rows.sort((a, b) => b.score - a.score);
      return rows.slice(0, limit);
    } catch (e) {
      console.warn("getTopScores error:", e);
      return [];
    }
  }

  // ------------------------------------------------------------------------
  // Профіль гравця: скільки разів він #1/#2/#3 в якійсь грі + його власний
  // рахунок по кожній грі, де він взагалі грав. Один запит по всій колекції
  // (а не по грі за раз) — дешевше для "своїх" масштабів гри і не вимагає
  // окремого композитного індексу на бекенді.
  //
  // Кожен елемент games[] тепер несе:
  //   gameName, score, rank, total (скільки всього гравців у цій грі),
  //   ts (коли встановлено цей рекорд — для "N днів тому" в UI).
  // joinedAt — окремий запит у games41_users, лише за потреби (виклик
  // getUserProfile трапляється рідко — тільки коли людина реально відкриває
  // "Мій профіль", тож зайвий read тут не б'є по квоті).
  // ------------------------------------------------------------------------
  // filterGames (необов'язково) — масив/Set gameName, які взагалі
  // враховувати. Зараз login.js передає сюди лише соло-ігри з реальним
  // індивідуальним рекордом (SCORABLE_GAMES) — мультиплеєрні кімнатні ігри
  // технічно можуть колись писати в ту саму колекцію, але для профілю це
  // окрема механіка, яку рахувати разом із соло-рейтингом поки не треба.
  async function getUserProfile(username, filterGames) {
    const empty = { trophies: { gold: 0, silver: 0, bronze: 0 }, games: [], joinedAt: null, gamesPlayedCount: 0, wordleStreak: 0 };
    if (!window.firebaseReady || !db) return empty;
    try {
      const allow = filterGames ? new Set(filterGames) : null;
      // Назва колекції захардкожена (не WORDLE_USERS_COLLECTION з wordle.js) —
      // той скрипт підключений лише на wordle.html, тут його може не бути.
      const [scoresSnap, userSnap, wordleSnap] = await Promise.all([
        db.collection(SCORES_COLLECTION).get(),
        db.collection("games41_names").doc(window.AppAuth && window.AppAuth.normName ? window.AppAuth.normName(username) : username).get().catch(() => null),
        db.collection("games41_wordle_users").doc(username).get().catch(() => null),
      ]);

      const byGame = {};
      scoresSnap.forEach((doc) => {
        const d = doc.data();
        if (!d || !d.gameName || !d.player) return;
        if (allow && !allow.has(d.gameName)) return;
        (byGame[d.gameName] = byGame[d.gameName] || []).push({ player: d.player, score: d.score, ts: d.ts || null });
      });

      const trophies = { gold: 0, silver: 0, bronze: 0 };
      const games = [];
      Object.keys(byGame).forEach((gameName) => {
        const rows = byGame[gameName].sort((a, b) => b.score - a.score);
        const idx = rows.findIndex((r) => r.player === username);
        if (idx === -1) return;
        const rank = idx + 1;
        if (rank === 1) trophies.gold++;
        else if (rank === 2) trophies.silver++;
        else if (rank === 3) trophies.bronze++;
        games.push({ gameName, score: rows[idx].score, rank, total: rows.length, ts: rows[idx].ts });
      });
      games.sort((a, b) => a.rank - b.rank || a.gameName.localeCompare(b.gameName));

      const joinedAt = userSnap && userSnap.exists ? (userSnap.data().createdAt || null) : null;
      const wordleStreak = wordleSnap && wordleSnap.exists ? (wordleSnap.data().streak || 0) : 0;

      return { trophies, games, joinedAt, gamesPlayedCount: games.length, wordleStreak };
    } catch (e) {
      console.warn("getUserProfile error:", e);
      return empty;
    }
  }

  // ------------------------------------------------------------------------
  // Накопичувальний рахунок (напр. лічильник перемог у шахах/шашках) — на
  // відміну від sendScore(), тут не "новий рекорд чи ні", а завжди
  // поточне_значення + delta. Читає свій попередній рахунок з тим самим
  // docId, що й sendScore, тож обидва підходи сумісні в одній грі.
  // ------------------------------------------------------------------------
  async function incrementScore(gameName, delta) {
    const session = window.AppAuth && window.AppAuth.getSession();
    if (!session) return { saved: false, reason: "not-logged-in" };
    if (session.guest) return { saved: false, reason: "guest" }; // гості не потрапляють у рекорди
    if (!window.firebaseReady || !db) return { saved: false, reason: "no-connection" };

    try {
      const docId = `${session.username}__${gameName}`;
      const ref = db.collection(SCORES_COLLECTION).doc(docId);
      const snap = await ref.get();
      const current = snap.exists ? (snap.data().score || 0) : 0;
      const next = current + delta;
      await ref.set({ gameName, player: session.username, score: next, ts: Date.now() });
      return { saved: true, score: next };
    } catch (e) {
      console.warn("incrementScore error:", e);
      return { saved: false, reason: "error", error: e.message };
    }
  }

  // ------------------------------------------------------------------------
  // «Поділитися рекордом». Плашка сама з'являється після НОВОГО особистого
  // рекорду в будь-якій грі, що викликає sendScore() — нових ігор окремо
  // підключати не треба. Ділимося картинкою-карткою (де можна) або текстом.
  // Ігри, що шлють рахунок посеред партії (2048, тетріс), не спамлять:
  // одна плашка на гру не частіше ніж раз на хвилину.
  // ------------------------------------------------------------------------
  const SHARE_COOLDOWN_MS = 60000;
  const lastOffer = {};
  let shareEl = null, shareTimer = null, sharePayload = null;

  function gameTitle(gameName) {
    return (window.GameLabels && window.GameLabels.gameLabel) ? window.GameLabels.gameLabel(gameName) : gameName;
  }
  function gameUrl() {
    return location.protocol.startsWith("http") ? location.origin + location.pathname : "";
  }

  async function offerShare(gameName, score, player) {
    if (Date.now() - (lastOffer[gameName] || 0) < SHARE_COOLDOWN_MS) {
      if (sharePayload && sharePayload.gameName === gameName) { sharePayload.score = score; updateShareText(); }
      return;
    }
    lastOffer[gameName] = Date.now();
    sharePayload = { gameName, score, player, rank: null, total: null };
    showShare();
    try {
      const rows = await getTopScores(gameName, 500);
      const idx = rows.findIndex((r) => r.player === player);
      if (idx >= 0 && sharePayload && sharePayload.gameName === gameName) { sharePayload.rank = idx + 1; sharePayload.total = rows.length; updateShareText(); }
    } catch (e) { /* місце — не обов'язково */ }
  }

  function ensureShareEl() {
    if (shareEl) return shareEl;
    const st = document.createElement("style");
    st.textContent = `
      .score-share{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 18px);transform:translate(-50%,140%);z-index:2147483000;
        display:flex;align-items:center;gap:10px;padding:8px 8px 8px 16px;border-radius:999px;background:#1d2b4a;color:#fff;
        font:600 14px/1.2 system-ui,-apple-system,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35);transition:transform .35s cubic-bezier(.3,1.4,.5,1);max-width:calc(100vw - 32px)}
      .score-share.on{transform:translate(-50%,0)}
      .score-share b{color:#ffcf3f}
      .score-share .ss-t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .score-share button{border:0;border-radius:999px;cursor:pointer;font:700 14px system-ui,-apple-system,sans-serif}
      .score-share .ss-go{display:flex;align-items:center;gap:6px;background:#ffcf3f;color:#1d2b4a;padding:9px 14px}
      .score-share .ss-go svg{width:16px;height:16px}
      .score-share .ss-x{background:transparent;color:rgba(255,255,255,.7);width:30px;height:30px;font-size:18px;line-height:1}
      @media (prefers-reduced-motion: reduce){.score-share{transition:none}}`;
    document.head.appendChild(st);
    shareEl = document.createElement("div");
    shareEl.className = "score-share";
    shareEl.setAttribute("role", "status");
    shareEl.innerHTML = `<span class="ss-t"></span>
      <button class="ss-go" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>Поділитися</button>
      <button class="ss-x" type="button" aria-label="Закрити">×</button>`;
    shareEl.querySelector(".ss-go").addEventListener("click", () => doShare());
    shareEl.querySelector(".ss-x").addEventListener("click", hideShare);
    document.body.appendChild(shareEl);
    return shareEl;
  }
  function updateShareText() {
    if (!shareEl || !sharePayload) return;
    const p = sharePayload;
    shareEl.querySelector(".ss-t").innerHTML = `Новий рекорд: <b>${p.score}</b>${p.rank ? ` · #${p.rank} з ${p.total}` : ""}`;
  }
  function showShare() {
    ensureShareEl(); updateShareText();
    requestAnimationFrame(() => shareEl.classList.add("on"));
    clearTimeout(shareTimer); shareTimer = setTimeout(hideShare, 12000);
  }
  function hideShare() { if (shareEl) shareEl.classList.remove("on"); clearTimeout(shareTimer); }

  function shareText(p) {
    const place = p.rank === 1 ? " — і це перше місце в Ігротеці" : p.rank ? ` — #${p.rank} з ${p.total} в Ігротеці` : "";
    return `Мій рекорд у грі «${gameTitle(p.gameName)}»: ${p.score}${place}. Поб'єш?`;
  }

  /* картинка-картка 1080×1080 */
  function shareCard(p) {
    return new Promise((resolve) => {
      try {
        const c = document.createElement("canvas"); c.width = c.height = 1080;
        const g = c.getContext("2d");
        const bg = g.createLinearGradient(0, 0, 1080, 1080); bg.addColorStop(0, "#1d2b4a"); bg.addColorStop(1, "#3e6fd8");
        g.fillStyle = bg; g.fillRect(0, 0, 1080, 1080);
        g.fillStyle = "rgba(255,255,255,.06)"; for (let i = 0; i < 14; i++) { g.beginPath(); g.arc((i * 211) % 1080, (i * 337) % 1080, 60 + (i % 4) * 30, 0, 6.283); g.fill(); }
        g.textAlign = "center"; g.fillStyle = "rgba(255,255,255,.75)"; g.font = "600 52px system-ui, sans-serif";
        g.fillText("Ігротека · " + gameTitle(p.gameName), 540, 230);
        g.fillStyle = "#ffcf3f"; g.font = "800 260px system-ui, sans-serif"; g.fillText(String(p.score), 540, 560);
        g.fillStyle = "#fff"; g.font = "700 64px system-ui, sans-serif"; g.fillText(p.player, 540, 700);
        if (p.rank) { g.font = "600 54px system-ui, sans-serif"; g.fillStyle = p.rank === 1 ? "#ffcf3f" : "rgba(255,255,255,.85)"; g.fillText(p.rank === 1 ? "Перше місце" : `#${p.rank} з ${p.total}`, 540, 790); }
        g.font = "600 46px system-ui, sans-serif"; g.fillStyle = "rgba(255,255,255,.7)"; g.fillText("Поб'єш?", 540, 930);
        c.toBlob((b) => resolve(b), "image/png");
      } catch (e) { resolve(null); }
    });
  }

  async function doShare() {
    const p = sharePayload; if (!p) return;
    const text = shareText(p), url = gameUrl();
    try {
      const blob = await shareCard(p);
      const file = blob && typeof File !== "undefined" ? new File([blob], "rekord.png", { type: "image/png" }) : null;
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: url ? text + " " + url : text });
        hideShare(); return;
      }
      if (navigator.share) { await navigator.share(url ? { text, url } : { text }); hideShare(); return; }
    } catch (e) {
      if (e && e.name === "AbortError") return; // людина передумала
    }
    try {
      await navigator.clipboard.writeText(url ? text + " " + url : text);
      shareEl.querySelector(".ss-t").textContent = "Скопійовано — встав у чат";
      clearTimeout(shareTimer); shareTimer = setTimeout(hideShare, 3000);
    } catch (e) {
      shareEl.querySelector(".ss-t").textContent = text;
    }
  }

  window.AppScore = { sendScore, incrementScore, getTopScores, getUserProfile, offerShare };
})();
