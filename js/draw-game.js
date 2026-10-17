// ==========================================================================
// Малювалка на спільному OnlineEngine. Одна спільна кімната ("shared",
// useLobby:false). Два режими в одній грі: crocodile (живе малювання,
// один малює — решта вгадують вголос) і gallery (малюють усі приватно,
// потім по черзі показуємо з таймером).
//
// Живі штрихи (crocodile) НЕ пишуться в RTDB по одному сегменту — це б
// дало десятки записів/сек під час активного малювання. Замість цього
// UI-шар (draw.html) буферизує сегменти локально і скидає пачками через
// pushStrokeBatch() раз на ~100мс. RTDB-список (push) сам "доганяє"
// нового глядача історією через child_added — без додаткового коду.
//
// Підключати ПІСЛЯ firebase-config.js, login.js, draw-prompts.js,
// online-engine.js, draw-canvas.js.
// ==========================================================================
(function () {
  const GAME_KEY = "draw";
  const PHASES = ["lobby", "active"];
  const MIN_PLAYERS = 2;
  const ABANDON_MS = 15 * 60 * 1000;
  const TICK_MS = 500;
  const MIN_GALLERY_SECONDS = 20, MAX_GALLERY_SECONDS = 120;
  const DEFAULT_GALLERY_SECONDS = 60;
  const ALLOWED_DIFFICULTIES = ["easy", "medium", "hard"];
  const DEFAULT_DIFFICULTY = "medium";
  const REVEAL_AUTO_ADVANCE_MS = 4500;
  const MAX_DRAWING_BYTES = 900000;

  const SCHEMA = {
    phase: "lobby",
    hostUsername: null,
    mode: "crocodile",
    difficulty: DEFAULT_DIFFICULTY,
    round: 0,
    gallerySettings: { drawSeconds: DEFAULT_GALLERY_SECONDS },
    gallery: null,
    crocodile: null,
    players: {},
  };

  const engine = window.OnlineEngine.create(GAME_KEY, {
    phases: PHASES,
    lockedHost: true,
    abandonMs: ABANDON_MS,
    onEmptyPlayer: () => ({ score: 0 }),
  });

  let username = null;
  let tickTimer = null;
  let onStateChange = () => {};
  let usedPromptsCache = {}; // локальний кеш, синхронізується з room.usedPrompts

  // ------------------------- аватари (монстрики Сміхлиста, як у Дилемах) -------------------------
  const AVATAR_STORAGE_PREFIX = "games41_quiplash_avatar_";
  const QA = () => window.QuiplashAvatars; // підключати ДО цього файлу
  const CHARACTERS = QA() ? QA().COUNT : 8;
  const charColor = (c) => (QA() ? QA().color(c) : "#ff3d8b");
  function takenChars(room) {
    return new Set(Object.entries((room && room.players) || {}).filter(([n]) => n !== username).map(([, p]) => Number(p && p.character)));
  }
  function avatarFor(room) {
    const taken = takenChars(room);
    let want = null;
    try {
      const raw = window.localStorage && window.localStorage.getItem(AVATAR_STORAGE_PREFIX + username);
      const profile = raw ? JSON.parse(raw) : null;
      if (profile && profile.character >= 1 && profile.character <= CHARACTERS) want = Number(profile.character);
    } catch (e) { /* немає localStorage */ }
    if (want && !taken.has(want)) return { character: want, color: charColor(want) };
    const idx = Object.keys((room && room.players) || {}).length;
    for (let i = 0; i < CHARACTERS; i++) {
      const c = ((want || idx) + i) % CHARACTERS + 1;
      if (!taken.has(c)) return { character: c, color: charColor(c) };
    }
    const c = (idx % CHARACTERS) + 1;
    return { character: c, color: charColor(c) };
  }
  // Тап по своїй аватарці в лобі — наступний вільний персонаж (без дублів).
  function cycleAvatar() {
    const room = engine.latestRoom, me = room && room.players && room.players[username];
    if (!me || room.phase !== "lobby") return;
    const taken = takenChars(room), cur = Number(me.character) || 1;
    for (let i = 1; i <= CHARACTERS; i++) {
      const c = (cur - 1 + i) % CHARACTERS + 1;
      if (taken.has(c)) continue;
      engine.roomRef.child("players/" + username).update({ character: c, color: charColor(c) });
      try { localStorage.setItem(AVATAR_STORAGE_PREFIX + username, JSON.stringify({ character: c, color: charColor(c) })); } catch (e) {}
      return;
    }
  }

  function buildFreshRoom() { return { players: {} }; }
  function unanswered(v) { return v === null || v === undefined; }

  function connectedNames(players) {
    return Object.entries(players || {}).filter(([, p]) => engine.isConnected(p)).map(([n]) => n);
  }

  // DRAW_PROMPTS тепер об'єкт {easy, medium, hard} (як у crocodile-words.js),
  // а не плаский масив — тому обираємо пул за складністю кімнати. usedMap
  // тримаємо з ключами "складність::слово", щоб однакове слово в різних
  // пулах (малоймовірно, але можливо) не заважало одне одному вважатись
  // "вже показаним".
  function usedKey(difficulty, prompt) { return `${difficulty}::${prompt}`; }

  function pickPrompt(usedMap, difficulty) {
    const pool = DRAW_PROMPTS[difficulty] || DRAW_PROMPTS[DEFAULT_DIFFICULTY];
    const fresh = pool.filter((p) => !usedMap || !usedMap[usedKey(difficulty, p)]);
    const list = fresh.length ? fresh : pool; // пул вичерпано — починаємо по колу
    // серед свіжих для кімнати — спершу ті, яких компанія ще не малювала
    const word = window.PromptHistory ? PromptHistory.order("draw", list)[0] : list[Math.floor(Math.random() * list.length)];
    if (window.PromptHistory) PromptHistory.mark("draw", [word]);
    return word;
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
    engine.onBecomeHost = () => { if (!tickTimer) tickTimer = setInterval(tick, TICK_MS); };
    engine.onLoseHost = () => { if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } };

    engine.start(username, { useLobby: false });
    await engine.getOrCreateRoom(roomId, SCHEMA, buildFreshRoom);
    await engine.joinRoom(roomId, { asPlayer: false });
  }

  function stop() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    engine.stop();
  }

  function handleEngineEvent(type, data) {
    if (type !== "room-update") return;
    const room = data.room;
    maybeJoinAsPlayer(room);
    onStateChange(room, { username, host: engine.isHost, isDrawer: room.crocodile && room.crocodile.drawerUsername === username });
  }

  function maybeJoinAsPlayer(room) {
    if (room.players && room.players[username]) return;
    if (room.phase !== "lobby") return;
    engine.becomePlayer({ score: 0, ...avatarFor(room) });
  }

  // ------------------------- налаштування лобі (тільки хост) -------------------------
  function setMode(mode) {
    if (mode !== "gallery" && mode !== "crocodile") return;
    engine.roomRef.child("mode").set(mode);
  }
  function setGalleryTimer(seconds) {
    if (!Number.isInteger(seconds) || seconds < MIN_GALLERY_SECONDS || seconds > MAX_GALLERY_SECONDS) return;
    engine.roomRef.child("gallerySettings/drawSeconds").set(seconds);
  }
  function setDifficulty(difficulty) {
    if (!ALLOWED_DIFFICULTIES.includes(difficulty)) return;
    engine.roomRef.child("difficulty").set(difficulty);
  }

  async function startGame(room) {
    const names = connectedNames(room.players);
    if (names.length < MIN_PLAYERS) return;
    const resetScores = {};
    names.forEach((n) => { resetScores[`players/${n}/score`] = 0; });
    await engine.roomRef.update({ ...resetScores, phase: "active", round: 0 });
    if (room.mode === "gallery") await startGalleryRound({ ...room, round: 0 }, names);
    else await startCrocodileRound(names[Math.floor(Math.random() * names.length)], 0);
  }

  function resetGame() {
    usedPromptsCache = {};
    const roomId = engine.currentRoomId;
    if (!roomId) return;
    engine.forceResetRoom(roomId, SCHEMA, buildFreshRoom);
  }

  // ------------------------- crocodile -------------------------
  async function startCrocodileRound(drawerUsername, round) {
    const room = engine.latestRoom;
    const difficulty = (room && room.difficulty) || DEFAULT_DIFFICULTY;
    const usedPrompts = (room && room.usedPrompts) || usedPromptsCache;
    const promptText = pickPrompt(usedPrompts, difficulty);
    const key = usedKey(difficulty, promptText);
    usedPromptsCache = { ...usedPrompts, [key]: true };
    await engine.roomRef.update({
      round: (round !== undefined ? round : (room ? room.round : 0)) + 1,
      [`usedPrompts/${key}`]: true,
      crocodile: { drawerUsername, promptText, strokesVersion: engine.now() },
    });
    // окремий список штрихів — власний вузол, щоб не тягнути важкий масив
    // при кожному читанні всього стану кімнати
    await engine.roomRef.child("crocodile/strokeBatches").remove();
  }

  function pushStrokeBatch(segments) {
    const room = engine.latestRoom;
    if (!room || !room.crocodile || room.crocodile.drawerUsername !== username) return;
    if (!segments || !segments.length) return;
    engine.roomRef.child("crocodile/strokeBatches").push(segments);
  }
  function sendUndo(strokeId) {
    const room = engine.latestRoom;
    if (!room || !room.crocodile || room.crocodile.drawerUsername !== username || !strokeId) return;
    engine.roomRef.child("crocodile/undoSignal").set({ strokeId, ts: engine.now() });
  }
  function sendClear() {
    const room = engine.latestRoom;
    if (!room || !room.crocodile || room.crocodile.drawerUsername !== username) return;
    engine.roomRef.child("crocodile/strokeBatches").remove();
    engine.roomRef.child("crocodile/clearSignal").set(engine.now());
  }

  function markCorrectGuess(guesserUsername) {
    const room = engine.latestRoom;
    if (!room || !room.crocodile || room.crocodile.drawerUsername !== username) return;
    if (!guesserUsername || guesserUsername === username) return;
    const drawerScore = (room.players[username] && room.players[username].score) || 0;
    const guesserScore = (room.players[guesserUsername] && room.players[guesserUsername].score) || 0;
    engine.roomRef.update({
      [`players/${username}/score`]: drawerScore + 1,
      [`players/${guesserUsername}/score`]: guesserScore + 1,
    }).then(() => startCrocodileRound(guesserUsername, room.round));
  }

  function hostSkipPrompt() {
    const room = engine.latestRoom;
    if (!room || !room.crocodile) return;
    startCrocodileRound(room.crocodile.drawerUsername, room.round);
  }
  function hostForceNextDrawer() {
    const room = engine.latestRoom;
    if (!room || !room.crocodile) return;
    const others = connectedNames(room.players).filter((n) => n !== room.crocodile.drawerUsername);
    if (!others.length) return;
    startCrocodileRound(others[Math.floor(Math.random() * others.length)], room.round);
  }

  // ------------------------- gallery -------------------------
  async function startGalleryRound(room, names) {
    room = room || engine.latestRoom;
    names = names || connectedNames(room.players);
    const difficulty = room.difficulty || DEFAULT_DIFFICULTY;
    const drawSeconds = Number(room.gallerySettings.drawSeconds) || DEFAULT_GALLERY_SECONDS;
    const drawMs = Math.min(MAX_GALLERY_SECONDS, Math.max(MIN_GALLERY_SECONDS, drawSeconds)) * 1000;
    const usedPrompts = room.usedPrompts || usedPromptsCache;
    const prompts = {};
    const usedUpdates = {};
    let usedLocal = { ...usedPrompts };
    names.forEach((n) => {
      const p = pickPrompt(usedLocal, difficulty);
      prompts[n] = p;
      const key = usedKey(difficulty, p);
      usedLocal[key] = true;
      usedUpdates[`usedPrompts/${key}`] = true;
    });
    usedPromptsCache = usedLocal;
    await engine.roomRef.update({
      ...usedUpdates,
      round: (room.round || 0) + 1,
      gallery: {
        sub: "drawing",
        drawEndsAt: engine.now() + drawMs,
        prompts,
        submissions: {},
        revealOrder: null,
        revealIndex: 0,
        revealed: false,
        revealedAt: null,
      },
    });
  }

  function submitDrawing(dataUrl) {
    const room = engine.latestRoom;
    if (!room || !room.gallery || room.gallery.sub !== "drawing") return;
    if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return;
    if (dataUrl.length > MAX_DRAWING_BYTES) return;
    if (room.gallery.submissions && room.gallery.submissions[username] !== undefined) return;
    engine.roomRef.child(`gallery/submissions/${username}`).set(dataUrl);
  }

  function hostRevealAnswer() {
    const room = engine.latestRoom;
    if (!room || !room.gallery || room.gallery.sub !== "reveal") return;
    engine.roomRef.update({ "gallery/revealed": true, "gallery/revealedAt": engine.now() });
  }
  function hostNextDrawing() {
    const room = engine.latestRoom;
    if (!room || !room.gallery || room.gallery.sub !== "reveal" || !room.gallery.revealed) return;
    advanceGalleryReveal(room);
  }
  function hostNewGalleryRound() {
    const room = engine.latestRoom;
    if (!room || !room.gallery || room.gallery.sub !== "roundEnd") return;
    startGalleryRound(room);
  }

  function finishGalleryDrawing(room) {
    const order = shuffle(Object.keys(room.gallery.submissions || {}));
    engine.roomRef.update({
      "gallery/sub": "reveal",
      "gallery/revealOrder": order,
      "gallery/revealIndex": 0,
      "gallery/revealed": false,
      "gallery/revealedAt": null,
    });
  }
  function advanceGalleryReveal(room) {
    const nextIndex = room.gallery.revealIndex + 1;
    const done = nextIndex >= (room.gallery.revealOrder || []).length;
    engine.roomRef.update({
      "gallery/revealIndex": nextIndex,
      "gallery/revealed": false,
      "gallery/revealedAt": null,
      "gallery/sub": done ? "roundEnd" : "reveal",
    });
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ------------------------- хост-тік: тільки таймери галереї -------------------------
  function tick() {
    const room = engine.latestRoom;
    if (!room || room.paused || room.phase !== "active" || room.mode !== "gallery" || !room.gallery) return; // пауза — нічого не рухаємо
    const t = engine.now();

    if (room.gallery.sub === "drawing") {
      const submittedCount = Object.keys(room.gallery.submissions || {}).length;
      const totalCount = connectedNames(room.players).length;
      if ((submittedCount >= totalCount && totalCount > 0) || t >= room.gallery.drawEndsAt) {
        finishGalleryDrawing(room);
      }
      return;
    }
    if (room.gallery.sub === "reveal" && room.gallery.revealed && room.gallery.revealedAt) {
      if (t >= room.gallery.revealedAt + REVEAL_AUTO_ADVANCE_MS) advanceGalleryReveal(room);
    }
  }

  window.DrawGame = {
    // Серверний час (з поправкою .info/serverTimeOffset) — для UI-таймерів і автовідправки.
    // Локальний Date.now() у клієнта може йти наперед/назад і ламати дедлайни, які ставить хост.
    now: () => engine.now(),
    MIN_PLAYERS,
    MIN_GALLERY_SECONDS,
    MAX_GALLERY_SECONDS,
    DEFAULT_GALLERY_SECONDS,
    ALLOWED_DIFFICULTIES,
    DEFAULT_DIFFICULTY,
    connectedNames,
    computeHost: (players) => engine.computeHost(players),
    unanswered,
    watchActiveRooms,
    start, stop, cycleAvatar,
    setMode, setGalleryTimer, setDifficulty, startGame, resetGame,
    pushStrokeBatch, sendUndo, sendClear, markCorrectGuess, hostSkipPrompt, hostForceNextDrawer,
    submitDrawing, hostRevealAnswer, hostNextDrawing, hostNewGalleryRound,
    get roomId() { return engine.currentRoomId; },
    get roomRef() { return engine.roomRef; },
    set onStateChange(fn) { onStateChange = fn; },
  };
})();