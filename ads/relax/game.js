/* Релакс: соло-поїздка без мети. Нескінченна дорога з ads/drive, день і ніч, погода, радіо. */
(function () {
  const { Road, Car, Scene, autopilot, clamp } = window.Drive, M = window.RelaxMusic;
  const $ = (id) => document.getElementById(id);
  const load = (k, d) => { try { const v = localStorage.getItem('relax_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem('relax_' + k, JSON.stringify(v)); } catch (e) {} };

  const COLORS = [0xD63A32, 0x2F6FBF, 0xE8E4D8, 0x2FA36B, 0xF2B632, 0x35363C];
  const CAMS = [['cabin', 'Із салону'], ['chase', 'Ззаду'], ['side', 'Узбіччя']];
  const st = { color: load('color', 0), cam: load('cam', 0), radio: load('radio', 0), cruise: load('cruise', 25), tilt: false, auto: false, playing: false, total: load('km', 0), tiltV: 0 };
  const seed = (Math.random() * 1e9) | 0, road = new Road({ seed }), car = new Car(road, { rail: road.half + 5 });
  const sc = new Scene({ canvas: $('gl'), road, car, color: COLORS[st.color], time: 0.08 + Math.random() * 0.45 });
  sc.setCam(CAMS[st.cam][0]);

  /* погода іде сама; сніг лише взимку */
  let wxLeft = 0, wxName = 'clear';
  function weather(dt) {
    wxLeft -= dt;
    const b = road.biome(car.s), winter = (b.t > 0.5 ? b.b : b.a) === 4;
    if (winter !== (wxName === 'snow' || wxName === 'wclear')) wxLeft = 0;
    if (wxLeft > 0) return;
    const r = Math.random();
    wxLeft = 70 + Math.random() * 130;
    const n = winter ? (r < 0.6 ? 'snow' : r < 0.85 ? 'clear' : 'fog') : (r < 0.46 ? 'clear' : r < 0.72 ? 'cloudy' : r < 0.9 ? 'rain' : 'fog');
    wxName = winter && n === 'clear' ? 'wclear' : n; sc.setWeather(n);
  }

  const keys = { l: false, r: false };
  function bindPad(el, k) {
    const on = (e) => { e.preventDefault(); keys[k] = true; el.classList.add('on'); wake(); }, off = () => { keys[k] = false; el.classList.remove('on'); };
    el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
  }
  bindPad($('left'), 'l'); bindPad($('right'), 'r');
  addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a') keys.l = true; if (e.key === 'ArrowRight' || e.key === 'd') keys.r = true;
    if (e.key === 'ArrowUp') cruise(1); if (e.key === 'ArrowDown') cruise(-1);
  });
  addEventListener('keyup', (e) => { if (e.key === 'ArrowLeft' || e.key === 'a') keys.l = false; if (e.key === 'ArrowRight' || e.key === 'd') keys.r = false; });

  function cruise(d) { st.cruise = clamp(st.cruise + d * 2.78, 11.1, 33.4); save('cruise', st.cruise); $('cruiseV').textContent = Math.round(st.cruise * 3.6 / 10) * 10; wake(); }
  $('slower').addEventListener('click', () => cruise(-1)); $('faster').addEventListener('click', () => cruise(1));

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
  $('radio').addEventListener('click', () => { radio((st.radio + 1) % M.STATIONS.length); wake(); });
  $('cam').addEventListener('click', () => { st.cam = (st.cam + 1) % CAMS.length; save('cam', st.cam); sc.setCam(CAMS[st.cam][0]); say(CAMS[st.cam][1]); wake(); });
  function setAuto(on) { st.auto = on; $('auto').classList.toggle('active', on); $('auto').setAttribute('aria-pressed', on); document.body.classList.toggle('autopilot', on); }
  $('auto').addEventListener('click', () => { setAuto(!st.auto); say(st.auto ? 'Автопілот' : 'Кермо твоє'); wake(); });

  /* нахил телефона */
  function onTilt(e) {
    const land = Math.abs(window.orientation || 0) === 90 || innerWidth > innerHeight, raw = land ? (e.beta || 0) * (window.orientation === -90 ? -1 : 1) : (e.gamma || 0);
    st.tiltV = clamp(raw / 24, -1, 1);
  }
  async function tilt(on) {
    if (on && window.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission) { try { if (await DeviceOrientationEvent.requestPermission() !== 'granted') on = false; } catch (e) { on = false; } }
    if (on && !window.DeviceOrientationEvent) on = false;
    st.tilt = on; st.tiltV = 0; removeEventListener('deviceorientation', onTilt); if (on) addEventListener('deviceorientation', onTilt);
    $('tilt').classList.toggle('active', on); $('tilt').setAttribute('aria-pressed', on); document.body.classList.toggle('tilting', on); say(on ? 'Кермо нахилом' : 'Кермо кнопками');
  }
  $('tilt').addEventListener('click', () => { tilt(!st.tilt); wake(); });

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
    $('menu').hidden = true; $('hud').hidden = false; st.playing = true; setAuto(auto); radio(st.radio, true); $('cruiseV').textContent = Math.round(st.cruise * 3.6 / 10) * 10; keepAwake(); wake();
    say(auto ? 'Автопілот' : M.STATIONS[st.radio].name);
  }
  $('go').addEventListener('click', () => start(false)); $('watch').addEventListener('click', () => start(true));
  $('menuBtn').addEventListener('click', () => { st.playing = false; M.pause(true); $('menu').hidden = false; $('hud').hidden = true; $('go').textContent = 'Далі'; M.pause(true); });
  document.addEventListener('visibilitychange', () => { const h = document.hidden; if (st.playing) M.pause(h); if (!h && st.playing) keepAwake(); });

  let savedKm = 0, frames = 0;
  window.G3.loop((dt) => {
    let inp = { steer: 0, gas: 0, brake: 0 };
    if (st.playing) {
      const ap = autopilot(road, car, st.cruise), hand = (keys.r ? 1 : 0) - (keys.l ? 1 : 0) + (st.tilt ? st.tiltV : 0);
      /* без автопілота газ лишається круїзний, а кермо легко тримає смугу */
      if (st.auto && !hand) inp = ap;
      else { const lim = Math.min(1, Math.abs(hand)); inp = { steer: hand ? clamp(hand, -1, 1) : ap.steer * 0.3, gas: ap.gas, brake: ap.brake }; if (st.auto && lim) inp.steer = hand; }
    } else inp = autopilot(road, car, 16);
    car.step(dt, inp); weather(dt); sc.update(dt);
    if (st.playing) {
      idle += dt; if (idle > 6) document.body.classList.add('calm');
      $('speed').textContent = Math.round(car.speed * 3.6); $('km').textContent = (car.dist / 1000).toFixed(1);
      M.drive(car.speed, sc.wx.rain);
      if (car.dist - savedKm > 500) { st.total += (car.dist - savedKm) / 1000; savedKm = car.dist; save('km', st.total); }
    }
    frames++;
  });
  window.RELAX = { car, road, sc, st, start, get frames() { return frames; } };
})();
