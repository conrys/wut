// ==========================================================================
// Проста реєстрація/логін без Firebase Auth: SHA-256(логін+пароль) звіряється
// з хешем у Firestore (games41_users/{login}). Без відновлення пароля,
// без токенів — сесія тримається просто в localStorage. "Все для своїх".
//
// ОНОВЛЕННЯ:
// - GAME_LABELS тепер єдине джерело правди й публікується як window.GameLabels
//   (раніше той самий список був продубльований у game-notes.js — легко
//   було забути оновити переклад в одній з двох копій). game-notes.js
//   довантажується нижче ПІСЛЯ визначення GAME_LABELS, тож на момент його
//   виконання window.GameLabels уже готовий.
// - "quiz"/"doodle" перекладені (були "Quiz"/"Doodle Jump").
// - Екран "Мій профіль" переписаний: кольоровий аватар за іменем, зведений
//   "рейтинг" одним числом, "#місце з N гравців" замість голого "#N",
//   "N днів тому" для кожного рекорду, підсвічування медальних рядків і
//   секція "Ще не грав" зі списком ігор без жодного рахунку.
// ==========================================================================
(function () {
  const STORAGE_KEY = "games41_session";

  async function sha256Hex(text) {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function normalizeUsername(name) {
    return (name || "").trim().toLowerCase();
  }

  function getSession() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch {
      return null;
    }
  }

  function setSession(username) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ username, loginAt: Date.now() }));
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function requireFirebase() {
    if (!window.firebaseReady || !db) {
      throw new Error("Немає з'єднання з сервером. Спробуй пізніше.");
    }
  }

  async function register(username, password) {
    requireFirebase();
    const uid = normalizeUsername(username);
    if (!uid || !/^[a-z0-9_\-]{3,20}$/.test(uid)) {
      throw new Error("Логін: 3-20 символів, латиниця/цифри/_/-");
    }
    if (!password || password.length < 4) {
      throw new Error("Пароль має бути мін. 4 символи");
    }
    const ref = db.collection(USERS_COLLECTION).doc(uid);
    const snap = await ref.get();
    if (snap.exists) throw new Error("Такий логін вже зайнятий");
    const passwordHash = await sha256Hex(uid + ":" + password);
    await ref.set({ passwordHash, createdAt: Date.now() });
    setSession(uid);
    return uid;
  }

  async function login(username, password) {
    requireFirebase();
    const uid = normalizeUsername(username);
    if (!uid || !password) throw new Error("Введи логін і пароль");
    const ref = db.collection(USERS_COLLECTION).doc(uid);
    const snap = await ref.get();
    if (!snap.exists) throw new Error("Користувача не знайдено");
    const passwordHash = await sha256Hex(uid + ":" + password);
    if (snap.data().passwordHash !== passwordHash) throw new Error("Невірний пароль");
    setSession(uid);
    return uid;
  }

  function logout() {
    clearSession();
    updatePill();
  }

  // Українські назви ігор — ЄДИНА копія на весь застосунок (game-notes.js
  // читає її через window.GameLabels, а не тримає свою). Ключ = ім'я файлу
  // без .html, те саме, що передається в sendScore()/getTopScores().
  const GAME_LABELS = {
    "tetris": "Тетріс",
    "2048": "2048",
    "wordle": "Wordle",
    "sudoku": "Судоку",
    "miner": "Сапер",
    "doodle": "Doodle",
    "soliter": "Косинка",
    "poker": "Покер",
    "snake": "Змійка",
    "spy": "Шпигун",
    "chess": "Шахи",
    "checkers": "Шашки",
    "whoami": "Хто я?",
    "memology": "Мемологія",
    "crocodile": "Крокодил",
    "quiplash": "Сміхлист",
    "mafia": "Мафія",
    "teli": "Зіпсований телефон",
    "quiz": "Квіз",
    "draw": "Малювалка",
  };
  // Невеличкі емодзі-іконки для секції "Ще не грав" у профілі — суто
  // декоративні, щоб список не був голим текстом. Гра без запису тут
  // просто отримує 🎮 за замовчуванням (див. gameIcon()).
  const GAME_ICONS = {
    "tetris": "🧱", "2048": "🔢", "wordle": "🔤", "sudoku": "🔢",
    "miner": "💣", "doodle": "🐸", "soliter": "🃏", "poker": "🃏",
    "snake": "🐍", "spy": "🕵️", "chess": "♟️", "checkers": "🔴",
    "whoami": "❓", "memology": "😂", "crocodile": "🐊", "quiplash": "😆",
    "mafia": "🔪", "teli": "📞", "quiz": "🧠", "draw": "🎨",
  };
  const GAME_ORDER = Object.keys(GAME_LABELS);

  // Соло-ігри з РЕАЛЬНИМ індивідуальним рекордом — тільки вони формують
  // "Мій профіль" (рейтинг/медалі/список/"Ще не грав"). Мультиплеєрні ігри
  // (мафія/шпигун/покер/крокодил/мемологія/quiplash/quiz/малювалка/
  // зіпсований телефон/"Хто я?") свідомо виключені — рекорд там теж можна
  // прикрутити, але це окрема "командна" механіка, яку робитимемо окремо
  // й по-іншому, не як соло-топ. Wordle теж свідомо не тут — у нього власна
  // колекція (games41_wordle_*) і своя механіка стріків, не games41_scores.
  const SCORABLE_GAMES = [
    "tetris", "2048", "sudoku", "miner", "doodle", "soliter", "snake", "chess", "checkers",
  ];

  function gameLabel(gameName) {
    return GAME_LABELS[gameName] || (gameName.charAt(0).toUpperCase() + gameName.slice(1));
  }
  function gameIcon(gameName) {
    return GAME_ICONS[gameName] || "🎮";
  }

  function medalFor(rank) {
    if (rank === 1) return "🥇";
    if (rank === 2) return "🥈";
    if (rank === 3) return "🥉";
    return `#${rank}`;
  }

  // Стабільний колір аватара за іменем — той самий прийом, що вже
  // використовується для кольору змійок у snake-multiplayer.js, тепер і
  // для аватара в профілі/шапці меню.
  const AVATAR_COLORS = ["#38cfa0", "#e0b84c", "#ff6b6b", "#8fb8ff", "#c77dff", "#4dd0e1", "#ffb84d", "#a3e635"];
  function colorForName(name) {
    let hash = 0;
    for (let i = 0; i < String(name).length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[hash % AVATAR_COLORS.length];
  }

  // "3 дні тому" / "учора" / "сьогодні" — без зовнішніх бібліотек,
  // українська плюралізація для найпоширеніших випадків (1/2-4/5+).
  function pluralDays(n) {
    const mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return `${n} день тому`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} дні тому`;
    return `${n} днів тому`;
  }
  function relativeTime(ts) {
    if (!ts) return "";
    const days = Math.floor((Date.now() - ts) / 86400000);
    if (days <= 0) return "сьогодні";
    if (days === 1) return "учора";
    if (days < 30) return pluralDays(days);
    const months = Math.floor(days / 30);
    return months === 1 ? "місяць тому" : `${months} міс. тому`;
  }
  function formatJoinDate(ts) {
    if (!ts) return null;
    const d = new Date(ts);
    return d.toLocaleDateString("uk-UA", { year: "numeric", month: "long" });
  }

  // Зведений "рейтинг профілю" — одне вражаюче число замість трьох дрібних
  // лічильників медалей. Ваги довільні (золото важить найбільше), суто щоб
  // дати екрану одну цифру, якою хочеться похвалитись.
  function computeRating(trophies) {
    return trophies.gold * 3 + trophies.silver * 2 + trophies.bronze * 1;
  }

  // ---------------------------- UI ----------------------------
  let pillEl, modalEl, menuEl, profileEl;

  function buildUI() {
    const style = document.createElement("style");
    style.textContent = `
      .auth-pill {
        position: static !important;
        width: 36px;
        height: 36px;
        border-radius: 50% !important;
        background: rgba(255, 255, 255, 0.08);
        color: var(--text, #f4f5f1);
        border: 1px solid var(--line, rgba(255, 255, 255, 0.15));
        font-family: var(--font-display, 'Space Grotesk', sans-serif);
        font-size: 14px;
        font-weight: 700;
        touch-action: manipulation;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        text-transform: uppercase;
        transition: background 0.2s ease, transform 0.15s ease;
      }
      .auth-pill:active { opacity: 0.7; transform: scale(0.95); }

      #top-bar .auth-pill {
        position: static !important;
        top: auto !important;
        right: auto !important;
      }

      /* ---------- Спільна база для всіх оверлеїв цього модуля ---------- */
      .auth-overlay, .menu-overlay, .profile-overlay {
        position: fixed; inset: 0;
        background: var(--scrim-strong, rgba(0,0,0,0.82));
        backdrop-filter: blur(var(--blur-panel, 12px));
        -webkit-backdrop-filter: blur(var(--blur-panel, 12px));
        display: none; align-items: center; justify-content: center;
        z-index: var(--z-modal, 9999); padding: 20px;
      }
      .auth-overlay.open, .menu-overlay.open, .profile-overlay.open { display: flex; }

      .auth-modal, .menu-card, .profile-modal {
        background: var(--surface-1, #22252b);
        border: 1px solid var(--line, rgba(255,255,255,0.08));
        border-radius: var(--radius-lg, 20px);
        padding: 22px;
        width: 100%; max-width: 320px;
        color: var(--text, #f4f5f1);
        font-family: var(--font-body, 'Inter', sans-serif);
      }
      .auth-modal h3, .profile-modal h3 {
        font-family: var(--font-display, 'Space Grotesk', sans-serif); margin: 0 0 14px; font-size: 20px;
      }
      .auth-modal input {
        width: 100%; box-sizing: border-box; margin-bottom: 10px;
        padding: 10px 12px; border-radius: var(--radius-sm, 8px); border: 1px solid var(--line, rgba(255,255,255,0.15));
        background: var(--bg, #14161a); color: var(--text, #f4f5f1); font-size: 14px;
      }
      .auth-modal .row { display: flex; gap: 8px; margin-top: 6px; }
      .auth-modal button {
        flex: 1; border: none; border-radius: var(--radius-sm, 8px); padding: 10px;
        font-weight: 600; font-size: 13px; cursor: pointer; touch-action: manipulation;
      }
      .auth-primary { background: var(--accent, #38cfa0); color: #0e2318; }
      .auth-tabs { display: flex; gap: 6px; margin-bottom: 14px; }
      .auth-tab {
        flex: 1; text-align: center; padding: 6px; border-radius: var(--radius-sm, 8px);
        font-size: 12px; font-weight: 600; color: var(--text-muted, #8b909c); cursor: pointer;
      }
      .auth-tab.active { background: var(--bg, #14161a); color: var(--accent, #38cfa0); }
      .auth-error { color: var(--danger, #ff6b6b); font-size: 12px; min-height: 16px; margin-bottom: 6px; }
      .auth-close, .menu-close { text-align: center; margin-top: 10px; font-size: 12px; color: var(--text-muted, #8b909c); cursor: pointer; }
      /* Окрема, добре видима кнопка — попередній варіант (дрібний сірий
         текст) на телефоні легко губився й давав замалий тап-таргет. */
      .profile-close {
        display: block; width: 100%; box-sizing: border-box; text-align: center;
        margin-top: 14px; padding: 12px; border-radius: var(--radius-sm, 8px);
        background: rgba(255,255,255,0.08); border: 1px solid var(--line, rgba(255,255,255,0.15));
        color: var(--text, #f4f5f1); font-size: 14px; font-weight: 600;
        cursor: pointer; touch-action: manipulation;
      }
      .profile-close:active { opacity: 0.6; }

      /* ---------- Меню профілю (Мій профіль / Налаштування / Вихід) ---------- */
      .menu-card { max-width: 300px; padding: 16px; }
      .menu-user {
        font-family: var(--font-display, 'Space Grotesk', sans-serif); font-weight: 700; font-size: 15px;
        padding: 4px 6px 14px; border-bottom: 1px solid var(--line, rgba(255,255,255,0.08)); margin-bottom: 10px;
        display: flex; align-items: center; gap: 8px;
      }
      .menu-item {
        display: block; width: 100%; box-sizing: border-box; text-align: left;
        background: rgba(255,255,255,0.05); border: 1px solid var(--line, rgba(255,255,255,0.1));
        color: var(--text, #f4f5f1); border-radius: var(--radius-sm, 8px); padding: 12px 14px; margin-bottom: 8px;
        font-size: 14px; font-weight: 600; cursor: pointer; touch-action: manipulation;
      }
      .menu-item:active { opacity: 0.6; }
      .menu-item-danger { color: var(--danger, #ff6b6b); }

      /* ---------- Мій профіль ---------- */
      .profile-modal { max-width: 400px; max-height: 88vh; overflow-y: auto; }

      .profile-head { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
      .profile-avatar {
        width: 52px; height: 52px; border-radius: 50%; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        font-family: var(--font-display, 'Space Grotesk', sans-serif);
        font-size: 22px; font-weight: 700; color: #0e1013;
      }
      .profile-head-text h3 { margin: 0; }
      .profile-username { color: var(--text-muted, #8b909c); font-size: 13px; }
      .profile-joined { color: var(--text-muted, #8b909c); font-size: 11px; margin-top: 2px; }

      .rating-card {
        display: flex; align-items: center; justify-content: space-between;
        background: linear-gradient(135deg, rgba(217,180,92,0.16), rgba(217,180,92,0.03));
        border: 1px solid rgba(217,180,92,0.35);
        border-radius: var(--radius-md, 14px); padding: 12px 16px; margin-bottom: 14px;
      }
      .rating-card .rating-label { font-size: 12px; color: var(--text-muted, #8b909c); text-transform: uppercase; letter-spacing: 0.04em; }
      .rating-card .rating-value {
        font-family: var(--font-display, 'Space Grotesk', sans-serif); font-weight: 700; font-size: 26px;
        color: var(--accent, #d9b45c);
      }

      /* Wordle — окремо, це стрік днів, а не рекорд/місце в топі, тому
         показуємо лише коли стрік реально є (>0), інакше рядок прихований. */
      .wordle-streak {
        display: flex; align-items: center; gap: 8px;
        background: rgba(255,107,107,0.1); border: 1px solid rgba(255,107,107,0.3);
        border-radius: var(--radius-md, 14px); padding: 10px 14px; margin-bottom: 14px;
        font-size: 13px; font-weight: 600;
      }
      .wordle-streak .wordle-streak-fire { font-size: 16px; }
      .wordle-streak .wordle-streak-value {
        font-family: var(--font-display, 'Space Grotesk', sans-serif); font-weight: 700; color: #ff8a65;
      }

      .trophy-row { display: flex; gap: 8px; margin-bottom: 18px; }
      .trophy {
        flex: 1; background: var(--bg, #14161a); border-radius: var(--radius-md, 14px); padding: 12px 6px;
        text-align: center; border: 1px solid var(--line, rgba(255,255,255,0.08));
      }
      .trophy-icon { display: block; font-size: 22px; margin-bottom: 4px; }
      .trophy-count { font-family: var(--font-display, 'Space Grotesk', sans-serif); font-weight: 700; font-size: 16px; }

      .profile-section-title {
        font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;
        color: var(--text-muted, #8b909c); margin: 18px 0 8px;
      }
      .profile-section-title:first-of-type { margin-top: 0; }

      .profile-row {
        display: flex; align-items: center; gap: 10px;
        padding: 9px 8px; border-radius: var(--radius-sm, 8px); margin-bottom: 4px;
        font-size: 14px; border: 1px solid transparent;
      }
      .profile-row.rank-1 { background: rgba(217,180,92,0.14); border-color: rgba(217,180,92,0.3); }
      .profile-row.rank-2 { background: rgba(190,197,207,0.12); border-color: rgba(190,197,207,0.28); }
      .profile-row.rank-3 { background: rgba(196,132,74,0.12); border-color: rgba(196,132,74,0.28); }
      .profile-row .rank-badge { width: 28px; text-align: center; font-size: 14px; flex-shrink: 0; }
      .profile-row .game-icon { font-size: 16px; flex-shrink: 0; }
      .profile-row .game-info { flex: 1; min-width: 0; }
      .profile-row .game-name { display: block; }
      .profile-row .game-meta { display: block; font-size: 11px; color: var(--text-muted, #8b909c); }
      .profile-row .game-score { font-family: var(--font-display, 'Space Grotesk', sans-serif); font-weight: 700; color: var(--accent, #38cfa0); flex-shrink: 0; }

      .profile-empty { color: var(--text-muted, #8b909c); font-size: 13px; text-align: center; padding: 20px 0; }
      .profile-unplayed { display: flex; flex-wrap: wrap; gap: 8px; }
      .profile-unplayed a {
        display: flex; align-items: center; gap: 6px;
        background: rgba(255,255,255,0.05); border: 1px solid var(--line, rgba(255,255,255,0.1));
        border-radius: 999px; padding: 7px 12px; font-size: 12.5px; font-weight: 600;
        color: var(--text, #f4f5f1); text-decoration: none; touch-action: manipulation;
      }
      .profile-unplayed a:active { opacity: 0.6; }
    `;
    document.head.appendChild(style);

    pillEl = document.createElement("div");
    pillEl.className = "auth-pill";

    const topBar = document.querySelector("#top-bar");
    if (topBar) {
      topBar.appendChild(pillEl);
    } else {
      GameHeader.slot("right").appendChild(pillEl);
    }

    pillEl.addEventListener("click", () => {
      const session = getSession();
      if (session) {
        openMenu();
      } else {
        openModal();
      }
    });

    modalEl = document.createElement("div");
    modalEl.className = "auth-overlay";
    modalEl.innerHTML = `
      <div class="auth-modal">
        <div class="auth-tabs">
          <div class="auth-tab active" data-tab="login">Вхід</div>
          <div class="auth-tab" data-tab="register">Реєстрація</div>
        </div>
        <h3 id="authTitle">Вхід</h3>
        <div class="auth-error" id="authError"></div>
        <input id="authUser" type="text" placeholder="Логін" autocomplete="username" />
        <input id="authPass" type="password" placeholder="Пароль" autocomplete="current-password" />
        <div class="row"><button class="auth-primary" id="authSubmit">Увійти</button></div>
        <div class="auth-close" id="authCloseBtn">Закрити</div>
      </div>
    `;
    document.body.appendChild(modalEl);

    let mode = "login";
    const errEl = modalEl.querySelector("#authError");
    const titleEl = modalEl.querySelector("#authTitle");
    const submitBtn = modalEl.querySelector("#authSubmit");
    const userInput = modalEl.querySelector("#authUser");
    const passInput = modalEl.querySelector("#authPass");

    modalEl.querySelectorAll(".auth-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        mode = tab.dataset.tab;
        modalEl.querySelectorAll(".auth-tab").forEach((t) => t.classList.toggle("active", t === tab));
        titleEl.textContent = mode === "login" ? "Вхід" : "Реєстрація";
        submitBtn.textContent = mode === "login" ? "Увійти" : "Зареєструватись";
        errEl.textContent = "";
      });
    });

    modalEl.querySelector("#authCloseBtn").addEventListener("click", closeModal);
    modalEl.addEventListener("click", (e) => { if (e.target === modalEl) closeModal(); });

    submitBtn.addEventListener("click", async () => {
      errEl.textContent = "";
      submitBtn.disabled = true;
      try {
        if (mode === "login") await login(userInput.value, passInput.value);
        else await register(userInput.value, passInput.value);
        userInput.value = "";
        passInput.value = "";
        closeModal();
        updatePill();
      } catch (e) {
        errEl.textContent = e.message || "Помилка";
      } finally {
        submitBtn.disabled = false;
      }
    });

    // ---------------------- Меню профілю ----------------------
    menuEl = document.createElement("div");
    menuEl.className = "menu-overlay";
    menuEl.innerHTML = `
      <div class="menu-card">
        <div class="menu-user"><span id="menuAvatar">👤</span> <span id="menuUsername"></span></div>
        <button type="button" class="menu-item" data-action="profile">🏆 Мій профіль</button>
        <button type="button" class="menu-item" data-action="settings">⚙ Налаштування</button>
        <button type="button" class="menu-item menu-item-danger" data-action="logout">🚪 Вихід</button>
        <div class="menu-close" id="menuCloseBtn">Закрити</div>
      </div>
    `;
    document.body.appendChild(menuEl);
    menuEl.addEventListener("click", (e) => { if (e.target === menuEl) closeMenu(); });
    menuEl.querySelector("#menuCloseBtn").addEventListener("click", closeMenu);
    menuEl.querySelectorAll(".menu-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.action;
        closeMenu();
        if (action === "profile") openProfile();
        else if (action === "settings") {
          if (window.AppSettings && window.AppSettings.openPanel) window.AppSettings.openPanel();
        } else if (action === "logout") {
          const session = getSession();
          if (session && confirm(`Вийти з ${session.username}?`)) logout();
        }
      });
    });

    // ---------------------- Мій профіль ----------------------
    profileEl = document.createElement("div");
    profileEl.className = "profile-overlay";
    profileEl.innerHTML = `
      <div class="profile-modal">
        <div class="profile-head">
          <div class="profile-avatar" id="profileAvatar"></div>
          <div class="profile-head-text">
            <h3 id="profileUsername"></h3>
            <div class="profile-joined" id="profileJoined"></div>
          </div>
        </div>
        <div class="rating-card">
          <span class="rating-label">Рейтинг профілю</span>
          <span class="rating-value" id="profileRating">0</span>
        </div>
        <div class="trophy-row">
          <div class="trophy"><span class="trophy-icon">🥇</span><span class="trophy-count" id="goldCount">0</span></div>
          <div class="trophy"><span class="trophy-icon">🥈</span><span class="trophy-count" id="silverCount">0</span></div>
          <div class="trophy"><span class="trophy-icon">🥉</span><span class="trophy-count" id="bronzeCount">0</span></div>
        </div>
        <div class="profile-section-title">Мої рахунки</div>
        <div id="profileGamesList"><div class="profile-empty">Завантаження…</div></div>
        <div class="profile-section-title" id="profileUnplayedTitle" style="display:none;">Ще не грав</div>
        <div class="profile-unplayed" id="profileUnplayedList"></div>
        <button type="button" class="profile-close" id="profileCloseBtn">Закрити</button>
      </div>
    `;
    document.body.appendChild(profileEl);
    profileEl.addEventListener("click", (e) => { if (e.target === profileEl) closeProfile(); });
    profileEl.querySelector("#profileCloseBtn").addEventListener("click", closeProfile);

    updatePill();
  }

  function openModal() { modalEl.classList.add("open"); }
  function closeModal() { modalEl.classList.remove("open"); }

  function openMenu() {
    const session = getSession();
    if (!session) return;
    menuEl.querySelector("#menuUsername").textContent = session.username;
    const av = menuEl.querySelector("#menuAvatar");
    av.textContent = session.username.charAt(0).toUpperCase();
    av.style.background = colorForName(session.username);
    av.style.borderRadius = "50%";
    av.style.display = "inline-flex";
    av.style.alignItems = "center";
    av.style.justifyContent = "center";
    av.style.width = "22px";
    av.style.height = "22px";
    av.style.fontSize = "12px";
    av.style.color = "#0e1013";
    menuEl.classList.add("open");
  }
  function closeMenu() { menuEl.classList.remove("open"); }

  async function openProfile() {
    const session = getSession();
    if (!session) return;

    const avatarEl = profileEl.querySelector("#profileAvatar");
    avatarEl.textContent = session.username.charAt(0).toUpperCase();
    avatarEl.style.background = colorForName(session.username);

    profileEl.querySelector("#profileUsername").textContent = session.username;
    profileEl.querySelector("#profileJoined").textContent = "";
    profileEl.querySelector("#profileRating").textContent = "0";
    profileEl.querySelector("#goldCount").textContent = "0";
    profileEl.querySelector("#silverCount").textContent = "0";
    profileEl.querySelector("#bronzeCount").textContent = "0";
    const listEl = profileEl.querySelector("#profileGamesList");
    const unplayedTitleEl = profileEl.querySelector("#profileUnplayedTitle");
    const unplayedListEl = profileEl.querySelector("#profileUnplayedList");
    listEl.innerHTML = '<div class="profile-empty">Завантаження…</div>';
    unplayedTitleEl.style.display = "none";
    unplayedListEl.innerHTML = "";
    profileEl.classList.add("open");

    if (!window.AppScore || !window.AppScore.getUserProfile) {
      listEl.innerHTML = '<div class="profile-empty">Недоступно</div>';
      return;
    }
    const { trophies, games, joinedAt } = await window.AppScore.getUserProfile(session.username, SCORABLE_GAMES);

    profileEl.querySelector("#goldCount").textContent = trophies.gold;
    profileEl.querySelector("#silverCount").textContent = trophies.silver;
    profileEl.querySelector("#bronzeCount").textContent = trophies.bronze;
    profileEl.querySelector("#profileRating").textContent = computeRating(trophies);

    const joinedLabel = formatJoinDate(joinedAt);
    profileEl.querySelector("#profileJoined").textContent = joinedLabel ? `У грі з ${joinedLabel}` : "";

    if (!games.length) {
      listEl.innerHTML = '<div class="profile-empty">Поки немає жодного рахунку. Зіграй у будь-яку гру!</div>';
    } else {
      listEl.innerHTML = games
        .map((g) => {
          const rankClass = g.rank <= 3 ? ` rank-${g.rank}` : "";
          const meta = g.total > 1 ? `з ${g.total} гравців` : "поки єдиний результат";
          const when = relativeTime(g.ts);
          return `
        <div class="profile-row${rankClass}">
          <span class="rank-badge">${medalFor(g.rank)}</span>
          <span class="game-icon">${gameIcon(g.gameName)}</span>
          <span class="game-info">
            <span class="game-name">${escapeHtml(gameLabel(g.gameName))}</span>
            <span class="game-meta">${escapeHtml(meta)}${when ? " · " + escapeHtml(when) : ""}</span>
          </span>
          <span class="game-score">${g.score}</span>
        </div>`;
        })
        .join("");
    }

    // "Ще не грав" — усі відомі ігри мінус ті, де вже є рахунок.
    const playedKeys = new Set(games.map((g) => g.gameName));
    const unplayed = SCORABLE_GAMES.filter((key) => !playedKeys.has(key));
    if (unplayed.length) {
      unplayedTitleEl.style.display = "";
      unplayedListEl.innerHTML = unplayed
        .map((key) => `<a href="${key}.html">${gameIcon(key)} ${escapeHtml(gameLabel(key))}</a>`)
        .join("");
    }
  }
  function closeProfile() { profileEl.classList.remove("open"); }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function updatePill() {
    if (!pillEl) return;
    const session = getSession();
    if (session) {
      pillEl.textContent = session.username.charAt(0).toUpperCase();
      pillEl.title = session.username;
      pillEl.style.background = colorForName(session.username);
      pillEl.style.color = "#0e1013";
    } else {
      pillEl.textContent = "👤";
      pillEl.title = "Увійти";
      pillEl.style.background = "rgba(255, 255, 255, 0.08)";
      pillEl.style.color = "#f4f5f1";
    }
  }

  document.addEventListener("DOMContentLoaded", buildUI);

  window.AppAuth = { getSession, login, register, logout };
  // Спільний словник назв/іконок ігор — game-notes.js (і будь-що інше)
  // читає звідси, замість тримати власну копію GAME_LABELS.
  window.GameLabels = { GAME_LABELS, GAME_ORDER, gameLabel, gameIcon };

  // Автопідключення нотаток (game-notes.js), щоб не додавати
  // окремий <script> тег у кожну гру вручну. Підвантажується ПІСЛЯ того,
  // як window.GameLabels уже визначений вище.
  (function loadGameNotes() {
    if (document.querySelector('script[src$="js/game-notes.js"]')) return;
    var s = document.createElement('script');
    s.src = 'js/game-notes.js';
    document.head.appendChild(s);
  })();
})();