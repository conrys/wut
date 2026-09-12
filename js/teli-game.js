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
  const PHASES = ["lobby", "active", "reveal"];
  const MIN_PLAYERS = 2;
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

  const engine = window.OnlineEngine.create("teli", {
    phases: PHASES,
    lockedHost: true, // потрібне тільки host-election (щоб один клієнт вів перехід кіл), не тік
  });

  let username = null;
  let onStateChange = () => {};
  let advancing = false;

  function buildFreshRoom() { return { players: {} }; }

  function unanswered(v) { return v === null || v === undefined; }

  function connectedNames(players) {
    return Object.entries(players || {}).filter(([, p]) => engine.isConnected(p)).map(([n]) => n);
  }

  // ------------------------- старт -------------------------
  async function start(user) {
    username = user;
    engine.onStateChange = handleEngineEvent;
    engine.start(username, { useLobby: false });
    await engine.getOrCreateRoom(engine.SHARED_ROOM_ID, SCHEMA, buildFreshRoom);
    await engine.joinRoom(engine.SHARED_ROOM_ID, { asPlayer: false });
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
    engine.forceResetRoom(engine.SHARED_ROOM_ID, SCHEMA, buildFreshRoom);
  }

  window.TeliGame = {
    MIN_PLAYERS,
    connectedNames,
    computeHost: (players) => engine.computeHost(players),
    isConnected: (p) => engine.isConnected(p),
    unanswered,
    start,
    stop,
    startGame,
    submitEntry,
    forceAdvance,
    resetGame,
    set onStateChange(fn) { onStateChange = fn; },
  };
})();
