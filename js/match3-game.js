// ==========================================================================
// «Три в ряд» — малювання, анімація подій із match3-core.js, меню, збереження.
// ==========================================================================
(function () {
  const C = window.Match3Core, N = C.N;
  const $ = (id) => document.getElementById(id);
  const cv = $('c'), ctx = cv.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SAVE = 'match3_run', BEST = 'match3_best';

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };

  // ---------- кераміка: фішки малюються кодом один раз на розмір ----------
  const GLAZE = [
    { base: '#d8402e', light: '#f27a5c', rim: '#8e2118' },
    { base: '#2763c8', light: '#5f9bf0', rim: '#153b80' },
    { base: '#3f9f46', light: '#7fce6f', rim: '#22632a' },
    { base: '#efab22', light: '#ffd76b', rim: '#a56c0a' },
    { base: '#8a48b8', light: '#bb82e0', rim: '#532775' },
    { base: '#1fb0a8', light: '#6fe0d4', rim: '#0f6d68' },
  ];
  const IVORY = '#fbf0da';
  const TAU = Math.PI * 2;

  function silhouette(g, c, r) {
    g.beginPath();
    if (c === 0) { const s = r * 0.9; g.roundRect(-s, -s, s * 2, s * 2, r * 0.32); }
    else if (c === 1) { const s = r * 1.14; g.moveTo(0, -s); g.quadraticCurveTo(s * 0.12, -s * 0.88, s, 0); g.quadraticCurveTo(s * 0.12, s * 0.88, 0, s); g.quadraticCurveTo(-s * 0.12, s * 0.88, -s, 0); g.quadraticCurveTo(-s * 0.12, -s * 0.88, 0, -s); g.closePath(); }
    else if (c === 2) { for (let k = 0; k < 6; k++) { const a = TAU * k / 6 - TAU / 4, s = r * 1.04; k ? g.lineTo(Math.cos(a) * s, Math.sin(a) * s) : g.moveTo(Math.cos(a) * s, Math.sin(a) * s); } g.closePath(); }
    else if (c === 3) { for (let k = 0; k <= 96; k++) { const a = TAU * k / 96, s = r * (0.96 + 0.07 * Math.cos(a * 12)); k ? g.lineTo(Math.cos(a) * s, Math.sin(a) * s) : g.moveTo(Math.cos(a) * s, Math.sin(a) * s); } g.closePath(); }
    else if (c === 4) { const s = r * 1.06; g.moveTo(0, -s); g.bezierCurveTo(s * 0.5, -s * 0.72, s, -s * 0.5, s, -s * 0.06); g.bezierCurveTo(s, s * 0.52, s * 0.42, s * 0.86, 0, s); g.bezierCurveTo(-s * 0.42, s * 0.86, -s, s * 0.52, -s, -s * 0.06); g.bezierCurveTo(-s, -s * 0.5, -s * 0.5, -s * 0.72, 0, -s); g.closePath(); }
    else { const s = r * 0.56; [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(([x, y]) => { g.moveTo(x * s + s, y * s); g.arc(x * s, y * s, s, 0, TAU); }); g.rect(-s, -s, s * 2, s * 2); }
  }

  function motif(g, c, r) {
    g.fillStyle = IVORY; g.strokeStyle = IVORY; g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = r * 0.1;
    if (c === 0) {
      for (let k = 0; k < 8; k++) { g.save(); g.rotate(TAU * k / 8); g.beginPath(); g.ellipse(0, -r * 0.42, r * 0.12, r * 0.25, 0, 0, TAU); g.fill(); g.restore(); }
      g.fillStyle = GLAZE[3].light; g.beginPath(); g.arc(0, 0, r * 0.14, 0, TAU); g.fill();
    } else if (c === 1) {
      for (let k = 0; k < 8; k++) { g.save(); g.rotate(TAU * k / 8); g.beginPath(); g.moveTo(0, 0); g.lineTo(r * 0.13, -r * 0.2); g.lineTo(0, -r * (k % 2 ? 0.42 : 0.68)); g.lineTo(-r * 0.13, -r * 0.2); g.closePath(); g.fill(); g.restore(); }
    } else if (c === 2) {
      g.beginPath(); g.moveTo(0, r * 0.66); g.lineTo(0, -r * 0.62); g.stroke();
      [-0.34, 0.04, 0.42].forEach((y) => [-1, 1].forEach((s) => { g.save(); g.translate(0, y * r); g.scale(s, 1); g.rotate(0.85); g.beginPath(); g.ellipse(0, -r * 0.26, r * 0.1, r * 0.26, 0, 0, TAU); g.fill(); g.restore(); }));
    } else if (c === 3) {
      g.beginPath(); g.arc(0, 0, r * 0.26, 0, TAU); g.fill();
      for (let k = 0; k < 12; k++) { g.save(); g.rotate(TAU * k / 12); g.beginPath(); g.moveTo(0, -r * 0.4); g.lineTo(0, -r * (k % 2 ? 0.56 : 0.7)); g.stroke(); g.restore(); }
    } else if (c === 4) {
      g.beginPath(); g.moveTo(0, r * 0.1); g.bezierCurveTo(-r * 0.62, -r * 0.05, -r * 0.5, -r * 0.5, -r * 0.42, -r * 0.62); g.lineTo(-r * 0.16, -r * 0.34); g.lineTo(0, -r * 0.7); g.lineTo(r * 0.16, -r * 0.34); g.lineTo(r * 0.42, -r * 0.62); g.bezierCurveTo(r * 0.5, -r * 0.5, r * 0.62, -r * 0.05, 0, r * 0.1); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(0, r * 0.1); g.lineTo(0, r * 0.68); g.moveTo(0, r * 0.52); g.quadraticCurveTo(r * 0.3, r * 0.5, r * 0.4, r * 0.26); g.moveTo(0, r * 0.52); g.quadraticCurveTo(-r * 0.3, r * 0.5, -r * 0.4, r * 0.26); g.stroke();
    } else {
      g.save(); g.rotate(TAU / 8); g.beginPath(); g.rect(-r * 0.24, -r * 0.24, r * 0.48, r * 0.48); g.fill(); g.restore();
      [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(([x, y]) => { g.beginPath(); g.arc(x * r * 0.68, y * r * 0.68, r * 0.13, 0, TAU); g.fill(); });
    }
  }

  function gloss(g, r) {
    g.fillStyle = 'rgba(255,255,255,.3)';
    g.beginPath(); g.ellipse(-r * 0.28, -r * 0.54, r * 0.34, r * 0.13, -0.5, 0, TAU); g.fill();
  }

  function drawPiece(g, c, r) {
    const P = GLAZE[c];
    g.save(); g.translate(0, r * 0.1); g.fillStyle = P.rim; silhouette(g, c, r); g.fill(); g.restore();
    const grad = g.createRadialGradient(-r * 0.3, -r * 0.45, r * 0.1, 0, 0, r * 1.4);
    grad.addColorStop(0, P.light); grad.addColorStop(0.55, P.base); grad.addColorStop(1, P.rim);
    g.fillStyle = grad; silhouette(g, c, r); g.fill();
    motif(g, c, r);
    gloss(g, r);
  }

  function drawSpecial(g, c, sp, r) {
    if (sp === 'r') {
      const hues = GLAZE.slice(0, 6);
      g.fillStyle = '#10211d'; g.beginPath(); g.arc(0, r * 0.1, r * 0.98, 0, TAU); g.fill();
      hues.forEach((P, k) => { g.fillStyle = P.base; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, r * 0.98, TAU * k / 6 - TAU / 4, TAU * (k + 1) / 6 - TAU / 4); g.closePath(); g.fill(); });
      g.fillStyle = IVORY; g.beginPath(); g.arc(0, 0, r * 0.42, 0, TAU); g.fill();
      g.fillStyle = '#10211d';
      for (let k = 0; k < 6; k++) { g.save(); g.rotate(TAU * k / 6); g.beginPath(); g.ellipse(0, -r * 0.22, r * 0.06, r * 0.13, 0, 0, TAU); g.fill(); g.restore(); }
      gloss(g, r);
      return;
    }
    drawPiece(g, c, r);
    if (sp === 'h' || sp === 'v') {
      g.save(); if (sp === 'v') g.rotate(TAU / 4);
      g.fillStyle = 'rgba(16,33,29,.8)'; g.beginPath(); g.roundRect(-r * 1.06, -r * 0.3, r * 2.12, r * 0.6, r * 0.3); g.fill();
      g.strokeStyle = IVORY; g.lineWidth = r * 0.15; g.lineCap = 'round'; g.lineJoin = 'round';
      [-1, 1].forEach((s) => { g.beginPath(); g.moveTo(s * r * 0.48, -r * 0.16); g.lineTo(s * r * 0.84, 0); g.lineTo(s * r * 0.48, r * 0.16); g.stroke(); });
      g.beginPath(); g.moveTo(-r * 0.3, 0); g.lineTo(r * 0.3, 0); g.stroke();
      g.restore();
    } else if (sp === 'b') {
      g.fillStyle = '#10211d'; g.beginPath(); g.arc(0, r * 0.08, r * 0.62, 0, TAU); g.fill();
      g.strokeStyle = IVORY; g.lineWidth = r * 0.1; g.beginPath(); g.arc(0, r * 0.08, r * 0.62, 0, TAU); g.stroke();
      g.fillStyle = IVORY;
      g.beginPath(); for (let k = 0; k < 16; k++) { const a = TAU * k / 16, s = r * (k % 2 ? 0.16 : 0.42); const px = Math.cos(a) * s, py = r * 0.08 + Math.sin(a) * s; k ? g.lineTo(px, py) : g.moveTo(px, py); } g.closePath(); g.fill();
    }
  }

  function drawCrate(g, hp, r) {
    const s = r * 1.02;
    g.fillStyle = '#54301d'; g.beginPath(); g.roundRect(-s, -s + r * 0.1, s * 2, s * 2, r * 0.2); g.fill();
    g.fillStyle = '#a4663c'; g.beginPath(); g.roundRect(-s, -s, s * 2, s * 2, r * 0.2); g.fill();
    g.strokeStyle = '#6f4023'; g.lineWidth = r * 0.09; g.lineCap = 'round';
    for (let k = -1; k <= 1; k++) { g.beginPath(); g.moveTo(-s * 0.8, k * s * 0.58); g.lineTo(s * 0.8, k * s * 0.58); g.stroke(); }
    if (hp > 1) {
      g.strokeStyle = '#2b3433'; g.lineWidth = r * 0.26; g.lineCap = 'butt';
      [-1, 1].forEach((d) => { g.beginPath(); g.moveTo(d * s * 0.58, -s); g.lineTo(d * s * 0.58, s); g.stroke(); });
      g.fillStyle = '#9fb0ad';
      [-1, 1].forEach((d) => [-1, 1].forEach((e) => { g.beginPath(); g.arc(d * s * 0.58, e * s * 0.72, r * 0.07, 0, TAU); g.fill(); }));
    }
  }

  function bake(size, fn) {
    const b = document.createElement('canvas'); b.width = b.height = size;
    const g = b.getContext('2d'); g.translate(size / 2, size / 2);
    fn(g, size * 0.36);
    return b;
  }
  const iconCache = {};
  function icon(key, fn) { return iconCache[key] || (iconCache[key] = bake(144, fn).toDataURL()); }
  const pieceIcon = (c) => icon('p' + c, (g, r) => drawPiece(g, c, r));
  const crateIcon = () => icon('crate', (g, r) => drawCrate(g, 1, r));
  const iceIcon = () => icon('ice', (g, r) => {
    const s = r * 1.1;
    g.fillStyle = '#9fdcf2'; g.beginPath(); g.roundRect(-s, -s, s * 2, s * 2, r * 0.26); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = r * 0.12; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-s * 0.5, s * 0.1); g.lineTo(s * 0.1, -s * 0.5); g.moveTo(-s * 0.1, s * 0.5); g.lineTo(s * 0.5, -s * 0.1); g.stroke();
  });

  let sheet = {}, cell = 40, side = 320, dpr = 1;
  function makeSheet() {
    const size = Math.ceil(cell * dpr * 1.2);
    sheet = { size };
    for (let c = 0; c < 6; c++) {
      sheet['g' + c] = bake(size, (g, r) => drawPiece(g, c, r));
      ['h', 'v', 'b'].forEach((sp) => { sheet['g' + c + sp] = bake(size, (g, r) => drawSpecial(g, c, sp, r)); });
    }
    sheet.r = bake(size, (g, r) => drawSpecial(g, -1, 'r', r));
    sheet.x1 = bake(size, (g, r) => drawCrate(g, 1, r));
    sheet.x2 = bake(size, (g, r) => drawCrate(g, 2, r));
  }

  function resize() {
    const box = $('wrap').getBoundingClientRect();
    side = Math.floor(Math.min(box.width, box.height, 480));
    if (side <= 0) return;
    dpr = Math.min(2.5, devicePixelRatio || 1);
    cv.style.width = cv.style.height = side + 'px';
    cv.width = cv.height = Math.round(side * dpr);
    cell = side / N;
    makeSheet();
  }
  new ResizeObserver(resize).observe($('wrap'));

  // ---------- стан малювання ----------
  let G = null, busy = false, armed = false, selected = -1, iceView = [], lastInput = 0, hintPair = null, T = 0, shake = 0, flash = 0;
  const sprites = new Map();
  let tweens = [], timers = [], fx = [], parts = [], pops = [];
  const view = { score: 0, moves: 0, have: [] };

  const easeOut = (k) => 1 - (1 - k) * (1 - k);
  const easeIn = (k) => k * k;
  const back = (k) => { const c = 1.9; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
  function tw(o, to, dur, delay, ease, done) { tweens.push({ o, to, from: null, dur: reduce ? Math.min(dur, 60) : dur, t: -(delay || 0), ease: ease || easeOut, done }); }
  const after = (ms, f) => timers.push({ t: ms, f });
  const wait = (ms) => new Promise((r) => after(reduce ? Math.min(ms, 60) : ms, r));

  function makeSprite(c, x, y) {
    const s = { id: c.id, k: c.k, c: c.c, sp: c.sp, hp: c.hp, gold: !!c.gold, fuse: c.fuse || 0, x, y, s: 1, a: 1, wig: 0 };
    sprites.set(c.id, s);
    return s;
  }
  function buildSprites(drop) {
    sprites.clear();
    iceView = G.ice.slice();
    G.cells.forEach((c, i) => {
      if (!c) return;
      const x = C.X(i), y = C.Y(i);
      const s = makeSprite(c, x, drop ? y - N - 1 : y);
      if (drop) tw(s, { y }, 420 + (N - y) * 30, x * 22 + (N - y) * 12, back);
    });
  }

  // ---------- кадр ----------
  function spriteKey(s) {
    if (s.k === 'x') return s.hp > 1 ? 'x2' : 'x1';
    if (s.sp === 'r') return 'r';
    return 'g' + s.c + (s.sp || '');
  }
  function drawBoard() {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#1b4a41' : '#164037';
      ctx.fillRect(x * cell, y * cell, cell, cell);
      const ice = iceView[C.idx(x, y)];
      if (ice > 0) {
        ctx.fillStyle = ice > 1 ? '#7cc9ea' : '#a9e0f4';
        ctx.beginPath(); ctx.roundRect(x * cell + 2, y * cell + 2, cell - 4, cell - 4, cell * 0.14); ctx.fill();
      }
    }
    if (selected >= 0) {
      ctx.strokeStyle = '#f6e8cc'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(C.X(selected) * cell + 2.5, C.Y(selected) * cell + 2.5, cell - 5, cell - 5, cell * 0.16); ctx.stroke();
    }
  }
  function drawSprite(s) {
    if (s.a <= 0 || s.s <= 0) return;
    const img = sheet[spriteKey(s)];
    if (!img) return;
    const w = cell * 1.2 * s.s, cx = (s.x + 0.5) * cell, cy = (s.y + 0.5) * cell;
    ctx.save();
    ctx.globalAlpha = s.a;
    ctx.translate(cx, cy);
    if (s.wig) ctx.rotate(Math.sin(T * 18) * 0.14);
    ctx.drawImage(img, -w / 2, -w / 2, w, w);
    if (s.gold) {
      ctx.strokeStyle = '#ffe28a'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, 0, cell * 0.43 * s.s, T * 2, T * 2 + 4.2); ctx.stroke();
      const a = T * 2 + 4.2, sr = cell * 0.09 * (1 + 0.3 * Math.sin(T * 7));
      ctx.fillStyle = '#fff6d0';
      ctx.save(); ctx.translate(Math.cos(a) * cell * 0.43, Math.sin(a) * cell * 0.43); ctx.rotate(T * 3);
      ctx.beginPath(); for (let k = 0; k < 8; k++) { const q = k * TAU / 8, l = k % 2 ? sr * 0.3 : sr; ctx.lineTo(Math.cos(q) * l, Math.sin(q) * l); } ctx.closePath(); ctx.fill(); ctx.restore();
    }
    if (s.fuse > 0) {
      const urgent = s.fuse <= 3, k = urgent && !reduce ? 1 + 0.1 * Math.sin(T * 10) : 1, rr = cell * 0.2 * k;
      ctx.fillStyle = urgent ? '#d1271a' : '#10211d';
      ctx.beginPath(); ctx.arc(cell * 0.24, cell * 0.24, rr, 0, TAU); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = IVORY; ctx.stroke();
      ctx.fillStyle = IVORY; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `800 ${Math.round(cell * 0.26)}px Nunito, sans-serif`;
      ctx.fillText(s.fuse, cell * 0.24, cell * 0.25);
    }
    ctx.restore();
  }
  function drawFx() {
    for (const f of fx) {
      if (f.t < 0) continue;
      const k = f.t / f.dur, a = 1 - k;
      const cx = (C.X(f.i) + 0.5) * cell, cy = (C.Y(f.i) + 0.5) * cell;
      ctx.save(); ctx.globalAlpha = a;
      if (f.t0 === 'h' || f.t0 === 'v' || f.t0 === 'cross') {
        ctx.fillStyle = '#fff6df';
        const w = (f.w || 1) * cell * (1 - k * 0.5);
        if (f.t0 !== 'v') ctx.fillRect(0, cy - w / 2, side, w);
        if (f.t0 !== 'h') ctx.fillRect(cx - w / 2, 0, w, side);
      } else if (f.t0 === 'b' || f.t0 === 'bigBomb') {
        const R = (f.t0 === 'b' ? 2.6 : 4.4) * cell * easeOut(k);
        ctx.strokeStyle = '#ffd76b'; ctx.lineWidth = cell * 0.5 * a + 1;
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
      } else if (f.t0 === 'rays' || f.t0 === 'r') {
        ctx.strokeStyle = '#fff6df'; ctx.lineWidth = 3;
        (f.targets || []).forEach((j) => { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo((C.X(j) + 0.5) * cell, (C.Y(j) + 0.5) * cell); ctx.stroke(); });
      }
      ctx.restore();
    }
  }
  function draw() {
    if (side <= 0 || !G) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, side, side);
    ctx.save();
    ctx.beginPath(); ctx.roundRect(0, 0, side, side, 14); ctx.clip();
    if (shake > 0 && !reduce) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    drawBoard();
    sprites.forEach(drawSprite);
    // тонка паморозь поверх фішки, щоб лід читався і під нею
    for (let i = 0; i < N * N; i++) if (iceView[i] > 0) {
      ctx.fillStyle = iceView[i] > 1 ? 'rgba(190,232,250,.42)' : 'rgba(205,240,252,.2)';
      ctx.beginPath(); ctx.roundRect(C.X(i) * cell + 2, C.Y(i) * cell + 2, cell - 4, cell - 4, cell * 0.14); ctx.fill();
    }
    drawFx();
    for (const p of parts) {
      ctx.globalAlpha = Math.max(0, p.l / p.m); ctx.fillStyle = p.col;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const p of pops) {
      ctx.globalAlpha = Math.min(1, p.l * 3);
      ctx.font = `700 ${p.size}px Philosopher, serif`;
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(10,30,26,.9)'; ctx.lineJoin = 'round';
      const y = p.y - (p.m - p.l) * 46;
      ctx.strokeText(p.t, p.x, y); ctx.fillStyle = p.col; ctx.fillText(p.t, p.x, y);
    }
    ctx.globalAlpha = 1;
    if (flash > 0) { ctx.fillStyle = `rgba(255,246,223,${flash})`; ctx.fillRect(0, 0, side, side); }
    ctx.restore();
  }

  let last = performance.now();
  function frame(now) {
    const ms = Math.min(50, now - last); last = now; T += ms / 1000;
    tweens = tweens.filter((t) => {
      t.t += ms;
      if (t.t < 0) return true;
      if (!t.from) { t.from = {}; for (const k in t.to) t.from[k] = t.o[k]; }
      const k = Math.min(1, t.t / t.dur), e = t.ease(k);
      for (const p in t.to) t.o[p] = t.from[p] + (t.to[p] - t.from[p]) * e;
      if (k >= 1) { if (t.done) t.done(); return false; }
      return true;
    });
    timers = timers.filter((t) => { t.t -= ms; if (t.t <= 0) { t.f(); return false; } return true; });
    fx = fx.filter((f) => (f.t += ms) < f.dur);
    parts = parts.filter((p) => { p.l -= ms / 1000; p.x += p.vx * ms / 1000; p.y += p.vy * ms / 1000; p.vy += 900 * ms / 1000; return p.l > 0; });
    pops = pops.filter((p) => (p.l -= ms / 1000) > 0);
    if (shake > 0) shake = Math.max(0, shake - ms * 0.05);
    if (flash > 0) flash = Math.max(0, flash - ms * 0.003);
    idleHint();
    draw();
    requestAnimationFrame(frame);
  }

  function burst(i, col) {
    if (reduce || parts.length > 220) return;
    const cx = (C.X(i) + 0.5) * cell, cy = (C.Y(i) + 0.5) * cell;
    for (let k = 0; k < 7; k++) {
      const a = Math.random() * TAU, v = 70 + Math.random() * 190, m = 0.3 + Math.random() * 0.25;
      parts.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, l: m, m, r: 1.5 + Math.random() * 3, col });
    }
  }
  function pop(t, x, y, size, col, life) { pops.push({ t, x, y, size, col: col || IVORY, l: life || 0.9, m: life || 0.9 }); }

  // ---------- звук (короткий «цок» кераміки) ----------
  let audio = null;
  function tone(freq, dur, vol, delay, type) {
    if (!audio || !(window.AppSettings ? window.AppSettings.isSoundOn() : true)) return;
    const t = audio.currentTime + (delay || 0), o = audio.createOscillator(), g = audio.createGain();
    o.type = type || 'triangle'; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.7, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur);
  }
  function buzz(p) { try { if (window.AppSettings && window.AppSettings.vibrate) window.AppSettings.vibrate(p); } catch (e) {} }
  const SCALE = [523, 587, 659, 784, 880, 1047, 1175, 1319];

  // ---------- HUD ----------
  const fmt = (n) => Math.round(n).toLocaleString('uk-UA').replace(/,/g, ' ');
  function plural(n) { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? 'хід' : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'ходи' : 'ходів'; }

  function renderGoals() {
    const gs = C.goalState(G);
    view.have = gs.map((g) => g.have);
    $('goals').innerHTML = gs.map((g, i) => {
      if (g.kind === 'score') return `<div class="goal wide" data-g="${i}"><small><span class="h"></span> з ${fmt(g.need)}</small><div class="bar"><i></i></div></div>`;
      const src = g.kind === 'collect' ? pieceIcon(g.c) : g.kind === 'ice' ? iceIcon() : crateIcon();
      const alt = g.kind === 'collect' ? 'Зібрати' : g.kind === 'ice' ? 'Лід' : 'Ящики';
      return `<div class="goal" data-g="${i}"><img src="${src}" alt="${alt}"><span class="h"></span></div>`;
    }).join('');
    updateHud();
  }
  function updateHud() {
    $('score').textContent = fmt(view.score);
    $('lvl').textContent = 'Рівень ' + G.level;
    $('moves').textContent = view.moves;
    $('movesW').textContent = plural(view.moves);
    $('movesBox').classList.toggle('low', view.moves <= 3);
    G.goals.forEach((g, i) => {
      const el = document.querySelector(`[data-g="${i}"]`);
      if (!el) return;
      const have = Math.min(g.need, view.have[i]);
      el.querySelector('.h').textContent = g.kind === 'score' ? fmt(have) : `${have}/${g.need}`;
      el.classList.toggle('done', have >= g.need);
      const bar = el.querySelector('.bar i');
      if (bar) bar.style.width = (100 * have / g.need) + '%';
    });
    [['hammer', G.boosters.hammer], ['shuffle', G.boosters.shuffle], ['plus', G.boosters.plus]].forEach(([id, n]) => {
      const b = $(id); b.querySelector('.n').textContent = n; b.disabled = n <= 0;
    });
    $('hammer').classList.toggle('on', armed);
    cv.classList.toggle('armed', armed);
  }
  function syncView() { view.score = G.score; view.moves = G.moves; view.have = C.goalState(G).map((g) => g.have); updateHud(); }

  let bannerTimer = 0;
  function banner(title, sub, ms) {
    const el = $('banner');
    el.querySelector('b').textContent = title;
    el.querySelector('span').textContent = sub || '';
    el.classList.add('on');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.classList.remove('on'), ms || 1100);
  }
  function goalLine() {
    const g = G.goals[0];
    if (g.kind === 'score') return `Набери ${fmt(g.need)} балів`;
    if (g.kind === 'collect') return 'Збери потрібні фішки';
    if (g.kind === 'ice') return 'Розбий увесь лід: роби збіги на ньому';
    return 'Розбий ящики: роби збіги поруч';
  }

  // ---------- програвання подій ----------
  async function play(events) {
    for (const e of events) {
      if (e.type === 'swap') {
        const A = sprites.get(e.sa), B = sprites.get(e.sb);
        view.moves = Math.max(0, view.moves - 1); updateHud();
        if (A) tw(A, { x: C.X(e.b), y: C.Y(e.b) }, 150);
        if (B) tw(B, { x: C.X(e.a), y: C.Y(e.a) }, 150);
        tone(330, 0.05, 0.05);
        await wait(155);
      } else if (e.type === 'clear') await playClear(e);
      else if (e.type === 'fall') await playFall(e);
      else if (e.type === 'shuffle') {
        e.moves.forEach((m) => { const s = sprites.get(m.id); if (s) { s.c = m.c; tw(s, { x: C.X(m.to), y: C.Y(m.to) }, 340, Math.random() * 60); } });
        tone(440, 0.12, 0.05); await wait(420);
      } else if (e.type === 'noMoves') { banner('Ходів немає', 'Перемішую поле'); await wait(650); }
      else if (e.type === 'fuse') e.list.forEach((f) => { const s = sprites.get(f.id); if (s) s.fuse = f.fuse; });
      else if (e.type === 'fuseBoom') {
        e.removed.forEach((r) => { const s = sprites.get(r.id); burst(r.i, '#ff8a66'); if (s) tw(s, { s: 0, a: 0 }, 180, 0, easeIn, () => sprites.delete(r.id)); });
        shake = 14; buzz(80); tone(120, 0.3, 0.14, 0, 'sawtooth');
        view.moves = Math.max(0, view.moves - e.lost); updateHud();
        banner(`Вибух: мінус ${e.lost} ${plural(e.lost)}`, '', 1000);
        await wait(320);
      } else if (e.type === 'hammer') { shake = 7; tone(150, 0.14, 0.14, 0, 'square'); await wait(90); }
      else if (e.type === 'finale') { view.moves = e.left; updateHud(); }
      else if (e.type === 'bonus') { view.score += e.pts; updateHud(); pop('+' + fmt(e.pts), side / 2, side / 2, Math.round(cell * 0.9), '#ffd76b', 1.1); tone(784, 0.2, 0.1); tone(1047, 0.3, 0.1, 0.12); await wait(650); }
    }
    syncView();
  }

  async function playClear(e) {
    let maxD = 0;
    e.fx.forEach((f) => {
      if (f.t === 'none') return;
      const type = f.t;
      fx.push({ t0: type, i: f.i, w: f.w, targets: f.targets, t: -(f.d || 0), dur: type === 'b' || type === 'bigBomb' ? 330 : 280 });
      maxD = Math.max(maxD, f.d || 0);
    });
    if (e.fx.some((f) => f.t === 'all')) flash = 0.9;
    if (e.specials) { shake = Math.max(shake, 5 + Math.min(10, e.specials * 2)); buzz(30); tone(220, 0.22, 0.13, 0, 'sawtooth'); }
    e.removed.forEach((r) => {
      maxD = Math.max(maxD, r.d);
      const s = sprites.get(r.id);
      if (!s) return;
      tw(s, { s: 0, a: 0.2 }, 170, r.d, easeIn, () => sprites.delete(r.id));
      after(r.d, () => burst(r.i, r.c >= 0 ? GLAZE[r.c].light : IVORY));
    });
    e.ice.forEach((c) => { iceView[c.i] = c.hp; burst(c.i, '#d6f2fc'); });
    e.crates.forEach((c) => {
      const s = sprites.get(c.id);
      burst(c.i, '#c78a5c');
      if (!s) return;
      s.hp = c.hp;
      if (c.hp <= 0) tw(s, { s: 0, a: 0 }, 170, 0, easeIn, () => sprites.delete(c.id));
      else { s.s = 0.82; tw(s, { s: 1 }, 170, 0, back); }
    });
    e.created.forEach((c) => {
      const s = makeSprite({ id: c.id, k: 'g', c: c.c, sp: c.sp }, C.X(c.i), C.Y(c.i));
      s.s = 0; tw(s, { s: 1 }, 240, 110, back);
    });
    tone(SCALE[Math.min(SCALE.length - 1, e.depth)], 0.11, 0.09);
    view.score += e.pts;
    G.goals.forEach((g, i) => {
      if (g.kind === 'score') view.have[i] += e.raw;
      else if (g.kind === 'collect') view.have[i] += e.removed.filter((r) => r.c === g.c).length;
      else if (g.kind === 'ice') view.have[i] += e.ice.filter((c) => c.hp === 0).length;
      else view.have[i] += e.crates.filter((c) => c.hp <= 0).length;
    });
    updateHud();
    if (e.pts && e.at && e.at !== -1) pop('+' + fmt(e.pts), (e.at.x + 0.5) * cell, (e.at.y + 0.5) * cell, Math.round(cell * (0.42 + Math.min(0.3, e.depth * 0.07))), e.gold ? '#ffd76b' : IVORY);
    if (e.depth >= 2) pop(['Гарно!', 'Чудово!', 'Неймовірно!'][Math.min(2, e.depth - 2)], side / 2, side * 0.4, Math.round(cell * 0.85), '#ffd76b', 0.8);
    if (e.gold) banner('Золота фішка', 'Бали подвоєно', 700);
    await wait(maxD + 190);
  }
  async function playFall(e) {
    let longest = 0;
    e.moves.forEach((m) => {
      const s = sprites.get(m.id);
      if (!s) return;
      const dist = C.Y(m.to) - C.Y(m.from), d = 110 + Math.sqrt(dist) * 75;
      longest = Math.max(longest, d);
      tw(s, { y: C.Y(m.to) }, d, 0, easeIn);
    });
    e.spawned.forEach((n) => {
      const s = makeSprite({ id: n.id, k: 'g', c: n.c, gold: n.gold }, C.X(n.to), n.startY);
      const dist = C.Y(n.to) - n.startY, d = 110 + Math.sqrt(dist) * 75;
      longest = Math.max(longest, d);
      tw(s, { y: C.Y(n.to) }, d, 0, easeIn);
    });
    await wait(longest + 20);
  }

  // ---------- дії гравця ----------
  function save() { store.set(SAVE, JSON.stringify(G)); }

  async function attemptSwap(a, b) {
    if (busy || !G || G.status !== 'play') return;
    selected = -1; hintOff();
    const ids = [G.cells[a] && G.cells[a].id, G.cells[b] && G.cells[b].id];
    if (!C.isGem(G.cells[a]) || !C.isGem(G.cells[b])) return;
    busy = true;
    const res = C.playSwap(G, a, b);
    if (!res.ok) {
      const A = sprites.get(ids[0]), B = sprites.get(ids[1]);
      tw(A, { x: C.X(b), y: C.Y(b) }, 110); tw(B, { x: C.X(a), y: C.Y(a) }, 110);
      await wait(115);
      tw(A, { x: C.X(a), y: C.Y(a) }, 130); tw(B, { x: C.X(b), y: C.Y(b) }, 130);
      tone(160, 0.08, 0.05);
      await wait(135);
      busy = false; return;
    }
    save();
    res.events[0].sa = ids[0]; res.events[0].sb = ids[1];
    await play(res.events);
    busy = false;
    proceed();
  }
  async function runBooster(res) {
    if (!res.ok) return;
    busy = true; save();
    await play(res.events);
    busy = false;
    proceed();
  }

  async function proceed() {
    if (!G) return;
    updateHud();
    if (G.status === 'won') {
      busy = true;
      banner('Рівень ' + G.level + ' пройдено', G.moves ? 'Ходи, що лишились, стають балами' : '', 1300);
      await wait(650);
      const events = C.finishLevel(G);
      save();
      report(G.level + 1);
      await play(events);
      busy = false;
      proceed();
    } else if (G.status === 'cleared') {
      if (G.chest) { showChest(); return; }
      C.nextLevel(G); save(); startBoard();
    } else if (G.status === 'lost') showLost();
    else idleStart();
  }
  function idleStart() { lastInput = performance.now(); }

  function startBoard() {
    selected = -1; armed = false; hintOff(); parts = []; pops = []; fx = [];
    syncView(); renderGoals(); syncView();
    buildSprites(true);
    busy = true;
    banner('Рівень ' + G.level, goalLine(), 1500);
    after(reduce ? 60 : 800, () => { busy = false; idleStart(); });
  }

  function report(level) {
    const best = JSON.parse(store.get(BEST) || '{}');
    const prev = best[G.diff] || { score: 0, level: 0 };
    if (G.score > prev.score) { best[G.diff] = { score: G.score, level }; store.set(BEST, JSON.stringify(best)); }
    if (window.AppScore) window.AppScore.sendScore('match3', G.score, { level });
  }

  // ---------- підказка ----------
  function hintOff() { if (hintPair) hintPair.forEach((s) => { if (s) s.wig = 0; }); hintPair = null; }
  function idleHint() {
    if (!G || busy || G.status !== 'play' || !$('ov').hidden || hintPair) return;
    if (performance.now() - lastInput < C.DIFF[G.diff].hint) return;
    const h = C.hint(G);
    if (!h) return;
    hintPair = h.map((i) => sprites.get(G.cells[i].id));
    hintPair.forEach((s) => { if (s) s.wig = 1; });
  }

  // ---------- керування ----------
  function cellAt(ev) {
    const r = cv.getBoundingClientRect();
    const x = Math.floor((ev.clientX - r.left) / (r.width / N)), y = Math.floor((ev.clientY - r.top) / (r.height / N));
    return x >= 0 && y >= 0 && x < N && y < N ? C.idx(x, y) : -1;
  }
  let drag = null;
  cv.addEventListener('pointerdown', (ev) => {
    ensureAudio();
    lastInput = performance.now(); hintOff();
    if (busy || !G || G.status !== 'play') return;
    const i = cellAt(ev);
    if (i < 0) return;
    if (armed) {
      if (!G.cells[i]) return;
      armed = false; selected = -1;
      runBooster(C.useHammer(G, i));
      return;
    }
    if (selected >= 0 && selected !== i && C.adjacent(selected, i)) { const a = selected; selected = -1; attemptSwap(a, i); return; }
    if (C.isGem(G.cells[i])) { selected = i; drag = { i, x: ev.clientX, y: ev.clientY }; try { cv.setPointerCapture(ev.pointerId); } catch (e) {} tone(660, 0.04, 0.03); }
    else selected = -1;
  });
  cv.addEventListener('pointermove', (ev) => {
    if (!drag || busy) return;
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y, min = Math.max(14, cell * 0.3);
    if (Math.abs(dx) < min && Math.abs(dy) < min) return;
    const x = C.X(drag.i) + (Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) : 0), y = C.Y(drag.i) + (Math.abs(dx) > Math.abs(dy) ? 0 : Math.sign(dy));
    const from = drag.i;
    drag = null;
    if (x >= 0 && y >= 0 && x < N && y < N) attemptSwap(from, C.idx(x, y));
  });
  const endDrag = () => { drag = null; };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);

  $('hammer').addEventListener('click', () => { if (busy || !G || G.status !== 'play') return; armed = !armed; selected = -1; updateHud(); if (armed) banner('Молот готовий', 'Торкнись клітинки', 1100); });
  $('shuffle').addEventListener('click', () => { if (busy || !G || G.status !== 'play') return; armed = false; runBooster(C.useShuffle(G)); });
  $('plus').addEventListener('click', () => { if (busy || !G || G.status !== 'play') return; armed = false; runBooster(C.usePlus(G)); });

  function ensureAudio() {
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
    } catch (e) {}
  }

  // ---------- екрани ----------
  const ov = $('ov'), card = $('card');
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function bestLine(d) {
    const b = JSON.parse(store.get(BEST) || '{}')[d];
    return b ? `Рекорд ${fmt(b.score)}, рівень ${b.level}` : '';
  }
  function bestSpan(d) { const t = bestLine(d); return t ? `<span>${esc(t)}</span>` : ''; }
  function menu() {
    G = C.newGame('easy', 7);   // поле-тло під меню
    G.status = 'menu';
    buildSprites(false); syncView(); renderGoals(); syncView();
    let saved = null;
    try { saved = JSON.parse(store.get(SAVE)); } catch (e) {}
    const heroes = [0, 3, 1].map((c) => `<img src="${pieceIcon(c)}" alt="">`).join('');
    card.innerHTML = `
      <div class="hero">${heroes}</div>
      <h1>Три в ряд</h1>
      ${saved ? `<button class="opt main" id="goOn" type="button"><div><b>Продовжити</b><span>Рівень ${saved.level}, ${fmt(saved.score)} балів</span></div></button>` : ''}
      <button class="opt" data-d="easy" type="button"><div><b>Легка</b><span>5 кольорів, більше ходів, підказки</span>${bestSpan('easy')}</div></button>
      <button class="opt" data-d="hard" type="button"><div><b>Складна</b><span>6 кольорів, менше ходів, бали ×1,5</span>${bestSpan('hard')}</div></button>`;
    ov.hidden = false;
    if (saved) $('goOn').onclick = () => { ensureAudio(); resume(saved); };
    card.querySelectorAll('[data-d]').forEach((b) => { b.onclick = () => { ensureAudio(); fresh(b.dataset.d); }; });
  }
  function fresh(d) {
    G = C.newGame(d, (Math.random() * 2147483647) | 0);
    G.bestAtStart = (JSON.parse(store.get(BEST) || '{}')[d] || { score: 0 }).score;
    save();
    ov.hidden = true;
    resize();
    syncView(); startBoard();
  }
  function resume(saved) {
    G = saved;
    ov.hidden = true;
    resize();
    syncView(); renderGoals(); syncView();
    buildSprites(true);
    busy = true;
    after(reduce ? 60 : 800, () => { busy = false; proceed(); });
  }

  const PERK_ICON = '<svg viewBox="0 0 24 24"><path d="M12 3l2.600 5.600 6.100.7-4.500 4.200 1.200 6L12 16.600 6.600 19.500l1.200-6L3.300 9.300l6.100-.7z"/></svg>';
  function showChest() {
    card.innerHTML = `<h2>Скарб рівня ${G.level}</h2><p>Обери одну нагороду</p>` + G.chest.map((k) => {
      const o = C.chestOption(k);
      return `<button class="opt" data-k="${k}" type="button">${PERK_ICON}<div><b>${esc(o.title)}</b><span>${esc(o.text)}</span></div></button>`;
    }).join('');
    ov.hidden = false;
    tone(659, 0.16, 0.09); tone(880, 0.2, 0.09, 0.1); tone(1175, 0.3, 0.09, 0.2);
    card.querySelectorAll('[data-k]').forEach((b) => { b.onclick = () => {
      C.pickChest(G, b.dataset.k);
      ov.hidden = true;
      C.nextLevel(G); save(); startBoard();
    }; });
  }
  function showLost() {
    const canPlus = G.boosters.plus > 0;
    if (!canPlus) return gameOver();
    card.innerHTML = `<h2>Ходи скінчились</h2><p>Додай запасні ходи й доведи рівень до кінця.</p>
      <button class="opt main" id="more" type="button"><div><b>Додати 5 ходів</b><span>Лишилось наборів: ${G.boosters.plus}</span></div></button>
      <button class="link" id="stop" type="button">Завершити забіг</button>`;
    ov.hidden = false;
    $('more').onclick = () => { ov.hidden = true; runBooster(C.usePlus(G)); };
    $('stop').onclick = gameOver;
  }
  function gameOver() {
    const isRecord = G.score > (G.bestAtStart || 0);
    report(G.level);
    store.del(SAVE);
    const d = G.diff;
    card.innerHTML = `<h2>${isRecord ? 'Новий рекорд' : 'Забіг завершено'}</h2>
      <div class="big">${fmt(G.score)}</div>
      <p>Рівень ${G.level}</p>
      <button class="opt main" id="again" type="button"><div><b>Грати ще</b></div></button>
      <button class="link" id="other" type="button">Змінити складність</button>`;
    ov.hidden = false;
    G.status = 'over';
    $('again').onclick = () => fresh(d);
    $('other').onclick = menu;
  }

  // для браузерних перевірок
  window.__match3 = { get G() { return G; }, get busy() { return busy; }, attemptSwap };

  resize();
  menu();
  requestAnimationFrame(frame);
})();
