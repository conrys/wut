// ==========================================================================
// Акаунти 41 Games на Firebase Auth.
//
// - Гість: лише ім'я (кирилиця ок), без пароля → signInAnonymously(). Ім'я
//   бронюється в games41_names на GUEST_TTL_MS і продовжується, поки гість
//   заходить. Гостя можна перетворити на акаунт ("Зберегти профіль") —
//   linkWithCredential зберігає той самий uid.
// - Акаунт: ім'я + пароль. Під капотом Email/Password: пошта синтетична
//   (hex імені @ EMAIL_DOMAIN), людина її не бачить і не вводить.
// - Старі акаунти (SHA-256 у games41_users) переносяться при першому вході:
//   хеш звіряється востаннє, створюється Auth-акаунт, старий документ
//   видаляється — після цього хеш більше ніде не лежить.
// - Сесія в localStorage тепер лише кеш { username, uid, guest }: при кожному
//   завантаженні звіряється з firebase.auth().currentUser. Не збіглося —
//   сесію скинуто (підробити username у localStorage більше не вийде).
//
// API для сторінок не змінився: AppAuth.getSession() синхронний і
// повертає { username } як і раніше (+ uid, guest).
// ==========================================================================
(function () {
  const STORAGE_KEY = "games41_session";
  const NAMES_COLLECTION = "games41_names";
  const LEGACY_USERS_COLLECTION = "games41_users";
  const EMAIL_DOMAIN = "u.games41.app";
  const PASSWORD_PREFIX = "41g:"; // старі паролі бувають по 4 символи, Firebase вимагає ≥ 6
  const GUEST_TTL_MS = 24 * 60 * 60 * 1000;
  const GUEST_REFRESH_MS = 60 * 60 * 1000;
  const NAME_MIN = 2, NAME_MAX = 16, NAME_MAX_BYTES = 32, PASSWORD_MIN = 6;

  // Сторінка, відкрита без сесії, показує "🔒 Увійди…". Після входу її
  // простіше й надійніше перезавантажити, ніж вчити кожну гру стартувати
  // посеред життя сторінки.
  const pageStartedWithSession = !!readSession();

  async function sha256Hex(text) {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // ---------------------------- імена ----------------------------
  // Літери будь-якої абетки, цифри, пробіл, _ і -, апостроф. Усі апострофи
  // зводимо до ʼ (U+02BC — це "літера", безпечна в HTML-атрибутах).
  function cleanName(raw) {
    return String(raw || "")
      .normalize("NFC")
      .replace(/['’`´]/g, "ʼ")
      .replace(/\s+/g, " ")
      .trim();
  }
  function normName(raw) { return cleanName(raw).toLowerCase(); }
  function validateName(name) {
    if (name.length < NAME_MIN) return `Ім'я: щонайменше ${NAME_MIN} символи`;
    if (name.length > NAME_MAX) return `Ім'я: не довше ${NAME_MAX} символів`;
    if (!/^[\p{L}\p{N}](?:[\p{L}\p{N}ʼ _-]*[\p{L}\p{N}])?$/u.test(name)) return "Ім'я: лише літери, цифри, пробіл, - і _";
    if (new TextEncoder().encode(name.toLowerCase()).length > NAME_MAX_BYTES) return "Ім'я задовге";
    return null;
  }
  function emailFor(norm) {
    const hex = Array.from(new TextEncoder().encode(norm)).map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex}@${EMAIL_DOMAIN}`;
  }
  function authPassword(pw) { return PASSWORD_PREFIX + pw; }

  // ---------------------------- сесія ----------------------------
  function readSession() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return s && s.username ? s : null;
    } catch {
      return null;
    }
  }
  function getSession() { return readSession(); }
  function setSession(username, uid, guest) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ username, uid, guest: !!guest, loginAt: Date.now() }));
    } catch {}
  }
  function clearSession() {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }

  function fbAuth() {
    if (!window.firebaseReady || !db || typeof firebase === "undefined" || typeof firebase.auth !== "function") {
      throw new Error("Немає з'єднання з сервером. Спробуй пізніше.");
    }
    return firebase.auth();
  }

  const AUTH_ERRORS = {
    "auth/network-request-failed": "Немає інтернету. Спробуй ще раз.",
    "auth/too-many-requests": "Забагато спроб. Зачекай хвилину.",
    "auth/operation-not-allowed": "Цей спосіб входу вимкнений у Firebase (Authentication → Sign-in method).",
    "auth/admin-restricted-operation": "Гостьовий вхід вимкнений у Firebase (Authentication → Sign-in method → Anonymous).",
    "auth/weak-password": `Пароль: щонайменше ${PASSWORD_MIN} символів`,
  };
  function friendly(e) {
    if (e && AUTH_ERRORS[e.code]) return new Error(AUTH_ERRORS[e.code]);
    if (e && e.code === "permission-denied") return new Error("Сервер відхилив запит. Онови сторінку й спробуй ще раз.");
    return e instanceof Error ? e : new Error(String(e));
  }
  const BAD_CREDENTIALS = new Set(["auth/invalid-credential", "auth/invalid-login-credentials", "auth/user-not-found", "auth/wrong-password", "auth/invalid-email"]);

  // Бронювання імені. Вільне, моє, або протерміноване гостьове — беремо.
  async function claimName(name, uid, guest, createdAtHint) {
    const norm = normName(name);
    const ref = db.collection(NAMES_COLLECTION).doc(norm);
    const legacy = await db.collection(LEGACY_USERS_COLLECTION).doc(norm).get().catch(() => null);
    const now = Date.now();
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = snap.exists ? snap.data() : null;
      const expiredGuest = d && d.guest && d.expiresAt && d.expiresAt < now;
      if (d && d.uid !== uid && !expiredGuest) throw new Error("Це ім'я вже зайняте");
      if (!d && legacy && legacy.exists && !createdAtHint) throw new Error("Це ім'я вже зайняте");
      tx.set(ref, {
        uid,
        name,
        guest: !!guest,
        expiresAt: guest ? now + GUEST_TTL_MS : null,
        createdAt: d && d.uid === uid && d.createdAt ? d.createdAt : (createdAtHint || now),
        updatedAt: now,
      });
    });
  }
  async function releaseName(name, uid) {
    const ref = db.collection(NAMES_COLLECTION).doc(normName(name));
    const snap = await ref.get().catch(() => null);
    if (snap && snap.exists && snap.data().uid === uid) await ref.delete().catch(() => {});
  }

  // ---------------------------- входи ----------------------------
  async function guestLogin(rawName) {
    const auth = fbAuth();
    const name = cleanName(rawName);
    const err = validateName(name);
    if (err) throw new Error(err);
    try {
      let user = auth.currentUser;
      if (!user || !user.isAnonymous) user = (await auth.signInAnonymously()).user;
      const prev = readSession();
      await claimName(name, user.uid, true);
      if (prev && prev.guest && prev.uid === user.uid && normName(prev.username) !== normName(name)) await releaseName(prev.username, user.uid);
      setSession(name, user.uid, true);
      return name;
    } catch (e) {
      throw friendly(e);
    }
  }

  async function register(rawName, password) {
    const auth = fbAuth();
    const name = cleanName(rawName);
    const err = validateName(name);
    if (err) throw new Error(err);
    if (!password || password.length < PASSWORD_MIN) throw new Error(`Пароль: щонайменше ${PASSWORD_MIN} символів`);
    const norm = normName(name);
    try {
      const taken = await db.collection(NAMES_COLLECTION).doc(norm).get();
      const prev = readSession();
      const mine = auth.currentUser && taken.exists && taken.data().uid === auth.currentUser.uid;
      if (taken.exists && !mine && !(taken.data().guest && taken.data().expiresAt < Date.now())) throw new Error("Це ім'я вже зайняте");
      const legacy = await db.collection(LEGACY_USERS_COLLECTION).doc(norm).get();
      if (legacy.exists) throw new Error("Це ім'я вже зайняте");
      let user = auth.currentUser;
      const credential = firebase.auth.EmailAuthProvider.credential(emailFor(norm), authPassword(password));
      if (user && user.isAnonymous) {
        // гість зберігає профіль: той самий uid, нічого не губиться
        user = (await user.linkWithCredential(credential)).user;
        await user.getIdToken(true); // свіжий токен: правила мають бачити, що це вже не анонім
      } else {
        user = (await auth.createUserWithEmailAndPassword(emailFor(norm), authPassword(password))).user;
      }
      await claimName(name, user.uid, false);
      if (prev && prev.guest && prev.uid === user.uid && normName(prev.username) !== norm) await releaseName(prev.username, user.uid);
      setSession(name, user.uid, false);
      return name;
    } catch (e) {
      if (e && (e.code === "auth/email-already-in-use" || e.code === "auth/credential-already-in-use")) throw new Error("Це ім'я вже зайняте");
      throw friendly(e);
    }
  }

  async function login(rawName, password) {
    const auth = fbAuth();
    const norm = normName(rawName);
    if (!norm || !password) throw new Error("Введи ім'я і пароль");
    const snap = await db.collection(NAMES_COLLECTION).doc(norm).get().catch(() => null);
    const data = snap && snap.exists ? snap.data() : null;
    // після скидання пароля акаунт перевидано з іншою прихованою поштою (data.email)
    const emails = [data && data.email, emailFor(norm)].filter((x, i, a) => x && a.indexOf(x) === i);
    for (const email of emails) {
      try {
        const cred = await auth.signInWithEmailAndPassword(email, authPassword(password));
        const name = data && data.uid === cred.user.uid ? data.name : norm;
        setSession(name, cred.user.uid, false);
        return name;
      } catch (e) {
        if (!e || !BAD_CREDENTIALS.has(e.code)) throw friendly(e);
      }
    }
    return migrateLegacy(norm, password);
  }

  // Старий акаунт: звіряємо SHA-256 востаннє, створюємо Auth-акаунт,
  // бронюємо ім'я і видаляємо старий документ із хешем.
  async function migrateLegacy(norm, password) {
    const auth = fbAuth();
    const ref = db.collection(LEGACY_USERS_COLLECTION).doc(norm);
    const snap = await ref.get().catch(() => null);
    if (!snap || !snap.exists || !snap.data().passwordHash) throw new Error("Невірне ім'я або пароль");
    const hash = await sha256Hex(norm + ":" + password);
    if (snap.data().passwordHash !== hash) throw new Error("Невірне ім'я або пароль");
    try {
      const user = (await auth.createUserWithEmailAndPassword(emailFor(norm), authPassword(password))).user;
      await claimName(norm, user.uid, false, snap.data().createdAt || Date.now());
      await ref.delete().catch((e) => console.warn("legacy cleanup:", e));
      setSession(norm, user.uid, false);
      return norm;
    } catch (e) {
      if (e && e.code === "auth/email-already-in-use") throw new Error("Невірне ім'я або пароль");
      throw friendly(e);
    }
  }

  // Скидання забутого пароля — ПОКИ НА ДОВІРІ: хто знає ім'я, той і задає новий пароль.
  // Змінити пароль чужого Firebase-акаунта з клієнта не можна, тож ім'я переходить
  // на новий акаунт (нова прихована пошта), а бронь імені вказує на нього. Рекорди
  // й стрік Wordle прив'язані до імені — нікуди не діваються.
  async function resetPassword(rawName, password) {
    const auth = fbAuth();
    const norm = normName(rawName);
    if (!norm) throw new Error("Введи своє ім'я");
    if (!password || password.length < PASSWORD_MIN) throw new Error(`Новий пароль: щонайменше ${PASSWORD_MIN} символів`);
    const ref = db.collection(NAMES_COLLECTION).doc(norm);
    const snap = await ref.get().catch(() => null);
    const legacy = await db.collection(LEGACY_USERS_COLLECTION).doc(norm).get().catch(() => null);
    const d = snap && snap.exists ? snap.data() : null;
    if ((!d || d.guest) && !(legacy && legacy.exists)) throw new Error("Акаунта з таким ім'ям немає");
    try {
      if (auth.currentUser) await auth.signOut();
      const email = emailFor(norm).replace("@", "+r" + Date.now().toString(36) + "@");
      const user = (await auth.createUserWithEmailAndPassword(email, authPassword(password))).user;
      const now = Date.now();
      const name = (d && d.name) || norm;
      await ref.set({ uid: user.uid, name, guest: false, expiresAt: null,
        createdAt: (d && d.createdAt) || (legacy && legacy.exists && legacy.data().createdAt) || now, updatedAt: now, email, resetAt: now });
      if (legacy && legacy.exists) await legacy.ref.delete().catch(() => {});
      setSession(name, user.uid, false);
      return name;
    } catch (e) {
      throw friendly(e);
    }
  }

  async function logout() {
    const s = readSession();
    clearSession();
    try {
      const auth = fbAuth();
      if (s && s.guest && auth.currentUser) await releaseName(s.username, auth.currentUser.uid);
      await auth.signOut();
    } catch {}
    if (pageStartedWithSession) location.reload();
    else updatePill();
  }

  // Звірка кешу з реальним станом Auth при кожному завантаженні сторінки.
  let legacySessionDropped = false;
  function watchAuthState() {
    let auth;
    try { auth = fbAuth(); } catch { return; }
    let first = true;
    auth.onAuthStateChanged((user) => {
      const s = readSession();
      if (s && (!user || user.uid !== s.uid)) {
        legacySessionDropped = !s.uid;
        clearSession();
        if (legacySessionDropped) { try { sessionStorage.setItem("games41_relogin", "1"); } catch {} }
        if (pageStartedWithSession) { location.reload(); return; }
        updatePill();
      } else if (s && s.guest && user && first) {
        refreshGuestClaim(s, user.uid);
      }
      first = false;
    });
  }
  async function refreshGuestClaim(s, uid) {
    try {
      const snap = await db.collection(NAMES_COLLECTION).doc(normName(s.username)).get();
      const d = snap.exists ? snap.data() : null;
      if (d && d.uid === uid && d.expiresAt - Date.now() > GUEST_TTL_MS - GUEST_REFRESH_MS) return;
      await claimName(s.username, uid, true);
    } catch (e) {
      if (/зайняте/.test(e.message)) {
        clearSession();
        if (pageStartedWithSession) location.reload();
      }
    }
  }

  // Українські назви ігор — ЄДИНА копія на весь застосунок (game-notes.js
  // читає її через window.GameLabels, а не тримає свою). Ключ = ім'я файлу
  // без .html, те саме, що передається в sendScore()/getTopScores().
  const GAME_LABELS = {
    "tetris": "Тетріс",
    "2048": "2048",
    "wordle": "Wordle",
    "sudoku": "Судоку",
    "miner": "Сапер",
    "doodle": "Стрибунець",
    "horde": "Орда",
    "blocks": "Блоки",
    "soliter": "Косинка",
    "roulette": "Рулетка",
    "poker": "Покер",
    "snake": "Змійка",
    "spy": "Шпигун",
    "chess": "Шахи",
    "checkers": "Шашки",
    "whoami": "Хто я?",
    "guesschar": "Вгадай персонажа",
    "alias": "Еліас",
    "memology": "Мемологія",
    "crocodile": "Крокодил",
    "quiplash": "Сміхлист",
    "mafia": "Мафія",
    "teli": "Зіпсований телефон",
    "quiz": "Квіз",
    "draw": "Малювалка",
    "durak": "Дурень",
    "humanbingo": "Людське бінго",
    "dilemmas": "Дилеми",
    "whofrom": "Хто з нас?",
    "court": "Суд Лінча",
    "bets": "Ставки",
    "fakenews": "Fake News",
    "remake": "Дубль",
    "naklep": "Наклеп",
    "party": "Вечірка 3-в-1",
    // ігри «Як у рекламі» (ads/<папка>/play.html; 2d/3d-версії — одна гра)
    "natovp": "Натовп ×3",
    "dira": "Діра-ненажера",
    "kolby": "Колби",
    "parkovka": "Парковка",
    "vezha-spiral": "Спіральна вежа",
    "vezha-blokiv": "Вежа з блоків",
    "khovanky": "Хованки",
    "perevtilennia": "Перевтілення",
    "monster": "Монстр",
    "agents": "Агенти",
    "hill": "Цар гори",
    "redlight": "Тихо-голосно",
  };
  // Невеличкі емодзі-іконки для секції "Ще не грав" у профілі — суто
  // декоративні, щоб список не був голим текстом. Гра без запису тут
  // просто отримує 🎮 за замовчуванням (див. gameIcon()).
  const GAME_ICONS = {
    "tetris": "🧱", "2048": "🔢", "wordle": "🔤", "sudoku": "🔢",
    "miner": "💣", "doodle": "🐸", "horde": "⚔️", "soliter": "🃏", "roulette": "🎰", "poker": "🃏",
    "snake": "🐍", "spy": "🕵️", "chess": "♟️", "checkers": "🔴",
    "whoami": "❓", "guesschar": "🎭", "alias": "💬", "memology": "😂", "crocodile": "🐊", "quiplash": "😆",
    "mafia": "🔪", "teli": "📞", "quiz": "🧠", "draw": "🎨", "durak": "🃏",
  };
  const GAME_ORDER = Object.keys(GAME_LABELS);

  // Соло-ігри з РЕАЛЬНИМ індивідуальним рекордом — тільки вони формують
  // "Мій профіль" (рейтинг/медалі/список/"Ще не грав"). Мультиплеєрні ігри
  // (мафія/шпигун/покер/крокодил/мемологія/quiplash/quiz/малювалка/
  // зіпсований телефон/"Хто я?") свідомо виключені — рекорд там теж можна
  // прикрутити, але це окрема "командна" механіка, яку робитимемо окремо
  // й по-іншому, не як соло-топ. Wordle теж свідомо не тут — у нього власна
  // колекція (games41_wordle_*) і своя механіка стріків, не games41_scores.
  // Дурак — накопичувальний лічильник перемог (як шахи/шашки), тому теж тут.
  const SCORABLE_GAMES = [
    "tetris", "2048", "sudoku", "miner", "doodle", "horde", "blocks", "soliter", "roulette", "snake", "chess", "checkers", "whoami", "durak",
  ];

  function gameLabel(gameName) {
    return GAME_LABELS[gameName] || (gameName.charAt(0).toUpperCase() + gameName.slice(1));
  }
  // іконка гри — її обкладинка (img/<гра>_logo.png), а не емодзі
  const COVER_FILE = { blocks: "blocks_logo.png", memology: "meme_logo.png", roulette: "roulette_logo.svg", dilemmas: "dilemmas_logo.svg" };
  function gameIcon(gameName) {
    const file = COVER_FILE[gameName] || (gameName + "_logo.png");
    return `<img src="img/${file}?v=20261017" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;
  }

  function medalFor(rank) {
    if (rank >= 1 && rank <= 3) return `<span class="medal m${rank}">${rank}</span>`;
    return `#${rank}`;
  }

  // Стабільний колір аватара за іменем — той самий прийом, що вже
  // використовується для кольору змійок у snake-multiplayer.js, тепер і
  // для аватара в профілі/шапці меню.
  const AVATAR_COLORS = ["#38cfa0", "#e0b84c", "#ff6b6b", "#8fb8ff", "#c77dff", "#4dd0e1", "#ffb84d", "#a3e635"];
  function colorForName(name) {
    let hash = 0;
    for (let i = 0; i < String(name).length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[hash % AVATAR_COLORS.length];
  }

  // "3 дні тому" / "учора" / "сьогодні" — без зовнішніх бібліотек,
  // українська плюралізація для найпоширеніших випадків (1/2-4/5+).
  function pluralDays(n) {
    const mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return `${n} день тому`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} дні тому`;
    return `${n} днів тому`;
  }
  function relativeTime(ts) {
    if (!ts) return "";
    const days = Math.floor((Date.now() - ts) / 86400000);
    if (days <= 0) return "сьогодні";
    if (days === 1) return "учора";
    if (days < 30) return pluralDays(days);
    const months = Math.floor(days / 30);
    return months === 1 ? "місяць тому" : `${months} міс. тому`;
  }
  function formatJoinDate(ts) {
    if (!ts) return null;
    const d = new Date(ts);
    return d.toLocaleDateString("uk-UA", { year: "numeric", month: "long" });
  }

  // Зведений "рейтинг профілю" — одне вражаюче число замість трьох дрібних
  // лічильників медалей. Ваги довільні (золото важить найбільше), суто щоб
  // дати екрану одну цифру, якою хочеться похвалитись.
  function computeRating(trophies) {
    return trophies.gold * 3 + trophies.silver * 2 + trophies.bronze * 1;
  }

  // ---------------------------- UI ----------------------------
  let pillEl, modalEl, menuEl, profileEl;

  function buildUI() {
    const style = document.createElement("style");
    style.textContent = `
      .auth-pill {
        position: static !important;
        width: 36px;
        height: 36px;
        border-radius: 50% !important;
        background: rgba(255, 255, 255, 0.08);
        color: #f4f5f1;
        border: 1px solid rgba(255, 255, 255, 0.15);
        font-family: 'Space Grotesk', sans-serif;
        font-size: 14px;
        font-weight: 700;
        touch-action: manipulation;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        text-transform: uppercase;
        transition: background 0.2s ease, transform 0.15s ease;
      }
      .auth-pill:active { opacity: 0.7; transform: scale(0.95); }

      #top-bar .auth-pill {
        position: static !important;
        top: auto !important;
        right: auto !important;
      }

      /* ---------- Спільна база для всіх оверлеїв цього модуля ---------- */
      .auth-overlay, .menu-overlay, .profile-overlay {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.82);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        display: none; align-items: center; justify-content: center;
        z-index: 9999; padding: 20px;
      }
      .auth-overlay.open, .menu-overlay.open, .profile-overlay.open { display: flex; }

      .auth-modal, .menu-card, .profile-modal {
        background: #22252b;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 20px;
        padding: 22px;
        width: 100%; max-width: 320px;
        color: #f4f5f1;
        font-family: 'Inter', sans-serif;
      }
      .auth-modal h3, .profile-modal h3 {
        font-family: 'Space Grotesk', sans-serif; margin: 0 0 14px; font-size: 20px;
      }
      .auth-modal input {
        width: 100%; box-sizing: border-box; margin-bottom: 10px;
        padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15);
        background: #12141b; color: #f4f5f1; font-size: 14px;
      }
      .auth-modal .row { display: flex; gap: 8px; margin-top: 6px; }
      .auth-modal button {
        flex: 1; border: none; border-radius: 8px; padding: 10px;
        font-weight: 600; font-size: 13px; cursor: pointer; touch-action: manipulation;
      }
      .auth-primary { background: #ffc93c; color: #0e2318; }
      .auth-tabs { display: flex; gap: 6px; margin-bottom: 14px; }
      .auth-tab {
        flex: 1; text-align: center; padding: 6px; border-radius: 8px;
        font-size: 12px; font-weight: 600; color: #9aa0ad; cursor: pointer;
      }
      .auth-tab.active { background: #12141b; color: #ffc93c; }
      .auth-error { color: #ff6b6b; font-size: 12px; min-height: 16px; margin-bottom: 6px; }
      .auth-close, .menu-close { text-align: center; margin-top: 10px; font-size: 12px; color: #9aa0ad; cursor: pointer; }
      .auth-forgot { text-align: center; margin-top: 10px; font-size: 13px; color: #ffc93c; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
      /* Окрема, добре видима кнопка — попередній варіант (дрібний сірий
         текст) на телефоні легко губився й давав замалий тап-таргет. */
      .profile-close {
        display: block; width: 100%; box-sizing: border-box; text-align: center;
        margin-top: 14px; padding: 12px; border-radius: 8px;
        background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15);
        color: #f4f5f1; font-size: 14px; font-weight: 600;
        cursor: pointer; touch-action: manipulation;
      }
      .profile-close:active { opacity: 0.6; }

      /* ---------- Меню профілю (Мій профіль / Налаштування / Вихід) ---------- */
      .menu-card { max-width: 300px; padding: 16px; }
      .menu-user {
        font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 15px;
        padding: 4px 6px 14px; border-bottom: 1px solid rgba(255,255,255,0.08); margin-bottom: 10px;
        display: flex; align-items: center; gap: 8px;
      }
      .menu-item {
        display: block; width: 100%; box-sizing: border-box; text-align: left;
        background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
        color: #f4f5f1; border-radius: 8px; padding: 12px 14px; margin-bottom: 8px;
        font-size: 14px; font-weight: 600; cursor: pointer; touch-action: manipulation;
      }
      .menu-item:active { opacity: 0.6; }
      .menu-item-danger { color: #ff6b6b; }

      /* ---------- Мій профіль ---------- */
      .profile-modal { max-width: 400px; max-height: 88vh; overflow-y: auto; }

      .profile-head { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
      .profile-avatar {
        width: 52px; height: 52px; border-radius: 50%; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        font-family: 'Space Grotesk', sans-serif;
        font-size: 22px; font-weight: 700; color: #0e1013;
      }
      .profile-head-text h3 { margin: 0; }
      .profile-username { color: #9aa0ad; font-size: 13px; }
      .profile-joined { color: #9aa0ad; font-size: 11px; margin-top: 2px; }

      .rating-card {
        display: flex; align-items: center; justify-content: space-between;
        background: linear-gradient(135deg, rgba(217,180,92,0.16), rgba(217,180,92,0.03));
        border: 1px solid rgba(217,180,92,0.35);
        border-radius: 14px; padding: 12px 16px; margin-bottom: 14px;
      }
      .rating-card .rating-label { font-size: 12px; color: #9aa0ad; text-transform: uppercase; letter-spacing: 0.04em; }
      .rating-card .rating-value {
        font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 26px;
        color: #ffc93c;
      }

      /* Wordle — окремо, це стрік днів, а не рекорд/місце в топі, тому
         показуємо лише коли стрік реально є (>0), інакше рядок прихований. */
      .wordle-streak {
        display: flex; align-items: center; gap: 8px;
        background: rgba(255,107,107,0.1); border: 1px solid rgba(255,107,107,0.3);
        border-radius: 14px; padding: 10px 14px; margin-bottom: 14px;
        font-size: 13px; font-weight: 600;
      }
      .wordle-streak .wordle-streak-fire { font-size: 16px; }
      .wordle-streak .wordle-streak-value {
        font-family: 'Space Grotesk', sans-serif; font-weight: 700; color: #ff8a65;
      }

      .trophy-row { display: flex; gap: 8px; margin-bottom: 18px; }
      .trophy {
        flex: 1; background: #12141b; border-radius: 14px; padding: 12px 6px;
        text-align: center; border: 1px solid rgba(255,255,255,0.08);
      }
      .trophy-icon { display: block; font-size: 22px; margin-bottom: 4px; }
      .trophy-count { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 16px; }

      .profile-section-title {
        font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;
        color: #9aa0ad; margin: 18px 0 8px;
      }
      .profile-section-title:first-of-type { margin-top: 0; }

      .profile-row {
        display: flex; align-items: center; gap: 10px;
        padding: 9px 8px; border-radius: 8px; margin-bottom: 4px;
        font-size: 14px; border: 1px solid transparent;
      }
      .profile-row.rank-1 { background: rgba(217,180,92,0.14); border-color: rgba(217,180,92,0.3); }
      .profile-row.rank-2 { background: rgba(190,197,207,0.12); border-color: rgba(190,197,207,0.28); }
      .profile-row.rank-3 { background: rgba(196,132,74,0.12); border-color: rgba(196,132,74,0.28); }
      .profile-row .rank-badge { width: 28px; text-align: center; font-size: 14px; flex-shrink: 0; }
      .profile-row .game-icon { font-size: 16px; flex-shrink: 0; }
      .profile-row .game-info { flex: 1; min-width: 0; }
      .profile-row .game-name { display: block; }
      .profile-row .game-meta { display: block; font-size: 11px; color: #9aa0ad; }
      .profile-row .game-score { font-family: 'Space Grotesk', sans-serif; font-weight: 700; color: #ffc93c; flex-shrink: 0; }

      .profile-empty { color: #9aa0ad; font-size: 13px; text-align: center; padding: 20px 0; }
      .profile-unplayed { display: flex; flex-wrap: wrap; gap: 8px; }
      .profile-unplayed a {
        display: flex; align-items: center; gap: 6px;
        background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
        border-radius: 999px; padding: 7px 12px; font-size: 12.5px; font-weight: 600;
        color: #f4f5f1; text-decoration: none; touch-action: manipulation;
      }
      .profile-unplayed a:active { opacity: 0.6; }

      .auth-hint { color: #9aa0ad; font-size: 12px; line-height: 1.4; margin: -2px 0 10px; }
      .auth-notice {
        background: rgba(255,184,77,0.12); border: 1px solid rgba(255,184,77,0.35); color: #f4f5f1;
        border-radius: 8px; padding: 8px 10px; font-size: 12px; margin-bottom: 10px; display: none;
      }
      .auth-notice.show { display: block; }
      .auth-modal input { font-size: 16px; } /* ≥16px — iOS не зумить сторінку при фокусі */
      .auth-cta {
        display: block; margin: 14px auto 0; padding: 12px 18px; border: none; border-radius: 8px;
        background: #ffc93c; color: #0e2318; font-weight: 700; font-size: 15px;
        cursor: pointer; touch-action: manipulation;
      }
      .auth-cta:active { opacity: 0.7; }
      .guest-badge {
        display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 999px; font-size: 10px; font-weight: 700;
        text-transform: uppercase; letter-spacing: .04em; background: rgba(255,255,255,0.1); color: #9aa0ad;
        vertical-align: middle;
      }
    
      /* ---------- оновлений вигляд (не залежить від теми сторінки) ---------- */
      .auth-overlay, .menu-overlay, .profile-overlay { background: rgba(6,8,14,0.7); }
      .auth-modal, .menu-card, .profile-modal { background: linear-gradient(180deg, #242836, #171a22); border-color: rgba(255,255,255,0.09);
        box-shadow: 0 24px 60px rgba(0,0,0,.55); animation: lgIn .28s cubic-bezier(.2,1.2,.4,1) both; color: #f4f5f1; }
      @keyframes lgIn { from { opacity: 0; transform: translateY(12px) scale(.97); } }
      .auth-modal input:focus { outline: none; border-color: #ffc93c; }
      .auth-primary { background: linear-gradient(180deg, #ffd96a, #e8ad1f); color: #2a1c00; font-weight: 800 !important; }
      .auth-tabs { background: #12141b; padding: 4px; border-radius: 12px; }
      .auth-tab.active { background: #2b303d; color: #ffc93c; }
      .menu-item { display: flex; align-items: center; gap: 10px; }
      .menu-item svg, .lg-ico { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .menu-item svg { color: #ffc93c; } .menu-item-danger svg { color: #ff6b6b; }
      .profile-avatar { box-shadow: 0 0 0 3px rgba(255,255,255,.12), 0 8px 20px rgba(0,0,0,.4); }
      .rating-card { background: linear-gradient(135deg, rgba(255,201,60,0.18), rgba(255,201,60,0.03)); border-color: rgba(255,201,60,0.4); }
      .trophy { background: #12141b; }
      .trophy-icon { display: grid; place-items: center; margin: 0 auto 4px; }
      .medal { display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; font: 800 11px 'Inter', sans-serif; color: #2a1c00;
        box-shadow: inset 0 -2px 0 rgba(0,0,0,.2); }
      .medal.m1 { background: linear-gradient(135deg, #ffe08a, #e0a91c); } .medal.m2 { background: linear-gradient(135deg, #f1f3f6, #a9b0bb); color: #23262d; }
      .medal.m3 { background: linear-gradient(135deg, #f0b98a, #b0682f); color: #2e1606; }
      .trophy-icon .medal { width: 30px; height: 30px; font-size: 13px; }
      .profile-row .game-icon img, .profile-unplayed a img { width: 26px; height: 26px; border-radius: 7px; object-fit: cover; display: block; background: #2a2e3a; }
      .profile-unplayed a img { width: 20px; height: 20px; border-radius: 5px; }
      .profile-row .game-score { color: #ffc93c; }
      .wordle-streak .lg-ico { color: #ff8a65; }
      .auth-pill svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
`;
    document.head.appendChild(style);

    pillEl = document.createElement("div");
    pillEl.className = "auth-pill";

    const topBar = document.querySelector("#top-bar");
    if (topBar) {
      topBar.appendChild(pillEl);
    } else if (window.GameHeader && GameHeader.slot) {
      GameHeader.slot("right").appendChild(pillEl);
    } else {
      // сторінка без шапки (notes.html): кнопка в правому верхньому куті
      pillEl.style.cssText = "position:fixed !important;top:10px;right:10px;z-index:9000;";
      document.body.appendChild(pillEl);
    }

    pillEl.addEventListener("click", () => {
      if (readSession()) openMenu();
      else openModal();
    });

    modalEl = document.createElement("div");
    modalEl.className = "auth-overlay";
    modalEl.innerHTML = `
      <div class="auth-modal" role="dialog" aria-modal="true">
        <div class="auth-tabs">
          <div class="auth-tab" data-tab="guest">Гість</div>
          <div class="auth-tab" data-tab="login">Вхід</div>
          <div class="auth-tab" data-tab="register">Реєстрація</div>
        </div>
        <h3 id="authTitle">Грати як гість</h3>
        <div class="auth-notice" id="authNotice">Ми оновили вхід: увійди ще раз своїм логіном і паролем — акаунт і рекорди на місці.</div>
        <div class="auth-hint" id="authHint"></div>
        <div class="auth-error" id="authError"></div>
        <input id="authUser" type="text" placeholder="Ім'я" autocomplete="username" maxlength="20" autocapitalize="words" />
        <input id="authPass" type="password" placeholder="Пароль" autocomplete="current-password" />
        <div class="row"><button class="auth-primary" id="authSubmit">Грати</button></div>
        <div class="auth-forgot" id="authForgot">Забув пароль?</div>
        <div class="auth-close" id="authCloseBtn">Закрити</div>
      </div>
    `;
    document.body.appendChild(modalEl);

    const errEl = modalEl.querySelector("#authError");
    const titleEl = modalEl.querySelector("#authTitle");
    const hintEl = modalEl.querySelector("#authHint");
    const submitBtn = modalEl.querySelector("#authSubmit");
    const userInput = modalEl.querySelector("#authUser");
    const passInput = modalEl.querySelector("#authPass");
    const forgotEl = modalEl.querySelector("#authForgot");
    forgotEl.addEventListener("click", () => setAuthMode("reset"));

    const MODES = {
      guest: { title: "Грати як гість", button: "Грати", hint: "Без пароля. Гостьовий профіль живе на цьому телефоні, рекорди не зберігаються. Пізніше його можна зберегти як акаунт.", password: false },
      login: { title: "Вхід", button: "Увійти", hint: "", password: true },
      register: { title: "Реєстрація", button: "Зареєструватись", hint: `Ім'я бачать інші гравці (можна кирилицею). Пароль — від ${PASSWORD_MIN} символів.`, password: true },
      reset: { title: "Новий пароль", button: "Змінити пароль", hint: `Забув пароль? Введи своє ім'я й новий пароль (від ${PASSWORD_MIN} символів). Рекорди лишаться з тобою.`, password: true },
      save: { title: "Зберегти профіль", button: "Зберегти", hint: `Гостьовий профіль стане акаунтом: вигадай пароль від ${PASSWORD_MIN} символів, щоб заходити з будь-якого пристрою.`, password: true },
    };
    setAuthMode = (mode) => {
      authMode = mode;
      const m = MODES[mode];
      const tab = mode === "save" ? "register" : mode === "reset" ? "login" : mode;
      modalEl.querySelectorAll(".auth-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
      modalEl.querySelector(".auth-tabs").style.display = mode === "save" ? "none" : "";
      titleEl.textContent = m.title;
      submitBtn.textContent = m.button;
      hintEl.textContent = m.hint;
      hintEl.style.display = m.hint ? "" : "none";
      passInput.style.display = m.password ? "" : "none";
      passInput.autocomplete = mode === "login" ? "current-password" : "new-password";
      passInput.placeholder = mode === "reset" ? "Новий пароль" : "Пароль";
      forgotEl.style.display = mode === "login" ? "" : "none";
      errEl.textContent = "";
    };
    modalEl.querySelectorAll(".auth-tab").forEach((tab) => tab.addEventListener("click", () => setAuthMode(tab.dataset.tab)));
    setAuthMode("guest");

    modalEl.querySelector("#authCloseBtn").addEventListener("click", closeModal);
    modalEl.addEventListener("click", (e) => { if (e.target === modalEl) closeModal(); });
    [userInput, passInput].forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") submitBtn.click(); }));

    submitBtn.addEventListener("click", async () => {
      errEl.textContent = "";
      submitBtn.disabled = true;
      try {
        if (authMode === "guest") await guestLogin(userInput.value);
        else if (authMode === "login") await login(userInput.value, passInput.value);
        else if (authMode === "reset") await resetPassword(userInput.value, passInput.value);
        else await register(userInput.value, passInput.value);
        userInput.value = "";
        passInput.value = "";
        if (!pageStartedWithSession) { location.reload(); return; }
        closeModal();
        updatePill();
      } catch (e) {
        errEl.textContent = e.message || "Помилка";
      } finally {
        submitBtn.disabled = false;
      }
    });

    // ---------------------- Меню профілю ----------------------
    menuEl = document.createElement("div");
    menuEl.className = "menu-overlay";
    menuEl.innerHTML = `
      <div class="menu-card">
        <div class="menu-user"><span id="menuAvatar"></span> <span id="menuUsername"></span></div>
        <button type="button" class="menu-item" data-action="profile"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v4a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 13v4M8 20h8M9 17h6"/></svg>Мій профіль</button>
        <button type="button" class="menu-item" data-action="save"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/></svg>Зберегти профіль</button>
        <button type="button" class="menu-item" data-action="settings"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>Налаштування</button>
        <button type="button" class="menu-item menu-item-danger" data-action="logout"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/></svg>Вихід</button>
        <div class="menu-close" id="menuCloseBtn">Закрити</div>
      </div>
    `;
    document.body.appendChild(menuEl);
    menuEl.addEventListener("click", (e) => { if (e.target === menuEl) closeMenu(); });
    menuEl.querySelector("#menuCloseBtn").addEventListener("click", closeMenu);
    menuEl.querySelectorAll(".menu-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.action;
        closeMenu();
        if (action === "profile") openProfile();
        else if (action === "save") {
          const s = readSession();
          openModal("save");
          if (s) userInput.value = s.username;
        } else if (action === "settings") {
          if (window.AppSettings && window.AppSettings.openPanel) window.AppSettings.openPanel();
        } else if (action === "logout") {
          const s = readSession();
          const warn = s && s.guest ? `Вийти з гостьового профілю ${s.username}? Ім'я звільниться для інших.` : `Вийти з ${s && s.username}?`;
          if (s && confirm(warn)) logout();
        }
      });
    });

    // ---------------------- Мій профіль ----------------------
    profileEl = document.createElement("div");
    profileEl.className = "profile-overlay";
    profileEl.innerHTML = `
      <div class="profile-modal">
        <div class="profile-head">
          <div class="profile-avatar" id="profileAvatar"></div>
          <div class="profile-head-text">
            <h3 id="profileUsername"></h3>
            <div class="profile-joined" id="profileJoined"></div>
          </div>
        </div>
        <div class="rating-card">
          <span class="rating-label">Рейтинг профілю</span>
          <span class="rating-value" id="profileRating">0</span>
        </div>
        <div class="trophy-row">
          <div class="trophy"><span class="trophy-icon"><span class="medal m1">1</span></span><span class="trophy-count" id="goldCount">0</span></div>
          <div class="trophy"><span class="trophy-icon"><span class="medal m2">2</span></span><span class="trophy-count" id="silverCount">0</span></div>
          <div class="trophy"><span class="trophy-icon"><span class="medal m3">3</span></span><span class="trophy-count" id="bronzeCount">0</span></div>
        </div>
        <div class="wordle-streak" id="wordleStreakRow" style="display:none;">
          <span class="wordle-streak-fire"><svg class="lg-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.4 1.3-3.8 2.5-5 .3 1.6 1 2.6 2 3 0-3-.5-5.5.5-8z"/></svg></span>
          <span>Wordle — стрік <span class="wordle-streak-value" id="wordleStreakValue">0</span> днів поспіль</span>
        </div>
        <div class="profile-section-title">Мої рахунки</div>
        <div id="profileGamesList"><div class="profile-empty">Завантаження…</div></div>
        <div class="profile-section-title" id="profileUnplayedTitle" style="display:none;">Ще не грав</div>
        <div class="profile-unplayed" id="profileUnplayedList"></div>
        <button type="button" class="profile-close" id="profileCloseBtn">Закрити</button>
      </div>
    `;
    document.body.appendChild(profileEl);
    profileEl.addEventListener("click", (e) => { if (e.target === profileEl) closeProfile(); });
    profileEl.querySelector("#profileCloseBtn").addEventListener("click", closeProfile);

    updatePill();
    addLoginButtons();
    if (sessionStorage.getItem("games41_relogin")) {
      try { sessionStorage.removeItem("games41_relogin"); } catch {}
      openModal("login");
      modalEl.querySelector("#authNotice").classList.add("show");
    } else if (!readSession() && new URLSearchParams(location.search).get("room")) {
      // зайшли за посиланням на кімнату — одразу пропонуємо гостьовий вхід
      openModal("guest");
    }
  }

  // На кожному екрані "🔒 Увійди в профіль…" додаємо справжню кнопку.
  function addLoginButtons() {
    if (readSession()) return;
    const re = /Увійди в профіль/;
    const els = Array.from(document.querySelectorAll("body *")).filter((el) =>
      el.children.length === 0 && re.test(el.textContent || "") && !el.closest(".auth-overlay, .menu-overlay, .profile-overlay"));
    els.forEach((el) => {
      if (el.parentElement && el.parentElement.querySelector(".auth-cta")) return;
      el.textContent = el.textContent.replace(/\s*\(кнопка зверху\)/, "");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "auth-cta";
      b.textContent = "Увійти або грати як гість";
      b.addEventListener("click", () => openModal("guest"));
      el.insertAdjacentElement("afterend", b);
    });
  }

  let authMode = "guest";
  let setAuthMode = () => {};
  function openModal(mode) {
    setAuthMode(mode || (authMode === "save" ? "guest" : authMode));
    modalEl.classList.add("open");
    const input = modalEl.querySelector("#authUser");
    setTimeout(() => input && input.focus(), 50);
  }
  function closeModal() { modalEl.classList.remove("open"); }

  function openMenu() {
    const session = readSession();
    if (!session) return;
    menuEl.querySelector("#menuUsername").innerHTML = escapeHtml(session.username) + (session.guest ? '<span class="guest-badge">гість</span>' : "");
    menuEl.querySelector('[data-action="save"]').style.display = session.guest ? "" : "none";
    const av = menuEl.querySelector("#menuAvatar");
    av.textContent = session.username.charAt(0).toUpperCase();
    av.style.background = colorForName(session.username);
    av.style.borderRadius = "50%";
    av.style.display = "inline-flex";
    av.style.alignItems = "center";
    av.style.justifyContent = "center";
    av.style.width = "22px";
    av.style.height = "22px";
    av.style.fontSize = "12px";
    av.style.color = "#0e1013";
    menuEl.classList.add("open");
  }
  function closeMenu() { menuEl.classList.remove("open"); }

  // Профіль однаковий на всіх сторінках: модуль рахунків довантажується сам,
  // навіть якщо гра його не підключала.
  let scoreModulePromise = null;
  function ensureScoreModule() {
    if (window.AppScore && window.AppScore.getUserProfile) return Promise.resolve(true);
    if (!scoreModulePromise) {
      scoreModulePromise = new Promise((resolve) => {
        const s = document.createElement("script");
        s.src = "js/core/score-connect.js";
        s.onload = () => resolve(!!window.AppScore);
        s.onerror = () => resolve(false);
        document.head.appendChild(s);
      });
    }
    return scoreModulePromise;
  }

  async function openProfile() {
    const session = readSession();
    if (!session) return;

    const avatarEl = profileEl.querySelector("#profileAvatar");
    avatarEl.textContent = session.username.charAt(0).toUpperCase();
    avatarEl.style.background = colorForName(session.username);

    profileEl.querySelector("#profileUsername").innerHTML = escapeHtml(session.username) + (session.guest ? '<span class="guest-badge">гість</span>' : "");
    profileEl.querySelector("#profileJoined").textContent = "";
    profileEl.querySelector("#profileRating").textContent = "0";
    profileEl.querySelector("#goldCount").textContent = "0";
    profileEl.querySelector("#silverCount").textContent = "0";
    profileEl.querySelector("#bronzeCount").textContent = "0";
    const listEl = profileEl.querySelector("#profileGamesList");
    const unplayedTitleEl = profileEl.querySelector("#profileUnplayedTitle");
    const unplayedListEl = profileEl.querySelector("#profileUnplayedList");
    const wordleRowEl = profileEl.querySelector("#wordleStreakRow");
    listEl.innerHTML = '<div class="profile-empty">Завантаження…</div>';
    unplayedTitleEl.style.display = "none";
    unplayedListEl.innerHTML = "";
    wordleRowEl.style.display = "none";
    profileEl.classList.add("open");

    if (session.guest) {
      listEl.innerHTML = '<div class="profile-empty">Гостьовий профіль не зберігає рекорди.<br>Збережи його як акаунт — і рахунки почнуть записуватись.</div>' +
        '<button type="button" class="auth-cta" id="profileSaveBtn">Зберегти профіль</button>';
      listEl.querySelector("#profileSaveBtn").addEventListener("click", () => {
        closeProfile();
        openModal("save");
        modalEl.querySelector("#authUser").value = session.username;
      });
      return;
    }

    const ok = await ensureScoreModule();
    if (!ok || !window.firebaseReady || !db) {
      listEl.innerHTML = '<div class="profile-empty">Немає з\'єднання з сервером — профіль недоступний.</div>';
      return;
    }
    const { trophies, games, joinedAt, wordleStreak } = await window.AppScore.getUserProfile(session.username, SCORABLE_GAMES);

    profileEl.querySelector("#goldCount").textContent = trophies.gold;
    profileEl.querySelector("#silverCount").textContent = trophies.silver;
    profileEl.querySelector("#bronzeCount").textContent = trophies.bronze;
    profileEl.querySelector("#profileRating").textContent = computeRating(trophies);

    if (wordleStreak > 0) {
      wordleRowEl.style.display = "";
      profileEl.querySelector("#wordleStreakValue").textContent = wordleStreak;
    }

    const joinedLabel = formatJoinDate(joinedAt);
    profileEl.querySelector("#profileJoined").textContent = joinedLabel ? `У грі з ${joinedLabel}` : "";

    if (!games.length) {
      listEl.innerHTML = '<div class="profile-empty">Поки немає жодного рахунку. Зіграй у будь-яку гру!</div>';
    } else {
      listEl.innerHTML = games
        .map((g) => {
          const rankClass = g.rank <= 3 ? ` rank-${g.rank}` : "";
          const meta = g.total > 1 ? `з ${g.total} гравців` : "поки єдиний результат";
          const when = relativeTime(g.ts);
          return `
        <div class="profile-row${rankClass}">
          <span class="rank-badge">${medalFor(g.rank)}</span>
          <span class="game-icon">${gameIcon(g.gameName)}</span>
          <span class="game-info">
            <span class="game-name">${escapeHtml(gameLabel(g.gameName))}</span>
            <span class="game-meta">${escapeHtml(meta)}${when ? " · " + escapeHtml(when) : ""}</span>
          </span>
          <span class="game-score">${g.score}</span>
        </div>`;
        })
        .join("");
    }

    const playedKeys = new Set(games.map((g) => g.gameName));
    const unplayed = SCORABLE_GAMES.filter((key) => !playedKeys.has(key));
    if (unplayed.length) {
      unplayedTitleEl.style.display = "";
      unplayedListEl.innerHTML = unplayed
        .map((key) => `<a href="${key}.html">${gameIcon(key)} ${escapeHtml(gameLabel(key))}</a>`)
        .join("");
    }
  }
  function closeProfile() { profileEl.classList.remove("open"); }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function updatePill() {
    if (!pillEl) return;
    const session = readSession();
    if (session) {
      pillEl.textContent = session.username.charAt(0).toUpperCase();
      pillEl.title = session.guest ? `${session.username} (гість)` : session.username;
      pillEl.style.background = colorForName(session.username);
      pillEl.style.color = "#0e1013";
    } else {
      pillEl.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4.2 4-6.5 8-6.5s7.2 2.3 8 6.5"/></svg>';
      pillEl.title = "Увійти";
      pillEl.style.background = "rgba(255, 255, 255, 0.08)";
      pillEl.style.color = "#f4f5f1";
    }
  }

  document.addEventListener("DOMContentLoaded", buildUI);
  watchAuthState();

  window.AppAuth = { getSession, login, register, guestLogin, logout, normName, cleanName, validateName, openLogin: (mode) => openModal(mode || "guest") };
  // Спільний словник назв/іконок ігор — game-notes.js (і будь-що інше)
  // читає звідси, замість тримати власну копію GAME_LABELS.
  window.GameLabels = { GAME_LABELS, GAME_ORDER, gameLabel, gameIcon };

  // Автопідключення нотаток (game-notes.js), щоб не додавати
  // окремий <script> тег у кожну гру вручну. Підвантажується ПІСЛЯ того,
  // як window.GameLabels уже визначений вище.
  (function loadGameNotes() {
    if (document.querySelector('script[src$="js/game-notes.js"]')) return;
    var s = document.createElement('script');
    s.src = 'js/game-notes.js';
    document.head.appendChild(s);
  })();
})();
