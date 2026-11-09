/* DnD — музика сцен, згенерована в браузері (WebAudio). Без файлів і ліцензій, працює офлайн.
   8 тем грають нескінченно. Зміна сцени — плавний перехід (старе затихає, нове наростає),
   бій — різкий обрив і одразу бойова тема. API: DNDMusic.play(id, 'fade'|'cut'), stop(), setOn(), unlock(). */
(function () {
  'use strict';
  let ctx = null, master = null, verb = null, verbIn = null, on = true, cur = null, want = null, timer = 0;
  const VOL = 0.22;
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function init() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = on ? 1 : 0; master.connect(ctx.destination);
    // реверб: згенерована імпульсна характеристика
    verb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.4, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    verb.buffer = ir; verbIn = ctx.createGain(); verbIn.gain.value = 0.32; verbIn.connect(verb); verb.connect(master);
    timer = setInterval(schedule, 25);
    return true;
  }
  // шум для барабанів і вітру
  let noiseBuf = null;
  function noise() { if (!noiseBuf) { const n = ctx.sampleRate; noiseBuf = ctx.createBuffer(1, n, n); const d = noiseBuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; } return noiseBuf; }

  /* ---------- голоси ---------- */
  function env(g, t, a, peak, d, sus, r, end) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * sus), t + a + d); g.gain.setValueAtTime(Math.max(0.0001, peak * sus), end); g.gain.exponentialRampToValueAtTime(0.0001, end + r); }
  function pluck(out, t, m, dur, vel, bright) { // лютня / арфа
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'triangle'; o2.type = 'sawtooth'; o.frequency.value = mtof(m); o2.frequency.value = mtof(m) * 1.002;
    f.type = 'lowpass'; f.frequency.setValueAtTime(bright || 3200, t); f.frequency.exponentialRampToValueAtTime(500, t + Math.min(dur, 0.6)); f.Q.value = 1;
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    o.connect(f); o2.connect(g2); g2.connect(f); f.connect(g);
    env(g, t, 0.004, vel, Math.min(dur, 0.9), 0.05, 0.15, t + dur);
    g.connect(out); o.start(t); o2.start(t); o.stop(t + dur + 0.3); o2.stop(t + dur + 0.3);
  }
  function pad(out, t, m, dur, vel, cut) { // мʼякий акорд
    const g = ctx.createGain(), f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cut || 1100; f.Q.value = 0.6;
    for (const det of [-7, 0, 6]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det; o.connect(f); o.start(t); o.stop(t + dur + 1.6); }
    f.connect(g); env(g, t, Math.min(1.2, dur * 0.4), vel, 0.4, 0.8, 1.4, t + dur); g.connect(out);
  }
  function choir(out, t, m, dur, vel) { // «а-а» — пила через форманти
    const g = ctx.createGain(), mix = ctx.createGain(); mix.gain.value = 1;
    for (const det of [-5, 4]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det; o.connect(mix); o.start(t); o.stop(t + dur + 2); }
    for (const [fr, q, gv] of [[800, 8, 1], [1150, 9, 0.6], [2900, 10, 0.25]]) { const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = fr; b.Q.value = q; const bg = ctx.createGain(); bg.gain.value = gv; mix.connect(b); b.connect(bg); bg.connect(g); }
    env(g, t, Math.min(1.5, dur * 0.5), vel * 2.2, 0.5, 0.85, 1.8, t + dur); g.connect(out);
  }
  function bell(out, t, m, vel, len) {
    const g = ctx.createGain(); g.connect(out);
    for (const [k, a] of [[1, 1], [2.76, 0.4], [5.4, 0.2], [8.9, 0.08]]) { const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine'; o.frequency.value = mtof(m) * k; og.gain.setValueAtTime(vel * a, t); og.gain.exponentialRampToValueAtTime(0.0001, t + (len || 2.5) / k * 1.5); o.connect(og); og.connect(g); o.start(t); o.stop(t + (len || 2.5) * 1.6); }
  }
  function flute(out, t, m, dur, vel) {
    const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    o.type = 'sine'; o.frequency.value = mtof(m); lfo.frequency.value = 5.2; lg.gain.value = mtof(m) * 0.006; lfo.connect(lg); lg.connect(o.frequency);
    const n = ctx.createBufferSource(), nf = ctx.createBiquadFilter(), ng = ctx.createGain(); n.buffer = noise(); nf.type = 'bandpass'; nf.frequency.value = mtof(m) * 2; nf.Q.value = 3; ng.gain.value = 0.05;
    n.connect(nf); nf.connect(ng); ng.connect(g);
    o.connect(g); env(g, t, 0.06, vel, 0.1, 0.8, 0.12, t + dur); g.connect(out);
    o.start(t); lfo.start(t); n.start(t); o.stop(t + dur + 0.3); lfo.stop(t + dur + 0.3); n.stop(t + dur + 0.3);
  }
  function drum(out, t, kind, vel) {
    if (kind === 'kick' || kind === 'taiko' || kind === 'tom') {
      const o = ctx.createOscillator(), g = ctx.createGain(), f0 = kind === 'kick' ? 110 : kind === 'taiko' ? 90 : 160, f1 = kind === 'kick' ? 40 : kind === 'taiko' ? 45 : 80;
      o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + 0.25);
      g.gain.setValueAtTime(vel, t); g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'taiko' ? 0.9 : 0.4)); o.connect(g); g.connect(out); o.start(t); o.stop(t + 1);
      if (kind === 'taiko') { const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), ng = ctx.createGain(); n.buffer = noise(); f.type = 'lowpass'; f.frequency.value = 900; ng.gain.setValueAtTime(vel * 0.6, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.15); n.connect(f); f.connect(ng); ng.connect(out); n.start(t); n.stop(t + 0.2); }
      return;
    }
    const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); n.buffer = noise();
    f.type = kind === 'shaker' ? 'highpass' : 'bandpass'; f.frequency.value = kind === 'shaker' ? 6000 : kind === 'frame' ? 420 : 2500; f.Q.value = kind === 'frame' ? 1.5 : 0.8;
    const len = kind === 'shaker' ? 0.05 : kind === 'frame' ? 0.18 : 0.08;
    g.gain.setValueAtTime(vel, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len); n.connect(f); f.connect(g); g.connect(out); n.start(t); n.stop(t + len + 0.02);
  }
  function wind(out, t, dur, vel) { // вітер: шум із повільним фільтром
    const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); n.buffer = noise(); n.loop = true;
    f.type = 'bandpass'; f.Q.value = 0.7; f.frequency.setValueAtTime(400, t); f.frequency.linearRampToValueAtTime(900 + Math.random() * 500, t + dur / 2); f.frequency.linearRampToValueAtTime(350, t + dur);
    env(g, t, dur * 0.4, vel, dur * 0.2, 0.7, dur * 0.4, t + dur * 0.6); n.connect(f); f.connect(g); g.connect(out); n.start(t); n.stop(t + dur + 0.5);
  }
  function strings(out, t, m, dur, vel) { // стакато струнних у бою
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.value = mtof(m);
    f.type = 'lowpass'; f.frequency.setValueAtTime(2400, t); f.frequency.exponentialRampToValueAtTime(700, t + dur); o.connect(f); f.connect(g);
    env(g, t, 0.01, vel, dur * 0.6, 0.3, 0.06, t + dur); g.connect(out); o.start(t); o.stop(t + dur + 0.2);
  }

  /* ---------- теми ---------- */
  // гами від тоніки (півтони)
  const SC = { dorian: [0, 2, 3, 5, 7, 9, 10], major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11], phryg: [0, 1, 3, 5, 7, 8, 10] };
  const deg = (root, scale, d) => root + scale[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  // мелодія: випадкове блукання гамою, фраза повторюється з варіацією (щоб «запамʼятовувалась»)
  function phrase(r, len, start, span) { const out = []; let d = start; for (let i = 0; i < len; i++) { d += [-2, -1, -1, 0, 1, 1, 2][Math.floor(r() * 7)]; d = Math.max(start - span, Math.min(start + span, d)); out.push(r() < 0.18 ? null : d); } return out; }

  const THEMES = {
    tavern: { n: 'Таверна', bpm: 138, beats: 3, sub: 2, root: 50, sc: 'dorian', prog: [0, 0, 6, 6, 3, 3, 4, 4] },
    town: { n: 'Місто', bpm: 96, beats: 4, sub: 2, root: 55, sc: 'major', prog: [0, 3, 4, 0, 5, 3, 4, 4] },
    road: { n: 'Дорога', bpm: 68, beats: 4, sub: 2, root: 52, sc: 'minor', prog: [0, 5, 2, 6] },
    temple: { n: 'Храм', bpm: 56, beats: 4, sub: 2, root: 57, sc: 'minor', prog: [0, 5, 3, 4] },
    dungeon: { n: 'Підземелля', bpm: 50, beats: 4, sub: 2, root: 48, sc: 'phryg', prog: [0, 0, 1, 0] },
    dream: { n: 'Сон', bpm: 64, beats: 4, sub: 2, root: 53, sc: 'lydian', prog: [0, 1, 0, 4] },
    party: { n: 'Гулянка', bpm: 152, beats: 3, sub: 2, root: 58, sc: 'major', prog: [0, 4, 0, 4, 3, 0, 4, 0] },
    battle: { n: 'Бій', bpm: 138, beats: 4, sub: 4, root: 50, sc: 'minor', prog: [0, 0, 5, 6, 0, 0, 3, 4] },
  };

  function makeTrack(id) {
    const T = THEMES[id]; if (!T) return null;
    const gain = ctx.createGain(); gain.gain.value = 0.0001; gain.connect(master);
    const send = ctx.createGain(); send.gain.value = id === 'battle' ? 0.25 : id === 'temple' || id === 'dream' || id === 'dungeon' ? 1 : 0.55; gain.connect(send); send.connect(verbIn);
    const scale = SC[T.sc], stepDur = 60 / T.bpm / T.sub, perBar = T.beats * T.sub;
    const r = rng(id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
    const A = phrase(r, perBar * 2, 7, 4), B = phrase(r, perBar * 2, 9, 4); // дві фрази мелодії
    return { id, gain, stepDur, perBar, T, scale, A, B, step: 0, next: ctx.currentTime + 0.08, alive: true,
      tick(t, i) {
        const bar = Math.floor(i / perBar), pos = i % perBar, chord = T.prog[bar % T.prog.length], beat = pos % T.sub === 0, b = Math.floor(pos / T.sub);
        const root = T.root, ch = (k) => deg(root, scale, chord + k), mel = (bar % 8 < 4 ? this.A : this.B)[(bar % 2) * perBar + pos];
        const out = gain;
        if (id === 'tavern' || id === 'party') { // джига/вальс: бас на 1, акорд на 2-3, мелодія восьмими
          if (pos === 0) pluck(out, t, ch(0) - 12, stepDur * 2.5, 0.32, 1400);
          if (beat && b > 0) { pluck(out, t, ch(0), stepDur * 1.6, 0.11, 2600); pluck(out, t + 0.012, ch(2), stepDur * 1.6, 0.1, 2600); pluck(out, t + 0.024, ch(4), stepDur * 1.6, 0.09, 2600); }
          if (mel != null && (id === 'tavern' || bar % 4 !== 3)) (id === 'party' ? flute : pluck)(out, t, deg(root, scale, mel) + 12, stepDur * (id === 'party' ? 1.8 : 1.1), id === 'party' ? 0.09 : 0.14, 4200);
          if (pos === 0) drum(out, t, 'frame', 0.5); if (pos === perBar - 1) drum(out, t, 'frame', 0.25); if (!beat) drum(out, t, 'shaker', 0.06);
        } else if (id === 'town') {
          if (pos === 0) pad(out, t, ch(0) - 12, stepDur * perBar, 0.035, 900);
          pluck(out, t, ch([0, 2, 4, 2][pos % 4]) + (pos % 4 === 2 ? 12 : 0), stepDur * 1.5, 0.09, 2400);
          if (mel != null && pos % 2 === 0) flute(out, t, deg(root, scale, mel) + 12, stepDur * 1.8, 0.07);
          if (pos % 2 === 1) drum(out, t, 'shaker', 0.05); if (pos === 0) drum(out, t, 'frame', 0.25);
        } else if (id === 'road') {
          if (pos === 0) { pad(out, t, ch(0) - 12, stepDur * perBar, 0.05, 700); pad(out, t, ch(2), stepDur * perBar, 0.025, 900); if (bar % 2 === 0) wind(out, t, stepDur * perBar * 2, 0.06); }
          if (pos % 2 === 0 && r() < 0.7) pluck(out, t, ch([0, 2, 4, 7][(pos / 2) % 4]), stepDur * 3, 0.07, 1800);
        } else if (id === 'temple') {
          if (pos === 0) { choir(out, t, ch(0), stepDur * perBar, 0.05); choir(out, t, ch(2), stepDur * perBar, 0.04); choir(out, t, ch(4) - 12, stepDur * perBar, 0.04); if (bar % 2 === 0) bell(out, t, ch(0) + 12, 0.05, 4); }
        } else if (id === 'dungeon') {
          if (pos === 0) { pad(out, t, root - 12, stepDur * perBar, 0.06, 400); if (bar % 2 === 1) pad(out, t, root - 11, stepDur * perBar, 0.025, 500); }
          if (pos === 0 && bar % 2 === 0) drum(out, t, 'kick', 0.35);
          if (r() < 0.05) bell(out, t, root + 24 + [0, 1, 6][Math.floor(r() * 3)], 0.02, 3);
          if (r() < 0.04) bell(out, t, 96 + Math.floor(r() * 6), 0.012, 0.4); // крапає вода
        } else if (id === 'dream') {
          if (pos === 0) pad(out, t, ch(0), stepDur * perBar, 0.035, 1300);
          if (pos % 2 === 0) bell(out, t, ch([0, 4, 7, 11, 14, 11, 7, 4][(pos / 2) % 8]) + 12, 0.035, 2.2);
        } else if (id === 'battle') { // таіко + стакато + мідь
          if (pos === 0 || pos === 6 || pos === 10) drum(out, t, 'taiko', 0.6);
          if (pos === 4 || pos === 12) drum(out, t, 'tom', 0.35);
          if (pos % 2 === 1) drum(out, t, 'shaker', 0.05);
          strings(out, t, ch(pos % 4 === 3 ? 4 : 0) - 12, stepDur * 0.8, 0.09);
          if (pos === 0) { for (const k of [0, 2, 4]) strings(out, t, ch(k), stepDur * 3, 0.06); }
          if (mel != null && pos % 4 === 0 && bar % 2 === 1) strings(out, t, deg(root, scale, mel) + 12, stepDur * 3, 0.07);
        }
      } };
  }
  function schedule() {
    if (!ctx) return;
    for (const tr of [cur].concat(fading)) {
      if (!tr || !tr.alive) continue;
      while (tr.next < ctx.currentTime + 0.2) { try { tr.tick(tr.next, tr.step); } catch (e) { if (!tr.err) { tr.err = 1; console.warn('music', tr.id, e); } } tr.step++; tr.next += tr.stepDur; }
    }
  }
  let fading = [];
  function play(id, mode) {
    want = { id, mode };
    if (!ctx || ctx.state !== 'running') return; // запуститься після першого дотику
    if (cur && cur.id === id) return;
    const t = ctx.currentTime;
    if (cur) {
      const old = cur, fall = mode === 'cut' ? 0.06 : 2.6;
      old.gain.gain.cancelScheduledValues(t); old.gain.gain.setValueAtTime(Math.max(0.0001, old.gain.gain.value), t); old.gain.gain.exponentialRampToValueAtTime(0.0001, t + fall);
      fading.push(old);
      setTimeout(() => { old.alive = false; try { old.gain.disconnect(); } catch (e) {} fading = fading.filter((x) => x !== old); }, fall * 1000 + 400);
    }
    cur = null;
    if (!id || !THEMES[id]) return;
    const tr = makeTrack(id); if (!tr) return;
    const rise = mode === 'cut' ? 0.03 : 2.6, delay = mode === 'cut' ? 0 : 0.8;
    tr.next = t + delay + 0.02;
    tr.gain.gain.setValueAtTime(0.0001, t + delay); tr.gain.gain.exponentialRampToValueAtTime(VOL, t + delay + rise);
    if (mode === 'cut' && id === 'battle') { drum(tr.gain, t + 0.01, 'taiko', 0.9); strings(tr.gain, t + 0.01, THEMES.battle.root - 12, 0.5, 0.15); } // удар на початку бою
    cur = tr;
  }
  function unlock() {
    if (!init()) return;
    if (ctx.state !== 'running') ctx.resume().then(() => { if (want) { const w = want; want = null; play(w.id, 'fade'); want = w; } }).catch(() => {});
  }
  function setOn(v) { on = !!v; if (master) master.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.2); }
  ['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, unlock, { passive: true }));

  window.DNDMusic = { play, stop: (mode) => play(null, mode), setOn, unlock, THEMES, get current() { return cur && cur.id; } };
})();
