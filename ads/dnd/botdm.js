/* Кошмар наяву — бот-майстер для соло-гри.
   Сценарій — послідовність «бітів»: розповідь, репліки NPC, хаби з варіантами дій,
   перевірки, бої. Варіанти в хабі відкриваються ланцюжком (req): не можна спитати
   «чи він щось приховує», поки не заговорив із людиною й не дізнався імʼя.
   Стан — у G.bd (серіалізується), сценарій — у коді. */
(function () {
  const S = window.DND_STORY, R = window.DND;
  const CK = (id) => S.SCENES.flatMap((s) => s.checks).find((c) => c.id === id);
  const hasThief = (g) => Object.values(g.chars).some((c) => !c.dead && R.CLASSES[c.cls].skills.includes('thieves'));
  const NPC = { 'Торінг': '🍺', 'Ерандур': '🕯️', 'Жрець': '🕯️', 'Вартовий': '🛡️', 'Перехожа': '🐟', 'Верен': '🧙', 'Голос': '💀', 'Шахтар': '⛏️', 'Хтось у натовпі': '👥', 'Управитель ярла': '📜', 'Привид': '👻' };

  /* Бiти:
     read: 'all' | [індекси] — текст сцени з story.js (пергамент)
     say: рядок | {t, sp, tip} | масив; sp — хто говорить; tip — підказка-правило
     ck: id з story.js або {sk|st|sv, dc, t, why, ok, fail}; who: me | best | all | group | thief; adv
     hub: {ask, opts, until(f, n), done, doneReq(f)} — варіанти; opt: {id, t, req(f,g), say, sp, ck, who, noroll, end, free, fin}
     ефекти (у біті, варіанті або з префіксом ok/fail після перевірки): set, lore, journal, goal
     fight, surp(f), win · rest · passive · next · end · if(f, g) */
  const SCRIPT = {
    intro: [
      { read: 'all' },
      { say: 'Я — бот-майстер. Описую світ і граю всіх, кого ви зустрінете. Ти вирішуєш, що робить твій герой: я даватиму варіанти, а кубик кидатимеш тапом.', tip: 'У справжній грі варіантів немає — гравець каже словами що завгодно. Тут вони, щоб показати, як майстер перетворює дію на перевірку.' },
      { say: 'Усе, що ви дізнаєтесь про світ і квест, записується у вкладку «Журнал». Заглядай туди, коли щось незрозуміло.' },
      { next: 1 },
    ],

    dawnstar: [
      { read: [0], lore: 'dawnstar' },
      { hub: 1, ask: 'Ви на головній вулиці Данстару. Що робите?', opts: [
        { id: 'look', t: 'Роздивитись вулицю', ck: 'd_street' },
        { id: 'ask', t: 'Зупинити перехожу й розпитати', sp: 'Перехожа', say: 'Жінка з кошиком риби ледь тримає очі розплющеними: «Чого вам?»',
          ck: { sk: 'persuasion', dc: 10, t: 'Розговорити перехожу', why: 'Переконання (Харизма): вона втомлена й налякана, але ввічливе слово допоможе. Легко.',
            ok: '«Ніхто не спить, ось що. А хто засне — кричить так, що вся вулиця чує. Ідіть до корчми «Вершина вітру», там усі сидять, щоб не засинати вдома самим».',
            fail: 'Жінка відмахується й поспішає далі. Зате тепер ясно, куди всі поділись: з корчми долинає гомін.' }, flag: 'asked', okJournal: 'nightmares' },
        { id: 'go', t: 'Піти до корчми «Вершина вітру»', end: 1 },
      ] },
      { read: [1, 2] },
      { hub: 1, ask: 'Ви в корчмі. Що робите?', opts: [
        { id: 'priest', t: 'Роздивитись жерця біля вогню', say: ['Жовта ряса, на грудях — амулет із золотим колом. Це знак Мари, богині милосердя.', 'Жрець ні з ким не говорить: гріє руки й уважно стежить за шахтарями, ніби чекає чогось.'], lore: 'mara', tip: 'Новий запис у лорі — вкладка «Журнал».' },
        { id: 'people', t: 'Роздивитись відвідувачів', say: 'Шахтарі мовчки сьорбають юшку, вояки ярла грають у кості — мляво, без азарту. Рибалка в кутку клює носом, і сусід штовхає його ліктем.' },
        { id: 'bar', t: 'Підійти до стійки й заговорити з корчмарем', end: 1 },
      ] },
      { say: { sp: 'Торінг', t: '«Я Торінг, це моя корчма. Мед, юшка, ліжко — чого бажаєте? Тільки спати не раджу»' } },
      { hub: 1, ask: 'Торінг протирає кухоль і чекає. Про що питаєте?', opts: [
        { id: 'what', t: '«Що тут коїться? Чому місто таке тихе?»', sp: 'Торінг', say: '«Кошмари. Пʼятий день. Засинаєш — і прокидаєшся з криком, мокрий від поту. Тож ніхто й не спить. Сидять тут, бо вдома самим страшно»', journal: 'nightmares', set: { what: 1 } },
        { id: 'who', t: '«Хто той жрець біля вогню?»', sp: 'Торінг', say: '«Прийшов пару днів тому. Каже, з храму Мари в Рифтені. Сидить, слухає, розпитує людей про сни. Як звати — не питав, мені не до того»' },
        { id: 'work', t: '«Є тут робота для шукачів пригод?»', sp: 'Торінг', say: '«Робота? Ярл Скальд озолотить того, хто зупинить кошмари. А я поїтиму його безкоштовно до кінця віку»', journal: 'reward', set: { reward: 1 } },
        { id: 'before', t: '«А перед тим, як почались сни, було щось дивне?»', req: (f) => f.what, ck: 'd_persu', okJournal: 'purple_light', okLore: 'temple', okSet: { light: 1 } },
        { id: 'room', t: '«Є вільна кімната на ніч?»', sp: 'Торінг', say: '«Є. Двадцять монет. Але навіщо вам ліжко, якщо спати не можна?» — він невесело всміхається.' },
        { id: 'mead', t: 'Замовити по кухлю гарячого меду', free: 1, noroll: 'Без кидка — просто платите. Мед гарячий і солодкий, уперше за день вам тепло. Не кожна дія потребує кубика.', lesson: 'noroll' },
        { id: 'army', t: '«Хай ярл дасть сотню вояків — і ми розберемось»', free: 1, noroll: 'Торінг пирхає: «Сотню? У ярла й двадцяти не набереться, і ті сплять на ходу». Кидка не буде: це просто неможливо. Кубик вирішує лише те, що могло б статись — навіть натуральна 20 не робить неможливе можливим.', lesson: 'nat20' },
      ], until: (f, n) => n >= 3, done: 'Подякувати й відійти від стійки' },
      { say: ['Раптом за столом шахтарів — гуркіт. Молодий шахтар сповзає з лави й падає на підлогу. Очі заплющені, груди рівно піднімаються — він спить.',
        'З його рота й ніздрів повільно струменить фіолетовий туман і стелиться підлогою.',
        'Жрець схоплюється першим. Він опускається на коліна біля шахтаря, кладе долоню йому на чоло й щось шепоче.',
        { sp: 'Хтось у натовпі', t: '«Знову… Це вже третій за сьогодні…»' }], journal: 'miner' },
      { hub: 1, ask: 'Корчма завмерла. Що робите?', opts: [
        { id: 'med', t: 'Підійти до шахтаря й оглянути його', ck: 'd_med' },
        { id: 'talk', t: 'Заговорити з жерцем: «Що з ним?»', sp: 'Жрець', say: ['«Сон, що не відпускає. Я тримаю його молитвою, щоб не провалився глибше».', 'Не забираючи долоні, він підводить на вас очі. «Мене звати Ерандур. Я жрець Мари»'], set: { talked: 1 }, lore: 'erandur' },
        { id: 'crowd', t: 'Роздивитись людей навколо', ck: 'd_crowd' },
        { id: 'listen', t: 'Прислухатись до гомону', ck: 'd_listen', okLore: 'temple' },
        { id: 'mist', t: 'Придивитись до фіолетового туману', ck: 'd_arcana', who: 'best' },
        { id: 'doing', t: 'Спитати Ерандура: «Що ви з ним робите?»', req: (f) => f.talked, sp: 'Ерандур',
          say: ['«Молитва Мари відганяє сон. Ненадовго».', { sp: 'Шахтар', t: 'Шахтар здригається, розплющує очі й хапає ротом повітря: «Туман… вона кличе…»' }, '«Їх стає більше щоночі, — тихо каже Ерандур. — Це не хвороба. Це Ваерміна»'],
          set: { vaer: 1 }, journal: 'erandur_met' },
        { id: 'whov', t: 'Згадати, хто така Ваерміна', req: (f) => f.vaer, ck: 'd_relig', who: 'best', okLore: ['vaermina', 'daedra', 'skull'], failLore: ['vaermina', 'daedra'],
          fail: 'Імʼя щось нагадує, але не більше. Ерандур пояснює сам: «Даедра снів і кошмарів. Її жерці ходять у чужі сни»' },
        { id: 'how', t: '«Звідки жрець Мари стільки знає про даедра?»', req: (f) => f.vaer, sp: 'Ерандур', say: 'Ерандур на мить замовкає. «Я… вивчав її культ. Довго». Він відводить очі.', set: { evasive: 1 } },
        { id: 'hide', t: 'Придивитись: чи не договорює він чогось?', req: (f) => f.evasive, ck: 'd_insight', okSet: { suspect: 1 }, okJournal: 'erandur_secret' },
        { id: 'press', t: 'Натиснути: «Ви щось приховуєте»', req: (f) => f.suspect, ck: 'd_intim', okSet: { early: 1 } },
      ], done: 'Вислухати, чого хоче Ерандур', doneReq: (f) => f.vaer },
      { say: { sp: 'Ерандур', t: '«Я знаю, звідки це. Храм Нічного Поклику, на скелі над містом. Там лежить те, що насилає сни. Сам я не дійду. Мені потрібні міцні руки. Підете зі мною?»' }, lore: 'temple' },
      { hub: 1, ask: 'Ерандур чекає відповіді.', opts: [
        { id: 'yes', t: '«Ми з вами»', sp: 'Ерандур', say: '«Хай Мара вас береже. Зберуся — і вирушаємо, поки світло»', end: 1 },
        { id: 'pay', t: '«А що ми з цього матимемо?»', ck: 'd_reward' },
        { id: 'no', t: '«Це не наша справа»', end: 1, noroll: 'Ерандур киває: «Тоді я піду сам». Він накидає капюшон і бреде до дверей — сутулий, ледь тримаючись на ногах. Ви розумієте: сам він не дійде. На порозі ви його наздоганяєте.', tip: 'Відмова — теж рух історії: майстер не змушує, але світ реагує.' },
      ] },
      { journal: 'go_temple' },
      { next: 1 },
    ],

    road: [
      { say: 'Ерандур просить годину на збори. Ви встигаєте пройтись містом.' },
      { hub: 1, ask: 'Що робите перед дорогою?', opts: [
        { id: 'guard', t: 'Спитати вартового біля воріт про дорогу', sp: 'Вартовий', say: '«До храму? Стежка на північ, уздовж скелі. Тримайтеся купи: вовки цієї зими голодні, вже двох пастухів загризли»', journal: 'wolves', set: { warned: 1 } },
        { id: 'rope', t: 'Купити в крамниці мотузку й смолоскипи', noroll: 'Без кидка — просто купуєте. Мотузка ще знадобиться.', set: { rope: 1 } },
        { id: 'jarl', t: 'Сходити до ярла по нагороду наперед', req: (f) => f.reward, sp: 'Управитель ярла', say: '«Ярл… не спить, але нікого не приймає. Повертайтесь із доказом — тоді й поговоримо»' },
        { id: 'go', t: 'Вирушати', end: 1 },
      ] },
      { read: 'all' },
      { say: 'Хтось має вести групу засніженою стежкою. Найкраще в горах орієнтується той, у кого найвища Виживання.' },
      { ck: 'r_surv', who: 'best' },
      { ck: 'r_cold', who: 'all', if: (f) => f.r_surv === false },
      { say: 'На півдорозі з-під снігу стирчить рука в залізній рукавиці. Замерзлий шукач пригод у старій броні, поруч — шкіряна сумка.' },
      { hub: 1, ask: 'Що робите?', opts: [
        { id: 'search', t: 'Обшукати сумку', ck: 'r_note', okJournal: 'note', okSet: { note: 1 } },
        { id: 'show', t: 'Показати записку Ерандуру', req: (f) => f.note, sp: 'Ерандур', say: 'Ерандур читає — і обличчя в нього сіріє. Довго мовчить. «Це… давня історія. Ходімо». Він ховає записку в рукав.', set: { shown: 1 } },
        { id: 'pray', t: 'Помолитися за загиблого', sp: 'Ерандур', say: 'Ерандур схиляє голову разом із вами: «Мара, прийми його. Хай йому нарешті сниться щось добре»' },
        { id: 'go', t: 'Іти далі', end: 1 },
      ] },
      { say: 'Мотузка з крамниці знадобилась: з нею лізти легше.', tip: 'Вдале спорядження чи план дають перевагу: кидаєш 2к20 і береш більше.', if: (f) => f.rope, lesson: 'adv' },
      { hub: 1, ask: 'Крижаний уступ перегороджує стежку. Як твій герой його долає? Одна перешкода — різні стати.', opts: [
        { id: 'climb', t: 'Залізти вгору (Атлетика — Сила)', ck: 'r_climb', adv: (f) => (f.rope ? 1 : 0), end: 1 },
        { id: 'acro', t: 'Пробігти по краю льоду (Акробатика — Спритність)', ck: 'r_acro', end: 1 },
        { id: 'wait', t: 'Почекати, поки інші скинуть мотузку', end: 1, noroll: 'Можна й так — без кидка. Хтось виліз, скинув мотузку, і ти піднімаєшся повільно, але безпечно. Розумне рішення теж працює.' },
      ] },
      { say: 'Між ялинами щось рухається. Усі кидають Сприйняття — це Мудрість: помітити, почути, вловити.' },
      { ck: 'r_wolf', who: 'all' },
      { say: 'Вартовий не збрехав: з-за ялин виходить зграя вовків. Голодні, виснажені — як і все навколо Данстара.', if: (f) => f.warned },
      { fight: 'wolves', win: 'Останній вовк скавучить і тікає в ліс. Стежка вільна.' },
      { rest: 'short' },
      { say: 'Попереду, на краю скелі, чорніє вежа храму. Двері величезні, оковані залізом, і на них тьмяно світиться печатка.' },
      { next: 1 },
    ],

    temple: [
      { read: [0] },
      { hub: 1, ask: 'Печатка тріснула. Перш ніж увійти…', opts: [
        { id: 'how', t: '«Звідки ви знали, як зняти печатку?»', sp: 'Ерандур', say: '«Мара відчиняє те, що замкнула ненависть», — відповідає він. Надто швидко.' },
        { id: 'seal', t: 'Оглянути уламки печатки', who: 'best', flag: 'seal',
          ck: { sk: 'arcana', dc: 12, t: 'Що це була за печатка?', why: 'Магія (Інтелект) — розпізнати чари.', ok: 'Печатку ставили жерці Ваерміни, зсередини. Зняти її міг лише той, хто знає їхні слова. Жерці Мари таких слів не знають.', fail: 'Якісь давні чари. Тепер уже неважливо.' } },
        { id: 'in', t: 'Увійти', end: 1 },
      ] },
      { read: [1, 2] },
      { passive: 13 },
      { hub: 1, if: (f) => f.t_perc === true, ask: 'Плита в підлозі явно підозріла. Що робиш?', opts: [
        { id: 'inv', t: 'Роздивитись, як вона працює', ck: 't_inv', end: 1 },
        { id: 'walk', t: 'Просто обійти її вздовж стіни', end: 1, noroll: 'Без кидка: ви обходите плиту. Обережність — теж рішення, і майстер не мусить просити кидок, якщо гравці діють розумно.' },
      ] },
      { say: 'Хтось наступає на плиту — клац! Зі стін сиплеться фіолетовий пил.', if: (f) => f.t_perc === false },
      { ck: 't_disarm', who: 'thief', if: (f, g) => f.t_inv === true && hasThief(g) },
      { ck: 't_gas', who: 'all', if: (f) => f.t_perc === false || f.t_inv === false || f.t_disarm === false },
      { say: 'Коридор виводить до зали. З-за рогу чути брязкіт зброї і крики.' },
      { hub: 1, ask: 'Що робите?', opts: [
        { id: 'peek', t: 'Обережно визирнути', flag: 'peek', okJournal: 'sleepers',
          ck: { sk: 'perception', dc: 10, t: 'Що там, у залі?', why: 'Сприйняття (Мудрість) — побачити.', ok: 'Двоє орків бʼються з жерцями у фіолетових рясах. Жерці рухаються сонно, повільно — ніби ще не прокинулись до кінця.', fail: 'Тіні, крики, дзенькіт. Скільки їх — не зрозуміло.' } },
        { id: 'who', t: 'Спитати Ерандура: «Хто це?»', sp: 'Ерандур', say: '«Жерці Ваерміни. І орки, що напали на храм шістдесят років тому. Вони спали весь цей час. Ми… їх розбудили»', lore: 'orcs', journal: 'sleepers' },
        { id: 'sneak', t: 'Підкрастися й напасти раптово', set: { sneak: 1 }, end: 1 },
        { id: 'charge', t: 'Кинутись у бій одразу', end: 1 },
      ] },
      { ck: 't_sneak', who: 'group', if: (f) => f.sneak },
      { fight: 'hall', surp: (f) => (f.t_sneak ? 'foe' : ''), win: 'Зала стихла. Ерандур важко дихає, спираючись на булаву.' },
      { rest: 'short' },
      { say: 'За залою — важкі дубові двері з табличкою «Бібліотека». Замкнені.' },
      { hub: 1, ask: 'Як відчиняєте?', opts: [
        { id: 'lock', t: 'Відімкнути відмичками (Спритність)', ck: 't_lock', who: 'thief', req: (f, g) => hasThief(g), end: 1 },
        { id: 'force', t: 'Виламати плечем (чиста Сила)', ck: 't_force', who: 'best', end: 1 },
      ] },
      { say: 'Пил, павутина, полиці з книгами про сни. На столі — товстий журнал у шкіряній палітурці. Ерандур дивиться на нього, як на змію.' },
      { hub: 1, ask: 'Що робите?', opts: [
        { id: 'read', t: 'Читати журнал храму', ck: 't_hist', who: 'best', okSet: { book: 1 }, fail: 'Почерк дрібний, сторінки злиплись від вологи — нічого не розібрати.' },
        { id: 'askread', t: 'Попросити Ерандура прочитати', req: (f) => f.t_hist === false, sp: 'Ерандур', say: 'Ерандур довго дивиться на журнал. Потім тихо читає: «Орки на сходах. Ми випили Ступор і закрили Череп барʼєром. Брат Казимир утік…» Він замовкає.', set: { book: 1 } },
        { id: 'kaz', t: '«Хто такий Казимир?»', req: (f) => f.book || f.note, sp: 'Ерандур',
          say: ['Ерандур опускає очі. Тиша така, що чути, як потріскує смолоскип.', '«Казимир — це я. Я був жерцем Ваерміни. Коли прийшли орки, всі пили Ступор — а я злякався і втік».', '«Шістдесят років я молюся Марі, щоб спокутувати це. Тепер мене звуть Ерандур»'],
          set: { confessed: 1 }, lore: 'kazimir', journal: 'kazimir' },
        { id: 'trust', t: 'Придивитись: чи щирий він?', req: (f) => f.confessed, ck: 't_ins' },
        { id: 'angry', t: '«Ви нам брехали!»', req: (f) => f.confessed, sp: 'Ерандур', say: '«Так. Бо інакше ви б не пішли. Можете піти зараз — я зрозумію. Але без вас я Череп не зупиню»' },
        { id: 'next', t: '«Що далі?»', req: (f) => f.confessed, sp: 'Ерандур', say: '«Барʼєр навколо Черепа поставили уві сні. І зняти його можна лише уві сні. Мені потрібен Ступор Ваерміни — він має бути тут»', lore: 'stupor', journal: 'stupor', set: { plan: 1 } },
      ], done: 'Шукати Ступор', doneReq: (f) => f.plan },
      { next: 1 },
    ],

    dream: [
      { read: 'all' },
      { say: 'Сон тягне в себе. Опирається не розум, а воля — тому рятівний кидок Мудрості.' },
      { ck: 'dr_will', who: 'all' },
      { hub: 1, ask: 'Ви в храмі шістдесятирічної давнини. Що робите?', opts: [
        { id: 'look', t: 'Роздивитись навколо', flag: 'dlook',
          ck: { sk: 'perception', dc: 10, t: 'Що навколо?', why: 'Сприйняття (Мудрість) — побачити.', ok: 'Свічки нові, на стінах — свіжі фрески Ваерміни. У вікні видно, як орки деруться на скелю. Ваші руки — чужі, у фіолетових рукавах.', fail: 'Усе пливе, як у тумані.' } },
        { id: 'mirror', t: 'Подивитись у дзеркало на стіні', say: 'У дзеркалі — не ти. Молодий темний ельф у фіолетовій рясі, з переляканими очима. Ти впізнаєш його: це Ерандур. Шістдесят років тому.', journal: 'memory' },
        { id: 'go', t: 'Йти до барʼєра', end: 1 },
      ] },
      { hub: 1, ask: 'Жрець-привид заступає дорогу: «Брате, ти куди?» Обидва шляхи — Харизма, але різні навички.', opts: [
        { id: 'lie', t: 'Збрехати: «Наказ Верена — до барʼєра!» (Обман)', ck: 'dr_lie', end: 1 },
        { id: 'perf', t: 'Зіграти роль жерця: заспівати гімн (Виступ)', ck: 'dr_perf', end: 1 },
      ] },
      { ck: 'dr_arc', who: 'best' },
      { say: 'Барʼєр гуде й сліпить. Без розгадки доведеться пробувати навмання — це перешкода.', if: (f) => f.dr_arc === false, lesson: 'adv' },
      { ck: 'dr_words', who: 'best', adv: (f) => (f.dr_arc === false ? -1 : 0) },
      { journal: 'memory' },
      { next: 1 },
    ],

    shrine: [
      { read: 'all', journal: 'veren' },
      { hub: 1, ask: 'Верен і Торек повільно підходять. Що робите?', opts: [
        { id: 'want', t: '«Чого ви хочете?»', sp: 'Верен', say: '«Ваерміна обіцяла нам вічний сон без болю. Ми отримали вічний кошмар. А він утік — і залишив нас»' },
        { id: 'calm', t: 'Вмовити їх скласти зброю', ck: 's_calm', end: 1 },
        { id: 'atk', t: 'Атакувати першими', end: 1 },
      ] },
      { fight: 'shrine', surp: (f) => (f.s_calm ? 'foe' : ''), win: 'Торек падає. Над постаментом стихає фіолетове сяйво.' },
      { say: { sp: 'Голос', t: 'Тиша. І раптом голос — у тебе в голові, теплий і лагідний: «Він зрадник. Убий його — і жезл твій. Ніхто більше не зможе тобі нашкодити уві сні»' }, journal: 'choice' },
      { ck: 's_will' },
      { ck: 's_ins' },
      { hub: 1, ask: 'Ерандур підносить булаву над Черепом. Що робиш? Правильної відповіді немає.', opts: [
        { id: 'let', t: 'Дати Ерандуру знищити Череп', fin: 'a', end: 1 },
        { id: 'pers', t: 'Переконати Ерандура віддати жезл (Переконання)', ck: 's_pers', fin: (f) => (f.s_pers ? 'b' : 'a'), end: 1 },
        { id: 'force', t: 'Зупинити його силою і забрати жезл', fin: 'b', end: 1, say: 'Удар — і Ерандур падає. Жезл холодний і важкий. Десь далеко сміється Ваерміна.' },
      ] },
      { end: 1 },
    ],
  };

  const BD = { at: 0, fightAt: 0, ckAt: 0, fast: false };
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const beats = (sc) => SCRIPT[S.SCENES[sc].id] || [];
  const ckDef = (c) => (c.sk ? { kind: 'sk', key: c.sk } : c.st ? { kind: 'st', key: c.st } : { kind: 'sv', key: c.sv });
  const fn = (v, f, g) => (typeof v === 'function' ? v(f, g) : v);

  function init(E, me) {
    E.G.bd = { me, sc: 0, i: 0, flags: {}, q: [], ch: null, pend: null, start: null, fin: null, end: false };
    E.apply({ t: 'scene', sc: 0 }, null, true);
    E.dirty = true;
  }
  function norm(x, sp) { return [].concat(x).filter(Boolean).map((m) => (typeof m === 'string' ? { t: m, sp: sp || '' } : Object.assign({ sp: sp || '' }, m))); }
  function push(E, msgs, tip) {
    const b = E.G.bd, list = norm(msgs);
    if (tip && list.length) list[list.length - 1].tip = tip;
    for (const m of list) {
      b.q.push({ t: m.t, sp: m.sp || '', tip: m.tip || '', read: !!m.read });
      if (!m.read) E.log(m.sp ? m.sp + ': ' + m.t : '🎲 ' + m.t, 'sys');
    }
    E.dirty = true;
  }
  function eff(E, o, pre) { // set / lore / journal / goal, з префіксом ok|fail після перевірки
    if (!o) return;
    const b = E.G.bd, k = (n) => (pre ? pre + n[0].toUpperCase() + n.slice(1) : n);
    if (o[k('set')]) Object.assign(b.flags, o[k('set')]);
    if (o[k('lore')]) E.apply({ t: 'lore', k: o[k('lore')] }, null, true);
    if (o[k('journal')]) E.apply({ t: 'journal', k: o[k('journal')] }, null, true);
    if (o[k('goal')]) E.apply({ t: 'goal', k: o[k('goal')] }, null, true);
    if (!pre && o.lesson) E.apply({ t: 'teach', k: o.lesson }, null, true);
  }
  function src(b, s) { const bt = beats(s.sc)[s.i]; return s.o ? bt && bt.opts.find((o) => o.id === s.o) : bt; }
  function who(E, spec, def) {
    const g = E.G, me = g.bd.me, alive = Object.keys(g.chars).filter((k) => !g.chars[k].dead);
    const bonus = (k) => E.checkParts(g.chars[k], def).reduce((a, p) => a + p[1], 0);
    const best = () => alive.slice().sort((a, b) => bonus(b) - bonus(a) || (a === me ? -1 : b === me ? 1 : 0))[0];
    if (spec === 'all' || spec === 'group') return alive;
    if (spec === 'best') return alive.length ? [best()] : [];
    if (spec === 'thief') { const t = alive.filter((k) => R.CLASSES[g.chars[k].cls].skills.includes('thieves')); return t.length ? [t.includes(me) ? me : t[0]] : []; }
    return alive.includes(me) ? [me] : alive.length ? [best()] : [];
  }
  function startCk(E, s) {
    const g = E.G, o = src(g.bd, s), c = typeof o.ck === 'string' ? CK(o.ck) : o.ck;
    if (!c) return false;
    const def = ckDef(c), spec = o.who || 'me', ks = who(E, spec, def);
    if (!ks.length) return false;
    let why = c.why || '';
    if (spec === 'best' && ks[0] !== g.bd.me) why += ' Кидає ' + g.chars[ks[0]].n + ' — у цій групі це виходить найкраще.';
    E.apply({ t: 'ck', cfg: Object.assign({}, def, { dc: c.dc, t: c.t, why, show: true, adv: fn(o.adv, g.bd.flags, g) || 0, who: ks, mode: spec === 'group' ? 'group' : 'one', sid: typeof o.ck === 'string' ? o.ck : null }) }, null, true);
    g.bd.pend = { type: 'ck', s };
    return true;
  }
  const COST = { r_cold: '3', r_climb: '1d4', r_acro: '1d4' };
  function resolveCk(E) {
    const g = E.G, b = g.bd, ck = g.ck, s = b.pend.s, o = src(b, s), c = typeof o.ck === 'string' ? CK(o.ck) : o.ck;
    const id = o.flag || (typeof o.ck === 'string' ? o.ck : o.id);
    const okK = ck.who.filter((k) => ck.res[k].ok), badK = ck.who.filter((k) => !ck.res[k].ok);
    const ok = ck.mode === 'group' ? ck.gok : okK.length * 2 >= ck.who.length;
    b.flags[id] = ok;
    const okT = o.ok || c.ok, failT = o.fail || c.fail, names = (ks) => ks.map((k) => g.chars[k].n).join(', ');
    let t;
    if (ck.mode === 'group') t = (ok ? '✔ Група впоралась (' : '✖ Група провалила (') + okK.length + ' з ' + ck.who.length + '). ' + (ok ? okT : failT);
    else if (ck.who.length > 1) t = (okK.length ? '✔ ' + names(okK) + ': ' + okT + ' ' : '') + (badK.length ? '✖ ' + names(badK) + ': ' + failT : '');
    else t = (ok ? '✔ Успіх. ' : '✖ Провал. ') + (ok ? okT : failT);
    const cid = typeof o.ck === 'string' ? o.ck : '';
    if (COST[cid] && badK.length) {
      const lost = badK.map((k) => { const d = COST[cid].includes('d') ? R.roll(COST[cid]).t : +COST[cid]; E.apply({ t: 'hp', k, d: -d }, null, true); return g.chars[k].n + ' −' + d; });
      t += ' (хіти: ' + lost.join(', ') + ')';
    }
    if (cid === 'dr_words' && !ok) { const lost = Object.keys(g.chars).filter((k) => !g.chars[k].dead).map((k) => { const d = R.roll('1d4').t; E.apply({ t: 'hp', k, d: -d }, null, true); return g.chars[k].n + ' −' + d; }); t += ' (' + lost.join(', ') + ')'; }
    const nat20 = ck.who.some((k) => ck.res[k].v === 20) && ck.kind !== 'sv';
    const tip = nat20 ? 'Натуральна 20 — найкращий результат, але лише з того, що можливо в цій ситуації.' : (!ok && ck.mode !== 'group' && !b.tipFail ? 'Провал не зупиняє історію — він лише має ціну.' : '');
    if (tip && !nat20) b.tipFail = 1;
    b.pend = null;
    push(E, { t, sp: o.sp && s.o ? o.sp : '', tip });
    eff(E, o, ok ? 'ok' : 'fail');
    if (o.fin) b.fin = fn(o.fin, b.flags, g);
    if (s.o && o.end && b.ch) b.ch.close = 1;
  }
  const EPI = {
    a: ['Ерандур опускає булаву на Череп. Кістка тріскає, і фіолетовий дим розвіюється, як ранковий туман.',
      { sp: 'Ерандур', t: '«Шістдесят років я чекав цього. Дякую вам. Тепер я можу спати»' },
      'Унизу, в Данстарі, люди вперше за тиждень засинають спокійно.'],
    b: ['Жезл «Череп порчі» тепер ваш. Держак холодний, а очниці черепа ледь світяться.',
      'Ви спускаєтесь у Данстар. Люди досі не сплять — і тепер, коли ви заплющуєте очі, вам теж щось сниться.'],
  };
  function finale(E, v) {
    const g = E.G, f = g.bd.flags;
    E.apply({ t: 'finale', v }, null, true);
    E.apply({ t: 'goal', k: 'done' }, null, true);
    push(E, EPI[v]);
    if (v === 'a' && f.reward) push(E, { sp: 'Торінг', t: 'Ярл Скальд дотримує слова й щедро платить. А Торінг ставить мед — безкоштовно, як і обіцяв: «До кінця віку, памʼятаєте?»' });
  }

  function step(E) {
    const g = E.G, b = g && g.bd; if (!b || b.end) return;
    const t0 = now(); if (!BD.fast && t0 < BD.at) return;
    if (b.q.length) return;
    if (b.fin) { const v = b.fin; b.fin = null; finale(E, v); return; }
    if (b.start) { const s = b.start; b.start = null; if (!startCk(E, s)) { push(E, 'Ніхто в групі цього не вміє.'); if (s.o && b.ch && src(b, s).end) b.ch.close = 1; } return; }
    if (b.pend) {
      if (b.pend.type === 'ck') {
        if (!g.ck) { b.pend = null; return; }
        if (!g.ck.done) return;
        if (!BD.fast && !BD.ckAt) { BD.ckAt = t0 + 1300; return; }
        if (!BD.fast && t0 < BD.ckAt) return;
        BD.ckAt = 0; resolveCk(E); return;
      }
      if (b.pend.type === 'fight') {
        const cb = g.cb; if (!cb) { b.pend = null; return; }
        if (!(cb.won || cb.lost)) return;
        if (!BD.fast && !BD.fightAt) { BD.fightAt = t0 + 2200; return; }
        if (!BD.fast && t0 < BD.fightAt) return;
        BD.fightAt = 0;
        const won = cb.won, win = b.pend.win;
        E.apply({ t: 'fightend' }, null, true);
        b.pend = null;
        if (won) push(E, '🏆 ' + (win || 'Перемога!'));
        else {
          for (const k in g.chars) { const ch = g.chars[k]; ch.dead = false; if (ch.hp <= 0) { ch.hp = 1; ch.ds = { s: 0, f: 0 }; ch.stable = false; } }
          push(E, 'Темрява… Ви приходите до тями — Ерандур витягнув вас із бою й перевʼязав рани. Вороги відступили. Але час втрачено.', 'Поразка в DnD — не обовʼязково кінець гри. Майстер може продовжити історію з ціною.');
        }
        return;
      }
    }
    const list = beats(b.sc);
    if (b.ch) { // хаб: закрити, коли варіант із end, умова until або нічого не лишилось
      const st = list[b.i];
      if (b.ch.close || (st.until && st.until(b.flags, b.ch.n, g)) || (!visible(st, b, g).length && !doneOk(st, b, g))) { b.ch = null; b.i++; E.dirty = true; }
      return;
    }
    if (b.i >= list.length) { b.i = 0; b.sc = Math.min(S.SCENES.length - 1, b.sc + 1); E.apply({ t: 'scene', sc: b.sc }, null, true); return; }
    const st = list[b.i], s = { sc: b.sc, i: b.i, o: null };
    if (st.if && !st.if(b.flags, g)) { b.i++; E.dirty = true; return; }
    BD.at = t0 + 300;
    if (st.read) { const sc = S.SCENES[b.sc]; push(E, (st.read === 'all' ? sc.read : st.read.map((i) => sc.read[i])).map((t) => ({ t, read: 1 }))); }
    if (st.say) push(E, norm(st.say, st.sp), st.tip);
    eff(E, st, '');
    if (st.hub) { b.ch = { picked: [], n: 0 }; E.dirty = true; return; }
    b.i++;
    if (st.ck) b.start = s;
    else if (st.fight) { E.apply({ t: 'fight', f: st.fight, surp: st.surp ? st.surp(b.flags) : '' }, null, true); if (g.cb) g.cb.auto = true; b.pend = { type: 'fight', win: st.win || '' }; }
    else if (st.rest) { E.apply({ t: 'rest', kind: st.rest }, null, true); push(E, '☕ Ви сідаєте перепочити на годину. Кожен кидає кістку хітів і трохи лікується.', 'Короткий відпочинок — 1 година. Довгий — 8 годин, відновлює все.'); }
    else if (st.passive) {
      const ks = Object.keys(g.chars).filter((k) => !g.chars[k].dead).sort((a, c) => E.passive(g.chars[c]) - E.passive(g.chars[a])), top = ks[0], pv = top ? E.passive(g.chars[top]) : 0;
      b.flags.t_perc = pv >= st.passive;
      E.apply({ t: 'teach', k: 'passive' }, null, true);
      push(E, b.flags.t_perc ? g.chars[top].n + ' помічає: одна плита підлоги трохи вища за інші, і навколо неї чисто від пилу.' : 'Звичайний коридор. Ніхто нічого не помітив.',
        'Я не просив кидати — інакше ви б здогадались, що тут щось є. Подивився на пасивне сприйняття: найвище в групі ' + pv + (b.flags.t_perc ? ' ≥ ' : ' < ') + st.passive + '.');
    } else if (st.next) b.i = list.length;
    else if (st.end) { b.end = true; push(E, 'Кінець пригоди! Ти щойно зіграв свою першу пригоду в DnD: перевірки, рятівні кидки, бої і вибір, який ніхто не робив за тебе.', 'Тепер спробуй бути майстром для друзів — у цій же грі є режим майстра з підказками.'); }
    E.dirty = true;
  }
  const visible = (st, b, g) => st.opts.filter((o) => !b.ch.picked.includes(o.id) && (!o.req || o.req(b.flags, g)));
  const doneOk = (st, b, g) => !!st.done && (!st.doneReq || st.doneReq(b.flags, g));

  function op(E, o) {
    const g = E.G, b = g && g.bd; if (!b) return;
    if (o.t === 'dmnext') {
      if (!b.q.length) return;
      b.q.shift(); BD.at = 0;
      if (!b.q.length && g.ck && g.ck.done && !b.pend) E.apply({ t: 'ckclose' }, null, true);
    } else if (o.t === 'dmpick') {
      if (!b.ch || b.q.length || b.pend || b.start) return;
      const st = beats(b.sc)[b.i], opt = st && st.opts && st.opts.find((x) => x.id === o.o);
      if (!opt || !visible(st, b, g).includes(opt)) return;
      b.ch.picked.push(opt.id); if (!opt.free) b.ch.n++;
      E.log('🧝 ' + g.chars[b.me].n + ': ' + opt.t, 'sys');
      eff(E, opt, '');
      if (opt.say) push(E, norm(opt.say, opt.sp), opt.ck ? '' : opt.tip);
      if (opt.noroll) push(E, opt.noroll, opt.tip);
      if (opt.ck) b.start = { sc: b.sc, i: b.i, o: opt.id };
      else { if (opt.fin) b.fin = fn(opt.fin, b.flags, g); if (opt.end) b.ch.close = 1; }
    } else if (o.t === 'dmdone') {
      if (!b.ch || b.q.length || b.pend || b.start) return;
      const st = beats(b.sc)[b.i]; if (!doneOk(st, b, g)) return;
      b.ch = null; b.i++;
    }
    E.dirty = true;
  }

  /* що показати гравцю зараз */
  function view(g) {
    const b = g && g.bd; if (!b) return null;
    if (b.q && b.q.length) { const m = b.q[0]; return { k: 'msg', t: m.t, tip: m.tip, read: m.read, sp: m.sp, ic: NPC[m.sp] || '🗣️', more: b.q.length - 1 }; }
    if (b.end) return { k: 'end' };
    if (b.pend && b.pend.type === 'ck') return { k: 'ck' };
    if (b.pend && b.pend.type === 'fight') return { k: 'fight' };
    if (b.ch) {
      const st = beats(b.sc)[b.i]; if (!st || !st.opts) return null;
      return { k: 'choice', ask: st.ask || 'Що робиш?', done: doneOk(st, b, g) ? st.done : '', opts: visible(st, b, g).map((o) => ({ i: o.id, t: o.t, ck: !!o.ck, nr: !!o.noroll })),
        used: st.opts.filter((o) => b.ch.picked.includes(o.id)).map((o) => o.t) };
    }
    return { k: 'wait' };
  }

  window.DNDBotDM = { init, step, op, view, BD, SCRIPT, beats, NPC };
})();
