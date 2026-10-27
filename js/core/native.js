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
  var me = document.currentScript && document.currentScript.src;
  var base = me ? me.replace(/js\/core\/native\.js(\?.*)?$/, "") : "";
  document.write('<script src="' + base + 'vendor/capacitor/capacitor.js"><\/script>' +
                 '<script src="' + base + 'js/core/app-shell.js"><\/script>');
})();
