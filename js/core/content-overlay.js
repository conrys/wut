// ==========================================================================
// Зміни до вбудованих банків питань/слів, зроблені в editor.html (з телефона).
//
// Файли js/promts/*.js лишаються базою. У Firestore games41_content лежать
// лише зміни: { list, op: "add"|"edit"|"hide", key, data, by, uid, createdAt, updatedAt }
//   add  — нове питання/слово (data), додається в кінець банку;
//   edit — вбудований запис key замінено на data;
//   hide — вбудований запис key прибрано з гри.
//
// Підключати ПІСЛЯ файлів js/promts/* і ДО скриптів гри:
//   <script src="js/core/content-overlay.js"></script>
// Модуль одразу накладає зміни з кешу (localStorage), потім тягне свіжі з
// Firestore і накладає ще раз. Банки змінюються «на місці», тож ігри, які
// беруть питання в момент старту, нічого не знають про редактор.
// ContentOverlay.ready — Promise, коли свіжі зміни накладено (або 4 с минуло).
//
// Квіз адресує питання номером у банку, тому там: додане — лише в кінець теми,
// приховане — позначка off (номери не зсуваються), а quiz-game.js чекає ready.
// ==========================================================================
(function () {
  const COLLECTION = "games41_content";
  const CACHE_KEY = "games41_content_v1";
  const LEVEL3 = [{ v: 1, t: "Легко" }, { v: 2, t: "З перчинкою" }, { v: 3, t: "Гаряче" }];
  const LEVEL_EMH = [{ v: "easy", t: "Легко" }, { v: "medium", t: "Середньо" }, { v: "hard", t: "Складно" }];
  const has = (name) => { try { return typeof eval(name) !== "undefined"; } catch (e) { return false; } };   // const-глобали сторінки
  const get = (name) => { try { return eval(name); } catch (e) { return undefined; } };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const norm = (s) => String(s || "").toLowerCase().replace(/[ʼ'’`]/g, "").replace(/\s+/g, " ").trim();

  // ---------------- адаптери ----------------
  // Кожен банк: get() → жива структура (або undefined, якщо на сторінці її нема),
  // entries(struct) → [{ key, data }], applyAdd/Edit/Hide(struct, …).

  // масив обʼєктів із полем text: PartySeed.*, DilemmaSeed.*, CharadesPrompts
  function objList(getArr, pick) {
    return {
      get: getArr,
      entries: (arr) => arr.map((x) => ({ key: norm(x.text), data: pick(x) })),
      make: (d) => pick(d),
      keyOfData: (d) => norm(d.text),
      restore: (arr, base) => { arr.length = 0; base.forEach((x) => arr.push(clone(x))); },
      edit: (arr, key, d) => { const i = arr.findIndex((x) => norm(x.text) === key); if (i >= 0) arr[i] = Object.assign(arr[i], pick(d)); },
      hide: (arr, key) => { const i = arr.findIndex((x) => norm(x.text) === key); if (i >= 0) arr.splice(i, 1); },
      add: (arr, d) => { if (!arr.some((x) => norm(x.text) === norm(d.text))) arr.push(pick(d)); },
    };
  }
  // масив рядків: QUIPLASH_PROMPTS, MEMOLOGY_PROMPTS, TeliIdeas…
  function strList(getArr) {
    return {
      get: getArr,
      entries: (arr) => arr.map((t) => ({ key: norm(t), data: { text: t } })),
      make: (d) => String(d.text),
      keyOfData: (d) => norm(d.text),
      restore: (arr, base) => { arr.length = 0; base.forEach((x) => arr.push(x)); },
      edit: (arr, key, d) => { const i = arr.findIndex((t) => norm(t) === key); if (i >= 0) arr[i] = String(d.text); },
      hide: (arr, key) => { const i = arr.findIndex((t) => norm(t) === key); if (i >= 0) arr.splice(i, 1); },
      add: (arr, d) => { if (!arr.some((t) => norm(t) === norm(d.text))) arr.push(String(d.text)); },
    };
  }
  // { easy:[], medium:[], hard:[] } рядків: DRAW_PROMPTS, ALIAS_WORDS
  function levelObj(getObj) {
    const K = (lvl, t) => lvl + "|" + norm(t);
    return {
      get: getObj,
      entries: (o) => LEVEL_EMH.flatMap(({ v }) => (o[v] || []).map((t) => ({ key: K(v, t), data: { text: t, level: v } }))),
      keyOfData: (d) => K(d.level, d.text),
      restore: (o, base) => Object.keys(base).forEach((k) => { o[k] = o[k] || []; o[k].length = 0; base[k].forEach((t) => o[k].push(t)); }),
      edit: (o, key, d) => { const [lvl] = key.split("|"); const a = o[lvl] || []; const i = a.findIndex((t) => K(lvl, t) === key); if (i >= 0) a[i] = String(d.text); },
      hide: (o, key) => { const [lvl] = key.split("|"); const a = o[lvl] || []; const i = a.findIndex((t) => K(lvl, t) === key); if (i >= 0) a.splice(i, 1); },
      add: (o, d) => { const a = (o[d.level] = o[d.level] || []); if (!a.some((t) => norm(t) === norm(d.text))) a.push(String(d.text)); },
    };
  }
  // теми: [{ name, easy, medium, hard }] (Крокодил, Хто я?) або [{ name, words }] (Шпигун)
  function themeList(getArr, levels) {
    const fields = levels ? LEVEL_EMH.map((l) => l.v) : ["words"];
    const K = (th, lvl, t) => norm(th) + "|" + lvl + "|" + norm(t);
    const slot = (arr, th, lvl) => { const t = arr.find((x) => norm(x.name) === norm(th)); return t ? (t[lvl] = t[lvl] || []) : null; };
    return {
      get: getArr,
      themes: (arr) => arr.map((t) => t.name),
      entries: (arr) => arr.flatMap((t) => fields.flatMap((lvl) => (t[lvl] || []).map((w) => ({ key: K(t.name, lvl, w), data: { theme: t.name, level: levels ? lvl : "", text: w } })))),
      keyOfData: (d) => K(d.theme, levels ? d.level : "words", d.text),
      restore: (arr, base) => base.forEach((b, i) => { fields.forEach((f) => { if (!arr[i]) return; arr[i][f] = arr[i][f] || []; arr[i][f].length = 0; (b[f] || []).forEach((w) => arr[i][f].push(w)); }); }),
      edit: (arr, key, d) => { const [th, lvl] = key.split("|"); const a = slot(arr, th, lvl) || []; const i = a.findIndex((w) => K(th, lvl, w) === key); if (i >= 0) a[i] = String(d.text); },
      hide: (arr, key) => { const [th, lvl] = key.split("|"); const a = slot(arr, th, lvl) || []; const i = a.findIndex((w) => K(th, lvl, w) === key); if (i >= 0) a.splice(i, 1); },
      add: (arr, d) => { const a = slot(arr, d.theme, levels ? d.level : "words"); if (a && !a.some((w) => norm(w) === norm(d.text))) a.push(String(d.text)); },
    };
  }
  // Квіз: window.QUIZ_SETS { "1": [{ name, questions:[…] }], … }
  const quizAdapter = {
    get: () => window.QUIZ_SETS,
    entries: (sets) => Object.keys(sets).sort((a, b) => a - b).flatMap((set) => sets[set].flatMap((t) => t.questions.map((q) => ({
      key: set + "|" + norm(q.text),
      data: { set, topic: t.name, value: q.value, text: q.text, options: q.options.slice(), correct: (q.correctIndices || [0])[0], answerText: q.answerText || "" },
    })))),
    keyOfData: (d) => String(d.set) + "|" + norm(d.text),
    restore: (sets, base) => {
      Object.keys(sets).forEach((k) => { if (!base[k]) delete sets[k]; });
      Object.keys(base).forEach((k) => { const a = sets[k] || (sets[k] = []); a.length = 0; base[k].forEach((t) => a.push(clone(t))); });
    },
    find: (sets, key) => {
      const [set] = key.split("|");
      for (const t of sets[set] || []) for (const q of t.questions) if (set + "|" + norm(q.text) === key) return q;
      return null;
    },
    q: (d) => ({ text: d.text, options: d.options.slice(0, 4), value: Number(d.value), timeLimit: Number(d.value) <= 200 ? 20 : 30,
      correctIndices: [Number(d.correct) || 0], answerText: d.answerText || "" }),
    edit(sets, key, d) { const q = this.find(sets, key); if (q) Object.assign(q, this.q(Object.assign({}, d, { value: q.value }))); },   // ціну вбудованого не міняємо — вона тримає місце на полі
    hide(sets, key) { const q = this.find(sets, key); if (q) q.off = true; },
    add(sets, d) {
      const set = String(d.set);
      const arr = sets[set] || (sets[set] = []);
      let t = arr.find((x) => norm(x.name) === norm(d.topic));
      if (!t) { t = { name: String(d.topic).trim(), questions: [] }; arr.push(t); }
      if (!t.questions.some((q) => norm(q.text) === norm(d.text))) t.questions.push(this.q(d));
    },
  };

  // ---------------- опис банків для редактора ----------------
  // fields: text | textarea | level3 | levelEMH | select(opts) | tags | theme
  const LISTS = [
    { id: "whofrom", game: "Хто з нас?", title: "Питання", a: objList(() => window.PartySeed && window.PartySeed.WHOFROM, (x) => ({ text: x.text, level: Number(x.level) || 1 })),
      fields: [{ k: "text", t: "textarea", label: "Питання" }, { k: "level", t: "level3", label: "Гострота" }],
      hint: "Повне речення: «Хто з нас найімовірніше…?»", empty: { level: 1 } },
    { id: "court", game: "Суд Лінча", title: "Звинувачення", a: objList(() => window.PartySeed && window.PartySeed.COURT, (x) => ({ text: x.text, level: Number(x.level) || 1 })),
      fields: [{ k: "text", t: "textarea", label: "Звинувачення" }, { k: "level", t: "level3", label: "Гострота" }],
      hint: "Дієслівна фраза: гра підставить «Звинувачений » + текст.", empty: { level: 1 } },
    { id: "bets", game: "Ставки", title: "Завдання", a: objList(() => window.PartySeed && window.PartySeed.BETS, (x) => ({ text: x.text, level: Number(x.level) || 1 })),
      fields: [{ k: "text", t: "textarea", label: "Завдання" }, { k: "level", t: "level3", label: "Гострота" }],
      hint: "Наказова форма: «Розповісти…», «Станцювати…».", empty: { level: 1 } },
    { id: "dilemmas", game: "Дилеми", title: "Твердження", a: objList(() => window.DilemmaSeed && window.DilemmaSeed.STATEMENTS, (x) => ({ text: x.text, kind: x.kind === "ok" ? "ok" : "agree", level: Number(x.level) || 1 })),
      fields: [{ k: "text", t: "textarea", label: "Твердження" }, { k: "kind", t: "select", label: "Кнопки", opts: [{ v: "agree", t: "Згоден / Не згоден" }, { v: "ok", t: "Прийнятно / Неприйнятно" }] }, { k: "level", t: "level3", label: "Гострота" }],
      hint: "Має ділити компанію приблизно навпіл. Без партійної політики й релігії.", empty: { level: 1, kind: "agree" } },
    { id: "dilemma_tasks", game: "Дилеми", title: "Завдання для меншості", a: objList(() => window.DilemmaSeed && window.DilemmaSeed.TASKS, (x) => ({ text: x.text, level: Number(x.level) || 1 })),
      fields: [{ k: "text", t: "textarea", label: "Завдання" }, { k: "level", t: "level3", label: "Гострота" }], hint: "Наказова форма.", empty: { level: 1 } },
    { id: "charades", game: "Зіпсовані шаради", title: "Слова", a: objList(() => window.CharadesPrompts, (x) => {
        const o = { text: x.text, cat: x.cat || "", level: Number(x.level) || 1 };
        const alt = (Array.isArray(x.alt) ? x.alt : String(x.alt || "").split(",")).map((s) => String(s).trim()).filter(Boolean);
        if (alt.length) o.alt = alt;
        return o;
      }),
      fields: [{ k: "text", t: "text", label: "Що загадується" }, { k: "cat", t: "text", label: "Категорія (підказка)", ph: "Фільм, Пісня, Мем…" },
        { k: "alt", t: "tags", label: "Інші правильні відповіді", ph: "через кому: Titanic, Тітанік" }, { k: "level", t: "level3", label: "Складність", labels: ["Легко", "Середньо", "Складно"] }],
      hint: "Відомі назви, які можна передати емодзі.", empty: { level: 1, cat: "" } },
    { id: "quiplash", game: "Сміхлист", title: "Питання", a: strList(() => get("QUIPLASH_PROMPTS")),
      fields: [{ k: "text", t: "textarea", label: "Питання" }], hint: "Обовʼязково з «___» на місці відповіді.", need: "___", empty: {} },
    { id: "quiplash_facts", game: "Сміхлист", title: "Факти для ТВ", a: strList(() => get("QUIPLASH_FACTS")),
      fields: [{ k: "text", t: "textarea", label: "Факт" }], hint: "Перевірений цікавий факт одним реченням.", empty: {} },
    { id: "memology", game: "Мемологія", title: "Ситуації", a: strList(() => get("MEMOLOGY_PROMPTS")),
      fields: [{ k: "text", t: "textarea", label: "Ситуація" }], hint: "До неї кидають мем: «Коли…», «Як я…».", empty: {} },
    { id: "teli", game: "Зіпсований телефон", title: "Ідеї першої фрази", a: strList(() => window.TeliIdeas),
      fields: [{ k: "text", t: "text", label: "Ідея" }], hint: "Коротка смішна сценка, яку можна намалювати.", empty: {} },
    { id: "draw", game: "Малювалка", title: "Слова", a: levelObj(() => get("DRAW_PROMPTS")),
      fields: [{ k: "text", t: "text", label: "Що малювати" }, { k: "level", t: "levelEMH", label: "Складність" }], empty: { level: "easy" } },
    { id: "alias", game: "Еліас", title: "Слова", a: levelObj(() => window.ALIAS_WORDS),
      fields: [{ k: "text", t: "text", label: "Слово" }, { k: "level", t: "levelEMH", label: "Складність" }], empty: { level: "easy" } },
    { id: "crocodile", game: "Крокодил", title: "Слова", a: themeList(() => get("CROCODILE_THEMES"), true),
      fields: [{ k: "theme", t: "theme", label: "Тема" }, { k: "text", t: "text", label: "Слово" }, { k: "level", t: "levelEMH", label: "Складність" }], empty: { level: "easy" } },
    { id: "whoami", game: "Хто я?", title: "Слова", a: themeList(() => get("WHOAMI_THEMES"), true),
      fields: [{ k: "theme", t: "theme", label: "Тема" }, { k: "text", t: "text", label: "Слово" }, { k: "level", t: "levelEMH", label: "Складність" }], empty: { level: "easy" } },
    { id: "spy", game: "Шпигун", title: "Слова", a: themeList(() => get("SPY_THEMES"), false),
      fields: [{ k: "theme", t: "theme", label: "Тема" }, { k: "text", t: "text", label: "Слово" }], empty: {} },
    { id: "quiz", game: "Квіз", title: "Питання", a: quizAdapter, quiz: true,
      hint: "Правильна відповідь — одна з чотирьох. Нова тема йде на поле, коли в ній є питання на всі ціни 100–500.", empty: { set: "1", value: 100, correct: 0, options: ["", "", "", ""] } },
  ];
  const byId = {}; LISTS.forEach((l) => { byId[l.id] = l; });

  // ---------------- накладання ----------------
  const base = {};   // id → незмінена копія з файлу (знімаємо до першого накладання)
  let docs = [];
  function snapshot() {
    LISTS.forEach((l) => { const s = l.a.get(); if (s && !base[l.id]) base[l.id] = clone(s); });
  }
  function applyAll(list) {
    docs = (list || []).filter((d) => d && byId[d.list] && d.op)
      .sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0) || (x.id < y.id ? -1 : 1));
    LISTS.forEach((l) => {
      const s = l.a.get();
      if (!s || !base[l.id]) return;
      l.a.restore(s, base[l.id]);
      const mine = docs.filter((d) => d.list === l.id);
      mine.filter((d) => d.op === "edit" && d.data).forEach((d) => { try { l.a.edit(s, d.key, d.data); } catch (e) {} });
      mine.filter((d) => d.op === "hide").forEach((d) => { try { l.a.hide(s, d.key); } catch (e) {} });
      mine.filter((d) => d.op === "add" && d.data).forEach((d) => { try { l.a.add(s, d.data); } catch (e) {} });
    });
    try { document.dispatchEvent(new CustomEvent("contentoverlay", { detail: { docs } })); } catch (e) {}
  }
  function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "[]"); } catch (e) { return []; } }
  function writeCache(list) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(list)); } catch (e) {} }

  snapshot();
  applyAll(readCache());   // одразу, щоб гра вже мала зміни з минулого разу

  function fetchFresh() {
    if (!window.firebaseReady || typeof db === "undefined" || !db) return Promise.resolve(null);
    return db.collection(COLLECTION).get().then((snap) => snap.docs.map((d) => Object.assign({ id: d.id }, d.data())));
  }
  let resolveReady;
  const ready = new Promise((r) => { resolveReady = r; });
  setTimeout(() => resolveReady(false), 4000);
  function refresh() {
    snapshot();   // на випадок, якщо файл банку підключено пізніше за модуль
    return fetchFresh().then((list) => {
      if (!list) return false;
      const sig = (a) => JSON.stringify(a.map((d) => [d.id, d.updatedAt || d.createdAt]).sort());
      if (sig(list) !== sig(docs)) { writeCache(list); applyAll(list); }
      return true;
    }).catch((e) => { console.warn("ContentOverlay:", e && (e.code || e.message)); return false; });
  }
  // firebase-config.js на деяких сторінках підключено нижче — тягнемо після розбору сторінки
  const go = () => refresh().then((ok) => resolveReady(ok));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go); else setTimeout(go, 0);

  window.ContentOverlay = {
    COLLECTION, LISTS, byId, ready, refresh, norm, LEVEL3, LEVEL_EMH,
    base: (id) => base[id] || null,
    docs: () => docs.slice(),
    applyAll: (list) => { writeCache(list); applyAll(list); },
  };
})();
