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
        const depth = window.location.pathname.split("/").filter(Boolean).length - 1;
        window.location.href = new URL(`${"../".repeat(depth)}index.html`, window.location.href).href;
      }
    });
  }
  setupHardwareBack();
})();