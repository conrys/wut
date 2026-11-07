// Кошмар наяву: майстер + 2 гравці на окремих «телефонах».
// Лобі й вибір героя, перевірка з кидком, бій (рух дотиками, атака при нагоді, лук, Палючі долоні, урок),
// авто-хід вовків, 0 хітів і кидок від смерті, майстер перезавантажує сторінку й продовжує гру. Без JS-помилок.
// node dnd-test.js   (симулятор має бути запущений: node server.js)
const { launch, phone, BASE } = require("./harness");
const URL_ = BASE + "/ads/dnd/play.html";
const results = [];
function check(name, ok, extra) { results.push(ok); console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); }
const until = async (fn, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { const r = await fn().catch(() => null); if (r) return r; await new Promise((x) => setTimeout(x, 250)); } return null; };
// гравець прочитав усі уроки (картка уроку лежить над мапою)
const dismiss = async (p) => { for (let i = 0; i < 6; i++) { const v = await p.evaluate(() => !document.getElementById("lesson").hidden); if (!v) return; await p.click("#lesOk"); } };
const tap = async (p, x, y) => { await dismiss(p); const c = await p.evaluate(([x, y]) => DNDGame.cell(x, y), [x, y]); await p.mouse.click(c.x, c.y); };
// майстер правит стан напряму (як тестовий «бог») і розсилає
const dmSet = (dm, fn, arg) => dm.evaluate(([src, arg]) => { const E = DNDGame.E; (0, eval)('(' + src + ')')(E.G, E, arg); E.dirty = true; DNDGame.tick(); }, [fn.toString(), arg]);

(async () => {
  const b = await launch();
  const dm = await phone(b, "dm_vlad", { lite: true });
  await dm.goto(URL_);
  await until(() => dm.evaluate(() => !document.getElementById("btnDm").disabled));
  await dm.fill("#dmName", "Влад");
  await dm.click("#btnDm");
  const code = await until(() => dm.evaluate(() => { const c = document.getElementById("lobCode").textContent; return /^[A-Z]{4}$/.test(c) && c; }));
  check("майстер створив гру з кодом", !!code, code);

  const pls = [];
  for (const [name, cls] of [["Ліса", "rogue"], ["Корвін", "wizard"]]) {
    const p = await phone(b, "u_" + cls, { lite: true });
    await p.goto(URL_);
    await until(() => p.evaluate(() => !document.getElementById("btnPl").disabled));
    await p.fill("#plName", name); await p.fill("#plCode", code); await p.click("#btnPl");
    await until(() => p.evaluate(() => !document.getElementById("lobby").hidden && document.querySelectorAll("[data-cls]").length === 5));
    await p.click(`[data-cls="${cls}"]`);
    pls.push(p);
  }
  const [lisa, kor] = pls;
  const taken = await until(() => kor.evaluate(() => document.querySelector('[data-cls="rogue"]').disabled));
  check("зайнятий герой недоступний іншому гравцю", !!taken);
  await until(() => dm.evaluate(() => !document.getElementById("lobStart").disabled && Object.keys(DNDGame.E.G.chars).length === 2));
  await dm.click("#lobStart");
  const started = await until(() => Promise.all(pls.map((p) => p.evaluate(() => !document.getElementById("app").hidden))).then((a) => a.every(Boolean)));
  check("пригода почалась на всіх телефонах", !!started);
  check("уроки «перевірка» і «без кидка» — ще не показані до потреби", await dm.evaluate(() => DNDGame.E.G.seen.length === 0));

  // ---- перевірка з готового сценарію
  await dm.click('[data-scene="1"]');
  await until(() => dm.evaluate(() => DNDGame.E.G.sc === 1));
  await dm.click('[data-ask="d_insight"]');
  await dm.click('[data-who="ліса"]');
  await dm.click('[data-cfgsend="1"]');
  const prompt = await until(() => lisa.evaluate(() => !document.getElementById("modal").hidden && !!document.getElementById("rollBtn2")));
  check("Ліса бачить запит перевірки з кнопкою кидка", !!prompt);
  await lisa.screenshot({ path: __dirname + "/shots/dnd-check.png" }).catch(() => {});
  await dm.screenshot({ path: __dirname + "/shots/dnd-dm-scene.png", fullPage: false }).catch(() => {});
  const breakdown = await lisa.evaluate(() => document.getElementById("modalSheet").textContent);
  check("у запиті видно стат і складність", /Проникливість/.test(breakdown) && /Мудрість \+1/.test(breakdown) && /Складність 12/.test(breakdown));
  check("Корвіну перевірка не прийшла", await kor.evaluate(() => document.getElementById("modal").hidden));
  await lisa.click("#rollBtn2");
  const res = await until(() => dm.evaluate(() => { const ck = DNDGame.E.G.ck; return ck && ck.done && ck.res["ліса"]; }));
  check("кидок дійшов до майстра і перевірку завершено", !!res, res && `к20=${res.v}, разом ${res.tot}`);
  const outcome = await dm.evaluate(() => document.getElementById("main").textContent);
  check("майстер бачить, що казати гравцям (успіх або провал)", /Успіх:|Провал:/.test(outcome));
  const lesShown = await until(() => lisa.evaluate(() => !document.getElementById("lesson").hidden && /Перевірка навички/.test(document.getElementById("lesson").textContent)));
  check("гравцям показано урок «Перевірка навички»", !!lesShown);
  await dm.click('[data-ckclose="1"]');
  await until(() => lisa.evaluate(() => document.getElementById("modal").hidden));

  // ---- групова перевірка: майстер кидає за гравця
  await dm.click('[data-ask=""]');
  await dm.click('[data-kind="sv"]'); await dm.selectOption("#cfgKey", "con");
  await dm.click('[data-whoall="1"]'); await dm.click('[data-mode="group"]'); await dm.click('[data-cfgsend="1"]');
  await dm.click('[data-rollfor="ліса"]'); await dm.click('[data-rollfor="корвін"]');
  const grp = await until(() => dm.evaluate(() => DNDGame.E.G.ck && DNDGame.E.G.ck.done && typeof DNDGame.E.G.ck.gok === "boolean"));
  check("своя групова перевірка (рятівний Статури), майстер кинув за обох", !!grp);
  await dm.click('[data-ckclose="1"]');

  // ---- бій із вовками
  await dm.click('[data-scene="2"]');
  await until(() => dm.evaluate(() => DNDGame.E.G.sc === 2));
  await dm.click('[data-fight="wolves"]');
  const onMap = await until(() => lisa.evaluate(() => DNDGame.U.tab === "map" && !document.getElementById("mapBox").hidden));
  check("бій почався — у гравців відкрилась мапа", !!onMap);
  check("вовків стільки ж, скільки гравців (2)", await dm.evaluate(() => Object.values(DNDGame.E.G.cb.tk).filter((t) => t.mt === "wolf").length === 2));
  // ставимо всіх на позиції і даємо хід Лісі
  await dmSet(dm, (g, E) => {
    const tk = g.cb.tk; Object.assign(tk["p_ліса"], { x: 5, y: 8 }); Object.assign(tk["p_корвін"], { x: 8, y: 13 });
    Object.assign(tk.m0, { x: 6, y: 8, hp: 11, react: 1 }); Object.assign(tk.m1, { x: 1, y: 2 });
    g.cb.turn = g.cb.order.indexOf("p_ліса"); Object.assign(tk["p_ліса"], { mv: 6, act: 1, bon: 1, atkLeft: 0 });
    g.chars["ліса"].hp = 17;
  });
  const myTurn = await until(() => lisa.evaluate(() => !!DNDGame.ctl() && /Рух/.test(document.getElementById("act").textContent)));
  check("у Ліси її хід і панель дій", !!myTurn);
  check("у Корвіна не його хід", await kor.evaluate(() => !DNDGame.ctl()));
  await lisa.waitForTimeout(400);
  await tap(lisa, 4, 11);
  const warn = await until(() => lisa.evaluate(() => /Атака при нагоді/.test(document.getElementById("act").textContent)));
  check("перед рухом попередження про атаку при нагоді", !!warn);
  await tap(lisa, 4, 11);
  const moved = await until(() => dm.evaluate(() => { const t = DNDGame.E.G.cb.tk["p_ліса"]; return (t.x === 4 && t.y === 11) || DNDGame.E.G.chars["ліса"].hp <= 0 ? t : null; }));
  check("Ліса пішла другим дотиком", !!moved);
  check("вовк ударив при нагоді", await dm.evaluate(() => DNDGame.E.G.cb.tk.m0.react === 0 && DNDGame.E.G.log.some((e) => /бʼє при нагоді/.test(e.t))));
  check("урок «Атака при нагоді»", await until(() => lisa.evaluate(() => DNDGame.G.seen.includes("oa"))));
  // лук: торкнутись вовка → підтвердження «Атака»
  await dmSet(dm, (g) => { Object.assign(g.cb.tk.m0, { x: 4, y: 3 }); g.chars["ліса"].hp = 17; });
  await until(() => lisa.evaluate(() => DNDGame.G.cb.tk.m0.y === 3));
  await lisa.click('[data-a="w1"]');
  await lisa.waitForTimeout(300);
  await tap(lisa, 4, 3);
  const conf = await until(() => lisa.evaluate(() => !!document.querySelector('[data-a="fire"]')));
  check("обрано лук — ціль підсвічено, є кнопка «Атака»", !!conf);
  await lisa.screenshot({ path: __dirname + "/shots/dnd-aim.png" }).catch(() => {});
  await lisa.click('[data-a="fire"]');
  const shot = await until(() => dm.evaluate(() => DNDGame.E.G.log.some((e) => e.r && /Короткий лук/.test(e.r.lbl))));
  check("кидок атаки луком у журналі", !!shot);
  const toastSeen = await until(() => kor.evaluate(() => !document.getElementById("toast").hidden && /Короткий лук/.test(document.getElementById("toast").textContent)));
  check("Корвін бачить кидок Ліси у спливашці", !!toastSeen);
  await lisa.click('[data-a="end"]');
  await until(() => dm.evaluate(() => DNDGame.E.cur(DNDGame.E.G).id !== "p_ліса"));

  // ---- Корвін: Палючі долоні через дотики
  await dmSet(dm, (g) => {
    const tk = g.cb.tk; Object.assign(tk["p_корвін"], { x: 5, y: 10, mv: 6, act: 1, bon: 1, atkLeft: 0 }); Object.assign(tk.m0, { x: 5, y: 8, hp: 11 }); Object.assign(tk["p_ліса"], { x: 9, y: 13 });
    g.cb.turn = g.cb.order.indexOf("p_корвін"); g.chars["корвін"].slots = 3;
  });
  await until(() => kor.evaluate(() => !!DNDGame.ctl()));
  await kor.click('[data-a="shands"]');
  await kor.waitForTimeout(300);
  await dismiss(kor);
  await tap(kor, 5, 8);
  const castBtn = await until(() => kor.evaluate(() => { const b = document.querySelector('[data-a="cast"]'); return b && !b.disabled && /У зоні: 1/.test(document.getElementById("act").textContent); }));
  await kor.screenshot({ path: __dirname + "/shots/dnd-cone.png" }).catch(() => {});
  check("конус Палючих долонь показує, скільки істот у зоні", !!castBtn, castBtn ? "" : await kor.evaluate(() => JSON.stringify({ sel: DNDGame.U.sel, mode: DNDGame.U.mode, sp: DNDGame.U.sp, act: document.getElementById("act").textContent.slice(0, 160) })));
  await kor.click('[data-a="cast"]');
  const burned = await until(() => dm.evaluate(() => DNDGame.E.G.chars["корвін"].slots === 2 && DNDGame.E.G.log.some((e) => e.r && /Рятівний Спритність/.test(e.r.lbl))));
  check("заклинання витратило комірку, вовк кидав рятівний Спритності", !!burned);
  await kor.click('[data-a="end"]');

  // ---- авто-хід вовків
  await dm.evaluate(() => { DNDGame.E.delay = 150; });
  await dmSet(dm, (g) => { g.cb.auto = true; });
  const autoRan = await until(() => dm.evaluate(() => { const c = DNDGame.E.cur(DNDGame.E.G); return c && c.ch; }), 20000);
  check("з «Монстри самі» вовки походили й хід повернувся героям", !!autoRan);

  // ---- 0 хітів → кидок від смерті
  await dmSet(dm, (g, E) => {
    g.cb.auto = false; g.cb.won = false; g.cb.lost = false;
    g.chars["ліса"].hp = 0; g.chars["ліса"].ds = { s: 0, f: 0 }; g.chars["ліса"].dead = false; g.chars["ліса"].stable = false;
    g.chars["корвін"].hp = 12;
    g.cb.turn = g.cb.order.indexOf("p_ліса"); Object.assign(g.cb.tk["p_ліса"], { act: 1, bon: 1, mv: 6, atkLeft: 0 });
    if (!g.cb.order.some((id) => g.cb.tk[id].mt && g.cb.tk[id].hp > 0)) g.cb.tk.m1.hp = 11;
  });
  const ds = await until(() => lisa.evaluate(() => !!document.querySelector('[data-a="death"]')));
  check("без тями — лише «Кидок від смерті» і «Кінець ходу»", !!ds);
  await lisa.click('[data-a="death"]');
  const dsr = await until(() => dm.evaluate(() => { const c = DNDGame.E.G.chars["ліса"]; return c.ds.s + c.ds.f > 0 || c.hp > 0 ? c : null; }));
  check("кидок від смерті зараховано", !!dsr, dsr && JSON.stringify(dsr.ds));

  // ---- майстер перезавантажився — гра продовжується
  await dm.reload();
  await until(() => dm.evaluate(() => !document.getElementById("btnResume").hidden && !document.getElementById("btnResume").disabled && !document.getElementById("btnDm").disabled));
  await dm.click("#btnResume");
  const back = await until(() => lisa.evaluate(() => DNDGame.G && DNDGame.G.log.some((e) => /Майстер повернувся/.test(e.t)) && !!DNDGame.G.cb));
  check("майстер перезапустив сторінку і продовжив гру з тим самим боєм", !!back);
  await dm.evaluate(() => DNDGame.send({ t: "fightend" }));
  const ended = await until(() => kor.evaluate(() => !DNDGame.G.cb && DNDGame.U.tab !== "map"));
  check("бій завершено — у гравців знову пригода", !!ended);
  // герой і правила відкриваються, стат пояснюється
  await kor.click('[data-tab="hero"]');
  await kor.click('[data-stat="int"]');
  check("лист героя: торкання стату пояснює його", await kor.evaluate(() => !document.getElementById("pop").hidden && /Магія/.test(document.getElementById("popSheet").textContent)));
  await kor.click('[data-popclose="1"]');
  for (const t of ["party", "memo", "scene"]) await dm.click(`[data-tab="${t}"]`);
  // скріншоти для перевірки очима
  await lisa.screenshot({ path: __dirname + "/shots/dnd-player.png" }).catch(() => {});

  const errs = [dm, ...pls].flatMap((p) => p.errors);
  check("жодної JS-помилки на трьох телефонах", errs.length === 0, errs.slice(0, 5).join(" || "));
  const okN = results.filter(Boolean).length;
  console.log(`\n${okN}/${results.length} перевірок`);
  await b.close();
  process.exit(okN === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
