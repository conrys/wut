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
  const DEFAULT_DRAW_SECONDS = 60;
  const MIN_DRAW_SECONDS = 20;
  const MAX_DRAW_SECONDS = 180;

  const SCHEMA = {
    phase: "lobby",
    hostUsername: null,
    lobbySettings: { drawSeconds: DEFAULT_DRAW_SECONDS },
    gameId: null, // унікальний id гри: відрізняє коло 2 від кола 1 у тій самій кімнаті
    playerOrder: null,
    totalRounds: 0,
    currentRound: 0,
    books: null, // books/<книга>/<номер раунду> = запис (слот за раундом, НЕ push у масив)
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

  function buildFreshRoom() { return { players: {}, lobbySettings: { drawSeconds: DEFAULT_DRAW_SECONDS } }; }

  function clampDrawSeconds(v) {
    v = Number(v) || DEFAULT_DRAW_SECONDS;
    return Math.max(MIN_DRAW_SECONDS, Math.min(MAX_DRAW_SECONDS, Math.round(v)));
  }

  function updateLobbySettings(partial) {
    const room = engine.latestRoom;
    if (!room || room.phase !== "lobby") return;
    const next = {};
    if (partial && partial.drawSeconds !== undefined) next.drawSeconds = clampDrawSeconds(partial.drawSeconds);
    if (Object.keys(next).length) engine.roomRef.child("lobbySettings").update(next);
  }

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
  // Тип кроку залежить ЛИШЕ від номера раунду (0 — фраза, 1 — малюнок, 2 — фраза…),
  // а не від того, що лежить у книзі: пропущений запис більше не збиває чергування.
  function entryTypeForRound(round) { return round % 2 === 0 ? "text" : "drawing"; }

  // Книга в RTDB — це слоти за раундом; повертає записи по порядку раундів
  // (масив, об'єкт чи undefined; прогалини пропускає).
  function bookEntries(book) {
    if (!book) return [];
    return Object.keys(book).map(Number).filter((k) => !Number.isNaN(k)).sort((a, b) => a - b)
      .map((k) => book[k]).filter(Boolean);
  }
  function entryBefore(book, round) {
    if (!book) return null;
    for (let r = round - 1; r >= 0; r--) if (book[r]) return book[r];
    return null;
  }
  function buildAssignments(playerOrder, round, totalRounds, books) {
    const assignments = {};
    playerOrder.forEach((name, idx) => {
      const bookIdx = bookIndexFor(idx, round, totalRounds);
      assignments[name] = {
        bookIndex: bookIdx,
        round, // завдання знає свій раунд — застаріле ніколи не піде в чужий слот
        type: entryTypeForRound(round),
        prompt: entryBefore(books && books[bookIdx], round),
      };
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
      gameId: engine.now(),
      playerOrder,
      totalRounds,
      currentRound: 0,
      books,
      assignments,
      submitted: {},
    });
  }

  // Повертає { ok:true } або { ok:false, reason } одразу; саме записування йде
  // асинхронно. Запис книги і submitted/<ім'я> — ОДИН атомарний update у слот
  // books/<книга>/<раунд>: повторний виклик (подвійний тап, автовідправка на
  // таймері) лише перезаписує той самий слот і не додає другий запис. Якщо запис
  // упав, ключ in-flight знімається і викликається onSubmitError.
  let inFlightKey = null;
  let onSubmitError = () => {};

  function submitEntry({ text, drawing }) {
    const room = engine.latestRoom;
    if (!room || room.phase !== "active") return { ok: false, reason: "wrong-phase" };
    const assignment = room.assignments && room.assignments[username];
    if (!assignment || assignment.round !== room.currentRound) return { ok: false, reason: "no-assignment" };
    if (room.submitted && room.submitted[username]) return { ok: false, reason: "already-submitted" };
    const round = room.currentRound;
    const key = `${room.gameId}:${round}`;
    if (inFlightKey === key) return { ok: false, reason: "in-flight" };

    let content;
    if (assignment.type === "text") {
      content = (text || "").trim().slice(0, MAX_TEXT_LEN);
      if (!content) return { ok: false, reason: "empty-text" };
    } else {
      if (!drawing || typeof drawing !== "string" || !drawing.startsWith("data:image/")) {
        return { ok: false, reason: "no-drawing" };
      }
      if (drawing.length > MAX_DRAWING_BYTES) return { ok: false, reason: "drawing-too-large" };
      content = drawing;
    }

    inFlightKey = key; // після успіху лишається до зміни раунду (інший key)
    const entry = { type: assignment.type, content, authorName: username };
    Promise.resolve(engine.roomRef.update({
      [`books/${assignment.bookIndex}/${round}`]: entry,
      [`submitted/${username}`]: round + 1, // >0, щоб лишалось truthy у UI
    })).catch((error) => {
      if (inFlightKey === key) inFlightKey = null; // дозволяємо повторну спробу
      onSubmitError({ reason: "write-failed", error });
    });
    return { ok: true };
  }

  function maybeAutoAdvance(room) {
    if (room.phase !== "active" || advancing) return;
    const order = room.playerOrder || [];
    // лише ті, хто здав САМЕ цей раунд (submitted = раунд + 1)
    const allIn = order.length > 0 && order.every((n) => room.submitted && room.submitted[n] === room.currentRound + 1);
    if (allIn) advanceRound(room);
  }

  async function advanceRound(room) {
    advancing = true;
    try {
      // перехід уже зробив інший клієнт/попередній виклик — нічого не робимо
      const cur = engine.latestRoom;
      if (!cur || cur.phase !== "active" || cur.currentRound !== room.currentRound) return;
      const nextRound = room.currentRound + 1;
      if (nextRound >= room.totalRounds) {
        await engine.roomRef.update({ phase: "reveal" });
        return;
      }
      const assignments = buildAssignments(room.playerOrder, nextRound, room.totalRounds, cur.books);
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
    MAX_DRAWING_BYTES,
    DEFAULT_DRAW_SECONDS, MIN_DRAW_SECONDS, MAX_DRAW_SECONDS,
    updateLobbySettings,
    bookEntries,
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
    get roomRef() { return engine.roomRef; },
    set onSubmitError(fn) { onSubmitError = typeof fn === "function" ? fn : () => {}; },
    set onStateChange(fn) { onStateChange = fn; },
  };
})();
