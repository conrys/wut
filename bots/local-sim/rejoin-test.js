// Rejoin: player leaves the room page and comes back — presence must resume.
// node rejoin-test.js   (simulator must be running)
const { launch, phone, BASE } = require("./harness");
const GAMES = [["whofrom.html", "party_whofrom"], ["dilemmas.html", "dilemmas"], ["charades.html", "charades"],
  ["fakenews.html", "fakenews"], ["draw.html", "draw"], ["teli.html", "teli"], ["court.html", "party_court"], ["bets.html", "party_bets"],
  ["mafia.html", "mafia"], ["quiplash.html", "quiplash"], ["spy.html", "spy"], ["memology.html", "memology"], ["quiz.html", "quiz"]];
const ago = async (key, room, name) => {
  const p = await fetch(`${BASE}/db/${key}_rooms/${room}/players/${encodeURIComponent(name)}.json`).then((r) => r.json());
  return p && p.lastSeen ? Date.now() - p.lastSeen : null;
};
(async () => {
  await fetch(BASE + "/__mock/reset");
  const b = await launch();
  let fails = 0;
  for (const [page, key] of GAMES.filter(([p]) => !process.argv[2] || process.argv[2].split(",").includes(p))) {
    const room = "RJ" + Math.floor(Math.random() * 900 + 100);
    const p = await phone(b, "Толік");
    await p.goto(`${BASE}/${page}?room=${room}`, { waitUntil: "load" });
    await p.waitForTimeout(6000);
    const first = await ago(key, room, "Толік");
    await p.goto(`${BASE}/index.html`, { waitUntil: "load" });
    await p.waitForTimeout(7000);
    await p.goto(`${BASE}/${page}?room=${room}`, { waitUntil: "load" });
    await p.waitForTimeout(7000);
    const back = await ago(key, room, "Толік");
    const ok = first !== null && first < 4000 && back !== null && back < 4000;
    if (!ok) fails++;
    console.log(`${ok ? "✅" : "❌"} ${page.padEnd(16)} first=${first}ms after-return=${back}ms ${p.errors.length ? "errors: " + p.errors.slice(0, 2).join(" | ") : ""}`);
    await p.context().close();
  }
  await b.close();
  console.log(fails ? `${fails} failed` : "all passed");
})();
