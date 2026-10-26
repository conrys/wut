// Повзуни: 4 телефони в кімнаті. Запуск: node server.js, потім node povzuny-mp-test.js
const { launch, phone, BASE } = require("./harness");
const SS = require("path").join(__dirname, "out", ""); require("fs").mkdirSync(SS, { recursive: true });
const ok = (n, c, x) => console.log((c ? "✓ " : "✗ ") + n + (x ? "  — " + x : ""));
(async () => {
  await fetch(BASE + "/__mock/reset");
  const b = await launch();
  const mk = async (name) => { const p = await phone(b, name, { viewport: { width: 390, height: 780 } }); await p.goto(BASE + "/ads/povzuny/play.html"); await p.waitForTimeout(1200); await p.fill("#nick", name); return p; };
  const A = await mk("Влад");
  await A.click("#createBtn"); await A.waitForFunction(() => Povzun.state === "play", null, { timeout: 15000 });
  const code = await A.evaluate(() => Povzun.NET.code);
  const circle = (p) => p.evaluate(() => setInterval(() => { const m = Povzun.me; if (m && !m.dead) m.ta = m.ang + 0.7; }, 80));   // кружляти, щоб не врізатися в край
  const join = async (p) => { await p.fill("#codeIn", code); await p.click("#joinBtn"); await p.waitForFunction(() => Povzun.state === "play", null, { timeout: 15000 }); await circle(p); };
  await circle(A);
  const Bp = await mk("Олена"); await join(Bp);
  const C = await mk("Марʼяна"); await join(C);
  await A.waitForTimeout(2500);
  const info = async (p) => p.evaluate(() => ({ host: Povzun.NET.host, bots: Povzun.bots.filter((b) => !b.dead).length, rb: [...Povzun.remotes.entries()].filter(([k, r]) => k.startsWith("bot:") && !r.dead).length,
    humans: [...Povzun.remotes.entries()].filter(([k, r]) => !k.startsWith("bot:") && !r.dead).map(([k, r]) => r.name).sort().join(",") }));
  const [ia, ib, ic] = [await info(A), await info(Bp), await info(C)];
  const aid = await A.evaluate(() => Povzun.NET.id);
  console.log("   діагностика: A мертва?", await A.evaluate(() => Povzun.me.dead), "| у B:", await Bp.evaluate((id) => { const r = Povzun.remotes.get(id), p = Povzun.NET.peers.get(id); return JSON.stringify({ r: r ? { dead: r.dead, age: +(performance.now() / 1000).toFixed(0) } : null, P: p && p.P ? { l: p.P.l, x: p.P.x, j: p.P.j } : null }); }, aid));
  ok("хост — той, хто створив; боти лише в нього", ia.host && !ib.host && !ic.host && ia.bots > 0 && ib.bots === 0, `A ${JSON.stringify(ia)}`);
  ok("інші бачать тих самих ботів і одне одного", Math.abs(ib.rb - ia.bots) <= 2 && Math.abs(ic.rb - ia.bots) <= 2 && ib.humans === "Влад,Марʼяна" && ic.humans === "Влад,Олена", `B ${JSON.stringify(ib)} C ${JSON.stringify(ic)}`);
  // позиції збігаються: де A бачить змію B і де B насправді
  const posB = await Bp.evaluate(() => [Povzun.me.hx, Povzun.me.hy]);
  const seenB = await A.evaluate((id) => { const r = Povzun.remotes.get(id); return r ? [r.hx, r.hy] : null; }, await Bp.evaluate(() => Povzun.NET.id));
  ok("A бачить B там, де B є (похибка < 60)", seenB && Math.hypot(seenB[0] - posB[0], seenB[1] - posB[1]) < 60, seenB && Math.round(Math.hypot(seenB[0] - posB[0], seenB[1] - posB[1])) + " од.");
  // їжа: B зʼїдає кульку — у всіх вона зникає
  const slot = await Bp.evaluate(() => { const me = Povzun.me; let best = 0, bd = 1e9; Povzun.field.forEach((p, i) => { const d = Math.hypot(p.x - me.hx, p.y - me.hy); if (d < bd) { bd = d; best = i; } });
    const p = Povzun.field[best]; me.pts[0][0] = p.x; me.pts[0][1] = p.y; return best; });
  await A.waitForTimeout(1200);
  const g = await Promise.all([A, Bp, C].map((p) => p.evaluate((s) => Povzun.gens[s], slot)));
  ok("зʼїдена кулька зникла на всіх трьох телефонах", g[0] >= 1 && g[0] === g[1] && g[1] === g[2], `покоління ${g.join("/")}`);
  // смерть C — їжа з тіла однакова в усіх
  await C.evaluate(() => Povzun.die(Povzun.me)); await A.waitForTimeout(1500);
  const cid = await C.evaluate(() => Povzun.NET.id);
  const df = await Promise.all([A, Bp, C].map((p) => p.evaluate((id) => [...Povzun.deathFood.keys()].filter((k) => k.startsWith("d" + id)).length, cid)));
  ok("C загинула: її тіло стало однаковою їжею в усіх", df[0] > 0 && df[0] === df[1] && df[1] === df[2], df.join("/"));
  const deadSeen = await A.evaluate((id) => { const r = Povzun.remotes.get(id); return !r || r.dead; }, cid);
  ok("A бачить, що змії C більше нема", deadSeen);
  const aAlive = await A.evaluate(() => !Povzun.me.dead);
  await C.click("#againBtn").catch(() => {}); await C.waitForTimeout(1500);
  // бот гине в хоста — його їжа з тими самими id в інших
  const bd = await A.evaluate(() => { const bt = Povzun.bots.find((x) => !x.dead); Povzun.die(bt); return bt.id; });
  await A.waitForTimeout(1500);
  const bf = await Promise.all([A, Bp].map((p) => p.evaluate((id) => [...Povzun.deathFood.keys()].filter((k) => k.startsWith("dbot:" + id)).length, bd)));
  ok("загиблий бот став однаковою їжею в хоста й гравця", bf[0] > 0 && bf[0] === bf[1], bf.join("/"));
  await A.screenshot({ path: SS + "pz_mpA.png" }); await Bp.screenshot({ path: SS + "pz_mpB.png" });
  // пізній гравець отримує знімок їжі
  const D = await mk("Петро"); await join(D); await D.waitForTimeout(5000);
  { const snap = async () => [await D.evaluate(() => Array.from(Povzun.gens)), await Bp.evaluate(() => Array.from(Povzun.gens))];
    let [d1, b1] = await snap(); const bad = d1.map((v, i) => (v !== b1[i] ? i : -1)).filter((i) => i >= 0);
    await D.waitForTimeout(5000); const [d2, b2] = await snap();
    const stuck = bad.filter((i) => d2[i] < b1[i] || (d2[i] !== b2[i] && b2[i] === b1[i] && d2[i] === d1[i]));
    ok("пізній гравець бачить ту саму їжу (розбіжності — лише в дорозі)", stuck.length === 0, `було в дорозі ${bad.length}, застрягло ${stuck.length}`); }
  // хост іде — боти переходять до іншого
  const botIds = await A.evaluate(() => Povzun.bots.filter((x) => !x.dead).map((x) => x.id).sort());
  await A.close(); await Bp.waitForTimeout(4000);
  const [nb, nc] = [await info(Bp), await info(C)];
  const newHost = nb.host ? Bp : C, other = nb.host ? C : Bp;
  const inherited = await newHost.evaluate(() => Povzun.bots.filter((x) => !x.dead).map((x) => x.id));
  const kept = inherited.filter((id) => botIds.includes(id)).length;
  ok("хост вийшов — ботів підхопив інший, ті самі боти", (nb.host !== nc.host) && kept >= botIds.length - 1, `новий хост: ${nb.host ? "Олена" : "Марʼяна"}, збережено ${kept}/${botIds.length}`);
  const ob = await info(other);
  ok("третій гравець бачить ботів нового хоста", ob.rb >= kept, JSON.stringify(ob));
  const errs = [Bp, C, D].flatMap((p) => p.errors);
  ok("без JS-помилок", !errs.length, errs.slice(0, 4).join(" | "));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
