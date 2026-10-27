// ==========================================================================
// Картинки з інтернету, збережені на телефоні — для ігор, у які грають без мережі.
//
//   const src = await ImgCache.src(url);   // objectURL зі збереженого, або завантажить і збереже;
//                                          // офлайн і не збережено → null
//   ImgCache.warm(urls, { onProgress })    // заздалегідь зберегти список (у фоні, по 3 одночасно)
//
// Зберігається в Cache Storage (живе між запусками, переживає оновлення файлів гри).
// У застосунку 41games качає через нативний CapacitorHttp — без обмежень CORS,
// тож зберігаються і фото з Firebase Storage. У браузері — звичайний fetch; якщо
// сервер не дозволяє CORS, просто повертає url (картинка вантажиться як завжди, без збереження).
// ==========================================================================
(function () {
  const CACHE = "41g-img-v1";
  const C = window.Capacitor;
  const native = !!(C && typeof C.isNativePlatform === "function" && C.isNativePlatform());
  const hasCache = typeof caches !== "undefined";
  const live = new Map();                     // url → Promise<string|null>

  function http() { return native && ((C.Plugins && C.Plugins.CapacitorHttp) || (C.registerPlugin && C.registerPlugin("CapacitorHttp"))); }
  function b64Blob(b64, type) {
    const bin = atob(String(b64).replace(/^data:[^,]*,/, "")), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type });
  }
  async function stored(url) {
    if (!hasCache) return null;
    try { const r = await (await caches.open(CACHE)).match(url); return r ? await r.blob() : null; } catch (e) { return null; }
  }
  async function download(url) {
    let blob = null;
    const H = http();
    if (H) {
      const r = await H.get({ url, responseType: "blob", connectTimeout: 15000, readTimeout: 20000 });
      const h = r.headers || {}, type = h["Content-Type"] || h["content-type"] || "image/jpeg";
      if (r.status >= 200 && r.status < 300 && r.data) blob = b64Blob(r.data, type.split(";")[0]);
    } else {
      const r = await fetch(url, { mode: "cors" });
      if (r.ok) blob = await r.blob();
    }
    if (!blob || !blob.size || !/^image\//.test(blob.type)) return null;
    if (hasCache) { try { await (await caches.open(CACHE)).put(url, new Response(blob, { headers: { "Content-Type": blob.type } })); } catch (e) {} }
    return blob;
  }
  const offline = () => navigator.onLine === false;

  function src(url) {
    if (!url) return Promise.resolve(null);
    if (!live.has(url)) {
      const p = (async () => {
        const b = await stored(url);
        if (b) return URL.createObjectURL(b);
        if (offline()) return null;
        try { const d = await download(url); if (d) return URL.createObjectURL(d); } catch (e) {}
        return offline() ? null : url;          // не вдалося зберегти — хай <img> вантажить напряму
      })();
      live.set(url, p);
      p.then((v) => { if (!v) live.delete(url); });   // офлайн-промах — спробуємо ще, коли зʼявиться мережа
    }
    return live.get(url);
  }
  async function has(url) { return !!(await stored(url)); }

  // Заздалегідь зберегти картинки (вже збережені пропускає). onProgress(готово, усього)
  async function warm(urls, opts) {
    const list = [...new Set((urls || []).filter(Boolean))], onProgress = (opts && opts.onProgress) || (() => {});
    let done = 0, i = 0;
    onProgress(0, list.length);
    async function worker() {
      while (i < list.length) {
        const url = list[i++];
        if (!(await has(url)) && !offline()) { try { await download(url); } catch (e) {} }
        if (await has(url)) done++;
        onProgress(done, list.length);
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    return { done, total: list.length };
  }

  window.ImgCache = { src, warm, has, native };
})();
