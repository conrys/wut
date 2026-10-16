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
        position: fixed; inset: 0; background: rgba(6,8,14,0.66);
        display: none; align-items: flex-end; justify-content: center;
        z-index: 9999; padding: 0;
      }
      @keyframes sheetUp { from { transform: translateY(40px); opacity: 0; } }

      .records-overlay.open { display: flex; }
      .records-modal {
        background: linear-gradient(180deg, #232733, #171a22); border: 1px solid rgba(255,255,255,0.08); border-bottom: 0;
        border-radius: 22px 22px 0 0; padding: 10px 18px calc(18px + env(safe-area-inset-bottom));
        width: 100%; max-width: 480px; max-height: 78vh; overflow-y: auto;
        color: #f4f5f1; font-family: 'Inter', sans-serif; box-shadow: 0 -16px 40px rgba(0,0,0,.45); animation: sheetUp .3s cubic-bezier(.2,.9,.3,1) both;
      }
      .records-modal::before { content: ""; display: block; width: 44px; height: 5px; margin: 0 auto 12px; border-radius: 3px; background: rgba(255,255,255,.18); }
      .records-modal h3 {
        display: flex; align-items: center; gap: 10px; font-family: 'Space Grotesk', sans-serif; margin: 0 0 14px; font-size: 20px;
      }
      .records-modal h3 svg { width: 26px; height: 26px; fill: none; stroke: #ffc93c; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .records-row {
        display: flex; align-items: center; gap: 10px;
        padding: 9px 10px; margin-bottom: 4px; border-radius: 12px; background: rgba(255,255,255,0.035);
        font-size: 14px;
      }
      .records-row.me { background: rgba(255,201,60,0.12); box-shadow: inset 0 0 0 1px rgba(255,201,60,0.45); }
      .records-row .rank { width: 26px; height: 26px; flex: none; border-radius: 50%; display: grid; place-items: center; color: #8b909c; font-weight: 800; font-size: 12px; background: rgba(255,255,255,0.06); }
      .records-row.r1 .rank { background: linear-gradient(135deg, #ffe08a, #e0a91c); color: #3a2600; }
      .records-row.r2 .rank { background: linear-gradient(135deg, #f1f3f6, #a9b0bb); color: #23262d; }
      .records-row.r3 .rank { background: linear-gradient(135deg, #f0b98a, #b0682f); color: #2e1606; }
      .records-row .player { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
      .records-row .score { font-family: 'Space Grotesk', sans-serif; font-weight: 700; color: #ffc93c; font-variant-numeric: tabular-nums; }
      .records-empty { color: #8b909c; font-size: 13px; text-align: center; padding: 20px 0; }
      .records-close { display: block; width: 100%; margin-top: 12px; padding: 12px; border-radius: 12px; text-align: center; font-size: 14px; font-weight: 700; color: #f4f5f1; background: rgba(255,255,255,0.07); cursor: pointer; }
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
        <h3><svg viewBox="0 0 24 24"><path d="M7 4h10v4a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 13v4M8 20h8M9 17h6"/></svg>Рекорди</h3>
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
      const sess = window.AppAuth && window.AppAuth.getSession && window.AppAuth.getSession();
      const me = sess && sess.username;
      listEl.innerHTML = rows
        .map(
          (r, i) => `
        <div class="records-row r${i + 1} ${me && r.player === me ? "me" : ""}">
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