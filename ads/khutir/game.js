/* Хутір — екран, жести, шторки, мережа. Логіка — у sim.js (KhutirSim). */
(function () {
  'use strict';
  const K = window.KhutirSim, B = K.B, RES = K.RES, N = K.N;
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

  // ================= стан =================
  let S = null, view = null, viewAt = 0;       // S — справжній стан; view — S, доведений до «зараз» (для показу)
  let mode = null, code = '', net = null, srvOff = 0, warp = 0;
  const me = { name: '', uid: '' };
  const now = () => Date.now() + (mode === 'shared' ? srvOff : 0) + warp;
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function nickFromSession() {
    try { const s = JSON.parse(ls.get('games41_session') || 'null'); if (s && s.username) return String(s.username).slice(0, 16); } catch (e) {}
    return '';
  }
  me.name = nickFromSession() || ls.get('khutir_nick') || '';

  function refreshView(force) {
    if (!S) return;
    const t = now();
    if (!S.t) K.advance(S, t); // новий хутір — годинник стартує зараз
    if (!force && t - viewAt < 250) return;
    view = K.advance(clone(S), t); viewAt = t;
    hud();
  }

  // ================= дії =================
  let busy = 0;
  function commit(a, okFx) {
    if (!S) return null;
    const t = now(), c = clone(S), r = K.act(c, a, t, me.name || 'Гість');
    if (!r.ok) { toast(r.err, true); sfx('err'); return r; }
    S = c; afterAct(r, a);
    if (mode === 'solo') saveSolo();
    else if (net) {
      busy++;
      net.ref.transaction((cur) => {
        if (cur === null) return null;
        let st; try { st = JSON.parse(cur); } catch (e) { return; }
        const rr = K.act(st, a, now(), me.name || 'Гість');
        if (!rr.ok) return; // хтось уже встиг — нічого не пишемо
        return JSON.stringify(st);
      }).then((res) => {
        busy--;
        if (res && !res.committed) toast('Хтось тебе випередив — оновлено', true);
      }, () => { busy--; toast('Немає звʼязку з хутором', true); });
    }
    return r;
  }
  function afterAct(r, a) {
    for (const f of r.fx || []) floatText(f[0], f[1], f[2]);
    if (a.t === 'collect' || a.t === 'collectAll') sfx('pick');
    else if (a.t === 'sell' || a.t === 'order') sfx('coin');
    else if (a.t === 'build' || a.t === 'upgrade' || a.t === 'chunk' || a.t === 'store') sfx('build');
    else if (a.t === 'clear') sfx('chop');
    if (r.lvUp) {
      const opened = K.ORDER.filter((k) => B[k].lv === r.lvUp).map((k) => B[k].ic + ' ' + B[k].n);
      say('Рівень ' + r.lvUp + '!', opened.length ? 'Відкрито: ' + opened.join(', ') : 'Нові замовлення стали більшими');
      sfx('lvl');
    }
    refreshView(true); if (sheetFn) sheetFn();
  }

  // ================= соло =================
  function saveSolo() { if (mode === 'solo' && S) ls.set('khutir_solo', JSON.stringify(S)); }
  setInterval(saveSolo, 10000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveSolo(); });
  function soloInfo() { try { const s = JSON.parse(ls.get('khutir_solo') || 'null'); return s ? s : null; } catch (e) { return null; } }

  function startSolo() {
    let s = soloInfo();
    if (!s) s = K.create((Math.random() * 2 ** 31) | 0, 'Мій хутір');
    mode = 'solo'; code = '';
    enter(s);
  }

  // що набігло, поки нікого не було
  function totals(s) { const o = {}; for (const r in s.st) o[r] = (o[r] || 0) + s.st[r]; for (const b of s.b) if (b.buf && B[b.k].out) o[B[b.k].out[0]] = (o[B[b.k].out[0]] || 0) + b.buf; return o; }
  function enter(s) {
    const before = totals(s), was = s.t;
    S = s; refreshView(true);
    const after = totals(view), gain = [];
    for (const r in after) { const d = after[r] - (before[r] || 0); if (d > 0) gain.push('+' + d + ' ' + RES[r].ic); }
    $('menu').hidden = true; ['hud', 'bar'].forEach((id) => ($(id).hidden = false));
    $('hOn').hidden = mode !== 'shared';
    centerCam();
    if (was && now() - was > 60e3 && gain.length) toast('Поки тебе не було: ' + gain.slice(0, 6).join('  '));
    if (mode === 'solo') saveSolo();
  }

  // ================= спільний хутір (RTDB khutir/<код>) =================
  const hasNet = !!(window.firebase && firebase.database && firebase.auth);
  function signedIn() {
    return new Promise((resolve) => {
      const auth = firebase.auth(), done = setTimeout(() => resolve(null), 8000);
      const off = auth.onAuthStateChanged((u) => {
        off();
        if (u) { clearTimeout(done); resolve(u); return; }
        auth.signInAnonymously().then((c) => { clearTimeout(done); resolve(c.user || auth.currentUser); }, () => { clearTimeout(done); resolve(null); });
      });
    });
  }
  const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const newCode = () => Array.from({ length: 6 }, () => CODE_ABC[Math.floor(Math.random() * CODE_ABC.length)]).join('');
  function farms() { try { return JSON.parse(ls.get('khutir_farms') || '[]'); } catch (e) { return []; } }
  function rememberFarm(c, n) { const f = farms().filter((x) => x.c !== c); f.unshift({ c, n }); ls.set('khutir_farms', JSON.stringify(f.slice(0, 8))); }
  function forgetFarm(c) { ls.set('khutir_farms', JSON.stringify(farms().filter((x) => x.c !== c))); }

  async function openShared(c, createName) {
    $('mErr').textContent = '';
    if (!hasNet) { $('mErr').textContent = 'Немає звʼязку'; return; }
    if (!me.name) { $('mErr').textContent = 'Впиши своє імʼя'; $('mNick').focus(); return; }
    const u = await signedIn();
    if (!u) { $('mErr').textContent = 'Не вдалося підʼєднатися. Перевір інтернет.'; return; }
    me.uid = u.uid;
    const db = firebase.database();
    db.ref('.info/serverTimeOffset').on('value', (v) => { srvOff = v.val() || 0; });
    if (createName) {
      for (let i = 0; i < 5 && !c; i++) {
        const cand = newCode();
        const res = await db.ref('khutir/' + cand + '/s').transaction((cur) => (cur ? undefined : JSON.stringify(K.advance(K.create((Math.random() * 2 ** 31) | 0, createName), now() + srvOff))));
        if (res.committed) c = cand;
      }
      if (!c) { $('mErr').textContent = 'Не вийшло створити, спробуй ще'; return; }
    }
    const ref = db.ref('khutir/' + c + '/s');
    const first = (await ref.once('value')).val();
    if (typeof first !== 'string') { $('mErr').textContent = 'Хутора з кодом ' + c + ' нема'; forgetFarm(c); drawFarms(); return; }
    if (net) net.leave();
    const onRef = db.ref('khutir/' + c + '/on'), meRef = onRef.child(u.uid);
    let online = [];
    const onVal = (snap) => { const v = snap.val() || {}; online = Object.keys(v).map((k) => v[k] && v[k].n).filter(Boolean); $('hOnN').textContent = online.length || 1; };
    onRef.on('value', onVal);
    meRef.onDisconnect().remove(); meRef.set({ n: me.name, t: firebase.database.ServerValue.TIMESTAMP });
    let entered = false;
    const onState = (snap) => {
      const v = snap.val(); if (typeof v !== 'string') return;
      try { S = JSON.parse(v); } catch (e) { return; }
      if (!entered) { entered = true; enter(S); }
      rememberFarm(c, S.nm); refreshView(true); if (sheetFn) sheetFn();
    };
    ref.on('value', onState);
    net = { ref, online: () => online, leave() { ref.off('value', onState); onRef.off('value', onVal); meRef.onDisconnect().cancel(); meRef.remove().catch(() => {}); } };
    mode = 'shared'; code = c;
  }

  // ================= меню =================
  function drawFarms() {
    const box = $('mFarms'), list = farms();
    box.innerHTML = list.map((f) => '<button class="row" data-c="' + esc(f.c) + '"><span class="ic">👥</span><span class="tx"><b>' + esc(f.n || 'Хутір') + '</b><small>код ' + esc(f.c) + '</small></span><span class="pr">→</span></button>').join('');
    box.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => { saveNick(); openShared(b.dataset.c); }));
  }
  function saveNick() { const v = ($('mNick').value || '').trim().slice(0, 16); if (v) { me.name = v; ls.set('khutir_nick', v); } }
  function showMenu() {
    if (net) { net.leave(); net = null; }
    if (mode === 'solo') saveSolo();
    mode = null; S = null; view = null; closeSheet(); cancelPlace();
    $('menu').hidden = false; ['hud', 'bar', 'tip'].forEach((id) => ($(id).hidden = true));
    const s = soloInfo();
    $('mSoloI').textContent = s ? 'рівень ' + s.lv + ' · ' + s.b.length + ' будівель' : 'почати з одного поля';
    $('mNick').value = me.name; $('mNick').parentElement.hidden = !!nickFromSession();
    $('mNet').hidden = !hasNet; $('mOff').hidden = hasNet; $('mFarms').hidden = !hasNet;
    drawFarms();
  }
  $('mSolo').addEventListener('click', () => { au(); startSolo(); });
  $('mNew').addEventListener('click', () => { au(); saveNick(); openShared('', 'Хутір ' + (me.name || '')); });
  $('mJoin').addEventListener('click', () => { au(); saveNick(); const c = ($('mCode').value || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); if (c.length < 4) { $('mErr').textContent = 'Впиши код хутора'; return; } openShared(c); });
  $('mCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('mJoin').click(); });
  // посилання ?farm=КОД — одразу в спільний хутір
  const qCode = (new URLSearchParams(location.search).get('farm') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  // ================= HUD =================
  let lastCoins = -1;
  function hud() {
    const s = view; if (!s) return;
    $('hNameT').textContent = (mode === 'shared' ? '👥 ' : '🏡 ') + s.nm;
    if (s.coins !== lastCoins) { $('hCoins').textContent = '💰 ' + fmt(s.coins); lastCoins = s.coins; }
    $('hLvlN').textContent = s.lv; $('hLvlBar').style.setProperty('--w', Math.min(100, (100 * s.xp) / K.xpNeed(s.lv)) + '%');
    let ready = 0; for (const b of s.b) if (b.buf && !b.h) ready++;
    $('dAll').hidden = !ready; $('dAll').textContent = ready;
    let can = 0; for (const o of s.o) if (o.w <= now() && o.it.every(([r, n]) => (s.st[r] || 0) >= n)) can++;
    $('dOrders').hidden = !can; $('dOrders').textContent = can;
    tipLine();
  }
  const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : String(Math.round(n)));
  function tipLine() {
    const s = view, el = $('tip');
    let t = '';
    if (placing) t = '';
    else if (s.lv <= 2) {
      const ready = s.b.some((b) => b.buf);
      if (!s.made && !ready) t = '🌾 Поле росте. Коли над ним зʼявиться колосок — торкнись';
      else if (!s.made && ready) t = '👆 Торкнись поля, щоб зібрати пшеницю';
      else if (!K.count(s, 'coop')) t = '🏗 Збудуй курник: він робить яйця з пшениці';
      else if (s.lv === 1) t = '📋 Замовлення платять більше, ніж ярмарок у коморі';
      else if (!K.count(s, 'mill')) t = '⭐ Рівень 2: відкрито млин і лісоруба';
    }
    el.hidden = !t; el.textContent = t;
  }

  // ================= шторки =================
  let sheetFn = null, sheetAt = 0;
  // той самий дотик, що відкрив шторку, не має натиснути кнопку в ній
  const fresh = () => performance.now() - sheetAt < 300;
  function openSheet(title, render) {
    $('shT').textContent = title; sheetFn = () => { if (view) $('shB').innerHTML = render(); bindSheet(); };
    refreshView(true); sheetFn(); $('sheet').classList.add('open'); sheetAt = performance.now();
  }
  function closeSheet() { $('sheet').classList.remove('open'); sheetFn = null; sel = null; buildAt = null; }
  $('shX').addEventListener('click', closeSheet);
  // кнопки в шторці: data-a='{"t":"…"}' — дія; data-go — перехід
  function bindSheet() {
    $('shB').querySelectorAll('[data-a]').forEach((el) => el.addEventListener('click', () => {
      if (fresh()) return;
      au(); const a = JSON.parse(el.dataset.a);
      if (a.t === 'demolish' && el.dataset.sure !== '1') { el.dataset.sure = '1'; el.innerHTML = 'Точно знести?<small>повернеться половина ціни</small>'; return; }
      const r = commit(a);
      if (r && r.ok && (a.t === 'demolish' || a.t === 'build')) closeSheet();
      if (r && r.ok && a.t === 'chunk') closeSheet();
      if (r && r.ok && a.t === 'clear') closeSheet();
    }));
    $('shB').querySelectorAll('[data-place]').forEach((el) => el.addEventListener('click', () => { if (fresh()) return; au(); startPlace(el.dataset.place); }));
    $('shB').querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', () => { if (fresh()) return; au(); go(el.dataset.go); }));
  }
  const A = (o) => esc(JSON.stringify(o));
  const items = (list, s, need) => list.map(([r, n]) => '<span class="it' + (need ? ((s.st[r] || 0) >= n ? ' ok' : ' no') : '') + '">' + RES[r].ic + ' ' + (need ? Math.min(s.st[r] || 0, n) + '/' : '') + n + '</span>').join('');
  const secs = (ms) => { const s = Math.ceil(ms / 1000); return s >= 60 ? Math.floor(s / 60) + ' хв' + (s % 60 ? ' ' + (s % 60) + ' с' : '') : s + ' с'; };
  const costTxt = (c) => (c.c ? fmt(c.c) + ' 💰' : '') + (c.pl ? ' · ' + c.pl + ' 🪚' : '');
  const recipe = (d) => (d.in ? items(d.in) + ' → ' : '') + (d.out ? '<span class="it">' + RES[d.out[0]].ic + ' ' + d.out[1] + '</span>' : '');

  function go(what) {
    if (what === 'build') openSheet('🏗 Будувати', buildSheet);
    else if (what === 'store') openSheet('📦 Комора', storeSheet);
    else if (what === 'orders') openSheet('📋 Замовлення', ordersSheet);
    else if (what === 'farm') openSheet(mode === 'shared' ? '👥 Спільний хутір' : '🏡 Мій хутір', farmSheet);
    else if (what === 'level') openSheet('⭐ Рівень ' + view.lv, levelSheet);
  }
  $('bBuild').addEventListener('click', () => { au(); cancelPlace(); buildAt = null; sel = null; go('build'); });
  $('bStore').addEventListener('click', () => { au(); go('store'); });
  $('bOrders').addEventListener('click', () => { au(); go('orders'); });
  $('bAll').addEventListener('click', () => { au(); commit({ t: 'collectAll' }); });
  $('hName').addEventListener('click', () => { au(); go('farm'); });
  $('hOn').addEventListener('click', () => { au(); go('farm'); });
  $('hLvl').addEventListener('click', () => { au(); go('level'); });

  let buildAt = null; // клітинка, на яку торкнулися перед «Будувати»
  function buildSheet() {
    const s = view;
    let h = buildAt ? '<p class="note">Будуємо на вибраній клітинці.</p>' : '<p class="note">Обери будівлю, потім — вільну клітинку на своїй землі.</p>';
    for (const k of K.ORDER) {
      const d = B[k], lock = s.lv < d.lv, c = K.buildCost(s, k), ok = !lock && K.canAfford(s, c);
      const info = d.d ? recipe(d) + ' · ' + d.d + ' с' : esc(d.hint || '');
      h += '<button class="row' + (ok ? '' : ' off') + '" ' + (lock ? 'disabled' : buildAt ? 'data-a="' + A({ t: 'build', k, x: buildAt[0], y: buildAt[1] }) + '"' : 'data-place="' + k + '"') + '><span class="ic">' + d.ic + '</span><span class="tx"><b>' + d.n + '</b><small>' + (lock ? '🔒 з ' + d.lv + ' рівня' : info) + '</small></span><span class="pr">' + (lock ? '' : costTxt(c)) + '</span></button>';
    }
    return h;
  }
  let sel = null; // id вибраної будівлі
  function bSheet() {
    const s = view, b = s.b.find((q) => q.id === sel);
    if (!b) { setTimeout(closeSheet); return ''; }
    const d = B[b.k];
    let h = '';
    if (!d.d) return '<p class="note">' + esc(d.hint || '') + '</p><div class="btns"><button class="btn red" data-a="' + A({ t: 'demolish', id: b.id }) + '">🗑 Знести<small>повернеться половина ціни</small></button></div>';
    const bon = K.bonuses(s).get(b.id) || 0, dur = K.durOf(b, K.bonuses(s)), cap = K.capOf(b), w = K.why(s, b);
    h += '<div class="row"><span class="ic">' + d.ic + '</span><span class="tx"><b>' + recipe(d) + '</b><small>цикл ' + secs(dur) + (bon ? ' · бонус сусідів +' + Math.round(bon * 100) + '%' : '') + (b.h ? ' · 🧑‍🌾 наймит збирає сам' : '') + '</small></span></div>';
    const st = b.p >= 0 ? '⏳ працює: ' + Math.floor((100 * b.p) / dur) + '%' : w === 'full' ? '✋ повно — збери' : w ? '💤 чекає: нема ' + RES[w].ic + ' ' + RES[w].n.toLowerCase() : '';
    h += '<div class="row"><span class="tx"><b>Готово: ' + b.buf + ' / ' + cap + ' ' + RES[d.out[0]].ic + '</b><small>' + st + '</small><span class="cap"><i class="' + (b.buf >= cap ? 'full' : '') + '" style="width:' + Math.min(100, (100 * b.buf) / cap) + '%"></i></span></span></div>';
    const uc = K.upCost(b), hc = K.hireCost(b);
    h += '<div class="btns">';
    if (b.buf) h += '<button class="btn" data-a="' + A({ t: 'collect', id: b.id }) + '">🧺 Зібрати ' + b.buf + ' ' + RES[d.out[0]].ic + '</button>';
    h += '<button class="btn' + (b.buf ? ' sec' : '') + '" data-a="' + A({ t: 'upgrade', id: b.id }) + '"' + (K.canAfford(s, uc) ? '' : ' disabled') + '>⬆ Рівень ' + (b.lv + 1) + '<small>' + costTxt(uc) + ' · швидше й більше місця</small></button>';
    if (!b.h) h += '<button class="btn sec" data-a="' + A({ t: 'hire', id: b.id }) + '"' + (s.lv >= 3 && K.canAfford(s, hc) ? '' : ' disabled') + '>🧑‍🌾 Наймит<small>' + (s.lv < 3 ? 'з 3 рівня' : costTxt(hc) + ' · сам носить у комору') + '</small></button>';
    h += '<button class="btn red" data-a="' + A({ t: 'demolish', id: b.id }) + '">🗑 Знести<small>повернеться половина ціни</small></button>';
    return h + '</div>';
  }
  function storeSheet() {
    const s = view, cap = K.storeCap(s), sc = K.storeCost(s);
    let h = '<div class="row"><span class="ic">📦</span><span class="tx"><b>Місця: по ' + cap + ' кожного</b><small>Повна комора — будівлі стоять. Продавай або розширюй.</small></span></div>';
    h += '<div class="btns"><button class="btn sec" data-a="' + A({ t: 'store' }) + '"' + (K.canAfford(s, sc) ? '' : ' disabled') + '>Розширити до ' + Math.round(cap * 1.5) + '<small>' + costTxt(sc) + '</small></button></div>';
    const list = Object.keys(RES).filter((r) => s.st[r] > 0);
    if (!list.length) h += '<p class="note">Поки порожньо. Збирай урожай із будівель.</p>';
    for (const r of list) {
      const n = s.st[r], p = RES[r].p;
      h += '<div class="row"><span class="ic">' + RES[r].ic + '</span><span class="tx"><b>' + RES[r].n + ': ' + n + '</b><small>на ярмарку ' + p + ' 💰 за шт.</small><span class="cap"><i class="' + (n >= cap ? 'full' : '') + '" style="width:' + Math.min(100, (100 * n) / cap) + '%"></i></span></span>' +
        '<button class="sell" data-a="' + A({ t: 'sell', r, n: 1 }) + '">−1 +' + p + '</button><button class="sell" data-a="' + A({ t: 'sell', r, n: Math.ceil(n / 2) }) + '"' + (n > 1 ? '' : ' disabled') + '>½ +' + Math.ceil(n / 2) * p + '</button></div>';
    }
    return h;
  }
  function ordersSheet() {
    const s = view, t = now();
    let h = '<p class="note">Замовлення платять в 1,5 раза більше за ярмарок і дають ⭐ досвід. Нові приходять одразу.</p>';
    s.o.forEach((o, i) => {
      if (o.w > t) { h += '<div class="row off"><span class="ic">🛒</span><span class="tx"><b>Новий замовник у дорозі</b><small>ще ' + secs(o.w - t) + '</small></span></div>'; return; }
      const ok = o.it.every(([r, n]) => (s.st[r] || 0) >= n);
      h += '<div class="row" style="flex-wrap:wrap"><span class="ic">🛒</span><span class="tx"><b>' + items(o.it, s, true) + '</b><small>нагорода: ' + o.c + ' 💰 · ' + o.xp + ' ⭐</small></span>' +
        '<span class="btns" style="flex:1 1 100%"><button class="btn" data-a="' + A({ t: 'order', i }) + '"' + (ok ? '' : ' disabled') + '>Віддати</button><button class="btn sec" style="flex:0 1 120px" data-a="' + A({ t: 'skip', i }) + '">Пропустити</button></span></div>';
    });
    return h;
  }
  function levelSheet() {
    const s = view, next = K.ORDER.filter((k) => B[k].lv > s.lv).slice(0, 3);
    let h = '<div class="row"><span class="ic">⭐</span><span class="tx"><b>' + s.xp + ' / ' + K.xpNeed(s.lv) + ' досвіду</b><small>Досвід — за замовлення, будівництво, покращення, нову землю.</small><span class="cap"><i style="width:' + (100 * s.xp) / K.xpNeed(s.lv) + '%"></i></span></span></div>';
    for (const k of next) h += '<div class="row off"><span class="ic">' + B[k].ic + '</span><span class="tx"><b>' + B[k].n + '</b><small>на ' + B[k].lv + ' рівні</small></span></div>';
    if (!next.length) h += '<p class="note">Усі будівлі відкрито. Далі — більші замовлення, нова земля й покращення без межі.</p>';
    h += '<p class="note">З 6 рівня — 4-те місце для замовлень, з 12 — 5-те.</p>';
    return h;
  }
  function farmSheet() {
    const s = view;
    let h = '';
    if (mode === 'shared') {
      const link = location.origin + location.pathname + '?farm=' + code;
      h += '<div class="row"><span class="ic">🔑</span><span class="tx"><b>Код: ' + esc(code) + '</b><small>Дай друзям — і хутір у вас спільний</small></span><button class="sell" id="shareB">Поділитися</button></div>';
      h += '<div class="row"><span class="ic">👥</span><span class="tx"><b>Зараз тут</b><small>' + esc((net ? net.online() : []).join(', ') || me.name) + '</small></span></div>';
      const pc = Object.entries(s.pc || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
      if (pc.length) h += '<div class="row"><span class="ic">🏆</span><span class="tx"><b>Хто скільки заробив</b><small>' + pc.map(([n, c]) => esc(n) + ' ' + fmt(c) + ' 💰').join(' · ') + '</small></span></div>';
      if (s.lg && s.lg.length) h += '<div class="row"><span class="ic">📰</span><span class="tx"><b>Що нового</b><small>' + s.lg.slice(-8).reverse().map((l) => '<b>' + esc(l[1]) + '</b> ' + esc(l[2]) + ' · ' + ago(l[0])).join('<br>') + '</small></span></div>';
      h += '<span hidden id="shareL">' + esc(link) + '</span>';
    }
    h += '<div class="row"><span class="ic">📊</span><span class="tx"><b>Рівень ' + s.lv + ' · ' + s.b.length + ' будівель · ' + s.ch.length * 16 + ' клітинок землі</b><small>Усього вироблено: ' + fmt(s.made) + '</small></span></div>';
    h += '<div class="inp"><input id="renameI" maxlength="24" value="' + esc(s.nm) + '" aria-label="Назва хутора"><button class="btn sec" id="renameB">Назвати</button></div>';
    h += '<div class="btns"><button class="btn sec" id="muteB">' + (muted ? '🔇 Звук вимкнено' : '🔊 Звук увімкнено') + '</button><button class="btn sec" id="exitB">↩ До меню</button></div>';
    setTimeout(() => {
      const sb = $('shareB'); if (sb) sb.onclick = () => { const link = $('shareL').textContent; if (navigator.share) navigator.share({ title: 'Хутір', text: 'Заходь на наш хутір! Код ' + code, url: link }).catch(() => {}); else { try { navigator.clipboard.writeText(link); toast('Посилання скопійовано'); } catch (e) { toast(link); } } };
      $('renameB').onclick = () => commit({ t: 'rename', nm: $('renameI').value });
      $('muteB').onclick = () => { muted = !muted; ls.set('khutir_mute', muted ? '1' : '0'); sheetFn && sheetFn(); };
      $('exitB').onclick = showMenu;
    });
    return h;
  }
  const ago = (t) => { const m = Math.round((now() - t) / 60000); return m < 1 ? 'щойно' : m < 60 ? m + ' хв тому' : m < 1440 ? Math.round(m / 60) + ' год тому' : Math.round(m / 1440) + ' дн тому'; };

  // ================= розміщення будівлі =================
  let placing = null;
  function startPlace(k) { closeSheet(); placing = k; $('place').hidden = false; $('placeT').textContent = 'Куди поставити ' + B[k].ic + ' ' + B[k].n + '?'; $('tip').hidden = true; }
  function cancelPlace() { placing = null; $('place').hidden = true; }
  $('placeX').addEventListener('click', cancelPlace);
  const free = (s, x, y) => K.owned(s, x, y) && !K.at(s, x, y) && !s.ob[K.idx(x, y)];

  // ================= торкання карти =================
  function tapTile(x, y) {
    const s = view; if (!s) return;
    if (x < 0 || y < 0 || x >= N || y >= N) { closeSheet(); return; }
    if (placing) {
      if (!free(s, x, y)) { toast(K.owned(s, x, y) ? 'Тут зайнято' : 'Це не твоя земля', true); return; }
      const r = commit({ t: 'build', k: placing, x, y });
      if (r && r.ok) { const k = placing; cancelPlace(); if (K.canAfford(view, K.buildCost(view, k)) && B[k].kind === 'field') toast('Ще поле? 🏗 → Поле'); }
      return;
    }
    const b = K.at(s, x, y);
    if (b) {
      if (b.buf && !b.h && !sheetFn) { const r = commit({ t: 'collect', id: b.id }); if (r && r.ok) return; }
      buildAt = null; sel = b.id; openSheet(B[b.k].ic + ' ' + B[b.k].n + (B[b.k].d ? ' · рів. ' + b.lv : ''), bSheet); return;
    }
    if (!K.owned(s, x, y)) {
      const c = K.chunkOf(x, y), cost = K.chunkCost(s);
      openSheet('🗺 Нова земля', () => '<p class="note">Ділянка 4×4. Купувати можна лише поруч зі своєю землею. Там можуть рости дерева (дають колоди) і лежати камені.</p><div class="btns"><button class="btn" data-a="' + A({ t: 'chunk', c }) + '"' + (K.canAfford(view, cost) ? '' : ' disabled') + '>Купити за ' + costTxt(K.chunkCost(view)) + '</button></div>');
      return;
    }
    const ob = s.ob[K.idx(x, y)];
    if (ob === 't') { closeSheet(); commit({ t: 'clear', x, y }); return; }
    if (ob === 'r') { openSheet('🪨 Камінь', () => '<p class="note">Заважає будувати. Прибрати коштує ' + K.ROCK + ' 💰.</p><div class="btns"><button class="btn" data-a="' + A({ t: 'clear', x, y }) + '"' + (view.coins >= K.ROCK ? '' : ' disabled') + '>Прибрати · ' + K.ROCK + ' 💰</button></div>'); return; }
    buildAt = [x, y]; sel = null; openSheet('🏗 Будувати тут', buildSheet);
  }

  // ================= малювання (ізометрія) =================
  const cv = $('cv'), g = cv.getContext('2d');
  const TW = 64, TH = 32;
  let W = 0, H = 0, DPR = 1;
  const cam = { x: 0, y: 0, z: 1 };
  function resize() { DPR = Math.min(2, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight; cv.width = W * DPR; cv.height = H * DPR; }
  addEventListener('resize', resize); resize();
  const wx = (x, y) => ((x - y) * TW) / 2, wy = (x, y) => ((x + y) * TH) / 2;
  const sx = (x, y) => (wx(x, y) - cam.x) * cam.z + W / 2, sy = (x, y) => (wy(x, y) - cam.y) * cam.z + H / 2;
  function pick(px, py) {
    const X = (px - W / 2) / cam.z + cam.x, Y = (py - H / 2) / cam.z + cam.y;
    const a = (2 * X) / TW, b = (2 * Y) / TH;
    return [Math.round((a + b) / 2), Math.round((b - a) / 2)];
  }
  function centerCam() {
    const s = view; if (!s) return;
    let ax = 0, ay = 0, n = 0;
    for (const c of s.ch) { const x = (c % K.NC) * K.CH + 1.5, y = Math.floor(c / K.NC) * K.CH + 1.5; ax += x; ay += y; n++; }
    ax /= n; ay /= n; cam.x = wx(ax, ay); cam.y = wy(ax, ay);
    cam.z = Math.max(0.8, Math.min(1.6, W / 400));
  }
  function clampCam() {
    cam.z = Math.max(0.45, Math.min(2.4, cam.z));
    cam.x = Math.max(-N * TW / 2, Math.min(N * TW / 2, cam.x));
    cam.y = Math.max(0, Math.min(N * TH, cam.y));
  }

  const h01 = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  function diamond(cx, cy, w, h) { g.beginPath(); g.moveTo(cx, cy - h / 2); g.lineTo(cx + w / 2, cy); g.lineTo(cx, cy + h / 2); g.lineTo(cx - w / 2, cy); g.closePath(); }
  function shade(hex, k) { const n = parseInt(hex.slice(1), 16); let r = n >> 16, gg = (n >> 8) & 255, b = n & 255; r = Math.round(r * k); gg = Math.round(gg * k); b = Math.round(b * k); return 'rgb(' + Math.min(255, r) + ',' + Math.min(255, gg) + ',' + Math.min(255, b) + ')'; }
  function emoji(t, x, y, size) { g.font = size + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, x, y); }

  function drawHouse(cx, cy, z, wall, roof, ic) {
    const w = TW * 0.72 * z, hh = TH * 0.72 * z, h = 20 * z, rh = 18 * z;
    const L = [cx - w / 2, cy], Bm = [cx, cy + hh / 2], R = [cx + w / 2, cy], T = [cx, cy - hh / 2];
    g.fillStyle = 'rgba(0,0,0,.18)'; diamond(cx + 4 * z, cy + 2 * z, w * 1.05, hh * 1.05); g.fill();
    g.fillStyle = shade(wall, 0.78); g.beginPath(); g.moveTo(L[0], L[1]); g.lineTo(Bm[0], Bm[1]); g.lineTo(Bm[0], Bm[1] - h); g.lineTo(L[0], L[1] - h); g.closePath(); g.fill();
    g.fillStyle = wall; g.beginPath(); g.moveTo(Bm[0], Bm[1]); g.lineTo(R[0], R[1]); g.lineTo(R[0], R[1] - h); g.lineTo(Bm[0], Bm[1] - h); g.closePath(); g.fill();
    // двері
    g.fillStyle = shade(roof, 0.6); const dx = (Bm[0] + R[0]) / 2, dy = (Bm[1] + R[1]) / 2; g.beginPath(); g.moveTo(dx - 4 * z, dy + 2 * z); g.lineTo(dx + 4 * z, dy - 2 * z); g.lineTo(dx + 4 * z, dy - 13 * z); g.lineTo(dx - 4 * z, dy - 9 * z); g.closePath(); g.fill();
    // дах-шатро
    const ax = cx, ay = cy - h - rh, e = 3 * z;
    g.fillStyle = shade(roof, 0.8); g.beginPath(); g.moveTo(ax, ay); g.lineTo(L[0] - e, L[1] - h + e * 0.3); g.lineTo(Bm[0], Bm[1] - h + e); g.closePath(); g.fill();
    g.fillStyle = roof; g.beginPath(); g.moveTo(ax, ay); g.lineTo(Bm[0], Bm[1] - h + e); g.lineTo(R[0] + e, R[1] - h + e * 0.3); g.closePath(); g.fill();
    if (ic) { g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc((L[0] + Bm[0]) / 2, (L[1] + Bm[1]) / 2 - h * 0.55, 8 * z, 0, 7); g.fill(); emoji(ic, (L[0] + Bm[0]) / 2, (L[1] + Bm[1]) / 2 - h * 0.55 + 0.5 * z, Math.round(11 * z)); }
  }
  function drawTree(cx, cy, z, k, apples) {
    g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.ellipse(cx + 3 * z, cy + 2 * z, 12 * z, 6 * z, 0, 0, 7); g.fill();
    g.fillStyle = '#6B4A2E'; g.fillRect(cx - 2 * z, cy - 14 * z, 4 * z, 14 * z);
    const c1 = k ? '#3E7D3A' : '#2F6B3A', c2 = k ? '#56A04A' : '#3F8A48';
    g.fillStyle = c1; g.beginPath(); g.arc(cx, cy - 20 * z, 11 * z, 0, 7); g.fill();
    g.fillStyle = c2; g.beginPath(); g.arc(cx - 3 * z, cy - 23 * z, 7 * z, 0, 7); g.fill();
    if (apples) { g.fillStyle = '#E53935'; for (let i = 0; i < apples; i++) { const a = i * 2.1 + 0.4; g.beginPath(); g.arc(cx + Math.cos(a) * 7 * z, cy - 20 * z + Math.sin(a) * 6 * z, 2.2 * z, 0, 7); g.fill(); } }
  }
  function drawRock(cx, cy, z) {
    g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.ellipse(cx + 2 * z, cy + 2 * z, 12 * z, 5 * z, 0, 0, 7); g.fill();
    g.fillStyle = '#8E8E93'; g.beginPath(); g.moveTo(cx - 12 * z, cy + 2 * z); g.lineTo(cx - 8 * z, cy - 8 * z); g.lineTo(cx + 2 * z, cy - 12 * z); g.lineTo(cx + 11 * z, cy - 4 * z); g.lineTo(cx + 10 * z, cy + 3 * z); g.closePath(); g.fill();
    g.fillStyle = '#B0B0B5'; g.beginPath(); g.moveTo(cx - 8 * z, cy - 8 * z); g.lineTo(cx + 2 * z, cy - 12 * z); g.lineTo(cx + 3 * z, cy - 4 * z); g.closePath(); g.fill();
  }
  function drawField(cx, cy, z, grow, ripe) {
    g.fillStyle = '#8A5A35'; diamond(cx, cy, TW * 0.94 * z, TH * 0.94 * z); g.fill();
    g.strokeStyle = '#74492A'; g.lineWidth = 1.5 * z;
    for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(cx - TW * 0.22 * z + i * 6 * z, cy - TH * 0.11 * z - i * 3 * z + TH * 0.11 * z); g.lineTo(cx + TW * 0.22 * z + i * 6 * z - TW * 0.22 * z, cy + TH * 0.22 * z - i * 3 * z); g.stroke(); }
    const hgt = (3 + 11 * grow) * z, col = ripe ? '#F2C14E' : grow > 0.6 ? '#C6C24A' : '#7FBF4D';
    g.strokeStyle = col; g.lineWidth = 2 * z; g.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const u = (i % 3) - 1, v = Math.floor(i / 3) - 1, px = cx + (u - v) * 9 * z, py = cy + (u + v) * 4.5 * z + 2 * z;
      g.beginPath(); g.moveTo(px, py); g.lineTo(px - 2 * z, py - hgt); g.moveTo(px, py); g.lineTo(px + 2 * z, py - hgt * 0.9); g.stroke();
      if (ripe) { g.fillStyle = '#E8A93A'; g.beginPath(); g.ellipse(px - 2 * z, py - hgt - 1 * z, 1.8 * z, 3 * z, -0.3, 0, 7); g.fill(); }
    }
  }
  function drawWell(cx, cy, z) {
    g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.ellipse(cx + 2 * z, cy + 3 * z, 15 * z, 7 * z, 0, 0, 7); g.fill();
    g.fillStyle = '#7C7C82'; g.beginPath(); g.ellipse(cx, cy, 13 * z, 7 * z, 0, 0, 7); g.fill(); g.fillRect(cx - 13 * z, cy - 8 * z, 26 * z, 8 * z);
    g.fillStyle = '#9C9CA3'; g.beginPath(); g.ellipse(cx, cy - 8 * z, 13 * z, 7 * z, 0, 0, 7); g.fill();
    g.fillStyle = '#3D86C6'; g.beginPath(); g.ellipse(cx, cy - 8 * z, 9 * z, 4.5 * z, 0, 0, 7); g.fill();
    g.fillStyle = '#6B4A2E'; g.fillRect(cx - 12 * z, cy - 28 * z, 3 * z, 20 * z); g.fillRect(cx + 9 * z, cy - 28 * z, 3 * z, 20 * z);
    g.fillStyle = '#A64B2A'; g.beginPath(); g.moveTo(cx - 16 * z, cy - 26 * z); g.lineTo(cx, cy - 36 * z); g.lineTo(cx + 16 * z, cy - 26 * z); g.closePath(); g.fill();
  }
  function drawHives(cx, cy, z, t) {
    for (const [u, v] of [[-10, -1], [9, -3], [0, 5]]) {
      const x = cx + u * z, y = cy + v * z;
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x - 5 * z, y + 1 * z, 12 * z, 3 * z);
      g.fillStyle = '#E8B23A'; g.fillRect(x - 6 * z, y - 12 * z, 12 * z, 12 * z);
      g.fillStyle = '#B9822A'; g.fillRect(x - 6 * z, y - 8 * z, 12 * z, 1.5 * z); g.fillRect(x - 6 * z, y - 4 * z, 12 * z, 1.5 * z);
      g.fillStyle = '#7A5C3E'; g.fillRect(x - 7 * z, y - 14 * z, 14 * z, 3 * z);
    }
    g.fillStyle = '#222';
    for (let i = 0; i < 4; i++) { const a = t / 300 + i * 1.7; g.beginPath(); g.arc(cx + Math.cos(a) * 14 * z, cy - 18 * z + Math.sin(a * 1.3) * 6 * z, 1.4 * z, 0, 7); g.fill(); }
  }
  function bubble(cx, cy, z, t, ic, warn) {
    const by = cy - 50 * z + Math.sin(t / 220 + cx) * 2.5 * z, r = 12 * z;
    g.fillStyle = warn ? 'rgba(40,36,48,.9)' : '#FFFFFF'; g.beginPath(); g.arc(cx, by, r, 0, 7); g.fill();
    g.beginPath(); g.moveTo(cx - 4 * z, by + r - 2 * z); g.lineTo(cx, by + r + 5 * z); g.lineTo(cx + 4 * z, by + r - 2 * z); g.fill();
    emoji(ic, cx, by + 1 * z, Math.round(14 * z));
    if (warn) { g.strokeStyle = '#FF6B6B'; g.lineWidth = 2 * z; g.beginPath(); g.moveTo(cx - 8 * z, by + 8 * z); g.lineTo(cx + 8 * z, by - 8 * z); g.stroke(); }
  }

  const floats = [];
  function floatText(x, y, t) { floats.push({ x, y, t, at: performance.now() }); }

  function draw(tms) {
    requestAnimationFrame(draw);
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.fillStyle = '#2E4A2A'; g.fillRect(0, 0, W, H);
    if (!view) { drawMenuBg(tms); return; }
    refreshView();
    const s = view, z = cam.z, t = now(), dt = t - viewAt;
    const bmap = new Map(); for (const b of s.b) bmap.set(K.idx(b.x, b.y), b);
    const bon = K.bonuses(s);
    const ownedSet = new Set(s.ch);
    const buyable = new Set();
    for (const c of s.ch) { const x = c % K.NC, y = Math.floor(c / K.NC); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < K.NC && Y < K.NC && !ownedSet.has(Y * K.NC + X)) buyable.add(Y * K.NC + X); } }
    const tw = TW * z, th = TH * z, pad = 60 * z;
    // земля
    for (let d = 0; d < 2 * N - 1; d++) for (let x = Math.max(0, d - N + 1); x <= Math.min(N - 1, d); x++) {
      const y = d - x, X = sx(x, y), Y = sy(x, y);
      if (X < -tw || X > W + tw || Y < -th - pad || Y > H + th + pad) continue;
      const c = K.chunkOf(x, y), own = ownedSet.has(c), hv = h01(x, y);
      g.fillStyle = own ? (hv < 0.5 ? '#7DBE5A' : '#78B955') : buyable.has(c) ? (hv < 0.5 ? '#4F7A45' : '#4B7542') : (hv < 0.5 ? '#3C5C37' : '#395833');
      diamond(X, Y, tw + 0.6, th + 0.6); g.fill();
      if (placing && free(s, x, y)) { g.fillStyle = 'rgba(255,255,255,.22)'; diamond(X, Y, tw * 0.86, th * 0.86); g.fill(); }
    }
    // межа своєї землі
    g.strokeStyle = 'rgba(255,240,180,.35)'; g.lineWidth = 1.5 * z;
    for (const c of s.ch) {
      const x0 = (c % K.NC) * K.CH, y0 = Math.floor(c / K.NC) * K.CH;
      const edges = [[[0, -1], [x0 - 0.5, y0 - 0.5, x0 + K.CH - 0.5, y0 - 0.5]], [[0, 1], [x0 - 0.5, y0 + K.CH - 0.5, x0 + K.CH - 0.5, y0 + K.CH - 0.5]], [[-1, 0], [x0 - 0.5, y0 - 0.5, x0 - 0.5, y0 + K.CH - 0.5]], [[1, 0], [x0 + K.CH - 0.5, y0 - 0.5, x0 + K.CH - 0.5, y0 + K.CH - 0.5]]];
      const cx = c % K.NC, cy = Math.floor(c / K.NC);
      for (const [[dx, dy], [a, b, e, f]] of edges) { const X = cx + dx, Y = cy + dy; if (X >= 0 && Y >= 0 && X < K.NC && Y < K.NC && ownedSet.has(Y * K.NC + X)) continue; g.beginPath(); g.moveTo(sx(a, b), sy(a, b)); g.lineTo(sx(e, f), sy(e, f)); g.stroke(); }
    }
    // предмети за глибиною
    for (let d = 0; d < 2 * N - 1; d++) for (let x = Math.max(0, d - N + 1); x <= Math.min(N - 1, d); x++) {
      const y = d - x, X = sx(x, y), Y = sy(x, y);
      if (X < -tw || X > W + tw || Y < -pad || Y > H + th + pad * 2) continue;
      const i = K.idx(x, y), b = bmap.get(i);
      if (b) { drawBuilding(b, X, Y, z, t, dt, bon, s); continue; }
      const ob = s.ob[i];
      if (ob === 't') drawTree(X, Y, z, ownedSet.has(K.chunkOf(x, y)), 0);
      else if (ob === 'r') drawRock(X, Y, z);
    }
    // таблички на землі, яку можна купити
    for (const c of buyable) {
      const x = (c % K.NC) * K.CH + 1.5, y = Math.floor(c / K.NC) * K.CH + 1.5, X = sx(x, y), Y = sy(x, y);
      if (X < -40 || X > W + 40 || Y < -40 || Y > H + 40) continue;
      g.fillStyle = 'rgba(12,10,16,.65)'; g.beginPath(); g.roundRect ? g.roundRect(X - 22 * z, Y - 13 * z, 44 * z, 26 * z, 10 * z) : g.rect(X - 22 * z, Y - 13 * z, 44 * z, 26 * z); g.fill();
      emoji('🗺', X - 9 * z, Y, Math.round(13 * z)); g.fillStyle = '#FFC93C'; g.font = '800 ' + Math.round(15 * z) + 'px "Baloo 2",sans-serif'; g.fillText('+', X + 9 * z, Y + 1 * z);
    }
    // вибрана будівля
    if (sel && sheetFn) { const b = s.b.find((q) => q.id === sel); if (b) { g.strokeStyle = '#FFC93C'; g.lineWidth = 2.5 * z; diamond(sx(b.x, b.y), sy(b.x, b.y), tw * 0.96, th * 0.96); g.stroke(); } }
    if (buildAt && sheetFn) { g.strokeStyle = '#FFFFFF'; g.lineWidth = 2.5 * z; diamond(sx(buildAt[0], buildAt[1]), sy(buildAt[0], buildAt[1]), tw * 0.96, th * 0.96); g.stroke(); }
    // злітні написи
    const pt = performance.now();
    for (let k = floats.length - 1; k >= 0; k--) {
      const f = floats[k], a = (pt - f.at) / 1300; if (a >= 1) { floats.splice(k, 1); continue; }
      const X = sx(f.x, f.y), Y = sy(f.x, f.y) - 40 * z - a * 40;
      g.globalAlpha = 1 - a * a; g.font = '800 ' + Math.round(18 * Math.max(0.8, z)) + 'px "Baloo 2",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.6)'; g.strokeText(f.t, X, Y); g.fillStyle = '#FFF6D5'; g.fillText(f.t, X, Y); g.globalAlpha = 1;
    }
  }
  function drawBuilding(b, X, Y, z, t, dt, bon, s) {
    const d = B[b.k], dur = d.d ? K.durOf(b, bon) : 1;
    const prog = b.p >= 0 ? Math.min(1, (b.p + dt) / dur) : b.buf ? 1 : 0;
    if (d.kind === 'field') drawField(X, Y, z, b.buf ? 1 : prog, b.buf >= K.capOf(b) || (b.buf && b.p < 0));
    else if (d.kind === 'orchard') { g.fillStyle = '#6DAF4E'; diamond(X, Y, TW * 0.9 * z, TH * 0.9 * z); g.fill(); drawTree(X - 12 * z, Y - 2 * z, z * 0.75, 1, b.buf ? 3 : Math.floor(prog * 3)); drawTree(X + 12 * z, Y - 2 * z, z * 0.75, 1, b.buf ? 3 : Math.floor(prog * 2)); drawTree(X, Y + 6 * z, z * 0.8, 1, b.buf ? 4 : Math.floor(prog * 3)); }
    else if (d.kind === 'well') drawWell(X, Y, z);
    else if (d.kind === 'apiary') { g.fillStyle = '#88C463'; diamond(X, Y, TW * 0.9 * z, TH * 0.9 * z); g.fill(); drawHives(X, Y, z, t); }
    else drawHouse(X, Y, z, d.wall, d.roof, d.ic);
    if (!d.d) return;
    if (b.lv > 1) { g.fillStyle = 'rgba(12,10,16,.75)'; g.beginPath(); g.arc(X + 20 * z, Y + 4 * z, 7 * z, 0, 7); g.fill(); g.fillStyle = '#FFC93C'; g.font = '800 ' + Math.round(10 * z) + 'px "Baloo 2",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(b.lv, X + 20 * z, Y + 4.5 * z); }
    if (b.h) emoji('🧑‍🌾', X - 20 * z, Y + 2 * z, Math.round(11 * z));
    const out = RES[d.out[0]].ic;
    if (b.buf && !b.h) bubble(X, Y, z, t, out, false);
    else if (b.p >= 0 && d.kind !== 'field') {
      const w = 28 * z; g.fillStyle = 'rgba(12,10,16,.6)'; g.fillRect(X - w / 2, Y + 11 * z, w, 4 * z); g.fillStyle = '#7BD389'; g.fillRect(X - w / 2, Y + 11 * z, w * prog, 4 * z);
    } else if (b.p < 0) { const w = K.why(s, b); if (w && w !== 'full') bubble(X, Y, z * 0.8, t, RES[w].ic, true); }
  }
  // заставка меню: трохи полів
  function drawMenuBg(t) {
    const z = Math.max(0.8, W / 420);
    for (let y = -6; y < 7; y++) for (let x = -6; x < 7; x++) {
      const X = W / 2 + ((x - y) * TW) / 2 * z, Y = H * 0.75 + ((x + y) * TH) / 2 * z;
      g.fillStyle = h01(x + 50, y + 50) < 0.5 ? '#7DBE5A' : '#78B955'; diamond(X, Y, TW * z + 0.6, TH * z + 0.6); g.fill();
    }
    for (let y = -6; y < 7; y++) for (let x = -6; x < 7; x++) {
      const X = W / 2 + ((x - y) * TW) / 2 * z, Y = H * 0.75 + ((x + y) * TH) / 2 * z, h = h01(x + 50, y + 50);
      if (Math.abs(x) <= 1 && Math.abs(y) <= 1) drawField(X, Y, z, (Math.sin(t / 1500 + x + y) + 1) / 2, false);
      else if (h > 0.85) drawTree(X, Y, z, 1, 0);
      else if (x === 3 && y === -1) drawHouse(X, Y, z, B.coop.wall, B.coop.roof, '🐔');
      else if (x === -1 && y === 3) drawHouse(X, Y, z, B.mill.wall, B.mill.roof, '🌬');
    }
  }
  requestAnimationFrame(draw);

  // ================= жести: тягнути, щипок, торкання =================
  const ptr = new Map(); let gest = null;
  cv.addEventListener('pointerdown', (e) => {
    au(); cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
    ptr.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
    if (ptr.size === 1) gest = { moved: false, cx: cam.x, cy: cam.y };
    if (ptr.size === 2) { const [a, b] = [...ptr.values()]; gest = { moved: true, pinch: true, d0: Math.hypot(a.x - b.x, a.y - b.y), z0: cam.z, cx: cam.x, cy: cam.y, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; }
  });
  cv.addEventListener('pointermove', (e) => {
    const p = ptr.get(e.pointerId); if (!p || !gest) return;
    p.x = e.clientX; p.y = e.clientY;
    if (gest.pinch && ptr.size >= 2) {
      const [a, b] = [...ptr.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const wx0 = (gest.mx - W / 2) / gest.z0 + gest.cx, wy0 = (gest.my - H / 2) / gest.z0 + gest.cy;
      cam.z = gest.z0 * (d / Math.max(10, gest.d0)); clampCam();
      cam.x = wx0 - (mx - W / 2) / cam.z; cam.y = wy0 - (my - H / 2) / cam.z; clampCam();
    } else if (!gest.pinch) {
      if (Math.hypot(p.x - p.x0, p.y - p.y0) > 8) gest.moved = true;
      if (gest.moved) { cam.x = gest.cx - (p.x - p.x0) / cam.z; cam.y = gest.cy - (p.y - p.y0) / cam.z; clampCam(); }
    }
  });
  const up = (e) => {
    const p = ptr.get(e.pointerId); ptr.delete(e.pointerId);
    if (!p || !gest) return;
    if (!gest.moved && !gest.pinch && ptr.size === 0 && performance.now() - p.t0 < 600) { const [x, y] = pick(p.x, p.y); tapTile(x, y); }
    if (ptr.size === 0) gest = null;
    else if (gest.pinch && ptr.size === 1) { const q = [...ptr.values()][0]; q.x0 = q.x; q.y0 = q.y; gest = { moved: true, cx: cam.x, cy: cam.y }; }
  };
  cv.addEventListener('touchend', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false }); // без емульованого click після дотику
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', (e) => { ptr.delete(e.pointerId); if (!ptr.size) gest = null; });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); const k = Math.exp(-e.deltaY * 0.0015), wx0 = (e.clientX - W / 2) / cam.z + cam.x, wy0 = (e.clientY - H / 2) / cam.z + cam.y; cam.z *= k; clampCam(); cam.x = wx0 - (e.clientX - W / 2) / cam.z; cam.y = wy0 - (e.clientY - H / 2) / cam.z; clampCam(); }, { passive: false });

  // ================= повідомлення й звук =================
  let toastT = 0;
  function toast(t, bad) { const el = $('toast'); el.textContent = t; el.classList.toggle('bad', !!bad); el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2600); }
  function say(big, small) { const el = $('say'); el.innerHTML = esc(big) + (small ? '<small>' + esc(small) + '</small>' : ''); el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); }
  let AC = null, muted = ls.get('khutir_mute') === '1';
  function au() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (AC && AC.state === 'suspended') AC.resume(); }
  function tone(f, d, type, vol, at) {
    if (!AC || muted) return; const t = AC.currentTime + (at || 0), o = AC.createOscillator(), gn = AC.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t); gn.gain.setValueAtTime(vol || 0.12, t); gn.gain.exponentialRampToValueAtTime(0.001, t + d);
    o.connect(gn); gn.connect(AC.destination); o.start(t); o.stop(t + d);
  }
  function sfx(k) {
    if (k === 'pick') { tone(660, 0.08, 'triangle'); tone(990, 0.1, 'triangle', 0.1, 0.06); }
    else if (k === 'coin') { tone(1320, 0.08, 'square', 0.05); tone(1760, 0.14, 'square', 0.05, 0.07); }
    else if (k === 'build') { tone(140, 0.15, 'sawtooth', 0.08); tone(220, 0.12, 'triangle', 0.1, 0.08); }
    else if (k === 'chop') { tone(300, 0.05, 'square', 0.06); tone(200, 0.08, 'square', 0.06, 0.07); }
    else if (k === 'err') tone(160, 0.18, 'sawtooth', 0.06);
    else if (k === 'lvl') [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', 0.1, i * 0.1));
  }

  // ================= тест-хук =================
  window.KHUTIR = {
    get S() { return S; }, get view() { return view; }, get mode() { return mode; }, get code() { return code; }, get cam() { return cam; },
    commit, tapTile, warp(ms) { warp += ms; refreshView(true); }, refresh() { refreshView(true); }, startSolo, openShared, showMenu, go, closeSheet,
    screenOf(x, y) { return [sx(x, y), sy(x, y)]; }, get sheetOpen() { return !!sheetFn; }, get placing() { return placing; }, me,
  };

  showMenu();
  if (qCode && hasNet) { $('mCode').value = qCode; if (me.name) openShared(qCode); else $('mErr').textContent = 'Впиши імʼя й натисни «Увійти»'; }
})();
