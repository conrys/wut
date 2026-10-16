// ==========================================================================
// «Вечірка» на спільному OnlineEngine (js/online-engine.js). Кімната
// Separate room namespaces per fixed-mode page; legacy party.html still uses
// the shared "party_rooms" namespace and lets the host switch modes.
// ведучий міняє між наборами раундів, не виходячи з кімнати. Лічильники
// ковтків і балів живуть у кімнаті й накопичуються через усі набори.
//
// Фази: lobby (вибір режиму) → round (етапи раундів) → summary (підсумок набору)
// → lobby … Етап (room.stage) — це опис того, що зараз бачать телефони; режим
// лише повертає наступний етап, а тут (на хості) вирішується, коли переходити:
//   • усі, кого чекаємо (stage.expect), відповіли → одразу далі,
//   • вийшов час етапу (stage.endsAt, серверний engine.now()) → далі,
//   • "reveal" (результат) тримається REVEAL_MAX_MS і йде далі сам або за «Далі».
// Ковтки обмежені SET_CAP на гравця за набір — запобіжник від перебору.
//
// Рішення приймає ОДИН клієнт — хост (lockedHost:true: міграція, якщо його
// телефон заснув). Підключати ПІСЛЯ firebase-config.js, login.js,
// online-engine.js, party-seed.js, party-modes.js.
// ==========================================================================
(function () {
  const config = window.PartyConfig || {};
  const FIXED_MODE = config.mode || null;
  const GAME_KEY = config.gameKey || "party";
  const PHASES = ["lobby", "round", "summary"];
  const TICK_MS = 500;
  const SET_CAP = 6;               // ковтків на гравця за один набір
  const DEFAULT_LEVEL = 2;
  const MIN_TIMER_SECONDS = 20, MAX_TIMER_SECONDS = 120;
  const DEFAULT_TIMER_SECONDS = 60;
  const DEFAULT_COURT_SPEAK_SECONDS = DEFAULT_TIMER_SECONDS;
  const COURT_SPEAK_SECONDS_RANGE = [MIN_TIMER_SECONDS, MAX_TIMER_SECONDS];
  const ABANDON_MS = 15 * 60 * 1000;
  const AVATAR_STORAGE_PREFIX = "games41_quiplash_avatar_";
  const AVATAR_COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6", "#1abc9c", "#e67e22", "#ff6fa5"];
  // монстрики Сміхлиста (js/quiplash-avatars.js), якщо підключені; старий party.html — 8 img/char*.svg
  const QA = () => window.QuiplashAvatars;
  const CHARACTERS = QA() ? QA().COUNT : 8;
  const charColor = (c) => (QA() ? QA().color(c) : AVATAR_COLORS[(c - 1) % AVATAR_COLORS.length]);

  const SCHEMA = {
    phase: "lobby",
    hostUsername: null,
    settings: { mode: FIXED_MODE || "whofrom", level: DEFAULT_LEVEL, courtSpeakSeconds: DEFAULT_COURT_SPEAK_SECONDS, voteSeconds: DEFAULT_TIMER_SECONDS, betSeconds: DEFAULT_TIMER_SECONDS, decideSeconds: DEFAULT_TIMER_SECONDS, courtAutoAdvance: true },
    setId: null,       // унікальний id набору
    mode: null,        // режим, що зараз грається
    order: null,       // хто грає цей набір (підключені на старті)
    deck: null,        // стан набору від режиму (питання, місця) — у кімнаті, щоб не залежати від версії файлу
    roundNo: 0,
    totalRounds: 0,
    stage: null,       // поточний етап (див. party-modes.js)
    stageSeq: 0,
    inputs: null,      // inputs/<ім'я> = "<id етапу>:<значення>" (відповідь минулого етапу ігнорується)
    tally: null,       // tally/drinks, tally/points — на весь вечір; tally/set — ковтки цього набору
    players: {},
  };

  const engine = window.OnlineEngine.create(GAME_KEY, { phases: PHASES, lockedHost: true, abandonMs: ABANDON_MS });

  let username = null;
  let onStateChange = () => {};
  let tickTimer = null;
  let busy = false;

  const modes = () => (window.PartyModes && window.PartyModes.MODES) || {};
  function buildFreshRoom() {
    const modeId = FIXED_MODE || "whofrom";
    return { players: {}, settings: { mode: modeId, level: DEFAULT_LEVEL, courtSpeakSeconds: DEFAULT_COURT_SPEAK_SECONDS, voteSeconds: DEFAULT_TIMER_SECONDS, betSeconds: DEFAULT_TIMER_SECONDS, decideSeconds: DEFAULT_TIMER_SECONDS, courtAutoAdvance: true } };
  }
  function connectedNames(players) {
    return Object.entries(players || {}).filter(([, p]) => engine.isConnected(p)).map(([n]) => n);
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // ------------------------- аватари (як у Смішлісті) -------------------------
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
    } catch (e) { /* немає localStorage — беремо за чергою */ }
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
  function cycleAvatar(step) {
    const room = engine.latestRoom, me = room && room.players && room.players[username];
    if (!me || room.phase === "round") return;
    const taken = takenChars(room), cur = Number(me.character) || 1, dir = step < 0 ? -1 : 1;
    for (let i = 1; i <= CHARACTERS; i++) {
      const c = ((cur - 1 + dir * i) % CHARACTERS + CHARACTERS) % CHARACTERS + 1;
      if (taken.has(c)) continue;
      engine.roomRef.child("players/" + username).update({ character: c, color: charColor(c) });
      try { localStorage.setItem(AVATAR_STORAGE_PREFIX + username, JSON.stringify({ character: c, color: charColor(c) })); } catch (e) {}
      return;
    }
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
        const lastActivity = Math.max(room.lastActivityAt || 0, room.createdAt || 0, lastSeens.length ? Math.max(...lastSeens) : 0);
        const stale = !connected.length && (!lastActivity || t - lastActivity > ABANDON_MS);
        return { roomId, phase: room.phase || "lobby", playerCount: Object.keys(players).length, connectedCount: connected.length, stale };
      }).filter((r) => !r.stale).sort((a, b) => b.connectedCount - a.connectedCount || b.playerCount - a.playerCount);
      callback(list);
    };
    ref.on("value", onValue);
    return () => ref.off("value", onValue);
  }

  // ------------------------- старт / події -------------------------
  async function start(user, roomId) {
    username = user;
    engine.onStateChange = handleEngineEvent;
    engine.start(username, { useLobby: false });
    await engine.getOrCreateRoom(roomId, SCHEMA, buildFreshRoom);
    await engine.joinRoom(roomId, { asPlayer: false });
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(tick, TICK_MS);
  }
  function stop() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    engine.stop();
  }
  function handleEngineEvent(type, data) {
    if (type !== "room-update") return;
    const room = data.room;
    maybeJoinAsPlayer(room);
    if (engine.isHost) progress(room);
    onStateChange(room, { username, host: engine.computeHost(room.players) === username });
  }
  // Новий гравець приєднується між наборами (лобі або підсумок), не посеред раунду.
  function maybeJoinAsPlayer(room) {
    if (room.players && room.players[username]) return;
    if (room.phase === "round") return;
    engine.becomePlayer(avatarFor(room));
  }
  function tick() {
    const room = engine.latestRoom;
    if (!room || !engine.isHost) return;
    progress(room);
  }

  // ------------------------- відповіді гравців -------------------------
  // відповідь зберігається як "<id етапу>:<значення>": запізніла відповідь минулого етапу
  // (тап саме в момент переходу) не потрапляє у наступний
  function validInputs(room) {
    const st = room.stage, out = {};
    if (!st) return out;
    Object.entries(room.inputs || {}).forEach(([name, raw]) => {
      if (typeof raw !== "string") return;
      const i = raw.indexOf(":");
      if (i < 0 || Number(raw.slice(0, i)) !== st.id) return;
      out[name] = raw.slice(i + 1);
    });
    return out;
  }
  function inputOf(room, name) { return validInputs(room)[name] || null; }

  function answer(value) {
    const room = engine.latestRoom, st = room && room.stage;
    if (!room || room.phase !== "round" || !st) return { ok: false, reason: "wrong-phase" };
    if (st.kind !== "pick-name" && st.kind !== "choice") return { ok: false, reason: "no-input" };
    if (!(st.expect || []).includes(username)) return { ok: false, reason: "not-expected" };
    const valid = st.kind === "pick-name" ? (st.names || []).includes(value) : (st.options || []).some((o) => o.id === value);
    if (!valid) return { ok: false, reason: "bad-value" };
    // змінити думку можна до кінця етапу
    engine.roomRef.update({ ["inputs/" + username]: st.id + ":" + value });
    return { ok: true };
  }

  // Хто з очікуваних ще не відповів (лише ті, хто в мережі з допуском на згорнутий браузер)
  function waitingNames(room) {
    const st = room.stage; if (!st) return [];
    const inputs = validInputs(room), players = room.players || {};
    return (st.expect || []).filter((n) => inputs[n] === undefined && engine.isConnected(players[n]));
  }

  // ------------------------- рішення хоста -------------------------
  function makeCtx(room, roundNo, state) {
    const players = room.players || {};
    const order = room.order || [];
    return {
      order, present: order.filter((n) => engine.isConnected(players[n])),
      level: (room.settings && room.settings.level) || DEFAULT_LEVEL,
      settings: room.settings || {},
      roundNo, totalRounds: room.totalRounds, state, shuffle,
    };
  }

  function progress(room) {
    if (busy || room.phase !== "round" || !room.stage) return;
    const st = room.stage, now = engine.now();
    if (st.kind === "reveal") { if (st.endsAt && now >= st.endsAt) nextRound(); return; }
    const expect = st.expect || [];
    const allIn = expect.length > 0 && waitingNames(room).length === 0;
    const manualCourtSpeech = room.mode === "court" && st.kind === "show" && room.settings?.courtAutoAdvance === false;
    if (!manualCourtSpeech && (allIn || (st.endsAt && now >= st.endsAt))) endStage(room);
  }

  // Записує етап (і, для результату, ковтки/бали) однією атомарною дією.
  function commitStage(cur, stage, extra) {
    const now = engine.now();
    const seq = (cur.stageSeq || 0) + 1;
    const st = Object.assign({}, stage, { id: seq, startedAt: now });
    if (st.durationMs) st.endsAt = now + st.durationMs;
    delete st.durationMs;
    const update = Object.assign({ stage: st, stageSeq: seq, inputs: null }, extra || {});
    if (st.kind === "reveal") {
      const tally = cur.tally || {}, drinks = tally.drinks || {}, points = tally.points || {}, setT = tally.set || {};
      const applied = {}, capped = [];
      Object.entries(st.penalties || {}).forEach(([n, sips]) => {
        const left = Math.max(0, SET_CAP - (setT[n] || 0));
        const a = Math.min(sips, left);
        if (a < sips) capped.push(n);
        if (a > 0) {
          applied[n] = a;
          update["tally/drinks/" + n] = (drinks[n] || 0) + a;
          update["tally/set/" + n] = (setT[n] || 0) + a;
        }
      });
      Object.entries(st.points || {}).forEach(([n, p]) => { update["tally/points/" + n] = (points[n] || 0) + p; });
      st.penalties = applied;
      st.capped = capped;
    }
    return update;
  }

  async function endStage(room) {
    busy = true;
    try {
      const cur = engine.latestRoom;
      if (!cur || cur.phase !== "round" || !cur.stage || cur.stage.id !== room.stage.id) return;
      const mode = modes()[cur.mode];
      if (!mode) return;
      const next = mode.onEnd(makeCtx(cur, cur.roundNo, cur.deck), cur.stage, validInputs(cur));
      await engine.roomRef.update(commitStage(cur, next));
    } finally { busy = false; }
  }

  async function nextRound() {
    const cur = engine.latestRoom;
    if (!cur || cur.phase !== "round" || !cur.stage || cur.stage.kind !== "reveal" || busy) return;
    busy = true;
    try {
      const n = cur.roundNo + 1;
      if (n >= cur.totalRounds) { await engine.roomRef.update({ phase: "summary", stage: null, inputs: null }); return; }
      const mode = modes()[cur.mode];
      const next = mode.startRound(makeCtx(cur, n, cur.deck));
      await engine.roomRef.update(commitStage(cur, next, { roundNo: n }));
    } finally { busy = false; }
  }

  // ------------------------- дії хоста -------------------------
  function isHostNow() {
    const room = engine.latestRoom;
    return !!room && engine.computeHost(room.players) === username;
  }

  function updateSettings(partial) {
    const room = engine.latestRoom;
    if (!room || room.phase === "round" || !isHostNow()) return;
    const next = {};
    if (partial && !FIXED_MODE && modes()[partial.mode]) { next.mode = partial.mode; }
    if (FIXED_MODE && modes()[FIXED_MODE] && !room.settings?.mode) next.mode = FIXED_MODE;
    if (partial && [1, 2, 3].includes(Number(partial.level))) next.level = Number(partial.level);
    const courtSpeakSeconds = Number(partial && partial.courtSpeakSeconds);
    if (Number.isInteger(courtSpeakSeconds) && courtSpeakSeconds >= COURT_SPEAK_SECONDS_RANGE[0] && courtSpeakSeconds <= COURT_SPEAK_SECONDS_RANGE[1]) {
      next.courtSpeakSeconds = courtSpeakSeconds;
    }
    for (const key of ["voteSeconds", "betSeconds", "decideSeconds"]) {
      const seconds = Number(partial && partial[key]);
      if (Number.isInteger(seconds) && seconds >= MIN_TIMER_SECONDS && seconds <= MAX_TIMER_SECONDS) next[key] = seconds;
    }
    if (partial && typeof partial.courtAutoAdvance === "boolean") next.courtAutoAdvance = partial.courtAutoAdvance;
    if (Object.keys(next).length) engine.roomRef.child("settings").update(next);
  }

  function startSet(room) {
    room = room || engine.latestRoom;
    if (!room || room.phase === "round" || !isHostNow()) return { ok: false, reason: "not-allowed" };
    const settings = room.settings || {};
    const mode = modes()[FIXED_MODE || settings.mode];
    if (!mode) return { ok: false, reason: "no-mode" };
    const names = connectedNames(room.players);
    if (names.length < mode.minPlayers) return { ok: false, reason: "not-enough-players" };
    // Раундів стільки, скільки питань у колоді рівня: грають, доки не набридне
    const draft = { players: room.players, order: names, totalRounds: Infinity, settings };
    const state = mode.startSet(makeCtx(draft, 0, null));
    draft.totalRounds = state.items.length;
    const first = mode.startRound(makeCtx(draft, 0, state));
    engine.roomRef.update(commitStage(Object.assign({}, room, { stageSeq: 0 }), first, {
      phase: "round", mode: mode.id, setId: engine.now(), order: names, deck: state,
      roundNo: 0, totalRounds: draft.totalRounds, "tally/set": null,
    }));
    return { ok: true };
  }

  // «Далі»: з результату — до наступного раунду; з показу/відповідей — достроково завершити етап
  function skip() {
    const room = engine.latestRoom;
    if (!room || room.phase !== "round" || !room.stage || !isHostNow() || busy) return;
    if (room.stage.kind === "reveal") nextRound(); else endStage(room);
  }
  function endSet() {
    const room = engine.latestRoom;
    if (!room || room.phase !== "round" || !isHostNow()) return;
    engine.roomRef.update({ phase: "summary", stage: null, inputs: null });
  }
  function toLobby() {
    const room = engine.latestRoom;
    if (!room || room.phase !== "summary" || !isHostNow()) return;
    engine.roomRef.update({ phase: "lobby", mode: null, stage: null, inputs: null, deck: null, order: null, roundNo: 0, totalRounds: 0 });
  }
  function resetAll() {
    const roomId = engine.currentRoomId;
    if (!roomId || !isHostNow()) return;
    engine.forceResetRoom(roomId, SCHEMA, buildFreshRoom);
  }

  window.PartyGame = {
    SET_CAP, DEFAULT_LEVEL,
    DEFAULT_COURT_SPEAK_SECONDS, COURT_SPEAK_SECONDS_RANGE, MIN_TIMER_SECONDS, MAX_TIMER_SECONDS, DEFAULT_TIMER_SECONDS,
    connectedNames,
    computeHost: (players) => engine.computeHost(players),
    isConnected: (p) => engine.isConnected(p),
    now: () => engine.now(),
    inputOf, waitingNames,
    watchActiveRooms,
    start, stop, startSet, updateSettings, answer, skip, endSet, toLobby, resetAll, cycleAvatar,
    get username() { return username; },
    get roomId() { return engine.currentRoomId; },
    get roomRef() { return engine.roomRef; },
    set onStateChange(fn) { onStateChange = fn; },
  };
})();
