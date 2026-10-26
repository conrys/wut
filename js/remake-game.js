// ==========================================================================
// «Дубль» — повтори кадр. Окрема гра на спільному OnlineEngine (js/core/online-engine.js).
// Кімнати: "remake_rooms"; фото гравців: "remake_photos/<кімната>/<ім'я>/<ключ>"
// (стиснутий JPEG, base64) — окремо від кімнати, щоб оновлення кімнати не тягли фото.
//
// Раунд: shoot (усі бачать кадр-оригінал і знімають свій дубль камерою; парами — надсилає один)
//        → vote (дублі всіх, за свій не можна) → reveal (переможець + колаж «оригінал/дубль»).
// Оригінали: спершу ті, що гравці завантажили в лобі, далі — випадкові з memes/ (MEMOLOGY_CARD_IDS).
// Рішення приймає лише хост. Підключати ПІСЛЯ firebase-config.js, login.js, online-engine.js,
// js/promts/memology-cards.js.
// ==========================================================================
(function () {
  const GAME_KEY = "remake";
  const PHOTOS_PATH = "remake_photos";
  const PHASES = ["lobby", "round", "summary"];
  const TICK_MS = 500;
  const MIN_PLAYERS = 2;
  const MIN_ROUNDS = 3, MAX_ROUNDS = 12, DEFAULT_ROUNDS = 5;
  const MIN_SHOOT_SEC = 30, MAX_SHOOT_SEC = 240, DEFAULT_SHOOT_SEC = 90;
  const MIN_VOTE_SEC = 20, MAX_VOTE_SEC = 120, DEFAULT_VOTE_SEC = 40;
  const MAX_REFS = 3;            // своїх оригіналів на гравця
  const SPARE = 4;               // запасні кадри для «Інший кадр»
  const WIN_BONUS = 2;
  const REVEAL_MS = 30000;
  const ABANDON_MS = 15 * 60 * 1000;
  const PHOTO_MAX_SIDE = 960, PHOTO_QUALITY = 0.75, PHOTO_MAX_CHARS = 140000;
  const SEEN_KEY = "games41_remake_seen", SEEN_KEEP = 150;   // кадри з memes/, які вже були (у хоста)
  const AVATAR_STORAGE_PREFIX = "games41_quiplash_avatar_";
  const AVATAR_COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6", "#1abc9c", "#e67e22", "#ff6fa5"];
  const QA = () => window.QuiplashAvatars;
  const CHARACTERS = QA() ? QA().COUNT : 8;
  const charColor = (c) => (QA() ? QA().color(c) : AVATAR_COLORS[(c - 1) % AVATAR_COLORS.length]);

  const SCHEMA = {
    phase: "lobby",
    hostUsername: null,
    settings: { rounds: DEFAULT_ROUNDS, shootSec: DEFAULT_SHOOT_SEC, voteSec: DEFAULT_VOTE_SEC },
    setId: null,
    order: null,
    deck: null,        // { items: [{ k:"pool", f } | { k:"up", n, id }] }
    roundNo: 0,
    totalRounds: 0,
    stage: null,
    stageSeq: 0,
    inputs: null,      // inputs/<ім'я> = "<id етапу>:<ключ фото>"
    refMeta: null,     // refMeta/<ім'я>/<ключ> = true — свої оригінали з лобі
    best: null,        // best/<раунд> = { ref, n, key } — переможці для галереї вечора
    tally: null,
    players: {},
  };

  const engine = window.OnlineEngine.create(GAME_KEY, { phases: PHASES, lockedHost: true, abandonMs: ABANDON_MS });

  let username = null;
  let onStateChange = () => {};
  let tickTimer = null;
  let busy = false;

  function defaultSettings() { return { rounds: DEFAULT_ROUNDS, shootSec: DEFAULT_SHOOT_SEC, voteSec: DEFAULT_VOTE_SEC }; }
  function buildFreshRoom() { return { players: {}, settings: defaultSettings() }; }
  function connectedNames(players) {
    return Object.entries(players || {}).filter(([, p]) => engine.isConnected(p)).map(([n]) => n);
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  function settingOf(room, key) {
    const s = room.settings || {}, v = Number(s[key]);
    if (key === "rounds") return clamp(Math.round(v) || DEFAULT_ROUNDS, MIN_ROUNDS, MAX_ROUNDS);
    if (key === "shootSec") return clamp(v || DEFAULT_SHOOT_SEC, MIN_SHOOT_SEC, MAX_SHOOT_SEC);
    return clamp(v || DEFAULT_VOTE_SEC, MIN_VOTE_SEC, MAX_VOTE_SEC);
  }
  // вбудовані меми (memes/) + хмарні з upload.html ("c:<файл>", спільні з Мемологією)
  let cloudIds = [];
  if (window.MediaPool) window.MediaPool.list("memology").then((items) => { cloudIds = items.map((it) => "c:" + it.file); });
  function poolOf() { return (Array.isArray(window.MEMOLOGY_CARD_IDS) ? window.MEMOLOGY_CARD_IDS : []).concat(cloudIds); }
  function poolSrc(f) {
    return typeof f === "string" && f.indexOf("c:") === 0 && window.MediaPool
      ? window.MediaPool.fileUrl("memology", f.slice(2)) : "memes/" + f;
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
  function cycleAvatar() {
    const room = engine.latestRoom, me = room && room.players && room.players[username];
    if (!me || room.phase === "round") return;
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

  // ------------------------- фото -------------------------
  // Посилання на фото: { k:"pool", f } — файл з memes/; { k:"up", n, id } — base64 у remake_photos.
  const photoCache = new Map();   // ключ → Promise<src>
  function photoKey(p) { return p.k === "pool" ? "pool:" + p.f : "up:" + p.n + ":" + p.id; }
  function loadPhoto(p) {
    if (!p) return Promise.resolve(null);
    const key = photoKey(p);
    if (photoCache.has(key)) return photoCache.get(key);
    let pr;
    if (p.k === "pool") pr = Promise.resolve(poolSrc(p.f));
    else {
      const roomId = engine.currentRoomId;
      pr = window.rtdb.ref(`${PHOTOS_PATH}/${roomId}/${p.n}/${p.id}`).get().then((s) => (s.exists() ? s.val() : null)).catch(() => null);
    }
    photoCache.set(key, pr);
    pr.then((src) => { if (!src) photoCache.delete(key); });
    return pr;
  }

  function resizeImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const k = Math.min(1, PHOTO_MAX_SIDE / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        let q = PHOTO_QUALITY, data = c.toDataURL("image/jpeg", q);
        // спершу знижуємо якість, потім — розмір (фото з камери телефона бувають важкі)
        while (data.length > PHOTO_MAX_CHARS && q > 0.35) { q -= 0.1; data = c.toDataURL("image/jpeg", q); }
        let side = PHOTO_MAX_SIDE;
        while (data.length > PHOTO_MAX_CHARS && side > 360) {
          side -= 120;
          const k2 = Math.min(1, side / Math.max(img.width, img.height));
          c.width = Math.max(1, Math.round(img.width * k2)); c.height = Math.max(1, Math.round(img.height * k2));
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          data = c.toDataURL("image/jpeg", 0.6);
        }
        data.length > PHOTO_MAX_CHARS ? reject(new Error("too-big")) : resolve(data);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad-image")); };
      img.src = url;
    });
  }
  async function uploadPhoto(file) {
    const roomId = engine.currentRoomId;
    if (!file || !/^image\//.test(file.type || "")) throw new Error("not-image");
    const data = await resizeImage(file);
    const ref = window.rtdb.ref(`${PHOTOS_PATH}/${roomId}/${username}`).push();
    await ref.set(data);
    photoCache.set("up:" + username + ":" + ref.key, Promise.resolve(data));
    return ref.key;
  }

  // Свої оригінали в лобі (необов'язково).
  function refCount(room, name) { return Object.keys((room.refMeta && room.refMeta[name]) || {}).length; }
  async function addRef(file) {
    const room = engine.latestRoom;
    if (!room || !engine.currentRoomId || room.phase === "round" || !(room.players && room.players[username])) return { ok: false, reason: "not-allowed" };
    if (refCount(room, username) >= MAX_REFS) return { ok: false, reason: "limit" };
    let id;
    try { id = await uploadPhoto(file); } catch (e) { return { ok: false, reason: e.message || "bad-image" }; }
    await engine.roomRef.child("refMeta/" + username + "/" + id).set(true);
    return { ok: true, id };
  }
  async function removeRef(id) {
    const room = engine.latestRoom, roomId = engine.currentRoomId;
    if (!room || !roomId || room.phase === "round" || !id) return;
    photoCache.delete("up:" + username + ":" + id);
    await engine.roomRef.child("refMeta/" + username + "/" + id).remove();
    await window.rtdb.ref(`${PHOTOS_PATH}/${roomId}/${username}/${id}`).remove();
  }

  // Дубль у раунді: завантажити фото й надіслати як відповідь. Можна перезняти до кінця таймера.
  async function submitShot(file) {
    const room = engine.latestRoom, st = room && room.stage;
    if (!room || room.phase !== "round" || !st || st.kind !== "shoot") return { ok: false, reason: "wrong-phase" };
    if (!(st.expect || []).includes(username)) return { ok: false, reason: "not-expected" };
    const stageId = st.id, prev = inputOf(room, username);
    let id;
    try { id = await uploadPhoto(file); } catch (e) { return { ok: false, reason: e.message || "bad-image" }; }
    const cur = engine.latestRoom;
    if (!cur || !cur.stage || cur.stage.id !== stageId || cur.stage.kind !== "shoot") {
      window.rtdb.ref(`${PHOTOS_PATH}/${engine.currentRoomId}/${username}/${id}`).remove().catch(() => {});
      return { ok: false, reason: "late" };
    }
    await engine.roomRef.update({ ["inputs/" + username]: stageId + ":" + id });
    if (prev && prev !== id) {   // перезняв — старий дубль більше не потрібен
      photoCache.delete("up:" + username + ":" + prev);
      window.rtdb.ref(`${PHOTOS_PATH}/${engine.currentRoomId}/${username}/${prev}`).remove().catch(() => {});
    }
    return { ok: true, id };
  }
  function vote(optId) {
    const room = engine.latestRoom, st = room && room.stage;
    if (!room || room.phase !== "round" || !st || st.kind !== "vote") return { ok: false, reason: "wrong-phase" };
    if (!(st.expect || []).includes(username)) return { ok: false, reason: "not-expected" };
    const shot = (st.shots || [])[Number(optId)];
    if (!shot) return { ok: false, reason: "bad-value" };
    if (shot.n === username) return { ok: false, reason: "own" };
    engine.roomRef.update({ ["inputs/" + username]: st.id + ":" + Number(optId) });
    return { ok: true };
  }

  function clearPhotos(roomId) {
    photoCache.clear();
    return window.rtdb.ref(`${PHOTOS_PATH}/${roomId}`).remove().catch(() => {});
  }

  // ------------------------- колода оригіналів -------------------------
  function readSeen() {
    try { const a = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function markSeen(files) {
    if (!files.length) return;
    try {
      const seen = readSeen().filter((f) => !files.includes(f)).concat(files);
      localStorage.setItem(SEEN_KEY, JSON.stringify(seen.slice(-SEEN_KEEP)));
    } catch (e) { /* без пам'яті — просто випадково */ }
  }
  function buildDeck(room, total) {
    const meta = room.refMeta || {};
    // свої оригінали — по колу між гравцями, щоб у всіх потрапило хоч щось
    const queues = shuffle(Object.keys(meta)).map((n) => shuffle(Object.keys(meta[n] || {}).map((id) => ({ k: "up", n, id }))));
    const own = [];
    for (let i = 0; queues.some((q) => q[i]); i++) queues.forEach((q) => { if (q[i]) own.push(q[i]); });
    const seen = new Set(readSeen());
    const pool = shuffle(poolOf());
    const fresh = pool.filter((f) => !seen.has(f)), old = pool.filter((f) => seen.has(f));
    const memes = fresh.concat(old).map((f) => ({ k: "pool", f }));
    const items = own.concat(memes).slice(0, total + SPARE);
    return items;
  }
  function availableRefs(room) {
    const up = Object.values(room.refMeta || {}).reduce((n, o) => n + Object.keys(o || {}).length, 0);
    return { uploaded: up, pool: poolOf().length, total: up + poolOf().length };
  }

  // ------------------------- етапи -------------------------
  function stageFor(room, idx) {
    const items = (room.deck && room.deck.items) || [], order = room.order || [];
    const ref = items[idx % items.length];
    return { kind: "shoot", ref, expect: order.slice(), durationMs: settingOf(room, "shootSec") * 1000, data: { idx } };
  }
  function reveal(stage, fields) {
    return Object.assign({ kind: "reveal", ref: stage.ref, durationMs: REVEAL_MS, results: [], lines: [], points: {}, data: stage.data }, fields);
  }

  function nextStage(room, stage, inputs) {
    const order = room.order || [], d = stage.data || {};
    if (stage.kind === "shoot") {
      const shots = shuffle(order.filter((n) => typeof inputs[n] === "string" && inputs[n]).map((n) => ({ n, key: inputs[n] })));
      if (!shots.length) return reveal(stage, { headline: "Ніхто не зняв дубль", lines: ["Кадр виявився надто складним"], durationMs: 8000 });
      if (shots.length === 1) {
        return reveal(stage, { headline: "Єдиний дубль", results: [{ n: shots[0].n, key: shots[0].key, v: 0 }], points: { [shots[0].n]: 1 },
          lines: [`${shots[0].n}: +1 за сміливість. Для голосування потрібно щонайменше два дублі`], winner: shots[0], durationMs: 15000 });
      }
      const expect = order.filter((n) => shots.some((s) => s.n !== n));
      return { kind: "vote", ref: stage.ref, shots, expect, durationMs: settingOf(room, "voteSec") * 1000, data: d };
    }
    // vote → результат
    const shots = stage.shots || [], counts = {};
    Object.entries(inputs).forEach(([voter, v]) => {
      const i = Number(v);
      if (Number.isInteger(i) && shots[i] && shots[i].n !== voter) counts[i] = (counts[i] || 0) + 1;
    });
    const results = shots.map((s, i) => ({ n: s.n, key: s.key, v: counts[i] || 0 })).sort((a, b) => b.v - a.v);
    const top = results[0].v, winners = top > 0 ? results.filter((r) => r.v === top) : [];
    const points = {};
    results.forEach((r) => { const p = r.v + (winners.includes(r) ? WIN_BONUS : 0); if (p) points[r.n] = (points[r.n] || 0) + p; });
    const lines = [];
    if (winners.length) lines.push(`${winners.map((w) => w.n).join(", ")}: +${WIN_BONUS} бонусом за найкращий дубль`);
    else lines.push("Ніхто не проголосував");
    return reveal(stage, {
      headline: winners.length ? (winners.length > 1 ? "Нічия!" : "Найкращий дубль") : "Голосів немає",
      results, lines, points, winner: winners[0] ? { n: winners[0].n, key: winners[0].key } : null,
    });
  }

  // ------------------------- рішення хоста -------------------------
  function progress(room) {
    if (busy || room.paused || room.phase !== "round" || !room.stage) return; // пауза (js/core/game-pause.js)
    const st = room.stage, now = engine.now();
    if (st.kind === "reveal") { if (st.endsAt && now >= st.endsAt) nextRound(); return; }
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
      const points = (cur.tally && cur.tally.points) || {};
      Object.entries(st.points || {}).forEach(([n, p]) => { update["tally/points/" + n] = (points[n] || 0) + p; });
      if (st.winner) update["best/r" + cur.roundNo] = { ref: st.ref, n: st.winner.n, key: st.winner.key };
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

  // ------------------------- дії хоста -------------------------
  function isHostNow() {
    const room = engine.latestRoom;
    return !!room && engine.computeHost(room.players) === username;
  }
  function updateSettings(partial) {
    const room = engine.latestRoom;
    if (!room || room.phase === "round" || !isHostNow() || !partial) return;
    const next = {}, lim = { rounds: [MIN_ROUNDS, MAX_ROUNDS], shootSec: [MIN_SHOOT_SEC, MAX_SHOOT_SEC], voteSec: [MIN_VOTE_SEC, MAX_VOTE_SEC] };
    Object.keys(lim).forEach((key) => {
      const v = Number(partial[key]);
      if (Number.isInteger(v) && v >= lim[key][0] && v <= lim[key][1]) next[key] = v;
    });
    if (Object.keys(next).length) engine.roomRef.child("settings").update(next);
  }

  function startSet(room) {
    room = room || engine.latestRoom;
    if (!room || room.phase === "round" || !isHostNow()) return { ok: false, reason: "not-allowed" };
    const names = connectedNames(room.players);
    if (names.length < MIN_PLAYERS) return { ok: false, reason: "not-enough-players" };
    const av = availableRefs(room);
    if (!av.total) return { ok: false, reason: "no-photos" };
    // раундів — як у налаштуваннях, але всі свої оригінали мають потрапити в гру
    const total = Math.min(av.total, Math.max(settingOf(room, "rounds"), Math.min(av.uploaded, MAX_ROUNDS + 3)));
    const items = buildDeck(room, total);
    markSeen(items.filter((it) => it.k === "pool").slice(0, total).map((it) => it.f));
    const draft = Object.assign({}, room, { stageSeq: 0, order: names, deck: { items } });
    engine.roomRef.update(commitStage(draft, stageFor(draft, 0), {
      phase: "round", setId: engine.now(), order: names, deck: { items },
      roundNo: 0, totalRounds: total, best: null, "tally/points": null,
    }));
    return { ok: true, rounds: total };
  }

  function skip() {
    const room = engine.latestRoom;
    if (!room || room.phase !== "round" || !room.stage || !isHostNow() || busy) return;
    if (room.stage.kind === "reveal") nextRound(); else endStage(room);
  }
  // «Інший кадр»: хост міняє оригінал на наступний з колоди (лише поки знімають).
  async function skipItem() {
    const room = engine.latestRoom;
    if (!room || room.phase !== "round" || !room.stage || room.stage.kind !== "shoot" || !isHostNow() || busy) return;
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
    const room = engine.latestRoom, roomId = engine.currentRoomId;
    if (!room || room.phase !== "summary" || !isHostNow()) return;
    engine.roomRef.update({ phase: "lobby", stage: null, inputs: null, deck: null, order: null, roundNo: 0, totalRounds: 0, refMeta: null, best: null });
    clearPhotos(roomId);   // фото були лише на один вечір
  }
  function resetAll() {
    const roomId = engine.currentRoomId;
    if (!roomId || !isHostNow()) return;
    engine.forceResetRoom(roomId, SCHEMA, buildFreshRoom);
    clearPhotos(roomId);
  }

  window.RemakeGame = {
    MIN_PLAYERS, MAX_REFS, WIN_BONUS,
    MIN_ROUNDS, MAX_ROUNDS, DEFAULT_ROUNDS, MIN_SHOOT_SEC, MAX_SHOOT_SEC, DEFAULT_SHOOT_SEC, MIN_VOTE_SEC, MAX_VOTE_SEC, DEFAULT_VOTE_SEC,
    connectedNames, availableRefs, refCount, settingOf,
    computeHost: (players) => engine.computeHost(players),
    isConnected: (p) => engine.isConnected(p),
    now: () => engine.now(),
    inputOf, waitingNames, loadPhoto,
    watchActiveRooms,
    start, stop, startSet, updateSettings, submitShot, vote, skip, skipItem, addRef, removeRef, endSet, toLobby, resetAll, cycleAvatar,
    get roomId() { return engine.currentRoomId; },
    get roomRef() { return engine.roomRef; },
    set onStateChange(fn) { onStateChange = fn; },
  };
})();
