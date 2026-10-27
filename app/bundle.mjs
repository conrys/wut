#!/usr/bin/env node
// ==========================================================================
// Файли гри для Android-застосунку 41games — ті самі, що й на сайті kzl-crm.web.app.
//
//   node app/bundle.mjs www       — скопіювати файли сайту в app/www (для збірки APK)
//   node app/bundle.mjs manifest  — app-version.json + app-manifest.json у корені
//                                   (запускає деплой сайту: за ним застосунок качає оновлення)
//
// app-manifest.json = список файлів із sha256. Застосунок порівнює його зі своїми файлами
// і завантажує лише змінені (решту бере з APK або з попереднього оновлення) — див. js/core/app-shell.js.
// ==========================================================================
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
export const SITE_URL = "https://kzl-crm.web.app";

// Що НЕ потрапляє в застосунок (службове, тести, вихідники). Сайт це теж не роздає
// або воно йому не потрібне — головне, щоб кожен файл застосунку був і на сайті.
const SKIP_DIRS = new Set(["node_modules", "app", "bots", "scripts", "md", "upd", "memes-incoming", "quipleaf_reference"]);
const SKIP_FILES = new Set(["firebase.json", "firestore.rules", "storage.rules", "database.rules.json", "README.txt",
  "skills-lock.json", "generate-card-list.js", "package.json", "package-lock.json", "app-manifest.json"]);

export function listBundleFiles(root = ROOT) {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;                  // .git, .github, .firebaserc, …
      const abs = path.join(dir, e.name), rel = path.relative(root, abs).split(path.sep).join("/");
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(abs); continue; }
      if (SKIP_FILES.has(rel) || /\.(md|log|tgz|zip|psd|xcf|kra)$/i.test(e.name)) continue;
      out.push(rel);
    }
  })(root);
  return out.sort();
}

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function version() {
  const sha = process.env.GITHUB_SHA || execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim();
  return sha.slice(0, 12);
}

// Те, що генерується перед деплоєм сайту, має бути і в застосунку
function prepare() {
  execSync("node scripts/generate-fakenews-photos.js", { cwd: ROOT, stdio: "inherit" });
  // лише версія, без часу збірки: APK і деплой того самого коміту дають однаковий файл → зайвого оновлення нема
  fs.writeFileSync(path.join(ROOT, "app-version.json"), JSON.stringify({ version: version() }) + "\n");
}

const cmd = process.argv[2];
if (cmd === "www") {
  prepare();
  const www = path.join(ROOT, "app", "www");
  fs.rmSync(www, { recursive: true, force: true });
  const files = listBundleFiles();
  let bytes = 0;
  for (const rel of files) {
    const dst = path.join(www, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), dst);
    bytes += fs.statSync(dst).size;
  }
  console.log(`✓ app/www: ${files.length} файлів, ${(bytes / 1048576).toFixed(1)} МБ, версія ${version()}`);
} else if (cmd === "manifest") {
  prepare();
  const files = listBundleFiles().map((rel) => {
    const hash = sha256(path.join(ROOT, rel));
    const url = SITE_URL + "/" + rel.split("/").map(encodeURIComponent).join("/") + "?v=" + hash.slice(0, 10);
    return { file_name: rel, file_hash: hash, download_url: url };
  });
  const manifest = { version: version(), files };
  fs.writeFileSync(path.join(ROOT, "app-manifest.json"), JSON.stringify(manifest));
  console.log(`✓ app-manifest.json: ${files.length} файлів, версія ${manifest.version}`);
} else {
  console.log("node app/bundle.mjs www | manifest");
}
