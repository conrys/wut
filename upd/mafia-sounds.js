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
    banner_night: [["nv.mp3", 15], ["nl.mp3", 85]],
    mafia_move: [["gf.mp3", 100]],
    doctor_move: [["rc.mp3", 100]],
    sheriff_move: [["hm.mp3", 1], ["amb.wav", 99]],
    night_resolve: [],
    banner_morning: [["m.wav", 100]],
    banner_morning_safe: [],
    banner_morning_dead: [],
    last_words: [],
    day_discussion: [["de.mp3", 3], ["dm.mp3", 97]],
    voting: [["v.wav", 100]],
    voting_draw: [["bv.wav", 100]],
    player_elimination_anim: [],
    banner_state: [],
    game_over: [],
    // поза таблицею звуків (sounds.xlsx їх ще не розрізняє) — потрібні коду
    // для різних банерів фіналу; поки що без файлів.
    game_over_mafia_win: [],
    game_over_mafia_lose: [],
  };

  const cache = {}; // filename -> Howl

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
    if (!file) return;
    const h = getHowl(file);
    if (h) h.play();
  }

  // Дозволяє дограти власні (не-табличні) ключі, якщо колись знадобиться,
  // без правки цього файлу — напр. window.MafiaSounds.registerVariant(...).
  function registerSound(key, pool) { SOUND_TABLE[key] = pool; }

  window.MafiaSounds = { play, registerSound, SOUND_TABLE };
})();
