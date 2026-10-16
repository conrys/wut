// End-to-end check of guest / register / legacy-migration / forged-session flows.
// node auth-test.js   (simulator must be running)
const crypto = require("node:crypto");
const { launch, phone, BASE } = require("./harness");

const results = [];
function check(name, ok, extra) { results.push({ name, ok: !!ok, extra }); console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); }
const fsAll = () => fetch(BASE + "/__mock/fs").then((r) => r.json());

async function blank(browser) {
  const p = await phone(browser, null);
  return p;
}

(async () => {
  await fetch(BASE + "/__mock/reset");
  const sha = crypto.createHash("sha256").update("oldvlad:1234").digest("hex");
  await fetch(BASE + "/__mock/fs", { method: "POST", body: JSON.stringify({ col: "games41_users", id: "oldvlad", data: { passwordHash: sha, createdAt: 1700000000000 } }) });
  const b = await launch();

  // 1. Guest via room link: modal opens by itself, Cyrillic name with apostrophe
  const a = await blank(b);
  await a.goto(`${BASE}/whofrom.html?room=AUTH1`, { waitUntil: "load" });
  await a.waitForTimeout(800);
  check("room link opens guest login", await a.isVisible(".auth-overlay.open #authUser"));
  await a.fill("#authUser", "  Мар'яна  ");
  await a.click("#authSubmit");
  await a.waitForLoadState("load"); await a.waitForTimeout(2500);
  const sA = await a.evaluate(() => window.AppAuth.getSession());
  check("guest session created", sA && sA.guest && sA.username === "Марʼяна", JSON.stringify(sA));
  const roomA = await fetch(`${BASE}/db/party_whofrom_rooms/AUTH1/players.json`).then((r) => r.json());
  check("guest joined room without manual reload", roomA && roomA["Марʼяна"], Object.keys(roomA || {}).join(","));

  // 2. Same name, other phone → taken
  const c = await blank(b);
  await c.goto(`${BASE}/whofrom.html`, { waitUntil: "load" }); await c.waitForTimeout(800);
  check("lock screen has login button", await c.isVisible(".auth-cta"));
  await c.click(".auth-cta");
  await c.fill("#authUser", "марʼяна");
  await c.click("#authSubmit"); await c.waitForTimeout(800);
  check("duplicate guest name rejected", /зайняте/.test(await c.textContent("#authError")), await c.textContent("#authError"));
  await c.fill("#authUser", "<b>x</b>");
  await c.click("#authSubmit"); await c.waitForTimeout(400);
  check("HTML in name rejected", /лише літери/.test(await c.textContent("#authError")));

  // 3. Legacy account migrates on first login
  await c.click('.auth-tab[data-tab="login"]');
  await c.fill("#authUser", "OldVlad");
  await c.fill("#authPass", "wrong");
  await c.click("#authSubmit"); await c.waitForTimeout(800);
  check("legacy wrong password rejected", /Невірне/.test(await c.textContent("#authError")), await c.textContent("#authError"));
  await c.fill("#authPass", "1234");
  await c.click("#authSubmit");
  await c.waitForLoadState("load"); await c.waitForTimeout(2000);
  const sC = await c.evaluate(() => window.AppAuth.getSession());
  let fsd = await fsAll();
  check("legacy login migrated", sC && sC.username === "oldvlad" && !sC.guest, JSON.stringify(sC));
  check("legacy hash deleted", !(fsd.games41_users || {}).oldvlad);
  check("name claimed with old join date", fsd.games41_names && fsd.games41_names.oldvlad && fsd.games41_names.oldvlad.createdAt === 1700000000000);

  // 4. Logout + login again through Firebase Auth path
  await c.evaluate(() => window.AppAuth.logout());
  await c.waitForLoadState("load"); await c.waitForTimeout(1200);
  check("logout clears session", !(await c.evaluate(() => window.AppAuth.getSession())));
  await c.click(".auth-cta"); await c.click('.auth-tab[data-tab="login"]');
  await c.fill("#authUser", "oldvlad"); await c.fill("#authPass", "1234");
  await c.click("#authSubmit"); await c.waitForLoadState("load"); await c.waitForTimeout(1500);
  check("second login works", (await c.evaluate(() => (window.AppAuth.getSession() || {}).username)) === "oldvlad");

  // 5. Forged legacy-style session is dropped
  const d = await blank(b);
  await d.addInitScript(() => { if (!sessionStorage.getItem("x")) { sessionStorage.setItem("x", 1); localStorage.setItem("games41_session", JSON.stringify({ username: "oldvlad", loginAt: 1 })); } });
  await d.goto(`${BASE}/whofrom.html`, { waitUntil: "load" });
  await d.waitForTimeout(2500);
  check("forged session cleared", !(await d.evaluate(() => window.AppAuth.getSession())));
  check("relogin notice shown", await d.isVisible("#authNotice.show"));

  // 6. Guest saves profile → account with same uid
  const uidBefore = sA.uid;
  await a.click(".auth-pill"); await a.click('[data-action="save"]');
  await a.fill("#authPass", "secret12");
  await a.click("#authSubmit"); await a.waitForTimeout(1500);
  const sA2 = await a.evaluate(() => window.AppAuth.getSession());
  check("guest saved as account (same uid)", sA2 && !sA2.guest && sA2.uid === uidBefore, JSON.stringify(sA2));
  fsd = await fsAll();
  check("saved name is permanent", fsd.games41_names["марʼяна"] && fsd.games41_names["марʼяна"].guest === false);

  // 7. Register new + profile inside a game page
  const e = await blank(b);
  await e.goto(`${BASE}/mafia.html`, { waitUntil: "load" }); await e.waitForTimeout(800);
  await e.click(".auth-cta"); await e.click('.auth-tab[data-tab="register"]');
  await e.fill("#authUser", "Тарас"); await e.fill("#authPass", "123");
  await e.click("#authSubmit"); await e.waitForTimeout(500);
  check("short password rejected", /щонайменше/.test(await e.textContent("#authError")));
  await e.fill("#authPass", "123456");
  await e.click("#authSubmit"); await e.waitForLoadState("load"); await e.waitForTimeout(1500);
  check("registered", (await e.evaluate(() => (window.AppAuth.getSession() || {}).username)) === "Тарас");
  await e.click(".auth-pill"); await e.click('[data-action="profile"]'); await e.waitForTimeout(1500);
  const prof = await e.evaluate(() => document.querySelector(".profile-modal").innerText);
  check("profile works inside a game", /Рейтинг профілю/i.test(prof) && !/Недоступно|недоступний/.test(prof), prof.replace(/\s+/g, " ").slice(0, 120));

  // 8. Pages that had no Firebase before
  const f = await phone(b, "soliter_tester");
  await f.goto(`${BASE}/soliter.html`, { waitUntil: "load" }); await f.waitForTimeout(800);
  check("soliter has Firebase now", await f.evaluate(() => window.firebaseReady === true));
  const g = await blank(b);
  await g.goto(`${BASE}/notes.html`, { waitUntil: "load" }); await g.waitForTimeout(800);
  check("notes.html has profile button, no errors", (await g.isVisible(".auth-pill")) && !g.errors.some((x) => /GameHeader/.test(x)), g.errors.join(" | "));

  const errs = [a, c, d, e, f, g].flatMap((p) => p.errors.filter((x) => !/^http 404/.test(x)));
  check("no JS errors", !errs.length, errs.slice(0, 3).join(" | "));
  await b.close();
  const bad = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - bad}/${results.length} passed`);
  process.exitCode = bad ? 1 : 0;
})();
