// ==========================================================================
// chess-game.js — онлайн-шахи на спільному OnlineEngine (js/online-engine.js)
// + чисте ядро правил js/chess-rules.js.
//
// Кімнатна модель відрізняється від party-ігор: тут рівно ДВА гравецькі
// слоти (white/black), а не список "усі грають". РОЛЬ НЕ РОЗДАЄТЬСЯ
// АВТОМАТИЧНО — кожен, хто заходить у кімнату (і той, хто її створив
// теж), спершу глядач і сам обирає color через claimColor("w"|"b") або
// лишається спостерігачем.
//
// hostUsername/hostSessionId — лише для host-election всередині
// OnlineEngine (потрібен один клієнт для getOrCreateRoom-конкурентності);
// саму партію "не веде" жоден хост — кожен гравець пише свій хід сам,
// суперник просто підписаний на roomRef.
//
// Таймконтроль (обирається при СТВОРЕННІ кімнати, не змінюється потім):
//   timeControl: { type: "none" }                                — без обмежень,
//     кімната лишається у списку активних довго (кілька днів), щоб можна
//     було повернутись і доходити партію коли завгодно.
//   timeControl: { type: "clock", initialSeconds, incrementSeconds } —
//     класичний шаховий годинник (RTDB timestamps, синхронізовані через
//     engine.now(), а не Date.now() — щоб не залежати від годинника
//     конкретного телефону); кімната вважається "старою" і зникає зі
//     списку за звичайний ABANDON_MS, як усі party-ігри.
//
// Підключати ПІСЛЯ firebase-config.js, login.js, online-engine.js,
// chess-rules.js.
// ==========================================================================
(function () {
  const GAME_KEY = "chess";
  const PHASES = ["lobby", "playing", "ended"];
  const ABANDON_MS_TIMED = 30 * 60 * 1000;       // партія з годинником: як звичайна party-гра
  const ABANDON_MS_UNTIMED = 3 * 24 * 60 * 60 * 1000; // без таймера: кілька днів, щоб дограти пізніше

  const R = window.ChessRules;

  const SCHEMA = {
    phase: "lobby",
    hostUsername: null,
    white: null,
    black: null,
    state: null,         // ChessRules.encodeState(...) поточної позиції
    result: null,         // { status, winner, reason } коли гра завершилась
    drawOfferBy: null,    // username, хто запропонував нічию (null — нема пропозиції)
    rematchVotes: null,   // { username: true } — обидва проголосували → нова партія
    timeControl: null,    // { type: "none" } | { type: "clock", initialSeconds, incrementSeconds }
    clock: null,          // { w: секунди_лишилось, b: секунди_лишилось, turnStartedAt } — лише для type:"clock"
    players: {},
  };

  const engine = window.OnlineEngine.create(GAME_KEY, { phases: PHASES, abandonMs: ABANDON_MS_TIMED });

  let username = null;
  let onStateChange = () => {};
  let clockTimer = null;

  function buildFreshRoom(timeControl) {
    return {
      players: {}, white: null, black: null, state: null, result: null,
      drawOfferBy: null, rematchVotes: null,
      timeControl: timeControl || { type: "none" },
      clock: null,
    };
  }

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
        const untimed = !room.timeControl || room.timeControl.type === "none";
        const threshold = untimed ? ABANDON_MS_UNTIMED : ABANDON_MS_TIMED;
        const stale = !connected.length && (!lastActivity || t - lastActivity > threshold);
        return {
          roomId, phase: room.phase || "lobby",
          white: room.white || null, black: room.black || null,
          timeControl: room.timeControl || { type: "none" },
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
  // timeControl передається лише коли РЕАЛЬНО створюється нова кімната
  // (buildFreshRoom викликається getOrCreateRoom лише якщо кімнати з таким
  // roomId ще нема або вона стара) — приєднання до існуючої кімнати цей
  // параметр просто ігнорує.
  async function start(user, roomId, timeControl) {
    username = user;
    engine.onStateChange = handleEngineEvent;
    engine.start(username, { useLobby: false });
    await engine.getOrCreateRoom(roomId, SCHEMA, () => buildFreshRoom(timeControl));
    await engine.joinRoom(roomId, { asPlayer: false });
    engine.becomePlayer({}); // просто позначитись присутнім — БЕЗ авто-кольору, роль обирає сам гравець
    startClockTicker();
  }

  function stop() {
    stopClockTicker();
    engine.stop();
  }

  function handleEngineEvent(type, data) {
    if (type !== "room-update") return;
    onStateChange(data.room, buildCtx(data.room));
  }

  function buildCtx(room) {
    const myColor = room.white === username ? "w" : room.black === username ? "b" : null;
    return {
      username,
      myColor,
      isSpectator: myColor === null,
      state: room.state ? R.decodeState(room.state) : null,
    };
  }

  // ------------------------- вибір ролі -------------------------
  // transaction() — щоб двоє, які тиснуть на той самий колір одночасно, не
  // обидва "виграли" (compare-and-swap: пише лише той, хто застав поле
  // ще порожнім).
  function claimColor(color) {
    const room = engine.latestRoom;
    if (!room || room.phase !== "lobby") return;
    if (room.white === username || room.black === username) return; // вже маєш роль
    const field = color === "w" ? "white" : "black";
    engine.roomRef.child(field).transaction((cur) => (cur ? undefined : username));
  }

  // Відмовитись від ролі до старту партії (щоб хтось інший міг зайняти).
  function releaseColor() {
    const room = engine.latestRoom;
    if (!room || room.phase !== "lobby") return;
    if (room.white === username) engine.roomRef.child("white").transaction((cur) => (cur === username ? null : undefined));
    else if (room.black === username) engine.roomRef.child("black").transaction((cur) => (cur === username ? null : undefined));
  }

  // ------------------------- старт партії -------------------------
  function startGame() {
    const room = engine.latestRoom;
    if (!room || !room.white || !room.black) return;
    const initial = R.encodeState(R.initialState());
    const tc = room.timeControl || { type: "none" };
    const clock = tc.type === "clock" ? { w: tc.initialSeconds, b: tc.initialSeconds, turnStartedAt: engine.now() } : null;
    engine.roomRef.update({ phase: "playing", state: initial, result: null, drawOfferBy: null, rematchVotes: null, clock });
  }

  // ------------------------- хід -------------------------
  // Клієнт, що ходить, сам перевіряє легальність (ChessRules.makeMove
  // повертає null на нелегальному ході — просто ігноруємо виклик).
  // Суперник при отриманні НЕ перевіряє повторно — довіра між друзями
  // достатня для гри для розваги, захист від читерства — не мета рушія.
  function makeMove(from, to, promotion) {
    const room = engine.latestRoom;
    if (!room || room.phase !== "playing" || !room.state) return false;
    const myColor = room.white === username ? "w" : room.black === username ? "b" : null;
    if (!myColor) return false;
    const state = R.decodeState(room.state);
    if (state.turn !== myColor) return false;
    const next = R.makeMove(state, { from, to, promotion });
    if (!next) return false;

    const status = R.gameStatus(next);
    const update = { state: R.encodeState(next), drawOfferBy: null };

    const tc = room.timeControl;
    if (tc && tc.type === "clock" && room.clock) {
      const elapsedSec = Math.max(0, (engine.now() - room.clock.turnStartedAt) / 1000);
      const remaining = Math.max(0, room.clock[myColor] - elapsedSec) + (tc.incrementSeconds || 0);
      update.clock = Object.assign({}, room.clock, { [myColor]: remaining, turnStartedAt: engine.now() });
    }

    if (status.status === "checkmate" || status.status === "stalemate" ||
        status.status === "draw-50move" || status.status === "draw-material" ||
        status.status === "draw-repetition") {
      update.phase = "ended";
      update.result = { status: status.status, winner: status.winner, reason: status.status };
    }
    engine.roomRef.update(update);
    return true;
  }

  function resign() {
    const room = engine.latestRoom;
    if (!room || room.phase !== "playing") return;
    const myColor = room.white === username ? "w" : room.black === username ? "b" : null;
    if (!myColor) return;
    engine.roomRef.update({
      phase: "ended",
      result: { status: "resign", winner: R.otherColor(myColor), reason: "resign" },
    });
  }

  function offerDraw() {
    const room = engine.latestRoom;
    if (!room || room.phase !== "playing") return;
    engine.roomRef.child("drawOfferBy").set(username);
  }
  function acceptDraw() {
    const room = engine.latestRoom;
    if (!room || room.phase !== "playing" || !room.drawOfferBy || room.drawOfferBy === username) return;
    engine.roomRef.update({ phase: "ended", result: { status: "draw-agreed", winner: null, reason: "draw-agreed" }, drawOfferBy: null });
  }
  function declineDraw() {
    engine.roomRef.child("drawOfferBy").set(null);
  }

  // Обидва гравці голосують → нова партія, кольори міняються місцями,
  // годинник (якщо є) стартує заново з тих самих початкових значень.
  function voteRematch() {
    const room = engine.latestRoom;
    if (!room || room.phase !== "ended") return;
    const votes = Object.assign({}, room.rematchVotes || {}, { [username]: true });
    const bothVoted = room.white && room.black && votes[room.white] && votes[room.black];
    if (bothVoted) {
      const tc = room.timeControl || { type: "none" };
      const clock = tc.type === "clock" ? { w: tc.initialSeconds, b: tc.initialSeconds, turnStartedAt: engine.now() } : null;
      engine.roomRef.update({
        phase: "playing",
        white: room.black, black: room.white,
        state: R.encodeState(R.initialState()),
        result: null, drawOfferBy: null, rematchVotes: null, clock,
      });
    } else {
      engine.roomRef.child("rematchVotes").set(votes);
    }
  }

  // ------------------------- годинник: падіння прапорця -------------------------
  // Раз на секунду будь-який підключений клієнт (обидва гравці й глядачі)
  // рахує, скільки лишилось стороні, чия зараз черга ходити. Хто перший
  // застав час <=0, той через transaction() (compare-and-swap на phase)
  // закриває партію — так навіть якщо кілька клієнтів "помітять" це
  // одночасно, запис піде рівно один раз.
  function startClockTicker() {
    stopClockTicker();
    clockTimer = setInterval(checkFlagFall, 1000);
  }
  function stopClockTicker() {
    if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
  }
  function checkFlagFall() {
    const room = engine.latestRoom;
    if (!room || room.phase !== "playing" || !room.clock) return;
    const tc = room.timeControl;
    if (!tc || tc.type !== "clock") return;
    if (!room.state) return;
    const turn = R.decodeState(room.state).turn;
    const elapsedSec = (engine.now() - room.clock.turnStartedAt) / 1000;
    const remaining = room.clock[turn] - elapsedSec;
    if (remaining > 0) return;
    engine.roomRef.child("phase").transaction((cur) => (cur === "playing" ? "ended" : undefined))
      .then((res) => {
        if (res && res.committed && res.snapshot.val() === "ended") {
          engine.roomRef.update({ result: { status: "timeout", winner: R.otherColor(turn), reason: "timeout" } });
        }
      });
  }
  // Живе відображення годинника для UI (без запису в RTDB — рахуємо локально
  // між тіками room-update, щоб секунди не "стрибали" лише раз на server push).
  function liveClockSeconds(room) {
    if (!room || !room.clock) return null;
    const tc = room.timeControl;
    if (!tc || tc.type !== "clock") return null;
    const state = room.state ? R.decodeState(room.state) : null;
    const turn = state ? state.turn : "w";
    const elapsedSec = room.phase === "playing" ? Math.max(0, (engine.now() - room.clock.turnStartedAt) / 1000) : 0;
    return {
      w: Math.max(0, room.clock.w - (turn === "w" ? elapsedSec : 0)),
      b: Math.max(0, room.clock.b - (turn === "b" ? elapsedSec : 0)),
    };
  }

  window.ChessGame = {
    connectedNames,
    computeHost: (players) => engine.computeHost(players),
    isConnected: (p) => engine.isConnected(p),
    watchActiveRooms,
    start, stop,
    claimColor, releaseColor,
    startGame, makeMove, resign,
    offerDraw, acceptDraw, declineDraw, voteRematch,
    liveClockSeconds,
    now: () => engine.now(),
    get roomId() { return engine.currentRoomId; },
    set onStateChange(fn) { onStateChange = fn; },
  };
})();