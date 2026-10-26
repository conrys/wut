#!/usr/bin/env node
// ==========================================================================
// Локальні копії зовнішніх залежностей (Firebase SDK, howler, Google Fonts) у /vendor
// і переписування посилань у .html/.css/.js на них.
//
// Навіщо: APK (app/) кладе файли сайту всередину застосунку, і соло-ігри мають
// запускатися без інтернету. Сайт використовує ті самі локальні копії — одне джерело правди,
// тож живі оновлення застосунку — це просто ті самі файли, що й на kzl-crm.web.app.
//
// Запуск (потрібні node + npm; ноутбук не обовʼязковий — це вміє й GitHub Actions):
//   node scripts/vendor-deps.mjs          — завантажити пакети, оновити /vendor, переписати посилання
//   node scripts/vendor-deps.mjs --check  — лише показати зовнішні посилання, що лишилися (для CI)
// Новий шрифт Google на сторінці? Просто встав звичне посилання fonts.googleapis.com і запусти скрипт.
// ==========================================================================
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const VENDOR = path.join(ROOT, "vendor");
const FIREBASE_VER = "10.13.0", HOWLER_VER = "2.2.4";
const SUBSETS = ["cyrillic", "latin"];
const SKIP_DIRS = new Set([".git", "node_modules", "bots", "app", "vendor", ".github", "md", "upd", "memes-incoming"]);
const CHECK = process.argv.includes("--check");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) walk(path.join(dir, e.name), out); }
    else if (/\.(html|css|js)$/.test(e.name)) out.push(path.join(dir, e.name));
  }
  return out;
}
const files = walk(ROOT);
const rel = (file, target) => { let r = path.relative(path.dirname(file), path.join(ROOT, target)).split(path.sep).join("/"); return r.startsWith(".") ? r : "./" + r; };

const FONT_RE = /https:\/\/fonts\.googleapis\.com\/css2\?[^"')\s]+/g;
const FB_RE = /https:\/\/www\.gstatic\.com\/firebasejs\/([\d.]+)\/(firebase-[a-z-]+\.js)/g;
const HOWLER_RE = /https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/howler\/[\d.]+\/howler\.min\.js/g;

if (CHECK) {
  let bad = 0;
  for (const f of files) {
    const s = fs.readFileSync(f, "utf8");
    for (const re of [FONT_RE, FB_RE, HOWLER_RE]) for (const m of s.matchAll(re)) { bad++; console.log(`${path.relative(ROOT, f)}: ${m[0]}`); }
    for (const m of s.matchAll(/<script[^>]+src="(https?:\/\/[^"]+)"/g)) { bad++; console.log(`${path.relative(ROOT, f)}: script ${m[1]}`); }
  }
  console.log(bad ? `\n⚠ ${bad} зовнішніх посилань — в APK без інтернету ці сторінки не працюватимуть. Запусти node scripts/vendor-deps.mjs` : "✓ зовнішніх скриптів і шрифтів нема");
  process.exit(0);
}

// ---------- шрифти, що реально використовуються ----------
const fams = new Map(); // "Baloo 2" -> Set("600", "800", "700i")
function parseFontUrl(u) {
  const q = new URL(u.replace(/&amp;/g, "&"));
  const list = [];
  for (const spec of q.searchParams.getAll("family")) {
    const [name, axes] = spec.split(":");
    const fam = name.replace(/\+/g, " ");
    const w = [];
    if (!axes) w.push("400");
    else {
      const [keys, vals] = axes.split("@"), ks = keys.split(",");
      for (const tuple of vals.split(";")) {
        const v = tuple.split(","), o = Object.fromEntries(ks.map((k, i) => [k, v[i]]));
        w.push((o.wght || "400") + (o.ital === "1" ? "i" : ""));
      }
    }
    list.push([fam, w]);
  }
  return list;
}
for (const f of files) for (const m of fs.readFileSync(f, "utf8").matchAll(FONT_RE)) for (const [fam, ws] of parseFontUrl(m[0])) {
  if (!fams.has(fam)) fams.set(fam, new Set()); ws.forEach((w) => fams.get(fam).add(w));
}
// ще й ті, що вже завендорені раніше (щоб повторний запуск нічого не губив)
const famIndexFile = path.join(VENDOR, "fonts", "families.json");
if (fs.existsSync(famIndexFile)) for (const [fam, ws] of Object.entries(JSON.parse(fs.readFileSync(famIndexFile, "utf8")))) {
  if (!fams.has(fam)) fams.set(fam, new Set()); ws.forEach((w) => fams.get(fam).add(w));
}
const slug = (fam) => fam.toLowerCase().replace(/\s+/g, "-");

// ---------- пакети npm у тимчасову теку ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vendor-"));
const pkgs = [`firebase@${FIREBASE_VER}`, `howler@${HOWLER_VER}`, ...[...fams.keys()].map((f) => `@fontsource/${slug(f)}`)];
console.log("npm:", pkgs.length, "пакетів…");
fs.writeFileSync(path.join(tmp, "package.json"), "{}");
execSync(`npm install --no-audit --no-fund --silent ${pkgs.join(" ")}`, { cwd: tmp, stdio: "inherit" });
const NM = path.join(tmp, "node_modules");

// ---------- Firebase + howler ----------
const fbDir = path.join(VENDOR, "firebase", FIREBASE_VER);
fs.mkdirSync(fbDir, { recursive: true });
for (const n of ["app", "auth", "firestore", "database", "storage"]) {
  const s = fs.readFileSync(path.join(NM, "firebase", `firebase-${n}-compat.js`), "utf8").replace(/\n\/\/# sourceMappingURL=.*$/m, "\n");
  fs.writeFileSync(path.join(fbDir, `firebase-${n}-compat.js`), s);
}
fs.mkdirSync(path.join(VENDOR, "howler"), { recursive: true });
fs.copyFileSync(path.join(NM, "howler", "dist", "howler.min.js"), path.join(VENDOR, "howler", "howler.min.js"));

// ---------- шрифти: vendor/fonts/<slug>.css + файли woff2 ----------
const fontDir = path.join(VENDOR, "fonts");
fs.mkdirSync(path.join(fontDir, "files"), { recursive: true });
const famIndex = {};
for (const [fam, ws] of fams) {
  const id = slug(fam), pdir = path.join(NM, "@fontsource", id);
  let css = `/* ${fam} — локальна копія (@fontsource/${id}), згенеровано scripts/vendor-deps.mjs */\n`;
  const got = [];
  for (const w of [...ws].sort()) {
    const ital = w.endsWith("i"), wt = w.replace("i", "");
    for (const sub of SUBSETS) {
      const cssFile = path.join(pdir, `${sub}-${wt}${ital ? "-italic" : ""}.css`);
      if (!fs.existsSync(cssFile)) continue;
      let block = fs.readFileSync(cssFile, "utf8");
      // лишаємо тільки woff2 (його вміють усі сучасні WebView), файли копіюємо поруч
      block = block.replace(/src:[^;]+;/, (src) => {
        const m = src.match(/url\(\.\/files\/([^)]+\.woff2)\)/);
        if (!m) return src;
        fs.copyFileSync(path.join(pdir, "files", m[1]), path.join(fontDir, "files", m[1]));
        return `src: url(./files/${m[1]}) format('woff2');`;
      });
      css += block.trim() + "\n";
      got.push(`${w}/${sub}`);
    }
  }
  if (!got.length) { console.warn(`⚠ ${fam}: немає файлів у @fontsource/${id}`); continue; }
  fs.writeFileSync(path.join(fontDir, `${id}.css`), css);
  famIndex[fam] = [...ws].sort();
}
fs.writeFileSync(famIndexFile, JSON.stringify(famIndex, null, 1) + "\n");

// ---------- переписуємо посилання ----------
let changed = 0;
for (const f of files) {
  let s = fs.readFileSync(f, "utf8"); const before = s;
  s = s.replace(/[ \t]*<link[^>]+rel="preconnect"[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>[ \t]*\n?/g, "");
  s = s.replace(/<link[^>]*href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]+)"[^>]*>/g, (_, u) =>
    parseFontUrl(u).filter(([fam]) => famIndex[fam]).map(([fam]) => `<link rel="stylesheet" href="${rel(f, `vendor/fonts/${slug(fam)}.css`)}">`).join(""));
  s = s.replace(/@import url\(['"]?(https:\/\/fonts\.googleapis\.com\/css2\?[^'")]+)['"]?\);?/g, (_, u) =>
    parseFontUrl(u).filter(([fam]) => famIndex[fam]).map(([fam]) => `@import url('${rel(f, `vendor/fonts/${slug(fam)}.css`)}');`).join("\n"));
  s = s.replace(FB_RE, (_, v, n) => rel(f, `vendor/firebase/${FIREBASE_VER}/${n}`));
  s = s.replace(HOWLER_RE, rel(f, "vendor/howler/howler.min.js"));
  if (s !== before) { fs.writeFileSync(f, s); changed++; }
}
fs.rmSync(tmp, { recursive: true, force: true });
const size = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((a, e) => a + (e.isDirectory() ? size(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
console.log(`✓ шрифтів: ${Object.keys(famIndex).length}, змінено файлів: ${changed}, /vendor: ${(size(VENDOR) / 1048576).toFixed(1)} МБ`);
