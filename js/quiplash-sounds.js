// ==========================================================================
// Звуки Сміхлиста — синтез через WebAudio, без файлів.
// QuiplashSfx.play("pop" | "tick" | "whoosh" | "ding" | "fanfare" | "wah" |
//                  "chime" | "drum" | "cheer" | "vs" | "buzz")
// Поважає перемикач звуку з налаштувань застосунку (AppSettings.isSoundOn).
// ==========================================================================
(function () {
  let ctx = null;
  let master = null;

  function soundOn() {
    try { return !window.AppSettings || window.AppSettings.isSoundOn(); } catch (e) { return true; }
  }
  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    return ctx;
  }
  // браузери дозволяють звук лише після жесту користувача
  function unlock() {
    const c = ensure();
    if (c && c.state === "suspended") c.resume().catch(() => {});
  }
  ["pointerdown", "touchstart", "keydown"].forEach((ev) => window.addEventListener(ev, unlock, { passive: true }));

  function tone(freq, start, dur, opts) {
    opts = opts || {};
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = opts.type || "sine";
    o.frequency.setValueAtTime(freq, start);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, start + dur);
    const vol = opts.vol == null ? 0.3 : opts.vol;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + Math.min(0.02, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g); g.connect(master);
    o.start(start); o.stop(start + dur + 0.05);
  }
  function noise(start, dur, opts) {
    opts = opts || {};
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = opts.filter || "bandpass";
    f.frequency.setValueAtTime(opts.freq || 1200, start);
    if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, start + dur);
    const g = ctx.createGain();
    const vol = opts.vol == null ? 0.25 : opts.vol;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + Math.min(0.03, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(start); src.stop(start + dur + 0.05);
  }

  const SOUNDS = {
    pop(t) { tone(520, t, 0.09, { to: 980, type: "triangle", vol: 0.35 }); },
    tick(t) { tone(1400, t, 0.05, { type: "square", vol: 0.08 }); },
    tickUrgent(t) { tone(1800, t, 0.07, { type: "square", vol: 0.14 }); },
    whoosh(t) { noise(t, 0.45, { freq: 400, to: 3500, vol: 0.22 }); },
    vs(t) {
      noise(t, 0.35, { freq: 300, to: 2400, vol: 0.2 });
      tone(110, t + 0.3, 0.35, { type: "sawtooth", vol: 0.18, to: 70 });
      noise(t + 0.3, 0.25, { filter: "lowpass", freq: 900, vol: 0.3 });
    },
    ding(t) { tone(1046, t, 0.5, { type: "sine", vol: 0.32 }); tone(1568, t + 0.08, 0.6, { type: "sine", vol: 0.2 }); },
    chime(t) { [523, 659, 784, 1046].forEach((f, i) => tone(f, t + i * 0.09, 0.35, { type: "triangle", vol: 0.22 })); },
    fanfare(t) {
      [[523, 0], [659, 0.12], [784, 0.24], [1046, 0.36]].forEach(([f, d]) => tone(f, t + d, 0.22, { type: "sawtooth", vol: 0.12 }));
      tone(1046, t + 0.5, 0.8, { type: "sawtooth", vol: 0.14 });
      tone(1318, t + 0.5, 0.8, { type: "triangle", vol: 0.12 });
      noise(t + 0.5, 0.9, { filter: "highpass", freq: 5000, vol: 0.08 });
    },
    wah(t) { [392, 370, 349].forEach((f, i) => tone(f, t + i * 0.32, 0.3, { type: "sawtooth", vol: 0.1, to: f * 0.97 })); tone(330, t + 0.96, 0.7, { type: "sawtooth", vol: 0.1, to: 300 }); },
    drum(t) { for (let i = 0; i < 14; i++) noise(t + i * 0.06, 0.05, { filter: "lowpass", freq: 700, vol: 0.12 + i * 0.012 }); noise(t + 0.9, 0.4, { filter: "lowpass", freq: 500, vol: 0.35 }); },
    cheer(t) { noise(t, 1.4, { freq: 1800, vol: 0.12 }); noise(t + 0.1, 1.2, { freq: 3200, vol: 0.08 }); },
    buzz(t) { tone(160, t, 0.35, { type: "square", vol: 0.12 }); },
  };

  function play(name) {
    if (!soundOn() || !SOUNDS[name]) return;
    const c = ensure();
    if (!c) return;
    if (c.state === "suspended") c.resume().catch(() => {});
    try { SOUNDS[name](c.currentTime + 0.01); } catch (e) { /* звук — не критично */ }
  }

  function vibrate(pattern) {
    try { if (window.AppSettings && AppSettings.vibrate) AppSettings.vibrate(pattern); } catch (e) {}
  }

  window.QuiplashSfx = { play, vibrate };
})();
