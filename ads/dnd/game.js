/* Кошмар наяву — інтерфейс. Майстер (role dm) тримає стан у своїй presence (поле g),
   гравці (role pl) читають його й надсилають наміри списком q. Рушій — engine.js. */
(function () {
  'use strict';
  const R = window.DND, S = window.DND_STORY, E = window.DNDE;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sgn = R.sgn;
  const kd = (s) => String(s).replace(/(\d)d(\d)/g, '$1к$2');
  const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };

  const ME = { role: null, nick: '', key: '', cls: null, code: '', q: [] };
  const U = { tab: null, mode: 'move', sel: null, tgt: null, tgts: [], wi: -1, sp: null, lesQ: [], rollSeen: null, fxSeen: null,
    sig: '', ver: 0, ckSeen: null, ckOpen: false, cfg: null, turnKey: '', cbKey: '', override: false, autoAt: 0, toastQ: [], toastT: 0, joinedAt: 0, modalKind: null };
  let NET = null, AVAIL = null, G = null, peers = [], dmSeenAt = 0;

  /* ---------- звук ---------- */
  let AC = null, muted = LS.get('dnd_mute', false);
  function beep(kind) {
    if (muted) return;
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)();
      const t = AC.currentTime, o = AC.createOscillator(), gn = AC.createGain();
      o.connect(gn); gn.connect(AC.destination);
      const set = { dice: [520, 0.05, 'square'], hit: [180, 0.18, 'sawtooth'], miss: [300, 0.1, 'triangle'], turn: [660, 0.22, 'sine'], crit: [880, 0.3, 'square'] }[kind] || [440, 0.1, 'sine'];
      o.type = set[2]; o.frequency.setValueAtTime(set[0], t);
      if (kind === 'turn') o.frequency.exponentialRampToValueAtTime(990, t + set[1]);
      if (kind === 'hit') o.frequency.exponentialRampToValueAtTime(70, t + set[1]);
      gn.gain.setValueAtTime(0.08, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + set[1]);
      o.start(t); o.stop(t + set[1] + 0.02);
    } catch (e) {}
  }

  /* ---------- старт ---------- */
  function sessionName() { try { const s = JSON.parse(localStorage.getItem('games41_session') || 'null'); return s && s.username ? String(s.username) : ''; } catch (e) { return ''; } }
  const savedNick = LS.get('dnd_nick', '') || sessionName();
  $('dmName').value = savedNick; $('plName').value = savedNick;
  const save = LS.get('dnd_save', null);
  if (save && save.code && save.g && save.g.started) {
    $('btnResume').hidden = false;
    $('btnResume').textContent = '↺ Продовжити гру ' + save.code + ' — ' + (S.SCENES[save.g.sc] || S.SCENES[0]).t;
  }
  const soloSave = LS.get('dnd_solo', null);
  if (soloSave && soloSave.g && soloSave.g.bd && !soloSave.g.bd.end) {
    $('btnSoloResume').hidden = false;
    $('btnSoloResume').textContent = '↺ Продовжити соло — ' + (S.SCENES[soloSave.g.sc] || S.SCENES[0]).t;
  }
  $('btnSolo').addEventListener('click', () => { startErr(''); const n = nickFrom('plName'); if (!n) return; openSoloSetup(n); });
  $('btnSoloResume').addEventListener('click', () => {
    const s0 = LS.get('dnd_solo', null); if (!s0) return;
    Object.assign(ME, { role: 'pl', solo: true, nick: s0.nick, key: s0.key, code: 'соло', q: [] });
    E.G = s0.g; E.G.fx = []; E.busy = false; G = E.G; U.joinedAt = performance.now(); render(true);
  });
  function openSoloSetup(n) {
    U.solo = U.solo || { cls: 'fighter', mates: ['wizard', 'cleric'] };
    const f = U.solo;
    f.mates = f.mates.filter((c) => c !== f.cls);
    openModal('solo', '<p class="eyebrow">Соло з ботом-майстром</p><h2>Твій герой</h2><div class="classes" style="margin-top:8px">' +
      R.CLASS_IDS.map((id) => { const c = R.CLASSES[id]; return '<button type="button" class="cls' + (f.cls === id ? ' on' : '') + '" data-scls="' + id + '"><span class="avatar" style="background:' + c.col + '">' + c.ic + '</span><span class="grow"><b>' + c.n + '</b><small>' + esc(c.bio) + '</small></span></button>'; }).join('') +
      '</div><p class="eyebrow" style="margin-top:12px">Супутники-боти (можна жодного)</p><div class="chips">' +
      R.CLASS_IDS.filter((id) => id !== f.cls).map((id) => '<button type="button" data-smate="' + id + '" class="' + (f.mates.includes(id) ? 'on' : '') + '">' + R.CLASSES[id].ic + ' ' + R.CLASSES[id].n + '</button>').join('') +
      '</div><p class="muted">Радимо 2 супутники: сам на сам храм дуже небезпечний.</p><div class="row"><button class="btn2" type="button" data-sclose="1">Назад</button><button class="btn grow" type="button" data-sgo="1">Почати</button></div>');
    $('modalSheet').onclick = (e) => {
      const b = e.target.closest('button'); if (!b || U.modalKind !== 'solo') return;
      if (b.dataset.scls) f.cls = b.dataset.scls;
      else if (b.dataset.smate) f.mates = f.mates.includes(b.dataset.smate) ? f.mates.filter((c) => c !== b.dataset.smate) : f.mates.concat(b.dataset.smate);
      else if (b.dataset.sclose) { closeModal(); return; }
      else if (b.dataset.sgo) { $('modalSheet').onclick = null; closeModal(); startSolo(n, f.cls, f.mates); return; }
      openSoloSetup(n);
    };
  }
  function startSolo(n, cls, mates) {
    Object.assign(ME, { role: 'pl', solo: true, nick: n, key: E.keyOf(n), code: 'соло', cls, q: [] });
    E.G = E.blank(); E.G.dm = '🤖 Бот-майстер';
    E.G.chars[ME.key] = E.newChar(n, cls);
    mates.forEach((c) => E.apply({ t: 'bot', cls: c }, null, true));
    E.apply({ t: 'start' }, null, true);
    window.DNDBotDM.init(E, ME.key);
    E.dirty = false; E.G.v++; G = E.G; U.joinedAt = performance.now(); U.tab = 'story';
    persistSolo(); render(true);
  }
  function persistSolo() { if (ME.solo && E.G) LS.set('dnd_solo', { nick: ME.nick, key: ME.key, g: E.G, at: Date.now() }); }

  (async () => {
    const t = window.HNS_TRANSPORT;
    try { AVAIL = t && await t.ready() ? t : null; } catch (e) { AVAIL = null; }
    $('netNote').textContent = AVAIL ? 'Кожен грає зі свого телефона. Потрібен інтернет.' : 'Немає звʼязку з сервером. Для гри потрібен інтернет.';
    $('btnDm').disabled = $('btnPl').disabled = !AVAIL;
  })();
  function startErr(t) { $('startErr').textContent = t; $('startErr').hidden = !t; }
  function nickFrom(id) {
    const n = $(id).value.replace(/\s+/g, ' ').trim().slice(0, 16);
    if (n.length < 2) { startErr('Імʼя — хоча б 2 літери.'); return null; }
    LS.set('dnd_nick', n); return n;
  }
  function newCode() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; let s = ''; for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)]; return s; }
  async function join(code) {
    try { NET = await AVAIL.join(code); } catch (e) { startErr(e && e.message === 'full' ? 'У грі вже 10 людей.' : 'Не вдалося підключитись. Спробуй ще раз.'); NET = null; return false; }
    ME.code = code; U.joinedAt = performance.now(); location.hash = code;
    return true;
  }
  $('btnDm').addEventListener('click', async () => {
    startErr(''); const n = nickFrom('dmName'); if (!n || !AVAIL) return;
    ME.role = 'dm'; ME.nick = n; ME.key = E.keyOf(n);
    E.G = E.blank(); E.G.dm = n;
    if (!(await join(newCode()))) { ME.role = null; return; }
    NET.presence({ r: 'dm', n, g: E.G, h: Date.now() }); persist();
    render(true);
  });
  $('btnResume').addEventListener('click', async () => {
    startErr(''); const s = LS.get('dnd_save', null); if (!s || !AVAIL) return;
    ME.role = 'dm'; ME.nick = s.nick || $('dmName').value || 'Майстер'; ME.key = E.keyOf(ME.nick);
    E.G = s.g; E.G.fx = []; E.busy = false;
    if (!(await join(s.code))) { ME.role = null; return; }
    E.log('Майстер повернувся.', 'sys'); E.G.v++;
    NET.presence({ r: 'dm', n: ME.nick, g: E.G, h: Date.now() });
    render(true);
  });
  $('btnPl').addEventListener('click', async () => {
    startErr(''); const n = nickFrom('plName'); if (!n || !AVAIL) return;
    const code = $('plCode').value.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) { startErr('Код — 4 літери, його видно на телефоні майстра.'); return; }
    ME.role = 'pl'; ME.nick = n; ME.key = E.keyOf(n); ME.q = [];
    if (!(await join(code))) { ME.role = null; return; }
    NET.presence({ r: 'pl', n, cls: null, q: [] });
    render(true);
  });
  $('plCode').addEventListener('input', () => { $('plCode').value = $('plCode').value.toUpperCase().replace(/[^A-Z]/g, ''); });
  if (/^#[A-Z]{4}$/.test(location.hash)) $('plCode').value = location.hash.slice(1);
  $('lobLeave').addEventListener('click', leave);
  function leave() {
    if (NET) NET.leave(); NET = null; ME.role = null; ME.solo = false; G = null; E.G = null; location.hash = '';
    $('lobby').hidden = true; $('app').hidden = true; $('start').hidden = false; closeModal();
  }
  $('mute').addEventListener('click', () => { muted = !muted; LS.set('dnd_mute', muted); $('mute').textContent = muted ? '🔇' : '🔊'; });
  $('mute').textContent = muted ? '🔇' : '🔊';

  /* ---------- мережа ---------- */
  const dmPeer = () => peers.filter((p) => p.presence && p.presence.r === 'dm' && p.presence.g).sort((a, b) => (+a.presence.h || 0) - (+b.presence.h || 0))[0];
  const plPeers = () => peers.filter((p) => p.presence && p.presence.r === 'pl' && p.presence.n);
  const online = (k) => plPeers().some((p) => E.keyOf(p.presence.n) === k);
  function persist() { if (ME.role === 'dm' && E.G) LS.set('dnd_save', { code: ME.code, nick: ME.nick, g: E.G, at: Date.now() }); }
  function pushG() {
    if (ME.solo && E.G) { E.G.v++; E.dirty = false; persistSolo(); return; }
    if (!E.G || !NET) return;
    E.G.v++; E.dirty = false;
    NET.presence({ g: E.G }); persist();
  }
  // авто-хід чекає, поки догра анімація, — щоб було видно, хто що зробив
  const animIdle = () => !ANIM.cur && !ANIM.q.length;
  E.wait = (ms) => new Promise((r) => { const t0 = performance.now(); const f = () => ((performance.now() - t0 >= ms && animIdle()) || performance.now() - t0 > 7000 ? r() : setTimeout(f, 80)); f(); });
  E.onChange = () => { if (E.dirty) pushG(); G = E.G; render(); };
  function send(op) {
    if (ME.solo) {
      if (/^dm(next|pick|done)$/.test(op.t)) window.DNDBotDM.op(E, op); else E.apply(op, ME.key, false);
      if (E.dirty) pushG(); G = E.G;
    } else if (ME.role === 'dm') { E.apply(op, null, true); if (E.dirty) pushG(); G = E.G; }
    else {
      op.i = E.uid(); ME.q.push(op); if (ME.q.length > 10) ME.q.shift();
      if (NET) NET.presence({ q: ME.q });
    }
    clearSel(); U.ver++; render();
  }
  function tick() {
    if (ME.solo && E.G) {
      if (E.G.ck && E.G.ck.id !== U.botCk) { U.botCk = E.G.ck.id; U.botAt = performance.now() + 1600; }
      if (E.G.ck && !E.G.ck.done && performance.now() > (U.botAt || 0)) { if (E.botRolls()) U.botAt = performance.now() + 1400; }
      const cb = E.G.cb, t = E.cur(E.G);
      if (cb && t && (!t.ch || E.isBotTurn(E.G)) && !E.busy && !cb.won && !cb.lost) {
        const key = cb.round + ':' + cb.turn;
        if (U.autoKey !== key) { U.autoKey = key; U.autoAt = performance.now() + 1300; }
        else if (performance.now() > U.autoAt && animIdle()) { U.autoAt = Infinity; E.autoTurn(); }
      }
      window.DNDBotDM.step(E);
      if (E.dirty) pushG();
      G = E.G; render(); return;
    }
    if (!NET) return;
    peers = NET.peers();
    if (ME.role === 'dm') {
      const pls = plPeers().filter((p) => !p.isMe);
      E.syncChars(pls.map((p) => ({ n: p.presence.n, cls: p.presence.cls })));
      for (const p of pls) {
        const k = E.keyOf(p.presence.n);
        for (const op of p.presence.q || []) {
          if (!op || !op.i || E.G.pid.includes(op.i)) continue;
          E.G.pid.push(op.i); if (E.G.pid.length > 160) E.G.pid.splice(0, 60);
          E.apply(op, k, false);
        }
      }
      // боти кидають перевірки (з паузою, щоб було видно)
      if (E.G.ck && E.G.ck.id !== U.botCk) { U.botCk = E.G.ck.id; U.botAt = performance.now() + 1600; }
      if (E.G.ck && !E.G.ck.done && performance.now() > (U.botAt || 0)) { if (E.botRolls()) U.botAt = performance.now() + 1400; }
      // монстри (якщо ввімкнено) і боти-гравці ходять самі
      const cb = E.G.cb, t = E.cur(E.G);
      if (cb && t && ((cb.auto && !t.ch) || E.isBotTurn(E.G)) && !E.busy && !cb.won && !cb.lost) {
        const key = cb.round + ':' + cb.turn;
        if (U.autoKey !== key) { U.autoKey = key; U.autoAt = performance.now() + 1300; }
        else if (performance.now() > U.autoAt && animIdle()) { U.autoAt = Infinity; E.autoTurn(); }
      }
      if (E.dirty) pushG();
      G = E.G;
    } else {
      const dm = dmPeer();
      if (dm) { G = dm.presence.g; dmSeenAt = performance.now(); }
      if (ME.role === 'pl' && G && G.started && G.chars && !G.chars[ME.key] && plPeers().some((p) => p.isMe && p.presence.cls)) { /* чекаємо, поки майстер створить героя */ }
    }
    render();
  }
  setInterval(tick, 150);

  /* ---------- рендер ---------- */
  function render(force) {
    if (!ME.role) return;
    const started = G && G.started;
    $('start').hidden = true;
    if (!started) { $('app').hidden = true; $('lobby').hidden = false; renderLobby(); return; }
    $('lobby').hidden = true; $('app').hidden = false;
    onG();
    const sig = [G.v, U.ver, U.tab, peers.map((p) => p.presence && (p.presence.n + p.presence.r)).join('|'), ME.role === 'pl' && !ME.solo && !dmPeer() ? 'nodm' : ''].join('#');
    if (!force && sig === U.sig) return;
    U.sig = sig;
    renderApp();
  }

  function renderLobby() {
    $('lobCode').textContent = ME.code;
    const pls = plPeers(), dm = ME.role === 'dm' ? { presence: { n: ME.nick } } : dmPeer();
    const mine = pls.find((p) => p.isMe);
    const bots = G && G.chars ? Object.keys(G.chars).filter((k) => G.chars[k].bot).map((k) => Object.assign({ k }, G.chars[k])) : [];
    const taken = pls.filter((p) => !p.isMe && p.presence.cls).map((p) => p.presence.cls).concat(bots.map((b) => b.cls));
    const sig = 'L' + ME.code + JSON.stringify(pls.map((p) => [p.presence.n, p.presence.cls, p.isMe])) + JSON.stringify(bots.map((b) => b.k)) + (dm ? dm.presence.n : '-') + ME.cls;
    if (sig === U.sig) return; U.sig = sig;
    $('lobPlayers').innerHTML = (dm ? '<li><span class="avatar" style="width:30px;height:30px;font-size:16px;background:#3A3346">🎲</span><b class="grow">' + esc(dm.presence.n) + '</b><span class="chip gold">майстер</span></li>' : '<li class="muted">Майстра ще немає… Перевір код.</li>') +
      bots.map((b) => { const c = R.CLASSES[b.cls]; return '<li><span class="avatar" style="width:30px;height:30px;font-size:16px;background:' + c.col + '">' + c.ic + '</span><b class="grow">' + esc(b.n) + '</b><span class="muted">' + c.n + '</span>' + (ME.role === 'dm' ? '<button class="btn2 sm" type="button" data-unbot="' + esc(b.k) + '">✕</button>' : '') + '</li>'; }).join('') +
      pls.map((p) => { const c = R.CLASSES[p.presence.cls]; return '<li><span class="avatar" style="width:30px;height:30px;font-size:16px;background:' + (c ? c.col : '#3A3346') + '">' + (c ? c.ic : '…') + '</span><b class="grow">' + esc(p.presence.n) + (p.isMe ? ' (ти)' : '') + '</b><span class="muted">' + (c ? c.n : 'обирає героя') + '</span></li>'; }).join('');
    if (ME.role === 'dm') {
      $('lobPick').hidden = true; $('lobWait').hidden = true; $('lobStart').hidden = false;
      $('lobStart').disabled = !pls.some((p) => p.presence.cls) && !bots.length;
      $('lobSub').textContent = 'Гравці вводять цей код на своїх телефонах і обирають героїв. Вільних героїв можна віддати ботам.';
      $('lobBots').hidden = false;
      $('lobBotBtns').innerHTML = R.CLASS_IDS.map((id) => { const c = R.CLASSES[id]; return '<button type="button" class="btn2 sm" data-bot="' + id + '"' + (taken.includes(id) || pls.some((p) => p.presence.cls === id) ? ' disabled' : '') + '>' + c.ic + ' ' + c.n + '</button>'; }).join('');
    } else {
      $('lobPick').hidden = false; $('lobStart').hidden = true; $('lobWait').hidden = false;
      $('lobSub').textContent = dm ? 'Майстер: ' + dm.presence.n : 'Шукаємо гру…';
      $('lobClasses').innerHTML = R.CLASS_IDS.map((id) => {
        const c = R.CLASSES[id], on = mine && mine.presence.cls === id, off = taken.includes(id);
        return '<button type="button" class="cls' + (on ? ' on' : '') + '" data-cls="' + id + '"' + (off ? ' disabled' : '') + '><span class="avatar" style="background:' + c.col + '">' + c.ic + '</span><span class="grow"><b>' + c.n + ' · ' + c.who + '</b><small>' + esc(c.bio) + '</small><small>КБ ' + c.ac + ' · хіти ' + c.hp + (off ? ' · зайнято' : '') + '</small></span></button>';
      }).join('');
    }
  }
  $('lobClasses').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cls]'); if (!b || b.disabled || !NET) return;
    ME.cls = b.dataset.cls; NET.presence({ cls: ME.cls }); U.sig = ''; renderLobby();
  });
  $('lobby').addEventListener('click', (e) => {
    const b = e.target.closest('[data-bot],[data-unbot]'); if (!b || b.disabled || ME.role !== 'dm') return;
    if (b.dataset.bot) send({ t: 'bot', cls: b.dataset.bot }); else send({ t: 'unbot', k: b.dataset.unbot });
    U.sig = ''; renderLobby();
  });
  $('lobStart').addEventListener('click', () => { E.syncChars(plPeers().filter((p) => !p.isMe).map((p) => ({ n: p.presence.n, cls: p.presence.cls }))); send({ t: 'start' }); U.tab = 'scene'; render(true); });

  /* реакції на новий стан: уроки, тости, анімації, перемикання вкладок */
  function onG() {
    if (!G) return;
    if (U.lastGv === G.v) return; U.lastGv = G.v;
    // уроки (черга: за одну дію може відкритись кілька)
    const les = Array.isArray(G.les) ? G.les : [];
    if (!U.lesIds) U.lesIds = new Set(les.map((l) => l.i));
    for (const l of les) if (!U.lesIds.has(l.i)) { U.lesIds.add(l.i); U.lesQ.push(l.k); }
    if ($('lesson').hidden) nextLesson();
    // кидки → тост
    const rolls = (G.log || []).filter((e) => e.c === 'roll' && e.r);
    if (U.rollSeen === null) U.rollSeen = rolls.length ? rolls[rolls.length - 1].i : '';
    else {
      const idx = rolls.findIndex((e) => e.i === U.rollSeen), fresh = idx < 0 ? rolls.slice(-2) : rolls.slice(idx + 1);
      if (fresh.length) { U.rollSeen = fresh[fresh.length - 1].i; fresh.slice(-3).forEach((e) => U.toastQ.push(e)); if (U.toastQ.length > 3) U.toastQ.splice(0, U.toastQ.length - 3); }
    }
    // анімації
    const fx = G.fx || [];
    if (U.fxSeen === null) U.fxSeen = fx.length ? fx[fx.length - 1].i : '';
    else { const idx = fx.findIndex((f) => f.i === U.fxSeen), fresh = idx < 0 ? fx : fx.slice(idx + 1); if (fresh.length) { U.fxSeen = fresh[fresh.length - 1].i; fresh.forEach((f) => ANIM.q.push(f)); } }
    // бій почався / закінчився
    const cbKey = G.cb ? G.cb.f + G.cb.order.join() : '';
    if (cbKey !== U.cbKey) { U.cbKey = cbKey; clearSel(); if (G.cb) U.tab = ME.role === 'dm' ? 'fight' : 'map'; else if (U.tab === 'map') U.tab = 'story'; }
    // новий хід
    const tk = G.cb ? G.cb.round + ':' + G.cb.turn : '';
    if (tk !== U.turnKey) { U.turnKey = tk; clearSel(); U.override = false; const c = ctl(); if (c && ME.role === 'pl') { beep('turn'); if (navigator.vibrate) try { navigator.vibrate(60); } catch (e) {} } }
    // перевірка
    const ck = G.ck;
    if (ME.role === 'pl' && ck && ck.who.includes(ME.key) && U.ckSeen !== ck.id) { U.ckSeen = ck.id; U.ckOpen = true; }
    if (U.modalKind === 'ck' && (!ck || !U.ckOpen)) closeModal();
    if (U.modalKind === 'watch' && (!ck || !U.watchOpen)) closeModal();
    if (ME.role === 'pl' && ck && !ck.who.includes(ME.key) && U.watchSeen !== ck.id && U.modalKind !== 'cfg') { U.watchSeen = ck.id; U.watchOpen = true; }
    if (ME.role === 'pl' && ck && U.watchOpen && !ck.who.includes(ME.key)) openWatch();
    if (ME.role === 'pl' && ck && U.ckOpen && ck.who.includes(ME.key)) openCheckPrompt();
  }

  function clearSel() { U.sel = null; U.tgt = null; U.tgts = []; if (U.mode !== 'move') { U.mode = 'move'; U.wi = -1; U.sp = null; } }

  function tabsFor() {
    if (ME.role === 'dm') return [['scene', '📜', 'Сцена'], ['fight', '⚔️', 'Бій'], ['party', '👥', 'Гравці'], ['memo', '🧭', 'Памʼятка']];
    const t = [['story', '📜', 'Пригода'], ['hero', '🧝', 'Герой'], ['journal', '📓', 'Журнал'], ['rules', '📖', 'Правила']];
    if (G.cb) t.unshift(['map', '⚔️', 'Бій']);
    return t;
  }
  function renderApp() {
    const tabs = tabsFor();
    if (!U.tab || !tabs.some((t) => t[0] === U.tab)) U.tab = tabs[0][0];
    const sc = S.SCENES[G.sc] || S.SCENES[0];
    $('topTitle').textContent = G.cb ? '⚔️ ' + S.FIGHTS[G.cb.f].n + ' · раунд ' + G.cb.round : sc.icon + ' ' + sc.t;
    $('topCode').textContent = ME.solo ? '🤖 соло' : ME.code;
    const ckDot = ME.role === 'dm' ? !!G.ck : G.ck && G.ck.who.includes(ME.key) && !G.ck.res[ME.key];
    const myTurn = !!ctl();
    $('tabs').innerHTML = tabs.map((t) => '<button type="button" data-tab="' + t[0] + '" class="' + (U.tab === t[0] ? 'on' : '') + '"><b>' + t[1] + '</b>' + t[2] +
      ((t[0] === 'journal' && jCount() > (U.jSeen || 0) && U.tab !== 'journal') || ((t[0] === 'scene' || t[0] === 'story') && ckDot) || ((t[0] === 'map' || t[0] === 'fight') && myTurn && U.tab !== t[0]) ? '<i class="dot"></i>' : '') + '</button>').join('');
    const isMap = (U.tab === 'map' || U.tab === 'fight') && G.cb;
    $('mapBox').hidden = !isMap; $('main').hidden = isMap;
    if (isMap) { renderOrder(); renderAct(); resizeMap(); if (!$('lesson').hidden) placeLesson(); return; }
    const sc0 = $('main').scrollTop;
    let h = '';
    if (ME.role === 'pl' && !ME.solo && !dmPeer()) h += '<div class="card" style="border-color:var(--red)"><b>Майстер не на звʼязку.</b><p class="muted" style="margin:4px 0 0">Можливо, згас екран. Гра збережена в нього — чекаємо.</p></div>';
    if (ME.role === 'pl' && !G.chars[ME.key]) h += '<div class="card"><b>Твого героя ще немає.</b><p class="muted">Обери героя — майстер побачить і додасть тебе в гру.</p><div class="classes">' + R.CLASS_IDS.map((id) => { const c = R.CLASSES[id]; return '<button type="button" class="cls" data-latecls="' + id + '"><span class="avatar" style="background:' + c.col + '">' + c.ic + '</span><span class="grow"><b>' + c.n + ' · ' + c.who + '</b></span></button>'; }).join('') + '</div></div>';
    if (U.tab === 'story') h += viewStory();
    else if (U.tab === 'hero') h += viewHero();
    else if (U.tab === 'rules') h += viewRules();
    else if (U.tab === 'journal') { h += viewJournal(); U.jSeen = jCount(); }
    else if (U.tab === 'scene') h += viewScene();
    else if (U.tab === 'fight') h += viewFightPick();
    else if (U.tab === 'party') h += viewParty();
    else if (U.tab === 'memo') h += viewMemo();
    $('main').innerHTML = h;
    $('main').scrollTop = U.toTop ? 0 : sc0; U.toTop = false;
  }
  $('tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (!b) return; U.tab = b.dataset.tab; $('main').scrollTop = 0; U.ver++; render(); });

  /* ---------- в'юшки ---------- */
  function dieHtml(r) {
    if (!r.d || !r.d.length) return '';
    const used = r.d.length > 1 ? r.d.indexOf(r.v) : 0;
    return '<span class="dice">' + r.d.map((d, i) => '<span class="die' + (i !== used ? ' off' : '') + (i === used && d === 20 ? ' n20' : '') + (i === used && d === 1 ? ' n1' : '') + '">' + d + '</span>').join('') + '</span>';
  }
  function rollLine(r) {
    const parts = r.parts.map((p) => sgn(p[1]) + ' ' + esc(p[0])).join(' ');
    const verdict = r.vsL === 'КБ' ? (r.ok ? (r.crit ? '💥 Критичне влучання!' : 'Влучання') : 'Промах') : (r.ok ? 'Успіх' : 'Провал');
    return dieHtml(r) + '<b>' + esc(r.lbl) + '</b><br><span class="muted">' + (r.auto ? 'автоматичний провал' : 'к20' + (r.d.length > 1 ? (r.adv > 0 ? ' з перевагою' : ' з перешкодою') : '') + ' ' + parts + ' = <b>' + r.tot + '</b>') +
      (r.vs != null ? ' проти ' + r.vsL + ' ' + r.vs : '') + '</span> · <b class="' + (r.ok ? 'ok' : 'bad') + '">' + verdict + '</b>' + (r.why && r.why.length ? '<br><span class="why">' + r.why.map(esc).join(' · ') + '</span>' : '');
  }
  function logHtml(n) {
    const items = (G.log || []).slice(-n).reverse();
    return '<ul class="log">' + items.map((e) => '<li class="' + esc(e.c) + '">' + (e.r ? rollLine(e.r) : esc(e.t)) + '</li>').join('') + '</ul>';
  }
  function dmCard() {
    const v = window.DNDBotDM && ME.solo ? window.DNDBotDM.view(G) : null; if (!v) return '';
    let h = '<div id="dmCard" style="margin-bottom:12px">';
    if (v.k === 'msg') {
      if (v.read) h += '<div class="read"><p class="eyebrow">Майстер розповідає</p><p>' + esc(v.t) + '</p></div>';
      else if (v.sp) h += '<div class="card npc" style="margin:0"><div class="npc-h"><span class="npc-ic">' + v.ic + '</span><b>' + esc(v.sp) + '</b></div><p class="npc-t">' + esc(v.t) + '</p></div>';
      else h += '<div class="card" style="margin:0;border-color:var(--violet)"><p class="eyebrow">🤖 Майстер</p><p style="margin:0;font-size:16px">' + esc(v.t) + '</p></div>';
      h += (v.tip ? '<div class="tip">💡 ' + esc(v.tip) + '</div>' : '') + '<button class="btn wide" type="button" data-dm="next" style="margin-top:10px">Далі ▸' + (v.more ? ' <small style="opacity:.6">(' + v.more + ')</small>' : '') + '</button>';
    } else if (v.k === 'choice') {
      h += '<div class="card" style="margin:0;border-color:var(--gold)"><p class="eyebrow">🤖 Майстер питає</p><b style="font-size:16px">' + esc(v.ask) + '</b>' +
        (v.used.length ? '<div class="muted" style="margin-top:6px;font-size:12.5px">Уже: ' + v.used.map(esc).join(' · ') + '</div>' : '') +
        v.opts.map((o) => '<button type="button" class="opt" data-dmpick="' + esc(o.i) + '">▸ ' + esc(o.t) + '</button>').join('') +
        (v.done ? '<button class="btn wide" type="button" data-dm="done" style="margin-top:12px">' + esc(v.done) + '</button>' : '') + '</div>';
    } else if (v.k === 'ck') h += G.ck && G.ck.who.includes(ME.key) && !G.ck.res[ME.key] ? '<button class="btn wide" data-openck="1" type="button">🎲 Кинути: ' + esc(E.checkName(G.ck)) + '</button>' : '<div class="card" style="margin:0"><p class="muted" style="margin:0">Кидають інші…</p></div>';
    else if (v.k === 'fight') h += '<button class="btn wide" type="button" data-tab="map">⚔️ До бою</button>';
    else if (v.k === 'end') h += '<div class="card" style="margin:0;border-color:var(--gold)"><h3>Кінець пригоди</h3><p class="muted">Загляни у «Журнал» — там уся історія, яку ви відкрили.</p><button class="btn2" type="button" data-soloagain="1">Зіграти ще раз</button></div>';
    return h + '</div>';
  }
  const SCENE_BG = { intro: '#3B2E5A,#1E1830', dawnstar: '#2E4A66,#16202C', road: '#5B7894,#1C2633', temple: '#3E2E52,#17121F', dream: '#5A2E7A,#1A0F26', shrine: '#5E1F45,#1A0C16' };
  function sceneBanner(sc, n) {
    return '<div class="scene-ban" style="background:linear-gradient(135deg,' + (SCENE_BG[sc.id] || '#333,#111') + ')"><span class="scene-ic">' + sc.icon + '</span><div><p class="eyebrow" style="color:rgba(255,255,255,.65);margin:0">Сцена ' + (n + 1) + ' з ' + S.SCENES.length + '</p><h2 style="margin:0">' + esc(sc.t) + '</h2>' +
      (G.goal && S.GOALS[G.goal] ? '<div class="scene-goal">🎯 ' + esc(S.GOALS[G.goal]) + '</div>' : '') + '</div></div>';
  }
  function viewStory() {
    const sc = S.SCENES[G.sc];
    let h = sceneBanner(sc, G.sc) + dmCard() + (ME.solo ? '' : '<div class="card"><details><summary>Текст сцени (майстер читає вголос)</summary><div class="read" style="margin-top:8px">' + sc.read.map((p) => '<p>' + esc(p) + '</p>').join('') + '</div></details></div>');
    if (G.end) h += '<div class="card" style="border-color:var(--gold)"><h3>' + (G.end === 'a' ? '🕯️ Кінець: Череп знищено' : '💀 Кінець: жезл ваш') + '</h3><p class="muted">Дякуємо за гру! Ти щойно зіграв свою першу пригоду.</p></div>';
    const ch = G.chars[ME.key];
    if (ch) { const c = R.CLASSES[ch.cls]; h += '<div class="card"><div class="sheet-h"><span class="avatar" style="background:' + c.col + '">' + c.ic + '</span><div class="grow"><b>' + esc(ch.n) + '</b> · ' + c.n + statusTxt(ch) + '<div class="bar"><i style="width:' + Math.max(0, ch.hp / c.hp * 100) + '%;background:' + hpCol(ch.hp / c.hp) + '"></i></div><span class="muted">' + ch.hp + '/' + c.hp + ' хітів' + (c.slots ? ' · комірки ' + ch.slots + '/' + c.slots : '') + '</span></div></div></div>'; }
    if (G.ck && !G.ck.who.includes(ME.key)) h += '<div class="card"><p class="eyebrow">Зараз кидають</p><b>' + esc(E.checkName(G.ck)) + '</b><p class="muted">' + G.ck.who.map((k) => esc(G.chars[k].n) + (G.ck.res[k] ? ' — ' + G.ck.res[k].tot + (G.ck.res[k].ok ? ' ✔' : ' ✖') : ' …')).join(', ') + '</p></div>';
    if (G.ck && G.ck.who.includes(ME.key) && !U.ckOpen && !ME.solo) h += '<button class="btn wide" data-openck="1" type="button" style="margin-bottom:12px">🎲 Перевірка: ' + esc(E.checkName(G.ck)) + '</button>';
    h += '<p class="eyebrow">Що відбувалось</p>' + logHtml(36);
    return h;
  }
  function statusTxt(ch) { return ch.dead ? ' · <b class="bad">загинув</b>' : ch.hp <= 0 ? (ch.stable ? ' · <b>без тями, стабільний</b>' : ' · <b class="bad">без тями ✔' + ch.ds.s + ' ✖' + ch.ds.f + '</b>') : ''; }
  const hpCol = (f) => (f > 0.6 ? '#5DD27A' : f > 0.3 ? '#E9B949' : '#FF6464');

  function viewHero() {
    const ch = G.chars[ME.key]; if (!ch) return '';
    const c = R.CLASSES[ch.cls];
    let h = '<div class="card"><div class="sheet-h"><span class="avatar" style="background:' + c.col + '">' + c.ic + '</span><div class="grow"><h2 style="margin:0">' + esc(ch.n) + '</h2><span class="muted">' + c.n + ' 2 рівня' + statusTxt(ch) + '</span></div></div>' +
      '<p class="muted" style="margin:8px 0 0">' + esc(c.bio) + '</p>' +
      '<div class="bar" style="height:14px;margin-top:10px"><i style="width:' + Math.max(0, ch.hp / c.hp * 100) + '%;background:' + hpCol(ch.hp / c.hp) + '"></i></div><span class="muted">Хіти ' + ch.hp + ' з ' + c.hp + ' — скільки ударів витримаєш. На 0 падаєш без тями.</span>' +
      '<div class="kv"><div data-info="ac"><b>' + c.ac + '</b><small>Клас броні</small></div><div data-info="speed"><b>' + c.sp + ' кл</b><small>' + (c.sp * 1.5) + ' м за хід</small></div><div data-info="init"><b>' + sgn(R.mod(c.st.dex)) + '</b><small>Ініціатива</small></div></div>' +
      '<div class="kv"><div data-info="passive"><b>' + E.passive(ch) + '</b><small>Пас. сприйняття</small></div><div data-info="prof"><b>+2</b><small>Майстерність</small></div>' + (c.slots ? '<div data-info="slots"><b>' + ch.slots + '/' + c.slots + '</b><small>Комірки чар</small></div>' : '<div><b>' + c.hd + '</b><small>Кістка хітів к' + c.hd + '</small></div>') + '</div>' +
      '<p class="eyebrow" style="margin-top:12px">Стати — торкнись, щоб дізнатись</p><div class="stats">' +
      R.STAT_IDS.map((s) => '<button type="button" class="stat" data-stat="' + s + '"><small>' + R.STATS[s].n + '</small><b>' + sgn(R.mod(c.st[s])) + '</b><span>' + c.st[s] + '</span></button>').join('') + '</div></div>';
    h += '<div class="card"><h3>Навички</h3><p class="muted">● — твоя навичка (+2 майстерності), ◉ — експертність (+4). Торкнись, щоб прочитати.</p>' +
      R.SKILL_ORDER.filter((sk) => !R.SKILLS[sk].tool || c.skills.includes(sk)).map((sk) => { const b = E.skillB(ch, sk); return '<button type="button" class="sk" data-skill="' + sk + '"><span class="pt' + (b.p > 2 ? ' ex' : b.p ? ' on' : '') + '"></span>' + R.SKILLS[sk].n + ' <em>' + R.STATS[b.st].s + '</em><b>' + sgn(b.m + b.p) + '</b></button>'; }).join('') + '</div>';
    h += '<div class="card"><h3>Рятівні кидки</h3><p class="muted">Коли щось стається з тобою: вибух, отрута, чари.</p>' +
      R.STAT_IDS.map((s) => { const b = E.saveB(ch, s); return '<button type="button" class="sk" data-save="' + s + '"><span class="pt' + (b.p ? ' on' : '') + '"></span>' + R.STATS[s].n + '<b>' + sgn(b.m + b.p) + '</b></button>'; }).join('') + '</div>';
    h += '<div class="card"><h3>Атаки</h3>' + c.weapons.map((w) => { const a = E.wAtk(c, w); return '<div class="sk"><span>⚔</span>' + w.n + ' <em>' + (w.reach && !w.range ? 'впритул' : w.range ? (w.thrown ? 'впритул або ' : '') + w.range + '/' + w.long + ' кл' : '') + '</em><b>' + sgn(a.b) + ' · ' + kd(w.dmg) + sgn(a.m) + '</b></div>'; }).join('') + '<p class="muted">Перше число — бонус до к20, друге — шкода.</p></div>';
    if (c.spells) h += '<div class="card"><h3>Заклинання</h3><p class="muted">Атака чарами ' + sgn(E.spellAtk(c)) + ' · складність рятівного ' + E.spellDC(c) + ' · комірок ' + ch.slots + '/' + c.slots + '</p>' + c.spells.map((s) => { const sp = R.SPELLS[s]; return '<button type="button" class="sk" data-spell="' + s + '"><span>🪄</span>' + sp.n + ' <em>' + (sp.lvl ? '1 коло' : 'замовляння') + (sp.time === 'b' ? ' · бонусна' : '') + '</em><b>›</b></button>'; }).join('') + '</div>';
    h += '<div class="card"><h3>Особливості</h3>' + c.feats.map((f) => '<div class="gm"><b>' + f.n + '</b> — ' + esc(f.d) + (f.uses ? ' <span class="chip">' + ((ch.uses || {})[f.id] ? 'є' : 'витрачено') + '</span>' : '') + '</div>').join('') + '</div>';
    return h;
  }
  const jCount = () => (G && (G.lore || []).length + (G.journal || []).length) || 0;
  function viewJournal() {
    const lore = G.lore || [], jr = G.journal || [];
    let h = '<div class="card" style="border-color:var(--gold)"><p class="eyebrow">Мета</p><h3 style="margin:0">🎯 ' + esc((S.GOALS || {})[G.goal] || 'Дізнатися, що коїться.') + '</h3></div>';
    h += '<div class="card"><h3>📝 Що ми знаємо</h3>' + (jr.length ? jr.slice().reverse().map((k, i) => '<div class="' + (i ? 'jr' : 'jr new') + '">' + esc(S.JOURNAL[k]) + '</div>').join('') : '<p class="muted">Поки нічого. Розпитуйте, роздивляйтесь — усе важливе зʼявиться тут.</p>') + '</div>';
    h += '<div class="card"><h3>📖 Загальний лор</h3><p class="muted">Хто є хто й що є що у світі. Відкривається, коли герої про щось дізнаються.</p>' +
      (lore.length ? lore.map((k) => { const L = S.LORE[k]; return '<details class="lore"><summary>' + L.ic + ' ' + esc(L.t) + '</summary><p>' + esc(L.d) + '</p></details>'; }).join('') : '<p class="muted">Ще нічого не відкрито.</p>') +
      (Object.keys(S.LORE).length > lore.length ? '<p class="muted" style="margin-top:8px">Ще не відкрито: ' + (Object.keys(S.LORE).length - lore.length) + '</p>' : '') + '</div>';
    return h;
  }
  const INFO = {
    ac: ['Клас броні (КБ)', 'Наскільки тебе важко влучити. Ворог кидає к20 + свій бонус: якщо вийшло стільки або більше — влучив.'],
    speed: ['Швидкість', 'Скільки клітинок можна пройти за хід. 1 клітинка = 1,5 м. Діагональ теж 1 клітинка. Кучугури й уламки — 2.'],
    init: ['Ініціатива', 'На початку бою кожен кидає к20 + Спритність. Хто вище — ходить раніше.'],
    passive: ['Пасивне сприйняття', '10 + бонус Сприйняття. Майстер дивиться на це число, щоб без кидка вирішити, чи ти помітив щось приховане.'],
    prof: ['Майстерність', 'Бонус за вміння. Додається до навичок, які ти знаєш, до атак зброєю й чарами та до деяких рятівних кидків.'],
    slots: ['Комірки заклинань', 'Паливо для заклинань 1 кола. Замовляння комірок не потребують. Відновлюються після довгого відпочинку.'],
  };
  function viewRules() {
    let h = '<div class="card"><h2>Як це працює</h2><div class="tip">Майстер описує → ти кажеш, що робиш → якщо результат невідомий, майстер просить кидок → к20 + модифікатор ≥ складності = успіх.</div></div>';
    h += '<div class="card"><h3>Шість статів</h3>' + R.STAT_IDS.map((s) => '<div class="ck"><b>' + R.STATS[s].n + '</b><div class="muted">' + esc(R.STATS[s].d) + '</div><div class="tags">' + R.SKILL_ORDER.filter((k) => R.SKILLS[k].st === s).map((k) => '<span class="tag">' + R.SKILLS[k].n + '</span>').join('') + (s === 'con' ? '<span class="tag">без навичок — «чиста» Статура</span>' : '') + '</div><div class="why">Рятівний: ' + esc(R.SAVES[s]) + '</div></div>').join('') + '</div>';
    h += '<div class="card"><h3>Складність (СЛ)</h3>' + R.DC.map((d) => '<div class="sk"><b style="margin:0;width:34px">' + d.v + '</b>' + d.n + ' <em>' + esc(d.d) + '</em></div>').join('') + '</div>';
    h += '<div class="card"><h3>Уроки</h3>' + Object.keys(R.LESSONS).map((k) => '<details' + (G.seen.includes(k) ? '' : '') + '><summary>' + (G.seen.includes(k) ? '✔ ' : '') + R.LESSONS[k].t + '</summary><p class="muted">' + esc(R.LESSONS[k].d) + '</p></details>').join('') + '</div>';
    return h;
  }

  /* --- майстер --- */
  function ckDef(c) { return c.sk ? { kind: 'sk', key: c.sk } : c.st ? { kind: 'st', key: c.st } : { kind: 'sv', key: c.sv }; }
  function ckTag(c) {
    const d = ckDef(c);
    const name = d.kind === 'sk' ? R.SKILLS[d.key].n : d.kind === 'st' ? 'Чиста ' + R.STATS[d.key].n : 'Рятівний ' + R.STATS[d.key].n;
    const st = d.kind === 'sk' ? R.STATS[R.SKILLS[d.key].st].s : R.STATS[d.key].s;
    return '<span class="tag ' + (d.kind === 'sv' ? 'sv' : 'st') + '">' + name + ' · ' + st + '</span><span class="tag dc">СЛ ' + c.dc + '</span><span class="tag">' + ({ one: 'один', all: 'кожен', group: 'група' }[c.who]) + '</span>';
  }
  function viewActiveCheck() {
    const ck = G.ck; if (!ck) return '';
    const sc = S.SCENES.flatMap((s) => s.checks).find((c) => c.id === ck.sid);
    let h = '<div class="card" style="border-color:var(--gold)"><p class="eyebrow">Перевірка йде</p><h3>' + esc(ck.t || E.checkName(ck)) + '</h3><div class="tags"><span class="tag st">' + esc(E.checkName(ck)) + '</span><span class="tag dc">СЛ ' + ck.dc + (ck.show ? '' : ' (приховано)') + '</span>' + (ck.adv ? '<span class="tag">' + (ck.adv > 0 ? 'перевага' : 'перешкода') + '</span>' : '') + (ck.gd ? '<span class="tag">+1к4 настанова</span>' : '') + (ck.mode === 'group' ? '<span class="tag">групова</span>' : '') + '</div><ul class="plain">';
    h += ck.who.map((k) => { const r = ck.res[k], ch = G.chars[k]; return '<li class="sk">' + esc(ch.n) + (online(k) ? '' : ' <em>не в мережі</em>') + (r ? '<b class="' + (r.ok ? 'ok' : 'bad') + '">' + dieHtml(r) + ' = ' + r.tot + (r.ok ? ' ✔' : ' ✖') + '</b>' : '<b><button class="btn2 sm" data-rollfor="' + k + '" type="button">Кинути за ' + esc(ch.n) + '</button></b>') + '</li>'; }).join('') + '</ul>';
    if (ck.done) {
      if (ck.mode === 'group') h += '<p class="verdict ' + (ck.gok ? 'ok' : 'bad') + '">' + (ck.gok ? 'Група впоралась' : 'Група провалила') + '</p>';
      if (sc) {
        const one = ck.mode === 'group' ? ck.gok : ck.who.length === 1 ? ck.res[ck.who[0]].ok : null;
        if (one === true || one === null) h += '<div class="tip"><b>Успіх:</b> ' + esc(sc.ok) + '</div>';
        if (one === false || one === null) h += '<div class="gm"><b>Провал:</b> ' + esc(sc.fail) + '</div>';
        h += '<p class="muted">Розкажи це гравцям своїми словами.</p>';
      }
    } else h += '<p class="muted">Чекаємо кидків…</p>';
    h += '<button class="btn wide" type="button" data-ckclose="1">' + (ck.done ? 'Готово' : 'Скасувати перевірку') + '</button></div>';
    return h;
  }
  function viewScene() {
    const sc = S.SCENES[G.sc];
    let h = viewActiveCheck();
    h += '<div class="row" style="margin-bottom:10px"><button class="btn2" data-scene="' + (G.sc - 1) + '" ' + (G.sc ? '' : 'disabled') + ' type="button">◀</button><div class="grow" style="text-align:center"><p class="eyebrow" style="margin:0">Сцена ' + (G.sc + 1) + ' з ' + S.SCENES.length + '</p><b style="font-family:var(--display);font-size:20px">' + sc.icon + ' ' + esc(sc.t) + '</b></div><button class="btn2" data-scene="' + (G.sc + 1) + '" ' + (G.sc < S.SCENES.length - 1 ? '' : 'disabled') + ' type="button">▶</button></div>';
    h += '<div class="read" style="margin-bottom:12px"><p class="eyebrow">Читай вголос</p>' + sc.read.map((p) => '<p>' + esc(p) + '</p>').join('') + '</div>';
    h += '<div class="card"><h3>🔒 Знаєш лише ти</h3>' + sc.gm.map((g) => '<div class="gm">' + esc(g) + '</div>').join('') + (sc.npc ? sc.npc.map((n) => '<div class="gm"><b>' + esc(n.n) + '</b> — ' + esc(n.d) + '</div>').join('') : '') + '</div>';
    h += '<div class="card"><h3>🧭 Як вести цю сцену</h3>' + sc.tips.map((t) => '<div class="tip">' + esc(t) + '</div>').join('') + '</div>';
    if (sc.checks.length) h += '<div class="card"><h3>🎲 Готові перевірки</h3><p class="muted">Проси, лише коли гравці самі щось таке роблять. Не всі треба використати.</p>' + sc.checks.map((c) => '<div class="ck"><div class="h"><b>' + esc(c.t) + '</b><button class="btn2 sm" data-ask="' + c.id + '" type="button">Попросити</button></div><div class="tags">' + ckTag(c) + '</div><div class="why">' + esc(c.why) + '</div><details><summary class="muted">Успіх / провал</summary><div class="tip">' + esc(c.ok) + '</div><div class="gm">' + esc(c.fail) + '</div></details></div>').join('') + '</div>';
    h += '<button class="btn2" data-ask="" type="button" style="width:100%;margin-bottom:12px">＋ Своя перевірка</button>';
    if (sc.fight) {
      const F = S.FIGHTS[sc.fight];
      h += '<div class="card"><h3>⚔️ ' + esc(F.n) + '</h3><p class="muted">' + esc(F.intro) + '</p>' + (G.cb ? '<p>Бій триває — вкладка «Бій».</p>' : fightStartHtml(sc.fight)) + '</div>';
    }
    if (sc.id === 'shrine') h += '<div class="card"><h3>Фінал</h3><p class="muted">Коли гравці вирішать долю Черепа:</p><div class="row"><button class="btn2" data-finale="a" type="button">🕯️ Череп знищено</button><button class="btn2" data-finale="b" type="button">💀 Жезл забрали</button></div></div>';
    if ((sc.lore && sc.lore.length) || (sc.journal && sc.journal.length)) {
      h += '<div class="card"><h3>📓 Відкрити гравцям</h3><p class="muted">Коли герої про щось дізнались — торкнись, і запис зʼявиться в їхньому «Журналі».</p>';
      if (sc.lore && sc.lore.length) h += '<p class="eyebrow">Лор</p><div class="chips">' + sc.lore.map((k) => '<button type="button" data-lore="' + k + '" class="' + ((G.lore || []).includes(k) ? 'on' : '') + '">' + ((G.lore || []).includes(k) ? '✔ ' : '') + S.LORE[k].ic + ' ' + esc(S.LORE[k].t) + '</button>').join('') + '</div>';
      if (sc.journal && sc.journal.length) h += '<p class="eyebrow">Журнал квесту</p>' + sc.journal.map((k) => '<button type="button" class="sk" data-jr="' + k + '"' + ((G.journal || []).includes(k) ? ' disabled' : '') + '><span class="pt' + ((G.journal || []).includes(k) ? ' on' : '') + '"></span><span class="grow" style="font-size:13px">' + esc(S.JOURNAL[k]) + '</span></button>').join('');
      h += '</div>';
    }
    if (sc.lessons && sc.lessons.length) h += '<div class="card"><h3>📖 Показати урок усім</h3><div class="chips">' + sc.lessons.map((k) => '<button type="button" data-teach="' + k + '">' + (G.seen.includes(k) ? '✔ ' : '') + R.LESSONS[k].t + '</button>').join('') + '</div></div>';
    return h;
  }
  function fightStartHtml(fid) {
    return '<label class="f">Раптовість<select id="surp_' + fid + '"><option value="">Ніхто не заскочений</option><option value="foe">Вороги заскочені (герої підкрались)</option><option value="pc">Герої заскочені (засідка)</option></select></label><button class="btn wide" type="button" data-fight="' + fid + '">Почати бій</button>';
  }
  function viewFightPick() {
    let h = '<div class="card"><h2>Бої пригоди</h2><p class="muted">Зазвичай бій починаєш зі сцени. Тут — усі одразу.</p></div>';
    for (const fid in S.FIGHTS) { const F = S.FIGHTS[fid]; h += '<div class="card"><h3>' + esc(F.n) + '</h3><p class="muted">' + esc(F.intro) + '</p>' + fightStartHtml(fid) + '</div>'; }
    return h;
  }
  function viewParty() {
    const keys = Object.keys(G.chars);
    let h = '<div class="card"><h2>Гравці</h2><p class="muted">Хіти міняй тут, коли сцена каже «−3 хіти» тощо. У бою шкода рахується сама.</p></div>';
    if (!keys.length) h += '<p class="muted">Поки нікого.</p>';
    for (const k of keys) {
      const ch = G.chars[k], c = R.CLASSES[ch.cls];
      h += '<div class="card"><div class="sheet-h"><span class="avatar" style="background:' + c.col + '">' + c.ic + '</span><div class="grow"><b>' + esc(ch.n) + '</b> · ' + c.n + (ch.bot ? ' <span class="chip">🤖 бот</span>' : ' <span class="chip ' + (online(k) ? '' : 'red') + '">' + (online(k) ? 'в мережі' : 'не в мережі') + '</span>') + statusTxt(ch) +
        '<div class="bar"><i style="width:' + Math.max(0, ch.hp / c.hp * 100) + '%;background:' + hpCol(ch.hp / c.hp) + '"></i></div></div></div>' +
        '<div class="row" style="margin-top:8px"><span class="grow"><b>' + ch.hp + '/' + c.hp + '</b> хітів</span>' + [-5, -1, 1, 5].map((d) => '<button class="btn2 sm" type="button" data-hp="' + k + '" data-d="' + d + '">' + (d > 0 ? '+' : '') + d + '</button>').join('') + '</div>' +
        '<div class="tags" style="margin-top:8px"><span class="tag">КБ ' + c.ac + '</span><span class="tag st">Пас. сприйн. ' + E.passive(ch) + '</span>' + (c.slots ? '<span class="tag sv">Комірки ' + ch.slots + '/' + c.slots + '</span>' : '') + '</div>' +
        (c.slots ? '<div class="row"><span class="muted grow">Комірки</span><button class="btn2 sm" type="button" data-slot="' + k + '" data-d="-1">−1</button><button class="btn2 sm" type="button" data-slot="' + k + '" data-d="1">+1</button></div>' : '') + '</div>';
    }
    h += '<div class="card"><h3>🤖 Додати бота</h3><p class="muted">Бот сам кидає перевірки й сам ходить у бою. У поточний бій не потрапить — лише в наступний.</p><div class="chips">' + R.CLASS_IDS.map((id) => '<button type="button" data-bot="' + id + '">' + R.CLASSES[id].ic + ' ' + R.CLASSES[id].n + '</button>').join('') + '</div>' +
      (keys.some((k) => G.chars[k].bot) ? '<div class="chips">' + keys.filter((k) => G.chars[k].bot).map((k) => '<button type="button" data-unbot="' + esc(k) + '">✕ ' + esc(G.chars[k].n) + '</button>').join('') + '</div>' : '') + '</div>';
    h += '<div class="card"><h3>Відпочинок</h3><p class="muted">Короткий (1 год): кожен кидає кістку хітів і лікується, Друге дихання й Сплеск дій повертаються. Довгий (8 год): усе відновлюється.</p><div class="row"><button class="btn2" type="button" data-rest="short" ' + (G.cb ? 'disabled' : '') + '>☕ Короткий</button><button class="btn2" type="button" data-rest="long" ' + (G.cb ? 'disabled' : '') + '>🌙 Довгий</button></div></div>';
    return h;
  }
  const MEMO = [
    ['Коли просити кидок', 'Лише коли 1) результат невідомий і 2) і успіх, і провал щось змінять. Легке робиться без кидка. Неможливе не стає можливим ні з якою 20.'],
    ['Хто вирішує, що кидати', 'Гравець каже, ЩО робить («я лізу на стіну»). Ти обираєш навичку й складність. «Кидаю Переконання» — не дія, а «вмовляю стражника пропустити» — дія.'],
    ['Перевірка чи рятівний кидок', 'Перевірка — герой щось робить сам. Рятівний — щось стається з героєм (вибух, отрута, чари), він опирається.'],
    ['Яку складність ставити', '10 — легко, 12 — трохи вміння, 15 — потрібна навичка, 20 — важко. Сумніваєшся — став 12.'],
    ['Перевага і перешкода', 'Добре описав, має допомогу, вигідна позиція — перевага (2к20, краще). Темрява, поспіх, поранення — перешкода. Не додавай +2/−2, просто перевага/перешкода.'],
    ['Провал рухає історію', 'Провал — не стіна, а ціна: час, хіти, шум, гірша позиція. Ніколи не кажи «нічого не вийшло, думайте далі» — кажи, що сталось натомість.'],
    ['Групова перевірка', 'Коли всі роблять одне (скрадаються, лізуть). Успіх, якщо впорався хоч би кожен другий.'],
    ['Пасивне сприйняття', 'Щоб не видати пастку проханням «киньте Сприйняття», подивись на пасивне (вкладка «Гравці»): більше або дорівнює складності — помітив.'],
    ['Хід у бою', 'Рух + 1 дія + 1 бонусна дія (якщо є чим) + 1 реакція за раунд (атака при нагоді). Рух можна ділити: підійти, вдарити, відійти.'],
    ['Повторні спроби', 'Якщо провал нічого не коштує — гравці пробуватимуть, поки не вийде. Тоді або не проси кидок (просто «за 10 хвилин ви це зробили»), або додай ціну кожній спробі.'],
  ];
  function viewMemo() {
    let h = '<div class="card"><h2>Памʼятка майстра</h2>' + MEMO.map((m) => '<div class="tip"><b>' + m[0] + '.</b> ' + esc(m[1]) + '</div>').join('') + '</div>';
    h += '<div class="card"><h3>Складність</h3>' + R.DC.map((d) => '<div class="sk"><b style="margin:0;width:34px">' + d.v + '</b>' + d.n + ' <em>' + esc(d.d) + '</em></div>').join('') + '</div>';
    h += '<div class="card"><h3>Уроки для гравців</h3><div class="row" style="margin-bottom:8px"><span class="grow muted">Показувати урок, коли правило трапляється вперше</span><button class="btn2 sm ' + (G.lessonsOn ? 'on' : '') + '" data-lessons="' + (G.lessonsOn ? 0 : 1) + '" type="button">' + (G.lessonsOn ? 'Увімкнено' : 'Вимкнено') + '</button></div><div class="chips">' +
      Object.keys(R.LESSONS).map((k) => '<button type="button" data-teach="' + k + '">' + (G.seen.includes(k) ? '✔ ' : '') + R.LESSONS[k].t + '</button>').join('') + '</div><p class="muted">Торкнись уроку — і він зʼявиться на всіх телефонах.</p></div>';
    h += viewRules();
    h += '<div class="card"><h3>Гра</h3><p class="muted">Стан гри зберігається на цьому телефоні. Якщо щось закрилось — «Продовжити гру» на старті.</p><button class="btn2" type="button" data-leave="1">Вийти з гри</button></div>';
    return h;
  }

  /* ---------- кліки в основній частині ---------- */
  $('main').addEventListener('click', (e) => {
    const b = e.target.closest('button,[data-info]'); if (!b) return;
    const d = b.dataset;
    if (d.stat) return popStat(d.stat);
    if (d.skill) { const s = R.SKILLS[d.skill], ch = G.chars[ME.key], bb = E.skillB(ch, d.skill); return pop('<h3>' + s.n + '</h3><p class="muted">' + R.STATS[s.st].n + (s.tool ? ' · інструменти' : '') + '</p><p>' + esc(s.d) + '</p><div class="parts"><span>' + R.STATS[s.st].n + ' ' + sgn(bb.m) + '</span>' + (bb.p ? '<span>' + (bb.p > 2 ? 'Експертність' : 'Майстерність') + ' +' + bb.p + '</span>' : '<span>не твоя навичка</span>') + '</div>'); }
    if (d.save) return pop('<h3>Рятівний: ' + R.STATS[d.save].n + '</h3><p>' + esc(R.SAVES[d.save]) + '</p>');
    if (d.spell) return popSpell(d.spell);
    if (d.info && INFO[d.info]) return pop('<h3>' + INFO[d.info][0] + '</h3><p>' + esc(INFO[d.info][1]) + '</p>');
    if (d.openck) { U.ckOpen = true; return openCheckPrompt(); }
    if (d.dm) return send({ t: d.dm === 'next' ? 'dmnext' : 'dmdone' });
    if (d.dmpick) return send({ t: 'dmpick', o: d.dmpick });
    if (d.tab) { U.tab = d.tab; U.ver++; return render(); }
    if (d.soloagain) { try { localStorage.removeItem('dnd_solo'); } catch (e) {} leave(); $('btnSoloResume').hidden = true; return; }
    if (d.latecls) { ME.cls = d.latecls; if (NET) NET.presence({ cls: ME.cls }); return; }
    if (d.scene != null && d.scene !== undefined && b.hasAttribute('data-scene')) return send({ t: 'scene', sc: +d.scene });
    if (b.hasAttribute('data-ask')) return openCheckCfg(d.ask);
    if (d.rollfor) return send({ t: 'roll', k: d.rollfor });
    if (d.ckclose) return send({ t: 'ckclose' });
    if (d.fight) { const s = $('surp_' + d.fight); send({ t: 'fight', f: d.fight, surp: s ? s.value : '' }); U.tab = 'fight'; return render(true); }
    if (d.finale) return send({ t: 'finale', v: d.finale });
    if (d.teach) return send({ t: 'teach', k: d.teach });
    if (d.lore) return send({ t: 'lore', k: d.lore });
    if (d.jr) return send({ t: 'journal', k: d.jr });
    if (d.lessons) return send({ t: 'lessons', on: d.lessons === '1' });
    if (d.hp) return send({ t: 'hp', k: d.hp, d: +d.d });
    if (d.slot) return send({ t: 'slot', k: d.slot, d: +d.d });
    if (d.rest) return send({ t: 'rest', kind: d.rest });
    if (d.bot) return send({ t: 'bot', cls: d.bot });
    if (d.unbot) return send({ t: 'unbot', k: d.unbot });
    if (d.leave) { if (confirm('Вийти? Гру збережено на цьому телефоні.')) leave(); }
  });

  /* ---------- попапи ---------- */
  function pop(html) { $('popSheet').innerHTML = html + '<button class="btn wide" type="button" data-popclose="1" style="margin-top:12px">Зрозуміло</button>'; $('pop').hidden = false; }
  $('pop').addEventListener('click', (e) => { if (e.target.id === 'pop' || e.target.closest('[data-popclose]')) $('pop').hidden = true; });
  function popStat(s) {
    const ch = G.chars[ME.key], c = ch && R.CLASSES[ch.cls];
    pop('<h3>' + R.STATS[s].n + (c ? ' ' + c.st[s] + ' (' + sgn(R.mod(c.st[s])) + ')' : '') + '</h3><p>' + esc(R.STATS[s].d) + '</p><p class="muted">Модифікатор = (значення − 10) ÷ 2, вниз. Саме модифікатор додається до к20.</p>' +
      '<p class="eyebrow">Навички цього стату</p>' + (R.SKILL_ORDER.filter((k) => R.SKILLS[k].st === s).map((k) => '<div class="sk">' + R.SKILLS[k].n + ' <em>' + esc(R.SKILLS[k].d) + '</em>' + (ch ? '<b>' + sgn(E.skillB(ch, k).m + E.skillB(ch, k).p) + '</b>' : '') + '</div>').join('') || '<p class="muted">Немає. Перевірку Статури просять «чисто»: витримати холод, не спати всю ніч, перепити орка.</p>') +
      '<p class="eyebrow" style="margin-top:8px">Рятівний кидок</p><p class="muted">' + esc(R.SAVES[s]) + '</p>');
  }
  function popSpell(id) { const sp = R.SPELLS[id]; pop('<h3>🪄 ' + sp.n + '</h3><p class="muted">' + (sp.lvl ? 'Заклинання 1 кола — витрачає комірку' : 'Замовляння — без комірок, скільки завгодно') + ' · ' + (sp.time === 'b' ? 'бонусна дія' : 'дія') + (sp.range > 1 ? ' · ' + sp.range + ' кл (' + sp.range * 1.5 + ' м)' : sp.range === 1 ? ' · дотик' : ' · від себе') + (sp.conc ? ' · концентрація' : '') + '</p><p>' + esc(sp.d) + '</p>'); }
  function popToken(t) {
    const i = E.info(G, t), dm = ME.role === 'dm', mine = t.ch === ME.key;
    const hpTxt = i.pc || dm ? i.hp + '/' + i.mhp + ' хітів' : (i.dead ? 'переможений' : i.hp / i.mhp > 0.66 ? 'майже цілий' : i.hp / i.mhp > 0.33 ? 'поранений' : 'ледь тримається');
    const cond = [];
    if (t.cond.sleep) cond.push('💤 спить'); if (i.down) cond.push('🩸 без тями'); if (t.cond.dodge) cond.push('🛡 ухиляється'); if (t.cond.bless) cond.push('✦ благословенний'); if (t.cond.slow) cond.push('❄ сповільнений'); if (t.hidden) cond.push('🫥 схований'); if (t.conc) cond.push('◎ концентрація: ' + R.SPELLS[t.conc].n);
    let h = '<div class="sheet-h"><span class="avatar" style="background:' + i.col + '">' + i.ic + '</span><div class="grow"><h3 style="margin:0">' + esc(i.n) + '</h3><span class="muted">' + hpTxt + (dm || i.pc ? ' · КБ ' + i.ac : '') + ' · швидкість ' + i.sp + ' кл</span></div></div>';
    if (cond.length) h += '<p>' + cond.join(' · ') + '</p>';
    if (i.m) h += '<p class="muted">' + esc(i.m.d) + '</p>' + (dm ? '<p class="muted">' + i.m.atk.map((a) => a.n + ' ' + sgn(a.bonus) + ', ' + kd(a.dmg)).join(' · ') + '</p>' : '');
    if (dm && i.m) h += '<div class="row">' + [-5, -1, 1, 5].map((d) => '<button class="btn2 sm" type="button" data-mhp="' + t.id + '" data-d="' + d + '">' + (d > 0 ? '+' : '') + d + '</button>').join('') + '</div>';
    void mine; pop(h);
  }
  $('popSheet').addEventListener('click', (e) => { const b = e.target.closest('[data-mhp]'); if (b) { send({ t: 'mhp', tok: b.dataset.mhp, d: +b.dataset.d }); $('pop').hidden = true; } });

  /* ---------- модалки перевірок ---------- */
  function openModal(kind, html) { U.modalKind = kind; $('modalSheet').innerHTML = html; $('modal').hidden = false; if (!$('lesson').hidden) placeLesson(); }
  function closeModal() { U.modalKind = null; $('modal').hidden = true; if (!$('lesson').hidden) placeLesson(); }
  function d20Svg(n, cls) {
    return '<div class="big20 ' + (cls || '') + '"><svg viewBox="0 0 100 100"><polygon points="50,3 93,27 93,73 50,97 7,73 7,27" fill="#ECE6DA" stroke="#B9A98C" stroke-width="3"/><polygon points="50,18 79,66 21,66" fill="none" stroke="#B9A98C" stroke-width="2"/></svg><span>' + n + '</span></div>';
  }
  /* кидки інших учасників тієї самої перевірки */
  function othersHtml(ck) {
    const oth = ck.who.filter((k) => k !== ME.key); if (!oth.length) return '';
    return '<div class="others"><p class="eyebrow" style="margin:6px 0 4px">' + (ck.mode === 'group' ? 'Групова — рахуються всі' : 'Кидають також') + '</p>' + oth.map((k) => {
      const ch = G.chars[k], c = R.CLASSES[ch.cls], r = ck.res[k];
      return '<div class="oth"><span class="avatar" style="width:28px;height:28px;font-size:15px;background:' + c.col + '">' + c.ic + '</span><span class="grow">' + esc(ch.n.replace(/ \(бот\)$/, '')) + '</span>' +
        (r ? dieHtml(r) + '<b class="' + (r.ok ? 'ok' : 'bad') + '">' + r.tot + (r.ok ? ' ✔' : ' ✖') + '</b>' : '<span class="die rolling">?</span>') + '</div>';
    }).join('') + '</div>';
  }
  const bonusOf = (ch, ck) => E.checkParts(ch, ck).reduce((a, p) => a + p[1], 0);
  /* дивимось, як кидає хтось інший */
  function openWatch() {
    const ck = G.ck; if (!ck) return;
    const main = ck.who[0], ch = G.chars[main], c = ch && R.CLASSES[ch.cls]; if (!ch) return;
    const me = G.chars[ME.key], nm = (x) => esc(x.n.replace(/ \(бот\)$/, ''));
    const why = String(ck.why || '').replace(/ ?Кидає .*? — у цій групі це виходить найкраще\.?/, '');
    let h = '<p class="eyebrow">' + (ck.kind === 'sv' ? 'Рятівний кидок' : 'Перевірка') + '</p>';
    if (ck.who.length === 1) {
      h += '<div class="sheet-h" style="margin:4px 0 8px"><span class="avatar" style="background:' + c.col + '">' + c.ic + '</span><div class="grow"><h2 style="margin:0">Кидає ' + nm(ch) + '</h2><span class="muted">' + esc(E.checkName(ck)) + (ck.t ? ' · ' + esc(ck.t) : '') + '</span></div></div>';
      if (me) {
        const hb = bonusOf(ch, ck), mb = bonusOf(me, ck);
        h += '<div class="gm"><b>Чому ' + nm(ch) + ', а не ти?</b> ' + (hb > mb ? '<br>' + nm(ch) + ': <b>' + sgn(hb) + '</b> (' + E.checkParts(ch, ck).map((p) => esc(p[0]) + ' ' + sgn(p[1])).join(', ') + ')<br>Ти: <b>' + sgn(mb) + '</b><br>Майстер дає кидок тому, хто вміє це найкраще.' : 'Так склалась історія — зараз діє саме цей герой.') + '</div>';
      }
    } else h += '<h2>' + esc(E.checkName(ck)) + '</h2>' + (ck.t ? '<p class="muted">' + esc(ck.t) + '</p>' : '');
    if (why) h += '<div class="tip">Чому ця перевірка: ' + esc(why) + '</div>';
    h += '<p style="text-align:center" class="muted">' + (ck.show ? 'Складність ' + ck.dc : 'Складність прихована') + (ck.adv ? (ck.adv > 0 ? ' · ▲ перевага' : ' · ▼ перешкода') : '') + '</p>';
    if (ck.who.length === 1) {
      const r = ck.res[main];
      if (!r) h += d20Svg('?', 'rolling') + '<p class="muted" style="text-align:center">' + nm(ch) + ' кидає к20…</p>';
      else {
        h += d20Svg(r.v, U.watchAnim === ck.id ? '' : 'spin') + (r.d.length > 1 ? '<p class="muted" style="text-align:center">к20: ' + r.d.join(' і ') + ' → ' + r.v + '</p>' : '') +
          '<p style="text-align:center;font-size:17px">' + r.v + ' ' + r.parts.map((p) => sgn(p[1])).join(' ') + ' = <b style="font-size:24px">' + r.tot + '</b>' + (ck.show ? ' проти ' + ck.dc : '') + '</p>' +
          '<div class="parts">' + r.parts.map((p) => '<span>' + esc(p[0]) + ' ' + sgn(p[1]) + '</span>').join('') + '</div>' +
          '<p class="verdict ' + (r.ok ? 'ok' : 'bad') + '">' + (r.ok ? 'Успіх!' : 'Провал') + '</p>';
        if (U.watchAnim !== ck.id) { U.watchAnim = ck.id; beep('dice'); }
      }
    } else h += othersHtml(Object.assign({}, ck, { who: ck.who.concat(ME.key).filter((k, i, a) => a.indexOf(k) === i) })).replace('Кидають також', 'Кидають');
    if (ck.mode === 'group' && ck.done) h += '<p class="verdict ' + (ck.gok ? 'ok' : 'bad') + '" style="font-size:20px">Група: ' + (ck.gok ? 'успіх' : 'провал') + '</p>';
    h += '<button class="btn2" type="button" id="watchOk" style="width:100%;margin-top:10px">' + (ck.done ? 'Ок' : 'Сховати') + '</button>';
    openModal('watch', h);
    $('watchOk').onclick = () => { U.watchOpen = false; closeModal(); U.ver++; render(); };
  }
  function openCheckPrompt() {
    const ck = G.ck, ch = G.chars[ME.key]; if (!ck || !ch) return;
    const r = ck.res[ME.key], parts = E.checkParts(ch, ck);
    const info = ck.kind === 'sk' ? R.SKILLS[ck.key].d : ck.kind === 'st' ? R.STATS[ck.key].d : R.SAVES[ck.key];
    const dcInfo = R.DC.slice().reverse().find((d) => ck.dc >= d.v) || R.DC[0];
    let h = '<p class="eyebrow">' + (ck.kind === 'sv' ? 'Рятівний кидок' : 'Майстер просить перевірку') + '</p><h2>' + esc(E.checkName(ck)) + '</h2>' + (ck.t ? '<p class="muted">' + esc(ck.t) + '</p>' : '') + '<p style="margin:6px 0">' + esc(info) + '</p>' + (ck.why ? '<div class="tip">Чому так: ' + esc(ck.why) + '</div>' : '');
    h += '<div class="parts"><span>к20</span>' + parts.map((p) => '<span>' + esc(p[0]) + ' ' + sgn(p[1]) + '</span>').join('') + (ck.gd ? '<span>Настанова +1к4</span>' : '') + (ck.kind === 'sk' && !E.skillB(ch, ck.key).p ? '<span class="muted">не твоя навичка — без майстерності</span>' : '') + '</div>';
    if (ck.adv) h += '<p style="text-align:center"><span class="chip ' + (ck.adv > 0 ? 'gold' : 'red') + '">' + (ck.adv > 0 ? '▲ Перевага: 2к20, береш більше' : '▼ Перешкода: 2к20, береш менше') + '</span></p>';
    h += '<p style="text-align:center" class="muted">' + (ck.show ? 'Складність ' + ck.dc + ' — ' + dcInfo.n.toLowerCase() : 'Складність прихована — майстер скаже, чи вийшло') + (ck.mode === 'group' ? ' · групова' : '') + '</p>';
    if (!r) h += '<button type="button" id="rollBtn" style="display:block;margin:0 auto;border:0;background:none">' + d20Svg('?') + '</button><button class="btn wide" type="button" id="rollBtn2">🎲 Кинути к20</button>';
    else {
      const used = r.d.length > 1 ? 'к20: ' + r.d.join(' і ') + ' → ' + r.v : '';
      h += d20Svg(r.v, U.ckAnim === ck.id ? '' : 'spin') + (used ? '<p class="muted" style="text-align:center">' + used + '</p>' : '') +
        '<p style="text-align:center;font-size:17px">' + r.v + ' ' + r.parts.map((p) => sgn(p[1])).join(' ') + ' = <b style="font-size:24px">' + r.tot + '</b>' + (ck.show ? ' проти ' + ck.dc : '') + '</p>' +
        '<p class="verdict ' + (r.ok ? 'ok' : 'bad') + '">' + (ck.show || ck.done ? (r.ok ? 'Успіх!' : 'Провал') : 'Чекай слова майстра') + '</p>' +
        (r.v === 20 ? '<p class="muted" style="text-align:center">Натуральна 20! Найкраще з можливого — але лише з можливого.</p>' : '') +
        (ck.mode === 'group' && ck.done ? '<p class="verdict ' + (ck.gok ? 'ok' : 'bad') + '" style="font-size:20px">Група: ' + (ck.gok ? 'успіх' : 'провал') + '</p>' : '') +
        othersHtml(ck) + '<button class="btn2" type="button" id="ckOk" style="width:100%;margin-top:8px">Ок</button>';
      if (U.ckAnim !== ck.id) { U.ckAnim = ck.id; beep('dice'); }
    }
    openModal('ck', h);
    const rb = () => { send({ t: 'roll' }); beep('dice'); $('modalSheet').querySelector('.big20') && $('modalSheet').querySelector('.big20').classList.add('spin'); };
    if ($('rollBtn')) { $('rollBtn').onclick = rb; $('rollBtn2').onclick = rb; }
    if ($('ckOk')) $('ckOk').onclick = () => { U.ckOpen = false; closeModal(); U.ver++; render(); };
  }

  function openCheckCfg(sid) {
    const c = sid ? S.SCENES.flatMap((s) => s.checks).find((x) => x.id === sid) : null;
    const all = Object.keys(G.chars).filter((k) => !G.chars[k].dead);
    U.cfg = c ? Object.assign({ t: c.t, dc: c.dc, show: true, adv: 0, gd: false, sid: c.id, mode: c.who === 'group' ? 'group' : 'one', who: c.who === 'one' ? (all.length === 1 ? all.slice() : []) : all.slice() }, ckDef(c))
      : { t: '', kind: 'sk', key: 'perception', dc: 12, show: true, adv: 0, gd: false, sid: null, mode: 'one', who: [] };
    renderCfg();
  }
  function renderCfg() {
    const f = U.cfg, all = Object.keys(G.chars).filter((k) => !G.chars[k].dead);
    const opts = f.kind === 'sk' ? R.SKILL_ORDER.map((k) => '<option value="' + k + '"' + (f.key === k ? ' selected' : '') + '>' + R.SKILLS[k].n + ' (' + R.STATS[R.SKILLS[k].st].s + ')</option>').join('')
      : R.STAT_IDS.map((k) => '<option value="' + k + '"' + (f.key === k ? ' selected' : '') + '>' + R.STATS[k].n + '</option>').join('');
    if (f.kind === 'sk' && !R.SKILLS[f.key]) f.key = 'perception';
    if (f.kind !== 'sk' && !R.STATS[f.key]) f.key = 'dex';
    const desc = f.kind === 'sk' ? R.SKILLS[f.key].d : f.kind === 'st' ? R.STATS[f.key].d : R.SAVES[f.key];
    const dcd = R.DC.find((d) => d.v === f.dc);
    let h = '<p class="eyebrow">Перевірка</p><h2>' + esc(f.t || 'Своя перевірка') + '</h2>' +
      '<div class="seg" style="margin-top:10px">' + [['sk', 'Навичка'], ['st', 'Чистий стат'], ['sv', 'Рятівний']].map((k) => '<button type="button" data-kind="' + k[0] + '" class="' + (f.kind === k[0] ? 'on' : '') + '">' + k[1] + '</button>').join('') + '</div>' +
      '<label class="f">' + (f.kind === 'sk' ? 'Навичка' : 'Стат') + '<select id="cfgKey">' + opts + '</select></label><div class="gm" style="margin-top:-4px">' + esc(desc) + '</div>' +
      '<p class="eyebrow" style="margin-top:10px">Складність</p><div class="chips">' + R.DC.map((d) => '<button type="button" data-dc="' + d.v + '" class="' + (f.dc === d.v ? 'on' : '') + '">' + d.v + '</button>').join('') + (dcd ? '' : '<button type="button" class="on">' + f.dc + '</button>') + '</div>' +
      (dcd ? '<p class="muted" style="margin-top:-6px">' + dcd.n + ': ' + esc(dcd.d) + '</p>' : '') +
      '<div class="seg">' + [[0, 'Звичайно'], [1, '▲ Перевага'], [-1, '▼ Перешкода']].map((k) => '<button type="button" data-adv="' + k[0] + '" class="' + (f.adv === k[0] ? 'on' : '') + '">' + k[1] + '</button>').join('') + '</div>' +
      '<div class="chips"><button type="button" data-show="1" class="' + (f.show ? 'on' : '') + '">' + (f.show ? '👁 Складність видно' : '🙈 Складність прихована') + '</button><button type="button" data-gd="1" class="' + (f.gd ? 'on' : '') + '">Настанова жриці +1к4</button></div>' +
      '<p class="eyebrow">Хто кидає</p><div class="chips">' + all.map((k) => '<button type="button" data-who="' + k + '" class="' + (f.who.includes(k) ? 'on' : '') + '">' + R.CLASSES[G.chars[k].cls].ic + ' ' + esc(G.chars[k].n) + '</button>').join('') + '<button type="button" data-whoall="1">Усі</button></div>' +
      (f.who.length > 1 ? '<div class="seg">' + [['one', 'Кожен окремо'], ['group', 'Групова']].map((k) => '<button type="button" data-mode="' + k[0] + '" class="' + (f.mode === k[0] ? 'on' : '') + '">' + k[1] + '</button>').join('') + '</div>' : '') +
      '<div class="row"><button class="btn2" type="button" data-cfgclose="1">Скасувати</button><button class="btn grow" type="button" data-cfgsend="1"' + (f.who.length ? '' : ' disabled') + '>Попросити кинути</button></div>';
    openModal('cfg', h);
    $('cfgKey').onchange = (e) => { f.key = e.target.value; renderCfg(); };
  }
  $('modalSheet').addEventListener('click', (e) => {
    if (U.modalKind !== 'cfg') return;
    const b = e.target.closest('button'); if (!b) return; const d = b.dataset, f = U.cfg;
    if (d.kind) { f.kind = d.kind; f.key = d.kind === 'sk' ? 'perception' : 'dex'; }
    else if (d.dc) f.dc = +d.dc;
    else if (d.adv != null && b.hasAttribute('data-adv')) f.adv = +d.adv;
    else if (d.show) f.show = !f.show;
    else if (d.gd) f.gd = !f.gd;
    else if (d.who) f.who = f.who.includes(d.who) ? f.who.filter((k) => k !== d.who) : f.who.concat(d.who);
    else if (d.whoall) f.who = Object.keys(G.chars).filter((k) => !G.chars[k].dead);
    else if (d.mode) f.mode = d.mode;
    else if (d.cfgclose) { closeModal(); return; }
    else if (d.cfgsend) { closeModal(); send({ t: 'ck', cfg: Object.assign({}, f) }); U.tab = 'scene'; U.toTop = true; render(true); return; }
    renderCfg();
  });
  $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal' && U.modalKind === 'cfg') closeModal(); });

  /* ---------- уроки й тости ---------- */
  function placeLesson() { // на мапі — над панеллю дій, щоб не закривати кнопки
    const map = !$('mapBox').hidden, modal = !$('modal').hidden;
    // поверх вікна кидка — нагорі; на мапі — над панеллю дій; інакше — внизу над вкладками
    $('lesson').style.top = modal ? 'calc(env(safe-area-inset-top,0px) + 50px)' : '';
    $('lesson').style.bottom = modal ? 'auto' : map ? ($('act').getBoundingClientRect().height + $('tabs').getBoundingClientRect().height + 8) + 'px' : '';
  }
  function nextLesson() {
    const k = U.lesQ.shift(), L = k && R.LESSONS[k]; if (!L) return;
    $('lesson').innerHTML = '<p class="eyebrow" style="color:#C5A8FF">Правило' + (U.lesQ.length ? ' · ще ' + U.lesQ.length : '') + '</p><h3>📖 ' + esc(L.t) + '</h3><p>' + esc(L.d) + '</p><button class="btn2 sm" type="button" id="lesOk">' + (U.lesQ.length ? 'Далі' : 'Зрозуміло') + '</button>';
    $('lesson').hidden = false; placeLesson();
    $('lesOk').onclick = () => { $('lesson').hidden = true; nextLesson(); };
    clearTimeout(U.lesT); U.lesT = setTimeout(() => { $('lesson').hidden = true; nextLesson(); }, 20000);
  }
  setInterval(() => {
    if (performance.now() < U.toastT) return;
    const e = U.toastQ.shift();
    if (!e) { if (!$('toast').hidden && performance.now() > U.toastT) $('toast').hidden = true; return; }
    if (U.modalKind === 'ck') { return; }
    const r = e.r;
    $('toast').innerHTML = rollLine(r);
    $('toast').hidden = false; $('toast').classList.remove('show'); void $('toast').offsetWidth; $('toast').classList.add('show');
    if (r.vsL !== 'КБ') beep('dice');
    U.toastT = performance.now() + (U.toastQ.length ? 2200 : 3400);
  }, 120);

  /* ==================== БІЙ ==================== */
  function ctl() {
    if (!G || !G.cb || G.cb.won || G.cb.lost) return null;
    const t = E.cur(G); if (!t) return null;
    if (ME.role === 'pl') return t.ch === ME.key ? t : null;
    if (!t.ch) return t;
    if (G.chars[t.ch] && G.chars[t.ch].bot) return U.override ? t : null;
    return U.override || !online(t.ch) ? t : null;
  }
  function renderOrder() {
    const cb = G.cb, cur = E.cur(G);
    $('order').innerHTML = cb.order.map((id) => { const t = cb.tk[id], i = E.info(G, t); return '<button type="button" class="oc' + (t === cur ? ' cur' : '') + (i.dead ? ' dead' : '') + '" data-tok="' + id + '"><i style="background:' + i.col + '">' + i.ic + '</i><span>' + esc(i.n.replace(/ \(бот\)$/, ' 🤖')) + (t.cond.sleep ? ' 💤' : '') + (i.down ? ' 🩸' : '') + '</span></button>'; }).join('');
  }
  $('order').addEventListener('click', (e) => { const b = e.target.closest('[data-tok]'); if (b && G.cb) popToken(G.cb.tk[b.dataset.tok]); });

  function canAction(t) { return t.act > 0 && t.atkLeft <= 0; }
  function renderAct() {
    const cb = G.cb, t = ctl(), cur = E.cur(G);
    let h = '';
    if (cb.won || cb.lost) {
      h += '<p class="verdict ' + (cb.won ? 'ok' : 'bad') + '">' + (cb.won ? '🏆 Перемога!' : '☠️ Усі герої впали') + '</p>';
      h += ME.role === 'dm' ? '<p class="hint">' + (cb.won ? 'Розкажи, що вони знаходять. Порада: короткий відпочинок у вкладці «Гравці».' : 'Вирішуй: Ерандур витягає їх, полон культистів або кінець. Хіти можна підняти у вкладці «Гравці».') + '</p><button class="btn wide" type="button" data-a="fightend">Завершити бій</button>' : '<p class="hint" style="text-align:center">Чекаємо майстра.</p>';
      $('act').innerHTML = h; return;
    }
    if (!t) {
      const i = cur && E.info(G, cur);
      h += '<p class="hint">Зараз ходить: <b>' + (i ? i.ic + ' ' + esc(i.n) : '—') + '</b>' + (ME.role === 'pl' && G.chars[ME.key] ? ' · ти — ' + esc(G.chars[ME.key].n) : '') + '</p>';
      if (ME.role === 'dm' && cur && cur.ch && G.chars[cur.ch].bot) h += '<p class="hint">🤖 Бот ходить сам…</p><button class="btn2" type="button" data-a="override">Сходити за нього</button> ';
      else if (ME.role === 'dm' && cur && cur.ch) h += '<p class="hint">Гравець ' + esc(i.n) + ' ходить зі свого телефона.</p><button class="btn2" type="button" data-a="override">Діяти за гравця</button> ';
      if (ME.role === 'pl') h += '<p class="hint">Поки чекаєш: торкнись будь-кого на мапі, щоб подивитись. Подумай, що зробиш у свій хід.</p>';
    } else h += actPanel(t);
    if (ME.role === 'dm') h += '<div class="row" style="margin-top:8px"><button class="btn2 sm ' + (cb.auto ? 'on' : '') + '" type="button" data-a="autoall">🤖 Монстри самі: ' + (cb.auto ? 'так' : 'ні') + '</button><button class="btn2 sm" type="button" data-a="fightend">Завершити бій</button></div>';
    $('act').innerHTML = h;
  }
  function chip(txt, used) { return '<span class="chip' + (used ? ' used' : '') + '">' + txt + '</span>'; }
  function actPanel(t) {
    const i = E.info(G, t), atks = E.attacks(G, t);
    let h = '<div class="res"><b style="margin-right:4px">' + i.ic + ' ' + esc(i.n) + '</b>' + chip('🚶 ' + t.mv + ' кл', t.mv <= 0) + chip('Дія', !canAction(t) && t.atkLeft <= 0) + chip('Бонусна', t.bon <= 0) + (t.atkLeft > 0 ? chip('ще атак: ' + t.atkLeft) : '') + chip('Реакція', t.react <= 0) + '</div>';
    if (i.down) {
      return h + '<p class="hint">Ти без тями. Кидок від смерті: 10+ — успіх, менше — провал. ✔' + i.ch.ds.s + '/3 ✖' + i.ch.ds.f + '/3. Тебе можуть підняти лікуванням.</p><div class="agrid"><button class="ab" type="button" data-a="death"' + (t.act > 0 ? '' : ' disabled') + '><b>🎲</b>Кидок від смерті</button><button class="ab end" type="button" data-a="end"><b>⏭</b>Кінець ходу</button></div>';
    }
    // підтвердження
    const conf = confirmHtml(t);
    if (conf) h += conf;
    h += '<p class="hint">' + hintTxt(t) + '</p>';
    const b = [];
    b.push(['move', '🚶', 'Рух', t.mv + ' кл · ' + (t.mv * 1.5) + ' м', t.mv <= 0, U.mode === 'move']);
    atks.forEach((a, k) => b.push(['w' + k, a.range && !a.reach ? '🏹' : a.spell ? '🔥' : '⚔️', a.n, sgn(a.b) + ' · ' + kd(a.dmg), !(t.atkLeft > 0 || t.act > 0), U.mode === 'atk' && U.wi === k]));
    if (i.pc && i.c.spells) i.c.spells.forEach((s) => { const sp = R.SPELLS[s]; b.push(['s' + s, '🪄', sp.n, (sp.lvl ? 'комірка ' + i.ch.slots : 'замовляння') + (sp.time === 'b' ? ' · бонус' : ''), (sp.time === 'b' ? t.bon <= 0 : !canAction(t)) || (sp.lvl > 0 && i.ch.slots <= 0), U.mode === 'spell' && U.sp === s]); });
    b.push(['dash', '🏃', 'Ривок', '+' + i.sp + ' кл, дія', !canAction(t)]);
    b.push(['dis', '↩️', 'Відступ', 'без атак при нагоді', !canAction(t)]);
    b.push(['dodge', '🛡️', 'Ухилення', 'атаки по тобі з ▼', !canAction(t)]);
    if (E.toks(G).some((o) => o.side === t.side && o.cond.sleep && E.dist(o, t) <= 1)) b.push(['wake', '👋', 'Розбудити', 'сусіда, дія', !canAction(t), U.mode === 'wake']);
    if (i.pc && i.ch.cls === 'fighter') { b.push(['wind', '💨', 'Друге дихання', 'бонус · ' + (i.ch.uses.wind ? '1к10+2' : 'витрачено'), t.bon <= 0 || !i.ch.uses.wind]); b.push(['surge', '⚡', 'Сплеск дій', i.ch.uses.surge ? '+1 дія' : 'витрачено', !i.ch.uses.surge]); }
    if (i.pc && i.ch.cls === 'rogue') { b.push(['cdash', '🏃', 'Хитрий ривок', 'бонус', t.bon <= 0]); b.push(['cdis', '↩️', 'Хитрий відступ', 'бонус', t.bon <= 0]); b.push(['chide', '🫥', 'Сховатись', 'бонус · Скритність', t.bon <= 0]); }
    if (!i.pc && ME.role === 'dm') b.push(['auto', '🤖', 'Авто-хід', 'гра сходить сама', false]);
    b.push(['end', '⏭️', 'Кінець ходу', '', false]);
    h += '<div class="agrid">' + b.map((x) => '<button type="button" class="ab' + (x[5] ? ' on' : '') + (x[0] === 'end' ? ' end' : '') + '" data-a="' + x[0] + '"' + (x[4] ? ' disabled' : '') + '><b>' + x[1] + '</b>' + esc(x[2]) + (x[3] ? '<small>' + esc(x[3]) + '</small>' : '') + '</button>').join('') + '</div>';
    return h;
  }
  function hintTxt(t) {
    if (U.mode === 'move') return t.mv > 0 ? 'Торкнись <b>зеленої</b> клітинки — побачиш шлях, ще раз — іди. Жовті — лише з Ривком.' : 'Рух витрачено. Можна діяти або закінчити хід.';
    if (U.mode === 'atk') { const a = E.attacks(G, t)[U.wi]; return a.range ? 'Блакитні клітинки — звичайна дальність, помаранчеві — з перешкодою. Торкнись цілі.' : 'Ціль має стояти впритул (червоні клітинки). Торкнись ворога.'; }
    if (U.mode === 'spell') {
      const sp = R.SPELLS[U.sp];
      if (sp.kind === 'area') return 'Торкнись клітинки, куди спрямувати конус. Обережно: зачепить і своїх.';
      if (sp.kind === 'sleep') return 'Торкнись центру кола (фіолетові клітинки — у межах дальності). Засинають і свої!';
      if (sp.kind === 'darts') return 'Торкайся цілей: 3 снаряди, можна в одну. ' + U.tgts.length + '/3';
      if (sp.kind === 'buff') return 'Торкнись до 3 союзників (себе теж можна). ' + U.tgts.length + '/3';
      if (sp.kind === 'heal') return sp.range === 1 ? 'Торкнись союзника поруч (або себе).' : 'Торкнись союзника в межах 12 клітинок.';
      return 'Торкнись цілі.';
    }
    if (U.mode === 'wake') return 'Торкнись сплячого союзника поруч.';
    return '';
  }
  function confirmHtml(t) {
    if (U.mode === 'move' && U.sel) {
      const r = E.reach(G, t, t.mv), p = E.pathTo(r, t, U.sel[0], U.sel[1]); if (!p) return '';
      const cost = r.d.get(r.K(U.sel[0], U.sel[1])), oa = oaList(t, p);
      return '<div class="confirm"><span class="grow">Іти: <b>' + cost + ' кл</b> (' + cost * 1.5 + ' м)' + (oa.length ? '<br><b class="bad">⚠ Атака при нагоді: ' + oa.map((o) => esc(E.info(G, o).n)).join(', ') + '</b> — візьми «Відступ», щоб уникнути' : '') + '</span><button class="btn" type="button" data-a="go">Іти</button></div>';
    }
    if (U.mode === 'atk' && U.tgt) {
      const a = E.attacks(G, t)[U.wi], tg = G.cb.tk[U.tgt], c = E.atkCheck(G, t, a, tg);
      if (!c.ok) return '';
      return '<div class="confirm"><span class="grow">' + esc(a.n) + ' → <b>' + esc(E.info(G, tg).n) + '</b><br>' + (c.adv.concat(c.dis).length ? c.adv.map((s) => '<span class="ok">▲ ' + esc(s) + '</span>').concat(c.dis.map((s) => '<span class="bad">▼ ' + esc(s) + '</span>')).join(' · ') + (c.adv.length && c.dis.length ? ' → взаємно гасяться' : '') : '<span class="muted">звичайний кидок</span>') + '</span><button class="btn" type="button" data-a="fire">Атака</button></div>';
    }
    if (U.mode === 'spell') {
      const sp = R.SPELLS[U.sp];
      let ready = false, txt = '';
      if (['atk', 'save1', 'heal', 'mark'].includes(sp.kind) && U.tgt) { ready = true; txt = '→ <b>' + esc(E.info(G, G.cb.tk[U.tgt]).n) + '</b>'; if (sp.kind === 'atk') { const c = E.atkCheck(G, t, { b: 0, reach: 0, range: sp.range, long: sp.range }, G.cb.tk[U.tgt]); if (c.ok && c.dis.length) txt += '<br><span class="bad">▼ ' + c.dis.map(esc).join(', ') + '</span>'; if (c.ok && c.adv.length) txt += '<br><span class="ok">▲ ' + c.adv.map(esc).join(', ') + '</span>'; } }
      if ((sp.kind === 'darts' || sp.kind === 'buff') && U.tgts.length) { ready = sp.kind === 'buff' || U.tgts.length === 3; txt = U.tgts.map((id) => esc(E.info(G, G.cb.tk[id]).n)).join(', ') + (sp.kind === 'darts' ? ' (' + U.tgts.length + '/3)' : ''); }
      if ((sp.kind === 'area' || sp.kind === 'sleep') && U.sel) { ready = true; const n = previewCells(t).filter(([x, y]) => E.occ(G, x, y)).length; txt = 'У зоні: ' + n + ' ' + (n === 1 ? 'істота' : 'істот'); }
      if (!txt) return '';
      return '<div class="confirm"><span class="grow">🪄 ' + esc(sp.n) + ' ' + txt + '</span>' + (sp.kind === 'darts' || sp.kind === 'buff' ? '<button class="btn2 sm" type="button" data-a="untgt">Скинути</button>' : '') + '<button class="btn" type="button" data-a="cast"' + (ready ? '' : ' disabled') + '>Читати</button></div>';
    }
    return '';
  }
  function oaList(t, path) {
    if (t.dis) return [];
    const out = []; let px = t.x, py = t.y;
    for (const [nx, ny] of path) {
      for (const o of E.toks(G)) {
        if (o.side === t.side || !E.active(G, o) || o.react <= 0 || out.includes(o)) continue;
        const a = E.attacks(G, o).find((q) => q.reach); if (!a) continue;
        if (Math.max(Math.abs(o.x - px), Math.abs(o.y - py)) <= a.reach && Math.max(Math.abs(o.x - nx), Math.abs(o.y - ny)) > a.reach) out.push(o);
      }
      px = nx; py = ny;
    }
    return out;
  }
  $('act').addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
    const a = b.dataset.a, t = ctl();
    if (a === 'fightend') { if (confirm('Завершити бій?')) send({ t: 'fightend' }); return; }
    if (a === 'autoall') return send({ t: 'auto', on: !G.cb.auto });
    if (a === 'override') { U.override = true; U.ver++; return render(); }
    if (!t) return;
    const tok = t.id;
    if (a === 'move') { clearSel(); U.mode = 'move'; }
    else if (a[0] === 'w' && /^w\d+$/.test(a)) { const k = +a.slice(1); if (U.mode === 'atk' && U.wi === k) clearSel(); else { clearSel(); U.mode = 'atk'; U.wi = k; autoTarget(t); } }
    else if (a[0] === 's' && R.SPELLS[a.slice(1)]) { const s = a.slice(1); if (U.mode === 'spell' && U.sp === s) clearSel(); else { clearSel(); U.mode = 'spell'; U.sp = s; if (R.SPELLS[s].range === 1 && R.SPELLS[s].kind === 'heal') U.tgt = null; } }
    else if (a === 'go' && U.sel) return send({ t: 'move', tok, x: U.sel[0], y: U.sel[1] });
    else if (a === 'fire' && U.tgt) return send({ t: 'atk', tok, tgt: U.tgt, w: U.wi });
    else if (a === 'cast') { const sp = R.SPELLS[U.sp]; return send({ t: 'spell', tok, sp: U.sp, tgt: U.tgt, tgts: U.tgts, x: U.sel ? U.sel[0] : null, y: U.sel ? U.sel[1] : null, k: sp.kind }); }
    else if (a === 'untgt') { U.tgts = []; }
    else if (a === 'dash' || a === 'dis' || a === 'dodge') return send({ t: 'std', tok, a });
    else if (a === 'wake') { clearSel(); U.mode = 'wake'; }
    else if (a === 'wind') return send({ t: 'feat', tok, f: 'wind' });
    else if (a === 'surge') return send({ t: 'feat', tok, f: 'surge' });
    else if (a === 'cdash') return send({ t: 'feat', tok, f: 'cunning', a: 'dash' });
    else if (a === 'cdis') return send({ t: 'feat', tok, f: 'cunning', a: 'dis' });
    else if (a === 'chide') return send({ t: 'feat', tok, f: 'cunning', a: 'hide' });
    else if (a === 'death') return send({ t: 'death', tok });
    else if (a === 'auto') { E.autoTurn(); return; }
    else if (a === 'end') return send({ t: 'end', tok });
    U.ver++; render();
  });
  function autoTarget(t) { // якщо ціль одна — одразу її обираємо
    const a = E.attacks(G, t)[U.wi];
    const ok = E.toks(G).filter((o) => o.side !== t.side && E.alive(G, o) && E.atkCheck(G, t, a, o).ok);
    if (ok.length === 1) U.tgt = ok[0].id;
  }

  /* ---------- мапа: малювання ---------- */
  const cv = $('map'), cx = cv.getContext('2d');
  let CS = 30, OX = 0, OY = 0, DPR = 1;
  function resizeMap() {
    const r = $('mapWrap').getBoundingClientRect(); DPR = Math.min(2, window.devicePixelRatio || 1);
    if (!r.width) return;
    cv.width = Math.round(r.width * DPR); cv.height = Math.round(r.height * DPR);
    CS = Math.floor(Math.min(r.width / E.W, r.height / E.H)); OX = Math.floor((r.width - CS * E.W) / 2); OY = Math.floor((r.height - CS * E.H) / 2);
  }
  window.addEventListener('resize', () => { if (G && G.cb) resizeMap(); });
  const THEME = {
    snow: { a: '#E4EAF2', b: '#DCE3EC', road: '#CDBFA6', grid: 'rgba(40,60,90,.08)' },
    stone: { a: '#3A3344', b: '#352F3F', road: '#3A3344', grid: 'rgba(0,0,0,.18)' },
    shrine: { a: '#33283F', b: '#2E2439', road: '#33283F', grid: 'rgba(0,0,0,.2)' },
  };
  function cellXY(x, y) { return [OX + x * CS, OY + y * CS]; }
  function drawTiles(cb) {
    const th = THEME[cb.theme] || THEME.stone, m = S.MAPS[cb.map];
    for (let y = 0; y < E.H; y++) for (let x = 0; x < E.W; x++) {
      const c = m[y][x], [X, Y] = cellXY(x, y);
      cx.fillStyle = c === ',' ? th.road : ((x + y) % 2 ? th.a : th.b); cx.fillRect(X, Y, CS, CS);
      if (c === '#') { cx.fillStyle = '#16121C'; cx.fillRect(X, Y, CS, CS); cx.fillStyle = '#2C2536'; cx.fillRect(X, Y, CS, Math.max(2, CS * 0.18)); }
      else if (c === 'T') { cx.fillStyle = 'rgba(0,0,0,.12)'; cx.beginPath(); cx.ellipse(X + CS / 2, Y + CS * 0.85, CS * 0.35, CS * 0.12, 0, 0, 7); cx.fill(); cx.fillStyle = '#2E5C45'; tri(X + CS / 2, Y + CS * 0.06, CS * 0.42, CS * 0.82); cx.fillStyle = '#3F7C5C'; tri(X + CS / 2, Y + CS * 0.06, CS * 0.28, CS * 0.5); }
      else if (c === 'r') { cx.fillStyle = '#868D98'; cx.beginPath(); cx.ellipse(X + CS / 2, Y + CS * 0.58, CS * 0.38, CS * 0.28, 0.3, 0, 7); cx.fill(); cx.fillStyle = '#A7AEB8'; cx.beginPath(); cx.ellipse(X + CS * 0.44, Y + CS * 0.5, CS * 0.2, CS * 0.12, 0.3, 0, 7); cx.fill(); }
      else if (c === '~') { cx.strokeStyle = cb.theme === 'snow' ? '#A9BCD3' : '#5E5468'; cx.lineWidth = Math.max(1, CS / 16); for (let k = 0; k < 2; k++) { cx.beginPath(); cx.arc(X + CS * (0.3 + k * 0.4), Y + CS * (0.55 + k * 0.1), CS * 0.16, Math.PI, 0); cx.stroke(); } }
      else if (c === 'P') { cx.fillStyle = 'rgba(0,0,0,.3)'; cx.beginPath(); cx.arc(X + CS / 2, Y + CS * 0.56, CS * 0.4, 0, 7); cx.fill(); cx.fillStyle = '#6A5E78'; cx.beginPath(); cx.arc(X + CS / 2, Y + CS / 2, CS * 0.38, 0, 7); cx.fill(); cx.fillStyle = '#857894'; cx.beginPath(); cx.arc(X + CS * 0.44, Y + CS * 0.44, CS * 0.18, 0, 7); cx.fill(); }
      else if (c === 'B') { cx.fillStyle = '#5C3A7A'; cx.fillRect(X + 1, Y + 1, CS - 2, CS - 2); cx.fillStyle = '#9B6BFF'; cx.globalAlpha = 0.25; cx.fillRect(X + 3, Y + 3, CS - 6, CS - 6); cx.globalAlpha = 1; }
      else if (c === 'S') { cx.fillStyle = '#4A2E5E'; cx.fillRect(X, Y, CS, CS); }
      else if (c === 'b') { cx.fillStyle = '#6E4B32'; cx.fillRect(X + CS * 0.12, Y + CS * 0.1, CS * 0.76, CS * 0.8); cx.fillStyle = '#C9B9A0'; cx.fillRect(X + CS * 0.2, Y + CS * 0.14, CS * 0.6, CS * 0.2); }
    }
    // череп на постаменті і фіолетове сяйво
    if (cb.map === 'shrine') {
      const [X, Y] = cellXY(5, 1), t = performance.now() / 1000;
      const gr = cx.createRadialGradient(X + CS, Y + CS, 2, X + CS, Y + CS, CS * (2.2 + Math.sin(t * 2) * 0.2));
      gr.addColorStop(0, 'rgba(170,110,255,.55)'); gr.addColorStop(1, 'rgba(170,110,255,0)');
      cx.fillStyle = gr; cx.fillRect(X - CS * 2, Y - CS * 2, CS * 6, CS * 6);
      cx.font = Math.round(CS * 1.1) + 'px serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText('💀', X + CS, Y + CS);
    }
    cx.strokeStyle = th.grid; cx.lineWidth = 1;
    cx.beginPath();
    for (let x = 0; x <= E.W; x++) { cx.moveTo(OX + x * CS + 0.5, OY); cx.lineTo(OX + x * CS + 0.5, OY + E.H * CS); }
    for (let y = 0; y <= E.H; y++) { cx.moveTo(OX, OY + y * CS + 0.5); cx.lineTo(OX + E.W * CS, OY + y * CS + 0.5); }
    cx.stroke();
  }
  function tri(x, y, w, h) { cx.beginPath(); cx.moveTo(x, y); cx.lineTo(x + w, y + h); cx.lineTo(x - w, y + h); cx.closePath(); cx.fill(); }
  function tint(cells, col) { cx.fillStyle = col; for (const [x, y] of cells) { const [X, Y] = cellXY(x, y); cx.fillRect(X + 1, Y + 1, CS - 2, CS - 2); } }
  function ring(x, y, col, w, dash) { const [X, Y] = cellXY(x, y); cx.strokeStyle = col; cx.lineWidth = w || 2.5; cx.setLineDash(dash || []); cx.beginPath(); cx.arc(X + CS / 2, Y + CS / 2, CS * 0.48, 0, 7); cx.stroke(); cx.setLineDash([]); }
  function center(x, y) { return [OX + (x + 0.5) * CS, OY + (y + 0.5) * CS]; }

  function previewCells(t) {
    const sp = R.SPELLS[U.sp]; if (!sp || !U.sel) return [];
    if (sp.kind === 'area') return E.coneCells(t, U.sel[0], U.sel[1], sp.size);
    if (sp.kind === 'sleep') return E.sphereCells(U.sel[0], U.sel[1], sp.size);
    return [];
  }
  function rangeCells(t, r) { const out = []; for (let y = 0; y < E.H; y++) for (let x = 0; x < E.W; x++) { const d = Math.max(Math.abs(x - t.x), Math.abs(y - t.y)); if (d && d <= r && !E.blocksMove(E.tile(G, x, y))) out.push([x, y]); } return out; }

  function drawOverlays(t) {
    if (!t || ANIM.cur) return;
    if (U.mode === 'move' && t.mv >= 0) {
      const r = E.reach(G, t, t.mv), green = [], yellow = [];
      for (const [k, c] of r.d) { if (c <= 0) continue; green.push(k.split(',').map(Number)); }
      if (canAction(t)) { const r2 = E.reach(G, t, t.mv + E.info(G, t).sp); for (const [k, c] of r2.d) if (c > 0 && !(r.d.get(k) > 0)) yellow.push(k.split(',').map(Number)); }
      tint(yellow, 'rgba(233,185,73,.16)'); tint(green, 'rgba(93,210,122,.28)');
      if (U.sel) {
        const p = E.pathTo(r, t, U.sel[0], U.sel[1]);
        if (p) {
          cx.strokeStyle = '#FFFFFF'; cx.lineWidth = Math.max(2, CS / 10); cx.setLineDash([CS / 5, CS / 7]); cx.beginPath();
          const s = center(t.x, t.y); cx.moveTo(s[0], s[1]); p.forEach(([x, y]) => { const c = center(x, y); cx.lineTo(c[0], c[1]); }); cx.stroke(); cx.setLineDash([]);
          ring(U.sel[0], U.sel[1], '#FFFFFF', 3);
          oaList(t, p).forEach((o) => { ring(o.x, o.y, '#FF6464', 3.5); const [X, Y] = cellXY(o.x, o.y); cx.fillStyle = '#FF6464'; cx.font = 'bold ' + Math.round(CS * 0.5) + 'px sans-serif'; cx.fillText('!', X + CS * 0.85, Y + CS * 0.15); });
        }
      }
    }
    if (U.mode === 'atk') {
      const a = E.attacks(G, t)[U.wi];
      const snow = G.cb.theme === 'snow';
      if (a.range) { tint(rangeCells(t, Math.min(a.long, 30)).filter(([x, y]) => Math.max(Math.abs(x - t.x), Math.abs(y - t.y)) > a.range), snow ? 'rgba(255,130,30,.26)' : 'rgba(255,154,60,.16)'); tint(rangeCells(t, a.range), snow ? 'rgba(40,130,255,.28)' : 'rgba(98,184,255,.2)'); }
      if (a.reach) tint(rangeCells(t, a.reach), 'rgba(255,80,80,.3)');
      E.toks(G).forEach((o) => { if (o.side !== t.side && E.alive(G, o) && E.atkCheck(G, t, a, o).ok) ring(o.x, o.y, '#FFD36A', 2.5, [4, 3]); });
    }
    if (U.mode === 'spell') {
      const sp = R.SPELLS[U.sp];
      if (sp.range > 1) tint(rangeCells(t, sp.range), G.cb.theme === 'snow' ? 'rgba(120,70,255,.18)' : 'rgba(155,107,255,.12)');
      if (sp.range === 1) tint(rangeCells(t, 1), 'rgba(93,210,122,.2)');
      if (sp.kind === 'area') { if (!U.sel) tint(E.coneCells(t, t.x, t.y - 3, sp.size), 'rgba(255,120,40,.14)'); else tint(previewCells(t), 'rgba(255,110,40,.42)'); }
      if (sp.kind === 'sleep' && U.sel) tint(previewCells(t), 'rgba(160,110,255,.38)');
      const okT = (o) => {
        if (!E.alive(G, o)) return false;
        const d = E.dist(t, o);
        if (sp.kind === 'heal' || sp.kind === 'buff') return o.side === t.side && d <= Math.max(1, sp.range) && (sp.range <= 1 || E.los(G, t, o));
        if (['atk', 'save1', 'mark', 'darts'].includes(sp.kind)) return o.side !== t.side && d <= sp.range && E.los(G, t, o);
        return false;
      };
      E.toks(G).forEach((o) => { if (okT(o)) ring(o.x, o.y, sp.kind === 'heal' || sp.kind === 'buff' ? '#5DD27A' : '#C5A8FF', 2.5, [4, 3]); });
      U.tgts.forEach((id, k) => { const o = G.cb.tk[id]; if (o) { ring(o.x, o.y, '#FFFFFF', 3.5); const [X, Y] = cellXY(o.x, o.y); cx.fillStyle = '#fff'; cx.font = 'bold ' + Math.round(CS * 0.36) + 'px sans-serif'; cx.fillText(String(U.tgts.filter((x) => x === id).length), X + CS * 0.88, Y + CS * 0.14 + k * 0); } });
    }
    if (U.tgt && G.cb.tk[U.tgt]) {
      const o = G.cb.tk[U.tgt], a = center(t.x, t.y), b = center(o.x, o.y);
      cx.strokeStyle = 'rgba(255,255,255,.85)'; cx.lineWidth = 2; cx.setLineDash([6, 5]); cx.beginPath(); cx.moveTo(a[0], a[1]); cx.lineTo(b[0], b[1]); cx.stroke(); cx.setLineDash([]);
      ring(o.x, o.y, '#FFFFFF', 3.5);
    }
  }
  function drawTokens(now) {
    const cb = G.cb, cur = E.cur(G);
    const list = E.toks(G).slice().sort((a, b) => E.alive(G, a) - E.alive(G, b));
    for (const t of list) {
      const i = E.info(G, t), p = ANIM.pos(t);
      const X = OX + (p[0] + 0.5) * CS, Y = OY + (p[1] + 0.5) * CS, r = CS * 0.4;
      const ph = ANIM.pendHp(t.id), shownHp = Math.max(0, Math.min(i.mhp, i.hp - ph)), lag = ph !== 0 && shownHp > 0;
      if (i.dead && !i.pc && !lag) { cx.globalAlpha = 0.35; cx.font = Math.round(CS * 0.5) + 'px serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(i.ic, X, Y); cx.fillStyle = '#FF6464'; cx.font = 'bold ' + Math.round(CS * 0.6) + 'px sans-serif'; cx.fillText('✕', X, Y); cx.globalAlpha = 1; continue; }
      if (t === cur) { const pulse = 0.5 + 0.5 * Math.sin(now / 220); cx.fillStyle = 'rgba(233,185,73,' + (0.18 + pulse * 0.22) + ')'; cx.beginPath(); cx.arc(X, Y, r * 1.3, 0, 7); cx.fill(); }
      cx.globalAlpha = t.hidden ? 0.55 : 1;
      cx.fillStyle = 'rgba(0,0,0,.35)'; cx.beginPath(); cx.ellipse(X, Y + r * 0.85, r * 0.9, r * 0.3, 0, 0, 7); cx.fill();
      cx.fillStyle = (i.down || i.dead) && !lag ? '#555060' : i.col; cx.beginPath(); cx.arc(X, Y, r, 0, 7); cx.fill();
      cx.lineWidth = Math.max(2, CS / 12); cx.strokeStyle = t.side === 'foe' ? '#2A0E12' : '#0E1A2A'; cx.stroke();
      // хіти дугою
      const f = Math.max(0, shownHp / i.mhp);
      cx.strokeStyle = 'rgba(0,0,0,.45)'; cx.lineWidth = Math.max(3, CS / 9); cx.beginPath(); cx.arc(X, Y, r + cx.lineWidth / 2, 0, 7); cx.stroke();
      cx.strokeStyle = hpCol(f); cx.beginPath(); cx.arc(X, Y, r + cx.lineWidth / 2, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); cx.stroke();
      cx.font = Math.round(CS * 0.48) + 'px serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(i.dead && !lag ? '💀' : i.ic, X, Y + 1);
      cx.globalAlpha = 1;
      if (CS >= 24) { // імʼя під токеном
        const n0 = i.n.replace(/ \(бот\)$/, ''), nm = n0.length > 9 ? n0.slice(0, 8) + '…' : n0;
        cx.font = '700 ' + Math.max(9, Math.round(CS * 0.27)) + 'px Rubik, sans-serif';
        const w = cx.measureText(nm).width + 8, ly = Y + r + CS * 0.2;
        cx.fillStyle = t.side === 'foe' ? 'rgba(90,15,25,.85)' : 'rgba(12,30,60,.85)'; roundRect(X - w / 2, ly - CS * 0.15, w, CS * 0.3, CS * 0.15); cx.fill();
        cx.fillStyle = '#fff'; cx.fillText(nm, X, ly + 0.5);
      }
      const mini = (txt, dx, dy) => { cx.font = Math.round(CS * 0.32) + 'px serif'; cx.fillText(txt, X + dx * r, Y + dy * r); };
      if (t.cond.sleep) mini('💤', 0.85, -0.85);
      if (i.down) mini('🩸', 0.85, -0.85);
      if (t.cond.bless) mini('✨', -0.9, -0.85);
      if (t.cond.dodge) mini('🛡️', -0.9, 0.85);
      if (t.cond.slow) mini('❄️', 0.9, 0.85);
      if (E.toks(G).some((o) => o.markT === t.id)) mini('🎯', 0, -1.15);
      if (t.ch === ME.key) { cx.strokeStyle = '#FFFFFF'; cx.lineWidth = 1.5; cx.setLineDash([3, 3]); cx.beginPath(); cx.arc(X, Y, r * 1.18, 0, 7); cx.stroke(); cx.setLineDash([]); }
    }
    void cb;
  }

  /* ---------- анімації ефектів ---------- */
  const ANIM = {
    q: [], cur: null, t0: 0, floats: [], banner: null,
    dur(f) { return f.k === 'move' ? Math.max(300, (f.path.length - 1) * 260) : { aim: 700, slash: 650, arrow: 800, bolt: 900, ray: 900, darts: 1150, fire: 1250, sleep: 1500, pillar: 1050, heal: 950, bless: 1050, mark: 750 }[f.k] || 600; },
    pendHp(id) { let n = 0; for (const f of this.q) if (f.k === 'float' && f.id === id && f.n) n += f.n; return n; },
    pos(t) {
      const f = this.cur;
      if (f && f.k === 'move' && f.id === t.id) {
        const p = Math.min(1, (performance.now() - this.t0) / this.dur(f)) * (f.path.length - 1), i = Math.floor(p), fr = p - i;
        const a = f.path[i], b = f.path[Math.min(f.path.length - 1, i + 1)];
        return [a[0] + (b[0] - a[0]) * fr, a[1] + (b[1] - a[1]) * fr];
      }
      const pend = this.q.find((q) => q.k === 'move' && q.id === t.id);
      if (pend) return pend.path[0];
      return [t.x, t.y];
    },
    step(now) {
      if (this.cur && now - this.t0 > this.dur(this.cur)) this.cur = null;
      if (this.q.length > 30) this.q.splice(0, this.q.length - 30);
      while (!this.cur && this.q.length) {
        const f = this.q.shift();
        if (f.k === 'float') { this.floats.push({ f, t0: now }); if (f.c !== 'heal') { const c = f.c === 'miss' ? 'miss' : 'hit'; beep(f.c === 'crit' ? 'crit' : c); } continue; }
        this.cur = f; this.t0 = now;
        if (f.k === 'aim') this.banner = { txt: String(f.txt).replace(/ \(бот\)/g, ''), foe: f.foe, t0: now };
      }
      this.floats = this.floats.filter((x) => now - x.t0 < 1400);
      if (this.banner && now - this.banner.t0 > 2600) this.banner = null;
    },
    drawFloats(now) {
      for (const x of this.floats) {
        const p = (now - x.t0) / 1400, C0 = center(x.f.b[0], x.f.b[1]);
        const col = { dmg: '#FF5A5A', crit: '#FFD23F', heal: '#5DD27A', miss: '#E8E2D6' }[x.f.c] || '#fff';
        const size = Math.round(CS * (x.f.c === 'crit' ? 0.62 : x.f.c === 'miss' ? 0.4 : 0.52) * (p < 0.15 ? 0.6 + p * 2.7 : 1));
        cx.save(); cx.globalAlpha = p > 0.7 ? (1 - p) / 0.3 : 1;
        cx.font = '800 ' + size + 'px "Baloo 2", sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
        cx.lineWidth = Math.max(3, size / 5); cx.strokeStyle = 'rgba(10,6,14,.85)';
        const y = C0[1] - CS * 0.55 - p * CS * 0.9;
        cx.strokeText(x.f.txt, C0[0], y); cx.fillStyle = col; cx.fillText(x.f.txt, C0[0], y);
        cx.restore();
      }
      const bn = this.banner;
      if (bn) {
        const a = Math.min(1, (now - bn.t0) / 200) * (now - bn.t0 > 2200 ? Math.max(0, 1 - (now - bn.t0 - 2200) / 400) : 1);
        cx.save(); cx.globalAlpha = a; cx.font = '700 ' + Math.max(12, Math.round(CS * 0.42)) + 'px Rubik, sans-serif';
        const w = cx.measureText(bn.txt).width + 24, X0 = OX + (CS * E.W - w) / 2, Y0 = OY + 6, hh = Math.max(24, CS * 0.75);
        cx.fillStyle = bn.foe ? 'rgba(120,20,30,.9)' : 'rgba(30,60,110,.9)'; roundRect(X0, Y0, w, hh, hh / 2); cx.fill();
        cx.fillStyle = '#fff'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(bn.txt, X0 + w / 2, Y0 + hh / 2 + 1);
        cx.restore();
      }
    },
    draw(now) {
      const f = this.cur; if (!f || f.k === 'move') return;
      const p = Math.min(1, (now - this.t0) / this.dur(f));
      const A = f.a && center(f.a[0], f.a[1]), B = f.b && center(f.b[0], f.b[1]);
      cx.save();
      if (f.k === 'aim' && A && B) {
        const col = f.foe ? '255,80,80' : '255,210,90', pulse = 0.55 + 0.45 * Math.sin(p * Math.PI * 4);
        cx.strokeStyle = 'rgba(' + col + ',' + (0.35 + pulse * 0.5) + ')'; cx.lineWidth = Math.max(2, CS / 12); cx.setLineDash([CS / 4, CS / 6]); cx.lineDashOffset = -p * CS * 2;
        cx.beginPath(); cx.moveTo(A[0], A[1]); cx.lineTo(B[0], B[1]); cx.stroke(); cx.setLineDash([]);
        cx.strokeStyle = 'rgba(' + col + ',.95)'; cx.lineWidth = Math.max(2, CS / 14);
        const rr = CS * (0.75 - 0.2 * Math.min(1, p * 1.5));
        cx.beginPath(); cx.arc(B[0], B[1], rr, 0, 7); cx.moveTo(B[0] - rr - 4, B[1]); cx.lineTo(B[0] - rr + 6, B[1]); cx.moveTo(B[0] + rr + 4, B[1]); cx.lineTo(B[0] + rr - 6, B[1]); cx.moveTo(B[0], B[1] - rr - 4); cx.lineTo(B[0], B[1] - rr + 6); cx.moveTo(B[0], B[1] + rr + 4); cx.lineTo(B[0], B[1] + rr - 6); cx.stroke();
      }
      if (f.k === 'slash' && B) {
        cx.fillStyle = 'rgba(255,255,255,' + (0.35 * (1 - p)) + ')'; cx.beginPath(); cx.arc(B[0], B[1], CS * 0.5, 0, 7); cx.fill(); cx.strokeStyle = 'rgba(255,255,255,' + (1 - p) + ')'; cx.lineWidth = CS / 6; cx.lineCap = 'round'; cx.beginPath(); cx.arc(B[0], B[1], CS * 0.6, -2.6 + p * 2.4, -1.0 + p * 2.4); cx.stroke(); }
      if ((f.k === 'arrow' || f.k === 'bolt' || f.k === 'ray') && A && B) {
        const q = Math.min(1, p * 1.4), x = A[0] + (B[0] - A[0]) * q, y = A[1] + (B[1] - A[1]) * q;
        const col = f.k === 'bolt' ? '255,130,40' : f.k === 'ray' ? '140,220,255' : '240,230,200';
        cx.strokeStyle = 'rgba(' + col + ',.9)'; cx.lineWidth = f.k === 'arrow' ? 2.5 : CS / 6; cx.lineCap = 'round';
        cx.beginPath(); cx.moveTo(A[0] + (B[0] - A[0]) * Math.max(0, q - 0.25), A[1] + (B[1] - A[1]) * Math.max(0, q - 0.25)); cx.lineTo(x, y); cx.stroke();
        if (f.k !== 'arrow') { cx.fillStyle = 'rgba(' + col + ',.95)'; cx.beginPath(); cx.arc(x, y, CS / 5, 0, 7); cx.fill(); }
        if (q >= 1) { cx.fillStyle = 'rgba(' + col + ',' + (1 - p) + ')'; cx.beginPath(); cx.arc(B[0], B[1], CS * (0.3 + p * 0.5) * (f.hit ? 1 : 0.5), 0, 7); cx.fill(); }
      }
      if (f.k === 'darts' && A) (f.bs || []).forEach((b, k) => {
        const Bc = center(b[0], b[1]), q = Math.min(1, p * 1.3 - k * 0.12); if (q <= 0) return;
        const mx = (A[0] + Bc[0]) / 2 + (k - 1) * CS * 1.4, my = (A[1] + Bc[1]) / 2 - CS;
        const x = (1 - q) * (1 - q) * A[0] + 2 * (1 - q) * q * mx + q * q * Bc[0], y = (1 - q) * (1 - q) * A[1] + 2 * (1 - q) * q * my + q * q * Bc[1];
        cx.fillStyle = '#B9A2FF'; cx.shadowColor = '#9B6BFF'; cx.shadowBlur = 12; cx.beginPath(); cx.arc(x, y, CS / 7, 0, 7); cx.fill();
      });
      if (f.k === 'fire' && f.cells) { cx.globalAlpha = 1 - p; f.cells.forEach(([x, y], k) => { const [X, Y] = cellXY(x, y); cx.fillStyle = k % 2 ? '#FF7A1A' : '#FFC23A'; cx.fillRect(X + 2, Y + 2, CS - 4, CS - 4); }); }
      if (f.k === 'sleep' && f.c) { cx.globalAlpha = 0.6 * (1 - p); tint(f.cells, '#A06EFF'); cx.globalAlpha = 1 - p; cx.font = Math.round(CS * 0.6) + 'px serif'; const C0 = center(f.c[0], f.c[1]); cx.fillText('💤', C0[0], C0[1] - p * CS); }
      if (f.k === 'pillar' && B) { const g = cx.createLinearGradient(B[0], B[1] - CS * 2, B[0], B[1]); g.addColorStop(0, 'rgba(255,240,180,0)'); g.addColorStop(1, 'rgba(255,240,180,' + (1 - p) + ')'); cx.fillStyle = g; cx.fillRect(B[0] - CS * 0.35, B[1] - CS * 2.2, CS * 0.7, CS * 2.5); }
      if ((f.k === 'heal' || f.k === 'mark') && B) { cx.globalAlpha = 1 - p; cx.font = Math.round(CS * 0.55) + 'px serif'; cx.fillText(f.k === 'heal' ? '💚' : '🎯', B[0], B[1] - p * CS * 0.9); }
      if (f.k === 'bless') (f.bs || []).forEach((b) => { const C0 = center(b[0], b[1]); cx.globalAlpha = 1 - p; cx.font = Math.round(CS * 0.5) + 'px serif'; cx.fillText('✨', C0[0], C0[1] - p * CS); });
      cx.restore();
    },
  };

  function frame(now) {
    requestAnimationFrame(frame);
    if (!G || !G.cb || $('mapBox').hidden) return;
    if (cv.width < 10) resizeMap();
    ANIM.step(now);
    cx.setTransform(DPR, 0, 0, DPR, 0, 0);
    cx.clearRect(0, 0, cv.width, cv.height);
    drawTiles(G.cb);
    drawOverlays(ctl());
    drawTokens(now);
    ANIM.draw(now);
    ANIM.drawFloats(now);
  }
  function roundRect(x, y, w, h, r) { cx.beginPath(); cx.moveTo(x + r, y); cx.arcTo(x + w, y, x + w, y + h, r); cx.arcTo(x + w, y + h, x, y + h, r); cx.arcTo(x, y + h, x, y, r); cx.arcTo(x, y, x + w, y, r); cx.closePath(); }
  requestAnimationFrame(frame);

  /* ---------- мапа: дотики ---------- */
  cv.addEventListener('pointerdown', (e) => {
    if (!G || !G.cb) return;
    const r = cv.getBoundingClientRect(), x = Math.floor((e.clientX - r.left - OX) / CS), y = Math.floor((e.clientY - r.top - OY) / CS);
    if (x < 0 || y < 0 || x >= E.W || y >= E.H) return;
    const t = ctl(), o = E.occ(G, x, y);
    if (!t) { if (o) popToken(o); return; }
    if (U.mode === 'move') {
      if (o && o !== t) { popToken(o); return; }
      const rr = E.reach(G, t, t.mv), c = rr.d.get(rr.K(x, y));
      if (c > 0) { if (U.sel && U.sel[0] === x && U.sel[1] === y) { send({ t: 'move', tok: t.id, x, y }); return; } U.sel = [x, y]; }
      else if (o === t) { popToken(t); return; }
      else { U.sel = null; toast(canAction(t) && E.reach(G, t, t.mv + E.info(G, t).sp).d.get(rr.K(x, y)) > 0 ? 'Туди — лише з Ривком (він забирає дію).' : 'Туди за цей хід не дійти.'); }
    } else if (U.mode === 'atk') {
      if (!o || o === t) return;
      const a = E.attacks(G, t)[U.wi], c = E.atkCheck(G, t, a, o);
      if (o.side === t.side) { toast('Це союзник.'); return; }
      if (!c.ok) { toast(c.why); return; }
      if (U.tgt === o.id) { send({ t: 'atk', tok: t.id, tgt: o.id, w: U.wi }); return; }
      U.tgt = o.id;
    } else if (U.mode === 'spell') {
      const sp = R.SPELLS[U.sp];
      if (sp.kind === 'area') U.sel = [x, y];
      else if (sp.kind === 'sleep') { if (Math.max(Math.abs(x - t.x), Math.abs(y - t.y)) > sp.range) { toast('Задалеко: Сон — до 18 клітинок.'); return; } U.sel = [x, y]; }
      else if (o) {
        const ally = o.side === t.side, d = E.dist(t, o), rng = Math.max(1, sp.range);
        if (sp.kind === 'heal' || sp.kind === 'buff') { if (!ally) { toast('Це для союзників.'); return; } }
        else if (ally) { toast('Це союзник.'); return; }
        if (d > rng) { toast(sp.range <= 1 ? 'Треба стояти поруч — це дотик.' : 'Задалеко: ' + sp.n + ' — до ' + sp.range + ' клітинок.'); return; }
        if (sp.range > 1 && !E.los(G, t, o)) { toast('Не видно — заважає стіна.'); return; }
        if (sp.kind === 'darts') { if (U.tgts.length < 3) U.tgts.push(o.id); }
        else if (sp.kind === 'buff') { U.tgts = U.tgts.includes(o.id) ? U.tgts.filter((i) => i !== o.id) : (U.tgts.length < 3 ? U.tgts.concat(o.id) : U.tgts); }
        else U.tgt = o.id;
      }
    } else if (U.mode === 'wake') {
      if (o && o.side === t.side && o.cond.sleep && E.dist(o, t) <= 1) { send({ t: 'std', tok: t.id, a: 'wake', tgt: o.id }); return; }
      toast('Торкнись сплячого союзника поруч.');
    }
    U.ver++; render();
  });
  function toast(t) { $('toast').innerHTML = esc(t); $('toast').hidden = false; U.toastT = performance.now() + 1800; }

  // тест-хук
  window.DNDGame = { ME, U, E, get G() { return G; }, send, tick, ctl, render,
    cell(x, y) { const r = cv.getBoundingClientRect(); return { x: r.left + OX + (x + 0.5) * CS, y: r.top + OY + (y + 0.5) * CS }; } };
})();
