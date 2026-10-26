// ==========================================================================
// Стиснення фото на телефоні перед завантаженням: поворот за EXIF, зменшення
// до maxSide, WebP (старий Safari — JPEG), якість знижується до target байтів.
//   const r = await ImageCompress.compress(file, { maxSide: 800, target: 200 * 1024 });
//   // r = { blob, type, ext: "webp"|"jpg", w, h }
// ==========================================================================
(function () {
  function toBlob(canvas, type, q) { return new Promise((res) => canvas.toBlob(res, type, q)); }
  async function decode(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (e) {}
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.decoding = "async"; img.src = url;
      await img.decode();
      return img;
    } finally { URL.revokeObjectURL(url); }
  }
  async function compress(file, opts) {
    const maxSide = (opts && opts.maxSide) || 1280, target = (opts && opts.target) || 450 * 1024, max = (opts && opts.max) || 1.9 * 1024 * 1024;
    const src = await decode(file);
    const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
    if (!sw || !sh) throw new Error("empty image");
    const k = Math.min(1, maxSide / Math.max(sw, sh));
    const w = Math.round(sw * k), h = Math.round(sh * k);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);   // прозорі PNG — на білому
    ctx.drawImage(src, 0, 0, w, h);
    if (src.close) src.close();
    let type = "image/webp", q = 0.82;
    let blob = await toBlob(c, type, q);
    if (!blob || blob.type !== "image/webp") { type = "image/jpeg"; q = 0.85; blob = await toBlob(c, type, q); }
    while (blob && blob.size > target && q > 0.5) { q -= 0.08; blob = await toBlob(c, type, q); }
    if (!blob || blob.size > max) throw new Error("too big");
    return { blob, type, ext: type === "image/webp" ? "webp" : "jpg", w, h };
  }
  window.ImageCompress = { compress };
})();
