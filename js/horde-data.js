// ==========================================================================
// «Орда» — увесь контент гри як дані: зброя, пасивки, еволюції, персонажі,
// вороги, хвилі, постійні апгрейди. Логіка — у horde-core.js, малювання —
// у horde-render.js. Щоб додати нову зброю чи ворога — досить нового об'єкта
// тут (і, якщо треба нова поведінка, функції у FIRE в horde-core.js).
//
// Усі числа — у пікселях світу і секундах. При портуванні на Kotlin цей файл
// переноситься як data-класи / JSON без змін логіки.
// ==========================================================================
(function () {
  // ---------- Зброя ----------
  // base — рівень 1; levels — що додається на рівнях 2..8 (по черзі).
  // Поля: dmg, cd (перезарядка, с), amount, area (множник), speed (множник
  // швидкості снарядів), duration (с), pierce (скільки ворогів пробиває).
  // evo — еволюція: потрібна зброя 8 рівня + пасивка `with` (будь-якого рівня),
  // відкривається зі скрині боса/еліти. mods додаються до статів 8 рівня,
  // cdMul множить перезарядку, flags вмикають особливу поведінку.
  const WEAPONS = {
    sword: {
      name: "Меч", icon: "⚔️", behavior: "sword",
      desc: "Рубає вбік найближчого ворога. Пробиває всіх.",
      base: { dmg: 10, cd: 1.35, amount: 1, area: 1, pierce: 999 },
      levels: [
        { amount: 1 }, { dmg: 5 }, { dmg: 5, area: 0.1 }, { dmg: 5 },
        { dmg: 5, area: 0.1 }, { dmg: 5 }, { dmg: 5 },
      ],
      evo: { with: "heart", name: "Кровопивець", icon: "🩸", desc: "Кожен удар лікує.", mods: { dmg: 10, area: 0.3 }, flags: { lifesteal: true } },
    },
    wand: {
      name: "Магічна стріла", icon: "✨", behavior: "wand",
      desc: "Летить у найближчого ворога.",
      base: { dmg: 10, cd: 1.2, amount: 1, speed: 1, pierce: 1 },
      levels: [
        { amount: 1 }, { cd: -0.2 }, { amount: 1 }, { dmg: 10 }, { amount: 1 }, { pierce: 1 }, { dmg: 10 },
      ],
      evo: { with: "tome", name: "Буря стріл", icon: "🌠", desc: "Стріли без перерви.", mods: { pierce: 1 }, cdMul: 0.22 },
    },
    knife: {
      name: "Кинджали", icon: "🗡️", behavior: "knife",
      desc: "Швидкі, віялом у найближчого ворога.",
      base: { dmg: 6.5, cd: 1.0, amount: 1, speed: 1, pierce: 1 },
      levels: [
        { amount: 1 }, { amount: 1, dmg: 5 }, { amount: 1 }, { pierce: 1 }, { amount: 1 }, { amount: 1, dmg: 5 }, { pierce: 1 },
      ],
      evo: { with: "bracer", name: "Тисяча лез", icon: "🌪️", desc: "Безперервний потік кинджалів.", mods: { dmg: 4 }, cdMul: 0.15 },
    },
    axe: {
      name: "Сокира", icon: "🪓", behavior: "axe",
      desc: "Летить угору й падає на голови. Б'є сильно.",
      base: { dmg: 20, cd: 2.8, amount: 1, area: 1, pierce: 3 },
      levels: [
        { amount: 1 }, { dmg: 20 }, { pierce: 2 }, { amount: 1 }, { dmg: 20 }, { pierce: 2 }, { dmg: 20 },
      ],
      evo: { with: "candle", name: "Смерч сокир", icon: "🌀", desc: "Сокири розлітаються спіраллю.", mods: { dmg: 20, area: 0.4, pierce: 999 }, flags: { spiral: true } },
    },
    pool: {
      name: "Свята вода", icon: "💧", behavior: "pool",
      desc: "Калюжі, що палять ворогів.",
      base: { dmg: 10, cd: 4.5, amount: 1, area: 1, duration: 2 },
      levels: [
        { amount: 1, area: 0.2 }, { dmg: 10, duration: 0.5 }, { amount: 1, area: 0.2 }, { dmg: 10, duration: 0.3 },
        { amount: 1, area: 0.2 }, { dmg: 5, duration: 0.3 }, { dmg: 5, area: 0.2 },
      ],
      evo: { with: "amulet", name: "Освячена земля", icon: "🌊", desc: "Калюжі ростуть і повзуть за тобою.", mods: { area: 0.5, duration: 2 }, flags: { follow: true } },
    },
    orbit: {
      name: "Книги-вартові", icon: "📖", behavior: "orbit",
      desc: "Кружляють навколо тебе.",
      base: { dmg: 10, cd: 3, amount: 1, area: 1, speed: 1, duration: 3 },
      levels: [
        { amount: 1 }, { area: 0.25, speed: 0.3 }, { duration: 0.5, dmg: 10 }, { amount: 1 },
        { area: 0.25, speed: 0.3 }, { duration: 0.5, dmg: 10 }, { amount: 1 },
      ],
      evo: { with: "hourglass", name: "Вічний кодекс", icon: "📚", desc: "Книги не зникають ніколи.", mods: { dmg: 5 }, flags: { permanent: true } },
    },
    aura: {
      name: "Часникова аура", icon: "🧄", behavior: "aura",
      desc: "Обпікає і відштовхує всіх поруч.",
      base: { dmg: 5, cd: 1.3, area: 1 },
      levels: [
        { dmg: 2, area: 0.4 }, { cd: -0.1, dmg: 1 }, { dmg: 1, area: 0.2 }, { cd: -0.1, dmg: 2 },
        { dmg: 1, area: 0.2 }, { cd: -0.1, dmg: 1 }, { dmg: 1, area: 0.2 },
      ],
      evo: { with: "armor", name: "Мур душі", icon: "👻", desc: "Аура більша і лікує тебе.", mods: { dmg: 5, area: 0.5 }, flags: { heal: true } },
    },
    bolt: {
      name: "Блискавка", icon: "⚡", behavior: "bolt",
      desc: "Б'є випадкових ворогів на екрані.",
      base: { dmg: 15, cd: 4.5, amount: 2, area: 1 },
      levels: [
        { amount: 1 }, { area: 1, dmg: 10 }, { amount: 1 }, { area: 1, dmg: 20 }, { amount: 1 }, { area: 1, dmg: 20 }, { amount: 1 },
      ],
      evo: { with: "crown", name: "Гнів небес", icon: "🌩️", desc: "Блискавки стрибають по ланцюгу.", mods: { amount: 3, dmg: 10 }, flags: { chain: true } },
    },
  };

  // ---------- Пасивки ----------
  // stat + per: на кожен рівень до стату додається per.
  const PASSIVES = {
    might:     { name: "Перстень сили",     icon: "💍", stat: "might",     per: 0.10, max: 5, desc: "+10% шкоди" },
    tome:      { name: "Книга заклять",     icon: "📕", stat: "cooldown",  per: -0.08, max: 5, desc: "−8% перезарядки" },
    candle:    { name: "Свічник",           icon: "🕯️", stat: "area",      per: 0.10, max: 5, desc: "+10% області" },
    bracer:    { name: "Наручі",            icon: "🧤", stat: "speed",     per: 0.10, max: 5, desc: "+10% швидкості снарядів" },
    hourglass: { name: "Пісочний годинник", icon: "⏳", stat: "duration",  per: 0.10, max: 5, desc: "+10% тривалості" },
    amulet:    { name: "Амулет двійника",   icon: "🧿", stat: "amount",    per: 1,    max: 2, desc: "+1 снаряд усім" },
    heart:     { name: "Серце дракона",     icon: "❤️", stat: "maxHp",     per: 20,   max: 5, desc: "+20 здоров'я" },
    armor:     { name: "Обладунок",         icon: "🛡️", stat: "armor",     per: 1,    max: 5, desc: "+1 броні" },
    crown:     { name: "Корона",            icon: "👑", stat: "growth",    per: 0.08, max: 5, desc: "+8% досвіду" },
    magnet:    { name: "Магніт",            icon: "🧲", stat: "magnet",    per: 0.30, max: 5, desc: "+30% радіусу збору" },
    boots:     { name: "Чоботи мандрівника", icon: "🥾", stat: "moveSpeed", per: 0.10, max: 5, desc: "+10% швидкості руху" },
    clover:    { name: "Конюшина",          icon: "🍀", stat: "luck",      per: 0.10, max: 5, desc: "+10% удачі" },
  };

  // ---------- Персонажі ----------
  // bonus — зміни статів (як у пасивок, адитивно). cost — ціна в золоті.
  const CHARACTERS = {
    knight:  { name: "Лицар",     weapon: "sword", hp: 120, color: "#c9cfd8", cape: "#b8323a", cost: 0,    bonus: { armor: 1 },          perk: "+1 броні, 120 здоров'я" },
    huntress:{ name: "Мисливиця", weapon: "knife", hp: 90,  color: "#7aa35a", cape: "#3f6b2a", cost: 400,  bonus: { moveSpeed: 0.15 },   perk: "+15% швидкості" },
    mage:    { name: "Чарівниця", weapon: "wand",  hp: 80,  color: "#7b6be0", cape: "#3b2f8f", cost: 700,  bonus: { cooldown: -0.10 },   perk: "−10% перезарядки" },
    priest:  { name: "Жрець",     weapon: "pool",  hp: 100, color: "#e8e2cf", cape: "#d6a93a", cost: 1000, bonus: { regen: 0.4 },        perk: "+0.4 здоров'я/с" },
    barbarian:{ name: "Варвар",   weapon: "axe",   hp: 140, color: "#c98a5a", cape: "#6b3b1f", cost: 1400, bonus: { might: 0.10 },       perk: "+10% шкоди, 140 здоров'я" },
    witch:   { name: "Відьма",    weapon: "bolt",  hp: 85,  color: "#5ab8a8", cape: "#1f4f4a", cost: 1800, bonus: { area: 0.10, luck: 0.1 }, perk: "+10% області й удачі" },
    scholar: { name: "Книжник",   weapon: "orbit", hp: 95,  color: "#d8b46a", cape: "#5a3b8a", cost: 2400, bonus: { duration: 0.20 },   perk: "+20% тривалості" },
  };

  // ---------- Вороги ----------
  // shape — як малювати (horde-render.js). fly — без штовхання з натовпом.
  // heavy — майже не відкидається.
  const ENEMIES = {
    bat:      { name: "Кажан",   shape: "bat",      r: 9,  hp: 5,   spd: 68,  dmg: 5,  xp: 1, color: "#6b4a8a", fly: true },
    zombie:   { name: "Зомбі",   shape: "zombie",   r: 12, hp: 12,  spd: 34,  dmg: 8,  xp: 1, color: "#5f8a45" },
    skeleton: { name: "Скелет",  shape: "skeleton", r: 12, hp: 20,  spd: 46,  dmg: 10, xp: 2, color: "#ddd6c2" },
    wolf:     { name: "Вовк",    shape: "wolf",     r: 12, hp: 18,  spd: 80, dmg: 10, xp: 2, color: "#7d6e60" },
    ghost:    { name: "Привид",  shape: "ghost",    r: 12, hp: 25,  spd: 56,  dmg: 12, xp: 2, color: "#a9d4ea", fly: true },
    cultist:  { name: "Культист", shape: "cultist", r: 12, hp: 45,  spd: 54,  dmg: 14, xp: 3, color: "#8f2c3e" },
    golem:    { name: "Ґолем",   shape: "golem",    r: 18, hp: 120, spd: 30,  dmg: 18, xp: 6, color: "#80848c", heavy: true },
    // боси
    ogre:     { name: "Огр",     shape: "ogre",     r: 40, hp: 1600,  spd: 46, dmg: 25, xp: 60,  color: "#7a8f3a", heavy: true, boss: "dash" },
    lich:     { name: "Ліч",     shape: "lich",     r: 38, hp: 4500,  spd: 48, dmg: 30, xp: 120, color: "#3d6f8f", heavy: true, boss: "summon" },
    reaper:   { name: "Жнець",   shape: "reaper",   r: 40, hp: 16000, spd: 72, dmg: 45, xp: 0,   color: "#1b1b24", heavy: true, boss: "final" },
  };

  // ---------- Хвилі ----------
  // По хвилинах (індекс = хвилина): скільки ворогів тримати на мапі (на базовий екран
  // 390×720; на більшому огляді ядро множить ліміт) і кого
  // спавнити (вага = частота). Після 15-ї хвилини діє останній запис.
  const WAVES = [
    { max: 10,  types: { bat: 1, zombie: 3 } },
    { max: 18,  types: { bat: 2, zombie: 3, skeleton: 1 } },
    { max: 30,  types: { zombie: 2, skeleton: 2, wolf: 1 } },
    { max: 45,  types: { skeleton: 3, wolf: 2, bat: 2 } },
    { max: 75,  types: { skeleton: 2, ghost: 2, zombie: 3 } },
    { max: 85,  types: { wolf: 3, ghost: 2, skeleton: 2 } },
    { max: 100, types: { golem: 1, ghost: 3, skeleton: 3 } },
    { max: 115, types: { wolf: 3, cultist: 1, bat: 4 } },
    { max: 130, types: { cultist: 2, golem: 1, skeleton: 3 } },
    { max: 145, types: { ghost: 3, cultist: 2, wolf: 2 } },
    { max: 160, types: { golem: 2, cultist: 3, skeleton: 2 } },
    { max: 175, types: { cultist: 3, ghost: 3, golem: 1 } },
    { max: 190, types: { golem: 2, wolf: 4, cultist: 2 } },
    { max: 210, types: { cultist: 4, golem: 2, ghost: 3 } },
    { max: 230, types: { golem: 3, cultist: 4, wolf: 3 } },
    { max: 250, types: { golem: 3, cultist: 4, ghost: 4, wolf: 3 } },
  ];

  // Події за часом (секунди): боси, еліти (дають скриню), рої та кільця.
  const EVENTS = [
    { t: 60,  kind: "elite", type: "skeleton" },
    { t: 150, kind: "swarm", type: "bat", n: 30 },
    { t: 180, kind: "elite", type: "wolf" },
    { t: 240, kind: "ring",  type: "zombie", n: 36 },
    { t: 300, kind: "boss",  type: "ogre" },
    { t: 390, kind: "swarm", type: "bat", n: 45 },
    { t: 420, kind: "elite", type: "golem" },
    { t: 480, kind: "ring",  type: "skeleton", n: 40 },
    { t: 540, kind: "swarm", type: "wolf", n: 30 },
    { t: 600, kind: "boss",  type: "lich" },
    { t: 690, kind: "elite", type: "cultist" },
    { t: 720, kind: "ring",  type: "golem", n: 24 },
    { t: 780, kind: "swarm", type: "ghost", n: 50 },
    { t: 840, kind: "elite", type: "golem" },
    { t: 870, kind: "ring",  type: "cultist", n: 44 },
    { t: 900, kind: "boss",  type: "reaper" },
  ];
  const RUN_SECONDS = 900; // на 15:00 приходить Жнець; вбив його — перемога

  // ---------- Постійні апгрейди (крамниця за золото) ----------
  // cost — ціна першого рівня, кожен наступний дорожчий на cost.
  const SHOP = {
    might:     { name: "Сила",        icon: "💪", stat: "might",     per: 0.05, max: 5, cost: 100, desc: "+5% шкоди" },
    maxHp:     { name: "Здоров'я",    icon: "❤️", stat: "maxHp",     per: 10,   max: 5, cost: 80, desc: "+10 здоров'я" },
    armor:     { name: "Броня",       icon: "🛡️", stat: "armor",     per: 1,    max: 3, cost: 180, desc: "+1 броні" },
    regen:     { name: "Відновлення", icon: "🌿", stat: "regen",     per: 0.2,  max: 5, cost: 110, desc: "+0.2 здоров'я/с" },
    cooldown:  { name: "Спритність",  icon: "⏱️", stat: "cooldown",  per: -0.03, max: 3, cost: 210, desc: "−3% перезарядки" },
    area:      { name: "Розмах",      icon: "⭕", stat: "area",      per: 0.05, max: 3, cost: 180, desc: "+5% області" },
    moveSpeed: { name: "Біг",         icon: "👟", stat: "moveSpeed", per: 0.05, max: 3, cost: 140, desc: "+5% швидкості" },
    magnet:    { name: "Притягання",  icon: "🧲", stat: "magnet",    per: 0.20, max: 3, cost: 100, desc: "+20% радіусу збору" },
    growth:    { name: "Мудрість",    icon: "📜", stat: "growth",    per: 0.04, max: 5, cost: 140, desc: "+4% досвіду" },
    greed:     { name: "Жадібність",  icon: "💰", stat: "greed",     per: 0.10, max: 5, cost: 100, desc: "+10% золота" },
    luck:      { name: "Удача",       icon: "🍀", stat: "luck",      per: 0.10, max: 3, cost: 210, desc: "+10% удачі" },
    rerolls:   { name: "Переграш",    icon: "🎲", stat: "rerolls",   per: 1,    max: 3, cost: 280, desc: "+1 перекид вибору" },
    revivals:  { name: "Друге життя", icon: "🕊️", stat: "revivals",  per: 1,    max: 1, cost: 1400, desc: "Один раз воскреснути" },
  };

  window.HordeData = { WEAPONS, PASSIVES, CHARACTERS, ENEMIES, WAVES, EVENTS, RUN_SECONDS, SHOP, MAX_WEAPONS: 6, MAX_PASSIVES: 6, WEAPON_MAX_LEVEL: 8 };
})();
