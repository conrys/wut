/* Раллі (прототип): водій бачить лише дорогу, штурман — ще й карту. Другим місцем керує бот, місця міняються на ходу. */
(function () {
  const { Road, Car, Scene, autopilot, corners, clamp, BIOME } = window.Drive, M = window.RelaxMusic, T = window.THREE;
  const $ = (id) => document.getElementById(id);
  const load = (k, d) => { try { const v = localStorage.getItem('rally_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem('rally_' + k, JSON.stringify(v)); } catch (e) {} };

  const LEN = 2600;
  const LOC = {
    carp: { name: 'Карпати', biome: BIOME.FOREST, kMax: 1 / 30, hill: 1.5 },
    step: { name: 'Степ', biome: BIOME.FIELD, kMax: 1 / 60, hill: 0.4 },
    selo: { name: 'Село', biome: BIOME.VILLAGE, kMax: 1 / 36, hill: 0.5 },
    osin: { name: 'Осінні пагорби', biome: BIOME.AUTUMN, kMax: 1 / 34, hill: 1.3 },
    zyma: { name: 'Зимовий ліс', biome: BIOME.WINTER, kMax: 1 / 38, hill: 1 },
  };
  /* бот-штурман: затримка в секундах, імовірність неточної й хибної підказки */
  const NAV = { easy: { d: [0.6, 1.4], inexact: 0.1, wrong: 0.02 }, mid: { d: [0.2, 0.8], inexact: 0.03, wrong: 0.005 }, pro: { d: [0.1, 0.4], inexact: 0.01, wrong: 0.00001 } };
  const VIS = [10, 25, 60, 150, 400, 1250];
  const COLORS = 0xD63A32;

  const st = { loc: load('loc', 'carp'), seat: load('seat', 'nav'), nav: load('nav', 'mid'), wx: load('wx', 'rand'), body: load('body', 'sedan') };
  let road, car, sc, list = [], phase = 'menu', t = 0, off = 0, next = 0, shown = null, seat = st.seat, gas = false, brake = false, hand = false, held = false, wheel = 0;
  const pad = { right: 0, wrong: 0, missed: 0 };

  function pickVis() { return st.wx === 'rand' ? VIS[Math.floor(Math.random() * VIS.length)] : +st.wx; }
  function callText(c) { return (c.dir === 'L' ? 'Лівий ' : 'Правий ') + c.grade; }
  function say(c) {
    const e = $('call'); e.textContent = callText(c); e.className = 'call show ' + (c.dir === 'L' ? 'l' : 'r'); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove('show'), 3200);
    if (seat !== 'nav' && window.speechSynthesis) { try { const u = new SpeechSynthesisUtterance(callText(c)); u.lang = 'uk-UA'; u.rate = 1.25; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (x) {} }
  }
  function nextCorner() { for (let i = next; i < list.length; i++) if (!list[i].call) return list[i]; return null; }
  function giveCall(dir, grade) {
    const c = nextCorner(); if (!c) return; c.call = { dir, grade }; say({ dir, grade });
  }

  /* бот-штурман: каже наперед, із запізненням і зрідка помиляється */
  function botNav(dt) {
    const c = nextCorner(); if (!c) return;
    if (c.when == null) { const L = NAV[st.nav]; c.when = L.d[0] + Math.random() * (L.d[1] - L.d[0]); c.lead = Math.max(55, car.speed * 3.4); }
    if (c.s0 - car.s > c.lead) return;
    c.when -= dt; if (c.when > 0) return;
    const L = NAV[st.nav], r = Math.random(); let dir = c.dir, grade = c.grade;
    if (r < L.wrong) dir = dir === 'L' ? 'R' : 'L'; else if (r < L.wrong + L.inexact) grade = Math.min(6, grade + 2); /* «правий 90» замість шпильки */
    giveCall(dir, grade);
  }

  /* бот-водій: бачить лише на відстань видимості; підказка дає знати про поворот наперед */
  function botDrive() {
    const vis = sc.wx.vis, see = Math.min(220, vis * 0.9); let want = 27, trust = false;
    for (let i = next; i < list.length; i++) {
      const c = list[i], d = c.s0 - car.s; if (d > 240) break;
      const know = d <= see, right = c.call && c.call.dir === c.dir, k = know ? c.k : c.call ? 1 / [0, 30, 40, 54, 72, 100, 140][c.call.grade] : 0;
      if (c.call) trust = true;
      if (!know && !c.call) continue;
      if (c.call && !right && !know) continue;
      want = Math.min(want, Math.sqrt(3.6 / Math.max(k, 1e-4) + 2 * 4.5 * Math.max(0, d)));
    }
    if (see < 180) want = Math.min(want, Math.sqrt(2 * 6 * see) + (trust ? 7 : 0));
    const ap = autopilot(road, car, 40, 0.6, 0), dv = want - car.speed;
    return { steer: ap.steer, gas: dv > 0 ? clamp(dv / 3 + 0.3, 0, 1) : 0, brake: dv < -0.6 ? clamp(-dv / 7, 0, 1) : 0 };
  }

  function drawDevice() {
    const c = sc.devC, g = c.getContext('2d'), W = c.width, H = c.height;
    g.fillStyle = '#2D2F22'; g.fillRect(0, 0, W, H);
    /* годинник має власну смугу: маршрут обрізається під нею */
    g.save(); g.beginPath(); g.rect(0, 46, W, H - 46); g.clip();
    const ox = W / 2, oy = H - 62, sca = 0.95, sn = Math.sin(car.travel), cs = Math.cos(car.travel);
    const P = (p) => { const dx = p.x - car.x, dz = p.z - car.z, fw = dx * sn + dz * cs, rt = -dx * cs + dz * sn; return [ox + rt * sca, oy - fw * sca]; };
    g.strokeStyle = '#F2DDA0'; g.lineWidth = 7; g.lineJoin = 'round'; g.lineCap = 'round'; g.beginPath(); let first = true;
    for (let s = Math.max(0, car.s - 50); s < Math.min(LEN, car.s + 340); s += 8) { const q = P(road.at(s)); if (first) g.moveTo(q[0], q[1]); else g.lineTo(q[0], q[1]); first = false; }
    g.stroke();
    g.fillStyle = '#FF8A1E'; g.beginPath(); g.moveTo(ox, oy - 20); g.lineTo(ox - 13, oy + 12); g.lineTo(ox + 13, oy + 12); g.closePath(); g.fill(); g.restore();
    g.fillStyle = '#0D0D0E'; g.fillRect(0, 0, W, 46); g.fillStyle = '#F4F1EA'; g.font = 'bold 28px monospace'; g.textAlign = 'center'; g.fillText(fmt(t), W / 2, 33);
    sc.devTex.needsUpdate = true;
  }
  const fmt = (x) => Math.floor(x / 60) + ':' + String(Math.floor(x % 60)).padStart(2, '0') + '.' + Math.floor(x * 10 % 10);

  function setSeat(s) {
    seat = s; if (sc) { sc.seat = s === 'drive' ? 'driver' : 'nav'; sc.fit(); } document.body.dataset.seat = s;
    $('seatBtn').textContent = s === 'drive' ? '⇄ До штурмана' : s === 'nav' ? '⇄ За кермо' : '⇄ За кермо';
  }

  function begin() {
    speakInit(); M.setStation(3);
    const L = LOC[st.loc], seed = (Math.random() * 1e9) | 0;
    road = new Road({ seed, fixedBiome: L.biome, startBiome: L.biome, kMax: L.kMax, hill: L.hill, kRate: 14, maxH: 1, lowFar: true });
    car = new Car(road, { lane: 0, rail: road.half + 5, s: 12 });
    sc = new Scene({ canvas: $('gl'), road, car, color: COLORS, body: st.body, device: true, seat: 'driver', time: 0.1 + Math.random() * 0.42, lockDay: true });
    sc.setCam('cabin'); sc.addGate(26, 0xFFC93C); sc.addGate(LEN, 0x3DD6A3);
    const v = pickVis(), winter = L.biome === BIOME.WINTER; sc.setVisibility(v < 60 ? 'fog' : v < 300 ? (winter ? 'snow' : 'rain') : v < 1000 ? 'cloudy' : 'clear', v);
    car.gripMul = 1 - (v < 300 && v >= 60 ? (winter ? 0.4 : 0.2) : 0);
    list = corners(road, 30, LEN); next = 0; t = 0; off = 0; Object.assign(pad, { right: 0, wrong: 0, missed: 0 });
    $('menu').hidden = true; $('hud').hidden = false; $('locChip').textContent = L.name + ' · видимість ' + (v >= 1000 ? 'ясно' : v + ' м'); setSeat(st.seat); phase = 'race';
  }
  function speakInit() { try { window.speechSynthesis && speechSynthesis.getVoices(); } catch (e) {} }

  function finish() {
    phase = 'done'; const total = pad.right + pad.wrong + pad.missed, acc = total ? Math.round(pad.right / total * 100) : 0, score = acc * 0.6 + clamp(40 - off * 2, 0, 40);
    $('hud').hidden = true; $('end').hidden = false; $('endTime').textContent = fmt(t);
    $('endText').textContent = `Вірних підказок: ${pad.right} із ${total} (${acc}%). Поза дорогою: ${off.toFixed(1)} с.`;
    $('endGrade').textContent = 'Зіграність: ' + (score >= 85 ? 'A' : score >= 65 ? 'B' : score >= 45 ? 'C' : 'D');
  }

  /* панель штурмана: кнопки спрацьовують від дотику */
  for (const b of document.querySelectorAll('[data-call]')) b.addEventListener('pointerdown', (e) => { e.preventDefault(); if (phase === 'race' && seat === 'nav') { const [d, g] = b.dataset.call.split(''); giveCall(d, +g); } });
  const hold = (el, on) => { el.addEventListener('pointerdown', (e) => { e.preventDefault(); on(true); el.classList.add('on'); }); for (const n of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(n, () => { on(false); el.classList.remove('on'); }); };
  hold($('gas'), (v) => { gas = v; }); hold($('brake'), (v) => { brake = v; }); hold($('hand'), (v) => { hand = v; });
  const wEl = $('wheelS'), wTh = wEl.firstElementChild;
  const wMove = (e) => { const r = wEl.getBoundingClientRect(); wheel = clamp((e.clientX - r.left) / r.width * 2 - 1, -1, 1); };
  wEl.addEventListener('pointerdown', (e) => { e.preventDefault(); held = true; try { wEl.setPointerCapture(e.pointerId); } catch (x) {} wMove(e); });
  wEl.addEventListener('pointermove', (e) => { if (held) wMove(e); });
  for (const n of ['pointerup', 'pointercancel']) wEl.addEventListener(n, () => { held = false; });
  const key = {}; addEventListener('keydown', (e) => { key[e.key] = true; }); addEventListener('keyup', (e) => { key[e.key] = false; });
  $('seatBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); if (phase === 'race') setSeat(seat === 'drive' ? 'nav' : 'drive'); });
  $('again').addEventListener('click', () => location.reload());

  for (const b of document.querySelectorAll('[data-set]')) b.addEventListener('click', () => { st[b.dataset.set] = b.dataset.val; save(b.dataset.set, b.dataset.val); paint(); });
  function paint() { for (const b of document.querySelectorAll('[data-set]')) { const on = st[b.dataset.set] === b.dataset.val; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); } }
  paint(); $('go').addEventListener('click', begin);

  let devT = 0;
  window.G3.loop((dt) => tick(dt, false));
  function tick(dt, noDraw) {
    if (phase === 'menu') return;
    let inp;
    if (phase === 'race') {
      t += dt;
      while (next < list.length && car.s > list[next].s1) { const c = list[next++]; if (!c.call) pad.missed++; else if (c.call.dir === c.dir && Math.abs(c.call.grade - c.grade) <= 1) pad.right++; else pad.wrong++; }
      if (seat !== 'nav') botNav(dt);
      if (seat === 'drive') {
        if (!held && wheel) wheel -= Math.sign(wheel) * Math.min(Math.abs(wheel), dt * 1.1);
        wTh.style.left = (wheel + 1) * 50 + '%';
        const s = Math.sign(wheel) * Math.abs(wheel) ** 1.3 + (key.ArrowRight ? 1 : 0) - (key.ArrowLeft ? 1 : 0);
        inp = { steer: clamp(s, -1, 1), gas: gas || key.ArrowUp ? 1 : 0, brake: brake || key.ArrowDown ? 1 : 0, rev: brake || key.ArrowDown, hand: hand || key[' '] };
      } else inp = botDrive();
      if (Math.abs(car.off) > road.half + 0.6) off += dt;
      $('time').textContent = fmt(t); $('speed').textContent = Math.round(car.speed * 3.6); $('left').textContent = (Math.max(0, LEN - car.s) / 1000).toFixed(1);
      if (car.s >= LEN) finish();
    } else inp = { steer: 0, gas: 0, brake: 0.6 };
    car.step(dt, inp);
    if (noDraw) return;
    sc.update(dt); M.drive(car.speed, sc.wx.rain, car.rpm, car.rumble, car.slip);
    devT -= dt; if (devT <= 0 && sc.seat === 'nav') { devT = 0.07; drawDevice(); }
  }
  window.RALLY = { get car() { return car; }, get list() { return list; }, get sc() { return sc; }, get phase() { return phase; }, pad, setSeat, finish, get t() { return t; }, get off() { return off; }, sim(sec) { for (let i = 0; i < sec * 60 && phase === 'race'; i++) tick(1 / 60, true); return phase; } };
})();
