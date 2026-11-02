/* Хутір — екран, жести, шторки, мережа. Логіка — у sim.js (KhutirSim). */
(function () {
  'use strict';
  const K = window.KhutirSim, B = K.B, RES = K.RES, N = K.N;
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

  // ================= стан =================
  let S = null, view = null, viewAt = 0;       // S — справжній стан; view — S, доведений до «зараз» (для показу)
  let mode = null, code = '', net = null, srvOff = 0, warp = 0, onlineUids = new Set();
  const me = { name: '', uid: '' };
  const now = () => Date.now() + (mode === 'shared' ? srvOff : 0) + warp;
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function nickFromSession() {
    try { const s = JSON.parse(ls.get('games41_session') || 'null'); if (s && s.username) return String(s.username).slice(0, 16); } catch (e) {}
    return '';
  }
  me.name = nickFromSession() || ls.get('khutir_nick') || '';
  const myUid = () => (mode === 'shared' ? me.uid : 'me');
  const myV = () => (view && view.vl ? view.vl[myUid()] : null);

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
    else if (a.t === 'deco' || a.t === 'fence') sfx('pick');

    if (r.lvUp) {
      const opened = K.ORDER.filter((k) => B[k].lv === r.lvUp).map((k) => B[k].ic + ' ' + B[k].n).concat(Object.keys(K.CROP).filter((c) => K.CROP[c].lv === r.lvUp).map((c) => RES[c].ic + ' ' + RES[c].n));
      say('Рівень ' + r.lvUp + '!', opened.length ? 'Відкрито: ' + opened.join(', ') : 'Нові замовлення стали більшими');
      sfx('lvl');
    }
    refreshView(true); if (sheetFn) sheetFn();
  }

  // ================= соло =================
  function saveSolo() { if (mode === 'solo' && S) ls.set('khutir_solo2', JSON.stringify(S)); }
  setInterval(saveSolo, 10000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveSolo(); });
  function soloInfo() { try { const s = JSON.parse(ls.get('khutir_solo2') || 'null'); return s && s.v === K.VER ? s : null; } catch (e) { return null; } }

  function startSolo() {
    let s = soloInfo();
    if (!s) s = K.create((Math.random() * 2 ** 31) | 0, 'Мій хутір');
    mode = 'solo'; code = '';
    enter(s);
  }

  // що набігло, поки нікого не було
  function totals(s) { const o = {}; for (const r in s.st) o[r] = (o[r] || 0) + s.st[r]; for (const b of s.b) if (b.buf && B[b.k].out) { const r = K.outOf(b)[0]; o[r] = (o[r] || 0) + b.buf; } return o; }
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
    if (!S.vl || !S.vl[myUid()]) commit({ t: 'join', uid: myUid(), n: me.name || 'Селянин' });
    else if (mode === 'shared' && S.vl[myUid()].n !== me.name && me.name) commit({ t: 'join', uid: myUid(), n: me.name });
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
        const res = await db.ref('khutir/' + cand + '/s').transaction((cur) => (cur ? undefined : JSON.stringify(Object.assign(K.advance(K.create((Math.random() * 2 ** 31) | 0, createName), now() + srvOff), { own: u.uid }))));
        if (res.committed) c = cand;
      }
      if (!c) { $('mErr').textContent = 'Не вийшло створити, спробуй ще'; return; }
    }
    const ref = db.ref('khutir/' + c + '/s');
    const first = (await ref.once('value')).val();
    if (typeof first !== 'string') { $('mErr').textContent = 'Хутора з кодом ' + c + ' нема'; forgetFarm(c); drawFarms(); return; }
    // хутір зі старими правилами починається заново: назва й власник лишаються
    await ref.transaction((cur) => {
      let o = null; try { o = JSON.parse(cur); } catch (e) { return cur; }
      if (!o || o.v === K.VER) return cur;
      return JSON.stringify(Object.assign(K.advance(K.create((Math.random() * 2 ** 31) | 0, o.nm), Date.now() + srvOff), { own: o.own }));
    });
    if (net) net.leave();
    const onRef = db.ref('khutir/' + c + '/on'), meRef = onRef.child(u.uid);
    let online = [];
    const onVal = (snap) => { const v = snap.val() || {}; onlineUids = new Set(Object.keys(v)); online = Object.keys(v).map((k) => v[k] && v[k].n).filter(Boolean); $('hOnN').textContent = online.length || 1; };
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
    mode = null; S = null; view = null; buildOn = false; hist.length = 0; redo.length = 0; closeSheet(); cancelPlace(); $('mbar').hidden = true;
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
    $('hNameT').textContent = (mode === 'shared' ? '👥 ' : '') + s.nm;
    if (s.coins !== lastCoins) { $('hCoins').textContent = '💰 ' + fmt(s.coins); lastCoins = s.coins; }
    $('hLvlN').textContent = s.lv; $('hLvlBar').style.setProperty('--w', Math.min(100, (100 * s.xp) / K.xpNeed(s.lv)) + '%');
    let ready = 0; for (const b of s.b) if ((b.buf && !b.h) || (b.k === 'field' && b.cr && b.p < 0)) ready++;
    $('dAll').hidden = !ready; $('dAll').textContent = ready;
    let can = 0; for (const o of s.o) if (o.w <= now() && o.it.every(([r, n]) => (s.st[r] || 0) >= n)) can++;
    $('dOrders').hidden = !can; $('dOrders').textContent = can;
    tipLine();
    $('hBeautyN').textContent = K.tier(s);
    const mk = K.market(s, now()), mb = $('mkBtn'), show = !!(mk && mk.here) && !buildOn;
    mb.hidden = !show; if (show) { const tx = '🛒 Торговець<small>ще ' + secs(mk.end - now()) + '</small>'; if (mb.innerHTML !== tx) mb.innerHTML = tx; }
  }
  const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : String(Math.round(n)));
  function tipLine() {
    const s = view, el = $('tip');
    if (buildOn) { el.hidden = true; return; }
    let t = '';
    if (placing) t = '';
    else if (s.lv <= 2) {
      const ready = s.b.some((b) => b.buf);
      if (!s.made && !ready) t = '🌾 Поле росте. Коли над ним зʼявиться колосок — торкнись';
      else if (!s.made && ready) t = '👆 Торкнись поля, щоб зібрати пшеницю';
      else if (s.b.some((b) => b.k === 'field' && !b.buf && b.p < 0)) t = '🌱 Торкнись порожнього поля й обери, що сіяти';
      else if (!K.count(s, 'mill')) t = '🏗 Збудуй млин: борошно дорожче за пшеницю';
      else if (s.lv === 1) t = '📋 Замовлення платять більше, ніж продаж у коморі';
      else if (!K.count(s, 'market')) t = '🏪 Збудуй ринок: сюди приїздять торговці';
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
  function closeSheet() { $('sheet').classList.remove('open'); sheetFn = null; sel = null; villFor = null; }
  $('shX').addEventListener('click', closeSheet);
  // кнопки в шторці: data-a='{"t":"…"}' — дія; data-go — перехід
  function bindSheet() {
    $('shB').querySelectorAll('[data-a]').forEach((el) => el.addEventListener('click', () => {
      if (fresh()) return;
      au(); const a = JSON.parse(el.dataset.a);
      if (a.t === 'demolish' && el.dataset.sure !== '1') { el.dataset.sure = '1'; el.innerHTML = 'Точно знести?<small>повернеться половина ціни</small>'; return; }
      const r = commit(a);
      if (r && r.ok && a.t === 'demolish') closeSheet();
      if (r && r.ok && a.t === 'chunk') closeSheet();
      if (r && r.ok && (a.t === 'clear' || a.t === 'undeco' || a.t === 'sow' || a.t === 'fence' || a.t === 'ebench' || a.t === 'sdeco')) closeSheet();
    }));
    $('shB').querySelectorAll('[data-tab]').forEach((el) => el.addEventListener('click', () => { if (fresh()) return; catTab = el.dataset.tab; sfx('pick'); sheetFn(); }));
    $('shB').querySelectorAll('[data-place]').forEach((el) => el.addEventListener('click', () => { if (fresh()) return; au(); startPlace(el.dataset.place); }));
    bindVill();
    $('shB').querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', () => { if (fresh()) return; au(); go(el.dataset.go); }));
  }
  const A = (o) => esc(JSON.stringify(o));
  const items = (list, s, need) => list.map(([r, n]) => '<span class="it' + (need ? ((s.st[r] || 0) >= n ? ' ok' : ' no') : '') + '">' + RES[r].ic + ' ' + (need ? Math.min(s.st[r] || 0, n) + '/' : '') + n + '</span>').join('');
  const secs = (ms) => { const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? h + ' год' + (m ? ' ' + m + ' хв' : '') : m ? m + ' хв' + (s < 600 && s % 60 ? ' ' + (s % 60) + ' с' : '') : s + ' с'; };
  const costTxt = (c) => (c.c ? fmt(c.c) + ' 💰' : '') + (c.pl ? ' · ' + c.pl + ' 🪚' : '');
  const recipe = (d) => (d.in ? items(d.in) + ' → ' : '') + (d.out ? '<span class="it">' + RES[d.out[0]].ic + ' ' + d.out[1] + '</span>' : '');

  function go(what) {
    if (what === 'build') openSheet('🏗 Будувати', buildSheet);
    else if (what === 'store') openSheet('📦 Комора', storeSheet);
    else if (what === 'orders') openSheet('📋 Замовлення', ordersSheet);
    else if (what === 'farm') openSheet(mode === 'shared' ? '👥 Спільний хутір' : '🏡 Мій хутір', farmSheet);
    else if (what === 'beauty') openSheet('🌸 Краса хутора', beautySheet);
    else if (what === 'level') openSheet('⭐ Рівень ' + view.lv, levelSheet);
    else if (what === 'vill') { const v = myV(); if (v) { villFor = myUid(); openSheet('🧑‍🌾 ' + v.n, villSheet); } }
  }
  $('bBuild').addEventListener('click', () => { au(); enterBuild(); });
  $('bStore').addEventListener('click', () => { au(); go('store'); });
  $('bVill').addEventListener('click', () => { au(); go('vill'); });
  $('bOrders').addEventListener('click', () => { au(); go('orders'); });
  $('bAll').addEventListener('click', () => { au(); commit({ t: 'collectAll' }); });
  $('hName').addEventListener('click', () => { au(); go('farm'); });
  $('hOn').addEventListener('click', () => { au(); go('farm'); });
  $('hLvl').addEventListener('click', () => { au(); go('level'); });
  $('hBeauty').addEventListener('click', () => { au(); go('beauty'); });
  $('mkBtn').addEventListener('click', () => { au(); const b = view.b.find((q) => q.k === 'market'); if (b) { cam.x = wx(b.x, b.y); cam.y = wy(b.x, b.y); tapTile(b.x, b.y); } });

  // каталог будування: вкладки замість довгого списку
  const CATS = { farm: ['Ферма', ['field', 'coop', 'dairy', 'orchard', 'apiary', 'well']], make: ['Виробництво', ['mill', 'lumber', 'saw', 'bakery', 'oilery', 'cheese', 'press', 'kitchen', 'pastry', 'meadery']], town: ['Село', ['market']], deco: ['Прикраси', null] };
  let catTab = 'farm';
  function buildSheet() {
    const s = view;
    let h = '<div class="tabs">' + Object.keys(CATS).map((k) => '<button class="tab' + (k === catTab ? ' on' : '') + '" data-tab="' + k + '">' + CATS[k][0] + '</button>').join('') + '</div><div class="cat">';
    if (catTab !== 'deco') for (const k of CATS[catTab][1]) {
      const d = B[k], lock = s.lv < d.lv, c = K.buildCost(s, k), one = d.one && K.count(s, k), ok = !lock && !one && K.canAfford(s, c);
      const info = lock ? '🔒 з ' + d.lv + ' рівня' : one ? 'Уже збудовано' : d.kind === 'field' ? esc(d.hint) : d.d ? recipe(d) + ' · ' + secs(d.d * 1000) : esc(d.hint || '');
      h += '<button class="row tile2' + (ok ? '' : ' off') + '" ' + (lock || one ? 'disabled' : 'data-place="' + k + '"') + '><span class="top"><span class="ic">' + d.ic + '</span><b>' + d.n + '</b></span><small>' + info + '</small><span class="pr">' + costTxt(c) + '</span></button>';
    } else for (const k in K.DECOR) {
      const d = K.DECOR[k], only = d.shop === false, have = (s.inv && s.inv[k]) || 0;
      if (only && !have) continue;
      const lock = !only && s.lv < d.lv, ok = only || (!lock && s.coins >= d.c);
      h += '<button class="row tile2' + (ok ? '' : ' off') + '" ' + (lock ? 'disabled' : 'data-place="deco:' + k + '"') + '><span class="top"><span class="ic">' + d.ic + '</span><b>' + d.n + '</b></span><small>' + (lock ? '🔒 з ' + d.lv + ' рівня' : '+' + d.b + ' 🌸' + (d.hint ? ' · ' + d.hint : '')) + '</small><span class="pr">' + (only ? 'є ' + have : d.c + ' 💰') + '</span></button>';
    }
    return h + '</div>';
  }
  function forestSheet() {
    const s = view, on = s.cut !== 0;
    return '<div class="row"><span class="ic">🪓</span><span class="tx"><b>Дерева тут не зникають</b><small>Раз на ' + Math.round(K.CUT_EVERY / 60000) + ' хв селянин іде сюди із сокирою, рубає й несе ' + K.CUT_WOOD + ' 🪵 у комору.</small></span></div>' +
      '<button class="row" data-a="' + A({ t: 'cut', on: !on }) + '"><span class="tx"><b>Селянин рубає</b><small>Вимкни, якщо колоди не потрібні</small></span><span class="sw' + (on ? ' on' : '') + '"><i></i></span></button>';
  }
  function beautySheet() {
    const s = view, t = K.tier(s), v = K.beauty(s), a = t ? K.tierNeed(t) : 0, n = t < 10 ? K.tierNeed(t + 1) : a;
    let h = '<div class="row"><span class="ic">🌸</span><span class="tx"><b>Ступінь ' + t + ' · краса ' + v + '</b><small>' + (t < 10 ? 'До наступного ступеня ще ' + (n - v) : 'Найвищий ступінь') + '</small><span class="cap"><i style="width:' + (t < 10 ? Math.min(100, (100 * (v - a)) / (n - a)) : 100) + '%"></i></span></span></div>';
    h += '<div class="row"><span class="ic">📋</span><span class="tx"><b>Замовники платять +' + t * 4 + '%</b><small>Кожен ступінь додає 4%</small></span></div>';
    h += '<div class="row"><span class="ic">🛒</span><span class="tx"><b>Торговець купує в ' + (2 + 0.1 * t).toFixed(1).replace('.', ',') + ' раза дорожче</b><small>З 2 ступеня бере більше товарів, з 3 — привозить ще одну рідкісну прикрасу</small></span></div>';
    h += '<p class="note">Різні прикраси дають більше: після 12 однакових кожна наступна важить утричі менше.</p><div class="btns"><button class="btn" id="goDeco">🌸 Прикрасити хутір</button></div>';
    setTimeout(() => { const b = $('goDeco'); if (b) b.onclick = () => { if (fresh()) return; catTab = 'deco'; closeSheet(); enterBuild(); go('build'); }; });
    return h;
  }
  let sel = null; // id вибраної будівлі
  function bSheet() {
    const s = view, b = s.b.find((q) => q.id === sel);
    if (!b) { setTimeout(closeSheet); return ''; }
    const d = B[b.k];
    let h = '';
    if (b.k === 'home') { const v = s.vl && s.vl[b.o]; return '<p class="note">Тут живе <b>' + esc(v ? v.n : '?') + '</b>. Звідси селянин ходить по найближчих будівлях.</p>' + (b.o === myUid() ? '<div class="btns"><button class="btn" data-go="vill">🧑‍🌾 Мій селянин</button></div>' : ''); }
    if (d.kind === 'barn') return storeSheet();
    if (d.kind === 'market') return marketHtml(s) + '<div class="btns"><button class="btn red" data-a="' + A({ t: 'demolish', id: b.id }) + '">🗑 Знести<small>повернеться половина ціни</small></button></div>';
    if (!d.d) return '<p class="note">' + esc(d.hint || '') + '</p><div class="btns"><button class="btn red" data-a="' + A({ t: 'demolish', id: b.id }) + '">🗑 Знести<small>повернеться половина ціни</small></button></div>';
    const bon = K.bonuses(s).get(b.id) || 0, dur = K.durOf(b, K.bonuses(s)), cap = K.capOf(b), w = K.why(s, b);
    const rt = K.routes(s); let who = '';
    for (const u in rt) if (rt[u].some((q) => q.id === b.id)) who = s.vl[u].n;
    h += '<div class="row"><span class="ic">' + d.ic + '</span><span class="tx"><b>' + (d.kind === 'field' ? 'Поле' : recipe(d)) + '</b><small>цикл ' + secs(dur) + (bon ? ' · бонус сусідів +' + Math.round(bon * 100) + '%' : '') + (b.h ? ' · 🧑‍🌾 наймит збирає сам' : who ? ' · 🧑‍🌾 збирає ' + esc(who) : ' · далеко від хат — збирай сам') + '</small></span></div>';
    const st = b.p >= 0 ? '⏳ ще ' + secs(dur - b.p) + ((b.qn || 0) ? ' · далі в черзі ' + b.qn : '') : w === 'full' ? '✋ повно — збери' : w === 'queue' ? '💤 чекає на твою чергу' : '';
    const outR = K.outOf(b)[0];
    if (d.kind === 'field') {
      const fields = s.b.filter((f) => f.k === 'field'), allOn = fields.every((f) => f.auto);
      h += '<button class="row" data-a="' + A({ t: 'auto', id: b.id, on: !b.auto }) + '"><span class="tx"><b>Постійно</b><small>Сіяти те саме щоразу, як заберуть урожай</small></span><span class="sw' + (b.auto ? ' on' : '') + '"><i></i></span></button>';
      if (fields.length > 1) h += '<div class="btns"><button class="btn sec" data-a="' + A({ t: 'auto', id: b.id, on: !allOn, all: 1 }) + '">' + (allOn ? 'Вимкнути на всіх полях' : 'Постійно на всіх полях') + '</button></div>';
      if (b.p < 0 && !b.buf) {
        h += '<p class="note">Що сіємо?</p>';
        for (const c in K.CROP) { const q = K.CROP[c], lock = s.lv < q.lv, dd = secs((q.d * dur) / K.CROP[b.cr || 'wheat'].d); h += '<button class="row' + (lock ? ' off' : '') + '" ' + (lock ? 'disabled' : 'data-a="' + A({ t: 'sow', id: b.id, c }) + '"') + '><span class="ic">' + RES[c].ic + '</span><span class="tx"><b>' + RES[c].n + '</b><small>' + (lock ? '🔒 з ' + q.lv + ' рівня' : dd + ' · врожай ' + q.y + ' · за цикл ' + q.y * RES[c].p + ' 💰') + '</small></span></button>'; }
      } else h += '<div class="row"><span class="ic">' + RES[outR].ic + '</span><span class="tx"><b>' + RES[outR].n + '</b><small>' + (b.buf ? 'Дозріло: ' + b.buf : '⏳ ще ' + secs(dur - b.p)) + '</small></span></div>';
    }
    if (d.in) {
      h += '<button class="row" data-a="' + A({ t: 'noq', id: b.id, on: !!b.noq }) + '"><span class="tx"><b>Селянин веде чергу</b><small>' + (who ? esc(who) + ' сам ставить сюди роботу зі своєї комори' : 'Діє, коли будівля на маршруті селянина') + '</small></span><span class="sw' + (b.noq ? '' : ' on') + '"><i></i></span></button>';
      const busyN = (b.qn || 0) + (b.p >= 0 ? 1 : 0), qm = K.qMax(b), can = busyN < qm && d.in.every(([r, n]) => (s.st[r] || 0) >= n);
      h += '<div class="btns"><button class="btn" data-a="' + A({ t: 'queue', id: b.id }) + '"' + (can ? '' : ' disabled') + '>▶ Зробити ' + RES[outR].ic + '<small>черга ' + busyN + ' / ' + qm + (busyN >= qm ? '' : ' · ' + d.in.map(([r, n]) => n + ' ' + RES[r].ic).join(' + ')) + '</small></button></div>';
    }
    if (d.kind !== 'field') h += '<div class="row"><span class="tx"><b>Готово: ' + b.buf + ' / ' + cap + ' ' + RES[outR].ic + '</b><small>' + st + '</small><span class="cap"><i class="' + (b.buf >= cap ? 'full' : '') + '" style="width:' + Math.min(100, (100 * b.buf) / cap) + '%"></i></span></span></div>';
    const uc = K.upCost(b), hc = K.hireCost(b);
    h += '<div class="btns">';
    if (b.buf) h += '<button class="btn" data-a="' + A({ t: 'collect', id: b.id }) + '">🧺 Зібрати ' + b.buf + ' ' + RES[outR].ic + '</button>';
    h += '<button class="btn' + (b.buf ? ' sec' : '') + '" data-a="' + A({ t: 'upgrade', id: b.id }) + '"' + (K.canAfford(s, uc) ? '' : ' disabled') + '>⬆ Рівень ' + (b.lv + 1) + '<small>' + costTxt(uc) + ' · швидше й більше місця</small></button>';
    void hc;
    h += '<button class="btn red" data-a="' + A({ t: 'demolish', id: b.id }) + '">🗑 Знести<small>повернеться половина ціни</small></button>';
    return h + '</div>';
  }
  function marketHtml(s) {
    const m = K.market(s, now());
    if (!m || !m.here) return '<div class="row"><span class="ic">🏪</span><span class="tx"><b>Торговця зараз нема</b><small>' + (m ? 'Приїде за ' + secs(m.next - now()) : '') + '. Купує вдвічі дорожче за комору, привозить рідкісні прикраси.</small></span></div>';
    let h = '<div class="row"><span class="ic">🛒</span><span class="tx"><b>Торговець із ' + esc(m.v) + '</b><small>поїде за ' + secs(m.end - now()) + '</small></span></div>';
    m.o.forEach((o, i) => {
      if (o.d) { const d = K.DECOR[o.d]; h += '<div class="row"><span class="ic">' + d.ic + '</span><span class="tx"><b>' + d.n + '</b><small>' + (o.n ? '+' + d.b + ' краси · лише від торговця' : 'куплено') + '</small></span><button class="sell" data-a="' + A({ t: 'mk', i }) + '"' + (o.n && s.coins >= d.c ? '' : ' disabled') + '>' + d.c + ' 💰</button></div>'; return; }
      const have = Math.min(o.n, s.st[o.r] || 0);
      h += '<div class="row"><span class="ic">' + RES[o.r].ic + '</span><span class="tx"><b>' + RES[o.r].n + ' по ' + o.p + ' 💰</b><small>' + (o.n ? 'візьме ще ' + o.n + ', у тебе ' + (s.st[o.r] || 0) : 'більше не треба') + '</small></span><button class="sell" data-a="' + A({ t: 'mk', i, n: have || 1 }) + '"' + (have ? '' : ' disabled') + '>Продати ' + have + '</button></div>';
    });
    return h;
  }
  let villFor = null, lookDraft = null;
  function villSheet() {
    const s = view, v = s.vl && s.vl[villFor]; if (!v) return '';
    const mine = villFor === myUid(), L = K.LOOK;
    if (!lookDraft || lookDraft.u !== villFor) lookDraft = { u: villFor, c: { ...v.c } };
    const c = lookDraft.c, r = (K.routes(s)[villFor] || []);
    let h = '<div class="row" style="justify-content:center;background:linear-gradient(#9FD07A,#6DAF4E)"><canvas id="villPv" width="120" height="140" style="width:120px;height:140px" aria-label="Вигляд селянина"></canvas></div>';
    h += '<div class="row"><span class="ic">🧺</span><span class="tx"><b>Обходить ' + r.length + ' з ' + K.route(v) + ' будівель · кошик ' + K.basket(v) + '</b><small>обхід за ' + secs(K.tripOf(s, villFor, r)) + ' · усього приніс ' + fmt(v.got || 0) + '. Носить урожай у комору й ставить роботу в черги цих будівель.</small></span></div>';
    const md = K.mood(v), restS = K.restSpot(s, v);
    h += '<div class="row"><span class="ic">' + (v.rt ? '💤' : md >= 60 ? '😊' : md >= 30 ? '😐' : '😩') + '</span><span class="tx"><b>' + (v.rt ? 'Відпочиває' : 'Настрій: ' + Math.round(md)) + '</b><small>' + (md >= 60 ? 'Працює на 20% швидше' : md >= 30 ? 'Працює звичайно' : 'Втомився: працює на 30% повільніше') + (restS ? '. Коли втомиться, піде відпочити.' : '. Постав лавку, гойдалку чи копицю: без них він не відпочиває.') + '</small><span class="cap"><i style="width:' + md + '%"></i></span></span></div>';
    if (!mine) return h;
    const names = { st: L.style, h: L.hat, b: L.body, f: L.face };
    const pick = (k, list, label) => '<div class="row"><span class="tx"><b>' + label + '</b><small>' + (names[k] ? names[k][c[k] || 0] : '') + '</small></span><button class="sell" data-look="' + k + ':-1" aria-label="' + label + ': попередній">◀</button>' +
      (list ? '<span style="width:22px;height:22px;border-radius:50%;background:' + list[c[k]] + ';border:2px solid #fff;flex:none"></span>' : '') + '<button class="sell" data-look="' + k + ':1" aria-label="' + label + ': наступний">▶</button></div>';
    h += pick('b', null, 'Селянин') + (c.b === 1 ? '' : pick('f', null, 'Обличчя')) + pick('sh', L.shirt, 'Сорочка') + pick('st', null, 'Одяг') + pick('p', L.pants, c.b === 1 ? 'Спідниця' : 'Штани') + pick('h', null, 'Шапка') + pick('s', L.skin, 'Шкіра');
    const changed = JSON.stringify(c) !== JSON.stringify(v.c);
    h += '<div class="btns"><button class="btn" data-a="' + A({ t: 'look', uid: villFor, c }) + '"' + (changed ? '' : ' disabled') + '>Вдягнути</button><button class="btn sec" id="moveHome">🏠 Перенести хату</button></div>';
    for (const k in K.VUP) { const cost = K.vupCost(v, k); h += '<button class="row' + (K.canAfford(s, cost) ? '' : ' off') + '" data-a="' + A({ t: 'vup', uid: villFor, k }) + '"><span class="ic">' + (k === 'rt' ? '🗺' : k === 'bk' ? '🧺' : '👢') + '</span><span class="tx"><b>' + K.VUP[k].n + ' · рів. ' + ((v.u[k] || 0) + 1) + '</b><small>' + K.VUP[k].d + '</small></span><span class="pr">' + costTxt(cost) + '</span></button>'; }
    return h;
  }
  function bindVill() {
    const pv = $('villPv'); if (pv && lookDraft) { const q = pv.getContext('2d'); q.clearRect(0, 0, 120, 140); drawVillager(q, 60, 124, 3.2, lookDraft.c, performance.now(), false, 1); }
    $('shB').querySelectorAll('[data-look]').forEach((el) => el.addEventListener('click', () => {
      if (fresh()) return;
      const [k, d] = el.dataset.look.split(':'), n = { s: K.LOOK.skin, sh: K.LOOK.shirt, p: K.LOOK.pants, st: K.LOOK.style, h: K.LOOK.hat, b: K.LOOK.body, f: K.LOOK.face }[k].length;
      lookDraft.c[k] = ((lookDraft.c[k] || 0) + +d + n) % n; sfx('pick'); sheetFn();
    }));
    const mh = $('moveHome'); if (mh) mh.onclick = () => { if (fresh()) return; closeSheet(); enterBuild(); setTool('move'); };
  }
  function storeSheet() {
    const s = view, cap = K.storeCap(s), sc = K.storeCost(s);
    let h = '<div class="row"><span class="ic">📦</span><span class="tx"><b>Місця: по ' + cap + ' кожного</b><small>Селянин зносить сюди врожай. Повна комора — будівлі стоять.</small></span></div>';
    h += '<div class="btns"><button class="btn sec" data-a="' + A({ t: 'store' }) + '"' + (K.canAfford(s, sc) ? '' : ' disabled') + '>Розширити до ' + Math.round(cap * 1.5) + '<small>' + costTxt(sc) + '</small></button></div>';
    const list = Object.keys(RES).filter((r) => s.st[r] > 0);
    if (!list.length) h += '<p class="note">Поки порожньо. Збирай урожай із будівель.</p>';
    for (const r of list) {
      const n = s.st[r], p = RES[r].p;
      h += '<div class="row"><span class="ic">' + RES[r].ic + '</span><span class="tx"><b>' + RES[r].n + ': ' + n + '</b><small>продаж ' + p + ' 💰 за шт.</small><span class="cap"><i class="' + (n >= cap ? 'full' : '') + '" style="width:' + Math.min(100, (100 * n) / cap) + '%"></i></span></span>' +
        '<button class="sell" data-a="' + A({ t: 'sell', r, n: 1 }) + '">−1 +' + p + '</button><button class="sell" data-a="' + A({ t: 'sell', r, n: Math.ceil(n / 2) }) + '"' + (n > 1 ? '' : ' disabled') + '>½ +' + Math.ceil(n / 2) * p + '</button></div>';
    }
    return h;
  }
  function ordersSheet() {
    const s = view, t = now();
    let h = '<p class="note">Замовлення платять в 1,6 раза більше за комору і дають ⭐ досвід. Нові приходять одразу.</p>';
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
      if (!s.own || s.own === me.uid) h += '<div class="btns"><button class="btn red" id="delFarm">🗑 Видалити хутір<small>для всіх, назавжди</small></button></div>';
      h += '<span hidden id="shareL">' + esc(link) + '</span>';
    }
    h += '<div class="row"><span class="ic">🌸</span><span class="tx"><b>Краса: ' + K.beauty(s) + ' · ступінь ' + K.tier(s) + '</b><small>Замовники платять +' + K.tier(s) * 4 + '%</small></span></div>';
    h += '<div class="row"><span class="ic">📊</span><span class="tx"><b>Рівень ' + s.lv + ' · ' + s.b.length + ' будівель · ' + s.ch.length * 16 + ' клітинок землі</b><small>Усього вироблено: ' + fmt(s.made) + '</small></span></div>';
    h += '<div class="inp"><input id="renameI" maxlength="24" value="' + esc(s.nm) + '" aria-label="Назва хутора"><button class="btn sec" id="renameB">Назвати</button></div>';
    h += '<div class="btns"><button class="btn sec" id="muteB">' + (muted ? '🔇 Звук вимкнено' : '🔊 Звук увімкнено') + '</button><button class="btn sec" id="exitB">↩ До меню</button></div>';
    setTimeout(() => {
      const sb = $('shareB'); if (sb) sb.onclick = () => { const link = $('shareL').textContent; if (navigator.share) navigator.share({ title: 'Хутір', text: 'Заходь на наш хутір! Код ' + code, url: link }).catch(() => {}); else { try { navigator.clipboard.writeText(link); toast('Посилання скопійовано'); } catch (e) { toast(link); } } };
      $('renameB').onclick = () => commit({ t: 'rename', nm: $('renameI').value });
      $('muteB').onclick = () => { muted = !muted; ls.set('khutir_mute', muted ? '1' : '0'); sheetFn && sheetFn(); };
      $('exitB').onclick = showMenu;
      const df = $('delFarm'); if (df) df.onclick = () => {
        if (df.dataset.sure !== '1') { df.dataset.sure = '1'; df.innerHTML = 'Точно видалити?<small>натисни ще раз</small>'; return; }
        const c = code, db = firebase.database(); forgetFarm(c); showMenu();
        db.ref('khutir/' + c).remove().then(() => toast('Хутір видалено'), () => toast('Не вдалося видалити', true));
      };
    });
    return h;
  }
  const ago = (t) => { const m = Math.round((now() - t) / 60000); return m < 1 ? 'щойно' : m < 60 ? m + ' хв тому' : m < 1440 ? Math.round(m / 60) + ' год тому' : Math.round(m / 1440) + ' дн тому'; };

  // ================= розміщення будівлі =================
  let placing = null, painting = false;
  function startPlace(k) {
    closeSheet(); applyDraft(); tool = null; placing = k; toolUI(); $('place').hidden = false; $('tip').hidden = true;
    if (k.startsWith('deco:')) { const d = K.DECOR[k.slice(5)]; $('placeT').textContent = d.ic + ' ' + d.n + ': торкайся або веди пальцем'; $('placeX').textContent = '✕'; if (k === 'deco:fence') fenceBar(); if (k === 'deco:bench') $('placeT').textContent = '🪑 Торкнись краю клітинки: лавка стане спинкою до нього'; if (d.small) $('placeT').textContent = d.ic + ' ' + d.n + ': веди до точки й відпусти'; }
    else { $('placeT').textContent = 'Куди поставити ' + B[k].ic + ' ' + B[k].n + '?'; $('placeX').textContent = '✕'; }
  }
  function cancelPlace() { placing = null; draft.clear(); $('placeOk').hidden = true; $('place').hidden = true; if (tool) toolUI(); }
  $('placeX').addEventListener('click', () => { tool = null; cancelPlace(); toolUI(); });
  // Тин спершу малюється чернеткою: гроші списуються лише кнопкою «Поставити», тож мисклік нічого не коштує.
  // Палець іде по кутах клітинок, тому повороти виходять самі.
  const draft = new Map();
  function fenceBar() {
    const n = draft.size, c = n * K.DECOR.fence.c, ok = view && view.coins >= c;
    $('placeT').textContent = n ? '🪵 Секцій: ' + n + ' · ' + c + ' 💰' + (ok ? '' : ' (бракує)') : '🪵 Веди пальцем по краях клітинок. Двома пальцями — рухати карту';
    $('placeOk').hidden = !n; $('placeOk').disabled = !ok;
  }
  function draftEdge(x, y, e) {
    const s = view, key = K.fenceKey(x, y, e), own = K.owned(s, x, y) || K.owned(s, x + (e ? 0 : 1), y + (e ? 1 : 0));
    if (s.f[key] || !own) return;
    if (draft.has(key)) { const keys = [...draft.keys()]; if (keys[keys.length - 1] === key || !gest || !gest.vtx) draft.delete(key); }
    else draft.set(key, { x, y, e, st: stroke });
    fenceBar();
  }
  const vertexAt = (px, py) => { const X = (px - W / 2) / cam.z + cam.x, Y = (py - H / 2) / cam.z + cam.y, a = (2 * X) / TW, b = (2 * Y) / TH; return [Math.round((a + b) / 2 + 0.5), Math.round((b - a) / 2 + 0.5)]; };
  // крок між сусідніми кутами клітинок = одна секція; швидкий рух розкладається на кроки
  function fenceDrag(px, py, g0) {
    const v = vertexAt(px, py);
    if (!g0.vtx) { g0.vtx = vertexAt(g0.sx, g0.sy); }
    let [a, b] = g0.vtx;
    while (a !== v[0] || b !== v[1]) {
      if (Math.abs(v[0] - a) >= Math.abs(v[1] - b)) { const d = Math.sign(v[0] - a), na = a + d; draftEdge(Math.min(a, na), b - 1, 1); a = na; }
      else { const d = Math.sign(v[1] - b), nb = b + d; draftEdge(a - 1, Math.min(b, nb), 0); b = nb; }
      g0.vtx = [a, b];
    }
  }
  $('placeOk').addEventListener('click', () => {
    au(); stroke++; applyDraft(); if (placing === 'deco:fence') fenceBar();
  });
  function applyDraft() { if (!draft.size) return; const l = [...draft.values()].map((q) => [q.x, q.y, q.e]), r = doAct({ t: 'fences', l }); if (r && r.ok) draft.clear(); else draft.clear(); }
  // ================= режим будування, як у The Sims =================
  // Кожна дія записується разом зі зворотною. Один рух пальця — одна сходинка «Назад».
  // Прикраси й тин повертають повну ціну, щойно поставлену будівлю «Назад» теж повертає повністю.
  let buildOn = false, tool = null; const hist = [], redo = [];
  function toolUI() {
    $('bar').hidden = buildOn || !view; $('mbar').hidden = !buildOn;
    $('mkBtn').hidden = true; $('mHammer').classList.toggle('on', tool === 'hammer'); $('mMove').classList.toggle('on', tool === 'move'); $('mBuild').classList.toggle('on', !!placing);
    $('mUndo').disabled = !hist.length; $('mRedo').disabled = !redo.length;
    if (tool) { placing = null; $('placeOk').hidden = true; $('place').hidden = false; $('placeX').textContent = '✕'; $('placeT').textContent = tool === 'hammer' ? '🔨 Торкнись або проведи по тому, що прибрати' : '✋ Тягни будівлю чи прикрасу на нове місце'; }
    else if (!placing) $('place').hidden = true;
  }
  function enterBuild() { buildOn = true; hist.length = 0; redo.length = 0; toolUI(); }
  function exitBuild() { applyDraft(); buildOn = false; tool = null; cancelPlace(); hist.length = 0; redo.length = 0; closeSheet(); toolUI(); hud(); }
  function setTool(t) { closeSheet(); applyDraft(); cancelPlace(); tool = tool === t ? null : t; toolUI(); }
  function inverseOf(a, before) {
    if (a.t === 'build') return { t: 'unbuild', id: S.b.reduce((m, b) => Math.max(m, b.id), 0) };
    if (a.t === 'deco') return { t: 'undeco', x: a.x, y: a.y, full: 1 };
    if (a.t === 'undeco') return { t: 'deco', k: before.d[K.idx(a.x, a.y)], x: a.x, y: a.y };
    if (a.t === 'fence') return a.off ? { t: 'fence', x: a.x, y: a.y, e: a.e } : { t: 'fence', x: a.x, y: a.y, e: a.e, off: 1, full: 1 };
    if (a.t === 'sdeco') { const key = K.idx(a.x, a.y) * 9 + a.sl; return a.off ? { t: 'sdeco', k: before.sd[key], x: a.x, y: a.y, sl: a.sl } : { t: 'sdeco', x: a.x, y: a.y, sl: a.sl, off: 1, full: 1 }; }
    if (a.t === 'smove') { const sl = a.from % 9, i = (a.from - sl) / 9; return { t: 'smove', from: K.idx(a.x, a.y) * 9 + a.sl, x: i % N, y: Math.floor(i / N), sl }; }
    if (a.t === 'ebench') { const key = K.fenceKey(a.x, a.y, a.e); if (a.turn) return a; if (a.off) return { t: 'ebench', x: a.x, y: a.y, e: a.e, dr: before.e[key] }; return { t: 'ebench', x: a.x, y: a.y, e: a.e, off: 1, full: 1 }; }
    if (a.t === 'fences') return { t: 'fenceoff', l: a.l.filter(([x, y, e]) => !before.f[K.fenceKey(x, y, e)]) };
    if (a.t === 'fenceoff') return { t: 'fences', l: a.l };
    if (a.t === 'demolish') return { t: 'restore', b: before.b.find((q) => q.id === a.id), pay: S.coins - before.coins };
    if (a.t === 'restore') return { t: 'demolish', id: a.b.id };
    if (a.t === 'unbuild') { const b = before.b.find((q) => q.id === a.id); return { t: 'build', k: b.k, x: b.x, y: b.y }; }
    if (a.t === 'move') { if (a.id) { const b = before.b.find((q) => q.id === a.id); return { t: 'move', id: a.id, x: b.x, y: b.y }; } return { t: 'move', x0: a.x, y0: a.y, x: a.x0, y: a.y0 }; }
    return null;
  }
  // дія з записом в історію
  function doAct(a) {
    const before = clone(S), r = commit(a);
    if (r && r.ok && buildOn) {
      const un = inverseOf(a, before); redo.length = 0;
      if (un) { const top = hist[hist.length - 1]; if (top && top.st === stroke) top.ops.push({ a, un }); else hist.push({ st: stroke, ops: [{ a, un }] }); if (hist.length > 60) hist.shift(); }
      toolUI();
    }
    return r;
  }
  // після скасування «будувати» будівля має новий номер, тому зворотну дію рахуємо заново
  function replay(group, back) {
    const ops = back ? group.ops.slice().reverse() : group.ops;
    for (const op of ops) {
      const a = back ? op.un : op.a, before = clone(S), r = commit(a);
      if (!r || !r.ok) break;
      if (back) op.a = inverseOf(a, before) || op.a; else op.un = inverseOf(a, before) || op.un;
    }
  }
  function hammerAt(px, py, dragging) {
    const s = view, hit = fenceAtPoint(px, py), [x, y] = pick(px, py), b = K.at(s, x, y), key = hit ? 'f' + hit.x + ':' + hit.y + ':' + hit.e : x + ':' + y;
    if (gest && gest.tile === key) return; if (gest) gest.tile = key;
    const sh = slotHit(px, py); if (sh) { if (gest && gest.tile === 's' + sh.key) return; if (gest) gest.tile = 's' + sh.key; doAct({ t: 'sdeco', x: sh.x, y: sh.y, sl: sh.sl, off: 1, full: 1 }); return; }
    const bh = benchAtPoint(px, py); if (bh && (!gest || gest.bk !== bh.ex + ':' + bh.ey)) { if (gest) gest.bk = bh.ex + ':' + bh.ey; doAct({ t: 'ebench', x: bh.ex, y: bh.ey, e: bh.e, off: 1, full: 1 }); return; }
    if (hit && (hit.d < 7 * cam.z || !b)) { doAct({ t: 'fence', x: hit.x, y: hit.y, e: hit.e, off: 1, full: 1 }); return; }
    if (s.d[K.idx(x, y)]) { doAct({ t: 'undeco', x, y, full: 1 }); return; }
    if (b && !dragging) { if (b.k === 'home' || b.k === 'barn') toast(B[b.k].n + ': не знести, її можна пересунути', true); else doAct({ t: 'demolish', id: b.id }); }
  }
  $('mBuild').addEventListener('click', () => { au(); applyDraft(); tool = null; cancelPlace(); toolUI(); go('build'); });
  $('mHammer').addEventListener('click', () => { au(); setTool('hammer'); });
  $('mMove').addEventListener('click', () => { au(); setTool('move'); });
  $('mDone').addEventListener('click', () => { au(); exitBuild(); });
  $('mUndo').addEventListener('click', () => { au(); applyDraft(); const g0 = hist.pop(); if (g0) { replay(g0, true); redo.push(g0); } toolUI(); });
  $('mRedo').addEventListener('click', () => { au(); const g0 = redo.pop(); if (g0) { replay(g0, false); hist.push(g0); } toolUI(); });
  let stroke = 0;
  // «Назад» (жест від краю екрана, кнопка телефона): вікно → режим розміщення → меню хутора → вихід на головну
  window.gameBack = () => {
    if (sheetFn) { closeSheet(); return true; }
    if (placing || tool) { tool = null; cancelPlace(); toolUI(); return true; }
    if (buildOn) { exitBuild(); return true; }
    if (mode) { showMenu(); return true; }
    return false;
  };
  let backArmed = false;
  function armBack() { if (backArmed || window.Capacitor) return; backArmed = true; try { history.pushState({ khutir: 1 }, ''); } catch (e) {} }
  addEventListener('pointerdown', armBack, { capture: true });   // браузер пропускає такі записи без дотику користувача
  addEventListener('popstate', () => { if (window.gameBack()) { backArmed = false; armBack(); } else history.back(); });
  const free = (s, x, y) => K.owned(s, x, y) && !K.at(s, x, y) && !s.ob[K.idx(x, y)] && !s.d[K.idx(x, y)];

  // ================= торкання карти =================
  function tapVillager(px, py) {
    let best = null, bd = 18 * Math.max(0.8, cam.z);
    for (const p of vpos) { const d = Math.hypot(p.sx - px, p.sy - 12 * cam.z - py); if (d < bd) { bd = d; best = p; } }
    if (!best) return false;
    villFor = best.uid; lookDraft = null; openSheet('🧑‍🌾 ' + view.vl[best.uid].n, villSheet); return true;
  }
  function tapTile(x, y) {
    const s = view; if (!s) return;
    if (x < 0 || y < 0 || x >= N || y >= N) { closeSheet(); return; }
    if (!placing && s.ob[K.idx(x, y)] === 'F') { openSheet('🌲 Ліс', forestSheet); return; }
    if (placing) {
      if (placing.startsWith('deco:')) {
        const k = placing.slice(5); if (k === 'fence' || k === 'bench' || K.DECOR[k].small) return;
        if (!free(s, x, y)) { if (!painting) toast(K.owned(s, x, y) ? 'Тут зайнято' : 'Це не твоя земля', true); return; }
        const r = doAct({ t: 'deco', k, x, y });
        if (r && r.ok && K.DECOR[k].shop === false && !view.inv[k]) { cancelPlace(); toolUI(); }
        return;
      }
      if (!free(s, x, y)) { toast(K.owned(s, x, y) ? 'Тут зайнято' : 'Це не твоя земля', true); return; }
      const r = doAct({ t: 'build', k: placing, x, y });
      if (r && r.ok && (B[placing].one || !K.canAfford(view, K.buildCost(view, placing)))) { cancelPlace(); toolUI(); }
      return;
    }
    const b = K.at(s, x, y);
    if (b) {
      if (b.buf && !b.h && !sheetFn) { const r = commit({ t: 'collect', id: b.id }); if (r && r.ok) return; }
      sel = b.id; openSheet(B[b.k].ic + ' ' + B[b.k].n + (B[b.k].d ? ' · рів. ' + b.lv : b.k === 'home' && s.vl && s.vl[b.o] ? ' · ' + s.vl[b.o].n : ''), bSheet); return;
    }
    if (!K.owned(s, x, y)) {
      const c = K.chunkOf(x, y), cost = K.chunkCost(s);
      openSheet('🗺 Нова земля', () => '<p class="note">Ділянка 4×4. Купувати можна лише поруч зі своєю землею. Там можуть рости дерева (дають колоди) і лежати камені.</p><div class="btns"><button class="btn" data-a="' + A({ t: 'chunk', c }) + '"' + (K.canAfford(view, cost) ? '' : ' disabled') + '>Купити за ' + costTxt(K.chunkCost(view)) + '</button></div>');
      return;
    }
    const dk = s.d[K.idx(x, y)];
    if (dk) { const d = K.DECOR[dk]; openSheet(d.ic + ' ' + d.n, () => '<p class="note">+' + d.b + ' краси.</p><div class="btns">' + (d.turn ? '<button class="btn sec" data-a="' + A({ t: 'turn', x, y }) + '">🔄 Повернути</button>' : '') + '<button class="btn red" data-a="' + A({ t: 'undeco', x, y }) + '">🗑 Прибрати<small>' + (d.shop === false ? 'повернеться в запас' : 'повернеться ' + Math.floor(d.c / 2) + ' 💰') + '</small></button></div>'); return; }
    const ob = s.ob[K.idx(x, y)];
    if (ob === 't') { closeSheet(); commit({ t: 'clear', x, y }); return; }
    if (ob === 'r') { openSheet('🪨 Камінь', () => '<p class="note">Заважає будувати. Прибрати коштує ' + K.ROCK + ' 💰.</p><div class="btns"><button class="btn" data-a="' + A({ t: 'clear', x, y }) + '"' + (view.coins >= K.ROCK ? '' : ' disabled') + '>Прибрати · ' + K.ROCK + ' 💰</button></div>'); return; }
    sel = null; if (!buildOn) enterBuild(); else go('build');
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
  // найближча межа клітинок до точки екрана; lock — тримати один напрямок, поки ведеш пальцем
  function edgeAt(px, py, lock) {
    const X = (px - W / 2) / cam.z + cam.x, Y = (py - H / 2) / cam.z + cam.y, a = (2 * X) / TW, b = (2 * Y) / TH, fx = (a + b) / 2, fy = (b - a) / 2;
    const tx = Math.round(fx), ty = Math.round(fy), dx = fx - tx, dy = fy - ty;
    const e = lock !== undefined ? lock : Math.abs(dx) > Math.abs(dy) ? 0 : 1;
    return e ? [tx, dy >= 0 ? ty : ty - 1, 1] : [dx >= 0 ? tx : tx - 1, ty, 0];
  }
  // секція тину під пальцем: міряємо до намальованої висоти тину, а не до землі
  function fenceAtPoint(px, py) {
    const s = view; let best = null, bd = 16 * Math.max(0.8, cam.z);
    for (const k in s.f) {
      const e = k % 2, i = (k - e) / 2, x = i % N, y = Math.floor(i / N);
      const ax = x + 0.5, ay = e ? y + 0.5 : y - 0.5, bx = e ? x - 0.5 : x + 0.5, by = y + 0.5;
      const X0 = sx(ax, ay), Y0 = sy(ax, ay) - 8 * cam.z, X1 = sx(bx, by), Y1 = sy(bx, by) - 8 * cam.z;
      const L = (X1 - X0) ** 2 + (Y1 - Y0) ** 2, t = Math.max(0, Math.min(1, ((px - X0) * (X1 - X0) + (py - Y0) * (Y1 - Y0)) / L));
      const d = Math.hypot(px - (X0 + (X1 - X0) * t), py - (Y0 + (Y1 - Y0) * t));
      if (d < bd) { bd = d; best = { x, y, e, d }; }
    }
    return best;
  }
  // уся пряма лінія тину, що проходить через цю секцію
  function fenceLine(s, f) {
    const out = [f], walk = (dir) => { for (let n = 1; n < N; n++) { const x = f.x + (f.e ? dir * n : 0), y = f.y + (f.e ? 0 : dir * n); if (x < 0 || y < 0 || x >= N || y >= N || !s.f[K.fenceKey(x, y, f.e)]) break; out.push({ x, y, e: f.e }); } };
    walk(1); walk(-1); return out;
  }
  function fenceSheet(f) {
    const n = fenceLine(view, f).length, back = Math.floor(K.DECOR.fence.c / 2);
    openSheet('🪵 Тин', () => '<div class="btns"><button class="btn red" data-a="' + A({ t: 'fence', x: f.x, y: f.y, e: f.e, off: 1 }) + '">🗑 Прибрати цю секцію<small>повернеться ' + back + ' 💰</small></button>' + (n > 1 ? '<button class="btn red" id="fenceAll">🗑 Прибрати всю лінію (' + n + ')<small>повернеться ' + n * back + ' 💰</small></button>' : '') + '</div>');
    const all = $('fenceAll'); if (all) all.onclick = () => { if (fresh()) return; for (const q of fenceLine(view, f)) commit({ t: 'fence', x: q.x, y: q.y, e: q.e, off: 1 }); closeSheet(); };
  }
  // ---------- 8 точок на клітинці для дрібних прикрас ----------
  const SLOT = 0.34, slotOff = (sl) => [sl % 3 - 1, Math.floor(sl / 3) - 1];
  const smallPlacing = () => !!placing && placing.startsWith('deco:') && !!K.DECOR[placing.slice(5)].small;
  // найближча точка; lift — точка трохи вище пальця, щоб її було видно, поки ведеш
  function slotNear(px, py, lift) {
    const X = (px - W / 2) / cam.z + cam.x, Y = (py - (lift ? 44 : 0) - H / 2) / cam.z + cam.y, a = (2 * X) / TW, b = (2 * Y) / TH, fx = (a + b) / 2, fy = (b - a) / 2;
    const x = Math.round(fx), y = Math.round(fy); let ox = Math.max(-1, Math.min(1, Math.round((fx - x) / SLOT))), oy = Math.max(-1, Math.min(1, Math.round((fy - y) / SLOT)));
    if (!ox && !oy) { if (Math.abs(fx - x) > Math.abs(fy - y)) ox = fx >= x ? 1 : -1; else oy = fy >= y ? 1 : -1; }
    return { x, y, sl: (oy + 1) * 3 + ox + 1 };
  }
  function slotPos(x, y, sl) { const [ox, oy] = slotOff(sl); return [sx(x + ox * SLOT, y + oy * SLOT), sy(x + ox * SLOT, y + oy * SLOT)]; }
  function slotHit(px, py) {
    const s = view; let best = null, bd = 13 * Math.max(0.8, cam.z);
    for (const k in s.sd) { const sl = k % 9, i = (k - sl) / 9, x = i % N, y = Math.floor(i / N), [X, Y] = slotPos(x, y, sl), d = Math.hypot(px - X, py - (Y - 5 * cam.z)); if (d < bd) { bd = d; best = { key: +k, x, y, sl, k: s.sd[k] }; } }
    return best;
  }
  function slotSheet(q) {
    const d = K.DECOR[q.k]; openSheet(d.ic + ' ' + d.n, () => '<p class="note">+' + d.b + ' краси.</p><div class="btns"><button class="btn red" data-a="' + A({ t: 'sdeco', x: q.x, y: q.y, sl: q.sl, off: 1 }) + '">🗑 Прибрати<small>' + (d.shop === false ? 'повернеться в запас' : 'повернеться ' + Math.floor(d.c / 2) + ' 💰') + '</small></button></div>');
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

  // готові спрайти: основа (ромб клітинки) у файлі — 256 px завширшки; ax/ay — центр основи в пікселях файлу
  const SPR = {
    grass: { src: 'img/grass.webp', ax: 128, ay: 64, fit: 1.0 },
    home: { src: 'img/home.webp', ax: 130, ay: 147, fit: 1.15, ch: [143, 5] },
    coop: { src: 'img/coop.webp', ax: 128, ay: 140, fit: 1.1 },
    mill: { src: 'img/mill.webp', ax: 220, ay: 470, fit: 1.1 },
    millS: { src: 'img/millS.webp', ax: 220, ay: 470, fit: 1.1 },
    saw: { src: 'img/saw.webp', ax: 128, ay: 151, fit: 1.1 },
    lumber: { src: 'img/lumber.webp', ax: 128, ay: 110, fit: 1.1 },
    bakery: { src: 'img/bakery.webp', ax: 128, ay: 183, fit: 1.1, ch: [142, 43] },
    dairy: { src: 'img/dairy.webp', ax: 128, ay: 150, fit: 1.1 },
    cheese: { src: 'img/cheese.webp', ax: 128, ay: 150, fit: 1.1 },
    apiary: { src: 'img/apiary.webp', ax: 128, ay: 146, fit: 1.1 },
    press: { src: 'img/press.webp', ax: 128, ay: 162, fit: 1.1 },
    pastry: { src: 'img/pastry.webp', ax: 128, ay: 193, fit: 1.1, ch: [142, 43] },
    meadery: { src: 'img/meadery.webp', ax: 128, ay: 175, fit: 1.1, ch: [148, 41] },
    market: { src: 'img/market.webp', ax: 139, ay: 192, fit: 1.15 },
    d_bench0: { src: 'img/d_bench0.webp', ax: 108, ay: 212, fit: 0.5 },
    d_bench1: { src: 'img/d_bench1.webp', ax: 112, ay: 197, fit: 0.5 },
    d_swing: { src: 'img/d_swing.webp', ax: 104, ay: 251, fit: 0.667 },
    d_hay: { src: 'img/d_hay.webp', ax: 98, ay: 241, fit: 0.667 },
    d_crane: { src: 'img/d_crane.webp', ax: 141, ay: 243, fit: 0.667 },
    d_stork: { src: 'img/d_stork.webp', ax: 73, ay: 306, fit: 0.667 },
    barn2: { src: 'img/barn2.webp', ax: 139, ay: 192, fit: 1.15 },
    barn0: { src: 'img/barn0.webp', ax: 139, ay: 192, fit: 1.15 },
    barn1: { src: 'img/barn1.webp', ax: 139, ay: 192, fit: 1.15 },
    well: { src: 'img/well.webp', ax: 128, ay: 162, fit: 1.1 },
    soil: { src: 'img/soil.webp', ax: 128, ay: 66, fit: 1.02 },
    wheat0: { src: 'img/wheat0.webp', ax: 129, ay: 66, fit: 1.02 },
    wheat1: { src: 'img/wheat1.webp', ax: 129, ay: 92, fit: 1.02 },
    wheat2: { src: 'img/wheat2.webp', ax: 129, ay: 145, fit: 1.02 },
    wheat3: { src: 'img/wheat3.webp', ax: 129, ay: 145, fit: 1.02 },
    apple0: { src: 'img/apple0.webp', ax: 128, ay: 138, fit: 1.0 },
    apple1: { src: 'img/apple1.webp', ax: 128, ay: 239, fit: 1.0 },
    apple2: { src: 'img/apple2.webp', ax: 148, ay: 273, fit: 1.0 },
    apple3: { src: 'img/apple3.webp', ax: 148, ay: 273, fit: 1.0 },
    oak: { src: 'img/oak.webp', ax: 171, ay: 347, fit: 1.0 },
    spruce: { src: 'img/spruce.webp', ax: 116, ay: 482, fit: 1.0 },
    rock: { src: 'img/rock.webp', ax: 98, ay: 157, fit: 1.0 },
    rocks: { src: 'img/rocks.webp', ax: 110, ay: 131, fit: 1.0 },
    pebbles: { src: 'img/pebbles.webp', ax: 94, ay: 84, fit: 1.0 },
    bush0: { src: 'img/bush0.webp', ax: 32, ay: 60, fit: 1.0 },
    bush1: { src: 'img/bush1.webp', ax: 32, ay: 60, fit: 1.0 },
    bush2: { src: 'img/bush2.webp', ax: 25, ay: 55, fit: 1.0 },
    bush3: { src: 'img/bush3.webp', ax: 31, ay: 53, fit: 1.0 },
    bush5: { src: 'img/bush5.webp', ax: 26, ay: 50, fit: 1.0 },
    bush6: { src: 'img/bush6.webp', ax: 33, ay: 62, fit: 1.0 },
    bush7: { src: 'img/bush7.webp', ax: 34, ay: 60, fit: 1.0 },
    bush8: { src: 'img/bush8.webp', ax: 31, ay: 54, fit: 1.0 },
    bush10: { src: 'img/bush10.webp', ax: 30, ay: 47, fit: 1.0 },
    bush11: { src: 'img/bush11.webp', ax: 34, ay: 56, fit: 1.0 },
    bush12: { src: 'img/bush12.webp', ax: 32, ay: 52, fit: 1.0 },
    bush13: { src: 'img/bush13.webp', ax: 34, ay: 68, fit: 1.0 },
    bush14: { src: 'img/bush14.webp', ax: 38, ay: 60, fit: 1.0 },
    bush15: { src: 'img/bush15.webp', ax: 46, ay: 49, fit: 1.0 },
  };
  const BUSHES = ["bush0", "bush1", "bush2", "bush3", "bush5", "bush6", "bush7", "bush8", "bush10", "bush11", "bush12", "bush13", "bush14", "bush15"];
  for (const k in SPR) { const im = new Image(); im.src = SPR[k].src; SPR[k].im = im; }
  // покадрова анімація: кадри й налаштування — у anim.js
  const ANIM = window.KHUTIR_ANIM || {};
  for (const k in ANIM) {
    const a = ANIM[k]; if (!SPR[k]) continue; a.fr = []; a.bad = false;
    for (let i = 0; i < a.n; i++) { const im = new Image(); im.onerror = () => { a.bad = true; }; im.src = 'img/anim/' + k + '/' + i + '.' + (a.ext || 'webp'); a.fr.push(im); }
  }
  function frameOf(k, sp, busy, seed) {
    const a = ANIM[k]; if (!a || !a.fr || a.bad || (a.busy && !busy)) return sp.im;
    const im = a.fr[Math.floor(performance.now() / a.ms + (seed || 0) * 0.37) % a.n];
    return im && im.complete && im.naturalWidth ? im : sp.im;
  }
  function sprite(k, X, Y, z, sw, busy, seed) {
    const sp = SPR[k]; if (!sp || !sp.im.complete || !sp.im.naturalWidth) return false;
    const sc = (TW * z * sp.fit) / 256, im = frameOf(k, sp, busy, seed);
    g.imageSmoothingQuality = 'high';
    if (!sw || im !== sp.im) { g.drawImage(im, X - sp.ax * sc, Y - sp.ay * sc, sp.im.naturalWidth * sc, sp.im.naturalHeight * sc); return true; }
    g.save(); g.translate(X, Y); g.transform(1, 0, -sw, 1, 0, 0);
    g.drawImage(im, -sp.ax * sc, -sp.ay * sc, sp.im.naturalWidth * sc, sp.im.naturalHeight * sc);
    g.restore(); return true;
  }
  // вітер: повільні пориви, що біжать по карті
  const wind = (x, y, t, amp) => amp * (Math.sin(t / 900 + x * 0.6 + y * 0.35) * 0.7 + Math.sin(t / 2300 + x * 0.2) * 0.3);
  // дим із комина: клубочки піднімаються, ростуть і тануть
  function smoke(k, X, Y, z, t, seed) {
    const sp = SPR[k]; if (!sp || !sp.ch || !sp.im.naturalWidth) return;
    const sc = (TW * z * sp.fit) / 256, cx = X + (sp.ch[0] - sp.ax) * sc, cy = Y + (sp.ch[1] - sp.ay) * sc;
    for (let i = 0; i < 6; i++) {
      const ph = ((t / 2600 + i / 6 + seed * 0.37) % 1);
      const x = cx + Math.sin(ph * 5 + seed + i) * 3 * z + ph * 10 * z, y = cy - ph * 34 * z, r = (2 + ph * 6) * z;
      g.globalAlpha = 0.55 * (1 - ph) * Math.min(1, ph * 6);
      g.fillStyle = '#E9E4DA'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    g.globalAlpha = 1;
  }
  // бджілки над пасікою
  function bees(X, Y, z, t, seed) {
    g.fillStyle = '#2B2116';
    for (let i = 0; i < 5; i++) { const a = t / 380 + i * 1.3 + seed; g.beginPath(); g.arc(X + Math.cos(a) * 16 * z + Math.sin(a * 2.3) * 4 * z, Y - 22 * z + Math.sin(a * 1.6) * 8 * z, 1.3 * z, 0, 7); g.fill(); }
  }
  function drawHouse(cx, cy, z, wall, roof, ic, hut) {
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
    if (hut) {
      // вікно з віконницями на лівій стіні й солом'яні пасма на стрісі
      const wx0 = (L[0] + Bm[0]) / 2, wy0 = (L[1] + Bm[1]) / 2 - h * 0.55;
      g.fillStyle = '#5B86B0'; g.beginPath(); g.moveTo(wx0 - 4 * z, wy0 - 3 * z); g.lineTo(wx0 + 4 * z, wy0 + 1 * z); g.lineTo(wx0 + 4 * z, wy0 + 7 * z); g.lineTo(wx0 - 4 * z, wy0 + 3 * z); g.closePath(); g.fill();
      g.fillStyle = '#2F6EA5'; g.fillRect(wx0 - 7 * z, wy0 - 3 * z, 2.5 * z, 7 * z); g.fillRect(wx0 + 4.5 * z, wy0 + 1 * z, 2.5 * z, 7 * z);
      g.strokeStyle = 'rgba(120,85,30,.55)'; g.lineWidth = 1 * z;
      for (let i = 1; i < 6; i++) { const u = i / 6; g.beginPath(); g.moveTo(ax, ay + 2 * z); g.lineTo(L[0] - e + (Bm[0] - L[0] + e) * u, L[1] - h + e * 0.3 + (Bm[1] - L[1] + e * 0.7) * u); g.stroke(); g.beginPath(); g.moveTo(ax, ay + 2 * z); g.lineTo(Bm[0] + (R[0] + e - Bm[0]) * u, Bm[1] - h + e + (R[1] - Bm[1] - e * 0.7) * u); g.stroke(); }
    }
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
  // що росте на клітинці: дуб, ялина або молода яблуня-дичка
  function treeKind(x, y) { const h = h01(x + 7, y + 3); return h < 0.45 ? 'oak' : h < 0.85 ? 'spruce' : 'apple1'; }
  // декор на порожній траві: кущі й галька, лише для краси (будувати не заважає)
  function decor(x, y) { const h = h01(x + 31, y + 17); if (h < 0.07) return BUSHES[Math.floor(h01(x, y + 99) * BUSHES.length)]; if (h < 0.09) return 'pebbles'; return ''; }
  // стежка: вузька смуга через центр клітинки, тягнеться до сусідніх доріг
  const isRoad = (s, x, y) => { const k = s.d[K.idx(x, y)]; return k === 'path' || k === 'stone'; };
  function drawRoad(s, x, y, z, k, bmap) {
    const dirt = k === 'path', w = dirt ? 0.13 : 0.19, base = dirt ? '#A98354' : '#9A958A', dk = dirt ? '#8E6B42' : '#7C776D', lt = dirt ? '#BE9A69' : '#B7B2A6', edge = dirt ? 'rgba(70,50,25,.35)' : 'rgba(50,48,44,.4)';
    const quad = (pts) => { g.beginPath(); pts.forEach(([a, b], i) => (i ? g.lineTo(sx(a, b), sy(a, b)) : g.moveTo(sx(a, b), sy(a, b)))); g.closePath(); };
    const hub = [[x - w, y - w], [x + w, y - w], [x + w, y + w], [x - w, y + w]], arms = [];
    // до сусідньої дороги — рівно до краю клітинки; до будівлі — трохи під неї, щоб стежка впиралась у стіну
    const reach = (a, b) => { if (isRoad(s, a, b)) return 0.5; const q = bmap.get(K.idx(a, b)); return q && q.k !== 'field' ? 0.72 : 0; };
    const px = reach(x + 1, y), nx = reach(x - 1, y), py = reach(x, y + 1), ny = reach(x, y - 1);
    if (px) arms.push([[x, y - w], [x + px, y - w], [x + px, y + w], [x, y + w]]);
    if (nx) arms.push([[x, y - w], [x - nx, y - w], [x - nx, y + w], [x, y + w]]);
    if (py) arms.push([[x - w, y], [x - w, y + py], [x + w, y + py], [x + w, y]]);
    if (ny) arms.push([[x - w, y], [x - w, y - ny], [x + w, y - ny], [x + w, y]]);
    g.strokeStyle = edge; g.lineWidth = 2.5 * z; g.lineJoin = 'round';
    for (const q of arms.concat([hub])) { quad(q); g.stroke(); }
    g.fillStyle = base; for (const q of arms.concat([hub])) { quad(q); g.fill(); }
    const specks = (a0, b0, a1, b1, seed) => { for (let i = 0; i < 3; i++) { const f = h01(seed + i, x * 7 + y), o = (h01(y * 3 + i, seed + x) - 0.5) * w * 1.5, a = a0 + (a1 - a0) * f + (b1 !== b0 ? o : 0), b = b0 + (b1 - b0) * f + (a1 !== a0 ? o : 0); g.fillStyle = i % 2 ? dk : lt; g.fillRect(sx(a, b) - 1.5 * z, sy(a, b) - 0.6 * z, 3 * z, 1.2 * z); } };
    if (px) specks(x, y, x + 0.5, y, 1); if (nx) specks(x, y, x - 0.5, y, 2);
    if (py) specks(x, y, x, y + 0.5, 3); if (ny) specks(x, y, x, y - 0.5, 4);
  }
  // дрібні прикраси — піксельні, як селянин; їх можна замінити спрайтами img/<назва>.webp у SPR
  const decoCache = {};
  function pxDeco(k) {
    if (decoCache[k]) return decoCache[k];
    const c = document.createElement('canvas'), W0 = 32, H0 = 40; c.width = W0; c.height = H0;
    const q = c.getContext('2d'), R = (col, x, y, w, h) => { q.fillStyle = col; q.fillRect(x, y, w, h); };
    if (k === 'lantern') { R('#3A3030', 15, 12, 2, 24); R('#3A3030', 12, 35, 8, 2); R('#3A3030', 11, 5, 10, 2); R('#FFD36B', 12, 7, 8, 7); R('#FFF0B8', 14, 8, 3, 4); R('#3A3030', 11, 14, 10, 1); R('#3A3030', 15, 2, 2, 3); }
    if (k === 'pot') { R('#B5592E', 12, 8, 8, 2); R('#C96B3A', 13, 10, 6, 3); R('#C96B3A', 9, 13, 14, 16); R('#C96B3A', 11, 29, 10, 4); R('#8E4522', 9, 13, 3, 16); R('#F3E3C3', 9, 18, 14, 2); R('#3B6E8F', 12, 21, 2, 3); R('#3B6E8F', 17, 21, 2, 3); R('#F3E3C3', 9, 26, 14, 1); }
    if (k === 'baba') { R('#8D8A80', 11, 3, 10, 9); R('#8D8A80', 9, 12, 14, 22); R('#6E6B62', 9, 12, 3, 22); R('#A5A296', 17, 13, 3, 17); R('#55524A', 13, 6, 2, 2); R('#55524A', 17, 6, 2, 2); R('#55524A', 14, 10, 4, 1); R('#6E6B62', 12, 21, 8, 2); R('#6E6B62', 11, 34, 10, 3); }
    const d = q.getImageData(0, 0, W0, H0).data, on = (x, y) => x >= 0 && y >= 0 && x < W0 && y < H0 && d[(y * W0 + x) * 4 + 3] > 200, e = [];
    for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) if (!on(x, y) && (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1))) e.push([x, y]);
    q.fillStyle = '#2A1C14'; for (const [x, y] of e) q.fillRect(x, y, 1, 1);
    return (decoCache[k] = c);
  }
  function drawDecor(s, x, y, X, Y, z, t) {
    const k = s.d[K.idx(x, y)];
    if (k === 'path' || k === 'stone') return;
    if (k === 'flower') { sprite(BUSHES[Math.floor(h01(x + 3, y + 9) * BUSHES.length)], X, Y + 3 * z, z, wind(x, y, t, 0.05)); return; }
    if (k === 'oak' || k === 'spruce') { sprite(k, X, Y + 4 * z, z * 0.6, wind(x, y, t, 0.025)); return; }
    // намальовані прикраси; поворот: парний — як є, непарний — дзеркально; лавка 2–3 — вид зі спини
    if (SPR['d_' + k] || k === 'bench') {
      const dr = (s.dr && s.dr[K.idx(x, y)]) || 0, key = k === 'bench' ? 'd_bench' + (dr >= 2 ? 1 : 0) : 'd_' + k;
      if (dr % 2) { g.save(); g.translate(X, Y); g.scale(-1, 1); sprite(key, 0, 2 * z, z); g.restore(); } else sprite(key, X, Y + 2 * z, z);
      return;
    }
    const im = pxDeco(k), c = 0.75 * z; g.imageSmoothingEnabled = false; g.drawImage(im, X - 16 * c, Y - 36 * c, 32 * c, 40 * c); g.imageSmoothingEnabled = true;
    if (k === 'lantern') lights.push([X, Y - 24 * z, 1.5]);
  }
  // тин на межі: e = 0 — край між (x,y) і (x+1,y), e = 1 — між (x,y) і (x,y+1)
  function drawFence(x, y, e, z) {
    const ax = x + 0.5, ay = e ? y + 0.5 : y - 0.5, bx = e ? x - 0.5 : x + 0.5, by = y + 0.5;
    const X0 = sx(ax, ay), Y0 = sy(ax, ay), X1 = sx(bx, by), Y1 = sy(bx, by);
    g.lineCap = 'butt'; g.strokeStyle = '#7A5230'; g.lineWidth = 1.5 * z;
    for (const h of [5, 9, 13]) { g.beginPath(); g.moveTo(X0, Y0 - h * z); g.lineTo(X1, Y1 - h * z); g.stroke(); }
    g.strokeStyle = '#9C7346'; g.lineWidth = 0.7 * z; g.beginPath(); g.moveTo(X0, Y0 - 9.5 * z); g.lineTo(X1, Y1 - 9.5 * z); g.stroke();
    const post = (px, py) => { g.fillStyle = '#5E3C1E'; g.fillRect(px - 1.5 * z, py - 16 * z, 3 * z, 17 * z); g.fillStyle = '#8A5A2B'; g.fillRect(px - 0.5 * z, py - 16 * z, 1 * z, 17 * z); };
    post(X0, Y0); post((X0 + X1) / 2, (Y0 + Y1) / 2); post(X1, Y1);
  }
  function drawSmall(x, y, q, z, t) {
    const [X, Y] = slotPos(x, y, q.sl);
    if (q.k === 'flower') { sprite(BUSHES[Math.floor(h01(x + q.sl * 3, y + 9) * BUSHES.length)], X, Y + z, z * 0.5, wind(x, y, t, 0.05)); return; }
    const im = pxDeco(q.k), c = 0.42 * z; g.imageSmoothingEnabled = false; g.drawImage(im, X - 16 * c, Y - 36 * c, 32 * c, 40 * c); g.imageSmoothingEnabled = true;
    if (q.k === 'lantern') lights.push([X, Y - 14 * z, 1]);
  }
  function drawBench(q, z) {
    const X = sx(q.px, q.py), Y = sy(q.px, q.py), key = 'd_bench' + (q.dr >= 2 ? 1 : 0);
    if (q.dr % 2) { g.save(); g.translate(X, Y); g.scale(-1, 1); sprite(key, 0, 2 * z, z); g.restore(); } else sprite(key, X, Y + 2 * z, z);
  }
  function benchAtPoint(px, py) {
    const s = view; let best = null, bd = 20 * Math.max(0.8, cam.z);
    for (const k in s.e) { const q = K.benchAt(+k, s.e[k]), d = Math.hypot(px - sx(q.px, q.py), py - (sy(q.px, q.py) - 8 * cam.z)); if (d < bd) { bd = d; best = q; } }
    return best;
  }
  function benchSheet(q) {
    const c = K.DECOR.bench.c, base = { t: 'ebench', x: q.ex, y: q.ey, e: q.e };
    openSheet('🪑 Лавка', () => '<div class="btns"><button class="btn sec" data-a="' + A({ ...base, turn: 1 }) + '">🔄 Розвернути</button><button class="btn red" data-a="' + A({ ...base, off: 1 }) + '">🗑 Прибрати<small>повернеться ' + Math.floor(c / 2) + ' 💰</small></button></div>');
  }
  // кибитка торговця: стоїть біля ринку, поки він приїхав
  function drawWagon(X, Y, z) {
    const R = (col, x, y, w, h) => { g.fillStyle = col; g.fillRect(X + x * z, Y + y * z, w * z, h * z); };
    R('#E9DFC8', -10, -24, 22, 12); R('#CFC3A6', -10, -24, 3, 12); R('#B5452E', -10, -14, 22, 2); R('#8A5A2B', -11, -12, 24, 5); R('#5E3C1E', -8, -7, 6, 6); R('#3A2517', -6, -5, 2, 2); R('#5E3C1E', 6, -7, 6, 6); R('#3A2517', 8, -5, 2, 2);
  }
  // поле: пшениця — намальована; решта культур поки кодом, колір і висота — свої
  const CROPLOOK = { corn: ['#6FAE3F', '#F2C14E', 1.3], sun: ['#5E9A3A', '#FFC93C', 1.4], beet: ['#3F8A3A', '#8E2A4E', 0.7], pump: ['#4F8F3A', '#F08A24', 0.55] };
  function drawField(cx, cy, z, grow, ripe, cr) {
    if (cr && cr !== 'wheat') {
      sprite('soil', cx, cy, z);
      const [leaf, fruit, tall] = CROPLOOK[cr], hgt = (3 + 12 * grow) * tall * z;
      g.lineCap = 'round';
      for (let i = 0; i < 9; i++) {
        const u = (i % 3) - 1, v = Math.floor(i / 3) - 1, px = cx + (u - v) * 9 * z, py = cy + (u + v) * 4.5 * z + 2 * z;
        g.strokeStyle = leaf; g.lineWidth = 2 * z; g.beginPath(); g.moveTo(px, py); g.lineTo(px, py - hgt); g.moveTo(px, py - hgt * 0.5); g.lineTo(px - 3 * z, py - hgt * 0.8); g.moveTo(px, py - hgt * 0.5); g.lineTo(px + 3 * z, py - hgt * 0.8); g.stroke();
        if (ripe || grow > 0.75) { g.fillStyle = fruit; g.beginPath(); g.arc(px, py - hgt, (cr === 'pump' ? 3.6 : 2.6) * z, 0, 7); g.fill(); }
      }
      return;
    }
    // мальовані стадії: паростки → зелена → жовтіє → стигла
    const st = ripe ? 'wheat3' : grow < 0.34 ? 'wheat0' : grow < 0.67 ? 'wheat1' : 'wheat2';
    if (sprite(st, cx, cy, z, st === 'wheat0' ? 0 : wind(cx / 40, cy / 40, performance.now(), 0.05))) return;
    const soil = sprite('soil', cx, cy, z);
    if (!soil) { g.fillStyle = '#8A5A35'; diamond(cx, cy, TW * 0.94 * z, TH * 0.94 * z); g.fill(); }
    g.strokeStyle = '#74492A'; g.lineWidth = 1.5 * z;
    if (!soil) for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(cx - TW * 0.22 * z + i * 6 * z, cy - TH * 0.11 * z - i * 3 * z + TH * 0.11 * z); g.lineTo(cx + TW * 0.22 * z + i * 6 * z - TW * 0.22 * z, cy + TH * 0.22 * z - i * 3 * z); g.stroke(); }
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
    g.fillStyle = warn ? 'rgba(58,37,23,.92)' : '#FFF6E0'; g.beginPath(); g.arc(cx, by, r, 0, 7); g.fill();
    g.beginPath(); g.moveTo(cx - 4 * z, by + r - 2 * z); g.lineTo(cx, by + r + 5 * z); g.lineTo(cx + 4 * z, by + r - 2 * z); g.fill();
    emoji(ic, cx, by + 1 * z, Math.round(14 * z));
    if (warn === true) { g.strokeStyle = '#FF6B6B'; g.lineWidth = 2 * z; g.beginPath(); g.moveTo(cx - 8 * z, by + 8 * z); g.lineTo(cx + 8 * z, by - 8 * z); g.stroke(); }
  }

  // селянин — піксельний: кадр малюється на маленькій сітці, контур додається сам, як у спрайтів світу
  const PXW = 28, PXH = 40, pxCache = new Map();
  const pxShade = (hex, f) => { const n = parseInt(hex.slice(1), 16), m = (v) => Math.max(0, Math.min(255, Math.round(v * f))); return 'rgb(' + m(n >> 16) + ',' + m((n >> 8) & 255) + ',' + m(n & 255) + ')'; };
  // кадри ходи: 0 стоїть, 1 крок, 2 стоїть, 3 другий крок; back — вид зі спини
  function pxFrame(c, fr, basket, back) {
    const L = K.LOOK, skin = L.skin[c.s] || L.skin[0], shirt = L.shirt[c.sh] || L.shirt[0], pants = L.pants[c.p] || L.pants[0];
    const fem = c.b === 1, key = [c.s, c.sh, c.p, c.st, c.h, c.b | 0, c.f | 0, fr, basket ? 1 : 0, back ? 1 : 0].join();
    if (pxCache.has(key)) return pxCache.get(key);
    const cv2 = document.createElement('canvas'); cv2.width = PXW; cv2.height = PXH;
    const q = cv2.getContext('2d'), R = (col, x, y, w, h) => { q.fillStyle = col; q.fillRect(x, y, w, h); };
    const up = fr === 1 || fr === 3 ? 1 : 0, sw = fr === 1 ? 2 : fr === 3 ? -2 : 0, dy = -up;
    const boot = '#4A2E1C', bootL = '#6B4428', red = '#C62828', hair = '#5A3A22', navy = '#1E2A44';
    const coat = c.st === 3, body = coat ? '#8A6239' : shirt, seam = pxShade(coat ? '#8A6239' : shirt, 0.84), low = coat ? 31 : 28;
    // дальня нога й рука темніші
    const sitF = fr === 4;
    const far = fem ? (fr === 1 ? 10 : fr === 3 ? 15 : 11) : fr === 1 ? 9 : fr === 3 ? 17 : 11, near = fem ? (fr === 1 ? 15 : fr === 3 ? 10 : 14) : fr === 1 ? 17 : fr === 3 ? 9 : 15;
    if (sitF) { R(pxShade(pants, 0.72), 12, 27, 11, 3); R(pxShade(boot, 0.8), 21, 28, 4, 6); }
    else { R(pxShade(pants, 0.72), far, 28, 4, 7 - up); R(pxShade(boot, 0.8), far, 34 - up, 5, 3); }
    R(pxShade(body, 0.72), 7 + sw, 18 + dy, 3, 8); R(pxShade(skin, 0.85), 7 + sw, 26 + dy, 3, 2);
    // ближня нога
    if (sitF) { R(pants, 12, 28, 12, 3); R(boot, 22, 30, 4, 6); R(bootL, 23, 30, 2, 1); }
    else { R(pants, near, 28, 4, 7); R(pxShade(pants, 0.84), near, 28, 1, 6); R(boot, near, 34, 5, 3); R(bootL, near + 1, 34, 3, 1); }
    // спідниця з вишитим подолом
    if (fem && !sitF) { R(pants, 9, 27, 12, 3); R(pants, 8, 30, 14, 4); R(pxShade(pants, 0.84), 9, 27, 2, 3); R(pxShade(pants, 0.84), 8, 30, 2, 4); R(pxShade(pants, 1.15), 16, 28, 2, 5); R('#FFF6D5', 8, 33, 14, 1); R(red, 10, 33, 1, 1); R(red, 14, 33, 1, 1); R(red, 18, 33, 1, 1); }
    // тулуб
    R(body, 9, 17 + dy, 11, low - 17); R(seam, 9, 17 + dy, 2, low - 17);
    if (!back) R(pxShade(body, 1.08), 16, 18 + dy, 2, 7);
    if (c.st === 0) { R(seam, 14, 17 + dy, 1, 8); R('#6B4428', 9, 25 + dy, 11, 2); R('#4A2E1C', 9, 26 + dy, 11, 1); }
    if (c.st === 1) {
      if (!back) { R(red, 14, 17 + dy, 2, 7); R(navy, 14, 18 + dy, 1, 1); R(navy, 15, 20 + dy, 1, 1); R(navy, 14, 22 + dy, 1, 1); }
      else { R(red, 9, 18 + dy, 11, 1); R(navy, 11, 18 + dy, 1, 1); R(navy, 14, 18 + dy, 1, 1); R(navy, 17, 18 + dy, 1, 1); }
      R(red, 9, 25 + dy, 11, 2); R('#8E1B1B', 9, 26 + dy, 11, 1);
    }
    if (c.st === 2) {
      const vest = '#2E2A24'; if (back) R(vest, 9, 17 + dy, 11, 10); else { R(vest, 9, 17 + dy, 4, 10); R(vest, 17, 17 + dy, 3, 10); R('#57504A', 13, 19 + dy, 1, 7); R('#E3C16F', 17, 20 + dy, 1, 1); R('#E3C16F', 17, 23 + dy, 1, 1); }
    }
    if (coat) {
      R('#6B4A28', 9, 29 + dy, 11, 1);
      if (back) R('#6B4A28', 14, 17 + dy, 1, 13);
      else { R(shirt, 13, 17 + dy, 3, 4); R('#6B4A28', 14, 21 + dy, 1, 9); R('#E3C16F', 15, 23 + dy, 1, 1); R('#E3C16F', 15, 26 + dy, 1, 1); }
      R(red, 9, 24 + dy, 11, 1);
    }
    // голова
    R(skin, 10, 8 + dy, 10, 9); R(pxShade(skin, 0.86), 10, 8 + dy, 2, 9); R(pxShade(skin, 0.86), 12, 16 + dy, 7, 1);
    if (back) { R(hair, 10, 8 + dy, 10, 7); R(pxShade('#5A3A22', 0.8), 10, 8 + dy, 2, 7); }
    else {
      R('#2B1D14', 17, 11 + dy, 1, 2); R(pxShade(skin, 0.8), 19, 12 + dy, 2, 2); R('#E28B7A', 16, 14 + dy, 1, 1);
      R(hair, 10, 9 + dy, 3, 3);
      if (fem) R('#B5473F', 17, 15 + dy, 2, 1);
      else if ((c.f | 0) === 0) { R(hair, 15, 14 + dy, 6, 1); R(hair, 20, 15 + dy, 1, 1); }
      else if (c.f === 1) { R(hair, 12, 14 + dy, 9, 2); R(hair, 13, 16 + dy, 8, 2); R(hair, 15, 18 + dy, 5, 1); R(skin, 17, 14 + dy, 3, 1); }
    }
    // коса: збоку або по центру спини, зі стрічкою
    if (fem) { const bx = back ? 14 : 9; R(hair, 10, 8 + dy, 3, 5); if (back) R(hair, 10, 8 + dy, 10, 8); R(hair, bx, 13 + dy, 3, 11); R('#47301C', bx, 15 + dy, 3, 1); R('#47301C', bx, 18 + dy, 3, 1); R('#47301C', bx, 21 + dy, 3, 1); R(red, bx, 24 + dy, 3, 2); }
    // шапка
    if (c.h === 0) { R(hair, 10, 6 + dy, 10, 3); R(hair, 9, 7 + dy, 2, 4); if (!back) R(pxShade('#5A3A22', 1.25), 15, 6 + dy, 3, 1); }
    if (c.h === 1) { R('#E3C16F', 5, 7 + dy, 20, 2); R('#B5913F', 5, 8 + dy, 20, 1); R('#E3C16F', 9, 2 + dy, 12, 5); R('#F0D68F', 15, 3 + dy, 4, 1); R('#C9A24A', 9, 2 + dy, 2, 5); R('#B23A2E', 9, 5 + dy, 12, 2); }
    if (c.h === 2) { R('#37474F', 9, 4 + dy, 12, 4); R('#263238', 9, 4 + dy, 2, 4); R('#546E7A', 14, 4 + dy, 4, 1); R('#263238', 9, 7 + dy, 12, 1); if (!back) R('#1B2428', 19, 7 + dy, 6, 2); }
    if (c.h === 3) {
      R('#D32F2F', 9, 5 + dy, 12, 5); R('#D32F2F', 9, 10 + dy, 3, 7); R('#A32020', 9, 5 + dy, 2, 12);
      if (back) { R('#D32F2F', 10, 10 + dy, 10, 6); R('#A32020', 13, 16 + dy, 4, 2); }
      R('#FDD835', 13, 6 + dy, 1, 1); R('#FDD835', 17, 7 + dy, 1, 1); R('#FDD835', 15, 8 + dy, 1, 1); R('#FDD835', 10, 12 + dy, 1, 1);
    }
    if (c.h === 4) {
      R(hair, 10, 6 + dy, 10, 3); R(hair, 9, 7 + dy, 2, 9); if (back) R(hair, 10, 8 + dy, 10, 11);
      [['#E53935', 9], ['#FDD835', 12], ['#1E88E5', 15], ['#E53935', 18], ['#8E24AA', 21]].forEach(([col, x], n) => { R(col, x - 1, 5 + dy + (n % 2), 3, 3); R('#FFF6D5', x, 6 + dy + (n % 2), 1, 1); });
      R('#E53935', 8, 9 + dy, 1, 13); R('#1E88E5', 9, 11 + dy, 1, 12); R('#FDD835', 7, 10 + dy, 1, 9);
    }
    if (c.h === 5) { R('#1F1A17', 8, 1 + dy, 14, 8); R('#3A2F28', 8, 1 + dy, 14, 1); R('#3A2F28', 11, 3 + dy, 2, 1); R('#3A2F28', 16, 5 + dy, 2, 1); R('#3A2F28', 13, 7 + dy, 2, 1); }
    // ближня рука або кошик
    const sleeve = body, cuff = c.st === 1 ? red : pxShade(body, 0.84);
    if (basket) {
      R(sleeve, 19, 18 + dy, 3, 6); R(sleeve, 21, 22 + dy, 3, 3); R(skin, 23, 22 + dy, 2, 3);
      R('#B5823C', 19, 26 + dy, 8, 6); R('#8A5A2B', 19, 26 + dy, 8, 1); R('#8A5A2B', 20, 28 + dy, 6, 1); R('#8A5A2B', 20, 30 + dy, 6, 1); R('#E3C16F', 21, 25 + dy, 4, 1);
    } else { R(sleeve, 19 - sw, 18 + dy, 3, 8); R(pxShade(body, 0.84), 19 - sw, 18 + dy, 1, 8); R(cuff, 19 - sw, 25 + dy, 3, 1); R(skin, 19 - sw, 26 + dy, 3, 2); }
    // сокира: замах і удар
    if (fr === 5) { R('#6B4428', 21, 7, 2, 13); R('#9AA3AD', 20, 4, 6, 4); R('#D5DBE0', 24, 4, 2, 4); }
    if (fr === 6) { R('#6B4428', 20, 22, 7, 2); R('#9AA3AD', 24, 19, 4, 7); R('#D5DBE0', 26, 19, 2, 7); }
    // контур
    const im = q.getImageData(0, 0, PXW, PXH), d = im.data, on = (x, y) => x >= 0 && y >= 0 && x < PXW && y < PXH && d[(y * PXW + x) * 4 + 3] > 200;
    const edge = []; for (let y = 0; y < PXH; y++) for (let x = 0; x < PXW; x++) if (!on(x, y) && (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1))) edge.push([x, y]);
    q.fillStyle = '#2A1C14'; for (const [x, y] of edge) q.fillRect(x, y, 1, 1);
    pxCache.set(key, cv2); return cv2;
  }
  // q — контекст, (x,y) — точка під ногами, k — масштаб, c — вигляд, walk — чи йде, dir — ±1 куди дивиться, back — іде від нас
  function drawVillager(q, x, y, k, c, t, walk, dir, basket, back, sit, chop) {
    const fr = chop ? (Math.floor(t / 380) % 2 ? 5 : 6) : sit ? 4 : walk ? Math.floor(t / 130) % 4 : 0, cell = 0.6 * k, im = pxFrame(c, fr, basket, back);
    q.save(); q.translate(x, y); if (!sit) { q.fillStyle = 'rgba(0,0,0,.25)'; q.beginPath(); q.ellipse(0, 0, 6 * k, 2.2 * k, 0, 0, 7); q.fill(); }
    q.scale(dir < 0 ? -1 : 1, 1); q.imageSmoothingEnabled = false;
    q.drawImage(im, -14 * cell, -37.5 * cell, PXW * cell, PXH * cell);
    q.imageSmoothingEnabled = true; q.restore();
  }
  // де селянин зараз: хата → будівлі маршруту → хата; на кожній будівлі трохи стоїть
  function villPos(s, uid, rts, t, dt) {
    const v = s.vl[uid], h = v && s.b.find((b) => b.id === v.home); if (!h) return null;
    const r = rts[uid] || [], F = K.speedOf(v);
    if (v.rt) {
      const q = K.restPlan(s, v), T = K.tripOf(s, uid, r);
      if (q) {
        const ms = (q.len * 1000) / K.WALK / F, tt = (v.vp + dt) % T, out = tt < ms, ret = tt > T - ms;
        if (out || ret) { const c = alongLeg(out ? q.pts : q.pts.slice().reverse(), out ? tt / ms : (tt - (T - ms)) / ms); return { x: c[0], y: c[1], walk: true, dir: c[2] - c[3] >= 0 ? 1 : -1, basket: false, back: c[2] + c[3] < 0 }; }
        const dr = q.sp.dr !== undefined ? q.sp.dr : (s.dr && s.dr[q.sp.i]) || 0; return { x: q.sp.px === undefined ? q.sp.x : q.sp.px, y: q.sp.py === undefined ? q.sp.y : q.sp.py, walk: false, sit: true, swing: q.sp.k === 'swing', dir: dr % 2 ? -1 : 1, basket: false, back: q.sp.k === 'bench' && dr >= 2 };
      }
    }
    const plan = K.walkPlan(s, uid, r, !!v.fx), T = plan.ms / F;
    if (!plan.legs.length) { const a = t / 2600 + uid.length; return { x: h.x + 0.45 + Math.cos(a) * 0.25, y: h.y + 0.35 + Math.sin(a) * 0.25, walk: true, dir: Math.cos(a + 1.57) > 0 ? 1 : -1, basket: false, back: Math.cos(a) - Math.sin(a) < 0 }; }
    // ідемо за часом: кожна ділянка триває стільки, скільки її довжина за сталої швидкості
    let tt = (v.vp + dt) % T;
    for (const l of plan.legs) {
      const w = (l.len * 1000) / K.WALK / F, pz = (l.pause || K.PAUSE) / F;
      if (tt < w) { const c = alongLeg(l.pts, w ? tt / w : 1); return { x: c[0], y: c[1], walk: true, dir: c[2] - c[3] >= 0 ? 1 : -1, basket: l.bk, back: c[2] + c[3] < 0 }; }
      tt -= w;
      if (tt < pz) { const e = l.pts[l.pts.length - 1], c0 = l.pts[l.pts.length - 2]; return { x: e[0], y: e[1], walk: false, chop: !!l.axe, dir: e[0] - c0[0] - (e[1] - c0[1]) >= 0 ? 1 : -1, basket: l.bk, back: false }; }
      tt -= pz;
    }
    const e = plan.legs[0].pts[0]; return { x: e[0], y: e[1], walk: false, dir: 1, basket: false, back: false };
  }
  // точка на ламаній за часткою шляху; два останні числа — напрямок кроку
  function alongLeg(pts, w) {
    let tot = 0; const len = []; for (let i = 0; i + 1 < pts.length; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); len.push(l); tot += l; }
    let d = w * tot;
    for (let i = 0; i < len.length; i++) {
      if (d <= len[i] || i === len.length - 1) { const f = len[i] ? Math.min(1, d / len[i]) : 0, a = pts[i], b = pts[i + 1]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, b[0] - a[0], b[1] - a[1]]; }
      d -= len[i];
    }
    return [pts[0][0], pts[0][1], 1, 0];
  }
  let vpos = [], lights = [], bubbles = [], marks = [], overTop = [];
  function drawVill(p, s, z, t) {
    const X = sx(p.x, p.y), Y = sy(p.x, p.y), v = s.vl[p.uid];
    drawVillager(g, X, Y - (p.sit ? (p.swing ? 10 : 6) * z : 0), 1.25 * z, v.c, t, p.walk, p.dir, p.basket, p.back, p.sit, p.chop);
    if (p.sit) bubbles.push([X, Y - 8 * z, z * 0.7, '💤', 1]);
    vpos.push({ uid: p.uid, sx: X, sy: Y });
    const nt = darkness(t); if (nt.dark > 0.2) lights.push([X + 7 * z * p.dir, Y - 14 * z, 0.45]);
    if (mode === 'shared' || p.uid !== 'me') {
      const mine = p.uid === myUid(), on = mine || onlineUids.has(p.uid);
      g.font = '700 ' + Math.round(11 * Math.max(0.85, z)) + 'px Rubik,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'bottom';
      g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.55)'; g.strokeText(v.n, X, Y - 30 * z); g.fillStyle = mine ? '#FFC93C' : on ? '#FFFFFF' : 'rgba(255,255,255,.6)'; g.fillText(v.n, X, Y - 30 * z);
    }
  }

  // день і ніч — лише для краси: доба 20 хв, однакова для всіх; урожай росте однаково
  const DAY = 20 * 60e3;
  function darkness(t) { const sun = Math.sin(((t % DAY) / DAY) * 2 * Math.PI - Math.PI / 2); return { dark: Math.max(0, Math.min(1, (0.15 - sun) / 0.7)) * 0.62, dusk: Math.max(0, 1 - Math.abs(sun) / 0.3) }; }

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
    const bon = K.bonuses(s), rts = K.routes(s), vByTile = new Map();
    lights = []; vpos = []; bubbles = []; marks = []; overTop = []; const benches = new Map(); for (const k in s.e) { const q = K.benchAt(+k, s.e[k]), i = K.idx(q.x, q.y); (benches.get(i) || benches.set(i, []).get(i)).push(q); }
    for (const uid of s.vo || []) { const p = villPos(s, uid, rts, t, dt); if (!p) continue; p.uid = uid; const key = Math.floor(p.x + 0.5) + Math.floor(p.y + 0.5); if (!vByTile.has(key)) vByTile.set(key, []); vByTile.get(key).push(p); }
    const ownedSet = new Set(s.ch), fset = new Set(s.fo || []);
    const buyable = new Set();
    for (const c of s.ch) { const x = c % K.NC, y = Math.floor(c / K.NC); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < K.NC && Y < K.NC && !ownedSet.has(Y * K.NC + X)) buyable.add(Y * K.NC + X); } }
    for (const c of fset) buyable.delete(c);
    const tw = TW * z, th = TH * z, pad = 60 * z, smallP = smallPlacing();
    const slotsOf = new Map(); for (const k in s.sd) { const sl = k % 9, i = (k - sl) / 9, q = slotOff(sl); (slotsOf.get(i) || slotsOf.set(i, []).get(i)).push({ sl, k: s.sd[k], back: q[0] + q[1] < 0 }); }
    // земля
    for (let d = 0; d < 2 * N - 1; d++) for (let x = Math.max(0, d - N + 1); x <= Math.min(N - 1, d); x++) {
      const y = d - x, X = sx(x, y), Y = sy(x, y);
      if (X < -tw || X > W + tw || Y < -th - pad || Y > H + th + pad) continue;
      const c = K.chunkOf(x, y), own = ownedSet.has(c), hv = h01(x, y);
      const gr = SPR.grass.im;
      if (gr.complete && gr.naturalWidth) {
        // мальована трава; дзеркалимо через одну, щоб не було видно повторів
        if (hv < 0.5) g.drawImage(gr, X - tw / 2 - 0.5, Y - th / 2 - 0.5, tw + 1, th + 1);
        else { g.save(); g.translate(X, Y); g.scale(-1, 1); g.drawImage(gr, -tw / 2 - 0.5, -th / 2 - 0.5, tw + 1, th + 1); g.restore(); }
        if (!own && !fset.has(c)) { g.fillStyle = buyable.has(c) ? 'rgba(10,30,10,.38)' : 'rgba(10,25,10,.55)'; diamond(X, Y, tw + 0.6, th + 0.6); g.fill(); }
      } else {
        g.fillStyle = own ? (hv < 0.5 ? '#7DBE5A' : '#78B955') : buyable.has(c) ? (hv < 0.5 ? '#4F7A45' : '#4B7542') : (hv < 0.5 ? '#3C5C37' : '#395833');
        diamond(X, Y, tw + 0.6, th + 0.6); g.fill();
      }
      const dk0 = s.d[K.idx(x, y)];
      if (dk0 === 'path' || dk0 === 'stone') drawRoad(s, x, y, z, dk0, bmap);
      if (smallP && own) for (let sl = 0; sl < 9; sl++) if (sl !== 4) { const [dx, dy] = slotPos(x, y, sl); g.fillStyle = s.sd[K.idx(x, y) * 9 + sl] ? 'rgba(200,64,47,.55)' : 'rgba(255,255,255,.6)'; g.beginPath(); g.arc(dx, dy, 2.2 * z, 0, 7); g.fill(); }
      if (!dk0 && !bmap.has(K.idx(x, y)) && !s.ob[K.idx(x, y)] && decor(x, y) === 'pebbles') { g.globalAlpha = 0.85; sprite('pebbles', X, Y, z * 0.55); g.globalAlpha = 1; }
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
      if (X < -tw || X > W + tw || Y < -pad || Y > H + th + pad * 2) { if (x === Math.min(N - 1, d) && vByTile.has(d)) for (const p of vByTile.get(d)) drawVill(p, s, z, t); continue; }
      const i = K.idx(x, y), b = bmap.get(i), sls = slotsOf.get(i);
      if (sls) for (const q of sls) if (q.back) drawSmall(x, y, q, z, t);
      if (b) drawBuilding(b, X, Y, z, t, dt, bon, s);
      else if (s.ob[i] === 'F') sprite(h01(x + 2, y + 7) < 0.6 ? 'spruce' : 'oak', X, Y + 4 * z, z * 0.6);
      else if (s.ob[i] === 't' && sprite(treeKind(x, y), X, Y + 4 * z, z * (treeKind(x, y) === 'apple1' ? 0.8 : 0.6), wind(x, y, t, 0.025))) {}
      else if (s.ob[i] === 'r' && sprite(h01(x + 3, y + 11) < 0.5 ? 'rock' : 'rocks', X, Y + 6 * z, z * 0.8)) {}
      else if (s.ob[i] === 't') drawTree(X, Y, z, ownedSet.has(K.chunkOf(x, y)), 0);
      else if (s.ob[i] === 'r') drawRock(X, Y, z);
      else if (s.d[i]) drawDecor(s, x, y, X, Y, z, t);
      else if (!s.ob[i]) { const dk = decor(x, y); if (dk && dk !== 'pebbles') sprite(dk, X + (h01(x, y + 5) - 0.5) * 18 * z, Y + (h01(x + 5, y) - 0.5) * 8 * z, z, wind(x, y, t, 0.05)); }
      if (sls) for (const q of sls) if (!q.back) drawSmall(x, y, q, z, t);
      if (benches.has(i)) for (const q of benches.get(i)) drawBench(q, z);
      if (s.f[K.fenceKey(x, y, 0)]) drawFence(x, y, 0, z);
      if (s.f[K.fenceKey(x, y, 1)]) drawFence(x, y, 1, z);
      // селяни, що стоять на цій «діагоналі», — після неї, щоб не ховалися за будинками
      if (x === Math.min(N - 1, d) && vByTile.has(d)) for (const p of vByTile.get(d)) drawVill(p, s, z, t);
    }
    // крила млина вищі за сусідів, тож малюються поверх усіх будівель
    for (const [X, Y, zz, busy, id] of overTop) sprite('millS', X, Y, zz, 0, busy, id);
    // ніч
    const nt = darkness(t);
    if (nt.dusk > 0) { g.fillStyle = 'rgba(255,120,40,' + (0.13 * nt.dusk) + ')'; g.fillRect(0, 0, W, H); }
    if (nt.dark > 0.01) {
      g.fillStyle = 'rgba(10,16,48,' + nt.dark + ')'; g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'lighter';
      for (const [lx, ly, k] of lights) { const r = 26 * z * k, gr = g.createRadialGradient(lx, ly, 0, lx, ly, r); gr.addColorStop(0, 'rgba(255,190,90,' + (0.75 * nt.dark) + ')'); gr.addColorStop(1, 'rgba(255,150,60,0)'); g.fillStyle = gr; g.fillRect(lx - r, ly - r, 2 * r, 2 * r); }
      g.globalCompositeOperation = 'source-over';
    }
    for (const m of marks) m();
    if (gest && gest.sl) { const q = gest.sl, [X, Y] = slotPos(q.x, q.y, q.sl), busy2 = s.sd[K.idx(q.x, q.y) * 9 + q.sl] || !K.owned(s, q.x, q.y); g.strokeStyle = busy2 ? '#C8402F' : '#FFD76A'; g.lineWidth = 2.5 * z; g.beginPath(); g.arc(X, Y, 6 * z, 0, 7); g.stroke(); }
    if (gest && gest.drag) { const m = gest.drag, X = sx(m.x, m.y), Y = sy(m.x, m.y), ok = free(s, m.x, m.y) || (m.x === m.x0 && m.y === m.y0); g.fillStyle = ok ? 'rgba(120,230,120,.4)' : 'rgba(255,90,90,.45)'; diamond(X, Y, tw, th); g.fill(); g.globalAlpha = 0.7; if (m.b) { if (!sprite(m.b.k, X, Y, z)) emoji(B[m.b.k].ic, X, Y - 10 * z, Math.round(22 * z)); } else emoji(K.DECOR[m.dk].ic, X, Y - 8 * z, Math.round(20 * z)); g.globalAlpha = 1; }
    if (draft.size) { g.globalAlpha = 0.75; for (const q of draft.values()) drawFence(q.x, q.y, q.e, z); g.globalAlpha = 1; for (const q of draft.values()) { const a = q.e ? [q.x + 0.5, q.y + 0.5, q.x - 0.5, q.y + 0.5] : [q.x + 0.5, q.y - 0.5, q.x + 0.5, q.y + 0.5]; g.strokeStyle = '#FFC93C'; g.lineWidth = 2.5 * z; g.beginPath(); g.moveTo(sx(a[0], a[1]), sy(a[0], a[1])); g.lineTo(sx(a[2], a[3]), sy(a[2], a[3])); g.stroke(); } }
    for (const [bx, by, bz, ic, warn] of bubbles) bubble(bx, by, bz, t, ic, warn);
    // таблички на землі, яку можна купити
    for (const c of buyable) {
      const x = (c % K.NC) * K.CH + 1.5, y = Math.floor(c / K.NC) * K.CH + 1.5, X = sx(x, y), Y = sy(x, y);
      if (X < -40 || X > W + 40 || Y < -40 || Y > H + 40) continue;
      g.fillStyle = 'rgba(12,10,16,.65)'; g.beginPath(); g.roundRect ? g.roundRect(X - 22 * z, Y - 13 * z, 44 * z, 26 * z, 10 * z) : g.rect(X - 22 * z, Y - 13 * z, 44 * z, 26 * z); g.fill();
      emoji('🗺', X - 9 * z, Y, Math.round(13 * z)); g.fillStyle = '#FFC93C'; g.font = '800 ' + Math.round(15 * z) + 'px "Baloo 2",sans-serif'; g.fillText('+', X + 9 * z, Y + 1 * z);
    }
    if (sheetFn && villFor && rts[villFor]) { g.strokeStyle = 'rgba(255,201,60,.8)'; g.setLineDash([4 * z, 4 * z]); g.lineWidth = 2 * z; for (const b of rts[villFor]) { diamond(sx(b.x, b.y), sy(b.x, b.y), tw * 0.9, th * 0.9); g.stroke(); } g.setLineDash([]); }
    // вибрана будівля
    if (sel && sheetFn) { const b = s.b.find((q) => q.id === sel); if (b) { g.strokeStyle = '#FFC93C'; g.lineWidth = 2.5 * z; diamond(sx(b.x, b.y), sy(b.x, b.y), tw * 0.96, th * 0.96); g.stroke(); } }
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
    const busy = b.p >= 0;
    if (d.kind !== 'home' && d.kind !== 'orchard' && sprite(b.k, X, Y, z, 0, busy, b.id)) {
      if (d.wall) lights.push([X + 9 * z, Y - 8 * z, 0.7]);
      if (busy && SPR[b.k].ch) smoke(b.k, X, Y, z, t, b.id);
      if (busy && b.k === 'apiary') bees(X, Y, z, t, b.id);
      if (b.k === 'mill') overTop.push([X, Y, z, busy, b.id]);
    }
    else if (d.kind === 'barn') sprite(s.sl >= 3 ? 'barn2' : s.sl >= 1 ? 'barn1' : 'barn0', X, Y, z);
    else if (d.kind === 'field') { if (b.p < 0 && !b.buf) sprite('soil', X, Y, z); else drawField(X, Y, z, b.buf ? 1 : prog, b.buf > 0, b.cr); }
    else if (d.kind === 'orchard' && sprite(b.buf ? 'apple3' : 'apple2', X, Y, z, wind(b.x, b.y, t, 0.02))) {}
    else if (d.kind === 'orchard') { g.fillStyle = '#6DAF4E'; diamond(X, Y, TW * 0.9 * z, TH * 0.9 * z); g.fill(); drawTree(X - 12 * z, Y - 2 * z, z * 0.75, 1, b.buf ? 3 : Math.floor(prog * 3)); drawTree(X + 12 * z, Y - 2 * z, z * 0.75, 1, b.buf ? 3 : Math.floor(prog * 2)); drawTree(X, Y + 6 * z, z * 0.8, 1, b.buf ? 4 : Math.floor(prog * 3)); }
    else if (d.kind === 'well') drawWell(X, Y, z);
    else if (d.kind === 'home') { if (!sprite('home', X, Y, z)) drawHouse(X, Y, z, '#F4EFE4', '#C9A24A', '', true); else smoke('home', X, Y, z, t, b.id); lights.push([X - 10 * z, Y - 10 * z, 1]); }
    else if (d.kind === 'apiary') { g.fillStyle = '#88C463'; diamond(X, Y, TW * 0.9 * z, TH * 0.9 * z); g.fill(); drawHives(X, Y, z, t); }
    else { drawHouse(X, Y, z, d.wall, d.roof, d.ic); lights.push([X + 9 * z, Y - 8 * z, 0.7]); }
    if (d.kind === 'market') { const m = K.market(s, t); if (m && m.here) { drawWagon(X + 26 * z, Y + 10 * z, z); bubbles.push([X, Y, z, '🛒', false]); } }
    if (!d.d) return;
    // рівень, наймит і прогрес — у спільний прохід поверх усіх спрайтів, інакше їх ховає сусідня будівля
    if (b.lv > 1) marks.push(() => { g.fillStyle = 'rgba(12,10,16,.75)'; g.beginPath(); g.arc(X + 20 * z, Y + 4 * z, 7 * z, 0, 7); g.fill(); g.fillStyle = '#FFC93C'; g.font = '800 ' + Math.round(10 * z) + 'px "Baloo 2",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(b.lv, X + 20 * z, Y + 4.5 * z); });
    if (b.h) marks.push(() => emoji('🧑‍🌾', X - 20 * z, Y + 2 * z, Math.round(11 * z)));
    const out = RES[K.outOf(b)[0]].ic;
    if (b.buf && !b.h) bubbles.push([X, Y, z, out, false]);
    else if (b.p >= 0 && (d.kind !== 'field' || K.CROP[b.cr].d > 600)) {
      const w = 28 * z; marks.push(() => { g.fillStyle = 'rgba(12,10,16,.6)'; g.fillRect(X - w / 2, Y + 11 * z, w, 4 * z); g.fillStyle = '#7BD389'; g.fillRect(X - w / 2, Y + 11 * z, w * prog, 4 * z); });
    } else if (b.p < 0) { const w = K.why(s, b); if (w === 'sow') bubbles.push([X, Y, z * 0.8, '🌱', 1]); else if (w === 'queue') bubbles.push([X, Y, z * 0.8, out, 1]); }
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
    au(); cv.setPointerCapture && cv.setPointerCapture(e.pointerId); if (!ptr.size) stroke++;
    ptr.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
    if (ptr.size === 1) gest = { moved: false, cx: cam.x, cy: cam.y };
    if (ptr.size === 1 && smallPlacing()) gest.sl = slotNear(e.clientX, e.clientY, false);
    if (ptr.size === 1 && tool === 'move' && view && slotHit(e.clientX, e.clientY)) { const q = slotHit(e.clientX, e.clientY); gest.slotDrag = q; gest.sl = q; }
    else if (ptr.size === 1 && tool === 'move' && view) {
      const [x, y] = pick(e.clientX, e.clientY), b = K.at(view, x, y), dk = view.d[K.idx(x, y)];
      if (b || dk) gest.drag = { b, dk, x0: x, y0: y, x, y };
    }
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
    } else if (!gest.pinch && (gest.sl || gest.slotDrag) && ptr.size === 1) {
      if (Math.hypot(p.x - p.x0, p.y - p.y0) > 8) gest.moved = true;
      if (gest.moved) gest.sl = slotNear(p.x, p.y, true);
    } else if (!gest.pinch && gest.drag) {
      if (Math.hypot(p.x - p.x0, p.y - p.y0) > 8) gest.moved = true;
      const [x, y] = pick(p.x, p.y); gest.drag.x = x; gest.drag.y = y;
    } else if (!gest.pinch) {
      if (Math.hypot(p.x - p.x0, p.y - p.y0) > 8) gest.moved = true;
      if (gest.moved && ptr.size === 1 && tool === 'hammer') { hammerAt(p.x, p.y, true); return; }
      if (gest.moved && ptr.size === 1 && placing === 'deco:fence') {
        gest.sx = p.x0; gest.sy = p.y0; fenceDrag(p.x, p.y, gest);
      } else if (gest.moved && ptr.size === 1 && placing && placing.startsWith('deco:')) {
        const [x, y] = pick(p.x, p.y), key = x + ':' + y;
        if (gest.tile !== key) { gest.tile = key; painting = true; tapTile(x, y); painting = false; }
      } else if (gest.moved) { cam.x = gest.cx - (p.x - p.x0) / cam.z; cam.y = gest.cy - (p.y - p.y0) / cam.z; clampCam(); }
    }
  });
  const up = (e) => {
    const p = ptr.get(e.pointerId); ptr.delete(e.pointerId);
    if (!p || !gest) return;
    if (gest.sl && ptr.size === 0) {
      const q = gest.sl, m = gest.slotDrag; gest = null;
      if (m) { if (q.x !== m.x || q.y !== m.y || q.sl !== m.sl) doAct({ t: 'smove', from: m.key, x: q.x, y: q.y, sl: q.sl }); return; }
      doAct({ t: 'sdeco', k: placing.slice(5), x: q.x, y: q.y, sl: q.sl });
      if (placing && K.DECOR[placing.slice(5)].shop === false && !view.inv[placing.slice(5)]) { cancelPlace(); toolUI(); }
      return;
    }
    if (gest.drag && ptr.size === 0) {
      const m = gest.drag; gest = null; if (m.x === m.x0 && m.y === m.y0) return;
      doAct(m.b ? { t: 'move', id: m.b.id, x: m.x, y: m.y } : { t: 'move', x0: m.x0, y0: m.y0, x: m.x, y: m.y }); return;
    }
    if (!gest.moved && tool === 'hammer' && ptr.size === 0) { hammerAt(p.x, p.y, false); gest = null; return; }
    if (!gest.moved && !gest.pinch && ptr.size === 0 && performance.now() - p.t0 < 600) {
      const hit = view ? fenceAtPoint(p.x, p.y) : null;
      if (placing === 'deco:fence') { const [x, y, e] = edgeAt(p.x, p.y); gest = null; draftEdge(x, y, e); return; }
      if (placing === 'deco:bench') { const [x, y, e] = edgeAt(p.x, p.y), [tx, ty] = pick(p.x, p.y), dr = e ? (ty > y ? 1 : 3) : tx > x ? 0 : 2; gest = null; doAct({ t: 'ebench', x, y, e, dr }); return; }
      if (!placing && view && tapVillager(p.x, p.y)) return; const [x, y] = pick(p.x, p.y);
      const sh = !placing && view ? slotHit(p.x, p.y) : null; if (sh) { slotSheet(sh); ptr.size || (gest = null); return; }
      const bh = !placing && view ? benchAtPoint(p.x, p.y) : null; if (bh) { benchSheet(bh); ptr.size || (gest = null); return; }
      if (!placing && hit && (hit.d < 7 * cam.z || !K.at(view, x, y))) { fenceSheet({ x: hit.x, y: hit.y, e: hit.e }); ptr.size || (gest = null); return; }
      tapTile(x, y);
    }
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
    villLegs(uid) { return K.walkPlan(view, uid, K.routes(view)[uid] || []).legs.map((l) => l.pts); }, fenceAtPoint, fenceLine, get draftN() { return draft.size; }, get buildOn() { return buildOn; }, get histN() { return hist.length; }, get redoN() { return redo.length; }, commit, tapTile, warp(ms) { warp += ms; refreshView(true); }, refresh() { refreshView(true); }, startSolo, openShared, showMenu, go, closeSheet,
    pxFrame, K, screenOf(x, y) { return [sx(x, y), sy(x, y)]; }, get vpos() { return vpos; }, darkness, DAY, focus(x, y) { cam.x = wx(x, y); cam.y = wy(x, y); }, get sheetOpen() { return !!sheetFn; }, get placing() { return placing; }, me,
  };

  showMenu();
  if (qCode && hasNet) { $('mCode').value = qCode; if (me.name) openShared(qCode); else $('mErr').textContent = 'Впиши імʼя й натисни «Увійти»'; }
})();
