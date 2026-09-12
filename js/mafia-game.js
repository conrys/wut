// ==========================================================================
// mafia-game.js — логіка гри "Мафія" поверх window.OnlineEngine (Firebase RTDB).
//
// Підключати ПІСЛЯ firebase-config.js, login.js і online-engine.js.
//
// ---------------------------------------------------------------------
// СХЕМА КІМНАТИ (room, кімнати ${GAME_KEY}_rooms/{roomId})
// ---------------------------------------------------------------------
//   phase            — одна з PHASES нижче
//   hostUsername     — керується рушієм (lockedHost: true)
//   players           — { username: {
//                            role,        'mafia' | 'doctor' | 'commissar' | 'civilian' | null
//                            alive,       boolean
//                            ready,       boolean (лобі)
//                            vote,        username | null  (день-голосування)
//                            nightAction, username | null  (нічна ціль ролі)
//                            avatar,      будь-яке значення, задає гравець
//                         } }
//   nightNumber       — номер поточної ночі (1, 2, 3, ...)
//   phaseDeadline     — now() поточної фази, до якого хост чекає дій гравців
//   nightResult       — { deadPlayer, savedByDoctor, inspected:{username,isMafia}|null } | null
//   lastEliminated    — username вигнаного голосуванням гравця (останній раунд) | null
//   winner            — 'mafia' | 'civilians' | null
//   chat              — { pushId: { username, text, at } } — push-список, не масив
//
// ---------------------------------------------------------------------
// ФАЗИ (room.phase)
// ---------------------------------------------------------------------
//   lobby → night → night_result → day_discussion → day_voting → (night | game_over)
//
// Переходи night → night_result → day_discussion → day_voting та
// day_voting → night/game_over виконує ВИКЛЮЧНО хост усередині tick().
// lobby → night виконується явним викликом MafiaGame.startGame() хостом
// (старт гри — дія людини, а не автоматичний тік).
// ==========================================================================
(function () {
  "use strict";

  if (!window.OnlineEngine) {
    throw new Error("mafia-game.js: підключи online-engine.js перед цим файлом.");
  }

  const GAME_KEY = "mafia";
  const MIN_PLAYERS = 4;
  const MAX_PLAYERS = 10;

  const PHASES = ["lobby", "night", "night_result", "day_discussion", "day_voting", "game_over"];

  // Тривалості фаз (мс) — легко підкрутити під темп гри.
  const PHASE_DURATIONS_MS = {
    night: 30000,
    night_result: 8000,
    day_discussion: 90000,
    day_voting: 45000,
  };

  const ROOM_SCHEMA = {
    phase: "lobby",
    hostUsername: null,
    players: {},          // маркер — керується рушієм (presence/joinedAt/lastSeen)
    nightNumber: 0,
    phaseDeadline: null,
    nightResult: null,
    lastEliminated: null,
    winner: null,
    chat: {},
  };

  function emptyPlayer() {
    return {
      role: null,
      alive: true,
      ready: false,
      vote: null,
      nightAction: null,
      avatar: null,
    };
  }

  function buildFreshRoom() {
    // Доповнює ROOM_SCHEMA ігровими полями нової кімнати. hostUsername і
    // players навмисно НЕ чіпаємо тут — hostUsername обере lockedHost-транзакція
    // рушія одразу після joinRoom(), players наповнюється через becomePlayer().
    return {
      nightNumber: 0,
      phaseDeadline: null,
      nightResult: null,
      lastEliminated: null,
      winner: null,
      chat: {},
    };
  }

  const engine = window.OnlineEngine.create(GAME_KEY, {
    phases: PHASES,
    abandonMs: 3 * 60 * 1000, // порожня кімната прибирається через 3 хв
    lockedHost: true,          // рушій сам веде computeHost + CAS-вибори хоста
    onEmptyPlayer: emptyPlayer,
    onDisconnectPlayerPatch: { lastSeen: 0, status: "inactive" },
  });

  let myUsername = null;
  let latestRoom = null;
  let tickTimer = null;
  let externalOnStateChange = () => {};

  // ------------------------- допоміжне -------------------------
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function playersOf(room) { return (room && room.players) || {}; }

  function aliveEntries(room) {
    return Object.entries(playersOf(room)).filter(([, p]) => p && p.alive);
  }

  // Застосовує "плаский" патч (ключі виду "players/ім'я/поле") до КОПІЇ
  // players — потрібно лише щоб перевірити умову перемоги ДО фактичного
  // запису в Firebase (щоб одразу перейти у game_over, а не ще на один тік
  // затриматись у night_result/day_voting).
  function applyPatchToPlayers(players, patch) {
    const next = {};
    Object.keys(players).forEach((u) => { next[u] = { ...players[u] }; });
    Object.keys(patch).forEach((key) => {
      const m = key.match(/^players\/([^/]+)\/(.+)$/);
      if (m && next[m[1]]) next[m[1]][m[2]] = patch[key];
    });
    return next;
  }

  // ------------------------- ігрова логіка (чисті функції) -------------------------
  // Навмисно не звертаються ні до engine, ні до DOM — легко тестувати й
  // переносити. Працюють над "players" у форматі Firebase: { username: {...} }.

  function assignRolesPatch(players) {
    const usernames = Object.keys(players);
    const n = usernames.length;
    const mafiaCount = n <= 5 ? 1 : n <= 7 ? 2 : 3;
    const hasDoctor = n >= 4;
    const hasCommissar = n >= 5;

    const order = shuffle(usernames);
    const roleOf = {};
    let idx = 0;
    for (let i = 0; i < mafiaCount; i++) roleOf[order[idx++]] = "mafia";
    if (hasDoctor) roleOf[order[idx++]] = "doctor";
    if (hasCommissar) roleOf[order[idx++]] = "commissar";
    while (idx < order.length) roleOf[order[idx++]] = "civilian";

    const patch = {};
    usernames.forEach((u) => {
      patch[`players/${u}/role`] = roleOf[u];
      patch[`players/${u}/alive`] = true;
      patch[`players/${u}/vote`] = null;
      patch[`players/${u}/nightAction`] = null;
    });
    return patch;
  }

  function checkWinCondition(players) {
    const alive = Object.values(players || {}).filter((p) => p && p.alive);
    const aliveMafia = alive.filter((p) => p.role === "mafia").length;
    const aliveOthers = alive.length - aliveMafia;
    if (aliveMafia === 0) return "civilians";
    if (aliveMafia >= aliveOthers) return "mafia";
    return null;
  }

  // Мафія (може бути декілька) голосує nightAction'ом за жертву як за
  // звичайне голосування: перемагає більшість, нічия = ніхто не гине.
  // Лікар і Комісар — одноосібні ролі, беремо їхню ціль напряму.
  function resolveNightPatch(players) {
    const alive = aliveEntries({ players });

    const mafiaVotes = {};
    alive.filter(([, p]) => p.role === "mafia" && p.nightAction).forEach(([, p]) => {
      mafiaVotes[p.nightAction] = (mafiaVotes[p.nightAction] || 0) + 1;
    });
    let mafiaTarget = null, maxV = 0, mafiaTie = false;
    Object.entries(mafiaVotes).forEach(([target, c]) => {
      if (c > maxV) { maxV = c; mafiaTarget = target; mafiaTie = false; }
      else if (c === maxV) mafiaTie = true;
    });
    if (mafiaTie) mafiaTarget = null;

    const doctorEntry = alive.find(([, p]) => p.role === "doctor");
    const doctorTarget = doctorEntry ? doctorEntry[1].nightAction : null;

    const commissarEntry = alive.find(([, p]) => p.role === "commissar");
    const commissarTarget = commissarEntry ? commissarEntry[1].nightAction : null;

    let deadPlayer = null;
    if (mafiaTarget && mafiaTarget !== doctorTarget && players[mafiaTarget] && players[mafiaTarget].alive) {
      deadPlayer = mafiaTarget;
    }

    let inspected = null;
    if (commissarTarget && players[commissarTarget]) {
      inspected = { username: commissarTarget, isMafia: players[commissarTarget].role === "mafia" };
    }

    const patch = {
      nightResult: {
        deadPlayer,
        savedByDoctor: !!(mafiaTarget && doctorTarget && mafiaTarget === doctorTarget),
        inspected,
      },
    };
    if (deadPlayer) patch[`players/${deadPlayer}/alive`] = false;
    Object.keys(players).forEach((u) => { patch[`players/${u}/nightAction`] = null; });
    return patch;
  }

  function resolveVotingPatch(players) {
    const alive = aliveEntries({ players });
    const counts = {};
    alive.forEach(([, p]) => { if (p.vote) counts[p.vote] = (counts[p.vote] || 0) + 1; });

    let leader = null, maxV = 0, tie = false;
    Object.entries(counts).forEach(([u, c]) => {
      if (c > maxV) { maxV = c; leader = u; tie = false; }
      else if (c === maxV) tie = true;
    });
    const eliminated = leader && !tie ? leader : null;

    const patch = { lastEliminated: eliminated };
    if (eliminated) patch[`players/${eliminated}/alive`] = false;
    Object.keys(players).forEach((u) => { patch[`players/${u}/vote`] = null; });
    return patch;
  }

  function allNightActionsIn(room) {
    const alive = aliveEntries(room);
    if (!alive.length) return true;
    return alive.every(([, p]) => p.role === "civilian" || !!p.nightAction);
  }

  function allVotesIn(room) {
    const alive = aliveEntries(room);
    return alive.length > 0 && alive.every(([, p]) => !!p.vote);
  }

  // Онлайн-гравці кімнати — для лобі-екрана ("N з M онлайн"), та сама ідея,
  // що й у spy-game.js.
  function connectedEntries(players) {
    return Object.entries(players || {}).filter(([, p]) => engine.isConnected(p));
  }

  // ------------------------- хост: tick() -------------------------
  function hostTick() {
    if (!engine.isHost || !latestRoom) return;
    const room = latestRoom;
    const t = engine.now();

    switch (room.phase) {
      case "night":
        if (t >= (room.phaseDeadline || 0) || allNightActionsIn(room)) resolveNightPhase(room);
        break;
      case "night_result":
        if (t >= (room.phaseDeadline || 0)) {
          engine.setPhase("day_discussion", { phaseDeadline: engine.now() + PHASE_DURATIONS_MS.day_discussion });
        }
        break;
      case "day_discussion":
        if (t >= (room.phaseDeadline || 0)) {
          engine.setPhase("day_voting", { phaseDeadline: engine.now() + PHASE_DURATIONS_MS.day_voting });
        }
        break;
      case "day_voting":
        if (t >= (room.phaseDeadline || 0) || allVotesIn(room)) resolveVotingPhase(room);
        break;
      // "lobby" і "game_over" тік не чіпає — переходи з них ініціює дія
      // гравця (startGame() / resetGame()), а не таймер.
      default:
        break;
    }
  }

  function resolveNightPhase(room) {
    const patch = resolveNightPatch(playersOf(room));
    const projected = applyPatchToPlayers(playersOf(room), patch);
    const winner = checkWinCondition(projected);

    if (winner) {
      engine.setPhase("game_over", { ...patch, winner, phaseDeadline: null });
    } else {
      engine.setPhase("night_result", { ...patch, phaseDeadline: engine.now() + PHASE_DURATIONS_MS.night_result });
    }
  }

  function resolveVotingPhase(room) {
    const patch = resolveVotingPatch(playersOf(room));
    const projected = applyPatchToPlayers(playersOf(room), patch);
    const winner = checkWinCondition(projected);

    if (winner) {
      engine.setPhase("game_over", { ...patch, winner, phaseDeadline: null });
    } else {
      const nextNight = (room.nightNumber || 0) + 1;
      engine.setPhase("night", {
        ...patch,
        nightNumber: nextNight,
        phaseDeadline: engine.now() + PHASE_DURATIONS_MS.night,
      });
    }
  }

  function startHostTick() {
    if (tickTimer) return;
    tickTimer = setInterval(hostTick, 1000);
    hostTick(); // не чекати першого інтервалу — перевірити стан одразу
  }

  function stopHostTick() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }

  engine.onBecomeHost = startHostTick;
  engine.onLoseHost = stopHostTick;

  // Гравець, який приєднався як спостерігач (кімната була заповнена або гра
  // вже йшла — див. start()), стає повноцінним гравцем, щойно фаза знову
  // lobby і є вільне місце. Саме так документація рушія й радить: "Викликай
  // becomePlayer() пізніше, коли гра дозволить".
  function maybeBecomePlayer(room) {
    if (!room || !myUsername || room.phase !== "lobby") return;
    const players = playersOf(room);
    if (players[myUsername]) return;
    if (Object.keys(players).length >= MAX_PLAYERS) return;
    engine.becomePlayer();
  }

  engine.onStateChange = function (event, payload) {
    if (event !== "room-update") return; // useLobby:false -> "lobby-update" не приходить узагалі
    latestRoom = payload.room;
    maybeBecomePlayer(payload.room);
    if (engine.isHost) hostTick();

    // Публічний колбек — так само, як у spy-game.js: (state, ctx), а не
    // сирий формат рушія. room.hostUsername вже записаний CAS-транзакцією
    // (lockedHost:true), тому ctx.host можна віддати напряму з engine.isHost,
    // без повторного обчислення computeHost(players) на кожен рендер.
    externalOnStateChange(payload.room, { username: myUsername, host: engine.isHost });
  };

  // ------------------------- публічні методи -------------------------

  function start(username, roomId) {
    myUsername = username;
    engine.start(username, { useLobby: false }); // room-code флоу, без спільного лобі запрошень
    return engine.getOrCreateRoom(roomId, ROOM_SCHEMA, buildFreshRoom).then((result) => {
      const room = result.room;
      const players = playersOf(room);
      const alreadyIn = !!players[username];
      const roomFull = Object.keys(players).length >= MAX_PLAYERS;
      const gameRunning = room.phase !== "lobby";
      const asPlayer = alreadyIn || (!roomFull && !gameRunning);
      return engine.joinRoom(roomId, { asPlayer }).then(() => result);
    });
  }

  // М'який вихід — за зразком spy-game.js: engine.stop() лише зупиняє
  // heartbeat і відписує локальні слухачі, АЛЕ НЕ видаляє гравця з players/
  // (на відміну від engine.leaveRoom()). Роль/alive/vote лишаються на місці,
  // щоб гравець, який згорнув застосунок посеред раунду, міг повернутись у
  // ту саму гру простим повторним start() — інші клієнти тим часом бачать
  // його як неактивного через застарілий lastSeen (isConnected()=false).
  function stop() {
    stopHostTick();
    engine.stop();
    myUsername = null;
    latestRoom = null;
  }

  // Старт гри — явна дія хоста з лобі. Розподіляє ролі й одразу переводить
  // кімнату у ніч 1.
  function startGame() {
    if (!engine.isHost || !latestRoom || latestRoom.phase !== "lobby") return Promise.resolve();
    const players = playersOf(latestRoom);
    const n = Object.keys(players).length;
    if (n < MIN_PLAYERS || n > MAX_PLAYERS) return Promise.resolve();

    const rolePatch = assignRolesPatch(players);
    return engine.setPhase("night", {
      ...rolePatch,
      nightNumber: 1,
      nightResult: null,
      lastEliminated: null,
      winner: null,
      phaseDeadline: engine.now() + PHASE_DURATIONS_MS.night,
    });
  }

  // Повертає кімнату в лобі, зберігаючи гравців, але скидаючи їхні ролі/стан.
  function resetGame() {
    if (!engine.isHost || !latestRoom) return Promise.resolve();
    const players = playersOf(latestRoom);
    const patch = {
      nightNumber: 0,
      phaseDeadline: null,
      nightResult: null,
      lastEliminated: null,
      winner: null,
      chat: null, // очистити чат минулої гри
    };
    Object.keys(players).forEach((u) => {
      patch[`players/${u}/role`] = null;
      patch[`players/${u}/alive`] = true;
      patch[`players/${u}/vote`] = null;
      patch[`players/${u}/nightAction`] = null;
      patch[`players/${u}/ready`] = false;
    });
    return engine.setPhase("lobby", patch);
  }

  // Хост натиснув "пропустити" — не міняє фазу напряму (щоб не дублювати
  // логіку резолву), а просто переводить дедлайн у минуле. Наступний тік
  // (він же спрацює одразу, бо onStateChange викликає hostTick() на кожен
  // запис) обробить це так само, як природне закінчення таймера.
  function forceAdvance() {
    if (!engine.isHost || !latestRoom) return Promise.resolve();
    if (latestRoom.phase === "lobby" || latestRoom.phase === "game_over") return Promise.resolve();
    if (!engine.roomRef) return Promise.resolve();
    return engine.roomRef.update({ phaseDeadline: engine.now() - 1, lastActivityAt: engine.now() });
  }

  function myPlayerRef() {
    if (!engine.roomRef || !myUsername) return null;
    return engine.roomRef.child("players").child(myUsername);
  }

  // Нічна дія власної ролі (мафія/лікар/комісар обирають ціль). Прямий запис
  // у власний шлях players/{я}/nightAction — самозапис, транзакція не потрібна.
  function submitNightAction(targetUsername) {
    const ref = myPlayerRef();
    if (!ref || !latestRoom || latestRoom.phase !== "night") return Promise.resolve();
    return ref.update({ nightAction: targetUsername });
  }

  function submitVote(targetUsername) {
    const ref = myPlayerRef();
    if (!ref || !latestRoom || latestRoom.phase !== "day_voting") return Promise.resolve();
    return ref.update({ vote: targetUsername });
  }

  function setAvatar(avatar) {
    const ref = myPlayerRef();
    if (!ref) return Promise.resolve();
    return ref.update({ avatar });
  }

  function setReady(ready) {
    const ref = myPlayerRef();
    if (!ref) return Promise.resolve();
    return ref.update({ ready: !!ready });
  }

  // Чат денного обговорення — push-список, а не масив (щоб не переписувати
  // всю історію при кожному повідомленні).
  function sendChatMessage(text) {
    if (!engine.roomRef || !myUsername) return Promise.resolve();
    const clean = String(text || "").trim().slice(0, 300);
    if (!clean) return Promise.resolve();
    return engine.roomRef.child("chat").push({ username: myUsername, text: clean, at: engine.now() });
  }

  window.MafiaGame = {
    PHASES,
    MIN_PLAYERS,
    MAX_PLAYERS,
    ROLES: ["mafia", "doctor", "commissar", "civilian"],

    start,
    stop,
    startGame,
    resetGame,
    forceAdvance,
    submitNightAction,
    submitVote,
    setAvatar,
    setReady,
    sendChatMessage,
    connectedEntries,
    computeHost: engine.computeHost,
    isConnected: engine.isConnected,

    get room() { return latestRoom; },
    get me() { return latestRoom && myUsername ? playersOf(latestRoom)[myUsername] || null : null; },
    get username() { return myUsername; },
    get roomId() { return engine.currentRoomId; },
    get isHost() { return engine.isHost; },
    now: () => engine.now(),

    set onStateChange(fn) { externalOnStateChange = typeof fn === "function" ? fn : () => {}; },
  };
})();
