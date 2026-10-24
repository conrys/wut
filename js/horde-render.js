// ==========================================================================
// «Орда» — піксельний рендер.
// Світ малюється в маленький буфер (1 піксель буфера = 2 одиниці світу), а
// потім збільшується цілим множником без згладжування — пікселі чіткі на
// будь-якому екрані. Спрайти будуються з текстових сіток (horde-sprites.js)
// один раз і кешуються, з автоматичною обводкою та «спалахом» удару.
// ==========================================================================
(function () {
  const D = window.HordeData, SP = window.HordeSprites;
  const TAU = Math.PI * 2;
  const WPP = 2;           // одиниць світу на піксель арту
  const TARGET_W = 280;    // бажана ширина буфера в пікселях арту
  const OUTLINE = "#16131d";

  // ------------------------------------------------------------ спрайти
  function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function normalize(rows, mirror) {
    const w = Math.max(...rows.map((r) => r.length));
    return rows.map((r) => {
      const p = r.padEnd(w, ".");
      return mirror ? p + p.split("").reverse().join("") : p;
    });
  }
  // Будує canvas зі сітки: обводка 1px навколо, варіанти: normal / flash / tint.
  function build(rows, opts) {
    const o = opts || {};
    const map = o.map || {};
    const h = rows.length, w = rows[0].length;
    const W = w + 2, H = h + 2;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    const img = g.createImageData(W, H);
    const solid = new Uint8Array(W * H);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let ch = rows[y][x];
      if (ch === ".") continue;
      if (map[ch]) ch = map[ch];
      let col = (o.colors && o.colors[ch]) || SP.PALETTE[ch];
      if (!col) continue;
      if (o.flash) col = "#ffffff";
      else if (o.tint) col = o.tint;
      const [r, gg, b] = hexRgb(col);
      const i = ((y + 1) * W + (x + 1));
      solid[i] = 1;
      img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = Math.round(255 * (o.alpha || 1));
    }
    if (!o.noOutline) {
      const [r, gg, b] = hexRgb(o.outline || OUTLINE);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (solid[i]) continue;
        const n = (x > 0 && solid[i - 1]) || (x < W - 1 && solid[i + 1]) || (y > 0 && solid[i - W]) || (y < H - 1 && solid[i + W]);
        if (n) { img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255; }
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  function scaled(src, k) {
    const c = document.createElement("canvas");
    c.width = src.width * k; c.height = src.height * k;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  const cache = new Map();
  // name — ключ у SPRITES; variant: "" | "flash" | "elite" | "eliteFlash"; frame — індекс кадру
  function sprite(name, frame, variant) {
    const key = name + "|" + frame + "|" + (variant || "");
    let c = cache.get(key);
    if (c) return c;
    const def = SP.SPRITES[name];
    const f = def.frames[frame % def.frames.length];
    const rows = normalize(f, def.mirror);
    const v = variant || "";
    const base = build(rows, {
      map: def.map, alpha: def.alpha,
      flash: v.indexOf("lash") >= 0,
      outline: v.indexOf("elite") === 0 ? "#f4cc4c" : undefined,
    });
    c = v.indexOf("elite") === 0 || def.big ? scaled(base, 2) : base;
    cache.set(key, c);
    return c;
  }
  function bigSprite(name, frame, flash) {
    const key = "big|" + name + "|" + frame + "|" + (flash ? 1 : 0);
    let c = cache.get(key);
    if (c) return c;
    c = scaled(sprite(name, frame, flash ? "flash" : ""), 2);
    cache.set(key, c);
    return c;
  }
  function heroSprite(charId, frame, variant) {
    const key = "hero|" + charId + "|" + frame + "|" + (variant || "");
    let c = cache.get(key);
    if (c) return c;
    const rows = (SP.HEADS[charId] || SP.HEADS.knight).concat(frame ? SP.BODY_B : SP.BODY_A);
    c = build(rows, { colors: SP.HERO_COLORS[charId] || SP.HERO_COLORS.knight, tint: variant === "hurt" ? "#ff5a4a" : undefined });
    cache.set(key, c);
    return c;
  }
  // Іконка для інтерфейсу як dataURL (12×12 + обводка), збільшена ×4.
  const iconCache = new Map();
  function iconURL(name, gold) {
    const key = name + (gold ? "|g" : "");
    if (iconCache.has(key)) return iconCache.get(key);
    const rows = SP.ICONS[name] || SP.ICONS.skull;
    const base = build(normalize(rows), { outline: gold ? "#f4cc4c" : OUTLINE });
    const url = scaled(base, 4).toDataURL();
    iconCache.set(key, url);
    return url;
  }
  function heroURL(charId) {
    const key = "heroicon|" + charId;
    if (iconCache.has(key)) return iconCache.get(key);
    const url = scaled(heroSprite(charId, 0), 4).toDataURL();
    iconCache.set(key, url);
    return url;
  }

  // ------------------------------------------------------- піксельний шрифт
  const DIGITS = {
    0: ["111", "101", "101", "101", "111"], 1: ["010", "110", "010", "010", "111"], 2: ["111", "001", "111", "100", "111"],
    3: ["111", "001", "011", "001", "111"], 4: ["101", "101", "111", "001", "001"], 5: ["111", "100", "111", "001", "111"],
    6: ["111", "100", "111", "101", "111"], 7: ["111", "001", "010", "010", "010"], 8: ["111", "101", "111", "101", "111"],
    9: ["111", "101", "111", "001", "111"],
  };
  function drawNumber(g, str, x, y, color) {
    const w = str.length * 4 - 1;
    let cx = Math.round(x - w / 2);
    y = Math.round(y);
    for (const ch of str) {
      const d = DIGITS[ch];
      if (d) for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (d[r][c] === "1") {
        g.fillStyle = OUTLINE; g.fillRect(cx + c - 1, y + r - 1, 3, 3);
      }
      cx += 4;
    }
    cx = Math.round(x - w / 2);
    g.fillStyle = color;
    for (const ch of str) {
      const d = DIGITS[ch];
      if (d) for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (d[r][c] === "1") g.fillRect(cx + c, y + r, 1, 1);
      cx += 4;
    }
  }

  // ------------------------------------------------------------ земля
  function makeGround() {
    const S = 128;
    const c = document.createElement("canvas");
    c.width = S; c.height = S;
    const g = c.getContext("2d");
    g.fillStyle = "#223b26"; g.fillRect(0, 0, S, S);
    let a = 4242;
    const rnd = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
    // плями відтінків
    for (let i = 0; i < 30; i++) {
      const cx = rnd() * S, cy = rnd() * S, rr = 5 + rnd() * 9;
      g.fillStyle = rnd() < 0.5 ? "#26432a" : "#1e3523";
      for (let y = -rr; y <= rr; y++) for (let x = -rr; x <= rr; x++) {
        if (x * x + y * y * 1.6 > rr * rr) continue;
        if ((x + y) % 2 && x * x + y * y * 1.6 > rr * rr * 0.6) continue; // дизеринг по краю
        g.fillRect(((cx + x) % S + S) % S | 0, ((cy + y) % S + S) % S | 0, 1, 1);
      }
    }
    // шум
    for (let i = 0; i < 520; i++) {
      g.fillStyle = rnd() < 0.5 ? "#2a4a2e" : "#1b3020";
      g.fillRect(rnd() * S | 0, rnd() * S | 0, 1, 1);
    }
    // травинки
    for (let i = 0; i < 70; i++) {
      const x = rnd() * S | 0, y = rnd() * S | 0;
      g.fillStyle = "#3e7d3a"; g.fillRect(x, y, 1, 2); g.fillRect(x + 2, y + 1, 1, 1);
      g.fillStyle = "#5e8c3d"; g.fillRect(x + 1, y - 1, 1, 3);
    }
    // квіточки
    const fl = ["#f4cc4c", "#e07ab8", "#f2ecd9", "#9be7ff"];
    for (let i = 0; i < 7; i++) {
      const x = rnd() * S | 0, y = rnd() * S | 0;
      g.fillStyle = fl[i % fl.length]; g.fillRect(x, y, 1, 1);
      g.fillStyle = "#3e7d3a"; g.fillRect(x, y + 1, 1, 1);
    }
    return c;
  }

  // декор за чанками (детерміновано від координат)
  const PROPS = [["rock", 24], ["bush", 24], ["grave", 14], ["graveOld", 10], ["tree", 10], ["bones", 9], ["mushroom", 7], ["candleProp", 2]];
  const PROP_TOTAL = PROPS.reduce((a, p) => a + p[1], 0);
  const CHUNK = 96; // у пікселях арту
  const chunkCache = new Map();
  function chunkProps(cx, cy) {
    const key = cx + "," + cy;
    let list = chunkCache.get(key);
    if (list) return list;
    let h = (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) >>> 0;
    const rnd = () => { h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
    list = [];
    const n = Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      let r = rnd() * PROP_TOTAL, name = PROPS[0][0];
      for (const p of PROPS) { r -= p[1]; if (r <= 0) { name = p[0]; break; } }
      list.push({ name, x: cx * CHUNK + Math.floor(rnd() * CHUNK), y: cy * CHUNK + Math.floor(rnd() * CHUNK) });
    }
    if (chunkCache.size > 3000) chunkCache.clear();
    chunkCache.set(key, list);
    return list;
  }

  // ------------------------------------------------------------ рендерер
  function create(canvas) {
    const ctx = canvas.getContext("2d");
    const buf = document.createElement("canvas");
    const g = buf.getContext("2d");
    const ground = makeGround();
    const R = { canvas, ctx, buf, g, scale: 1, bw: 0, bh: 0, dpr: 1, cssW: 0, cssH: 0, shakeT: 0, shakeA: 0 };

    R.resize = function (cssW, cssH, dpr) {
      R.cssW = cssW; R.cssH = cssH; R.dpr = dpr;
      const devW = Math.round(cssW * dpr), devH = Math.round(cssH * dpr);
      canvas.width = devW; canvas.height = devH;
      canvas.style.width = cssW + "px"; canvas.style.height = cssH + "px";
      R.scale = Math.max(1, Math.round(devW / TARGET_W));
      R.bw = Math.ceil(devW / R.scale); R.bh = Math.ceil(devH / R.scale);
      buf.width = R.bw + 1; buf.height = R.bh + 1; // +1 px запасу під субпіксельний зсув камери
      return { viewW: R.bw * WPP, viewH: R.bh * WPP };
    };
    R.shake = function (a) { R.shakeA = Math.max(R.shakeA, a); R.shakeT = 0.25; };
    R.cssToArt = (v) => v * R.dpr / R.scale;

    R.render = function (s, t, ui) {
      const opt = ui || {};
      const p = s.player;
      const bw = R.bw, bh = R.bh;
      g.imageSmoothingEnabled = false;

      let sx = 0, sy = 0;
      if (R.shakeT > 0 && opt.shake !== false) {
        R.shakeT -= 1 / 60;
        sx = Math.round((Math.random() * 2 - 1) * R.shakeA);
        sy = Math.round((Math.random() * 2 - 1) * R.shakeA);
        if (R.shakeT <= 0) R.shakeA = 0;
      }
      // інтерполяція між кроками логіки + субпіксельна камера: світ малюється
      // від цілого пікселя, а весь буфер зсувається на дробову частину при виводі
      const A = opt.alpha == null ? 1 : opt.alpha;
      const lx = (o) => (o.px == null ? o.x : o.px + (o.x - o.px) * A);
      const ly = (o) => (o.py == null ? o.y : o.py + (o.y - o.py) * A);
      const PX = lx(p), PY = ly(p);
      const cxf = PX / WPP - bw / 2, cyf = PY / WPP - bh / 2;
      const camX = Math.floor(cxf) + sx, camY = Math.floor(cyf) + sy;
      const fracX = cxf - Math.floor(cxf), fracY = cyf - Math.floor(cyf);
      const ax = (x) => Math.round(x / WPP) - camX;
      const ay = (y) => Math.round(y / WPP) - camY;
      const vis = (x, y, m) => { const X = ax(x), Y = ay(y); return X > -m && X < bw + m && Y > -m && Y < bh + m; };

      // земля
      const GS = ground.width;
      const ox = -(((camX % GS) + GS) % GS), oy = -(((camY % GS) + GS) % GS);
      for (let x = ox; x <= bw; x += GS) for (let y = oy; y <= bh; y += GS) g.drawImage(ground, x, y);

      // декор
      const c0x = Math.floor((camX - 20) / CHUNK), c1x = Math.floor((camX + bw + 20) / CHUNK);
      const c0y = Math.floor((camY - 30) / CHUNK), c1y = Math.floor((camY + bh + 10) / CHUNK);
      for (let cx = c0x; cx <= c1x; cx++) for (let cy = c0y; cy <= c1y; cy++) {
        for (const pr of chunkProps(cx, cy)) {
          const img = sprite(pr.name, 0);
          g.drawImage(img, pr.x - camX - (img.width >> 1), pr.y - camY - img.height);
        }
      }

      // зони (свята вода)
      for (const z of s.zones) {
        if (!vis(z.x, z.y, z.r)) continue;
        const k = Math.min(1, z.life / 0.3);
        pixelDisc(g, ax(z.x), ay(z.y), Math.round(z.r / WPP), `rgba(88,160,232,${0.38 * k})`, `rgba(155,231,255,${0.85 * k})`, t);
      }
      // аура
      for (const w of s.weapons) {
        if (D.WEAPONS[w.id].behavior !== "aura") continue;
        const ws = HordeCore.weaponStats(s, w);
        const r = Math.round(52 * ws.area / WPP);
        pixelDisc(g, ax(PX), ay(PY), r,
          ws.flags.heal ? `rgba(160,102,224,${0.16 + (w.pulse || 0) * 0.18})` : `rgba(242,236,217,${0.1 + (w.pulse || 0) * 0.16})`,
          ws.flags.heal ? "rgba(200,170,255,.6)" : "rgba(242,236,217,.4)", t, true);
      }

      // предмети
      for (const pk of s.pickups) {
        if (!vis(pk.x, pk.y, 12)) continue;
        let img;
        const bob = Math.round(Math.sin(t * 4 + pk.x * 0.1));
        if (pk.kind === "gem") img = sprite(pk.v >= 25 ? "gemR" : pk.v >= 5 ? "gemG" : "gemB", 0);
        else if (pk.kind === "coin") img = sprite("coin", Math.floor(t * 8 + pk.x) % 4);
        else if (pk.kind === "food") img = sprite("food", 0);
        else if (pk.kind === "vortex") img = sprite("vortex", 0);
        else if (pk.kind === "chest") {
          img = sprite("chest", 0);
          const X = ax(pk.x), Y = ay(pk.y);
          if (Math.floor(t * 4) % 2) { g.fillStyle = "rgba(244,204,76,.35)"; g.fillRect(X - 9, Y - 8, 18, 14); }
        }
        if (img) g.drawImage(img, ax(pk.x) - (img.width >> 1), ay(pk.y) - (img.height >> 1) + bob);
      }

      // тіні + вороги (сортуємо за y, щоб нижні перекривали верхніх)
      const list = [];
      for (const e of s.enemies) if (vis(e.x, e.y, 40)) list.push(e);
      list.sort((a, b) => a.y - b.y);
      for (const e of list) {
        const X = ax(lx(e)), Y = ay(ly(e));
        const rr = Math.max(3, Math.round(e.r / WPP));
        g.fillStyle = "rgba(10,8,16,.35)";
        g.fillRect(X - rr + 1, Y + rr - 1, rr * 2 - 2, 2);
      }
      let playerDrawn = !!opt.noPlayer;
      for (const e of list) {
        if (!playerDrawn && e.y > p.y) { drawPlayer(g, s, ax(PX), ay(PY), t); playerDrawn = true; }
        const def = D.ENEMIES[e.type];
        const frame = def.shape === "bat" || def.shape === "wolf" || def.shape === "ghost" ? Math.floor(t * 6 + e.id) % 2 : 0;
        const flash = e.flash > 0;
        let img;
        if (e.boss) img = bigSprite(def.shape, frame, flash);
        else if (e.elite) img = sprite(def.shape, frame, flash ? "eliteFlash" : "elite");
        else img = sprite(def.shape, frame, flash ? "flash" : "");
        const bob = def.fly ? Math.round(Math.sin(e.phase) * 1.5) : (Math.floor(e.phase * 0.6) % 2 ? -1 : 0);
        const EX = ax(lx(e)), EY = ay(ly(e));
        const X = EX - (img.width >> 1), Y = EY - (img.height >> 1) + bob;
        const flip = e.dirX ? e.dirX < 0 : e.x > p.x;
        if (flip) { g.save(); g.translate(X + img.width, Y); g.scale(-1, 1); g.drawImage(img, 0, 0); g.restore(); }
        else g.drawImage(img, X, Y);
        if (def.shape === "reaper") {
          const sc = bigSprite("scythe", 0, flash);
          g.drawImage(sc, EX + (flip ? -sc.width - 8 : 8), Y - 6);
        }
      }
      if (!playerDrawn) drawPlayer(g, s, ax(PX), ay(PY), t);

      // книги-вартові
      for (const w of s.weapons) {
        if (D.WEAPONS[w.id].behavior !== "orbit" || w.active <= 0) continue;
        const ws = HordeCore.weaponStats(s, w);
        const R0 = 72 * ws.area;
        const img = sprite(ws.flags.permanent ? "bookGold" : "book", 0);
        for (let i = 0; i < ws.amount; i++) {
          const a = w.angle + (i / ws.amount) * TAU;
          const X = ax(PX + Math.cos(a) * R0), Y = ay(PY + Math.sin(a) * R0);
          g.drawImage(img, X - (img.width >> 1), Y - (img.height >> 1));
        }
      }

      // снаряди
      for (const pr of s.projectiles) {
        if (!vis(pr.x, pr.y, 10)) continue;
        const img = sprite(pr.kind === "arrow" ? "arrow" : pr.kind === "knife" ? "knife" : "axe", 0);
        const X = ax(lx(pr)), Y = ay(ly(pr));
        const ang = pr.kind === "axe" ? Math.round((pr.spin || 0) / (Math.PI / 4)) * (Math.PI / 4) : Math.atan2(pr.vy, pr.vx);
        g.save(); g.translate(X, Y); g.rotate(ang);
        const k = pr.kind === "axe" ? Math.max(1, Math.round(pr.r / 11)) : 1;
        g.drawImage(img, -(img.width * k >> 1), -(img.height * k >> 1), img.width * k, img.height * k);
        g.restore();
      }

      // ефекти
      for (const f of s.fx) drawFx(g, f, ax, ay, t);

      // цифри шкоди
      if (opt.numbers !== false) for (const n of s.nums) {
        const k = n.t / 0.6;
        drawNumber(g, String(n.v), ax(n.x), ay(n.y) - 4 - Math.round(k * 8), k < 0.15 ? "#ffe25a" : "#f2ecd9");
      }

      // стрілка до боса
      const b = s.bossAlive;
      if (b && !b.dead && !vis(b.x, b.y, -6)) {
        const a = Math.atan2(b.y - p.y, b.x - p.x);
        const ex = Math.max(8, Math.min(bw - 8, bw / 2 + Math.cos(a) * (bw / 2 - 10)));
        const ey = Math.max(30, Math.min(bh - 10, bh / 2 + Math.sin(a) * (bh / 2 - 14)));
        g.save(); g.translate(Math.round(ex), Math.round(ey)); g.rotate(a);
        g.fillStyle = OUTLINE; g.fillRect(-4, -4, 9, 9);
        g.fillStyle = "#ff4636";
        for (let i = 0; i < 4; i++) g.fillRect(-3 + i, -3 + i, 1, 7 - i * 2);
        g.restore();
      }
      // смуга здоров'я боса
      if (b && !b.dead) {
        const W = Math.min(bw - 24, 160), X = Math.round((bw - W) / 2), Y = bh - 14;
        g.fillStyle = OUTLINE; g.fillRect(X - 1, Y - 1, W + 2, 6);
        g.fillStyle = "#4a1a24"; g.fillRect(X, Y, W, 4);
        g.fillStyle = "#d23c3c"; g.fillRect(X, Y, Math.round(W * Math.max(0, b.hp / b.maxHp)), 4);
        g.fillStyle = "#ff8a7a"; g.fillRect(X, Y, Math.round(W * Math.max(0, b.hp / b.maxHp)), 1);
      }

      // нічна віньєтка + червона при малому здоров'ї
      vignette(g, bw, bh, p.hp / s.stats.maxHp, t);

      // джойстик
      const j = opt.joy;
      if (j && (j.active || j.always)) {
        const cx = Math.round(R.cssToArt(j.ox)), cy = Math.round(R.cssToArt(j.oy));
        const rr = Math.round(R.cssToArt(j.R));
        ring(g, cx, cy, rr, j.active ? "rgba(242,236,217,.45)" : "rgba(242,236,217,.22)");
        ring(g, cx, cy, rr - 1, "rgba(22,19,29,.35)");
        const kx = Math.round(cx + j.x * rr), ky = Math.round(cy + j.y * rr);
        const kr = Math.max(4, Math.round(rr * 0.42));
        disc(g, kx, ky, kr, j.active ? "rgba(242,236,217,.55)" : "rgba(242,236,217,.25)");
      }

      // буфер → екран
      ctx.imageSmoothingEnabled = false;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(buf, -Math.round(fracX * R.scale), -Math.round(fracY * R.scale), (bw + 1) * R.scale, (bh + 1) * R.scale);
    };
    return R;
  }

  // ------------------------------------------------------------ персонаж
  function drawPlayer(g, s, X, Y, t) {
    const p = s.player;
    g.fillStyle = "rgba(10,8,16,.4)"; g.fillRect(X - 4, Y + 7, 9, 2);
    if (p.inv > 0 && Math.floor(t * 20) % 2 === 0) return;
    const frame = p.moving ? Math.floor(t * 8) % 2 : 0;
    const img = heroSprite(s.charId, frame, p.hurt > 0 ? "hurt" : "");
    const bx = X - (img.width >> 1), by = Y - img.height + 8;
    if (p.fx < 0) { g.save(); g.translate(bx + img.width, by); g.scale(-1, 1); g.drawImage(img, 0, 0); g.restore(); }
    else g.drawImage(img, bx, by);
    // здоров'я під ногами
    const frac = Math.max(0, p.hp / s.stats.maxHp);
    g.fillStyle = OUTLINE; g.fillRect(X - 7, Y + 10, 15, 3);
    g.fillStyle = "#4a1a24"; g.fillRect(X - 6, Y + 11, 13, 1);
    g.fillStyle = frac > 0.3 ? "#d23c3c" : "#ff4636"; g.fillRect(X - 6, Y + 11, Math.round(13 * frac), 1);
  }

  // ------------------------------------------------------------ примітиви
  function disc(g, cx, cy, r, color) {
    g.fillStyle = color;
    for (let y = -r; y <= r; y++) {
      const w = Math.round(Math.sqrt(r * r - y * y));
      g.fillRect(cx - w, cy + y, w * 2 + 1, 1);
    }
  }
  function ring(g, cx, cy, r, color) {
    g.fillStyle = color;
    let x = r, y = 0, err = 1 - r;
    while (x >= y) {
      const pts = [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]];
      for (const [px, py] of pts) g.fillRect(cx + px, cy + py, 1, 1);
      y++;
      if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
    }
  }
  // диск із дизерингом і краєм, що «дихає»
  function pixelDisc(g, cx, cy, r, fill, edge, t, sparse) {
    g.fillStyle = fill;
    for (let y = -r; y <= r; y++) {
      const w = Math.round(Math.sqrt(r * r - y * y));
      if (sparse) { for (let x = -w; x <= w; x++) if (((x + y + cx + cy) & 1) === 0) g.fillRect(cx + x, cy + y, 1, 1); }
      else g.fillRect(cx - w, cy + y, w * 2 + 1, 1);
    }
    ring(g, cx, cy, r, edge);
    const sp = Math.floor(t * 10);
    g.fillStyle = edge;
    for (let i = 0; i < 6; i++) {
      const a = i * 1.05 + sp * 0.2;
      g.fillRect(Math.round(cx + Math.cos(a) * r * 0.6), Math.round(cy + Math.sin(a) * r * 0.6), 1, 1);
    }
  }
  function vignette(g, bw, bh, hpk, t) {
    const grd = g.createRadialGradient(bw / 2, bh / 2, Math.min(bw, bh) * 0.35, bw / 2, bh / 2, Math.max(bw, bh) * 0.72);
    grd.addColorStop(0, "rgba(10,8,22,0)");
    grd.addColorStop(1, "rgba(10,8,22,.55)");
    g.fillStyle = grd; g.fillRect(0, 0, bw, bh);
    if (hpk < 0.3) {
      const k = (0.3 - hpk) * 1.8 * (0.8 + 0.2 * Math.sin(t * 6));
      const r = g.createRadialGradient(bw / 2, bh / 2, Math.min(bw, bh) * 0.3, bw / 2, bh / 2, Math.max(bw, bh) * 0.7);
      r.addColorStop(0, "rgba(160,0,0,0)"); r.addColorStop(1, `rgba(170,10,20,${k})`);
      g.fillStyle = r; g.fillRect(0, 0, bw, bh);
    }
  }

  function drawFx(g, f, ax, ay, t) {
    const k = f.t / f.life;
    if (f.kind === "slash") {
      const X = ax(f.x), Y = ay(f.y);
      const hw = Math.round(f.w / WPP / 2), hh = Math.max(2, Math.round(f.h / WPP / 2 * (1 - k * 0.4)));
      const col = f.evo ? "255,90,110" : "242,236,217";
      // дуга-серп: зовнішній край яскравий, всередині прозоріше
      for (let y = -hh; y <= hh; y++) {
        const w = Math.round(hw * Math.sqrt(1 - (y * y) / (hh * hh + 0.01)));
        const shift = Math.round(f.side * (hh - Math.abs(y)) * 0.6);
        g.fillStyle = `rgba(${col},${(0.35 * (1 - k)).toFixed(2)})`;
        g.fillRect(X - w + shift, Y + y, w * 2, 1);
        g.fillStyle = `rgba(${col},${(0.95 * (1 - k)).toFixed(2)})`;
        g.fillRect(f.side > 0 ? X + w + shift - 2 : X - w + shift, Y + y, 2, 1);
      }
    } else if (f.kind === "puff") {
      const X = ax(f.x), Y = ay(f.y);
      g.fillStyle = f.color;
      const n = 6, d = Math.round(2 + k * (f.r / WPP + 3));
      for (let i = 0; i < n; i++) {
        if (k > 0.7 && i % 2) continue;
        const a = i * (TAU / n) + f.x;
        const s = k < 0.5 ? 2 : 1;
        g.fillRect(Math.round(X + Math.cos(a) * d), Math.round(Y + Math.sin(a) * d), s, s);
      }
      if (k < 0.3) { g.fillStyle = "#f2ecd9"; g.fillRect(X - 1, Y - 1, 2, 2); }
    } else if (f.kind === "bolt") {
      const X = ax(f.x), Y = ay(f.y);
      const fx = f.fromX != null ? ax(f.fromX) : X + 4, fy = f.fromY != null ? ay(f.fromY) : Y - 200;
      if (Math.floor(t * 30) % 2 || k < 0.4) {
        let px = fx, py = fy;
        const seg = 7;
        for (let i = 1; i <= seg; i++) {
          const q = i / seg;
          const nx = i === seg ? X : Math.round(fx + (X - fx) * q + Math.sin(i * 12.9 + f.x) * 5);
          const ny = i === seg ? Y : Math.round(fy + (Y - fy) * q);
          line(g, px, py, nx, ny, k < 0.5 ? "#ffffff" : "#ffe25a");
          px = nx; py = ny;
        }
      }
      ring(g, X, Y, Math.round(f.r / WPP * (0.6 + k * 0.4)), `rgba(255,226,90,${(1 - k).toFixed(2)})`);
    } else if (f.kind === "ring") {
      ring(g, ax(f.x), ay(f.y), Math.max(1, Math.round(f.r / WPP * k)), f.color);
    } else if (f.kind === "heal") {
      const X = ax(f.x), Y = ay(f.y) - 14 - Math.round(k * 10);
      g.fillStyle = "#86c556";
      g.fillRect(X - 5, Y, 3, 1); g.fillRect(X - 4, Y - 1, 1, 3);
      g.fillRect(X + 3, Y + 3, 3, 1); g.fillRect(X + 4, Y + 2, 1, 3);
    }
  }
  function line(g, x0, y0, x1, y1, color) {
    g.fillStyle = color;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let i = 0; i < 600; i++) {
      g.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  window.HordeRender = { create, sprite, heroSprite, iconURL, heroURL, WPP };
})();
