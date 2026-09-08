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

  // ---------------------------- UI ----------------------------
  let pillEl, modalEl;

  function buildUI() {
    const style = document.createElement("style");
    style.textContent = `
      .game-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        padding-top: calc(max(12px, env(safe-area-inset-top)));
        padding-bottom: 12px;
        box-sizing: border-box;
      }
      .game-header .slot-left,
      .game-header .slot-center,
      .game-header .slot-right {
        display: flex;
        align-items: center;
        flex: 1;
      }
      .game-header .slot-left { justify-content: flex-start; }
      .game-header .slot-center { justify-content: center; }
      .game-header .slot-right { justify-content: flex-end; }

      .auth-pill {
        position: static !important;
        width: 36px;
        height: 36px;
        border-radius: 50% !important;
        background: rgba(255, 255, 255, 0.08);
        color: #f4f5f1;
        border: 1px solid rgba(255, 255, 255, 0.15);
        font-family: 'Space Grotesk', sans-serif;
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

      .auth-overlay {
        position: fixed; inset: 0; background: rgba(0,0,0,0.6);
        display: none; align-items: center; justify-content: center;
        z-index: 9999; padding: 20px;
      }
      .auth-overlay.open { display: flex; }
      .auth-modal {
        background: #22252b; border-radius: 16px; padding: 22px;
        width: 100%; max-width: 320px; color: #f4f5f1;
        font-family: 'Inter', sans-serif;
      }
      .auth-modal h3 {
        font-family: 'Space Grotesk', sans-serif; margin: 0 0 14px; font-size: 20px;
      }
      .auth-modal input {
        width: 100%; box-sizing: border-box; margin-bottom: 10px;
        padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15);
        background: #14161a; color: #f4f5f1; font-size: 14px;
      }
      .auth-modal .row { display: flex; gap: 8px; margin-top: 6px; }
      .auth-modal button {
        flex: 1; border: none; border-radius: 8px; padding: 10px;
        font-weight: 600; font-size: 13px; cursor: pointer; touch-action: manipulation;
      }
      .auth-primary { background: #38cfa0; color: #0e2318; }
      .auth-tabs { display: flex; gap: 6px; margin-bottom: 14px; }
      .auth-tab {
        flex: 1; text-align: center; padding: 6px; border-radius: 8px;
        font-size: 12px; font-weight: 600; color: #8b909c; cursor: pointer;
      }
      .auth-tab.active { background: #14161a; color: #38cfa0; }
      .auth-error { color: #ff6b6b; font-size: 12px; min-height: 16px; margin-bottom: 6px; }
      .auth-close { text-align: center; margin-top: 10px; font-size: 12px; color: #8b909c; cursor: pointer; }
    `;
    document.head.appendChild(style);

    function getHeaderSlot(slotName) {
      let header = document.getElementById("gameHeader");
      if (!header) {
        header = document.createElement("div");
        header.id = "gameHeader";
        header.className = "game-header";
        header.innerHTML = `
          <div class="slot-left"></div>
          <div class="slot-center"></div>
          <div class="slot-right"></div>
        `;
        const page = document.querySelector(".page") || document.body;
        page.insertBefore(header, page.firstChild);
      }
      return header.querySelector(`.slot-${slotName}`);
    }

    pillEl = document.createElement("div");
    pillEl.className = "auth-pill";

    const topBar = document.querySelector("#top-bar");
    if (topBar) {
      topBar.appendChild(pillEl);
    } else {
      getHeaderSlot("right").appendChild(pillEl);
    }

    pillEl.addEventListener("click", () => {
      const session = getSession();
      if (session) {
        if (confirm(`Вийти з ${session.username}?`)) logout();
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

    updatePill();
  }

  function openModal() { modalEl.classList.add("open"); }
  function closeModal() { modalEl.classList.remove("open"); }

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
})();