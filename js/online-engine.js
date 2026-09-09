// ==========================================================================
// online-engine.js — спільний мультиплеєр-рушій поверх Firebase RTDB.
// Мета: та сама універсальність, що й у AppScore.sendScore(gameName, score) —
// одна гра підключає рушій, описує СХЕМУ своєї кімнати, і далі просто
// викликає getOrCreateRoom/startGame/pauseGame/... без ручного керування
// структурою документа.
//
// Підключати ПІСЛЯ firebase-config.js (window.rtdb) і login.js.
//
// ---------------------------------------------------------------------
// СХЕМА КІМНАТИ (RoomSchema)
// ---------------------------------------------------------------------
// Плоский об'єкт значень-за-замовчуванням для ВСІХ полів верхнього рівня,
// які повинен мати документ кімнати. Приклад для Змійки:
//   { phase: "lobby", hostUsername: null, food: null, players: {} }
// "players" — завжди спеціальне поле, керується самим рушієм окремо
// (presence/heartbeat/host), у схему включається лише як маркер, що воно
// має існувати.
//
// ---------------------------------------------------------------------
// ФАЗИ ГРИ (спільні для всіх ігор, поле room.phase)
// ---------------------------------------------------------------------
//   lobby → playing → paused → playing (resume) → ended
// Engine сам не вирішує, ЩО означає "playing" для конкретної гри — тільки
// пише фазу + timestamp переходу. Гра сама реагує на зміну phase у своєму
// onStateChange.
//
// ---------------------------------------------------------------------
// АВТООЧИЩЕННЯ СТАРИХ КІМНАТ
// ---------------------------------------------------------------------
// Кожна кімната має room.lastActivityAt, який оновлюється: (а) при кожному
// heartbeat будь-якого гравця в кімнаті, (б) при будь-якому setPhase().
// getOrCreateRoom() перед видачею кімнати сам перевіряє: якщо
// now() - lastActivityAt > ABANDON_MS (15 хв) — стара кімната видаляється
// і на її місці одразу створюється нова, чиста, за схемою.
//
// ---------------------------------------------------------------------
// ВАЛІДАЦІЯ ФОРМИ КІМНАТИ
// ---------------------------------------------------------------------
// Якщо документ існує, не застарів, але йому бракує якихось полів зі схеми
// (наприклад, гру доповнили новим полем already-in-production) —
// getOrCreateRoom() домальовує відсутні поля значеннями за замовчуванням
// одним update(), замість падіння чи розсипання гри.
// ==========================================================================
(function () {
  const HEARTBEAT_MS = 2000;
  const PRESENCE_TIMEOUT_MS = 5000;
  const ABANDON_MS = 15 * 60 * 1000;
  const SHARED_ROOM_ID = "shared";
  const PHASES = ["lobby", "playing", "paused", "ended"];

  function createEngine(gameKey, opts) {
    opts = opts || {};
    const LOBBY_PATH = `${gameKey}_lobby`;
    const ROOMS_PATH = `${gameKey}_rooms`;
    const onEmptyPlayer = opts.onEmptyPlayer || (() => ({}));
    const onDisconnectPlayerPatch = opts.onDisconnectPlayerPatch || { lastSeen: 0, status: "inactive" };

    let serverOffset = 0;
    if (window.rtdb) {
      window.rtdb.ref(".info/serverTimeOffset").on("value", (snap) => { serverOffset = snap.val() || 0; });
    }
    function now() { return Date.now() + serverOffset; }

    let username = null;
    let lobbyRef = null, myLobbyRef = null;
    let roomRef = null, myPlayerRef = null;
    let currentRoomId = null;
    let heartbeatTimer = null, hostWatchTimer = null;
    let isHost = false;
    let listeners = { lobby: null, invite: null, room: null };
    let onStateChange = () => {};
    let onBecomeHost = () => {};
    let onLoseHost = () => {};
    let latestRoom = null;

    // ------------------------- presence -------------------------
    // start(user, { useLobby }) — heartbeat ЗАВЖДИ активний, незалежно від
    // того, чи гра взагалі має "лобі поза кімнатою". useLobby:false — для
    // ігор з ОДНІЄЮ спільною кімнатою без запрошень (Шпигун): гравець одразу
    // йде в joinRoom(SHARED_ROOM_ID), лобі-шар (запрошення, "solo"-статус)
    // просто не піднімається.
    function start(user, options) {
      options = options || {};
      username = user;

      if (options.useLobby !== false) {
        lobbyRef = window.rtdb.ref(LOBBY_PATH);
        myLobbyRef = lobbyRef.child(username);
        myLobbyRef.onDisconnect().remove();
        touchLobby("solo", null);

        listeners.lobby = lobbyRef.on("value", (snap) => {
          const all = snap.val() || {};
          const active = Object.entries(all).filter(
            ([name, v]) => name !== username && v.lastSeen && now() - v.lastSeen < PRESENCE_TIMEOUT_MS
          );
          onStateChange("lobby-update", { active });
        });

        listeners.invite = myLobbyRef.child("roomId").on("value", (snap) => {
          const roomId = snap.val();
          if (roomId && roomId !== currentRoomId) joinRoom(roomId);
          else if (!roomId && currentRoomId) leaveRoomLocally();
        });
      }

      heartbeatTimer = setInterval(() => {
        if (myLobbyRef) myLobbyRef.child("lastSeen").set(now());
        if (currentRoomId && myPlayerRef) {
          myPlayerRef.child("lastSeen").set(now());
          myPlayerRef.child("status").set("active");
          roomRef.child("lastActivityAt").set(now());
        }
      }, HEARTBEAT_MS);
    }
    const startPresence = start; // сумісна назва для room-based ігор (Змійка)

    function touchLobby(status, roomId) {
      if (myLobbyRef) myLobbyRef.set({ status, roomId: roomId || null, lastSeen: now() });
    }

    function stop(options) {
      options = options || {};
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (hostWatchTimer) clearInterval(hostWatchTimer);
      if (lobbyRef && listeners.lobby) lobbyRef.off("value", listeners.lobby);
      if (myLobbyRef && listeners.invite) myLobbyRef.child("roomId").off("value", listeners.invite);
      if (myLobbyRef) { myLobbyRef.onDisconnect().cancel(); myLobbyRef.remove(); }
      leaveRoomLocally(options.preserveRoomPresence === true);
    }
    const stopPresence = stop; // сумісна назва для room-based ігор (Змійка)

    // ------------------------- валідація форми кімнати -------------------------
    function validateRoomShape(room, schema) {
      const missing = Object.keys(schema).filter((k) => room[k] === undefined);
      return { valid: missing.length === 0, missing };
    }

    function isRoomStale(room) {
      const last = room.lastActivityAt || room.createdAt || 0;
      return now() - last > ABANDON_MS;
    }

    // ------------------------- отримати або створити кімнату -------------------------
    // schema     — RoomSchema (значення за замовчуванням для верхніх полів)
    // buildFresh — () => ({ ...ігрові поля для НОВОЇ кімнати, players: {...} })
    // Повертає { room, roomId, recreated, repaired }.
    async function getOrCreateRoom(roomId, schema, buildFresh) {
      const ref = window.rtdb.ref(`${ROOMS_PATH}/${roomId}`);
      const snap = await ref.get();
      let room = snap.exists() ? snap.val() : null;

      if (room && isRoomStale(room)) {
        await ref.remove();
        room = null;
      }

      if (!room) {
        room = { ...schema, ...buildFresh(), createdAt: now(), lastActivityAt: now() };
        await ref.set(room);
        return { room, roomId, recreated: true, repaired: false };
      }

      const { valid, missing } = validateRoomShape(room, schema);
      if (!valid) {
        const patch = {};
        missing.forEach((k) => { patch[k] = schema[k]; });
        await ref.update(patch);
        Object.assign(room, patch);
      }
      return { room, roomId, recreated: false, repaired: !valid };
    }

    // Примусово прибрати конкретну кімнату незалежно від віку (напр. кнопка
    // "скинути гру" в UI хоста).
    function forceResetRoom(roomId, schema, buildFresh) {
      return window.rtdb.ref(`${ROOMS_PATH}/${roomId}`).remove()
        .then(() => getOrCreateRoom(roomId, schema, buildFresh));
    }

    // ------------------------- приєднання до кімнати -------------------------
    function createRoom(roomId, schema, buildFresh, players) {
      return getOrCreateRoom(roomId, schema, () => ({
        ...buildFresh(),
        hostUsername: username,
        players: Object.fromEntries(
          Object.entries(players || {}).map(([name, extra], i) => [
            name,
            { joinedAt: now() + i, lastSeen: now(), ...onEmptyPlayer(), ...extra },
          ])
        ),
      })).then((result) => {
        Object.keys(players || {}).forEach((name) => {
          if (name !== username) window.rtdb.ref(`${LOBBY_PATH}/${name}`).update({ status: "in-room", roomId });
        });
        return joinRoom(roomId).then(() => result);
      });
    }

    // asPlayer:false — приєднатись лише як спостерігач (підписка на стан,
    // без запису себе в players/) — для ігор, де заходити ГРАВЦЕМ посеред
    // активного раунду не можна (Шпигун, Quiplash), але дивитись на екран
    // і чекати наступного кола — можна. Викликай becomePlayer() пізніше,
    // коли гра дозволить (напр. коли room.phase знову стане "lobby").
    function joinRoom(roomId, joinOpts) {
      const asPlayer = !joinOpts || joinOpts.asPlayer !== false;
      if (currentRoomId === roomId) return asPlayer ? becomePlayer(joinOpts && joinOpts.extra) : Promise.resolve();
      leaveRoomLocally();
      currentRoomId = roomId;
      roomRef = window.rtdb.ref(`${ROOMS_PATH}/${roomId}`);
      myPlayerRef = roomRef.child("players/" + username);

      listeners.room = roomRef.on("value", (snap2) => {
        const room = snap2.val();
        if (!room) { leaveRoomLocally(); return; }
        latestRoom = room;
        onStateChange("room-update", { room, roomId });
        if (opts.lockedHost) maybeElectHostWithLock(room, roomId);
      });
      touchLobby("in-room", roomId);
      if (opts.lockedHost) startHostWatch();

      return asPlayer ? becomePlayer(joinOpts && joinOpts.extra) : Promise.resolve();
    }

    // Додає себе в players/ поточної кімнати, якщо ще не доданий (ідемпотентно).
    // Викликається автоматично з joinRoom({asPlayer:true}) (дефолт), або
    // вручну пізніше — коли гра дозволить приєднатись гравцем, що прийшов
    // під час активного раунду як спостерігач.
    function becomePlayer(extra) {
      if (!myPlayerRef) return Promise.resolve();
      return myPlayerRef.get().then((snap) => {
        if (!snap.exists()) {
          return myPlayerRef.set({ joinedAt: now(), lastSeen: now(), status: "active", ...onEmptyPlayer(), ...extra });
        }
        if (snap.val().status === "active" && !extra) return;
        return myPlayerRef.update({ lastSeen: now(), status: "active", ...(extra || {}) });
      }).then(() => {
        myPlayerRef.onDisconnect().update(onDisconnectPlayerPatch);
      });
    }

    function leaveRoomLocally(preservePresence) {
      if (hostWatchTimer) { clearInterval(hostWatchTimer); hostWatchTimer = null; }
      if (roomRef && listeners.room) roomRef.off("value", listeners.room);
      if (myPlayerRef && !preservePresence) myPlayerRef.onDisconnect().cancel();
      if (isHost) { isHost = false; onLoseHost(); }
      currentRoomId = null; roomRef = null; myPlayerRef = null; latestRoom = null;
    }

    function leaveRoom() {
      if (currentRoomId && myPlayerRef) myPlayerRef.remove();
      leaveRoomLocally();
      touchLobby("solo", null);
    }

    // ------------------------- фази гри -------------------------
    // setPhase() — базовий примітив, приймає БУДЬ-ЯКУ назву фази: якщо гра
    // передала свій список у opts.phases (напр. Шпигун: ["lobby","active",
    // "reveal"]) — валідує проти нього; якщо opts.phases не передано —
    // дозволяє будь-який рядок без перевірки.
    // startGame/pauseGame/resumeGame/endGame — зручні обгортки НАД тим самим
    // примітивом для типового випадку lobby→playing→paused→ended; гра з
    // власними назвами фаз просто викликає setPhase("active", {...}) напряму
    // й обгортками може не користуватись.
    const allowedPhases = opts.phases || null;
    function setPhase(phase, extra) {
      if (!roomRef) return Promise.resolve();
      if (allowedPhases && allowedPhases.indexOf(phase) === -1) throw new Error("Невідома фаза: " + phase);
      return roomRef.update({ phase, lastActivityAt: now(), ...extra });
    }
    function startGame(extra) { return setPhase("playing", { startedAt: now(), ...extra }); }
    function pauseGame(extra) { return setPhase("paused", { pausedAt: now(), ...extra }); }
    function resumeGame(extra) { return setPhase("playing", { resumedAt: now(), ...extra }); }
    function endGame(extra) { return setPhase("ended", { endedAt: now(), ...extra }); }

    // ------------------------- host election -------------------------
    function isConnected(p) { return !!(p && p.lastSeen && now() - p.lastSeen < PRESENCE_TIMEOUT_MS); }
    function computeHost(players) {
      const conn = Object.entries(players || {}).filter(([, p]) => isConnected(p));
      if (!conn.length) return null;
      return conn.sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0))[0][0];
    }

    function startHostWatch() {
      if (hostWatchTimer) clearInterval(hostWatchTimer);
      hostWatchTimer = setInterval(() => {
        roomRef.once("value").then((snap) => { const room = snap.val(); if (room) maybeElectHostWithLock(room, currentRoomId); });
      }, 2000);
    }

    function maybeElectHostWithLock(room, roomId) {
      const players = room.players || {};
      const hostEntry = players[room.hostUsername];
      const hostStale = !hostEntry || !isConnected(hostEntry);
      if (!hostStale) {
        if (room.hostUsername === username && !isHost) { isHost = true; onBecomeHost(roomId); }
        if (room.hostUsername !== username && isHost) { isHost = false; onLoseHost(); }
        return;
      }
      const alive = Object.entries(players).filter(([, p]) => isConnected(p))
        .sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
      if (alive.length && alive[0][0] === username) {
        window.rtdb.ref(`${ROOMS_PATH}/${roomId}/hostUsername`).transaction((current) => {
          if (current === room.hostUsername) return username; // compare-and-swap
          return;
        }).then(() => { if (!isHost) { isHost = true; onBecomeHost(roomId); } });
      }
    }

    return {
      HEARTBEAT_MS, PRESENCE_TIMEOUT_MS, ABANDON_MS, SHARED_ROOM_ID, PHASES,
      now,
      start, stop, startPresence, stopPresence, touchLobby,
      validateRoomShape, getOrCreateRoom, forceResetRoom,
      createRoom, joinRoom, leaveRoom, becomePlayer,
      setPhase, startGame, pauseGame, resumeGame, endGame,
      computeHost, isConnected,
      get currentRoomId() { return currentRoomId; },
      get roomRef() { return roomRef; }, // пряме RTDB-посилання на кімнату — для гро-специфічних полів поза схемою
      get latestRoom() { return latestRoom; },
      get isHost() { return isHost; },
      set onStateChange(fn) { onStateChange = fn; },
      set onBecomeHost(fn) { onBecomeHost = fn; },
      set onLoseHost(fn) { onLoseHost = fn; },
    };
  }

  window.OnlineEngine = { create: createEngine, SHARED_ROOM_ID, HEARTBEAT_MS, PRESENCE_TIMEOUT_MS, ABANDON_MS, PHASES };
})();
