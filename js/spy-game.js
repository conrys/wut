// ==========================================================================
// Шпигун — тепер на спільному online-engine.js замість власної ручної
// presence/host-логіки. Публічний API (window.SpyGame) НЕ змінився —
// spy.html підключає цей файл так само, як і раніше.
//
// Що дає рушій тут:
// - heartbeat/presence/onDisconnect — як і було
// - computeHost() — той самий принцип "найдавніший живий", тепер з рушія
// - getOrCreateRoom() — сама чистить кімнату, якщо вона старша 15хв (раніше
//   робив вручну cleanupIfAbandoned()), і сама домальовує поля, якщо схему
//   колись розширимо новим полем
// - joinRoom(..., {asPlayer}) — зберігає правило "не заходити ГРАВЦЕМ
//   посеред активного раунду", тепер явним параметром, а не окремим if
// ==========================================================================
(function () {
  const MIN_PLAYERS = 2;

  const ROOM_SCHEMA = {
    phase: "lobby",
    settings: { theme: "random", spyCount: 1 },
    round: { number: 0 },
    cards: {},
    players: {},
  };

  const Engine = window.OnlineEngine.create("spy", {
    phases: ["lobby", "active", "reveal"],
  });

  let username = null;
  let onStateChange = () => {};

  function maxSpyCount(playerCount) {
    return Math.max(1, Math.min(3, playerCount - 2));
  }

  function connectedEntries(players) {
    return Object.entries(players || {}).filter(([, p]) => Engine.isConnected(p));
  }

  function isHost(players) {
    return username && Engine.computeHost(players) === username;
  }

  // ------------------------- приєднання / presence -------------------------
  function start(user) {
    username = user;
    Engine.start(user, { useLobby: false });

    Engine.onStateChange = (type, data) => {
      if (type !== "room-update") return;
      const state = data.room;

      // приєднались як спостерігач під час активного раунду — щойно раунд
      // завершиться (phase знову "lobby"), стаємо гравцем автоматично
      if (state.phase !== "active" && (!state.players || !state.players[username])) {
        Engine.becomePlayer();
      }

      onStateChange(state, { username, host: isHost(state.players) });
    };

    Engine.getOrCreateRoom(Engine.SHARED_ROOM_ID, ROOM_SCHEMA, () => ({})).then(({ room }) => {
      const canJoinAsPlayer = room.phase !== "active";
      Engine.joinRoom(Engine.SHARED_ROOM_ID, { asPlayer: canJoinAsPlayer });
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

    const cards = {};
    names.forEach((n) => {
      cards[n] = spies.includes(n) ? { isSpy: true } : { isSpy: false, themeName, word };
    });

    // "active" — доменна фаза Шпигуна (не generic playing/paused/ended
    // рушія), тому пишемо через низькорівневий setPhase() напряму разом з
    // ігровими полями round/cards одним update().
    Engine.setPhase("active", {
      round: { number: (state.round.number || 0) + 1, themeName, word, spyUsernames: spies },
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
    Engine.forceResetRoom(Engine.SHARED_ROOM_ID, ROOM_SCHEMA, () => ({})).then(() => {
      Engine.joinRoom(Engine.SHARED_ROOM_ID, { asPlayer: true });
    });
  }

  window.SpyGame = {
    MIN_PLAYERS,
    maxSpyCount,
    connectedEntries,
    computeHost: Engine.computeHost,
    start,
    stop,
    updateSettings,
    startRound,
    revealSpies,
    nextRound,
    resetAll,
    set onStateChange(fn) { onStateChange = fn; },
  };
})();
