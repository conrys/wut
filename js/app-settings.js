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

  const DEFAULTS = { headerMargin: "M", controlSize: "M", soundOn: true };

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
    persist();
    apply();
    document.dispatchEvent(new CustomEvent("appsettingschange", { detail: { key, value, settings: get() } }));
  }

  function isSoundOn() {
    return current.soundOn !== false;
  }

  window.AppSettings = {
    get,
    set,
    isSoundOn,
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
        left: 12px;
        bottom: 12px;
        z-index: 999;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, 0.15);
        background: rgba(30, 30, 36, 0.85);
        color: #f0f0f0;
        font-size: 18px;
        line-height: 1;
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
        <button type="button" class="close-btn">Готово</button>
      </div>
    `;

    document.body.appendChild(btn);
    document.body.appendChild(panel);

    function refreshActive() {
      panel.querySelectorAll(".row").forEach((row) => {
        const key = row.dataset.setting;
        const value = key === "soundOn" ? (isSoundOn() ? "on" : "off") : current[key];
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
    panel.querySelectorAll(".opt-btn").forEach((b) => {
      b.addEventListener("click", () => {
        const key = b.closest(".row").dataset.setting;
        const value = key === "soundOn" ? b.dataset.value === "on" : b.dataset.value;
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
