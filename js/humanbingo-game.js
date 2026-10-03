// ==========================================================================
// humanbingo-game.js — Human Bingo на OnlineEngine + спільному js/fact-pool.js.
//
// Гра навмисно ФІЗИЧНА: після старту застосунок лише показує кожному його
// картку 5x5 (чи менше, якщо фактів обмаль) з підказками "Знайди того,
// хто..." — сам похід по кімнаті й перевірка "збігів" відбувається наживо,
// без звірки через застосунок (довіра на чесність, як у справжньому бінго).
//
// Підключати ПІСЛЯ firebase-config.js, login.js, online-engine.js,
// fact-pool.js.
// ==========================================================================
(function () {
  const GAME_KEY = "humanbingo";
  const PHASES = ["lobby", "collecting", "playing", "ended"];
  const ABANDON_MS = 6 * 60 * 60 * 1000; // вечірка може тривати довго, і повертатись до карток хочеться й після

  const F = window.FactPool;
  const SCHEMA = {
    phase: "lobby", hostUsername: null, coHostUsername: null,
    factPool: { spiceLevel: 3, thresholds: F.DEFAULT_THRESHOLDS, facts: {}, queue: {} },
    cards: {}, marks: {}, players: {},
  };

  const engine = window.OnlineEngine.create(GAME_KEY, { phases: PHASES, abandonMs: ABANDON_MS });
  let username = null;
  let onStateChange = () => {};
  let pool = null; // FactPool.attach(...) instance, прив'язана до цієї кімнати

  function buildFreshRoom() {
    return {
      hostUsername: null, coHostUsername: null,
      factPool: { spiceLevel: 3, thresholds: F.DEFAULT_THRESHOLDS, facts: {}, queue: {} },
      cards: {}, marks: {}, players: {},
    };
  }

  function connectedNames(players) {
    return Object.entries(players || {}).filter(([, p]) => engine.isConnected(p)).map(([n]) => n);
  }
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
      }).filter((r) => !r.stale).sort((a, b) => b.connectedCount - a.connectedCount);
      callback(list);
    };
    ref.on("value", onValue);
    return () => ref.off("value", onValue);
  }

  async function start(user, roomId) {
    username = user;
    engine.onStateChange = handleEngineEvent;
    engine.start(username, { useLobby: false });
    await engine.getOrCreateRoom(roomId, SCHEMA, buildFreshRoom);
    await engine.joinRoom(roomId, { asPlayer: true });
    engine.becomePlayer({});
    const room = engine.latestRoom;
    if (!room.hostUsername) engine.roomRef.child("hostUsername").set(username);
    pool = F.attach(engine.roomRef.child("factPool"), { now: () => engine.now() });
  }
  function stop() { engine.stop(); pool = null; }

  function handleEngineEvent(type, data) {
    if (type !== "room-update") return;
    const room = data.room;
    const isHost = room.hostUsername === username;
    const isCoHost = room.coHostUsername === username;
    onStateChange(room, { username, isHost, isCoHost: isHost || isCoHost, sessionId: room.createdAt || null });
  }

  function setCoHost(who) {
    const room = engine.latestRoom;
    if (!room || room.hostUsername !== username) return;
    pool.setCoHost(who);
  }

  // ------------------------- фази -------------------------
  function beginCollecting() {
    const room = engine.latestRoom;
    if (!room || room.hostUsername !== username || room.phase !== "lobby") return;
    engine.roomRef.child("phase").set("collecting");
  }

  function myFactCount(room) {
    const all = Object.assign({}, room.factPool && room.factPool.facts, room.factPool && room.factPool.queue);
    return Object.values(all).filter((f) => f.authorUsername === username).length;
  }

  function submitFact(text, level) {
    const room = engine.latestRoom;
    if (!room || room.phase !== "collecting" || !text || !text.trim()) return Promise.resolve({ verdict: "empty" });
    return pool.submit(text.trim(), username, level, room.createdAt || null);
  }

  function startGame() {
    const room = engine.latestRoom;
    if (!room || room.hostUsername !== username || room.phase !== "collecting") return;
    const facts = room.factPool.facts || {};
    const spice = room.factPool.spiceLevel || 3;
    const size = F.bingoGridSize(Object.keys(F.approvedAtOrBelow(facts, spice)).length);
    if (!size) return; // замало фактів — UI мав би це показати заздалегідь і не дати натиснути
    const names = Object.keys(room.players || {});
    const cards = {};
    names.forEach((n) => {
      const picked = F.sampleFacts(facts, spice, size * size);
      cards[n] = picked.map((f) => f.id);
      picked.forEach((f) => pool.markPlayed(f.id, room.createdAt || null));
    });
    engine.roomRef.update({ phase: "playing", cards, marks: null });
  }

  // Відмітка "ця людина підходить під клітинку": marks/{я}/{factId} = ім'я.
  // who === null прибирає відмітку. Себе вписувати не можна.
  function setMark(factId, who) {
    const room = engine.latestRoom;
    if (!room || room.phase !== "playing" || !factId) return Promise.resolve();
    const myCard = (room.cards && room.cards[username]) || [];
    if (!myCard.includes(factId)) return Promise.resolve();
    const ref = engine.roomRef.child("marks/" + username + "/" + factId);
    if (!who) return ref.remove();
    if (who === username || !(room.players && room.players[who])) return Promise.resolve();
    return ref.set(who);
  }

  function endGame() {
    const room = engine.latestRoom;
    if (!room || room.hostUsername !== username) return;
    engine.roomRef.update({ phase: "ended" });
  }
  function backToLobby() {
    const room = engine.latestRoom;
    if (!room || room.hostUsername !== username) return;
    engine.roomRef.update({ phase: "lobby", cards: {}, marks: null });
  }

  window.HumanBingoGame = {
    watchActiveRooms, start, stop,
    setCoHost, beginCollecting, submitFact, myFactCount, startGame, setMark, endGame, backToLobby,
    setSpiceLevel: (lvl) => pool && pool.setSpiceLevel(lvl),
    setThresholds: (th) => pool && pool.setThresholds(th),
    approve: (id) => pool && pool.approve(id),
    reject: (id) => pool && pool.reject(id),
    removeApproved: (id) => pool && pool.removeApproved(id),
    get roomId() { return engine.currentRoomId; },
    get roomRef() { return engine.roomRef; },
    set onStateChange(fn) { onStateChange = fn; },
  };
})();