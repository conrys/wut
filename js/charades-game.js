// ==========================================================================
// «Зіпсовані шаради» — окрема гра на спільному OnlineEngine (js/online-engine.js).
// Самодостатня: не залежить від party-*.js / naklep-*.js / fakenews-*.js.
// Кімнати: "charades_rooms". Слова: js/charades-prompts.js (window.CharadesPrompts).
//
// Раунд (шифрувальник змінюється по колу):
//   encode — шифрувальник бачить слово й шифрує його ЛИШЕ емодзі (панель або клавіатура);
//            може один раз замінити слово («r»);
//   guess  — решта друкують відповідь; перший правильний +3, другий +2, далі +1;
//            після першого правильного лишається CUT_MS, щоб не чекати весь таймер;
//   reveal — результат. Шифрувальник: +1 за кожного, хто вгадав; якщо ніхто — п'є.
// Правильність відповіді перевіряє клієнт відгадувача (допуск на 1–2 одруківки);
// в кімнату пишеться лише факт вгадування з серверним часом (для порядку).
// Підключати ПІСЛЯ firebase-config.js, login.js, online-engine.js, charades-prompts.js.
// ==========================================================================
(function () {
  const GAME_KEY = "charades";
  const PHASES = ["lobby", "round", "summary"];
  const TICK_MS = 500;
  const SET_CAP = 6;
  const MIN_PLAYERS = 3;
  const LAPS_OPTIONS = [1, 2], DEFAULT_LAPS = 1;          // кіл: кожен шифрує по разу за коло
  const ENCODE_OPTIONS = [20, 30, 45], DEFAULT_ENCODE_SEC = 30;
  const GUESS_OPTIONS = [30, 45, 60], DEFAULT_GUESS_SEC = 45;
  const DEFAULT_LEVEL = 2;
  const CUT_MS = 15000;          // скільки лишається після першої правильної відповіді
  const SPARE = 4;               // запасні слова для «Інше слово»
  const EMOJI_MAX = 40;          // символів у шифрі
  const GUESS_COOLDOWN_MS = 1000;
  const REVEAL_MS = 45000;
  const ABANDON_MS = 15 * 60 * 1000;
  const AVATAR_STORAGE_PREFIX = "games41_quiplash_avatar_";
  const AVATAR_COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6", "#1abc9c", "#e67e22", "#ff6fa5"];
  const CHARACTERS = 8;

  const SCHEMA = {
    phase: "lobby",
    hostUsername: null,
    settings: { laps: DEFAULT_LAPS, level: DEFAULT_LEVEL, encodeSec: DEFAULT_ENCODE_SEC, guessSec: DEFAULT_GUESS_SEC },
    setId: null,
    order: null,       // хто грає цей набір; шифрувальник = order[roundNo % order.length]
    deck: null,        // { items: [{ text, alt, cat }] }
    roundNo: 0,
    totalRounds: 0,
    stage: null,
    stageSeq: 0,
    inputs: null,      // inputs/<ім'я> = "<id етапу>:<значення>"
    tally: null,
    players: {},
  };

  const engine = window.OnlineEngine.create(GAME_KEY, { phases: PHASES, lockedHost: true, abandonMs: ABANDON_MS });

  let username = null;
  let onStateChange = () => {};
  let tickTimer = null;
  let busy = false;
  let lastGuessAt = 0;

  function defaultSettings() { return { laps: DEFAULT_LAPS, level: DEFAULT_LEVEL, encodeSec: DEFAULT_ENCODE_SEC, guessSec: DEFAULT_GUESS_SEC }; }
  function buildFreshRoom() { return { players: {}, settings: defaultSettings() }; }
  function connectedNames(players) {
    return Object.entries(players || {}).filter(([, p]) => engine.isConnected(p)).map(([n]) => n);
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function ms(room, key, defSec) { return (((room.settings || {})[key]) || defSec) * 1000; }

  // ------------------------- аватари (як у Смішлісті) -------------------------
  function avatarFor(room) {
    try {
      const raw = window.localStorage && window.localStorage.getItem(AVATAR_STORAGE_PREFIX + username);
      const profile = raw ? JSON.parse(raw) : null;
      if (profile && profile.character >= 1 && profile.character <= CHARACTERS) {
        return { character: profile.character, color: profile.color || AVATAR_COLORS[(profile.character - 1) % AVATAR_COLORS.length] };
      }
    } catch (e) { /* немає localStorage */ }
    const idx = Object.keys((room && room.players) || {}).length;
    return { character: (idx % CHARACTERS) + 1, color: AVATAR_COLORS[(idx + Math.floor(idx / CHARACTERS)) % AVATAR_COLORS.length] };
  }

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
  function inputOf(room, name) { const v = validInputs(room)[name]; return v === undefined ? null : v; }
  function waitingNames(room) {
    const st = room.stage; if (!st) return [];
    const inputs = validInputs(room), players = room.players || {};
    return (st.expect || []).filter((n) => inputs[n] === undefined && engine.isConnected(players[n]));
  }

  // --- шифр: лише емодзі (жодних літер і цифр), не менше двох ---
  function emojiCount(t) {
    const pic = t.match(/\p{Extended_Pictographic}/gu) || [], flags = t.match(/\p{Regional_Indicator}/gu) || [];
    return pic.length + Math.floor(flags.length / 2);
  }
  function checkEmoji(text) {
    const t = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
    if (!t) return { ok: false, reason: "empty" };
    if (/[\p{L}\p{N}]/u.test(t)) return { ok: false, reason: "letters" };      // літери/цифри заборонені
    if (Array.from(t).length > EMOJI_MAX) return { ok: false, reason: "too-long" };
    if (emojiCount(t) < 2) return { ok: false, reason: "too-few" };
    return { ok: true, value: t };
  }
  function submitEmoji(text) {
    const room = engine.latestRoom, st = room && room.stage;
    if (!room || room.phase !== "round" || !st || st.kind !== "encode") return { ok: false, reason: "wrong-phase" };
    if (st.data.encoder !== username) return { ok: false, reason: "not-encoder" };
    const c = checkEmoji(text);
    if (!c.ok) return c;
    engine.roomRef.update({ ["inputs/" + username]: st.id + ":e:" + c.value });
    return { ok: true };
  }
  function rerollWord() {
    const room = engine.latestRoom, st = room && room.stage;
    if (!room || room.phase !== "round" || !st || st.kind !== "encode") return { ok: false, reason: "wrong-phase" };
    if (st.data.encoder !== username || st.data.rerolled) return { ok: false, reason: "not-allowed" };
    engine.roomRef.update({ ["inputs/" + username]: st.id + ":r" });
    return { ok: true };
  }

  // --- відповідь: нечітке порівняння ---
  function norm(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/ё/g, "е").replace(/[’ʼ'`ʹ]/g, "").replace(/[^\p{L}\p{N}]+/gu, "");
  }
  function lev(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return dp[a.length][b.length];
  }
  function matches(guess, answers) {
    const g = norm(guess);
    if (!g) return false;
    return (answers || []).some((a) => {
      const n = norm(a);
      if (!n) return false;
      if (g === n) return true;
      const tol = n.length <= 4 ? 0 : n.length <= 9 ? 1 : 2;   // коротке слово — без помилок
      return Math.abs(g.length - n.length) <= tol && lev(g, n) <= tol;
    });
  }
  // Повертає { ok:true, hit } (hit — чи правильно). Правильну відповідь фіксуємо з серверним часом.
  function guess(text) {
    const room = engine.latestRoom, st = room && room.stage;
    if (!room || room.phase !== "round" || !st || st.kind !== "guess") return { ok: false, reason: "wrong-phase" };
    if (!(st.expect || []).includes(username)) return { ok: false, reason: "not-expected" };
    if (inputOf(room, username) !== null) return { ok: false, reason: "already-solved" };
    const t = engine.now();
    if (Date.now() - lastGuessAt < GUESS_COOLDOWN_MS) return { ok: false, reason: "too-fast" };
    lastGuessAt = Date.now();
    if (!matches(text, (st.data && st.data.answers) || [])) return { ok: true, hit: false };
    engine.roomRef.update({ ["inputs/" + username]: st.id + ":" + t });
    return { ok: true, hit: true };
  }

  // ------------------------- колода й етапи -------------------------
  function buildItems(level, total) {
    const all = (window.CharadesPrompts || []).filter((x) => x.level <= level);
    return shuffle(all).slice(0, total + SPARE).map((x) => ({ text: x.text, alt: x.alt || [], cat: x.cat || "" }));
  }
  function encodeStage(room, idx, encoder, rerolled) {
    const items = (room.deck && room.deck.items) || [], it = items[idx % items.length];
    const words = String(it.text).trim().split(/\s+/).length;
    return {
      kind: "encode", title: "Шифрування", hint: "", expect: [encoder], durationMs: ms(room, "encodeSec", DEFAULT_ENCODE_SEC),
      data: { step: "encode", idx, encoder, text: it.text, answers: [it.text].concat(it.alt || []), cat: it.cat, words, rerolled: !!rerolled },
    };
  }
  function reveal(stage, fields) {
    return Object.assign({ kind: "reveal", title: "Результат", durationMs: REVEAL_MS, results: [], lines: [], penalties: {}, points: {} }, fields);
  }
  function nextStage(room, stage, inputs) {
    const order = room.order || [], d = stage.data || {};
    if (d.step === "encode") {
      const v = inputs[d.encoder];
      if (typeof v === "string" && v.indexOf("e:") === 0) {
        const emoji = v.slice(2);
        const hint = d.cat ? `${d.cat} · ${d.words} ${d.words === 1 ? "слово" : d.words < 5 ? "слова" : "слів"}` : "";
        return {
          kind: "guess", title: "Відгадай", hint, emoji, expect: order.filter((n) => n !== d.encoder), durationMs: ms(room, "guessSec", DEFAULT_GUESS_SEC),
          data: Object.assign({}, d, { step: "guess", cut: false }),
        };
      }
      return reveal(stage, { headline: "😴 Шифрувальник не встиг", lines: [`Слово було: «${d.text}»`], durationMs: 8000, data: d, encoder: d.encoder });
    }
    // guess → результат
    const solves = Object.entries(inputs)
      .filter(([n]) => order.includes(n) && n !== d.encoder)
      .map(([n, v]) => ({ n, t: Number(v) })).filter((x) => isFinite(x.t))
      .sort((a, b) => a.t - b.t || (a.n < b.n ? -1 : 1));
    const points = {}, penalties = {};
    const results = solves.map((s, i) => { const pts = i === 0 ? 3 : i === 1 ? 2 : 1; points[s.n] = pts; return { n: s.n, pts }; });
    const lines = [];
    if (solves.length) {
      points[d.encoder] = (points[d.encoder] || 0) + solves.length;
      lines.push(`${d.encoder} отримує +${solves.length} за тих, хто вгадав`);
    } else {
      penalties[d.encoder] = 1;
      lines.push(`Ніхто не вгадав: ${d.encoder} п'є за надто складний ребус`);
    }
    return reveal(stage, {
      headline: `✅ Це було: «${d.text}»`, emoji: stage.emoji, results, lines, penalties, points, data: d, encoder: d.encoder,
    });
  }

  // ------------------------- рішення хоста -------------------------
  function progress(room) {
    if (busy || room.phase !== "round" || !room.stage) return;
    const st = room.stage, now = engine.now(), d = st.data || {};
    if (st.kind === "reveal") { if (st.endsAt && now >= st.endsAt) nextRound(); return; }
    if (st.kind === "encode" && validInputs(room)[d.encoder] === "r" && !d.rerolled) { reroll(room); return; }
    if (st.kind === "guess" && !d.cut && Object.keys(validInputs(room)).length > 0 && st.endsAt && st.endsAt - now > CUT_MS) {
      // перший правильний є: решті лишаємо CUT_MS
      busy = true;
      engine.roomRef.update({ "stage/endsAt": now + CUT_MS, "stage/data/cut": true }).finally(() => { busy = false; });
      return;
    }
    const expect = st.expect || [];
    const allIn = expect.length > 0 && waitingNames(room).length === 0;
    if (allIn || (st.endsAt && now >= st.endsAt)) endStage(room);
  }

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
        const left = Math.max(0, SET_CAP - (setT[n] || 0)), a = Math.min(sips, left);
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
  // Шифрувальник попросив інше слово (один раз): той самий шифрувальник, наступне слово.
  async function reroll(room) {
    busy = true;
    try {
      const cur = engine.latestRoom;
      if (!cur || cur.phase !== "round" || !cur.stage || cur.stage.id !== room.stage.id) return;
      const d = cur.stage.data;
      await engine.roomRef.update(commitStage(cur, encodeStage(cur, d.idx + 1, d.encoder, true)));
    } finally { busy = false; }
  }
  async function nextRound() {
    const cur = engine.latestRoom;
    if (!cur || cur.phase !== "round" || !cur.stage || cur.stage.kind !== "reveal" || busy) return;
    busy = true;
    try {
      const n = cur.roundNo + 1;
      if (n >= cur.totalRounds) { await engine.roomRef.update({ phase: "summary", stage: null, inputs: null }); return; }
      const prev = cur.stage.data, order = cur.order || [];
      const idx = prev && typeof prev.idx === "number" ? prev.idx + 1 : n;
      await engine.roomRef.update(commitStage(cur, encodeStage(cur, idx, order[n % order.length], false), { roundNo: n }));
    } finally { busy = false; }
  }

  // ------------------------- дії хоста -------------------------
  function isHostNow() {
    const room = engine.latestRoom;
    return !!room && engine.computeHost(room.players) === username;
  }
  function updateSettings(partial) {
    const room = engine.latestRoom;
    if (!room || room.phase === "round" || !isHostNow() || !partial) return;
    const next = {};
    if (LAPS_OPTIONS.includes(Number(partial.laps))) next.laps = Number(partial.laps);
    if ([1, 2, 3].includes(Number(partial.level))) next.level = Number(partial.level);
    if (ENCODE_OPTIONS.includes(Number(partial.encodeSec))) next.encodeSec = Number(partial.encodeSec);
    if (GUESS_OPTIONS.includes(Number(partial.guessSec))) next.guessSec = Number(partial.guessSec);
    if (Object.keys(next).length) engine.roomRef.child("settings").update(next);
  }
  function startSet(room) {
    room = room || engine.latestRoom;
    if (!room || room.phase === "round" || !isHostNow()) return { ok: false, reason: "not-allowed" };
    const names = connectedNames(room.players);
    if (names.length < MIN_PLAYERS) return { ok: false, reason: "not-enough-players" };
    const s = room.settings || {};
    const total = names.length * (s.laps || DEFAULT_LAPS);        // кожен шифрує по разу за коло
    const items = buildItems(s.level || DEFAULT_LEVEL, total);
    if (!items.length) return { ok: false, reason: "no-words" };
    const order = shuffle(names);
    const draft = Object.assign({}, room, { stageSeq: 0, order, deck: { items } });
    engine.roomRef.update(commitStage(draft, encodeStage(draft, 0, order[0], false), {
      phase: "round", setId: engine.now(), order, deck: { items }, roundNo: 0, totalRounds: total, "tally/set": null,
    }));
    return { ok: true, rounds: total };
  }
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
    engine.roomRef.update({ phase: "lobby", stage: null, inputs: null, deck: null, order: null, roundNo: 0, totalRounds: 0 });
  }
  function resetAll() {
    const roomId = engine.currentRoomId;
    if (!roomId || !isHostNow()) return;
    engine.forceResetRoom(roomId, SCHEMA, buildFreshRoom);
  }

  window.CharadesGame = {
    SET_CAP, MIN_PLAYERS, EMOJI_MAX, LAPS_OPTIONS, ENCODE_OPTIONS, GUESS_OPTIONS,
    DEFAULT_LAPS, DEFAULT_LEVEL, DEFAULT_ENCODE_SEC, DEFAULT_GUESS_SEC,
    connectedNames,
    computeHost: (players) => engine.computeHost(players),
    isConnected: (p) => engine.isConnected(p),
    now: () => engine.now(),
    inputOf, waitingNames, checkEmoji, matches,
    watchActiveRooms,
    start, stop, startSet, updateSettings, submitEmoji, rerollWord, guess, skip, endSet, toLobby, resetAll,
    get roomId() { return engine.currentRoomId; },
    get roomRef() { return engine.roomRef; },
    set onStateChange(fn) { onStateChange = fn; },
  };
})();
