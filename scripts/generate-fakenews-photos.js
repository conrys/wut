const fs = require("node:fs/promises");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const photosDirectory = path.join(projectRoot, "img", "fakenews");
const manifestPath = path.join(projectRoot, "js", "promts", "fakenews-photos.js");
const supportedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

async function main() {
  const entries = await fs.readdir(photosDirectory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && supportedExtensions.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);

  if (!files.length) {
    throw new Error(`No supported photos found in ${photosDirectory}`);
  }

  const photos = files.map((name) => ({
    src: `img/fakenews/${name.split(path.sep).map(encodeURIComponent).join("/")}`,
  }));
  const output = `// Generated from img/fakenews/ before Firebase Hosting deployment. Do not edit by hand.\n` +
    `// The original filename is used as the photo context shown to players.\n` +
    `(function () {\n  window.FakeNewsPhotos = ${JSON.stringify(photos, null, 2).replace(/\n/g, "\n  ")};\n})();\n`;

  await fs.writeFile(manifestPath, output, "utf8");
  console.log(`Generated Fake News photo pool with ${photos.length} image${photos.length === 1 ? "" : "s"}.`);
}

main().catch((error) => {
  console.error("Could not generate the Fake News photo pool:", error.message);
  process.exitCode = 1;
});
