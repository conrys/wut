// ==========================================================================
// Кнопка «❓» + модалка з правилами гри. Контент — окремий блок тексту на
// кожну гру в HELP_CONTENT нижче, ключ — те саме ім'я гри, що дає
// currentGameName() в records.js (з імені файлу: tetris.html -> 'tetris').
//
// Якщо для поточної гри нема запису в HELP_CONTENT — кнопка просто не
// з'являється (нічого не ламається на сторінках, для яких текст ще не
// написаний).
//
// Підключати ТІЛЬКИ на сторінках ігор, після records.js, перед back-button.js.
// Щоб додати правила для ще однієй гри — допиши сюди ще один ключ.
// ==========================================================================
(function () {
  const HELP_CONTENT = {
    sudoku: {
      title: "Правила · Судоку",
      html: `
        <p>Заповни поле цифрами 1–9 так, щоб у кожному рядку, кожній колонці
        і кожному квадраті 3×3 кожна цифра зустрічалась рівно один раз.</p>
        <p><b>Керування:</b> тап по клітинці → тап по цифрі внизу. Стрілки на
        клавіатурі теж працюють. «💡 Підказка» відкриває правильну цифру в
        обраній клітинці, але коштує як помилка.</p>
        <p><b>Як рахуються очки:</b></p>
        <p class="help-formula">База складності − (час, сек × 2) − (помилки × 40)</p>
        <p>Мінімум — 50 очок. База: Легко — 1400, Середньо — 2000, Важко — 2800.</p>
        <p>Тобто чим швидше і без помилок пройдеш — тим вищий рахунок. У
        рекордах (як і в інших іграх) зберігається лише твій кращий результат.</p>
      `,
    },
    miner: {
      title: "Правила · Мінер",
      html: `
        <p>Класичний Мінер. Відкривай клітинки, уникаючи мін. Цифра на
        відкритій клітинці показує, скільки мін серед 8 сусідніх.
        Порожня клітинка (без цифри) автоматично відкриває всіх сусідів
        по ланцюжку.</p>
        <p><b>Керування:</b> тап — відкрити клітинку. Довге натискання
        (або тумблер «🚩 Режим прапорця» внизу) — поставити/зняти прапорець
        на підозрілій клітинці.</p>
        <p>Перший тап завжди безпечний — міни розставляються вже після
        нього, оминаючи цю клітинку і сусідів.</p>
        <p><b>Як рахуються очки:</b></p>
        <p class="help-formula">База складності − (час, сек × 3)</p>
        <p>Мінімум — 50 очок. База: Легко — 1000, Середньо — 1700, Важко — 2400.</p>
      `,
    },
    // tetris: { title: "...", html: "..." },
    // "2048": { title: "...", html: "..." },
    // wordle: { title: "...", html: "..." },
    // snake:  { title: "...", html: "..." },
  };

  function currentGameName() {
    const file = window.location.pathname.split("/").pop() || "";
    return file.replace(/\.html?$/i, "");
  }

  function buildUI() {
    const gameName = currentGameName();
    const content = HELP_CONTENT[gameName];
    if (!content) return; // немає тексту для цієї гри — кнопку не показуємо

    const style = document.createElement("style");
    style.textContent = `
      .help-btn {
        position: fixed; bottom: 16px; right: 16px; z-index: 9998;
        width: 40px; height: 40px; border-radius: 50%;
        background: rgba(0,0,0,0.5); color: #f4f5f1;
        border: 1px solid rgba(255,255,255,0.15);
        font-family: 'Inter', sans-serif; font-size: 16px; font-weight: 700;
        display: flex; align-items: center; justify-content: center;
        touch-action: manipulation; cursor: pointer;
      }
      .help-btn:active { opacity: 0.6; }
      .help-overlay {
        position: fixed; inset: 0; background: rgba(0,0,0,0.6);
        display: none; align-items: center; justify-content: center;
        z-index: 9999; padding: 20px;
      }
      .help-overlay.open { display: flex; }
      .help-modal {
        background: #22252b; border-radius: 16px; padding: 22px;
        width: 100%; max-width: 340px; max-height: 75vh; overflow-y: auto;
        color: #f4f5f1; font-family: 'Inter', sans-serif;
      }
      .help-modal h3 {
        font-family: 'Space Grotesk', sans-serif; margin: 0 0 12px; font-size: 18px;
      }
      .help-modal p { font-size: 13px; line-height: 1.5; color: #d6d8db; margin: 0 0 10px; }
      .help-modal .help-formula {
        font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 14px;
        color: #38cfa0; background: #14161a; border-radius: 8px; padding: 8px 10px;
      }
      .help-close { text-align: center; margin-top: 6px; font-size: 12px; color: #8b909c; cursor: pointer; }
    `;
    document.head.appendChild(style);

    const btn = document.createElement("button");
    btn.className = "help-btn";
    btn.textContent = "❓";
    btn.setAttribute("aria-label", "Правила гри");
    document.body.appendChild(btn);

    const overlay = document.createElement("div");
    overlay.className = "help-overlay";
    overlay.innerHTML = `
      <div class="help-modal">
        <h3>${content.title}</h3>
        ${content.html}
        <div class="help-close" id="helpCloseBtn">Закрити</div>
      </div>
    `;
    document.body.appendChild(overlay);

    btn.addEventListener("click", () => overlay.classList.add("open"));
    overlay.querySelector("#helpCloseBtn").addEventListener("click", () => overlay.classList.remove("open"));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.remove("open"); });
  }

  document.addEventListener("DOMContentLoaded", buildUI);
})();
