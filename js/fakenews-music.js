// ==========================================================================
// Фонова музика Fake News — синтез через WebAudio, без файлів.
// Спокійний lo-fi «студія новин»: електропіаніно-акорди, м'який бас,
// тихе «тікання редакції» вісімками, зрідка дзвіночок-мотив. Без бочки,
// приглушена фільтром — щоб не заважала читати й говорити.
//
//   FakeNewsMusic.start()          — після жесту користувача (кнопка «Увімкнути звук»)
//   FakeNewsMusic.setMood(m)       — "lobby" | "write" | "vote" | "show" | "reveal" | "summary" | "off"
//                                    (гучність під фазу: на показі/результаті притихає)
//   FakeNewsMusic.toggle()         — увімк/вимк (запам'ятовується в localStorage)
//   FakeNewsMusic.isOn()
//   FakeNewsMusic.render(ctx, out, seconds) — для офлайн-прослуховування (OfflineAudioContext)
//
// Поважає перемикач звуку застосунку (AppSettings.isSoundOn), якщо він підключений.
// ==========================================================================
(function () {
  const BPM = 84;
  const BEAT = 60 / BPM, BAR = BEAT * 4;
  const STORE = "fakenews_music_on";
  const MOOD_GAIN = { lobby: 0.8, write: 1, vote: 0.9, show: 0.4, reveal: 0.3, summary: 0.55, off: 0 };
  const VOLUME = 0.16;

  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
  // Фа мажор. Акорд: бас (MIDI) + голоси (MIDI, середній регістр, плавне голосоведення)
  const CH = {
    Fmaj9:  { b: 41, v: [57, 60, 64, 67] },     // A C E G
    Dm9:    { b: 38, v: [57, 60, 64, 65] },     // A C E F
    Gm9:    { b: 43, v: [57, 58, 62, 65] },     // A Bb D F
    C9sus:  { b: 36, v: [58, 62, 64, 67] },     // Bb D E G
    C7:     { b: 36, v: [58, 60, 64, 67] },     // Bb C E G
    Bbmaj7: { b: 46, v: [57, 58, 62, 65] },     // A Bb D F
    Am7:    { b: 45, v: [55, 60, 64, 67] },     // G C E G
    Dm7:    { b: 38, v: [57, 60, 62, 65] },     // A C D F
    Ebmaj7: { b: 39, v: [55, 58, 62, 63] },     // G Bb D Eb — «газетний» поворот
  };
  // фрази по 4 такти; чергуються, щоб петля не набридала
  const PHRASES = [
    ["Fmaj9", "Dm9", "Gm9", "C9sus"],
    ["Bbmaj7", "Am7", "Gm9", "C7"],
    ["Fmaj9", "Dm7", "Bbmaj7", "C9sus"],
    ["Dm9", "Ebmaj7", "Gm9", "C7"],
  ];
  const PENTA = [65, 67, 69, 72, 74, 77, 79]; // F G A C D F G — мелодія завжди «вписується»

  // ---------------- інструменти ----------------
  function keys(ctx, out, t, freq, dur, vol) {          // електропіаніно: тон + «язичок» другої гармоніки
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(vol * 0.35, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(out);
    const o1 = ctx.createOscillator(); o1.type = "sine"; o1.frequency.value = freq; o1.detune.value = (Math.random() - 0.5) * 6;
    const o2 = ctx.createOscillator(); o2.type = "sine"; o2.frequency.value = freq * 2;
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.35, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o1.connect(g); o2.connect(g2); g2.connect(g);
    o1.start(t); o2.start(t); o1.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }
  function bass(ctx, out, t, freq, dur, vol) {
    const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.value = freq;
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 380;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
    g.gain.exponentialRampToValueAtTime(vol * 0.5, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }
  let noiseBuf = null;
  function tick(ctx, out, t, vol, bright) {               // тихе «тікання» — як годинник у студії
    if (!noiseBuf || noiseBuf.sampleRate !== ctx.sampleRate) {
      noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.08), ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = bright ? 5200 : 3800; f.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t); s.stop(t + 0.06);
  }
  function bell(ctx, out, t, freq, vol) {
    const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = "sine"; o2.frequency.value = freq * 3.01;
    const g = ctx.createGain(), g2 = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    g2.gain.setValueAtTime(vol * 0.25, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g); o2.connect(g2); g.connect(out); g2.connect(out);
    o.start(t); o2.start(t); o.stop(t + 1.7); o2.stop(t + 0.5);
  }

  // ---------------- такт ----------------
  // bar — порядковий номер такту з початку; rnd — генератор випадковості
  function scheduleBar(ctx, bus, t0, bar, rnd) {
    const phraseNo = Math.floor(bar / 4);
    const phrase = PHRASES[(phraseNo * 3 + (phraseNo > 3 ? 1 : 0)) % PHRASES.length];
    const ch = CH[phrase[bar % 4]];
    const sw = BEAT * 0.08;                               // легкий свінг вісімок

    // акорд: удар на «раз» (розкладений на кілька мс — як живими пальцями) + тихий повтор на «і-два»
    ch.v.forEach((n, i) => keys(ctx, bus.keys, t0 + i * 0.012, midi(n), BAR * 0.95, 0.07));
    if (rnd() < 0.7) ch.v.slice(1).forEach((n, i) => keys(ctx, bus.keys, t0 + BEAT * 1.5 + sw + i * 0.01, midi(n), BEAT * 2.2, 0.035));

    // бас: тоніка на «раз», інколи квінта/октава на «три»
    bass(ctx, bus.main, t0, midi(ch.b), BEAT * 1.8, 0.22);
    const r = rnd();
    if (r < 0.45) bass(ctx, bus.main, t0 + BEAT * 2, midi(ch.b + 7), BEAT * 1.2, 0.16);
    else if (r < 0.7) bass(ctx, bus.main, t0 + BEAT * 2.5 + sw, midi(ch.b + 12), BEAT * 0.8, 0.12);

    // тікання вісімками; акцент на долях, у кінці фрази — коротка «телетайпна» шістнадцятка
    for (let i = 0; i < 8; i++) {
      const t = t0 + i * BEAT / 2 + (i % 2 ? sw : 0);
      tick(ctx, bus.main, t, i % 2 ? 0.018 : 0.03, i === 0);
    }
    if (bar % 4 === 3) for (let i = 0; i < 3; i++) tick(ctx, bus.main, t0 + BEAT * 3.25 + i * BEAT / 4, 0.014, true);

    // мелодія — рідко і тихо, 2–3 ноти, з пентатоніки
    if (bar % 2 === 1 && rnd() < 0.6) {
      let idx = Math.floor(rnd() * PENTA.length);
      const notes = 2 + (rnd() < 0.4 ? 1 : 0);
      for (let i = 0; i < notes; i++) {
        bell(ctx, bus.keys, t0 + BEAT * (0.5 + i * 1.0) + (i % 2 ? sw : 0), midi(PENTA[idx]), 0.05);
        idx = Math.max(0, Math.min(PENTA.length - 1, idx + (rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(rnd() * 2))));
      }
    }
  }

  // спільна обробка: приглушення верхів, трохи «простору» (затримка), загальна гучність
  function buildBus(ctx, dest) {
    const out = ctx.createGain(); out.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2400; lp.Q.value = 0.5;
    const main = ctx.createGain();
    const keysIn = ctx.createGain();
    const delay = ctx.createDelay(1); delay.delayTime.value = BEAT * 0.75;
    const fb = ctx.createGain(); fb.gain.value = 0.28;
    const wet = ctx.createGain(); wet.gain.value = 0.22;
    keysIn.connect(main);
    keysIn.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(main);
    main.connect(lp); lp.connect(out); out.connect(dest);
    return { out, main, keys: keysIn };
  }
  function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

  // ---------------- живий програвач ----------------
  let ctx = null, bus = null, timer = null, nextBar = 0, nextTime = 0, mood = "lobby", started = false;
  const rnd = Math.random;

  function soundOn() { try { return !window.AppSettings || window.AppSettings.isSoundOn(); } catch (e) { return true; } }
  function wanted() { try { return localStorage.getItem(STORE) !== "0"; } catch (e) { return true; } }
  function target() { return started && wanted() && soundOn() ? VOLUME * (MOOD_GAIN[mood] == null ? 1 : MOOD_GAIN[mood]) : 0; }
  function applyGain(sec) {
    if (!bus) return;
    const g = bus.out.gain, t = ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(target(), t + (sec == null ? 1.5 : sec));
  }
  function pump() {
    if (!ctx) return;
    if (target() === 0 && bus.out.gain.value < 0.001) { nextTime = Math.max(nextTime, ctx.currentTime + 0.1); return; } // тиша — не плануємо зайвого
    while (nextTime < ctx.currentTime + 1.2) {
      if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.05;
      scheduleBar(ctx, bus, nextTime, nextBar++, rnd);
      nextTime += BAR;
    }
  }
  function start() {
    started = true;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      bus = buildBus(ctx, ctx.destination);
      nextTime = ctx.currentTime + 0.2;
      timer = setInterval(pump, 200);
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    pump();
    applyGain(3);                                          // плавний вхід
  }
  function setMood(m) { if (m === mood) return; mood = m; applyGain(m === "reveal" || m === "show" ? 0.6 : 2); }
  function toggle() { const on = !wanted(); try { localStorage.setItem(STORE, on ? "1" : "0"); } catch (e) {} if (on && !ctx) start(); else applyGain(0.8); return on; }
  document.addEventListener("appsettingschange", () => applyGain(0.5));

  // офлайн-рендер для прослуховування: ctx — OfflineAudioContext
  function render(octx, dest, seconds) {
    const b = buildBus(octx, dest || octx.destination);
    b.out.gain.setValueAtTime(0, 0); b.out.gain.linearRampToValueAtTime(VOLUME, 2.5);
    const r = seeded(7);
    for (let i = 0, t = 0.1; t < seconds; i++, t += BAR) scheduleBar(octx, b, t, i, r);
  }

  window.FakeNewsMusic = { start, setMood, toggle, isOn: wanted, render, BAR };
})();
