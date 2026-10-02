// ==========================================================================
// fact-pool.js — спільний пул особистих фактів/фраз, який живить одразу
// кілька ігор: Human Bingo ("знайди того, хто..."), читання "Я ніколи не"
// (в тому числі валет у King's Cup), і будь-яку майбутню гру на цьому ж
// принципі. Живе всередині кімнати ГРИ, що його використовує (room.factPool),
// не окремою базою — кожна гра має свій пул, playCount/lastPlayedAt пишуться
// per-факт для майбутніх вечірок (див. коментар нижче).
//
// Одна фраза одночасно читається в двох напрямках без переформулювання:
//   Bingo:        "Знайди того, хто " + text
//   Я ніколи не:  "Хтось із присутніх ніколи не " + text
// Тому при зборі просимо продовження речення "Я ..." (дієслівна форма),
// а не довільний текст — приклад: "їздив зайцем", "цілувався з двома
// людьми за вечір".
//
// Схема факту:
//   { id, text, authorUsername, level (1-5), status: "approved"|"pending",
//     similarTo: factId|null,   // лише для status:"pending" — на що схоже
//     createdAt, sessionId,      // sessionId = room.createdAt цієї вечірки
//     playCount, lastPlayedAt }
//
// Чому playCount/lastPlayedAt/sessionId зберігаються, хоч і не потрібні в
// межах ОДНОГО вечора: щоб за місяць, на наступній тусовці, хост міг
// побачити "це вже грали 23.10 — повторити чи пропустити". Це просто поля,
// нічого автоматично не забороняє — рішення завжди за хостом.
// ==========================================================================
(function () {
  const STOPWORDS = new Set([
    "я", "не", "було", "був", "була", "буду", "мене", "мені", "мою", "моє",
    "з", "у", "в", "на", "до", "від", "за", "та", "і", "й", "але", "що",
    "це", "той", "та", "ці", "цей", "як", "коли", "хто", "щось", "якось",
  ]);

  function normalizeWords(text) {
    return (text || "")
      .toLowerCase()
      .replace(/['".,!?;:()«»\-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w));
  }

  // Жаккар-подібна схожість двох наборів слів: перетин / об'єднання.
  function wordOverlapScore(textA, textB) {
    const a = new Set(normalizeWords(textA));
    const b = new Set(normalizeWords(textB));
    if (!a.size || !b.size) return 0;
    let intersect = 0;
    a.forEach((w) => { if (b.has(w)) intersect++; });
    const union = a.size + b.size - intersect;
    return union ? intersect / union : 0;
  }

  // Найсхожіший факт з approved-пулу під поданий текст.
  function mostSimilar(text, pool) {
    let best = null, bestScore = 0;
    Object.entries(pool || {}).forEach(([id, fact]) => {
      if (fact.status !== "approved") return;
      const score = wordOverlapScore(text, fact.text);
      if (score > bestScore) { bestScore = score; best = id; }
    });
    return { id: best, score: bestScore };
  }

  const DEFAULT_THRESHOLDS = { high: 0.6, medium: 0.3 };

  // Класифікує новий текст відносно пулу: "duplicate" (не турбувати хоста,
  // питати автора), "review" (у чергу хосту з підказкою схожого), "new"
  // (одразу в пул). thresholds — {high, medium}, налаштовується хостом.
  function classifySubmission(text, pool, thresholds) {
    const th = thresholds || DEFAULT_THRESHOLDS;
    const { id, score } = mostSimilar(text, pool);
    if (!id) return { verdict: "new", similarTo: null, score: 0 };
    if (score >= th.high) return { verdict: "duplicate", similarTo: id, score };
    if (score >= th.medium) return { verdict: "review", similarTo: id, score };
    return { verdict: "new", similarTo: null, score };
  }

  // ------------------------- вибір фактів для гри -------------------------
  function approvedAtOrBelow(pool, spiceLevel) {
    return Object.entries(pool || {})
      .filter(([, f]) => f.status === "approved" && (f.level || 1) <= spiceLevel)
      .map(([id, f]) => Object.assign({ id }, f));
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  // N випадкових фактів на карту бінго (без повторів); якщо в пулі менше
  // N — повертає скільки є (виклик сам вирішує, чи цього досить для сітки).
  function sampleFacts(pool, spiceLevel, count) {
    return shuffle(approvedAtOrBelow(pool, spiceLevel)).slice(0, count);
  }
  // Один факт для читання (King's Cup J / "Я ніколи не") — з пріоритетом
  // тим, що ще не читали цієї сесії (playCount==0), інакше будь-який.
  function pickForReading(pool, spiceLevel, sessionId) {
    const options = approvedAtOrBelow(pool, spiceLevel);
    if (!options.length) return null;
    const fresh = options.filter((f) => !(f.lastPlayedSession === sessionId));
    const from = fresh.length ? fresh : options;
    return from[Math.floor(Math.random() * from.length)];
  }
  function bingoGridSize(poolCount) {
    if (poolCount >= 25) return 5;
    if (poolCount >= 16) return 4;
    if (poolCount >= 9) return 3;
    return 0; // замало фактів навіть на 3x3
  }

  // ------------------------- (RTDB-обгортка) -------------------------
  // Приймає готовий firebase-ref на room.factPool (roomRef.child("factPool")),
  // а не сам створює з'єднання — так модуль лишається байдужим до того, яка
  // саме гра (Human Bingo, King's Cup, майбутня) його підключає.
  function attach(poolRef, opts) {
    opts = opts || {};
    function newId() { return poolRef.push().key; }

    // Повертає verdict одразу (щоб UI міг спитати автора при "duplicate"),
    // і сам пише в approved/queue при "new"/"review".
    function submit(text, authorUsername, level, sessionId) {
      return poolRef.once("value").then((snap) => {
        const data = snap.val() || {};
        const pool = Object.assign({}, data.facts, data.queue); // дублі шукаємо і серед уже approved, і серед того, що в черзі
        const verdict = classifySubmission(text, pool, data.thresholds);
        const id = newId();
        const fact = {
          text, authorUsername, level: level || 3,
          createdAt: opts.now ? opts.now() : Date.now(),
          sessionId: sessionId || null,
          playCount: 0, lastPlayedAt: null, lastPlayedSession: null,
        };
        if (verdict.verdict === "duplicate") {
          return Object.assign({ id: null, written: false }, verdict);
        }
        if (verdict.verdict === "review") {
          poolRef.child("queue/" + id).set(Object.assign({ status: "pending", similarTo: verdict.similarTo }, fact));
          return Object.assign({ id, written: true, queued: true }, verdict);
        }
        poolRef.child("facts/" + id).set(Object.assign({ status: "approved", similarTo: null }, fact));
        return Object.assign({ id, written: true, queued: false }, verdict);
      });
    }

    function approve(id) {
      return poolRef.child("queue/" + id).once("value").then((snap) => {
        const fact = snap.val();
        if (!fact) return false;
        fact.status = "approved";
        return poolRef.update({
          ["facts/" + id]: fact,
          ["queue/" + id]: null,
        }).then(() => true);
      });
    }
    function reject(id) { return poolRef.child("queue/" + id).remove(); }
    function removeApproved(id) { return poolRef.child("facts/" + id).remove(); }

    function setSpiceLevel(level) { return poolRef.child("spiceLevel").set(level); }
    function setThresholds(thresholds) { return poolRef.child("thresholds").set(thresholds); }
    function setCoHost(username) { return poolRef.child("coHostUsername").set(username || null); }

    function markPlayed(id, sessionId) {
      return poolRef.child("facts/" + id).once("value").then((snap) => {
        const fact = snap.val();
        if (!fact) return;
        return poolRef.child("facts/" + id).update({
          playCount: (fact.playCount || 0) + 1,
          lastPlayedAt: opts.now ? opts.now() : Date.now(),
          lastPlayedSession: sessionId || null,
        });
      });
    }

    function watch(callback) {
      const onValue = (snap) => callback(snap.val() || {});
      poolRef.on("value", onValue);
      return () => poolRef.off("value", onValue);
    }

    return {
      submit, approve, reject, removeApproved,
      setSpiceLevel, setThresholds, setCoHost, markPlayed, watch,
    };
  }

  window.FactPool = {
    normalizeWords, wordOverlapScore, mostSimilar, classifySubmission, DEFAULT_THRESHOLDS,
    approvedAtOrBelow, sampleFacts, pickForReading, bingoGridSize,
    attach,
  };
})();
