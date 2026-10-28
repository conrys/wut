// Хутір: соло (ріст, збір торканням, будівництво, замовлення, офлайн-прибуток, збереження), жести, спільний хутір двома телефонами.
// node khutir-test.js   (симулятор має бути запущений: node server.js)
const fs = require("fs");
const { launch, phone, BASE } = require("./harness");
const URL_ = BASE + "/ads/khutir/play.html";
const OUT = __dirname + "/out/khutir"; fs.mkdirSync(OUT, { recursive: true });
const results = [];
function check(name, ok, extra) { results.push(ok); console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); }
const until = async (fn, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { const r = await fn(); if (r) return r; await new Promise((x) => setTimeout(x, 300)); } return null; };
const tapAt = async (p, x, y) => { await p.touchscreen.tap(x, y); await p.waitForTimeout(150); };
const tapTile = async (p, x, y) => { const [sx, sy] = await p.evaluate(([x, y]) => KHUTIR.screenOf(x, y), [x, y]); await tapAt(p, sx, sy); };

(async () => {
  const b = await launch();
  // ================= СОЛО =================
  const p = await phone(b, null, { lite: true });
  await p.goto(URL_); await p.waitForTimeout(1200);
  check("меню показано", await p.isVisible("#mSolo"));
  await p.screenshot({ path: OUT + "/0-menu.png" });
  await p.tap("#mSolo");
  await until(() => p.evaluate(() => KHUTIR.mode === "solo" && !!KHUTIR.view));
  const st0 = await p.evaluate(() => ({ c: KHUTIR.view.coins, b: KHUTIR.view.b.length, f: KHUTIR.view.b[0] }));
  check("новий хутір: 60 💰 і одне поле", st0.c === 60 && st0.b === 1 && st0.f.k === "field", JSON.stringify(st0));
  check("поле одразу росте", st0.f.p >= 0);
  await p.evaluate(() => KHUTIR.warp(65e3));
  const buf = await p.evaluate(() => KHUTIR.view.b[0].buf);
  check("за 65 с поле дало 6 🌾", buf === 6, String(buf));
  await p.screenshot({ path: OUT + "/1-ripe.png" });
  // торкання поля — збір
  await tapTile(p, st0.f.x, st0.f.y);
  const wheat = await p.evaluate(() => KHUTIR.view.st.wheat || 0);
  check("торкнувся поля → пшениця в коморі", wheat === 6, String(wheat));
  // торкання вільної клітинки → шторка «Будувати тут» → Курник
  await tapTile(p, 17, 16);
  check("торкання вільної клітинки відкрило «Будувати тут»", await p.evaluate(() => KHUTIR.sheetOpen && document.getElementById("shT").textContent.includes("тут")));
  await p.screenshot({ path: OUT + "/2-build.png" });
  const coopBtn = await p.$("#shB button.row:has-text('Курник')");
  await coopBtn.tap(); await p.waitForTimeout(450);
  const coop = await p.evaluate(() => KHUTIR.view.b.find((b) => b.k === "coop"));
  check("курник збудовано на вибраній клітинці", coop && coop.x === 17 && coop.y === 16, JSON.stringify(coop));
  check("курник одразу взяв пшеницю й працює", coop && coop.p >= 0 && (await p.evaluate(() => KHUTIR.view.st.wheat)) === 5);
  // розміщення через 🏗: поле
  await p.evaluate(() => KHUTIR.closeSheet());
  await p.tap("#bBuild"); await p.waitForTimeout(450);
  await (await p.$("#shB button.row:has-text('Поле')")).tap(); await p.waitForTimeout(450);
  check("режим розміщення", await p.evaluate(() => KHUTIR.placing === "field") && await p.isVisible("#place"));
  await tapTile(p, 15, 17);
  check("друге поле стоїть", await p.evaluate(() => KHUTIR.view.b.filter((b) => b.k === "field").length === 2 && !KHUTIR.placing));
  // замовлення: накопичити й віддати
  await p.evaluate(() => KHUTIR.warp(10 * 60e3));
  await p.tap("#bAll"); await p.waitForTimeout(450);
  const before = await p.evaluate(() => ({ c: KHUTIR.view.coins, xp: KHUTIR.view.xp, lv: KHUTIR.view.lv }));
  await p.tap("#bOrders"); await p.waitForTimeout(450);
  await p.screenshot({ path: OUT + "/3-orders.png" });
  const give = await p.$$("#shB button.btn:not(.sec):not([disabled])");
  check("є замовлення, яке можна віддати", give.length > 0, "кнопок: " + give.length);
  if (give.length) await give[0].tap(); await p.waitForTimeout(450);
  const after = await p.evaluate(() => ({ c: KHUTIR.view.coins, xp: KHUTIR.view.xp, lv: KHUTIR.view.lv }));
  check("замовлення дало гроші й досвід", after.c > before.c && (after.xp > before.xp || after.lv > before.lv), JSON.stringify([before, after]));
  // продаж у коморі
  await p.evaluate(() => KHUTIR.closeSheet()); await p.tap("#bStore"); await p.waitForTimeout(450);
  const c1 = await p.evaluate(() => KHUTIR.view.coins);
  const sellBtn = await p.$("#shB button.sell"); if (sellBtn) await sellBtn.tap(); await p.waitForTimeout(150);
  check("продаж на ярмарку додає 💰", (await p.evaluate(() => KHUTIR.view.coins)) > c1);
  await p.screenshot({ path: OUT + "/4-store.png" });
  await p.evaluate(() => KHUTIR.closeSheet());
  // дерево: зрубати
  const tree = await p.evaluate(() => { const s = KHUTIR.view; for (const k in s.ob) if (s.ob[k] === "t") { const i = +k; const x = i % 32, y = Math.floor(i / 32); if (KhutirSim.owned(s, x, y)) return [x, y]; } return null; });
  if (tree) { await tapTile(p, tree[0], tree[1]); check("торкання дерева → колоди", await p.evaluate(() => (KHUTIR.view.st.wood || 0) >= 1)); }
  // перетягування камери не будує й не відкриває шторок
  const cam0 = await p.evaluate(() => ({ ...KHUTIR.cam }));
  const cdp = await p.context().newCDPSession(p);
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
  await touch("touchStart", [{ x: 200, y: 400, id: 1 }]);
  for (let i = 1; i <= 8; i++) await touch("touchMove", [{ x: 200 + i * 15, y: 400 + i * 8, id: 1 }]);
  await touch("touchEnd", []); await p.waitForTimeout(150);
  const cam1 = await p.evaluate(() => ({ ...KHUTIR.cam, sheet: KHUTIR.sheetOpen }));
  check("тягнення пальцем рухає карту без шторок", Math.abs(cam1.x - cam0.x) > 30 && !cam1.sheet, JSON.stringify([cam0.x, cam1.x]));
  // щипок двома пальцями
  await touch("touchStart", [{ x: 150, y: 400, id: 1 }, { x: 240, y: 400, id: 2 }]);
  for (let i = 1; i <= 8; i++) await touch("touchMove", [{ x: 150 - i * 10, y: 400, id: 1 }, { x: 240 + i * 10, y: 400, id: 2 }]);
  await touch("touchEnd", []); await p.waitForTimeout(150);
  const z1 = await p.evaluate(() => KHUTIR.cam.z);
  check("щипок збільшує карту", z1 > cam1.z * 1.3, cam1.z.toFixed(2) + " → " + z1.toFixed(2));
  // збереження + офлайн-прибуток
  await p.evaluate(() => KHUTIR.showMenu());
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem("khutir_solo")));
  check("хутір збережено на телефоні", saved && saved.b.length >= 3);
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem("khutir_solo")); s.t -= 3 * 3600e3; localStorage.setItem("khutir_solo", JSON.stringify(s)); });
  await p.reload(); await p.waitForTimeout(800);
  check("меню показує рівень свого хутора", /рівень/.test(await p.textContent("#mSoloI")));
  await p.tap("#mSolo"); await p.waitForTimeout(400);
  const toastTxt = await p.textContent("#toast");
  check("після 3 год відсутності — «Поки тебе не було: +…»", /Поки тебе не було/.test(toastTxt), toastTxt);
  await p.screenshot({ path: OUT + "/5-back.png" });
  check("соло без JS-помилок", p.errors.length === 0, p.errors.slice(0, 3).join(" ‖ "));

  // ================= СПІЛЬНИЙ =================
  const a = await phone(b, "Влад", { lite: true });
  await a.goto(URL_); await a.waitForTimeout(800);
  await a.tap("#mNew");
  const code = await until(() => a.evaluate(() => KHUTIR.mode === "shared" && KHUTIR.code), 20000);
  check("створено спільний хутір з кодом", !!code && code.length === 6, String(code));
  const c2 = await phone(b, null, { lite: true });
  await c2.goto(URL_); await c2.waitForTimeout(600);
  await c2.fill("#mNick", "Олена К"); await c2.fill("#mCode", code.toLowerCase()); await c2.tap("#mJoin");
  await until(() => c2.evaluate(() => KHUTIR.mode === "shared" && !!KHUTIR.view), 20000);
  check("другий телефон зайшов за кодом", await c2.evaluate(() => KHUTIR.mode === "shared"));
  check("👥 показує двох", !!(await until(() => a.evaluate(() => document.getElementById("hOnN").textContent === "2"), 10000)));
  // A будує курник — B бачить
  await a.evaluate(() => KHUTIR.commit({ t: "build", k: "field", x: 17, y: 17 }));
  check("B бачить поле, яке збудував A", !!(await until(() => c2.evaluate(() => KHUTIR.view.b.some((b) => b.x === 17 && b.y === 17)), 10000)));
  // обидва водночас збирають те саме поле — пшениця не дублюється
  await a.evaluate(() => KHUTIR.warp(70e3)); await c2.evaluate(() => KHUTIR.warp(70e3));
  const fid = await a.evaluate(() => KHUTIR.view.b[0].id);
  await Promise.all([a.evaluate((id) => KHUTIR.commit({ t: "collect", id }), fid), c2.evaluate((id) => KHUTIR.commit({ t: "collect", id }), fid)]);
  await a.waitForTimeout(1500);
  const w2 = await a.evaluate(() => JSON.parse(KHUTIR.S ? JSON.stringify(KHUTIR.S) : "{}").st.wheat || 0);
  const wB = await c2.evaluate(() => KHUTIR.S.st.wheat || 0);
  check("одночасний збір: пшениця зарахована раз (≤ 12)", w2 > 0 && w2 <= 12 && w2 === wB, w2 + " / " + wB);
  // журнал і внески
  await c2.evaluate(() => KHUTIR.commit({ t: "sell", r: "wheat", n: 2 }));
  await a.waitForTimeout(1000);
  await a.tap("#hName"); await a.waitForTimeout(300);
  const farmTxt = await a.textContent("#shB");
  check("у меню хутора: код, хто тут, внески, журнал", farmTxt.includes(code) && farmTxt.includes("Олена К") && farmTxt.includes("збудував"), farmTxt.slice(0, 160));
  await a.screenshot({ path: OUT + "/6-shared.png" });
  // посилання ?farm=КОД
  const d = await phone(b, "Тарас", { lite: true });
  await d.goto(URL_ + "?farm=" + code);
  check("посилання ?farm= одразу відкриває хутір", !!(await until(() => d.evaluate(() => KHUTIR.mode === "shared" && KHUTIR.code), 15000)));
  // неправильний код
  const e = await phone(b, "Петро", { lite: true });
  await e.goto(URL_); await e.waitForTimeout(500);
  await e.fill("#mCode", "ZZZZZZ"); await e.tap("#mJoin"); await e.waitForTimeout(1500);
  check("неіснуючий код — зрозуміла помилка", /нема/.test(await e.textContent("#mErr")));
  for (const [n, q] of [["A", a], ["B", c2], ["посилання", d], ["код", e]]) check("без JS-помилок: " + n, q.errors.length === 0, q.errors.slice(0, 3).join(" ‖ "));
  await b.close();
  const ok = results.filter(Boolean).length; console.log(`\n${ok}/${results.length}`);
  process.exit(ok === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
