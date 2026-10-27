# 41games — Android-застосунок

Capacitor-оболонка, в яку вкладено ті самі файли, що й на kzl-crm.web.app.
Соло-ігри працюють без інтернету, онлайн-ігри й рекорди ходять у ту саму базу Firebase.

## Завантажити

https://github.com/conrys/wut/releases/download/apk-latest/41games.apk

## Як оновлюється

| Що змінилось | Що відбувається |
|---|---|
| ігри, тексти, картинки (будь-що поза `app/`) | пуш у `master` → деплой сайту → `app-manifest.json`; застосунок на головній бачить нову версію і в фоні качає **лише змінені файли**; вмикається при наступному запуску або кнопкою «Перезапустити» |
| оболонка (`app/**`: іконка, назва, плагіни, дозволи) | GitHub Actions «Build APK» збирає новий APK у реліз `apk-latest` — його треба перевстановити |

Якщо оновлення не стартує (немає `notifyAppReady` за 15 с), застосунок сам повертається до попередньої версії.

## Файли

- `bundle.mjs` — список файлів застосунку (`www`) і маніфест оновлень (`manifest`)
- `capacitor.config.json` — назва, id `com.games41.app`, заставка, плагін оновлень (без статистики Capgo)
- `android/` — нативний проєкт; `make-res.py` перемальовує іконки й заставку з `img/icon.png`
- `android/release.jks.enc` — ключ підпису, зашифрований паролем із секрету `APK_SIGNING_PASSWORD`
- `../js/core/native.js` — перший скрипт кожної сторінки: у застосунку підвантажує `vendor/capacitor/capacitor.js` і `js/core/app-shell.js`, на сайті нічого не робить
- `../scripts/vendor-deps.mjs` — локальні копії Firebase SDK, howler і шрифтів (без CDN, щоб працювало офлайн); `--check` показує зовнішні посилання, що лишились

Нова сторінка гри: першим у `<head>` після `<meta charset>` має йти `<script src="…/js/core/native.js"></script>`,
шрифти й скрипти — локальні (запусти `node scripts/vendor-deps.mjs`, якщо вставив посилання на Google Fonts).

## Збірка вручну (якщо колись буде ноутбук)

```
cd app && npm ci && node bundle.mjs www && npx cap sync android && cd android && ./gradlew assembleRelease
```
