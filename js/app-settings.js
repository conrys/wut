// ==========================================================================
// Спільні налаштування застосунку (звук / розмір відступу хедера / розмір
// керування). Один localStorage-ключ на все, застосування — через
// CSS-змінні на document.documentElement, щоб будь-яка сторінка/стиль міг
// на них зреагувати без додаткового коду (var(--app-header-margin-top),
// var(--ctrl-size) і т.д.).
//
// Раніше розмір керування жив ЛОКАЛЬНО тільки в snake.html (свій
// localStorage-ключ "snake_ctrl_size", своя таблиця SIZE_CONFIGS). Тепер
// таблиця тут, а snake.html лише читає/пише через AppSettings — і той
// самий вибір видно/змінюваний з index.html.
//
// Підключати РАНО на кожній сторінці (одразу після firebase-config.js,
// до game-header.js/login.js/back-button.js/records.js), щоб CSS-змінні
// були виставлені ще до першого фарбування:
//   <script src="js/app-settings.js"></script>
//   <script src="js/game-header.js"></script>
//   ...
// ==========================================================================
(function () {
  const STORAGE_KEY = "app_settings";
  const LEGACY_CTRL_KEY = "snake_ctrl_size"; // для м'якої міграції старого значення

  const DEFAULTS = { headerMargin: "M", controlSize: "M", soundOn: true, vibrationOn: true };

  const HEADER_MARGINS = { S: "8px", M: "24px", L: "48px", XL: "72px", XXXXL: "100px" };

  const CONTROL_SIZES = {
    S: { size: "48px", font: "18px", gap: "5px" },
    M: { size: "58px", font: "22px", gap: "6px" },
    L: { size: "70px", font: "28px", gap: "8px" },
    XL: { size: "84px", font: "34px", gap: "10px" },
  };

  function load() {
    let stored = {};
    try {
      stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch (e) {
      stored = {};
    }
    const merged = Object.assign({}, DEFAULTS, stored);

    // Одноразова міграція старого локального ключа Змійки, якщо спільного
    // значення ще нема (щоб той, хто вже підібрав собі розмір, не загубив
    // вибір після оновлення).
    if (!("controlSize" in stored)) {
      const legacy = localStorage.getItem(LEGACY_CTRL_KEY);
      if (legacy && CONTROL_SIZES[legacy]) merged.controlSize = legacy;
    }
    return merged;
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  }

  function apply() {
    const root = document.documentElement.style;

    root.setProperty(
      "--app-header-margin-top",
      HEADER_MARGINS[current.headerMargin] || HEADER_MARGINS.M
    );

    const ctrl = CONTROL_SIZES[current.controlSize] || CONTROL_SIZES.M;
    root.setProperty("--ctrl-size", ctrl.size);
    root.setProperty("--ctrl-font", ctrl.font);
    root.setProperty("--ctrl-gap", ctrl.gap);
  }

  let current = load();
  apply();

  function get(key) {
    return key ? current[key] : Object.assign({}, current);
  }

  function set(key, value) {
    current[key] = value;
    // Вимкнули звук під час програшу доріжки — глушимо її одразу, а не
    // чекаємо, поки вона догра сама.
    if (key === "soundOn" && value === false) stopSound();
    persist();
    apply();
    document.dispatchEvent(new CustomEvent("appsettingschange", { detail: { key, value, settings: get() } }));
  }

  function isSoundOn() {
    return current.soundOn !== false;
  }

  function isVibrationOn() {
    return current.vibrationOn !== false;
  }

  // Кеш вже створених <audio> — щоб той самий звук, який грає часто
  // (напр. тік голосування раз/сек), не створював новий HTMLAudioElement
  // щоразу. Відсутній файл на диску просто тихо ігнорується (немає в
  // консолі жодної помилки) — так само, як уже було зроблено в
  // mafia-host.html, тут той самий підхід, але спільний для всіх ігор.
  const audioCache = {};

  // ОДИН активний звук на застосунок. Раніше playSound() лише стартував
  // новий <audio>, нічого не зупиняючи: якщо фаза мінялась швидше за
  // тривалість файлу (у тесті з ботами — щосекунди), voting-start.mp3
  // продовжував гудіти вже поверх вироку. Тепер новий звук ЗАВЖДИ глушить
  // попередній (крім явного playSound(path, { overlap: true })).
  let currentAudio = null;

  function stopSound() {
    if (!currentAudio) return;
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    } catch (e) {}
    currentAudio = null;
  }

  // ------------------------------------------------------------------
  // Варіанти одного й того ж звуку: night.mp3 / night1.mp3 / night2.mp3,
  // night-result-dead.mp3 / night-result-dead2.mp3 і т.д. Ніде нічого
  // реєструвати не треба — достатньо покласти файл поруч із основним і
  // дописати до імені цифру. При першому програші звуку код тихо
  // "промацує" сусідів <base><1..MAX_VARIANTS>.<ext>: ті, що реально
  // існують, потрапляють у пул, і далі щоразу береться випадковий з пулу.
  // Дірки в нумерації дозволені (є dead2 без dead1 — це нормально),
  // відсутній файл просто не додається (в консолі — жодної помилки).
  // ------------------------------------------------------------------
  const MAX_VARIANTS = 5;
  const variantCache = {}; // "snd/mafia/night.mp3" -> ["...night.mp3", "...night1.mp3", ...]

  function getAudio(path) {
    let audio = audioCache[path];
    if (!audio) {
      audio = new Audio(path);
      audio.preload = "auto";
      audio.addEventListener("error", () => {}, { once: true });
      audioCache[path] = audio;
    }
    return audio;
  }

  function probeVariants(path) {
    const list = [path];
    variantCache[path] = list;

    const dot = path.lastIndexOf(".");
    if (dot < 1) return;
    const base = path.slice(0, dot);
    const ext = path.slice(dot);

    for (let i = 1; i <= MAX_VARIANTS; i++) {
      const candidate = base + i + ext;
      const probe = new Audio(candidate);
      probe.preload = "metadata";
      probe.addEventListener(
        "loadedmetadata",
        () => {
          if (list.indexOf(candidate) === -1) {
            list.push(candidate);
            list.sort();
          }
        },
        { once: true }
      );
      probe.addEventListener("error", () => {}, { once: true }); // такого файлу нема — просто пропускаємо
      try { probe.load(); } catch (e) {}
    }
  }

  function resolvePath(path) {
    const list = variantCache[path];
    if (!list) {
      probeVariants(path); // перший виклик грає основний файл, пул підтягнеться до наступного разу
      return path;
    }
    if (list.length < 2) return path;
    return list[Math.floor(Math.random() * list.length)];
  }

  function playSound(path, opts) {
    if (!isSoundOn() || !path) return;
    const overlap = !!(opts && opts.overlap);
    if (!overlap) stopSound();

    const audio = getAudio(resolvePath(path));
    try {
      audio.currentTime = 0;
      const p = audio.play();
      if (p && p.catch) p.catch(() => {}); // автоплей заблокований чи файл відсутній — ігноруємо
    } catch (e) {}

    if (!overlap) {
      currentAudio = audio;
      audio.addEventListener(
        "ended",
        () => { if (currentAudio === audio) currentAudio = null; },
        { once: true }
      );
    }
  }

  // pattern: число (мс) або масив [вібро, пауза, вібро, ...] — той самий
  // формат, що приймає navigator.vibrate().
  //
  // ВАЖЛИВО: чистий web Vibration API (navigator.vibrate) у більшості
  // браузерів/WebView спрацьовує лише як ПРЯМИЙ наслідок жесту користувача
  // (клік/тап) — виклик з асинхронного колбека (тут: зміна фази в RTDB)
  // браузер просто тихо ігнорує, без помилки в консолі. Тому пріоритет —
  // нативний Capacitor Haptics (обходить це обмеження, бо йде напряму в
  // Android, а не через веб-API), і лише якщо плагіна нема — best-effort
  // фолбек на navigator.vibrate (спрацює для викликів із кліку, для
  // фонових подій найімовірніше ні — але це вже не гірше, ніж було).
  //
  // Потрібно: npm i @capacitor/haptics && npx cap sync android (сама
  // капаситорна оболонка вже додає дозвіл VIBRATE в AndroidManifest —
  // вручну його прописувати не треба).
  function vibrateViaCapacitor(pattern) {
    const Haptics = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics;
    if (!Haptics) return false;
    const chunks = Array.isArray(pattern) ? pattern : [pattern];
    let delay = 0;
    chunks.forEach((ms, i) => {
      if (i % 2 === 0 && ms > 0) {
        setTimeout(() => Haptics.vibrate({ duration: ms }).catch(() => {}), delay);
      }
      delay += ms;
    });
    return true;
  }

  function vibrate(pattern) {
    if (!isVibrationOn()) return;
    if (vibrateViaCapacitor(pattern)) return;
    if (!navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch (e) {}
  }

  // Той самий механізм, що й vibrate(), але СВІДОМО ігнорує тумблер
  // "Вібрація увімк./вимк." — це чиста діагностика заліза/плагіна:
  // натиснута кнопка тест-вібро мала б спрацювати незалежно від того, в
  // якому стані зараз загальне налаштування.
  function testVibrate() {
    if (!vibrateViaCapacitor(100) && navigator.vibrate) {
      try { navigator.vibrate(100); } catch (e) {}
    }
  }

  window.AppSettings = {
    get,
    set,
    isSoundOn,
    isVibrationOn,
    playSound,
    stopSound,
    vibrate,
    testVibrate,
    HEADER_MARGINS: Object.keys(HEADER_MARGINS),
    CONTROL_SIZES: Object.keys(CONTROL_SIZES),
  };

  // ------------------------------------------------------------------------
  // Плаваюча кнопка налаштувань (⚙, знизу зліва) + панель. Монтується сама,
  // без розмітки в HTML — так само, як GameHeader.ensure(). З'являється на
  // будь-якій сторінці, що підключила цей скрипт.
  // ------------------------------------------------------------------------
  function mountSettingsUI() {
    if (document.getElementById("appSettingsBtn")) return;

    const style = document.createElement("style");
    style.textContent = `
      #appSettingsBtn {
        position: fixed;
        left: 16px;
        bottom: 62px;
        z-index: 999;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, 0.15);
        background: rgba(30, 30, 36, 0.85);
        color: #f0f0f0;
        font-size: 18px;
        
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
      }
      #appSettingsPanel {
        position: fixed;
        inset: 0;
        z-index: 1000;
        display: none;
        align-items: flex-end;
        justify-content: flex-start;
        background: rgba(0, 0, 0, 0.5);
        padding: 12px;
        box-sizing: border-box;
      }
      #appSettingsPanel.open { display: flex; }
      #appSettingsPanel .box {
        background: #1e1e24;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 14px;
        padding: 16px;
        width: 260px;
        max-width: calc(100vw - 24px);
        color: #f0f0f0;
        font-family: inherit;
      }
      #appSettingsPanel h4 {
        margin: 0 0 8px;
        font-size: 12px;
        color: #9a9aa5;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      #appSettingsPanel .row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
      #appSettingsPanel .opt-btn {
        flex: 1;
        min-width: 40px;
        padding: 8px 6px;
        font-size: 13px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.06);
        color: #f0f0f0;
        cursor: pointer;
      }
      #appSettingsPanel .opt-btn.active {
        border-color: #38cfa0;
        background: rgba(56, 207, 160, 0.15);
        color: #38cfa0;
      }
      #appSettingsPanel .close-btn {
        width: 100%;
        margin-top: 4px;
        padding: 10px;
        border-radius: 8px;
        border: none;
        background: #38cfa0;
        color: #14161a;
        font-weight: 700;
        cursor: pointer;
      }
    `;
    document.head.appendChild(style);

    const btn = document.createElement("button");
    btn.id = "appSettingsBtn";
    btn.type = "button";
    btn.title = "Налаштування";
    btn.textContent = "⚙";

    const panel = document.createElement("div");
    panel.id = "appSettingsPanel";
    panel.innerHTML = `
      <div class="box">
        <h4>Відступ хедера</h4>
        <div class="row" data-setting="headerMargin">
          ${Object.keys(HEADER_MARGINS)
            .map((k) => `<button type="button" class="opt-btn" data-value="${k}">${k}</button>`)
            .join("")}
        </div>
        <h4>Розмір керування</h4>
        <div class="row" data-setting="controlSize">
          ${Object.keys(CONTROL_SIZES)
            .map((k) => `<button type="button" class="opt-btn" data-value="${k}">${k}</button>`)
            .join("")}
        </div>
        <h4>Звук</h4>
        <div class="row" data-setting="soundOn">
          <button type="button" class="opt-btn" data-value="on">Увімк.</button>
          <button type="button" class="opt-btn" data-value="off">Вимк.</button>
        </div>
        <h4>Вібрація</h4>
        <div class="row" data-setting="vibrationOn">
          <button type="button" class="opt-btn" data-value="on">Увімк.</button>
          <button type="button" class="opt-btn" data-value="off">Вимк.</button>
        </div>
        <button type="button" class="close-btn" id="testVibrateBtn" style="background: rgba(255,255,255,0.1); color: #f0f0f0; margin-bottom: 10px;">🔔 Тест вібро (0.1с)</button>
        <button type="button" class="close-btn">Готово</button>
      </div>
    `;

    document.body.appendChild(btn);
    document.body.appendChild(panel);

    const BOOL_KEYS = ["soundOn", "vibrationOn"];

    function refreshActive() {
      panel.querySelectorAll(".row").forEach((row) => {
        const key = row.dataset.setting;
        const value = BOOL_KEYS.includes(key) ? (current[key] !== false ? "on" : "off") : current[key];
        row.querySelectorAll(".opt-btn").forEach((b) => {
          b.classList.toggle("active", b.dataset.value === value);
        });
      });
    }

    btn.addEventListener("click", () => {
      refreshActive();
      panel.classList.add("open");
    });
    panel.addEventListener("click", (e) => {
      if (e.target === panel) panel.classList.remove("open");
    });
    panel.querySelector(".close-btn").addEventListener("click", () => {
      panel.classList.remove("open");
    });
    const testBtn = document.getElementById("testVibrateBtn");
    testBtn.addEventListener("click", () => {
      const hasCapacitor = !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics);
      const hasWebVibrate = !!navigator.vibrate;
      testVibrate();
      testBtn.textContent = hasCapacitor
        ? "✅ Capacitor Haptics знайдено"
        : hasWebVibrate
        ? "⚠️ тільки navigator.vibrate (без Capacitor)"
        : "❌ жодного способу вібрувати нема";
      setTimeout(() => { testBtn.textContent = "🔔 Тест вібро (0.1с)"; }, 2500);
    });
    panel.querySelectorAll(".opt-btn").forEach((b) => {
      b.addEventListener("click", () => {
        const key = b.closest(".row").dataset.setting;
        const value = BOOL_KEYS.includes(key) ? b.dataset.value === "on" : b.dataset.value;
        set(key, value);
        refreshActive();
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountSettingsUI);
  } else {
    mountSettingsUI();
  }
})();
