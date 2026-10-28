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
  function closeSheet() { $('sheet').classList.remove('open'); sheetFn = null; sel = null; buildAt = null; villFor = null; }
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
    bindVill();
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
    else if (what === 'vill') { const v = myV(); if (v) { villFor = myUid(); openSheet('🧑‍🌾 ' + v.n, villSheet); } }
  }
  $('bBuild').addEventListener('click', () => { au(); cancelPlace(); buildAt = null; sel = null; go('build'); });
  $('bStore').addEventListener('click', () => { au(); go('store'); });
  $('bVill').addEventListener('click', () => { au(); go('vill'); });
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
    if (b.k === 'home') { const v = s.vl && s.vl[b.o]; return '<p class="note">Тут живе <b>' + esc(v ? v.n : '?') + '</b>. Звідси селянин ходить по найближчих будівлях.</p>' + (b.o === myUid() ? '<div class="btns"><button class="btn" data-go="vill">🧑‍🌾 Мій селянин</button></div>' : ''); }
    if (!d.d) return '<p class="note">' + esc(d.hint || '') + '</p><div class="btns"><button class="btn red" data-a="' + A({ t: 'demolish', id: b.id }) + '">🗑 Знести<small>повернеться половина ціни</small></button></div>';
    const bon = K.bonuses(s).get(b.id) || 0, dur = K.durOf(b, K.bonuses(s)), cap = K.capOf(b), w = K.why(s, b);
    const rt = K.routes(s); let who = '';
    for (const u in rt) if (rt[u].some((q) => q.id === b.id)) who = s.vl[u].n;
    h += '<div class="row"><span class="ic">' + d.ic + '</span><span class="tx"><b>' + recipe(d) + '</b><small>цикл ' + secs(dur) + (bon ? ' · бонус сусідів +' + Math.round(bon * 100) + '%' : '') + (b.h ? ' · 🧑‍🌾 наймит збирає сам' : who ? ' · 🧑‍🌾 збирає ' + esc(who) : ' · далеко від хат — збирай сам') + '</small></span></div>';
    const st = b.p >= 0 ? '⏳ працює: ' + Math.floor((100 * b.p) / dur) + '%' : w === 'full' ? '✋ повно — збери' : w ? '💤 чекає: нема ' + RES[w].ic + ' ' + RES[w].n.toLowerCase() : '';
    h += '<div class="row"><span class="tx"><b>Готово: ' + b.buf + ' / ' + cap + ' ' + RES[d.out[0]].ic + '</b><small>' + st + '</small><span class="cap"><i class="' + (b.buf >= cap ? 'full' : '') + '" style="width:' + Math.min(100, (100 * b.buf) / cap) + '%"></i></span></span></div>';
    const uc = K.upCost(b), hc = K.hireCost(b);
    h += '<div class="btns">';
    if (b.buf) h += '<button class="btn" data-a="' + A({ t: 'collect', id: b.id }) + '">🧺 Зібрати ' + b.buf + ' ' + RES[d.out[0]].ic + '</button>';
    h += '<button class="btn' + (b.buf ? ' sec' : '') + '" data-a="' + A({ t: 'upgrade', id: b.id }) + '"' + (K.canAfford(s, uc) ? '' : ' disabled') + '>⬆ Рівень ' + (b.lv + 1) + '<small>' + costTxt(uc) + ' · швидше й більше місця</small></button>';
    void hc;
    h += '<button class="btn red" data-a="' + A({ t: 'demolish', id: b.id }) + '">🗑 Знести<small>повернеться половина ціни</small></button>';
    return h + '</div>';
  }
  let villFor = null, lookDraft = null;
  function villSheet() {
    const s = view, v = s.vl && s.vl[villFor]; if (!v) return '';
    const mine = villFor === myUid(), L = K.LOOK;
    if (!lookDraft || lookDraft.u !== villFor) lookDraft = { u: villFor, c: { ...v.c } };
    const c = lookDraft.c, r = (K.routes(s)[villFor] || []);
    let h = '<div class="row" style="justify-content:center;background:linear-gradient(#9FD07A,#6DAF4E)"><canvas id="villPv" width="120" height="140" style="width:120px;height:140px" aria-label="Вигляд селянина"></canvas></div>';
    h += '<div class="row"><span class="ic">🧺</span><span class="tx"><b>Обходить ' + r.length + ' з ' + K.route(v) + ' будівель · кошик ' + K.basket(v) + '</b><small>обхід за ' + secs(K.tripMs(v)) + ' · усього приніс ' + fmt(v.got || 0) + '. Працює й тоді, коли нікого нема.</small></span></div>';
    if (!mine) return h;
    const pick = (k, list, label) => '<div class="row"><span class="tx"><b>' + label + '</b><small>' + (k === 'st' || k === 'h' ? L[k === 'st' ? 'style' : 'hat'][c[k]] : '') + '</small></span><button class="sell" data-look="' + k + ':-1" aria-label="' + label + ': попередній">◀</button>' +
      (list ? '<span style="width:22px;height:22px;border-radius:50%;background:' + list[c[k]] + ';border:2px solid #fff;flex:none"></span>' : '') + '<button class="sell" data-look="' + k + ':1" aria-label="' + label + ': наступний">▶</button></div>';
    h += pick('sh', L.shirt, 'Сорочка') + pick('st', null, 'Одяг') + pick('p', L.pants, 'Штани') + pick('h', null, 'Шапка') + pick('s', L.skin, 'Обличчя');
    const changed = JSON.stringify(c) !== JSON.stringify(v.c);
    h += '<div class="btns"><button class="btn" data-a="' + A({ t: 'look', uid: villFor, c }) + '"' + (changed ? '' : ' disabled') + '>Вдягнути</button><button class="btn sec" id="moveHome">🏠 Перенести хату</button></div>';
    for (const k in K.VUP) { const cost = K.vupCost(v, k); h += '<button class="row' + (K.canAfford(s, cost) ? '' : ' off') + '" data-a="' + A({ t: 'vup', uid: villFor, k }) + '"><span class="ic">' + (k === 'rt' ? '🗺' : k === 'bk' ? '🧺' : '👢') + '</span><span class="tx"><b>' + K.VUP[k].n + ' · рів. ' + ((v.u[k] || 0) + 1) + '</b><small>' + K.VUP[k].d + '</small></span><span class="pr">' + costTxt(cost) + '</span></button>'; }
    return h;
  }
  function bindVill() {
    const pv = $('villPv'); if (pv && lookDraft) { const q = pv.getContext('2d'); q.clearRect(0, 0, 120, 140); drawVillager(q, 60, 124, 3.2, lookDraft.c, performance.now(), false, 1); }
    $('shB').querySelectorAll('[data-look]').forEach((el) => el.addEventListener('click', () => {
      if (fresh()) return;
      const [k, d] = el.dataset.look.split(':'), n = { s: K.LOOK.skin, sh: K.LOOK.shirt, p: K.LOOK.pants, st: K.LOOK.style, h: K.LOOK.hat }[k].length;
      lookDraft.c[k] = (lookDraft.c[k] + +d + n) % n; sfx('pick'); sheetFn();
    }));
    const mh = $('moveHome'); if (mh) mh.onclick = () => { if (fresh()) return; closeSheet(); placing = '@home'; $('place').hidden = false; $('placeT').textContent = 'Куди перенести хату?'; };
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
  function tapVillager(px, py) {
    let best = null, bd = 18 * Math.max(0.8, cam.z);
    for (const p of vpos) { const d = Math.hypot(p.sx - px, p.sy - 12 * cam.z - py); if (d < bd) { bd = d; best = p; } }
    if (!best) return false;
    villFor = best.uid; lookDraft = null; openSheet('🧑‍🌾 ' + view.vl[best.uid].n, villSheet); return true;
  }
  function tapTile(x, y) {
    const s = view; if (!s) return;
    if (x < 0 || y < 0 || x >= N || y >= N) { closeSheet(); return; }
    if (placing) {
      if (!free(s, x, y)) { toast(K.owned(s, x, y) ? 'Тут зайнято' : 'Це не твоя земля', true); return; }
      if (placing === '@home') { const r = commit({ t: 'movehome', uid: myUid(), x, y }); if (r && r.ok) cancelPlace(); return; }
      const r = commit({ t: 'build', k: placing, x, y });
      if (r && r.ok) { const k = placing; cancelPlace(); if (K.canAfford(view, K.buildCost(view, k)) && B[k].kind === 'field') toast('Ще поле? 🏗 → Поле'); }
      return;
    }
    const b = K.at(s, x, y);
    if (b) {
      if (b.buf && !b.h && !sheetFn) { const r = commit({ t: 'collect', id: b.id }); if (r && r.ok) return; }
      buildAt = null; sel = b.id; openSheet(B[b.k].ic + ' ' + B[b.k].n + (B[b.k].d ? ' · рів. ' + b.lv : b.k === 'home' && s.vl && s.vl[b.o] ? ' · ' + s.vl[b.o].n : ''), bSheet); return;
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

  // готові спрайти: основа (ромб клітинки) у файлі — 256 px завширшки; ax/ay — центр основи в пікселях файлу
  const SPR = {
    home: { src: 'img/home.webp', ax: 130, ay: 147, fit: 1.15 },
    coop: { src: 'img/coop.webp', ax: 128, ay: 140, fit: 1.1 },
    mill: { src: 'img/mill.webp', ax: 128, ay: 207, fit: 1.1 },
    saw: { src: 'img/saw.webp', ax: 128, ay: 151, fit: 1.1 },
    lumber: { src: 'img/lumber.webp', ax: 128, ay: 110, fit: 1.1 },
    bakery: { src: 'img/bakery.webp', ax: 128, ay: 183, fit: 1.1 },
    dairy: { src: 'img/dairy.webp', ax: 128, ay: 150, fit: 1.1 },
    cheese: { src: 'img/cheese.webp', ax: 128, ay: 150, fit: 1.1 },
    apiary: { src: 'img/apiary.webp', ax: 128, ay: 146, fit: 1.1 },
    press: { src: 'img/press.webp', ax: 128, ay: 162, fit: 1.1 },
    pastry: { src: 'img/pastry.webp', ax: 128, ay: 193, fit: 1.1 },
    meadery: { src: 'img/meadery.webp', ax: 128, ay: 175, fit: 1.1 },
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
  function sprite(k, X, Y, z) {
    const sp = SPR[k]; if (!sp || !sp.im.complete || !sp.im.naturalWidth) return false;
    const sc = (TW * z * sp.fit) / 256;
    g.imageSmoothingQuality = 'high';
    g.drawImage(sp.im, X - sp.ax * sc, Y - sp.ay * sc, sp.im.naturalWidth * sc, sp.im.naturalHeight * sc);
    return true;
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
  function drawField(cx, cy, z, grow, ripe) {
    // мальовані стадії: паростки → зелена → жовтіє → стигла
    if (sprite(ripe ? 'wheat3' : grow < 0.34 ? 'wheat0' : grow < 0.67 ? 'wheat1' : 'wheat2', cx, cy, z)) return;
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
    g.fillStyle = warn ? 'rgba(40,36,48,.9)' : '#FFFFFF'; g.beginPath(); g.arc(cx, by, r, 0, 7); g.fill();
    g.beginPath(); g.moveTo(cx - 4 * z, by + r - 2 * z); g.lineTo(cx, by + r + 5 * z); g.lineTo(cx + 4 * z, by + r - 2 * z); g.fill();
    emoji(ic, cx, by + 1 * z, Math.round(14 * z));
    if (warn) { g.strokeStyle = '#FF6B6B'; g.lineWidth = 2 * z; g.beginPath(); g.moveTo(cx - 8 * z, by + 8 * z); g.lineTo(cx + 8 * z, by - 8 * z); g.stroke(); }
  }

  // селянин: q — контекст, (x,y) — точка під ногами, k — масштаб, c — вигляд, walk — чи йде, dir — ±1 куди дивиться
  function drawVillager(q, x, y, k, c, t, walk, dir, basket) {
    const L = K.LOOK, skin = L.skin[c.s] || L.skin[0], shirt = L.shirt[c.sh] || L.shirt[0], pants = L.pants[c.p] || L.pants[0];
    const ph = walk ? Math.sin(t / 110) : 0, bob = walk ? Math.abs(Math.sin(t / 110)) * 0.8 * k : 0;
    q.save(); q.translate(x, y - bob); q.scale(dir < 0 ? -1 : 1, 1);
    q.fillStyle = 'rgba(0,0,0,.22)'; q.beginPath(); q.ellipse(0, bob, 4.5 * k, 1.8 * k, 0, 0, 7); q.fill();
    // ноги
    q.fillStyle = pants; q.fillRect(-2.6 * k + ph * 0.8 * k, -6 * k, 2.2 * k, 6 * k); q.fillRect(0.4 * k - ph * 0.8 * k, -6 * k, 2.2 * k, 6 * k);
    q.fillStyle = '#3B2A1E'; q.fillRect(-2.8 * k + ph * 0.8 * k, -1 * k, 2.6 * k, 1.2 * k); q.fillRect(0.3 * k - ph * 0.8 * k, -1 * k, 2.6 * k, 1.2 * k);
    // тулуб
    const coat = c.st === 3, len = coat ? 9.5 : 7;
    q.fillStyle = coat ? '#7A5532' : shirt; q.beginPath(); q.moveTo(-3.6 * k, -5.2 * k + (coat ? 2.5 * k : 0)); q.lineTo(3.6 * k, -5.2 * k + (coat ? 2.5 * k : 0)); q.lineTo(3 * k, -5.5 * k - len * k + 2 * k); q.lineTo(-3 * k, -5.5 * k - len * k + 2 * k); q.closePath(); q.fill();
    if (coat) { q.fillStyle = shirt; q.fillRect(-1 * k, -12 * k, 2 * k, 5 * k); }
    if (c.st === 1) { q.fillStyle = '#C62828'; q.fillRect(-0.6 * k, -12 * k, 1.2 * k, 4 * k); q.fillRect(-3 * k, -7.2 * k, 6 * k, 0.9 * k); q.fillRect(-3.3 * k, -10.5 * k, 1 * k, 1 * k); q.fillRect(2.3 * k, -10.5 * k, 1 * k, 1 * k); }
    if (c.st === 2) { q.fillStyle = '#2E2A24'; q.fillRect(-3.3 * k, -12 * k, 2 * k, 6.6 * k); q.fillRect(1.3 * k, -12 * k, 2 * k, 6.6 * k); }
    // руки
    q.fillStyle = coat ? '#7A5532' : shirt; q.fillRect(-4.6 * k, -11.5 * k - ph * 0.5 * k, 1.6 * k, 5 * k); q.fillRect(3 * k, -11.5 * k + ph * 0.5 * k, 1.6 * k, 5 * k);
    q.fillStyle = skin; q.fillRect(-4.6 * k, -6.7 * k - ph * 0.5 * k, 1.6 * k, 1.4 * k);
    if (basket) { q.fillStyle = '#B5823C'; q.beginPath(); q.moveTo(3 * k, -7 * k); q.lineTo(8 * k, -7 * k); q.lineTo(7.2 * k, -3.5 * k); q.lineTo(3.8 * k, -3.5 * k); q.closePath(); q.fill(); q.strokeStyle = '#8A5A2B'; q.lineWidth = 0.7 * k; q.beginPath(); q.arc(5.5 * k, -7 * k, 2.4 * k, Math.PI, 0); q.stroke(); q.fillStyle = '#F2C14E'; q.beginPath(); q.arc(5.5 * k, -7.3 * k, 1.6 * k, Math.PI, 0); q.fill(); }
    else { q.fillStyle = skin; q.fillRect(3 * k, -6.7 * k + ph * 0.5 * k, 1.6 * k, 1.4 * k); }
    // голова
    q.fillStyle = skin; q.beginPath(); q.arc(0, -15 * k, 3.2 * k, 0, 7); q.fill();
    q.fillStyle = '#2B1D14'; q.fillRect(1.2 * k, -15.6 * k, 0.9 * k, 0.9 * k);
    // шапка
    const hat = c.h;
    if (hat === 1) { q.fillStyle = '#E3C16F'; q.beginPath(); q.ellipse(0, -17 * k, 6 * k, 1.6 * k, 0, 0, 7); q.fill(); q.fillRect(-2.8 * k, -20.5 * k, 5.6 * k, 3.6 * k); q.fillStyle = '#B23A2E'; q.fillRect(-2.8 * k, -18.2 * k, 5.6 * k, 0.9 * k); }
    else if (hat === 2) { q.fillStyle = '#37474F'; q.beginPath(); q.arc(0, -16.5 * k, 3.4 * k, Math.PI, 0); q.fill(); q.fillRect(0, -17 * k, 5 * k, 1.2 * k); }
    else if (hat === 3) { q.fillStyle = '#D32F2F'; q.beginPath(); q.arc(0, -15.5 * k, 3.7 * k, Math.PI * 0.95, Math.PI * 2.05); q.lineTo(-1 * k, -11 * k); q.closePath(); q.fill(); q.fillStyle = '#FFEB3B'; q.beginPath(); q.arc(-1.5 * k, -17.5 * k, 0.7 * k, 0, 7); q.arc(1.5 * k, -17.8 * k, 0.7 * k, 0, 7); q.fill(); }
    else if (hat === 4) { const fl = ['#E53935', '#FDD835', '#1E88E5', '#E53935', '#8E24AA']; fl.forEach((f, i) => { q.fillStyle = f; q.beginPath(); q.arc(-3.4 * k + i * 1.7 * k, -18 * k - Math.sin(i / 4 * Math.PI) * 1.2 * k, 1.1 * k, 0, 7); q.fill(); }); q.strokeStyle = '#E53935'; q.lineWidth = 0.7 * k; q.beginPath(); q.moveTo(-3 * k, -16 * k); q.lineTo(-4.5 * k, -9 * k); q.stroke(); q.strokeStyle = '#1E88E5'; q.beginPath(); q.moveTo(-2.4 * k, -16 * k); q.lineTo(-3.3 * k, -9.5 * k); q.stroke(); }
    else if (hat === 5) { q.fillStyle = '#1F1A17'; q.fillRect(-3.4 * k, -22 * k, 6.8 * k, 6.4 * k); q.fillStyle = '#3A2F28'; q.fillRect(-3.4 * k, -22 * k, 6.8 * k, 1.2 * k); }
    else { q.fillStyle = '#4E342E'; q.beginPath(); q.arc(0, -16 * k, 3.3 * k, Math.PI, 0); q.fill(); }
    q.restore();
  }
  // де селянин зараз: хата → будівлі маршруту → хата; на кожній будівлі трохи стоїть
  function villPos(s, uid, rts, t, dt) {
    const v = s.vl[uid], h = v && s.b.find((b) => b.id === v.home); if (!h) return null;
    const r = rts[uid] || [], trip = K.tripMs(v);
    if (!r.length) { const a = t / 2600 + uid.length; return { x: h.x + 0.45 + Math.cos(a) * 0.25, y: h.y + 0.35 + Math.sin(a) * 0.25, walk: true, dir: Math.cos(a + 1.57) > 0 ? 1 : -1, basket: false }; }
    const pts = [h].concat(r, [h]), segs = pts.length - 1;
    const f = (((v.vp + dt) % trip) / trip) * segs, i = Math.min(segs - 1, Math.floor(f)), fr = f - i;
    const a = pts[i], b = pts[i + 1], w = Math.min(1, fr / 0.75);
    // підходить до краю клітинки, а не в середину будівлі
    const ox = 0.42, oy = 0.42;
    const x = a.x + ox + (b.x - a.x) * w, y = a.y + oy + (b.y - a.y) * w;
    const sxd = (b.x - a.x) - (b.y - a.y);
    return { x, y, walk: fr < 0.75, dir: sxd >= 0 ? 1 : -1, basket: i > 0 };
  }
  let vpos = [], lights = [], bubbles = [];
  function drawVill(p, s, z, t) {
    const X = sx(p.x, p.y), Y = sy(p.x, p.y), v = s.vl[p.uid];
    drawVillager(g, X, Y, 1.25 * z, v.c, t, p.walk, p.dir, p.basket);
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
    lights = []; vpos = []; bubbles = [];
    for (const uid of s.vo || []) { const p = villPos(s, uid, rts, t, dt); if (!p) continue; p.uid = uid; const key = Math.floor(p.x + 0.5) + Math.floor(p.y + 0.5); if (!vByTile.has(key)) vByTile.set(key, []); vByTile.get(key).push(p); }
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
      if (!bmap.has(K.idx(x, y)) && !s.ob[K.idx(x, y)] && decor(x, y) === 'pebbles') { g.globalAlpha = 0.85; sprite('pebbles', X, Y, z * 0.55); g.globalAlpha = 1; }
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
      const i = K.idx(x, y), b = bmap.get(i);
      if (b) drawBuilding(b, X, Y, z, t, dt, bon, s);
      else if (s.ob[i] === 't' && sprite(treeKind(x, y), X, Y + 4 * z, z * (treeKind(x, y) === 'apple1' ? 0.8 : 0.6))) {}
      else if (s.ob[i] === 'r' && sprite(h01(x + 3, y + 11) < 0.5 ? 'rock' : 'rocks', X, Y + 6 * z, z * 0.8)) {}
      else if (s.ob[i] === 't') drawTree(X, Y, z, ownedSet.has(K.chunkOf(x, y)), 0);
      else if (s.ob[i] === 'r') drawRock(X, Y, z);
      else if (!s.ob[i]) { const dk = decor(x, y); if (dk && dk !== 'pebbles') sprite(dk, X + (h01(x, y + 5) - 0.5) * 18 * z, Y + (h01(x + 5, y) - 0.5) * 8 * z, z); }
      // селяни, що стоять на цій «діагоналі», — після неї, щоб не ховалися за будинками
      if (x === Math.min(N - 1, d) && vByTile.has(d)) for (const p of vByTile.get(d)) drawVill(p, s, z, t);
    }
    // ніч
    const nt = darkness(t);
    if (nt.dusk > 0) { g.fillStyle = 'rgba(255,120,40,' + (0.13 * nt.dusk) + ')'; g.fillRect(0, 0, W, H); }
    if (nt.dark > 0.01) {
      g.fillStyle = 'rgba(10,16,48,' + nt.dark + ')'; g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'lighter';
      for (const [lx, ly, k] of lights) { const r = 26 * z * k, gr = g.createRadialGradient(lx, ly, 0, lx, ly, r); gr.addColorStop(0, 'rgba(255,190,90,' + (0.75 * nt.dark) + ')'); gr.addColorStop(1, 'rgba(255,150,60,0)'); g.fillStyle = gr; g.fillRect(lx - r, ly - r, 2 * r, 2 * r); }
      g.globalCompositeOperation = 'source-over';
    }
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
    if (d.kind !== 'home' && sprite(b.k, X, Y, z)) { if (d.wall) lights.push([X + 9 * z, Y - 8 * z, 0.7]); }
    else if (d.kind === 'field') drawField(X, Y, z, b.buf ? 1 : prog, b.buf > 0);
    else if (d.kind === 'orchard' && sprite(b.buf ? 'apple3' : 'apple2', X, Y, z)) {}
    else if (d.kind === 'orchard') { g.fillStyle = '#6DAF4E'; diamond(X, Y, TW * 0.9 * z, TH * 0.9 * z); g.fill(); drawTree(X - 12 * z, Y - 2 * z, z * 0.75, 1, b.buf ? 3 : Math.floor(prog * 3)); drawTree(X + 12 * z, Y - 2 * z, z * 0.75, 1, b.buf ? 3 : Math.floor(prog * 2)); drawTree(X, Y + 6 * z, z * 0.8, 1, b.buf ? 4 : Math.floor(prog * 3)); }
    else if (d.kind === 'well') drawWell(X, Y, z);
    else if (d.kind === 'home') { if (!sprite('home', X, Y, z)) drawHouse(X, Y, z, '#F4EFE4', '#C9A24A', '', true); lights.push([X - 10 * z, Y - 10 * z, 1]); }
    else if (d.kind === 'apiary') { g.fillStyle = '#88C463'; diamond(X, Y, TW * 0.9 * z, TH * 0.9 * z); g.fill(); drawHives(X, Y, z, t); }
    else { drawHouse(X, Y, z, d.wall, d.roof, d.ic); lights.push([X + 9 * z, Y - 8 * z, 0.7]); }
    if (!d.d) return;
    if (b.lv > 1) { g.fillStyle = 'rgba(12,10,16,.75)'; g.beginPath(); g.arc(X + 20 * z, Y + 4 * z, 7 * z, 0, 7); g.fill(); g.fillStyle = '#FFC93C'; g.font = '800 ' + Math.round(10 * z) + 'px "Baloo 2",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(b.lv, X + 20 * z, Y + 4.5 * z); }
    if (b.h) emoji('🧑‍🌾', X - 20 * z, Y + 2 * z, Math.round(11 * z));
    const out = RES[d.out[0]].ic;
    if (b.buf && !b.h) bubbles.push([X, Y, z, out, false]);
    else if (b.p >= 0 && d.kind !== 'field') {
      const w = 28 * z; g.fillStyle = 'rgba(12,10,16,.6)'; g.fillRect(X - w / 2, Y + 11 * z, w, 4 * z); g.fillStyle = '#7BD389'; g.fillRect(X - w / 2, Y + 11 * z, w * prog, 4 * z);
    } else if (b.p < 0) { const w = K.why(s, b); if (w && w !== 'full') bubbles.push([X, Y, z * 0.8, RES[w].ic, true]); }
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
    if (!gest.moved && !gest.pinch && ptr.size === 0 && performance.now() - p.t0 < 600) { if (!placing && view && tapVillager(p.x, p.y)) return; const [x, y] = pick(p.x, p.y); tapTile(x, y); }
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
    screenOf(x, y) { return [sx(x, y), sy(x, y)]; }, get vpos() { return vpos; }, darkness, DAY, focus(x, y) { cam.x = wx(x, y); cam.y = wy(x, y); }, get sheetOpen() { return !!sheetFn; }, get placing() { return placing; }, me,
  };

  showMenu();
  if (qCode && hasNet) { $('mCode').value = qCode; if (me.name) openShared(qCode); else $('mErr').textContent = 'Впиши імʼя й натисни «Увійти»'; }
})();
