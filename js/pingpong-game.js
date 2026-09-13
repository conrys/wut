// ==========================================================================
// Пінг-понг — перша "неперервна" (не покрокова) гра серії. Побудована за
// двома запозиченими патернами:
//   - мультикімнатність і матчмейкінг — за зразком mafia-game.js
//     (useLobby:false + довільний roomId замість SHARED_ROOM_ID,
//     watchActiveRooms() для списку живих столів)
//   - місця/заміна бота гравцем — за зразком poker-game.js (транзакція на
//     seats), тільки капнуто на рівно 2 місця
//
// МЕРЕЖЕВА МОДЕЛЬ (найважливіше, що тут нового)
// -----------------------------------------------------------------------
// Це перша гра серії з неперервною фізикою, а не покроковими діями. RTDB не
// розрахована на запис 60 разів/сек, тому:
//   - ХОСТ (lockedHost) рахує м'яч ЛОКАЛЬНО через requestAnimationFrame на
//     повній частоті кадрів, але пише в Firebase лише раз на ~60мс (~16/сек):
//     позицію+швидкість м'яча, обидві ракетки, рахунок.
//   - ГІСТЬ (не-хост) пише в Firebase ТІЛЬКИ свою ракетку, з тією ж
//     частотою — не чіпає м'яч і рахунок узагалі, це монопольна зона хоста.
//   - Обидва клієнти на РЕНДЕРІ роблять "мертве рахування" м'яча між
//     пакетами (просувають позицію по останній відомій швидкості, а не
//     чекають наступного пакету) — інакше рух виглядатиме сіпаним при ~16Гц.
//   - Бот — це просто ракетка, яку рахує хост локально (стежить за м'ячем
//     із затримкою реакції, не миттєво).
// ==========================================================================
(function () {
  const GAME_KEY = "pingpong";
  const FIELD_W = 300, FIELD_H = 500;
  const PADDLE_W = 64, PADDLE_H = 10, BALL_R = 6;
  const BALL_SPEED_INITIAL = 220, BALL_SPEED_MAX = 560, SPIN_FACTOR = 80, HIT_SPEEDUP = 1.04;
  const WINNING_SCORE = 7;
  const SYNC_MS = 60;               // throttle мережевих записів (~16/сек)
  const POINT_PAUSE_MS = 1400;
  const BOT_REACTION_MS = 180;
  const BOT_MAX_SPEED = 230;
  const BOT_ERROR_PX = 18;

  const ROOM_SCHEMA = {
    hostUsername: null,
    seats: {},
    ball: { x: FIELD_W / 2, y: FIELD_H / 2, vx: 0, vy: 0 },
    paddles: { "0": FIELD_W / 2, "1": FIELD_W / 2 },
    matchState: "point_scored", // point_scored (чекає подачі) | playing | game_over
    serveTo: "0",
    winner: null,
    pointAt: 0,
    players: {},
  };

  const Engine = window.OnlineEngine.create(GAME_KEY, {
    lockedHost: true,
    onEmptyPlayer: () => ({}),
  });

  let username = null;
  let onStateChange = () => {};
  let rafId = null;
  let lastSyncAt = 0;
  let lastFrameAt = null;
  let botTargetX = FIELD_W / 2;
  let lastBotThinkAt = 0;
  let localPaddleX = FIELD_W / 2;      // моя власна ракетка (миттєвий локальний інпут)
  let lastGuestSyncAt = 0;

  function seatKeysSorted(seats) { return Object.keys(seats || {}).sort((a, b) => Number(a) - Number(b)); }
  function isHost(state) { return !!(state && username && state.hostUsername === username); }
  function mySeatOf(state) {
    if (!state || !state.seats) return null;
    return seatKeysSorted(state.seats).find((k) => state.seats[k].occupantType === "human" && state.seats[k].username === username) || null;
  }

  // ------------------------- місця (за зразком покеру, капнуто на 2) -------------------------
  function claimSeat(who) {
    return Engine.roomRef.child("seats").transaction((seats) => {
      if (seats === null || seats === undefined) {
        return {
          "0": { occupantType: "human", username: who, score: 0 },
          "1": { occupantType: "bot", botId: "bot_1", score: 0 },
        };
      }
      for (const key in seats) {
        if (seats[key].occupantType === "human" && seats[key].username === who) return seats;
      }
      const botKey = Object.keys(seats).find((k) => seats[k].occupantType === "bot");
      if (botKey) {
        const next = Object.assign({}, seats);
        next[botKey] = { occupantType: "human", username: who, score: seats[botKey].score || 0 };
        return next;
      }
      return; // обидва місця вже людські — це не наша кімната, матчмейкінг мав відсіяти її заздалегідь
    });
  }

  // ------------------------- матчмейкінг (за зразком mafia-game.js) -------------------------
  function generateRoomId() {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
  }

  function watchActiveRooms(callback) {
    if (!window.rtdb) { callback([]); return () => {}; }
    const ref = window.rtdb.ref(`${GAME_KEY}_rooms`);
    const onValue = (snap) => {
      const rooms = snap.val() || {};
      const t = Date.now();
      const list = Object.entries(rooms).map(([roomId, room]) => {
        const seats = room.seats || {};
        const players = room.players || {};
        const connected = Object.entries(players).filter(([, p]) => Engine.isConnected(p));
        const lastSeens = Object.values(players).map((p) => p.lastSeen || 0);
        const mostRecentPlayer = lastSeens.length ? Math.max(...lastSeens) : 0;
        const lastActivity = Math.max(room.lastActivityAt || 0, mostRecentPlayer);
        const stale = !connected.length && (!lastActivity || t - lastActivity > 3 * 60 * 1000);
        const hasOpenBotSeat = Object.values(seats).some((s) => s.occupantType === "bot");
        return { roomId, connectedCount: connected.length, hasOpenBotSeat, stale };
      }).filter((r) => !r.stale)
        .sort((a, b) => b.connectedCount - a.connectedCount);
      callback(list);
    };
    ref.on("value", onValue);
    return () => ref.off("value", onValue);
  }

  // одноразовий підбір кімнати для швидкого старту: перша активна кімната
  // з вільним місцем бота, інакше — нова кімната з випадковим кодом
  function findRoomForQuickJoin() {
    if (!window.rtdb) return Promise.resolve(generateRoomId());
    return window.rtdb.ref(`${GAME_KEY}_rooms`).once("value").then((snap) => {
      const rooms = snap.val() || {};
      const t = Date.now();
      for (const [roomId, room] of Object.entries(rooms)) {
        const seats = room.seats || {};
        const players = room.players || {};
        const connected = Object.values(players).filter((p) => Engine.isConnected(p));
        const lastSeens = Object.values(players).map((p) => p.lastSeen || 0);
        const lastActivity = Math.max(room.lastActivityAt || 0, lastSeens.length ? Math.max(...lastSeens) : 0);
        const stale = !connected.length && (!lastActivity || t - lastActivity > 3 * 60 * 1000);
        const hasOpenBotSeat = Object.values(seats).some((s) => s.occupantType === "bot");
        if (!stale && hasOpenBotSeat) return roomId;
      }
      return generateRoomId();
    });
  }

  // ------------------------- фізика (чиста функція, легко тестувати) -------------------------
  function stepBall(ball, paddles, dt) {
    let { x, y, vx, vy } = ball;
    x += vx * dt; y += vy * dt;
    let scoredBy = null;

    if (x - BALL_R < 0) { x = BALL_R; vx = -vx; }
    if (x + BALL_R > FIELD_W) { x = FIELD_W - BALL_R; vx = -vx; }

    if (vy < 0 && y - BALL_R <= PADDLE_H) {
      const p = paddles["0"];
      if (Math.abs(x - p) <= PADDLE_W / 2 + BALL_R) {
        y = PADDLE_H + BALL_R;
        vy = -vy * HIT_SPEEDUP;
        const offset = Math.max(-1, Math.min(1, (x - p) / (PADDLE_W / 2)));
        vx += offset * SPIN_FACTOR;
      } else if (y - BALL_R <= 0) {
        scoredBy = "1";
      }
    }
    if (vy > 0 && y + BALL_R >= FIELD_H - PADDLE_H) {
      const p = paddles["1"];
      if (Math.abs(x - p) <= PADDLE_W / 2 + BALL_R) {
        y = FIELD_H - PADDLE_H - BALL_R;
        vy = -vy * HIT_SPEEDUP;
        const offset = Math.max(-1, Math.min(1, (x - p) / (PADDLE_W / 2)));
        vx += offset * SPIN_FACTOR;
      } else if (y + BALL_R >= FIELD_H) {
        scoredBy = "0";
      }
    }
    const speed = Math.hypot(vx, vy);
    if (speed > BALL_SPEED_MAX) { const k = BALL_SPEED_MAX / speed; vx *= k; vy *= k; }
    return { ball: { x, y, vx, vy }, scoredBy };
  }

  function serveBall(towardSeat) {
    const angle = (Math.random() * 0.7 - 0.35); // невеликий розкид від вертикалі
    const dir = towardSeat === "0" ? -1 : 1; // подача атакує ту сторону, що програла останній розіграш
    return {
      x: FIELD_W / 2, y: FIELD_H / 2,
      vx: BALL_SPEED_INITIAL * Math.sin(angle),
      vy: dir * BALL_SPEED_INITIAL * Math.cos(angle),
    };
  }

  // ------------------------- бот -------------------------
  function updateBotPaddle(state, seatKey, dt, now) {
    if (now - lastBotThinkAt > BOT_REACTION_MS) {
      lastBotThinkAt = now;
      const ball = state.ball;
      const movingToward = (seatKey === "0" && ball.vy < 0) || (seatKey === "1" && ball.vy > 0);
      botTargetX = movingToward
        ? Math.max(PADDLE_W / 2, Math.min(FIELD_W - PADDLE_W / 2, ball.x + (Math.random() * 2 - 1) * BOT_ERROR_PX))
        : FIELD_W / 2;
    }
    const cur = state.paddles[seatKey];
    const delta = botTargetX - cur;
    const maxStep = BOT_MAX_SPEED * dt;
    const next = Math.abs(delta) <= maxStep ? botTargetX : cur + Math.sign(delta) * maxStep;
    return Math.max(PADDLE_W / 2, Math.min(FIELD_W - PADDLE_W / 2, next));
  }

  // ------------------------- головний цикл хоста -------------------------
  function hostFrame(state, now) {
    const dt = lastFrameAt ? Math.min((now - lastFrameAt) / 1000, 0.033) : 0;
    lastFrameAt = now;

    const mySeat = mySeatOf(state);
    const otherSeat = mySeat === "0" ? "1" : "0";
    const paddles = Object.assign({}, state.paddles);

    if (mySeat) paddles[mySeat] = localPaddleX;
    const otherSeatInfo = state.seats[otherSeat];
    if (otherSeatInfo && otherSeatInfo.occupantType === "bot") {
      paddles[otherSeat] = updateBotPaddle(Object.assign({}, state, { paddles }), otherSeat, dt, now);
    }
    // якщо otherSeat — гість-людина, його ракетку хост НЕ рахує: бере те, що
    // вже прийшло від гостя останнім оновленням стану (paddles[otherSeat] з RTDB)

    let ball = state.ball;
    let matchState = state.matchState;
    let winner = state.winner;
    let seats = state.seats;
    let scoreChanged = false;
    let serveTo = state.serveTo;
    let pointAt = state.pointAt;

    if (matchState === "point_scored") {
      if (now - (pointAt || 0) >= POINT_PAUSE_MS) {
        ball = serveBall(serveTo);
        matchState = "playing";
      }
    } else if (matchState === "playing" && dt > 0) {
      const result = stepBall(ball, paddles, dt);
      ball = result.ball;
      if (result.scoredBy) {
        seats = JSON.parse(JSON.stringify(seats));
        seats[result.scoredBy].score = (seats[result.scoredBy].score || 0) + 1;
        scoreChanged = true;
        if (seats[result.scoredBy].score >= WINNING_SCORE) {
          matchState = "game_over";
          winner = result.scoredBy;
        } else {
          matchState = "point_scored";
          pointAt = now;
          serveTo = result.scoredBy === "0" ? "1" : "0";
        }
      }
    }

    if (now - lastSyncAt >= SYNC_MS) {
      lastSyncAt = now;
      const updates = { ball, paddles, matchState, serveTo, winner, pointAt };
      // seats пишемо лише коли реально змінили рахунок цим тіком — інакше
      // ризикуємо на наступному ж такті затерти свіжу claimSeat-транзакцію
      // (хтось саме заміняв бота на людину) застарілим знімком
      if (scoreChanged) updates.seats = seats;
      Engine.roomRef.update(updates);
    }
  }

  function hostLoop() {
    rafId = requestAnimationFrame(() => {
      if (latestRoomForHost) hostFrame(latestRoomForHost, Date.now());
      hostLoop();
    });
  }

  let latestRoomForHost = null;

  // ------------------------- гість: шле лише свою ракетку -------------------------
  function guestMaybeSync(state) {
    const mySeat = mySeatOf(state);
    if (!mySeat || isHost(state)) return;
    const now = Date.now();
    if (now - lastGuestSyncAt < SYNC_MS) return;
    lastGuestSyncAt = now;
    Engine.roomRef.child("paddles/" + mySeat).set(localPaddleX);
  }

  // ------------------------- вхідна точка гравця: керування ракеткою -------------------------
  function setMyPaddleX(x) {
    localPaddleX = Math.max(PADDLE_W / 2, Math.min(FIELD_W - PADDLE_W / 2, x));
  }

  // ------------------------- приєднання -------------------------
  function start(user, roomId) {
    username = user;
    Engine.start(user, { useLobby: false });

    Engine.onBecomeHost = () => {
      lastFrameAt = null;
      if (!rafId) hostLoop();
    };
    Engine.onLoseHost = () => {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      latestRoomForHost = null;
    };

    Engine.onStateChange = (type, data) => {
      if (type !== "room-update") return;
      const state = data.room;
      latestRoomForHost = isHost(state) ? state : null;
      guestMaybeSync(state);
      onStateChange(state, { username, isHost: isHost(state), roomId: Engine.currentRoomId });
    };

    return Engine.getOrCreateRoom(roomId, ROOM_SCHEMA, () => ({})).then(() => {
      return Engine.joinRoom(roomId, { asPlayer: true }).then(() => claimSeat(username));
    });
  }

  function quickJoin(user) {
    return findRoomForQuickJoin().then((roomId) => start(user, roomId));
  }

  function stop() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    latestRoomForHost = null;
    Engine.stop();
  }

  function resetMatch(state) {
    if (!isHost(state)) return Promise.resolve();
    const keptSeats = {};
    Object.keys(state.seats).forEach((k) => {
      keptSeats[k] = Object.assign({}, state.seats[k], { score: 0 });
    });
    return Engine.roomRef.update({
      seats: keptSeats,
      ball: { x: FIELD_W / 2, y: FIELD_H / 2, vx: 0, vy: 0 },
      paddles: { "0": FIELD_W / 2, "1": FIELD_W / 2 },
      matchState: "point_scored",
      serveTo: "0",
      winner: null,
      pointAt: Date.now(),
    });
  }

  window.PingPongGame = {
    FIELD_W, FIELD_H, PADDLE_W, PADDLE_H, BALL_R, WINNING_SCORE,
    start, quickJoin, stop, setMyPaddleX, resetMatch,
    watchActiveRooms, generateRoomId,
    mySeatOf,
    get roomId() { return Engine.currentRoomId; },
    set onStateChange(fn) { onStateChange = fn; },
  };
})();
