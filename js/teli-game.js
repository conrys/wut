// ==========================================================================
// Зіпсований телефон на спільному OnlineEngine (js/online-engine.js).
// Одна спільна кімната ("shared", useLobby:false).
//
// На відміну від Смішліста тут немає таймерів — перехід до наступного кола
// відбувається реактивно, щойно останній гравець надішле свій запис (не
// окремий setInterval-тік, а перевірка прямо в колбеку room-update; хост
// потрібен лише щоб рівно ОДИН клієнт виконував перехід, lockedHost:true
// дає готове host-election з міграцією без додаткового коду).
//
// Підключати ПІСЛЯ firebase-config.js, login.js, online-engine.js,
// draw-canvas.js.
// ==========================================================================
(function () {
  const GAME_KEY = "teli";
  const PHASES = ["lobby", "active", "reveal"];
  const MIN_PLAYERS = 2;
  const ABANDON_MS = 15 * 60 * 1000;
  const MAX_TEXT_LEN = 140;
  const MAX_DRAWING_BYTES = 900000; // приблизна межа розміру data URL картинки

  const SCHEMA = {
    phase: "lobby",
    hostUsername: null,
    playerOrder: null,
    totalRounds: 0,
    currentRound: 0,
    books: null,
    assignments: null,
    submitted: null,
    players: {},
  };

  const engine = window.OnlineEngine.create(GAME_KEY, {
    phases: PHASES,
    lockedHost: true, // потрібне тільки host-election (щоб один клієнт вів перехід кіл), не тік
    abandonMs: ABANDON_MS,
  });

  let username = null;
  let onStateChange = () => {};
  let advancing = false;

  function buildFreshRoom() { return { players: {} }; }

  function unanswered(v) { return v === null || v === undefined; }

  function connectedNames(players) {
    return Object.entries(players || {}).filter(([, p]) => engine.isConnected(p)).map(([n]) => n);
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
          roomId,
          phase: room.phase || "lobby",
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

  // ------------------------- старт -------------------------
  async function start(user, roomId) {
    username = user;
    engine.onStateChange = handleEngineEvent;
    engine.start(username, { useLobby: false });
    await engine.getOrCreateRoom(roomId, SCHEMA, buildFreshRoom);
    await engine.joinRoom(roomId, { asPlayer: false });
  }

  function stop() {
    engine.stop();
  }

  function handleEngineEvent(type, data) {
    if (type !== "room-update") return;
    const room = data.room;
    maybeJoinAsPlayer(room);
    if (engine.isHost) maybeAutoAdvance(room);
    onStateChange(room, { username, host: engine.computeHost(room.players) === username });
  }

  // Гравець, що вже був у грі (перезайшов), лишається як є навіть посеред
  // раунду — отримає своє завдання назад. Новий гравець може приєднатись
  // тільки в лобі (не можна влізти посеред активного кола).
  function maybeJoinAsPlayer(room) {
    if (room.players && room.players[username]) return;
    if (room.phase !== "lobby") return;
    engine.becomePlayer({});
  }

  // ------------------------- ігрова логіка (роздача/ротація) -------------------------
  function bookIndexFor(playerIdx, round, totalRounds) {
    return (playerIdx + round) % totalRounds;
  }
  function nextEntryType(book) {
    if (!book || !book.length) return "text"; // перший крок кожної книги — завжди фраза
    return book[book.length - 1].type === "text" ? "drawing" : "text";
  }
  function buildAssignments(playerOrder, round, totalRounds, books) {
    const assignments = {};
    playerOrder.forEach((name, idx) => {
      const bookIdx = bookIndexFor(idx, round, totalRounds);
      const book = books[bookIdx] || [];
      const type = nextEntryType(book);
      const prompt = book.length ? book[book.length - 1] : null;
      assignments[name] = { bookIndex: bookIdx, type, prompt };
    });
    return assignments;
  }

  async function startGame(room) {
    const playerOrder = connectedNames(room.players);
    if (playerOrder.length < MIN_PLAYERS) return;
    const totalRounds = playerOrder.length;
    const books = Array.from({ length: totalRounds }, () => []);
    const assignments = buildAssignments(playerOrder, 0, totalRounds, books);
    await engine.roomRef.update({
      phase: "active",
      playerOrder,
      totalRounds,
      currentRound: 0,
      books,
      assignments,
      submitted: {},
    });
  }

  function submitEntry({ text, drawing }) {
    const room = engine.latestRoom;
    if (!room || room.phase !== "active") return;
    const assignment = room.assignments && room.assignments[username];
    if (!assignment) return;
    if (room.submitted && room.submitted[username]) return;

    let content;
    if (assignment.type === "text") {
      content = (text || "").trim().slice(0, MAX_TEXT_LEN);
      if (!content) return;
    } else {
      if (!drawing || typeof drawing !== "string" || !drawing.startsWith("data:image/")) return;
      if (drawing.length > MAX_DRAWING_BYTES) return;
      content = drawing;
    }

    const entry = { type: assignment.type, content, authorName: username };
    // transaction на конкретну книгу — безпечно навіть якщо двоє додають
    // записи в РІЗНІ книги одночасно (кожна книга — свій незалежний шлях)
    engine.roomRef.child(`books/${assignment.bookIndex}`).transaction((current) => {
      const arr = current || [];
      arr.push(entry);
      return arr;
    }).then(() => {
      engine.roomRef.child(`submitted/${username}`).set(true);
    });
  }

  function maybeAutoAdvance(room) {
    if (room.phase !== "active" || advancing) return;
    const submittedCount = Object.keys(room.submitted || {}).length;
    if (submittedCount >= (room.playerOrder || []).length && room.playerOrder.length > 0) {
      advanceRound(room);
    }
  }

  async function advanceRound(room) {
    advancing = true;
    try {
      const nextRound = room.currentRound + 1;
      if (nextRound >= room.totalRounds) {
        await engine.roomRef.update({ phase: "reveal" });
        return;
      }
      const assignments = buildAssignments(room.playerOrder, nextRound, room.totalRounds, room.books);
      await engine.roomRef.update({ currentRound: nextRound, assignments, submitted: {} });
    } finally {
      advancing = false;
    }
  }

  // Хост може примусово пропустити очікування (хтось завис/вийшов посеред
  // кола) — рахує книги неактивних гравців незмінними далі по колу.
  function forceAdvance() {
    const room = engine.latestRoom;
    if (!room || room.phase !== "active") return;
    advanceRound(room);
  }

  function resetGame() {
    const roomId = engine.currentRoomId;
    if (!roomId) return;
    engine.forceResetRoom(roomId, SCHEMA, buildFreshRoom);
  }

  window.TeliGame = {
    MIN_PLAYERS,
    connectedNames,
    computeHost: (players) => engine.computeHost(players),
    isConnected: (p) => engine.isConnected(p),
    unanswered,
    watchActiveRooms,
    start,
    stop,
    startGame,
    submitEntry,
    forceAdvance,
    resetGame,
    get roomId() { return engine.currentRoomId; },
    set onStateChange(fn) { onStateChange = fn; },
  };
})();
