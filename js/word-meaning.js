// ==========================================================================
// Тлумачення слова з Вікісловника — телефон запитує напряму, без нашого сервера.
//   WordMeaning.lookup("аванс", "uk") → Promise<{ defs: [рядки], url, source } | null>
// uk: українська Вікісловник (розділ «Значення» з вікітексту); якщо там порожньо —
//     англійські відповідники з англ. Вікісловника (розділ Ukrainian).
// en: англ. Вікісловник, REST-ендпоінт definition.
// ==========================================================================
(function () {
  const cache = new Map();
  const MAX_DEFS = 3;

  function stripHtml(html) {
    const d = document.createElement("div");
    d.innerHTML = html;
    d.querySelectorAll("sup, .reference, ul, dl").forEach((x) => x.remove());   // посилання й приклади
    return d.textContent.replace(/\s+/g, " ").trim();
  }

  // ---- uk.wiktionary: рядки «# …» після заголовка «Значення» ----
  function cleanWikiLine(s) {
    let t = s.replace(/^#+\s*/, "");
    // помітки на кшталт {{розм.}}, {{перен.}}, {{помітка|рідко}} → «розм.» тощо
    t = t.replace(/\{\{\s*помітка\s*\|([^}|]*)[^}]*\}\}/gi, "$1");
    for (let i = 0; i < 4; i++) t = t.replace(/\{\{(?:приклад|пример|example|Приклад|джерело)[^{}]*\}\}/gi, "");   // приклади геть
    t = t.replace(/\{\{\s*([^{}|]{1,14}\.)\s*(?:\|[^{}]*)?\}\}/g, "$1");               // {{розм.}} → розм.
    for (let i = 0; i < 4; i++) t = t.replace(/\{\{[^{}]*\}\}/g, "");                  // решта шаблонів
    t = t.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")                             // [[a|b]] → b
      .replace(/'''?/g, "").replace(/<ref[^>]*\/>|<ref[\s\S]*?<\/ref>/g, "").replace(/<[^>]+>/g, "")
      .replace(/\s+([,.;:])/g, "$1").replace(/\s+/g, " ").replace(/^[\s,;:—-]+|[\s,;:—-]+$/g, "").trim();
    return t;
  }
  function parseUkWikitext(wt) {
    if (!wt) return [];
    // лише український розділ, якщо сторінка має кілька мов
    const ukStart = wt.search(/^=\s*(?:\{\{-uk-\}\}|Українська)\s*=\s*$/m);
    if (ukStart >= 0) {
      wt = wt.slice(ukStart);
      const nextLang = wt.slice(1).search(/^=\s*(?:\{\{-[a-z-]+-\}\}|[А-ЯҐЄІЇA-Z][^=]*)\s*=\s*$/m);
      if (nextLang > 0) wt = wt.slice(0, nextLang + 1);
    }
    const lines = wt.split("\n"), out = [];
    let inMeaning = false;
    for (const line of lines) {
      if (/^=+\s*Значення\s*=+\s*$/i.test(line)) { inMeaning = true; continue; }
      if (/^=+[^=].*=+\s*$/.test(line)) { if (inMeaning && out.length) break; inMeaning = false; continue; }
      if (inMeaning && /^#(?![:*#])/.test(line)) {
        const d = cleanWikiLine(line);
        if (d.length > 2 && !out.includes(d)) out.push(d);
        if (out.length >= MAX_DEFS) break;
      }
    }
    return out;
  }
  async function fromUkWiktionary(word) {
    const api = "https://uk.wiktionary.org/w/api.php?action=parse&format=json&formatversion=2&origin=*&redirects=1&prop=wikitext&page=" + encodeURIComponent(word);
    const j = await fetch(api).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const defs = parseUkWikitext(j && j.parse && j.parse.wikitext);
    return defs.length ? { defs, url: "https://uk.wiktionary.org/wiki/" + encodeURIComponent(word), source: "Вікісловник" } : null;
  }

  // ---- en.wiktionary REST: { en: [...], uk: [...] } ----
  async function fromEnWiktionary(word, langKey) {
    const j = await fetch("https://en.wiktionary.org/api/rest_v1/page/definition/" + encodeURIComponent(word))
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const entries = (j && j[langKey]) || [];
    const defs = [];
    for (const e of entries) {
      for (const d of e.definitions || []) {
        const t = stripHtml(d.definition || "");
        if (t && !defs.includes(t)) defs.push((e.partOfSpeech ? e.partOfSpeech.toLowerCase() + ": " : "") + t);
        if (defs.length >= MAX_DEFS) break;
      }
      if (defs.length >= MAX_DEFS) break;
    }
    return defs.length ? { defs, url: "https://en.wiktionary.org/wiki/" + encodeURIComponent(word), source: langKey === "en" ? "Wiktionary" : "Wiktionary (англ. відповідники)" } : null;
  }

  function lookup(word, lang) {
    const w = String(word || "").toLowerCase().trim();
    const key = lang + ":" + w;
    if (!w) return Promise.resolve(null);
    if (!cache.has(key)) {
      const pr = lang === "uk"
        ? fromUkWiktionary(w).then((r) => r || fromEnWiktionary(w, "uk"))
        : fromEnWiktionary(w, "en");
      cache.set(key, pr.catch(() => null));
    }
    return cache.get(key);
  }

  window.WordMeaning = { lookup, _parseUkWikitext: parseUkWikitext };
})();
