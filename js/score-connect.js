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

  window.AppScore = { sendScore, getTopScores };
})();
