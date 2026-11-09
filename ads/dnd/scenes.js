/* DnD — ілюстрації сцен (SVG, малюються в браузері) і що грає в кожній сцені.
   DNDArt.svg(kind) → рядок SVG для банера сцени. Майстер може замінити картинку своєю. */
(function () {
  'use strict';
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  const W = 400, H = 170;
  const sky = (a, b, id) => '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/></linearGradient></defs><rect width="' + W + '" height="' + H + '" fill="url(#' + id + ')"/>';
  function stars(r, n, maxY, col) { let h = ''; for (let i = 0; i < n; i++) h += '<circle cx="' + (r() * W).toFixed(1) + '" cy="' + (r() * maxY).toFixed(1) + '" r="' + (0.4 + r() * 0.9).toFixed(2) + '" fill="' + (col || '#fff') + '" opacity="' + (0.3 + r() * 0.6).toFixed(2) + '"' + (r() < 0.3 ? ' class="tw" style="animation-delay:' + (r() * 3).toFixed(1) + 's"' : '') + '/>'; return h; }
  function ridge(r, y, amp, step, col, op) { // гірський хребет
    let d = 'M0 ' + H + ' L0 ' + y; for (let x = 0; x <= W + step; x += step) d += ' L' + x + ' ' + (y - r() * amp).toFixed(1);
    return '<path d="' + d + ' L' + W + ' ' + H + 'Z" fill="' + col + '"' + (op ? ' opacity="' + op + '"' : '') + '/>';
  }
  function pines(r, n, y0, y1, col, sMin, sMax) { let h = ''; for (let i = 0; i < n; i++) { const x = r() * W, y = y0 + r() * (y1 - y0), s = sMin + r() * (sMax - sMin); h += '<path d="M' + x.toFixed(1) + ' ' + (y - s * 3).toFixed(1) + ' L' + (x - s).toFixed(1) + ' ' + y.toFixed(1) + ' L' + (x + s).toFixed(1) + ' ' + y.toFixed(1) + 'Z" fill="' + col + '"/>'; } return h; }
  function snow(r, n) { let h = '<g class="snow">'; for (let i = 0; i < n; i++) h += '<circle cx="' + (r() * W).toFixed(1) + '" cy="' + (r() * H).toFixed(1) + '" r="' + (0.6 + r() * 1.3).toFixed(2) + '" fill="#fff" opacity="' + (0.4 + r() * 0.5).toFixed(2) + '" style="animation-duration:' + (5 + r() * 6).toFixed(1) + 's;animation-delay:-' + (r() * 8).toFixed(1) + 's"/>'; return h + '</g>'; }
  function mist(col, y, op) { return '<g class="mist"><ellipse cx="120" cy="' + y + '" rx="180" ry="18" fill="' + col + '" opacity="' + op + '"/><ellipse cx="330" cy="' + (y + 10) + '" rx="160" ry="16" fill="' + col + '" opacity="' + op + '"/></g>'; }
  function house(x, y, w, h, roof, lit) { // хатка з вікном
    return '<rect x="' + x + '" y="' + (y - h) + '" width="' + w + '" height="' + h + '" fill="#141019"/><path d="M' + (x - 4) + ' ' + (y - h) + ' L' + (x + w / 2) + ' ' + (y - h - roof) + ' L' + (x + w + 4) + ' ' + (y - h) + 'Z" fill="#0E0B12"/>' +
      (lit ? '<rect class="fl" x="' + (x + w * 0.3) + '" y="' + (y - h * 0.65) + '" width="' + (w * 0.22) + '" height="' + (h * 0.28) + '" fill="#FFC067"/>' : '');
  }
  const css = '<style>.tw{animation:tw 3s ease-in-out infinite}@keyframes tw{50%{opacity:.1}}.fl{animation:fl 1.6s steps(4) infinite}@keyframes fl{25%{opacity:.75}50%{opacity:1}75%{opacity:.85}}' +
    '.snow circle{animation:sn linear infinite}@keyframes sn{from{transform:translate(0,-' + H + 'px)}to{transform:translate(-30px,' + H + 'px)}}.mist{animation:mi 14s ease-in-out infinite alternate}@keyframes mi{to{transform:translateX(-40px)}}' +
    '.fire{transform-box:fill-box;transform-origin:50% 100%;animation:fi .5s ease-in-out infinite alternate}@keyframes fi{to{transform:scaleY(1.18) scaleX(.92)}}.glow{animation:gl 2.2s ease-in-out infinite alternate}@keyframes gl{to{opacity:.55}}' +
    '.spin{transform-box:fill-box;transform-origin:center;animation:sp 40s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}.bob{animation:bo 5s ease-in-out infinite alternate}@keyframes bo{to{transform:translateY(-6px)}}' +
    '@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>';

  const ART = {
    tavern(r) { // всередині таверни: стіни з дошок, вогнище, ліхтарі, столи
      let h = sky('#4A2E18', '#1A0F08', 'tv');
      for (let x = 0; x < W; x += 26) h += '<rect x="' + x + '" y="0" width="25" height="120" fill="#000" opacity="' + (0.05 + r() * 0.12).toFixed(2) + '"/>';
      h += '<rect x="0" y="22" width="' + W + '" height="9" fill="#2A1A0C"/><rect x="0" y="118" width="' + W + '" height="52" fill="#24160A"/>';
      h += '<circle class="glow" cx="300" cy="110" r="90" fill="#FF8A2A" opacity=".28"/>'; // відсвіт
      h += '<path d="M250 120 L250 58 L350 58 L350 120 L335 120 L335 76 L265 76 L265 120Z" fill="#3A3230"/><rect x="244" y="52" width="112" height="8" fill="#4A403C"/>'; // камін
      h += '<path class="fire" d="M280 120 Q285 92 296 100 Q300 80 306 98 Q316 88 320 120Z" fill="#FF9A2A"/><path class="fire" d="M290 120 Q294 104 300 108 Q305 96 310 120Z" fill="#FFE07A"/>';
      for (const x of [60, 150, 210]) h += '<line x1="' + x + '" y1="31" x2="' + x + '" y2="52" stroke="#120A04" stroke-width="1.5"/><circle class="glow" cx="' + x + '" cy="58" r="14" fill="#FFB050" opacity=".35"/><rect class="fl" x="' + (x - 4) + '" y="52" width="8" height="11" rx="2" fill="#FFD27A"/>';
      h += '<rect x="30" y="128" width="120" height="7" fill="#130B05"/><rect x="40" y="135" width="6" height="30" fill="#130B05"/><rect x="134" y="135" width="6" height="30" fill="#130B05"/>';
      h += '<rect x="165" y="134" width="70" height="6" fill="#130B05"/><rect x="172" y="140" width="5" height="25" fill="#130B05"/><rect x="223" y="140" width="5" height="25" fill="#130B05"/>';
      for (const [x, y] of [[55, 128], [72, 128], [118, 128], [190, 134]]) h += '<rect x="' + (x - 4) + '" y="' + (y - 10) + '" width="8" height="10" rx="1.5" fill="#8A5A2A"/><rect x="' + (x + 4) + '" y="' + (y - 8) + '" width="3" height="5" rx="1.5" fill="none" stroke="#8A5A2A" stroke-width="1.5"/>';
      h += '<ellipse cx="380" cy="132" rx="20" ry="25" fill="#3A2412"/><ellipse cx="380" cy="132" rx="20" ry="25" fill="none" stroke="#1A0F06" stroke-width="2"/>'; // бочка
      return h;
    },
    town(r) { // засніжене портове місто вночі
      let h = sky('#1E3550', '#0D1520', 'tn') + stars(r, 40, 80);
      h += '<circle cx="330" cy="36" r="14" fill="#E8EEF5" opacity=".9"/>' + ridge(r, 95, 30, 30, '#22344A');
      h += '<rect x="0" y="128" width="' + W + '" height="42" fill="#101823"/><rect x="0" y="146" width="' + W + '" height="24" fill="#0B2030" opacity=".9"/>';
      let x = 10; while (x < W - 20) { const w = 26 + r() * 22, hh = 18 + r() * 22; h += house(x, 132, w, hh, 10 + r() * 8, r() < 0.7); if (r() < 0.4) h += '<rect x="' + (x + w * 0.7) + '" y="' + (132 - hh - 14) + '" width="4" height="10" fill="#0E0B12"/>'; x += w + 6 + r() * 12; }
      h += '<path d="M0 132 Q100 126 200 131 T400 129 L400 136 L0 136Z" fill="#DDE6EF" opacity=".85"/>'; // сніг на дахах/землі
      h += '<path d="M300 150 L340 150 L335 158 L305 158Z" fill="#05080C"/><line x1="320" y1="150" x2="320" y2="126" stroke="#05080C" stroke-width="2"/>'; // човен
      return h + snow(r, 50);
    },
    stone(r) { // Маркарт: місто в скелях, водоспад, ранкове світло
      let h = sky('#E8A07A', '#5A2E3E', 'st');
      h += '<circle cx="80" cy="60" r="30" fill="#FFD6A0" opacity=".6"/>' + ridge(r, 70, 40, 24, '#6A3E42') + ridge(r, 100, 30, 18, '#4A2A30');
      h += '<rect x="250" y="40" width="12" height="130" fill="#BFE0F0" opacity=".55"/><rect x="254" y="40" width="4" height="130" fill="#fff" opacity=".6"/>';
      for (let i = 0; i < 7; i++) { const x = 30 + i * 50 + r() * 10, y = 105 + r() * 25, w = 30 + r() * 16, hh = 20 + r() * 30; if (x > 230 && x < 280) continue;
        h += '<rect x="' + x + '" y="' + (y - hh) + '" width="' + w + '" height="' + hh + '" fill="#3A2226"/><path d="M' + x + ' ' + (y - hh) + ' L' + (x + w / 2) + ' ' + (y - hh - 8) + ' L' + (x + w) + ' ' + (y - hh) + 'Z" fill="#2E1A1E"/><rect x="' + (x + w / 2 - 4) + '" y="' + (y - 10) + '" width="8" height="10" fill="#1A0E10"/>'; }
      h += '<rect x="0" y="140" width="' + W + '" height="30" fill="#2A161A"/>';
      return h;
    },
    road(r) { // сніжна дорога в горах
      let h = sky('#5A7894', '#1C2633', 'rd');
      h += ridge(r, 70, 45, 22, '#8AA2B8', 0.7) + '<path d="M0 68 L30 50 L60 66" fill="none"/>' + ridge(r, 100, 35, 18, '#3E5468');
      h += pines(r, 26, 112, 128, '#1C2A36', 4, 7) + '<rect x="0" y="128" width="' + W + '" height="42" fill="#C8D4DF"/>';
      h += '<path d="M150 170 Q190 140 230 128 L250 128 Q220 145 230 170Z" fill="#9AA8B5"/>' + pines(r, 8, 150, 170, '#14202A', 7, 12);
      return h + snow(r, 80);
    },
    trail(r) { // поля Тамріелю вдень: дорога, ферма, коза
      let h = sky('#9CC6E0', '#E8E2C0', 'tr');
      h += '<circle cx="320" cy="40" r="18" fill="#FFF3C0"/>' + ridge(r, 85, 30, 30, '#8A9AAA', 0.6) + ridge(r, 112, 18, 24, '#6E8A3A');
      h += '<rect x="0" y="125" width="' + W + '" height="45" fill="#5E7A2E"/><path d="M180 170 Q200 140 240 125 L256 125 Q222 145 228 170Z" fill="#B89A6A"/>';
      h += '<rect x="60" y="92" width="44" height="30" fill="#6A4A2A"/><path d="M54 92 L82 74 L110 92Z" fill="#8A6A3A"/><rect x="76" y="106" width="10" height="16" fill="#3A2412"/>'; // ферма
      for (let i = 0; i < 14; i++) h += '<path d="M' + (r() * W).toFixed(0) + ' ' + (130 + r() * 35).toFixed(0) + ' l2 -6 l2 6" stroke="#3E5A1A" fill="none"/>';
      h += '<g class="bob"><ellipse cx="320" cy="140" rx="14" ry="8" fill="#EFE8DA"/><circle cx="334" cy="133" r="5" fill="#EFE8DA"/><path d="M334 128 l3 -5 M331 128 l-1 -5" stroke="#5A4A3A" stroke-width="1.5"/><line x1="312" y1="146" x2="312" y2="154" stroke="#5A4A3A" stroke-width="2"/><line x1="326" y1="146" x2="326" y2="154" stroke="#5A4A3A" stroke-width="2"/></g>';
      return h;
    },
    temple(r) { // храм: колони, вітраж, свічки
      let h = sky('#3A2A4E', '#120E18', 'tm');
      h += '<path d="M170 20 Q200 -5 230 20 L230 90 L170 90Z" fill="#6A4A9A" opacity=".55"/><path d="M200 8 L200 90 M170 45 L230 45" stroke="#2A1E36" stroke-width="3"/><circle class="glow" cx="200" cy="55" r="60" fill="#9A7AD8" opacity=".18"/>';
      for (const x of [40, 110, 280, 350]) h += '<rect x="' + (x - 11) + '" y="10" width="22" height="135" fill="#241A30"/><rect x="' + (x - 15) + '" y="10" width="30" height="8" fill="#2E2240"/><rect x="' + (x - 15) + '" y="138" width="30" height="8" fill="#2E2240"/>';
      h += '<rect x="0" y="145" width="' + W + '" height="25" fill="#16101E"/><rect x="160" y="118" width="80" height="27" fill="#2E2240"/>';
      for (let i = 0; i < 9; i++) { const x = 168 + i * 8 + r() * 3, hh = 6 + r() * 8; h += '<rect x="' + x + '" y="' + (118 - hh) + '" width="3" height="' + hh + '" fill="#E8E0D0"/><ellipse class="fire" cx="' + (x + 1.5) + '" cy="' + (115 - hh) + '" rx="1.8" ry="3.5" fill="#FFC060"/>'; }
      h += '<circle class="glow" cx="200" cy="112" r="40" fill="#FFB050" opacity=".2"/>';
      return h;
    },
    dream(r) { // сон: фіолетовий вир, летючі острови
      let h = sky('#5A2E7A', '#140A22', 'dr') + stars(r, 70, H, '#E8D8FF');
      h += '<g class="spin" opacity=".35">'; for (let i = 0; i < 5; i++) h += '<ellipse cx="200" cy="85" rx="' + (40 + i * 30) + '" ry="' + (12 + i * 9) + '" fill="none" stroke="#C89AF0" stroke-width="1.5" stroke-dasharray="' + (10 + i * 6) + ' ' + (8 + i * 4) + '"/>'; h += '</g>';
      h += '<circle class="glow" cx="200" cy="85" r="22" fill="#F0C8FF" opacity=".55"/>';
      for (const [x, y, w] of [[70, 120, 60], [320, 60, 50], [300, 135, 40]]) h += '<g class="bob" style="animation-delay:-' + (x % 5) + 's"><path d="M' + (x - w / 2) + ' ' + y + ' L' + (x + w / 2) + ' ' + y + ' L' + x + ' ' + (y + w * 0.6) + 'Z" fill="#2A1640"/><rect x="' + (x - w / 2) + '" y="' + (y - 4) + '" width="' + w + '" height="5" rx="2" fill="#4A3A6A"/></g>';
      return h;
    },
    cave(r) { // печера-святилище: сталактити, червоне сяйво, вівтар
      let h = sky('#3A1028', '#0A0508', 'cv');
      h += '<circle class="glow" cx="200" cy="110" r="80" fill="#E0306A" opacity=".25"/>';
      let d = 'M0 0'; for (let x = 0; x <= W; x += 14) d += ' L' + x + ' ' + (r() < 0.3 ? 20 + r() * 40 : 4 + r() * 10).toFixed(0) + ' L' + (x + 7) + ' 2'; h += '<path d="' + d + ' L' + W + ' 0Z" fill="#05020A"/>';
      h += '<path d="M0 170 L0 130 Q60 120 120 135 L120 170Z M400 170 L400 125 Q340 118 280 138 L280 170Z" fill="#05020A"/><rect x="0" y="150" width="' + W + '" height="20" fill="#0A0508"/>';
      h += '<path d="M170 150 L176 128 L224 128 L230 150Z" fill="#1E0E16"/><rect x="166" y="124" width="68" height="6" fill="#2E1622"/>';
      h += '<g class="bob"><circle cx="200" cy="108" r="11" fill="#C8C0B8"/><circle cx="196" cy="106" r="2.5" fill="#E0306A"/><circle cx="204" cy="106" r="2.5" fill="#E0306A"/><rect x="198.5" y="118" width="3" height="10" fill="#5A4A3A"/></g>';
      return h + mist('#E0306A', 152, 0.12);
    },
    fort(r) { // зруйнований форт на пагорбі вночі, вогні, ворони
      let h = sky('#2E2A44', '#0C0A12', 'ft') + stars(r, 45, 70);
      h += '<circle cx="80" cy="34" r="12" fill="#E8E0F0" opacity=".85"/>' + ridge(r, 110, 22, 26, '#1A1824');
      h += '<path d="M130 112 L130 62 L150 62 L150 54 L158 54 L158 62 L170 62 L170 54 L178 54 L178 62 L196 62 L196 40 L224 40 L224 62 L250 62 L250 54 L258 54 L258 70 L270 70 L270 112Z" fill="#0A0910"/>';
      h += '<path d="M216 40 L222 26 L226 40" fill="#0A0910"/><rect class="fl" x="206" y="52" width="6" height="9" fill="#FF8A3A"/><rect class="fl" x="150" y="80" width="5" height="8" fill="#FF8A3A"/><circle class="glow" cx="200" cy="112" r="40" fill="#FF6A2A" opacity=".18"/>';
      h += '<rect x="0" y="130" width="' + W + '" height="40" fill="#08070C"/>';
      for (let i = 0; i < 5; i++) { const x = 260 + r() * 120, y = 20 + r() * 40; h += '<path class="bob" d="M' + x.toFixed(0) + ' ' + y.toFixed(0) + ' q4 -4 8 0 q4 -4 8 0" stroke="#000" stroke-width="1.6" fill="none"/>'; }
      return h + mist('#6A5A8A', 140, 0.14);
    },
    grove(r) { // Туманний гай: рожевий туман, ліхтарики, свято
      let h = sky('#6A2A4A', '#1A0A14', 'gv');
      h += '<circle class="glow" cx="200" cy="100" r="110" fill="#FF7AB0" opacity=".18"/>';
      for (let i = 0; i < 9; i++) { const x = 15 + i * 46 + r() * 10, hh = 70 + r() * 50; h += '<rect x="' + (x - 3) + '" y="' + (150 - hh) + '" width="6" height="' + hh + '" fill="#1A0812"/><circle cx="' + x + '" cy="' + (150 - hh) + '" r="' + (18 + r() * 10).toFixed(0) + '" fill="#2A0E1E"/>'; }
      h += '<path d="M0 50 Q100 70 200 52 T400 56" stroke="#3A1A2A" fill="none"/>';
      for (let i = 0; i < 12; i++) { const x = 10 + i * 34, y = 56 + Math.sin(i) * 6; h += '<circle class="glow" style="animation-delay:-' + (i % 4) * 0.5 + 's" cx="' + x + '" cy="' + y + '" r="4" fill="' + ['#FFD27A', '#FF8AC0', '#B8F0FF'][i % 3] + '"/>'; }
      h += '<rect x="150" y="128" width="100" height="6" fill="#120610"/>'; for (const x of [165, 185, 210, 232]) h += '<rect x="' + (x - 3) + '" y="120" width="6" height="8" rx="1" fill="#C0306A"/>';
      h += '<rect x="0" y="150" width="' + W + '" height="20" fill="#120610"/>';
      return h + mist('#FFB0D0', 145, 0.22);
    },
    letter(r) { // перед грою: стіл, свічка, мапа
      let h = sky('#3B2E5A', '#1E1830', 'lt');
      h += '<rect x="0" y="110" width="' + W + '" height="60" fill="#2A1C12"/><path d="M90 150 L120 92 L290 98 L310 156Z" fill="#D8C49A"/><path d="M140 120 Q180 104 220 126 T280 118" stroke="#8A5A3A" stroke-width="2" stroke-dasharray="4 4" fill="none"/><path d="M270 112 l8 8 m0 -8 l-8 8" stroke="#A02A2A" stroke-width="2.5"/>';
      h += '<rect x="340" y="90" width="10" height="34" fill="#EEE4D0"/><ellipse class="fire" cx="345" cy="84" rx="4" ry="8" fill="#FFC060"/><circle class="glow" cx="345" cy="90" r="40" fill="#FFB050" opacity=".22"/>';
      h += '<g transform="translate(50 118)"><path d="M0 0 L12 -7 L24 0 L12 7Z" fill="#E8E0F0"/><path d="M0 0 L12 7 L12 21 L0 14Z" fill="#B0A0D0"/><path d="M24 0 L12 7 L12 21 L24 14Z" fill="#8070B0"/></g>';
      return h;
    },
  };
  let uid = 0; // окремий id фільтра на кожну картинку: якщо спільний лежить у схованому SVG, Chrome його не застосовує
  const cache = {};
  function svg(kind, seed) {
    const k = ART[kind] ? kind : 'letter', key = k + ':' + (seed || 0);
    const fid = 'dndBlur' + (++uid);
    if (!cache[key]) cache[key] = '<svg class="scene-art" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' + css + '<defs><filter id="' + fid + '" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="16"/></filter></defs>' + ART[k](rng((seed || 7) * 977 + k.length * 31)).replace(/<circle class="glow"(?! style)( cx="[\d.]+" cy="[\d.]+" r="(\d{2,})")/g, '<circle class="glow" filter="url(#' + fid + ')"$1') + '</svg>';
    return cache[key];
  }
  window.DNDArt = { svg, kinds: Object.keys(ART) };

  /* яку картинку й музику має кожна сцена пригоди */
  const A = window.DND_ADV || {};
  if (A.nightmare) A.nightmare.sceneArt = {
    intro: ['letter', 'road'], dawnstar: ['tavern', 'tavern'], road: ['road', 'road'], temple: ['temple', 'temple'], dream: ['dream', 'dream'], shrine: ['cave', 'dungeon'] };
  if (A.sanguine) A.sanguine.sceneArt = {
    tavern: ['tavern', 'tavern'], markarth: ['stone', 'town'], trail: ['trail', 'road'], morvunskar: ['fort', 'dungeon'], grove: ['grove', 'party'] };
  if (window.DND_USE && window.DND_STORY && window.DND_STORY.id) { const id = window.DND_STORY.id; window.DND_STORY.id = null; window.DND_USE(id); }
})();
