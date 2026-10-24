// ==========================================================================
// «Орда» — малювання стану з horde-core.js на canvas. Нічого не змінює в
// стані гри. Вороги малюються простими фігурами один раз у кеш-спрайти
// (offscreen canvas), далі — лише drawImage: так 300+ ворогів не гальмують.
// ==========================================================================
(function () {
  const D = window.HordeData;
  const TAU = Math.PI * 2;

  function makeCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.ceil(w); c.height = Math.ceil(h);
    return c;
  }

  // ---------- фігури ворогів (у локальних координатах, радіус r) ----------
  function eyes(ctx, r, ox, oy, col, size) {
    ctx.fillStyle = col || "#ffe36b";
    const s = size || r * 0.18;
    ctx.beginPath(); ctx.arc(-r * 0.3 + (ox || 0), -r * 0.15 + (oy || 0), s, 0, TAU); ctx.arc(r * 0.3 + (ox || 0), -r * 0.15 + (oy || 0), s, 0, TAU); ctx.fill();
  }
  const SHAPES = {
    bat(ctx, r, c, frame) {
      const flap = frame ? 0.35 : -0.15;
      ctx.fillStyle = shade(c, -0.25);
      for (const sgn of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(sgn * r * 2.1, -r * (0.6 + flap));
        ctx.lineTo(sgn * r * 1.6, r * 0.2);
        ctx.lineTo(sgn * r * 1.1, -r * 0.1 + flap * r);
        ctx.lineTo(sgn * r * 0.7, r * 0.5);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, 0, r * 0.8, 0, TAU); ctx.fill();
      eyes(ctx, r * 0.8, 0, 0, "#ff5a5a");
    },
    zombie(ctx, r, c) {
      ctx.fillStyle = shade(c, -0.3); ctx.beginPath(); ctx.ellipse(0, r * 0.35, r * 0.95, r * 0.75, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, -r * 0.1, r * 0.82, 0, TAU); ctx.fill();
      ctx.fillStyle = "#1b1f14"; ctx.fillRect(-r * 0.4, -r * 0.3, r * 0.25, r * 0.22); ctx.fillRect(r * 0.15, -r * 0.35, r * 0.28, r * 0.28);
      ctx.fillRect(-r * 0.35, r * 0.25, r * 0.7, r * 0.12);
      // простягнуті руки
      ctx.fillStyle = c; ctx.fillRect(-r * 1.15, r * 0.05, r * 0.45, r * 0.28); ctx.fillRect(r * 0.7, r * 0.05, r * 0.45, r * 0.28);
    },
    skeleton(ctx, r, c) {
      ctx.fillStyle = shade(c, -0.15); ctx.fillRect(-r * 0.35, r * 0.4, r * 0.7, r * 0.6);
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, -r * 0.05, r * 0.85, 0, TAU); ctx.fill();
      ctx.fillStyle = "#1a1a22";
      ctx.beginPath(); ctx.arc(-r * 0.32, -r * 0.1, r * 0.22, 0, TAU); ctx.arc(r * 0.32, -r * 0.1, r * 0.22, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, r * 0.12); ctx.lineTo(-r * 0.1, r * 0.3); ctx.lineTo(r * 0.1, r * 0.3); ctx.fill();
      for (let i = -2; i <= 2; i++) ctx.fillRect(i * r * 0.15 - r * 0.04, r * 0.45, r * 0.08, r * 0.2);
    },
    wolf(ctx, r, c) {
      ctx.fillStyle = shade(c, -0.25);
      ctx.beginPath(); ctx.moveTo(-r * 0.75, -r * 0.4); ctx.lineTo(-r * 0.55, -r * 1.15); ctx.lineTo(-r * 0.15, -r * 0.6); ctx.fill();
      ctx.beginPath(); ctx.moveTo(r * 0.75, -r * 0.4); ctx.lineTo(r * 0.55, -r * 1.15); ctx.lineTo(r * 0.15, -r * 0.6); ctx.fill();
      ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(0, 0, r * 0.95, r * 0.8, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = shade(c, 0.35); ctx.beginPath(); ctx.ellipse(0, r * 0.35, r * 0.45, r * 0.32, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "#111"; ctx.beginPath(); ctx.arc(0, r * 0.22, r * 0.12, 0, TAU); ctx.fill();
      eyes(ctx, r, 0, -r * 0.05, "#ffcf3a", r * 0.13);
    },
    ghost(ctx, r, c) {
      ctx.globalAlpha = 0.82;
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(0, -r * 0.15, r * 0.9, Math.PI, 0);
      ctx.lineTo(r * 0.9, r * 0.8);
      for (let i = 0; i < 4; i++) {
        const x0 = r * 0.9 - (i + 0.5) * r * 0.45;
        ctx.quadraticCurveTo(x0, (i % 2 ? r * 1.1 : r * 0.5), r * 0.9 - (i + 1) * r * 0.45, r * 0.8);
      }
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#1c2a40";
      ctx.beginPath(); ctx.ellipse(-r * 0.3, -r * 0.2, r * 0.16, r * 0.24, 0, 0, TAU); ctx.ellipse(r * 0.3, -r * 0.2, r * 0.16, r * 0.24, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, r * 0.25, r * 0.15, r * 0.2, 0, 0, TAU); ctx.fill();
    },
    cultist(ctx, r, c) {
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.moveTo(0, -r * 1.2); ctx.lineTo(r * 0.95, r * 0.95); ctx.lineTo(-r * 0.95, r * 0.95); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#14080c"; ctx.beginPath(); ctx.ellipse(0, -r * 0.05, r * 0.42, r * 0.5, 0, 0, TAU); ctx.fill();
      eyes(ctx, r * 0.7, 0, -r * 0.05, "#ff3b3b", r * 0.1);
    },
    golem(ctx, r, c) {
      ctx.fillStyle = shade(c, -0.3); roundRect(ctx, -r, -r * 0.8, r * 2, r * 1.8, r * 0.35); ctx.fill();
      ctx.fillStyle = c; roundRect(ctx, -r * 0.85, -r * 0.95, r * 1.7, r * 1.6, r * 0.3); ctx.fill();
      ctx.strokeStyle = shade(c, -0.45); ctx.lineWidth = Math.max(1, r * 0.08);
      ctx.beginPath(); ctx.moveTo(-r * 0.5, -r * 0.9); ctx.lineTo(-r * 0.2, -r * 0.4); ctx.lineTo(-r * 0.4, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(r * 0.6, r * 0.1); ctx.lineTo(r * 0.3, r * 0.45); ctx.stroke();
      eyes(ctx, r, 0, -r * 0.15, "#7df7ff", r * 0.13);
    },
    ogre(ctx, r, c) {
      ctx.fillStyle = shade(c, -0.3); ctx.beginPath(); ctx.ellipse(0, r * 0.25, r, r * 0.8, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, -r * 0.1, r * 0.8, 0, TAU); ctx.fill();
      ctx.fillStyle = "#f2ead0";
      ctx.beginPath(); ctx.moveTo(-r * 0.35, r * 0.25); ctx.lineTo(-r * 0.25, -r * 0.05); ctx.lineTo(-r * 0.15, r * 0.25); ctx.fill();
      ctx.beginPath(); ctx.moveTo(r * 0.35, r * 0.25); ctx.lineTo(r * 0.25, -r * 0.05); ctx.lineTo(r * 0.15, r * 0.25); ctx.fill();
      eyes(ctx, r * 0.8, 0, -r * 0.15, "#ffdd33", r * 0.1);
      ctx.fillStyle = "#5a3b1f"; ctx.fillRect(r * 0.75, -r * 0.6, r * 0.22, r * 1.2); // кийок
    },
    lich(ctx, r, c) {
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.moveTo(0, -r * 0.9); ctx.lineTo(r, r); ctx.lineTo(-r, r); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#e6e0cc"; ctx.beginPath(); ctx.arc(0, -r * 0.3, r * 0.45, 0, TAU); ctx.fill();
      ctx.fillStyle = "#0b1a24"; ctx.beginPath(); ctx.arc(-r * 0.17, -r * 0.35, r * 0.11, 0, TAU); ctx.arc(r * 0.17, -r * 0.35, r * 0.11, 0, TAU); ctx.fill();
      ctx.fillStyle = "#e8c84a"; // корона
      ctx.beginPath(); ctx.moveTo(-r * 0.45, -r * 0.65); ctx.lineTo(-r * 0.3, -r * 1.0); ctx.lineTo(-r * 0.1, -r * 0.72); ctx.lineTo(0, -r * 1.1);
      ctx.lineTo(r * 0.1, -r * 0.72); ctx.lineTo(r * 0.3, -r * 1.0); ctx.lineTo(r * 0.45, -r * 0.65); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#7fe0ff"; ctx.beginPath(); ctx.arc(r * 0.85, -r * 0.4, r * 0.18, 0, TAU); ctx.fill();
    },
    reaper(ctx, r, c) {
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.moveTo(0, -r * 1.1); ctx.quadraticCurveTo(r * 1.1, -r * 0.6, r * 0.9, r); ctx.lineTo(-r * 0.9, r); ctx.quadraticCurveTo(-r * 1.1, -r * 0.6, 0, -r * 1.1); ctx.fill();
      ctx.fillStyle = "#000"; ctx.beginPath(); ctx.ellipse(0, -r * 0.3, r * 0.45, r * 0.5, 0, 0, TAU); ctx.fill();
      eyes(ctx, r * 0.7, 0, -r * 0.25, "#ff2b2b", r * 0.1);
      ctx.strokeStyle = "#c9ccd6"; ctx.lineWidth = r * 0.1;
      ctx.beginPath(); ctx.moveTo(r * 0.9, r * 0.9); ctx.lineTo(r * 0.9, -r * 1.1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(r * 0.9, -r * 1.1); ctx.quadraticCurveTo(r * 0.1, -r * 1.3, -r * 0.3, -r * 0.7); ctx.stroke();
    },
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function shade(h, k) {
    const c = hexRgb(h);
    const f = (v) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k);
    return `rgb(${f(c[0])},${f(c[1])},${f(c[2])})`;
  }

  // ---------- кеш спрайтів ----------
  const cache = new Map();
  function sprite(type, scale, frame, flash, dpr) {
    const key = `${type}|${scale}|${frame}|${flash ? 1 : 0}|${dpr}`;
    let c = cache.get(key);
    if (c) return c;
    const def = D.ENEMIES[type];
    const r = def.r * scale;
    const pad = r * 1.4 + 4;
    const size = (r * 2 + pad * 2) * dpr;
    c = makeCanvas(size, size);
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    g.translate(r + pad, r + pad);
    // тінь
    g.fillStyle = "rgba(0,0,0,.28)";
    g.beginPath(); g.ellipse(0, r * 0.95, r * 0.9, r * 0.32, 0, 0, TAU); g.fill();
    SHAPES[def.shape](g, r, def.color, frame);
    if (flash) {
      g.globalCompositeOperation = "source-atop";
      g.fillStyle = "rgba(255,255,255,.85)";
      g.fillRect(-r - pad, -r - pad, r * 2 + pad * 2, r * 2 + pad * 2);
      g.globalCompositeOperation = "source-over";
    }
    c._half = (r + pad);
    cache.set(key, c);
    return c;
  }

  // ---------- земля ----------
  let groundTile = null;
  function makeGround(dpr) {
    const S = 256;
    const c = makeCanvas(S * dpr, S * dpr);
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    g.fillStyle = "#1f2b20"; g.fillRect(0, 0, S, S);
    let a = 1337;
    const r = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
    for (let i = 0; i < 26; i++) { // плями
      g.fillStyle = r() < 0.5 ? "rgba(40,58,38,.55)" : "rgba(24,34,26,.6)";
      const x = r() * S, y = r() * S, rr = 10 + r() * 30;
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { g.beginPath(); g.ellipse(x + ox, y + oy, rr, rr * 0.7, 0, 0, TAU); g.fill(); }
    }
    for (let i = 0; i < 70; i++) { // травинки
      const x = r() * S, y = r() * S;
      g.strokeStyle = r() < 0.5 ? "rgba(90,130,70,.45)" : "rgba(60,95,55,.5)";
      g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - 2, y - 5); g.moveTo(x, y); g.lineTo(x + 2, y - 6); g.stroke();
    }
    for (let i = 0; i < 7; i++) { // камінці
      const x = r() * S, y = r() * S;
      g.fillStyle = "rgba(120,120,110,.35)";
      g.beginPath(); g.ellipse(x, y, 3 + r() * 3, 2 + r() * 2, 0, 0, TAU); g.fill();
    }
    for (let i = 0; i < 6; i++) { // квіточки
      const x = r() * S, y = r() * S;
      g.fillStyle = r() < 0.5 ? "rgba(230,200,90,.5)" : "rgba(200,150,220,.45)";
      g.beginPath(); g.arc(x, y, 1.6, 0, TAU); g.fill();
    }
    c._size = S;
    return c;
  }

  // ---------- персонаж ----------
  function drawPlayer(ctx, s, t) {
    const p = s.player;
    const ch = D.CHARACTERS[s.charId];
    const bob = p.moving ? Math.sin(t * 14) * 1.6 : Math.sin(t * 3) * 0.6;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = "rgba(0,0,0,.3)";
    ctx.beginPath(); ctx.ellipse(0, 12, 12, 4.5, 0, 0, TAU); ctx.fill();
    ctx.translate(0, bob);
    ctx.scale(p.fx >= 0 ? 1 : -1, 1);
    const blink = p.inv > 0 && Math.floor(t * 20) % 2 === 0;
    if (blink) ctx.globalAlpha = 0.45;
    // плащ
    ctx.fillStyle = ch.cape;
    ctx.beginPath(); ctx.moveTo(-6, -6); ctx.quadraticCurveTo(-16 - (p.moving ? 3 : 0), 4, -11, 12); ctx.lineTo(4, 12); ctx.closePath(); ctx.fill();
    // тіло
    ctx.fillStyle = shade(ch.color, -0.25); roundRect(ctx, -8, -2, 16, 14, 4); ctx.fill();
    // голова
    ctx.fillStyle = ch.color; ctx.beginPath(); ctx.arc(0, -8, 9, 0, TAU); ctx.fill();
    ctx.fillStyle = "#1a1c22"; roundRect(ctx, 1, -10, 7, 4, 2); ctx.fill();   // очі/забрало
    ctx.fillStyle = "#fff"; ctx.fillRect(5, -9.5, 1.6, 1.6);
    if (p.hurt > 0) { ctx.globalCompositeOperation = "source-atop"; ctx.fillStyle = "rgba(255,60,60,.6)"; ctx.fillRect(-20, -20, 40, 40); }
    ctx.restore();
    // смужка здоров'я
    const w = 30, frac = Math.max(0, p.hp / s.stats.maxHp);
    ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(p.x - w / 2, p.y + 18, w, 4);
    ctx.fillStyle = frac > 0.35 ? "#e04a4a" : "#ff2d2d"; ctx.fillRect(p.x - w / 2, p.y + 18, w * frac, 4);
  }

  // ---------- головний рендер ----------
  function render(ctx, s, view, t, joy) {
    const { W, H, dpr } = view;
    const p = s.player;
    if (!groundTile || groundTile._dpr !== dpr) { groundTile = makeGround(dpr); groundTile._dpr = dpr; }
    const camX = p.x - W / 2, camY = p.y - H / 2;

    // земля
    const S = groundTile._size;
    const ox = -(((camX % S) + S) % S), oy = -(((camY % S) + S) % S);
    for (let x = ox; x < W; x += S) for (let y = oy; y < H; y += S) ctx.drawImage(groundTile, x, y, S, S);

    ctx.save();
    ctx.translate(-camX, -camY);
    const inView = (x, y, m) => x > camX - m && x < camX + W + m && y > camY - m && y < camY + H + m;

    // зони (свята вода)
    for (const z of s.zones) {
      if (!inView(z.x, z.y, z.r)) continue;
      const k = Math.min(1, z.life / 0.3);
      const g = ctx.createRadialGradient(z.x, z.y, z.r * 0.2, z.x, z.y, z.r);
      g.addColorStop(0, `rgba(120,200,255,${0.55 * k})`); g.addColorStop(1, `rgba(60,130,255,${0.15 * k})`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = `rgba(190,235,255,${0.7 * k})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r * (0.85 + 0.1 * Math.sin(t * 8 + z.x)), 0, TAU); ctx.stroke();
    }

    // аура
    for (const w of s.weapons) {
      if (D.WEAPONS[w.id].behavior !== "aura") continue;
      const ws = HordeCore.weaponStats(s, w);
      const R = 52 * ws.area;
      ctx.fillStyle = ws.flags.heal ? `rgba(200,170,255,${0.13 + (w.pulse || 0) * 0.15})` : `rgba(255,240,200,${0.1 + (w.pulse || 0) * 0.15})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, TAU); ctx.fill();
      ctx.strokeStyle = ws.flags.heal ? "rgba(200,170,255,.35)" : "rgba(255,240,200,.3)"; ctx.lineWidth = 1.5; ctx.stroke();
    }

    // предмети
    for (const pk of s.pickups) {
      if (!inView(pk.x, pk.y, 20)) continue;
      drawPickup(ctx, pk, t);
    }

    // вороги
    const frame = Math.floor(t * 8) % 2;
    for (const e of s.enemies) {
      if (!inView(e.x, e.y, e.r * 3)) continue;
      const scale = e.elite ? 1.6 : 1;
      const img = sprite(e.type, scale, D.ENEMIES[e.type].shape === "bat" ? frame : 0, e.flash > 0, dpr);
      const h = img._half;
      const wob = D.ENEMIES[e.type].fly ? Math.sin(e.phase) * 2 : Math.sin(e.phase * 0.7) * 0.8;
      const flip = e.x > p.x ? -1 : 1;
      if (flip < 0) {
        ctx.save(); ctx.translate(e.x, e.y + wob); ctx.scale(-1, 1); ctx.drawImage(img, -h, -h, h * 2, h * 2); ctx.restore();
      } else ctx.drawImage(img, e.x - h, e.y - h + wob, h * 2, h * 2);
      if (e.elite || e.boss) {
        ctx.strokeStyle = e.boss ? "rgba(255,80,80,.8)" : "rgba(255,210,80,.85)"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(e.x, e.y + wob, e.r + 4 + Math.sin(t * 6) * 1.5, 0, TAU); ctx.stroke();
      }
    }

    // орбіти (книги)
    for (const w of s.weapons) {
      if (D.WEAPONS[w.id].behavior !== "orbit" || w.active <= 0) continue;
      const ws = HordeCore.weaponStats(s, w);
      const R = 72 * ws.area, br = 11 * ws.area;
      for (let i = 0; i < ws.amount; i++) {
        const a = w.angle + (i / ws.amount) * TAU;
        const x = p.x + Math.cos(a) * R, y = p.y + Math.sin(a) * R;
        ctx.save(); ctx.translate(x, y); ctx.rotate(a + Math.PI / 2);
        ctx.fillStyle = ws.flags.permanent ? "#e9c45a" : "#8a3b2f"; roundRect(ctx, -br * 0.8, -br, br * 1.6, br * 2, 2); ctx.fill();
        ctx.fillStyle = "#f3ead2"; ctx.fillRect(-br * 0.55, -br * 0.8, br * 1.1, br * 1.6);
        ctx.fillStyle = ws.flags.permanent ? "#8a5a1a" : "#8a3b2f"; ctx.fillRect(-br * 0.1, -br * 0.8, br * 0.2, br * 1.6);
        ctx.restore();
      }
    }

    if (!view.noPlayer) drawPlayer(ctx, s, t);

    // снаряди
    for (const pr of s.projectiles) {
      if (!inView(pr.x, pr.y, 30)) continue;
      drawProjectile(ctx, pr);
    }

    // ефекти
    for (const f of s.fx) drawFx(ctx, f, t);

    // цифри шкоди
    ctx.font = "700 11px Inter, sans-serif";
    ctx.textAlign = "center";
    for (const n of s.nums) {
      const k = n.t / 0.6;
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = "#000"; ctx.fillText(n.v, n.x + 1, n.y - k * 18 + 1);
      ctx.fillStyle = "#fff"; ctx.fillText(n.v, n.x, n.y - k * 18);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // стрілка до боса за екраном
    const b = s.bossAlive;
    if (b && !b.dead && !inView(b.x, b.y, -10)) {
      const a = Math.atan2(b.y - p.y, b.x - p.x);
      const ex = W / 2 + Math.cos(a) * (W / 2 - 26), ey = H / 2 + Math.sin(a) * (H / 2 - 40);
      ctx.save(); ctx.translate(Math.max(20, Math.min(W - 20, ex)), Math.max(70, Math.min(H - 30, ey))); ctx.rotate(a);
      ctx.fillStyle = "#ff4d4d"; ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-8, -9); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // віньєтка при низькому здоров'ї
    const hpk = p.hp / s.stats.maxHp;
    if (hpk < 0.3) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      g.addColorStop(0, "rgba(160,0,0,0)"); g.addColorStop(1, `rgba(160,0,0,${(0.3 - hpk) * 1.6 * (0.8 + 0.2 * Math.sin(t * 6))})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }

    // джойстик
    if (joy && joy.active) {
      ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.lineWidth = 2;
      ctx.fillStyle = "rgba(255,255,255,.06)";
      ctx.beginPath(); ctx.arc(joy.ox, joy.oy, joy.R, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.35)";
      ctx.beginPath(); ctx.arc(joy.ox + joy.x * joy.R, joy.oy + joy.y * joy.R, 20, 0, TAU); ctx.fill();
    }
  }

  function drawPickup(ctx, pk, t) {
    const y = pk.y + Math.sin(t * 4 + pk.x) * 1.5;
    if (pk.kind === "gem") {
      const col = pk.v >= 25 ? "#ff5a6a" : pk.v >= 5 ? "#5ae07a" : "#5ab4ff";
      const s = pk.v >= 25 ? 7 : pk.v >= 5 ? 5.5 : 4.5;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(pk.x, y - s * 1.3); ctx.lineTo(pk.x + s, y); ctx.lineTo(pk.x, y + s * 1.3); ctx.lineTo(pk.x - s, y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.55)";
      ctx.beginPath(); ctx.moveTo(pk.x, y - s * 1.3); ctx.lineTo(pk.x + s * 0.4, y - s * 0.2); ctx.lineTo(pk.x - s * 0.3, y); ctx.closePath(); ctx.fill();
    } else if (pk.kind === "coin") {
      ctx.fillStyle = "#b8862a"; ctx.beginPath(); ctx.arc(pk.x, y + 1, 6, 0, TAU); ctx.fill();
      ctx.fillStyle = "#f2c44a"; ctx.beginPath(); ctx.arc(pk.x, y, 6, 0, TAU); ctx.fill();
      ctx.fillStyle = "#fff0b0"; ctx.fillRect(pk.x - 1, y - 3.5, 2, 7);
    } else if (pk.kind === "food") {
      ctx.fillStyle = "#c46a3a"; ctx.beginPath(); ctx.ellipse(pk.x - 1, y, 8, 6, -0.4, 0, TAU); ctx.fill();
      ctx.fillStyle = "#f3ead2"; ctx.fillRect(pk.x + 4, y - 7, 3, 7); ctx.beginPath(); ctx.arc(pk.x + 5.5, y - 8, 2.5, 0, TAU); ctx.fill();
    } else if (pk.kind === "vortex") {
      ctx.strokeStyle = "#9ad8ff"; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(pk.x, y, 4 + i * 3, t * 4 + i, t * 4 + i + 4); ctx.stroke(); }
    } else if (pk.kind === "chest") {
      const glow = 0.5 + 0.5 * Math.sin(t * 5);
      ctx.fillStyle = `rgba(255,210,80,${0.25 + glow * 0.25})`; ctx.beginPath(); ctx.arc(pk.x, y, 22, 0, TAU); ctx.fill();
      ctx.fillStyle = "#6b3f1f"; roundRect(ctx, pk.x - 12, y - 8, 24, 17, 3); ctx.fill();
      ctx.fillStyle = "#8a5428"; roundRect(ctx, pk.x - 12, y - 12, 24, 8, 3); ctx.fill();
      ctx.fillStyle = "#e8c04a"; ctx.fillRect(pk.x - 12, y - 4, 24, 2.5); ctx.fillRect(pk.x - 2.5, y - 6, 5, 7);
    }
  }

  function drawProjectile(ctx, pr) {
    if (pr.kind === "arrow") {
      const a = Math.atan2(pr.vy, pr.vx);
      ctx.save(); ctx.translate(pr.x, pr.y); ctx.rotate(a);
      ctx.fillStyle = "rgba(170,140,255,.35)"; ctx.beginPath(); ctx.ellipse(-6, 0, 12, 5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "#e6dcff"; ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-4, -3.5); ctx.lineTo(-2, 0); ctx.lineTo(-4, 3.5); ctx.closePath(); ctx.fill();
      ctx.restore();
    } else if (pr.kind === "knife") {
      const a = Math.atan2(pr.vy, pr.vx);
      ctx.save(); ctx.translate(pr.x, pr.y); ctx.rotate(a);
      ctx.fillStyle = "#dfe4ea"; ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-3, -2.5); ctx.lineTo(-3, 2.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#6b4a2a"; ctx.fillRect(-8, -1.5, 5, 3);
      ctx.restore();
    } else if (pr.kind === "axe") {
      const r = pr.r;
      ctx.save(); ctx.translate(pr.x, pr.y); ctx.rotate(pr.spin || 0);
      ctx.fillStyle = "#6b4a2a"; ctx.fillRect(-r * 0.12, -r, r * 0.24, r * 2);
      ctx.fillStyle = "#c9ced6"; ctx.beginPath(); ctx.moveTo(0, -r); ctx.quadraticCurveTo(r * 1.1, -r * 0.8, r * 0.9, r * 0.1); ctx.lineTo(0, -r * 0.2); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  function drawFx(ctx, f, t) {
    const k = f.t / f.life;
    if (f.kind === "slash") {
      ctx.save(); ctx.translate(f.x, f.y);
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = f.evo ? "rgba(255,70,90,.55)" : "rgba(255,255,255,.55)";
      ctx.beginPath();
      ctx.ellipse(0, 0, f.w / 2, f.h / 2 * (1 - k * 0.5), 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = f.evo ? "#ffb3c0" : "#fff";
      ctx.beginPath(); ctx.ellipse(f.side * f.w * 0.1, -f.h * 0.1, f.w / 2 * 0.85, f.h / 2 * 0.25, 0, 0, TAU); ctx.fill();
      ctx.restore(); ctx.globalAlpha = 1;
    } else if (f.kind === "puff") {
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = f.color;
      for (let i = 0; i < 5; i++) {
        const a = i * 1.26;
        ctx.beginPath(); ctx.arc(f.x + Math.cos(a) * f.r * k * 1.4, f.y + Math.sin(a) * f.r * k * 1.4, f.r * 0.35 * (1 - k), 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if (f.kind === "bolt") {
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = "#fff6a8"; ctx.lineWidth = 3;
      const fx = f.fromX != null ? f.fromX : f.x + 10, fy = f.fromY != null ? f.fromY : f.y - 400;
      ctx.beginPath(); ctx.moveTo(fx, fy);
      const seg = 6;
      for (let i = 1; i < seg; i++) {
        const q = i / seg;
        ctx.lineTo(fx + (f.x - fx) * q + (Math.sin(i * 12.9 + f.x) * 12), fy + (f.y - fy) * q);
      }
      ctx.lineTo(f.x, f.y); ctx.stroke();
      ctx.fillStyle = "rgba(255,246,168,.35)"; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (f.kind === "ring") {
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = f.color; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r * k, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (f.kind === "heal") {
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = "#6bff8a"; ctx.font = "700 14px Inter, sans-serif"; ctx.textAlign = "center";
      ctx.fillText("+", f.x - 8, f.y - 20 - k * 20); ctx.fillText("+", f.x + 9, f.y - 14 - k * 22);
      ctx.globalAlpha = 1;
    }
  }

  window.HordeRender = { render, sprite, SHAPES };
})();
