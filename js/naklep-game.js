// ==========================================================================
// «Наклеп» — окрема гра на спільному OnlineEngine (js/online-engine.js).
// Самодостатня: НЕ залежить від party-game.js / party-modes.js / party-seed.js
// і нічого в них не змінює. Підключати ПІСЛЯ firebase-config.js, login.js,
// online-engine.js, naklep-prompts.js. Кімнати: "naklep_rooms".
//
// Фази: lobby (факти гравців + налаштування) → round (етапи) → summary → lobby…
// Етап (room.stage) описує, що зараз бачать телефони:
//   kind "choice"    — «Це про мене?» (лише для готових фактів, таємно)
//   kind "pick-name" — вгадати, чий факт
//   kind "reveal"    — результат (headline, bars, lines, penalties, points)
// Рішення (коли переходити далі) приймає ОДИН клієнт — хост (lockedHost).
// Ковтки обмежені SET_CAP на гравця за набір.
// ==========================================================================
(function () {
  const GAME_KEY = "naklep";
  const PHASES = ["lobby", "round", "summary"];
  const TICK_MS = 500;
  const SET_CAP = 6;
  const MIN_PLAYERS = 4;
  const ROUND_OPTIONS = [4, 6, 8, 12];
  const DEFAULT_ROUNDS = 6;
  const DEFAULT_LEVEL = 2;
  const MIN_TIMER_SEC = 20, MAX_TIMER_SEC = 120;
  const DEFAULT_VOTE_SEC = 60;
  const MAX_FACTS = 3, FACT_MAX_LEN = 120;
  const SPARE = 6;                 // запасні факти для «Пропустити факт»
  const REVEAL_MS = 45000;
  const ABANDON_MS = 15 * 60 * 1000;
  const AVATAR_STORAGE_PREFIX = "games41_quiplash_avatar_";
  const AVATAR_COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6", "#1abc9c", "#e67e22", "#ff6fa5"];
  const CHARACTERS = 8;
  const CONFESS = [{ id: "yes", label: "✋ Так, це про мене" }, { id: "no", label: "🙅 Ні" }];

  const SCHEMA = {
    phase: "lobby",
    hostUsername: null,
    settings: { rounds: DEFAULT_ROUNDS, level: DEFAULT_LEVEL, voteSec: DEFAULT_VOTE_SEC },
    setId: null,
    order: null,       // хто грає цей набір (підключені на старті)
    deck: null,        // { items: [{ t: текст, o: автор | відсутній для готових }] }
    roundNo: 0,
    totalRounds: 0,
    stage: null,
    stageSeq: 0,
    inputs: null,      // inputs/<ім'я> = "<id етапу>:<значення>"
    facts: null,       // facts/<ім'я>/<ключ> = текст; чиститься на старті набору
    tally: null,       // tally/drinks, tally/points — на весь вечір; tally/set — ковтки цього набору
    players: {},
  };

  const engine = window.OnlineEngine.create(GAME_KEY, { phases: PHASES, lockedHost: true, abandonMs: ABANDON_MS });

  let username = null;
  let onStateChange = () => {};
  let tickTimer = null;
  let busy = false;

  function buildFreshRoom() { return { players: {}, settings: { rounds: DEFAULT_ROUNDS, level: DEFAULT_LEVEL, voteSec: DEFAULT_VOTE_SEC } }; }
  function connectedNames(players) {
    return Object.entries(players || {}).filter(([, p]) => engine.isConnected(p)).map(([n]) => n);
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function voteMsOf(room) {
    const seconds = Number((room.settings || {}).voteSec) || DEFAULT_VOTE_SEC;
    return Math.min(MAX_TIMER_SEC, Math.max(MIN_TIMER_SEC, seconds)) * 1000;
  }

  // ------------------------- аватари (як у Смішлісті) -------------------------
  function avatarFor(room) {
    try {
      const raw = window.localStorage && window.localStorage.getItem(AVATAR_STORAGE_PREFIX + username);
      const profile = raw ? JSON.parse(raw) : null;
      if (profile && profile.character >= 1 && profile.character <= CHARACTERS) {
        return { character: profile.character, color: profile.color || AVATAR_COLORS[(profile.character - 1) % AVATAR_COLORS.length] };
      }
    } catch (e) { /* немає localStorage — беремо за чергою */ }
    const idx = Object.keys((room && room.players) || {}).length;
    return { character: (idx % CHARACTERS) + 1, color: AVATAR_COLORS[(idx + Math.floor(idx / CHARACTERS)) % AVATAR_COLORS.length] };
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
    engine.roomRef.update({ ["inputs/" + username]: st.id + ":" + value });
    return { ok: true };
  }
  function waitingNames(room) {
    const st = room.stage; if (!st) return [];
    const inputs = validInputs(room), players = room.players || {};
    return (st.expect || []).filter((n) => inputs[n] === undefined && engine.isConnected(players[n]));
  }

  // ------------------------- логіка гри: колода фактів -------------------------
  function buildItems(room, order, level, totalRounds) {
    const need = totalRounds + SPARE;
    const queues = shuffle(order.slice()).map((n) => {
      const raw = Object.values((room.facts && room.facts[n]) || {}).filter((t) => typeof t === "string" && t.trim()).map((t) => t.trim().slice(0, 140));
      return shuffle(raw).map((t) => ({ t, o: n }));
    });
    const own = []; // по колу: по одному факту від кожного, щоб один балакучий не забив усю колоду
    for (let i = 0; queues.some((q) => q[i]); i++) queues.forEach((q) => { if (q[i]) own.push(q[i]); });
    const pool = shuffle((window.NaklepPrompts || []).filter((x) => x.level <= level)).map((x) => ({ t: x.text }));
    const seen = new Set();
    const all = own.slice(0, need).concat(pool).filter((it) => {
      const k = it.t.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    return shuffle(all.slice(0, need));
  }

  function stageFor(room, idx) {
    const items = (room.deck && room.deck.items) || [];
    const order = room.order || [];
    const item = items[idx % items.length], text = "«" + item.t + "»", ms = voteMsOf(room);
    if (item.o) {
      return { kind: "pick-name", title: "Наклеп", text, hint: "Чий це факт? Обери одне ім'я", names: order.slice(), expect: order.filter((n) => n !== item.o), durationMs: ms, data: { step: "vote", idx, owner: item.o } };
    }
    return { kind: "choice", title: "Зізнання", text, hint: "Це про тебе? Відповідай чесно: ніхто не бачить твоєї відповіді", options: CONFESS, expect: order.slice(), durationMs: ms, data: { step: "confess", idx } };
  }

  function sortedCounts(counts) {
    return Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  }
  function reveal(stage, fields) {
    return Object.assign({ kind: "reveal", title: "Результат", text: stage.text, roles: [], durationMs: REVEAL_MS, bars: [], lines: [], penalties: {}, points: {} }, fields);
  }

  // Наступний етап після завершення поточного (stage — той, що закінчився).
  function nextStage(room, stage, inputs) {
    const order = room.order || [], d = stage.data || {};
    if (d.step === "confess") {
      const yes = order.filter((n) => inputs[n] === "yes");
      if (!yes.length) return reveal(stage, { headline: "🤥 Ніхто не зізнався", lines: ["Або цього не було ні в кого, або всі брешуть"], durationMs: 8000, data: d });
      return { kind: "pick-name", title: "Наклеп", text: stage.text, hint: "Хто з нас зізнався? Обери одне ім'я", names: order.slice(), expect: order.slice(), durationMs: voteMsOf(room), data: { step: "vote", idx: d.idx, yes } };
    }
    const counts = {};
    Object.entries(inputs).forEach(([voter, t]) => { if (order.includes(t) && t !== voter) counts[t] = (counts[t] || 0) + 1; });
    const V = Object.keys(inputs).filter((v) => order.includes(v)).length;
    const barsOf = (extra) => {
      const b = sortedCounts(counts).slice(0, 8).map(([name, value]) => ({ name, value }));
      (extra || []).forEach((n) => { if (!counts[n]) b.push({ name: n, value: 0 }); });
      return b;
    };
    if (d.owner) { // факт написав гравець — автор відомий
      const owner = d.owner, hits = counts[owner] || 0;
      const roles = [{ label: "Автор", name: owner }], head = `🗣️ Це факт від ${owner}`;
      const hitters = Object.keys(inputs).filter((v) => inputs[v] === owner);
      const points = {}; hitters.forEach((n) => { points[n] = 1; });
      if (!V) return reveal(stage, { headline: head, roles, bars: barsOf([owner]), lines: ["Ніхто не проголосував"], data: d });
      if (hits / V >= 0.5) return reveal(stage, { headline: head, roles, bars: barsOf([owner]), lines: [`${hits} з ${V} впізнали: ${owner} п'є, бо викрили`, `Вгадали (+1 бал): ${hitters.join(", ")}`], penalties: { [owner]: 1 }, points, data: d });
      if (!hits) {
        const penalties = {}; Object.keys(inputs).forEach((n) => { penalties[n] = 1; });
        return reveal(stage, { headline: head, roles, bars: barsOf([owner]), lines: [`Ніхто не здогадався: ${owner} усіх обдурив(ла) (+1 бал)`, "Усі, хто гадав, п'ють"], penalties, points: { [owner]: 1 }, data: d });
      }
      if (hits / V < 1 / 3) points[owner] = 1;
      return reveal(stage, { headline: head, roles, bars: barsOf([owner]), lines: [`${hits} з ${V} впізнали, без ковтків`, `Вгадали (+1 бал): ${hitters.join(", ")}`].concat(points[owner] ? [`${owner} майже обдурив(ла): +1 бал`] : []), points, data: d });
    }
    // готовий факт: «власники» — ті, хто таємно зізнався
    const yes = d.yes || [], thr = Math.max(2, Math.ceil(V / 4));
    const penalties = {}, points = {};
    yes.forEach((y) => { if ((counts[y] || 0) >= thr) penalties[y] = 1; else points[y] = 1; });
    Object.entries(inputs).forEach(([voter, t]) => { if (yes.includes(t) && t !== voter) points[voter] = (points[voter] || 0) + 1; });
    const exposed = Object.keys(penalties), safe = yes.filter((y) => !penalties[y]);
    const guessers = Object.keys(inputs).filter((v) => yes.includes(inputs[v]) && inputs[v] !== v);
    return reveal(stage, {
      headline: `🫣 Це про: ${yes.join(", ")}`, roles: yes.map((n) => ({ label: "Зізнався(лась)", name: n })), bars: barsOf(yes),
      lines: [exposed.length ? `Розкусили (від ${thr} голосів), ковток: ${exposed.join(", ")}` : "", safe.length ? `Не розкусили (+1 бал): ${safe.join(", ")}` : "", guessers.length ? `Вгадали (+1 бал): ${guessers.join(", ")}` : ""].filter(Boolean),
      penalties, points, data: d,
    });
  }

  // ------------------------- рішення хоста -------------------------
  function progress(room) {
    if (busy || room.phase !== "round" || !room.stage) return;
    const st = room.stage, now = engine.now();
    if (st.kind === "reveal") { if (st.endsAt && now >= st.endsAt) nextRound(); return; }
    const expect = st.expect || [];
    const allIn = expect.length > 0 && waitingNames(room).length === 0;
    if (allIn || (st.endsAt && now >= st.endsAt)) endStage(room);
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
      await engine.roomRef.update(commitStage(cur, nextStage(cur, cur.stage, validInputs(cur))));
    } finally { busy = false; }
  }

  async function nextRound() {
    const cur = engine.latestRoom;
    if (!cur || cur.phase !== "round" || !cur.stage || cur.stage.kind !== "reveal" || busy) return;
    busy = true;
    try {
      const n = cur.roundNo + 1;
      if (n >= cur.totalRounds) { await engine.roomRef.update({ phase: "summary", stage: null, inputs: null }); return; }
      const prev = cur.stage.data;
      const idx = prev && typeof prev.idx === "number" ? prev.idx + 1 : n;
      await engine.roomRef.update(commitStage(cur, stageFor(cur, idx), { roundNo: n }));
    } finally { busy = false; }
  }

  // ------------------------- факти гравців (лобі) -------------------------
  function addFact(text) {
    const room = engine.latestRoom;
    if (!room || room.phase === "round" || !(room.players && room.players[username])) return { ok: false, reason: "not-allowed" };
    const t = String(text == null ? "" : text).replace(/\s+/g, " ").trim().slice(0, FACT_MAX_LEN);
    if (t.length < 3) return { ok: false, reason: "too-short" };
    const mine = Object.values((room.facts && room.facts[username]) || {});
    if (mine.length >= MAX_FACTS) return { ok: false, reason: "limit" };
    if (mine.some((x) => String(x).toLowerCase() === t.toLowerCase())) return { ok: false, reason: "duplicate" };
    engine.roomRef.child("facts/" + username).push(t);
    return { ok: true };
  }
  function removeFact(key) {
    const room = engine.latestRoom;
    if (!room || room.phase === "round" || !key) return;
    engine.roomRef.child("facts/" + username + "/" + key).remove();
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
    if (partial && ROUND_OPTIONS.includes(Number(partial.rounds))) next.rounds = Number(partial.rounds);
    if (partial && [1, 2, 3].includes(Number(partial.level))) next.level = Number(partial.level);
    const voteSec = Number(partial && partial.voteSec);
    if (Number.isInteger(voteSec) && voteSec >= MIN_TIMER_SEC && voteSec <= MAX_TIMER_SEC) next.voteSec = voteSec;
    if (Object.keys(next).length) engine.roomRef.child("settings").update(next);
  }

  function startSet(room) {
    room = room || engine.latestRoom;
    if (!room || room.phase === "round" || !isHostNow()) return { ok: false, reason: "not-allowed" };
    const names = connectedNames(room.players);
    if (names.length < MIN_PLAYERS) return { ok: false, reason: "not-enough-players" };
    const settings = room.settings || {};
    const total = settings.rounds || DEFAULT_ROUNDS, level = settings.level || DEFAULT_LEVEL;
    const items = buildItems(room, names, level, total);
    if (!items.length) return { ok: false, reason: "no-facts" };
    const draft = Object.assign({}, room, { stageSeq: 0, order: names, deck: { items } });
    engine.roomRef.update(commitStage(draft, stageFor(draft, 0), {
      phase: "round", setId: engine.now(), order: names, deck: { items },
      roundNo: 0, totalRounds: total, "tally/set": null, facts: null, // факти спожито — наступний набір збирає нові
    }));
    return { ok: true };
  }

  // «Далі»: з результату — до наступного раунду; з відповідей — достроково завершити етап
  function skip() {
    const room = engine.latestRoom;
    if (!room || room.phase !== "round" || !room.stage || !isHostNow() || busy) return;
    if (room.stage.kind === "reveal") nextRound(); else endStage(room);
  }
  // Хост міняє поточний факт на наступний (без ковтків і балів, раунд той самий).
  async function skipItem() {
    const room = engine.latestRoom;
    if (!room || room.phase !== "round" || !room.stage || room.stage.kind === "reveal" || !isHostNow() || busy) return;
    busy = true;
    try {
      const cur = engine.latestRoom;
      if (!cur || !cur.stage || cur.stage.id !== room.stage.id) return;
      const idx = ((cur.stage.data && cur.stage.data.idx) || 0) + 1;
      await engine.roomRef.update(commitStage(cur, stageFor(cur, idx)));
    } finally { busy = false; }
  }
  function endSet() {
    const room = engine.latestRoom;
    if (!room || room.phase !== "round" || !isHostNow()) return;
    engine.roomRef.update({ phase: "summary", stage: null, inputs: null });
  }
  function toLobby() {
    const room = engine.latestRoom;
    if (!room || room.phase !== "summary" || !isHostNow()) return;
    engine.roomRef.update({ phase: "lobby", stage: null, inputs: null, deck: null, order: null, roundNo: 0, totalRounds: 0 });
  }
  function resetAll() {
    const roomId = engine.currentRoomId;
    if (!roomId || !isHostNow()) return;
    engine.forceResetRoom(roomId, SCHEMA, buildFreshRoom);
  }

  window.NaklepGame = {
    SET_CAP, MIN_PLAYERS, ROUND_OPTIONS, DEFAULT_ROUNDS, DEFAULT_LEVEL, MIN_TIMER_SEC, MAX_TIMER_SEC, DEFAULT_VOTE_SEC, MAX_FACTS,
    connectedNames,
    computeHost: (players) => engine.computeHost(players),
    isConnected: (p) => engine.isConnected(p),
    now: () => engine.now(),
    inputOf, waitingNames,
    watchActiveRooms,
    start, stop, startSet, updateSettings, answer, skip, skipItem, addFact, removeFact, endSet, toLobby, resetAll,
    get roomId() { return engine.currentRoomId; },
    get roomRef() { return engine.roomRef; },
    set onStateChange(fn) { onStateChange = fn; },
  };
})();
