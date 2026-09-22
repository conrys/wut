// ==========================================================================
// Проста реєстрація/логін без Firebase Auth: SHA-256(логін+пароль) звіряється
// з хешем у Firestore (games41_users/{login}). Без відновлення пароля,
// без токенів — сесія тримається просто в localStorage. "Все для своїх".
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

  // Українські назви ігор для сторінки профілю (ключ = ім'я файлу без .html,
  // те саме, що передається в sendScore/getTopScores). Невідома гра просто
  // показується як є, з великої літери.
  const GAME_LABELS = {
    "tetris": "Тетріс",
    "2048": "2048",
    "wordle": "Wordle",
    "sudoku": "Судоку",
    "miner": "Сапер",
    "doodle": "Doodle Jump",
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
    "quiz": "Quiz",
    "draw": "Малювалка",
  };

  function gameLabel(gameName) {
    return GAME_LABELS[gameName] || (gameName.charAt(0).toUpperCase() + gameName.slice(1));
  }

  function medalFor(rank) {
    if (rank === 1) return "🥇";
    if (rank === 2) return "🥈";
    if (rank === 3) return "🥉";
    return `#${rank}`;
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
      .profile-modal { max-width: 340px; max-height: 80vh; overflow-y: auto; }
      .profile-modal h3 { margin-bottom: 2px; }
      .profile-username { color: var(--text-muted, #8b909c); font-size: 13px; margin-bottom: 16px; }
      .trophy-row { display: flex; gap: 8px; margin-bottom: 18px; }
      .trophy {
        flex: 1; background: var(--bg, #14161a); border-radius: var(--radius-md, 14px); padding: 12px 6px;
        text-align: center; border: 1px solid var(--line, rgba(255,255,255,0.08));
      }
      .trophy-icon { display: block; font-size: 22px; margin-bottom: 4px; }
      .trophy-count { font-family: var(--font-display, 'Space Grotesk', sans-serif); font-weight: 700; font-size: 16px; }
      .profile-section-title {
        font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;
        color: var(--text-muted, #8b909c); margin: 0 0 8px;
      }
      .profile-row {
        display: flex; align-items: center; gap: 10px;
        padding: 9px 4px; border-bottom: 1px solid var(--line, rgba(255,255,255,0.06));
        font-size: 14px;
      }
      .profile-row .rank-badge { width: 26px; text-align: center; font-size: 14px; }
      .profile-row .game-name { flex: 1; }
      .profile-row .game-score { font-family: var(--font-display, 'Space Grotesk', sans-serif); font-weight: 700; color: var(--accent, #38cfa0); }
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
        <h3>Мій профіль</h3>
        <div class="profile-username" id="profileUsername"></div>
        <div class="trophy-row">
          <div class="trophy"><span class="trophy-icon">🥇</span><span class="trophy-count" id="goldCount">0</span></div>
          <div class="trophy"><span class="trophy-icon">🥈</span><span class="trophy-count" id="silverCount">0</span></div>
          <div class="trophy"><span class="trophy-icon">🥉</span><span class="trophy-count" id="bronzeCount">0</span></div>
        </div>
        <div class="profile-section-title">Мої рахунки</div>
        <div id="profileGamesList"><div class="records-empty">Завантаження…</div></div>
        <div class="records-close" id="profileCloseBtn">Закрити</div>
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
    menuEl.querySelector("#menuAvatar").textContent = session.username.charAt(0).toUpperCase();
    menuEl.classList.add("open");
  }
  function closeMenu() { menuEl.classList.remove("open"); }

  async function openProfile() {
    const session = getSession();
    if (!session) return;
    profileEl.querySelector("#profileUsername").textContent = session.username;
    profileEl.querySelector("#goldCount").textContent = "0";
    profileEl.querySelector("#silverCount").textContent = "0";
    profileEl.querySelector("#bronzeCount").textContent = "0";
    const listEl = profileEl.querySelector("#profileGamesList");
    listEl.innerHTML = '<div class="records-empty">Завантаження…</div>';
    profileEl.classList.add("open");

    if (!window.AppScore || !window.AppScore.getUserProfile) {
      listEl.innerHTML = '<div class="records-empty">Недоступно</div>';
      return;
    }
    const { trophies, games } = await window.AppScore.getUserProfile(session.username);
    profileEl.querySelector("#goldCount").textContent = trophies.gold;
    profileEl.querySelector("#silverCount").textContent = trophies.silver;
    profileEl.querySelector("#bronzeCount").textContent = trophies.bronze;

    if (!games.length) {
      listEl.innerHTML = '<div class="records-empty">Поки немає жодного рахунку. Зіграй у будь-яку гру!</div>';
      return;
    }
    listEl.innerHTML = games
      .map(
        (g) => `
      <div class="profile-row">
        <span class="rank-badge">${medalFor(g.rank)}</span>
        <span class="game-name">${escapeHtml(gameLabel(g.gameName))}</span>
        <span class="game-score">${g.score}</span>
      </div>`
      )
      .join("");
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
      pillEl.style.background = "var(--accent, #38cfa0)";
      pillEl.style.color = "#0e2318";
    } else {
      pillEl.textContent = "👤";
      pillEl.title = "Увійти";
      pillEl.style.background = "rgba(255, 255, 255, 0.08)";
      pillEl.style.color = "#f4f5f1";
    }
  }

  document.addEventListener("DOMContentLoaded", buildUI);

  window.AppAuth = { getSession, login, register, logout };

  // Автопідключення нотаток (game-notes.js), щоб не додавати
  // окремий <script> тег у кожну гру вручну.
  (function loadGameNotes() {
    if (document.querySelector('script[src$="js/game-notes.js"]')) return;
    var s = document.createElement('script');
    s.src = 'js/game-notes.js';
    document.head.appendChild(s);
  })();
})();