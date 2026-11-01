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
  const r1 = await p.evaluate(() => { const c = KHUTIR.commit({ t: "build", k: "mill", x: 25, y: 25 }); return c.ok; });
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
  await (await p.$("#shB button.row:has-text('Стежка')")).tap(); await p.waitForTimeout(400);
  check("режим малювання", await p.evaluate(() => KHUTIR.placing === "deco:path"));
  const n1 = await p.evaluate(() => { let n = 0; for (let x = 18; x < 26; x++) if (KHUTIR.commit({ t: "deco", k: "path", x, y: 19 }).ok) n++; return n; });
  check("стежка намальована", n1 >= 6, String(n1));
  const b0 = await p.evaluate(() => KHUTIR.K.beauty(KHUTIR.view));
  await p.evaluate(() => { for (let x = 17; x < 24; x++) KHUTIR.commit({ t: "fence", x, y: 18, e: 1 }); for (let i = 0; i < 4; i++) KHUTIR.commit({ t: "deco", k: ["flower", "bench", "lantern", "oak"][i], x: 18 + i * 2, y: 20 }); KHUTIR.closeSheet(); });
  const b1 = await p.evaluate(() => [KHUTIR.K.beauty(KHUTIR.view), KHUTIR.K.tier(KHUTIR.view)]);
  check("прикраси дають красу й ступінь", b1[0] > b0 && b1[1] >= 1, JSON.stringify(b1));
  check("на дорозі не можна будувати", await p.evaluate(() => { const d = Object.keys(KHUTIR.view.d)[0], x = d % 48, y = Math.floor(d / 48); return !KHUTIR.commit({ t: "build", k: "well", x, y }).ok; }));
  // скасування: будівля повертає всі гроші
  const un = await p.evaluate(() => { const v = KHUTIR.view; let t = null; for (let y = 16; y < 28 && !t; y++) for (let x = 16; x < 28 && !t; x++) if (!KHUTIR.K.at(v, x, y) && !v.ob[KHUTIR.K.idx(x, y)] && !v.d[KHUTIR.K.idx(x, y)]) t = [x, y]; const c0 = v.coins; KHUTIR.commit({ t: "build", k: "well", x: t[0], y: t[1] }); return [c0, t]; });
  await p.tap("#placeU"); await p.waitForTimeout(300);
  check("скасування будівлі повернуло все", await p.evaluate(([c0, t]) => KHUTIR.view.coins === c0 && !KHUTIR.K.at(KHUTIR.view, t[0], t[1]), un));
  // «Назад»: шторка закривається, гра лишається
  await p.evaluate(() => KHUTIR.go("store")); await p.waitForTimeout(300);
  await p.touchscreen.tap(195, 140); await p.goBack({ waitUntil: "commit" }).catch(() => {}); await p.waitForTimeout(500);
  check("«Назад» закрив шторку й лишив у грі", await p.evaluate(() => !!window.KHUTIR && !KHUTIR.sheetOpen && KHUTIR.mode === "solo"));
  // тин лежить на межі: клітинка під ним вільна, а селянин його обходить
  check("тин не займає клітинку", await p.evaluate(() => { const v = KHUTIR.view; return Object.keys(v.f).length > 0 && !Object.values(v.d).includes("fence"); }));
  const walk = await p.evaluate(() => { const uid = Object.keys(KHUTIR.view.vl)[0], s = KHUTIR.view, busy = new Set(s.b.map((b) => b.x + ":" + b.y)), legs = KHUTIR.villLegs(uid); let bad = 0, n = 0; for (const l of legs) for (const q of l.slice(1, -1)) { n++; if (busy.has(q[0] + ":" + q[1])) bad++; } return [n, bad]; });
  check("селянин не йде крізь будівлі", walk[0] > 0 && walk[1] === 0, JSON.stringify(walk));
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
