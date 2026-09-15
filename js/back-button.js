(function () {
  const currentPath = window.location.pathname.split("/").pop();
  const isIndex = currentPath === "index.html" || currentPath === "";

  function setupHardwareBack() {
    const CapApp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (!CapApp) return;

    CapApp.addListener("backButton", () => {
      if (isIndex) {
        CapApp.exitApp();
      } else {
        window.location.href = "index.html";
      }
    });
  }
  setupHardwareBack();

  if (isIndex) return; // На головній кнопка "Назад" не потрібна

  document.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = `
      .app-back-btn {
        position: static !important;
        background: rgba(0, 0, 0, 0.5);
        border: 1px solid rgba(255,255,255,0.15);
        color: #f4f5f1;
        border-radius: 20px;
        padding: 6px 14px;
        font-family: 'Inter', sans-serif;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        touch-action: manipulation;
        -webkit-user-select: none;
        user-select: none;
        text-decoration: none;
      }
      .app-back-btn:active { opacity: 0.6; }
    `;
    document.head.appendChild(style);

    const existingBtn = document.querySelector("#backBtn");
    if (existingBtn) existingBtn.remove();

    const backBtn = document.createElement("button");
    backBtn.className = "app-back-btn";
    backBtn.id = "backBtn";
    backBtn.textContent = "◀ Назад";

    backBtn.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.href = "index.html";
    });

    GameHeader.slot("left").appendChild(backBtn);
  });
})();