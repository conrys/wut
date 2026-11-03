/* Релакс: радіо, яке синтезується на телефоні (без файлів і ліцензій), плюс звук дороги.
   Станція «Своя музика» взагалі не створює AudioContext, щоб не перебивати інший застосунок. */
(function () {
  const STATIONS = [
    { id: 'sunset', name: 'Захід', bpm: 72, chords: [[53, 57, 60, 64], [57, 60, 64, 67], [50, 53, 57, 60], [48, 52, 55, 59]], lead: [72, 74, 76, 79, 81] },
    { id: 'night', name: 'Нічна траса', bpm: 92, chords: [[45, 52, 57, 60], [41, 48, 53, 57], [48, 55, 60, 64], [43, 50, 55, 59]], lead: [69, 72, 76, 79, 84] },
    { id: 'steppe', name: 'Степ', bpm: 64, chords: [[50, 57, 62, 66], [55, 59, 62, 67], [47, 54, 59, 62], [52, 59, 62, 67]], lead: [74, 76, 78, 81, 83] },
    { id: 'road', name: 'Лише дорога', road: true },
    { id: 'own', name: 'Своя музика', off: true },
  ];
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  let AC = null, master, music, roadG, rainG, tyreG, rumbleG, engine, eng2, engG, engF, delay, noiseBuf, timer = 0, next = 0, step = 0, cur = null;

  function init() {
    if (AC) return true;
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return false; }
    master = AC.createDynamicsCompressor(); master.connect(AC.destination);
    music = AC.createGain(); music.gain.value = 0.5; music.connect(master);
    delay = AC.createDelay(1.2); delay.delayTime.value = 0.42; const fb = AC.createGain(); fb.gain.value = 0.38; const f = AC.createBiquadFilter(); f.frequency.value = 1500;
    delay.connect(fb); fb.connect(f); f.connect(delay); delay.connect(music);
    const n = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate), d = n.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = (freq, type) => { const s = AC.createBufferSource(); s.buffer = n; s.loop = true; const fl = AC.createBiquadFilter(); fl.type = type; fl.frequency.value = freq; const g = AC.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(master); s.start(); return g; };
    noiseBuf = n; roadG = noise(420, 'lowpass'); rainG = noise(2600, 'highpass'); tyreG = noise(1500, 'bandpass'); rumbleG = noise(110, 'lowpass');
    engine = AC.createOscillator(); engine.type = 'sawtooth'; eng2 = AC.createOscillator(); eng2.type = 'square'; eng2.connect(engF0()); engF = AC.createBiquadFilter(); engF.frequency.value = 240; engG = AC.createGain(); engG.gain.value = 0;
    engine.connect(engF); engF0().connect(engF); engF.connect(engG); engG.connect(master); engine.start(); eng2.start();
    return true;
  }
  function note(t, m, len, type, vol, wet) {
    const o = AC.createOscillator(), g = AC.createGain(), f = AC.createBiquadFilter(); o.type = type; o.frequency.value = hz(m); f.frequency.value = 1400;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + Math.min(0.6, len * 0.3)); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(f); f.connect(g); g.connect(music); if (wet) g.connect(delay); o.start(t); o.stop(t + len + 0.05);
  }
  function sched() {
    if (!cur || !cur.bpm) return;
    const beat = 60 / cur.bpm;
    while (next < AC.currentTime + 0.5) {
      const bar = Math.floor(step / 16), ch = cur.chords[bar % cur.chords.length], pos = step % 16;
      if (pos === 0) { for (const m of ch) note(next, m, beat * 4.2, 'triangle', 0.075, true); note(next, ch[0] - 12, beat * 3.6, 'sine', 0.2, false); }
      if (pos === 8) note(next, ch[0] - 12, beat * 2.6, 'sine', 0.13, false);
      if (cur.id === 'night' && pos % 2 === 0) note(next, ch[(pos / 2) % 4] + 12, beat * 0.9, 'square', 0.022, true);
      if (Math.random() < (cur.id === 'night' ? 0.1 : 0.16) && pos % 2 === 0) note(next, cur.lead[Math.floor(Math.random() * cur.lead.length)], beat * 2.4, 'sine', 0.06, true);
      next += beat / 4; step++;
    }
  }
  function setStation(i) {
    cur = STATIONS[i];
    if (cur.off) { if (AC) { clearInterval(timer); AC.close(); AC = null; e2g = null; } return; }
    if (!init()) return; if (AC.state === 'suspended') AC.resume();
    clearInterval(timer); step = 0; next = AC.currentTime + 0.1;
    if (cur.bpm) timer = setInterval(sched, 180);
  }
  let e2g = null; function engF0() { if (!e2g) { e2g = AC.createGain(); e2g.gain.value = 0.3; } return e2g; }
  function thud() {
    if (!AC) return; const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain(); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.2);
    g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.26); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.3);
  }
  function drive(speed, rain, rpm, rumble, slip) {
    if (!AC) return;
    const t = AC.currentTime, v = Math.min(1, speed / 40), q = cur && cur.road ? 1 : 0.42;
    roadG.gain.setTargetAtTime(v * 0.13 * q, t, 0.3); rainG.gain.setTargetAtTime(rain * 0.05, t, 0.8);
    const f = 38 + rpm * 118; engine.frequency.setTargetAtTime(f, t, 0.08); eng2.frequency.setTargetAtTime(f * 0.5, t, 0.08); engF.frequency.setTargetAtTime(170 + rpm * 520, t, 0.1); engG.gain.setTargetAtTime((0.02 + rpm * 0.035) * q, t, 0.15);
    tyreG.gain.setTargetAtTime(Math.min(0.09, v * v * 0.05 + slip * 0.03) * q, t, 0.2); rumbleG.gain.setTargetAtTime(rumble * 0.5, t, 0.06);
  }
  function pause(on) { if (AC) { if (on) AC.suspend(); else AC.resume(); } }
  window.RelaxMusic = { STATIONS, setStation, drive, thud, pause, get active() { return !!AC; } };
})();
