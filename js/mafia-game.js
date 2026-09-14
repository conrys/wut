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
//   mafiaCount       — скільки мафіозі роздати при старті; null = авто за кількістю гравців
//   timers           — { phaseName: мс }, перевизначає DEFAULT_TIMERS; {} = усе за замовчуванням
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
//   lobby → night → night_result → day_discussion → day_voting → voting_result → (night | game_over)
//
// Кожна фаза з дедлайном сама вирішує, чи оголошувати переможця, ПІСЛЯ
// власного "reveal" — тобто гравці завжди спершу бачать, хто загинув/кого
// вигнали, і лише тоді (за наступний тік) гра може перейти в game_over.
// Переходи виконує ВИКЛЮЧНО хост усередині tick(). lobby → night
// виконується явним викликом MafiaGame.startGame() хостом (старт гри —
// дія людини, а не автоматичний тік).
// ==========================================================================
(function () {
  "use strict";

  if (!window.OnlineEngine) {
    throw new Error("mafia-game.js: підключи online-engine.js перед цим файлом.");
  }

  const GAME_KEY = "mafia";
  const MIN_PLAYERS = 4;
  const MAX_PLAYERS = 10;

  const PHASES = ["lobby", "night", "night_result", "day_discussion", "day_voting", "voting_result", "game_over"];

  // Тривалості фаз за замовчуванням (мс) — хост може перевизначити частину
  // з них через setTimers() ще в лобі; ефективна тривалість завжди йде
  // через effectiveDuration(room, phase).
  const DEFAULT_TIMERS = {
    night: 30000,
    night_result: 8000,
    day_discussion: 90000,
    day_voting: 45000,
    voting_result: 6000,
  };

  // Єдине джерело правди для назв/іконок/кольорового класу ролей — і
  // mafia.html, і mafia-host.html читають ЦЕ, а не тримають власні копії,
  // щоб кольори/підписи ніколи не розійшлися між двома сторінками.
  const ROLE_META = {
    mafia:     { name: "Мафія",   icon: "🔪", desc: "Обирає жертву щоночі." },
    doctor:    { name: "Лікар",   icon: "💉", desc: "Рятує одного гравця щоночі." },
    commissar: { name: "Комісар", icon: "🔎", desc: "Перевіряє одного гравця щоночі." },
    civilian:  { name: "Мирний",  icon: "🙂", desc: "Діє лише вдень." },
  };

  const ROOM_SCHEMA = {
    phase: "lobby",
    hostUsername: null,
    mafiaCount: null,      // null = авто за кількістю гравців
    timers: {},            // перевизначення DEFAULT_TIMERS, часткове
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
      mafiaCount: null,
      timers: {},
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

  // ------------------------- ігрова логіка (чисті функції) -------------------------
  // Навмисно не звертаються ні до engine, ні до DOM — легко тестувати й
  // переносити. Працюють над "players" у форматі Firebase: { username: {...} }.

  function autoMafiaCount(n) { return n <= 5 ? 1 : n <= 7 ? 2 : 3; }

  // Мафія завжди мусить лишатись меншістю (інакше гра закінчилась би одразу
  // після старту) — це і є верхня межа: mafiaCount < живих-не-мафії.
  function clampMafiaCount(n, requested) {
    const max = Math.max(1, Math.ceil(n / 2) - 1);
    const val = Number.isFinite(requested) && requested > 0 ? Math.round(requested) : autoMafiaCount(n);
    return Math.min(max, Math.max(1, val));
  }

  function effectiveDuration(room, phaseName) {
    const custom = room && room.timers && room.timers[phaseName];
    return typeof custom === "number" && custom > 0 ? custom : DEFAULT_TIMERS[phaseName];
  }

  function assignRolesPatch(players, mafiaCount) {
    const usernames = Object.keys(players);
    const n = usernames.length;
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
      // Рахуємо голос лише якщо ціль ще жива — застарілий чи прямий (боти,
      // ручний запис) вибір мертвого гравця не повинен впливати на тираж.
      if (players[p.nightAction] && players[p.nightAction].alive) {
        mafiaVotes[p.nightAction] = (mafiaVotes[p.nightAction] || 0) + 1;
      }
    });
    let mafiaTarget = null, maxV = 0, mafiaTie = false;
    Object.entries(mafiaVotes).forEach(([target, c]) => {
      if (c > maxV) { maxV = c; mafiaTarget = target; mafiaTie = false; }
      else if (c === maxV) mafiaTie = true;
    });
    if (mafiaTie) {
      // Раніше нічия = ніхто не гине, через що при 2+ мафіозі з різними
      // цілями вбивство фактично НІКОЛИ не спрацьовувало (мафія рідко
      // випадково обирає ту саму ціль наосліп). Тепер нічия розв'язується
      // випадковим вибором серед тих цілей, що набрали однаковий максимум —
      // вбивство завжди відбувається. У mafia.html мафія додатково бачить
      // вибір напарників у реальному часі, щоб узгоджуватись і уникати нічиєї.
      const tied = Object.keys(mafiaVotes).filter((t) => mafiaVotes[t] === maxV);
      mafiaTarget = tied[Math.floor(Math.random() * tied.length)];
    }

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
    alive.forEach(([, p]) => {
      // Рахуємо голос лише якщо ціль ще жива - з тих самих причин, що й у
      // resolveNightPatch: застарілий/прямий запис не повинен впливати на вирок.
      if (p.vote && players[p.vote] && players[p.vote].alive) counts[p.vote] = (counts[p.vote] || 0) + 1;
    });

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
          const winner = checkWinCondition(playersOf(room));
          if (winner) {
            engine.setPhase("game_over", { winner, phaseDeadline: null });
          } else {
            engine.setPhase("day_discussion", { phaseDeadline: engine.now() + effectiveDuration(room, "day_discussion") });
          }
        }
        break;
      case "day_discussion":
        if (t >= (room.phaseDeadline || 0)) {
          engine.setPhase("day_voting", { phaseDeadline: engine.now() + effectiveDuration(room, "day_voting") });
        }
        break;
      case "day_voting":
        if (t >= (room.phaseDeadline || 0) || allVotesIn(room)) resolveVotingPhase(room);
        break;
      case "voting_result":
        if (t >= (room.phaseDeadline || 0)) {
          const winner = checkWinCondition(playersOf(room));
          if (winner) {
            engine.setPhase("game_over", { winner, phaseDeadline: null });
          } else {
            const nextNight = (room.nightNumber || 0) + 1;
            engine.setPhase("night", { nightNumber: nextNight, phaseDeadline: engine.now() + effectiveDuration(room, "night") });
          }
        }
        break;
      // "lobby" і "game_over" тік не чіпає — переходи з них ініціює дія
      // гравця (startGame() / resetGame()), а не таймер.
      default:
        break;
    }
  }

  function resolveNightPhase(room) {
    const patch = resolveNightPatch(playersOf(room));
    engine.setPhase("night_result", { ...patch, phaseDeadline: engine.now() + effectiveDuration(room, "night_result") });
  }

  function resolveVotingPhase(room) {
    const patch = resolveVotingPatch(playersOf(room));
    engine.setPhase("voting_result", { ...patch, phaseDeadline: engine.now() + effectiveDuration(room, "voting_result") });
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

  // Режим глядача — для хост-екрана на ТБ/проєкторі. Навмисно НЕ встановлює
  // myUsername: усі решта функцій (myPlayerRef, me, maybeBecomePlayer) вже
  // захищені перевіркою "if (!myUsername) return", тож глядач автоматично
  // ніколи не потрапляє у players/ і, відповідно, фізично не може бути
  // обраний хостом (lockedHost-транзакція обирає лише з room.players).
  // Живий список активних кімнат гри — для екрана входу ("обери кімнату
  // зі списку" замість введення коду навмання). Порядок "застарілості" тут
  // навмисно повторює isRoomStale() з online-engine.js (та функція
  // приватна й не експортується), щоб не показувати кімнати, які рушій сам
  // ось-ось приберет через abandonMs.
  function watchActiveRooms(callback) {
    if (!window.rtdb) { callback([]); return () => {}; }
    const ref = window.rtdb.ref(`${GAME_KEY}_rooms`);
    const onValue = (snap) => {
      const rooms = snap.val() || {};
      const t = engine.now();
      const list = Object.entries(rooms).map(([roomId, room]) => {
        const players = playersOf(room);
        const connected = Object.entries(players).filter(([, p]) => engine.isConnected(p));
        const lastSeens = Object.values(players).map((p) => p.lastSeen || 0);
        const mostRecentPlayer = lastSeens.length ? Math.max(...lastSeens) : 0;
        const lastActivity = Math.max(room.lastActivityAt || 0, room.createdAt || 0, mostRecentPlayer);
        const stale = !connected.length && (!lastActivity || t - lastActivity > 3 * 60 * 1000);
        return {
          roomId,
          phase: room.phase || "lobby",
          usernames: Object.keys(players),
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

  function watch(roomId) {
    const displayName = "tv_" + Math.random().toString(36).slice(2, 8);
    engine.start(displayName, { useLobby: false });
    return engine.getOrCreateRoom(roomId, ROOM_SCHEMA, buildFreshRoom).then((result) =>
      engine.joinRoom(roomId, { asPlayer: false }).then(() => result)
    );
  }

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

    const mafiaCount = clampMafiaCount(n, latestRoom.mafiaCount);
    const rolePatch = assignRolesPatch(players, mafiaCount);
    return engine.setPhase("night", {
      ...rolePatch,
      nightNumber: 1,
      nightResult: null,
      lastEliminated: null,
      winner: null,
      phaseDeadline: engine.now() + effectiveDuration(latestRoom, "night"),
    });
  }

  // Хост обирає кількість мафіозі ще в лобі (null скидає на авто-формулу).
  // Клампиться під поточну кількість гравців, щоб мафія завжди лишалась
  // меншістю — інакше гра могла б закінчитись одразу після старту.
  function setMafiaCount(count) {
    if (!engine.isHost || !latestRoom || latestRoom.phase !== "lobby" || !engine.roomRef) return Promise.resolve();
    const n = Object.keys(playersOf(latestRoom)).length;
    const clamped = count == null ? null : clampMafiaCount(n, count);
    return engine.roomRef.update({ mafiaCount: clamped });
  }

  // Хост перевизначає тривалість окремих фаз ще в лобі. partial — часткові
  // { night, day_discussion, day_voting, night_result, voting_result } у мс;
  // непозначені або некоректні значення лишають DEFAULT_TIMERS без змін.
  function setTimers(partial) {
    if (!engine.isHost || !latestRoom || latestRoom.phase !== "lobby" || !engine.roomRef || !partial) return Promise.resolve();
    const patch = {};
    Object.keys(DEFAULT_TIMERS).forEach((k) => {
      if (typeof partial[k] === "number" && partial[k] > 0) patch[`timers/${k}`] = Math.round(partial[k]);
    });
    return Object.keys(patch).length ? engine.roomRef.update(patch) : Promise.resolve();
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
    watch,
    watchActiveRooms,
    stop,
    startGame,
    resetGame,
    forceAdvance,
    setMafiaCount,
    setTimers,
    submitNightAction,
    submitVote,
    setAvatar,
    setReady,
    sendChatMessage,
    connectedEntries,
    computeHost: engine.computeHost,
    isConnected: engine.isConnected,
    ROLE_META,
    DEFAULT_TIMERS,

    get room() { return latestRoom; },
    get me() { return latestRoom && myUsername ? playersOf(latestRoom)[myUsername] || null : null; },
    get username() { return myUsername; },
    get roomId() { return engine.currentRoomId; },
    get isHost() { return engine.isHost; },
    now: () => engine.now(),

    set onStateChange(fn) { externalOnStateChange = typeof fn === "function" ? fn : () => {}; },
  };
})();
