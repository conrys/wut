// ==========================================================================
// Кнопка «?» + модалка з правилами гри. Контент — окремий блок тексту на
// кожну гру в HELP_CONTENT нижче, ключ — те саме ім'я гри, що дає
// currentGameName() в records.js (з імені файлу: tetris.html -> 'tetris').
//
// Якщо для поточної гри нема запису в HELP_CONTENT — кнопка просто не
// з'являється (нічого не ламається на сторінках, для яких текст ще не
// написаний).
//
// Підключати ТІЛЬКИ на сторінках ігор, після records.js, перед back-button.js.
// Щоб додати правила для ще однієї гри — допиши сюди ще один ключ.
// ==========================================================================
(function () {
  const HELP_CONTENT = {
    sudoku: {
      title: "Правила · Судоку",
      html: `
        <p>Заповни поле цифрами 1–9 так, щоб у кожному рядку, кожній колонці
        і кожному квадраті 3×3 кожна цифра зустрічалась рівно один раз.</p>
        <p><b>Керування:</b> тап по клітинці → тап по цифрі внизу. Стрілки на
        клавіатурі теж працюють. «Підказка» відкриває правильну цифру в
        обраній клітинці, але коштує як помилка.</p>
        <p><b>Як рахуються очки:</b></p>
        <p class="help-formula">База складності − (час, сек × 2) − (помилки × 40)</p>
        <p>Мінімум — 50 очок. База: Легко — 1400, Середньо — 2000, Важко — 2800.</p>
        <p>Тобто чим швидше і без помилок пройдеш — тим вищий рахунок. У
        рекордах (як і в інших іграх) зберігається лише твій кращий результат.</p>
      `,
    },
    miner: {
      title: "Правила · Сапер",
      html: `
        <p>Класичний Сапер. Відкривай клітинки, уникаючи мін. Цифра на
        відкритій клітинці показує, скільки мін серед 8 сусідніх.
        Порожня клітинка (без цифри) автоматично відкриває всіх сусідів
        по ланцюжку.</p>
        <p><b>Керування:</b> тап — відкрити клітинку. Довге натискання
        (або тумблер «Прапорці» внизу) — поставити/зняти прапорець
        на підозрілій клітинці.</p>
        <p>Перший тап завжди безпечний — міни розставляються вже після
        нього, оминаючи цю клітинку і сусідів.</p>
        <p><b>Як рахуються очки:</b></p>
        <p class="help-formula">База складності − (час, сек × 3)</p>
        <p>Мінімум — 50 очок. База: Легко — 1000, Середньо — 1700, Важко — 2400.</p>
      `,
    },
    roulette: {
      title: "Правила · Рулетка",
      html: `
        <p>Європейська рулетка: 37 номерів (0–36), одне зеро. Фішки
        віртуальні, без грошей — на старті 1000.</p>
        <p><b>Ставки:</b> обери номінал фішки внизу й торкайся полів столу.
        Ставити можна на кілька полів одразу. «Назад» знімає останню фішку,
        «Повторити» — ставки минулого оберту, «×2» — подвоює всі.</p>
        <p><b>Виплати:</b> номер — 35:1; дюжина (1–12, 13–24, 25–36) чи
        колонка «2:1» — 2:1; червоне/чорне, парне/непарне, 1–18/19–36 — 1:1.
        Зеро програє всі ставки, крім ставки на 0.</p>
        <p><b>Рекорд</b> — найбільший баланс, який у тебе був. Якщо фішки
        закінчились — можна взяти ще 1000, рекорд не зникне.</p>
      `,
    },
    soliter: {
      title: "Правила · Косинка",
      html: `
        <p>Класична Косинка (Klondike). Мета — зібрати всі 52 карти у 4
        фундаменти зверху, по кожній масті окремо, від Туза до Короля.</p>
        <p><b>Стовпці:</b> карти складаються за спаданням рангу з
        чергуванням кольору (червона на чорну і навпаки). На порожній стовпець можна класти лише
        Короля. Перетягувати можна одну карту або цілу валідну
        послідовність.</p>
        <p><b>Сток/відбій:</b> тап по закритій колоді відкриває карти у
        відбій. Коли колода закінчується — відбій перевертається назад.
        Верхню карту з бази можна перетягнути назад у стовпець.</p>
        <p><b>Складність:</b> «Легко» — по 1 карті, роздачі, що йдуть майже
        прямо; «Норм» — по 1, звичайна випадкова роздача; «Складно» — по 3
        карти і заплутаніші роздачі. Чим складніше — тим більше очок.</p>
        <p>Колода тасується чесно, але кожну роздачу перед грою розв'язує
        солвер — виграти її точно можна. <b>Підказка</b> показує
        наступний хід на шляху до перемоги (кожна мінус 100 очок). Якщо
        ходами заведеш гру в глухий кут — гра про це скаже: скасуй кілька
        ходів або почни нову.</p>
        <p><b>Як рахуються очки:</b></p>
        <p class="help-formula">3000 − (час, сек × 2) − кількість ходів</p>
        <p>Мінімум — 50 очок.</p>
      `,
    },
    crocodile: {
      title: "Правила · Крокодил",
      html: `
        <p>Один телефон передається по колу. Гравець, у кого телефон,
        бачить слово й показує його жестами (без слів!) або пояснює
        описово — залежно від того, як домовитесь. Решта вгадує вголос.</p>
        <p><b>Керування:</b> вгадали слово — тисни «Вгадали!», одразу
        з'явиться нове. Важко/незручно — «⏭ Пропустити», теж без штрафу.</p>
        <p>Коли час раунду вийде — рахунок раунду додається до загального,
        і телефон передається далі.</p>
        <p>Рекорд — сумарна кількість вгаданих слів за всю гру (усі
        раунди разом), зберігається як звичайний рахунок.</p>
      `,
    },
    horde: {
      title: "Правила · Орда",
      html: `
        <p>Протримайся 15 хвилин проти орди нечисті. На 15:00 приходить Демон —
        здолай його, і це перемога.</p>
        <p><b>Керування:</b> тягни пальцем будь-де на екрані — з'явиться
        джойстик. На ПК — WASD або стрілки, пробіл — пауза. Зброя б'є сама.</p>
        <p><b>Рівні:</b> збирай кристали — на кожному рівні обираєш нову зброю
        або посилення (до 6 зброї і 6 пасивок).</p>
        <p><b>Еволюції:</b> зброя 8 рівня + потрібна пасивка → у скрині з боса
        чи еліти зброя перетворюється на значно сильнішу. Яка пасивка потрібна —
        видно в паузі.</p>
        <p><b>Лікування:</b> ламай ящики — з них часто падає зілля здоров'я (+30).
        Фонтан лікує, поки стоїш у її колі. Пасивка «Чаша життя» і «Відновлення» в
        крамниці дають постійну регенерацію.</p>
        <p><b>Точки інтересу</b> (за екраном показує стрілка): вівтар — простій у колі
        4 с і отримай скриню; обеліск виклику — торкнись, і 25 с орда вдвічі густіша,
        вижив — скриня, золото й зілля.</p>
        <p><b>Золото:</b> монети з ворогів і бонус за кожен забіг. За нього — нові
        герої та постійні посилення в Крамниці. Прогрес зберігається на телефоні.</p>
        <p class="help-formula">Рахунок = секунди × 10 + вбиті вороги (+5000 за перемогу)</p>
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
    if (!content) return;

    const style = document.createElement("style");
    style.textContent = `
      .help-btn {
        position: fixed; bottom: 16px; right: 16px; z-index: 9998;
        width: 40px; height: 40px; border-radius: 50%; padding: 0;
        background: rgba(10,12,20,0.6); color: #f4f5f1;
        border: 1px solid rgba(255,255,255,0.2); box-shadow: 0 4px 14px rgba(0,0,0,.35);
        display: flex; align-items: center; justify-content: center;
        touch-action: manipulation; cursor: pointer;
      }
      .help-btn svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2.3; stroke-linecap: round; stroke-linejoin: round; }
      .help-btn:active { opacity: 0.6; }
      .help-btn.in-header { position: static; width: 36px; height: 36px; box-shadow: none; flex: none;
        border: 1px solid var(--line, rgba(255,255,255,.2)); background: var(--panel, rgba(255,255,255,.08)); color: var(--ink, #f4f5f1); }
      .help-btn.in-header svg { width: 17px; height: 17px; }
      .help-overlay {
        position: fixed; inset: 0; background: rgba(6,8,14,0.66);
        display: none; align-items: flex-end; justify-content: center;
        z-index: 9999; padding: 0;
      }
      @keyframes sheetUp { from { transform: translateY(40px); opacity: 0; } }

      .help-overlay.open { display: flex; }
      .help-modal {
        background: linear-gradient(180deg, #232733, #171a22); border: 1px solid rgba(255,255,255,0.08); border-bottom: 0;
        border-radius: 22px 22px 0 0; padding: 10px 20px calc(18px + env(safe-area-inset-bottom));
        width: 100%; max-width: 480px; max-height: 80vh; overflow-y: auto;
        color: #f4f5f1; font-family: 'Inter', sans-serif; box-shadow: 0 -16px 40px rgba(0,0,0,.45); animation: sheetUp .3s cubic-bezier(.2,.9,.3,1) both;
      }
      .help-modal::before { content: ""; display: block; width: 44px; height: 5px; margin: 0 auto 12px; border-radius: 3px; background: rgba(255,255,255,.18); }
      .help-modal p b { color: #fff; }
      .help-modal h3 {
        font-family: 'Space Grotesk', sans-serif; margin: 0 0 12px; font-size: 18px;
      }
      .help-modal p { font-size: 13px; line-height: 1.5; color: #d6d8db; margin: 0 0 10px; }
      .help-modal .help-formula {
        font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 14px;
        color: #38cfa0; background: #14161a; border-radius: 8px; padding: 8px 10px;
      }
      .help-close { display: block; margin-top: 8px; padding: 12px; border-radius: 12px; text-align: center; font-size: 14px; font-weight: 700; color: #f4f5f1; background: rgba(255,255,255,0.07); cursor: pointer; }
    `;
    document.head.appendChild(style);

    const btn = document.createElement("button");
    btn.className = "help-btn";
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9a3 3 0 1 1 4.2 2.8c-.8.4-1.2 1.1-1.2 2V15"/><path d="M12 18.5v.01"/></svg>';
    btn.setAttribute("aria-label", "Правила гри");
    // У шапці гри (ліворуч, поруч із «Назад») кнопка нічого не перекриває; плаваюча
    // знизу-справа лягала на кнопки гри на малих екранах. Шапка вантажиться defer-скриптом —
    // якщо її ще немає, кнопка тимчасово плаває й переїжджає, щойно та з'явиться.
    const dock = () => {
      let slot = null;
      try { slot = window.GameHeader && GameHeader.slot ? GameHeader.slot("left") : null; } catch (e) { slot = null; }
      if (!slot) return false;
      btn.classList.add("in-header"); slot.appendChild(btn); return true;
    };
    if (!dock()) {
      document.body.appendChild(btn);
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", dock, { once: true });
      else setTimeout(dock, 0);
    }

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
