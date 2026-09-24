// ==========================================================================
// Відправка рекорду у Firestore. Викликати в кожній грі в момент game over:
//   window.AppScore && window.AppScore.sendScore('tetris', score);
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
    const empty = { trophies: { gold: 0, silver: 0, bronze: 0 }, games: [], joinedAt: null, gamesPlayedCount: 0 };
    if (!window.firebaseReady || !db) return empty;
    try {
      const allow = filterGames ? new Set(filterGames) : null;
      const [scoresSnap, userSnap] = await Promise.all([
        db.collection(SCORES_COLLECTION).get(),
        db.collection(USERS_COLLECTION).doc(username).get().catch(() => null),
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

      return { trophies, games, joinedAt, gamesPlayedCount: games.length };
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

  window.AppScore = { sendScore, incrementScore, getTopScores, getUserProfile };
})();