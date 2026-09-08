// ==========================================================================
// Шпигун — party-гра, перенесена з оригінального Express+socket.io проєкту
// на Firebase Realtime Database (без власного сервера). Логіка 1:1 з
// оригінального server.js, тільки замість сокет-подій — читання/запис у
// /spy_game.
//
// Хост = гравець із найменшим joinedAt серед тих, у кого lastSeen свіжий
// (<5с) — той самий принцип, що й у снейку, обчислюється динамічно кожним
// клієнтом незалежно, без "виборів" — тому міграція хоста при виході
// відбувається сама собою.
//
// Це ОДНА спільна гра на весь застосунок (не окремі кімнати як у змійці) —
// вечірка грає одну партію всі разом.
// ==========================================================================
(function () {
  const HEARTBEAT_MS = 2000;
  const PRESENCE_TIMEOUT_MS = 5000;
  const MIN_PLAYERS = 3;
  const ABANDON_MS = 15 * 60 * 1000; // гра без жодного живого lastSeen 15хв — скидаємо
  const PATH = "spy_game";

  let username = null;
  let ref = null;
  let heartbeatTimer = null;
  let onStateChange = () => {};

  let serverOffset = 0;
  function now() { return Date.now() + serverOffset; }

  function maxSpyCount(playerCount) {
    return Math.max(1, Math.min(3, playerCount - 2));
  }

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

  function isHost(players) {
    return username && computeHost(players) === username;
  }

  // ------------------------- приєднання / presence -------------------------
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
      // якщо ще не в грі (заходили посеред активного раунду) і раунд уже
      // не активний — пробуємо приєднатись знову
      if ((!state.players || !state.players[username]) && state.phase !== "active") {
        joinIfPossible();
      }
      onStateChange(state, { username, host: isHost(state.players) });
    });
  }

  function stop() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (ref) ref.off("value");
  }

  function emptyState() {
    return { phase: "lobby", players: {}, settings: { theme: "random", spyCount: 1 }, round: { number: 0 }, cards: {} };
  }

  // Без сервера немає "cron" — тому кожен, хто відкриває гру, попутно (один
  // раз) перевіряє: якщо гра покинута (жоден гравець не має свіжого
  // lastSeen) довше ABANDON_MS — скидаємо її до чистого лобі, замість того
  // щоб вона висіла в застряглому стані назавжди.
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
        // повертаємось (можливо перезайшли) — лишаємо той самий joinedAt
        ref.child("players/" + username).update({ lastSeen: now() });
        return;
      }
      if (state.phase === "active") {
        // новий гравець не може зайти посеред активного раунду —
        // просто чекає на лобі/наступне коло (аналогічно оригіналу)
        return;
      }
      ref.child("players/" + username).set({ joinedAt: now(), lastSeen: now() });
    });
  }

  // ------------------------- дії хоста -------------------------
  function updateSettings(theme, spyCount) {
    ref.child("settings").set({ theme, spyCount });
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

    ref.update({
      phase: "active",
      round: { number: (state.round.number || 0) + 1, themeName, word, spyUsernames: spies },
      cards,
    });
  }

  function revealSpies() {
    ref.child("phase").set("reveal");
  }

  function nextRound() {
    ref.child("phase").set("lobby");
  }

  function resetAll() {
    ref.set(emptyState()).then(() => joinIfPossible());
  }

  window.SpyGame = {
    MIN_PLAYERS,
    maxSpyCount,
    connectedEntries,
    computeHost,
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
