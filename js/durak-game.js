// ==========================================================================
// durak-game.js — онлайн "Дурак" на спільному OnlineEngine (js/online-engine.js)
// + чисте ядро правил js/durak-rules.js.
//
// На відміну від покеру/мафії, тут НЕ ПОТРІБЕН тік хоста: у дурака нема
// ботів і нема таймерів — кожен хід ЦІЛКОМ ініціюється клієнтом, що ходить
// (підкинути/відбити/пасувати/забрати), рушій одразу валідує і пише новий
// стан у RTDB. Той самий підхід, що й у chess-game.js.
//
// ВАЖЛИВО про RTDB: Firebase MOVE НЕ зберігає порожні масиви/об'єкти —
// запис {table: []} чи {hands: {ivan: []}} просто ВИДАЛЯЄ цей ключ
// цілком. Тобто після кожного читання з кімнати потрібно "розпакувати"
// (normalizeState) відсутні ключі назад у порожні масиви — інакше
// DurakRules-функції впадуть на .length/.forEach від undefined.
//
// Підключати ПІСЛЯ firebase-config.js, login.js, online-engine.js,
// durak-rules.js.
// ==========================================================================
(function () {
  const GAME_KEY = "durak";
  const PHASES = ["lobby", "playing", "ended"];
  const ABANDON_MS = 30 * 60 * 1000;
  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 6; // 36 карт / 6 = по 6 кожному без жодної в колоді на добір — практична стеля

  const D = window.DurakRules;

  const SCHEMA = { phase: "lobby", hostUsername: null, state: null, lobbySettings: null, players: {} };
  const engine = window.OnlineEngine.create(GAME_KEY, { phases: PHASES, abandonMs: ABANDON_MS });

  let username = null;
  let onStateChange = () => {};

  function buildFreshRoom() { return { players: {}, state: null, lobbySettings: D.defaultSettings() }; }

  function connectedNames(players) {
    return Object.entries(players || {}).filter(([, p]) => p.isBot || engine.isConnected(p)).map(([n]) => n);
  }

  // RTDB видаляє порожні масиви/відсутні ключі — повертаємо їх на місце.
  function normalizeState(raw) {
    if (!raw) return null;
    const order = raw.order || [];
    const hands = {};
    order.forEach((u) => { hands[u] = (raw.hands && raw.hands[u]) || []; });
    return {
      deck: raw.deck || [],
      trumpSuit: raw.trumpSuit,
      trumpCard: raw.trumpCard,
      hands,
      order,
      attackerIdx: raw.attackerIdx,
      defenderIdx: raw.defenderIdx,
      table: (raw.table || []).map((t) => ({ attack: t.attack, defend: t.defend || null })),
      passed: raw.passed || [],
      discardCount: raw.discardCount || 0,
      finishedOrder: raw.finishedOrder || [],
      result: raw.result || null,
      lastAction: raw.lastAction || null,
      settings: raw.settings || D.defaultSettings(),
    };
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
        return {
          roomId, phase: room.phase || "lobby",
          playerNames: Object.keys(players),
          playerCount: Object.keys(players).length, connectedCount: connected.length,
          stale,
        };
      }).filter((r) => !r.stale)
        .sort((a, b) => b.connectedCount - a.connectedCount || b.playerCount - a.playerCount);
      callback(list);
    };
    ref.on("value", onValue);
    return () => ref.off("value", onValue);
  }

  // ------------------------- старт -------------------------
  async function start(user, roomId) {
    username = user;
    engine.onStateChange = handleEngineEvent;
    engine.onBecomeHost = startHostTick;
    engine.onLoseHost = stopHostTick;
    engine.start(username, { useLobby: false });
    await engine.getOrCreateRoom(roomId, SCHEMA, buildFreshRoom);
    const room = engine.latestRoom;
    const canJoinAsPlayer = !room || room.phase === "lobby" || (room.players && room.players[username]);
    await engine.joinRoom(roomId, { asPlayer: canJoinAsPlayer });
  }
  function stop() { stopHostTick(); engine.stop(); }

  function handleEngineEvent(type, data) {
    if (type !== "room-update") return;
    const room = data.room;
    const state = normalizeState(room.state);
    const players = room.players || {};
    onStateChange(room, {
      username,
      state,
      isSpectator: !players[username] || (room.phase !== "lobby" && state && !state.order.includes(username)),
      playerNames: Object.keys(players),
    });
  }

  // ------------------------- боти (для тестування) -------------------------
  // Бот — просто запис у room.players з isBot:true (без справжнього клієнта).
  // Ходи за них робить хост раз на HOST_TICK_MS, по одній дії за тік.
  const HOST_TICK_MS = 700;
  let hostTickTimer = null;

  function addBot() {
    const room = engine.latestRoom;
    if (!room || room.phase !== "lobby") return;
    const existing = Object.keys(room.players || {});
    if (existing.length >= MAX_PLAYERS) return;
    let n = 1;
    while (existing.includes("Бот " + n)) n++;
    engine.roomRef.child("players/Бот " + n).set({
      status: "active", isBot: true, lastSeen: engine.now(),
      // дуже пізній joinedAt: хост-вибори беруть найраніше приєднаного, а
      // хостом мусить бути ЛЮДИНА (бот сам ходів не робить — їх робить хост)
      joinedAt: 8000000000000000,
    });
  }
  function removeBot(name) {
    const room = engine.latestRoom;
    if (!room || room.phase !== "lobby") return;
    if (room.players && room.players[name] && room.players[name].isBot) engine.roomRef.child("players/" + name).remove();
  }

  function startHostTick() { stopHostTick(); hostTickTimer = setInterval(runHostTick, HOST_TICK_MS); }
  function stopHostTick() { if (hostTickTimer) { clearInterval(hostTickTimer); hostTickTimer = null; } }

  function runHostTick() {
    try {
      const room = engine.latestRoom;
      if (!room || room.phase !== "playing" || !room.state) return;
      const state = normalizeState(room.state);
      if (state.result) return;
      for (const bot of state.order) {
        if (!room.players || !room.players[bot] || !room.players[bot].isBot) continue;
        const action = D.botAction(state, bot);
        if (!action) continue;
        let next = null;
        if (action.type === "throw") next = D.throwCard(state, bot, action.card);
        else if (action.type === "defend") next = D.defendCard(state, bot, action.slotIndex, action.card);
        else if (action.type === "take") next = D.takeCards(state, bot);
        else if (action.type === "pass") next = D.passAttack(state, bot);
        if (!next) continue;
        const update = { state: next };
        if (next.result) update.phase = "ended";
        engine.roomRef.update(update);
        break; // одна дія за тік — природний темп
      }
    } catch (e) {
      console.error("[durak] тік ботів кинув виняток:", e);
    }
  }

  // ------------------------- налаштування лобі -------------------------
  function updateLobbySettings(partial) {
    const room = engine.latestRoom;
    if (!room || room.phase !== "lobby") return;
    engine.roomRef.child("lobbySettings").update(partial);
  }

  // ------------------------- старт партії -------------------------
  function startGame() {
    const room = engine.latestRoom;
    if (!room) return;
    const names = Object.keys(room.players || {});
    if (names.length < MIN_PLAYERS || names.length > MAX_PLAYERS) return;
    const settings = room.lobbySettings || D.defaultSettings();
    const fresh = D.initialState(names, settings);
    if (!fresh) return;
    engine.roomRef.update({ phase: "playing", state: fresh });
  }

  // ------------------------- дії гравця -------------------------
  // Спільний патерн: узяти нормалізований стан із кімнати, спробувати дію
  // через DurakRules (повертає null на нелегальній дії — просто ігноруємо),
  // записати назад; якщо з'явився result — партія завершена.
  function applyAndWrite(fn) {
    const room = engine.latestRoom;
    if (!room || room.phase !== "playing" || !room.state) return false;
    const state = normalizeState(room.state);
    const next = fn(state);
    if (!next) return false;
    const update = { state: next };
    if (next.result) update.phase = "ended";
    engine.roomRef.update(update);
    return true;
  }

  function throwCard(card) { return applyAndWrite((s) => D.throwCard(s, username, card)); }
  function defendCard(slotIndex, card) { return applyAndWrite((s) => D.defendCard(s, username, slotIndex, card)); }
  function passAttack() { return applyAndWrite((s) => D.passAttack(s, username)); }
  function takeCards() { return applyAndWrite((s) => D.takeCards(s, username)); }
  function transferCard(card) { return applyAndWrite((s) => D.transferCard(s, username, card)); }

  function rematch() {
    const room = engine.latestRoom;
    if (!room || room.phase !== "ended") return;
    startGame();
  }

  window.DurakGame = {
    MIN_PLAYERS, MAX_PLAYERS,
    connectedNames, isConnected: (p) => engine.isConnected(p),
    watchActiveRooms, normalizeState,
    start, stop, startGame, rematch, updateLobbySettings, addBot, removeBot,
    throwCard, defendCard, passAttack, takeCards, transferCard,
    get roomId() { return engine.currentRoomId; },
    get roomRef() { return engine.roomRef; },
    set onStateChange(fn) { onStateChange = fn; },
  };
})();
