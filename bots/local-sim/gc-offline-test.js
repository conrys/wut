// «Вгадай персонажа» у застосунку без інтернету: фото збережені на телефоні (js/core/img-cache.js).
// 1) з мережею (підроблена Вікіпедія, нативний CapacitorHttp) — фото всіх персонажів зберігаються у фоні;
// 2) нове відкриття «без інтернету» (navigator.onLine=false, Вікіпедія недоступна) — гра показує фото зі збереженого;
// 3) у браузері (не застосунок) у фоні нічого не качається.
const { launch, phone, BASE } = require("./harness");
const ok = (n, c, x) => console.log((c ? "✓ " : "✗ ") + n + (x ? "  — " + x : ""));
// 1×1 PNG
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
const NATIVE = `
  window.__http = 0;
  window.androidBridge = { postMessage(){} };
  const P = (name, methods) => ({ name, methods: methods.map((m) => ({ name: m, rtype: "promise" })) });
  window.Capacitor = {
    PluginHeaders: [P("App", ["addListener", "exitApp"]), P("SplashScreen", ["hide"]), P("StatusBar", ["setStyle"]), P("Haptics", ["vibrate"]),
      P("CapacitorHttp", ["get", "request"]), P("CapacitorUpdater", ["notifyAppReady", "list", "download", "next", "set", "setMultiDelay"])],
    nativePromise(plugin, method, opts) {
      if (plugin === "CapacitorHttp") {
        if (/app-manifest/.test(opts.url)) return Promise.reject(new Error("offline"));
        if (navigator.onLine === false) return Promise.reject(new Error("offline"));
        window.__http++;
        return Promise.resolve({ status: 200, headers: { "Content-Type": "image/png" }, data: "${PNG}" });
      }
      return Promise.resolve({ bundles: [] });
    },
    nativeCallback() { return "cb1"; },
  };`;
async function wiki(ctx) {
  let n = 0;
  await ctx.route(/wikipedia\.org\/w\/api\.php/, (route) => {
    n++;
    const titles = decodeURIComponent(new URL(route.request().url()).searchParams.get("titles") || "").split("|");
    const pages = titles.map((t, i) => ({ title: t, thumbnail: { source: "https://upload.wikimedia.org/thumb/" + encodeURIComponent(t) + ".png" } }));
    route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ query: { pages } }) });
  });
  return () => n;
}
(async () => {
  const b = await launch();
  const p = await phone(b, "tester");
  const ctx = p.context();
  const apiCalls = await wiki(ctx);
  await ctx.addInitScript(NATIVE);
  await p.goto(BASE + "/guesschar.html");
  await p.waitForFunction(() => /Фото збережені|Збережено/.test((document.getElementById("offlineHint") || {}).textContent || ""), null, { timeout: 30000 }).catch(() => {});
  const hint1 = await p.evaluate(() => document.getElementById("offlineHint").textContent);
  const http1 = await p.evaluate(() => window.__http);
  ok("з мережею: усі фото збережені у фоні", /Фото збережені/.test(hint1), `${hint1} · завантажень ${http1}, запитів до Вікіпедії ${apiCalls()}`);
  const cached = await p.evaluate(async () => (await (await caches.open("41g-img-v1")).keys()).length);
  ok("у Cache Storage є картинки", cached >= 150, String(cached));

  // 2) «без інтернету»: нова сторінка, Вікіпедія недоступна, navigator.onLine=false
  await ctx.unroute(/wikipedia\.org\/w\/api\.php/);
  const p2 = await ctx.newPage(); p2.errors = []; p2.on("pageerror", (e) => p2.errors.push(e.message));
  await p2.addInitScript(() => { Object.defineProperty(Navigator.prototype, "onLine", { get: () => false }); });
  await p2.goto(BASE + "/guesschar.html"); await p2.waitForTimeout(2500);
  const hint2 = await p2.evaluate(() => document.getElementById("offlineHint").textContent);
  ok("офлайн: підказка про збережені фото", /Без інтернету: доступно \d+/.test(hint2), hint2);
  await p2.evaluate(() => { document.querySelector('#modeSeg [data-v="photo"]').click(); document.getElementById("startBtn").click(); });
  await p2.waitForSelector(".gc-photo", { timeout: 8000 }).catch(() => {});
  const bg = await p2.evaluate(() => { const e = document.querySelector(".gc-photo"); return e ? e.style.backgroundImage : ""; });
  ok("офлайн: картка з фото зі збереженого (blob:)", /blob:/.test(bg), bg.slice(0, 60));
  await p2.evaluate(() => document.getElementById("skipBtn").click()); await p2.waitForTimeout(600);
  const bg2 = await p2.evaluate(() => { const e = document.querySelector(".gc-photo"); return e ? e.style.backgroundImage : ""; });
  ok("офлайн: наступна картка теж з фото", /blob:/.test(bg2) && bg2 !== bg);
  await p2.screenshot({ path: __dirname + "/out/gc-offline.png" });

  // 3) браузер: без застосунку фоново нічого не качаємо
  const p3 = await phone(b, "tester"); const n3 = await wiki(p3.context());
  await p3.goto(BASE + "/guesschar.html"); await p3.waitForTimeout(3000);
  ok("на сайті фото у фоні не качаються", n3() === 0 && await p3.evaluate(() => document.getElementById("offlineHint").classList.contains("hidden")), "запитів " + n3());
  console.log("errors", p.errors.slice(0, 3), p2.errors.slice(0, 3), p3.errors.slice(0, 3));
  await b.close();
})();
