// ==========================================================================
// Хто я? — портовано з Node.js+Socket.io на спільний online-engine.js.
// Публічний API window.WhoAmIGame — підключати після online-engine.js
// і whoami-words.js.
//
// Ключова відмінність від Шпигуна: тут немає "раунду" в сенсі одного
// спільного стану на всіх — кожен гравець грає паралельно й у своєму темпі,
// сам собі "здає" нове слово (markGuessed/skipWord), тому приєднатись
// гравцем можна в будь-який момент, включно з активною фазою (asPlayer
// завжди true, на відміну від Шпигуна).
//
// Слова беруться зі спільного пулу (щоб не повторювались між гравцями) —
// вибір слова робиться через RTDB-транзакцію на usedWords/{theme}:{difficulty},
// а не централізовано хостом, як було на старому сервері: кожен клієнт сам
// атомарно "застовбовує" собі слово з пулу.
// ==========================================================================
(function () {
  const MIN_PLAYERS = 2;
  const DIFFICULTIES = ["easy", "medium", "hard"];
  const DIFF_LABELS = { easy: "Легка", medium: "Середня", hard: "Складна" };
  const THEME_NAMES = WHOAMI_THEMES.map((t) => t.name);

  const ROOM_SCHEMA = {
    phase: "lobby", // lobby | active
    settings: { theme: "random", difficulty: "medium" },
    usedWords: {},
    players: {},
  };

  const Engine = window.OnlineEngine.create("whoami", {
    onEmptyPlayer: () => ({ score: 0, currentWord: null, currentThemeName: null }),
  });

  let username = null;
  let onStateChange = () => {};
  let dealingInFlight = false;

  function connectedEntries(players) {
    return Object.entries(players || {}).filter(([, p]) => Engine.isConnected(p));
  }

  function isHost(players) {
    return username && Engine.computeHost(players) === username;
  }

  // ------------------------- вибір слова -------------------------
  function pickThemeName(themeSetting) {
    return themeSetting === "random"
      ? THEME_NAMES[Math.floor(Math.random() * THEME_NAMES.length)]
      : themeSetting;
  }

  // Атомарно бере слово з спільного пулу (RTDB-транзакція — безпечно навіть
  // якщо кілька гравців тягнуть слово з тієї ж теми одночасно) і одразу
  // записує його у ВЛАСНЕ поле гравця, що викликав.
  function dealNewWordToSelf(themeSetting, difficulty) {
    if (!Engine.roomRef || dealingInFlight) return Promise.resolve();
    dealingInFlight = true;

    const themeName = pickThemeName(themeSetting);
    const theme = WHOAMI_THEMES.find((t) => t.name === themeName);
    const pool = theme[difficulty] || theme.medium;
    const key = `${themeName}:${difficulty}`;
    const poolRef = Engine.roomRef.child("usedWords/" + key);

    return poolRef.transaction((used) => {
      used = used || [];
      let available = pool.filter((w) => used.indexOf(w) === -1);
      if (!available.length) { used = []; available = pool; }
      const word = available[Math.floor(Math.random() * available.length)];
      used = used.concat([word]);
      return used;
    }).then((result) => {
      const used = (result.snapshot && result.snapshot.val()) || [];
      const word = used[used.length - 1];
      return Engine.roomRef.child("players/" + username).update({
        currentWord: word,
        currentThemeName: themeName,
      });
    }).finally(() => { dealingInFlight = false; });
  }

  // Хост примусово роздає НОВІ слова всім підключеним одразу (кнопка
  // "Роздати всім нові слова") — тут потрібен саме цикл по гравцях, бо це
  // не реакція "у мене нема слова", а явна дія ведучого над усіма.
  function redealAll(state) {
    if (!isHost(state.players) || state.phase !== "active") return;
    connectedEntries(state.players).forEach(([name]) => {
      const themeName = pickThemeName(state.settings.theme);
      const theme = WHOAMI_THEMES.find((t) => t.name === themeName);
      const pool = theme[state.settings.difficulty] || theme.medium;
      const key = `${themeName}:${state.settings.difficulty}`;
      const poolRef = Engine.roomRef.child("usedWords/" + key);
      poolRef.transaction((used) => {
        used = used || [];
        let available = pool.filter((w) => used.indexOf(w) === -1);
        if (!available.length) { used = []; available = pool; }
        const word = available[Math.floor(Math.random() * available.length)];
        return used.concat([word]);
      }).then((result) => {
        const used = (result.snapshot && result.snapshot.val()) || [];
        const word = used[used.length - 1];
        Engine.roomRef.child("players/" + name).update({ currentWord: word, currentThemeName: themeName });
      });
    });
  }

  // ------------------------- приєднання / presence -------------------------
  function start(user) {
    username = user;
    Engine.start(user, { useLobby: false });

    Engine.onStateChange = (type, data) => {
      if (type !== "room-update") return;
      const state = data.room;

      // активна фаза й у мене ще нема слова (щойно стартувала гра, або я
      // приєднався посеред неї) — самообслуговування, без участі хоста
      const me = state.players && state.players[username];
      if (state.phase === "active" && me && !me.currentWord) {
        dealNewWordToSelf(state.settings.theme, state.settings.difficulty);
      }

      onStateChange(state, { username, host: isHost(state.players) });
    };

    Engine.getOrCreateRoom(Engine.SHARED_ROOM_ID, ROOM_SCHEMA, () => ({})).then(() => {
      // на відміну від Шпигуна — завжди йдемо гравцем одразу, навіть
      // посеред активної фази (паралельна гра без черги/раунду)
      Engine.joinRoom(Engine.SHARED_ROOM_ID, { asPlayer: true });
    });
  }

  function stop() {
    Engine.stop();
  }

  // ------------------------- дії хоста -------------------------
  function updateSettings(theme, difficulty) {
    if (!Engine.roomRef) return;
    Engine.roomRef.child("settings").set({ theme, difficulty });
  }

  function startGame(state) {
    const conn = connectedEntries(state.players);
    if (conn.length < MIN_PLAYERS) return;
    Engine.setPhase("active");
    // слова роздасть кожен собі сам реактивно (див. onStateChange вище) —
    // тут явно нічого роздавати не треба
  }

  function resetAll(state) {
    const keptPlayers = {};
    connectedEntries(state.players).forEach(([name, p]) => {
      keptPlayers[name] = { joinedAt: p.joinedAt, lastSeen: p.lastSeen, score: 0, currentWord: null, currentThemeName: null };
    });
    return Engine.forceResetRoom(Engine.SHARED_ROOM_ID, ROOM_SCHEMA, () => ({ players: keptPlayers })).then(() => {
      Engine.joinRoom(Engine.SHARED_ROOM_ID, { asPlayer: true });
    });
  }

  // ------------------------- дії гравця -------------------------
  function markGuessed(state) {
    const me = state.players && state.players[username];
    if (!me || state.phase !== "active") return;
    Engine.roomRef.child("players/" + username).update({ score: (me.score || 0) + 1 });
    dealNewWordToSelf(state.settings.theme, state.settings.difficulty);
  }

  function skipWord(state) {
    if (state.phase !== "active") return;
    dealNewWordToSelf(state.settings.theme, state.settings.difficulty);
  }

  window.WhoAmIGame = {
    MIN_PLAYERS,
    DIFFICULTIES,
    DIFF_LABELS,
    THEME_NAMES,
    connectedEntries,
    computeHost: Engine.computeHost,
    start,
    stop,
    updateSettings,
    startGame,
    markGuessed,
    skipWord,
    redealAll,
    resetAll,
    set onStateChange(fn) { onStateChange = fn; },
  };
})();
