// ==========================================================================
// Спільний модуль "нотаток" (для тестувальників — виглядає як звичайна
// кнопка "залишити нотатку", по суті це bug-report/todo для розробника).
// Пише документи в Firestore-колекцію games41_notes: { gameName, text,
// author, createdAt }. Читає їх сторінка notes.html.
//
// Підключати ПІСЛЯ js/firebase-config.js та js/login.js:
//   <script src="js/game-notes.js"></script>
// (або нічого не підключати вручну — login.js вміє підвантажити цей файл
// сам, якщо туди додано відповідний фрагмент — саме так це й зроблено).
//
// ОНОВЛЕННЯ:
// - Іконка 📝 → 🐛 (зрозуміліше сигналізує "звіт про баг/нотатку", а не
//   "нотатка для себе").
// - Кнопка більше НЕ floating (position: fixed знизу-зліва) — раніше вона
//   стояла на тих самих координатах, що й refresh-button.js (left:16,
//   bottom:16), і в частині ігор перекривала ігрові контроли внизу екрана
//   (шашки/сапер/покер/змійка тощо). Тепер вона докована в той самий
//   #gameHeader/#top-bar, де вже сидять кнопка "Назад" і аватар профілю —
//   це зона, куди жодна гра нічого свого не малює, тож перекриття
//   структурно неможливе.
// - Список ігор у селекті береться з window.GameLabels (визначається в
//   login.js) замість власної копії GAME_LABELS — один словник на весь
//   застосунок, менше шансів забути оновити переклад в одному з двох місць.
// ==========================================================================
(function () {
  const NOTES_COLLECTION = "games41_notes";

  function gameLabels() {
    return (window.GameLabels && window.GameLabels.GAME_LABELS) || {};
  }

  function currentGameKey() {
    const file = (location.pathname.split("/").pop() || "").replace(/\.html?$/, "");
    return gameLabels()[file] ? file : "";
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
      /* Кнопка тепер докована в #gameHeader/#top-bar (position: static),
         той самий розмір/стиль, що й .auth-pill у login.js, аби виглядала
         частиною тієї ж групи іконок, а не окремим стороннім елементом. */
      .notes-header-btn {
        position: static;
        margin: 0 8px; /* .slot-center і #top-bar не завжди мають свій gap між дітьми — без цього кнопка тулиться впритул до сусіда */
        width: 36px; height: 36px; border-radius: 50%;
        border: 1px solid var(--line, rgba(255,255,255,0.15));
        background: rgba(255,255,255,0.08);
        color: var(--text, #f4f5f1);
        font-size: 16px; cursor: pointer; touch-action: manipulation;
        display: inline-flex; align-items: center; justify-content: center;
        flex-shrink: 0;
        transition: transform 0.15s ease;
      }
      .notes-header-btn:active { transform: scale(0.93); }

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
    const labels = gameLabels();
    Object.keys(labels).forEach((key) => {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = labels[key];
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

  // SVG наданий користувачем (bug.svg) — fill замінено на currentColor,
  // щоб іконка підхоплювала колір кнопки (var(--text)) і однаково виглядала
  // і у світлій, і в темній темі, замість зашитого #ffffff з оригіналу.
  const BUG_ICON_SVG = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path fill-rule="evenodd" clip-rule="evenodd" d="M17.3859 2.64323C17.7411 2.43012 17.8562 1.96943 17.6431 1.61424C17.43 1.25906 16.9693 1.14388 16.6141 1.35699L14.2687 2.76426C13.582 2.43471 12.8126 2.25011 12 2.25011C11.1874 2.25011 10.418 2.43471 9.73131 2.76426L7.38587 1.35699C7.03069 1.14388 6.56999 1.25906 6.35688 1.61424C6.14377 1.96943 6.25894 2.43012 6.61413 2.64323L8.37676 3.70081C7.37449 4.65692 6.75 6.00559 6.75 7.50011V7.79077C6.49339 7.92641 6.25088 8.08518 6.02526 8.2643C5.95652 8.19683 5.87356 8.14157 5.77854 8.10356L3.77854 7.30356C3.39396 7.14973 2.95748 7.33679 2.80364 7.72137C2.64981 8.10596 2.83687 8.54244 3.22146 8.69628L4.99257 9.40472C4.52263 10.1351 4.25 11.0045 4.25 11.9376V13.2501H2C1.58579 13.2501 1.25 13.5859 1.25 14.0001C1.25 14.4143 1.58579 14.7501 2 14.7501H4.25V15.0001C4.25 16.2791 4.55983 17.4858 5.10854 18.5491L3.22146 19.304C2.83687 19.4578 2.64981 19.8943 2.80364 20.2789C2.95748 20.6634 3.39396 20.8505 3.77854 20.6967L5.77854 19.8967C5.83233 19.8752 5.88225 19.8481 5.92792 19.8164C7.34764 21.6039 9.53996 22.7501 12 22.7501C14.46 22.7501 16.6524 21.6039 18.0721 19.8164C18.1177 19.8481 18.1677 19.8752 18.2215 19.8967L20.2215 20.6967C20.606 20.8505 21.0425 20.6634 21.1964 20.2789C21.3502 19.8943 21.1631 19.4578 20.7785 19.304L18.8915 18.5491C19.4402 17.4858 19.75 16.2791 19.75 15.0001V14.7501H22C22.4142 14.7501 22.75 14.4143 22.75 14.0001C22.75 13.5859 22.4142 13.2501 22 13.2501H19.75V11.9376C19.75 11.0045 19.4774 10.1351 19.0074 9.40472L20.7785 8.69628C21.1631 8.54244 21.3502 8.10596 21.1964 7.72137C21.0425 7.33679 20.606 7.14973 20.2215 7.30356L18.2215 8.10356C18.1264 8.14157 18.0435 8.19683 17.9747 8.2643C17.7491 8.08518 17.5066 7.92641 17.25 7.79077V7.50011C17.25 6.00559 16.6255 4.65692 15.6232 3.70081L17.3859 2.64323ZM5.75 15.0001V11.9376C5.75 10.1772 7.17709 8.75011 8.9375 8.75011H15.0625C16.8229 8.75011 18.25 10.1772 18.25 11.9376V15.0001C18.25 18.1981 15.8482 20.8351 12.75 21.2056V15.0001C12.75 14.5859 12.4142 14.2501 12 14.2501C11.5858 14.2501 11.25 14.5859 11.25 15.0001V21.2056C8.15183 20.8351 5.75 18.1981 5.75 15.0001ZM12 3.75011C14.0037 3.75011 15.6404 5.32165 15.7447 7.2994C15.522 7.26693 15.2942 7.25011 15.0625 7.25011H8.9375C8.70578 7.25011 8.47799 7.26693 8.25528 7.2994C8.35958 5.32165 9.99627 3.75011 12 3.75011Z" fill="currentColor"/>
    </svg>`;

  function makeButton() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "notes-header-btn";
    btn.title = "Залишити нотатку";
    btn.innerHTML = BUG_ICON_SVG;
    btn.addEventListener("click", open);
    return btn;
  }

  function mount() {
    if (document.getElementById("gameNotesFab")) return;
    injectStyles();
    const btn = makeButton();
    btn.id = "gameNotesFab";

    // Той самий вибір місця, що й у login.js для аватара: якщо на сторінці
    // є власний #top-bar (index.html) — туди. На ігрових сторінках — у слот
    // "center" спільного #gameHeader, ОДРАЗУ ПРАВОРУЧ від кнопки "Рекорди"
    // (не в "right" — там сидить лише аватар логіну, і два круглі елементи
    // впритул один до одного виглядали затісно/неохайно).
    const topBar = document.querySelector("#top-bar");
    if (topBar) {
      // На index.html #top-bar уже містить фільтри (Всі/Соло/2-10/Хост) і
      // аватар логіну (.auth-pill, ставиться в login.js). Хочемо саме
      // "ліворуч від аватара", а не "в кінці бару" (інакше кнопка виринає
      // ПІСЛЯ аватара, впритул до нього) — тому шукаємо аватар явно і
      // вставляємо перед ним; якщо його раптом ще нема в DOM, просто
      // додаємо в кінець як безпечний запасний варіант.
      const pill = topBar.querySelector(".auth-pill");
      if (pill) topBar.insertBefore(btn, pill);
      else topBar.appendChild(btn);
    } else if (window.GameHeader && window.GameHeader.slot) {
      window.GameHeader.slot("center").appendChild(btn);
    } else {
      // Запобіжник на випадок сторінки без хедера взагалі — краще плаваюча
      // кнопка внизу, ніж кнопка, що ніде не з'явиться.
      btn.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:999;";
      document.body.appendChild(btn);
      return;
    }
  }

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }
  // GameHeader/login.js будують хедер по DOMContentLoaded — монтуємось
  // одразу за ними в тій самій черзі подій, тож слот "right" уже існує.
  ready(mount);

  window.AppNotes = { open, close };
})();