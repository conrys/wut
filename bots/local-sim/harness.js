// Shared Playwright helpers: phone contexts wired to the local mock.
const { chromium } = require("playwright");
const BASE = "http://127.0.0.1:8787";
const HOWLER_STUB = `window.Howl=function(o){return{play(){return 1},stop(){},pause(){},volume(){},fade(){},on(){},once(){},off(){},playing(){return false},unload(){},seek(){return 0},rate(){},loop(){},state(){return 'loaded'},duration(){return 1}}};window.Howler={volume(){},mute(){},stop(){},ctx:null};`;

async function launch() {
  return chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ["--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--js-flags=--max-old-space-size=256", "--disable-background-networking", "--disable-component-update", "--disable-default-apps", "--disable-sync", "--no-first-run", "--disable-features=Translate,OptimizationHints,MediaRouter,AutofillServerCommunication"],
  });
}

async function phone(browser, username, opts = {}) {
  const ctx = await browser.newContext({
    viewport: opts.viewport || { width: 390, height: 844 },
    deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: "uk-UA",
  });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  await ctx.route("https://www.gstatic.com/**", async (route) => {
    const u = route.request().url();
    if (u.includes("firebase-app-compat")) {
      const r = await fetch(BASE + "/__mock/firebase.js");
      return route.fulfill({ status: 200, contentType: "text/javascript", body: await r.text() });
    }
    return route.fulfill({ status: 200, contentType: "text/javascript", body: "" });
  });
  await ctx.route("https://cdnjs.cloudflare.com/**", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: HOWLER_STUB }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
  if (username) {
    await ctx.addInitScript((u) => {
      try { localStorage.setItem("games41_session", JSON.stringify({ username: u, loginAt: Date.now() })); } catch (e) {}
    }, username);
  }
  if (opts.lite) {
    await ctx.addInitScript(() => {
      const css = "*,*::before,*::after{animation:none!important;transition:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;filter:none!important;box-shadow:none!important;text-shadow:none!important}";
      document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st); });
    });
  }
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push("pageerror: " + (e.stack || e.message).split("\n").slice(0, 3).join(" | ")));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) page.errors.push("console: " + m.text().slice(0, 300)); });
  page.on("requestfailed", (r) => { if (!/^https?:\/\/127/.test(r.url())) return; page.errors.push("reqfail: " + r.url()); });
  page.on("response", (r) => { if (r.status() >= 400) page.errors.push("http " + r.status() + ": " + r.url().replace(BASE, "")); });
  page.on("dialog", (d) => d.accept().catch(() => {}));
  page.username = username;
  return page;
}

module.exports = { launch, phone, BASE };
