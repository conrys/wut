// Перевірка upload.html і хмарних картинок у іграх на локальному стенді.
//   node server.js            (в іншому терміналі)
//   node media-test.js <папка з тестовими фото>
// Storage підміняється заглушкою: файли «вантажаться» в пам'ять сторінки,
// а посилання firebasestorage.googleapis.com віддають будь-яку картинку з memes/.
const fs = require("fs");
const path = require("path");
const { launch, phone, BASE } = require("./harness");

const FX = process.argv[2];
if (!FX || !fs.existsSync(FX)) { console.error("node media-test.js <папка з фото>"); process.exit(1); }
const fx = (n) => path.join(FX, n);
const SAMPLE = fs.readFileSync(path.join(__dirname, "..", "..", "memes", fs.readdirSync(path.join(__dirname, "..", "..", "memes")).find((f) => f.endsWith(".webp"))));

const STORAGE_STUB = `(function(){
  window.__uploads = []; window.__deleted = [];
  firebase.storage = function () { return { ref: function (p) { return {
    put: function (blob, meta) {
      const t = new Promise((res) => setTimeout(() => { window.__uploads.push({ p, size: blob.size, type: meta.contentType, cc: meta.cacheControl }); res({}); }, 30));
      t.on = function (ev, cb) { setTimeout(() => cb({ bytesTransferred: blob.size / 2, totalBytes: blob.size }), 5); };
      return t;
    },
    delete: function () { window.__deleted.push(p); return Promise.resolve(); },
  }; } }; };
})();`;

const results = [];
function check(name, ok, extra) { results.push({ name, ok: !!ok, extra }); console.log((ok ? "✓ " : "✗ ") + name + (extra ? "  — " + extra : "")); }

async function wire(page) {
  const ctx = page.context();
  await ctx.route(/firebase-storage-compat/, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: STORAGE_STUB }));
  await ctx.route(/firebasestorage\.googleapis\.com/, (r) => r.fulfill({ status: 200, contentType: "image/webp", body: SAMPLE }));
}
const imgCount = (page, sel) => page.$$eval(sel, (els) => els.length);

(async () => {
  await fetch(BASE + "/__mock/reset");
  const browser = await launch();
  const a = await phone(browser, "Влад");
  await wire(a);

  // 1. без права адміна — інструкція з uid
  await a.goto(BASE + "/upload.html");
  await a.waitForSelector("#gate:not(.hidden)", { timeout: 8000 });
  const gate = await a.textContent("#gate");
  check("не адмін бачить свій uid та інструкцію", gate.includes("t_Влад") && gate.includes("games41_admins"));

  // 2. стаємо адміном
  await a.evaluate(() => firebase.firestore().collection("games41_admins").doc("t_Влад").set({ name: "Влад" }));
  await a.reload();
  await a.waitForSelector("#app:not(.hidden)", { timeout: 8000 });
  check("адмін бачить сторінку", true);

  // 3. Мемологія: 2 великі фото
  await a.click('.tab[data-g="memology"]');
  await a.setInputFiles("#pickFiles", [fx("phone.jpg"), fx("kit-na-dahu.png")]);
  await a.waitForFunction(() => document.querySelectorAll(".q").length === 2 && !document.querySelector(".q .meta").textContent.includes("Стискаю") && ![...document.querySelectorAll(".q .meta")].some((m) => m.textContent.includes("Стискаю")), null, { timeout: 15000 });
  const metas = await a.$$eval(".q .meta", (els) => els.map((e) => e.textContent.trim()));
  check("стиснення до ≤1280 px", metas.every((m) => /(\d+)×(\d+)/.test(m) && Math.max(...m.match(/(\d+)×(\d+)/).slice(1).map(Number)) <= 1280), metas.join(" | "));
  await a.click("#sendBtn");
  await a.waitForFunction(() => window.__uploads.length === 2 && document.querySelectorAll("#grid .cell").length === 2, null, { timeout: 10000 });
  const ups = await a.evaluate(() => window.__uploads);
  check("2 файли в Storage як WebP", ups.every((u) => u.type === "image/webp" && /^games41_media\/memology\/[a-z0-9]+\.webp$/.test(u.p)), ups.map((u) => `${u.p} ${Math.round(u.size / 1024)}KB`).join(", "));
  check("кешування файлів назавжди", ups.every((u) => /immutable/.test(u.cc)));

  // 4. Fake News: підпис обов'язковий
  await a.click('.tab[data-g="fakenews"]');
  await a.setInputFiles("#pickFiles", [fx("IMG_20261026_101010.jpg")]);
  await a.waitForFunction(() => document.querySelector(".q:not(.done) .meta") && !document.querySelector(".q:not(.done) .meta").textContent.includes("Стискаю"), null, { timeout: 15000 });
  await a.click("#sendBtn");
  await a.waitForTimeout(300);
  check("без підпису Fake News не вантажить", (await a.evaluate(() => window.__uploads.length)) === 2 && (await imgCount(a, ".q input.bad")) === 1);
  await a.fill(".q:not(.done) input[type=text]", "Кіт-бухгалтер звільнився");
  await a.click("#sendBtn");
  await a.waitForFunction(() => window.__uploads.length === 3, null, { timeout: 10000 });
  await a.waitForSelector("#grid .cell .cap");
  check("Fake News: фото з підписом", (await a.textContent("#grid .cell .cap")).includes("Кіт-бухгалтер"));

  // 5. Сміхлист: підпис не обов'язковий
  await a.click('.tab[data-g="quiplash"]');
  await a.setInputFiles("#pickFiles", [fx("kit-na-dahu.png")]);
  await a.waitForFunction(() => document.querySelector(".q:not(.done) .meta") && !document.querySelector(".q:not(.done) .meta").textContent.includes("Стискаю"), null, { timeout: 15000 });
  await a.click("#sendBtn");
  await a.waitForFunction(() => window.__uploads.length === 4, null, { timeout: 10000 });
  check("Сміхлист: без підпису ок", true);

  // 5b. одне фото одразу в три ігри
  await a.click('.tab[data-g="memology"]');
  await a.setInputFiles("#pickFiles", [fx("phone.jpg")]);
  await a.waitForFunction(() => document.querySelector(".q:not(.done) .meta") && !document.querySelector(".q:not(.done) .meta").textContent.includes("Стискаю"), null, { timeout: 15000 });
  await a.click('.q:not(.done) .g[data-g="fakenews"]');
  await a.click('.q:not(.done) .g[data-g="quiplash"]');
  check("поля підпису для вибраних ігор", (await imgCount(a, ".q:not(.done) input[data-t]")) === 2);
  check("кнопка рахує місця", (await a.textContent("#sendBtn")).includes("3 місця"), await a.textContent("#sendBtn"));
  await a.fill('.q:not(.done) input[data-t="fakenews"]', "Те саме фото в трьох іграх");
  await a.click("#sendBtn");
  await a.waitForFunction(() => window.__uploads.length === 7, null, { timeout: 10000 });
  await a.waitForFunction(() => document.querySelectorAll(".q .g.ok").length === 3, null, { timeout: 5000 });
  const multi = (await a.evaluate(() => window.__uploads.slice(4).map((u) => u.p.split("/")[1]))).sort().join(",");
  check("одне фото → 3 ігри окремими файлами", multi === "fakenews,memology,quiplash", multi);

  // 6. видалення
  await a.waitForFunction(() => document.querySelectorAll("#grid .cell").length === 3);
  await a.click("#grid .cell .del");
  await a.waitForFunction(() => document.querySelectorAll("#grid .cell").length === 2 && window.__deleted.length === 1, null, { timeout: 8000 });
  check("видалення прибирає запис і файл", true);
  const docs = await a.evaluate(() => firebase.firestore().collection("games41_media").get().then((s) => s.docs.map((d) => d.data())));
  check("записи в Firestore: memology 2, fakenews 2, quiplash 2",
    ["memology", "fakenews", "quiplash"].every((g) => docs.filter((d) => d.game === g).length === 2), JSON.stringify(docs.map((d) => [d.game, d.file, d.text])));
  await a.screenshot({ path: path.join(FX, "upload.png"), fullPage: true });

  // 7. ігри бачать хмарні картинки
  const g = await phone(browser, "Олена К");
  await wire(g);
  await g.goto(BASE + "/memology.html");
  const mem = await g.evaluate(() => MediaPool.list("memology").then((l) => l.map((x) => x.url)));
  check("Мемологія отримує хмарний список", mem.length === 2 && mem[0].includes("firebasestorage.googleapis.com"), mem[0]);
  await g.goto(BASE + "/remake.html");
  await g.waitForTimeout(1500);
  const rem = await g.evaluate(() => typeof MEMOLOGY_CARD_IDS !== "undefined" && MediaPool.list("memology").then((l) => l.length));
  check("Римейк підключає MediaPool", rem === 2);

  await g.goto(BASE + "/fakenews.html?room=MEDIA1");
  await g.waitForTimeout(4000);
  const room = await (await fetch(BASE + "/db/fakenews_rooms/MEDIA1.json")).json();
  check("Fake News: список хмарних фото записано в кімнату", room && Array.isArray(room.cloud) && room.cloud.length === 2 && room.cloud[0].t.includes("Кіт"), JSON.stringify(room && room.cloud));
  const pool = await g.evaluate(() => ({ n: window.FakeNewsPhotos.length, last: window.FakeNewsPhotos[window.FakeNewsPhotos.length - 1] }));
  check("Fake News: пул = вбудовані + хмарні", pool.last && pool.last.src.includes("firebasestorage") && pool.last.title.includes("трьох іграх"), `n=${pool.n}`);

  await g.goto(BASE + "/fakenews-tv.html?room=MEDIA1");
  await g.waitForTimeout(2500);
  const tvPool = await g.evaluate(() => window.FakeNewsPhotos[window.FakeNewsPhotos.length - 1].src);
  check("Fake News ТВ: той самий пул", tvPool.includes("firebasestorage"));

  await g.goto(BASE + "/quiplash.html");
  await g.waitForTimeout(1500);
  const ql = await g.evaluate(() => MediaPool.list("quiplash").then((l) => l.length));
  check("Сміхлист отримує хмарний список", ql === 2);

  const errs = a.errors.concat(g.errors).filter((e) => !/favicon/.test(e));
  check("без JS-помилок", !errs.length, errs.slice(0, 5).join(" || "));
  await browser.close();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} перевірок пройдено`);
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
