// ==========================================================================
// mafia-sounds.js — тонка обгортка над Howler.js для "Мафії".
//
// window.MafiaSounds.play(key) — key відповідає КОЛОНЦІ "state" у робочій
// таблиці звуків (sounds.xlsx): один ключ може мати кілька варіантів файлу
// з вагами (sound_spawn_chance) — при кожному виклику обирається зважено-
// випадковий варіант. Ключі, для яких звук ще не підібраний (WIP-збір),
// мають порожній масив — play() тоді просто нічого не грає, без падіння.
//
// Ключі — це майже завжди назва фази (room.phase), АЛЕ для двох моментів
// одна фаза має два взаємовиключні варіанти залежно від результату:
//   - "banner_morning_safe" / "banner_morning_dead" — при вході в
//     night_reveal, залежно від того, чи є жертва ночі;
//   - "player_elimination_anim" / "voting_draw" — при вході в
//     player_elimination_anim, залежно від того, чи когось вигнали.
// Обидва варіанти в кожній парі — окремі ключі в SOUND_TABLE, а який саме
// викликати — вирішує mafia2.html у cueEnterPhase() за станом гри.
// ==========================================================================
(function () {
  "use strict";

  const BASE_PATH = "snd/mafia/";

  // ключ → [[файл, вага], ...]. Порожній масив = звук ще не підібраний.
  const SOUND_TABLE = {
    lobby: [],
    role_reveal: [["rrs.mp3", 3], ["rr.mp3", 94], ["rr1.mp3", 3]],
    // плейтест-2: "зробити звук для role_mafia довшим" — окремий, довший
    // варіант САМЕ для гравця, якому випала мафія (mafia.html кличе цей
    // ключ замість звичайного role_reveal, коли me.role === "mafia").
    // Поки порожньо — постав файл(и), коли будуть готові.
    role_reveal_mafia: [],
    banner_night: [["nv.mp3", 15], ["nl.mp3", 85]],
    mafia_move: [["gf.mp3", 100]],
    doctor_move: [["hm.mp3", 1], ["amb.wav", 99]],
    sheriff_move: [["rc.mp3", 100]],
    night_resolve: [],
    banner_morning: [["m.wav", 100]],
    banner_morning_safe: [["ds.mp3", 100]],
    banner_morning_dead: [["db.mp3", 100]],
    last_words: [],
    day_discussion: [["de.mp3", 3], ["dm.mp3", 97]],
    voting: [["v.wav", 100]],
    voting_draw: [["bv.wav", 100]],
    player_elimination_anim: [],
    banner_state: [],
    game_over: [],
    // поза таблицею звуків (sounds.xlsx їх ще не розрізняє) — потрібні коду
    // для різних банерів фіналу.
    // gf.mp3 уже використовується для mafia_move — тут свідомо дублюємо
    // той самий файл на game_over_mafia_win (той самий "переможний" тон).
    game_over_mafia_win: [["gf.mp3", 100]],
    game_over_mafia_lose: [["cv.mp3", 100]],
  };

  // [на тестування, плейтест-2] окрема ФОНОВА доріжка, що грає ПАРАЛЕЛЬНО
  // з головним потоком звуків (не через play(), щоб її не зупиняло кожне
  // наступне play() з SOUND_TABLE) — зараз лише для day_discussion
  // ("діалог сімів" — гібриш-балачка на фоні обговорення). Порожньо, поки
  // не буде файлу; ключі окремі від SOUND_TABLE навмисно.
  const AMBIENT_TABLE = {
    day_discussion: [],
  };

  const cache = {}; // filename -> Howl
  let activeHowl = null; // те, що зараз реально грає (основний потік) — щоб було що зупинити
  let activeAmbientHowl = null; // окремий, паралельний потік — play()/stop() його не чіпають

  function pickWeighted(pool) {
    if (!pool || !pool.length) return null;
    const total = pool.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    for (const [file, w] of pool) {
      r -= w;
      if (r <= 0) return file;
    }
    return pool[pool.length - 1][0];
  }

  function getHowl(file) {
    if (cache[file]) return cache[file];
    if (typeof Howl === "undefined") return null;
    const h = new Howl({
      src: [BASE_PATH + file],
      onloaderror: () => { /* файлу ще нема на диску — просто мовчимо */ },
    });
    cache[file] = h;
    return h;
  }

  // ------------------------- Capacitor Haptics (за наявності) -------------------------
  function haptic(style) {
    try {
      const H = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics;
      if (!H) return; // звичайний браузер — просто без вібро
      H.impact({ style });
    } catch (e) { /* не в Capacitor-обгортці */ }
  }
  const HAPTIC_MAP = {
    mafia_move: "LIGHT", doctor_move: "LIGHT", sheriff_move: "LIGHT",
    banner_morning_dead: "HEAVY", voting: "LIGHT",
    player_elimination_anim: "MEDIUM", voting_draw: "LIGHT",
  };

  function play(key) {
    if (HAPTIC_MAP[key]) haptic(HAPTIC_MAP[key]);
    const file = pickWeighted(SOUND_TABLE[key]);
    // ВАЖЛИВО (плейтест-2, "звук для vote налазить і на last_words, і на
    // 'вибув'"): зупиняємо попередній активний звук ЗАВЖДИ на вхід у нову
    // фазу — навіть якщо для НОВОЇ фази файл іще не підібраний (порожній
    // пул). Раніше `if (!file) return;` виходив РАНІШЕ, ніж встигав
    // зупинити activeHowl, тож довгий v.wav просто продовжував грати
    // поверх last_words/player_elimination_anim, у яких SOUND_TABLE ще
    // порожня. Один активний звук одночасно — завжди, а не лише коли є
    // чим його замінити.
    if (activeHowl) { activeHowl.stop(); activeHowl = null; }
    if (!file) return;
    const h = getHowl(file);
    if (!h) return;
    activeHowl = h;
    h.play();
  }

  // Паралельна фонова доріжка (AMBIENT_TABLE) — незалежна від play()/stop()
  // головного потоку, щоб не переривати "діалог сімів" кожним фразовим
  // переходом. loop:true за замовчуванням, гучність приглушена, щоб не
  // забивати основні репліки/звуки.
  function playAmbient(key) {
    stopAmbient();
    const file = pickWeighted(AMBIENT_TABLE[key]);
    if (!file) return;
    if (typeof Howl === "undefined") return;
    activeAmbientHowl = new Howl({ src: [BASE_PATH + file], loop: true, volume: 0.35 });
    activeAmbientHowl.play();
  }
  function stopAmbient() {
    if (activeAmbientHowl) { activeAmbientHowl.stop(); activeAmbientHowl = null; }
  }

  // Плейтест-3: пауза гри мала призупиняти й звук, а не лише таймер —
  // Howler.pause()/play() тримає позицію відтворення, тож звук РІВНО
  // продовжується з того самого місця, а не стартує заново.
  function pauseAll() {
    if (activeHowl) activeHowl.pause();
    if (activeAmbientHowl) activeAmbientHowl.pause();
  }
  function resumeAll() {
    if (activeHowl) activeHowl.play();
    if (activeAmbientHowl) activeAmbientHowl.play();
  }

  // Плейтест-2: "звуки почали грати лише з другого кола" — переважно це
  // file:// CORS у тестовому оточенні (Howler не може завантажити mp3
  // через XHR з file:///…, це видно й у консольних помилках — вирішується
  // роздачею через http(s), не подвійним кліком на .html). Але додатково,
  // про всяк випадок: прогріваємо всі файли з обох таблиць одним викликом
  // ще ДО першого play(), щоб перший реальний виклик не чекав на мережу.
  function preloadAll() {
    if (typeof Howl === "undefined") return;
    const files = new Set();
    Object.values(SOUND_TABLE).forEach((pool) => (pool || []).forEach(([f]) => files.add(f)));
    Object.values(AMBIENT_TABLE).forEach((pool) => (pool || []).forEach(([f]) => files.add(f)));
    files.forEach((f) => getHowl(f));
  }

  // Явна зупинка — знадобиться, якщо колись треба буде обірвати звук РАНІШЕ
  // (напр. хост форсує дострокове завершення фази з консолі).
  function stop() {
    if (activeHowl) activeHowl.stop();
    activeHowl = null;
  }

  // Дозволяє дограти власні (не-табличні) ключі, якщо колись знадобиться,
  // без правки цього файлу — напр. window.MafiaSounds.registerVariant(...).
  function registerSound(key, pool) { SOUND_TABLE[key] = pool; }

  window.MafiaSounds = { play, stop, registerSound, SOUND_TABLE, playAmbient, stopAmbient, preloadAll, AMBIENT_TABLE, pauseAll, resumeAll };
})();
