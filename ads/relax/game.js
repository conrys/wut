/* Релакс: соло-поїздка без мети. Нескінченна дорога з ads/drive, день і ніч, погода, радіо. */
(function () {
  const { Road, Car, Scene, autopilot, clamp } = window.Drive, M = window.RelaxMusic;
  const $ = (id) => document.getElementById(id);
  const load = (k, d) => { try { const v = localStorage.getItem('relax_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem('relax_' + k, JSON.stringify(v)); } catch (e) {} };

  const COLORS = [0xD63A32, 0x2F6FBF, 0xE8E4D8, 0x2FA36B, 0xF2B632, 0x35363C];
  const CAMS = [['cabin', 'Із салону'], ['chase', 'Ззаду'], ['side', 'Узбіччя']];
  const st = { color: load('color', 0), cam: load('cam', 0), radio: load('radio', 0), cruise: load('cruise', 25), steerMode: load('steer', 'slider'), speedMode: load('speed', 'slider'), roadMode: load('road', 'highway'), gearMode: load('gears', 'off'), bodyMode: load('body', 'zhiguli'), fxMode: load('fx', 'on'), btn: 0, auto: false, playing: false, total: load('km', 0), tiltV: 0 };
  const seed = (Math.random() * 1e9) | 0, pad = st.roadMode !== 'highway', road = new Road({ seed, pad }), car = new Car(road, { rail: pad ? 0 : road.half + 5 });
  document.body.classList.toggle('padmode', pad);
  const sc = new Scene({ canvas: $('gl'), road, car, color: COLORS[st.color], body: st.bodyMode, fx: st.fxMode === 'on', time: 0.08 + Math.random() * 0.45 });
  sc.setCam(CAMS[st.cam][0]);

  /* погода іде сама; сніг лише взимку */
  let wxLeft = 0, wxName = 'clear';
  function weather(dt) {
    if (pad) return;
    wxLeft -= dt;
    const b = road.biome(car.s), winter = (b.t > 0.5 ? b.b : b.a) === 4;
    if (winter !== (wxName === 'snow' || wxName === 'wclear')) wxLeft = 0;
    if (wxLeft > 0) return;
    const r = Math.random();
    wxLeft = 70 + Math.random() * 130;
    const n = winter ? (r < 0.6 ? 'snow' : r < 0.85 ? 'clear' : 'fog') : (r < 0.46 ? 'clear' : r < 0.72 ? 'cloudy' : r < 0.9 ? 'rain' : 'fog');
    wxName = winter && n === 'clear' ? 'wclear' : n; sc.setWeather(n);
  }

  const keys = { l: false, r: false, up: false, down: false }, ped = { gas: false, brake: false };
  function hold(el, on, off) {
    const dn = (e) => { e.preventDefault(); on(); el.classList.add('on'); wake(); }, up = () => { off(); el.classList.remove('on'); };
    el.addEventListener('pointerdown', dn); for (const n of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(n, up);
  }
  hold($('left'), () => { keys.l = true; }, () => { keys.l = false; }); hold($('right'), () => { keys.r = true; }, () => { keys.r = false; });
  hold($('gas'), () => { ped.gas = true; }, () => { ped.gas = false; }); hold($('brake'), () => { ped.brake = true; }, () => { ped.brake = false; });
  hold($('hand'), () => { ped.hand = true; }, () => { ped.hand = false; });
  const KEY = { ' ': 'hand', ArrowLeft: 'l', a: 'l', ArrowRight: 'r', d: 'r', ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down' };
  addEventListener('keydown', (e) => { if (KEY[e.key]) keys[KEY[e.key]] = true; });
  addEventListener('keyup', (e) => { if (KEY[e.key]) keys[KEY[e.key]] = false; });

  /* повзунок: value від min до max, тягнеться пальцем незалежно від другого пальця */
  function slider(el, opt) {
    const thumb = el.firstElementChild, S = { value: opt.value, held: false, set(v, fromUser) {
      S.value = clamp(v, opt.min, opt.max); const t = (S.value - opt.min) / (opt.max - opt.min);
      thumb.style[opt.vertical ? 'bottom' : 'left'] = t * 100 + '%'; el.setAttribute('aria-valuenow', Math.round(S.value * 100) / 100);
      if (opt.onset) opt.onset(S.value, thumb, fromUser);
    } };
    const move = (e) => { const r = el.getBoundingClientRect(), t = opt.vertical ? (r.bottom - e.clientY) / r.height : (e.clientX - r.left) / r.width; S.set(opt.min + clamp(t, 0, 1) * (opt.max - opt.min), true); };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); S.held = true; try { el.setPointerCapture(e.pointerId); } catch (x) {} el.focus({ preventScroll: true }); move(e); wake(); });
    el.addEventListener('pointermove', (e) => { if (S.held) { move(e); wake(); } });
    const up = () => { S.held = false; }; el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('keydown', (e) => { const d = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key]; if (d) { e.preventDefault(); e.stopPropagation(); S.set(S.value + d * (opt.max - opt.min) / 20, true); } });
    S.set(opt.value); return S;
  }
  const wheelS = slider($('wheelS'), { min: -1, max: 1, value: 0, onset: (v, th) => { th.firstElementChild.style.transform = `rotate(${v * 120}deg)`; } });
  const speedS = slider($('speedS'), { min: 0, max: 41.7, value: st.cruise, vertical: true, onset: (v, th, user) => { th.textContent = Math.round(v * 3.6 / 5) * 5; if (user) { st.cruise = v; save('cruise', v); } } });

  /* кнопка спрацьовує від дотику, навіть коли інший палець тримає кермо чи газ; click лишається для клавіатури */
  function press(el, fn) {
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
    el.addEventListener('click', (e) => { if (e.detail === 0) fn(); });
  }

  /* інтерфейс ховається, щоб лишилась сама дорога */
  let idle = 0;
  function wake() { idle = 0; document.body.classList.remove('calm'); }
  $('gl').addEventListener('pointerdown', wake);

  function say(t) { const e = $('say'); e.textContent = t; e.classList.remove('show'); void e.offsetWidth; e.classList.add('show'); }
  function radio(i, quiet) {
    st.radio = i; save('radio', i); M.setStation(i);
    $('radio').textContent = i === 4 ? '🎧' : i === 3 ? '🛣' : '📻'; $('radio').setAttribute('aria-label', 'Радіо: ' + M.STATIONS[i].name);
    if (!quiet) say(M.STATIONS[i].name);
  }
  press($('radio'), () => { radio((st.radio + 1) % M.STATIONS.length); wake(); });
  press($('cam'), () => { st.cam = (st.cam + 1) % CAMS.length; save('cam', st.cam); sc.setCam(CAMS[st.cam][0]); say(CAMS[st.cam][1]); wake(); });
  function setAuto(on) { st.auto = on; $('auto').classList.toggle('active', on); $('auto').setAttribute('aria-pressed', on); document.body.classList.toggle('autopilot', on); layout(); }
  press($('auto'), () => { setAuto(!st.auto); say(st.auto ? 'Автопілот' : 'Кермо твоє'); wake(); });

  /* нахил телефона */
  function onTilt(e) {
    const land = Math.abs(window.orientation || 0) === 90 || innerWidth > innerHeight, raw = land ? (e.beta || 0) * (window.orientation === -90 ? -1 : 1) : (e.gamma || 0);
    st.tiltV = clamp(raw / 32, -1, 1);
  }
  async function tilt(on) {
    if (on && window.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission) { try { if (await DeviceOrientationEvent.requestPermission() !== 'granted') on = false; } catch (e) { on = false; } }
    if (on && !window.DeviceOrientationEvent) on = false;
    st.tiltV = 0; st.tiltS = 0; removeEventListener('deviceorientation', onTilt); if (on) addEventListener('deviceorientation', onTilt);
    return on;
  }
  function layout() {
    document.body.dataset.steer = st.steerMode; document.body.dataset.speed = st.speedMode; document.body.dataset.gears = st.gearMode; car.manual = st.gearMode === 'manual' && !st.auto;
    for (const b of document.querySelectorAll('[data-set]')) { const on = st[b.dataset.set] === b.dataset.val; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }
  }
  for (const b of document.querySelectorAll('[data-set]')) b.addEventListener('click', async () => {
    const key = b.dataset.set, v = b.dataset.val;
    if (key === 'roadMode') { if (v !== st.roadMode) { save('road', v); location.reload(); } return; }
    if (v === 'tilt' && !(await tilt(true))) { say('Нахил недоступний на цьому пристрої'); return; }
    if (key === 'steerMode' && v !== 'tilt') tilt(false);
    st[key] = v; save({ steerMode: 'steer', speedMode: 'speed', gearMode: 'gears', bodyMode: 'body', fxMode: 'fx' }[key], v);
    if (key === 'bodyMode') sc.setBody(v); if (key === 'fxMode') sc.fxOn = v === 'on'; layout();
  });
  layout();

  function shift(d) { car.gear = clamp(car.gear + d, 1, 5); wake(); }
  press($('gUp'), () => shift(1)); press($('gDn'), () => shift(-1));
  addEventListener('keydown', (e) => { if (e.key === 'e') shift(1); if (e.key === 'q') shift(-1); });

  /* плавне кермо: кнопки набирають поворот поступово, повзунок і нахил точніші біля центру */
  const curve = (v) => { const a = Math.abs(v); return a < 0.03 ? 0 : Math.sign(v) * Math.pow(a, 1.3); };
  function steerHand(dt) {
    const want = (keys.r ? 1 : 0) - (keys.l ? 1 : 0); let hand;
    const rate = want && want * st.btn >= 0 ? 1.8 : 4.5; /* натиснув — кермо крутиться ~0,55 с; відпустив — вертається швидше */
    st.btn += clamp(want - st.btn, -rate * dt, rate * dt); hand = st.btn;
    if (st.steerMode === 'slider') { if (!wheelS.held && wheelS.value) { const v = wheelS.value; wheelS.set(v - Math.sign(v) * Math.min(Math.abs(v), dt * 0.9)); } hand += curve(wheelS.value); }
    if (st.steerMode === 'tilt') { st.tiltS += (st.tiltV - st.tiltS) * Math.min(1, dt * 7); hand += curve(st.tiltS); }
    return clamp(hand, -1, 1);
  }
  function speedInput(ap) {
    if (st.speedMode === 'pedals') { const g = ped.gas || keys.up, b = ped.brake || keys.down; return { gas: g ? 1 : 0, brake: b ? 1 : (g ? 0 : 0.04) }; }
    if (keys.up || keys.down) speedS.set(st.cruise = clamp(st.cruise + ((keys.up ? 1 : 0) - (keys.down ? 1 : 0)) * 0.2, 0, 41.7));
    const dv = st.cruise - car.speed;
    return { gas: dv > 0 ? clamp(dv / 3 + 0.2, 0, 1) : 0, brake: dv < -0.5 ? clamp(-dv / 8, 0, 0.7) : 0 };
  }

  /* меню */
  const sw = $('colors');
  COLORS.forEach((c, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'dot'; b.style.background = '#' + c.toString(16).padStart(6, '0'); b.setAttribute('aria-label', 'Колір авто ' + (i + 1));
    b.addEventListener('click', () => { st.color = i; save('color', i); sc.setColor(COLORS[i]); paint(); }); sw.appendChild(b);
  });
  function paint() { [...sw.children].forEach((b, i) => b.classList.toggle('on', i === st.color)); }
  paint();
  $('kmTotal').textContent = st.total >= 1 ? `Уже проїхано: ${Math.round(st.total)} км` : '';
  let lock = null;
  async function keepAwake() { try { lock = await navigator.wakeLock.request('screen'); } catch (e) {} }
  function start(auto) {
    $('menu').hidden = true; $('hud').hidden = false; st.playing = true; setAuto(auto); radio(st.radio, true); if (st.steerMode === 'tilt') tilt(true); keepAwake(); wake();
    say(auto ? 'Автопілот' : M.STATIONS[st.radio].name);
  }
  $('go').addEventListener('click', () => start(false)); $('watch').addEventListener('click', () => start(true));
  $('menuBtn').addEventListener('click', () => { st.playing = false; M.pause(true); $('menu').hidden = false; $('hud').hidden = true; $('go').textContent = 'Далі'; M.pause(true); });
  document.addEventListener('visibilitychange', () => { const h = document.hidden; if (st.playing) M.pause(h); if (!h && st.playing) keepAwake(); });

  let savedKm = 0, frames = 0, bumpWas = 0;
  window.G3.loop((dt) => {
    let inp = { steer: 0, gas: 0, brake: 0 };
    if (st.playing) {
      const ap = autopilot(road, car, st.speedMode === 'slider' ? st.cruise : 25), hand = steerHand(dt);
      if (st.auto) inp = hand ? { ...ap, steer: hand } : ap;
      else { const sp = speedInput(ap), keep = 0.3 * (1 - Math.min(1, Math.abs(hand) * 3)); inp = { steer: hand + (pad || ped.hand || keys.hand ? 0 : ap.steer * keep), gas: sp.gas, brake: sp.brake, hand: ped.hand || keys.hand }; }
    } else inp = autopilot(road, car, 16);
    car.gripMul = 1 - 0.22 * sc.wx.rain - 0.42 * sc.wx.snow;
    car.step(dt, inp); weather(dt); sc.update(dt);
    if (car.bump > bumpWas + 0.5) { M.thud(); try { navigator.vibrate && navigator.vibrate(25); } catch (e) {} } bumpWas = car.bump;
    if (st.playing) {
      idle += dt; if (idle > 6) document.body.classList.add('calm');
      $('speed').textContent = Math.round(car.speed * 3.6); $('km').textContent = (car.dist / 1000).toFixed(1);
      M.drive(car.speed, sc.wx.rain, car.rpm, car.rumble, car.slip); $('gearV').textContent = car.gear;
      if (car.dist - savedKm > 500) { st.total += (car.dist - savedKm) / 1000; savedKm = car.dist; save('km', st.total); }
    }
    frames++;
  });
  window.RELAX = { car, road, sc, st, start, wheelS, speedS, get frames() { return frames; } };
})();
