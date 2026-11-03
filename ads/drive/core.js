/* Спільний рушій водіння (Релакс, далі Раллі): дорога й фізика авто без екрана.
   Осі: y вгору, вперед = (sin h, cos h) у площині x/z, праворуч = (-cos h, sin h).
   h росте при повороті ліворуч; кривизна k > 0 — лівий поворот. */
(function (root) {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const rng = (s) => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

  /* Плавний шум по площині для рельєфу */
  function noise(x, z) {
    const h = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
    const ix = Math.floor(x), iz = Math.floor(z), fx = smooth(x - ix), fz = smooth(z - iz);
    return lerp(lerp(h(ix, iz), h(ix + 1, iz), fx), lerp(h(ix, iz + 1), h(ix + 1, iz + 1), fx), fz) * 2 - 1;
  }

  const BIOME = { FOREST: 0, FIELD: 1, AUTUMN: 2, VILLAGE: 3, WINTER: 4 };

  /* Нескінченна дорога: точки через кожні step метрів, генеруються на вимогу */
  class Road {
    constructor(opt = {}) {
      this.step = 4;
      this.half = opt.half || 3.5;
      this.kMax = opt.kMax || 1 / 95;
      this.hill = opt.hill == null ? 1 : opt.hill;
      this.r = rng(opt.seed || 1);
      this.pts = [{ s: 0, x: 0, z: 0, h: 0, k: 0, y: 0 }];
      this.segLeft = 90; this.kT = 0;
      this.p = [this.r() * 6, this.r() * 6, this.r() * 6];
      this.zones = []; this.zoneEnd = 0;
      this.addZone(opt.startBiome == null ? BIOME.FOREST : opt.startBiome);
    }
    addZone(id) {
      const len = 1000 + this.r() * 1000;
      this.zones.push({ id, a: this.zoneEnd, b: this.zoneEnd + len });
      this.zoneEnd += len;
    }
    /* біом у точці s: {a, b, t} — плавний перехід на останніх 180 м зони */
    biome(s) {
      while (s + 400 > this.zoneEnd) {
        const last = this.zones[this.zones.length - 1].id;
        let id; do { id = Math.floor(this.r() * 5); } while (id === last);
        this.addZone(id);
      }
      let lo = 0, hi = this.zones.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (this.zones[m].b <= s) lo = m + 1; else hi = m; }
      const z = this.zones[lo], nx = this.zones[lo + 1];
      const t = nx ? smooth((s - (z.b - 180)) / 180) : 0;
      return { a: z.id, b: nx ? nx.id : z.id, t };
    }
    elev(s) {
      const p = this.p, H = this.hill;
      return H * (9 * Math.sin(s / 340 + p[0]) + 3.5 * Math.sin(s / 137 + p[1]) + 1.1 * Math.sin(s / 61 + p[2]));
    }
    ensure(i) {
      const P = this.pts, d = this.step;
      while (P.length <= i) {
        const q = P[P.length - 1];
        if (this.segLeft <= 0) {
          this.segLeft = 70 + this.r() * 240;
          const mag = this.r() < 0.22 ? 0 : this.kMax * (0.3 + this.r() * 0.7);
          let sign = this.r() < 0.5 ? -1 : 1;
          if (Math.abs(q.h) > 0.6) sign = q.h > 0 ? -1 : 1;
          this.kT = mag * sign;
        }
        /* дорога не закручується в петлю і не перетинає сама себе */
        if (Math.abs(q.h) > 0.8 && q.h * this.kT >= 0) { this.kT = -Math.sign(q.h) * this.kMax * 0.7; this.segLeft = Math.max(this.segLeft, 90); }
        this.segLeft -= d;
        const k = q.k + (this.kT - q.k) * Math.min(1, d / 36);
        const h = q.h + k * d, s = q.s + d;
        P.push({ s, k, h, x: q.x + Math.sin(h) * d, z: q.z + Math.cos(h) * d, y: this.elev(s) });
      }
      return P[i];
    }
    /* Точка на осі дороги в дистанції s */
    at(s) {
      s = Math.max(0, s);
      const f = s / this.step, i = Math.floor(f), t = f - i;
      const a = this.ensure(i), b = this.ensure(i + 1);
      return { s, x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t), y: lerp(a.y, b.y, t), h: lerp(a.h, b.h, t), k: lerp(a.k, b.k, t) };
    }
    /* Позиція авто відносно дороги: s і зміщення (праворуч +) */
    locate(x, z, hint = 0) {
      const c = Math.max(0, Math.floor(hint / this.step));
      let best = c, bd = Infinity;
      for (let i = Math.max(0, c - 8); i <= c + 14; i++) {
        const p = this.ensure(i), dd = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (dd < bd) { bd = dd; best = i; }
      }
      const p = this.ensure(best), fx = Math.sin(p.h), fz = Math.cos(p.h), dx = x - p.x, dz = z - p.z;
      const along = dx * fx + dz * fz;
      return { s: Math.max(0, p.s + along), off: -dx * Math.cos(p.h) + dz * Math.sin(p.h) };
    }
  }

  const SURF = { asphalt: { grip: 9, drag: 0.012 }, gravel: { grip: 4.6, drag: 0.03 }, grass: { grip: 3, drag: 0.5 } };

  /* Аркадне авто. Кермо: +1 праворуч */
  class Car {
    constructor(road, opt = {}) {
      this.road = road;
      const lane = opt.lane == null ? 1.75 : opt.lane, p = road.at(opt.s || 8);
      this.x = p.x - Math.cos(p.h) * lane; this.z = p.z + Math.sin(p.h) * lane; this.y = p.y;
      this.yaw = p.h; this.vx = 0; this.vz = 0; this.steer = 0; this.spin = 0; this.pitch = 0; this.roll = 0;
      this.s = p.s; this.off = lane; this.dist = 0; this.vmax = opt.vmax || 42; this.accel = opt.accel || 6;
      this.surface = opt.surface || 'asphalt'; this.rail = opt.rail == null ? road.half + 5 : opt.rail;
      this.onGrass = false; this.lat = 0;
    }
    get speed() { return Math.hypot(this.vx, this.vz); }
    /* кут коліс обмежений бічним прискоренням: на швидкості кермо не смикає авто */
    maxSteer(v) { return Math.min(0.55, Math.atan(8 * 2.6 / Math.max(1, v * v))); }
    step(dt, inp) {
      const n = Math.max(1, Math.ceil(dt * 90)), h = dt / n;
      for (let i = 0; i < n; i++) this.sub(h, inp);
    }
    sub(dt, inp) {
      const R = this.road, sf = Math.sin(this.yaw), cf = Math.cos(this.yaw);
      let vf = this.vx * sf + this.vz * cf, vl = -this.vx * cf + this.vz * sf;
      this.steer += (clamp(inp.steer || 0, -1, 1) - this.steer) * Math.min(1, dt * 4.5);
      const a = this.steer * this.maxSteer(Math.abs(vf));
      this.yaw -= vf * Math.tan(a) / 2.6 * dt;
      this.onGrass = Math.abs(this.off) > R.half + 1.1;
      const S = SURF[this.onGrass ? 'grass' : this.surface];
      vf += (inp.gas || 0) * this.accel * (1 - clamp(vf / this.vmax, 0, 1)) * dt;
      vf -= (inp.brake || 0) * 12 * dt * Math.sign(vf);
      vf -= vf * S.drag * dt;
      vl *= Math.exp(-S.grip * dt);
      const sn = Math.sin(this.yaw), cn = Math.cos(this.yaw);
      this.vx = sn * vf - cn * vl; this.vz = cn * vf + sn * vl;
      this.x += this.vx * dt; this.z += this.vz * dt;
      const L = R.locate(this.x, this.z, this.s);
      this.dist += Math.max(0, L.s - this.s); this.s = L.s; this.off = L.off;
      const q = R.at(L.s);
      /* м'який бортик: Релакс без аварій, авто повертається на узбіччя */
      if (this.rail && Math.abs(L.off) > this.rail) {
        const over = Math.abs(L.off) - this.rail, sg = Math.sign(L.off), rx = -Math.cos(q.h), rz = Math.sin(q.h);
        this.x -= rx * sg * over * Math.min(1, dt * 8); this.z -= rz * sg * over * Math.min(1, dt * 8);
        let d = q.h - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); this.yaw += d * Math.min(1, dt * 1.8);
      }
      const ahead = R.at(L.s + 2).y, back = R.at(Math.max(0, L.s - 2)).y;
      this.y = q.y; this.pitch += (Math.atan2(ahead - back, 4) - this.pitch) * Math.min(1, dt * 8);
      this.lat = vf * vf * Math.tan(a) / 2.6;
      this.roll += (clamp(this.lat * 0.012, -0.08, 0.08) - this.roll) * Math.min(1, dt * 5);
      this.spin += vf * dt / 0.33;
    }
  }

  /* Автопілот: слідує за смугою, сповільнюється перед поворотом */
  function autopilot(road, car, cruise, lane = 1.75) {
    const v = Math.max(car.speed, 5), L = 7 + v * 0.7, q = road.at(car.s + L);
    const tx = q.x - Math.cos(q.h) * lane, tz = q.z + Math.sin(q.h) * lane, dx = tx - car.x, dz = tz - car.z;
    const fw = dx * Math.sin(car.yaw) + dz * Math.cos(car.yaw), rt = -dx * Math.cos(car.yaw) + dz * Math.sin(car.yaw);
    const curv = 2 * rt / Math.max(9, fw * fw + rt * rt), ang = Math.atan(curv * 2.6);
    let safe = cruise;
    for (let d = 10; d <= 90; d += 20) { const k = Math.abs(road.at(car.s + d).k); if (k > 1e-4) safe = Math.min(safe, Math.sqrt(3.4 / k) + d * 0.08); }
    const dv = safe - car.speed;
    return { steer: clamp(ang / car.maxSteer(v), -1, 1), gas: dv > 0 ? clamp(dv / 3 + 0.3, 0, 1) : 0, brake: dv < -1 ? clamp(-dv / 12, 0, 0.6) : 0 };
  }

  const WEATHER = {
    clear: { vis: 1250, grey: 0, dark: 0, rain: 0, snow: 0, label: 'Ясно' },
    cloudy: { vis: 900, grey: 0.55, dark: 0.12, rain: 0, snow: 0, label: 'Хмарно' },
    rain: { vis: 280, grey: 0.85, dark: 0.26, rain: 1, snow: 0, label: 'Дощ' },
    fog: { vis: 70, grey: 0.9, dark: 0.1, rain: 0, snow: 0, label: 'Туман' },
    snow: { vis: 210, grey: 0.8, dark: 0.08, rain: 0, snow: 1, label: 'Сніг' },
  };

  const api = { Road, Car, autopilot, WEATHER, BIOME, noise, rng, clamp, lerp, smooth };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Drive = Object.assign(root.Drive || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
