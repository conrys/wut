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

  // невеличкий рядок стану внизу: «Оновлення · 42%» з тонкою смужкою; не заважає тапам
  let bar = null, barHideT = 0;
  function progress(pct, text, tone) {
    clearTimeout(barHideT);
    if (!bar) {
      bar = document.createElement("div"); bar.id = "appShellBar"; bar.setAttribute("role", "status"); bar.setAttribute("aria-live", "polite");
      bar.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 10px);z-index:2147482999;" +
        "pointer-events:none;min-width:150px;max-width:calc(100% - 32px);padding:6px 12px 7px;border-radius:12px;background:rgba(34,37,43,.92);" +
        "color:#f4f5f1;font:600 12px/1.2 Inter,system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.35);transition:opacity .3s;text-align:center";
      bar.innerHTML = '<div data-t></div><div style="margin-top:5px;height:3px;border-radius:2px;background:rgba(255,255,255,.14);overflow:hidden">' +
        '<div data-f style="height:100%;width:0;border-radius:2px;background:#38cfa0;transition:width .25s"></div></div>';
      document.body.appendChild(bar);
    }
    bar.style.opacity = "1";
    bar.querySelector("[data-t]").textContent = text;
    const f = bar.querySelector("[data-f]");
    f.style.width = Math.max(0, Math.min(100, pct)) + "%";
    f.style.background = tone === "err" ? "#ff6b6b" : "#38cfa0";
  }
  function progressDone(delay) {
    clearTimeout(barHideT);
    barHideT = setTimeout(() => { if (bar) { const b = bar; b.style.opacity = "0"; bar = null; setTimeout(() => b.remove(), 320); } }, delay || 0);
  }
  Updater.addListener("download", (e) => {
    const p = Math.round((e && e.percent) || 0);
    if (busy && p < 100) progress(p, "⬇️ Оновлення · " + p + "%");
  }).catch(() => {});

  const READY_KEY = "app_update_ready";
  const localVersion = () => fetch(BASE + "app-version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.version).catch(() => null);

  // Свіжий запуск застосунку (не перехід між сторінками): якщо минулого разу оновлення
  // завантажилось — вмикаємо його одразу, поки людина ще на заставці / головній.
  let fresh = false;
  try { fresh = !sessionStorage.getItem("app_launched"); sessionStorage.setItem("app_launched", "1"); } catch (e) {}
  // прибираємо «kill»-умову, яку ставила стара версія: вона блокувала встановлення назавжди
  Updater.cancelDelay().catch(() => {});
  async function applyReadyOnLaunch() {
    let r = null;
    try { r = JSON.parse(localStorage.getItem(READY_KEY) || "null"); } catch (e) {}
    if (!r || !r.id) return false;
    try { localStorage.removeItem(READY_KEY); } catch (e) {}
    const cur = await localVersion();
    if (cur && cur === r.version) return false;            // уже на ній
    try { await Updater.set({ id: r.id }); return true; } catch (e) { return false; }
  }

  let busy = false, lastCheck = 0;
  // стан для налаштувань («Застосунок»): що й коли перевіряли, чим скінчилось
  const ST_KEY = "app_update_status";
  function setStatus(o) { try { localStorage.setItem(ST_KEY, JSON.stringify(Object.assign({ at: Date.now() }, o))); } catch (e) {} }
  function getStatus() { try { return JSON.parse(localStorage.getItem(ST_KEY) || "null"); } catch (e) { return null; } }
  // не частіше ніж раз на хвилину (повернувся в застосунок — перевіряємо знову)
  async function checkUpdate(manual) {
    if (busy) return manual ? { state: "busy" } : undefined;
    if (!manual && Date.now() - lastCheck < 60 * 1000) return;
    busy = true; lastCheck = Date.now();
    try {
      const lv = await localVersion(), local = lv ? { version: lv } : null;
      const r = await Http.get({ url: SITE + "/app-manifest.json?t=" + Date.now(), responseType: "json", headers: { "Cache-Control": "no-cache" } });
      const m = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
      if (!m || !m.version || !Array.isArray(m.files)) { setStatus({ state: "error", error: "неправильний список файлів на сайті" }); return; }
      if (local && local.version === m.version) { setStatus({ state: "latest", remote: m.version }); if (manual) toast("У тебе найновіша версія ✓"); return; }
      const list = await Updater.list().catch(() => ({ bundles: [] }));
      let bundle = (list.bundles || []).find((b) => b.version === m.version && b.status !== "error" && b.status !== "downloading");
      if (!bundle) {
        progress(0, "⬇️ Оновлення · 0%");
        try {
          bundle = await Updater.download({ url: SITE + "/app-manifest.json", version: m.version, manifest: m.files });
        } catch (e) {
          progress(100, "Оновлення не завантажилось — спробую пізніше", "err"); progressDone(4000);
          throw e;
        }
        progress(100, "✓ Оновлення завантажено"); progressDone(900);
      }
      // Вмикаємо самі: при наступному запуску застосунку (див. applyReadyOnLaunch) або кнопкою.
      // Раніше тут були next() + умова «kill» плагіна — але кожна перевірка ставила ту умову знову,
      // і оновлення не вмикалось ніколи (жовтень 2026).
      try { localStorage.setItem(READY_KEY, JSON.stringify({ id: bundle.id, version: m.version })); } catch (e) {}
      setStatus({ state: "ready", remote: m.version });
      toast("Оновлення готове — увімкнеться при наступному запуску", "Перезапустити", () => { try { localStorage.removeItem(READY_KEY); } catch (e) {} Updater.set({ id: bundle.id }); });
    } catch (e) {
      const msg = e && e.message ? String(e.message).slice(0, 140) : String(e);
      setStatus({ state: "error", error: msg });
      if (manual) toast("Не вдалося оновитися: " + msg);
      console.warn("[41games] оновлення:", e && e.message ? e.message : e);
    } finally { busy = false; }
  }

  if (isHub) {
    addEventListener("load", async () => {
      if (fresh && (await applyReadyOnLaunch())) return;   // зараз перезавантажиться в нову версію
      setTimeout(() => checkUpdate(false), 1500);
    }, { once: true });
    App.addListener("appStateChange", (s) => { if (s.isActive) checkUpdate(false); });
  }

  window.AppShell = {
    checkUpdate: () => checkUpdate(true),
    status: getStatus,
    version: () => fetch(BASE + "app-version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.version).catch(() => "?"),
  };
})();
