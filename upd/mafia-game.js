// ==========================================================================
// mafia-game.js — FSM-рушій "Мафії" поверх online-engine.js.
//
// Архітектура (див. специфікацію):
//   - ownerUsername (у нас — engine-івський room.hostUsername) пишеться
//     ОДИН РАЗ при створенні кімнати (engine.createRoom, БЕЗ opts.lockedHost
//     — тобто движок ніколи сам його не переобирає). Тік FSM іде лише на
//     пристрої, де myUsername === room.hostUsername; якщо власник офлайн —
//     тік просто ніде не крутиться, гра стоїть на паузі. Жодних CAS/
//     переобрань з нашого боку теж нема.
//   - Жодна таймерна фаза не переривається достроково: тік лише ЧЕКАЄ
//     phaseDeadline і виконує перехід, ніколи не завершує фазу раніше
//     через "усі вже проголосували".
//   - Дедуп/дебаунс вихідних оновлень у публічний onStateChange — у старому
//     проєкті heartbeat КОЖНОГО гравця (раз/2с) будив onValue по ВСІЙ
//     кімнаті, і UI, що сліпо перемальовував DOM на кожен такий тик,
//     зносив кнопки просто в момент кліку. Тут це гаситься на джерелі.
// ==========================================================================
(function () {
  "use strict";

  const GAME_KEY = "mafia2";
  const ROOMS_PATH = GAME_KEY + "_rooms"; // має 1-в-1 збігатись із внутрішньою назвою в online-engine.js
  const DISPATCH_DEBOUNCE_MS = 150;

  const MIN_PLAYERS = 5;
  const MAX_PLAYERS = 12;

  const DEFAULT_SETTINGS = {
    doctorEnabled: true,
    sheriffEnabled: true,
    mafiaCount: null, // null = авто (за кількістю гравців)
    mafiaConsensus: "majority", // "majority" | "strict"
  };

  const ROLE_META = {
    mafia: { name: "Мафія", icon: "🔪", desc: "Вночі обираєте разом, кого усунути." },
    doctor: { name: "Лікар", icon: "💉", desc: "Вночі рятуй одного гравця (можна себе)." },
    sheriff: { name: "Шериф", icon: "🕵️", desc: "Вночі перевіряй одного гравця — мафія чи ні." },
    civilian: { name: "Мирний житель", icon: "🙂", desc: "Вдень шукай мафію разом з усіма." },
  };

  // Тривалості фаз (мс). Єдине джерело правди для тіку.
  // "night_reveal": 10s лишив за первинною специфікацією — у робочій
  // таблиці звуків його нема окремим рядком (там лише banner_morning
  // 3.5s), тож якщо насправді малась на увазі коротша/інша тривалість —
  // це один рядок для правки тут.
  const PHASE_DURATIONS = {
    role_reveal: 5000,
    banner_night_start: 2500,
    mafia_move: 20000,
    doctor_move: 15000,
    sheriff_move: 15000,
    banner_morning: 3500,
    night_reveal: 10000,
    last_words: 15000,
    day_discussion: 90000,
    voting: 30000,
    player_elimination_anim: 7000,
    banner_state: 10000,
  };

  // ------------------------- схема кімнати -------------------------
  function onEmptyPlayer() { return { role: null, isDon: false, alive: true, ready: false }; }

  const ROOM_SCHEMA = {
    phase: "lobby",
    phaseDeadline: null,
    hostUsername: null,
    settings: DEFAULT_SETTINGS,
    nightNumber: 0,
    moves: {},
    votes: {},
    nightResult: null,
    lastEliminated: null,
    lastWords: null,
    lastWordsNext: null,
    chat: {},
    winner: null,
    players: {},
  };

  function buildFreshRoom() {
    return {
      phase: "lobby",
      phaseDeadline: null,
      settings: { ...DEFAULT_SETTINGS },
      nightNumber: 0,
      moves: {},
      votes: {},
      nightResult: null,
      lastEliminated: null,
      lastWords: null,
      lastWordsNext: null,
      chat: {},
      winner: null,
    };
  }

  const engine = window.OnlineEngine.create(GAME_KEY, {
    onEmptyPlayer,
    // lockedHost навмисно НЕ передаємо — hostUsername лишається тим, ким
    // був записаний при створенні кімнати, назавжди.
  });

  let myUsername = null;
  let currentRoomId = null;
  let gameOnStateChange = () => {};
  let ownerTickTimer = null;
  let advancingSincePhase = null; // від якої фази вже надіслали перехід — чекаємо підтвердження
  let dispatchTimer = null;
  let pendingRoom = null;

  // ------------------------- допоміжне -------------------------
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function isConnected(p) { return engine.isConnected(p); }
  function connectedEntries(players) {
    return Object.entries(players || {}).filter(([, p]) => isConnected(p));
  }

  function resolveMafiaCount(n, settings) {
    const cap = Math.max(1, n - (settings.doctorEnabled ? 1 : 0) - (settings.sheriffEnabled ? 1 : 0) - 1);
    if (settings.mafiaCount) return Math.min(settings.mafiaCount, 3, cap);
    return Math.max(1, Math.min(3, Math.floor(n / 4), cap));
  }

  function checkWinCondition(players) {
    const alive = Object.values(players || {}).filter((p) => p.alive);
    const mafia = alive.filter((p) => p.role === "mafia").length;
    const others = alive.length - mafia;
    if (mafia === 0) return "civilians";
    if (mafia >= others) return "mafia";
    return null;
  }

  // ------------------------- запуск/зупинка -------------------------
  // ВАЖЛИВО: свідомо НЕ використовуємо engine.createRoom() тут — та
  // обгортка завжди приєднує викликача asPlayer:true, тобто хтось, хто
  // просто відкрив код активної (не-lobby) кімнати, миттєво дописався б у
  // players/ без ролі й зламав би checkWinCondition на решту раунду.
  // Замість цього: getOrCreateRoom (сама створює hostUsername лише для
  // ЩОЙНО створеної кімнати) → рішення asPlayer/spectator за room.phase →
  // joinRoom. mafia.html вже має екран "waiting" саме на цей випадок.
  function start(username, roomId) {
    myUsername = username;
    currentRoomId = roomId;
    engine.onStateChange = handleEngineEvent;
    engine.start(username, { useLobby: false });
    return engine.getOrCreateRoom(roomId, ROOM_SCHEMA, () => Object.assign(buildFreshRoom(), {
      hostUsername: username, // пишеться лише якщо кімната справді щойно створюється
    })).then((result) => {
      const room = result.room;
      const players = room.players || {};
      const alreadyIn = !!players[username];
      const roomFull = Object.keys(players).length >= MAX_PLAYERS;
      const gameRunning = room.phase !== "lobby";
      const asPlayer = alreadyIn || (!roomFull && !gameRunning);
      return engine.joinRoom(roomId, { asPlayer }).then(() => result);
    });
  }

  // Якщо приєднались спостерігачем під час активного раунду (гра вже йшла),
  // автоматично стаємо гравцем, щойно кімната повертається в lobby.
  function maybeBecomePlayer(room) {
    if (!room || !myUsername || room.phase !== "lobby") return;
    const players = room.players || {};
    if (players[myUsername]) return;
    if (Object.keys(players).length >= MAX_PLAYERS) return;
    engine.becomePlayer();
  }

  function stop() {
    if (ownerTickTimer) { clearInterval(ownerTickTimer); ownerTickTimer = null; }
    if (dispatchTimer) { clearTimeout(dispatchTimer); dispatchTimer = null; }
    advancingSincePhase = null;
    engine.stop();
  }

  // ------------------------- вхідний потік подій рушія -------------------------
  function handleEngineEvent(event, payload) {
    if (event !== "room-update") return;
    const room = payload.room;
    if (!room) return;

    if (advancingSincePhase && room.phase !== advancingSincePhase) advancingSincePhase = null;

    maybeBecomePlayer(room);

    const iAmOwner = room.hostUsername === myUsername;
    if (iAmOwner && !ownerTickTimer) ownerTickTimer = setInterval(ownerTick, 250);
    if (!iAmOwner && ownerTickTimer) { clearInterval(ownerTickTimer); ownerTickTimer = null; }

    scheduleDispatch(room);
  }

  // Дебаунсимо вихід у гро-специфічний onStateChange: heartbeat кожного
  // гравця (раз/2с, з online-engine.js) інакше будив би повний перемальок
  // UI по кілька разів на секунду при 6+ гравцях.
  function scheduleDispatch(room) {
    pendingRoom = room;
    if (dispatchTimer) return;
    dispatchTimer = setTimeout(() => {
      dispatchTimer = null;
      const r = pendingRoom; pendingRoom = null;
      if (!r) return;
      gameOnStateChange(
        Object.assign({}, r, { ownerUsername: r.hostUsername }),
        { username: myUsername, roomId: currentRoomId, isOwner: r.hostUsername === myUsername }
      );
    }, DISPATCH_DEBOUNCE_MS);
  }

  // ------------------------- тік (лише на пристрої власника) -------------------------
  function ownerTick() {
    const room = engine.latestRoom;
    if (!room) return;
    if (room.phase === "lobby" || room.phase === "game_over") return;
    if (advancingSincePhase === room.phase) return; // перехід із цієї фази вже надіслано, чекаємо підтвердження
    if (room.phaseDeadline == null) return;
    if (engine.now() < room.phaseDeadline) return;
    advancingSincePhase = room.phase;
    advancePhase(room);
  }

  function write(patch, nextPhase, duration) {
    const extra = Object.assign({}, patch, {
      phaseDeadline: duration == null ? null : engine.now() + duration,
    });
    engine.setPhase(nextPhase, extra);
  }

  // ------------------------- FSM: переходи -------------------------
  function advancePhase(room) {
    const settings = Object.assign({}, DEFAULT_SETTINGS, room.settings);

    switch (room.phase) {
      case "role_reveal":
        return write({}, "banner_night_start", PHASE_DURATIONS.banner_night_start);

      case "banner_night_start":
        return write({}, "mafia_move", PHASE_DURATIONS.mafia_move);

      case "mafia_move":
        if (settings.doctorEnabled) return write({}, "doctor_move", PHASE_DURATIONS.doctor_move);
        if (settings.sheriffEnabled) return write({}, "sheriff_move", PHASE_DURATIONS.sheriff_move);
        return resolveNight(room);

      case "doctor_move":
        if (settings.sheriffEnabled) return write({}, "sheriff_move", PHASE_DURATIONS.sheriff_move);
        return resolveNight(room);

      case "sheriff_move":
        return resolveNight(room);

      case "banner_morning":
        return write({}, "night_reveal", PHASE_DURATIONS.night_reveal);

      case "night_reveal": {
        const victim = room.nightResult && room.nightResult.victim;
        if (victim) {
          return write({ lastWords: { victim }, lastWordsNext: "day_discussion" }, "last_words", PHASE_DURATIONS.last_words);
        }
        return write({ lastWords: null, lastWordsNext: null }, "day_discussion", PHASE_DURATIONS.day_discussion);
      }

      case "last_words": {
        const next = room.lastWordsNext === "player_elimination_anim" ? "player_elimination_anim" : "day_discussion";
        return write({}, next, PHASE_DURATIONS[next]);
      }

      case "day_discussion":
        return write({}, "voting", PHASE_DURATIONS.voting);

      case "voting":
        return resolveVoting(room);

      case "player_elimination_anim":
        return write({}, "banner_state", PHASE_DURATIONS.banner_state);

      case "banner_state": {
        const winner = checkWinCondition(room.players || {});
        if (winner) return write({ winner }, "game_over", null);
        return write({ nightNumber: (room.nightNumber || 1) + 1, moves: {} }, "banner_night_start", PHASE_DURATIONS.banner_night_start);
      }

      default:
        return; // lobby / game_over / невідома фаза — нічого не робимо
    }
  }

  // Нічне розв'язання: консенсус мафії, лікар, шериф. Викликається, коли
  // спливає таймер ОСТАННЬОЇ увімкненої нічної ролі за настройками гри.
  function resolveNight(room) {
    const players = room.players || {};
    const settings = Object.assign({}, DEFAULT_SETTINGS, room.settings);
    const moves = room.moves || {};

    const aliveMafia = Object.entries(players).filter(([, p]) => p.alive && p.role === "mafia").map(([u]) => u);
    const donEntry = Object.entries(players).find(([, p]) => p.alive && p.role === "mafia" && p.isDon);

    let killTarget = null;
    if (aliveMafia.length) {
      const picks = aliveMafia.map((u) => (moves[u] && moves[u].choice === "target") ? moves[u].target : "SKIP");
      if (settings.mafiaConsensus === "strict") {
        const uniq = new Set(picks);
        if (uniq.size === 1 && picks[0] !== "SKIP") killTarget = picks[0];
      } else {
        const tally = {};
        picks.forEach((p) => { if (p !== "SKIP") tally[p] = (tally[p] || 0) + 1; });
        const entries = Object.entries(tally);
        if (entries.length) {
          const max = Math.max(...entries.map(([, c]) => c));
          const top = entries.filter(([, c]) => c === max).map(([u]) => u);
          if (top.length === 1) {
            killTarget = top[0];
          } else {
            const donMove = donEntry && moves[donEntry[0]];
            const donPick = donMove && donMove.choice === "target" ? donMove.target : null;
            killTarget = top.includes(donPick) ? donPick : top[0];
          }
        }
      }
    }

    let doctorSave = null;
    if (settings.doctorEnabled) {
      const doc = Object.entries(players).find(([, p]) => p.alive && p.role === "doctor");
      const m = doc && moves[doc[0]];
      if (m && m.choice === "target") doctorSave = m.target;
    }

    let sheriffCheck = null;
    if (settings.sheriffEnabled) {
      const sh = Object.entries(players).find(([, p]) => p.alive && p.role === "sheriff");
      const m = sh && moves[sh[0]];
      if (m && m.choice === "target" && players[m.target]) {
        sheriffCheck = { username: m.target, isMafia: players[m.target].role === "mafia" };
      }
    }

    const victim = (killTarget && killTarget !== doctorSave) ? killTarget : null;
    const patch = { nightResult: { victim: victim || null, sheriffCheck }, moves: {} };
    if (victim) patch["players/" + victim + "/alive"] = false;

    const projected = victim ? Object.assign({}, players, { [victim]: Object.assign({}, players[victim], { alive: false }) }) : players;
    const earlyWinner = checkWinCondition(projected);
    if (earlyWinner) {
      write(Object.assign(patch, { winner: earlyWinner }), "game_over", null);
      return;
    }
    write(patch, "banner_morning", PHASE_DURATIONS.banner_morning);
  }

  function resolveVoting(room) {
    const players = room.players || {};
    const votes = room.votes || {};
    const tally = {};
    Object.entries(votes).forEach(([voter, target]) => {
      if (players[voter] && players[voter].alive && players[target] && players[target].alive) {
        tally[target] = (tally[target] || 0) + 1;
      }
    });
    const entries = Object.entries(tally);
    let eliminated = null;
    if (entries.length) {
      const max = Math.max(...entries.map(([, c]) => c));
      const top = entries.filter(([, c]) => c === max);
      if (top.length === 1) eliminated = top[0][0]; // нічия — ніхто не вигнаний
    }

    const patch = { votes: {}, lastEliminated: eliminated || null };
    if (eliminated) {
      patch["players/" + eliminated + "/alive"] = false;
      patch.lastWords = { victim: eliminated };
      patch.lastWordsNext = "player_elimination_anim";
      write(patch, "last_words", PHASE_DURATIONS.last_words);
    } else {
      write(patch, "player_elimination_anim", PHASE_DURATIONS.player_elimination_anim);
    }
  }

  // ------------------------- дії гравців -------------------------
  function submitMafiaMove(target) {
    const room = engine.latestRoom; const me = room && room.players[myUsername];
    if (!room || room.phase !== "mafia_move" || !me || !me.alive || me.role !== "mafia") return;
    engine.roomRef.child("moves/" + myUsername).set(target ? { choice: "target", target } : { choice: "skip", target: null });
  }

  function submitDoctorMove(target) {
    const room = engine.latestRoom; const me = room && room.players[myUsername];
    if (!room || room.phase !== "doctor_move" || !me || !me.alive || me.role !== "doctor") return;
    engine.roomRef.child("moves/" + myUsername).set(target ? { choice: "target", target } : { choice: "skip", target: null });
  }

  function submitSheriffMove(target) {
    const room = engine.latestRoom; const me = room && room.players[myUsername];
    if (!room || room.phase !== "sheriff_move" || !me || !me.alive || me.role !== "sheriff" || !target) return;
    if ((room.moves || {})[myUsername]) return; // "1 остаточний вибір" — уже перевірив цієї ночі
    engine.roomRef.child("moves/" + myUsername).set({ choice: "target", target });
  }

  function submitVote(target) {
    const room = engine.latestRoom; const me = room && room.players[myUsername];
    if (!room || room.phase !== "voting" || !me || !me.alive || !target) return;
    engine.roomRef.child("votes/" + myUsername).set(target);
  }

  // ------------------------- чат -------------------------
  // Канали визначаються ЛИШЕ клієнтом (та сама довірча модель, що й в
  // усій грі — без Firebase security rules по ролі). Мертві бачать/пишуть
  // у "always" завжди; жива мафія — у "mafia_move" лише під час ходу
  // мафії; усі живі — у "day" під час дня.
  function myChatChannel(state) {
    const players = state.players || {};
    const me = players[myUsername];
    if (!me) return null;
    if (!me.alive) return { status: "role_spectator", key: "always" };
    if (state.phase === "mafia_move" && me.role === "mafia") return { status: "role_mafia", key: "mafia_move" };
    if (state.phase === "day_discussion" || state.phase === "voting") return { status: "day", key: "day" };
    return null;
  }

  function visibleChat(state, username) {
    const players = state.players || {};
    const me = players[username];
    if (!me) return [];
    let key;
    if (!me.alive) key = "always";
    else if (state.phase === "mafia_move" && me.role === "mafia") key = "mafia_move";
    else if (state.phase === "day_discussion" || state.phase === "voting") key = "day";
    else return [];
    return Object.values(state.chat || {}).filter((m) => m.channel === key);
  }

  function sendChatMessage(text) {
    const room = engine.latestRoom;
    if (!room || !engine.roomRef) return;
    const ch = myChatChannel(room);
    if (!ch) return;
    const clean = String(text || "").trim().slice(0, 300);
    if (!clean) return;
    const key = engine.roomRef.child("chat").push().key;
    engine.roomRef.child("chat/" + key).set({
      username: myUsername, text: clean, at: engine.now(), channel: ch.key, status: ch.status,
    });
  }

  // ------------------------- лобі / налаштування -------------------------
  function setReady(ready) {
    if (!engine.roomRef || !myUsername) return;
    engine.roomRef.child("players/" + myUsername).update({ ready: !!ready });
  }

  function setSettings(patch) {
    const room = engine.latestRoom;
    if (!room || room.phase !== "lobby" || room.hostUsername !== myUsername) return;
    const merged = Object.assign({}, DEFAULT_SETTINGS, room.settings, patch);
    engine.roomRef.child("settings").set(merged);
  }

  function startGame() {
    const room = engine.latestRoom;
    if (!room || room.phase !== "lobby" || room.hostUsername !== myUsername) return;
    const players = room.players || {};
    const names = Object.keys(players);
    const settings = Object.assign({}, DEFAULT_SETTINGS, room.settings);
    const conn = connectedEntries(players);
    if (conn.length < MIN_PLAYERS || names.length > MAX_PLAYERS) return;

    const mafiaCount = resolveMafiaCount(names.length, settings);
    const shuffled = shuffle(names.slice());
    const roles = {};
    let i = 0;
    const mafiaNames = shuffled.slice(i, i + mafiaCount); i += mafiaCount;
    mafiaNames.forEach((u) => { roles[u] = "mafia"; });
    if (settings.doctorEnabled) { roles[shuffled[i]] = "doctor"; i++; }
    if (settings.sheriffEnabled) { roles[shuffled[i]] = "sheriff"; i++; }
    for (; i < shuffled.length; i++) roles[shuffled[i]] = "civilian";
    const donUsername = mafiaNames[Math.floor(Math.random() * mafiaNames.length)];

    const patch = { settings, nightNumber: 1, moves: {}, votes: {}, nightResult: null,
      lastEliminated: null, lastWords: null, lastWordsNext: null, winner: null };
    names.forEach((u) => {
      patch["players/" + u + "/role"] = roles[u];
      patch["players/" + u + "/isDon"] = u === donUsername;
      patch["players/" + u + "/alive"] = true;
    });
    write(patch, "role_reveal", PHASE_DURATIONS.role_reveal);
  }

  function resetGame() {
    const room = engine.latestRoom;
    if (!room || room.hostUsername !== myUsername) return;
    const players = room.players || {};
    const patch = { nightNumber: 0, moves: {}, votes: {}, nightResult: null,
      lastEliminated: null, lastWords: null, lastWordsNext: null, winner: null };
    Object.keys(players).forEach((u) => {
      patch["players/" + u + "/role"] = null;
      patch["players/" + u + "/isDon"] = false;
      patch["players/" + u + "/alive"] = true;
      patch["players/" + u + "/ready"] = false;
    });
    write(patch, "lobby", null);
  }

  // ------------------------- список активних кімнат -------------------------
  function watchActiveRooms(callback) {
    if (!window.rtdb) return () => {};
    const ref = window.rtdb.ref(ROOMS_PATH);
    const handler = ref.on("value", (snap) => {
      const all = snap.val() || {};
      const rooms = Object.entries(all)
        .filter(([, r]) => r && r.phase)
        .map(([roomId, r]) => ({
          roomId,
          phase: r.phase,
          playerCount: Object.keys(r.players || {}).length,
          connectedCount: connectedEntries(r.players).length,
        }));
      callback(rooms);
    });
    return () => ref.off("value", handler);
  }

  // ------------------------- публічний API -------------------------
  window.MafiaGame = {
    ROLE_META, DEFAULT_SETTINGS, MIN_PLAYERS, MAX_PLAYERS,
    now: () => engine.now(),
    get me() { const r = engine.latestRoom; return r && myUsername ? (r.players || {})[myUsername] : null; },
    get room() { return engine.latestRoom; },
    start, stop,
    connectedEntries, watchActiveRooms,
    setReady, setSettings, startGame, resetGame,
    submitMafiaMove, submitDoctorMove, submitSheriffMove, submitVote,
    sendChatMessage, visibleChat, myChatChannel,
    set onStateChange(fn) { gameOnStateChange = fn || (() => {}); },
  };
})();
