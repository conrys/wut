// ==========================================================================
// «Згоден / Не згоден» (файли dilemmas-*) на спільному OnlineEngine
// (js/online-engine.js). Кімната "dilemmas_rooms".
//
// Гра на обговорення. Показується твердження двох видів: «Згоден / Не згоден»
// або «Прийнятно / Неприйнятно». Іконки гравців стоять на спільній шкалі:
//   «згоден / прийнятно»   — іконка робить крок ЛІВОРУЧ,
//   «не згоден / неприйнятно» — крок ПРАВОРУЧ.
// До STEPS (10) кроків від центру. Більшості й меншості в раунді немає — голос
// рухає лише твою іконку, тож гра однаково працює на 2 і на 12+ гравців.
// Наприкінці сторона, на якій МЕНШЕ гравців, обирає завдання (по одному з трьох).
//
// ТАЙМЕР ЛИШЕ ДЛЯ ОСТАННІХ ~10% ГРАВЦІВ. Поки голосує більшість — нічого не
// тікає: люди обговорюють у своєму темпі. Щойно без голосу лишилось не більше
// ніж max(1, ceil(10% гравців)) (і хоча б двоє вже проголосували) — для них
// стартує налаштований хостом таймер (20–120 секунд; 12 гравців: 10
// проголосували → таймер для двох, що лишились; вони могли вже вийти з гри).
// Усі проголосували раніше — результат одразу. Для двох гравців таймера нема:
// чекаємо обох (або «Показати зараз»).
//
// Рішення (таймер, результат, наступний раунд) приймає ОДИН клієнт — хост
// (lockedHost:true дає міграцію хоста, якщо його телефон заснув). Тік раз на
// TICK_MS перевіряє лише те, що залежить від часу; решта реагує на room-update.
// Час — завжди engine.now() (серверний), а не годинник телефона.
//
// Підключати ПІСЛЯ firebase-config.js, login.js, online-engine.js,
// dilemmas-seed.js.
// ==========================================================================
(function () {
  const GAME_KEY = "dilemmas";
  const PHASES = ["lobby", "voting", "reveal", "final"];
  const MIN_PLAYERS = 2;            // шкала працює вже на двох
  const STEPS = 10;                 // скільки кроків від центру до краю шкали
  const STRAGGLER_SHARE = 0.1;      // таймер — для останніх 10% гравців
  const MIN_TIMER_SECONDS = 20, MAX_TIMER_SECONDS = 120;
  const DEFAULT_STRAGGLER_SECONDS = 60;
  const STRAGGLER_MS = DEFAULT_STRAGGLER_SECONDS * 1000;
  const REVEAL_MAX_MS = 120 * 1000; // після результату чекаємо «Далі» від хоста не довше 2 хв
  const TICK_MS = 500;
  const DEFAULT_LEVEL = 2;          // 1 легко · 2 з перчинкою · 3 гаряче
  const TASK_OPTIONS = 3;
  const ABANDON_MS = 15 * 60 * 1000;
  const AVATAR_STORAGE_PREFIX = "games41_quiplash_avatar_"; // профіль аватара з Смішліста
  const AVATAR_COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6", "#1abc9c", "#e67e22", "#ff6fa5"];
  // монстрики Сміхлиста (js/quiplash-avatars.js), якщо підключені; інакше 8 img/char*.svg
  const QA = () => window.QuiplashAvatars;
  const CHARACTERS = QA() ? QA().COUNT : 8;
  const charColor = (c) => (QA() ? QA().color(c) : AVATAR_COLORS[(c - 1) % AVATAR_COLORS.length]);

  const SCHEMA = {
    phase: "lobby",
    hostUsername: null,
    lobbySettings: { level: DEFAULT_LEVEL, stragglerSeconds: DEFAULT_STRAGGLER_SECONDS },
    gameId: null,       // унікальний id гри (коло 2 у тій самій кімнаті ≠ коло 1)
    order: null,        // хто грає: підключені на момент старту
    cards: null,        // [{text, kind}] — тексти лежать у кімнаті (не залежать від версії файлу на телефоні); kind: "agree" | "ok"
    totalRounds: 0,
    currentRound: 0,
    votes: null,        // votes/<ім'я> = "<раунд>:<a|b>" (голос застарілого раунду ігнорується)
    timerEndsAt: null,  // серверний час (мс), коли закінчується таймер останніх
    revealAt: null,
    result: null,       // {round, a, b, voters:{ім'я:'a'|'b'}}; a = «згоден/прийнятно» (ліворуч), b = «не згоден/неприйнятно» (праворуч)
    pos: null,          // pos/<ім'я> = позиція на шкалі від -STEPS (ліворуч) до +STEPS (праворуч)
    final: null,        // {ranking:[{name,pos}], losers:[...], sides:{left,right}, tasks:{ім'я:{options:[...], chosen}}}
    players: {},
  };

  const engine = window.OnlineEngine.create(GAME_KEY, {
    phases: PHASES,
    lockedHost: true,
    abandonMs: ABANDON_MS,
  });

  let username = null;
  let onStateChange = () => {};
  let tickTimer = null;
  let busy = false;

  function buildFreshRoom() {
    return { players: {}, lobbySettings: { level: DEFAULT_LEVEL, stragglerSeconds: DEFAULT_STRAGGLER_SECONDS } };
  }

  function connectedNames(players) {
    return Object.entries(players || {}).filter(([, p]) => engine.isConnected(p)).map(([n]) => n);
  }

  // ------------------------- аватари (як у Смішлісті) -------------------------
  function takenChars(room) {
    return new Set(Object.entries((room && room.players) || {}).filter(([n]) => n !== username).map(([, p]) => Number(p && p.character)));
  }
  function avatarFor(room) {
    const taken = takenChars(room);
    let want = null;
    try {
      const raw = window.localStorage && window.localStorage.getItem(AVATAR_STORAGE_PREFIX + username);
      const profile = raw ? JSON.parse(raw) : null;
      if (profile && profile.character >= 1 && profile.character <= CHARACTERS) want = Number(profile.character);
    } catch (e) { /* немає localStorage або зіпсований профіль — беремо за чергою */ }
    if (want && !taken.has(want)) return { character: want, color: charColor(want) };
    const idx = Object.keys((room && room.players) || {}).length;
    for (let i = 0; i < CHARACTERS; i++) {
      const c = ((want || idx) + i) % CHARACTERS + 1;
      if (!taken.has(c)) return { character: c, color: charColor(c) };
    }
    const c = (idx % CHARACTERS) + 1;
    return { character: c, color: charColor(c) };
  }
  // Тап по своїй аватарці в лобі — наступний вільний персонаж (без дублів).
  function cycleAvatar() {
    const room = engine.latestRoom, me = room && room.players && room.players[username];
    if (!me || room.phase !== "lobby") return;
    const taken = takenChars(room), cur = Number(me.character) || 1;
    for (let i = 1; i <= CHARACTERS; i++) {
      const c = (cur - 1 + i) % CHARACTERS + 1;
      if (taken.has(c)) continue;
      engine.roomRef.child("players/" + username).update({ character: c, color: charColor(c) });
      try { localStorage.setItem(AVATAR_STORAGE_PREFIX + username, JSON.stringify({ character: c, color: charColor(c) })); } catch (e) {}
      return;
    }
  }

  // ------------------------- список активних кімнат -------------------------
  function watchActiveRooms(callback) {
    if (!window.rtdb) { callback([]); return () => {}; }
    const ref = window.rtdb.ref(`${GAME_KEY}_rooms`);
    const onValue = (snap) => {
      const rooms = snap.val() || {};
      const t = engine.now();
      const list = Object.entries(rooms).map(([roomId, room]) => {
        const players = room.players || {};
        const connected = connectedNames(players);
        const lastSeens = Object.values(players).map((p) => p.lastSeen || 0);
        const mostRecentPlayer = lastSeens.length ? Math.max(...lastSeens) : 0;
        const lastActivity = Math.max(room.lastActivityAt || 0, room.createdAt || 0, mostRecentPlayer);
        const stale = !connected.length && (!lastActivity || t - lastActivity > ABANDON_MS);
        return { roomId, phase: room.phase || "lobby", playerCount: Object.keys(players).length, connectedCount: connected.length, stale };
      }).filter((r) => !r.stale)
        .sort((a, b) => b.connectedCount - a.connectedCount || b.playerCount - a.playerCount);
      callback(list);
    };
    ref.on("value", onValue);
    return () => ref.off("value", onValue);
  }

  // ------------------------- старт / події -------------------------
  async function start(user, roomId) {
    username = user;
    engine.onStateChange = handleEngineEvent;
    engine.start(username, { useLobby: false });
    await engine.getOrCreateRoom(roomId, SCHEMA, buildFreshRoom);
    await engine.joinRoom(roomId, { asPlayer: false });
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(tick, TICK_MS);
  }

  function stop() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    engine.stop();
  }

  function handleEngineEvent(type, data) {
    if (type !== "room-update") return;
    const room = data.room;
    maybeJoinAsPlayer(room);
    if (engine.isHost) progress(room);
    onStateChange(room, { username, host: engine.computeHost(room.players) === username });
  }

  // Новий гравець приєднується лише в лобі; хто вже був у грі — лишається.
  function maybeJoinAsPlayer(room) {
    if (room.players && room.players[username]) return;
    if (room.phase !== "lobby") return;
    engine.becomePlayer(avatarFor(room));
  }

  function tick() {
    const room = engine.latestRoom;
    if (!room || !engine.isHost) return;
    progress(room);
  }

  // ------------------------- голоси -------------------------
  // голос зберігається як "<раунд>:<вибір>": запізнілий голос минулого раунду
  // (тап саме в момент переходу) не потрапляє в наступний
  function voteOf(room, name) {
    const raw = room && room.votes && room.votes[name];
    if (typeof raw !== "string") return null;
    const [r, c] = raw.split(":");
    return Number(r) === room.currentRound && (c === "a" || c === "b") ? c : null;
  }

  function vote(choice) {
    const room = engine.latestRoom;
    if (!room || room.phase !== "voting") return { ok: false, reason: "wrong-phase" };
    if (choice !== "a" && choice !== "b") return { ok: false, reason: "bad-choice" };
    if (!(room.order || []).includes(username)) return { ok: false, reason: "not-in-game" };
    // змінити думку можна будь-коли до результату (це гра на обговорення)
    engine.roomRef.update({ ["votes/" + username]: room.currentRound + ":" + choice });
    return { ok: true };
  }

  // Хто ще "в грі" цього раунду: підключені (з 2-хв допуском на згорнутий браузер)
  // і ті, хто вже проголосував. Саме з них рахуємо, хто лишився без голосу.
  function votingState(room) {
    const players = room.players || {};
    const present = (room.order || []).filter((n) => voteOf(room, n) || engine.isConnected(players[n]));
    const voted = present.filter((n) => voteOf(room, n));
    return { present, voted, remaining: present.length - voted.length };
  }

  function stragglerLimit(n) {
    return Math.max(1, Math.ceil(n * STRAGGLER_SHARE));
  }
  function stragglerMs(room) {
    const seconds = Number(room.lobbySettings && room.lobbySettings.stragglerSeconds) || DEFAULT_STRAGGLER_SECONDS;
    return Math.min(MAX_TIMER_SECONDS, Math.max(MIN_TIMER_SECONDS, seconds)) * 1000;
  }

  // ------------------------- рішення хоста -------------------------
  function progress(room) {
    if (busy || room.paused) return; // пауза (js/core/game-pause.js) — нічого не рухаємо
    if (room.phase === "voting") {
      const { present, voted, remaining } = votingState(room);
      if (!voted.length) return;
      if (remaining === 0) { doReveal(room); return; }
      if (room.timerEndsAt) {
        if (engine.now() >= room.timerEndsAt) doReveal(room);
      } else if (voted.length >= 2 && remaining <= stragglerLimit(present.length)) {
        startStragglerTimer(room);
      }
    } else if (room.phase === "reveal") {
      if (room.revealAt && engine.now() - room.revealAt > REVEAL_MAX_MS) nextRound();
    }
  }

  async function startStragglerTimer(room) {
    busy = true;
    try {
      const cur = engine.latestRoom;
      if (!cur || cur.phase !== "voting" || cur.currentRound !== room.currentRound || cur.timerEndsAt) return;
      await engine.roomRef.update({ timerEndsAt: engine.now() + stragglerMs(cur) });
    } finally { busy = false; }
  }

  async function doReveal(room) {
    busy = true;
    try {
      const cur = engine.latestRoom;
      if (!cur || cur.phase !== "voting" || cur.currentRound !== room.currentRound) return;
      const voters = {};
      (cur.order || []).forEach((n) => { const c = voteOf(cur, n); if (c) voters[n] = c; });
      const a = Object.values(voters).filter((c) => c === "a").length;
      const b = Object.values(voters).filter((c) => c === "b").length;
      const update = {
        phase: "reveal", revealAt: engine.now(), timerEndsAt: null,
        result: { round: cur.currentRound, a, b, voters },
      };
      // «згоден» — крок ліворуч (−1), «не згоден» — праворуч (+1), не далі за STEPS
      Object.entries(voters).forEach(([n, c]) => {
        const prev = (cur.pos && cur.pos[n]) || 0;
        update["pos/" + n] = Math.max(-STEPS, Math.min(STEPS, prev + (c === "a" ? -1 : 1)));
      });
      await engine.roomRef.update(update);
    } finally { busy = false; }
  }

  async function nextRound() {
    const cur = engine.latestRoom;
    if (!cur || cur.phase !== "reveal" || busy) return;
    busy = true;
    try {
      const n = cur.currentRound + 1;
      if (n >= cur.totalRounds) {
        await engine.roomRef.update({ phase: "final", final: buildFinal(cur), timerEndsAt: null, revealAt: null });
        return;
      }
      await engine.roomRef.update({ phase: "voting", currentRound: n, votes: null, timerEndsAt: null, revealAt: null, result: null });
    } finally { busy = false; }
  }

  // ------------------------- фінал: зони й завдання -------------------------
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function seeded(seed) { // mulberry32: однаковий результат при однаковому gameId
    let t = seed >>> 0;
    return () => {
      t = (t + 0x6D2B79F5) >>> 0;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildFinal(cur) {
    const order = cur.order || [];
    const pos = cur.pos || {};
    const rnd = seeded(hashStr(String(cur.gameId)));
    const tie = {};
    order.forEach((n) => { tie[n] = rnd(); });
    // зліва направо (від «згодних» до «не згодних»); при однаковій позиції — жереб
    const ranking = order.map((n) => ({ name: n, pos: pos[n] || 0 }))
      .sort((x, y) => x.pos - y.pos || tie[x.name] - tie[y.name]);
    const left = ranking.filter((r) => r.pos < 0).map((r) => r.name);
    const right = ranking.filter((r) => r.pos > 0).map((r) => r.name);
    // програє сторона, де гравців МЕНШЕ; порівну (або одна сторона порожня) — ніхто
    let losers = [];
    if (left.length && right.length && left.length !== right.length) losers = left.length < right.length ? left : right;
    const level = (cur.lobbySettings && cur.lobbySettings.level) || DEFAULT_LEVEL;
    const pool = ((window.DilemmaSeed && window.DilemmaSeed.TASKS) || []).filter((t) => t.level <= level).map((t) => t.text);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const tasks = {};
    let cursor = 0;
    losers.forEach((name) => {
      const options = [];
      for (let k = 0; k < TASK_OPTIONS && pool.length; k++) { options.push(pool[cursor % pool.length]); cursor++; }
      tasks[name] = { options };
    });
    return { ranking, losers, tasks, sides: { left: left.length, right: right.length } };
  }

  function chooseTask(index) {
    const room = engine.latestRoom;
    if (!room || room.phase !== "final" || !room.final) return { ok: false, reason: "wrong-phase" };
    const mine = room.final.tasks && room.final.tasks[username];
    if (!mine) return { ok: false, reason: "not-a-loser" };
    if (!Number.isInteger(index) || index < 0 || index >= (mine.options || []).length) return { ok: false, reason: "bad-index" };
    engine.roomRef.update({ ["final/tasks/" + username + "/chosen"]: index });
    return { ok: true };
  }

  // ------------------------- дії хоста -------------------------
  function isHostNow() {
    const room = engine.latestRoom;
    return !!room && engine.computeHost(room.players) === username;
  }

  function updateLobbySettings(partial) {
    const room = engine.latestRoom;
    if (!room || room.phase !== "lobby") return;
    const next = {};
    if (partial && [1, 2, 3].includes(Number(partial.level))) next.level = Number(partial.level);
    const stragglerSeconds = Number(partial && partial.stragglerSeconds);
    if (Number.isInteger(stragglerSeconds) && stragglerSeconds >= MIN_TIMER_SECONDS && stragglerSeconds <= MAX_TIMER_SECONDS) {
      next.stragglerSeconds = stragglerSeconds;
    }
    if (Object.keys(next).length) engine.roomRef.child("lobbySettings").update(next);
  }

  function startGame(room) {
    room = room || engine.latestRoom;
    if (!room || room.phase !== "lobby" || !isHostNow()) return { ok: false, reason: "not-allowed" };
    const names = connectedNames(room.players);
    if (names.length < MIN_PLAYERS) return { ok: false, reason: "not-enough-players" };
    const seed = window.DilemmaSeed;
    if (!seed || !seed.STATEMENTS || !seed.STATEMENTS.length) return { ok: false, reason: "no-content" };
    const settings = room.lobbySettings || {};
    const level = settings.level || DEFAULT_LEVEL;
    const pool = seed.STATEMENTS.filter((d) => d.level <= level);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const cards = pool.map((d) => ({ text: d.text, kind: d.kind }));   // уся колода рівня: грають, доки не набридне
    engine.roomRef.update({
      phase: "voting", gameId: engine.now(), order: names, cards, totalRounds: cards.length,
      currentRound: 0, votes: null, timerEndsAt: null, revealAt: null, result: null, pos: null, final: null,
    });
    return { ok: true };
  }

  // Хост показує результат одразу (напр. хтось вийшов і не проголосує)
  function forceReveal() {
    const room = engine.latestRoom;
    if (!room || room.phase !== "voting" || !isHostNow() || busy) return;
    doReveal(room);
  }

  function next() {
    if (!isHostNow()) return;
    nextRound();
  }

  function resetGame() {
    const roomId = engine.currentRoomId;
    if (!roomId || !isHostNow()) return;
    engine.forceResetRoom(roomId, SCHEMA, buildFreshRoom);
  }

  window.DilemmasGame = {
    MIN_PLAYERS, STEPS, STRAGGLER_MS, STRAGGLER_SHARE, MIN_TIMER_SECONDS, MAX_TIMER_SECONDS,
    DEFAULT_STRAGGLER_SECONDS, DEFAULT_LEVEL,
    connectedNames,
    computeHost: (players) => engine.computeHost(players),
    isConnected: (p) => engine.isConnected(p),
    now: () => engine.now(),
    voteOf,
    votingState,
    stragglerLimit,
    watchActiveRooms,
    start,
    stop,
    startGame,
    updateLobbySettings,
    vote,
    forceReveal,
    next,
    chooseTask,
    resetGame,
    cycleAvatar,
    get roomId() { return engine.currentRoomId; },
    get roomRef() { return engine.roomRef; },
    set onStateChange(fn) { onStateChange = fn; },
  };
})();
