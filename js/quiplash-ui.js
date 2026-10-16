// ==========================================================================
// Спільні UI-помічники Сміхлиста для телефона і ТВ.
// ==========================================================================
(function () {
  const G = () => window.QuiplashGame;
  const A = () => window.QuiplashAvatars;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  // «… — ___» → підкреслений пропуск
  function promptHtml(text) {
    return esc(text).replace(/_{2,}/g, '<span class="blank">&nbsp;</span>');
  }
  function playersById(state) {
    const out = {};
    Object.entries(state.players || {}).forEach(([n, p]) => { out[n] = Object.assign({ name: n }, p); });
    return out;
  }
  function avatar(p, mood, cls) { return A().html(p || { character: 1 }, mood, cls); }

  // Залишок фази з урахуванням паузи: { remaining, total, frac }
  function phaseTimer(state) {
    if (!state || !state.phaseDeadline) return null;
    const now = G().now();
    const pausedFor = state.paused ? Math.max(0, now - (state.pausedAt || now)) : 0;
    const deadline = state.phaseDeadline + pausedFor;
    const startedAt = (state.phaseStartedAt || deadline - 1) + pausedFor;
    const total = Math.max(1, deadline - startedAt);
    const remaining = Math.max(0, deadline - now);
    return { remaining, total, frac: Math.max(0, Math.min(1, remaining / total)), notStarted: now < startedAt };
  }

  // Кільце таймера. Повертає ціле число секунд, що лишились (для тіків звуку).
  function paintTimer(el, state, visible) {
    if (!el) return null;
    const t = visible ? phaseTimer(state) : null;
    if (!t || t.notStarted) { el.classList.add("hidden-timer"); return null; }
    el.classList.remove("hidden-timer");
    const secs = Math.ceil(t.remaining / 1000);
    el.style.setProperty("--p", t.frac.toFixed(3));
    const span = el.querySelector("span");
    if (span && span.textContent !== String(secs)) span.textContent = String(secs);
    el.classList.toggle("urgent", secs <= 5);
    el.classList.toggle("warn", secs > 5 && t.frac < 0.35);
    return secs;
  }

  function roundTitle(round) {
    const plan = G().ROUND_PLAN;
    const type = plan[(round || 1) - 1] || "classic";
    if (type === "image") return { title: "Фінал!", sub: "Один підпис до картинки — голосують усі", mult: "×3 бали" };
    if (round === 2) return { title: "Раунд 2", sub: "Ті самі правила, але бали подвоюються", mult: "×2 бали" };
    return { title: `Раунд ${round}`, sub: "Пиши найсмішніші відповіді — суперник отримає те саме питання", mult: round > 1 ? `×${G().mult(round)} бали` : "100 балів за голос" };
  }

  function bonusLabel(kind, pts) {
    if (kind === "super") return `<span class="ql-bonus super">СМІХЛИСТ! +${pts}</span>`;
    if (kind === "win") return `<span class="ql-bonus">Перемога +${pts}</span>`;
    if (kind === "forfeit") return `<span class="ql-bonus forfeit">Без бою 🏳️</span>`;
    return "";
  }

  function votesWord(n) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return "голос";
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "голоси";
    return "голосів";
  }

  // Таблиця рахунку з анімацією переставляння місць (FLIP) і приростом за раунд.
  function renderBoard(container, state, opts) {
    opts = opts || {};
    const byId = playersById(state);
    const round = state.round || 0;
    const rows = Object.values(byId).map((p) => ({
      ...p,
      score: p.score || 0,
      before: opts.showDelta ? G().scoreBefore(state, p.name, round) : (p.score || 0),
    }));
    const now = rows.slice().sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const prev = rows.slice().sort((a, b) => b.before - a.before || a.name.localeCompare(b.name));
    const key = now.map((r) => `${r.name}:${r.score}:${r.character}`).join("|") + (opts.showDelta ? "|d" + round : "");
    if (container.dataset.key === key) return;
    container.dataset.key = key;
    const max = Math.max(1, ...now.map((r) => r.score));
    const prevRank = {};
    prev.forEach((r, i) => { prevRank[r.name] = i; });
    container.classList.add("ql-board");
    container.innerHTML = now.map((r, i) => {
      const delta = r.score - r.before;
      const move = opts.showDelta ? prevRank[r.name] - i : 0;
      const mood = opts.final ? (i === 0 ? "happy" : i === now.length - 1 && now.length > 2 ? "sad" : "idle") : (delta > 0 && i === 0 ? "happy" : "idle");
      return `<div class="ql-row${i === 0 && r.score > 0 ? " first" : ""}${r.name === opts.me ? " me" : ""}" data-name="${esc(r.name)}" style="--c:${r.color || "#2ee6c5"}">
        <div class="ql-row-rank">${i === 0 && r.score > 0 ? "👑" : i + 1}</div>
        ${avatar(r, mood)}
        <div class="ql-row-main">
          <div class="ql-row-name">${esc(r.name)}${move > 0 ? `<span class="ql-row-move up">▲${move}</span>` : move < 0 ? `<span class="ql-row-move down">▼${-move}</span>` : ""}</div>
          <div class="ql-row-bar"><i data-w="${Math.round((r.score / max) * 100)}" style="width:${opts.showDelta ? Math.round((r.before / max) * 100) : 0}%"></i></div>
        </div>
        <div class="ql-row-score" data-from="${r.before}" data-to="${r.score}">${opts.showDelta ? r.before : r.score}</div>
        ${opts.showDelta && delta > 0 ? `<div class="ql-row-delta">+${delta}</div>` : ""}
      </div>`;
    }).join("");
    // FLIP: рядки стартують зі старих місць і з'їжджають на нові
    if (opts.showDelta) {
      const els = Array.from(container.children);
      const h = els[0] ? els[0].getBoundingClientRect().height + 8 : 0;
      els.forEach((el, i) => {
        const from = prevRank[el.dataset.name];
        if (from !== undefined && from !== i) el.style.transform = `translateY(${(from - i) * h}px)`;
      });
      setTimeout(() => els.forEach((el) => { el.style.transform = ""; }), 900);
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      container.querySelectorAll(".ql-row-bar i").forEach((i) => { i.style.width = i.dataset.w + "%"; });
    }));
    // лічильник балів
    container.querySelectorAll(".ql-row-score").forEach((el) => {
      const from = Number(el.dataset.from), to = Number(el.dataset.to);
      if (from === to) { el.textContent = to; return; }
      const start = performance.now() + 500, dur = 1100;
      const step = (ts) => {
        const k = Math.max(0, Math.min(1, (ts - start) / dur));
        el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
        if (k < 1 && el.isConnected) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  function confetti(count) {
    const box = document.createElement("div");
    box.className = "ql-confetti";
    const colors = ["#ffd23f", "#ff4f9a", "#2ee6c5", "#4d8dff", "#ff7f6b", "#ffffff"];
    let html = "";
    for (let i = 0; i < (count || 80); i++) {
      html += `<i style="left:${Math.random() * 100}%;background:${colors[i % colors.length]};--dx:${(Math.random() * 200 - 100).toFixed(0)}px;--rot:${(Math.random() * 1080 - 540).toFixed(0)}deg;--dur:${(2.2 + Math.random() * 2).toFixed(2)}s;--delay:${(Math.random() * 0.8).toFixed(2)}s"></i>`;
    }
    box.innerHTML = html;
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 5200);
  }

  // Повноекранний «СМІХЛИСТ!» рівно раз на подію (superSmihlystokAt унікальний).
  let lastSuperAt = null;
  function maybeSuper(state, onPlay) {
    const at = state.superSmihlystokAt;
    if (!at || at === lastSuperAt) return;
    const first = lastSuperAt === null;
    lastSuperAt = at;
    // не програємо стару подію при першому завантаженні сторінки
    if (first && G().now() - at > 8000) return;
    let el = document.getElementById("ql-super");
    if (!el) {
      el = document.createElement("div");
      el.id = "ql-super";
      el.className = "ql-super";
      document.body.appendChild(el);
    }
    const p = (state.players || {})[state.superSmihlystokUsername] || { character: 1 };
    // невелика затримка — спершу видно голоси, потім вибух
    setTimeout(() => {
      el.innerHTML = `${avatar(p, "happy")}<div class="ql-super-label">СМІХЛИСТ!</div><div class="ql-super-name">${esc(state.superSmihlystokUsername || "")} забирає всі голоси</div>`;
      el.classList.remove("playing");
      void el.offsetWidth;
      el.classList.add("playing");
      confetti(70);
      if (onPlay) onPlay();
      setTimeout(() => el.classList.remove("playing"), 2700);
    }, 1400);
  }

  window.QuiplashUI = { esc, promptHtml, playersById, avatar, phaseTimer, paintTimer, roundTitle, bonusLabel, votesWord, renderBoard, confetti, maybeSuper };
})();
