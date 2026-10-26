// ==========================================================================
// «Fake News» — окрема гра на спільному OnlineEngine (js/online-engine.js).
// Самодостатня: не залежить від party-*.js. Кімнати: "fakenews_rooms",
// фото гравців: "fakenews_photos/<кімната>/<ім'я>/<ключ>" (стиснутий JPEG, base64).
// Фото лежать ОКРЕМО від вузла кімнати, щоб кожне оновлення кімнати не тягло їх на всі
// телефони; у кімнаті — лише room.photoMeta (які ключі існують).
//
// Раунд: write (усі пишуть заголовок до одного фото, автор фото теж) →
//        show (ефір: заголовки по черзі, анонімно) → vote (за свій не можна) → reveal.
// Етапи: kind "write" | "show" | "vote" | "reveal". Рішення приймає лише хост.
// Канал: кожне фото виходить на одному з CHANNELS (оформлення ефіру + легка підказка до стилю).
// Автор фото обирає канал у лобі (picks/<ім'я>/p<i> = id каналу, photoMeta/…/ch), інакше — випадковий.
// Підключати ПІСЛЯ firebase-config.js, login.js, online-engine.js, fakenews-photos.js.
// ==========================================================================
(function () {
  const GAME_KEY = "fakenews";
  const PHASES = ["lobby", "round", "summary"];
  const TICK_MS = 500;
  const SET_CAP = 6;
  const MIN_PLAYERS = 3;
  const MIN_TIMER_SEC = 20, MAX_TIMER_SEC = 120;
  const DEFAULT_WRITE_SEC = 60;
  const DEFAULT_SHOW_SEC = 20;
  const DEFAULT_VOTE_SEC = 60;
  const MAX_PHOTOS = 2;          // фото на гравця: обрані з пулу + власні разом; щойно набрано — гравець «готовий»
  const POOL_CHOICES = 6;
  const HEADLINE_MAX = 90;
  const SPARE = 3;               // запасні фото для «Інше фото»
  const WIN_BONUS = 2;
  const REVEAL_MS = 45000;
  // Великі компанії: в ефір і на голосування йде не більше MAX_AIRED заголовків
  // до фото (першими — автори, яких показували найрідше). 20 заголовків × 20 с
  // ефіру = майже 7 хвилин на одне фото.
  const MAX_AIRED = 6;
  const CHANNELS = [
    { id: "tv", icon: "📺", name: "Новини 24/7", short: "Новини", hint: "коротко й тривожно, як бігуча стрічка" },
    { id: "tabloid", icon: "📰", name: "Жовта преса", short: "Преса", hint: "більше сенсації й знаків оклику!" },
    { id: "tg", icon: "📱", name: "Телеграм-канал", short: "Телеграм", hint: "«⚡️ТЕРМІНОВО» і «джерела повідомляють»" },
    { id: "radio", icon: "🎙️", name: "Радіо", short: "Радіо", hint: "так, ніби диктор читає це в мікрофон" },
    { id: "sport", icon: "🏆", name: "Спорт-канал", short: "Спорт", hint: "як коментатор у фіналі чемпіонату" },
  ];
  const CHANNEL_IDS = CHANNELS.map((c) => c.id);
  function randomChannel() { return CHANNEL_IDS[Math.floor(Math.random() * CHANNEL_IDS.length)]; }
  function channelInfo(id) { return CHANNELS.find((c) => c.id === id) || CHANNELS[0]; }
  const ABANDON_MS = 15 * 60 * 1000;
  const PHOTO_MAX_SIDE = 720, PHOTO_QUALITY = 0.72, PHOTO_MAX_CHARS = 140000;
  const AVATAR_STORAGE_PREFIX = "games41_quiplash_avatar_";
  const AVATAR_COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6", "#1abc9c", "#e67e22", "#ff6fa5"];
  // монстрики Сміхлиста (js/quiplash-avatars.js), якщо підключені; інакше 8 img/char*.svg
  const QA = () => window.QuiplashAvatars;
  const CHARACTERS = QA() ? QA().COUNT : 8;
  const charColor = (c) => (QA() ? QA().color(c) : AVATAR_COLORS[(c - 1) % AVATAR_COLORS.length]);

  const SCHEMA = {
    phase: "lobby",
    hostUsername: null,
    settings: { writeSec: DEFAULT_WRITE_SEC, showSec: DEFAULT_SHOW_SEC, voteSec: DEFAULT_VOTE_SEC },
    setId: null,
    order: null,
    deck: null,        // { items: [{ p: { k:"pool", i } | { k:"up", n, id } }] }
    roundNo: 0,
    totalRounds: 0,
    stage: null,
    stageSeq: 0,
    show: null,        // { idx, at } — який заголовок зараз в ефірі (веде хост)
    airCounts: null,   // airCounts/<ім'я> — скільки разів заголовок гравця йшов в ефір за набір
    inputs: null,      // inputs/<ім'я> = "<id етапу>:<значення>"
    photoMeta: null,   // photoMeta/<ім'я>/<ключ> = { title } (у старих фото могло бути true)
    picks: null,       // picks/<ім'я>/p<індекс> = true (фото, обрані гравцем з готового пулу)
    tally: null,
    players: {},
  };

  const engine = window.OnlineEngine.create(GAME_KEY, { phases: PHASES, lockedHost: true, abandonMs: ABANDON_MS });

  let username = null;
  let onStateChange = () => {};
  let tickTimer = null;
  let busy = false;

  function defaultSettings() { return { writeSec: DEFAULT_WRITE_SEC, showSec: DEFAULT_SHOW_SEC, voteSec: DEFAULT_VOTE_SEC }; }
  function buildFreshRoom() { return { players: {}, settings: defaultSettings() }; }
  function connectedNames(players) {
    return Object.entries(players || {}).filter(([, p]) => engine.isConnected(p)).map(([n]) => n);
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function sec(room, key, def) {
    const seconds = Number((room.settings || {})[key]) || def;
    return Math.min(MAX_TIMER_SEC, Math.max(MIN_TIMER_SEC, seconds)) * 1000;
  }
  function poolOf() { return Array.isArray(window.FakeNewsPhotos) ? window.FakeNewsPhotos : []; }

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
  function cycleAvatar() {
    const room = engine.latestRoom, me = room && room.players && room.players[username];
    if (!me || !(room.phase !== "round")) return;
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
    seedCloudPool();
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(tick, TICK_MS);
  }
  function stop() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    engine.stop();
  }
  // Записує в кімнату список хмарних фото, поки ним ще ніхто не скористався
  // (до першого вибору фото в лобі). Далі список у кімнаті не міняється.
  function seedCloudPool(retry) {
    if (!window.MediaPool) return;
    window.MediaPool.list("fakenews").then((items) => {
      const room = engine.latestRoom;
      if (!room && !retry) { setTimeout(() => seedCloudPool(true), 1500); return; }
      if (!room || !engine.roomRef || room.phase === "round") return;
      if (room.picks && Object.keys(room.picks).length) return;
      const list = items.map((it) => ({ f: it.file, t: (it.text || "").slice(0, 80) }));
      const cur = Array.isArray(room.cloud) ? room.cloud.map((c) => c && c.f).join("|") : "";
      if (cur === list.map((c) => c.f).join("|")) return;
      engine.roomRef.child("cloud").set(list.length ? list : null).catch(() => {});
    });
  }
  function handleEngineEvent(type, data) {
    if (type !== "room-update") return;
    const room = data.room;
    if (window.FakeNewsUI) window.FakeNewsUI.syncCloud(room);
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

  function answer(value) {
    const room = engine.latestRoom, st = room && room.stage;
    if (!room || room.phase !== "round" || !st) return { ok: false, reason: "wrong-phase" };
    if (st.kind !== "write" && st.kind !== "vote") return { ok: false, reason: "no-input" };
    if (!(st.expect || []).includes(username)) return { ok: false, reason: "not-expected" };
    let v = String(value == null ? "" : value);
    if (st.kind === "write") {
      v = v.replace(/\s+/g, " ").trim().slice(0, HEADLINE_MAX);
      if (v.length < 2) return { ok: false, reason: "too-short" };
    } else {
      if (!(st.options || []).some((o) => o.id === v)) return { ok: false, reason: "bad-value" };
      if (((st.data && st.data.authors) || [])[Number(v)] === username) return { ok: false, reason: "own-headline" };
    }
    engine.roomRef.update({ ["inputs/" + username]: st.id + ":" + v });
    return { ok: true };
  }
  function waitingNames(room) {
    const st = room.stage; if (!st) return [];
    const inputs = validInputs(room), players = room.players || {};
    return (st.expect || []).filter((n) => inputs[n] === undefined && engine.isConnected(players[n]));
  }

  // ------------------------- вибір фото та готовність -------------------------
  // Пріоритет — готовий пул: гравець обирає фото з нього, а власне завантаження необов'язкове.
  // Гравець автоматично «готовий», коли обрав/завантажив MAX_PHOTOS фото разом.
  function photoCount(room, name) {
    const up = Object.keys((room.photoMeta && room.photoMeta[name]) || {}).length;
    const pk = Object.keys((room.picks && room.picks[name]) || {}).length;
    return up + pk;
  }
  function readyNames(room) { return connectedNames(room.players).filter((n) => photoCount(room, n) >= MAX_PHOTOS); }
  function togglePoolPick(i) {
    const room = engine.latestRoom;
    i = Number(i);
    if (!room || room.phase === "round" || !(room.players && room.players[username]) || !Number.isInteger(i) || !poolOf()[i]) return { ok: false, reason: "not-allowed" };
    const key = "p" + i, mine = (room.picks && room.picks[username]) || {};
    if (mine[key]) { engine.roomRef.child("picks/" + username + "/" + key).remove(); return { ok: true, picked: false }; }
    if (photoCount(room, username) >= MAX_PHOTOS) return { ok: false, reason: "limit" };
    engine.roomRef.child("picks/" + username + "/" + key).set(randomChannel());   // канал можна змінити в лобі
    return { ok: true, picked: true };
  }
  // Канал мого фото: p = { k:"pool", i } | { k:"up", id }. Невідоме значення (старе true) — канал не обрано.
  function photoChannel(room, name, p) {
    const v = p.k === "pool" ? room.picks && room.picks[name] && room.picks[name]["p" + p.i]
      : room.photoMeta && room.photoMeta[name] && room.photoMeta[name][p.id] && room.photoMeta[name][p.id].ch;
    return CHANNEL_IDS.includes(v) ? v : null;
  }
  function setPhotoChannel(p, ch) {
    const room = engine.latestRoom;
    if (!room || room.phase === "round" || !CHANNEL_IDS.includes(ch) || !p) return { ok: false, reason: "not-allowed" };
    if (p.k === "pool") {
      if (!(room.picks && room.picks[username] && room.picks[username]["p" + p.i])) return { ok: false, reason: "not-mine" };
      engine.roomRef.child("picks/" + username + "/p" + p.i).set(ch);
    } else {
      if (!(room.photoMeta && room.photoMeta[username] && room.photoMeta[username][p.id])) return { ok: false, reason: "not-mine" };
      engine.roomRef.child("photoMeta/" + username + "/" + p.id + "/ch").set(ch);
    }
    return { ok: true };
  }

  // ------------------------- фото -------------------------
  const photoCache = new Map();   // ключ → Promise<src>
  function photoKey(p) { return p.k === "pool" ? "pool:" + p.i : "up:" + p.n + ":" + p.id; }
  // Повертає Promise<src> для картинки (шлях з пулу або base64 з RTDB), з кешем.
  function loadPhoto(p) {
    if (!p) return Promise.resolve(null);
    const key = photoKey(p);
    if (photoCache.has(key)) return photoCache.get(key);
    let pr;
    if (p.k === "pool") { const it = poolOf()[p.i]; pr = Promise.resolve(it ? it.src : null); }
    else {
      const roomId = engine.currentRoomId;
      pr = window.rtdb.ref(`fakenews_photos/${roomId}/${p.n}/${p.id}`).get().then((s) => (s.exists() ? s.val() : null)).catch(() => null);
    }
    photoCache.set(key, pr);
    pr.then((src) => { if (!src) photoCache.delete(key); });
    return pr;
  }
  function readableFilename(filename) {
    let decodedFilename = filename;
    try { decodedFilename = decodeURIComponent(filename); } catch (error) {
      if (!(error instanceof URIError)) throw error;
    }
    return decodedFilename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  }
  function photoTitle(p) {
    if (!p) return "";
    if (p.k === "pool") {
      const item = poolOf()[p.i];
      if (!item) return "";
      if (typeof item.title === "string" && item.title.trim()) return item.title.trim();
      const filename = String(item.src || "").split(/[?#]/, 1)[0].split(/[\\/]/).pop() || "";
      return readableFilename(filename);
    }
    if (p.k === "up") {
      const meta = engine.latestRoom && engine.latestRoom.photoMeta &&
        engine.latestRoom.photoMeta[p.n] && engine.latestRoom.photoMeta[p.n][p.id];
      if (meta && typeof meta.title === "string" && meta.title.trim()) return meta.title.trim();
      return `Фото від ${p.n}`; // підпис для фото гравця без назви (раніше тут була технічна фраза про файл)
    }
    return "";
  }
  function poolChoices(room, name) {
    const pool = poolOf();
    if (!pool.length) return [];
    const picks = room.picks && room.picks[name] || {};
    const selected = Object.keys(picks)
      .map((key) => Number(key.slice(1)))
      .filter((index) => Number.isInteger(index) && index >= 0 && index < pool.length);
    let seed = 2166136261;
    for (const char of `${engine.currentRoomId || ""}:${name}`) {
      seed ^= char.charCodeAt(0);
      seed = Math.imul(seed, 16777619);
    }
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const shuffled = pool.map((_, index) => index);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const sample = shuffled.slice(0, POOL_CHOICES);
    const legacyPicks = selected.filter((index) => !sample.includes(index));
    return legacyPicks.concat(sample.filter((index) => !legacyPicks.includes(index))).slice(0, POOL_CHOICES);
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
        while (data.length > PHOTO_MAX_CHARS && q > 0.3) { q -= 0.1; data = c.toDataURL("image/jpeg", q); }
        data.length > PHOTO_MAX_CHARS ? reject(new Error("too-big")) : resolve(data);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad-image")); };
      img.src = url;
    });
  }
  async function addPhoto(file) {
    const room = engine.latestRoom, roomId = engine.currentRoomId;
    if (!room || !roomId || room.phase === "round" || !(room.players && room.players[username])) return { ok: false, reason: "not-allowed" };
    if (!file || !/^image\//.test(file.type || "")) return { ok: false, reason: "not-image" };
    if (photoCount(room, username) >= MAX_PHOTOS) return { ok: false, reason: "limit" };
    let data;
    try { data = await resizeImage(file); } catch (e) { return { ok: false, reason: e.message || "bad-image" }; }
    const ref = window.rtdb.ref(`fakenews_photos/${roomId}/${username}`).push();
    await ref.set(data);
    photoCache.set("up:" + username + ":" + ref.key, Promise.resolve(data));
    await engine.roomRef.child("photoMeta/" + username + "/" + ref.key).set({
      title: readableFilename(file.name || ""),
      ch: randomChannel(),
    });
    return { ok: true, id: ref.key };
  }
  async function removePhoto(id) {
    const room = engine.latestRoom, roomId = engine.currentRoomId;
    if (!room || !roomId || room.phase === "round" || !id) return;
    photoCache.delete("up:" + username + ":" + id);
    await engine.roomRef.child("photoMeta/" + username + "/" + id).remove();
    await window.rtdb.ref(`fakenews_photos/${roomId}/${username}/${id}`).remove();
  }
  function clearPhotos(roomId) {
    photoCache.clear();
    return window.rtdb.ref(`fakenews_photos/${roomId}`).remove().catch(() => {});
  }

  // Колода: спершу фото, які обрали/завантажили гравці (по колу, без дублів), потім решта пулу.
  function buildItems(room, order, total) {
    const need = total + SPARE;
    const meta = room.photoMeta || {}, picks = room.picks || {};
    const names = Array.from(new Set(Object.keys(meta).concat(Object.keys(picks))));
    const queues = shuffle(names).map((n) => shuffle(
      Object.keys(meta[n] || {}).map((id) => ({ p: { k: "up", n, id }, ch: photoChannel(room, n, { k: "up", id }) }))
        .concat(Object.keys(picks[n] || {}).map((k) => ({ p: { k: "pool", i: Number(k.slice(1)) }, ch: photoChannel(room, n, { k: "pool", i: Number(k.slice(1)) }) })))
    ));
    const own = [];
    for (let i = 0; queues.some((q) => q[i]); i++) queues.forEach((q) => { if (q[i]) own.push(q[i]); });
    const seen = new Set();
    const chosen = own.filter((it) => {
      const k = photoKey(it.p);
      if (seen.has(k)) return false;   // кілька гравців могли обрати те саме фото
      seen.add(k); return true;
    });
    const rest = shuffle(poolOf().map((_, i) => ({ p: { k: "pool", i } }))).filter((it) => !seen.has(photoKey(it.p)));
    // обрані гравцями фото йдуть першими (у випадковому порядку), решта пулу — лише добір і запас
    // хто не обрав канал — отримує випадковий, але без двох однакових каналів поспіль, де можна
    const out = shuffle(chosen.slice(0, need)).concat(rest).slice(0, need);
    let prev = null;
    out.forEach((it) => {
      if (!it.ch) { const options = CHANNEL_IDS.filter((c) => c !== prev); it.ch = options[Math.floor(Math.random() * options.length)]; }
      prev = it.ch;
    });
    return out;
  }
  function availablePhotos(room) {
    const meta = room.photoMeta || {};
    const up = Object.values(meta).reduce((n, o) => n + Object.keys(o || {}).length, 0);
    return { uploaded: up, pool: poolOf().length, total: up + poolOf().length };
  }

  // ------------------------- етапи -------------------------
  function stageFor(room, idx) {
    const items = (room.deck && room.deck.items) || [], order = room.order || [];
    const item = items[idx % items.length];
    const ch = channelInfo(item.ch);
    return { kind: "write", title: "Заголовок", hint: `${ch.icon} ${ch.name}: ${ch.hint}`, photo: item.p, expect: order.slice(), durationMs: sec(room, "writeSec", DEFAULT_WRITE_SEC), data: { step: "write", idx, photo: item.p, ch: ch.id } };
  }
  function sortedByVotes(list) { return list.slice().sort((a, b) => b.v - a.v); }
  function reveal(stage, fields) {
    return Object.assign({ kind: "reveal", title: "Результат", photo: stage.photo, durationMs: REVEAL_MS, results: [], lines: [], penalties: {}, points: {} }, fields);
  }

  function nextStage(room, stage, inputs) {
    const order = room.order || [], d = stage.data || {};
    if (d.step === "write") {
      const heads = order.filter((n) => typeof inputs[n] === "string" && inputs[n].trim()).map((n) => ({ n, t: inputs[n] }));
      if (!heads.length) return reveal(stage, { headline: "📭 Ніхто нічого не написав", lines: ["Редакція в шоці"], durationMs: 8000, data: d });
      if (heads.length < 2) return reveal(stage, { headline: "📰 Єдиний заголовок", results: [{ n: heads[0].n, t: heads[0].t, v: 0 }], lines: ["Для голосування потрібно щонайменше два заголовки"], durationMs: 12000, data: d });
      let aired = heads, airCounts = null;
      if (heads.length > MAX_AIRED) {
        const counts = room.airCounts || {};
        aired = shuffle(heads).sort((a, b) => (counts[a.n] || 0) - (counts[b.n] || 0)).slice(0, MAX_AIRED);
        airCounts = Object.assign({}, counts);
        aired.forEach((h) => { airCounts[h.n] = (airCounts[h.n] || 0) + 1; });
      }
      const shuf = shuffle(aired);
      const hint = aired.length < heads.length ? `В ефірі ${aired.length} з ${heads.length} заголовків — решта вийде з наступними фото` : "Дивимось, що вийшло";
      return { kind: "show", title: "Ефір", hint, photo: stage.photo, expect: [], data: { step: "show", idx: d.idx, photo: d.photo, ch: d.ch, texts: shuf.map((h) => h.t), authors: shuf.map((h) => h.n), airCounts } };
    }
    if (d.step === "show") {
      return { kind: "vote", title: "Голосування", hint: "Який заголовок найкращий? За свій голосувати не можна", photo: stage.photo, options: d.texts.map((t, i) => ({ id: String(i), label: t })), expect: order.slice(), durationMs: sec(room, "voteSec", DEFAULT_VOTE_SEC), data: Object.assign({}, d, { step: "vote" }) };
    }
    // vote → результат
    const counts = {};
    Object.entries(inputs).forEach(([voter, v]) => {
      const i = Number(v);
      if (Number.isInteger(i) && d.authors[i] !== undefined && d.authors[i] !== voter) counts[i] = (counts[i] || 0) + 1;
    });
    const results = sortedByVotes(d.texts.map((t, i) => ({ n: d.authors[i], t, v: counts[i] || 0 })));
    const top = results[0].v, winners = top > 0 ? results.filter((r) => r.v === top) : [];
    const points = {};
    results.forEach((r) => { const p = r.v + (winners.includes(r) ? WIN_BONUS : 0); if (p) points[r.n] = (points[r.n] || 0) + p; });
    const zeros = results.filter((r) => r.v === 0);
    const penalties = {};
    const lines = [];
    if (winners.length) lines.push(`🏆 ${winners.map((w) => w.n).join(", ")}: +${WIN_BONUS} бали бонусом`);
    else lines.push("Ніхто не отримав голосів");
    if (winners.length && zeros.length && zeros.length <= Math.floor(results.length / 3)) {
      zeros.forEach((z) => { penalties[z.n] = 1; });
      lines.push(`Сухий гумор (0 голосів), ковток: ${zeros.map((z) => z.n).join(", ")}`);
    }
    return reveal(stage, {
      headline: winners.length ? `🏆 ${winners[0].t}` : "🤷 Голосів немає", results, lines, penalties, points,
      data: d, owner: d.photo && d.photo.k === "up" ? d.photo.n : null,
    });
  }

  // ------------------------- рішення хоста -------------------------
  function progress(room) {
    if (busy || room.paused || room.phase !== "round" || !room.stage) return; // пауза (js/core/game-pause.js) — нічого не рухаємо
    const st = room.stage, now = engine.now();
    if (st.kind === "reveal") { if (st.endsAt && now >= st.endsAt) nextRound(); return; }
    if (st.kind === "show") {
      const sh = room.show;
      if (!sh) return;
      if (now - sh.at >= sec(room, "showSec", DEFAULT_SHOW_SEC)) advanceShow(room);
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
    const update = Object.assign({ stage: st, stageSeq: seq, inputs: null, show: st.kind === "show" ? { idx: 0, at: now } : null }, extra || {});
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
      const next = nextStage(cur, cur.stage, validInputs(cur));
      const extra = next.data && next.data.airCounts ? { airCounts: next.data.airCounts } : null;
      if (next.data) delete next.data.airCounts;
      await engine.roomRef.update(commitStage(cur, next, extra));
    } finally { busy = false; }
  }

  // Ефір: наступний заголовок; після останнього — голосування.
  async function advanceShow(room) {
    busy = true;
    try {
      const cur = engine.latestRoom;
      if (!cur || cur.phase !== "round" || !cur.stage || cur.stage.kind !== "show" || cur.stage.id !== room.stage.id) return;
      const idx = ((cur.show && cur.show.idx) || 0) + 1;
      if (idx >= cur.stage.data.texts.length) { await engine.roomRef.update(commitStage(cur, nextStage(cur, cur.stage, {}))); return; }
      await engine.roomRef.update({ show: { idx, at: engine.now() } });
    } finally { busy = false; }
  }

  async function nextRound() {
    const cur = engine.latestRoom;
    if (!cur || cur.phase !== "round" || !cur.stage || cur.stage.kind !== "reveal" || busy) return;
    busy = true;
    try {
      const n = cur.roundNo + 1;
      if (n >= cur.totalRounds) { await engine.roomRef.update({ phase: "summary", stage: null, inputs: null, show: null }); return; }
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
    const next = {};
    for (const key of ["writeSec", "showSec", "voteSec"]) {
      const seconds = Number(partial[key]);
      if (Number.isInteger(seconds) && seconds >= MIN_TIMER_SEC && seconds <= MAX_TIMER_SEC) next[key] = seconds;
    }
    if (Object.keys(next).length) engine.roomRef.child("settings").update(next);
  }

  function startSet(room) {
    room = room || engine.latestRoom;
    if (!room || room.phase === "round" || !isHostNow()) return { ok: false, reason: "not-allowed" };
    const names = connectedNames(room.players);
    if (names.length < MIN_PLAYERS) return { ok: false, reason: "not-enough-players" };
    const av = availablePhotos(room);
    if (!av.total) return { ok: false, reason: "no-photos" };
    const settings = room.settings || {};
    const total = av.total;   // раунд на кожне обране фото
    const items = buildItems(room, names, total);
    const draft = Object.assign({}, room, { stageSeq: 0, order: names, deck: { items } });
    engine.roomRef.update(commitStage(draft, stageFor(draft, 0), {
      phase: "round", setId: engine.now(), order: names, deck: { items },
      roundNo: 0, totalRounds: total, "tally/set": null, airCounts: null,
    }));
    return { ok: true, rounds: total };
  }

  function skip() {
    const room = engine.latestRoom;
    if (!room || room.phase !== "round" || !room.stage || !isHostNow() || busy) return;
    if (room.stage.kind === "reveal") nextRound(); else endStage(room);
  }
  // «Наступний заголовок» в ефірі, не чекаючи таймера.
  function nextHeadline() {
    const room = engine.latestRoom;
    if (!room || room.phase !== "round" || !room.stage || room.stage.kind !== "show" || !isHostNow() || busy) return;
    advanceShow(room);
  }
  // «Інше фото»: хост міняє поточне фото на наступне з колоди (лише поки пишуть заголовки).
  async function skipItem() {
    const room = engine.latestRoom;
    if (!room || room.phase !== "round" || !room.stage || room.stage.kind !== "write" || !isHostNow() || busy) return;
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
    engine.roomRef.update({ phase: "summary", stage: null, inputs: null, show: null });
  }
  function toLobby() {
    const room = engine.latestRoom, roomId = engine.currentRoomId;
    if (!room || room.phase !== "summary" || !isHostNow()) return;
    engine.roomRef.update({ phase: "lobby", stage: null, inputs: null, show: null, deck: null, order: null, roundNo: 0, totalRounds: 0, photoMeta: null, picks: null });
    clearPhotos(roomId);   // фото були лише на один набір
  }
  function resetAll() {
    const roomId = engine.currentRoomId;
    if (!roomId || !isHostNow()) return;
    engine.forceResetRoom(roomId, SCHEMA, buildFreshRoom);
    clearPhotos(roomId);
  }

  window.FakeNewsGame = {
    SET_CAP, MIN_PLAYERS, MAX_PHOTOS, POOL_CHOICES, HEADLINE_MAX, MIN_TIMER_SEC, MAX_TIMER_SEC, CHANNELS,
    DEFAULT_WRITE_SEC, DEFAULT_SHOW_SEC, DEFAULT_VOTE_SEC,
    connectedNames, availablePhotos, photoCount, readyNames, poolChoices, togglePoolPick, photoChannel, setPhotoChannel,
    computeHost: (players) => engine.computeHost(players),
    isConnected: (p) => engine.isConnected(p),
    now: () => engine.now(),
    inputOf, waitingNames, loadPhoto, photoTitle,
    watchActiveRooms,
    start, stop, startSet, updateSettings, answer, skip, skipItem, nextHeadline, addPhoto, removePhoto, endSet, toLobby, resetAll, cycleAvatar,
    get roomId() { return engine.currentRoomId; },
    get roomRef() { return engine.roomRef; },
    set onStateChange(fn) { onStateChange = fn; },
  };
})();
