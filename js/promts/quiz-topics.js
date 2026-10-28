// Спільні функції банків Квізу. Самі банки — окремими файлами, кожен додає свій номер у window.QUIZ_SETS:
//   quiz-topics-2.js → «2», quiz-topics-3.js → «3», quiz-topics-4.js → «4».
// Квіз 1 прибрано 28.10.2026 (зіграний). Новий набір — новий файл quiz-topics-N.js
// (scripts/quizN-source.py → scripts/quiz_build.py) і рядок <script> у quiz.html, quiz-tv.html, quiz-bot-test.html.
// Поле гри (6 тем × 5 цін) збирається з банку на старті — див. buildFreshBoard у js/quiz-game.js.
// Статичні файли: у RTDB зберігаються лише індекси й прапорці played, не тексти.

window.QUIZ_SETS = window.QUIZ_SETS || {};

function quizSetIds() { return Object.keys(window.QUIZ_SETS).sort((a, b) => Number(a) - Number(b)); }
// Набір за замовчуванням — найменший номер із наявних (зараз «2»).
function quizDefaultSet() { return quizSetIds()[0] || "2"; }
function quizBank(set) { return window.QUIZ_SETS[set] || window.QUIZ_SETS[quizDefaultSet()] || []; }

// Банк за замовчуванням під старою назвою (для тестів і старого коду).
Object.defineProperty(window, "QUIZ_TOPICS", { configurable: true, get: () => quizBank(quizDefaultSet()) });

// Клітинка поля памʼятає номер набору (row.set), індекс теми (ti) і питання (qi) в банку.
// Кімната з прибраного набору (напр. «1») не падає, а просить почати заново.
function quizQuestionAt(board, ci, qi) {
  const row = board && board[ci];
  const cell = row && row.questions && row.questions[qi];
  const bank = window.QUIZ_SETS[row && row.set];
  const q = bank && row.ti != null && cell && cell.qi != null && bank[row.ti] && bank[row.ti].questions[cell.qi];
  return q || {
    text: "Цей набір питань прибрано — натисни «Заново», щоб зібрати нове поле.",
    options: ["Гаразд"], correctIndices: [0], value: (qi + 1) * 100, timeLimit: 20, answerText: "",
  };
}
