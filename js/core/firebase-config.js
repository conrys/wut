// ==========================================================================
// КОНФІГ FIREBASE — встав сюди свій об'єкт з Firebase Console:
// Project settings → General → Your apps → (додай Web app, якщо нема) → SDK config
//
// Це ПУБЛІЧНИЙ клієнтський конфіг — apiKey тут НЕ секрет (так і задумано
// Google: https://firebase.google.com/docs/projects/api-keys). Захист даних
// робиться через Firestore Security Rules, а не приховуванням цих значень.
//
// НЕ ПЛУТАТИ з service-account.json / Admin SDK ключем з твого Node.js-
// додатку — той дійсно секретний і сюди НІКОЛИ не вставляється.
// ==========================================================================
const firebaseConfig = {
  apiKey: "AIzaSyCkvOZW77P5f70NeC5VU8AQ5q4jKFBnUwk",
  authDomain: "kzl-crm.firebaseapp.com",
  projectId: "kzl-crm",
  storageBucket: "kzl-crm.firebasestorage.app",
  messagingSenderId: "1092229511761",
  appId: "1:1092229511761:web:248c6e87c89e3f3a7ed670",
  databaseURL: "https://kzl-crm-default-rtdb.europe-west1.firebasedatabase.app",
};
// measurementId/Analytics свідомо не підключаємо — для логіну й рекордів
// не потрібен, а це ще один зовнішній скрипт і мережевий виклик щоразу.

// Окремі колекції, щоб не перетнутись з даними іншого проєкту в тій самій базі
const USERS_COLLECTION = "games41_users";
const SCORES_COLLECTION = "games41_scores";

// window.firebaseReady — прапорець, щоб інші скрипти могли коректно
// відключити мережеві фічі, якщо SDK не завантажився (немає інтернету
// при першому запуску, заблокований CDN тощо) — гра при цьому все одно
// має працювати офлайн.
window.firebaseReady = false;
let db = null;

try {
  if (typeof firebase !== "undefined") {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();

    // Сучасне офлайн-кешування замість застарілого enablePersistence / enableIndexedDbPersistence
    try {
      if (typeof firebase.firestore.persistentLocalCache === "function") {
        db.settings({
          cache: firebase.firestore.persistentLocalCache()
        });
      }
    } catch (cacheErr) {
      console.warn("Firestore cache init warning:", cacheErr);
    }

    window.firebaseReady = true;

    // Після тривалого перебування у фоні (Android присипляє мережеві
    // з'єднання WebView) Firestore SDK інколи не саме не "прокидається".
    // Форсуємо перепідключення щоразу, коли застосунок повертається
    // на передній план.
    const CapApp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (CapApp) {
      CapApp.addListener("appStateChange", (state) => {
        if (state.isActive) {
          db.disableNetwork().then(() => db.enableNetwork()).catch(() => {});
        }
      });
    } else {
      // запасний варіант для звичайного браузера/прев'ю
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          db.disableNetwork().then(() => db.enableNetwork()).catch(() => {});
        }
      });
    }
  } else {
    console.warn("Firebase SDK не завантажився — фічі логіну/рекордів вимкнено на цій сесії.");
  }

  // Realtime Database — тільки для мультиплеєр-змійки. Компакт-скрипт
  // firebase-database-compat.js підключається ЛИШЕ на snake.html, тому
  // тут перевіряємо доступність окремо — на інших сторінках rtdb лишається null.
  window.rtdbReady = false;
  window.rtdb = null;
  try {
    if (typeof firebase !== "undefined" && typeof firebase.database === "function") {
      window.rtdb = firebase.database();
      window.rtdbReady = true;
    }
  } catch (e) {
    console.warn("Realtime Database init error:", e);
  }
} catch (e) {
  console.warn("Firebase init error:", e);
}