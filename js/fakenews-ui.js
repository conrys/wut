// ==========================================================================
// Ефірна картка Fake News — спільна для телефона (fakenews.html) і ТВ (fakenews-tv.html).
// FakeNewsUI.renderNews(card, room, st, { loadPhoto, cls }) → { sameStage } коли змінився заголовок
// FakeNewsUI.makeLoader(roomId) → loadPhoto(p) для сторінки без запущеного рушія (ТВ)
// FakeNewsUI.photoTitle(room, p), channelIcon(id), noEmoji(text)
// Стилі — js/styles/fakenews-news.css.
// ==========================================================================
(function () {
  const BOLT = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2L4.5 13.5H12L11 22l8.5-11.5H12z"/></svg>';
  // рушій додає емодзі на початок підсумкових рядків — в інтерфейсі без них
  const noEmoji = (t) => String(t || "").replace(/^(?:\p{Extended_Pictographic}️?\s*)+/u, "");
  const CH_ICONS = {
    tv: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M8 2l4 4 4-4"/>',
    tabloid: '<path d="M4 5h13v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM17 9h3v10a1 1 0 0 1-1 1h-2"/><path d="M7 9h7M7 13h7M7 16h4"/>',
    tg: '<path d="M21 4L3 11l6 2 2 6 3-4 5 4z"/><path d="M9 13l8-6"/>',
    radio: '<rect x="3" y="9" width="18" height="11" rx="2"/><circle cx="8" cy="14.5" r="2.5"/><path d="M14 13h4M14 16h4M6 9l11-5"/>',
    sport: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8M10 17h4"/>',
  };
  const channelIcon = (id) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${CH_ICONS[id] || CH_ICONS.tv}</svg>`;

  // Кожен канал: розмітка картки + підписи на кожен етап. У розмітці обов'язкові
  // img, .hlbox > .hl (заголовок), .tag, .cnt, .tick — їх заповнює renderNews.
  const EQ_BARS = Array.from({ length: 14 }, (_, i) => `<i style="animation-delay:-${(i * 0.37) % 1}s"></i>`).join("");
  const CH_UI = {
    tv: {
      html: `<img alt="" /><div class="live tag"></div><div class="cnt hidden"></div>
        <div class="l3"><div class="l3-head hlbox"><span class="hl"></span></div><div class="ticker"><span class="tick"></span></div></div>`,
      tag: { write: "ТЕРМІНОВО", show: "● ЕФІР", vote: "ГОЛОСУВАННЯ", reveal: "ВИРОК ГЛЯДАЧІВ" },
      tick: { write: () => "41 NEWS · РЕДАКЦІЯ ЧЕКАЄ НА ЗАГОЛОВКИ", show: (i) => "41 NEWS · ПРЯМИЙ ЕФІР · ЗАГОЛОВОК " + i,
        vote: () => "41 NEWS · ГЛЯДАЧІ ОБИРАЮТЬ НАЙКРАЩИЙ ФЕЙК", reveal: (h) => "41 NEWS · " + h },
      wait: "Тут буде твій заголовок…", ask: "Який заголовок найкращий?",
    },
    tabloid: {
      html: `<div class="tb-mast"><span>Жовта преса</span><small>щоденник пліток · №41</small></div>
        <div class="tb-photo"><img alt="" /><div class="tb-stamp tag"></div><div class="cnt hidden"></div></div>
        <div class="tb-head hlbox"><span class="hl"></span></div><div class="tb-sub tick"></div>`,
      tag: { write: "СЕНСАЦІЯ!", show: "ЕКСКЛЮЗИВ!", vote: "ЧИТАЧІ ВИРІШУЮТЬ", reveal: "ГОЛОВНА ПЛІТКА" },
      tick: { write: () => "Редакція перевіряє плітки (ні)", show: (i) => `Плітка №${i}. Джерело побажало лишитися анонімним`,
        vote: () => "Яка плітка гучніша? Голосуйте!", reveal: (h) => h },
      wait: "Тут буде гучний заголовок…", ask: "Яка плітка найгучніша?",
    },
    tg: {
      html: `<div class="tg-top"><span class="tg-ava">${BOLT}</span><span><b>Терміново | 41</b><small class="tag"></small></span><span class="cnt hidden"></span></div>
        <div class="tg-photo"><img alt="" /></div><div class="tg-text hlbox"><span class="hl"></span></div>
        <div class="tg-foot"><span class="tg-reacts"><span>🔥 41</span><span>😱 17</span><span>🤡 6</span></span><span class="tick"></span></div>`,
      tag: { write: "41 тис. підписників · друкує…", show: "41 тис. підписників · щойно", vote: "41 тис. підписників · опитування", reveal: "41 тис. підписників · закріплено" },
      tick: { write: () => "👁 —", show: (i) => `👁 ${(12.4 + i * 3.1).toFixed(1)}K`, vote: () => "👁 41K", reveal: () => "👁 99K" },
      wait: "друкує…", ask: "Опитування: який пост найкращий?",
    },
    radio: {
      html: `<img alt="" /><div class="rd-top"><span class="rd-onair tag"></span><span class="rd-freq">FM 104.1 · Радіо 41</span><span class="cnt hidden"></span></div>
        <div class="rd-eq">${EQ_BARS}</div><div class="rd-head hlbox"><span class="hl"></span></div><div class="rd-tick tick"></div>`,
      tag: { write: "У СТУДІЇ", show: "В ЕФІРІ", vote: "ДЗВІНКИ В СТУДІЮ", reveal: "ХІТ ЕФІРУ" },
      tick: { write: () => "Диктор розминає голос…", show: (i) => `Ви слухаєте Радіо 41 · новина ${i}`, vote: () => "Телефонуйте в студію: яка новина найкраща?", reveal: (h) => h },
      wait: "Диктор чекає на текст…", ask: "Яку новину крутити ще раз?",
    },
    sport: {
      html: `<img alt="" /><div class="sp-board"><span class="sp-logo">41 SPORT</span><span class="sp-score">2 : 1</span><span class="sp-live tag"></span></div><div class="cnt hidden"></div>
        <div class="sp-bar"><div class="sp-head hlbox"><span class="hl"></span></div><div class="sp-tick"><span class="tick"></span></div></div>`,
      tag: { write: "РОЗМИНКА", show: "LIVE", vote: "VAR", reveal: "ФІНАЛЬНИЙ СВИСТОК" },
      tick: { write: () => "41 SPORT · КОМАНДИ ВИХОДЯТЬ НА ПОЛЕ", show: (i) => `41 SPORT · ПРЯМА ТРАНСЛЯЦІЯ · МОМЕНТ ${i}`,
        vote: () => "41 SPORT · ПЕРЕГЛЯДАЄМО ПОВТОРИ", reveal: (h) => "41 SPORT · " + h },
      wait: "Коментатор готується…", ask: "Який момент найкращий?",
    },
  };
  function renderNews(card, room, st, opts) {
    opts = opts || {};
    const d = st.data || {}, chId = CH_UI[d.ch] ? d.ch : "tv", ui = CH_UI[chId];
    if (card.dataset.ch !== chId) {   // інший канал — інша розмітка
      card.dataset.ch = chId; card.className = "news ch-" + chId + (opts.cls ? " " + opts.cls : ""); card.innerHTML = ui.html; card.dataset.photo = ""; card.dataset.head = "";
    }
    const img = card.querySelector("img");
    const key = JSON.stringify(st.photo || null);
    if (card.dataset.photo !== key) {
      card.dataset.photo = key; img.removeAttribute("src"); card.style.removeProperty("--ph");
      (opts.loadPhoto || (() => Promise.resolve(null)))(st.photo).then((src) => { if (card.dataset.photo === key && src) { img.src = src; card.style.setProperty("--ph", `url("${src}")`); } });
    }
    const kind = ["write", "show", "vote"].includes(st.kind) ? st.kind : "reveal";
    let text = "", muted = false, count = "", tick = "";
    if (kind === "write") { text = ui.wait; muted = true; tick = ui.tick.write(); }
    else if (kind === "show") {
      const idx = Math.min((room.show && room.show.idx) || 0, d.texts.length - 1);
      text = d.texts[idx]; count = `${idx + 1} / ${d.texts.length}`; tick = ui.tick.show(idx + 1);
    } else if (kind === "vote") { text = ui.ask; muted = true; tick = ui.tick.vote(); }
    else {
      const top = (st.results || [])[0];
      text = top && top.v > 0 ? top.t : noEmoji(st.headline); tick = ui.tick.reveal(noEmoji(st.headline));
    }
    const head = card.querySelector(".hlbox"), cnt = card.querySelector(".cnt");
    head.querySelector(".hl").textContent = text;
    head.classList.toggle("muted", muted);
    const hk = st.id + "|" + text, prev = card.dataset.head || "";
    let changed = null;
    if (hk !== prev) {
      changed = { sameStage: !!prev && prev.split("|")[0] === String(st.id) };
      card.dataset.head = hk; head.classList.remove("pop"); void head.offsetWidth; head.classList.add("pop");
    }
    card.querySelector(".tag").textContent = ui.tag[kind];
    cnt.textContent = count; cnt.classList.toggle("hidden", !count);
    card.querySelector(".tick").textContent = tick;
    return changed;
  }


  // ---------------- фото без рушія (ТВ) ----------------
  function makeLoader(roomId) {
    const cache = new Map();
    return function loadPhoto(p) {
      if (!p) return Promise.resolve(null);
      const key = p.k === "pool" ? "pool:" + p.i : `up:${p.n}/${p.id}`;
      if (cache.has(key)) return cache.get(key);
      let pr;
      if (p.k === "pool") { const it = (window.FakeNewsPhotos || [])[p.i]; pr = Promise.resolve(it ? it.src : null); }
      else pr = window.rtdb.ref(`fakenews_photos/${roomId}/${p.n}/${p.id}`).get().then((s) => (s.exists() ? s.val() : null)).catch(() => null);
      cache.set(key, pr);
      pr.then((src) => { if (!src) cache.delete(key); });
      return pr;
    };
  }
  function photoTitle(room, p) {
    if (!p) return "";
    if (p.k === "pool") {
      const it = (window.FakeNewsPhotos || [])[p.i];
      if (!it) return "";
      if (typeof it.title === "string" && it.title.trim()) return it.title.trim();
      let f = String(it.src || "").split(/[?#]/, 1)[0].split(/[\/]/).pop() || "";
      try { f = decodeURIComponent(f); } catch (e) {}
      return f.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    }
    const meta = room && room.photoMeta && room.photoMeta[p.n] && room.photoMeta[p.n][p.id];
    return meta && typeof meta.title === "string" && meta.title.trim() ? meta.title.trim() : `Фото від ${p.n}`;
  }

  window.FakeNewsUI = { renderNews, makeLoader, photoTitle, channelIcon, noEmoji, CH_UI };
})();
