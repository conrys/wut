# Правила розробки 41 Games

Цей документ є робочим guide для людей і AI-моделей, які змінюють ігри в цьому workspace.

## 1. Головний принцип

- Спочатку знайди власника поведінки: state machine, game engine або конкретний renderer.
- Не виправляй UI там, де помилка насправді в state або presence.
- Не роби broad refactor під час вузького bugfix.
- Перед зміною сформулюй локальну гіпотезу і найдешевшу перевірку, яка може її спростувати.
- Після першої зміни одразу запускай вузьку перевірку.
- Не переписуй користувацькі зміни і не роби destructive git-операцій.
- Не створюй commit або branch без прямого прохання.

## 2. Типи ігор

### 2.1 Солоігри

Солоігри мають залишатися playable без Firebase:

- локальний gameplay state живе в JavaScript/DOM;
- локальний best score можна зберігати в `localStorage`;
- Firestore-рекорди є optional feature, а не залежність gameplay;
- відсутність мережі не повинна ламати старт, reset або game over;
- score відправляється лише після фактичного завершення гри;
- score upload має бути fire-and-forget і не блокувати UI.

Перед змінами перевіряй:

- reset повністю очищує старий state;
- win/lose/game over не викликає score upload багато разів;
- keyboard, touch і mobile viewport не залежать від Firebase;
- старий localStorage формат не спричиняє exception.

### 2.2 Мультиплеєрні ігри

Мультиплеєр має мати чітко розділені шари:

1. transport/presence: Firebase RTDB, heartbeat, reconnect;
2. canonical game state: одна authoritative state machine;
3. player actions: answer, vote, pause, reset;
4. renderers: mobile client і TV/display client.

Не дозволяй UI самостійно вирішувати фазу гри. UI лише показує state і надсилає action.

## 3. Firebase і конфігурація

### 3.1 Script order

Для сторінок із Firebase порядок має бути таким:

```html
firebase-app-compat.js
firebase-firestore-compat.js       <!-- якщо використовується Firestore -->
firebase-database-compat.js        <!-- якщо використовується RTDB -->
js/firebase-config.js
js/login.js                         <!-- якщо потрібен login -->
js/words-or-prompts.js
js/online-engine.js                 <!-- перед game wrapper -->
js/game.js
js/score-connect.js
js/records.js
js/help.js
js/back-button.js
```

Особливо важливо:

- `online-engine.js` має бути завантажений до `spy-game.js` і `quiplash-game.js`;
- `firebase-config.js` викликає `firebase.firestore()`, тому Firestore SDK має бути підключений навіть на display-сторінці, якщо config його ініціалізує;
- TV сторінка повинна мати всі SDK, які очікує `firebase-config.js`;
- не покладайся на порядок async network loading: script tags мають бути синхронно правильні.

### 3.2 RTDB paths

- Кожна гра має власний root, наприклад `spy_rooms`, `quiplash_rooms`, `snake_rooms`.
- Shared room для Quiplash: `quiplash_rooms/shared`.
- Якщо код пише в новий root, rules мають містити відповідний блок.
- Після додавання root оновлюй `database.rules.json` і `firebase.json`.
- Локальна наявність rules-файлу не змінює вже задеплоєні Firebase Rules: після змін потрібен `firebase deploy --only database`.

Поточні правила відкриті для тестування. Для production потрібні authenticated/validated rules.

### 3.3 RTDB data shape

Схема room має бути стабільною і документованою. Для Quiplash приблизна форма:

```js
{
  phase: "lobby",
  round: 0,
  players: {},
  settings: { voteSeconds: 25 },
  matchups: null,
  currentMatchupIndex: 0,
  gallery: null,
  tvFact: null,
  phaseDeadline: null,
  paused: false,
  awaitingContinuation: false
}
```

Не покладайся на те, що Firebase збереже `null` поля. RTDB може не повертати null-valued children. Перевіряй optional values як:

```js
value == null
```

або helper:

```js
function unanswered(value) {
  return value === null || value === undefined;
}
```

## 4. OnlineEngine і presence

### 4.1 Host

- Host не є окремим privileged account.
- Host визначається серед connected players за найменшим `joinedAt`.
- Лише host запускає game tick.
- Будь-яка host-sensitive action має перевіряти canonical state, а не лише кнопку на UI.
- Не запускай другий tick timer при кожному RTDB event.
- При втраті host наступний connected player має мати змогу продовжити state machine.

### 4.2 Heartbeat

- Heartbeat оновлює `lastSeen` через стабільний інтервал.
- `PRESENCE_TIMEOUT_MS` має бути більшим за нормальну затримку WebView/background wake-up.
- Не перебудовуй DOM і не запускай важкі операції через heartbeat.
- Не викликай `becomePlayer()` з повним update на кожну state notification, якщо це не потрібно.
- `onDisconnect()` є страховкою, але reconnect logic також має працювати явно.

### 4.3 Disconnect/reconnect

Відключений гравець не повинен одразу зникати з canonical scoreboard:

- зберігай player record, score, avatar, answers і joinedAt;
- став `status: "inactive"` через onDisconnect patch;
- при heartbeat поверни `status: "active"`;
- якщо гравець reload-нув сторінку, не видаляй його room record;
- збережений avatar має відновлюватися при reconnect;
- новий гравець не повинен автоматично входити в активний раунд;
- знайомий гравець може повернутися у свій активний раунд.

Перед зміною leave lifecycle перевіряй різницю між:

- browser reload;
- навмисним виходом із room;
- закриттям вкладки;
- втратами мережі;
- повним reset гри.

### 4.4 Avatar reservation

- Avatar selection має бути server/canonical state, не лише localStorage.
- У lobby avatar повинен змінюватися на всіх клієнтах.
- Для reservation використовуй RTDB transaction, інакше два клієнти можуть одночасно вибрати один avatar.
- Inactive player продовжує резервувати свій avatar до reconnect або reset.
- LocalStorage використовується для persistence, але не є джерелом істини.

## 5. State machine

Кожна фаза має бути явно описана і мати один owner переходу.

Для поточного Quiplash:

```text
lobby
  -> answering
  -> answer_countdown
  -> voting
  -> reveal
  -> voting (наступний matchup)
  -> round_end
  -> answering (наступний round)
  -> round_end + awaitingContinuation
  -> game_over
```

Правила:

- відповіді не мають таймера, якщо дизайн прямо не каже інше;
- таймер є тільки для голосування та коротких scripted transitions;
- `phaseDeadline` має зберігатися в canonical state;
- pause повинен компенсувати час паузи, а не дозволяти deadline спливти у фоні;
- `round_end` не повинен автоматично обходити host decision після фінального раунду;
- phase transitions мають бути idempotent: повторний tick не повинен дублювати score або reset.

### 5.1 Відповіді

- Не вважай `undefined` зданою відповіддю.
- Після Firebase read перевіряй і `null`, і `undefined`.
- Клієнт не повинен перемальовувати textarea на кожен RTDB update.
- Використовуй render key для питання, щоб не втрачати focus і введений текст.
- Після submit блокуй повторну відправку на цьому matchup.

### 5.2 Голосування

- Учасники matchup не голосують за власну пару, окрім спеціального test mode для 2 players.
- Для 2 гравців правила голосування мають бути визначені явно: кожен голосує за відповідь суперника.
- `eligibleVoterCount` має відповідати UI counter.
- Gallery voters рахуються лише серед тих, хто реально дав відповідь.
- Timer expiry має завершувати voting, навіть якщо хтось відключився.
- Голос не можна прийняти двічі.

### 5.3 Disconnect під час раунду

- Якщо inactive player уже дав відповідь, його відповідь і matchup не видаляються.
- Якщо він не дав відповідь і не повернувся, після відповідей active players можна compact/rebuild майбутні matchup-и.
- Не видаляй inactive player зі scoreboard.
- Якщо для нового раунду менше двох active players, не стартуй раунд: мовчки чекай reconnect.
- При непарній кількості active players формуй замкнені пари, щоб ніхто не залишився без matchup.
- Не нараховуй score двічі після compact або reconnect.

## 6. TV/display client

TV — display-only клієнт у стилі Jackbox. Він не повинен вимагати login чи player action.

TV має відображати кожен canonical state:

- lobby: players, avatars, count, settings;
- answering: round, prompt/image, facts, readiness;
- answer_countdown: countdown до voting;
- voting classic: prompt, дві відповіді, intro, timer, vote count;
- voting gallery: image, всі captions, timer, vote count;
- reveal classic: winner, answers, points, bonuses;
- reveal gallery: captions, winner, Сміхлист reaction;
- round_end: scoreboard, recap, inactive status;
- game_over: final scoreboard;
- paused: overlay і frozen timer.

TV rules:

- Не використовуй auth session як умову для рендера TV.
- TV читає той самий room path, що і mobile game.
- Не кешуй render лише за player IDs: avatar changes мають включати `character` і `color` у render key.
- Не перебудовуй scoreboard на кожен heartbeat.
- Timer повинен оновлюватися локальним display loop, а state deadline залишатися canonical.
- Не вставляй status message як flex child у `body`, якщо body є flex layout: використовуй absolute/fixed overlay або контейнер усередині screen.
- Візуальні effects не повинні змінювати game state.
- TV не має права голосувати, стартувати, reset-ити або змінювати player data.

## 7. SVG і avatar animation

Зовнішній `<img src="img/charX.svg">` дозволяє анімувати весь character wrapper, але не окремі очі/рот усередині SVG.

Тому:

- для scale/rotate/filter animation достатньо CSS wrapper;
- для справжньої зміни міміки треба редагувати кожен SVG або вбудовувати SVG inline;
- не ламай оригінальні avatar assets заради однієї animation;
- якщо додаєш SVG animation, збережи однаковий viewBox і fallback без animation;
- animation має мати точний timeline, наприклад `0.3s in + 0.7s hold + 0.3s out`;
- перевіряй, що animation не змінює layout сусідніх елементів.

## 8. Rendering і performance

- Firebase event може приходити кожні 2 секунди або частіше.
- Render має бути idempotent і differential там, де є input, scoreboard або animation.
- Не викликай `innerHTML = ...` для активної textarea на кожен state event.
- Для scoreboard використовуй stable render key: players + score + avatar + relevant round.
- Для intro/reveal animation використовуй state key, щоб animation не перезапускалась від heartbeat.
- Для timers використовуй `requestAnimationFrame` або короткий local interval лише на display; не пиши timer у Firebase кожну frame.
- DOM transitions не повинні створювати layout shift або scrollbar без потреби.

## 9. Security і Firebase Rules

Поточна клієнтська архітектура довіряє Firebase Rules і частково клієнтам. Для production:

- не залишай `.read: true, .write: true` без validation;
- валідуй допустимі phase transitions;
- обмежуй score updates серверними правилами або trusted backend;
- не дозволяй гравцю змінювати чужий player record;
- не дозволяй голосувати за себе або поза current matchup;
- не дозволяй змінювати score через довільний client write;
- перевіряй типи, довжини answer, допустимі avatar IDs;
- Firebase API key у frontend не є password, але database rules є критично важливими.

## 10. Auth і localStorage

Поточний login — lightweight private-app login, не повноцінний Firebase Auth.

- Не називай localStorage session security boundary.
- Не використовуй username із localStorage як доказ identity для public production app.
- Не зберігай plaintext passwords.
- Усі Firestore operations мають мати graceful fallback.
- Рекорди не повинні ламати gameplay при offline/error.
- При зміні storage schema підтримуй старий формат або роби safe migration.

## 11. File/path conventions

- Web paths використовують `/`, наприклад `img/char1.svg`.
- Не вигадуй `img/quiplash/chars/...`, якщо файли реально лежать у `img/`.
- JSON, який завантажується через `fetch`, не тестуй через `file://`; використовуй HTTP/Firebase Hosting.
- Для image assets перевіряй, що кожен файл із `image-prompts.json` реально існує.
- Якщо додаєш нову Firebase room path, додай rules і перевір deploy.

## 12. Testing checklist

### Перед завершенням будь-якої зміни

- `get_errors` для змінених файлів;
- `node --check` для змінених JS;
- `git diff --check`;
- перевірка script order;
- перевірка relative asset paths.

### Соло

- fresh start;
- reset;
- win/lose/game over;
- offline/no Firestore;
- mobile touch і keyboard;
- score upload не повторюється.

### Multiplayer

- 2 players;
- 3+ players;
- join/leave/reload;
- inactive/reconnect;
- host disconnect/election;
- duplicate avatar selection race;
- pause/resume;
- vote timeout;
- all votes early;
- final scoreboard;
- reset room.

### Quiplash TV

Перевір кожну фазу вручну:

```text
lobby
answering
answer_countdown
voting classic
reveal classic
round_end classic
answering image
voting gallery
reveal gallery + Сміхлист
round_end gallery
final round_end + host decision
 game_over
paused
inactive player
avatar change
reload/reconnect
```

## 13. Lessons already learned

- RTDB не гарантує повернення `null` children: `undefined` треба трактувати як незаповнене поле.
- Firebase heartbeat не повинен перебудовувати input DOM.
- TV повинен мати Firestore SDK, якщо `firebase-config.js` безумовно викликає `firebase.firestore()`.
- `index.html` має завантажувати `online-engine.js` до `spy-game.js`.
- Reset і browser reload — різні події; reload не повинен видаляти player presence так, як навмисний leave.
- Scoreboard і lobby avatar cache мають включати не лише список гравців, а й score/character/color.
- Display-only TV не має бути flex sibling-ом для status message: так можна випадково змістити весь екран убік.
- Не вважай “немає diagnostics” доказом коректного runtime: перевіряй гілки state вручну або через browser test.

## 14. Definition of done

Зміна готова, коли:

- поведінка контролюється правильним abstraction owner;
- state shape і phase transitions не суперечать mobile/TV клієнтам;
- disconnect/reconnect semantics явно збережені;
- UI не втрачає input focus і не створює зайві rerenders;
- assets і script dependencies перевірені;
- rules/config оновлені, якщо додано Firebase path;
- є щонайменше одна executable validation;
- у фінальному описі вказано, що перевірено і що залишилось manual-only.
