// Перевірка мосту Android-застосунку (js/core/native.js + app-shell.js) у Chromium:
// підробляємо нативний Capacitor (androidBridge + PluginHeaders + nativePromise) і дивимось,
// які нативні виклики робить сторінка. Потрібні app-version.json / app-manifest.json
// у корені (node app/bundle.mjs manifest).
const { launch, phone, BASE } = require("./harness");
const ok = (n, c, x) => console.log((c ? "✓ " : "✗ ") + n + (x ? "  — " + x : ""));
const MOCK = (remoteVersion) => `
  window.__calls = [];
  window.androidBridge = { postMessage(){} };
  const P = (name, methods) => ({ name, methods: methods.map((m) => ({ name: m, rtype: "promise" })) });
  window.Capacitor = {
    PluginHeaders: [P("App", ["addListener", "exitApp"]), P("SplashScreen", ["hide", "show"]), P("StatusBar", ["setStyle"]), P("Haptics", ["vibrate"]),
      P("CapacitorHttp", ["get", "request"]), P("CapacitorUpdater", ["notifyAppReady", "list", "download", "next", "set", "setMultiDelay"])],
    nativePromise(plugin, method, opts) {
      window.__calls.push(plugin + "." + method);
      if (plugin === "CapacitorHttp") return fetch("/app-manifest.json").then((r) => r.json()).then((m) => ({ data: Object.assign(m, ${remoteVersion ? `{ version: "${remoteVersion}" }` : "{}"}), status: 200 }));
      if (method === "list") return Promise.resolve({ bundles: [] });
      if (method === "download") { window.__dl = opts; return Promise.resolve({ id: "b1", version: opts.version, status: "pending" }); }
      return Promise.resolve({});
    },
    nativeCallback() { return "cb1"; },
  };`;
(async () => {
  const b = await launch();
  // 1) та сама версія — нічого не качаємо
  let p = await phone(b, "tester"); await p.addInitScript(MOCK(null));
  await p.goto(BASE + "/index.html"); await p.waitForTimeout(3500);
  let calls = await p.evaluate(() => window.__calls);
  ok("core + app-shell підвантажились (Capacitor.registerPlugin)", await p.evaluate(() => typeof Capacitor.registerPlugin === "function" && !!window.AppShell));
  ok("notifyAppReady на старті", calls.includes("CapacitorUpdater.notifyAppReady"));
  ok("заставка ховається", calls.includes("SplashScreen.hide"));
  ok("Capacitor.Plugins.App є для back-button.js", await p.evaluate(() => !!Capacitor.Plugins.App && !!Capacitor.Plugins.Haptics));
  ok("версія збігається → без завантаження", calls.includes("CapacitorHttp.get") && !calls.includes("CapacitorUpdater.download"), calls.join(","));
  // 2) на сайті новіша версія → download з manifest, next, затримка до перезапуску, тост
  p = await phone(b, "tester"); await p.addInitScript(MOCK("ffffffffffff"));
  await p.goto(BASE + "/index.html"); await p.waitForTimeout(3500);
  calls = await p.evaluate(() => window.__calls);
  const dl = await p.evaluate(() => window.__dl && { v: window.__dl.version, n: window.__dl.manifest.length, f: window.__dl.manifest[0] });
  ok("нова версія → download(manifest)", dl && dl.v === "ffffffffffff" && dl.n > 500, dl && `${dl.n} файлів, ${JSON.stringify(dl.f).slice(0, 90)}…`);
  ok("next + setMultiDelay(kill)", calls.includes("CapacitorUpdater.next") && calls.includes("CapacitorUpdater.setMultiDelay"));
  ok("тост «Оновлення готове» з кнопкою", await p.evaluate(() => { const t = document.getElementById("appShellToast"); return !!t && /Оновлення готове/.test(t.textContent) && !!t.querySelector("button"); }));
  await p.screenshot({ path: __dirname + "/out/app-shell-toast.png" });
  // 3) гра (не головна) — оновлення не перевіряє, але notifyAppReady є
  p = await phone(b, "tester"); await p.addInitScript(MOCK("ffffffffffff"));
  await p.goto(BASE + "/ads/povzuny/play.html"); await p.waitForTimeout(2500);
  calls = await p.evaluate(() => window.__calls);
  ok("у грі: notifyAppReady є, перевірки оновлень нема", calls.includes("CapacitorUpdater.notifyAppReady") && !calls.includes("CapacitorHttp.get"));
  // 4) звичайний браузер — нічого не підвантажується
  p = await phone(b, "tester"); const reqs = []; p.on("request", (r) => reqs.push(r.url()));
  await p.goto(BASE + "/index.html"); await p.waitForTimeout(1500);
  ok("на сайті capacitor.js / app-shell.js не вантажаться", !reqs.some((u) => /capacitor\.js|app-shell\.js/.test(u)));
  console.log("errors", p.errors.slice(0, 3));
  await b.close();
})();
