// ==========================================================================
// Мемологія — портовано з Node.js+Socket.io на спільний online-engine.js.
// Публічний API window.MemologyGame. Підключати після online-engine.js,
// memology-prompts.js і memology-cards.js.
//
// Найскладніша частина порту — спільна колода карток (deckNew/deckPlayed).
// На старому сервері це було безпечно "само собою", бо Node.js
// однопотоковий. Тут кілька клієнтів можуть тягнути карти одночасно
// (найпомітніше — на старті гри, коли всі роздають собі руку в один момент),
// тож весь пул тримається ОДНИМ вузлом `deck` і читається/пишеться виключно
// через RTDB-транзакцію — це гарантує, що жодна картка не потрапить одразу
// двом гравцям, так само як у Хто я? з пулом слів.
//
// Чесне застереження про анонімність голосування: на старому сервері автор
// картки під час voting-фази взагалі не потрапляв у пейлоад клієнту (сервер
// його приховував). Тут RTDB-правила відкриті на читання для друзів (як і
// для решти ігор серії), тому "анонімність" — це вже конвенція UI (ми просто
// не показуємо автора в інтерфейсі під час голосування), а не гарантія на
// рівні даних. Для грайливої гри в колі друзів це прийнятний компроміс,
// узгоджений з рештою rules.md (розділ 9) — але технічно наполегливий
// гравець з devtools зможе підглянути.
// ==========================================================================
(function () {
  const GAME_KEY = "memology";
  const MIN_PLAYERS = 2;
  const ABANDON_MS = 15 * 60 * 1000;
  const HAND_SIZE = 6;
  const SWAP_COST = 1;
  const DECK_RESET_COOLDOWN_ROUNDS = 4;
  const AVATAR_STORAGE_PREFIX = "games41_quiplash_avatar_"; // профіль аватара з Смішліста
  // монстрики Сміхлиста (js/quiplash-avatars.js) — підключати ДО цього файлу
  const QA = () => window.QuiplashAvatars;
  const CHARACTERS = QA() ? QA().COUNT : 8;
  const charColor = (c) => (QA() ? QA().color(c) : "#ff4d4d");

  const ROOM_SCHEMA = {
    phase: "lobby", // lobby | active
    deck: { new: [], played: [] },
    round: null,
    roundNumber: 0,
    usedPrompts: [],
    lastDeckResetRound: null,
    pendingSwaps: {},
    players: {},
  };

  const Engine = window.OnlineEngine.create(GAME_KEY, {
    abandonMs: ABANDON_MS,
    onEmptyPlayer: () => ({ score: 0, hand: [] }),
  });

  let username = null;
  let onStateChange = () => {};
  let latestState = null;
  let avatarAsked = false;

  // ------------------------- аватари (як у Дилемах) -------------------------
  function takenChars(state) {
    return new Set(Object.entries((state && state.players) || {}).filter(([n]) => n !== username).map(([, p]) => Number(p && p.character)));
  }
  function avatarFor(state) {
    const taken = takenChars(state);
    let want = null;
    try {
      const raw = window.localStorage && window.localStorage.getItem(AVATAR_STORAGE_PREFIX + username);
      const profile = raw ? JSON.parse(raw) : null;
      if (profile && profile.character >= 1 && profile.character <= CHARACTERS) want = Number(profile.character);
    } catch (e) { /* немає localStorage — беремо за чергою */ }
    if (want && !taken.has(want)) return { character: want, color: charColor(want) };
    const idx = Object.keys((state && state.players) || {}).length;
    for (let i = 0; i < CHARACTERS; i++) {
      const c = ((want || idx) + i) % CHARACTERS + 1;
      if (!taken.has(c)) return { character: c, color: charColor(c) };
    }
    const c = (idx % CHARACTERS) + 1;
    return { character: c, color: charColor(c) };
  }
  // Тап по своїй аватарці в лобі — наступний вільний персонаж (без дублів).
  function cycleAvatar() {
    const state = latestState, me = state && state.players && state.players[username];
    if (!me || state.phase !== "lobby" || !Engine.roomRef) return;
    const taken = takenChars(state), cur = Number(me.character) || 1;
    for (let i = 1; i <= CHARACTERS; i++) {
      const c = (cur - 1 + i) % CHARACTERS + 1;
      if (taken.has(c)) continue;
      Engine.roomRef.child("players/" + username).update({ character: c, color: charColor(c) });
      try { localStorage.setItem(AVATAR_STORAGE_PREFIX + username, JSON.stringify({ character: c, color: charColor(c) })); } catch (e) {}
      return;
    }
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function connectedEntries(players) {
    return Object.entries(players || {}).filter(([, p]) => Engine.isConnected(p));
  }

  function isHost(players) {
    return username && Engine.computeHost(players) === username;
  }

  // ------------------------- спільна колода (транзакційно) -------------------------
  // Тягне n карт атомарно; повертає масив реально витягнутих id (може бути
  // коротшим за n, якщо картки взагалі скінчились — крайній випадок).
  function drawCardsTx(n) {
    if (n <= 0 || !Engine.roomRef) return Promise.resolve([]);
    return Engine.roomRef.child("deck").transaction((deck) => {
      deck = deck || { new: [], played: [] };
      let pool = (deck.new || []).slice();
      let played = (deck.played || []).slice();
      const drawn = [];
      for (let i = 0; i < n; i++) {
        if (pool.length === 0) {
          if (played.length === 0) break;
          pool = shuffle(played);
          played = [];
        }
        drawn.push(pool.pop());
      }
      // _lastDrawn — тимчасове службове поле, щоб дізнатись РЕЗУЛЬТАТ саме
      // нашої транзакції (RTDB transaction повертає лише новий стан вузла,
      // тому "останнє витягнуте" тут і є те, що дісталось нам).
      return { new: pool, played: played, _lastDrawn: drawn };
    }).then((result) => {
      const val = (result && result.snapshot && result.snapshot.val()) || {};
      return val._lastDrawn || [];
    });
  }

  function discardToPlayedTx(cardId) {
    if (!Engine.roomRef) return Promise.resolve();
    return Engine.roomRef.child("deck").transaction((deck) => {
      deck = deck || { new: [], played: [] };
      const played = (deck.played || []).slice();
      played.push(cardId);
      return { new: deck.new || [], played };
    });
  }

  // добирає руку гравця до HAND_SIZE; викликається реактивно (див. onStateChange)
  // Додати глобальну змінну на рівні модуля:
  let isDrawing = false;

  function fillHandToSize(hand) {
    const current = hand || [];
    const need = HAND_SIZE - current.length;
    // Перевіряємо блокувальник
    if (need <= 0 || !Engine.roomRef || isDrawing) return;

    isDrawing = true;
    drawCardsTx(need).then((drawn) => {
      isDrawing = false;
      if (!drawn.length) return;
      
      // Обов'язково беремо свіжу руку з БД, щоб не стерти результат паралельного обміну (swap)
      Engine.roomRef.child("players/" + username + "/hand").once("value").then(snap => {
        const latestHand = snap.val() || [];
        Engine.roomRef.child("players/" + username + "/hand").set(latestHand.concat(drawn));
      });
    }).catch(() => {
      isDrawing = false;
    });
  }

  // ------------------------- ситуації -------------------------
  function pickPrompt(state) {
    const all = MEMOLOGY_PROMPTS;
    let used = state.usedPrompts || [];
    let available = all.filter((p) => used.indexOf(p) === -1);
    if (!available.length) { used = []; available = all; }
    const prompt = available[Math.floor(Math.random() * available.length)];
    return { promptText: prompt, usedPrompts: used.concat([prompt]) };
  }

  // ------------------------- раунди (веде хост) -------------------------
  function startNewRound(state) {
    const { promptText, usedPrompts } = pickPrompt(state);
    return Engine.roomRef.update({
      roundNumber: (state.roundNumber || 0) + 1,
      round: { promptText, subPhase: "submitting", submissions: {}, votes: {} },
      usedPrompts,
    });
  }

  function advanceToVoting(state) {
    // Збираємо ключі (або дані) зданих карток
    const submissionsObj = state.round.submissions || {};
    const playerNames = Object.keys(submissionsObj);

    // Перемішуємо масив імен гравців випадковим чином (Алгоритм Фішера-Єтса або схожий)
    for (let i = playerNames.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [playerNames[i], playerNames[j]] = [playerNames[j], playerNames[i]];
    }

    // Зберігаємо зафіксований порядок у базі даних (у стані раунду)
    Engine.roomRef.child("round").update({
      subPhase: "voting",
      votingOrder: playerNames // <-- ОСЬ ЦЕЙ ФІКСОВАНИЙ МАСИВ
    });
  }

  function revealRound(state) {
    const votes = (state.round && state.round.votes) || {};
    const tally = {};
    Object.values(votes).forEach((authorUsername) => {
      tally[authorUsername] = (tally[authorUsername] || 0) + 1;
    });
    const updates = {};
    Object.entries(tally).forEach(([authorUsername, count]) => {
      const p = state.players[authorUsername];
      if (p) updates["players/" + authorUsername + "/score"] = (p.score || 0) + count;
    });
    updates["round/subPhase"] = "reveal";
    updates["round/tally"] = tally;
    Engine.roomRef.update(updates);
  }

  // тільки хост фактично пише перехід фази — і будь-який клієнт може
  // "помітити" умову виконання (ідемпотентно: повторний виклик нічого не
  // зіпсує, бо subPhase вже зміниться після першого успішного запису)
  function checkAdvance(state) {
    if (!isHost(state.players) || !state.round) return;
    const conn = connectedEntries(state.players);
    if (state.round.subPhase === "submitting") {
      const eligible = conn; // Вимагаємо хід від усіх підключених гравців
      const submitted = Object.keys(state.round.submissions || {}).length;
      if (eligible.length > 0 && submitted >= eligible.length) advanceToVoting(state);
    } else if (state.round.subPhase === "voting") {
      const voted = Object.keys(state.round.votes || {}).length;
      if (conn.length > 0 && voted >= conn.length) revealRound(state);
    }
  }

  // ------------------------- список активних кімнат -------------------------
  function watchActiveRooms(callback) {
    if (!window.rtdb) { callback([]); return () => {}; }
    const ref = window.rtdb.ref(`${GAME_KEY}_rooms`);
    const onValue = (snap) => {
      const rooms = snap.val() || {};
      const t = Engine.now();
      const list = Object.entries(rooms).map(([roomId, room]) => {
        const players = room.players || {};
        const connected = connectedEntries(players);
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

  // ------------------------- приєднання / presence -------------------------
  function start(user, roomId) {
    username = user;
    Engine.start(user, { useLobby: false });

    Engine.onStateChange = (type, data) => {
      if (type !== "room-update") return;
      const state = data.room;
      latestState = state;
      const me = state.players && state.players[username];

      // у гравця ще нема монстрика (щойно зайшов) — призначаємо один раз
      if (me && !me.character && !avatarAsked) {
        avatarAsked = true;
        Engine.roomRef.child("players/" + username).update(avatarFor(state));
      }
      if (me && me.character) avatarAsked = false;

      // активна гра й моя рука неповна (щойно стартувала гра, приєднався
      // посеред неї, або тільки-но подав картку) — добираю сам собі
      if (state.phase === "active" && me && (!me.hand || me.hand.length < HAND_SIZE)) {
        fillHandToSize(me.hand);
      }

      checkAdvance(state);

      onStateChange(state, { username, host: isHost(state.players) });
    };

    return Engine.getOrCreateRoom(roomId, ROOM_SCHEMA, () => ({})).then(() => {
      return Engine.joinRoom(roomId, { asPlayer: true });
    });
  }

  function stop() { Engine.stop(); }

  // ------------------------- дії хоста -------------------------
  function startGame(state) {
    const conn = connectedEntries(state.players);
    if (conn.length < MIN_PLAYERS) return;
    if (!MEMOLOGY_CARD_IDS.length) return;
    Engine.roomRef.update({
      phase: "active",
      deck: { new: shuffle(MEMOLOGY_CARD_IDS), played: [] },
    }).then(() => startNewRound({ roundNumber: 0, usedPrompts: [] }));
  }

  function nextRound(state) {
    if (!isHost(state.players) || state.phase !== "active") return;
    if (!state.round || state.round.subPhase !== "reveal") return;
    startNewRound(state);
  }

  function forceAdvance(state) {
    if (!isHost(state.players) || state.phase !== "active" || !state.round) return;
    if (state.round.subPhase === "submitting") advanceToVoting(state);
    else if (state.round.subPhase === "voting") revealRound(state);
  }

  function resetAll(state) {
    const roomId = Engine.currentRoomId;
    if (!roomId) return Promise.resolve();
    const keptPlayers = {};
    connectedEntries(state.players).forEach(([name, p]) => {
      keptPlayers[name] = { joinedAt: p.joinedAt, lastSeen: p.lastSeen, score: 0, hand: [], character: p.character || null, color: p.color || null };
    });
    if (window.rtdb) window.rtdb.ref("fakenews_photos/memology-" + roomId).remove().catch(() => {}); // свої фото — лише на одну гру
    return Engine.forceResetRoom(roomId, ROOM_SCHEMA, () => ({ players: keptPlayers })).then(() => {
      return Engine.joinRoom(roomId, { asPlayer: true });
    });
  }

  // ------------------------- дії гравця -------------------------
  function submitCard(state, cardId) {
    const me = state.players && state.players[username];
    if (!me || !state.round || state.round.subPhase !== "submitting") return;
    if (state.round.submissions && state.round.submissions[username]) return;
    const idx = (me.hand || []).indexOf(cardId);
    if (idx === -1) return;
    const newHand = me.hand.slice();
    newHand.splice(idx, 1);

    Engine.roomRef.child("players/" + username + "/hand").set(newHand);
    Engine.roomRef.child("round/submissions/" + username).set(cardId);
    discardToPlayedTx(cardId);
    // нову картку замість зіграної добере реактивний fillHandToSize на
    // наступному оновленні стану — тут навмисно нічого не тягнемо самі,
    // щоб не було подвійного добору паралельно з ним
  }

  // Передумав: поки інші ще обирають, міняємо кинутий мем на інший з руки.
  // Старий мем повертається в руку на місце нового, у відбої — навпаки.
  function changeSubmission(state, newCardId) {
    const me = state.players && state.players[username];
    const r = state.round;
    if (!me || !r || r.subPhase !== "submitting") return;
    const old = r.submissions && r.submissions[username];
    if (!old || old === newCardId) return;
    const idx = (me.hand || []).indexOf(newCardId);
    if (idx === -1) return;
    const newHand = me.hand.slice();
    newHand.splice(idx, 1, old);
    Engine.roomRef.update({
      ["players/" + username + "/hand"]: newHand,
      ["round/submissions/" + username]: newCardId,
    });
    Engine.roomRef.child("deck").transaction((deck) => {
      deck = deck || { new: [], played: [] };
      const played = (deck.played || []).slice();
      const i = played.lastIndexOf(old);
      if (i !== -1) played.splice(i, 1);
      played.push(newCardId);
      return { new: deck.new || [], played };
    });
  }

  // ------------------------- свої фото як меми -------------------------
  // Фото лежать окремо від кімнати (кімнату читають усі на кожне оновлення):
  // fakenews_photos/memology-<кімната>/<гравець>/<id> — той самий вузол і ті
  // самі правила бази, що й у Fake News (JPEG base64 < 150000), тож нових
  // правил деплоїти не треба. Картка такого мему — "u:<гравець>:<id>".
  const USER_PHOTO_MAX_CHARS = 140000;
  const MAX_OWN_PHOTOS = 5;
  function photosPath() { return "fakenews_photos/memology-" + Engine.currentRoomId; }
  function isUserCard(cardId) { return typeof cardId === "string" && cardId.indexOf("u:") === 0; }
  function userCardRef(cardId) {
    const rest = cardId.slice(2), i = rest.lastIndexOf(":");
    return window.rtdb.ref(photosPath() + "/" + rest.slice(0, i) + "/" + rest.slice(i + 1));
  }
  function compressPhoto(file) {
    return new Promise((resolve, reject) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let w = img.naturalWidth, h = img.naturalHeight;
        const scale = Math.min(1, 720 / Math.max(w, h));
        w = Math.round(w * scale); h = Math.round(h * scale);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        let q = 0.82, data = c.toDataURL("image/jpeg", q);
        while (data.length > USER_PHOTO_MAX_CHARS && q > 0.3) { q -= 0.1; data = c.toDataURL("image/jpeg", q); }
        if (data.length > USER_PHOTO_MAX_CHARS) { reject(new Error("too-big")); return; }
        resolve(data);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad-image")); };
      img.src = url;
    });
  }
  // Додає фото гравцеві в руку (рука може тимчасово стати 7 — після кидка добір не робиться).
  async function addOwnPhoto(state, file) {
    const me = state && state.players && state.players[username];
    if (!me || state.phase !== "active" || !Engine.roomRef) return { ok: false, reason: "not-active" };
    if ((me.ownPhotos || 0) >= MAX_OWN_PHOTOS) return { ok: false, reason: "limit" };
    let data;
    try { data = await compressPhoto(file); } catch (e) { return { ok: false, reason: e.message }; }
    const ref = window.rtdb.ref(photosPath() + "/" + username).push();
    try { await ref.set(data); } catch (e) { return { ok: false, reason: "upload" }; }
    const cardId = "u:" + username + ":" + ref.key;
    const fresh = (await Engine.roomRef.child("players/" + username).once("value")).val() || {};
    await Engine.roomRef.child("players/" + username).update({ hand: (fresh.hand || []).concat(cardId), ownPhotos: (fresh.ownPhotos || 0) + 1 });
    return { ok: true, cardId, data };
  }
  function loadUserCard(cardId) {
    if (!isUserCard(cardId) || !window.rtdb || !Engine.currentRoomId) return Promise.resolve(null);
    return userCardRef(cardId).get().then((s) => (s.exists() ? s.val() : null)).catch(() => null);
  }

  function castVote(state, cardId) {
    if (!state.round || state.round.subPhase !== "voting") return;
    if (state.round.votes && state.round.votes[username]) return;
    const authorUsername = Object.keys(state.round.submissions || {}).find(
      (u) => state.round.submissions[u] === cardId
    );
    if (!authorUsername || authorUsername === username) return;
    Engine.roomRef.child("round/votes/" + username).set(authorUsername);
  }

  function deckResetCost(state) {
    return Math.max(0, connectedEntries(state.players).length - 1);
  }
  
  function deckResetRoundsLeft(state) {
    const me = state.players && state.players[username];
    if (!me || me.lastDeckResetRound == null) return 0; // Беремо з me, а не зі state
    const passed = (state.roundNumber || 0) - me.lastDeckResetRound;
    return Math.max(0, DECK_RESET_COOLDOWN_ROUNDS - passed);
  }

  function resetMyDeck(state) {
    const me = state.players && state.players[username];
    if (!me || state.phase !== "active") return;
    if (deckResetRoundsLeft(state) > 0) return;
    const cost = deckResetCost(state);
    const oldHand = me.hand || [];

    Engine.roomRef.child("deck").transaction((deck) => {
      deck = deck || { new: [], played: [] };
      return { new: deck.new || [], played: (deck.played || []).concat(oldHand) };
    }).then(() => {
      Engine.roomRef.update({
        ["players/" + username + "/hand"]: [],
        ["players/" + username + "/score"]: (me.score || 0) - cost,
        // Записуємо глобально гравцю, а не кімнаті!
        ["players/" + username + "/lastDeckResetRound"]: state.roundNumber || 0, 
      });
    });
  }

  // ------------------------- обмін карткою -------------------------
  function requestSwap(state, myCardId, targetUsername) {
    const me = state.players && state.players[username];
    if (!me || state.phase !== "active") return null;
    if ((me.hand || []).indexOf(myCardId) === -1) return null;
    const target = state.players[targetUsername];
    if (!target || targetUsername === username || !Engine.isConnected(target)) return null;
    if (!target.hand || !target.hand.length) return null;
    const pending = state.pendingSwaps || {};
    const busy = Object.values(pending).some(
      (r) => r.fromUsername === username || r.targetUsername === targetUsername
    );
    if (busy) return null;

    const reqId = "swap_" + username + "_" + Date.now();
    Engine.roomRef.child("pendingSwaps/" + reqId).set({
      fromUsername: username, targetUsername, myCardId, createdAt: Date.now(),
    });
    return reqId;
  }

  function cancelSwap(reqId) {
    if (Engine.roomRef) Engine.roomRef.child("pendingSwaps/" + reqId).remove();
  }

  function respondSwap(state, reqId, accepted, giveCardId) {
    const req = state.pendingSwaps && state.pendingSwaps[reqId];
    if (!req || req.targetUsername !== username) return;
    Engine.roomRef.child("pendingSwaps/" + reqId).remove();
    if (!accepted) return;

    const initiator = state.players[req.fromUsername];
    const target = state.players[username];
    if (!initiator || !target || state.phase !== "active") return;
    const myIdx = (initiator.hand || []).indexOf(req.myCardId);
    const giveIdx = (target.hand || []).indexOf(giveCardId);
    if (myIdx === -1 || giveIdx === -1) return; // картки вже змінились, поки чекали відповіді

    const newInitiatorHand = initiator.hand.slice();
    newInitiatorHand.splice(myIdx, 1, giveCardId);
    const newTargetHand = target.hand.slice();
    newTargetHand.splice(giveIdx, 1, req.myCardId);

    const updates = {};
    updates["players/" + req.fromUsername + "/hand"] = newInitiatorHand;
    updates["players/" + req.fromUsername + "/score"] = (initiator.score || 0) - SWAP_COST;
    updates["players/" + username + "/hand"] = newTargetHand;
    Engine.roomRef.update(updates);
  }

  window.MemologyGame = {
    MIN_PLAYERS,
    HAND_SIZE,
    SWAP_COST,
    cycleAvatar,
    connectedEntries,
    computeHost: Engine.computeHost,
    deckResetCost,
    deckResetRoundsLeft,
    watchActiveRooms,
    start,
    stop,
    startGame,
    nextRound,
    forceAdvance,
    resetAll,
    submitCard,
    castVote,
    changeSubmission,
    addOwnPhoto,
    loadUserCard,
    isUserCard,
    MAX_OWN_PHOTOS,
    resetMyDeck,
    requestSwap,
    cancelSwap,
    respondSwap,
    get roomId() { return Engine.currentRoomId; },
    get roomRef() { return Engine.roomRef; },
    set onStateChange(fn) { onStateChange = fn; },
  };
})();