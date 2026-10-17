// ==========================================================================
// Історія показаних питань — щоб від гри до гри не випадало те саме.
// Спершу йдуть ще не бачені питання (у випадковому порядку), потім — ті,
// що показувались найдавніше. Коли банк вичерпано, коло починається знову.
//
// Де живе історія:
//   - Firestore games41_prompt_history/{гра} = { seen: { <id питання>: мс } } —
//     спільна для всієї компанії, хоч би хто був хостом;
//   - localStorage на пристрої хоста — запасна копія (офлайн або без правил).
//
// Використання (хост):
//   PromptHistory.preload("dilemmas");                 // раз при завантаженні сторінки
//   const ordered = PromptHistory.order("dilemmas", items, (x) => x.text);
//   PromptHistory.mark("dilemmas", ["текст показаного питання"]);
// Підключати після js/core/firebase-config.js.
// ==========================================================================
(function () {
  const COLLECTION = "games41_prompt_history";
  const LS_PREFIX = "games41_seen_";
  const cache = {}; // гра -> { id: мс }

  function id(text) {
    let h = 0;
    const s = String(text || "");
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
    return "p" + h.toString(36);
  }

  function local(game) {
    try { return JSON.parse(localStorage.getItem(LS_PREFIX + game) || "{}") || {}; } catch (e) { return {}; }
  }
  function saveLocal(game, seen) {
    try { localStorage.setItem(LS_PREFIX + game, JSON.stringify(seen)); } catch (e) {}
  }
  function merge(game, more) {
    const seen = cache[game] || (cache[game] = local(game));
    for (const k in more || {}) if (!(seen[k] >= more[k])) seen[k] = more[k];
    return seen;
  }
  function fsDoc(game) {
    try {
      if (window.firebaseReady && typeof db !== "undefined" && db) return db.collection(COLLECTION).doc(game);
    } catch (e) {}
    return null;
  }

  // Підтягує спільну історію в памʼять; order() працює й до завершення (лише з локальною).
  function preload(game) {
    merge(game, {});
    const ref = fsDoc(game);
    if (!ref) return Promise.resolve();
    return ref.get().then((snap) => {
      const data = snap.exists ? snap.data() : null;
      merge(game, data && data.seen);
      saveLocal(game, cache[game]);
    }).catch(() => {});
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }

  // Не бачені — випадково, далі бачені від найдавнішого. Повертає новий масив.
  function order(game, items, textOf) {
    const seen = merge(game, {});
    const get = textOf || ((x) => x);
    const fresh = [], old = [];
    (items || []).forEach((x) => { const t = seen[id(get(x))]; (t ? old : fresh).push({ x, t: t || 0 }); });
    shuffle(fresh);
    // серед давно бачених теж трохи перемішуємо, щоб порядок не був однаковим
    old.sort((a, b) => a.t - b.t || Math.random() - 0.5);
    return fresh.concat(old).map((o) => o.x);
  }

  function mark(game, texts) {
    const now = Date.now(), patch = {};
    (texts || []).forEach((t) => { if (t) patch[id(t)] = now; });
    if (!Object.keys(patch).length) return;
    saveLocal(game, merge(game, patch));
    const ref = fsDoc(game);
    if (ref) ref.set({ seen: patch }, { merge: true }).catch(() => {});
  }

  window.PromptHistory = { preload, order, mark, id };
})();
