// Fake News channels: owner picks a channel per photo in the lobby (preview tiles),
// the round card and write hint follow it. Screenshots → out/fn-channels/.
// node fakenews-channels-test.js   (simulator must be running)
const fs = require("node:fs");
const path = require("node:path");
const { launch, phone, BASE } = require("./harness");
const OUT = path.join(__dirname, "out", "fn-channels");
fs.mkdirSync(OUT, { recursive: true });
const results = [];
function check(name, ok, extra) { results.push(ok); console.log(`${ok ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`); }
const ROOM = "FC" + Math.floor(Math.random() * 900 + 100);
const room = () => fetch(`${BASE}/db/fakenews_rooms/${ROOM}.json`).then((r) => r.json());
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { const r = await fn(); if (r) return r; await new Promise((x) => setTimeout(x, 300)); } return null; };
const WANT = [["tv", "tabloid"], ["tg", "radio"], ["sport", "tabloid"]];

(async () => {
  await fetch(BASE + "/__mock/reset");
  const b = await launch();
  const names = ["Влад", "Олена К", "Марʼяна"], pages = [];
  for (const n of names) { const p = await phone(b, n); await p.goto(`${BASE}/fakenews.html?room=${ROOM}`, { waitUntil: "load" }); await p.waitForTimeout(pages.length ? 800 : 2500); pages.push(p); }
  await pages[0].waitForTimeout(2000);

  for (let k = 0; k < pages.length; k++) {
    const p = pages[k];
    const tiles = await p.$$("#poolGrid .pp");
    await tiles[0].click(); await p.waitForTimeout(400); await tiles[1].click(); await p.waitForTimeout(700);
    const rows = await p.$$(".fn-chan-row");
    const chips = await p.$$(".fn-chan-row .chp");
    if (k === 0) {
      check("channel picker: a row per chosen photo, 5 previews each", rows.length === 2 && chips.length === 10, `${rows.length} rows, ${chips.length} tiles`);
      check("a channel is pre-selected by default", (await p.$$(".fn-chan-row .chp.sel")).length === 2);
      check("previews show the photo itself", await p.$eval(".fn-chan-row .chp img", (im) => !!im.getAttribute("src")));
      await p.screenshot({ path: path.join(OUT, "lobby-picker.png"), fullPage: true });
    }
    for (let r = 0; r < 2; r++) { await p.click(`.fn-chan-row:nth-of-type(${r + 2}) .chp[data-ch="${WANT[k][r]}"]`).catch(async () => { const rr = await p.$$(".fn-chan-row"); await (await rr[r].$(`.chp[data-ch="${WANT[k][r]}"]`)).click(); }); await p.waitForTimeout(400); }
  }
  const lobby = await room();
  const chosen = Object.values(lobby.picks || {}).flatMap((o) => Object.values(o));
  check("channel choices saved", ["tv", "tabloid", "tg", "radio", "sport"].every((c) => chosen.includes(c)), chosen.join(","));
  check("caption shows the chosen channel", /Новини 24\/7|Жовта преса/.test(await pages[0].textContent("#myChannels")));

  await pages[0].click("#startBtn");
  const seen = new Set();
  for (let round = 0; round < 6 && seen.size < 5; round++) {
    let r = await until(async () => { const x = await room(); return x && x.stage && x.stage.kind === "write" && x.roundNo === round && x; });
    if (!r) { check("round " + round + " started", false); break; }
    const ch = r.stage.data.ch;
    await pages[0].waitForTimeout(600);
    const cls = await pages[0].getAttribute("#newsCard", "class");
    check(`round ${round + 1}: card styled as «${ch}»`, cls.includes("ch-" + ch), cls);
    const hint = await pages[0].textContent("#stageHint");
    if (!seen.has(ch)) check(`round ${round + 1}: write hint matches channel`, hint.includes(":"), hint);
    for (let k = 0; k < pages.length; k++) { await pages[k].fill("#fnWrite", `Сенсація ${k + 1}: коти захопили ${["мерію", "метро", "пекарню"][k]}`); await pages[k].click("#fnSend"); }
    r = await until(async () => { const x = await room(); return x && x.stage && x.stage.kind === "show" && x; });
    await pages[0].waitForTimeout(900);
    if (!seen.has(ch)) await (await pages[0].$("#newsCard")).screenshot({ path: path.join(OUT, `air-${ch}.png`) });
    seen.add(ch);
    await pages[0].click("#hostNextBtn");
    await until(async () => { const x = await room(); return x && x.stage && x.stage.kind === "vote" && x; });
    for (const p of pages) { await p.waitForTimeout(300); const opt = await p.$(".fn-opt:not(.own)"); if (opt) await opt.click(); }
    await until(async () => { const x = await room(); return x && x.stage && x.stage.kind === "reveal" && x; });
    await pages[0].waitForTimeout(500);
    await pages[0].click("#hostNextBtn");
  }
  check("all five channels went on air", seen.size === 5, [...seen].join(","));
  const errs = pages.flatMap((p) => p.errors);
  check("no JS errors", !errs.length, errs.slice(0, 3).join(" | "));
  await b.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
})();
