// ==========================================================================
// Кнопка «🏆 Рекорди» + модалка з топ-10 по поточній грі.
// Назва гри визначається автоматично з імені файлу (tetris.html -> 'tetris',
// 2048.html -> '2048') — той самий рядок, що передається в sendScore().
// Підключати ТІЛЬКИ на сторінках ігор (після firebase-config.js,
// game-header.js, login.js, score-connect.js), на index.html не потрібен.
// ==========================================================================
(function () {
  function currentGameName() {
    const file = window.location.pathname.split("/").pop() || "";
    return file.replace(/\.html?$/i, "");
  }

  function buildUI() {
    const gameName = currentGameName();
    if (!gameName || gameName === "index") return;

    const style = document.createElement("style");
    style.textContent = `
      .records-btn {
        position: static !important;
        transform: none !important;
        background: rgba(0,0,0,0.5);
        color: #f4f5f1;
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 20px;
        padding: 6px 14px;
        font-family: 'Inter', sans-serif;
        font-size: 12px;
        font-weight: 600;
        touch-action: manipulation;
        cursor: pointer;
      }
      .records-btn:active { opacity: 0.6; }
      .records-overlay {
        position: fixed; inset: 0; background: rgba(0,0,0,0.6);
        display: none; align-items: center; justify-content: center;
        z-index: 9999; padding: 20px;
      }
      .records-overlay.open { display: flex; }
      .records-modal {
        background: #22252b; border-radius: 16px; padding: 22px;
        width: 100%; max-width: 320px; max-height: 70vh; overflow-y: auto;
        color: #f4f5f1; font-family: 'Inter', sans-serif;
      }
      .records-modal h3 {
        font-family: 'Space Grotesk', sans-serif; margin: 0 0 14px; font-size: 20px;
      }
      .records-row {
        display: flex; justify-content: space-between; align-items: center;
        padding: 8px 4px; border-bottom: 1px solid rgba(255,255,255,0.06);
        font-size: 14px;
      }
      .records-row .rank { color: #8b909c; width: 24px; font-weight: 700; }
      .records-row .player { flex: 1; }
      .records-row .score { font-family: 'Space Grotesk', sans-serif; font-weight: 700; color: #38cfa0; }
      .records-empty { color: #8b909c; font-size: 13px; text-align: center; padding: 20px 0; }
      .records-close { text-align: center; margin-top: 14px; font-size: 12px; color: #8b909c; cursor: pointer; }
    `;
    document.head.appendChild(style);

    const btn = document.createElement("div");
    btn.className = "records-btn";
    btn.textContent = "Рекорди";

    GameHeader.slot("center").appendChild(btn);

    const overlay = document.createElement("div");
    overlay.className = "records-overlay";
    overlay.innerHTML = `
      <div class="records-modal">
        <h3>Рекорди</h3>
        <div id="recordsList"><div class="records-empty">Завантаження…</div></div>
        <div class="records-close" id="recordsCloseBtn">Закрити</div>
      </div>
    `;
    document.body.appendChild(overlay);

    const listEl = overlay.querySelector("#recordsList");
    overlay.querySelector("#recordsCloseBtn").addEventListener("click", () => overlay.classList.remove("open"));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.remove("open"); });

    btn.addEventListener("click", async () => {
      overlay.classList.add("open");
      listEl.innerHTML = '<div class="records-empty">Завантаження…</div>';
      if (!window.AppScore) {
        listEl.innerHTML = '<div class="records-empty">Недоступно</div>';
        return;
      }
      const rows = await window.AppScore.getTopScores(gameName, 10);
      if (!rows.length) {
        listEl.innerHTML = '<div class="records-empty">Поки немає рекордів. Стань першим!</div>';
        return;
      }
      listEl.innerHTML = rows
        .map(
          (r, i) => `
        <div class="records-row">
          <span class="rank">${i + 1}</span>
          <span class="player">${escapeHtml(r.player)}</span>
          <span class="score">${r.score}</span>
        </div>`
        )
        .join("");
    });
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  document.addEventListener("DOMContentLoaded", buildUI);
})();