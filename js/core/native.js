// ==========================================================================
// Міст до Android-застосунку 41games (Capacitor). Підключається першим скриптом
// на кожній сторінці. На сайті (у браузері) нічого не робить і нічого не вантажить.
//
// У застосунку синхронно (до решти скриптів сторінки) підвантажує:
//   vendor/capacitor/capacitor.js — @capacitor/core: registerPlugin і Capacitor.Plugins.*
//   js/core/app-shell.js          — заставка, рядок стану, живі оновлення
// Після цього старий код (back-button.js, firebase-config.js, app-settings.js) бачить
// Capacitor.Plugins.App / Haptics, як і задумувалось.
// ==========================================================================
(function () {
  var C = window.Capacitor;
  if (!C || !window.androidBridge) return;            // не в застосунку
  if (C.registerPlugin) return;                       // уже підключено
  // помилки оболонки під час старту — у Налаштування → «Застосунок» (без консолі на телефоні інакше не видно)
  window.addEventListener("error", function (e) {
    if (!/capacitor\.js|app-shell\.js|native\.js/.test(e.filename || "")) return;
    try {
      var a = JSON.parse(localStorage.getItem("app_shell_errors") || "[]");
      a.unshift({ at: Date.now(), m: String(e.message).slice(0, 160) + " @" + String(e.filename).split("/").pop() + ":" + e.lineno });
      localStorage.setItem("app_shell_errors", JSON.stringify(a.slice(0, 5)));
    } catch (x) {}
  });
  var me = document.currentScript && document.currentScript.src;
  var base = me ? me.replace(/js\/core\/native\.js(\?.*)?$/, "") : "";
  document.write('<script src="' + base + 'vendor/capacitor/capacitor.js"><\/script>' +
                 '<script src="' + base + 'js/core/app-shell.js"><\/script>');
})();
