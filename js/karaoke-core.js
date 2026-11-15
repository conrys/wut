// ==========================================================================
// karaoke-core.js — спільне для karaoke-tv.html (плеєр + текст) і
// karaoke.html (телефон: черга/пошук + текст).
//
// Дані кімнати: karaoke_rooms/CODE
//   meta  { created, tv }                 — tv=true, поки відкритий екран ТВ
//   now   { key, v, title, ch, by, dur, playing, pos, at, off, lrc, lrcState, err }
//         pos — секунда треку на момент at (серверний час), off — зсув тексту, с
//   queue/{push} { v, title, ch, dur, by }
//   cmd/{push}   { a, x }   — команди від будь-кого; виконує ТВ і видаляє
//   req/{push}   { q, by }  — запит пошуку; ТВ шукає акаунтом хоста
//   res/{push}   { items | err } — відповідь на запит; телефон читає й видаляє
// Тексти НЕ зберігаються в базі: кожен екран бере їх з LRCLIB за now.lrc.
// ==========================================================================
(function () {
  const ROOT = "karaoke_rooms";
  const LRCLIB = "https://lrclib.net/api";

  function roomRef(code) { return window.rtdb.ref(`${ROOT}/${code}`); }

  // серверний час (для синхронізації позиції треку між ТВ і телефонами)
  let srvOffset = 0;
  function watchClock() {
    if (!window.rtdb) return;
    window.rtdb.ref(".info/serverTimeOffset").on("value", (s) => { srvOffset = s.val() || 0; });
  }
  function now() { return Date.now() + srvOffset; }

  // позиція тексту (с) за станом now з бази
  function trackTime(st) {
    if (!st) return 0;
    const base = st.pos || 0;
    return st.playing && st.at ? base + (now() - st.at) / 1000 : base;
  }

  // ID відео з посилання YouTube / YouTube Music / youtu.be або голого ID
  function parseVideoId(s) {
    s = (s || "").trim();
    if (/^[\w-]{11}$/.test(s)) return s;
    try {
      const u = new URL(s);
      if (/youtu\.be$/.test(u.hostname)) return (u.pathname.slice(1).match(/^[\w-]{11}/) || [])[0] || null;
      const v = u.searchParams.get("v");
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{11})/);
      return m ? m[1] : null;
    } catch { return null; }
  }

  // "PT3M12S" → 192
  function isoDur(s) {
    const m = (s || "").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
  }
  function fmtDur(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  }

  // ---------- LRC ----------
  // повертає [{t, text}] за часом; порожні рядки лишаються (паузи)
  function parseLrc(lrc) {
    const out = [];
    (lrc || "").split(/\r?\n/).forEach((line) => {
      const tags = [...line.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
      if (!tags.length) return;
      const text = line.replace(/\[[^\]]*\]/g, "").trim();
      tags.forEach((m) => out.push({ t: +m[1] * 60 + parseFloat(m[2].replace(":", ".")), text }));
    });
    return out.sort((a, b) => a.t - b.t);
  }
  // індекс поточного рядка (-1 до першого)
  function lineAt(lines, t) {
    let lo = 0, hi = lines.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (lines[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  }
  // частка проспіваного рядка 0..1 (для заливки)
  function lineProgress(lines, i, t) {
    if (i < 0) return 0;
    const end = i + 1 < lines.length ? lines[i + 1].t : lines[i].t + 4;
    return Math.min(1, Math.max(0, (t - lines[i].t) / Math.max(0.5, Math.min(end - lines[i].t, 8))));
  }

  // ---------- LRCLIB ----------
  async function lrcSearch(q) {
    const r = await fetch(`${LRCLIB}/search?q=${encodeURIComponent(q)}`);
    if (!r.ok) throw new Error("LRCLIB " + r.status);
    return r.json();
  }
  async function lrcGet(id) {
    const r = await fetch(`${LRCLIB}/get/${id}`);
    if (!r.ok) throw new Error("LRCLIB " + r.status);
    return r.json();
  }

  // "Artist - Song (Official Video)" + канал "Artist - Topic" → {artist, track}
  function cleanTitle(title, channel) {
    let t = (title || "")
      .replace(/[([【][^)\]】]*(official|video|audio|lyric|lyrics|visuali[sz]er|mv|m\/v|hd|4k|remaster|кліп|clip|премʼєра|премьера|prod\.?)[^)\]】]*[)\]】]/gi, "")
      .replace(/\|.*$/, "")
      .replace(/\s+/g, " ").trim();
    const ch = (channel || "").replace(/\s*-\s*Topic$/i, "").replace(/VEVO$/i, "").trim();
    const parts = t.split(/\s[-–—]\s/);
    if (parts.length >= 2) return { artist: parts[0].trim(), track: parts.slice(1).join(" - ").trim() };
    return { artist: ch, track: t };
  }
  function norm(s) { return (s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }

  // найкращий синхронний текст під трек; null — не знайшли
  async function findLyrics(title, channel, dur) {
    const { artist, track } = cleanTitle(title, channel);
    let list = [];
    try { list = await lrcSearch(`${artist} ${track}`.trim()); } catch {}
    if (!list.length && track) { try { list = await lrcSearch(track); } catch {} }
    if (!list.length) return null;
    const nt = norm(track), na = norm(artist);
    let best = null, bestScore = -1e9;
    list.slice(0, 20).forEach((it) => {
      if (it.instrumental) return;
      let s = 0;
      if (it.syncedLyrics) s += 100;
      else if (it.plainLyrics) s += 10; else return;
      if (dur && it.duration) s -= Math.min(60, Math.abs(it.duration - dur)) * 2;
      if (norm(it.trackName) === nt) s += 30; else if (nt && norm(it.trackName).includes(nt)) s += 10;
      if (na && norm(it.artistName).includes(na)) s += 20;
      if (s > bestScore) { bestScore = s; best = it; }
    });
    return best;
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function randomCode() {
    const C = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let s = ""; for (let i = 0; i < 5; i++) s += C[Math.floor(Math.random() * C.length)];
    return s;
  }

  window.Karaoke = {
    ROOT, roomRef, watchClock, now, trackTime, parseVideoId, isoDur, fmtDur,
    parseLrc, lineAt, lineProgress, lrcSearch, lrcGet, cleanTitle, findLyrics, escapeHtml, randomCode,
  };
})();
