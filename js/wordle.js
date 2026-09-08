// ==========================================================================
// Wordle-рушій. Слово дня рахується детерміновано з дати (за Києвом) —
// без запису "сьогоднішнього слова" у Firestore, тому нема гонки між
// гравцями і гра працює навіть без інтернету (крім фіду/стріку).
//
// Слово дня і перевірка "чи існує таке слово" тепер беруться з РІЗНИХ
// списків: WORDS_UK/WORDS_EN (words-uk.js/words-en.js) — вузькі, свідомо
// відібрані під слово дня; WORDS_UK_GUESSES/WORDS_EN_GUESSES
// (words-uk-guesses.js/words-en-guesses.js) — набагато ширші, лише для
// валідації здогадок гравця, щоб реальні слова не відхилялись через те,
// що їх просто нема у вузькому списку слів дня.
//
// Firestore-чистка: зберігаємо тільки результати за "сьогодні" й "вчора"
// (за Києвом) — усе старіше видаляється опортуністично, коли будь-хто
// відкриває гру (без Cloud Functions/cron — лишається на безкоштовному плані).
//
// Підключати ПІСЛЯ firebase-config.js, login.js, words-en.js, words-uk.js,
// words-en-guesses.js, words-uk-guesses.js.
// ==========================================================================
const WORDLE_USERS_COLLECTION = "games41_wordle_users";
const WORDLE_RESULTS_COLLECTION = "games41_wordle_results";
const WORDLE_EPOCH = "2026-09-03"; // день №1

function kyivDateStr(d) {
  d = d || new Date();
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(d); // YYYY-MM-DD
}

function addDaysStr(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function wordleDayNumber(dateStr) {
  const epoch = new Date(WORDLE_EPOCH + "T00:00:00Z");
  const d = new Date(dateStr + "T00:00:00Z");
  return Math.round((d - epoch) / 86400000) + 1;
}

function seededIndex(seed, len) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (Math.imul(hash, 31) + seed.charCodeAt(i)) >>> 0;
  return hash % len;
}

function answerListFor(lang) {
  return lang === "uk" ? WORDS_UK : WORDS_EN;
}

// Falls back to the answer list itself if a guess list script didn't load
// for some reason, so the game still works — just with a narrower
// vocabulary — instead of rejecting every single guess outright.
function guessListFor(lang) {
  if (lang === "uk") return typeof WORDS_UK_GUESSES !== "undefined" ? WORDS_UK_GUESSES : WORDS_UK;
  return typeof WORDS_EN_GUESSES !== "undefined" ? WORDS_EN_GUESSES : WORDS_EN;
}

function dailyWord(lang, dateStr) {
  dateStr = dateStr || kyivDateStr();
  const list = answerListFor(lang);
  const idx = seededIndex(dateStr + ":" + lang, list.length);
  return list[idx].toLowerCase();
}

// Класичний двопрохідний алгоритм — коректно рахує повторювані літери.
function evaluateGuess(guess, answer) {
  const n = guess.length;
  const result = new Array(n).fill("absent");
  const ansArr = answer.split("");
  const guessArr = guess.split("");
  for (let i = 0; i < n; i++) {
    if (guessArr[i] === ansArr[i]) {
      result[i] = "correct";
      ansArr[i] = null;
      guessArr[i] = null;
    }
  }
  for (let i = 0; i < n; i++) {
    if (guessArr[i] === null) continue;
    const idx = ansArr.indexOf(guessArr[i]);
    if (idx !== -1) {
      result[i] = "present";
      ansArr[idx] = null;
    }
  }
  return result;
}

const STATUS_EMOJI = { correct: "🟩", present: "🟨", absent: "⬛" };

function buildShareText(lang, dateStr, rows, won, maxAttempts) {
  const dayNum = wordleDayNumber(dateStr);
  const grid = rows.map((r) => r.map((s) => STATUS_EMOJI[s]).join("")).join("\n");
  const header = `Wordle ${dayNum} ${won ? rows.length : "X"}/${maxAttempts}`;
  return `${header}\n\n${grid}`;
}

// ------------------------- локальний стан гри -------------------------
function stateKey(lang, dateStr) {
  return `wordle_state_${lang}_${dateStr}`;
}

function loadState(lang, dateStr) {
  try {
    return JSON.parse(localStorage.getItem(stateKey(lang, dateStr)) || "null");
  } catch {
    return null;
  }
}

function saveState(lang, dateStr, state) {
  localStorage.setItem(stateKey(lang, dateStr), JSON.stringify(state));
}

// ------------------------- Firestore: чистка старих результатів -------------------------
// Тримаємо тільки "сьогодні" й "вчора" (за Києвом) — усе старіше видаляється.
// Викликається один раз при завантаженні скрипта (опортуністично, ким завгодно).
let _cleanupDone = false;
async function cleanupOldResults() {
  if (_cleanupDone || !window.firebaseReady || !db) return;
  _cleanupDone = true;
  try {
    const cutoff = addDaysStr(kyivDateStr(), -1); // все з датою < вчора видаляємо
    const snap = await db.collection(WORDLE_RESULTS_COLLECTION).where("date", "<", cutoff).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  } catch (e) {
    console.warn("cleanupOldResults error:", e);
  }
}

// ------------------------- Firestore: стрік і фід -------------------------
async function submitWordleResult({ lang, dateStr, won, rows, maxAttempts }) {
  const session = window.AppAuth && window.AppAuth.getSession();
  if (!session || !window.firebaseReady || !db) return { saved: false };

  const shareText = buildShareText(lang, dateStr, rows, won, maxAttempts);
  const docId = `${dateStr}_${lang}_${session.username}`;

  try {
    await db.collection(WORDLE_RESULTS_COLLECTION).doc(docId).set({
      username: session.username,
      date: dateStr,
      lang,
      attempts: rows.length,
      won,
      shareText,
      ts: Date.now(),
    });

    // стрік — єдиний, незалежний від того, яку мову грали цього дня
    const userRef = db.collection(WORDLE_USERS_COLLECTION).doc(session.username);
    const snap = await userRef.get();
    const data = snap.exists ? snap.data() : { streak: 0, lastWinDate: null };

    if (won) {
      let streak;
      if (data.lastWinDate === addDaysStr(dateStr, -1)) streak = (data.streak || 0) + 1;
      else if (data.lastWinDate === dateStr) streak = data.streak || 1; // вже рахували сьогодні
      else streak = 1;
      await userRef.set({ streak, lastWinDate: dateStr, updatedAt: Date.now() });
    } else if (data.lastWinDate !== dateStr) {
      await userRef.set({ streak: 0, lastWinDate: data.lastWinDate || null, updatedAt: Date.now() }, { merge: true });
    }

    return { saved: true, shareText };
  } catch (e) {
    console.warn("submitWordleResult error:", e);
    return { saved: false, error: e.message };
  }
}

function isValidWord(lang, word) {
  const list = guessListFor(lang);
  const normalizedWord = word.toLowerCase();
  return list.includes(normalizedWord);
}

async function getStreak() {
  const session = window.AppAuth && window.AppAuth.getSession();
  if (!session || !window.firebaseReady || !db) return 0;
  try {
    const snap = await db.collection(WORDLE_USERS_COLLECTION).doc(session.username).get();
    return snap.exists ? snap.data().streak || 0 : 0;
  } catch {
    return 0;
  }
}

async function getTodayFeed(lang, dateStr) {
  if (!window.firebaseReady || !db) return [];
  try {
    const snap = await db
      .collection(WORDLE_RESULTS_COLLECTION)
      .where("date", "==", dateStr)
      .where("lang", "==", lang)
      .get();
    const rows = [];
    snap.forEach((d) => rows.push(d.data()));
    rows.sort((a, b) => a.ts - b.ts);
    return rows;
  } catch (e) {
    console.warn("getTodayFeed error:", e);
    return [];
  }
}

// опортуністичний виклик — не блокує нічого, просто "по дорозі" прибирає
if (window.firebaseReady) cleanupOldResults();
else document.addEventListener("DOMContentLoaded", () => setTimeout(cleanupOldResults, 500));

window.Wordle = {
  kyivDateStr,
  wordleDayNumber,
  dailyWord,
  evaluateGuess,
  isValidWord,
  buildShareText,
  loadState,
  saveState,
  submitWordleResult,
  getStreak,
  getTodayFeed,
};
