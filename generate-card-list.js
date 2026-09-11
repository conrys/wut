// generate-card-list.js
// Запускати ЛОКАЛЬНО (одноразово, і щоразу як додаєш/прибираєш картинки в img/):
//
//   node generate-card-list.js
//
// Сканує папку memes/ поруч зі скриптом і перезаписує js/memology-cards.js —
// той самий формат, що memology-prompts.js/whoami-words.js, підключається
// звичайним <script src="js/memology-cards.js">. Це заміна серверного
// сканування папки (fs.readdirSync), якого більше нема без Node-хоста.
const fs = require('fs');
const path = require('path');

const IMG_DIR = path.join(__dirname, 'memes');
const OUT_FILE = path.join(__dirname, 'js', 'memology-cards.js');
const IMG_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

if (!fs.existsSync(IMG_DIR)) {
  console.error('Не знайшов папку memes/ поруч зі скриптом. Поклади картки туди і запусти ще раз.');
  process.exit(1);
}

const files = fs
  .readdirSync(IMG_DIR)
  .filter((f) => IMG_EXTENSIONS.includes(path.extname(f).toLowerCase()))
  .sort();

if (!files.length) {
  console.error('У папці img/ немає жодного зображення (.jpg/.jpeg/.png/.gif/.webp).');
  process.exit(1);
}

const out =
  '// Згенеровано generate-card-list.js — НЕ редагувати вручну.\n' +
  '// Перезапусти node generate-card-list.js після зміни вмісту memes/.\n' +
  'window.MEMOLOGY_CARD_IDS = ' + JSON.stringify(files, null, 2) + ';\n';

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, out, 'utf-8');

console.log('Знайдено зображень: ' + files.length);
console.log('Записано: ' + OUT_FILE);
