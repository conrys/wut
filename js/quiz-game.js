// ==========================================================================
// Quiz ("Своя гра") — перенесено з окремого Node.js+Socket.IO сервера на
// online-engine.js. Хід по черзі (round-robin серед підключених гравців,
// відсортованих за joinedAt) — хто б не відповів, хід все одно переходить
// далі, це НЕ "хто відповів правильно — лишається відповідати" механіка.
//
// lockedHost:true — потрібен постійний tick-loop (countdown, таймер питання,
// пауза-інтрига перед показом результату, показ результату) так само, як у
// Змійці. Лише ОДИН клієнт (поточний хост) фактично рухає фази гри й пише
// рахунок; активний гравець сам лише кладе свою відповідь (`pendingAnswer`)
// у кімнату — хост підхоплює її на своєму наступному тіку й оцінює.
//
// Банк питань (QUIZ_TOPICS, окремий файл quiz-topics.js) — статичний, лежить
// локально в кожного клієнта. У кімнаті зберігається лише "дошка" з
// прапорцями played по індексах categoryIndex/questionIndex, не самі тексти
// питань/відповідей — це економить записи і водночас НЕ є справжнім
// server-side приховуванням відповіді (той самий рівень довіри, що й у
// Quiplash: технічно підкований гравець і так має весь банк локально).
// ==========================================================================
(function () {
  const MIN_PLAYERS = 2;
  const COUNTDOWN_SECONDS = 10;
  const RESULT_DISPLAY_SECONDS = 3;
  const REVEAL_DELAY_MS = 1200; // коротка "інтрига" перед показом результату
  const WRONG_PENALTY_RATIO = 0.5; // -50% від вартості питання за неправильну відповідь
  const TICK_MS = 500;

  const ROOM_SCHEMA = {
    phase: "lobby", // lobby|countdown|categorySelect|questionActive|evaluating|resultDisplay|game_over
    currentPlayerUsername: null,
    currentQuestion: null, // { categoryIndex, questionIndex }
    board: null, // [{ name, questions:[{played}] }]
    pendingAnswer: null, // { selectedIndex, at } — кладе активний гравець, забирає хост
    phaseDeadline: null,
    lastEvaluation: null,
    players: {},
  };

  function buildFreshBoard() {
    return QUIZ_TOPICS.map((t) => ({ name: t.name, questions: t.questions.map(() => ({ played: false })) }));
  }

  const Engine = window.OnlineEngine.create("quiz", {
    lockedHost: true,
    onEmptyPlayer: () => ({ score: 0 }),
    onDisconnectPlayerPatch: { lastSeen: 0 },
  });

  let username = null;
  let ref = null;
  let tickTimer = null;
  let onStateChange = () => {};

  function now() { return Engine.now(); }

  // ------------------------- допоміжні -------------------------
  function connectedEntries(players) {
    return Object.entries(players || {}).filter(([, p]) => Engine.isConnected(p));
  }
  function connectedSorted(players) {
    return connectedEntries(players).sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
  }
  function computeHost(players) {
    return Engine.computeHost(players);
  }
  function allBoardPlayed(board) {
    return (board || []).every((t) => t.questions.every((q) => q.played));
  }
  function pickNextPlayer(state, afterUsername) {
    const conn = connectedSorted(state.players);
    if (!conn.length) return null;
    if (!afterUsername) return conn[0][0];
    const idx = conn.findIndex(([n]) => n === afterUsername);
    return conn[(idx + 1 + conn.length) % conn.length][0]; // idx===-1 (пішов) → conn[0]
  }

  // ------------------------- приєднання / presence -------------------------
  function start(user) {
    username = user;
    Engine.start(user, { useLobby: false });

    Engine.onStateChange = (type, data) => {
      if (type !== "room-update") return;
      const state = data.room;
      ref = Engine.roomRef;

      if (!state.players || !state.players[username]) {
        if (state.phase === "lobby") {
          Engine.becomePlayer({ score: 0 });
        } else {
          onStateChange(state, { username, host: false, isActive: false, spectating: true });
          return;
        }
      }

      onStateChange(state, {
        username,
        host: computeHost(state.players) === username,
        isActive: state.currentPlayerUsername === username,
        spectating: false,
      });
    };

    Engine.onBecomeHost = () => {
      if (tickTimer) clearInterval(tickTimer);
      tickTimer = setInterval(hostTick, TICK_MS);
    };
    Engine.onLoseHost = () => {
      if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    };

    Engine.getOrCreateRoom(Engine.SHARED_ROOM_ID, ROOM_SCHEMA, () => ({ board: buildFreshBoard() })).then(({ room }) => {
      const alreadyIn = !!(room.players && room.players[username]);
      const canJoinAsPlayer = alreadyIn || room.phase === "lobby" || room.phase === "countdown";
      Engine.joinRoom(Engine.SHARED_ROOM_ID, { asPlayer: canJoinAsPlayer, extra: { score: 0 } });
    });
  }

  function stop() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    Engine.stop({ preserveRoomPresence: true });
  }

  // ------------------------- дії гравця -------------------------
  function selectQuestion(categoryIndex, questionIndex) {
    const room = Engine.latestRoom;
    if (!room || room.phase !== "categorySelect") return;
    if (room.currentPlayerUsername !== username) return;
    const cell = room.board[categoryIndex] && room.board[categoryIndex].questions[questionIndex];
    if (!cell || cell.played) return;
    const q = QUIZ_TOPICS[categoryIndex].questions[questionIndex];

    ref.update({
      phase: "questionActive",
      currentQuestion: { categoryIndex, questionIndex },
      [`board/${categoryIndex}/questions/${questionIndex}/played`]: true,
      phaseDeadline: now() + q.timeLimit * 1000,
      pendingAnswer: null,
      lastEvaluation: null,
    });
  }

  function submitAnswer(selectedIndex) {
    const room = Engine.latestRoom;
    if (!room || room.phase !== "questionActive") return;
    if (room.currentPlayerUsername !== username) return;
    if (room.pendingAnswer) return; // вже відповів
    Engine.roomRef.update({ pendingAnswer: { selectedIndex, at: now() } });
  }

  // ------------------------- дії хоста (кнопки на телефоні хоста) -------------------------
  function forceStart() {
    const room = Engine.latestRoom;
    if (!room || (room.phase !== "lobby" && room.phase !== "countdown")) return;
    if (connectedSorted(room.players).length < MIN_PLAYERS) return;
    ref.update({ phase: "categorySelect", currentPlayerUsername: pickNextPlayer(room, null), phaseDeadline: null });
  }
  function skipQuestion() {
    const room = Engine.latestRoom;
    if (!room || room.phase !== "questionActive") return;
    finalizeAnswer(room, null);
  }
  function forceNextTurn() {
    const room = Engine.latestRoom;
    if (!room || (room.phase !== "resultDisplay" && room.phase !== "evaluating")) return;
    advanceAfterResult(room);
  }
  function resetGame() {
    return Engine.forceResetRoom(Engine.SHARED_ROOM_ID, ROOM_SCHEMA, () => ({ board: buildFreshBoard() })).then(() => {
      Engine.joinRoom(Engine.SHARED_ROOM_ID, { extra: { score: 0 } });
    });
  }

  // ------------------------- оцінювання / перехід ходу (тільки хост) -------------------------
  function finalizeAnswer(room, selectedIndex) {
    const { categoryIndex, questionIndex } = room.currentQuestion;
    const q = QUIZ_TOPICS[categoryIndex].questions[questionIndex];
    const correct = selectedIndex !== null && q.correctIndices.includes(selectedIndex);
    const pointsAwarded = correct ? q.value : -Math.round(q.value * WRONG_PENALTY_RATIO);
    const activeName = room.currentPlayerUsername;
    const player = room.players[activeName];

    const updates = {
      phase: "evaluating",
      phaseDeadline: now() + REVEAL_DELAY_MS,
      pendingAnswer: null,
      lastEvaluation: {
        playerName: activeName,
        correct,
        selectedIndex,
        pointsAwarded,
        value: q.value,
      },
    };
    if (player) updates[`players/${activeName}/score`] = (player.score || 0) + pointsAwarded;
    ref.update(updates);
  }

  function advanceAfterResult(room) {
    if (allBoardPlayed(room.board)) {
      ref.update({ phase: "game_over", phaseDeadline: null, currentQuestion: null, currentPlayerUsername: null });
      return;
    }
    const next = pickNextPlayer(room, room.currentPlayerUsername);
    ref.update({
      phase: "categorySelect",
      currentPlayerUsername: next,
      currentQuestion: null,
      phaseDeadline: null,
      lastEvaluation: null,
    });
  }

  // ------------------------- tick хоста -------------------------
  function hostTick() {
    const room = Engine.latestRoom;
    if (!room || !ref) return;
    const t = now();

    switch (room.phase) {
      case "lobby": {
        if (connectedSorted(room.players).length >= MIN_PLAYERS) {
          ref.update({ phase: "countdown", phaseDeadline: t + COUNTDOWN_SECONDS * 1000 });
        }
        break;
      }
      case "countdown": {
        if (connectedSorted(room.players).length < MIN_PLAYERS) {
          ref.update({ phase: "lobby", phaseDeadline: null });
          break;
        }
        if (t >= room.phaseDeadline) {
          ref.update({ phase: "categorySelect", currentPlayerUsername: pickNextPlayer(room, null), phaseDeadline: null });
        }
        break;
      }
      case "categorySelect": {
        if (!Engine.isConnected(room.players[room.currentPlayerUsername] || {})) {
          const next = pickNextPlayer(room, room.currentPlayerUsername);
          if (next && next !== room.currentPlayerUsername) ref.update({ currentPlayerUsername: next });
        }
        break;
      }
      case "questionActive": {
        if (room.pendingAnswer) { finalizeAnswer(room, room.pendingAnswer.selectedIndex); break; }
        if (!Engine.isConnected(room.players[room.currentPlayerUsername] || {})) { finalizeAnswer(room, null); break; }
        if (t >= room.phaseDeadline) { finalizeAnswer(room, null); }
        break;
      }
      case "evaluating": {
        if (t >= room.phaseDeadline) {
          ref.update({ phase: "resultDisplay", phaseDeadline: t + RESULT_DISPLAY_SECONDS * 1000 });
        }
        break;
      }
      case "resultDisplay": {
        if (t >= room.phaseDeadline) advanceAfterResult(room);
        break;
      }
      default:
        break;
    }
  }

  window.QuizGame = {
    MIN_PLAYERS,
    COUNTDOWN_SECONDS,
    RESULT_DISPLAY_SECONDS,
    QUIZ_TOPICS,
    connectedEntries,
    computeHost,
    start,
    stop,
    selectQuestion,
    submitAnswer,
    forceStart,
    skipQuestion,
    forceNextTurn,
    resetGame,
    set onStateChange(fn) { onStateChange = fn; },
  };
})();
