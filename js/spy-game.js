// ==========================================================================
// Шпигун — на спільному online-engine.js, номерні кімнати (room-code флоу,
// за зразком mafia-game.js) замість однієї спільної Engine.SHARED_ROOM_ID
// кімнати на весь застосунок.
//
// Публічний API (window.SpyGame) майже не змінився — головна відмінність:
// start(user) стало start(user, roomId), і додався watchActiveRooms() для
// екрана вибору кімнати (рендерить spy.html через RoomCodeUI).
//
// Що дає рушій тут:
// - heartbeat/presence/onDisconnect — як і було
// - computeHost() — той самий принцип "найдавніший живий", тепер з рушія
// - getOrCreateRoom() — сама чистить кімнату, якщо вона старша ABANDON_MS
//   (раніше робив вручну cleanupIfAbandoned()), і сама домальовує поля,
//   якщо схему колись розширимо новим полем
// - joinRoom(..., {asPlayer}) — зберігає правило "не заходити ГРАВЦЕМ
//   посеред активного раунду", тепер явним параметром, а не окремим if
// ==========================================================================
(function () {
  const GAME_KEY = "spy";
  const MIN_PLAYERS = 2;
  const ABANDON_MS = 15 * 60 * 1000;

  const ROOM_SCHEMA = {
    phase: "lobby",
    settings: { theme: "random", spyCount: 1 },
    round: { number: 0 },
    cards: {},
    players: {},
  };

  const Engine = window.OnlineEngine.create(GAME_KEY, {
    phases: ["lobby", "active", "reveal"],
    abandonMs: ABANDON_MS,
  });

  let username = null;
  let onStateChange = () => {};
  let latestState = null;
  let avatarAsked = false;

  // ------------------------- аватари (як у Дилемах) -------------------------
  const AVATAR_STORAGE_PREFIX = "games41_quiplash_avatar_"; // профіль аватара з Смішліста
  const QA = () => window.QuiplashAvatars; // підключати ДО цього файлу
  const CHARACTERS = QA() ? QA().COUNT : 8;
  const charColor = (c) => (QA() ? QA().color(c) : "#c8102e");
  function takenChars(state) {
    return new Set(Object.entries((state && state.players) || {}).filter(([n]) => n !== username).map(([, p]) => Number(p && p.character)));
  }
  function avatarFor(state) {
    const taken = takenChars(state);
    let want = null;
    try {
      const raw = window.localStorage && window.localStorage.getItem(AVATAR_STORAGE_PREFIX + username);
      const profile = raw ? JSON.parse(raw) : null;
      if (profile && profile.character >= 1 && profile.character <= CHARACTERS) want = Number(profile.character);
    } catch (e) { /* немає localStorage — беремо за чергою */ }
    if (want && !taken.has(want)) return { character: want, color: charColor(want) };
    const idx = Object.keys((state && state.players) || {}).length;
    for (let i = 0; i < CHARACTERS; i++) {
      const c = ((want || idx) + i) % CHARACTERS + 1;
      if (!taken.has(c)) return { character: c, color: charColor(c) };
    }
    const c = (idx % CHARACTERS) + 1;
    return { character: c, color: charColor(c) };
  }
  // Тап по своїй аватарці в лобі — наступний вільний персонаж (без дублів).
  function cycleAvatar() {
    const state = latestState, me = state && state.players && state.players[username];
    if (!me || state.phase !== "lobby" || !Engine.roomRef) return;
    const taken = takenChars(state), cur = Number(me.character) || 1;
    for (let i = 1; i <= CHARACTERS; i++) {
      const c = (cur - 1 + i) % CHARACTERS + 1;
      if (taken.has(c)) continue;
      Engine.roomRef.child("players/" + username).update({ character: c, color: charColor(c) });
      try { localStorage.setItem(AVATAR_STORAGE_PREFIX + username, JSON.stringify({ character: c, color: charColor(c) })); } catch (e) {}
      return;
    }
  }

  function maxSpyCount(playerCount) {
    return Math.max(1, Math.min(3, playerCount - 2));
  }

  function connectedEntries(players) {
    return Object.entries(players || {}).filter(([, p]) => Engine.isConnected(p));
  }

  function isHost(players) {
    return username && Engine.computeHost(players) === username;
  }

  // ------------------------- список активних кімнат -------------------------
  // Та сама ідея, що й у mafia-game.js: показати на екрані входу лише живі
  // (не застарілі) кімнати, порядок "застарілості" повторює ABANDON_MS вище.
  function watchActiveRooms(callback) {
    if (!window.rtdb) { callback([]); return () => {}; }
    const ref = window.rtdb.ref(`${GAME_KEY}_rooms`);
    const onValue = (snap) => {
      const rooms = snap.val() || {};
      const t = Engine.now();
      const list = Object.entries(rooms).map(([roomId, room]) => {
        const players = room.players || {};
        const connected = connectedEntries(players);
        const lastSeens = Object.values(players).map((p) => p.lastSeen || 0);
        const mostRecentPlayer = lastSeens.length ? Math.max(...lastSeens) : 0;
        const lastActivity = Math.max(room.lastActivityAt || 0, room.createdAt || 0, mostRecentPlayer);
        const stale = !connected.length && (!lastActivity || t - lastActivity > ABANDON_MS);
        return {
          roomId,
          phase: room.phase || "lobby",
          usernames: Object.keys(players),
          playerCount: Object.keys(players).length,
          connectedCount: connected.length,
          stale,
        };
      }).filter((r) => !r.stale)
        .sort((a, b) => b.connectedCount - a.connectedCount || b.playerCount - a.playerCount);
      callback(list);
    };
    ref.on("value", onValue);
    return () => ref.off("value", onValue);
  }

  // ------------------------- приєднання / presence -------------------------
  function start(user, roomId) {
    username = user;
    Engine.start(user, { useLobby: false });

    Engine.onStateChange = (type, data) => {
      if (type !== "room-update") return;
      const state = data.room;
      latestState = state;
      const me = state.players && state.players[username];
      if (me && !me.character && !avatarAsked) {
        avatarAsked = true;
        Engine.roomRef.child("players/" + username).update(avatarFor(state));
      }
      if (me && me.character) avatarAsked = false;

      // приєднались як спостерігач під час активного раунду — щойно раунд
      // завершиться (phase знову "lobby"), стаємо гравцем автоматично
      if (state.phase !== "active" && (!state.players || !state.players[username])) {
        Engine.becomePlayer();
      }

      onStateChange(state, { username, host: isHost(state.players), roomId: Engine.currentRoomId });
    };

    return Engine.getOrCreateRoom(roomId, ROOM_SCHEMA, () => ({})).then(({ room }) => {
      const canJoinAsPlayer = room.phase !== "active";
      return Engine.joinRoom(roomId, { asPlayer: canJoinAsPlayer });
    });
  }

  function stop() {
    Engine.stop();
  }

  // ------------------------- дії хоста -------------------------
  function updateSettings(theme, spyCount) {
    if (!Engine.roomRef) return;
    Engine.roomRef.child("settings").set({ theme, spyCount });
  }

  function startRound(state) {
    const conn = connectedEntries(state.players);
    if (conn.length < MIN_PLAYERS) return;

    const max = maxSpyCount(conn.length);
    const spyCount = Math.min(state.settings.spyCount || 1, max);
    const themeName =
      state.settings.theme === "random"
        ? SPY_THEMES[Math.floor(Math.random() * SPY_THEMES.length)].name
        : state.settings.theme;
    const theme = SPY_THEMES.find((t) => t.name === themeName);
    const word = theme.words[Math.floor(Math.random() * theme.words.length)];

    const names = conn.map(([n]) => n);
    const shuffled = names.slice().sort(() => Math.random() - 0.5);
    const spies = shuffled.slice(0, spyCount);

    // хто перший ставить питання — випадково серед усіх (і шпигун теж, інакше це підказка)
    const firstAsker = names[Math.floor(Math.random() * names.length)];

    const cards = {};
    names.forEach((n) => {
      cards[n] = spies.includes(n) ? { isSpy: true } : { isSpy: false, themeName, word };
    });

    // "active" — доменна фаза Шпигуна (не generic playing/paused/ended
    // рушія), тому пишемо через низькорівневий setPhase() напряму разом з
    // ігровими полями round/cards одним update().
    Engine.setPhase("active", {
      round: { number: (state.round.number || 0) + 1, themeName, word, spyUsernames: spies, startedAt: Engine.now(), firstAsker },
      cards,
    });
  }

  function revealSpies() {
    Engine.setPhase("reveal");
  }

  function nextRound() {
    Engine.setPhase("lobby");
  }

  function resetAll() {
    const roomId = Engine.currentRoomId;
    if (!roomId) return Promise.resolve();
    return Engine.forceResetRoom(roomId, ROOM_SCHEMA, () => ({})).then(() => {
      return Engine.joinRoom(roomId, { asPlayer: true });
    });
  }

  window.SpyGame = {
    MIN_PLAYERS,
    maxSpyCount,
    cycleAvatar,
    now: Engine.now,
    connectedEntries,
    computeHost: Engine.computeHost,
    watchActiveRooms,
    start,
    stop,
    updateSettings,
    startRound,
    revealSpies,
    nextRound,
    resetAll,
    get roomId() { return Engine.currentRoomId; },
    get roomRef() { return Engine.roomRef; },
    set onStateChange(fn) { onStateChange = fn; },
  };
})();