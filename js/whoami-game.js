// ==========================================================================
// Хто я? — ПОВНІСТЮ ОФЛАЙН гра, без Firebase RTDB і без online-engine.js.
//
// Причина: гра грається так, що кожен тримає СВІЙ телефон і показує слово
// ІНШИМ гравцям (не собі) — увесь геймплей відбувається "в кімнаті", без
// потреби синхронізувати стан між пристроями. Якщо в двох гравців випадково
// співпав слово — компанія й так це помітить (усі бачать чужі екрани), тому
// анти-дублікат пул слів через мережу — зайва складність, яку прибрали.
//
// Кожен пристрій сам веде свій рахунок і свій локальний пул "вже показаних"
// слів (щоб не повторювались підряд у ЦІЙ сесії), без жодного запису кудись.
// ==========================================================================
(function () {
  const DIFFICULTIES = ["easy", "medium", "hard"];
  const DIFF_LABELS = { easy: "Легка", medium: "Середня", hard: "Складна" };
  const THEME_NAMES = WHOAMI_THEMES.map((t) => t.name);

  let settings = { theme: "random", difficulty: "medium" };
  let score = 0;
  let currentWord = null;
  let currentThemeName = null;
  let usedThisSession = {}; // { "тема:складність": Set(слів) } — лише пам'ять цієї сесії гри

  function pickThemeName(themeSetting) {
    return themeSetting === "random"
      ? THEME_NAMES[Math.floor(Math.random() * THEME_NAMES.length)]
      : themeSetting;
  }

  function dealNewWord() {
    const themeName = pickThemeName(settings.theme);
    const theme = WHOAMI_THEMES.find((t) => t.name === themeName);
    const pool = theme[settings.difficulty] || theme.medium;
    const key = themeName + ":" + settings.difficulty;
    const used = usedThisSession[key] || (usedThisSession[key] = new Set());
    let available = pool.filter((w) => !used.has(w));
    if (!available.length) { used.clear(); available = pool; } // пул вичерпано — почали по колу
    const word = available[Math.floor(Math.random() * available.length)];
    used.add(word);
    currentWord = word;
    currentThemeName = themeName;
  }

  function updateSettings(theme, difficulty) {
    settings = { theme, difficulty };
  }

  function startGame() {
    score = 0;
    usedThisSession = {};
    dealNewWord();
  }

  function markGuessed() {
    score += 1;
    dealNewWord();
  }

  function skipWord() {
    dealNewWord();
  }

  function resetAll() {
    startGame();
  }

  function getState() {
    return { settings, score, currentWord, currentThemeName };
  }

  window.WhoAmIGame = {
    DIFFICULTIES,
    DIFF_LABELS,
    THEME_NAMES,
    updateSettings,
    startGame,
    markGuessed,
    skipWord,
    resetAll,
    getState,
  };
})();
