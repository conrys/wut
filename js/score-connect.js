// ==========================================================================
// Відправка рекорду у Firestore. Викликати в кожній грі в момент game over:
//   window.AppScore && window.AppScore.sendScore('tetris', score);
// Якщо юзер не залогінений або немає мережі — просто нічого не відправляє,
// сама гра при цьому не ламається.
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
  // ------------------------------------------------------------------------
  async function getUserProfile(username) {
    const empty = { trophies: { gold: 0, silver: 0, bronze: 0 }, games: [] };
    if (!window.firebaseReady || !db) return empty;
    try {
      const snap = await db.collection(SCORES_COLLECTION).get();
      const byGame = {};
      snap.forEach((doc) => {
        const d = doc.data();
        if (!d || !d.gameName || !d.player) return;
        (byGame[d.gameName] = byGame[d.gameName] || []).push({ player: d.player, score: d.score });
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
        games.push({ gameName, score: rows[idx].score, rank, total: rows.length });
      });
      games.sort((a, b) => a.rank - b.rank || a.gameName.localeCompare(b.gameName));

      return { trophies, games };
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