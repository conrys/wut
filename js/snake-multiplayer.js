// ==========================================================================
// Мультиплеєр-шар змійки поверх Firebase Realtime Database.
// Підключати ПІСЛЯ firebase-config.js (де вже піднятий window.rtdb) і login.js.
//
// Спрощення для MVP (свідомо):
// - Кімната не має "кінця раунду" — це спільна арена: помер гравець стає
//   спостерігачем і може натиснути "Приєднатись знову", арена не закривається.
// - Head-to-head та колізії з чужим тілом рахуються по позиціях ДО ходу цього
//   тіку — рідкісні прикордонні випадки (одночасний з'їзд у ту саму клітинку)
//   не є ідеальними, але для казуальної гри з друзями це не критично.
// ==========================================================================
(function () {
  const GRID = 22;
  const MAX_PLAYERS = 8;
  const TICK_MS = 160;
  const HEARTBEAT_MS = 2000;
  const PRESENCE_TIMEOUT_MS = 5000;
  const ROOM_ABANDON_MS = 15 * 60 * 1000; // кімната без жодної активності 15хв — видаляємо
  const COLORS = ["#38cfa0", "#e0b84c", "#ff6b6b", "#8fb8ff", "#c77dff", "#4dd0e1", "#ffb84d", "#a3e635"];
  const DIRS = {
    up: { dx: 0, dy: -1 },
    down: { dx: 0, dy: 1 },
    left: { dx: -1, dy: 0 },
    right: { dx: 1, dy: 0 },
  };
  const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };

  // now() використовує зсув годинника відносно сервера Firebase, а не
  // "сирий" Date.now() — інакше розсинхронізовані годинники різних
  // пристроїв (типово для емуляторів) ламають усі перевірки "свіжості"
  // presence/lastSeen між клієнтами.
  let serverOffset = 0;
  if (window.rtdb) {
    window.rtdb.ref(".info/serverTimeOffset").on("value", (snap) => {
      serverOffset = snap.val() || 0;
    });
  }
  function now() { return Date.now() + serverOffset; }
  function rnd(n) { return Math.floor(Math.random() * n); }

  let username = null;
  let lobbyRef, myLobbyRef, roomRef = null, myPlayerRef = null;
  let heartbeatTimer = null;
  let tickTimer = null;
  let watchTimer = null;
  let isHost = false;
  let currentRoomId = null;
  let listeners = { onLobby: null, onRoom: null, onInvite: null };
  let onStateChange = () => {}; // колбек для UI: (mode, data) => {}
  let latestRoom = null; // кеш стану кімнати з listener'а — тік хоста рахує з нього, без зайвого once()

  function colorFor(name, joinedAt, allJoinedSorted) {
    const idx = allJoinedSorted.indexOf(name);
    return COLORS[idx >= 0 ? idx % COLORS.length : 0];
  }

  function emptyCellNear() {
    // проста рандомна вільна позиція — колізії при спавні ігноруємо (рідкість, самокорегується наступним тіком)
    return { x: rnd(GRID), y: rnd(GRID) };
  }

  function initialBody() {
    const head = emptyCellNear();
    return [head];
  }

  // ------------------------- прибирання застарілих кімнат -------------------------
  // Без сервера немає "cron" — тому кожен, хто відкриває гру, попутно (один раз)
  // прибирає кімнати, де НІХТО не має свіжого lastSeen довше ROOM_ABANDON_MS.
  // Безкоштовно й безпечно виконувати з кількох клієнтів одночасно (delete —
  // ідемпотентний, повторний виклик на вже видалений вузол просто нічого не робить).
  function cleanupStaleRooms() {
    window.rtdb.ref("snake_rooms").once("value").then((snap) => {
      const rooms = snap.val() || {};
      Object.entries(rooms).forEach(([roomId, room]) => {
        const players = room.players || {};
        const lastSeens = Object.values(players).map((p) => p.lastSeen || 0);
        const mostRecent = lastSeens.length ? Math.max(...lastSeens) : (room.createdAt || 0);
        if (now() - mostRecent > ROOM_ABANDON_MS) {
          window.rtdb.ref("snake_rooms/" + roomId).remove();
        }
      });
    });
  }

  // ------------------------- presence (лобі) -------------------------
  function startPresence(user) {
    username = user;
    lobbyRef = window.rtdb.ref("snake_lobby");
    myLobbyRef = lobbyRef.child(username);

    myLobbyRef.onDisconnect().remove();
    touchLobby("solo", null);
    cleanupStaleRooms();

    heartbeatTimer = setInterval(() => {
      myLobbyRef.child("lastSeen").set(now());
      if (currentRoomId && myPlayerRef) myPlayerRef.child("lastSeen").set(now());
    }, HEARTBEAT_MS);

    listeners.onLobby = lobbyRef.on("value", (snap) => {
      const all = snap.val() || {};
      const active = Object.entries(all).filter(
        ([name, v]) => name !== username && v.lastSeen && now() - v.lastSeen < PRESENCE_TIMEOUT_MS
      );
      onStateChange("lobby-update", { active });
    });

    // якщо мене хтось запросив у кімнату (інший гравець створив room і вписав мій roomId)
    listeners.onInvite = myLobbyRef.child("roomId").on("value", (snap) => {
      const roomId = snap.val();
      if (roomId && roomId !== currentRoomId) {
        joinExistingRoom(roomId);
      } else if (!roomId && currentRoomId) {
        leaveRoomLocally();
      }
    });
  }

  function touchLobby(status, roomId) {
    myLobbyRef.set({ status, roomId: roomId || null, lastSeen: now() });
  }

  function stopPresence() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (watchTimer) clearInterval(watchTimer);
    if (tickTimer) clearInterval(tickTimer);
    if (lobbyRef && listeners.onLobby) lobbyRef.off("value", listeners.onLobby);
    if (myLobbyRef && listeners.onInvite) myLobbyRef.child("roomId").off("value", listeners.onInvite);
    if (myLobbyRef) { myLobbyRef.onDisconnect().cancel(); myLobbyRef.remove(); }
    if (roomRef && listeners.onRoom) roomRef.off("value", listeners.onRoom);
    if (myPlayerRef) { myPlayerRef.onDisconnect().cancel(); }
  }

  // ------------------------- кімнати -------------------------
  function createRoomWith(otherUsername) {
    const roomId = `${username}_${now()}`;
    const meBody = initialBody();
    const otherBody = initialBody();
    const roomData = {
      status: "playing",
      hostUsername: username,
      createdAt: now(),
      food: emptyCellNear(),
      players: {
        [username]: { body: meBody, direction: "right", alive: true, score: 0, joinedAt: now(), lastSeen: now() },
        [otherUsername]: { body: otherBody, direction: "left", alive: true, score: 0, joinedAt: now() + 1, lastSeen: now() },
      },
    };
    window.rtdb.ref("snake_rooms/" + roomId).set(roomData).then(() => {
      window.rtdb.ref("snake_lobby/" + username).update({ status: "in-room", roomId });
      window.rtdb.ref("snake_lobby/" + otherUsername).update({ status: "in-room", roomId });
    });
  }

  function joinExistingRoom(roomId) {
    if (currentRoomId === roomId) return;
    leaveRoomLocally();
    currentRoomId = roomId;
    roomRef = window.rtdb.ref("snake_rooms/" + roomId);
    myPlayerRef = roomRef.child("players/" + username);

    // якщо мене там ще нема (приєднання 3го+ гравця) — додаю себе
    myPlayerRef.get().then((snap) => {
      if (!snap.exists()) {
        myPlayerRef.set({
          body: initialBody(),
          direction: ["up", "down", "left", "right"][rnd(4)],
          alive: true,
          score: 0,
          joinedAt: now(),
          lastSeen: now(),
        });
      }
      myPlayerRef.onDisconnect().update({ alive: false });
    });

    listeners.onRoom = roomRef.on("value", (snap) => {
      const room = snap.val();
      if (!room) { leaveRoomLocally(); return; }
      latestRoom = room; // кеш для тіку хоста — без зайвого round-trip на кожен рух
      onStateChange("room-update", { room, roomId });
      maybeElectHost(room, roomId);
    });

    touchLobby("in-room", roomId);
    startHostWatch();
  }

  function requestJoinMultiplayer(otherUsername) {
    createRoomWith(otherUsername);
  }

  function joinAsSpectatorOrPlayer(roomId) {
    joinExistingRoom(roomId);
  }

  function leaveRoomLocally() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    if (roomRef && listeners.onRoom) roomRef.off("value", listeners.onRoom);
    if (myPlayerRef) myPlayerRef.onDisconnect().cancel();
    isHost = false;
    currentRoomId = null;
    roomRef = null;
    myPlayerRef = null;
  }

  function backToSolo() {
    if (currentRoomId && myPlayerRef) myPlayerRef.remove();
    leaveRoomLocally();
    touchLobby("solo", null);
  }

  function respawn() {
    if (!myPlayerRef) return;
    myPlayerRef.update({ body: initialBody(), alive: true, score: 0, direction: "right", lastSeen: now() });
  }

  function sendDirection(dir) {
    if (!myPlayerRef) return;
    myPlayerRef.child("direction").set(dir);
  }

  // ------------------------- host election -------------------------
  function startHostWatch() {
    if (watchTimer) clearInterval(watchTimer);
    watchTimer = setInterval(() => {
      roomRef.once("value").then((snap) => {
        const room = snap.val();
        if (room) maybeElectHost(room, currentRoomId);
      });
    }, 2000);
  }

  function maybeElectHost(room, roomId) {
    const players = room.players || {};
    const hostEntry = players[room.hostUsername];
    const hostStale = !hostEntry || (hostEntry.lastSeen && now() - hostEntry.lastSeen > PRESENCE_TIMEOUT_MS);
    if (!hostStale) {
      if (room.hostUsername === username && !isHost) startHostLoop(roomId);
      if (room.hostUsername !== username && isHost) stopHostLoop();
      return;
    }
    // хост "мертвий" — живі гравці, відсортовані по часу приєднання
    const alive = Object.entries(players)
      .filter(([, p]) => p.lastSeen && now() - p.lastSeen < PRESENCE_TIMEOUT_MS)
      .sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
    if (alive.length && alive[0][0] === username) {
      window.rtdb.ref(`snake_rooms/${roomId}/hostUsername`).transaction((current) => {
        if (current === room.hostUsername) return username; // compare-and-swap
        return; // хтось уже змінив — не чіпаємо
      }).then(() => startHostLoop(roomId));
    }
  }

  function startHostLoop(roomId) {
    if (isHost) return;
    isHost = true;
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(() => tick(roomId), TICK_MS);
  }

  function stopHostLoop() {
    isHost = false;
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }

  // ------------------------- ігровий тік (тільки хост) -------------------------
  function tick(roomId) {
    const room = latestRoom;
    if (!room) return;
    const ref = window.rtdb.ref("snake_rooms/" + roomId);
    const players = room.players || {};
    const activeNames = Object.keys(players).filter(
      (n) => players[n].alive && players[n].lastSeen && now() - players[n].lastSeen < PRESENCE_TIMEOUT_MS
    );

    // прибираємо тих, хто відвалився (не оновлював lastSeen) — звільняємо слот
    Object.keys(players).forEach((n) => {
      if (players[n].lastSeen && now() - players[n].lastSeen > PRESENCE_TIMEOUT_MS && players[n].alive) {
        players[n].alive = false;
      }
    });

    const newHeads = {};
    activeNames.forEach((n) => {
      const p = players[n];
      let dir = p.direction || "right";
      const cur = p.__lastDir || dir;
      if (OPPOSITE[dir] === cur && p.body.length > 1) dir = cur; // не даємо розвернутись на 180°
      const d = DIRS[dir];
      const head = p.body[0];
      newHeads[n] = {
        x: (head.x + d.dx + GRID) % GRID,
        y: (head.y + d.dy + GRID) % GRID,
        dir,
      };
    });

    // колізії: своє тіло / чуже тіло (позиції ДО ходу) / зустрічні голови
    const headCells = {};
    Object.entries(newHeads).forEach(([n, h]) => {
      const key = h.x + "," + h.y;
      (headCells[key] = headCells[key] || []).push(n);
    });

    const dead = new Set();
    Object.entries(newHeads).forEach(([n, h]) => {
      const key = h.x + "," + h.y;
      if (headCells[key].length > 1) dead.add(n); // head-to-head
      Object.entries(players).forEach(([other, p]) => {
        const body = other === n ? p.body.slice(0, -1) : p.body; // власний хвіст, що відʼїде, не рахуємо
        if (body.some((c) => c.x === h.x && c.y === h.y)) dead.add(n);
      });
    });

    const food = room.food || emptyCellNear();
    let newFood = food;
    const updates = {};
    activeNames.forEach((n) => {
      const p = players[n];
      const h = newHeads[n];
      if (dead.has(n)) {
        updates[`players/${n}/alive`] = false;
        if (players[n]) players[n].alive = false; // оновлюємо кеш одразу
        return;
      }
      const ate = h.x === food.x && h.y === food.y;
      const newBody = [{ x: h.x, y: h.y }, ...(ate ? p.body : p.body.slice(0, -1))];
      updates[`players/${n}/body`] = newBody;
      updates[`players/${n}/__lastDir`] = h.dir;
      // одразу оновлюємо кеш, щоб НАСТУПНИЙ тік вважав це вихідною точкою
      // без очікування на відлуння запису через listener
      p.body = newBody;
      p.__lastDir = h.dir;
      if (ate) {
        updates[`players/${n}/score`] = (p.score || 0) + 10;
        p.score = (p.score || 0) + 10;
        newFood = emptyCellNear();
      }
    });
    updates["food"] = newFood;
    room.food = newFood;
    ref.update(updates);
  }

  window.SnakeMP = {
    GRID,
    MAX_PLAYERS,
    COLORS,
    startPresence,
    stopPresence,
    requestJoinMultiplayer,
    joinAsSpectatorOrPlayer,
    backToSolo,
    respawn,
    sendDirection,
    set onStateChange(fn) { onStateChange = fn; },
  };
})();
