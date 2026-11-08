/* Кошмар наяву — бот-майстер для соло-гри: веде пригоду за сценарієм.
   Читає сцени, дає вибір дій (як «що ти робиш?»), сам обирає перевірку й пояснює чому,
   розповідає наслідки, веде бої. Працює на телефоні гравця поверх рушія (engine.js).
   Стан — у G.bd (серіалізується), сценарій — тут, у коді. */
(function () {
  const S = window.DND_STORY, R = window.DND;
  const CK = (id) => S.SCENES.flatMap((s) => s.checks).find((c) => c.id === id);
  const hasThief = (g) => Object.values(g.chars).some((c) => !c.dead && R.CLASSES[c.cls].skills.includes('thieves'));

  /* who: me — твій герой, best — хто найкраще вміє, all — кожен, group — групова, thief — у кого є відмички */
  const SCRIPT = {
    intro: [
      { say: 'read' },
      { say: 'Я — бот-майстер. Описую світ і граю всіх, кого ви зустрінете. Ти вирішуєш, що робить твій герой: я даватиму варіанти, а кубик кидатимеш тапом.', tip: 'У справжній грі варіантів немає — гравець каже словами що завгодно. Тут вони, щоб показати, як майстер перетворює дію на перевірку.' },
      { next: 1 },
    ],
    dawnstar: [
      { say: 'read' },
      { choice: [
        { t: 'Придивитись до Ерандура: чи він щось недоговорює?', ck: 'd_insight' },
        { t: 'Згадати, хто така Ваерміна', ck: 'd_relig', who: 'best' },
        { t: 'Зрозуміти, чари це чи хвороба', ck: 'd_arcana', who: 'best' },
        { t: 'Вмовити корчмаря Торінга розповісти більше', ck: 'd_persu' },
        { t: 'Натиснути на Ерандура, щоб розповів усе', ck: 'd_intim' },
        { t: 'Оглянути виснаженого шахтаря', ck: 'd_med', who: 'best' },
        { t: 'Попросити ярла дати 100 вояків', noroll: 'Кидка не буде. Ярл просто відмовить: у Данстарі немає 100 вояків, а чужинцям він би їх і не дав. Кубик вирішує лише те, що могло б статись — навіть натуральна 20 не робить неможливе можливим.', lesson: 'noroll' },
      ], multi: 1, ask: 'Що робить твій герой у корчмі? Можна кілька речей.', done: 'Погодитись іти з Ерандуром' },
      { say: 'Ерандур підводиться: «Храм Нічного Поклику — на скелі над містом. Ходімо, поки світло».' },
      { next: 1 },
    ],
    road: [
      { say: 'read' },
      { say: 'Хтось має вести групу засніженою стежкою. Найкраще в горах орієнтується той, у кого найвища Виживання.' },
      { ck: 'r_surv', who: 'best' },
      { ck: 'r_cold', who: 'all', if: (f) => f.r_surv === false },
      { choice: [
        { t: 'Залізти вгору (Атлетика — Сила)', ck: 'r_climb' },
        { t: 'Пробігти по краю льоду (Акробатика — Спритність)', ck: 'r_acro' },
        { t: 'Почекати, поки інші скинуть мотузку', noroll: 'Можна й так — без кидка. Хтось виліз, скинув мотузку, і ти піднімаєшся повільно, але безпечно. Не все в DnD вирішує кубик: розумне рішення теж працює.' },
      ], ask: 'Крижаний уступ перегороджує стежку. Як твій герой його долає? Одна перешкода — різні стати.' },
      { say: 'Між ялинами щось рухається. Усі кидають Сприйняття — це Мудрість: помітити, почути, вловити.' },
      { ck: 'r_wolf', who: 'all' },
      { fight: 'wolves', win: 'Останній вовк скавучить і тікає в ліс. Стежка вільна.' },
      { rest: 'short' },
      { say: 'Попереду, на краю скелі, чорніє вежа храму.' },
      { next: 1 },
    ],
    temple: [
      { say: 'read' },
      { passive: 13 },
      { choice: [
        { t: 'Роздивитись, як працює ця плита', ck: 't_inv' },
        { t: 'Просто обійти її вздовж стіни', noroll: 'Без кидка: ви обходите плиту. Обережність — теж рішення, і майстер не мусить просити кидок, якщо гравці діють розумно.' },
      ], ask: 'Плита в підлозі явно підозріла. Що робиш?', if: (f) => f.t_perc === true },
      { say: 'Хтось наступає на плиту — клац! Зі стін сиплеться фіолетовий пил.', if: (f) => f.t_perc === false },
      { ck: 't_disarm', who: 'thief', if: (f, g) => f.t_inv === true && hasThief(g) },
      { ck: 't_gas', who: 'all', if: (f) => f.t_perc === false || f.t_inv === false || f.t_disarm === false },
      { say: 'З глибини храму чути брязкіт зброї й крики. Якщо підкрастися тихо — нападете першими.' },
      { ck: 't_sneak', who: 'group' },
      { fight: 'hall', surp: (f) => (f.t_sneak ? 'foe' : ''), win: 'Зала стихла. Ерандур важко дихає, спираючись на булаву.' },
      { rest: 'short' },
      { choice: [
        { t: 'Відімкнути відмичками (Спритність)', ck: 't_lock', who: 'thief', if: (f, g) => hasThief(g) },
        { t: 'Виламати плечем (чиста Сила)', ck: 't_force', who: 'best' },
      ], ask: 'Двері бібліотеки замкнені. Як відчиняєте?' },
      { ck: 't_hist', who: 'best' },
      { say: 'Ерандур опускає очі: «Казимир — це я. Я втік, коли всі пили Ступор. Шістдесят років я молюся Марі, щоб спокутувати це».' },
      { ck: 't_ins' },
      { next: 1 },
    ],
    dream: [
      { say: 'read' },
      { say: 'Сон тягне в себе. Опирається не розум, а воля — тому рятівний кидок Мудрості.' },
      { ck: 'dr_will', who: 'all' },
      { choice: [
        { t: 'Збрехати: «Наказ Верена — до барʼєра!» (Обман)', ck: 'dr_lie' },
        { t: 'Зіграти роль жерця: заспівати гімн (Виступ)', ck: 'dr_perf' },
      ], ask: 'Жрець-привид заступає дорогу: «Брате, ти куди?» Що робиш? Обидва шляхи — Харизма, але різні навички.' },
      { ck: 'dr_arc', who: 'best' },
      { say: 'Барʼєр гуде й сліпить. Без розгадки доведеться пробувати навмання — це перешкода.', if: (f) => f.dr_arc === false, lesson: 'adv' },
      { ck: 'dr_words', who: 'best', adv: (f) => (f.dr_arc === false ? -1 : 0) },
      { next: 1 },
    ],
    shrine: [
      { say: 'read' },
      { fight: 'shrine', win: 'Торек падає. Над постаментом стихає фіолетове сяйво.' },
      { say: 'Тиша. І раптом голос — у тебе в голові, теплий і лагідний: «Він зрадник. Убий його — і жезл твій. Ніхто більше не зможе тобі нашкодити уві сні».' },
      { ck: 's_will' },
      { ck: 's_ins' },
      { choice: [
        { t: 'Дати Ерандуру знищити Череп', fin: 'a', say: 'Ти киваєш. Булава опускається — Череп розлітається фіолетовим пилом.' },
        { t: 'Переконати Ерандура віддати жезл (Переконання)', ck: 's_pers', fin: (f) => (f.s_pers ? 'b' : 'a') },
        { t: 'Зупинити його силою і забрати жезл', fin: 'b', say: 'Удар — і Ерандур падає. Жезл холодний і важкий. Десь далеко сміється Ваерміна.' },
      ], ask: 'Ерандур підносить булаву над Черепом. Що робиш? Правильної відповіді немає.' },
      { end: 1 },
    ],
  };

  const BD = { at: 0, fightAt: 0, fast: false };
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  function steps(sc) {
    const scene = S.SCENES[sc], out = [];
    for (const st of SCRIPT[scene.id] || []) if (st.say === 'read') scene.read.forEach((p) => out.push({ say: p, read: 1 })); else out.push(st);
    return out;
  }
  const ckDef = (c) => (c.sk ? { kind: 'sk', key: c.sk } : c.st ? { kind: 'st', key: c.st } : { kind: 'sv', key: c.sv });

  function init(E, me) {
    E.G.bd = { me, sc: 0, i: 0, flags: {}, msg: null, ch: null, pend: null, end: false };
    E.apply({ t: 'scene', sc: 0 }, null, true);
    E.dirty = true;
  }
  function say(E, t, tip, read) {
    E.G.bd.msg = { t, tip: tip || '', read: !!read };
    if (!read) E.log('🎲 Майстер: ' + t, 'sys');
    E.dirty = true;
  }
  function who(E, spec, def) {
    const g = E.G, me = g.bd.me, alive = Object.keys(g.chars).filter((k) => !g.chars[k].dead);
    const bonus = (k) => E.checkParts(g.chars[k], def).reduce((a, p) => a + p[1], 0);
    const best = () => alive.slice().sort((a, b) => bonus(b) - bonus(a) || (a === me ? -1 : 1))[0];
    if (spec === 'all' || spec === 'group') return alive;
    if (spec === 'best') return [best()];
    if (spec === 'thief') { const t = alive.filter((k) => R.CLASSES[g.chars[k].cls].skills.includes('thieves')); return t.length ? [t.includes(me) ? me : t[0]] : []; }
    return alive.includes(me) ? [me] : alive.length ? [best()] : [];
  }
  function startCk(E, id, spec, adv, fo) {
    const g = E.G, c = CK(id), def = ckDef(c), ks = who(E, spec || 'me', def);
    if (!ks.length || !c) return false;
    let why = c.why;
    if (spec === 'best' && ks[0] !== g.bd.me) why += ' Кидає ' + g.chars[ks[0]].n + ' — у нього(неї) це виходить найкраще.';
    E.apply({ t: 'ck', cfg: Object.assign({}, def, { dc: c.dc, t: c.t, why, show: true, adv: adv || 0, who: ks, mode: spec === 'group' ? 'group' : 'one', sid: id }) }, null, true);
    g.bd.pend = { type: 'ck', id, fo: fo || null };
    return true;
  }
  // наслідки, які бот рахує сам (у звичайній грі — майстер у вкладці «Гравці»)
  const COST = { r_cold: '3', r_climb: '1d4', r_acro: '1d4' };
  function resolveCk(E) {
    const g = E.G, b = g.bd, ck = g.ck, c = CK(b.pend.id);
    const okK = ck.who.filter((k) => ck.res[k].ok), badK = ck.who.filter((k) => !ck.res[k].ok);
    const ok = ck.mode === 'group' ? ck.gok : okK.length * 2 >= ck.who.length;
    b.flags[b.pend.id] = ok;
    const names = (ks) => ks.map((k) => g.chars[k].n).join(', ');
    let t;
    if (ck.mode === 'group') t = (ok ? '✔ Група впоралась (' : '✖ Група провалила (') + okK.length + ' з ' + ck.who.length + '). ' + (ok ? c.ok : c.fail);
    else if (ck.who.length > 1) t = (okK.length ? '✔ ' + names(okK) + ': ' + c.ok + ' ' : '') + (badK.length ? '✖ ' + names(badK) + ': ' + c.fail : '');
    else t = (ok ? '✔ Успіх. ' + c.ok : '✖ Провал. ' + c.fail);
    if (COST[b.pend.id] && badK.length) {
      const lost = [];
      for (const k of badK) { const d = COST[b.pend.id].includes('d') ? R.roll(COST[b.pend.id]).t : +COST[b.pend.id]; E.apply({ t: 'hp', k, d: -d }, null, true); lost.push(g.chars[k].n + ' −' + d); }
      t += ' (хіти: ' + lost.join(', ') + ')';
    }
    if (b.pend.id === 'dr_words' && !ok) { const lost = []; for (const k of Object.keys(g.chars)) { if (g.chars[k].dead) continue; const d = R.roll('1d4').t; E.apply({ t: 'hp', k, d: -d }, null, true); lost.push(g.chars[k].n + ' −' + d); } t += ' (' + lost.join(', ') + ')'; }
    const nat = ck.who.map((k) => ck.res[k].v);
    const tip = nat.includes(20) && ck.kind !== 'sv' ? 'Натуральна 20 — найкращий результат, але лише з того, що можливо в цій ситуації.' : (!ok && ck.mode !== 'group' ? 'Провал не зупиняє історію — він лише має ціну.' : '');
    const fo = b.pend.fo;
    b.pend = null;
    say(E, t, tip);
    if (fo) { const st = steps(b.sc)[fo.i], opt = st && st.choice[fo.o]; if (opt && opt.fin) b.finAfter = typeof opt.fin === 'function' ? opt.fin(b.flags) : opt.fin; }
  }

  function step(E) {
    const g = E.G, b = g && g.bd; if (!b || b.end) return;
    const t0 = now(); if (!BD.fast && t0 < BD.at) return;
    if (b.msg) return;
    if (b.finAfter) { const v = b.finAfter; b.finAfter = null; E.apply({ t: 'finale', v }, null, true); say(E, v === 'a' ? 'Ерандур опускає булаву на Череп. Фіолетовий дим розвіюється — і десь унизу, в Данстарі, люди вперше за тиждень засинають спокійно.' : 'Жезл «Череп порчі» тепер ваш. Ерандур мовчки дивиться вам услід. А в Данстарі досі не сплять…'); return; }
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
        if (!BD.fast && !BD.fightAt) { BD.fightAt = t0 + 1800; return; }
        if (!BD.fast && t0 < BD.fightAt) return;
        BD.fightAt = 0;
        const won = cb.won, win = b.pend.win;
        E.apply({ t: 'fightend' }, null, true);
        b.pend = null;
        if (won) say(E, '🏆 ' + (win || 'Перемога!'));
        else {
          for (const k in g.chars) { const ch = g.chars[k]; ch.dead = false; if (ch.hp <= 0) { ch.hp = 1; ch.ds = { s: 0, f: 0 }; ch.stable = false; } }
          say(E, 'Темрява… Ви приходите до тями — Ерандур витягнув вас із бою й перевʼязав рани. Вороги відступили. Але час втрачено.', 'Поразка в DnD — не обовʼязково кінець гри. Майстер може продовжити історію з ціною.');
        }
        return;
      }
    }
    if (b.ch) return;
    const list = steps(b.sc);
    if (b.i >= list.length) { b.i = 0; b.sc = Math.min(S.SCENES.length - 1, b.sc + 1); E.apply({ t: 'scene', sc: b.sc }, null, true); return; }
    const st = list[b.i];
    if (st.if && !st.if(b.flags, g)) { b.i++; E.dirty = true; return; }
    BD.at = t0 + 300;
    if (st.say) { b.i++; say(E, st.say, st.tip, st.read); if (st.lesson) E.apply({ t: 'teach', k: st.lesson }, null, true); }
    else if (st.ck) { b.i++; startCk(E, st.ck, st.who, typeof st.adv === 'function' ? st.adv(b.flags) : st.adv); }
    else if (st.choice) { b.ch = { picked: [] }; E.dirty = true; }
    else if (st.fight) {
      b.i++;
      E.apply({ t: 'fight', f: st.fight, surp: st.surp ? st.surp(b.flags) : '' }, null, true);
      if (g.cb) g.cb.auto = true;
      b.pend = { type: 'fight', win: st.win || '' };
    } else if (st.rest) { b.i++; E.apply({ t: 'rest', kind: st.rest }, null, true); say(E, '☕ Ви сідаєте перепочити на годину. Кожен кидає кістку хітів і трохи лікується.', 'Короткий відпочинок — 1 година. Довгий — 8 годин, відновлює все.'); }
    else if (st.passive) {
      b.i++;
      const ks = Object.keys(g.chars).filter((k) => !g.chars[k].dead), top = ks.sort((a, c2) => E.passive(g.chars[c2]) - E.passive(g.chars[a]))[0];
      const pv = top ? E.passive(g.chars[top]) : 0;
      b.flags.t_perc = pv >= st.passive;
      E.apply({ t: 'teach', k: 'passive' }, null, true);
      say(E, b.flags.t_perc ? g.chars[top].n + ' помічає: одна плита підлоги трохи вища за інші, і навколо неї чисто від пилу.' : 'Звичайний коридор. Ніхто нічого не помітив.',
        'Я не просив кидати — інакше ви б здогадались, що тут щось є. Подивився на пасивне сприйняття: найвище в групі ' + pv + (b.flags.t_perc ? ' ≥ ' : ' < ') + st.passive + '.');
    } else if (st.next) { b.i = list.length; E.dirty = true; }
    else if (st.end) { b.end = true; say(E, 'Кінець пригоди! Ти щойно зіграв свою першу кампанію в DnD: перевірки, рятівні кидки, бої і вибір, який ніхто не робив за тебе.', 'Тепер спробуй бути майстром для друзів — у цій же грі є режим майстра з підказками.'); }
    E.dirty = true;
  }

  function op(E, o) {
    const g = E.G, b = g && g.bd; if (!b) return;
    if (o.t === 'dmnext') {
      if (!b.msg) return;
      b.msg = null; BD.at = 0;
      if (g.ck && g.ck.done && !b.pend) E.apply({ t: 'ckclose' }, null, true);
    } else if (o.t === 'dmpick') {
      if (!b.ch || b.msg || b.pend) return;
      const st = steps(b.sc)[b.i], opt = st && st.choice && st.choice[o.o];
      if (!opt || b.ch.picked.includes(o.o) || (opt.if && !opt.if(b.flags, g))) return;
      b.ch.picked.push(o.o);
      const fo = { i: b.i, o: o.o };
      if (!st.multi) { b.ch = null; b.i++; }
      E.log('🧝 ' + g.chars[b.me].n + ': ' + opt.t, 'sys');
      if (opt.noroll) { say(E, opt.noroll); if (opt.lesson) E.apply({ t: 'teach', k: opt.lesson }, null, true); }
      else if (opt.ck) { if (!startCk(E, opt.ck, opt.who, 0, fo)) say(E, 'Ніхто в групі цього не вміє.'); }
      else if (opt.fin) { if (opt.say) say(E, opt.say); b.finAfter = typeof opt.fin === 'function' ? opt.fin(b.flags) : opt.fin; }
    } else if (o.t === 'dmdone') {
      if (!b.ch || b.msg || b.pend) return;
      b.ch = null; b.i++;
    }
    E.dirty = true;
  }

  /* що показати гравцю зараз */
  function view(g) {
    const b = g && g.bd; if (!b) return null;
    if (b.msg) return { k: 'msg', t: b.msg.t, tip: b.msg.tip, read: b.msg.read };
    if (b.end) return { k: 'end' };
    if (b.pend && b.pend.type === 'ck') return { k: 'ck' };
    if (b.pend && b.pend.type === 'fight') return { k: 'fight' };
    if (b.ch) {
      const st = steps(b.sc)[b.i]; if (!st || !st.choice) return null;
      return { k: 'choice', ask: st.ask || 'Що робиш?', multi: !!st.multi, done: st.done || 'Далі',
        opts: st.choice.map((o, i) => ({ i, t: o.t, used: b.ch.picked.includes(i), hide: o.if && !o.if(b.flags, g) })).filter((o) => !o.hide) };
    }
    return { k: 'wait' };
  }

  window.DNDBotDM = { init, step, op, view, BD, SCRIPT, steps };
})();
