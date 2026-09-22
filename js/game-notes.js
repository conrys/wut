// ==========================================================================
// Спільний модуль "нотаток" (для тестувальників — виглядає як звичайна
// кнопка "залишити нотатку", по суті це bug-report/todo для розробника).
// Пише документи в Firestore-колекцію games41_notes: { gameName, text,
// author, createdAt }. Читає їх сторінка notes.html.
//
// Підключати ПІСЛЯ js/firebase-config.js та js/login.js:
//   <script src="js/game-notes.js"></script>
// (або нічого не підключати вручну — login.js вміє підвантажити цей файл
// сам, якщо туди додано відповідний фрагмент).
//
// Кнопка — плаваюча ⚙-подібна іконка знизу-зліва (position: fixed), як у
// app-settings.js. На ігрових сторінках — bottom:16px (там своєї кнопки
// налаштувань немає). На index.html — bottom:64px, одразу над реальною
// кнопкою ⚙ (яка сидить на bottom:16px), щоб не перекривались.
// ==========================================================================
(function () {
  const NOTES_COLLECTION = "games41_notes";

  // Тримати синхронно зі списком GAME_LABELS у js/login.js.
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

  function currentGameKey() {
    const file = (location.pathname.split("/").pop() || "").replace(/\.html?$/, "");
    return GAME_LABELS[file] ? file : "";
  }

  function requireDb() {
    if (!window.firebaseReady || typeof firebase === "undefined") {
      throw new Error("Немає з'єднання з сервером. Спробуй пізніше.");
    }
    return firebase.firestore();
  }

  async function submitNote(gameKey, text) {
    const session = window.AppAuth && window.AppAuth.getSession();
    if (!session) throw new Error("Спочатку увійди в акаунт (іконка профілю).");
    if (!gameKey) throw new Error("Обери гру зі списку.");
    const clean = (text || "").trim();
    if (!clean) throw new Error("Напиши щось :)");
    const db = requireDb();
    await db.collection(NOTES_COLLECTION).add({
      gameName: gameKey,
      text: clean,
      author: session.username,
      createdAt: Date.now(),
    });
  }

  // ---------------------------- UI ----------------------------
  let modalEl;

  function injectStyles() {
    if (document.getElementById("game-notes-style")) return;
    const style = document.createElement("style");
    style.id = "game-notes-style";
    style.textContent = `
      .notes-fab {
        position: fixed;
        left: 16px;
        z-index: var(--z-sticky, 999);
        width: 40px; height: 40px; border-radius: 50%;
        border: 1px solid var(--line, rgba(255,255,255,0.15));
        background: rgba(30,30,36,0.85);
        color: var(--text, #f0f0f0);
        font-size: 18px; cursor: pointer; touch-action: manipulation;
        display: flex; align-items: center; justify-content: center;
        backdrop-filter: blur(var(--blur-bg, 6px));
        -webkit-backdrop-filter: blur(var(--blur-bg, 6px));
        transition: transform 0.15s ease;
      }
      .notes-fab:active { transform: scale(0.93); }
      /* Ігрові сторінки: своя кнопка налаштувань там не показується (див.
         app-settings.js), тож нотатки займають те саме місце знизу-зліва. */
      .notes-fab--game { bottom: 16px; }
      /* index.html: там уже є плаваюча ⚙ на bottom:16px (40px заввишки) —
         ставимо нотатки одразу над нею з невеликим проміжком. */
      .notes-fab--index { bottom: 64px; }

      .notes-overlay {
        position: fixed; inset: 0;
        background: var(--scrim-strong, rgba(0,0,0,0.82));
        backdrop-filter: blur(var(--blur-panel, 12px));
        -webkit-backdrop-filter: blur(var(--blur-panel, 12px));
        display: none; align-items: center; justify-content: center;
        z-index: var(--z-modal, 9999); padding: 20px;
      }
      .notes-overlay.open { display: flex; }

      .notes-modal {
        background: var(--surface-1, #1c1f2b);
        border: 1px solid var(--line, rgba(255,255,255,0.08));
        border-radius: var(--radius-lg, 20px);
        padding: 20px; width: 100%; max-width: 340px;
        color: var(--text, #f2f1ec);
        font-family: var(--font-body, 'Inter', sans-serif);
      }
      .notes-modal h3 {
        font-family: var(--font-display, 'Space Grotesk', sans-serif);
        margin: 0 0 14px; font-size: 18px;
      }
      .notes-modal select, .notes-modal textarea {
        width: 100%; box-sizing: border-box; margin-bottom: 10px;
        padding: 10px 12px; border-radius: var(--radius-sm, 8px);
        border: 1px solid var(--line, rgba(255,255,255,0.15));
        background: var(--bg, #14161a); color: var(--text, #f2f1ec);
        font-size: 14px; font-family: inherit;
      }
      .notes-modal textarea { resize: vertical; min-height: 80px; }
      .notes-error {
        color: var(--danger, #d97070); font-size: 12px; min-height: 16px; margin-bottom: 4px;
      }
      .notes-modal .row { display: flex; gap: 8px; margin-top: 6px; }
      .notes-modal button {
        flex: 1; border: none; border-radius: var(--radius-sm, 8px); padding: 10px;
        font-weight: 600; font-size: 13px; cursor: pointer; touch-action: manipulation;
      }
      .notes-primary { background: var(--accent, #d9b45c); color: #14161a; }
      .notes-cancel { background: rgba(255,255,255,0.08); color: var(--text, #f2f1ec); }
    `;
    document.head.appendChild(style);
  }

  function buildModal() {
    modalEl = document.createElement("div");
    modalEl.className = "notes-overlay";
    modalEl.innerHTML = `
      <div class="notes-modal">
        <h3>Залишити нотатку</h3>
        <select class="notes-select"></select>
        <textarea class="notes-text" placeholder="Що додати / що не так..."></textarea>
        <div class="notes-error"></div>
        <div class="row">
          <button type="button" class="notes-cancel">Скасувати</button>
          <button type="button" class="notes-primary">Надіслати</button>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);

    const select = modalEl.querySelector(".notes-select");
    Object.keys(GAME_LABELS).forEach((key) => {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = GAME_LABELS[key];
      select.appendChild(opt);
    });
    const guess = currentGameKey();
    if (guess) select.value = guess;

    modalEl.addEventListener("click", (e) => { if (e.target === modalEl) close(); });
    modalEl.querySelector(".notes-cancel").addEventListener("click", close);
    modalEl.querySelector(".notes-primary").addEventListener("click", async () => {
      const errEl = modalEl.querySelector(".notes-error");
      const textEl = modalEl.querySelector(".notes-text");
      errEl.textContent = "";
      try {
        await submitNote(select.value, textEl.value);
        textEl.value = "";
        close();
      } catch (e) {
        errEl.textContent = e.message || "Помилка. Спробуй ще раз.";
      }
    });
  }

  function open() {
    if (!modalEl) buildModal();
    modalEl.querySelector(".notes-error").textContent = "";
    modalEl.classList.add("open");
  }

  function close() {
    if (modalEl) modalEl.classList.remove("open");
  }

  function isIndexPage() {
    const file = (location.pathname.split("/").pop() || "");
    return file === "index.html" || file === "";
  }

  function makeButton() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "notes-fab " + (isIndexPage() ? "notes-fab--index" : "notes-fab--game");
    btn.title = "Залишити нотатку";
    btn.textContent = "📝";
    btn.addEventListener("click", open);
    return btn;
  }

  function mount() {
    if (document.getElementById("gameNotesFab")) return;
    injectStyles();
    const btn = makeButton();
    btn.id = "gameNotesFab";
    document.body.appendChild(btn);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }

  window.AppNotes = { open, close };
})();
