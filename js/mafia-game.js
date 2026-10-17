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

  const GAME_KEY = "mafia";
  const ROOMS_PATH = GAME_KEY + "_rooms"; // має 1-в-1 збігатись із внутрішньою назвою в online-engine.js
  const DISPATCH_DEBOUNCE_MS = 150;

  const MIN_PLAYERS = 4;
  const MAX_PLAYERS = 20;
  const MAX_MAFIA = 5; // 20 гравців → 5 мафій (≈ n/4)
  const MAX_DOCTORS = 3;

  const DEFAULT_SETTINGS = {
    doctorEnabled: true,
    doctorCount: 1, // скільки лікарів (1..MAX_DOCTORS), коли лікар увімкнений
    sheriffEnabled: true,
    mafiaCount: null, // null = авто (за кількістю гравців)
    mafiaConsensus: "majority", // "majority" | "strict"
    // Перший цикл ніч+день (room.nightNumber === 1) проходить повністю
    // (ролі, ходи, перевірка шерифа) — ЛИШЕ фактична смерть від мафії й
    // лінч на голосуванні приглушуються, щоб новачки встигли зрозуміти
    // механіку без реальних втрат за першу ніч/день. З другого раунду
    // (nightNumber >= 2) гра йде звичайно.
    introRoundEnabled: false,
    // Режим ведучого: хто натискає «Почати», отримує роль «Ведучий» — без ролі в місті,
    // бачить усіх, читає текст уголос і перемикає фази («Далі», пауза).
    narratorMode: false,
  };

  const ROLE_META = {
    mafia: { name: "Мафія", icon: "🔪", desc: "Вночі обираєте разом, кого усунути." },
    doctor: { name: "Лікар", icon: "💉", desc: "Вночі рятуй одного гравця (можна себе)." },
    sheriff: { name: "Шериф", icon: "🕵️", desc: "Вночі перевіряй одного гравця — мафія чи ні." },
    civilian: { name: "Мирний житель", icon: "🙂", desc: "Вдень шукай мафію разом з усіма." },
    narrator: { name: "Ведучий", icon: "🎩", desc: "Ти без ролі: бачиш усіх, читаєш текст уголос і перемикаєш фази." },
  };

  // Тривалості фаз (мс). Єдине джерело правди для тіку.
  // "night_reveal": 10s лишив за первинною специфікацією — у робочій
  // таблиці звуків його нема окремим рядком (там лише banner_morning
  // 3.5s), тож якщо насправді малась на увазі коротша/інша тривалість —
  // це один рядок для правки тут.
  const PHASE_DURATIONS = {
    role_reveal: 10000, // папка-досьє ~2.5с + час спокійно прочитати роль
    banner_night_start: 2500,
    // *_wake — 3с "прокидається …": гравець встигає відкрити очі (офлайн за
    // одним столом і онлайн з різних міст), лише потім відкривається вибір.
    mafia_wake: 3000,
    doctor_wake: 3000,
    sheriff_wake: 3000,
    mafia_move: 20000,
    doctor_move: 15000,
    sheriff_move: 15000,
    banner_morning: 3500,
    night_reveal: 10000,
    last_words: 15000,
    day_discussion: 90000,
    voting: 20000,
    player_elimination_anim: 7000,
    banner_state: 4000, // плейтест-3: було 10000, задовго після голосування
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
    dayReady: {},   // плейтест-2: "готовий голосувати" — дострокове завершення day_discussion
    paused: false,  // плейтест-2: загальна пауза гри
    pausedAt: null,
    chat: {},
    winner: null,
    history: {},    // журнал міста: n<номер> — ніч, d<номер> — день
    sheriffLog: {}, // нотатки шерифа (показує лише клієнт шерифа)
    lastVotes: null, // знімок голосів останнього голосування (для екрана вибуття)
    narrator: null,  // ім'я ведучого (режим ведучого), інакше null
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
      dayReady: {},
      paused: false,
      pausedAt: null,
      chat: {},
      winner: null,
      history: {},
      sheriffLog: {},
      lastVotes: null,
      narrator: null,
    };
  }

  // ------------------------- аватари (як у Смішлісті / вечірці) -------------------------
  const AVATAR_STORAGE_PREFIX = "games41_quiplash_avatar_";
  const AVATAR_COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6", "#1abc9c", "#e67e22", "#ff6fa5"];
  const CHARACTERS = 8;
  function avatarFor(room) {
    try {
      const raw = window.localStorage && window.localStorage.getItem(AVATAR_STORAGE_PREFIX + myUsername);
      const profile = raw ? JSON.parse(raw) : null;
      if (profile && profile.character >= 1 && profile.character <= CHARACTERS) {
        return { character: profile.character, color: profile.color || AVATAR_COLORS[(profile.character - 1) % AVATAR_COLORS.length] };
      }
    } catch (e) { /* немає localStorage — беремо за чергою */ }
    const idx = Object.keys((room && room.players) || {}).length;
    return { character: (idx % CHARACTERS) + 1, color: AVATAR_COLORS[(idx + Math.floor(idx / CHARACTERS)) % AVATAR_COLORS.length] };
  }
  // Нуарний силует (порядковий номер у NOIR_FILES з mafia.html, 1..NOIR_COUNT) —
  // гравець обирає сам у лобі, вибір пам'ятаємо локально для наступних ігор.
  const NOIR_COUNT = 12;
  const NOIR_STORAGE_PREFIX = "games41_mafia_noir_";
  function savedNoir() {
    try { const v = Number(window.localStorage.getItem(NOIR_STORAGE_PREFIX + myUsername)); return v >= 1 && v <= NOIR_COUNT ? v : null; } catch (e) { return null; }
  }
  function setNoir(k) {
    const room = engine.latestRoom;
    if (!room || room.phase !== "lobby" || !engine.roomRef || !myUsername) return;
    const v = ((Number(k) - 1) % NOIR_COUNT + NOIR_COUNT) % NOIR_COUNT + 1;
    try { window.localStorage.setItem(NOIR_STORAGE_PREFIX + myUsername, String(v)); } catch (e) { /* без localStorage — лише на цю гру */ }
    engine.roomRef.child("players/" + myUsername).update({ noir: v });
  }

  const engine = window.OnlineEngine.create(GAME_KEY, {
    onEmptyPlayer,
    // lockedHost: якщо хост згортає застосунок/вилітає з мережі — через
    // ~5-7с (PRESENCE_TIMEOUT_MS + цикл переобрання) хост-тік сам
    // підхопить інший живий гравець (той самий механізм, що й у
    // покері/шахах/шашках/дураку). Раніше hostUsername писався один раз
    // при створенні кімнати й ніколи не переобирався — гра просто
    // зависала назавжди, якщо хост згортав телефон у фоні.
    lockedHost: true,
  });

  let myUsername = null;
  let currentRoomId = null;
  let gameOnStateChange = () => {};
  let ownerTickTimer = null;
  let advancingSincePhase = null; // від якої фази вже надіслали перехід — чекаємо підтвердження
  let advancingAt = 0; // коли надіслали — якщо запис загубився, через ADVANCE_RETRY_MS пробуємо знову
  const ADVANCE_RETRY_MS = 4000;
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
    const cap = Math.max(1, n - resolveDoctorCount(n, settings) - (settings.sheriffEnabled ? 1 : 0) - 1);
    if (settings.mafiaCount) return Math.min(settings.mafiaCount, MAX_MAFIA, cap);
    return Math.max(1, Math.min(MAX_MAFIA, Math.floor(n / 4), cap));
  }

  // Лікарів не більше, ніж дозволяє стіл: лишаємо місце хоча б для мафії,
  // шерифа (якщо є) і одного мирного.
  function resolveDoctorCount(n, settings) {
    if (!settings.doctorEnabled) return 0;
    const wanted = Math.max(1, Math.min(MAX_DOCTORS, Number(settings.doctorCount) || 1));
    return Math.max(1, Math.min(wanted, n - 2 - (settings.sheriffEnabled ? 1 : 0)));
  }

  function checkWinCondition(players) {
    const alive = Object.values(players || {}).filter((p) => p.alive && p.role !== "narrator");
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
    engine.onBecomeHost = startOwnerTick;
    engine.onLoseHost = stopOwnerTick;
    engine.start(username, { useLobby: false });
    // hostUsername НЕ пишемо тут вручну — з lockedHost:true engine сам
    // обирає й записує і hostUsername, і hostSessionId разом через CAS
    // (maybeElectHostWithLock в online-engine.js), щойно побачить, що
    // players[room.hostUsername] відсутній/офлайн. Якби ми продовжили
    // писати лише hostUsername тут, engine побачив би "хост начебто є й
    // онлайн" (бо це ми самі) і ніколи не пройшов би гілку обрання —
    // onBecomeHost не спрацював би взагалі ні для кого.
    return engine.getOrCreateRoom(roomId, ROOM_SCHEMA, buildFreshRoom).then((result) => {
      const room = result.room;
      const players = room.players || {};
      const alreadyIn = !!players[username];
      const roomFull = Object.keys(players).length >= MAX_PLAYERS;
      const gameRunning = room.phase !== "lobby";
      const asPlayer = alreadyIn || (!roomFull && !gameRunning);
      // Аватар лише для нових гравців — хто вже в кімнаті, свій не міняє.
      let extra = asPlayer && !(players[username] && players[username].character) ? avatarFor(room) : undefined;
      const noir = savedNoir();
      if (asPlayer && noir && !(players[username] && players[username].noir)) extra = Object.assign({}, extra, { noir });
      return engine.joinRoom(roomId, { asPlayer, extra }).then(() => result);
    });
  }

  // Якщо приєднались спостерігачем під час активного раунду (гра вже йшла),
  // автоматично стаємо гравцем, щойно кімната повертається в lobby.
  function maybeBecomePlayer(room) {
    if (!room || !myUsername || room.phase !== "lobby") return;
    const players = room.players || {};
    if (players[myUsername]) return;
    if (Object.keys(players).length >= MAX_PLAYERS) return;
    const noir = savedNoir();
    engine.becomePlayer(Object.assign(avatarFor(room), noir ? { noir } : {}));
  }

  function startOwnerTick() {
    if (!ownerTickTimer) ownerTickTimer = setInterval(ownerTick, 250);
  }
  function stopOwnerTick() {
    if (ownerTickTimer) { clearInterval(ownerTickTimer); ownerTickTimer = null; }
  }

  function stop() {
    stopOwnerTick();
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

    // Хост-тік більше НЕ керується тут вручну (порівнянням hostUsername) —
    // engine сам викликає onBecomeHost/onLoseHost (startOwnerTick/
    // stopOwnerTick вище) через lockedHost-механізм, включно з
    // автоматичним переобранням, якщо попередній хост зникає.

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

  // Плейтест-2: усі живі (і онлайн) гравці натиснули "Готовий голосувати"
  // -> day_discussion завершується достроково, не чекаючи повного таймера.
  // Єдиний виняток із правила "жодна фаза не завершується достроково" —
  // навмисно, і лише тут: анонімність нічних дій тут не при чому, а 90с
  // форсованого мовчання, коли всі вже готові, просто дратує.
  function allAliveReadyToVote(room) {
    const alive = connectedEntries(room.players || {}).filter(([, p]) => p.alive);
    if (!alive.length) return false;
    const ready = room.dayReady || {};
    return alive.every(([u]) => !!ready[u]);
  }

  // ------------------------- тік (лише на пристрої власника) -------------------------
  function ownerTick() {
    const room = engine.latestRoom;
    if (!room) return;
    if (room.phase === "lobby" || room.phase === "game_over") return;
    if (room.paused) return; // плейтест-2: загальна пауза — тік просто не крутиться
    // перехід із цієї фази вже надіслано — чекаємо підтвердження; але якщо
    // запис загубився (мережа ведучого), не зависаємо назавжди, а повторюємо.
    if (advancingSincePhase === room.phase && Date.now() - advancingAt < ADVANCE_RETRY_MS) return;
    if (room.phaseDeadline == null) return;
    const deadlineReached = engine.now() >= room.phaseDeadline;
    const earlyByReadyVote = room.phase === "day_discussion" && allAliveReadyToVote(room);
    if (!deadlineReached && !earlyByReadyVote) return;
    advancingSincePhase = room.phase;
    advancingAt = Date.now();
    advancePhase(room);
  }

  // Плейтест-2: window.MafiaGame.Skip() у консолі — форсує перехід ПОТОЧНОЇ
  // фази прямо зараз, ігноруючи дедлайн. Довірча devtool-функція (як і
  // решта прямих RTDB-записів у проєкті) — працює з будь-якого підключеного
  // клієнта, не лише з пристрою власника.
  function forceAdvance() {
    const room = engine.latestRoom;
    if (!room) return;
    if (room.phase === "lobby" || room.phase === "game_over") return;
    advancingSincePhase = null;
    advancePhase(room);
  }

  // Ведучий перемикає фазу вручну, не чекаючи таймера.
  function narratorNext() {
    const room = engine.latestRoom;
    if (!room || room.narrator !== myUsername || room.paused) return;
    forceAdvance();
  }

  function pauseGame() {
    const room = engine.latestRoom;
    if (!room || (room.hostUsername !== myUsername && room.narrator !== myUsername) || room.paused) return;
    engine.roomRef.update({ paused: true, pausedAt: engine.now() });
  }

  // Компенсуємо весь час паузи в phaseDeadline, інакше фаза "згорає" у
  // фоні, поки гра на паузі.
  function resumeGame() {
    const room = engine.latestRoom;
    if (!room || (room.hostUsername !== myUsername && room.narrator !== myUsername) || !room.paused) return;
    const pausedFor = engine.now() - (room.pausedAt || engine.now());
    const patch = { paused: false, pausedAt: null };
    if (room.phaseDeadline != null) patch.phaseDeadline = room.phaseDeadline + pausedFor;
    engine.roomRef.update(patch);
  }

  function setDayReady(ready) {
    const room = engine.latestRoom; const me = room && room.players[myUsername];
    if (!room || room.phase !== "day_discussion" || !me || !me.alive || !engine.roomRef) return;
    engine.roomRef.child("dayReady/" + myUsername).set(!!ready);
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
        return write({}, "mafia_wake", PHASE_DURATIONS.mafia_wake);

      case "mafia_wake":
        return write({}, "mafia_move", PHASE_DURATIONS.mafia_move);

      case "mafia_move":
        if (settings.doctorEnabled) return write({}, "doctor_wake", PHASE_DURATIONS.doctor_wake);
        if (settings.sheriffEnabled) return write({}, "sheriff_wake", PHASE_DURATIONS.sheriff_wake);
        return resolveNight(room);

      case "doctor_wake":
        return write({}, "doctor_move", PHASE_DURATIONS.doctor_move);

      case "doctor_move":
        if (settings.sheriffEnabled) return write({}, "sheriff_wake", PHASE_DURATIONS.sheriff_wake);
        return resolveNight(room);

      case "sheriff_wake":
        return write({}, "sheriff_move", PHASE_DURATIONS.sheriff_move);

      case "sheriff_move":
        return resolveNight(room);

      case "banner_morning": {
        // плейтест-2: "ніхто не загинув" — 10с на порожній екран задовго,
        // скорочуємо саме цей випадок; коли є жертва — лишаємо повний час
        // (люди мають встигнути усвідомити). resolveNight() уже записав
        // room.nightResult ДО входу в banner_morning, тож підглянути тут можна.
        const safe = !(room.nightResult && room.nightResult.victim);
        // Газету без жертви теж треба встигнути прочитати — 7с замість колишніх 2с.
        return write({}, "night_reveal", safe ? 7000 : PHASE_DURATIONS.night_reveal);
      }

      case "night_reveal": {
        const victim = room.nightResult && room.nightResult.victim;
        if (victim) {
          return write({ lastWords: { victim }, lastWordsNext: "day_discussion" }, "last_words", PHASE_DURATIONS.last_words);
        }
        return write({ lastWords: null, lastWordsNext: null, dayReady: {} }, "day_discussion", PHASE_DURATIONS.day_discussion);
      }

      case "last_words": {
        const next = room.lastWordsNext === "player_elimination_anim" ? "player_elimination_anim" : "day_discussion";
        const patch = next === "day_discussion" ? { dayReady: {} } : {};
        return write(patch, next, PHASE_DURATIONS[next]);
      }

      case "day_discussion":
        return write({ dayReady: {} }, "voting", PHASE_DURATIONS.voting);

      case "voting":
        return resolveVoting(room);

      case "player_elimination_anim":
        // плейтест-3: банер "Підбиваємо підсумки" тепер завжди короткий
        // (4с) — раніше скорочував лише фінальний випадок, тепер це
        // просто PHASE_DURATIONS.banner_state (=4000) для всіх випадків.
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

    // Кожен живий лікар рятує свою ціль; захищений кожен, кого обрав хоч один.
    const doctorSaves = new Set();
    if (settings.doctorEnabled) {
      Object.entries(players).filter(([, p]) => p.alive && p.role === "doctor").forEach(([u]) => {
        const m = moves[u];
        if (m && m.choice === "target") doctorSaves.add(m.target);
      });
    }

    let sheriffCheck = null;
    if (settings.sheriffEnabled) {
      const sh = Object.entries(players).find(([, p]) => p.alive && p.role === "sheriff");
      const m = sh && moves[sh[0]];
      if (m && m.choice === "target" && players[m.target]) {
        sheriffCheck = { username: m.target, isMafia: players[m.target].role === "mafia" };
      }
    }

    const isIntroRound = settings.introRoundEnabled && (room.nightNumber || 1) === 1;
    const victim = (!isIntroRound && killTarget && !doctorSaves.has(killTarget)) ? killTarget : null;
    // savedSomeone — публічний факт "лікар встиг" (без імені врятованого).
    const savedSomeone = !isIntroRound && !!killTarget && doctorSaves.has(killTarget);
    const n = room.nightNumber || 1;
    const patch = { nightResult: { victim: victim || null, sheriffCheck, savedSomeone, intro: !!isIntroRound }, moves: {} };
    patch["history/n" + n] = { type: "night", n, victim: victim || null, savedSomeone, intro: !!isIntroRound };
    if (sheriffCheck) patch["sheriffLog/n" + n] = { n, target: sheriffCheck.username, isMafia: sheriffCheck.isMafia };
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
    const settings = Object.assign({}, DEFAULT_SETTINGS, room.settings);
    const isIntroRound = settings.introRoundEnabled && (room.nightNumber || 1) === 1;
    const tally = {};
    Object.entries(votes).forEach(([voter, target]) => {
      if (players[voter] && players[voter].alive && players[target] && players[target].alive) {
        tally[target] = (tally[target] || 0) + 1;
      }
    });
    const entries = Object.entries(tally);
    let eliminated = null;
    if (!isIntroRound && entries.length) {
      const max = Math.max(...entries.map(([, c]) => c));
      const top = entries.filter(([, c]) => c === max);
      if (top.length === 1) eliminated = top[0][0]; // нічия — ніхто не вигнаний
    }

    const n = room.nightNumber || 1;
    const patch = { votes: {}, lastEliminated: eliminated || null, lastVotes: Object.keys(votes).length ? votes : null };
    patch["history/d" + n] = { type: "day", n, eliminated: eliminated || null, tie: !eliminated && entries.length > 0, intro: !!isIntroRound };
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

  // Плейтест-2: скіп лікаря прибрано повністю — лікар МАЄ обрати когось,
  // єдиний спосіб "не рятувати" — не встигнути до кінця таймера (moves
  // лишиться порожнім). Виклик без target тепер просто ігнорується.
  function submitDoctorMove(target) {
    const room = engine.latestRoom; const me = room && room.players[myUsername];
    if (!room || room.phase !== "doctor_move" || !me || !me.alive || me.role !== "doctor" || !target) return;
    engine.roomRef.child("moves/" + myUsername).set({ choice: "target", target });
  }

  function submitSheriffMove(target) {
    const room = engine.latestRoom; const me = room && room.players[myUsername];
    if (!room || room.phase !== "sheriff_move" || !me || !me.alive || me.role !== "sheriff" || !target) return;
    if ((room.moves || {})[myUsername]) return; // "1 остаточний вибір" — уже перевірив цієї ночі
    engine.roomRef.child("moves/" + myUsername).set({ choice: "target", target });
  }

  // target === null означає "скасувати голос" (прибрати запис голосу
  // повністю, а не просто "не голосувати ні за кого візуально") — на
  // відміну від лікаря/шерифа, тут це свідомо дозволено: якщо ніч не дала
  // жодної зачіпки (ніхто не загинув, перевірка шерифа нічого не прояснила),
  // гравці мають право явно відмовитись від лінчу того дня, а не бути
  // змушеними тицяти в когось навмання.
  function submitVote(target) {
    const room = engine.latestRoom; const me = room && room.players[myUsername];
    if (!room || room.phase !== "voting" || !me || !me.alive) return;
    if (target) {
      engine.roomRef.child("votes/" + myUsername).set(target);
    } else {
      engine.roomRef.child("votes/" + myUsername).remove();
    }
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
    if (me.role === "narrator") return (state.phase === "day_discussion" || state.phase === "voting") ? { status: "day", key: "day" } : { status: "role_spectator", key: "always" };
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
    if (me.role === "narrator") key = (state.phase === "day_discussion" || state.phase === "voting") ? "day" : "always";
    else if (!me.alive) key = "always";
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
    const settings = Object.assign({}, DEFAULT_SETTINGS, room.settings);
    const conn = connectedEntries(players);
    // Ролі отримують лише ті, хто зараз у лобі (онлайн); хто давно вийшов —
    // прибираємо з кімнати, інакше він "висить" живим і ламає підрахунок перемоги.
    const narrator = settings.narratorMode ? myUsername : null;
    const names = conn.map(([u]) => u).filter((u) => u !== narrator);
    if (names.length < MIN_PLAYERS || names.length > MAX_PLAYERS) return;

    const mafiaCount = resolveMafiaCount(names.length, settings);
    const shuffled = shuffle(names.slice());
    const roles = {};
    let i = 0;
    const mafiaNames = shuffled.slice(i, i + mafiaCount); i += mafiaCount;
    mafiaNames.forEach((u) => { roles[u] = "mafia"; });
    const doctorCount = resolveDoctorCount(names.length, settings);
    for (let d = 0; d < doctorCount; d++) { roles[shuffled[i]] = "doctor"; i++; }
    if (settings.sheriffEnabled) { roles[shuffled[i]] = "sheriff"; i++; }
    for (; i < shuffled.length; i++) roles[shuffled[i]] = "civilian";
    const donUsername = mafiaNames[Math.floor(Math.random() * mafiaNames.length)];

    const patch = { settings, nightNumber: 1, moves: {}, votes: {}, nightResult: null,
      lastEliminated: null, lastWords: null, lastWordsNext: null, winner: null,
      history: {}, sheriffLog: {}, lastVotes: null, chat: {}, narrator };
    Object.keys(players).forEach((u) => { if (!names.includes(u) && u !== narrator) patch["players/" + u] = null; });
    if (narrator) Object.assign(patch, { ["players/" + narrator + "/role"]: "narrator", ["players/" + narrator + "/isDon"]: false, ["players/" + narrator + "/alive"]: false });
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
      lastEliminated: null, lastWords: null, lastWordsNext: null, winner: null,
      history: {}, sheriffLog: {}, lastVotes: null, narrator: null };
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
    ROLE_META, DEFAULT_SETTINGS, MIN_PLAYERS, MAX_PLAYERS, MAX_MAFIA, MAX_DOCTORS, PHASE_DURATIONS,
    resolveMafiaCount, resolveDoctorCount,
    now: () => engine.now(),
    get me() { const r = engine.latestRoom; return r && myUsername ? (r.players || {})[myUsername] : null; },
    get room() { return engine.latestRoom; },
    get roomId() { return engine.currentRoomId; },
    get roomRef() { return engine.roomRef; },
    start, stop,
    connectedEntries, watchActiveRooms,
    setReady, setSettings, startGame, resetGame, setNoir, NOIR_COUNT,
    submitMafiaMove, submitDoctorMove, submitSheriffMove, submitVote,
    sendChatMessage, visibleChat, myChatChannel,
    setDayReady, pauseGame, resumeGame, narratorNext,
    Skip: forceAdvance, // плейтест-2: window.MafiaGame.Skip() у консолі браузера
    set onStateChange(fn) { gameOnStateChange = fn || (() => {}); },
  };
})();