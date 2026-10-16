// ==========================================================================
// Аватарки Сміхлиста — 20 унікальних монстриків у inline-SVG з емоціями.
//
// QuiplashAvatars.svg(id, mood)  → рядок <svg>; mood: idle | happy | sad | shock | write
// QuiplashAvatars.html(player, mood, extraClass) → обгортка .qa-av з svg
//
// Більшість персонажів збирається з деталей (тіло × очі × аксесуар), а двоє
// улюбленців — Лісі (№4) і Карен (№8) — перенесені з img/char4.svg і
// img/char8.svg майже 1:1 (власні контури, рот, окуляри, 💢), лише з
// варіантами емоцій поверх.
// Колір персонажа фіксований: 20 персонажів на 20 гравців — без дублікатів.
// ==========================================================================
(function () {
  const INK = "#14112b";
  const SW = 3; // товщина контуру у viewBox 120×120 (≈ як у старих char*.svg)

  const CHARACTERS = [
    { id: 1, name: "Лука", color: "#8be000", shape: "drop", eyes: "big1", acc: "none", extra: "grin" },
    { id: 2, name: "Ліам", color: "#8b2cf5", shape: "round", eyes: "mismatch", acc: "wizard" },
    { id: 3, name: "Йорк", color: "#e83a3a", shape: "round", eyes: "two", acc: "horns", extra: "fangs" },
    { id: 4, name: "Лісі", color: "#ffaa56", special: "lisi" },
    { id: 5, name: "Сімон", color: "#12b5a5", shape: "bean", eyes: "sleepy", acc: "none" },
    { id: 6, name: "Кікі", color: "#b07cd8", shape: "onigiri", eyes: "two", acc: "tuft" },
    { id: 7, name: "Лойд", color: "#3a8dff", shape: "pill", eyes: "two", acc: "crown" },
    { id: 8, name: "Карен", color: "#ff6fa5", special: "karen" },
    { id: 9, name: "Бублик", color: "#ffb000", shape: "cloud", eyes: "tiny", acc: "sprout" },
    { id: 10, name: "Желейка", color: "#ff4fd8", shape: "ghost", eyes: "three", acc: "none" },
    { id: 11, name: "Їжачок", color: "#2fbf71", shape: "spiky", eyes: "two", acc: "none" },
    { id: 12, name: "Буряк", color: "#b0204f", shape: "onigiri", eyes: "mismatch", acc: "mohawk" },
    { id: 13, name: "Пампух", color: "#ffe14d", shape: "round", eyes: "tiny", acc: "beanie" },
    { id: 14, name: "Циклопчик", color: "#4cc9f0", shape: "tofu", eyes: "big1", acc: "none", extra: "spots" },
    { id: 15, name: "Персик", color: "#ff7f6b", shape: "bean", eyes: "two", acc: "party" },
    { id: 16, name: "М'ятик", color: "#7cf2c4", shape: "drop", eyes: "sleepy", acc: "bow" },
    { id: 17, name: "Космик", color: "#5b5bd6", shape: "pill", eyes: "three", acc: "antenna" },
    { id: 18, name: "Сирник", color: "#c9874a", shape: "tofu", eyes: "two", acc: "glasses" },
    { id: 19, name: "Привидко", color: "#eef0ff", shape: "ghost", eyes: "two", acc: "none" },
    { id: 20, name: "Огірок", color: "#c6d636", shape: "bean", eyes: "tiny", acc: "tuft", extra: "spots" },
  ];
  const COUNT = CHARACTERS.length;

  function byId(id) {
    const n = Number(id);
    return CHARACTERS[(Number.isInteger(n) && n >= 1 && n <= COUNT ? n : 1) - 1];
  }

  // ---------------- тіла: path + верх голови + центр обличчя ----------------
  function spikyPath() {
    const pts = [];
    const spikes = 11, cx = 60, cy = 68;
    for (let i = 0; i < spikes * 2; i++) {
      const a = (Math.PI * i) / spikes - Math.PI / 2;
      const r = i % 2 === 0 ? 47 : 37;
      pts.push(`${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a) * 0.95).toFixed(1)}`);
    }
    return "M" + pts.join(" L") + "Z";
  }
  const SHAPES = {
    round: { d: "M60 24C88 24 102 45 102 70C102 96 84 108 60 108C36 108 18 96 18 70C18 45 32 24 60 24Z", top: 24, face: 60 },
    ghost: { d: "M22 64C22 38 40 20 60 20C80 20 98 38 98 64V102Q90 94 82 102Q74 110 66 102Q60 96 54 102Q46 110 38 102Q30 94 22 102Z", top: 20, face: 56 },
    tofu: { d: "M40 26H80Q96 26 96 42V92Q96 108 80 108H40Q24 108 24 92V42Q24 26 40 26Z", top: 26, face: 60 },
    onigiri: { d: "M60 20C70 20 106 84 104 96C102 108 92 108 60 108C28 108 18 108 16 96C14 84 50 20 60 20Z", top: 24, face: 74 },
    bean: { d: "M60 16C84 16 94 48 94 74C94 98 80 110 60 110C40 110 26 98 26 74C26 48 36 16 60 16Z", top: 16, face: 56 },
    cloud: { d: "M32 106C14 106 10 84 24 77C16 60 30 44 45 50C47 32 74 28 81 46C97 40 110 58 99 72C111 81 106 106 88 106Z", top: 36, face: 76 },
    spiky: { d: spikyPath(), top: 26, face: 66 },
    pill: { d: "M14 74C14 52 34 40 60 40C86 40 106 52 106 74C106 96 86 108 60 108C34 108 14 96 14 74Z", top: 40, face: 70 },
    drop: { d: "M60 12C64 30 96 52 96 78C96 98 80 110 60 110C40 110 24 98 24 78C24 52 56 30 60 12Z", top: 30, face: 72 },
  };

  // ---------------- аксесуари (back — за тілом, front — поверх) ----------------
  function accessory(acc, t, color) {
    const s = `stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round" stroke-linecap="round"`;
    switch (acc) {
      case "horns":
        return { back: `<path d="M40 ${t + 12}Q28 ${t - 4} 36 ${t - 16}Q42 ${t - 2} 52 ${t + 6}Z" fill="#fff1d0" ${s}/><path d="M80 ${t + 12}Q92 ${t - 4} 84 ${t - 16}Q78 ${t - 2} 68 ${t + 6}Z" fill="#fff1d0" ${s}/>`, front: "" };
      case "antenna":
        return { back: `<path d="M60 ${t + 4}V${t - 14}" fill="none" ${s}/>`, front: `<circle cx="60" cy="${t - 18}" r="5.5" fill="#ffd23f" ${s}/>` };
      case "sprout":
        return { back: `<path d="M60 ${t + 4}Q60 ${t - 6} 58 ${t - 12}" fill="none" ${s}/>`, front: `<path d="M58 ${t - 12}Q46 ${t - 22} 40 ${t - 12}Q50 ${t - 6} 58 ${t - 12}Z" fill="#59d35b" ${s}/><path d="M58 ${t - 12}Q66 ${t - 26} 78 ${t - 20}Q72 ${t - 8} 58 ${t - 12}Z" fill="#59d35b" ${s}/>` };
      case "party":
        return { back: "", front: `<path d="M47 ${t + 6}L60 ${t - 24}L73 ${t + 6}Z" fill="#ffd23f" ${s}/><path d="M52 ${t - 6}L67 ${t - 2}M56 ${t - 15}L64 ${t - 13}" stroke="#ff4f9a" stroke-width="3.2" stroke-linecap="round"/><circle cx="60" cy="${t - 25}" r="4.5" fill="#ff4f9a" ${s}/>` };
      case "crown":
        return { back: "", front: `<path d="M44 ${t + 6}L42 ${t - 12}L51 ${t - 3}L60 ${t - 16}L69 ${t - 3}L78 ${t - 12}L76 ${t + 6}Z" fill="#ffd23f" ${s}/><circle cx="60" cy="${t - 2}" r="2.6" fill="#ff4f9a"/>` };
      case "bow":
        return { back: "", front: `<path d="M74 ${t + 8}L62 ${t - 2}L63 ${t + 16}Z" fill="#ff4f9a" ${s}/><path d="M74 ${t + 8}L88 ${t - 2}L86 ${t + 16}Z" fill="#ff4f9a" ${s}/><circle cx="74" cy="${t + 8}" r="4" fill="#ff86bd" ${s}/>` };
      case "wizard":
        return { back: "", front: `<path d="M40 ${t + 8}Q62 ${t - 2} 84 ${t + 6}L80 ${t - 2}Q74 ${t - 20} 88 ${t - 34}Q60 ${t - 22} 46 ${t}Z" fill="#3b4fd8" ${s}/><path d="M60 ${t - 8}l1.6 3.4 3.6.4-2.7 2.4.8 3.6-3.3-1.9-3.3 1.9.8-3.6-2.7-2.4 3.6-.4z" fill="#ffe14d"/><circle cx="74" cy="${t - 18}" r="1.6" fill="#ffe14d"/>` };
      case "beanie":
        return { back: "", front: `<path d="M34 ${t + 14}Q36 ${t - 18} 60 ${t - 18}Q84 ${t - 18} 86 ${t + 14}Z" fill="#ff5a5f" ${s}/><path d="M32 ${t + 8}H88V${t + 18}H32Z" fill="#ffffff" ${s}/><circle cx="60" cy="${t - 20}" r="6" fill="#ffffff" ${s}/>` };
      case "mohawk":
        return { back: `<path d="M46 ${t + 8}L44 ${t - 10}L53 ${t - 1}L58 ${t - 18}L64 ${t - 2}L74 ${t - 12}L72 ${t + 8}Z" fill="#ffd23f" ${s}/>`, front: "" };
      case "tuft":
        return { back: "", front: `<path d="M56 ${t + 3}Q50 ${t - 10} 60 ${t - 14}Q56 ${t - 6} 64 ${t - 8}Q60 ${t - 2} 62 ${t + 3}" fill="${color}" ${s}/>` };
      default:
        return { back: "", front: "" };
    }
  }

  // ---------------- очі ----------------
  function eyeList(type, fy) {
    switch (type) {
      case "big1": return [{ x: 60, y: fy - 2, r: 15, p: 7 }];
      case "three": return [{ x: 42, y: fy, r: 7.5, p: 3.6 }, { x: 60, y: fy - 7, r: 8.5, p: 4 }, { x: 78, y: fy, r: 7.5, p: 3.6 }];
      case "mismatch": return [{ x: 45, y: fy - 1, r: 11.5, p: 5 }, { x: 75, y: fy + 1, r: 7.5, p: 3.6 }];
      case "tiny": return [{ x: 47, y: fy, r: 0, p: 4.2 }, { x: 73, y: fy, r: 0, p: 4.2 }];
      default: return [{ x: 46, y: fy, r: 9.5, p: 4.6 }, { x: 74, y: fy, r: 9.5, p: 4.6 }];
    }
  }

  function eyesSvg(type, fy, mood, color) {
    const eyes = eyeList(type, fy);
    const dx = mood === "write" ? -2.5 : 0;
    const dy = mood === "sad" || mood === "write" ? 2.5 : 0;
    const pScale = mood === "shock" ? 0.6 : 1;
    let out = "";
    if (mood === "happy" && (type === "two" || type === "tiny" || type === "sleepy")) {
      // радісні очі-дужки ^ ^
      eyes.forEach((e) => {
        const w = Math.max(6, e.r || 6);
        out += `<path d="M${e.x - w} ${e.y + 3}Q${e.x} ${e.y - w} ${e.x + w} ${e.y + 3}" fill="none" stroke="${INK}" stroke-width="${SW + 0.6}" stroke-linecap="round"/>`;
      });
      return out;
    }
    eyes.forEach((e) => {
      out += `<g class="qa-e">`;
      if (e.r) out += `<circle cx="${e.x}" cy="${e.y}" r="${e.r}" fill="#fff" stroke="${INK}" stroke-width="${SW}"/>`;
      const pr = e.p * pScale;
      const still = mood === "sad" || mood === "write" || mood === "shock";
      out += `<g class="${still ? "" : "qa-p"}"><circle cx="${e.x + dx}" cy="${e.y + dy}" r="${pr}" fill="${INK}"/><circle cx="${e.x + dx + pr * 0.35}" cy="${e.y + dy - pr * 0.4}" r="${Math.max(0.9, pr * 0.32)}" fill="#fff"/></g>`;
      if (type === "sleepy" && mood !== "shock") {
        out += `<path d="M${e.x - e.r - 1} ${e.y + 1}A${e.r + 1} ${e.r + 1} 0 0 1 ${e.x + e.r + 1} ${e.y + 1}Z" fill="${color}" stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round"/>`;
      }
      out += `</g>`;
    });
    // брови для емоцій
    if (mood === "sad" || mood === "shock") {
      const minX = Math.min(...eyes.map((e) => e.x)), maxX = Math.max(...eyes.map((e) => e.x));
      const top = Math.min(...eyes.map((e) => e.y - (e.r || 5))) - 6;
      if (mood === "sad") {
        out += `<path d="M${minX - 9} ${top + 2}L${minX + 5} ${top - 4}M${maxX + 9} ${top + 2}L${maxX - 5} ${top - 4}" stroke="${INK}" stroke-width="${SW}" stroke-linecap="round"/>`;
      } else {
        out += `<path d="M${minX - 8} ${top - 1}Q${minX} ${top - 8} ${minX + 8} ${top - 2}M${maxX - 8} ${top - 2}Q${maxX} ${top - 8} ${maxX + 8} ${top - 1}" fill="none" stroke="${INK}" stroke-width="${SW}" stroke-linecap="round"/>`;
      }
    }
    return out;
  }

  // ---------------- рот ----------------
  function mouthSvg(mood, my, extra) {
    const s = `stroke="${INK}" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round"`;
    const fangs = extra === "fangs" ? `<path d="M52 ${my + 1}l3 6 3-5.5M62 ${my + 0.5}l3 5.5 3-6" fill="#fff" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>` : "";
    switch (mood) {
      case "happy":
        return `<path d="M43 ${my - 3}Q60 ${my + 24} 77 ${my - 3}Z" fill="#3a1030" ${s}/><path d="M51 ${my + 9}Q60 ${my + 4} 69 ${my + 9}Q60 ${my + 16} 51 ${my + 9}Z" fill="#ff6b8b"/>`;
      case "sad":
        return `<path d="M48 ${my + 8}Q60 ${my - 3} 72 ${my + 8}" fill="none" ${s}/>`;
      case "shock":
        return `<ellipse cx="60" cy="${my + 4}" rx="6.5" ry="8.5" fill="#3a1030" ${s}/>`;
      case "write":
        return `<path d="M49 ${my + 3}L69 ${my}" fill="none" ${s}/><path d="M60 ${my + 1.5}Q61 ${my + 11} 66 ${my + 9}Q68 ${my + 4} 66 ${my + 0.6}" fill="#ff6b8b" stroke="${INK}" stroke-width="2"/>`;
      default:
        if (extra === "grin") {
          return `<path d="M40 ${my - 2}Q60 ${my + 16} 80 ${my - 2}Q60 ${my + 6} 40 ${my - 2}Z" fill="#3e6b00" ${s}/><path d="M46 ${my + 1}Q60 ${my + 8} 74 ${my + 1}" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>`;
        }
        return `<path d="M48 ${my}Q60 ${my + 12} 72 ${my}" fill="none" ${s}/>${fangs}`;
    }
  }

  function moodExtras(mood, fy, eyesType) {
    let out = "";
    if (mood === "happy") {
      out += `<ellipse cx="33" cy="${fy + 13}" rx="6.5" ry="4" fill="#ff5a8a" opacity=".45"/><ellipse cx="87" cy="${fy + 13}" rx="6.5" ry="4" fill="#ff5a8a" opacity=".45"/>`;
    }
    if (mood === "sad") {
      const x = eyesType === "big1" ? 48 : 40;
      out += `<path class="qa-tear" d="M${x} ${fy + 8}q-4 7 0 9q4-2 0-9z" fill="#6ec6ff" stroke="${INK}" stroke-width="1.4"/>`;
    }
    if (mood === "shock") {
      out += `<path d="M96 ${fy - 26}l3-8M102 ${fy - 20}l8-3M100 ${fy - 14}l7 2" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`;
    }
    return out;
  }

  function genericSvg(c, mood) {
    const shape = SHAPES[c.shape] || SHAPES.round;
    const fy = shape.face;
    const acc = accessory(c.acc, shape.top, c.color);
    const spots = c.extra === "spots"
      ? `<circle cx="33" cy="${fy + 26}" r="4" fill="#000" opacity=".12"/><circle cx="85" cy="${fy + 22}" r="5" fill="#000" opacity=".12"/><circle cx="78" cy="${fy + 33}" r="2.6" fill="#000" opacity=".12"/>`
      : "";
    const glasses = c.acc === "glasses"
      ? `<g fill="none" stroke="${INK}" stroke-width="${SW}"><circle cx="46" cy="${fy}" r="13"/><circle cx="74" cy="${fy}" r="13"/><path d="M59 ${fy - 1}H61M33 ${fy - 2}L26 ${fy - 5}M87 ${fy - 2}L94 ${fy - 5}"/></g>`
      : "";
    return acc.back +
      `<path d="${shape.d}" fill="${c.color}" stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round"/>` +
      `<path d="${shape.d}" fill="url(#qaShade)" opacity=".9"/>` +
      `<ellipse cx="42" cy="${shape.top + 14}" rx="8" ry="4.5" fill="#fff" opacity=".35" transform="rotate(-25 42 ${shape.top + 14})"/>` +
      spots +
      eyesSvg(c.eyes, fy, mood, c.color) + glasses +
      mouthSvg(mood, fy + 19, c.extra) +
      moodExtras(mood, fy, c.eyes) +
      acc.front;
  }

  // ---------------- Лісі (img/char4.svg, 640×480) ----------------
  function lisiSvg(mood) {
    const mouthStyle = {
      idle: "",
      happy: "transform:scale(1.08,1.15)",
      sad: "transform:scale(.62,.32) translateY(-14px)",
      write: "transform:scale(.62,.32) translateY(-14px)",
      shock: "transform:scale(.8,1.3)",
    }[mood] || "";
    const pd = mood === "sad" || mood === "write" ? 8 : 0;
    const pupilCls = mood === "sad" || mood === "write" || mood === "shock" ? "" : "qa-p";
    const pr = mood === "shock" ? 0.6 : 1;
    let extras = "";
    if (mood === "happy") extras = `<ellipse cx="225" cy="245" rx="26" ry="15" fill="#ff5a8a" opacity=".45"/><ellipse cx="455" cy="235" rx="26" ry="15" fill="#ff5a8a" opacity=".45"/>`;
    if (mood === "sad") extras = `<path class="qa-tear" d="M280 205q-16 28 0 36q16-8 0-36z" fill="#6ec6ff" stroke="#000" stroke-width="5"/><path d="M250 128L320 142M445 128L380 142" stroke="#000" stroke-width="10" stroke-linecap="round"/>`;
    if (mood === "shock") extras = `<path d="M255 118Q295 92 330 122M370 120Q405 92 445 116" fill="none" stroke="#000" stroke-width="10" stroke-linecap="round"/>`;
    return `<g transform="translate(-18.75 3) scale(.25)">
      <path fill="#ffaa56" stroke="#000" stroke-width="10" d="m244.54,56.15c-50,30 -108.6,45 -108.6,93.59c0,70 -5,150 0,220.02c60,35 90,52 142.72,62.44c80,-25 160,-50 215.06,-101.78c10,-70 -5,-155 -18.82,-229.24c-45,-25 -90,-42 -134.79,-57.48c-35,-3 -60,2 -95.57,12.46z"/>
      <path fill="url(#qaShade)" opacity=".9" d="m244.54,56.15c-50,30 -108.6,45 -108.6,93.59c0,70 -5,150 0,220.02c60,35 90,52 142.72,62.44c80,-25 160,-50 215.06,-101.78c10,-70 -5,-155 -18.82,-229.24c-45,-25 -90,-42 -134.79,-57.48c-35,-3 -60,2 -95.57,12.46z"/>
      <g class="qa-e" transform="translate(13.08,-0.44)"><ellipse fill="#fff" cx="394.27" cy="168.77" rx="35" ry="27"/>
        <g class="${pupilCls}"><ellipse fill="#000" cx="${399.78 - pd}" cy="${171.34 + pd}" rx="${11.57 * pr}" ry="${9.47 * pr}"/></g></g>
      <g class="qa-e" transform="translate(8.29,2.43)"><ellipse fill="#fff" cx="288.78" cy="170.22" rx="36" ry="25"/>
        <g class="${pupilCls}"><ellipse fill="#7efc00" stroke="#000" stroke-width="10" cx="${294.29 - pd}" cy="${172.14 + pd}" rx="${6.71 * pr}" ry="${3.93 * pr}"/></g></g>
      <g class="${mood === "idle" ? "qa-chomp" : "qa-mouth"}" style="${mouthStyle}">
        <path fill="#ba7a3f" stroke="#000" stroke-width="3" d="m243.56,261.27c35,4 95.46,8.61 95.46,8.61c40,-5 113.46,-13.3 113.14,-13.91c-2,15 -9.07,50.69 -9.39,50.08c-30,20 -136.61,76.51 -136.61,76.51c-25,-20 -74.33,-70.42 -74.66,-71.03c-2,-15 12.06,-50.25 12.06,-50.25z"/>
        <path fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round" d="M 252,262 C 285,266 339,269 339,269 C 380,264 440,257 440,257 L 428,272 L 418,260 L 405,277 L 392,263 L 378,281 L 362,267 L 347,284 L 332,270 L 317,284 L 302,268 L 288,279 L 275,265 L 263,274 Z"/>
        <path fill="#5e3f23" d="m306.73,381.25l-29.92,-28.68c0,0 7.27,-20.11 16.53,-19.7c9.26,0.41 13.59,24.09 13.53,24.03c-0.06,-0.06 8.09,-26.08 18.32,-25.12c10.23,0.97 14.89,27.65 14.82,29.65c-0.06,2 -33.29,19.83 -33.29,19.83z"/>
        <path fill="#fff" d="m306.53,382.26c0,0 -28.82,-26.77 -28.89,-26.81c-0.06,-0.04 0.06,-9.84 0.06,-9.84c0,0 14.41,1.65 14.35,1.61c-0.06,-0.04 0.06,12.81 0.06,12.81c0,0 2.06,-13.18 2,-13.22c-0.06,-0.04 12.83,0.86 12.77,0.82c-0.06,-0.04 0.06,14.45 0,14.41c-0.06,-0.04 2.33,-15.2 2.26,-15.24c-0.06,-0.04 11.59,-0.17 11.53,-0.21c-0.06,-0.04 0.68,15.07 0.62,15.03c-0.06,-0.04 1.71,-15.61 1.65,-15.65c-0.06,-0.04 16.12,-0.58 16.06,-0.62c-0.06,-0.04 0.06,13.83 0,13.79c-0.06,-0.04 3.15,-14.17 3.09,-14.21c-0.06,-0.04 17.97,0.04 17.91,0c-0.06,-0.04 -0.97,7.25 -1.03,7.21c-0.06,-0.04 -52.44,30.1 -52.44,30.1z"/>
      </g>
      ${extras}
    </g>`;
  }

  // ---------------- Карен (img/char8.svg, 600×480, трохи освіжена) ----------------
  function karenSvg(mood) {
    const won = mood === "happy";
    const shadesY = won ? 100 : 0; // перемога — окуляри з'їжджають на очі («deal with it»)
    const pd = mood === "sad" || mood === "write" ? 7 : 0;
    const pupilCls = mood === "sad" || mood === "write" || mood === "shock" ? "" : "qa-p";
    const pr = mood === "shock" ? 0.55 : 1;
    const brows = mood === "sad"
      ? `<path d="M 222,214 L 280,196" stroke="#000" stroke-width="9" stroke-linecap="round"/><path d="M 388,214 L 330,196" stroke="#000" stroke-width="9" stroke-linecap="round"/>`
      : mood === "shock"
        ? `<path d="M 220,196 Q 255,176 288,196" fill="none" stroke="#000" stroke-width="9" stroke-linecap="round"/><path d="M 322,196 Q 355,176 390,196" fill="none" stroke="#000" stroke-width="9" stroke-linecap="round"/>`
        : `<g class="qa-brow"><path d="M 218,220 L 282,240 C 282,224 280,205 221,200" fill="#ff6fa5" stroke="#000" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
           <path d="M 382,220 L 318,240 C 318,224 320,205 379,200" fill="#ff6fa5" stroke="#000" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></g>`;
    const mouth = {
      idle: `<path d="M240,305 L272,290 L300,303 L328,288 L365,305" fill="none" stroke="#7a1140" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`,
      write: `<path d="M240,305 L272,290 L300,303 L328,288 L365,305" fill="none" stroke="#7a1140" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`,
      happy: `<path d="M245,300 Q300,318 352,284" fill="none" stroke="#7a1140" stroke-width="11" stroke-linecap="round"/>`,
      sad: `<path d="M245,318 Q272,296 300,310 Q328,296 358,318" fill="none" stroke="#7a1140" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`,
      shock: `<ellipse cx="302" cy="308" rx="22" ry="28" fill="#5a0d30" stroke="#000" stroke-width="8"/>`,
    }[mood];
    return `<g transform="translate(-14.2 -0.8) scale(.24)">
      <path fill="#ff6fa5" stroke="#000" stroke-width="10" stroke-linejoin="round" d="M 507.4,260.0 Q 462.3,307.7 417.2,355.5 Q 376.3,405.2 335.4,455.0 Q 280.3,420.4 225.2,385.7 Q 168.3,356.2 111.5,326.6 Q 133.1,267.6 154.6,208.6 Q 175.5,147.2 196.3,85.7 Q 261.3,100.5 326.3,115.4 Q 392.6,123.0 458.9,130.6 Q 483.1,195.3 507.4,260.0 Z"/>
      <path fill="url(#qaShade)" opacity=".9" d="M 507.4,260.0 Q 462.3,307.7 417.2,355.5 Q 376.3,405.2 335.4,455.0 Q 280.3,420.4 225.2,385.7 Q 168.3,356.2 111.5,326.6 Q 133.1,267.6 154.6,208.6 Q 175.5,147.2 196.3,85.7 Q 261.3,100.5 326.3,115.4 Q 392.6,123.0 458.9,130.6 Q 483.1,195.3 507.4,260.0 Z"/>
      <ellipse cx="210" cy="300" rx="26" ry="14" fill="#ff3d7f" opacity="${won ? 0.55 : 0.3}"/><ellipse cx="400" cy="300" rx="26" ry="14" fill="#ff3d7f" opacity="${won ? 0.55 : 0.3}"/>
      <g class="qa-e"><ellipse fill="#fff" stroke="#000" stroke-width="6" cx="255" cy="235" rx="30" ry="26"/>
        <g class="${pupilCls}"><ellipse fill="#000" cx="${248 - pd}" cy="${238 + pd}" rx="${10 * pr}" ry="${12 * pr}"/><circle cx="${251 - pd}" cy="${234 + pd}" r="3" fill="#fff"/></g></g>
      <g class="qa-e"><ellipse fill="#fff" stroke="#000" stroke-width="6" cx="355" cy="235" rx="30" ry="26"/>
        <g class="${pupilCls}"><ellipse fill="#000" cx="${362 - pd}" cy="${238 + pd}" rx="${10 * pr}" ry="${12 * pr}"/><circle cx="${365 - pd}" cy="${234 + pd}" r="3" fill="#fff"/></g></g>
      ${won ? "" : brows}
      ${mouth}
      <g class="qa-shades" style="transform:translateY(${shadesY}px)">
        <path d="M 215,135 Q 300,110 385,135" stroke="#111" stroke-width="8" fill="none" stroke-linecap="round"/>
        <rect x="220" y="115" width="68" height="38" rx="10" fill="#222" stroke="#000" stroke-width="5"/>
        <rect x="312" y="115" width="68" height="38" rx="10" fill="#222" stroke="#000" stroke-width="5"/>
        <path d="M 228,122 L 245,142 M 240,121 L 252,135" stroke="#fff" stroke-width="3.5" opacity=".55" stroke-linecap="round"/>
        <path d="M 320,122 L 337,142 M 332,121 L 344,135" stroke="#fff" stroke-width="3.5" opacity=".55" stroke-linecap="round"/>
        <rect x="288" y="125" width="24" height="6" fill="#000"/>
      </g>
      ${mood === "happy" ? "" : `<g class="qa-vein" style="${mood === "shock" ? "transform:scale(1.35)" : ""}"><path d="M 420 160 L 435 180 L 450 160 M 465 180 L 445 195 L 465 210 M 405 180 L 425 195 L 405 210 M 420 230 L 435 210 L 450 230" stroke="#e74c3c" stroke-width="8" stroke-linecap="round" fill="none"/></g>`}
      ${mood === "sad" ? `<path class="qa-tear" d="M228 262q-14 26 0 32q14-6 0-32z" fill="#6ec6ff" stroke="#000" stroke-width="5"/>` : ""}
    </g>`;
  }

  const MOODS = ["idle", "happy", "sad", "shock", "write"];
  const cache = {};

  function svg(id, mood) {
    const c = byId(id);
    const m = MOODS.includes(mood) ? mood : "idle";
    const key = c.id + "|" + m;
    if (cache[key]) return cache[key];
    const inner = c.special === "lisi" ? lisiSvg(m) : c.special === "karen" ? karenSvg(m) : genericSvg(c, m);
    cache[key] = `<svg class="qa-svg qa-m-${m}" viewBox="0 -12 120 136" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
      `<ellipse cx="60" cy="116" rx="34" ry="5.5" fill="#000" opacity=".22" class="qa-shadow"/>` +
      `<g class="qa-b">${inner}</g></svg>`;
    return cache[key];
  }

  function html(player, mood, extraClass) {
    const c = byId(player && player.character);
    const delay = -((c.id * 0.73) % 4).toFixed(2);
    return `<div class="qa-av ${extraClass || ""}" style="--qa-d:${delay}s;--qa-c:${c.color}">${svg(c.id, mood)}</div>`;
  }

  // ---------------- спільний CSS (один раз на сторінку) ----------------
  function injectStyles() {
    if (document.getElementById("qa-styles")) return;
    const defs = document.createElement("div");
    defs.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    defs.innerHTML = `<svg width="0" height="0" aria-hidden="true"><defs>
      <linearGradient id="qaShade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/>
        <stop offset="1" stop-color="#000" stop-opacity=".2"/></linearGradient></defs></svg>`;
    document.body.appendChild(defs);
    const st = document.createElement("style");
    st.id = "qa-styles";
    st.textContent = `
.qa-av{display:inline-flex;align-items:center;justify-content:center;line-height:0}
.qa-svg{width:100%;height:100%;overflow:visible;display:block}
.qa-b,.qa-e,.qa-p,.qa-chomp,.qa-mouth,.qa-brow,.qa-vein,.qa-shades,.qa-tear{transform-box:fill-box}
.qa-b{transform-origin:50% 100%;animation:qa-breathe 3.6s ease-in-out infinite;animation-delay:var(--qa-d,0s)}
.qa-e{transform-origin:center;animation:qa-blink 4.4s ease-in-out infinite;animation-delay:var(--qa-d,0s)}
.qa-p{transform-origin:center;animation:qa-look 7s cubic-bezier(.25,1,.5,1) infinite;animation-delay:var(--qa-d,0s)}
.qa-chomp{transform-origin:center;animation:qa-chomp 7.2s ease-in-out infinite}
.qa-mouth{transform-origin:center;transition:transform .3s}
.qa-brow{animation:qa-brow 2.8s ease-in-out infinite}
.qa-vein{transform-origin:center;animation:qa-pop 1.8s ease-in-out infinite}
.qa-shades{transition:transform .5s cubic-bezier(.3,1.6,.5,1)}
.qa-tear{animation:qa-tear 1.6s ease-in infinite}
.qa-m-happy .qa-b{animation:qa-hop .55s ease-in-out infinite}
.qa-m-sad .qa-b{animation:qa-droop 3.2s ease-in-out infinite}
.qa-m-shock .qa-b{animation:qa-shake .35s ease-in-out 4}
.qa-m-write .qa-b{animation:qa-wiggle 1.4s ease-in-out infinite}
.qa-still .qa-b,.qa-still .qa-e,.qa-still .qa-p,.qa-still .qa-chomp{animation:none}
@keyframes qa-breathe{0%,100%{transform:scale(1,1)} 50%{transform:scale(1.03,.96)}}
@keyframes qa-blink{0%,91%,100%{transform:scaleY(1)} 95%{transform:scaleY(.08)}}
@keyframes qa-look{0%,18%{transform:translate(0,0)} 22%,42%{transform:translate(1.6px,-.6px)} 46%,66%{transform:translate(-1.5px,.8px)} 70%,86%{transform:translate(-1.6px,-.3px)} 90%,100%{transform:translate(0,0)}}
@keyframes qa-chomp{0%,32%{transform:scale(1,1)} 48%,72%{transform:scale(.62,.32) translateY(-14px)} 86%,100%{transform:scale(1,1)}}
@keyframes qa-brow{0%,100%{transform:translateY(0)} 50%{transform:translateY(-3px)}}
@keyframes qa-pop{0%,100%{transform:scale(1)} 50%{transform:scale(1.25) rotate(5deg)}}
@keyframes qa-tear{0%{transform:translateY(0);opacity:0} 20%{opacity:1} 100%{transform:translateY(9px);opacity:0}}
@keyframes qa-hop{0%,100%{transform:translateY(0) scale(1,1)} 40%{transform:translateY(-7%) scale(.97,1.04)} 80%{transform:translateY(0) scale(1.05,.94)}}
@keyframes qa-droop{0%,100%{transform:scale(1.02,.94) rotate(-2deg)} 50%{transform:scale(1.04,.92) rotate(2deg)}}
@keyframes qa-shake{0%,100%{transform:translateX(0)} 25%{transform:translateX(-4%) rotate(-3deg)} 75%{transform:translateX(4%) rotate(3deg)}}
@keyframes qa-wiggle{0%,100%{transform:rotate(0)} 25%{transform:rotate(-3deg)} 75%{transform:rotate(3deg)}}
@media (prefers-reduced-motion:reduce){.qa-b,.qa-p,.qa-chomp,.qa-brow,.qa-vein,.qa-tear{animation:none!important}}`;
    document.head.appendChild(st);
  }
  if (document.body) injectStyles();
  else document.addEventListener("DOMContentLoaded", injectStyles);

  window.QuiplashAvatars = { CHARACTERS, COUNT, byId, svg, html, color: (id) => byId(id).color, name: (id) => byId(id).name };
})();
