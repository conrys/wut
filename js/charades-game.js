// ==========================================================================
// «Зіпсовані шаради» — окрема гра на спільному OnlineEngine (js/online-engine.js).
// Самодостатня: не залежить від party-*.js / fakenews-*.js.
// Кімнати: "charades_rooms". Слова: js/charades-prompts.js (window.CharadesPrompts).
//
// Набір триває, доки не скінчаться слова обраного рівня; шифрувальник іде по колу.
// Раунд:
//   encode — шифрувальник бачить слово й шифрує його ЛИШЕ емодзі (панель або клавіатура);
//            може один раз замінити слово («r»);
//   guess  — решта кажуть відповідь УГОЛОС; шифрувальник позначає ВСІХ, хто вгадав
//            (можуть крикнути разом — порядку немає), і тисне «Готово» (або «Ніхто не вгадав»);
//   reveal — результат. Кожен, хто вгадав: +3, шифрувальник +1; якщо ніхто — шифрувальник п'є.
// Вибір шифрувальника — inputs/<шифрувальник> = "<id>:p:Ім'я|Ім'я" (живий, бачать усі)
// або "<id>:d:…" (готово — хост закриває етап). Імена не містять "|".
// Підключати ПІСЛЯ firebase-config.js, login.js, online-engine.js, charades-prompts.js.
// ==========================================================================
(function () {
  const GAME_KEY = "charades";
  const PHASES = ["lobby", "round", "summary"];
  const TICK_MS = 500;
  const SET_CAP = 6;
  const MIN_PLAYERS = 3;
  const MIN_TIMER_SEC = 20, MAX_TIMER_SEC = 120;
  const DEFAULT_ENCODE_SEC = 60;
  const DEFAULT_GUESS_SEC = 60;
  const DEFAULT_LEVEL = 2;
  const GUESS_POINTS = 3, ENCODER_POINTS = 1;
  const EMOJI_MAX = 40;          // символів у шифрі
  const REVEAL_MS = 45000;
  const ABANDON_MS = 15 * 60 * 1000;
  const AVATAR_STORAGE_PREFIX = "games41_quiplash_avatar_";
  const AVATAR_COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6", "#1abc9c", "#e67e22", "#ff6fa5"];
  // монстрики Сміхлиста (js/quiplash-avatars.js), якщо підключені; інакше 8 img/char*.svg
  const QA = () => window.QuiplashAvatars;
  const CHARACTERS = QA() ? QA().COUNT : 8;
  const charColor = (c) => (QA() ? QA().color(c) : AVATAR_COLORS[(c - 1) % AVATAR_COLORS.length]);

  const SCHEMA = {
    phase: "lobby",
    hostUsername: null,
    settings: { level: DEFAULT_LEVEL, encodeSec: DEFAULT_ENCODE_SEC, guessSec: DEFAULT_GUESS_SEC },
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

  function defaultSettings() { return { level: DEFAULT_LEVEL, encodeSec: DEFAULT_ENCODE_SEC, guessSec: DEFAULT_GUESS_SEC }; }
  function buildFreshRoom() { return { players: {}, settings: defaultSettings() }; }
  function connectedNames(players) {
    return Object.entries(players || {}).filter(([, p]) => engine.isConnected(p)).map(([n]) => n);
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function ms(room, key, defSec) {
    const seconds = Number((room.settings || {})[key]) || defSec;
    return Math.min(MAX_TIMER_SEC, Math.max(MIN_TIMER_SEC, seconds)) * 1000;
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
    if (st.data.idx + 1 >= ((room.deck && room.deck.items) || []).length) return { ok: false, reason: "no-words" };   // це останнє слово
    engine.roomRef.update({ ["inputs/" + username]: st.id + ":r" });
    return { ok: true };
  }

  // --- відгадування вголос: шифрувальник позначає, хто вгадав ---
  // { names: [...] у порядку вгадування, done } з inputs шифрувальника.
  function picksOf(room) {
    const st = room && room.stage, d = (st && st.data) || {};
    const v = st ? validInputs(room)[d.encoder] : undefined;
    if (typeof v !== "string" || !/^[pd]:/.test(v)) return { names: [], done: false };
    const allowed = (room.order || []).filter((n) => n !== d.encoder);
    const names = [...new Set(v.slice(2).split("|").filter((n) => allowed.includes(n)))];
    return { names, done: v[0] === "d" };
  }
  function writePicks(names, done) {
    const room = engine.latestRoom, st = room && room.stage;
    if (!room || room.phase !== "round" || !st || st.kind !== "guess") return { ok: false, reason: "wrong-phase" };
    if (st.data.encoder !== username) return { ok: false, reason: "not-encoder" };
    engine.roomRef.update({ ["inputs/" + username]: st.id + ":" + (done ? "d:" : "p:") + names.join("|") });
    return { ok: true };
  }
  // Тап по гравцю: позначає його як того, хто вгадав; повторний тап — знімає позначку.
  function togglePick(name) {
    const room = engine.latestRoom, cur = picksOf(room);
    if (cur.done) return { ok: false, reason: "done" };
    const names = cur.names.includes(name) ? cur.names.filter((n) => n !== name) : cur.names.concat(name);
    return writePicks(names, false);
  }
  function finishPicks() { return writePicks(picksOf(engine.latestRoom).names, true); }

  // ------------------------- колода й етапи -------------------------
  function buildItems(level) {
    const all = (window.CharadesPrompts || []).filter((x) => x.level <= level);
    // спершу слова, яких компанія ще не загадувала (js/core/prompt-history.js)
    const deck = window.PromptHistory ? PromptHistory.order("charades", all, (x) => x.text) : shuffle(all);
    return deck.map((x) => ({ text: x.text, alt: x.alt || [], cat: x.cat || "" }));
  }
  function encodeStage(room, idx, encoder, rerolled) {
    const items = (room.deck && room.deck.items) || [], it = items[idx % items.length];
    const words = String(it.text).trim().split(/\s+/).length;
    if (window.PromptHistory) PromptHistory.mark("charades", [it.text]);
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
          kind: "guess", title: "Відгадай", hint, emoji, expect: [d.encoder], durationMs: ms(room, "guessSec", DEFAULT_GUESS_SEC),
          data: Object.assign({}, d, { step: "guess" }),
        };
      }
      return reveal(stage, { headline: "Шифрувальник не встиг", missed: true, lines: [`Слово було: «${d.text}»`], durationMs: 8000, data: d, encoder: d.encoder });
    }
    // guess → результат (порядок — як тапав шифрувальник)
    const solves = picksOf(Object.assign({}, room, { stage })).names;
    const points = {}, penalties = {};
    const results = solves.map((n) => { points[n] = GUESS_POINTS; return { n, pts: GUESS_POINTS }; });
    const lines = [];
    if (solves.length) {
      points[d.encoder] = (points[d.encoder] || 0) + ENCODER_POINTS;
      lines.push(`${d.encoder} отримує +${ENCODER_POINTS} за вдалий шифр`);
    } else {
      penalties[d.encoder] = 1;
      lines.push(`Ніхто не вгадав: ${d.encoder} п'є за надто складний ребус`);
    }
    return reveal(stage, {
      headline: `Це було: «${d.text}»`, emoji: stage.emoji, results, lines, penalties, points, data: d, encoder: d.encoder,
    });
  }

  // ------------------------- рішення хоста -------------------------
  function progress(room) {
    if (busy || room.paused || room.phase !== "round" || !room.stage) return; // пауза (js/core/game-pause.js) — нічого не рухаємо
    const st = room.stage, now = engine.now(), d = st.data || {};
    if (st.kind === "reveal") { if (st.endsAt && now >= st.endsAt) nextRound(); return; }
    if (st.kind === "encode" && validInputs(room)[d.encoder] === "r" && !d.rerolled) { reroll(room); return; }
    const expect = st.expect || [];
    // у відгадуванні проміжні тапи ("p:") — ще не кінець, чекаємо «Готово» ("d:")
    const allIn = st.kind === "guess" ? picksOf(room).done : expect.length > 0 && waitingNames(room).length === 0;
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
      const prev = cur.stage.data, order = cur.order || [];
      const idx = prev && typeof prev.idx === "number" ? prev.idx + 1 : n;
      // «Інше слово» теж бере слово з колоди, тож кінець — коли скінчились слова
      if (n >= cur.totalRounds || idx >= ((cur.deck && cur.deck.items) || []).length) { await engine.roomRef.update({ phase: "summary", stage: null, inputs: null }); return; }
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
    if ([1, 2, 3].includes(Number(partial.level))) next.level = Number(partial.level);
    const encodeSec = Number(partial.encodeSec), guessSec = Number(partial.guessSec);
    if (Number.isInteger(encodeSec) && encodeSec >= MIN_TIMER_SEC && encodeSec <= MAX_TIMER_SEC) next.encodeSec = encodeSec;
    if (Number.isInteger(guessSec) && guessSec >= MIN_TIMER_SEC && guessSec <= MAX_TIMER_SEC) next.guessSec = guessSec;
    if (Object.keys(next).length) engine.roomRef.child("settings").update(next);
  }
  function startSet(room) {
    room = room || engine.latestRoom;
    if (!room || room.phase === "round" || !isHostNow()) return { ok: false, reason: "not-allowed" };
    const names = connectedNames(room.players);
    if (names.length < MIN_PLAYERS) return { ok: false, reason: "not-enough-players" };
    const s = room.settings || {};
    const level = s.level || DEFAULT_LEVEL;
    const items = buildItems(level);   // уся колода рівня, перемішана: скільки слів — стільки й раундів
    const total = items.length;
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
    SET_CAP, MIN_PLAYERS, EMOJI_MAX, MIN_TIMER_SEC, MAX_TIMER_SEC,
    DEFAULT_LEVEL, DEFAULT_ENCODE_SEC, DEFAULT_GUESS_SEC,
    connectedNames,
    computeHost: (players) => engine.computeHost(players),
    isConnected: (p) => engine.isConnected(p),
    now: () => engine.now(),
    cycleAvatar,
    inputOf, waitingNames, checkEmoji, picksOf,
    watchActiveRooms,
    start, stop, startSet, updateSettings, submitEmoji, rerollWord, togglePick, finishPicks, skip, endSet, toLobby, resetAll,
    get roomId() { return engine.currentRoomId; },
    get roomRef() { return engine.roomRef; },
    set onStateChange(fn) { onStateChange = fn; },
  };
})();
