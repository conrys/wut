// ==========================================================================
// Смішліст — party-гра, перенесена з оригінального Node-сервера (HTTP-поллінг
// раз/сек + POST-дії) на Firebase: Realtime Database для живого стану гри
// (той самий host-tick принцип, що й у Змійці/Шпигуні), Firestore — для
// довгострокової пам'яті "яке питання коли показували" (те, що в оригіналі
// жило в JSON-файлі на диску сервера).
//
// Хост = гравець із найменшим joinedAt серед тих, у кого lastSeen свіжий —
// САМЕ ВІН виконує tick() (переходи фаз) і пише єдиний канонічний стан;
// інші клієнти лише читають і шлють власні відповіді/голоси.
//
// Одна спільна гра на застосунок (як і Шпигун) — вечірка грає разом.
// ==========================================================================
(function () {
  const HEARTBEAT_MS = 2000;
  const PRESENCE_TIMEOUT_MS = 5000;
  const TICK_MS = 500;
  const MIN_PLAYERS = 3;
  const MAX_PLAYERS = 8;
  const ABANDON_MS = 15 * 60 * 1000; // гра без жодного живого lastSeen 15хв — скидаємо

  const ROUND_PLAN = ["classic", "classic", "classic", "image"];
  const TOTAL_ROUNDS = ROUND_PLAN.length;

  const DEFAULT_VOTE_SECONDS = 25;
  const MIN_VOTE_SECONDS = 10;
  const MAX_VOTE_SECONDS = 90;
  const GALLERY_VOTE_BONUS_SECONDS = 10;
  const REVEAL_TIME_MS = 6000;
  const ROUND_END_TIME_MS = 8000;

  const SMIHLYSTOCHOK_THRESHOLD = 0.75;
  const SMIHLYSTOCHOK_BONUS = 300;
  const MAX_ANSWER_LEN = 100;

  const PROMPT_COOLDOWN_DAYS = 30;
  const PROMPT_HISTORY_COLLECTION = "games41_quiplash_prompt_history";

  const PATH = "quiplash_game";

  let username = null;
  let ref = null;
  let heartbeatTimer = null;
  let tickTimer = null;
  let isHost = false;
  let onStateChange = () => {};

  let serverOffset = 0;
  function now() { return Date.now() + serverOffset; }

  function sanitize(text, maxLen) {
    return (text || "").toString().replace(/[\r\n\t]/g, " ").trim().slice(0, maxLen);
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function promptId(text) {
    // простий детермінований хеш тексту (аналог sha1-зрізу з оригіналу,
    // без потреби в crypto) — використовується як ключ документа в Firestore
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) >>> 0;
    return "p" + h.toString(36);
  }

  // ------------------------- вибір питання з кулдауном (Firestore) -------------------------
  async function pickPrompt() {
    if (!window.firebaseReady || !db) {
      return QUIPLASH_PROMPTS[Math.floor(Math.random() * QUIPLASH_PROMPTS.length)];
    }
    try {
      const snap = await db.collection(PROMPT_HISTORY_COLLECTION).get();
      const history = {};
      snap.forEach((d) => { history[d.id] = d.data().lastUsedAt; });

      const cooldownMs = PROMPT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
      const nowMs = Date.now();
      const withMeta = QUIPLASH_PROMPTS.map((text) => {
        const id = promptId(text);
        const lastUsed = history[id] || 0;
        return { text, id, lastUsed };
      });
      const fresh = shuffle(withMeta.filter((p) => nowMs - p.lastUsed >= cooldownMs));
      const stale = withMeta.filter((p) => nowMs - p.lastUsed < cooldownMs).sort((a, b) => a.lastUsed - b.lastUsed);
      const pick = (fresh.length ? fresh : stale)[0];

      db.collection(PROMPT_HISTORY_COLLECTION).doc(pick.id).set({ lastUsedAt: Date.now() }).catch(() => {});
      return pick.text;
    } catch (e) {
      console.warn("pickPrompt (Firestore) error, fallback to random:", e);
      return QUIPLASH_PROMPTS[Math.floor(Math.random() * QUIPLASH_PROMPTS.length)];
    }
  }

  function pickImagePrompt() {
    if (!QUIPLASH_IMAGE_PROMPTS.length) return null;
    return QUIPLASH_IMAGE_PROMPTS[Math.floor(Math.random() * QUIPLASH_IMAGE_PROMPTS.length)];
  }

  // ------------------------- presence -------------------------
  function connectedEntries(players) {
    return Object.entries(players || {}).filter(
      ([, p]) => p.lastSeen && now() - p.lastSeen < PRESENCE_TIMEOUT_MS
    );
  }

  function computeHost(players) {
    const conn = connectedEntries(players);
    if (!conn.length) return null;
    return conn.sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0))[0][0];
  }

  function emptyState() {
    return {
      phase: "lobby",
      round: 0,
      players: {},
      settings: { voteSeconds: DEFAULT_VOTE_SECONDS },
      matchups: null,
      currentMatchupIndex: 0,
      gallery: null,
      phaseDeadline: null,
      paused: false,
    };
  }

  function start(user) {
    username = user;
    ref = window.rtdb.ref(PATH);

    if (window.rtdb) {
      window.rtdb.ref(".info/serverTimeOffset").on("value", (snap) => { serverOffset = snap.val() || 0; });
    }

    cleanupIfAbandoned();
    joinIfPossible();

    heartbeatTimer = setInterval(() => {
      ref.child("players/" + username + "/lastSeen").set(now());
    }, HEARTBEAT_MS);

    ref.child("players/" + username).onDisconnect().update({ lastSeen: 0 });

    ref.on("value", (snap) => {
      const state = snap.val() || emptyState();
      if ((!state.players || !state.players[username]) && state.phase !== "answering" && state.phase !== "voting") {
        joinIfPossible();
      }
      maybeRunAsHost(state);
      onStateChange(state, { username, host: computeHost(state.players) === username });
    });
  }

  function stop() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (tickTimer) clearInterval(tickTimer);
    if (ref) ref.off("value");
    isHost = false;
  }

  // Той самий принцип, що й у Шпигуні: якщо гра покинута (жоден гравець не
  // має свіжого lastSeen) довше ABANDON_MS — скидаємо до чистого лобі.
  function cleanupIfAbandoned() {
    ref.once("value").then((snap) => {
      const state = snap.val();
      if (!state || !state.players) return;
      const lastSeens = Object.values(state.players).map((p) => p.lastSeen || 0);
      const mostRecent = lastSeens.length ? Math.max(...lastSeens) : 0;
      if (lastSeens.length && now() - mostRecent > ABANDON_MS) {
        ref.set(emptyState());
      }
    });
  }

  function joinIfPossible() {
    ref.once("value").then((snap) => {
      const state = snap.val() || emptyState();
      const existing = state.players && state.players[username];
      if (existing) {
        ref.child("players/" + username).update({ lastSeen: now() });
        return;
      }
      if (state.phase !== "lobby" || Object.keys(state.players || {}).length >= MAX_PLAYERS) return;
      const idx = Object.keys(state.players || {}).length;
      const color = QUIPLASH_AVATAR_COLORS[idx % QUIPLASH_AVATAR_COLORS.length];
      const character = (idx % 8) + 1; // 8 доступних SVG-персонажів (img/quiplash/chars/char1..8.svg)
      ref.child("players/" + username).set({ joinedAt: now(), lastSeen: now(), color, character, score: 0 });
    });
  }

  function maybeRunAsHost(state) {
    const amHost = computeHost(state.players) === username;
    if (amHost && !isHost) {
      isHost = true;
      if (tickTimer) clearInterval(tickTimer);
      tickTimer = setInterval(() => tick(), TICK_MS);
    } else if (!amHost && isHost) {
      isHost = false;
      if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    }
  }

  // ------------------------- дії гравців/хоста -------------------------
  function updateSettings(voteSeconds) {
    const clamped = Math.min(MAX_VOTE_SECONDS, Math.max(MIN_VOTE_SECONDS, Math.round(voteSeconds)));
    ref.child("settings/voteSeconds").set(clamped);
  }

  async function startGame(state) {
    const conn = connectedEntries(state.players);
    if (conn.length < MIN_PLAYERS) return;
    await startRound(state, 1);
  }

  async function startRound(state, roundNumber) {
    const roundType = ROUND_PLAN[roundNumber - 1] || "classic";
    const conn = connectedEntries(state.players).map(([n]) => n);

    if (roundType === "image") {
      const p = pickImagePrompt();
      if (p) {
        await ref.update({
          phase: "answering",
          round: roundNumber,
          gallery: { image: p.image, text: p.text, answers: {}, votes: {}, results: null, finalized: false },
          matchups: null,
          currentMatchupIndex: 0,
          phaseDeadline: null,
        });
        return;
      }
      // немає картинок у списку — тихо їдемо класикою, як в оригіналі
    }

    const order = shuffle(conn);
    const n = order.length;
    const matchups = {};
    for (let i = 0; i < n; i++) {
      const a = order[i];
      const b = order[(i + 1) % n];
      const promptText = await pickPrompt();
      const id = `${roundNumber}-${i}`;
      matchups[id] = { id, promptText, playerAId: a, playerBId: b, answerA: null, answerB: null, votes: {}, finalized: false };
    }

    await ref.update({
      phase: "answering",
      round: roundNumber,
      gallery: null,
      matchups,
      currentMatchupIndex: 0,
      phaseDeadline: null,
    });
  }

  function submitAnswer(matchupId, text) {
    const clean = sanitize(text, MAX_ANSWER_LEN);
    if (!clean) return;
    ref.once("value").then((snap) => {
      const state = snap.val();
      if (!state || state.phase !== "answering" || state.paused) return;
      if (state.gallery) {
        if (state.gallery.answers && state.gallery.answers[username] !== undefined) return;
        ref.child(`gallery/answers/${username}`).set(clean);
        return;
      }
      const m = state.matchups && state.matchups[matchupId];
      if (!m) return;
      if (m.playerAId === username && m.answerA === null) ref.child(`matchups/${matchupId}/answerA`).set(clean);
      else if (m.playerBId === username && m.answerB === null) ref.child(`matchups/${matchupId}/answerB`).set(clean);
    });
  }

  function submitVote(matchupId, choice) {
    ref.once("value").then((snap) => {
      const state = snap.val();
      if (!state || state.phase !== "voting" || state.paused) return;
      if (state.gallery) return; // голосування в галереї — окрема функція
      const m = state.matchups[matchupId];
      if (!m || m.id !== matchupId) return;
      if (username === m.playerAId || username === m.playerBId) return;
      if (m.votes && m.votes[username]) return;
      ref.child(`matchups/${matchupId}/votes/${username}`).set(choice);
    });
  }

  function submitGalleryVote(targetId) {
    ref.once("value").then((snap) => {
      const state = snap.val();
      if (!state || state.phase !== "voting" || state.paused || !state.gallery) return;
      if (username === targetId) return;
      if (state.gallery.answers[targetId] === undefined) return;
      if (state.gallery.votes && state.gallery.votes[username]) return;
      ref.child(`gallery/votes/${username}`).set(targetId);
    });
  }

  function setPause(desired) {
    ref.once("value").then((snap) => {
      const state = snap.val();
      if (!state || state.phase === "lobby" || state.phase === "game_over") return;
      if (desired === state.paused) return;
      if (desired) {
        ref.update({ paused: true, pausedAt: now(), pausedByName: username });
      } else {
        const elapsed = now() - (state.pausedAt || now());
        const updates = { paused: false, pausedAt: null, pausedByName: null };
        if (state.phaseDeadline) updates.phaseDeadline = state.phaseDeadline + elapsed;
        ref.update(updates);
      }
    });
  }

  function resetGame() {
    ref.set(emptyState()).then(() => joinIfPossible());
  }

  // ------------------------- хост-тік: переходи фаз -------------------------
  function classicVoteMs(state) { return (state.settings.voteSeconds || DEFAULT_VOTE_SECONDS) * 1000; }
  function galleryVoteMs(state) { return classicVoteMs(state) + GALLERY_VOTE_BONUS_SECONDS * 1000; }

  function allAnswered(state) {
    if (state.gallery) {
      const conn = connectedEntries(state.players).map(([n]) => n);
      return conn.every((n) => state.gallery.answers && state.gallery.answers[n] !== undefined);
    }
    const list = Object.values(state.matchups || {});
    return list.length > 0 && list.every((m) => m.answerA !== null && m.answerB !== null);
  }

  function eligibleVoterCount(state, m) {
    return connectedEntries(state.players).filter(([n]) => n !== m.playerAId && n !== m.playerBId).length;
  }
  function votesComplete(state, m) {
    return Object.keys(m.votes || {}).length >= eligibleVoterCount(state, m);
  }
  function galleryVotesComplete(state) {
    const conn = connectedEntries(state.players).length;
    return Object.keys((state.gallery && state.gallery.votes) || {}).length >= conn;
  }

  function finalizeMatchupVotes(state, m) {
    const votes = Object.values(m.votes || {});
    const countA = votes.filter((v) => v === "A").length;
    const countB = votes.filter((v) => v === "B").length;
    const total = countA + countB;
    const perVote = 100 * state.round;
    const bonusA = total > 0 && countA / total >= SMIHLYSTOCHOK_THRESHOLD ? SMIHLYSTOCHOK_BONUS : 0;
    const bonusB = total > 0 && countB / total >= SMIHLYSTOCHOK_THRESHOLD ? SMIHLYSTOCHOK_BONUS : 0;
    const pointsA = countA * perVote + bonusA;
    const pointsB = countB * perVote + bonusB;

    const updates = {};
    updates[`matchups/${m.id}/countA`] = countA;
    updates[`matchups/${m.id}/countB`] = countB;
    updates[`matchups/${m.id}/pointsA`] = pointsA;
    updates[`matchups/${m.id}/pointsB`] = pointsB;
    updates[`matchups/${m.id}/basePointsA`] = countA * perVote;
    updates[`matchups/${m.id}/basePointsB`] = countB * perVote;
    updates[`matchups/${m.id}/bonusPointsA`] = bonusA;
    updates[`matchups/${m.id}/bonusPointsB`] = bonusB;
    updates[`matchups/${m.id}/finalized`] = true;
    if (state.players[m.playerAId]) updates[`players/${m.playerAId}/score`] = (state.players[m.playerAId].score || 0) + pointsA;
    if (state.players[m.playerBId]) updates[`players/${m.playerBId}/score`] = (state.players[m.playerBId].score || 0) + pointsB;
    return updates;
  }

  function finalizeGalleryVotes(state) {
    const conn = connectedEntries(state.players).map(([n]) => n);
    const counts = {};
    conn.forEach((n) => { counts[n] = 0; });
    Object.values(state.gallery.votes || {}).forEach((targetId) => { counts[targetId] = (counts[targetId] || 0) + 1; });
    const total = Object.keys(state.gallery.votes || {}).length;
    const perVote = 100 * state.round;

    const updates = {};
    const results = {};
    conn.forEach((n) => {
      const count = counts[n] || 0;
      const basePoints = count * perVote;
      const bonusPoints = total > 0 && count / total >= SMIHLYSTOCHOK_THRESHOLD ? SMIHLYSTOCHOK_BONUS : 0;
      const points = basePoints + bonusPoints;
      results[n] = { count, points, basePoints, bonusPoints };
      if (state.players[n]) updates[`players/${n}/score`] = (state.players[n].score || 0) + points;
    });
    updates["gallery/results"] = results;
    updates["gallery/finalized"] = true;
    return updates;
  }

  function tick() {
    ref.once("value").then((snap) => {
      const state = snap.val();
      if (!state || state.paused) return;
      if (state.phase === "lobby" || state.phase === "game_over") return;
      const t = now();

      if (state.phase === "answering") {
        if (allAnswered(state)) {
          if (state.gallery) {
            ref.update({ phase: "voting", phaseDeadline: t + galleryVoteMs(state) });
          } else {
            ref.update({ phase: "voting", currentMatchupIndex: 0, phaseDeadline: t + classicVoteMs(state) });
          }
        }
        return;
      }

      if (state.phase === "voting") {
        if (state.gallery) {
          if (galleryVotesComplete(state) || t >= state.phaseDeadline) {
            const updates = finalizeGalleryVotes(state);
            updates.phase = "reveal";
            updates.phaseDeadline = t + REVEAL_TIME_MS;
            ref.update(updates);
          }
          return;
        }
        const list = Object.values(state.matchups);
        const m = list[state.currentMatchupIndex];
        if (!m) return;
        if (votesComplete(state, m) || t >= state.phaseDeadline) {
          const updates = finalizeMatchupVotes(state, m);
          updates.phase = "reveal";
          updates.phaseDeadline = t + REVEAL_TIME_MS;
          ref.update(updates);
        }
        return;
      }

      if (state.phase === "reveal") {
        if (t >= state.phaseDeadline) {
          if (state.gallery) {
            ref.update({ phase: "round_end", phaseDeadline: t + ROUND_END_TIME_MS });
            return;
          }
          const nextIdx = state.currentMatchupIndex + 1;
          const list = Object.values(state.matchups);
          if (nextIdx < list.length) {
            ref.update({ phase: "voting", currentMatchupIndex: nextIdx, phaseDeadline: t + classicVoteMs(state) });
          } else {
            ref.update({ phase: "round_end", phaseDeadline: t + ROUND_END_TIME_MS });
          }
        }
        return;
      }

      if (state.phase === "round_end") {
        if (t >= state.phaseDeadline) {
          if (state.round >= TOTAL_ROUNDS) {
            ref.update({ phase: "game_over", phaseDeadline: null });
          } else {
            startRound(state, state.round + 1);
          }
        }
      }
    });
  }

  window.QuiplashGame = {
    MIN_PLAYERS, MAX_PLAYERS, TOTAL_ROUNDS,
    MIN_VOTE_SECONDS, MAX_VOTE_SECONDS, DEFAULT_VOTE_SECONDS,
    connectedEntries, computeHost,
    start, stop,
    updateSettings, startGame,
    submitAnswer, submitVote, submitGalleryVote,
    setPause, resetGame,
    set onStateChange(fn) { onStateChange = fn; },
  };
})();
