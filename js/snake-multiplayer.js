// ==========================================================================
// Мультиплеєр-шар змійки — на спільному online-engine.js, модель "одна
// спільна арена" (як Шпигун), а не динамічні кімнати на кожну пару гравців.
// Перший, хто відкриває гру, створює арену й одразу стає першим гравцем
// (а отже й першим хостом — computeHost/CAS обирають найдавнішого живого).
// Усі наступні просто заходять у ТУ САМУ кімнату — жодного запрошення чи
// підтвердження "приєднатись до X?" більше не потрібно.
//
// Публічний API (window.SnakeMP) підтримує старі назви (backToSolo,
// respawn, sendDirection), але requestJoinMultiplayer/joinAsSpectatorOrPlayer
// прибрані — вони належали до старої моделі динамічних кімнат.
//
// lockedHost:true — постійний tick-loop (не подієва гра, як Шпигун/Quiplash),
// тому хост фіксується в кімнаті через CAS-транзакцію, і рушій сам керує
// стартом/стопом локального tick-таймера через onBecomeHost/onLoseHost.
//
// Спрощення для MVP лишились ті самі, що й раніше (свідомо):
// - Арена не має "кінця раунду": помер гравець стає спостерігачем і може
//   натиснути "Приєднатись знову", арена не закривається.
// - Колізії рахуються по позиціях ДО ходу цього тіку — рідкісні прикордонні
//   випадки (одночасний з'їзд у ту саму клітинку) не ідеальні, але для
//   казуальної гри з друзями це не критично.
// ==========================================================================
(function () {
  const GRID = 22;
  const MAX_PLAYERS = 8;
  const TICK_MS = 160;
  const COLORS = ["#38cfa0", "#e0b84c", "#ff6b6b", "#8fb8ff", "#c77dff", "#4dd0e1", "#ffb84d", "#a3e635"];
  const DIRS = {
    up: { dx: 0, dy: -1 },
    down: { dx: 0, dy: 1 },
    left: { dx: -1, dy: 0 },
    right: { dx: 1, dy: 0 },
  };
  const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };

  const ROOM_SCHEMA = { hostUsername: null, food: null, players: {} };

  function rnd(n) { return Math.floor(Math.random() * n); }

  // Безпечний вибір вільної клітинки: спершу кілька спроб навмання (швидко
  // й дешево в типовому випадку), і лише якщо всі невдалі — повний прохід
  // по дошці в пошуку першої вільної клітинки. players — поточний
  // room.players, extraOccupied — додаткові клітинки, яких теж уникати
  // (напр. позиція іншого гравця, що спавниться в ту саму мить).
  function pickFreeCell(players, extraOccupied) {
    const occupied = new Set();
    Object.values(players || {}).forEach((p) => {
      if (!p.alive) return;
      (p.body || []).forEach((c) => occupied.add(c.x + "," + c.y));
    });
    (extraOccupied || []).forEach((c) => occupied.add(c.x + "," + c.y));

    for (let i = 0; i < 40; i++) {
      const cand = { x: rnd(GRID), y: rnd(GRID) };
      if (!occupied.has(cand.x + "," + cand.y)) return cand;
    }
    for (let x = 0; x < GRID; x++) {
      for (let y = 0; y < GRID; y++) {
        if (!occupied.has(x + "," + y)) return { x, y };
      }
    }
    return { x: 0, y: 0 }; // дошка повністю зайнята — практично неможливо при GRID=22/MAX_PLAYERS=8
  }

  function initialBody(players, extraOccupied) {
    return [pickFreeCell(players, extraOccupied)];
  }

  // Стабільний колір за іменем — закріплюється РАЗ при вході гравця і більше
  // ніколи не перераховується (раніше колір рахувався за позицією в масиві
  // гравців, тому міг змінюватись посеред гри, коли хтось виходив).
  function colorForName(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return COLORS[hash % COLORS.length];
  }

  const Engine = window.OnlineEngine.create("snake", {
    lockedHost: true,
    // Мінімальний fallback — у наших власних шляхах нижче extra завжди
    // передається явно з правильним body/color/direction; це спрацює лише
    // як запобіжник на випадок непередбаченого виклику.
    onEmptyPlayer: () => ({ body: [{ x: 0, y: 0 }], direction: "right", alive: true, score: 0 }),
    onDisconnectPlayerPatch: { alive: false },
  });

  let username = null;
  let tickTimer = null;
  let onStateChange = () => {}; // колбек для UI: (mode, data) => {}

  function freshRoomPayload() {
    return { food: pickFreeCell(null, null) };
  }

  function joinExtraFor(room) {
    return {
      body: initialBody(room.players, room.food ? [room.food] : null),
      direction: ["up", "down", "left", "right"][rnd(4)],
      alive: true,
      score: 0,
      color: colorForName(username),
    };
  }

  // ------------------------- presence / арена -------------------------
  function startPresence(user) {
    username = user;
    Engine.start(user, { useLobby: false });

    Engine.onStateChange = (type, data) => {
      if (type === "room-update") onStateChange("room-update", { room: data.room });
    };
    Engine.onBecomeHost = (roomId) => {
      if (tickTimer) clearInterval(tickTimer);
      tickTimer = setInterval(() => tick(roomId), TICK_MS);
    };
    Engine.onLoseHost = () => {
      if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    };

    // Перший, хто відкриє гру, створює арену свіжою; усі наступні знаходять
    // її вже готовою — в обох випадках дальше просто читаємо поточний стан
    // і рахуємо БЕЗПЕЧНЕ місце спавну відносно нього.
    Engine.getOrCreateRoom(Engine.SHARED_ROOM_ID, ROOM_SCHEMA, freshRoomPayload).then(({ room }) => {
      Engine.joinRoom(Engine.SHARED_ROOM_ID, { extra: joinExtraFor(room) });
    });
  }

  function stopPresence() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    Engine.stop();
  }

  function backToSolo() {
    Engine.leaveRoom();
  }

  function respawn() {
    if (!Engine.roomRef) return;
    Engine.roomRef.once("value").then((snap) => {
      const room = snap.val() || {};
      const body = initialBody(room.players, room.food ? [room.food] : null);
      Engine.roomRef.child("players/" + username).update({
        body, alive: true, score: 0, direction: "right", lastSeen: Engine.now(),
      });
    });
  }

  function sendDirection(dir) {
    if (!Engine.roomRef) return;
    Engine.roomRef.child("players/" + username + "/direction").set(dir);
  }

  // Скинути спільну арену для всіх (напр. кнопка адміністрування в UI, якщо
  // з'явиться) — аналог Spy.resetAll.
  function resetGame() {
    return Engine.forceResetRoom(Engine.SHARED_ROOM_ID, ROOM_SCHEMA, freshRoomPayload).then(({ room }) => {
      Engine.joinRoom(Engine.SHARED_ROOM_ID, { extra: joinExtraFor(room) });
    });
  }

  // ------------------------- ігровий тік (тільки хост) -------------------------
  function tick(roomId) {
    const room = Engine.latestRoom;
    if (!room) return;
    const ref = Engine.roomRef;
    const players = room.players || {};
    const activeNames = Object.keys(players).filter(
      (n) => players[n].alive && Engine.isConnected(players[n])
    );
    const updates = {};

    // прибираємо тих, хто відвалився (не оновлював lastSeen) — звільняємо
    // слот. Раніше це виставляло alive:false лише в ЛОКАЛЬНОМУ кеші (об'єкт
    // players у пам'яті хоста), але ніколи не записувалось у updates — тому
    // в базі й далі лежало alive:true, і "мертва" змійка малювалась
    // назавжди у всіх клієнтів (заморожена в останній відомій позиції).
    Object.keys(players).forEach((n) => {
      if (players[n].alive && players[n].lastSeen && !Engine.isConnected(players[n])) {
        players[n].alive = false;
        updates[`players/${n}/alive`] = false;
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

    const food = room.food || pickFreeCell(players);
    let newFood = food;
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
        newFood = pickFreeCell(players); // рахуємо ПІСЛЯ оновлення p.body в кеші вище — нове тіло вже враховане
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
    backToSolo,
    respawn,
    sendDirection,
    resetGame,
    set onStateChange(fn) { onStateChange = fn; },
  };
})();
