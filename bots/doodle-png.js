// Tiny PNG "doodle" generator for test bots (Зіпсований телефон): a few thick
// random strokes and circles on white. No dependencies — zlib + CRC32 by hand.
const zlib = require("node:zlib");

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

const COLORS = [[231, 76, 60], [52, 152, 219], [46, 204, 113], [241, 196, 15], [155, 89, 182], [30, 30, 30]];

function doodleDataUri(seed, w = 240, h = 180) {
  const rand = rng(seed);
  const px = Buffer.alloc(w * h * 3, 255);
  const dot = (x, y, r, [cr, cg, cb]) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const X = Math.round(x + dx), Y = Math.round(y + dy);
      if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const i = (Y * w + X) * 3; px[i] = cr; px[i + 1] = cg; px[i + 2] = cb;
    }
  };
  // кілька кіл-контурів
  for (let n = 0; n < 2; n++) {
    const color = COLORS[Math.floor(rand() * COLORS.length)];
    const cx = 40 + rand() * (w - 80), cy = 40 + rand() * (h - 80), R = 15 + rand() * 35;
    for (let a = 0; a < Math.PI * 2; a += 0.04) dot(cx + Math.cos(a) * R, cy + Math.sin(a) * R, 3, color);
  }
  // кілька ламаних штрихів
  for (let n = 0; n < 3; n++) {
    const color = COLORS[Math.floor(rand() * COLORS.length)];
    let x = rand() * w, y = rand() * h;
    for (let seg = 0; seg < 5; seg++) {
      const nx = Math.max(5, Math.min(w - 5, x + (rand() - 0.5) * 120));
      const ny = Math.max(5, Math.min(h - 5, y + (rand() - 0.5) * 90));
      const steps = Math.ceil(Math.hypot(nx - x, ny - y) / 2);
      for (let t = 0; t <= steps; t++) dot(x + ((nx - x) * t) / steps, y + ((ny - y) * t) / steps, 2, color);
      x = nx; y = ny;
    }
  }
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) px.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
  return "data:image/png;base64," + png.toString("base64");
}

module.exports = { doodleDataUri };
