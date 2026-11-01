(function () {
  const currentPath = window.location.pathname.split("/").pop();
  const isIndex = currentPath === "index.html" || currentPath === "";
  // Головна — від адреси самого скрипта (js/core/ → ../../index.html), а не від кореня
  // диска/сервера: так «Назад» працює і з file://, і з підпапок (ads/<гра>/).
  const HOME_URL = document.currentScript && document.currentScript.src
    ? new URL("../../index.html", document.currentScript.src).href
    : new URL("index.html", window.location.href).href;

  function setupHardwareBack() {
    const CapApp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (!CapApp) return;

    CapApp.addListener("backButton", () => {
      // гра може сама обробити «Назад» (закрити вікно, вийти в своє меню)
      if (window.gameBack && window.gameBack()) return;
      if (isIndex) {
        CapApp.exitApp();
      } else {
        window.location.href = HOME_URL;
      }
    });
  }
  setupHardwareBack();
})();