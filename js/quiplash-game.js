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
  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 8;
  const ABANDON_MS = 15 * 60 * 1000; // гра без жодного живого lastSeen 15хв — скидаємо

  const ROUND_PLAN = ["classic", "classic", "image"];
  const TOTAL_ROUNDS = ROUND_PLAN.length;

  const DEFAULT_VOTE_SECONDS = 25;
  const MIN_VOTE_SECONDS = 10;
  const MAX_VOTE_SECONDS = 90;
  const GALLERY_VOTE_BONUS_SECONDS = 10;
  const ANSWERING_COUNTDOWN_MS = 4000;
  const REVEAL_TIME_MS = 6000;
  const ROUND_END_TIME_MS = 8000;

  const SMIHLYSTOCHOK_THRESHOLD = 0.75;
  const SMIHLYSTOCHOK_BONUS = 300;
  const MAX_ANSWER_LEN = 100;

  const PROMPT_COOLDOWN_DAYS = 30;
  const PROMPT_HISTORY_COLLECTION = "games41_quiplash_prompt_history";
  const IMAGE_COOLDOWN_DAYS = 14; // менший пул (22 картинки) — коротший кулдаун
  const IMAGE_HISTORY_COLLECTION = "games41_quiplash_image_history";
  const AVATAR_STORAGE_PREFIX = "games41_quiplash_avatar_";

  const ROOM_SCHEMA = {
    ...emptyState(),
  };
  const Engine = window.OnlineEngine.create("quiplash", {
    phases: ["lobby", "answering", "answer_countdown", "voting", "reveal", "round_end", "game_over"],
  });

  let username = null;
  let ref = null;
  let heartbeatTimer = null;
  let tickTimer = null;
  let isHost = false;
  let onStateChange = () => {};

  function now() { return Engine.now(); }

  function sanitize(text, maxLen) {
    return (text || "").toString().replace(/[\r\n\t]/g, " ").trim().slice(0, maxLen);
  }

  function unanswered(value) { return value === null || value === undefined; }

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

  async function pickImagePrompt() {
    await QUIPLASH_IMAGE_PROMPTS_READY;
    if (!QUIPLASH_IMAGE_PROMPTS.length) return null;
    if (!window.firebaseReady || !db) {
      return QUIPLASH_IMAGE_PROMPTS[Math.floor(Math.random() * QUIPLASH_IMAGE_PROMPTS.length)];
    }
    try {
      const snap = await db.collection(IMAGE_HISTORY_COLLECTION).get();
      const history = {};
      snap.forEach((d) => { history[d.id] = d.data().lastUsedAt; });

      const cooldownMs = IMAGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
      const nowMs = Date.now();
      // id за назвою файлу картинки (не за індексом у масиві) — лишається
      // стабільним, навіть якщо image-prompts.json колись переупорядкується
      const withMeta = QUIPLASH_IMAGE_PROMPTS.map((p) => {
        const id = promptId(p.image);
        const lastUsed = history[id] || 0;
        return { ...p, id, lastUsed };
      });
      const fresh = shuffle(withMeta.filter((p) => nowMs - p.lastUsed >= cooldownMs));
      const stale = withMeta.filter((p) => nowMs - p.lastUsed < cooldownMs).sort((a, b) => a.lastUsed - b.lastUsed);
      const pick = (fresh.length ? fresh : stale)[0];

      db.collection(IMAGE_HISTORY_COLLECTION).doc(pick.id).set({ lastUsedAt: Date.now() }).catch(() => {});
      return pick;
    } catch (e) {
      console.warn("pickImagePrompt (Firestore) error, fallback to random:", e);
      return QUIPLASH_IMAGE_PROMPTS[Math.floor(Math.random() * QUIPLASH_IMAGE_PROMPTS.length)];
    }
  }

  function pickFact(roundNumber, createdAt) {
    if (!QUIPLASH_FACTS.length) return null;
    // Раніше: (roundNumber-1) % length — детерміновано, тому щоразу
    // однаково (roundNumber завжди 1,2,3 в межах гри). createdAt реально
    // різний у кожній новій грі (оновлюється forceResetRoom) — той самий
    // фікс, що й для сідла тла.
    const seed = (createdAt || 0) + (roundNumber || 0) * 97;
    return QUIPLASH_FACTS[Math.abs(seed) % QUIPLASH_FACTS.length];
  }

  // ------------------------- presence -------------------------
  function connectedEntries(players) {
    return Object.entries(players || {}).filter(([, p]) => Engine.isConnected(p));
  }

  function computeHost(players) {
    const conn = connectedEntries(players);
    if (!conn.length) return null;
    return conn.sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0))[0][0];
  }

  function storedProfile(name) {
    try {
      const value = JSON.parse(localStorage.getItem(AVATAR_STORAGE_PREFIX + name) || "null");
      if (value && Number.isInteger(value.character) && value.character >= 1 && value.character <= 8 && value.color) return value;
    } catch {}
    return null;
  }

  function rememberProfile(name, profile) {
    try { localStorage.setItem(AVATAR_STORAGE_PREFIX + name, JSON.stringify(profile)); } catch {}
  }

  function playerProfile(players, name) {
    const ordered = Object.entries(players || {}).sort((a, b) => {
      const joinedDiff = (a[1].joinedAt || 0) - (b[1].joinedAt || 0);
      return joinedDiff || a[0].localeCompare(b[0]);
    });
    const index = Math.max(0, ordered.findIndex(([playerName]) => playerName === name));
    const used = new Set(ordered
      .filter(([playerName, player]) => playerName !== name && Number.isInteger(player.character))
      .map(([, player]) => player.character));
    const current = players && players[name];
    if (current && Number.isInteger(current.character) && current.character >= 1 && current.character <= 8 && !used.has(current.character)) {
      return { character: current.character, color: current.color || QUIPLASH_AVATAR_COLORS[(current.character - 1) % QUIPLASH_AVATAR_COLORS.length] };
    }
    const saved = storedProfile(name);
    if (saved && !used.has(saved.character)) return saved;
    const character = Array.from({ length: 8 }, (_, i) => i + 1).find((value) => !used.has(value)) || ((index % 8) + 1);
    return {
      color: QUIPLASH_AVATAR_COLORS[(character - 1) % QUIPLASH_AVATAR_COLORS.length],
      character,
    };
  }

  function syncPlayerProfiles(state) {
    if (!ref || computeHost(state.players) !== username) return;
    const updates = {};
    Object.keys(state.players || {}).forEach((name) => {
      const profile = playerProfile(state.players, name);
      const current = state.players[name];
      if (current.character !== profile.character) updates[`players/${name}/character`] = profile.character;
      if (current.color !== profile.color) updates[`players/${name}/color`] = profile.color;
      if (name === username) rememberProfile(name, profile);
    });
    if (Object.keys(updates).length) ref.update(updates);
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
      tvFact: null,
      phaseDeadline: null,
      paused: false,
      awaitingContinuation: false,
    };
  }

  function start(user) {
    username = user;
    Engine.start(user, { useLobby: false });
    Engine.onStateChange = (type, data) => {
      if (type !== "room-update") return;
      const state = data.room;
      ref = Engine.roomRef;
      if (!state.players || !state.players[username]) {
        const saved = storedProfile(username);
        const profile = state.phase === "lobby" ? playerProfile(state.players, username) : saved;
        if (state.phase !== "lobby" && !profile) {
          maybeRunAsHost(state);
          onStateChange(state, { username, host: computeHost(state.players) === username });
          return;
        }
        rememberProfile(username, profile);
        Engine.becomePlayer();
      } else if (state.players && state.players[username]) {
        const profile = playerProfile(state.players, username);
        const current = state.players[username];
        Engine.becomePlayer(profile);
        rememberProfile(username, current.character ? current : profile);
        if (current.character !== profile.character || current.color !== profile.color) {
          ref.child(`players/${username}`).update(profile);
        }
      }
      syncPlayerProfiles(state);
      maybeRunAsHost(state);
      onStateChange(state, { username, host: computeHost(state.players) === username });
    };

    Engine.getOrCreateRoom(Engine.SHARED_ROOM_ID, ROOM_SCHEMA, () => emptyState()).then(({ room }) => {
      ref = Engine.roomRef;
      const extra = room.phase === "lobby" ? playerProfile(room.players, username) : null;
      if (extra) rememberProfile(username, extra);
      Engine.joinRoom(Engine.SHARED_ROOM_ID, { asPlayer: room.phase === "lobby", extra });
    });
  }

  function stop() {
    if (tickTimer) clearInterval(tickTimer);
    Engine.leaveRoom();
    Engine.stop({ preserveRoomPresence: true });
    ref = null;
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

  function setAvatar(character) {
    const selected = Number(character);
    if (!Number.isInteger(selected) || selected < 1 || selected > 8) return;
    const profile = {
      character: selected,
      color: QUIPLASH_AVATAR_COLORS[(selected - 1) % QUIPLASH_AVATAR_COLORS.length],
    };
    ref.transaction((state) => {
      if (!state || state.phase !== "lobby" || !state.players || !state.players[username]) return;
      const taken = Object.entries(state.players).some(([name, player]) =>
        name !== username && Engine.isConnected(player) && player.character === selected
      );
      if (taken) return;
      state.players[username] = { ...state.players[username], ...profile };
      return state;
    }).then((result) => {
      if (result.committed) rememberProfile(username, profile);
    });
  }

  async function startGame(state) {
    if (!state || state.phase !== "lobby" || computeHost(state.players) !== username) return;
    const conn = connectedEntries(state.players);
    if (conn.length < MIN_PLAYERS) return;
    await startRound(state, 1);
  }

  async function startRound(state, roundNumber) {
    const roundType = ROUND_PLAN[roundNumber - 1] || "classic";
    const conn = connectedEntries(state.players).map(([n]) => n);
    if (conn.length < 2) return;
    const tvFact = pickFact(roundNumber, state.createdAt);

    if (roundType === "image") {
      const p = await pickImagePrompt();
      if (p) {
        await ref.update({
          phase: "answering",
          round: roundNumber,
          gallery: { image: p.image, text: p.text, answers: {}, votes: {}, results: null, finalized: false },
          matchups: null,
          currentMatchupIndex: 0,
          tvFact,
          phaseDeadline: null,
          awaitingContinuation: false,
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
      tvFact,
      phaseDeadline: null,
      awaitingContinuation: false,
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
      if (m.playerAId === username && unanswered(m.answerA)) ref.child(`matchups/${matchupId}/answerA`).set(clean);
      else if (m.playerBId === username && unanswered(m.answerB)) ref.child(`matchups/${matchupId}/answerB`).set(clean);
    });
  }

  function submitVote(matchupId, choice) {
    ref.once("value").then((snap) => {
      const state = snap.val();
      if (!state || state.phase !== "voting" || state.paused) return;
      if (state.gallery) return; // голосування в галереї — окрема функція
      const m = state.matchups[matchupId];
      if (!m || m.id !== matchupId) return;
      const twoPlayerTest = connectedEntries(state.players).length === 2;
      const isParticipant = username === m.playerAId || username === m.playerBId;
      if (isParticipant && !twoPlayerTest) return;
      if (twoPlayerTest && ((username === m.playerAId && choice === "A") || (username === m.playerBId && choice === "B"))) return;
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
    Engine.forceResetRoom(Engine.SHARED_ROOM_ID, ROOM_SCHEMA, () => emptyState()).then(({ room }) => {
      const extra = playerProfile(room.players, username);
      rememberProfile(username, extra);
      Engine.joinRoom(Engine.SHARED_ROOM_ID, { asPlayer: room.phase === "lobby", extra });
    });
  }

  function continueGame() {
    ref.once("value").then((snap) => {
      const state = snap.val();
      if (!state || state.phase !== "round_end" || !state.awaitingContinuation) return;
      if (computeHost(state.players) !== username) return;
      startRound(state, state.round + 1);
    });
  }

  function finishGame() {
    ref.once("value").then((snap) => {
      const state = snap.val();
      if (!state || state.phase !== "round_end" || !state.awaitingContinuation) return;
      if (computeHost(state.players) !== username) return;
      ref.update({ phase: "game_over", phaseDeadline: null, awaitingContinuation: false });
    });
  }

  // ------------------------- хост-тік: переходи фаз -------------------------
  function classicVoteMs(state) { return (state.settings.voteSeconds || DEFAULT_VOTE_SECONDS) * 1000; }
  function galleryVoteMs(state) { return classicVoteMs(state) + GALLERY_VOTE_BONUS_SECONDS * 1000; }

  function playerAnswered(state, name) {
    return Object.values(state.matchups || {}).every((m) =>
      (m.playerAId !== name || !unanswered(m.answerA)) &&
      (m.playerBId !== name || !unanswered(m.answerB))
    );
  }

  function compactClassicMatchups(state) {
    const active = connectedEntries(state.players).map(([name]) => name);
    if (active.length < 2) return null;
    const old = Object.values(state.matchups || {});
    const order = [];
    old.forEach((m) => {
      [m.playerAId, m.playerBId].forEach((name) => {
        if (active.includes(name) && !order.includes(name)) order.push(name);
      });
    });
    active.forEach((name) => { if (!order.includes(name)) order.push(name); });

    const answerFor = (name) => {
      const match = old.find((m) => m.playerAId === name && !unanswered(m.answerA) || m.playerBId === name && !unanswered(m.answerB));
      if (!match) return null;
      return match.playerAId === name ? match.answerA : match.answerB;
    };
    const promptFor = (a, b) => {
      const match = old.find((m) =>
        (m.playerAId === a && m.playerBId === b) || (m.playerAId === b && m.playerBId === a)
      ) || old.find((m) => m.playerAId === a || m.playerBId === a);
      return match ? match.promptText : "Придумайте відповідь";
    };
    const matchups = {};
    for (let i = 0; i < order.length; i++) {
      const a = order[i];
      const b = order[(i + 1) % order.length];
      const id = `${state.round}-${i}`;
      matchups[id] = {
        id,
        promptText: promptFor(a, b),
        playerAId: a,
        playerBId: b,
        answerA: answerFor(a),
        answerB: answerFor(b),
        votes: {},
        finalized: false,
      };
    }
    return { matchups, currentMatchupIndex: 0 };
  }

  function allAnswered(state) {
    if (state.gallery) {
      const conn = connectedEntries(state.players).map(([n]) => n);
      return conn.every((n) => state.gallery.answers && state.gallery.answers[n] !== undefined);
    }
    const conn = connectedEntries(state.players).map(([name]) => name);
    return conn.length >= 2 && conn.every((name) => playerAnswered(state, name));
  }

  function eligibleVoterCount(state, m) {
    const connected = connectedEntries(state.players);
    if (connected.length === 2) return 2;
    return connected.filter(([n]) => n !== m.playerAId && n !== m.playerBId).length;
  }
  function votesComplete(state, m) {
    return Object.keys(m.votes || {}).length >= eligibleVoterCount(state, m);
  }
  function galleryVotesComplete(state) {
    const eligible = connectedEntries(state.players).filter(([name]) => state.gallery.answers && state.gallery.answers[name]).length;
    return Object.keys((state.gallery && state.gallery.votes) || {}).length >= eligible;
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
    const conn = Object.keys(state.gallery.answers || {});
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
        if (!state.gallery && allAnswered(state)) {
          const active = connectedEntries(state.players).map(([name]) => name);
          const hasPendingInactive = Object.keys(state.players || {}).some((name) =>
            !active.includes(name) && !playerAnswered(state, name)
          );
          if (hasPendingInactive) {
            const compacted = compactClassicMatchups(state);
            if (compacted) {
              ref.update(compacted);
              return;
            }
          }
        }
        if (allAnswered(state)) {
          if (state.gallery) {
            ref.update({ phase: "answer_countdown", phaseDeadline: t + ANSWERING_COUNTDOWN_MS });
          } else {
            ref.update({ phase: "answer_countdown", currentMatchupIndex: 0, phaseDeadline: t + ANSWERING_COUNTDOWN_MS });
          }
        }
        return;
      }

      if (state.phase === "answer_countdown") {
        if (t >= state.phaseDeadline) {
          ref.update({ phase: "voting", phaseDeadline: t + (state.gallery ? galleryVoteMs(state) : classicVoteMs(state)) });
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
        if (!state.awaitingContinuation && t >= state.phaseDeadline) {
          if (state.round >= TOTAL_ROUNDS) {
            ref.update({ phase: "round_end", phaseDeadline: null, awaitingContinuation: true });
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
    setPause, resetGame, continueGame, finishGame, setAvatar,
    set onStateChange(fn) { onStateChange = fn; },
  };
})();
