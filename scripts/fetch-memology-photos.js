// Нові картинки для Мемології з вільними ліцензіями (Openverse: CC0, PD, CC BY, CC BY-SA).
//
// Крок 1 — набрати кандидатів у memes-incoming/ (у git і на хостинг не йде):
//   node scripts/fetch-memology-photos.js fetch [скільки_на_запит=6]
// Крок 2 — відкрити memes-incoming/ у Провіднику (вид «Великі значки»)
//   і видалити все, що не подобається: з текстом, нудне, розмите.
// Крок 3 — перенести решту в гру:
//   node scripts/fetch-memology-photos.js import
//   Конвертує у WebP ≤1280px у memes/, дописує авторів у memes/credits.json,
//   запам'ятовує відкинуті (щоб не качати їх знову) і оновлює список карток.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const incomingDir = path.join(root, "memes-incoming");
const manifestPath = path.join(incomingDir, "_manifest.json");
const memesDir = path.join(root, "memes");
const creditsPath = path.join(memesDir, "credits.json");
const rejectedPath = path.join(__dirname, "memology-rejected.json");

const LICENSES = "cc0,pdm,by,by-sa";
const MAX_SIDE = 1280;
const UA = "kzl-party-games/1.0 (memology card collector)";

// Короткі запити: Openverse шукає по заголовку й тегах, довгі фрази дають порожньо.
const QUERIES = [
  // люди
  "facepalm", "shocked face", "surprised face", "laughing", "crying face", "angry face",
  "grumpy", "yawning", "bored", "confused", "screaming", "disgusted", "smirk",
  "thinking face", "sleepy", "excited", "tired", "nervous", "suspicious", "shrug",
  // тварини
  "funny cat", "grumpy cat", "surprised cat", "cat yawn", "angry cat", "funny dog",
  "dog tongue", "sleepy dog", "goat", "screaming goat", "llama", "alpaca", "owl",
  "raccoon", "sloth", "pug", "hamster", "seal", "frog", "monkey face", "parrot",
  "horse teeth", "cow face", "quokka", "capybara", "pigeon", "hedgehog",
];

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; }
}
const writeJson = (file, data) => fs.writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res;
  } finally { clearTimeout(timer); }
}

async function search(query, count) {
  const params = new URLSearchParams({
    q: query, license: LICENSES, category: "photograph", mature: "false",
    page_size: String(Math.min(count * 3, 40)),
  });
  const res = await fetchWithTimeout("https://api.openverse.org/v1/images/?" + params, 60000);
  return (await res.json()).results || [];
}

async function fetchCandidates(perQuery) {
  await fs.mkdir(incomingDir, { recursive: true });
  const manifest = await readJson(manifestPath, {});
  const credits = await readJson(creditsPath, {});
  const rejected = new Set(await readJson(rejectedPath, []));
  const known = new Set([
    ...Object.values(manifest).map((m) => m.id),
    ...Object.values(credits).map((c) => c.id),
    ...rejected,
  ]);

  let added = 0;
  for (const query of QUERIES) {
    let results;
    try { results = await search(query, perQuery); } catch (e) {
      console.log(`  [${query}] пошук не вдався: ${e.message}`);
      continue;
    }
    let taken = 0;
    for (const r of results) {
      if (taken >= perQuery) break;
      if (known.has(r.id)) continue;
      if ((r.width && r.width < 500) || (r.height && r.height < 400)) continue;
      known.add(r.id);
      try {
        const buf = Buffer.from(await (await fetchWithTimeout(r.url, 45000)).arrayBuffer());
        const jpg = await sharp(buf).rotate()
          .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 85 }).toBuffer();
        const file = `${query.replace(/\s+/g, "-")}_${r.id.slice(0, 8)}.jpg`;
        await fs.writeFile(path.join(incomingDir, file), jpg);
        manifest[file] = {
          id: r.id, title: r.title || "", creator: r.creator || "", creator_url: r.creator_url || "",
          license: r.license, license_version: r.license_version || "", license_url: r.license_url || "",
          landing: r.foreign_landing_url || "", source: r.source || "",
        };
        taken++; added++;
      } catch (e) {
        // мертві посилання на Flickr трапляються часто — просто пропускаємо
      }
    }
    console.log(`  [${query}] +${taken}`);
    await writeJson(manifestPath, manifest);
  }
  console.log(`\nГотово: +${added} кандидатів у memes-incoming/ (усього ${Object.keys(manifest).length}).`);
  console.log("Видали непотрібне в Провіднику, потім: node scripts/fetch-memology-photos.js import");
}

async function importChosen() {
  const manifest = await readJson(manifestPath, null);
  if (!manifest) throw new Error("Немає memes-incoming/_manifest.json — спершу запусти fetch.");
  const credits = await readJson(creditsPath, {});
  const rejected = new Set(await readJson(rejectedPath, []));
  const present = new Set(await fs.readdir(incomingDir));

  let imported = 0, dropped = 0;
  for (const [file, meta] of Object.entries(manifest)) {
    if (!present.has(file)) { rejected.add(meta.id); dropped++; continue; }
    const webp = await sharp(path.join(incomingDir, file))
      .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 }).toBuffer();
    const name = crypto.createHash("md5").update(webp).digest("hex") + ".webp";
    await fs.writeFile(path.join(memesDir, name), webp);
    credits[name] = meta;
    await fs.unlink(path.join(incomingDir, file));
    imported++;
  }
  await writeJson(creditsPath, credits);
  await writeJson(rejectedPath, [...rejected].sort());
  await fs.unlink(manifestPath);
  console.log(`Перенесено в memes/: ${imported}, відкинуто: ${dropped}.`);
  execFileSync(process.execPath, [path.join(root, "generate-card-list.js")], { stdio: "inherit" });
}

const [cmd, arg] = process.argv.slice(2);
const run = cmd === "fetch" ? fetchCandidates(Math.max(1, parseInt(arg, 10) || 6))
  : cmd === "import" ? importChosen()
  : Promise.reject(new Error("Вкажи команду: fetch або import"));
run.catch((e) => { console.error("Помилка:", e.message); process.exitCode = 1; });
