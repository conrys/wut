/* DnD — «Мої герої»: створення героя з підказками, портрет і іконка з обрізанням.
   Герої зберігаються на телефоні (localStorage). Для гри з друзями картинки
   кладуться в RTDB dnd_img/<id> — тоді їх бачать інші телефони. */
(function () {
  'use strict';
  const R = window.DND;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LSK = 'dnd_heroes';
  const load = () => { try { const v = JSON.parse(localStorage.getItem(LSK) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  const saveAll = (list) => { try { localStorage.setItem(LSK, JSON.stringify(list)); return true; } catch (e) { return false; } };
  const rid = () => (Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-6)).replace(/[^a-z0-9]/g, 'x');
  const get = (id) => load().find((h) => h.id === id) || null;
  const compact = (h) => (h ? { id: h.id, rev: h.rev || 0, n: h.n, bg: h.bg, look: h.look || '', story: h.story || '', ip: h.p ? h.ip : '', ii: h.i ? h.ii : '' } : null);

  /* ---------- картинки: свої — з телефона, чужі — з бази ---------- */
  const cache = {}, uploaded = {};
  const H = { onImg: null };
  function seedLocal() { for (const h of load()) { if (h.ip && h.p) cache[h.ip] = { url: h.p }; if (h.ii && h.i) cache[h.ii] = { url: h.i }; } }
  // картинки сцен від майстра: копія на телефоні (до 8 останніх) + в базі для гравців
  function seedScenes() { try { const m = JSON.parse(localStorage.getItem('dnd_scimg') || '{}'); for (const k in m) cache[k] = cache[k] || { url: m[k] }; } catch (e) {} }
  seedScenes();
  function put(id, u) {
    cache[id] = { url: u };
    try { const m = JSON.parse(localStorage.getItem('dnd_scimg') || '{}'); m[id] = u; const ks = Object.keys(m); while (ks.length > 8) delete m[ks.shift()]; localStorage.setItem('dnd_scimg', JSON.stringify(m)); } catch (e) {}
    return upload({ ip: id, p: u });
  }
  seedLocal();
  function url(id) {
    if (!id) return null;
    const c = cache[id];
    if (c && c.url) return c.url;
    if (!c || (c.state === 'miss' && Date.now() - c.at > 5000)) fetchImg(id);
    return null;
  }
  async function fetchImg(id) {
    cache[id] = { state: 'loading' };
    try {
      if (!(window.HNS_TRANSPORT && await window.HNS_TRANSPORT.ready())) throw new Error('offline');
      const snap = await firebase.database().ref('dnd_img/' + id).get();
      const v = snap.val();
      if (typeof v === 'string' && v.startsWith('data:image/')) { cache[id] = { url: v }; if (H.onImg) H.onImg(); }
      else cache[id] = { state: 'miss', at: Date.now() };
    } catch (e) { cache[id] = { state: 'miss', at: Date.now() }; }
  }
  function image(id) { // готовий Image для канви або null
    const u = url(id); if (!u) return null;
    const c = cache[id];
    if (!c.img) { c.img = new Image(); c.img.onload = () => { if (H.onImg) H.onImg(); }; c.img.src = u; }
    return c.img.complete && c.img.naturalWidth ? c.img : null;
  }
  async function upload(h) { // для гри з друзями
    if (!h) return;
    for (const [id, u] of [[h.ip, h.p], [h.ii, h.i]]) {
      if (!id || !u || uploaded[id] || !u.startsWith('data:')) continue; // готові портрети є на кожному телефоні
      try { if (window.HNS_TRANSPORT && await window.HNS_TRANSPORT.ready()) { await firebase.database().ref('dnd_img/' + id).set(u); uploaded[id] = 1; } }
      catch (e) { uploaded[id] = 1; } // уже є в базі — правило не дає перезаписати
    }
  }
  /* готові портрети: по 2 чоловіки й 2 жінки на клас (набір GCC Vol.1, Georgios Maragkos / Reckoning Web — вільна ліцензія).
     Файли в ads/dnd/img/por/<id>_p.webp (3:4) і <id>_i.webp (іконка). Готові герої беруть свій, власні — обирають у редакторі. */
  const PORTRAITS = [];
  for (const cls of ['fighter', 'rogue', 'wizard', 'cleric', 'ranger', 'bard']) for (const sx of ['m', 'f']) for (const n of [1, 2]) {
    const id = cls + '_' + sx + n; PORTRAITS.push({ id, cls, sx });
    cache['pp_' + id] = { url: 'img/por/' + id + '_p.webp' }; cache['pi_' + id] = { url: 'img/por/' + id + '_i.webp' };
  }
  const PRESET = { fighter: 'fighter_m1', rogue: 'rogue_f1', wizard: 'wizard_m1', cleric: 'cleric_f1', ranger: 'ranger_f1', bard: 'bard_m1' };
  const defId = (cls, k) => (PRESET[cls] ? (k === 'p' ? 'pp_' : 'pi_') + PRESET[cls] : null);
  // власний герой без картинок лишається з емодзі: чуже обличчя (Фаркаса) йому не підставляємо
  function iconId(ch) { const h = ch && ch.hero; return h ? h.ii || h.ip || null : defId(ch && ch.cls, 'i'); }
  function portId(ch) { const h = ch && ch.hero; return h ? h.ip || null : defId(ch && ch.cls, 'p'); }
  /* аватар: іконка героя, стандартна іконка класу або емодзі класу */
  function avatarHtml(ch, px, kind) {
    const c = R.CLASSES[ch.cls] || { col: '#3A3346', ic: '?' };
    const u = kind === 'p' ? url(portId(ch)) : url(iconId(ch));
    const st = 'width:' + px + 'px;height:' + px + 'px;';
    if (u) return '<img class="avatar av-img" alt="" src="' + u + '" style="' + st + 'background:' + c.col + '">';
    return '<span class="avatar" style="' + st + 'font-size:' + Math.round(px * 0.52) + 'px;background:' + c.col + '">' + c.ic + '</span>';
  }

  /* ---------- редактор героя ---------- */
  let ed = null, onDone = null, fileKind = null;
  function ensureDom() {
    if ($('heroEd')) return;
    const d = document.createElement('div');
    d.innerHTML = '<div class="modal hero-ed" id="heroEd" hidden><div class="sheet" id="heroEdSheet"></div></div>' +
      '<div class="crop" id="crop" hidden><div class="crop-in"><p class="eyebrow" id="cropT" style="color:#fff">Обріж фото</p><div class="crop-frame" id="cropFrame"><canvas id="cropCv"></canvas></div>' +
      '<label class="f" style="color:#ddd">Масштаб<input type="range" id="cropZoom" min="1" max="4" step="0.01" value="1"></label><p class="muted" style="text-align:center;margin:0 0 10px">Тягни фото пальцем, щоб вибрати частину</p>' +
      '<div class="row"><button class="btn2" type="button" id="cropNo">Скасувати</button><button class="btn grow" type="button" id="cropOk">Готово</button></div></div></div>' +
      '<input type="file" id="heFile" accept="image/*" hidden>';
    document.body.appendChild(d);
    $('heroEdSheet').addEventListener('click', onClick);
    $('heroEdSheet').addEventListener('input', onInput);
    $('heFile').addEventListener('change', onFile);
  }
  function open(id, cb) {
    ensureDom();
    const h = id ? get(id) : null;
    ed = h ? Object.assign({}, h) : { id: rid(), rev: 0, n: '', cls: 'fighter', bg: 'soldier', look: '', story: '', p: '', i: '', ip: '', ii: '' };
    ed.isNew = !h; ed.err = ''; onDone = cb || null;
    draw(); $('heroEd').hidden = false; $('heroEdSheet').scrollTop = 0;
  }
  function close() { $('heroEd').hidden = true; ed = null; }
  const statTop = (c) => R.STAT_IDS.slice().sort((a, b) => c.st[b] - c.st[a]).slice(0, 2).map((k) => R.STATS[k].n);
  function draw() {
    const c = R.CLASSES[ed.cls], ch = R.CLASS_HINT[ed.cls], bh = R.buildHero({ cls: ed.cls, bg: ed.bg });
    let h = '<p class="eyebrow">' + (ed.isNew ? 'Новий герой' : 'Редагувати героя') + '</p><h2>' + esc(ed.n || 'Твій герой') + '</h2>';
    h += '<div class="hstep"><b>1. Як звати героя?</b><input id="heN" maxlength="20" placeholder="Наприклад, Аларик" value="' + esc(ed.n) + '"><small>Імʼя, яке звучатиме в історії. Можна не своє.</small></div>';
    h += '<div class="hstep"><b>2. Клас — що твій герой уміє</b><small>Клас визначає, як ти граєш у бою. Не знаєш — бери Воїна.</small><div class="classes">' +
      R.CLASS_IDS.map((id) => { const k = R.CLASSES[id], hh = R.CLASS_HINT[id]; return '<button type="button" class="cls' + (ed.cls === id ? ' on' : '') + '" data-hcls="' + id + '"><span class="avatar" style="background:' + k.col + '">' + k.ic + '</span><span class="grow"><b>' + hh.cn + '</b><small>' + esc(hh.hint) + '</small>' + (ed.cls === id ? '<small class="ok">▸ ' + esc(hh.play) + '</small>' : '') + '</span></button>'; }).join('') + '</div></div>';
    h += '<div class="hstep"><b>3. Походження — ким герой був раніше</b><small>Додає дві навички і трохи історії. Обирай, що подобається.</small><div class="classes">' +
      R.BG_IDS.map((id) => { const b = R.BACKGROUNDS[id]; return '<button type="button" class="cls' + (ed.bg === id ? ' on' : '') + '" data-hbg="' + id + '"><span class="avatar" style="background:#3A3346">' + b.ic + '</span><span class="grow"><b>' + b.n + '</b><small>' + esc(b.d) + '</small><small class="muted">+ ' + b.sk.map((k) => R.SKILLS[k].n).join(', ') + '</small></span></button>'; }).join('') + '</div></div>';
    h += '<div class="hstep"><b>4. Як виглядає (необовʼязково)</b><small>Портрет — у листі героя. Іконка — твій кружечок на мапі бою.</small><div class="pics">' +
      '<div class="pic"><div class="ppor">' + (ed.p ? '<img alt="" src="' + ed.p + '">' : '<span>' + c.ic + '</span>') + '</div><button class="btn2 sm" type="button" data-hup="p">📷 Портрет</button>' + (ed.p ? '<button class="btn2 sm" type="button" data-hdel="p">✕</button>' : '') + '</div>' +
      '<div class="pic"><div class="pico" style="background:' + c.col + '">' + (ed.i ? '<img alt="" src="' + ed.i + '">' : '<span>' + c.ic + '</span>') + '</div><button class="btn2 sm" type="button" data-hup="i">📷 Іконка</button>' + (ed.p ? '<button class="btn2 sm" type="button" data-hcut="1">✂️ З портрета</button>' : '') + (ed.i ? '<button class="btn2 sm" type="button" data-hdel="i">✕</button>' : '') + '</div></div>' +
      '<small style="margin-top:8px">Або обери готовий портрет:</small>' + galHtml(PORTRAITS.filter((x) => x.cls === ed.cls)) +
      '<details><summary class="muted" style="font-size:12.5px">Портрети інших класів</summary>' + galHtml(PORTRAITS.filter((x) => x.cls !== ed.cls)) + '</details></div>';
    h += '<div class="hstep"><b>5. Кілька слів (необовʼязково)</b><input id="heLook" maxlength="120" placeholder="Зовнішність: високий норд зі шрамом через брову" value="' + esc(ed.look) + '"><textarea id="heStory" maxlength="500" rows="3" placeholder="Чому вирушив у пригоди? Чого боїться?">' + esc(ed.story) + '</textarea><small>Майстрові буде з чим грати, а тобі — кого відігравати.</small></div>';
    h += '<div class="card hsum"><p class="eyebrow">Що вийшло</p><b>' + c.ic + ' ' + ch.cn + (R.BACKGROUNDS[ed.bg] ? ' · ' + R.BACKGROUNDS[ed.bg].n : '') + '</b>' +
      '<div class="tags" style="margin:6px 0"><span class="tag">Хіти ' + c.hp + '</span><span class="tag">КБ ' + c.ac + '</span><span class="tag st">Найсильніше: ' + statTop(c).join(', ') + '</span>' + (c.slots ? '<span class="tag sv">Чари: ' + c.slots + ' комірки</span>' : '') + '</div>' +
      '<small>Навички: ' + bh.skills.map((k) => R.SKILLS[k].n).join(', ') + '</small><small class="muted" style="display:block;margin-top:4px">Ці числа гра рахує сама — запамʼятовувати нічого не треба.</small></div>';
    if (ed.err) h += '<p class="err">' + esc(ed.err) + '</p>';
    h += '<div class="row" style="margin-top:4px">' + (ed.isNew ? '' : '<button class="btn2" type="button" data-hremove="1">🗑</button>') + '<button class="btn2" type="button" data-hcancel="1">Скасувати</button><button class="btn grow" type="button" data-hsave="1">Зберегти</button></div>';
    $('heroEdSheet').innerHTML = h;
  }
  function galHtml(list) {
    return '<div class="pgal">' + list.map((x) => '<button type="button" class="' + (ed.ip === 'pp_' + x.id ? 'on' : '') + '" data-hpre="' + x.id + '" aria-label="Портрет"><img alt="" loading="lazy" src="img/por/' + x.id + '_i.webp"></button>').join('') + '</div>';
  }
  function onInput(e) {
    if (!ed) return;
    if (e.target.id === 'heN') ed.n = e.target.value.replace(/\s+/g, ' ').slice(0, 20);
    if (e.target.id === 'heLook') ed.look = e.target.value.slice(0, 120);
    if (e.target.id === 'heStory') ed.story = e.target.value.slice(0, 500);
  }
  function onClick(e) {
    const b = e.target.closest('button'); if (!b || !ed) return;
    const d = b.dataset, keep = $('heroEdSheet').scrollTop;
    if (d.hcls) ed.cls = d.hcls;
    else if (d.hbg) ed.bg = d.hbg;
    else if (d.hpre) { const id = d.hpre; Object.assign(ed, { p: 'img/por/' + id + '_p.webp', ip: 'pp_' + id, i: 'img/por/' + id + '_i.webp', ii: 'pi_' + id }); }
    else if (d.hup) { fileKind = d.hup; $('heFile').value = ''; $('heFile').click(); return; }
    else if (d.hcut) { const img = new Image(); img.onload = () => crop(img, 'i'); img.src = ed.p; return; }
    else if (d.hdel) { ed[d.hdel] = ''; ed[d.hdel === 'p' ? 'ip' : 'ii'] = ''; }
    else if (d.hcancel) { close(); return; }
    else if (d.hremove) { if (!confirm('Видалити героя «' + (ed.n || '') + '»?')) return; saveAll(load().filter((x) => x.id !== ed.id)); const cb = onDone; close(); if (cb) cb(null); return; }
    else if (d.hsave) {
      const n = (ed.n || '').trim();
      if (n.length < 2) { ed.err = 'Дай героєві імʼя — хоча б 2 літери.'; draw(); $('heN').focus(); return; }
      const rec = { id: ed.id, rev: (ed.rev || 0) + 1, n, cls: ed.cls, bg: ed.bg, look: ed.look.trim(), story: ed.story.trim(), p: ed.p, i: ed.i, ip: ed.p ? ed.ip : '', ii: ed.i ? ed.ii : '', at: Date.now() };
      const list = load().filter((x) => x.id !== rec.id); list.unshift(rec);
      if (!saveAll(list)) { ed.err = 'Не вистачає місця на телефоні. Спробуй менший портрет або видали старого героя.'; draw(); return; }
      seedLocal(); const cb = onDone; close(); if (cb) cb(rec.id); return;
    } else return;
    draw(); $('heroEdSheet').scrollTop = keep;
  }
  function onFile() {
    const f = $('heFile').files && $('heFile').files[0]; if (!f || !ed) return;
    const rd = new FileReader();
    rd.onload = () => { const img = new Image(); img.onload = () => crop(img, fileKind); img.onerror = () => { ed.err = 'Не вдалося відкрити цю картинку.'; draw(); }; img.src = rd.result; };
    rd.readAsDataURL(f);
  }

  /* ---------- обрізання: тягни й масштабуй ---------- */
  function crop(img, kind) {
    const portrait = kind === 'p', outW = portrait ? 480 : 192, outH = portrait ? 640 : 192, aspect = outW / outH;
    const vw = Math.min(window.innerWidth - 48, 340), fw = portrait ? Math.min(vw, Math.round((window.innerHeight * 0.55) * aspect)) : Math.min(vw, 300), fh = Math.round(fw / aspect);
    const cv = $('cropCv'), dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = fw * dpr; cv.height = fh * dpr; cv.style.width = fw + 'px'; cv.style.height = fh + 'px';
    $('cropFrame').classList.toggle('round', !portrait);
    $('cropT').textContent = portrait ? 'Портрет (3:4)' : 'Іконка для мапи (коло)';
    const base = Math.max(fw / img.naturalWidth, fh / img.naturalHeight);
    let z = 1, ox = (fw - img.naturalWidth * base) / 2, oy = (fh - img.naturalHeight * base) / 2;
    const ctx = cv.getContext('2d');
    const clamp = () => { const s = base * z, w = img.naturalWidth * s, h = img.naturalHeight * s; ox = Math.min(0, Math.max(fw - w, ox)); oy = Math.min(0, Math.max(fh - h, oy)); };
    const paint = () => {
      clamp(); const s = base * z;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#111'; ctx.fillRect(0, 0, fw, fh);
      ctx.drawImage(img, ox, oy, img.naturalWidth * s, img.naturalHeight * s);
      if (!portrait) { ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.beginPath(); ctx.rect(0, 0, fw, fh); ctx.arc(fw / 2, fh / 2, fw / 2 - 2, 0, Math.PI * 2, true); ctx.fill('evenodd'); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(fw / 2, fh / 2, fw / 2 - 2, 0, Math.PI * 2); ctx.stroke(); }
    };
    $('cropZoom').value = '1';
    $('cropZoom').oninput = () => { const cx0 = fw / 2, cy0 = fh / 2, s0 = base * z; z = +$('cropZoom').value; const s1 = base * z; ox = cx0 - (cx0 - ox) * s1 / s0; oy = cy0 - (cy0 - oy) * s1 / s0; paint(); };
    let drag = null;
    cv.onpointerdown = (e) => { drag = { x: e.clientX, y: e.clientY, ox, oy }; cv.setPointerCapture(e.pointerId); };
    cv.onpointermove = (e) => { if (!drag) return; ox = drag.ox + e.clientX - drag.x; oy = drag.oy + e.clientY - drag.y; paint(); };
    cv.onpointerup = cv.onpointercancel = () => { drag = null; };
    $('cropNo').onclick = () => { $('crop').hidden = true; };
    $('cropOk').onclick = () => {
      const out = document.createElement('canvas'); out.width = outW; out.height = outH;
      const k = outW / fw, s = base * z * k, c2 = out.getContext('2d');
      c2.fillStyle = '#222'; c2.fillRect(0, 0, outW, outH);
      c2.drawImage(img, ox * k, oy * k, img.naturalWidth * s, img.naturalHeight * s);
      let u = out.toDataURL('image/webp', 0.8);
      if (!u.startsWith('data:image/webp')) u = out.toDataURL('image/jpeg', 0.82);
      if (portrait) { ed.p = u; ed.ip = rid(); if (!ed.i) { autoIcon(out); } } else { ed.i = u; ed.ii = rid(); }
      $('crop').hidden = true; const keep = $('heroEdSheet').scrollTop; draw(); $('heroEdSheet').scrollTop = keep;
    };
    $('crop').hidden = false; paint();
  }
  function autoIcon(portraitCanvas) { // якщо іконки ще нема — беремо верх портрета (обличчя)
    const out = document.createElement('canvas'); out.width = 192; out.height = 192;
    const w = portraitCanvas.width, side = w * 0.86;
    out.getContext('2d').drawImage(portraitCanvas, (w - side) / 2, portraitCanvas.height * 0.08, side, side, 0, 0, 192, 192);
    let u = out.toDataURL('image/webp', 0.8); if (!u.startsWith('data:image/webp')) u = out.toDataURL('image/jpeg', 0.82);
    ed.i = u; ed.ii = rid();
  }

  /* картки героїв для вибору (соло, лобі, старт) */
  function pickHtml(sel, attr) {
    return load().map((h) => {
      const c = R.CLASSES[h.cls], b = R.BACKGROUNDS[h.bg];
      return '<button type="button" class="cls hero' + (sel === h.id ? ' on' : '') + '" data-' + attr + '="' + h.id + '">' + avatarHtml({ cls: h.cls, hero: { ii: h.ii, ip: h.ip } }, 44) +
        '<span class="grow"><b>' + esc(h.n) + '</b><small>' + R.CLASS_HINT[h.cls].cn + (b ? ' · ' + b.n : '') + '</small></span>' + (c ? '' : '') + '</button>';
    }).join('');
  }

  H.reg = (id, u) => { cache[id] = cache[id] || { url: u }; };
  Object.assign(H, { load, get, compact, open, url, image, upload, put, iconId, portId, rid: () => rid(), avatarHtml, pickHtml, seedLocal });
  window.DNDHeroes = H;
})();
