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
// самый вибір видно/змінюваний з index.html.
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

  const DEFAULTS = { headerMargin: "M", headerStyle: "bar", homeSections: false, controlSize: "M", soundOn: true, vibrationOn: true, graphics: "auto", gameTheme: "orig" };

  // S — шапка впритул до верху екрана (лише безпечна зона телефона над нею)
  const HEADER_MARGINS = { S: "0px", M: "24px", L: "48px", XL: "72px", XXXXL: "100px" };

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


  // ---------------- Графіка: легкий режим для старих телефонів ----------------
  // «Авто» вмикає легкий режим сам, якщо телефон слабкий (мало памʼяті/ядер)
  // або в системі ввімкнено «зменшити рух». Легкий режим (клас html.lite)
  // вимикає найважче для старого GPU: розмиття під панелями, «нерухомі» фони,
  // що перемальовуються при прокрутці, нескінченні анімації, тіні-фільтри.
  // Ігри можуть спитати AppSettings.isLite() (Мафія — частинки, Змійка — світіння).
  function detectWeakDevice() {
    try {
      const mem = navigator.deviceMemory, cores = navigator.hardwareConcurrency;
      const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      return !!(reduce || (mem && mem <= 3) || (cores && cores <= 4));
    } catch (e) { return false; }
  }
  const WEAK_DEVICE = detectWeakDevice();
  const DARK_MQ = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function isDarkGames() {
    const t = current && current.gameTheme;
    return t === "dark" || (t === "system" && !!(DARK_MQ && DARK_MQ.matches));
  }
  if (DARK_MQ && DARK_MQ.addEventListener) DARK_MQ.addEventListener("change", () => apply());

  function isLite() {
    const g = current && current.graphics;
    return g === "lite" || (g !== "full" && WEAK_DEVICE);
  }
  const LITE_CSS = `
    html.lite *, html.lite *::before, html.lite *::after { backdrop-filter: none !important; -webkit-backdrop-filter: none !important;
      animation-iteration-count: 1 !important; scroll-behavior: auto !important; }
    html.lite, html.lite body { background-attachment: scroll !important; }
    html.lite .pav, html.lite .qa-av, html.lite .piece, html.lite .pc, html.lite .chip, html.lite svg { filter: none !important; }
    html.lite .grain, html.lite .fog, html.lite .flicker, html.lite .scratches, html.lite .specks, html.lite .sprockets { display: none !important; }
    html.lite body::before { animation: none !important; }
  `;
  function injectLiteCss() {
    if (document.getElementById("appLiteCss")) return;
    const st = document.createElement("style");
    st.id = "appLiteCss"; st.textContent = LITE_CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function apply() {
    const root = document.documentElement.style;
    injectLiteCss();
    document.documentElement.classList.toggle("lite", isLite());
    // вигляд шапки ігор: смуга з фоном або лише кнопки (js/styles/game-header.css)
    document.documentElement.classList.toggle("hdr-float", current.headerStyle === "float");
    document.documentElement.classList.toggle("hdr-top", current.headerMargin === "S");
    // темна тема для світлих ігор: кожна така гра має блок html.dark-games { … }
    document.documentElement.classList.toggle("dark-games", isDarkGames());

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

  function testVibrate() {
    if (!vibrateViaCapacitor(100) && navigator.vibrate) {
      try { navigator.vibrate(100); } catch (e) {}
    }
  }

  window.AppSettings = {
    get,
    set,
    isLite,
    isDarkGames,
    weakDevice: WEAK_DEVICE,
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
    if (document.getElementById("appSettingsPanel")) return;

    // Плаваюча кнопка налаштувань лишається лише на index.html — на сторінках
    // ігор панель відкривається з меню профілю (login.js). Панель монтуємо
    // всюди: її відкриває AppSettings.openPanel().
    const currentFile = window.location.pathname.split("/").pop();
    const isIndexPage = currentFile === "index.html" || currentFile === "";

    const style = document.createElement("style");
    style.textContent = `
      #appSettingsBtn {
        position: fixed; left: 16px; bottom: calc(16px + env(safe-area-inset-bottom)); z-index: 999;
        width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; cursor: pointer;
        border: 1px solid rgba(255,255,255,0.12); background: rgba(30,30,36,0.88); color: #f4f5f1;
        box-shadow: 0 6px 18px rgba(0,0,0,.35);
      }
      #appSettingsBtn svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

      #appSettingsPanel {
        position: fixed; inset: 0; z-index: 10000; display: none; align-items: flex-end; justify-content: center;
        background: rgba(6,8,14,0.66);
      }
      #appSettingsPanel.open { display: flex; }
      @keyframes asSheetUp { from { transform: translateY(40px); opacity: 0; } }
      #appSettingsPanel .box {
        box-sizing: border-box; width: 100%; max-width: 480px; max-height: 86vh; overflow-y: auto;
        padding: 10px 16px calc(16px + env(safe-area-inset-bottom));
        background: linear-gradient(180deg, #242836, #171a22); border: 1px solid rgba(255,255,255,0.08); border-bottom: 0;
        border-radius: 22px 22px 0 0; box-shadow: 0 -16px 40px rgba(0,0,0,.45);
        color: #f4f5f1; font-family: 'Inter', system-ui, sans-serif; animation: asSheetUp .3s cubic-bezier(.2,.9,.3,1) both;
      }
      #appSettingsPanel .box::before { content: ""; display: block; width: 44px; height: 5px; margin: 0 auto 12px; border-radius: 3px; background: rgba(255,255,255,.18); }
      #appSettingsPanel h3 { display: flex; align-items: center; gap: 10px; margin: 0 0 14px; font: 700 20px 'Space Grotesk', 'Inter', sans-serif; }
      #appSettingsPanel h3 svg { width: 24px; height: 24px; fill: none; stroke: #ffc93c; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

      #appSettingsPanel .grp { margin-bottom: 14px; }
      #appSettingsPanel .grp-t { margin: 0 4px 6px; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #8b909c; }
      #appSettingsPanel .card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); border-radius: 16px; overflow: hidden; }
      #appSettingsPanel .item { padding: 12px 14px; }
      #appSettingsPanel .item + .item { border-top: 1px solid rgba(255,255,255,0.06); }
      #appSettingsPanel .item-h { display: flex; align-items: center; gap: 12px; }
      #appSettingsPanel .item-l { flex: 1; min-width: 0; }
      #appSettingsPanel .item-l b { display: block; font-size: 15px; font-weight: 600; }
      #appSettingsPanel .item-l small { display: block; margin-top: 2px; font-size: 12px; line-height: 1.35; color: #8b909c; }

      /* перемикач */
      #appSettingsPanel .sw {
        flex: none; position: relative; width: 50px; height: 30px; border-radius: 15px; border: 0; padding: 0; cursor: pointer;
        background: rgba(255,255,255,0.14); transition: background .2s ease;
      }
      #appSettingsPanel .sw::after {
        content: ""; position: absolute; top: 3px; left: 3px; width: 24px; height: 24px; border-radius: 50%;
        background: #f4f5f1; box-shadow: 0 2px 6px rgba(0,0,0,.35); transition: transform .2s cubic-bezier(.2,.9,.3,1.2);
      }
      #appSettingsPanel .sw[aria-checked="true"] { background: #ffc93c; }
      #appSettingsPanel .sw[aria-checked="true"]::after { transform: translateX(20px); background: #2a1c00; }

      /* сегменти */
      #appSettingsPanel .seg { display: flex; gap: 4px; margin-top: 10px; padding: 4px; border-radius: 12px; background: rgba(0,0,0,0.28); }
      #appSettingsPanel .opt-btn {
        flex: 1; min-width: 0; padding: 9px 4px; border: 0; border-radius: 9px; cursor: pointer;
        background: transparent; color: #c9cdd6; font: 600 13px 'Inter', system-ui, sans-serif; white-space: nowrap;
        transition: background .15s ease, color .15s ease;
      }
      #appSettingsPanel .opt-btn.active { background: #ffc93c; color: #2a1c00; font-weight: 800; box-shadow: 0 2px 8px rgba(255,201,60,.3); }

      /* живий приклад розміру кнопок керування */
      #appSettingsPanel .ctrl-prev { display: flex; justify-content: center; gap: var(--ctrl-gap, 6px); margin-top: 12px; }
      #appSettingsPanel .ctrl-prev span {
        width: var(--ctrl-size, 58px); height: var(--ctrl-size, 58px); border-radius: 14px; display: grid; place-items: center;
        background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12); transition: width .2s ease, height .2s ease;
      }
      #appSettingsPanel .ctrl-prev svg { width: 40%; height: 40%; fill: none; stroke: #f4f5f1; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }

      #appSettingsPanel .close-btn {
        display: block; width: 100%; margin-top: 4px; padding: 13px; border: 0; border-radius: 14px; cursor: pointer;
        background: #ffc93c; color: #2a1c00; font: 800 15px 'Inter', system-ui, sans-serif;
      }
`;
    document.head.appendChild(style);

    const btn = document.createElement("button");
    btn.id = "appSettingsBtn";
    btn.type = "button";
    btn.title = "Налаштування";
    btn.setAttribute("aria-label", "Налаштування");
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>';

    const sw = (key, title, hint) => `
      <div class="item"><div class="item-h">
        <div class="item-l"><b>${title}</b>${hint ? `<small>${hint}</small>` : ""}</div>
        <button type="button" class="sw" role="switch" data-setting="${key}" aria-label="${title}"></button>
      </div></div>`;
    const seg = (key, title, hint, opts, extra) => `
      <div class="item">
        <div class="item-l"><b>${title}</b>${hint ? `<small>${hint}</small>` : ""}</div>
        <div class="seg" data-setting="${key}">
          ${opts.map(([v, label]) => `<button type="button" class="opt-btn" data-value="${v}">${label}</button>`).join("")}
        </div>${extra || ""}
      </div>`;
    const keys = (obj) => Object.keys(obj).map((k) => [k, k]);
    const arrow = '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>';

    const panel = document.createElement("div");
    panel.id = "appSettingsPanel";
    panel.innerHTML = `
      <div class="box" role="dialog" aria-label="Налаштування">
        <h3><svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>Налаштування</h3>

        <div class="grp"><div class="grp-t">Звук і відгук</div><div class="card">
          ${sw("soundOn", "Звук", "")}
          ${sw("vibrationOn", "Вібрація", "")}
        </div></div>

        <div class="grp"><div class="grp-t">Головна</div><div class="card">
          ${sw("homeSections", "Розділи", "Групувати ігри: аркади, карти, вечірки…")}
        </div></div>

        <div class="grp"><div class="grp-t">Тема світлих ігор</div><div class="card">
          ${seg("gameTheme", "Кольори", "Судоку, 2048, Мемологія, Телефон, Хто я?", [["orig", "Як задумано"], ["dark", "Темна"], ["system", "Як у системі"]])}
        </div></div>

        <div class="grp"><div class="grp-t">Шапка в іграх</div><div class="card">
          ${seg("headerStyle", "Вигляд", "Панель — смуга з фоном. Кнопки — лише кнопки, без смуги.", [["bar", "Панель"], ["float", "Лише кнопки"]])}
          ${seg("headerMargin", "Відступ зверху", "S — впритул до верху екрана", keys(HEADER_MARGINS))}
        </div></div>

        <div class="grp"><div class="grp-t">Керування</div><div class="card">
          ${seg("controlSize", "Розмір кнопок", "Стрілки в Змійці, Тетрісі та інших аркадах", keys(CONTROL_SIZES),
            `<div class="ctrl-prev" aria-hidden="true"><span>${arrow}</span></div>`)}
        </div></div>

        <div class="grp"><div class="grp-t">Графіка</div><div class="card">
          ${seg("graphics", "Якість", WEAK_DEVICE ? "Телефон слабкий, тож «Авто» вмикає легку графіку" : "Легка — без розмиття й важких анімацій, для старих телефонів",
            [["auto", "Авто"], ["full", "Повна"], ["lite", "Легка"]])}
        </div></div>

        <button type="button" class="close-btn" id="appSettingsCloseBtn">Готово</button>
      </div>
    `;

    document.body.appendChild(panel);
    if (isIndexPage) document.body.appendChild(btn);

    function refreshActive() {
      panel.querySelectorAll(".sw").forEach((s) => {
        s.setAttribute("aria-checked", String(current[s.dataset.setting] !== false && current[s.dataset.setting] !== undefined));
      });
      panel.querySelectorAll(".seg").forEach((row) => {
        const value = current[row.dataset.setting];
        row.querySelectorAll(".opt-btn").forEach((b) => b.classList.toggle("active", b.dataset.value === value));
      });
    }

    const open = () => { refreshActive(); panel.classList.add("open"); };
    const close = () => panel.classList.remove("open");
    // Дозволяє іншим модулям (меню профілю в login.js) відкрити цю ж панель.
    window.AppSettings.openPanel = open;

    if (isIndexPage) btn.addEventListener("click", open);
    panel.addEventListener("click", (e) => { if (e.target === panel) close(); });
    document.getElementById("appSettingsCloseBtn").addEventListener("click", close);
    panel.querySelectorAll(".sw").forEach((s) => {
      s.addEventListener("click", () => {
        const key = s.dataset.setting;
        const value = s.getAttribute("aria-checked") !== "true";
        set(key, value);
        if (key === "vibrationOn" && value) testVibrate();
        refreshActive();
      });
    });
    panel.querySelectorAll(".opt-btn").forEach((b) => {
      b.addEventListener("click", () => {
        set(b.closest(".seg").dataset.setting, b.dataset.value);
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