// Хутір: посів, черга, прикраси, торговець, скидання старих хуторів, спільний хутір.
// node khutir-test.js   (симулятор має бути запущений: node server.js)
const { launch, phone, BASE } = require("./harness");
const OUT = process.env.OUT || "out/khutir"; require("fs").mkdirSync(OUT, { recursive: true });
const URL_ = BASE + "/ads/khutir/play.html"; let fails = 0;
const check = (n, ok, x) => { if (!ok) fails++; console.log(`${ok ? "✅" : "❌"} ${n}${x ? " — " + x : ""}`); };
const until = async (fn, ms = 15000) => { const e = Date.now() + ms; while (Date.now() < e) { const r = await fn(); if (r) return r; await new Promise((s) => setTimeout(s, 200)); } return false; };
const tapTile = async (p, x, y) => { await p.evaluate(([x, y]) => { KHUTIR.focus(x, y); KHUTIR.tapTile(x, y); }, [x, y]); await p.waitForTimeout(450); };
(async () => {
  const b = await launch();
  const p = await phone(b, null, { lite: true });
  // старе соло-збереження не підхоплюється
  await p.goto(URL_); await p.evaluate(() => localStorage.setItem("khutir_solo", JSON.stringify({ v: 1, lv: 11, coins: 17000, b: [] }))); await p.reload(); await p.waitForTimeout(800);
  check("старе соло не показане", /почати/.test(await p.textContent("#mSoloI")));
  await p.tap("#mSolo"); await until(() => p.evaluate(() => KHUTIR.mode === "solo" && !!KHUTIR.view));
  const v0 = await p.evaluate(() => ({ c: KHUTIR.view.coins, ch: KHUTIR.view.ch.length, f: KHUTIR.view.b[0], n: KHUTIR.K.N }));
  check("старт: 100 💰, земля 3×3, карта 48", v0.c === 100 && v0.ch === 9 && v0.n === 48, JSON.stringify(v0));
  // пшениця дозріває, збір, посів вибором
  await p.evaluate(() => KHUTIR.warp(125e3)); await p.waitForTimeout(300);
  await p.tap("#bAll"); await p.waitForTimeout(400);
  const wh = await p.evaluate(() => KHUTIR.view.st.wheat || 0);
  check("пшениця зібрана, селянин теж носить", wh >= 3, String(wh));
  check("«Зібрати» знову посіяло поле", await p.evaluate(() => KHUTIR.view.b[0].p >= 0));
  await p.evaluate(() => { const v = KHUTIR.S; v.lv = 12; v.coins = 50000; v.st = { wheat: 20, corn: 20, flour: 5, egg: 5 }; for (const b of v.b) if (b.k === "field") { b.p = -1; b.buf = 0; } KHUTIR.refresh(); });
  await tapTile(p, v0.f.x, v0.f.y);
  await p.screenshot({ path: OUT + "/1-sow.png" });
  check("порожнє поле питає, що сіяти", await p.isVisible("#shB button.row:has-text('Гарбуз')"));
  await (await p.$("#shB button.row:has-text('Гарбуз')")).tap(); await p.waitForTimeout(500);
  check("посіяв гарбуз", await p.evaluate(() => KHUTIR.view.b[0].cr === "pump" && KHUTIR.view.b[0].p >= 0));
  // будівля: сировина береться лише чергою
  const r1 = await p.evaluate(() => { const v = KHUTIR.view; let t = null; for (let y = 27; y > 16 && !t; y--) for (let x = 27; x > 16 && !t; x--) if (!KHUTIR.K.at(v, x, y) && !v.ob[KHUTIR.K.idx(x, y)] && !v.d[KHUTIR.K.idx(x, y)]) t = [x, y]; const c = KHUTIR.commit({ t: "build", k: "mill", x: t[0], y: t[1] }); KHUTIR.commit({ t: "noq", id: KHUTIR.view.b.find((b) => b.k === "mill").id, on: false }); return c.ok; });
  const m0 = await p.evaluate(() => ({ w: KHUTIR.view.st.wheat, m: KHUTIR.view.b.find((b) => b.k === "mill") }));
  check("млин не бере пшеницю сам", r1 && m0.w === 20 && m0.m.p < 0, JSON.stringify(m0));
  const q = await p.evaluate(() => { const id = KHUTIR.view.b.find((b) => b.k === "mill").id, o = []; for (let i = 0; i < 3; i++) o.push(KHUTIR.commit({ t: "queue", id }).ok); return o; });
  check("черга млина на 2", q[0] && q[1] && !q[2], JSON.stringify(q));
  check("черга забрала 4 пшениці", (await p.evaluate(() => KHUTIR.view.st.wheat)) === 16);
  await p.evaluate(() => KHUTIR.warp(1205e3)); await p.waitForTimeout(300);
  check("черга відпрацювала: 2 борошна", await p.evaluate(() => { const m = KHUTIR.view.b.find((b) => b.k === "mill"); return m.buf + KHUTIR.view.st.flour >= 7 && m.p < 0; }));
  // прикраси: малювання пальцем
  await p.evaluate(() => KHUTIR.closeSheet()); await p.tap("#bBuild"); await p.waitForTimeout(400);
  await p.screenshot({ path: OUT + "/2-build.png" });
  await p.waitForTimeout(250); await p.tap("[data-tab=deco]"); await p.waitForTimeout(300);
  await (await p.$("#shB button.row:has-text('Стежка')")).tap(); await p.waitForTimeout(400);
  check("режим малювання", await p.evaluate(() => KHUTIR.placing === "deco:path"));
  const n1 = await p.evaluate(() => { let n = 0; for (let x = 18; x < 26; x++) if (KHUTIR.commit({ t: "deco", k: "path", x, y: 19 }).ok) n++; return n; });
  check("стежка намальована", n1 >= 6, String(n1));
  const b0 = await p.evaluate(() => KHUTIR.K.beauty(KHUTIR.view));
  await p.evaluate(() => { for (let x = 17; x < 24; x++) KHUTIR.commit({ t: "fence", x, y: 18, e: 1 }); for (let i = 0; i < 4; i++) KHUTIR.commit({ t: "deco", k: ["flower", "bench", "lantern", "oak"][i], x: 18 + i * 2, y: 20 }); KHUTIR.closeSheet(); });
  const b1 = await p.evaluate(() => [KHUTIR.K.beauty(KHUTIR.view), KHUTIR.K.tier(KHUTIR.view)]);
  check("прикраси дають красу й ступінь", b1[0] > b0 && b1[1] >= 1, JSON.stringify(b1));
  check("на дорозі не можна будувати", await p.evaluate(() => { const d = Object.keys(KHUTIR.view.d)[0], x = d % 48, y = Math.floor(d / 48); return !KHUTIR.commit({ t: "build", k: "well", x, y }).ok; }));
  // «Постійно»: поле сіється само
  const au = await p.evaluate(() => { const c = KHUTIR.S, f = c.b.find((b) => b.k === "field"); KHUTIR.commit({ t: "auto", id: f.id, on: true }); const q = KHUTIR.S.b.find((b) => b.k === "field"); q.cr = "wheat"; q.p = -1; q.buf = 3; KHUTIR.refresh(); KHUTIR.commit({ t: "collect", id: q.id }); return KHUTIR.view.b.find((b) => b.id === q.id).p >= 0; });
  check("«Постійно» пересіяло поле після збору", au);
  // режим будування: Назад / Вперед
  const free1 = await p.evaluate(() => { const v = KHUTIR.view, o = []; for (let y = 16; y < 28; y++) for (let x = 16; x < 28; x++) if (!KHUTIR.K.at(v, x, y) && !v.ob[KHUTIR.K.idx(x, y)] && !v.d[KHUTIR.K.idx(x, y)]) o.push([x, y]); return [o[0], o[5], v.coins]; });
  await p.evaluate(() => document.getElementById("placeX").click());
  await p.tap("#mBuild"); await p.waitForTimeout(400);
  await p.tap("[data-tab=farm]"); await p.waitForTimeout(300);
  await (await p.$("#shB button.row:has(b:text-is('Криниця'))")).tap(); await p.waitForTimeout(450);
  await p.evaluate((t) => KHUTIR.tapTile(t[0], t[1]), free1[0]); await p.waitForTimeout(250);
  check("будівля стоїть, режим лишається", await p.evaluate((t) => !!KHUTIR.K.at(KHUTIR.view, t[0], t[1]) && KHUTIR.buildOn && KHUTIR.placing === "well", free1[0]));
  await p.tap("#mUndo"); await p.waitForTimeout(250);
  check("Назад: будівлі нема, гроші повернуто", await p.evaluate(([t, , c]) => !KHUTIR.K.at(KHUTIR.view, t[0], t[1]) && KHUTIR.view.coins === c, free1));
  await p.tap("#mRedo"); await p.waitForTimeout(250);
  check("Вперед: будівля знову стоїть", await p.evaluate((t) => !!KHUTIR.K.at(KHUTIR.view, t[0], t[1]), free1[0]));
  await p.tap("#mUndo"); await p.waitForTimeout(200); await p.tap("#mRedo"); await p.waitForTimeout(200);
  // кувалда й Назад повертають будівлю з рівнем
  await p.evaluate((t) => { KHUTIR.S.b.find((b) => b.x === t[0] && b.y === t[1]).lv = 3; KHUTIR.refresh(); }, free1[0]);
  await p.tap("#mHammer"); await p.waitForTimeout(200);
  const hs = await p.evaluate((t) => { KHUTIR.focus(t[0], t[1]); return KHUTIR.screenOf(t[0], t[1]); }, free1[0]); await p.waitForTimeout(150);
  await p.mouse.click(hs[0], hs[1]); await p.waitForTimeout(350);
  check("кувалда прибрала будівлю", await p.evaluate((t) => !KHUTIR.K.at(KHUTIR.view, t[0], t[1]), free1[0]));
  await p.tap("#mUndo"); await p.waitForTimeout(300);
  check("Назад повернув будівлю з її рівнем", await p.evaluate((t) => (KHUTIR.K.at(KHUTIR.view, t[0], t[1]) || {}).lv === 3, free1[0]));
  // рух: перетягування будівлі
  await p.tap("#mMove"); await p.waitForTimeout(200);
  const ms = await p.evaluate(([a, b]) => { KHUTIR.focus(a[0], a[1]); KHUTIR.cam.z = 1; return [KHUTIR.screenOf(a[0], a[1]), KHUTIR.screenOf(b[0], b[1])]; }, free1); await p.waitForTimeout(150);
  const mt = await p.evaluate(([a]) => KHUTIR.screenOf(a[0], a[1]), free1);
  await p.mouse.move(mt[0], mt[1]); await p.mouse.down(); await p.mouse.move(ms[1][0], ms[1][1], { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(350);
  check("будівля перетягнута", await p.evaluate(([a, b]) => !KHUTIR.K.at(KHUTIR.view, a[0], a[1]) && !!KHUTIR.K.at(KHUTIR.view, b[0], b[1]), free1));
  await p.tap("#mUndo"); await p.waitForTimeout(250);
  check("Назад повернув на місце", await p.evaluate(([a]) => !!KHUTIR.K.at(KHUTIR.view, a[0], a[1]), free1));
  await p.tap("#mDone"); await p.waitForTimeout(250);
  check("Готово: звичайна панель", await p.evaluate(() => !KHUTIR.buildOn) && await p.isVisible("#bBuild"));
  // «Назад»: шторка закривається, гра лишається
  await p.evaluate(() => KHUTIR.go("store")); await p.waitForTimeout(300);
  await p.touchscreen.tap(195, 140); await p.goBack({ waitUntil: "commit" }).catch(() => {}); await p.waitForTimeout(500);
  check("«Назад» закрив шторку й лишив у грі", await p.evaluate(() => !!window.KHUTIR && !KHUTIR.sheetOpen && KHUTIR.mode === "solo"));
  // тин лежить на межі: клітинка під ним вільна, а селянин його обходить
  check("тин не займає клітинку", await p.evaluate(() => { const v = KHUTIR.view; return Object.keys(v.f).length > 0 && !Object.values(v.d).includes("fence"); }));
  const walk = await p.evaluate(() => { const uid = Object.keys(KHUTIR.view.vl)[0], s = KHUTIR.view, busy = new Set(s.b.filter((b) => b.k !== "field").map((b) => b.x + ":" + b.y)), legs = KHUTIR.villLegs(uid); let bad = 0, n = 0; for (const l of legs) for (const q of l.slice(1, -1)) { n++; if (busy.has(q[0] + ":" + q[1])) bad++; } return [n, bad]; });
  check("селянин не йде крізь будівлі", walk[0] > 0 && walk[1] === 0, JSON.stringify(walk));
  // тин прибирається дотиком по самому тину
  const fp = await p.evaluate(() => { const k = +Object.keys(KHUTIR.view.f)[3], e = k % 2, i = (k - e) / 2, x = i % 48, y = Math.floor(i / 48); KHUTIR.focus(x, y); const a = KHUTIR.screenOf(x + 0.5, y + 0.5), b = KHUTIR.screenOf(x - 0.5, y + 0.5); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 8 * KHUTIR.cam.z, Object.keys(KHUTIR.view.f).length, x, y, e]; });
  await p.waitForTimeout(200); await p.touchscreen.tap(fp[0], fp[1]); await p.waitForTimeout(500);
  check("дотик по тину відкрив вікно прибирання", await p.isVisible("#fenceAll"), JSON.stringify(fp));
  await p.waitForTimeout(300); await p.tap("#fenceAll"); await p.waitForTimeout(500);
  check("уся лінія тину прибрана", await p.evaluate(() => Object.keys(KHUTIR.view.f).length === 0));
  await p.evaluate(() => { KHUTIR.commit({ t: "fence", x: 20, y: 18, e: 1 }); KHUTIR.closeSheet(); });
  // тин: чернетка з кутом, гроші лише після підтвердження
  await p.evaluate(() => { KHUTIR.closeSheet(); KHUTIR.focus(22, 20); KHUTIR.cam.z = 1.4; }); await p.tap("#bBuild"); await p.waitForTimeout(400);
  await p.tap("[data-tab=deco]"); await p.waitForTimeout(300);
  await (await p.$("#shB button.row:has(b:text-is('Тин'))")).tap(); await p.waitForTimeout(400);
  const c1 = await p.evaluate(() => KHUTIR.view.coins);
  const pt = await p.evaluate(() => [[21.5, 21.5], [24.5, 21.5], [24.5, 24.5]].map(([x, y]) => KHUTIR.screenOf(x, y)));
  await p.mouse.move(pt[0][0], pt[0][1]); await p.mouse.down(); await p.mouse.move(pt[1][0], pt[1][1], { steps: 8 }); await p.mouse.move(pt[2][0], pt[2][1], { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + "/5-fence.png" });
  check("кут за один рух: 6 секцій, гроші не списані", await p.evaluate((c) => KHUTIR.draftN === 6 && KHUTIR.view.coins === c, c1), String(await p.evaluate(() => KHUTIR.draftN)));
  await p.tap("#placeOk"); await p.waitForTimeout(400);
  check("«Поставити» списало за 6 секцій", await p.evaluate((c) => KHUTIR.view.coins === c - 48, c1));
  await p.tap("#mUndo"); await p.waitForTimeout(300);
  check("Назад повернув усі гроші за тин", await p.evaluate((c) => KHUTIR.view.coins === c, c1));
  await p.tap("#mDone"); await p.waitForTimeout(300);
  // селянин веде чергу й відпочиває
  const vq = await p.evaluate(() => { const K = KHUTIR.K, s = K.create(5, "t"); s.lv = 5; let t = 1.8e12; K.advance(s, t); K.addVillager(s, "me", "V"); s.coins = 5000; s.st = { wheat: 50 };
    K.act(s, { t: "build", k: "mill", x: 21, y: 23 }, t, "V"); const m = s.b.find((b) => b.k === "mill"); t += 60e3; K.advance(s, t); const q1 = (m.qn || 0) + (m.p >= 0 ? 1 : 0);
    const spot = [20, 23]; K.act(s, { t: "deco", k: "hay", x: spot[0], y: spot[1] }, t, "V"); const v = s.vl.me; v.m = 31; t += 3600e3; K.advance(s, t); return [q1, s.st.wheat < 50, v.m]; });
  check("селянин сам поставив млин у чергу", vq[0] > 0 && vq[1], JSON.stringify(vq));
  check("настрій відновлюється відпочинком", vq[2] > 31, String(vq[2]));
  // швидкість стала: час обходу пропорційний довжині шляху
  const sp = await p.evaluate(() => { const K = KHUTIR.K, s = KHUTIR.view, u = Object.keys(s.vl)[0], r = K.routes(s)[u], pl = K.walkPlan(s, u, r), len = pl.legs.reduce((a, l) => a + l.len, 0); return [pl.ms, (len / K.WALK) * 1000 + K.PAUSE * pl.legs.length]; });
  check("час обходу = довжина шляху / швидкість", Math.abs(sp[0] - sp[1]) < 1, JSON.stringify(sp));
  // торговець
  await p.evaluate(() => { KHUTIR.commit({ t: "build", k: "market", x: 24, y: 24 }); const t = Date.now() + 0, every = 3 * 3600e3, ph = t % every; if (ph >= 80 * 60e3) KHUTIR.warp(every - ph + 60e3); KHUTIR.S.st.wheat = 60; KHUTIR.refresh(); });
  const m = await p.evaluate(() => KHUTIR.K.market(KHUTIR.view, KHUTIR.view.t));
  check("торговець приїхав", m && m.here && m.o.length >= 3, JSON.stringify(m).slice(0, 160));
  await p.waitForTimeout(400); await p.evaluate(() => KHUTIR.focus(24, 24)); await tapTile(p, 24, 24); await p.screenshot({ path: OUT + "/3-market.png" });
  check("шторка ринку показує торговця", /Торговець із/.test(await p.textContent("#shB")));
  const buy = await p.evaluate(() => { const v = KHUTIR.view, m = KHUTIR.K.market(v, v.t), i = m.o.findIndex((o) => o.d), r = KHUTIR.commit({ t: "mk", i }); return [r.ok, m.o[i].d, Object.values(KHUTIR.view.inv)[0]]; });
  check("купив рідкісну прикрасу", buy[0] && buy[2] === 1, JSON.stringify(buy));
  await p.evaluate(() => { KHUTIR.closeSheet(); KHUTIR.focus(22, 21); KHUTIR.cam.z = 1.5; }); await p.waitForTimeout(600); await p.screenshot({ path: OUT + "/4-farm.png" });
  check("соло без JS-помилок", !p.errors.length, p.errors.slice(0, 2).join(" | "));
  // спільний хутір: старий скидається, дії двох телефонів не губляться
  const a = await phone(b, "влад", { lite: true }), c = await phone(b, "оля", { lite: true });
  await a.goto(URL_); await a.waitForTimeout(800); await a.fill("#mCode", "").catch(() => {});
  await a.tap("#mNew"); await until(() => a.evaluate(() => KHUTIR.mode === "shared" && !!KHUTIR.view));
  const code = await a.evaluate(() => KHUTIR.code);
  await a.evaluate(() => KHUTIR.commit({ t: "deco", k: "path", x: 20, y: 20 }));
  await c.goto(URL_ + "?farm=" + code); await until(() => c.evaluate(() => KHUTIR.mode === "shared" && !!KHUTIR.view));
  await until(() => c.evaluate(() => !!KHUTIR.view.d && Object.keys(KHUTIR.view.d).length === 1));
  await Promise.all([a.evaluate(() => KHUTIR.commit({ t: "deco", k: "path", x: 21, y: 20 })), c.evaluate(() => KHUTIR.commit({ t: "deco", k: "path", x: 22, y: 20 }))]);
  check("дві одночасні дії збереглися", await until(() => a.evaluate(() => Object.keys(KHUTIR.view.d).length === 3)));
  await a.evaluate((c) => firebase.database().ref("khutir/" + c + "/s").set(JSON.stringify({ v: 1, nm: "Старий", own: "x", lv: 9, coins: 999, b: [], ch: [], ob: {}, o: [], st: {} })), code);
  await c.waitForTimeout(800); const c2 = await phone(b, "петро", { lite: true });
  await c2.goto(URL_ + "?farm=" + code);
  const o = await until(() => c2.evaluate(() => KHUTIR.mode === "shared" && KHUTIR.view && KHUTIR.view.v === 2 && [KHUTIR.view.nm, KHUTIR.view.coins]));
  check("старий спільний хутір почався заново, назва лишилась", o && o[0] === "Старий" && o[1] === 100, JSON.stringify(o));
  await b.close(); console.log(fails ? `\n❌ невдач: ${fails}` : "\n✅ усе пройшло"); process.exit(fails ? 1 : 0);
})();
