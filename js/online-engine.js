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

    const ABANDON_MS = opts.abandonMs != null ? opts.abandonMs : 15 * 60 * 1000;

    let serverOffset = 0;
    if (window.rtdb) {
      window.rtdb.ref(".info/serverTimeOffset").on("value", (snap) => { serverOffset = snap.val() || 0; });
    }
    function now() { return Date.now() + serverOffset; }

    let username = null;
    // Унікальний ідентифікатор САМЕ ЦІЄЇ вкладки/сесії рушія — не плутати з
    // username. Раніше хост визначався порівнянням room.hostUsername===username:
    // якщо той самий гравець відкритий у двох вкладках (стара після reload ще
    // жива + нова), ОБИДВІ бачать збіг і ОБИДВІ локально стають хостом, після
    // чого незалежно одна від одної пишуть room.phase — звідси гонка запису.
    // Порівняння тепер іде по mySessionId, унікальному на кожен createEngine().
    const mySessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    let lobbyRef = null, myLobbyRef = null;
    let roomRef = null, myPlayerRef = null, isActivePlayer = false;
    let currentRoomId = null;
    let heartbeatTimer = null, hostWatchTimer = null;
    let isHost = false;
    let listeners = { lobby: null, invite: null, room: null };
    let onStateChange = () => {};
    let onBecomeHost = () => {};
    let onLoseHost = () => {};
    let latestRoom = null;

    // ------------------------- screen wake lock -------------------------
    // Тримаємо екран хоста увімкненим, поки він веде гру: на Android
    // автоблокування посеред партії (мафія й т.п.) зупиняє тік хоста —
    // рафтимери/фази перестають рухатись, доки хтось не розблокує телефон,
    // через що можуть "згубитись" стейти. Screen Wake Lock не заміняє
    // ручне блокування кнопкою живлення, але прибирає автотаймаут.
    // Непідтримувані браузери (iOS Safari < 16.4 тощо) просто ігнорують —
    // немає window.navigator.wakeLock, requestWakeLock() одразу виходить.
    let wakeLock = null;
    async function requestWakeLock() {
      if (!("wakeLock" in navigator) || wakeLock) return;
      try {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => { wakeLock = null; });
      } catch (e) {
        // дозвіл відхилено, сторінка неактивна тощо — не критично
      }
    }
    function releaseWakeLock() {
      if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    }
    // Wake lock автоматично звільняється браузером, коли вкладка йде у
    // фон (напр. переключення на іншу апку) — при поверненні перезапитуємо,
    // якщо ми й досі хост.
    document.addEventListener("visibilitychange", () => {
      if (isHost && document.visibilityState === "visible") requestWakeLock();
    });

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
        const t = now();
        if (myLobbyRef) myLobbyRef.child("lastSeen").set(t);
        if (currentRoomId && myPlayerRef && roomRef && isActivePlayer) {
          myPlayerRef.update({ lastSeen: t, status: "active" });
          roomRef.child("lastActivityAt").set(t);
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
      const players = room.players || {};
      if (Object.values(players).some(isConnected)) return false;
      const lastSeens = Object.values(players).map((p) => p.lastSeen || 0);
      const mostRecentPlayer = lastSeens.length ? Math.max.apply(null, lastSeens) : 0;
      const last = Math.max(room.lastActivityAt || 0, room.createdAt || 0, mostRecentPlayer);
      if (!last) return true;
      return now() - last > ABANDON_MS;
    }

    // ------------------------- отримати або створити кімнату -------------------------
    // schema     — RoomSchema (значення за замовчуванням для верхніх полів)
    // buildFresh — () => ({ ...ігрові поля для НОВОЇ кімнати, players: {...} })
    // Повертає { room, roomId, recreated, repaired }.
    // ВАЖЛИВО: ніде тут не викликаємо ref.remove() окремо перед ref.set() —
    // set() і так атомарно замінює ВЕСЬ вузол цілком (ніякого попереднього
    // remove() не потрібно). Якщо зробити remove()+set() як два окремі
    // записи, між ними на мить існує null-знімок кімнати — і listener кожного
    // ІНШОГО підключеного клієнта (roomRef.on("value")) отримує цей null,
    // трактує його як "кімнати більше нема" і сам себе відписує через
    // leaveRoomLocally(). У результаті всі, крім того, хто ініціював
    // скидання (він одразу переприєднується сам), лишаються без активного
    // listener'а — і бачать "заморожену" сторінку, поки не оновлять вручну.
    async function getOrCreateRoom(roomId, schema, buildFresh) {
      const ref = window.rtdb.ref(`${ROOMS_PATH}/${roomId}`);
      const snap = await ref.get();
      let room = snap.exists() ? snap.val() : null;

      if (!room || isRoomStale(room)) {
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
    // Той самий принцип, що й вище: жодного remove() перед set() — інакше
    // ВСІ інші підключені клієнти на мить бачать null і відписуються.
    function forceResetRoom(roomId, schema, buildFresh) {
      const ref = window.rtdb.ref(`${ROOMS_PATH}/${roomId}`);
      const room = { ...schema, ...buildFresh(), createdAt: now(), lastActivityAt: now() };
      return ref.set(room).then(() => ({ room, roomId, recreated: true, repaired: false }));
    }

    // ------------------------- приєднання до кімнати -------------------------
    function createRoom(roomId, schema, buildFresh, players) {
      return getOrCreateRoom(roomId, schema, () => ({
        ...buildFresh(),
        hostUsername: username,
        hostSessionId: mySessionId, // без цього творець кімнати ніколи б не пройшов гілку !hostStale в maybeElectHostWithLock
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
      const playerRef = myPlayerRef;
      if (!playerRef) return Promise.resolve();
      isActivePlayer = true;
      return playerRef.get().then((snap) => {
        if (playerRef !== myPlayerRef) return;
        if (!snap.exists()) {
          return playerRef.set({ joinedAt: now(), lastSeen: now(), status: "active", ...onEmptyPlayer(), ...extra });
        }
        const val = snap.val() || {};
        const patch = extra || {};
        const extraChanged = Object.keys(patch).some((key) => val[key] !== patch[key]);
        if (val.status === "active" && !extraChanged) return;
        return playerRef.update({ lastSeen: now(), status: "active", ...patch });
      }).then(() => {
        if (playerRef !== myPlayerRef) return;
        return playerRef.onDisconnect().update(onDisconnectPlayerPatch);
      });
    }

    function leaveRoomLocally(preservePresence) {
      if (hostWatchTimer) { clearInterval(hostWatchTimer); hostWatchTimer = null; }
      if (roomRef && listeners.room) roomRef.off("value", listeners.room);
      if (myPlayerRef && !preservePresence) myPlayerRef.onDisconnect().cancel();
      if (isHost) { isHost = false; releaseWakeLock(); onLoseHost(); }
      currentRoomId = null; roomRef = null; myPlayerRef = null; isActivePlayer = false; latestRoom = null;
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
        // Порівняння по mySessionId, а НЕ по username — щоб дві вкладки
        // одного й того ж гравця (стара незакрита + нова після reload)
        // не вважали хостом себе ОБИДВІ одночасно.
        if (room.hostSessionId === mySessionId && !isHost) { isHost = true; requestWakeLock(); onBecomeHost(roomId); }
        if (room.hostSessionId !== mySessionId && isHost) { isHost = false; releaseWakeLock(); onLoseHost(); }
        return;
      }
      const alive = Object.entries(players).filter(([, p]) => isConnected(p))
        .sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
      if (alive.length && alive[0][0] === username) {
        // ВАЖЛИВО: RTDB не зберігає null (запис null == видалення шляху), тож
        // для шляху, який ще ЖОДНОГО разу не записувався, transaction() дає
        // current === null, а room.hostSessionId (звичайне звернення до
        // відсутньої властивості JS-об'єкта) === undefined. Пряме "current
        // === room.hostSessionId" через це порівняння null !== undefined
        // ЗАВЖДИ хибне для першого обрання хоста в кімнаті — CAS ніколи не
        // комітився, і хоста не обирав ніхто. Нормалізуємо обидві сторони
        // до null перед порівнянням.
        window.rtdb.ref(`${ROOMS_PATH}/${roomId}/hostSessionId`).transaction((current) => {
          const expected = room.hostSessionId == null ? null : room.hostSessionId;
          if ((current == null ? null : current) === expected) return mySessionId; // compare-and-swap
          return;
        }).then((result) => {
          // ВАЖЛИВО: transaction() резолвиться навіть коли CAS ПРОГРАНА
          // (result.committed === false) — .then() спрацьовує в обох
          // випадках. Раніше тут isHost виставлявся безумовно, тож той, хто
          // програв гонку за хоста, все одно локально вважав себе хостом.
          // Тепер isHost=true лише якщо реально записане значення — наше.
          if (!result || !result.committed || result.snapshot.val() !== mySessionId) return;
          window.rtdb.ref(`${ROOMS_PATH}/${roomId}/hostUsername`).set(username); // для решти ігор/UI, які читають лише hostUsername
          if (!isHost) { isHost = true; requestWakeLock(); onBecomeHost(roomId); }
        });
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