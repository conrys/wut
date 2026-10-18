// ==========================================================================
// Еліас онлайн — на спільному online-engine.js, номерні кімнати (RoomCodeUI).
// Кожен на своєму телефоні: пояснювач бачить слово й тисне «Вгадали»/«Пропустити»,
// його команда вгадує вголос, суперники бачать слово (контроль чесності).
//
// RTDB: alias_rooms/<код> (правило як у решти: .read true, .write auth != null).
//
// Хто що пише:
//   • пояснювач — слова ходу (words/<i>, cur, pos) — єдиний автор, без гонок;
//     також останнє слово (lastBy), виправлення (words/<i>/ok) і «Зарахувати»;
//   • ведучий (lockedHost) — старт гри, кінець часу (playing → last), налаштування,
//     заміна пояснювача, підстраховує «Зарахувати», якщо пояснювач зник.
// Фази: lobby → ready → playing → last → review → (ready … | over) → lobby
// ==========================================================================
(function () {
  const GAME_KEY = "alias";
  const ABANDON_MS = 20 * 60 * 1000;
  const TICK_MS = 400;
  const DECK_SIZE = 500;
  const MIN_PER_TEAM = 2;
  const TEAM_NAMES = ["Котики", "Їжаки", "Совенята", "Лисички"];
  const TEAM_COLORS = ["#ffe14d", "#ff7eb6", "#7cc7ff", "#b6f36b"];
  const PHASES = ["lobby", "ready", "playing", "last", "review", "over"];

  const SCHEMA = {
    phase: "lobby",
    hostUsername: null,
    settings: { teams: 2, time: 60, target: 50, diff: "mix", penalty: 1 },
    scores: null,      // { "0": бали, "1": бали, … }
    team: 0,           // чий хід
    explainer: null,   // хто пояснює
    explainIdx: null,  // { "0": лічильник черги пояснювачів у команді }
    round: 1,
    turnNo: 0,
    deck: null,        // масив слів (будує ведучий на старті)
    pos: 0,
    cur: null,         // поточне слово
    words: null,       // [{ w, ok }]
    startedAt: null,
    endsAt: null,
    lastBy: null,      // команда, що вгадала останнє слово (-1 — ніхто)
    winner: null,
    players: {},
  };

  const engine = window.OnlineEngine.create(GAME_KEY, { phases: PHASES, lockedHost: true, abandonMs: ABANDON_MS });
  let username = null, onStateChange = () => {}, tickTimer = null, busy = false;

  // ------------------------- аватари (як у решти ігор) -------------------------
  const AVATAR_STORAGE_PREFIX = "games41_quiplash_avatar_";
  const QA = () => window.QuiplashAvatars;
  const CHARACTERS = QA() ? QA().COUNT : 8;
  const charColor = (c) => (QA() ? QA().color(c) : "#0f9b8e");
  function takenChars(room) { return new Set(Object.entries((room && room.players) || {}).filter(([n]) => n !== username).map(([, p]) => Number(p && p.character))); }
  function avatarFor(room) {
    const taken = takenChars(room);
    let want = null;
    try { const p = JSON.parse(localStorage.getItem(AVATAR_STORAGE_PREFIX + username) || "null"); if (p && p.character >= 1 && p.character <= CHARACTERS) want = Number(p.character); } catch (e) {}
    if (want && !taken.has(want)) return { character: want, color: charColor(want) };
    const idx = Object.keys((room && room.players) || {}).length;
    for (let i = 0; i < CHARACTERS; i++) { const c = ((want || idx) + i) % CHARACTERS + 1; if (!taken.has(c)) return { character: c, color: charColor(c) }; }
    const c = (idx % CHARACTERS) + 1; return { character: c, color: charColor(c) };
  }
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

  // ------------------------- команди -------------------------
  const teamCount = (room) => Math.max(2, Math.min(4, Number(room && room.settings && room.settings.teams) || 2));
  function connectedNames(players) { return Object.keys(players || {}).filter((n) => engine.isConnected(players[n])); }
  function teamOf(room, name) { const p = room && room.players && room.players[name]; return p && Number.isInteger(p.team) ? p.team : null; }
  function members(room, t, onlyConnected) {
    const players = room.players || {};
    return Object.keys(players).filter((n) => players[n].team === t && (!onlyConnected || engine.isConnected(players[n])))
      .sort((a, b) => (players[a].joinedAt || 0) - (players[b].joinedAt || 0) || (a < b ? -1 : 1));
  }
  // нова людина — у команду, де найменше гравців
  function smallestTeam(room) {
    const T = teamCount(room); let best = 0, bestN = Infinity;
    for (let t = 0; t < T; t++) { const n = members(room, t, true).length; if (n < bestN) { bestN = n; best = t; } }
    return best;
  }
  function joinTeam(t) {
    const room = engine.latestRoom;
    if (!room || !room.players || !room.players[username] || !Number.isInteger(t) || t < 0 || t >= teamCount(room)) return;
    if (room.phase !== "lobby" && room.phase !== "over") return;
    engine.roomRef.child("players/" + username).update({ team: t });
  }
  function explainerFor(room, t, bump) {
    const list = members(room, t, true);
    if (!list.length) return null;
    const k = ((room.explainIdx && room.explainIdx[t]) || 0) + (bump || 0);
    return list[((k % list.length) + list.length) % list.length];
  }

  // ------------------------- кімнати -------------------------
  function buildFreshRoom() { return { players: {} }; }
  function watchActiveRooms(callback) {
    if (!window.rtdb) { callback([]); return () => {}; }
    const ref = window.rtdb.ref(`${GAME_KEY}_rooms`);
    const onValue = (snap) => {
      const rooms = snap.val() || {}, t = engine.now();
      const list = Object.entries(rooms).map(([roomId, room]) => {
        const players = room.players || {}, connected = connectedNames(players);
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
  async function start(user, roomId) {
    username = user;
    engine.onStateChange = handleEngineEvent;
    engine.start(username, { useLobby: false });
    await engine.getOrCreateRoom(roomId, SCHEMA, buildFreshRoom);
    await engine.joinRoom(roomId, { asPlayer: false });
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(tick, TICK_MS);
  }
  function stop() { if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } engine.stop(); }
  function handleEngineEvent(type, data) {
    if (type !== "room-update") return;
    const room = data.room;
    // у Еліас можна заходити будь-коли — новенький стає в найменшу команду
    if (!(room.players && room.players[username])) engine.becomePlayer({ ...avatarFor(room), team: smallestTeam(room) });
    else if (!Number.isInteger(room.players[username].team)) engine.roomRef.child("players/" + username).update({ team: smallestTeam(room) });
    onStateChange(room, { username, host: engine.computeHost(room.players) === username });
  }

  // ------------------------- колода -------------------------
  function buildDeck(diff) {
    const lvls = diff === "easy" ? ["easy", "medium"] : diff === "hard" ? ["medium", "hard"] : ["easy", "medium", "hard"];
    const pool = new Set(), A = window.ALIAS_WORDS || {};
    lvls.forEach((l) => (A[l] || []).forEach((w) => pool.add(w)));
    const extra = [];
    try { if (typeof CROCODILE_THEMES !== "undefined") extra.push(...CROCODILE_THEMES); if (typeof WHOAMI_THEMES !== "undefined") extra.push(...WHOAMI_THEMES); } catch (e) {}
    extra.forEach((t) => lvls.forEach((l) => (t[l] || []).forEach((w) => pool.add(String(w).trim()))));
    const list = Array.from(pool).filter(Boolean);
    const PH = window.PromptHistory;
    const ordered = PH ? PH.order("alias", list, (x) => x.toLowerCase()) : list.sort(() => Math.random() - 0.5);
    const deck = ordered.slice(0, DECK_SIZE);
    if (PH) PH.mark("alias", deck.slice(0, 120).map((x) => x.toLowerCase()));
    return deck;
  }

  // ------------------------- дії ведучого -------------------------
  const isHostNow = () => { const r = engine.latestRoom; return !!r && engine.computeHost(r.players) === username; };
  function updateSettings(partial) {
    const room = engine.latestRoom;
    if (!room || room.phase !== "lobby" || !isHostNow()) return;
    const n = {};
    if ([2, 3, 4].includes(Number(partial.teams))) n.teams = Number(partial.teams);
    if ([30, 60, 90].includes(Number(partial.time))) n.time = Number(partial.time);
    if ([30, 50, 80].includes(Number(partial.target))) n.target = Number(partial.target);
    if (["easy", "mix", "hard"].includes(partial.diff)) n.diff = partial.diff;
    if ([0, 1].includes(Number(partial.penalty))) n.penalty = Number(partial.penalty);
    if (!Object.keys(n).length) return;
    const u = {}; Object.entries(n).forEach(([k, v]) => { u["settings/" + k] = v; });
    // менше команд — гравців із «зниклих» команд переселяємо
    if (n.teams) Object.entries(room.players || {}).forEach(([name, p]) => { if (Number.isInteger(p.team) && p.team >= n.teams) u[`players/${name}/team`] = p.team % n.teams; });
    engine.roomRef.update(u);
  }
  function canStart(room) {
    const T = teamCount(room);
    for (let t = 0; t < T; t++) if (members(room, t, true).length < MIN_PER_TEAM) return { ok: false, reason: `У кожній команді мінімум ${MIN_PER_TEAM} гравці онлайн` };
    return { ok: true };
  }
  function startGame() {
    const room = engine.latestRoom;
    if (!room || !isHostNow() || (room.phase !== "lobby" && room.phase !== "over") || !canStart(room).ok) return;
    const T = teamCount(room), scores = {}, explainIdx = {};
    for (let t = 0; t < T; t++) { scores[t] = 0; explainIdx[t] = 0; }
    const deck = buildDeck(room.settings && room.settings.diff);
    const fresh = Object.assign({}, room, { explainIdx });
    engine.roomRef.update({
      phase: "ready", scores, explainIdx, team: 0, round: 1, turnNo: 0, deck, pos: 0, cur: null, words: null,
      startedAt: null, endsAt: null, lastBy: null, winner: null, explainer: explainerFor(fresh, 0),
    });
  }
  // ведучий міняє пояснювача, якщо той не відповідає
  function nextExplainer() {
    const room = engine.latestRoom;
    if (!room || !isHostNow() || room.phase !== "ready") return;
    const t = room.team, idx = Object.assign({}, room.explainIdx || {});
    idx[t] = (idx[t] || 0) + 1;
    engine.roomRef.update({ explainIdx: idx, explainer: explainerFor(Object.assign({}, room, { explainIdx: idx }), t) });
  }
  function toLobby() {
    const room = engine.latestRoom;
    if (!room || !isHostNow()) return;
    engine.roomRef.update({ phase: "lobby", scores: null, explainer: null, deck: null, pos: 0, cur: null, words: null, startedAt: null, endsAt: null, lastBy: null, winner: null,
      paused: null, pausedAt: null, pausedByName: null });
  }

  // ------------------------- дії пояснювача -------------------------
  const iExplain = (room) => !!room && room.explainer === username;
  const canDrive = (room) => iExplain(room) || (isHostNow() && !engine.isConnected((room.players || {})[room.explainer]));
  function beginTurn() {
    const room = engine.latestRoom;
    if (!room || room.phase !== "ready" || room.paused || !canDrive(room)) return;
    const deck = room.deck || [], pos = room.pos || 0, t = engine.now();
    engine.roomRef.update({
      phase: "playing", startedAt: t, endsAt: t + (Number(room.settings && room.settings.time) || 60) * 1000,
      cur: deck.length ? deck[pos % deck.length] : "слово", pos: pos + 1, words: null, lastBy: null,
    });
  }
  function mark(ok) {
    const room = engine.latestRoom;
    if (!room || room.phase !== "playing" || room.paused || !iExplain(room) || !room.cur) return false;
    if (room.endsAt && engine.now() >= room.endsAt) return false;
    const words = room.words || [], deck = room.deck || [], pos = room.pos || 0;
    engine.roomRef.update({ [`words/${words.length}`]: { w: room.cur, ok: !!ok }, cur: deck.length ? deck[pos % deck.length] : room.cur, pos: pos + 1 });
    return true;
  }
  function setLast(teamIdx) {
    const room = engine.latestRoom;
    if (!room || room.phase !== "last" || !canDrive(room)) return;
    const t = Number(teamIdx);
    engine.roomRef.update({ lastBy: Number.isInteger(t) && t >= -1 && t < teamCount(room) ? t : -1, phase: "review" });
  }
  function toggleWord(i) {
    const room = engine.latestRoom;
    if (!room || room.phase !== "review" || !canDrive(room)) return;
    const w = (room.words || [])[i];
    if (w) engine.roomRef.child(`words/${i}/ok`).set(!w.ok);
  }
  function turnPoints(room) {
    const words = room.words || [], got = words.filter((w) => w && w.ok).length, sk = words.filter((w) => w && !w.ok).length;
    const pen = Number(room.settings && room.settings.penalty) ? sk : 0;
    return got - pen + (room.lastBy === room.team ? 1 : 0);
  }
  async function confirmTurn() {
    const room = engine.latestRoom;
    if (busy || !room || room.phase !== "review" || !(canDrive(room) || isHostNow())) return;
    busy = true;
    try {
      const T = teamCount(room), scores = Object.assign({}, room.scores || {});
      scores[room.team] = (scores[room.team] || 0) + turnPoints(room);
      if (Number.isInteger(room.lastBy) && room.lastBy >= 0 && room.lastBy !== room.team) scores[room.lastBy] = (scores[room.lastBy] || 0) + 1;
      const idx = Object.assign({}, room.explainIdx || {});
      idx[room.team] = (idx[room.team] || 0) + 1;
      const nextTeam = (room.team + 1) % T, wrapped = nextTeam === 0;
      const u = { scores, explainIdx: idx, turnNo: (room.turnNo || 0) + 1, team: nextTeam, words: null, cur: null, lastBy: null, startedAt: null, endsAt: null };
      if (wrapped) {
        u.round = (room.round || 1) + 1;
        const vals = Array.from({ length: T }, (_, t) => scores[t] || 0), best = Math.max(...vals);
        const target = Number(room.settings && room.settings.target) || 50;
        if (best >= target && vals.filter((v) => v === best).length === 1) {
          u.phase = "over"; u.winner = vals.indexOf(best); u.explainer = null;
          await engine.roomRef.update(u); return;
        }
      }
      u.phase = "ready";
      u.explainer = explainerFor(Object.assign({}, room, { explainIdx: idx }), nextTeam);
      await engine.roomRef.update(u);
    } finally { busy = false; }
  }

  // ------------------------- тік ведучого -------------------------
  function tick() {
    const room = engine.latestRoom;
    if (!room || !engine.isHost || room.paused) return;
    if (room.phase === "playing" && room.endsAt && engine.now() >= room.endsAt) engine.roomRef.update({ phase: "last" });
    // у команди, що ходить, зник пояснювач — призначаємо іншого
    if (room.phase === "ready" && room.explainer && !engine.isConnected((room.players || {})[room.explainer])) {
      const other = explainerFor(room, room.team, 1);
      if (other && other !== room.explainer) {
        const idx = Object.assign({}, room.explainIdx || {}); idx[room.team] = (idx[room.team] || 0) + 1;
        engine.roomRef.update({ explainIdx: idx, explainer: other });
      }
    }
  }

  window.AliasGame = {
    TEAM_NAMES, TEAM_COLORS, MIN_PER_TEAM,
    start, stop, watchActiveRooms, cycleAvatar, joinTeam, updateSettings, canStart, startGame, nextExplainer, toLobby,
    beginTurn, mark, setLast, toggleWord, confirmTurn, turnPoints,
    teamCount, teamOf, members, connectedNames, iExplain, canDrive,
    computeHost: (p) => engine.computeHost(p), isConnected: (p) => engine.isConnected(p), now: () => engine.now(),
    get roomRef() { return engine.roomRef; }, get roomId() { return engine.currentRoomId; },
    set onStateChange(fn) { onStateChange = fn; },
  };
})();
