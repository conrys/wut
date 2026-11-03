/* Спільна сцена водіння на three.js: лоуполі-дорога чанками, світ по біомах, небо, погода,
   авто й кабіна. Кабіна малюється окремим проходом, тож дощ і дерева її не перетинають.
   Сидіння: seat = 'driver' | 'nav' (штурман для Раллі). */
(function () {
  const D = window.Drive, T = window.THREE, { clamp, lerp, smooth, noise, rng, BIOME, WEATHER } = D;
  const rgb = (hex) => [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255];
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const shade = (c, f) => [c[0] * f, c[1] * f, c[2] * f];

  /* Збирач трикутників: один меш на чанк, колір — у вершинах, грані пласкі */
  class Tris {
    constructor() { this.p = []; this.c = []; this.n = []; this.uv = null; }
    tri(a, b, c, col) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      for (let i = 0; i < 3; i++) { this.c.push(col[0], col[1], col[2]); this.n.push(nx, ny, nz); }
    }
    quad(a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); }
    /* призма / конус навколо осі y */
    prism(x, y, z, r0, r1, h, n, col, rot = 0, top = true) {
      const ring = (r, yy) => { const a = []; for (let i = 0; i < n; i++) { const t = rot + i / n * 6.283; a.push([x + Math.sin(t) * r, yy, z + Math.cos(t) * r]); } return a; };
      const A = ring(r0, y), B = ring(r1, y + h), tip = [x, y + h, z];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, f = 0.9 + 0.14 * Math.sin(rot + i * 2.1);
        this.quad(A[i], A[j], B[j], B[i], shade(col, f));
        if (top && r1 > 0.001) this.tri(B[i], B[j], tip, shade(col, 1.08));
      }
    }
    box(x, y, z, sx, sy, sz, yaw, col) {
      const s = Math.sin(yaw), c = Math.cos(yaw), P = (a, b, d) => [x + a * sx / 2 * c + d * sz / 2 * s, y + b * sy / 2, z - a * sx / 2 * s + d * sz / 2 * c];
      const v = [P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1), P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)];
      this.quad(v[3], v[2], v[1], v[0], shade(col, 0.82)); this.quad(v[4], v[5], v[6], v[7], shade(col, 0.95));
      this.quad(v[0], v[4], v[7], v[3], shade(col, 0.76)); this.quad(v[5], v[1], v[2], v[6], shade(col, 0.9));
      this.quad(v[7], v[6], v[2], v[3], col);
    }
    /* незграбна кулька — крона дерева */
    blob(x, y, z, r, col, r2) {
      const n = 6, rows = 3, P = [];
      for (let j = 0; j <= rows; j++) { const a = j / rows * 3.14; P.push([]); for (let i = 0; i < n; i++) { const t = i / n * 6.283 + j * 0.5, q = r * (0.86 + r2() * 0.28); P[j].push([x + Math.sin(a) * Math.sin(t) * q, y + Math.cos(a) * r * 0.86, z + Math.sin(a) * Math.cos(t) * q]); } }
      for (let j = 0; j < rows; j++) for (let i = 0; i < n; i++) { const k = (i + 1) % n; this.quad(P[j + 1][i], P[j + 1][k], P[j][k], P[j][i], shade(col, 0.86 + j * 0.09 + r2() * 0.08)); }
    }
    pine(x, y, z, h, col, tr, snow) {
      this.prism(x, y, z, h * 0.04, h * 0.03, h * 0.3, 5, tr);
      const L = 3; for (let i = 0; i < L; i++) { const t = i / L, r = h * (0.27 - t * 0.14); this.prism(x, y + h * (0.2 + t * 0.56), z, r, 0.001, h * 0.42, 6, snow && i ? mix(col, snow, 0.45 + i * 0.2) : col, i, false); }
    }
    oak(x, y, z, h, col, tr, r2) {
      this.prism(x, y, z, h * 0.06, h * 0.04, h * 0.55, 5, tr);
      this.blob(x, y + h * 0.68, z, h * 0.3, col, r2);
      this.blob(x + h * 0.14, y + h * 0.55, z - h * 0.08, h * 0.2, shade(col, 1.08), r2);
    }
    geo() {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
      if (this.uv) g.setAttribute('uv', new T.Float32BufferAttribute(this.uv, 2));
      g.computeBoundingSphere();
      return g;
    }
  }

  const BI = [
    { g: [0x4F9A3A, 0x62B045, 0x3F8A38], amp: 11, ver: 0x3C8C3F },
    { g: [0xD8B84A, 0xC9A93E, 0x8FB24C], amp: 4, ver: 0xA5B94E },
    { g: [0xB79A3F, 0x9E8B3C, 0xC2752E], amp: 24, ver: 0x93903F },
    { g: [0x74B24E, 0x82BC52, 0x5DA146], amp: 5, ver: 0x62A646 },
    { g: [0xE9EFF3, 0xDAE4EB, 0xC9D6DF], amp: 14, ver: 0xDCE6EC },
  ].map((b) => ({ ...b, g: b.g.map(rgb), ver: rgb(b.ver) }));
  const TR = rgb(0x6A4A30), BIRCH = rgb(0xD8D6CC), PINE = rgb(0x2E6E45), LEAF = [rgb(0x4D9E3B), rgb(0x6DB63F), rgb(0x3D8B3C)];
  const ORANGE = [rgb(0xD9822B), rgb(0xC9552A), rgb(0xE0A92F)], SNOW = rgb(0xF2F6F8), POPLAR = rgb(0x3F8F47);
  const WALLS = [0xE9E3D0, 0xF0D9A8, 0xC9DDE8, 0xE8C7B5].map(rgb), ROOF = [0x9C3F2E, 0x5B5F6B, 0x7A4A32].map(rgb);

  const CH = 30; /* точок у чанку */
  const AHEAD = 10, BEHIND = 2;

  function chunk(road, c) {
    const i0 = c * CH, r2 = rng(c * 7919 + 13), O = road.ensure(i0), ox = O.x, oy = O.y, oz = O.z;
    const P = (i) => road.ensure(i), ground = new Tris(), lit = new Tris(), R = new Tris(); R.uv = [];
    const hw = road.half, OFFS = [-160, -74, -34, -15, -7.5, -hw - 1, hw + 1, 7.5, 15, 34, 74, 160];
    const blendCol = (s, f) => { const b = road.biome(s); return mix(f(BI[b.a]), f(BI[b.b]), b.t); };
    const hgt = (p, off, wx, wz) => {
      const a = Math.abs(off), b = road.biome(p.s), amp = lerp(BI[b.a].amp, BI[b.b].amp, b.t);
      const t = smooth((a - 6) / 46), ditch = -0.55 * smooth((a - hw - 1) / 2) * (1 - smooth((a - 9) / 7));
      return ditch + t * ((noise(wx * 0.011, wz * 0.011) + 0.45) * amp + noise(wx * 0.05, wz * 0.05) * 1.6);
    };
    const pt = (p, off) => {
      const k = Math.abs(p.k), inner = p.k > 0 ? off < 0 : off > 0; /* внутрішній бік повороту не складається */
      const o2 = inner && k > 1e-5 ? Math.sign(off) * Math.min(Math.abs(off), 0.82 / k) : off;
      const x = p.x - Math.cos(p.h) * o2, z = p.z + Math.sin(p.h) * o2;
      return [x - ox, p.y + hgt(p, o2, x, z) - oy, z - oz];
    };
    /* земля: кожна друга точка, вікові плями кольором */
    for (let i = i0; i < i0 + CH; i += 2) {
      const a = P(i), b = P(i + 2);
      for (let j = 0; j < OFFS.length - 1; j++) {
        const A = pt(a, OFFS[j]), B = pt(a, OFFS[j + 1]), C = pt(b, OFFS[j + 1]), E = pt(b, OFFS[j]);
        const n = noise((A[0] + ox) * 0.03, (A[2] + oz) * 0.03), base = blendCol(a.s, (x) => x.g[n > 0.2 ? 2 : n > -0.2 ? 0 : 1]);
        const near = Math.abs(OFFS[j] + OFFS[j + 1]) < 16 ? blendCol(a.s, (x) => x.ver) : base;
        const c1 = shade(near, 0.96 + r2() * 0.08), c2 = shade(near, 0.96 + r2() * 0.08);
        /* порядок із нормаллю вгору */
        ground.tri(A, B, E, c1); ground.tri(B, C, E, c2);
      }
    }
    /* асфальт */
    const edge = (p, o, up) => { const x = p.x - Math.cos(p.h) * o, z = p.z + Math.sin(p.h) * o; return [x - ox, p.y + up - oy, z - oz]; };
    for (let i = i0; i < i0 + CH; i++) {
      const a = P(i), b = P(i + 1), f = a.s / 24, g = b.s / 24, bb = road.biome(a.s), wn = lerp(bb.a === BIOME.WINTER ? 1 : 0, bb.b === BIOME.WINTER ? 1 : 0, bb.t);
      const col = mix([1, 1, 1], [1.2, 1.24, 1.3], wn);
      const A = edge(a, -hw, 0.06), B = edge(a, hw, 0.06), C = edge(b, hw, 0.06), E = edge(b, -hw, 0.06);
      R.tri(A, B, E, col); R.uv.push(0, f, 1, f, 0, g); R.tri(B, C, E, col); R.uv.push(1, f, 1, g, 0, g);
      /* узбіччя */
      for (const sg of [-1, 1]) {
        const x0 = edge(a, sg * hw, 0.04), x1 = edge(b, sg * hw, 0.04), y0 = edge(a, sg * (hw + 1), 0), y1 = edge(b, sg * (hw + 1), 0);
        const c = mix(rgb(0x8C8678), blendCol(a.s, (x) => x.ver), 0.25);
        if (sg > 0) { ground.tri(x0, y0, x1, c); ground.tri(y0, y1, x1, c); } else { ground.tri(y0, x0, y1, c); ground.tri(x0, x1, y1, c); }
      }
    }
    /* світ */
    const place = (s, off) => { const p = road.at(s), x = p.x - Math.cos(p.h) * off, z = p.z + Math.sin(p.h) * off; const q = { s, h: p.h, k: p.k, y: p.y }; return [x - ox, p.y + hgt(q, off, x, z) - oy, z - oz, p.h]; };
    const s0 = O.s, len = CH * road.step;
    const out = () => { const sg = r2() < 0.5 ? -1 : 1; return sg * (8.5 + r2() ** 1.5 * 62); };
    for (const [id, w] of (() => { const b = road.biome(s0 + len / 2); return b.a === b.b ? [[b.a, 1]] : [[b.a, 1 - b.t], [b.b, b.t]]; })()) {
      const fit = (n) => Math.round(n * w);
      if (id === BIOME.FOREST) {
        for (let i = 0; i < fit(70); i++) { const [x, y, z] = place(s0 + r2() * len, out()), h = 6 + r2() * 8; if (r2() < 0.42) ground.pine(x, y, z, h * 1.25, PINE, TR); else ground.oak(x, y, z, h, LEAF[Math.floor(r2() * 3)], r2() < 0.2 ? BIRCH : TR, r2); }
        for (let i = 0; i < fit(16); i++) { const [x, y, z] = place(s0 + r2() * len, (r2() < 0.5 ? -1 : 1) * (6.4 + r2() * 5)); ground.blob(x, y + 0.45, z, 0.7 + r2() * 0.5, LEAF[Math.floor(r2() * 3)], r2); }
      } else if (id === BIOME.AUTUMN) {
        for (let i = 0; i < fit(46); i++) { const [x, y, z] = place(s0 + r2() * len, out()), h = 6 + r2() * 7; ground.oak(x, y, z, h, ORANGE[Math.floor(r2() * 3)], TR, r2); }
      } else if (id === BIOME.WINTER) {
        for (let i = 0; i < fit(52); i++) { const [x, y, z] = place(s0 + r2() * len, out()), h = 8 + r2() * 9; ground.pine(x, y, z, h, PINE, TR, SNOW); }
      } else if (id === BIOME.FIELD) {
        for (let d = 20; d < len; d += 40) {
          if (r2() > w) continue;
          const [x, y, z, h] = place(s0 + d, -9.5), [x2, y2, z2] = place(s0 + d + 40, -9.5);
          ground.box(x, y + 4, z, 0.22, 8, 0.22, h, TR); ground.box(x, y + 7.5, z, 1.8, 0.14, 0.14, h, TR);
          const mx = (x + x2) / 2, mz = (z + z2) / 2, L = Math.hypot(x2 - x, z2 - z), yaw = Math.atan2(x2 - x, z2 - z);
          ground.box(mx, (y + y2) / 2 + 7.2, mz, 0.05, 0.05, L, yaw, [0.2, 0.2, 0.22]);
        }
        for (let i = 0; i < fit(9); i++) { const [x, y, z] = place(s0 + r2() * len, (r2() < 0.5 ? -1 : 1) * (30 + r2() * 90)); ground.oak(x, y, z, 7 + r2() * 4, LEAF[0], TR, r2); }
      } else if (id === BIOME.VILLAGE) {
        for (let i = 0; i < fit(4); i++) {
          const sg = r2() < 0.5 ? -1 : 1, [x, y, z, h] = place(s0 + 14 + r2() * (len - 28), sg * (13 + r2() * 11)), w2 = 5 + r2() * 3, d2 = 6 + r2() * 3;
          const yaw = h + (sg > 0 ? 1.57 : -1.57), s = Math.sin(yaw), c = Math.cos(yaw), wc = WALLS[Math.floor(r2() * 4)], rc = ROOF[Math.floor(r2() * 3)];
          ground.box(x, y + 1.5, z, w2, 3, d2, yaw, wc);
          const A = (a, b, e) => [x + a * c + e * s, y + b, z - a * s + e * c], W = w2 / 2 + 0.3, Dd = d2 / 2 + 0.3;
          ground.quad(A(-W, 3, -Dd), A(0, 5.2, -Dd), A(0, 5.2, Dd), A(-W, 3, Dd), rc); ground.quad(A(0, 5.2, -Dd), A(W, 3, -Dd), A(W, 3, Dd), A(0, 5.2, Dd), shade(rc, 0.84));
          ground.tri(A(-W, 3, -Dd), A(W, 3, -Dd), A(0, 5.2, -Dd), wc); ground.tri(A(W, 3, Dd), A(-W, 3, Dd), A(0, 5.2, Dd), wc);
          for (const e of [-1.4, 1.4]) lit.box(x + e * s + (W - 0.27) * -sg * c * 0 , y + 1.7, z + e * c, w2 + 0.08, 0.9, 0.9, yaw, rgb(0xFFD27A));
        }
        for (let i = 0; i < fit(12); i++) { const [x, y, z] = place(s0 + r2() * len, (r2() < 0.5 ? -1 : 1) * (9 + r2() * 45)); if (r2() < 0.5) { ground.prism(x, y, z, 0.2, 0.1, 2, 5, TR); ground.blob(x, y + 6, z, 1.5, POPLAR, r2); ground.blob(x, y + 3.5, z, 1.7, POPLAR, r2); } else ground.oak(x, y, z, 6 + r2() * 4, LEAF[1], TR, r2); }
      }
    }
    /* стовпчики-світловідбивачі: вночі ведуть дорогу */
    for (let d = 0; d < len; d += 48) for (const sg of [-1, 1]) {
      const [x, y, z, h] = place(s0 + d + (sg > 0 ? 24 : 0), sg * (hw + 1.4));
      ground.box(x, y + 0.45, z, 0.13, 0.9, 0.13, h, [0.95, 0.95, 0.92]); lit.box(x, y + 0.74, z, 0.15, 0.18, 0.15, h, rgb(sg > 0 ? 0xFF7A3D : 0xF4F4F4));
    }
    return { ox, oy, oz, ground: ground.geo(), road: R.geo(), lit: lit.p.length ? lit.geo() : null };
  }

  function roadTexture() {
    return window.G3.canvasTex(128, 512, (g, W, H) => {
      g.fillStyle = '#6A6B70'; g.fillRect(0, 0, W, H);
      const r = rng(5); for (let i = 0; i < 2600; i++) { const v = 88 + r() * 40 | 0; g.fillStyle = `rgba(${v},${v},${v + 4},.5)`; g.fillRect(r() * W, r() * H, 2, 2); }
      for (let i = 0; i < 7; i++) { g.fillStyle = 'rgba(52,52,56,.16)'; g.fillRect(16 + r() * 90, r() * H, 3 + r() * 5, 30 + r() * 70); }
      g.fillStyle = '#ECE7D6'; g.fillRect(5, 0, 4, H); g.fillRect(W - 9, 0, 4, H); g.fillRect(W / 2 - 2, 0, 4, H * 0.5);
    });
  }

  /* --- модель авто: простий кузов, спільний для Релаксу й Раллі --- */
  function carModel(color) {
    const G = new T.Group(), c = rgb(color), t = new Tris(), dark = [0.1, 0.11, 0.13], glass = [0.18, 0.25, 0.32];
    t.box(0, 0.62, 0, 1.76, 0.5, 4.1, 0, c); t.box(0, 1.1, -0.2, 1.54, 0.5, 2.1, 0, c);
    t.box(0, 1.12, 0.87, 1.42, 0.38, 0.06, 0, glass); t.box(0, 1.12, -1.27, 1.42, 0.38, 0.06, 0, glass);
    t.box(-0.78, 1.12, -0.2, 0.03, 0.36, 1.85, 0, glass); t.box(0.78, 1.12, -0.2, 0.03, 0.36, 1.85, 0, glass);
    t.box(0, 0.42, 2.06, 1.78, 0.22, 0.12, 0, dark); t.box(0, 0.42, -2.06, 1.78, 0.22, 0.12, 0, dark);
    t.box(-0.62, 0.74, 2.06, 0.34, 0.16, 0.04, 0, [1, 0.96, 0.78]); t.box(0.62, 0.74, 2.06, 0.34, 0.16, 0.04, 0, [1, 0.96, 0.78]);
    t.box(-0.64, 0.74, -2.06, 0.34, 0.14, 0.04, 0, [0.85, 0.08, 0.08]); t.box(0.64, 0.74, -2.06, 0.34, 0.14, 0.04, 0, [0.85, 0.08, 0.08]);
    const body = new T.Mesh(t.geo(), new T.MeshLambertMaterial({ vertexColors: true })); G.add(body);
    G.stop = new T.MeshBasicMaterial({ color: 0x5A0A0A });
    for (const x of [-0.64, 0.64]) { const m = new T.Mesh(new T.BoxGeometry(0.36, 0.15, 0.03), G.stop); m.position.set(x, 0.74, -2.09); G.add(m); }
    const wg = new T.CylinderGeometry(0.34, 0.34, 0.24, 10); wg.rotateZ(1.5708);
    const wm = new T.MeshLambertMaterial({ color: 0x15161A }); G.wheels = [];
    for (const [x, z] of [[-0.82, 1.3], [0.82, 1.3], [-0.82, -1.3], [0.82, -1.3]]) { const w = new T.Mesh(wg, wm); w.position.set(x, 0.34, z); G.add(w); G.wheels.push(w); }
    const sh = new T.Mesh(new T.PlaneGeometry(2.3, 4.7), new T.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.28, depthWrite: false }));
    sh.rotation.x = -1.5708; sh.position.y = 0.09; G.add(sh);
    return G;
  }

  /* --- кабіна. Простір: око в (seatX,0,0), вперед = -z --- */
  function cabinModel(color, opt) {
    const G = new T.Group(), c = rgb(color), t = new Tris(), dash = rgb(0x5E5F60), dashD = rgb(0x45474A), door = rgb(0x6B7274), col = 0.76;
    const Q = (a, b, cc, d, cl) => t.quad(a, b, cc, d, cl);
    /* капот */
    Q([-col, -0.24, -0.86], [col, -0.24, -0.86], [0.56, -0.33, -2.5], [-0.56, -0.33, -2.5], c);
    /* панель приладів */
    Q([-0.92, -0.2, -0.82], [0.92, -0.2, -0.82], [0.92, -0.25, -0.5], [-0.92, -0.25, -0.5], dash);
    Q([-0.92, -0.25, -0.5], [0.92, -0.25, -0.5], [0.92, -0.72, -0.56], [-0.92, -0.72, -0.56], dashD);
    Q([-0.92, -0.72, -0.56], [0.92, -0.72, -0.56], [0.92, -1.1, -0.1], [-0.92, -1.1, -0.1], [0.14, 0.14, 0.16]);
    /* стійки й дах */
    for (const sg of [-1, 1]) {
      Q([sg * 0.8, -0.2, -0.84], [sg * 0.72, -0.2, -0.86], [sg * 0.56, 0.48, -0.26], [sg * 0.63, 0.48, -0.24], c);
      Q([sg * 0.9, -0.22, -0.84], [sg * 0.9, -0.22, 0.3], [sg * 0.9, -1.1, 0.3], [sg * 0.9, -1.1, -0.84], door);
      t.box(sg * 0.86, -0.46, -0.3, 0.06, 0.1, 0.46, 0, c); t.box(sg * 0.88, -0.2, -0.3, 0.05, 0.05, 1.1, 0, c);
      Q([sg * 0.9, -0.2, -0.84], [sg * 0.82, 0.5, -0.24], [sg * 0.82, 0.5, 0.3], [sg * 0.9, -0.2, 0.3], c.map((v) => v * 0)); // вікно нижче ховається
    }
    G.frame = new T.Mesh(t.geo(), new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide }));
    G.add(G.frame);
    /* бокові вікна мають бути прозорі: прибираємо чорні трикутники */
    const pos = G.frame.geometry.getAttribute('color').array, keep = [], pa = G.frame.geometry.getAttribute('position').array, na = G.frame.geometry.getAttribute('normal').array;
    const P2 = [], C2 = [], N2 = [];
    for (let i = 0; i < pa.length; i += 9) { if (pos[i] + pos[i + 1] + pos[i + 2] === 0) continue; for (let j = 0; j < 9; j++) { P2.push(pa[i + j]); C2.push(pos[i + j]); N2.push(na[i + j]); } }
    G.frame.geometry.dispose();
    const g2 = new T.BufferGeometry(); g2.setAttribute('position', new T.Float32BufferAttribute(P2, 3)); g2.setAttribute('normal', new T.Float32BufferAttribute(N2, 3)); g2.setAttribute('color', new T.Float32BufferAttribute(C2, 3)); G.frame.geometry = g2;
    /* верхня рамка лобового */
    const hdr = new T.Mesh(new T.BoxGeometry(1.7, 0.1, 0.5), new T.MeshLambertMaterial({ color })); hdr.position.set(0, 0.54, -0.1); G.add(hdr);
    /* деталі панелі: дефлектори, рукоятка, бардачок */
    const dk = new T.MeshLambertMaterial({ color: 0x2C2D30 }), bx = (x, y, z, a, b, d, m) => { const e = new T.Mesh(new T.BoxGeometry(a, b, d), m || dk); e.position.set(x, y, z); G.add(e); return e; };
    bx(0.02, -0.32, -0.5, 0.42, 0.05, 0.03); bx(0.62, -0.32, -0.5, 0.3, 0.05, 0.03); bx(0.42, -0.46, -0.5, 0.42, 0.14, 0.03);
    const bump = new T.Mesh(new T.BoxGeometry(1.5, 0.03, 0.09), new T.MeshLambertMaterial({ color: 0x35363A })); bump.position.set(0, -0.2, -0.8); G.add(bump);
    bx(0.04, -0.62, -0.42, 0.05, 0.05, 0.22).rotation.x = -0.6; bx(0.04, -0.55, -0.32, 0.075, 0.075, 0.075, new T.MeshLambertMaterial({ color: 0xC2342B }));
    /* дзеркала */
    const mir = new T.Mesh(new T.BoxGeometry(0.2, 0.13, 0.07), new T.MeshLambertMaterial({ color })); mir.position.set(0.98, -0.1, -0.75); G.add(mir);
    const mg = new T.Mesh(new T.PlaneGeometry(0.17, 0.1), new T.MeshBasicMaterial({ color: 0xF4F0DF })); mg.position.set(0.97, -0.1, -0.71); mg.rotation.y = 0.2; G.add(mg);
    const inner = new T.Mesh(new T.BoxGeometry(0.3, 0.08, 0.02), new T.MeshLambertMaterial({ color: 0x2A2A2C })); inner.position.set(0.04, 0.38, -0.5); G.add(inner);
    const ig = new T.Mesh(new T.PlaneGeometry(0.27, 0.06), new T.MeshBasicMaterial({ color: 0xBFDDE6 })); ig.position.set(0.04, 0.38, -0.489); G.add(ig);
    /* прилади */
    const tex = window.G3.canvasTex(256, 128, (g) => {
      g.fillStyle = '#161618'; g.fillRect(0, 0, 256, 128);
      for (const x of [64, 192]) { g.strokeStyle = '#E8E2CF'; g.lineWidth = 4; g.beginPath(); g.arc(x, 64, 50, 0, 6.3); g.stroke(); for (let i = 0; i < 9; i++) { const a = 2.4 + i * 0.58; g.beginPath(); g.moveTo(x + Math.cos(a) * 40, 64 + Math.sin(a) * 40); g.lineTo(x + Math.cos(a) * 48, 64 + Math.sin(a) * 48); g.stroke(); } }
    });
    const gauges = new T.Mesh(new T.PlaneGeometry(0.36, 0.18), new T.MeshBasicMaterial({ map: tex })); gauges.position.set(-0.37, -0.33, -0.49); gauges.rotation.x = -0.1; G.add(gauges);
    const needle = new T.Mesh(new T.BoxGeometry(0.058, 0.006, 0.002), new T.MeshBasicMaterial({ color: 0xFF7A2E })); needle.geometry.translate(0.029, 0, 0);
    needle.position.set(-0.46, -0.33, -0.482); needle.rotation.x = -0.1; G.add(needle); G.needle = needle;
    /* кермо */
    const wheel = new T.Group(); wheel.position.set(-0.37, -0.41, -0.4); wheel.rotation.x = 0.36;
    const wm = new T.MeshLambertMaterial({ color: 0x17171A }), rim = new T.Mesh(new T.TorusGeometry(0.19, 0.016, 8, 26), wm); wheel.add(rim);
    const rot = new T.Group(); wheel.add(rot); rot.add(rim);
    for (const a of [0, 2.1, 4.2]) { const sp = new T.Mesh(new T.BoxGeometry(0.17, 0.03, 0.012), wm); sp.position.set(Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0); sp.rotation.z = a; rot.add(sp); }
    const hub = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 0.03, 10), wm); hub.rotation.x = 1.57; rot.add(hub);
    const hm = new T.MeshLambertMaterial({ color: 0xD9C7A6 });
    for (const sg of [-1, 1]) { const h = new T.Mesh(new T.BoxGeometry(0.1, 0.07, 0.06), hm); h.position.set(sg * 0.18, 0.02, 0.02); rot.add(h); }
    G.add(wheel); G.wheelRot = rot;
    /* двірники */
    G.wipers = [-0.34, 0.3].map((x) => { const w = new T.Group(); w.position.set(x, -0.19, -0.82); w.rotation.x = -0.72; const b = new T.Mesh(new T.BoxGeometry(0.015, 0.56, 0.012), new T.MeshLambertMaterial({ color: 0x141416 })); b.geometry.translate(0, 0.28, 0); w.add(b); G.add(w); return w; });
    /* краплі на склі */
    const N = 70, dp = new Float32Array(N * 3).fill(-50), dg = new T.BufferGeometry(); dg.setAttribute('position', new T.BufferAttribute(dp, 3));
    G.drops = new T.Points(dg, new T.PointsMaterial({ color: 0xDCEBF4, size: 0.012, transparent: true, opacity: 0.6, map: softDot(), depthWrite: false })); G.drops.frustumCulled = false; G.add(G.drops);
    /* пристрій штурмана: Раллі малює карту на його екрані */
    if (opt && opt.device) {
      const d = new T.Group(); d.position.set(0.37, -0.56, -0.34); d.rotation.x = -0.62;
      d.add(new T.Mesh(new T.BoxGeometry(0.3, 0.42, 0.03), new T.MeshLambertMaterial({ color: 0xE08A1E })));
      G.add(d); G.device = d;
    }
    return G;
  }

  let dot = null;
  function softDot() {
    if (!dot) dot = window.G3.canvasTex(32, 32, (g) => { const r = g.createRadialGradient(16, 16, 1, 16, 16, 15); r.addColorStop(0, '#fff'); r.addColorStop(0.6, 'rgba(255,255,255,.7)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 32, 32); });
    return dot;
  }

  /* ключові моменти доби: t 0 — світанок */
  const DAY = [
    { t: 0, top: 0x6E8FC0, hor: 0xF3C2A0, sun: 0.5, hemi: 0.55, sc: 0xFFC890, night: 0.1 },
    { t: 0.12, top: 0x68B7D8, hor: 0xD8ECE6, sun: 0.62, hemi: 0.6, sc: 0xFFF1DC, night: 0 },
    { t: 0.4, top: 0x5CBBD6, hor: 0xCDEBE6, sun: 0.66, hemi: 0.62, sc: 0xFFF6E8, night: 0 },
    { t: 0.56, top: 0x6699CC, hor: 0xFFD79A, sun: 0.6, hemi: 0.56, sc: 0xFFC77A, night: 0 },
    { t: 0.64, top: 0x46497F, hor: 0xFF8D5C, sun: 0.4, hemi: 0.46, sc: 0xFF9460, night: 0.2 },
    { t: 0.72, top: 0x161C3E, hor: 0x3C3D6B, sun: 0.08, hemi: 0.24, sc: 0x8A9CE0, night: 0.85 },
    { t: 0.9, top: 0x0B1028, hor: 0x1A2040, sun: 0.05, hemi: 0.2, sc: 0x8A9CE0, night: 1 },
    { t: 1, top: 0x6E8FC0, hor: 0xF3C2A0, sun: 0.5, hemi: 0.55, sc: 0xFFC890, night: 0.1 },
  ];

  class Scene {
    constructor(opt) {
      this.road = opt.road; this.car = opt.car;
      this.w = window.G3.world({ canvas: opt.canvas, shadows: false, fov: 62, near: 0.3, far: 1500, hemiGround: 0x7DA860, fog: 0xCDEBE6, fogNear: 200, fogFar: 1250 });
      const s = this.scene = this.w.scene, w = this.w; s.background = new T.Color(0xCDEBE6); w.renderer.autoClear = false;
      this.mat = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide });
      this.lit = new T.MeshBasicMaterial({ vertexColors: true });
      const rt = roadTexture(); rt.wrapS = rt.wrapT = T.RepeatWrapping; rt.anisotropy = 4;
      this.roadMat = new T.MeshLambertMaterial({ map: rt, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      this.chunks = new Map(); this.q = [];
      this.time = opt.time == null ? 0.3 : opt.time; this.dayLen = opt.dayLen || 480; this.locked = !!opt.lockDay;
      this.wx = { ...WEATHER.clear }; this.wxT = { ...WEATHER.clear }; this.night = 0; this.shake = 0;
      this.buildSky(); this.buildWeather(); this.buildDust();
      this.cam = 'cabin'; this.seat = 'driver';
      this.carM = carModel(opt.color); s.add(this.carM);
      this.spot = new T.SpotLight(0xFFF1CC, 0, 90, 0.5, 0.6, 1.2); this.spot.position.set(0, 1, 1.5); this.spot.target.position.set(0, 0, 18); this.carM.add(this.spot, this.spot.target);
      this.cabS = new T.Scene(); this.cabC = new T.PerspectiveCamera(62, 1, 0.05, 10);
      this.cabHemi = new T.HemisphereLight(0xffffff, 0x777788, 0.8); this.cabSun = new T.DirectionalLight(0xffffff, 0.5); this.cabSun.position.set(-0.2, 0.7, 0.9); this.cabS.add(this.cabHemi, this.cabSun);
      this.cab = cabinModel(opt.color, { device: opt.device }); this.cabS.add(this.cab);
      this.color = opt.color; this.orb = null; this.fit();
      addEventListener('resize', () => this.fit());
      this.syncChunks(true);
    }
    setColor(c) {
      this.color = c; this.scene.remove(this.carM); this.spot.parent && this.carM.remove(this.spot, this.spot.target);
      this.carM = carModel(c); this.carM.add(this.spot, this.spot.target); this.scene.add(this.carM);
      this.cabS.remove(this.cab); this.cab = cabinModel(c, { device: !!this.cab.device }); this.cabS.add(this.cab);
    }
    /* однаковий масштаб у вертикальному й горизонтальному положенні: фокусна відстань іде від короткої сторони екрана */
    fit() {
      const w = this.w, a = w.W / w.H, f = Math.min(w.W, w.H) * 0.92, fov = Math.min(105, 2 * Math.atan(w.H / 2 / f) * 180 / Math.PI);
      this.tilt = a > 1 ? 0.22 : 0.1; /* горизонтально кут нижчий, щоб лишались приладова панель і кермо */
      w.camera.fov = fov; w.camera.updateProjectionMatrix(); this.cabC.fov = fov; this.cabC.aspect = a; this.cabC.updateProjectionMatrix();
    }
    setCam(m) { this.cam = m; this.orb = null; this.fit(); }
    setWeather(n, instant) { this.wxT = { ...WEATHER[n], name: n }; if (instant) this.wx = { ...this.wxT }; }
    buildSky() {
      const g = new T.SphereGeometry(1200, 16, 10), n = g.getAttribute('position').count;
      g.setAttribute('color', new T.Float32BufferAttribute(new Float32Array(n * 3), 3));
      this.sky = new T.Mesh(g, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide, fog: false, depthWrite: false })); this.sky.renderOrder = -10; this.scene.add(this.sky);
      this.sunM = new T.Mesh(new T.CircleGeometry(38, 18), new T.MeshBasicMaterial({ color: 0xFFF4D0, fog: false, depthWrite: false, transparent: true })); this.sunM.renderOrder = -9; this.scene.add(this.sunM);
      const pos = [], r = rng(7); for (let i = 0; i < 260; i++) { const a = r() * 6.283, b = r() * 1.4; pos.push(Math.cos(a) * Math.cos(b) * 1100, Math.sin(b) * 1100 + 20, Math.sin(a) * Math.cos(b) * 1100); }
      const sg = new T.BufferGeometry(); sg.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      this.stars = new T.Points(sg, new T.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0, depthWrite: false })); this.stars.renderOrder = -9; this.scene.add(this.stars);
      const t = new Tris(), r2 = rng(3);
      for (let i = 0; i < 16; i++) { const a = r2() * 6.283, d = 650 + r2() * 300, x = Math.sin(a) * d, z = Math.cos(a) * d, y = 170 + r2() * 90; for (let j = 0; j < 4; j++) t.blob(x + (j - 1.5) * 52, y + r2() * 12, z + r2() * 30, 34 + r2() * 26, [1, 1, 1], r2); }
      this.clouds = new T.Mesh(t.geo(), new T.MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true, opacity: 0.9 })); this.clouds.scale.y = 0.42; this.scene.add(this.clouds);
    }
    buildWeather() {
      const n = 320, p = new Float32Array(n * 6); this.rainN = n; this.drops = [];
      for (let i = 0; i < n; i++) this.drops.push([(Math.random() - 0.5) * 40, Math.random() * 18, (Math.random() - 0.5) * 40]);
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(p, 3));
      this.rain = new T.LineSegments(g, new T.LineBasicMaterial({ color: 0xBFD6E8, transparent: true, opacity: 0.5 })); this.rain.frustumCulled = false; this.rain.visible = false; this.scene.add(this.rain);
      const sp = new Float32Array(n * 3), sg = new T.BufferGeometry(); sg.setAttribute('position', new T.BufferAttribute(sp, 3));
      this.snow = new T.Points(sg, new T.PointsMaterial({ color: 0xffffff, size: 0.09, transparent: true, opacity: 0.9, map: softDot(), depthWrite: false })); this.snow.frustumCulled = false; this.snow.visible = false; this.scene.add(this.snow);
    }
    /* пил, бризки й снігова курява */
    buildDust() {
      const N = this.dustN = 150; this.dust = []; const p = new Float32Array(N * 3).fill(-9999), c = new Float32Array(N * 3), g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(p, 3)); g.setAttribute('color', new T.BufferAttribute(c, 3));
      for (let i = 0; i < N; i++) this.dust.push({ l: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
      this.dustI = 0; this.dustM = new T.Points(g, new T.PointsMaterial({ size: 0.75, vertexColors: true, transparent: true, opacity: 0.42, map: softDot(), depthWrite: false })); this.dustM.frustumCulled = false; this.scene.add(this.dustM);
      /* сліди: стрічка за колесами */
      const S = this.trackN = 160, tp = new Float32Array(S * 18).fill(-9999), tg = new T.BufferGeometry(); tg.setAttribute('position', new T.BufferAttribute(tp, 3));
      this.track = new T.Mesh(tg, new T.MeshBasicMaterial({ color: 0x4A5058, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: T.DoubleSide })); this.track.frustumCulled = false; this.scene.add(this.track);
      this.trackI = 0; this.trackS = -1; this.trackLast = null; this.emit = 0;
    }
    puff(x, y, z, col) {
      const d = this.dust[this.dustI], c = this.car, a = this.dustM.geometry.getAttribute('color'); this.dustI = (this.dustI + 1) % this.dustN;
      d.l = 0.5 + Math.random() * 0.5; d.x = x; d.y = y; d.z = z; d.vx = c.vx * 0.3 + (Math.random() - 0.5) * 2.4; d.vy = 0.7 + Math.random() * 1.5; d.vz = c.vz * 0.3 + (Math.random() - 0.5) * 2.4;
      a.setXYZ(this.dustI, col[0], col[1], col[2]); a.needsUpdate = true; d.i = this.dustI;
    }
    effects(dt) {
      const c = this.car, W = this.wx, b = this.road.biome(c.s), winter = (b.t > 0.5 ? b.b : b.a) === BIOME.WINTER, sy = Math.sin(c.yaw), cy = Math.cos(c.yaw), v = c.speed;
      const rain = W.rain * clamp(v / 18, 0, 1), snowKick = winter ? clamp(v / 16, 0, 1) * 0.45 : 0, rate = c.rumble * 60 + rain * 40 + snowKick * 26;
      this.emit += rate * dt;
      const col = c.rumble > 0.1 ? (winter ? [0.93, 0.95, 0.97] : [0.68, 0.58, 0.42]) : winter ? [0.93, 0.95, 0.97] : [0.75, 0.8, 0.84];
      while (this.emit > 1) { this.emit--; const sd = Math.random() < 0.5 ? -0.8 : 0.8; this.puff(c.x - sy * 1.7 - cy * sd, c.y + 0.25, c.z - cy * 1.7 + sy * sd, col); }
      const pa = this.dustM.geometry.getAttribute('position');
      for (const d of this.dust) { if (d.i == null) continue; d.l -= dt; if (d.l <= 0) { pa.setXYZ(d.i, 0, -9999, 0); continue; } d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; d.vy -= dt * 1.4; pa.setXYZ(d.i, d.x, d.y, d.z); }
      pa.needsUpdate = true;
      /* сліди взимку й на траві */
      const on = winter || c.rumble > 0.5; this.track.visible = true;
      if (Math.abs(c.dist - this.trackS) > 1.1) {
        const pr = this.trackLast, mk = (o) => { const rx = -cy, rz = sy, y = c.y + 0.1; return [[c.x + rx * (o - 0.13), y, c.z + rz * (o - 0.13)], [c.x + rx * (o + 0.13), y, c.z + rz * (o + 0.13)]]; }, cur = [mk(-0.82), mk(0.82)];
        if (pr && on) { const a = this.track.geometry.getAttribute('position'); for (let w = 0; w < 2; w++) { const I = this.trackI; this.trackI = (I + 1) % this.trackN; const [p0, p1] = pr[w], [q0, q1] = cur[w], arr = [p0, p1, q1, p0, q1, q0]; arr.forEach((v3, k) => a.setXYZ(I * 6 + k, v3[0], v3[1], v3[2])); } a.needsUpdate = true; }
        this.trackLast = cur; this.trackS = c.dist;
      }
    }
    glass(dt) {
      const W = this.wx, cab = this.cab, wet = Math.max(W.rain, W.snow * 0.6), g = cab.drops.geometry.getAttribute('position'); cab.drops.visible = wet > 0.05;
      /* сухо: двірники лежать унизу скла; мокро: ходять туди-сюди */
      this.wip = this.wip || 0; const moving = wet > 0.15 || (this.wip % 6.283) > 0.05; if (moving) this.wip += dt * 3.6; else this.wip = 0;
      const ph = (1 - Math.cos(this.wip)) / 2; for (const w of cab.wipers) w.rotation.z = -1.5 + ph * 1.9;
      if (!cab.drops.visible) return;
      for (let n = Math.random() < wet * dt * 40 ? 1 : 0; n > 0; n--) { const i = Math.floor(Math.random() * g.count), t = Math.random(); g.setXYZ(i, -0.68 + Math.random() * 1.36, lerp(-0.18, 0.44, t), lerp(-0.84, -0.3, t)); }
      const band = 0.72 - ph * 1.44; for (let i = 0; i < g.count; i++) if (Math.abs(g.getX(i) - band) < 0.1) g.setXYZ(i, 0, -50, 0);
      g.needsUpdate = true;
    }
    syncChunks(all) {
      const cur = Math.floor(this.car.s / this.road.step / CH), S = this.chunks;
      for (const [c, o] of S) if (c < cur - BEHIND || c > cur + AHEAD + 1) { this.scene.remove(o.g); o.a.geometry.dispose(); o.b.geometry.dispose(); if (o.c) o.c.geometry.dispose(); S.delete(c); }
      const need = []; for (let c = Math.max(0, cur - BEHIND); c <= cur + AHEAD; c++) if (!S.has(c)) need.push(c);
      need.sort((a, b) => Math.abs(a - cur) - Math.abs(b - cur));
      for (const c of all ? need : need.slice(0, 1)) {
        const d = chunk(this.road, c), g = new T.Group(); g.position.set(d.ox, d.oy, d.oz);
        const a = new T.Mesh(d.ground, this.mat), b = new T.Mesh(d.road, this.roadMat), l = d.lit ? new T.Mesh(d.lit, this.lit) : null;
        g.add(a, b); if (l) g.add(l); this.scene.add(g); S.set(c, { g, a, b, c: l });
      }
    }
    light(dt) {
      if (!this.locked) this.time = (this.time + dt / this.dayLen) % 1;
      const t = this.time; let i = 0; while (i < DAY.length - 2 && DAY[i + 1].t <= t) i++;
      const A = DAY[i], B = DAY[i + 1], f = (t - A.t) / (B.t - A.t), W = this.wx, k = Math.min(1, dt * 0.09);
      for (const n of ['vis', 'grey', 'dark', 'rain', 'snow']) W[n] += (this.wxT[n] - W[n]) * (dt > 1 ? 1 : k * (n === 'vis' ? 1.6 : 1));
      const col = (a, b) => new T.Color(a).lerp(new T.Color(b), f);
      const n = this.night = lerp(A.night, B.night, f), g = new T.Color(lerp(0.76, 0.14, n), lerp(0.79, 0.15, n), lerp(0.82, 0.2, n));
      const top = col(A.top, B.top).lerp(g, W.grey), hor = col(A.hor, B.hor).lerp(g, W.grey * 0.92);
      const sk = this.sky.geometry, pos = sk.getAttribute('position'), c = sk.getAttribute('color'), tmp = new T.Color();
      for (let v = 0; v < pos.count; v++) { tmp.copy(hor).lerp(top, smooth(pos.getY(v) / 460)); c.setXYZ(v, tmp.r, tmp.g, tmp.b); } c.needsUpdate = true;
      const w = this.w, dim = 1 - W.dark; this.scene.fog.color.copy(hor); this.scene.background.copy(hor);
      w.scene.fog.far = Math.max(12, W.vis); w.scene.fog.near = Math.max(1.5, W.vis * 0.2);
      w.sun.intensity = lerp(A.sun, B.sun, f) * dim * (1 - W.grey * 0.45); w.sun.color.copy(col(A.sc, B.sc)); w.hemi.intensity = lerp(A.hemi, B.hemi, f) * dim;
      const a = t * 6.283, sd = w.sunDir.set(Math.cos(a) * 0.75, Math.max(0.06, Math.sin(a)), 0.45).normalize();
      this.cabHemi.intensity = 0.34 + w.hemi.intensity * 0.72; this.cabSun.intensity = w.sun.intensity * 0.5 + (n * 0.05);
      this.sunM.visible = n < 0.6 && W.grey < 0.7; this.sunM.material.opacity = 1 - W.grey; this.stars.material.opacity = n * (1 - W.grey);
      this.clouds.material.opacity = 0.9 * (1 - n * 0.75); this.clouds.material.color.copy(new T.Color(1, 1, 1).lerp(hor, n * 0.8)); this.clouds.visible = W.vis > 200; this.clouds.rotation.y += dt * 0.004;
      this.lit.color.setScalar(lerp(0.34, 1.25, n));
      const lamp = clamp((n - 0.12) * 2 + W.grey * 0.55 * (W.vis < 300 ? 1 : 0), 0, 1); this.spot.intensity = lamp * 2.2; this.lamp = lamp;
      return sd;
    }
    weather(dt) {
      const W = this.wx, c = this.w.camera.position, R = this.rain, S = this.snow; R.visible = W.rain > 0.05; S.visible = W.snow > 0.05;
      if (!R.visible && !S.visible) return;
      const vx = this.car.vx, vz = this.car.vz, a = R.geometry.getAttribute('position').array, b = S.geometry.getAttribute('position').array;
      this.drops.forEach((d, i) => {
        d[1] -= dt * (R.visible ? 24 : 2.6); d[0] -= vx * dt; d[2] -= vz * dt;
        if (d[1] < -2) d[1] = 16 + Math.random() * 3;
        d[0] = ((d[0] + 20) % 40 + 40) % 40 - 20; d[2] = ((d[2] + 20) % 40 + 40) % 40 - 20;
        const x = c.x + d[0], y = c.y + d[1] - 4, z = c.z + d[2];
        a[i * 6] = x; a[i * 6 + 1] = y; a[i * 6 + 2] = z; a[i * 6 + 3] = x + vx * 0.03; a[i * 6 + 4] = y + 0.75; a[i * 6 + 5] = z + vz * 0.03;
        b[i * 3] = x + Math.sin(d[1] + i) * 0.4; b[i * 3 + 1] = y; b[i * 3 + 2] = z;
      });
      R.geometry.getAttribute('position').needsUpdate = true; S.geometry.getAttribute('position').needsUpdate = true;
      R.material.opacity = W.rain * 0.5; S.material.opacity = W.snow * 0.9;
    }
    update(dt) {
      const c = this.car, w = this.w, cam = w.camera, m = this.carM;
      this.syncChunks(false); const sd = this.light(dt);
      const rm = c.rumble + c.bump, jig = window.G3.reduce ? 0 : rm * 0.035;
      m.position.set(c.x, c.y + (Math.random() - 0.5) * jig, c.z); m.rotation.set(-c.pitch - c.bodyPitch, c.yaw, 0, 'YXZ'); m.rotateZ(c.roll + (Math.random() - 0.5) * jig * 0.5);
      m.stop.color.setHex(c.braking ? 0xFF2A1E : 0x5A0A0A);
      for (const wh of m.wheels) wh.rotation.x = c.spin;
      const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw), vis = this.cam !== 'cabin'; m.visible = vis || this.lamp > 0.02;
      for (const ch of m.children) if (ch !== this.spot && ch !== this.spot.target) ch.visible = vis;
      if (this.cam === 'cabin') {
        const sx = this.seat === 'nav' ? 0.37 : -0.37, rx = -cy, rz = sy, sh = window.G3.reduce ? 0 : (c.speed > 3 ? c.speed * 0.00016 : 0) + rm * 0.03, lean = clamp(c.lat * 0.004, -0.05, 0.05);
        cam.position.set(c.x + sy * 0.15 + rx * (sx + lean), c.y + 1.2 + (Math.random() - 0.5) * sh, c.z + cy * 0.15 + rz * (sx + lean));
        cam.rotation.order = 'YXZ'; cam.rotation.set(c.pitch + c.bodyPitch * 0.6 - this.tilt, c.yaw + Math.PI, -c.roll * 0.7);
        this.cabC.rotation.x = -this.tilt;
        this.cab.position.set(-sx, 0, 0); this.cab.rotation.z = 0; this.cab.wheelRot.rotation.z = -c.steer * 1.6;
        const v = clamp(c.speed / 46, 0, 1); this.cab.needle.rotation.z = 3.8 - v * 4.4;
      } else if (this.cam === 'chase') {
        if (this.lagYaw == null) this.lagYaw = c.yaw; let dy = c.yaw - this.lagYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); this.lagYaw += dy * Math.min(1, dt * 3.2);
        const back = 6.6 + c.speed * 0.045, ly = Math.sin(this.lagYaw), lc = Math.cos(this.lagYaw), tx = c.x - ly * back, tz = c.z - lc * back, k = Math.min(1, dt * 7);
        if (!this.ch) this.ch = new T.Vector3(tx, c.y + 2.9, tz);
        this.ch.x += (tx - this.ch.x) * k; this.ch.y += (c.y + 2.9 - this.ch.y) * k; this.ch.z += (tz - this.ch.z) * k;
        cam.position.copy(this.ch); cam.rotation.order = 'XYZ'; cam.lookAt(c.x + sy * 5, c.y + 1.1, c.z + cy * 5);
      } else {
        if (!this.orb || c.s > this.orb.s + 12) { const sg = Math.random() < 0.5 ? -1 : 1, s = c.s + 90 + Math.random() * 60, p = this.road.at(s), o = sg * (5.3 + Math.random()); this.orb = { s, x: p.x - Math.cos(p.h) * o, y: p.y + 1.6 + Math.random() * 1.8, z: p.z + Math.sin(p.h) * o }; }
        cam.position.set(this.orb.x, this.orb.y, this.orb.z); cam.rotation.order = 'XYZ'; cam.lookAt(c.x, c.y + 1, c.z);
      }
      cam.updateMatrixWorld();
      this.sky.position.copy(cam.position); this.stars.position.copy(cam.position); this.clouds.position.set(cam.position.x, 0, cam.position.z);
      this.sunM.position.set(cam.position.x + sd.x * 1100, cam.position.y + sd.y * 1100, cam.position.z + sd.z * 1100); this.sunM.lookAt(cam.position);
      w.sun.position.set(c.x + sd.x * 200, c.y + sd.y * 200, c.z + sd.z * 200); w.sun.target.position.set(c.x, c.y, c.z);
      this.weather(dt); this.effects(dt); if (this.cam === 'cabin') this.glass(dt);
      w.renderer.clear(); w.renderer.render(this.scene, cam);
      if (this.cam === 'cabin') { w.renderer.clearDepth(); w.renderer.render(this.cabS, this.cabC); }
    }
  }

  window.Drive.Scene = Scene;
})();
