const fs = require('fs');
const path = require('path');

// Переконуємося, що шляхи вказують на правильні папки всередині www
const MEMES_DIR = path.join(__dirname, 'memes');
const OUTPUT_FILE = path.join(__dirname, 'js', 'memology-cards.js');

try {
  const files = fs.readdirSync(MEMES_DIR).filter(file => 
    /\.(jpg|jpeg|png|gif|webp)$/i.test(file)
  );

  const jsContent = `window.MEMOLOGY_CARD_IDS = ${JSON.stringify(files, null, 2)};\n`;
  
  fs.writeFileSync(OUTPUT_FILE, jsContent, 'utf-8');
  console.log(`Успішно додано ${files.length} мемів у js/memology-cards.js`);
} catch (err) {
  console.error('Помилка при генерації списку:', err);
}