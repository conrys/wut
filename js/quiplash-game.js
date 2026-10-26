// ==========================================================================
// Сміхлист — party-гра в дусі Quiplash (Jackbox) на Firebase.
// Realtime Database — живий стан кімнати; Firestore — пам'ять "яке питання /
// яку картинку коли показували" (кулдаун між іграми).
//
// Хост = гравець із найменшим joinedAt серед тих, чий клієнт живий просто
// зараз. САМЕ ВІН крутить tick() (переходи фаз, підрахунок) і пише канонічний
// стан; інші клієнти лише читають і шлють власні відповіді/голоси.
//
// Потік раунду:
//   round_intro → answering → answer_countdown →
//   (voting → reveal) × пари → round_end → … → game_over
// Кожна фаза з таймером має phaseStartedAt + phaseDeadline (обидва зсуваються
// паузою), тож будь-який екран малює таймер без власних констант.
//
// Очки пишуться ідемпотентно: roundScores/{раунд}/{гравець}/{пара} = бали,
// а players/{гравець}/score — сума всіх roundScores. Повторний підрахунок
// тієї самої пари (два хости на мить) дає ті самі числа, а не подвоєні.
// ==========================================================================
(function () {
  const GAME_KEY = "quiplash";
  const TICK_MS = 400;
  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 20;
  // Більше 8 людей — у раунді відповідають 8 (хто відповідав найменше),
  // решта цей раунд лише голосує. Інакше 20 дуелей ≈ 8–10 хв на раунд.
  const MAX_ANSWERERS = 8;
  const ROUND_PLAN = ["classic", "classic", "image"];
  const TOTAL_ROUNDS = ROUND_PLAN.length;

  // ---- таймінги (єдине джерело правди для телефонів, ТВ і ботів) ----
  const ROUND_INTRO_MS = 4500;
  const ANSWER_MS = 90000;        // класика: дві відповіді на гравця
  const IMAGE_ANSWER_MS = 75000;  // фінал: один підпис до картинки
  const ANSWER_DONE_MS = 2500;    // «Всі відповіли!» / «Час вийшов!»
  const VOTE_INTRO_MS = 2500;     // VS-заставка перед голосуванням
  const VOTE_MS = 20000;
  const GALLERY_VOTE_BASE_MS = 25000;
  const GALLERY_VOTE_PER_ANSWER_MS = 2500;
  const GALLERY_VOTE_MAX_MS = 45000;
  const REVEAL_MS = 7500;
  const GALLERY_REVEAL_MS = 9000;
  const ROUND_END_MS = 10000;

  // ---- очки: множник раунду ×1, ×2, ×3 ----
  const POINTS_PER_VOTE = 100;
  const WIN_BONUS = 100;
  const SUPER_BONUS = 250; // усі голоси (мінімум 2) за одну відповідь — «СМІХЛИСТ!»
  const MAX_ANSWER_LEN = 80;

  const PROMPT_COOLDOWN_DAYS = 30;
  const PROMPT_HISTORY_COLLECTION = "games41_quiplash_prompt_history";
  const IMAGE_COOLDOWN_DAYS = 14;
  const IMAGE_HISTORY_COLLECTION = "games41_quiplash_image_history";
  const AVATAR_STORAGE_PREFIX = "games41_quiplash_avatar_";
  const AVATAR_COUNT = 20;

  // «Рятівна відповідь» — як Safety Quip у Jackbox: підставляє готовий жарт,
  // якщо нічого не спадає на думку.
  const SAFETY_QUIPS = [
    "Мамина пательня", "Податкова", "Борщ без сметани", "Сусід з перфоратором", "Кіт, який усе бачив",
    "Пароль від вайфаю", "Шкарпетка без пари", "Понеділок", "Голосове на 7 хвилин", "Бабусин сервіз",
    "Квитанція за світло", "Тещин холодець", "Пакет з пакетами", "Забута каструля на плиті", "Рекламний дзвінок о 8 ранку",
    "Бутерброд маслом донизу", "Оновлення Windows", "Чек на два метри", "Курка, що перейшла дорогу", "Сало в шоколаді",
    "Груповий чат батьків", "Таємний рецепт олів'є", "Мем, який ніхто не зрозумів", "Будильник без кнопки «ще 5 хвилин»", "Дід у шльопанцях",
  ];

  const Engine = window.OnlineEngine.create(GAME_KEY, {
    phases: ["lobby", "round_intro", "answering", "answer_countdown", "voting", "reveal", "round_end", "game_over"],
    abandonMs: 3 * 60 * 1000,
  });
  const ABANDON_MS = Engine.ABANDON_MS || 3 * 60 * 1000;

  let username = null;
  let ref = null;
  let tickTimer = null;
  let isHost = false;
  let latest = null;
  let busy = false; // хост зараз асинхронно готує раунд — тік не запускає ще один
  let joinRequestedAt = 0;
  let onStateChange = () => {};

  function now() { return Engine.now(); }
  function sanitize(text, maxLen) { return (text || "").toString().replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLen); }
  function unanswered(v) { return v === null || v === undefined || v === ""; }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function promptId(text) {
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) >>> 0;
    return "p" + h.toString(36);
  }
  function mult(round) { return Math.max(1, Math.min(3, round || 1)); }

  // ------------------------- вибір питань з кулдауном -------------------------
  // Один запит до історії на весь раунд (раніше — повне читання колекції на
  // КОЖНУ пару, і дві пари могли отримати те саме питання).
  async function pickPrompts(count) {
    const all = QUIPLASH_PROMPTS.slice();
    const fallback = () => shuffle(all).slice(0, count);
    if (!window.firebaseReady || typeof db === "undefined" || !db) return fallback();
    try {
      const snap = await Promise.race([
        db.collection(PROMPT_HISTORY_COLLECTION).get(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3500)),
      ]);
      const history = {};
      snap.forEach((d) => { history[d.id] = d.data().lastUsedAt; });
      const cooldownMs = PROMPT_COOLDOWN_DAYS * 864e5;
      const t = Date.now();
      const meta = all.map((text) => ({ text, id: promptId(text), lastUsed: history[promptId(text)] || 0 }));
      const fresh = shuffle(meta.filter((p) => t - p.lastUsed >= cooldownMs));
      const stale = meta.filter((p) => t - p.lastUsed < cooldownMs).sort((a, b) => a.lastUsed - b.lastUsed);
      const picks = fresh.concat(stale).slice(0, count);
      const batch = db.batch();
      picks.forEach((p) => batch.set(db.collection(PROMPT_HISTORY_COLLECTION).doc(p.id), { lastUsedAt: Date.now() }));
      batch.commit().catch(() => {});
      return picks.map((p) => p.text);
    } catch (e) {
      console.warn("pickPrompts fallback:", e && e.message);
      return fallback();
    }
  }

  async function pickImagePrompt() {
    try { await QUIPLASH_IMAGE_PROMPTS_READY; } catch (e) {}
    // вбудовані (ql_img/) + хмарні з upload.html
    const cloud = window.MediaPool ? await window.MediaPool.list("quiplash") : [];
    const prompts = QUIPLASH_IMAGE_PROMPTS.concat(cloud.map((it) => ({
      image: it.url, text: it.text || "Придумайте смішний підпис до цієї картинки",
    })));
    if (!prompts.length) return null;
    const random = () => prompts[Math.floor(Math.random() * prompts.length)];
    if (!window.firebaseReady || typeof db === "undefined" || !db) return random();
    try {
      const snap = await Promise.race([
        db.collection(IMAGE_HISTORY_COLLECTION).get(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3500)),
      ]);
      const history = {};
      snap.forEach((d) => { history[d.id] = d.data().lastUsedAt; });
      const cooldownMs = IMAGE_COOLDOWN_DAYS * 864e5;
      const t = Date.now();
      const meta = prompts.map((p) => ({ ...p, id: promptId(p.image), lastUsed: history[promptId(p.image)] || 0 }));
      const fresh = shuffle(meta.filter((p) => t - p.lastUsed >= cooldownMs));
      const stale = meta.filter((p) => t - p.lastUsed < cooldownMs).sort((a, b) => a.lastUsed - b.lastUsed);
      const pick = fresh[0] || stale[0];
      db.collection(IMAGE_HISTORY_COLLECTION).doc(pick.id).set({ lastUsedAt: Date.now() }).catch(() => {});
      return pick;
    } catch (e) {
      console.warn("pickImagePrompt fallback:", e && e.message);
      return random();
    }
  }

  function pickFact(roundNumber, createdAt) {
    if (!QUIPLASH_FACTS.length) return null;
    const seed = (createdAt || 0) + (roundNumber || 0) * 97;
    return QUIPLASH_FACTS[Math.abs(seed) % QUIPLASH_FACTS.length];
  }

  // ------------------------- присутність -------------------------
  function connectedEntries(players) { return Object.entries(players || {}).filter(([, p]) => Engine.isConnected(p)); }
  function connectedNames(state) { return connectedEntries(state.players).map(([n]) => n); }
  function activeNames(state) { return Object.entries(state.players || {}).filter(([, p]) => Engine.isActiveNow(p)).map(([n]) => n); }

  // Хост — лише справжній клієнт гри (його heartbeat пише sessionId). Тестові
  // боти пишуть тільки lastSeen і крутити тік не вміють: раніше, щойно телефон
  // ведучого засинав, ведучим ставав бот — і гра стояла, поки людина не повернеться.
  function computeHost(players) {
    const active = Object.entries(players || {}).filter(([, p]) => Engine.isActiveNow(p));
    const real = active.filter(([, p]) => p.sessionId);
    const pool = real.length ? real : active;
    if (!pool.length) return null;
    return pool.sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0) || a[0].localeCompare(b[0]))[0][0];
  }

  // ------------------------- аватарки -------------------------
  function validChar(c) { return Number.isInteger(c) && c >= 1 && c <= AVATAR_COUNT; }
  function charColor(c) { return window.QuiplashAvatars ? QuiplashAvatars.color(c) : (QUIPLASH_AVATAR_COLORS[(c - 1) % QUIPLASH_AVATAR_COLORS.length]); }

  function storedChar(name) {
    try {
      const v = JSON.parse(localStorage.getItem(AVATAR_STORAGE_PREFIX + name) || "null");
      if (v && validChar(v.character)) return v.character;
    } catch (e) {}
    return null;
  }
  function rememberChar(name, character) {
    try { localStorage.setItem(AVATAR_STORAGE_PREFIX + name, JSON.stringify({ character, color: charColor(character) })); } catch (e) {}
  }

  // Детерміновано: конфлікт двох однакових персонажів вирішується на користь
  // того, хто зайшов раніше — пізніший бере вільного. Ніякого пінг-понгу.
  function playerProfile(players, name, preferred) {
    const ordered = Object.entries(players || {}).sort((a, b) =>
      (a[1].joinedAt || 0) - (b[1].joinedAt || 0) || a[0].localeCompare(b[0]));
    const used = new Set();
    let result = null;
    for (const [n, p] of ordered) {
      let want = n === name && validChar(preferred) ? preferred : p.character;
      if (!validChar(want) || used.has(want)) {
        const saved = n === name ? storedChar(n) : null;
        want = saved && !used.has(saved) ? saved : null;
        if (!want) for (let c = 1; c <= AVATAR_COUNT; c++) if (!used.has(c)) { want = c; break; }
        if (!want) want = 1;
      }
      used.add(want);
      if (n === name) result = want;
    }
    if (result == null) {
      // гравця ще нема в players — перший вільний (або збережений)
      const saved = validChar(preferred) ? preferred : storedChar(name);
      if (saved && !used.has(saved)) result = saved;
      else { for (let c = 1; c <= AVATAR_COUNT; c++) if (!used.has(c)) { result = c; break; } }
      if (result == null) result = 1;
    }
    return { character: result, color: charColor(result) };
  }

  function syncPlayerProfiles(state) {
    if (!ref || computeHost(state.players) !== username) return;
    const updates = {};
    Object.keys(state.players || {}).forEach((name) => {
      const prof = playerProfile(state.players, name);
      const cur = state.players[name];
      if (cur.character !== prof.character) updates[`players/${name}/character`] = prof.character;
      if (cur.color !== prof.color) updates[`players/${name}/color`] = prof.color;
    });
    if (Object.keys(updates).length) ref.update(updates);
  }

  function emptyState() {
    return {
      phase: "lobby",
      round: 0,
      players: {},
      currentMatchupIndex: 0,
      paused: false,
    };
  }
  const ROOM_SCHEMA = emptyState();

  // ------------------------- список активних кімнат -------------------------
  function watchActiveRooms(callback) {
    if (!window.rtdb) { callback([]); return () => {}; }
    const roomsRef = window.rtdb.ref(`${GAME_KEY}_rooms`);
    const onValue = (snap) => {
      const rooms = snap.val() || {};
      const t = now();
      const list = Object.entries(rooms).map(([roomId, room]) => {
        const players = room.players || {};
        const connected = Object.entries(players).filter(([, p]) => Engine.isConnected(p));
        const lastSeens = Object.values(players).map((p) => p.lastSeen || 0);
        const mostRecentPlayer = lastSeens.length ? Math.max(...lastSeens) : 0;
        const lastActivity = Math.max(room.lastActivityAt || 0, room.createdAt || 0, mostRecentPlayer);
        const stale = !connected.length && (!lastActivity || t - lastActivity > ABANDON_MS);
        return { roomId, phase: room.phase || "lobby", playerCount: Object.keys(players).length, connectedCount: connected.length, stale };
      }).filter((r) => !r.stale)
        .sort((a, b) => b.connectedCount - a.connectedCount || b.playerCount - a.playerCount);
      callback(list);
    };
    roomsRef.on("value", onValue);
    return () => roomsRef.off("value", onValue);
  }

  // ------------------------- старт / підключення -------------------------
  function start(user, roomId) {
    username = user;
    Engine.start(user, { useLobby: false });
    Engine.onStateChange = (type, data) => {
      if (type !== "room-update") return;
      const state = data.room;
      latest = state;
      ref = Engine.roomRef;
      const me = state.players && state.players[username];
      const count = Object.keys(state.players || {}).length;
      if (!me) {
        // Заходити можна будь-коли (і посеред гри — тоді голосуєш, а
        // відповідаєш з наступного раунду), поки є місце.
        if (count < MAX_PLAYERS && now() - joinRequestedAt > 4000) {
          joinRequestedAt = now();
          const prof = playerProfile(state.players, username);
          rememberChar(username, prof.character);
          Engine.becomePlayer({ ...prof, score: 0 });
        }
      } else {
        const prof = playerProfile(state.players, username);
        if (me.character !== prof.character || me.color !== prof.color) ref.child(`players/${username}`).update(prof);
        rememberChar(username, prof.character);
      }
      syncPlayerProfiles(state);
      maybeRunAsHost(state);
      onStateChange(state, { username, host: computeHost(state.players) === username });
    };

    return Engine.getOrCreateRoom(roomId, ROOM_SCHEMA, () => emptyState()).then(({ room }) => {
      ref = Engine.roomRef;
      const full = Object.keys(room.players || {}).length >= MAX_PLAYERS && !(room.players || {})[username];
      const extra = full ? null : { ...playerProfile(room.players, username), score: (room.players && room.players[username] && room.players[username].score) || 0 };
      if (extra) rememberChar(username, extra.character);
      return Engine.joinRoom(roomId, { asPlayer: !full, extra });
    });
  }

  function stop() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
    Engine.stop({ preserveRoomPresence: true });
    ref = null;
    isHost = false;
  }

  function cleanupIfAbandoned() {
    if (!ref) return;
    ref.once("value").then((snap) => {
      const state = snap.val();
      if (!state || !state.players) return;
      const lastSeens = Object.values(state.players).map((p) => p.lastSeen || 0);
      const mostRecent = lastSeens.length ? Math.max(...lastSeens) : 0;
      if (lastSeens.length && now() - mostRecent > ABANDON_MS) ref.set(emptyState());
    });
  }

  function maybeRunAsHost(state) {
    const amHost = computeHost(state.players) === username;
    if (amHost && !isHost) {
      isHost = true;
      if (tickTimer) clearInterval(tickTimer);
      tickTimer = setInterval(tick, TICK_MS);
    } else if (!amHost && isHost) {
      isHost = false;
      if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    }
  }

  // ------------------------- дії гравців -------------------------
  function setAvatar(character) {
    const selected = Number(character);
    if (!validChar(selected) || !ref) return;
    ref.child("players").transaction((players) => {
      if (!players || !players[username]) return players;
      const taken = Object.entries(players).some(([n, p]) => n !== username && p && p.character === selected);
      if (taken) return; // abort
      players[username].character = selected;
      players[username].color = charColor(selected);
      return players;
    }).then((res) => { if (res.committed) rememberChar(username, selected); }).catch(() => {});
  }

  function startGame(state) {
    state = latest || state;
    if (!state || state.phase !== "lobby" || computeHost(state.players) !== username) return;
    if (connectedNames(state).length < MIN_PLAYERS) return;
    // нова гра — чистий рахунок у всіх
    const updates = { roundScores: null, answerCounts: null, superSmihlystokAt: null, superSmihlystokUsername: null };
    Object.keys(state.players || {}).forEach((n) => { updates[`players/${n}/score`] = 0; });
    ref.update(updates).then(() => startRound(Object.assign({}, state, { answerCounts: null, roundScores: null }), 1));
  }

  function submitAnswer(matchupId, text) {
    const clean = sanitize(text, MAX_ANSWER_LEN);
    if (!clean || !ref) return Promise.resolve(false);
    const state = latest;
    if (!state || state.phase !== "answering" || state.paused) return Promise.resolve(false);
    if (state.gallery) {
      if (!isAnswerer(state, username)) return Promise.resolve(false);
      if (state.gallery.answers && !unanswered(state.gallery.answers[username])) return Promise.resolve(false);
      return ref.child(`gallery/answers/${username}`).set(clean).then(() => true);
    }
    const m = state.matchups && state.matchups[matchupId];
    if (!m) return Promise.resolve(false);
    if (m.playerAId === username && unanswered(m.answerA)) return ref.child(`matchups/${matchupId}/answerA`).set(clean).then(() => true);
    if (m.playerBId === username && unanswered(m.answerB)) return ref.child(`matchups/${matchupId}/answerB`).set(clean).then(() => true);
    return Promise.resolve(false);
  }

  function canVoteOn(state, m, name) {
    const twoPlayer = connectedNames(state).length === 2;
    const isParticipant = name === m.playerAId || name === m.playerBId;
    return twoPlayer || !isParticipant;
  }

  function submitVote(matchupId, choice) {
    const state = latest;
    if (!ref || !state || state.phase !== "voting" || state.paused || state.gallery) return;
    if (state.voteRevealAt && now() < state.voteRevealAt) return;
    const m = state.matchups && state.matchups[matchupId];
    if (!m || (choice !== "A" && choice !== "B")) return;
    if (!canVoteOn(state, m, username)) return;
    // тест удвох: голосуєш лише за чужу відповідь
    if ((username === m.playerAId && choice === "A") || (username === m.playerBId && choice === "B")) return;
    if (m.votes && m.votes[username]) return;
    ref.child(`matchups/${matchupId}/votes/${username}`).set(choice);
  }

  function submitGalleryVote(targetId) {
    const state = latest;
    if (!ref || !state || state.phase !== "voting" || state.paused || !state.gallery) return;
    if (state.voteRevealAt && now() < state.voteRevealAt) return;
    if (username === targetId) return;
    if (!state.gallery.answers || unanswered(state.gallery.answers[targetId])) return;
    if (state.gallery.votes && state.gallery.votes[username]) return;
    ref.child(`gallery/votes/${username}`).set(targetId);
  }

  function setPause(desired) {
    const state = latest;
    if (!ref || !state || state.phase === "lobby" || state.phase === "game_over") return;
    if (!!desired === !!state.paused) return;
    if (desired) {
      ref.update({ paused: true, pausedAt: now(), pausedByName: username });
    } else {
      const elapsed = now() - (state.pausedAt || now());
      const u = { paused: false, pausedAt: null, pausedByName: null };
      if (state.phaseDeadline) u.phaseDeadline = state.phaseDeadline + elapsed;
      if (state.phaseStartedAt) u.phaseStartedAt = state.phaseStartedAt + elapsed;
      if (state.voteRevealAt) u.voteRevealAt = state.voteRevealAt + elapsed;
      ref.update(u);
    }
  }

  // Назад у лобі тими самими гравцями (раніше — повне перестворення кімнати,
  // через яке всі на мить "вилітали" і ведучий міг змінитись).
  function backToLobby() {
    const state = latest;
    if (!ref || !state || computeHost(state.players) !== username) return;
    const u = {
      phase: "lobby", round: 0, matchups: null, gallery: null, currentMatchupIndex: 0, roundReady: null,
      phaseDeadline: null, phaseStartedAt: null, voteRevealAt: null, paused: false, pausedAt: null, pausedByName: null,
      roundAnswerers: null, answerCounts: null, roundScores: null, tvFact: null, timedOut: null,
      superSmihlystokAt: null, superSmihlystokUsername: null, createdAt: now(),
    };
    Object.keys(state.players || {}).forEach((n) => { u[`players/${n}/score`] = 0; });
    ref.update(u);
  }
  function resetGame() { backToLobby(); }

  // ------------------------- раунди -------------------------
  function isAnswerer(state, name) {
    return !state || !Array.isArray(state.roundAnswerers) || state.roundAnswerers.includes(name);
  }

  function pickAnswerers(state, conn, roundType) {
    const counts = state.answerCounts || {};
    // фінал — один підпис на гравця, тож пишуть усі
    if (roundType === "image" || conn.length <= MAX_ANSWERERS) return conn.slice();
    return shuffle(conn).sort((a, b) => (counts[a] || 0) - (counts[b] || 0)).slice(0, MAX_ANSWERERS);
  }

  function matchupList(state) {
    return Object.keys(state.matchups || {}).sort().map((k) => state.matchups[k]);
  }

  async function startRound(state, roundNumber) {
    if (busy) return;
    busy = true;
    try {
      const conn = connectedNames(state);
      if (conn.length < MIN_PLAYERS) return;
      const roundType = ROUND_PLAN[roundNumber - 1] || "classic";
      const answerers = pickAnswerers(state, conn, roundType);
      const answerCounts = Object.assign({}, state.answerCounts || {});
      answerers.forEach((n) => { answerCounts[n] = (answerCounts[n] || 0) + 1; });
      const t = now();
      // 1) одразу показуємо заставку раунду — питання готуються, поки вона йде
      await ref.update({
        phase: "round_intro", round: roundNumber, roundType,
        phaseStartedAt: t, phaseDeadline: t + ROUND_INTRO_MS, voteRevealAt: null,
        matchups: null, gallery: null, currentMatchupIndex: 0, roundReady: null, timedOut: null,
        roundAnswerers: answerers, answerCounts, tvFact: pickFact(roundNumber, state.createdAt),
      });

      let content = null;
      if (roundType === "image") {
        const p = await pickImagePrompt();
        if (p) content = { gallery: { image: p.image, text: (p.text || "").trim(), answers: {}, votes: {}, finalized: false } };
      }
      if (!content) {
        const order = shuffle(answerers);
        const n = order.length;
        // Кільце: кожен гравець отримує 2 питання, кожне питання — 2 гравцям.
        // Удвох кільце дає дві пари з тими самими людьми й різними питаннями.
        const prompts = await pickPrompts(n);
        const matchups = {};
        for (let i = 0; i < n; i++) {
          const id = `r${roundNumber}m${String(i).padStart(2, "0")}`;
          matchups[id] = { id, promptText: prompts[i % prompts.length], playerAId: order[i], playerBId: order[(i + 1) % n], finalized: false };
        }
        content = { matchups, roundType: "classic" };
      }
      // 2) кімната могла змінитись, поки чекали Firestore — пишемо, лише якщо це досі наш раунд
      // (latest може ще не встигнути оновитись після нашого ж запису вище —
      // тому відкидаємо лише явно чужий/новіший стан)
      const cur = latest;
      if (cur && (cur.phase === "lobby" || cur.phase === "game_over" || (cur.round || 0) > roundNumber ||
        (cur.round === roundNumber && cur.phase !== "round_intro"))) return;
      await ref.update({ ...content, roundReady: roundNumber });
    } catch (e) {
      console.warn("startRound error:", e);
    } finally {
      busy = false;
    }
  }

  function answerMsFor(state) { return state.gallery ? IMAGE_ANSWER_MS : ANSWER_MS; }
  function galleryVoteMs(state) {
    const n = Object.keys((state.gallery && state.gallery.answers) || {}).length;
    return Math.min(GALLERY_VOTE_MAX_MS, GALLERY_VOTE_BASE_MS + n * GALLERY_VOTE_PER_ANSWER_MS);
  }

  function playerAnswered(state, name) {
    if (state.gallery) return !isAnswerer(state, name) || !unanswered((state.gallery.answers || {})[name]);
    return matchupList(state).every((m) =>
      (m.playerAId !== name || !unanswered(m.answerA)) && (m.playerBId !== name || !unanswered(m.answerB)));
  }
  // Чекаємо лише тих, чий застосунок відкритий просто зараз; решту рятує таймер.
  function allAnswered(state) {
    const waiting = activeNames(state).filter((n) => isAnswerer(state, n));
    return waiting.every((n) => playerAnswered(state, n));
  }

  function eligibleVoters(state, m) {
    const conn = connectedNames(state);
    if (conn.length === 2) return conn;
    return conn.filter((n) => n !== m.playerAId && n !== m.playerBId);
  }
  function votesComplete(state, m) {
    const votes = m.votes || {};
    const active = new Set(activeNames(state));
    const need = eligibleVoters(state, m).filter((n) => active.has(n));
    return need.every((n) => votes[n]);
  }
  function galleryVoters(state) {
    const answers = state.gallery.answers || {};
    const authors = Object.keys(answers).filter((n) => !unanswered(answers[n]));
    return connectedNames(state).filter((n) => authors.some((a) => a !== n));
  }
  function galleryVotesComplete(state) {
    const votes = state.gallery.votes || {};
    const active = new Set(activeNames(state));
    return galleryVoters(state).filter((n) => active.has(n)).every((n) => votes[n]);
  }

  function scoreUpdates(state, round, gains) {
    // gains: { name: { key: points } } — ідемпотентно перезаписує ці ключі і
    // перераховує повну суму кожного зачепленого гравця з нуля.
    const rs = JSON.parse(JSON.stringify(state.roundScores || {}));
    const u = {};
    Object.entries(gains).forEach(([name, byKey]) => {
      Object.entries(byKey).forEach(([key, pts]) => {
        rs[round] = rs[round] || {};
        rs[round][name] = rs[round][name] || {};
        rs[round][name][key] = pts;
        u[`roundScores/${round}/${name}/${key}`] = pts;
      });
    });
    Object.keys(gains).forEach((name) => {
      if (!state.players || !state.players[name]) return;
      let total = 0;
      Object.values(rs).forEach((byName) => Object.values((byName && byName[name]) || {}).forEach((p) => { total += Number(p) || 0; }));
      u[`players/${name}/score`] = total;
    });
    return u;
  }

  function finalizeMatchup(state, m) {
    const k = mult(state.round);
    const per = POINTS_PER_VOTE * k;
    const aMissing = unanswered(m.answerA), bMissing = unanswered(m.answerB);
    const p = `matchups/${m.id}/`;
    const u = {};
    let res;
    if (aMissing || bMissing) {
      // перемога без бою: суперник не відповів
      const voters = Math.max(1, eligibleVoters(state, m).length);
      res = {
        countA: 0, countB: 0,
        pointsA: aMissing ? 0 : per * voters, pointsB: bMissing ? 0 : per * voters,
        bonusA: 0, bonusB: 0,
        bonusKindA: aMissing ? null : "forfeit", bonusKindB: bMissing ? null : "forfeit",
      };
    } else {
      const votes = Object.values(m.votes || {});
      const countA = votes.filter((v) => v === "A").length;
      const countB = votes.filter((v) => v === "B").length;
      const total = countA + countB;
      const kind = (mine, theirs) => {
        if (!mine || mine <= theirs) return null;
        return total >= 2 && theirs === 0 ? "super" : "win";
      };
      const kindA = kind(countA, countB), kindB = kind(countB, countA);
      const bonus = (kd) => (kd === "super" ? SUPER_BONUS * k : kd === "win" ? WIN_BONUS * k : 0);
      res = {
        countA, countB,
        bonusA: bonus(kindA), bonusB: bonus(kindB),
        pointsA: countA * per + bonus(kindA), pointsB: countB * per + bonus(kindB),
        bonusKindA: kindA, bonusKindB: kindB,
      };
      if (kindA === "super" || kindB === "super") {
        u.superSmihlystokUsername = kindA === "super" ? m.playerAId : m.playerBId;
        u.superSmihlystokAt = now();
      }
    }
    Object.entries(res).forEach(([key, val]) => { u[p + key] = val; });
    u[p + "finalized"] = true;
    const gains = {};
    gains[m.playerAId] = { [m.id]: res.pointsA };
    if (m.playerBId !== m.playerAId) gains[m.playerBId] = Object.assign(gains[m.playerBId] || {}, { [m.id]: res.pointsB });
    else gains[m.playerAId][m.id] = res.pointsA + res.pointsB;
    return Object.assign(u, scoreUpdates(state, state.round, gains));
  }

  function finalizeGallery(state) {
    const k = mult(state.round);
    const per = POINTS_PER_VOTE * k;
    const answers = state.gallery.answers || {};
    const authors = Object.keys(answers).filter((n) => !unanswered(answers[n]));
    const counts = {};
    authors.forEach((n) => { counts[n] = 0; });
    Object.values(state.gallery.votes || {}).forEach((target) => { if (target in counts) counts[target]++; });
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const top = Math.max(0, ...Object.values(counts));
    const results = {};
    const gains = {};
    const u = {};
    authors.forEach((n) => {
      const count = counts[n];
      let bonusKind = null;
      if (count > 0 && count === top) bonusKind = total >= 2 && count === total ? "super" : "win";
      const bonus = bonusKind === "super" ? SUPER_BONUS * k : bonusKind === "win" ? WIN_BONUS * k : 0;
      results[n] = { count, basePoints: count * per, bonusPoints: bonus, bonusKind, points: count * per + bonus };
      gains[n] = { g: results[n].points };
      if (bonusKind === "super") { u.superSmihlystokUsername = n; u.superSmihlystokAt = now(); }
    });
    u["gallery/results"] = results;
    u["gallery/finalized"] = true;
    return Object.assign(u, scoreUpdates(state, state.round, gains));
  }

  // Наступна пара для показу: пропускає пари без жодної відповіді, а пари
  // з однією відповіддю одразу йдуть у reveal (перемога без бою).
  function enterMatchup(state, fromIdx, t) {
    const list = matchupList(state);
    for (let i = fromIdx; i < list.length; i++) {
      const m = list[i];
      const aMissing = unanswered(m.answerA), bMissing = unanswered(m.answerB);
      if (aMissing && bMissing) continue;
      if (aMissing || bMissing) {
        const u = finalizeMatchup(state, m);
        return Object.assign(u, { phase: "reveal", currentMatchupIndex: i, voteRevealAt: null, phaseStartedAt: t, phaseDeadline: t + REVEAL_MS });
      }
      return { phase: "voting", currentMatchupIndex: i, voteRevealAt: t + VOTE_INTRO_MS, phaseStartedAt: t + VOTE_INTRO_MS, phaseDeadline: t + VOTE_INTRO_MS + VOTE_MS };
    }
    return { phase: "round_end", voteRevealAt: null, phaseStartedAt: t, phaseDeadline: t + ROUND_END_MS };
  }

  // ------------------------- хост-тік -------------------------
  function tick() {
    const state = latest;
    if (!ref || !state || state.paused || busy) return;
    if (computeHost(state.players) !== username) return;
    const t = now();
    const deadlinePassed = state.phaseDeadline && t >= state.phaseDeadline;

    switch (state.phase) {
      case "round_intro":
        if (deadlinePassed && state.roundReady === state.round) {
          const ms = answerMsFor(state);
          ref.update({ phase: "answering", phaseStartedAt: t, phaseDeadline: t + ms });
        } else if (state.roundReady !== state.round && state.phaseDeadline && t > state.phaseDeadline + 8000) {
          // хост змінився посеред підготовки — готуємо раунд заново
          startRound(state, state.round);
        }
        return;
      case "answering":
        if (deadlinePassed || allAnswered(state)) {
          ref.update({ phase: "answer_countdown", timedOut: !!deadlinePassed && !allAnswered(state), phaseStartedAt: t, phaseDeadline: t + ANSWER_DONE_MS });
        }
        return;
      case "answer_countdown":
        if (!deadlinePassed) return;
        if (state.gallery) {
          const answers = state.gallery.answers || {};
          const n = Object.keys(answers).filter((k) => !unanswered(answers[k])).length;
          if (n < 2) {
            // нема з чого обирати — одразу підсумок (одинокий підпис бере бали без бою)
            const u = n === 1 ? finalizeGallery(state) : { "gallery/finalized": true };
            ref.update(Object.assign(u, { phase: "round_end", phaseStartedAt: t, phaseDeadline: t + ROUND_END_MS }));
            return;
          }
          const vm = galleryVoteMs(state);
          ref.update({ phase: "voting", voteRevealAt: t + VOTE_INTRO_MS, phaseStartedAt: t + VOTE_INTRO_MS, phaseDeadline: t + VOTE_INTRO_MS + vm });
          return;
        }
        ref.update(enterMatchup(state, 0, t));
        return;
      case "voting": {
        if (state.voteRevealAt && t < state.voteRevealAt) return;
        if (state.gallery) {
          if (deadlinePassed || galleryVotesComplete(state)) {
            ref.update(Object.assign(finalizeGallery(state), { phase: "reveal", phaseStartedAt: t, phaseDeadline: t + GALLERY_REVEAL_MS }));
          }
          return;
        }
        const m = matchupList(state)[state.currentMatchupIndex];
        if (!m) { ref.update(enterMatchup(state, state.currentMatchupIndex + 1, t)); return; }
        if (deadlinePassed || votesComplete(state, m)) {
          ref.update(Object.assign(finalizeMatchup(state, m), { phase: "reveal", phaseStartedAt: t, phaseDeadline: t + REVEAL_MS }));
        }
        return;
      }
      case "reveal":
        if (!deadlinePassed) return;
        if (state.gallery) { ref.update({ phase: "round_end", phaseStartedAt: t, phaseDeadline: t + ROUND_END_MS }); return; }
        ref.update(enterMatchup(state, (state.currentMatchupIndex || 0) + 1, t));
        return;
      case "round_end":
        if (!deadlinePassed) return;
        if (state.round >= TOTAL_ROUNDS) {
          ref.update({ phase: "game_over", phaseDeadline: null, phaseStartedAt: t });
        } else if (connectedNames(state).length >= MIN_PLAYERS) {
          startRound(state, state.round + 1);
        }
        return;
      default:
        return;
    }
  }

  // Сума очок гравця до початку раунду N (для анімації зміни місць)
  function scoreBefore(state, name, round) {
    let total = 0;
    Object.entries(state.roundScores || {}).forEach(([r, byName]) => {
      if (Number(r) >= round) return;
      Object.values((byName && byName[name]) || {}).forEach((p) => { total += Number(p) || 0; });
    });
    return total;
  }

  window.QuiplashGame = {
    MIN_PLAYERS, MAX_PLAYERS, MAX_ANSWERERS, TOTAL_ROUNDS, MAX_ANSWER_LEN, ROUND_PLAN,
    VOTE_INTRO_MS, VOTE_MS, ANSWER_MS, IMAGE_ANSWER_MS, POINTS_PER_VOTE, SAFETY_QUIPS,
    isAnswerer, matchupList, playerAnswered, canVoteOn, eligibleVoters, galleryVoters, galleryVoteMs, scoreBefore, mult,
    connectedEntries, computeHost, watchActiveRooms,
    start, stop, cleanupIfAbandoned,
    startGame, submitAnswer, submitVote, submitGalleryVote,
    setPause, resetGame, backToLobby, setAvatar, now,
    get roomId() { return Engine.currentRoomId; },
    get roomRef() { return Engine.roomRef; },
    set onStateChange(fn) { onStateChange = fn; },
  };
})();
