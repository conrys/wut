// ==========================================================================
// Оболонка Android-застосунку 41games. Вантажиться ЛИШЕ в застосунку (через js/core/native.js).
//
//  • реєструє нативні плагіни → Capacitor.Plugins.App / Haptics / … для решти коду;
//  • ховає заставку з крокодилом, коли сторінка готова;
//  • живі оновлення: на головній звіряє свою версію з kzl-crm.web.app/app-manifest.json
//    і, якщо на сайті новіша, у фоні качає ЛИШЕ змінені файли (решта — з APK чи попереднього
//    оновлення). Нова версія вмикається при наступному запуску або кнопкою «Перезапустити».
//    Якщо нова версія не стартує — плагін сам повертає попередню (notifyAppReady нижче).
// ==========================================================================
(function () {
  const Cap = window.Capacitor;
  if (!Cap || !Cap.registerPlugin || !Cap.isNativePlatform()) return;
  const SITE = "https://kzl-crm.web.app";
  const reg = (n) => (Cap.Plugins && Cap.Plugins[n]) || Cap.registerPlugin(n);
  ["App", "Haptics", "SplashScreen", "StatusBar", "CapacitorUpdater"].forEach(reg);
  const { App, SplashScreen, StatusBar, CapacitorUpdater: Updater } = Cap.Plugins;
  const Http = reg("CapacitorHttp");

  // 1) ця версія файлів стартувала → без відкату
  Updater.notifyAppReady().catch(() => {});

  // 2) заставка й рядок стану
  const hide = () => SplashScreen.hide({ fadeOutDuration: 220 }).catch(() => {});
  if (document.readyState === "complete") hide(); else addEventListener("load", hide, { once: true });
  setTimeout(hide, 4000);
  StatusBar.setStyle({ style: "DARK" }).catch(() => {});

  // 3) живі оновлення — лише з головної (на ній завжди опиняєшся між іграми)
  const path = location.pathname.replace(/\/+$/, "/");
  const isHub = path === "/" || path === "/index.html";
  const BASE = new URL("../../", document.currentScript ? document.currentScript.src : location.href).href;

  function toast(text, btnText, onBtn) {
    let t = document.getElementById("appShellToast");
    if (!t) {
      t = document.createElement("div"); t.id = "appShellToast"; t.setAttribute("role", "status");
      t.style.cssText = "position:fixed;left:12px;right:12px;bottom:calc(env(safe-area-inset-bottom,0px) + 14px);z-index:2147483000;" +
        "display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:14px;background:rgba(34,37,43,.96);color:#f4f5f1;" +
        "font:600 14px/1.3 Inter,system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.45);transition:opacity .25s";
      document.body.appendChild(t);
    }
    t.innerHTML = ""; t.style.opacity = "1";
    const s = document.createElement("span"); s.style.flex = "1"; s.textContent = text; t.appendChild(s);
    if (btnText) {
      const b = document.createElement("button"); b.type = "button"; b.textContent = btnText;
      b.style.cssText = "border:0;border-radius:10px;padding:9px 12px;background:#38cfa0;color:#0b2a20;font:700 14px Inter,system-ui,sans-serif";
      b.onclick = onBtn; t.appendChild(b);
    }
    const x = document.createElement("button"); x.type = "button"; x.setAttribute("aria-label", "Закрити"); x.textContent = "✕";
    x.style.cssText = "border:0;background:none;color:#8b909c;font-size:16px;padding:4px 6px";
    x.onclick = () => { t.style.opacity = "0"; setTimeout(() => t.remove(), 260); }; t.appendChild(x);
  }

  let busy = false, lastCheck = 0;
  async function checkUpdate(manual) {
    if (busy || (!manual && Date.now() - lastCheck < 20 * 60 * 1000)) return;
    busy = true; lastCheck = Date.now();
    try {
      const local = await fetch(BASE + "app-version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      const r = await Http.get({ url: SITE + "/app-manifest.json?t=" + Date.now(), responseType: "json", headers: { "Cache-Control": "no-cache" } });
      const m = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
      if (!m || !m.version || !Array.isArray(m.files)) return;
      if (local && local.version === m.version) { if (manual) toast("У тебе найновіша версія ✓"); return; }
      const list = await Updater.list().catch(() => ({ bundles: [] }));
      let bundle = (list.bundles || []).find((b) => b.version === m.version && b.status !== "error" && b.status !== "downloading");
      if (!bundle) {
        if (manual) toast("Завантажую оновлення…");
        bundle = await Updater.download({ url: SITE + "/app-manifest.json", version: m.version, manifest: m.files });
      }
      await Updater.next({ id: bundle.id });
      // не перезавантажувати посеред гри, коли просто згорнув застосунок: лише після закриття
      await Updater.setMultiDelay({ delayConditions: [{ kind: "kill" }] }).catch(() => {});
      toast("Оновлення готове — увімкнеться при наступному запуску", "Перезапустити", () => Updater.set({ id: bundle.id }));
    } catch (e) {
      if (manual) toast("Не вдалося перевірити оновлення (немає інтернету?)");
      console.warn("[41games] оновлення:", e && e.message ? e.message : e);
    } finally { busy = false; }
  }

  if (isHub) {
    addEventListener("load", () => setTimeout(() => checkUpdate(false), 1500), { once: true });
    App.addListener("appStateChange", (s) => { if (s.isActive) checkUpdate(false); });
  }

  window.AppShell = {
    checkUpdate: () => checkUpdate(true),
    version: () => fetch(BASE + "app-version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.version).catch(() => "?"),
  };
})();
