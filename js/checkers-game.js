// ==========================================================================
// checkers-game.js — онлайн-шашки на спільному OnlineEngine
// (js/online-engine.js) + чисте ядро правил js/checkers-rules.js.
// Структура — копія chess-game.js (той самий кімнатний протокол: рівно ДВА
// гравецькі слоти white/black, роль обирається вручну через claimColor).
//
// Підключати ПІСЛЯ firebase-config.js, login.js, online-engine.js,
// checkers-rules.js.
// ==========================================================================
(function () {
  const GAME_KEY = "checkers";
  const PHASES = ["lobby", "playing", "ended"];
  const ABANDON_MS_TIMED = 30 * 60 * 1000;
  const ABANDON_MS_UNTIMED = 3 * 24 * 60 * 60 * 1000;

  const R = window.CheckersRules;

  const SCHEMA = {
    phase: "lobby",
    hostUsername: null,
    white: null,
    black: null,
    state: null,
    result: null,
    drawOfferBy: null,
    rematchVotes: null,
    timeControl: null,
    clock: null,
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

  async function start(user, roomId, timeControl) {
    username = user;
    engine.onStateChange = handleEngineEvent;
    engine.start(username, { useLobby: false });
    await engine.getOrCreateRoom(roomId, SCHEMA, () => buildFreshRoom(timeControl));
    await engine.joinRoom(roomId, { asPlayer: false });
    engine.becomePlayer({});
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

  function claimColor(color) {
    const room = engine.latestRoom;
    if (!room || room.phase !== "lobby") return;
    if (room.white === username || room.black === username) return;
    const field = color === "w" ? "white" : "black";
    engine.roomRef.child(field).transaction((cur) => (cur ? undefined : username));
  }

  function releaseColor() {
    const room = engine.latestRoom;
    if (!room || room.phase !== "lobby") return;
    if (room.white === username) engine.roomRef.child("white").transaction((cur) => (cur === username ? null : undefined));
    else if (room.black === username) engine.roomRef.child("black").transaction((cur) => (cur === username ? null : undefined));
  }

  function startGame() {
    const room = engine.latestRoom;
    if (!room || !room.white || !room.black) return;
    const initial = R.encodeState(R.initialState());
    const tc = room.timeControl || { type: "none" };
    const clock = tc.type === "clock" ? { w: tc.initialSeconds, b: tc.initialSeconds, turnStartedAt: engine.now() } : null;
    engine.roomRef.update({ phase: "playing", state: initial, result: null, drawOfferBy: null, rematchVotes: null, clock });
  }

  // Хід. forcedFrom у стані сам пильнує, що при серії взять ходити можна
  // лише тією ж фігурою — makeMove() з ChessRules-подібного ядра поверне
  // null на будь-якому іншому ході.
  function makeMove(from, to) {
    const room = engine.latestRoom;
    if (!room || room.phase !== "playing" || !room.state) return false;
    const myColor = room.white === username ? "w" : room.black === username ? "b" : null;
    if (!myColor) return false;
    const state = R.decodeState(room.state);
    if (state.turn !== myColor) return false;
    const next = R.makeMove(state, { from, to });
    if (!next) return false;

    const status = R.gameStatus(next);
    const update = { state: R.encodeState(next), drawOfferBy: null };

    const tc = room.timeControl;
    if (tc && tc.type === "clock" && room.clock && next.turn !== state.turn) {
      const elapsedSec = Math.max(0, (engine.now() - room.clock.turnStartedAt) / 1000);
      const remaining = Math.max(0, room.clock[myColor] - elapsedSec) + (tc.incrementSeconds || 0);
      update.clock = Object.assign({}, room.clock, { [myColor]: remaining, turnStartedAt: engine.now() });
    }

    if (status.status === "no-moves") {
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

  window.CheckersGame = {
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