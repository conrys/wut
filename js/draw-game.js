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
  const PHASES = ["lobby", "active"];
  const MIN_PLAYERS = 2;
  const TICK_MS = 500;
  const ALLOWED_GALLERY_SECONDS = [45, 60, 90, 120, 180];
  const DEFAULT_GALLERY_SECONDS = 90;
  const REVEAL_AUTO_ADVANCE_MS = 4500;
  const MAX_DRAWING_BYTES = 900000;

  const SCHEMA = {
    phase: "lobby",
    hostUsername: null,
    mode: "crocodile",
    round: 0,
    gallerySettings: { drawSeconds: DEFAULT_GALLERY_SECONDS },
    gallery: null,
    crocodile: null,
    players: {},
  };

  const engine = window.OnlineEngine.create("draw", {
    phases: PHASES,
    lockedHost: true,
    onEmptyPlayer: () => ({ score: 0 }),
  });

  let username = null;
  let tickTimer = null;
  let onStateChange = () => {};
  let usedPromptsCache = {}; // локальний кеш, синхронізується з room.usedPrompts

  function buildFreshRoom() { return { players: {} }; }
  function unanswered(v) { return v === null || v === undefined; }

  function connectedNames(players) {
    return Object.entries(players || {}).filter(([, p]) => engine.isConnected(p)).map(([n]) => n);
  }

  function pickPrompt(usedMap) {
    const fresh = DRAW_PROMPTS.filter((p) => !usedMap || !usedMap[p]);
    const pool = fresh.length ? fresh : DRAW_PROMPTS; // список вичерпано — починаємо по колу
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // ------------------------- старт -------------------------
  async function start(user) {
    username = user;
    engine.onStateChange = handleEngineEvent;
    engine.onBecomeHost = () => { if (!tickTimer) tickTimer = setInterval(tick, TICK_MS); };
    engine.onLoseHost = () => { if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } };

    engine.start(username, { useLobby: false });
    await engine.getOrCreateRoom(engine.SHARED_ROOM_ID, SCHEMA, buildFreshRoom);
    await engine.joinRoom(engine.SHARED_ROOM_ID, { asPlayer: false });
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
    engine.becomePlayer({ score: 0 });
  }

  // ------------------------- налаштування лобі (тільки хост) -------------------------
  function setMode(mode) {
    if (mode !== "gallery" && mode !== "crocodile") return;
    engine.roomRef.child("mode").set(mode);
  }
  function setGalleryTimer(seconds) {
    if (!ALLOWED_GALLERY_SECONDS.includes(seconds)) return;
    engine.roomRef.child("gallerySettings/drawSeconds").set(seconds);
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
    engine.forceResetRoom(engine.SHARED_ROOM_ID, SCHEMA, buildFreshRoom);
  }

  // ------------------------- crocodile -------------------------
  async function startCrocodileRound(drawerUsername, round) {
    const room = engine.latestRoom;
    const usedPrompts = (room && room.usedPrompts) || usedPromptsCache;
    const promptText = pickPrompt(usedPrompts);
    usedPromptsCache = { ...usedPrompts, [promptText]: true };
    await engine.roomRef.update({
      round: (round !== undefined ? round : (room ? room.round : 0)) + 1,
      [`usedPrompts/${promptText}`]: true,
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
    const drawMs = (room.gallerySettings.drawSeconds || DEFAULT_GALLERY_SECONDS) * 1000;
    const usedPrompts = room.usedPrompts || usedPromptsCache;
    const prompts = {};
    const usedUpdates = {};
    let usedLocal = { ...usedPrompts };
    names.forEach((n) => {
      const p = pickPrompt(usedLocal);
      prompts[n] = p;
      usedLocal[p] = true;
      usedUpdates[`usedPrompts/${p}`] = true;
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
    if (!room || room.phase !== "active" || room.mode !== "gallery" || !room.gallery) return;
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
    MIN_PLAYERS,
    ALLOWED_GALLERY_SECONDS,
    connectedNames,
    computeHost: (players) => engine.computeHost(players),
    unanswered,
    start, stop,
    setMode, setGalleryTimer, startGame, resetGame,
    pushStrokeBatch, sendUndo, sendClear, markCorrectGuess, hostSkipPrompt, hostForceNextDrawer,
    submitDrawing, hostRevealAnswer, hostNextDrawing, hostNewGalleryRound,
    set onStateChange(fn) { onStateChange = fn; },
  };
})();