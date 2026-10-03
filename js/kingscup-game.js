// ==========================================================================
// kingscup-game.js — King's Cup на OnlineEngine + js/fact-pool.js (валет
// читає з того самого механізму особистих фактів, що й Human Bingo — кожна
// кімната має свій примірник пулу, схема та сама).
//
// Правила закладені прямо в RULES нижче — той самий набір, що узгодили:
// A=Водоспад, 2=Ти, 3=Я, 4=Підлога, 7=Небо, 8=Друг, 10=Категорії,
// J="Я ніколи не" (з пулу), Q=Майстер питань, K=нове правило (1-3) чи
// "випий чашу" (4-й король). 5,6,9 — без правила (просто витягнута карта).
//
// Застосунок НЕ намагається відстежувати саме пиття — лише лічильник
// спільної чаші як число на екрані; реальне виконання правил на чесність.
//
// Підключати ПІСЛЯ firebase-config.js, login.js, online-engine.js,
// fact-pool.js.
// ==========================================================================
(function () {
  const GAME_KEY = "kingscup";
  const PHASES = ["lobby", "playing", "ended"];
  const ABANDON_MS = 6 * 60 * 60 * 1000;
  const SUITS = ["S", "H", "D", "C"];
  const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  const RANK_LABEL = { 14: "A", 13: "K", 12: "Q", 11: "J" };
  function rankLabel(r) { return RANK_LABEL[r] || String(r); }

  const RULES = {
    14: { name: "Водоспад", text: "П'єте по колу, почавши з тебе — ніхто не зупиняється, поки не зупинився попередній" },
    2: { name: "Ти", text: "Вкажи, хто п'є" },
    3: { name: "Я", text: "Ти п'єш" },
    4: { name: "Підлога", text: "Останній, хто торкнувся підлоги, — п'є" },
    7: { name: "Небо", text: "Останній, хто підняв руку, — п'є" },
    8: { name: "Друг", text: "Обери напарника — відтепер коли п'єш ти, п'є і він" },
    10: { name: "Категорії", text: "Назви категорію — по колу називайте щось з неї, зам'явся — п'єш" },
    12: { name: "Майстер питань", text: "Хто відповість на твоє питання — п'є, доки не витягнуть наступну даму" },
  };

  const F = window.FactPool;
  const SCHEMA = {
    phase: "lobby", hostUsername: null,
    factPool: { spiceLevel: 3, thresholds: F.DEFAULT_THRESHOLDS, facts: {}, queue: {} },
    deck: [], turnOrder: [], turnIdx: 0, cupCount: 0, kingsThisCycle: 0,
    currentCard: null, currentExtra: null, lastCupDrink: null,
    buddies: {}, houseRules: [], players: {},
  };

  const engine = window.OnlineEngine.create(GAME_KEY, { phases: PHASES, abandonMs: ABANDON_MS });
  let username = null;
  let onStateChange = () => {};
  let pool = null;

  function freshDeck() {
    const deck = [];
    for (const s of SUITS) for (const r of RANKS) deck.push({ rank: r, suit: s });
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    return deck;
  }

  function buildFreshRoom() {
    return {
      hostUsername: null,
      factPool: { spiceLevel: 3, thresholds: F.DEFAULT_THRESHOLDS, facts: {}, queue: {} },
      deck: [], turnOrder: [], turnIdx: 0, cupCount: 0, kingsThisCycle: 0,
      currentCard: null, currentExtra: null, lastCupDrink: null,
      buddies: {}, houseRules: [], players: {},
    };
  }

  function connectedNames(players) { return Object.entries(players || {}).filter(([, p]) => engine.isConnected(p)).map(([n]) => n); }
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
    const turnOrder = room.turnOrder || [];
    const isMyTurn = room.phase === "playing" && turnOrder[room.turnIdx || 0] === username;
    onStateChange(room, { username, isHost, isMyTurn, sessionId: room.createdAt || null });
  }

  function startGame() {
    const room = engine.latestRoom;
    if (!room || room.hostUsername !== username || room.phase !== "lobby") return;
    const names = Object.keys(room.players || {});
    if (names.length < 2) return;
    engine.roomRef.update({
      phase: "playing", deck: freshDeck(), turnOrder: names, turnIdx: 0,
      cupCount: 0, kingsThisCycle: 0, currentCard: null, currentExtra: null, lastCupDrink: null,
      buddies: {}, houseRules: [],
    });
  }

  // Тягне карту. Не просуває хід сам — гравець читає правило й тисне
  // "Далі" (advanceTurn), щоб встигнути обрати друга/вписати правило для
  // карт, які цього потребують (8, K).
  function drawCard() {
    const room = engine.latestRoom;
    if (!room || room.phase !== "playing") return;
    const turnOrder = room.turnOrder || [];
    if (turnOrder[room.turnIdx || 0] !== username) return;
    const deck = (room.deck || []).slice();
    if (!deck.length) return;
    const card = deck.pop();
    const update = { deck, currentCard: card, currentExtra: null, cupCount: (room.cupCount || 0) + 1 };

    if (card.rank === 11) { // J
      const fact = pool ? F.pickForReading((room.factPool || {}).facts, (room.factPool || {}).spiceLevel || 3, room.createdAt || null) : null;
      update.currentExtra = fact ? { type: "fact", factId: fact.id, text: fact.text } : { type: "fact", factId: null, text: "У пулі ще нема фактів" };
      if (fact) pool.markPlayed(fact.id, room.createdAt || null);
    } else if (card.rank === 13) { // K
      const cycle = (room.kingsThisCycle || 0) + 1;
      if (cycle >= 4) {
        update.lastCupDrink = { by: username, amount: update.cupCount };
        update.cupCount = 0;
        update.kingsThisCycle = 0;
        update.currentExtra = { type: "drink-cup" };
      } else {
        update.kingsThisCycle = cycle;
        update.currentExtra = { type: "new-rule", cycle };
      }
    } else if (card.rank === 8) {
      update.currentExtra = { type: "buddy" };
    }
    engine.roomRef.update(update);
  }

  function pickBuddy(targetUsername) {
    const room = engine.latestRoom;
    if (!room || room.phase !== "playing") return;
    const turnOrder = room.turnOrder || [];
    if (turnOrder[room.turnIdx || 0] !== username) return;
    engine.roomRef.child("buddies/" + username).set(targetUsername);
  }
  function addHouseRule(text) {
    const room = engine.latestRoom;
    if (!room || !text || !text.trim()) return;
    const turnOrder = room.turnOrder || [];
    if (turnOrder[room.turnIdx || 0] !== username) return;
    const rules = (room.houseRules || []).concat([text.trim()]);
    engine.roomRef.child("houseRules").set(rules);
  }

  function advanceTurn() {
    const room = engine.latestRoom;
    if (!room || room.phase !== "playing") return;
    const turnOrder = room.turnOrder || [];
    if (turnOrder[room.turnIdx || 0] !== username) return;
    const nextIdx = ((room.turnIdx || 0) + 1) % turnOrder.length;
    if (!(room.deck || []).length) {
      engine.roomRef.update({ phase: "ended" });
      return;
    }
    // currentCard теж скидаємо: UI показує "Тягнути карту" лише коли currentCard
    // порожній. Раніше стара карта лишалась, і всі бачили тільки кнопку "Далі".
    engine.roomRef.update({ turnIdx: nextIdx, currentCard: null, currentExtra: null });
  }

  function endGame() {
    const room = engine.latestRoom;
    if (!room || room.hostUsername !== username) return;
    engine.roomRef.update({ phase: "ended" });
  }
  function backToLobby() {
    const room = engine.latestRoom;
    if (!room || room.hostUsername !== username) return;
    engine.roomRef.update({ phase: "lobby", currentCard: null, currentExtra: null });
  }

  window.KingsCupGame = {
    RULES, rankLabel,
    watchActiveRooms, start, stop, startGame,
    drawCard, pickBuddy, addHouseRule, advanceTurn, endGame, backToLobby,
    setSpiceLevel: (lvl) => pool && pool.setSpiceLevel(lvl),
    setThresholds: (th) => pool && pool.setThresholds(th),
    approve: (id) => pool && pool.approve(id),
    reject: (id) => pool && pool.reject(id),
    submitFact: (text, level) => { const room = engine.latestRoom; return pool ? pool.submit(text, username, level, room && room.createdAt) : Promise.resolve({ verdict: "empty" }); },
    get roomId() { return engine.currentRoomId; },
    get roomRef() { return engine.roomRef; },
    set onStateChange(fn) { onStateChange = fn; },
  };
})();