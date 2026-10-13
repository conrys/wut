// refresh-button.js — плаваюча кнопка "оновити сторінку" на випадок нюансів
// з конектом (RTDB-сокет заснув у фоні, WebView не помітив реконект тощо).
// Підключати як інші спільні утиліти: <script src="js/refresh-button.js"></script>.
// Розміщена знизу зліва навмисно — help.js вже займає низ справа (❓).
(function () {
  document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("refreshFloatBtn")) return;

    const btn = document.createElement("button");
    btn.id = "refreshFloatBtn";
    btn.textContent = "↻";
    btn.title = "Оновити сторінку";
    btn.style.cssText = [
      "position:fixed", "left:16px", "bottom:16px", "z-index:80",
      "width:40px", "height:40px", "border-radius:50%",
      "background:#22252b", "color:#f4f5f1", "border:1px solid rgba(255,255,255,0.12)",
      "font-size:19px", "line-height:1", "display:flex", "align-items:center", "justify-content:center",
      "touch-action:manipulation", "-webkit-user-select:none", "user-select:none",
      "-webkit-touch-callout:none", "box-shadow:0 4px 12px rgba(0,0,0,0.35)",
    ].join(";");

    btn.addEventListener("pointerdown", (e) => { e.preventDefault(); location.reload(); });
    btn.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });

    document.body.appendChild(btn);
  });
})();
