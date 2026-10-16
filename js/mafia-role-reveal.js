// ==========================================================================
// mafia-role-reveal.js — розкриття ролі: папка-досьє.
//
// Закрита справа ("ЦІЛКОМ ТАЄМНО") виїжджає знизу → обкладинка
// розгортається на лівому згині → ліворуч фото гравця на скріпці,
// праворуч аркуш досьє з предметом ролі → на аркуш падає штамп ролі
// (для дона — ще й другий штамп "ДОН").
//
// Уся анімація — CSS (класи + animation-delay), без rAF.
//
// Публічний API (той самий, що й у попередній версії):
//   MafiaRoleReveal.mount(containerEl)
//   MafiaRoleReveal.play(role, opts) — role: "mafia"|"doctor"|"sheriff"|"civilian";
//     opts.isDon, opts.name (ім'я на фото), opts.avatarHtml (готовий <span class="av">),
//     opts.onDone
//   MafiaRoleReveal.DURATION_MS — коли штамп уже стоїть.
// ==========================================================================
(function () {
  "use strict";

  const DURATION_MS = 2500;
  const DON_EXTRA_MS = 450;

  const ROLES = {
    mafia: { stamp: "МАФІЯ", color: "#a8141c", title: "Мафія", note: "Член сім'ї. Діє вночі." },
    doctor: { stamp: "ЛІКАР", color: "#11684f", title: "Лікар", note: "Рятує одного щоночі." },
    sheriff: { stamp: "ШЕРИФ", color: "#1d4a86", title: "Шериф", note: "Перевіряє одного щоночі." },
    civilian: { stamp: "МИРНИЙ", color: "#3a3631", title: "Мирний житель", note: "Шукає мафію вдень." },
  };

  // Предмети ролі — окремі ассети в img/mafia/items/ (можна замінити на PNG
  // з тією ж назвою-ключем, розмітка від формату не залежить).
  const ITEM_SRC = {
    mafia: "img/mafia/items/pistol.svg",
    doctor: "img/mafia/items/stethoscope.svg",
    sheriff: "img/mafia/items/badge.svg",
    civilian: "img/mafia/items/passport.svg",
  };

  const CLIP = `<svg class="fd-clip" viewBox="0 0 24 64" aria-hidden="true"><path d="M7 20V8a5 5 0 0 1 10 0v40a8 8 0 0 1-16 0V14" fill="none" stroke="#7d8287" stroke-width="2.2" stroke-linecap="round"/><path d="M7 20V8a5 5 0 0 1 10 0" fill="none" stroke="#c9ced3" stroke-width="1" stroke-linecap="round" opacity=".8"/></svg>`;

  const STYLE_ID = "mafia-role-reveal-styles";
  const CSS = `
.fd-stage { --W: min(43vw, 200px); --H: calc(var(--W) * 1.36); position: relative; width: calc(var(--W) * 2); height: calc(var(--H) + 34px);
  margin: 18px auto 8px; perspective: 1500px; }
.fd-lift { position: absolute; inset: 22px 0 0 0; transform: translateY(130%) rotate(-5deg); opacity: 0; }
.fd { position: absolute; left: 0; top: 0; width: calc(var(--W) * 2); height: var(--H); transform-style: preserve-3d;
  transform: translateX(calc(var(--W) * -0.5)); }
.fd-back, .fd-cover { position: absolute; top: 0; left: var(--W); width: var(--W); height: var(--H); }
.fd-back { border-radius: 3px 8px 8px 3px; background: linear-gradient(160deg, #e4cd9b 0%, #d6ba82 55%, #c9a96d 100%);
  box-shadow: 0 18px 40px rgba(0,0,0,.55), inset 0 0 0 1px rgba(80,55,20,.35); }
.fd-back::before { content: ""; position: absolute; top: -15px; right: 12px; width: 42%; height: 18px; border-radius: 7px 7px 0 0;
  background: linear-gradient(180deg, #e8d3a4, #dcc18a); box-shadow: inset 0 0 0 1px rgba(80,55,20,.3); }
.fd-cover { transform-origin: left center; transform-style: preserve-3d; z-index: 3; }
.fd-face { position: absolute; inset: 0; backface-visibility: hidden; -webkit-backface-visibility: hidden; overflow: hidden; }
.fd-front { border-radius: 3px 8px 8px 3px; background:
    radial-gradient(circle at 70% 78%, transparent 17px, rgba(110,70,25,.16) 18px, rgba(110,70,25,.08) 21px, transparent 22px),
    linear-gradient(155deg, #e9d3a3 0%, #dbbf86 50%, #caa96c 100%);
  box-shadow: inset 0 0 0 1px rgba(80,55,20,.4), inset 6px 0 10px -6px rgba(80,55,20,.5); }
.fd-label { position: absolute; left: 12%; right: 12%; top: 16%; background: #f6f0e1; border: 1px solid rgba(60,45,20,.5); padding: 6px 8px 7px;
  font-family: 'IBM Plex Mono', monospace; color: #2b231c; box-shadow: 0 1px 2px rgba(0,0,0,.2); }
.fd-label .l1 { font-size: 9px; letter-spacing: .18em; text-transform: uppercase; opacity: .7; }
.fd-label .l2 { font-size: 15px; font-weight: 500; margin-top: 2px; letter-spacing: .06em; }
.fd-label .line { height: 1px; background: rgba(43,35,28,.35); margin-top: 6px; }
.fd-secret { position: absolute; left: 50%; top: 58%; transform: translate(-50%,-50%) rotate(-14deg); white-space: nowrap;
  font-family: 'Oswald', sans-serif; font-weight: 700; font-size: calc(var(--W) * .115); letter-spacing: .08em; color: #a8141c;
  border: 3px solid #a8141c; border-radius: 4px; padding: 3px 9px; opacity: .82; mix-blend-mode: multiply;
  -webkit-mask-image: radial-gradient(circle at 30% 40%, #000 55%, rgba(0,0,0,.65) 75%); mask-image: radial-gradient(circle at 30% 40%, #000 55%, rgba(0,0,0,.65) 75%); }
.fd-string { position: absolute; right: 8px; top: 50%; width: 18px; height: 40px; transform: translateY(-50%); }
.fd-string i { position: absolute; left: 3px; width: 12px; height: 12px; border-radius: 50%; background: #b9965a; box-shadow: inset 0 0 0 1px rgba(60,40,15,.6), 0 1px 1px rgba(0,0,0,.3); }
.fd-string i:nth-child(1) { top: 0; } .fd-string i:nth-child(2) { bottom: 0; }
.fd-string b { position: absolute; left: 8px; top: 6px; width: 2px; height: 28px; background: #7a2d22; border-radius: 1px; transform: rotate(8deg); }
.fd-inner { transform: rotateY(180deg); border-radius: 8px 3px 3px 8px; background: linear-gradient(200deg, #e2c992 0%, #d3b67c 60%, #c4a467 100%);
  box-shadow: inset 0 0 0 1px rgba(80,55,20,.35), inset -8px 0 12px -8px rgba(80,55,20,.55); }
.fd-photo { position: absolute; left: 16%; top: 13%; width: 62%; background: #f8f5ee; padding: 7px 7px 22px; transform: rotate(-5deg);
  box-shadow: 0 4px 10px rgba(0,0,0,.35); }
.fd-photo .pic { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; background: #2a2622; overflow: hidden; }
.fd-photo .pic .av { width: 92%; height: 92%; box-shadow: none; filter: sepia(.45) contrast(1.05); }
.fd-photo .cap { position: absolute; left: 0; right: 0; bottom: 3px; text-align: center; font-family: 'Caveat', cursive; font-size: 16px; color: #2b3a6b;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 4px; }
.fd-clip { position: absolute; left: 44%; top: 4%; width: 13px; height: 36px; z-index: 2; transform: rotate(4deg); filter: drop-shadow(0 1px 1px rgba(0,0,0,.4)); }
.fd-hand { position: absolute; left: 12%; right: 10%; bottom: 9%; font-family: 'Caveat', cursive; font-size: 15px; color: #2b3a6b; transform: rotate(-3deg); line-height: 1.1; }
.fd-shade { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; background: linear-gradient(90deg, rgba(0,0,0,.45), transparent 70%); opacity: 0; }
.fd-sheet { position: absolute; left: 7%; right: 7%; top: 5%; bottom: 5%; background: #f4efe2; transform: rotate(.8deg);
  box-shadow: 0 2px 5px rgba(0,0,0,.25); padding: 8px 9px; color: #2b231c; font-family: 'IBM Plex Mono', monospace;
  background-image: radial-gradient(circle at 80% 10%, rgba(255,255,255,.6), transparent 40%), radial-gradient(circle at 10% 95%, rgba(140,110,60,.12), transparent 45%); }
.fd-sheet .hd { display: flex; justify-content: space-between; font-size: 8px; letter-spacing: .14em; border-bottom: 1.5px solid #2b231c; padding-bottom: 3px; }
.fd-sheet .ev { position: relative; margin: 6px 0 5px; background: #e6dfcd; border: 1px solid rgba(43,35,28,.25); padding: 3px; }
.fd-sheet .ev img { display: block; width: 100%; aspect-ratio: 240 / 150; object-fit: contain; }
.fd-sheet .ev-tag { position: absolute; left: 4px; top: 3px; font-size: 6.5px; letter-spacing: .14em; color: rgba(43,35,28,.6); }
.fd-sheet .row { font-size: 9px; line-height: 1.3; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fd-sheet .row.note { white-space: normal; line-height: 1.25; }
.fd-sheet .row b { font-weight: 500; letter-spacing: .05em; }
.fd-sheet .bar { height: 5px; background: #1a1612; margin-top: 4px; border-radius: 1px; opacity: .85; }
.fd-stamp { position: absolute; left: 50%; bottom: 7%; transform: translateX(-50%) rotate(-9deg) scale(2.6); opacity: 0; z-index: 2;
  font-family: 'Oswald', sans-serif; font-weight: 700; font-size: calc(var(--W) * .135); line-height: 1.15; letter-spacing: .08em; color: var(--rc);
  border: 3px solid var(--rc); outline: 1.5px solid var(--rc); outline-offset: 2px; border-radius: 3px; padding: 1px 10px; white-space: nowrap;
  background: rgba(244,239,226,.93); box-shadow: 0 1px 4px rgba(0,0,0,.25); }
.fd-don { position: absolute; z-index: 3; right: 6%; top: 44%; transform: rotate(12deg) scale(2.4); opacity: 0; font-family: 'Oswald', sans-serif; font-weight: 700;
  font-size: calc(var(--W) * .1); letter-spacing: .1em; color: #7a1018; background: rgba(244,239,226,.95); border: 2.5px solid #7a1018; outline: 1px solid #7a1018; outline-offset: 2px;
  border-radius: 50%; padding: 7px 6px; box-shadow: 0 1px 4px rgba(0,0,0,.35); }

.fd-stage.run .fd-lift { animation: fdLift .65s cubic-bezier(.2,1.15,.3,1) forwards; }
.fd-stage.run .fd { animation: fdCenter .9s 1.0s cubic-bezier(.55,0,.2,1) forwards, fdThud .35s 2.05s ease-out; }
.fd-stage.run .fd-cover { animation: fdTease .35s .65s ease-in-out, fdOpen .9s 1.0s cubic-bezier(.55,0,.2,1) forwards; }
.fd-stage.run .fd-shade { animation: fdShade .9s 1.0s ease forwards; }
.fd-stage.run .fd-stamp { animation: fdStamp .32s 2.0s cubic-bezier(.3,1.6,.5,1) forwards; }
.fd-stage.run .fd-don { animation: fdDon .3s 2.45s cubic-bezier(.3,1.6,.5,1) forwards; }
@keyframes fdLift { to { transform: none; opacity: 1; } }
@keyframes fdTease { 50% { transform: rotateY(-14deg); } }
@keyframes fdOpen { from { transform: rotateY(0); } to { transform: rotateY(-180deg); } }
@keyframes fdCenter { to { transform: translateX(0); } }
@keyframes fdShade { 0% { opacity: 0; } 40% { opacity: 1; } 100% { opacity: 0; } }
@keyframes fdStamp { to { transform: translateX(-50%) rotate(-9deg) scale(1); opacity: 1; } }
@keyframes fdDon { to { transform: rotate(12deg) scale(1); opacity: 1; } }
@keyframes fdThud { 0% { transform: translateX(0); } 30% { transform: translateX(0) translateY(3px) scale(.995); } 100% { transform: translateX(0); } }
@media (prefers-reduced-motion: reduce) {
  .fd-stage.run .fd-lift, .fd-stage.run .fd, .fd-stage.run .fd-cover, .fd-stage.run .fd-stamp, .fd-stage.run .fd-don { animation-duration: .01s !important; animation-delay: 0s !important; }
}`;

  let stage = null;
  let doneTimer = null;

  function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function mount(container) {
    ensureStyles();
    container.innerHTML = `<div class="fd-stage" id="fdStage"></div>`;
    stage = container.querySelector("#fdStage");
    Object.values(ITEM_SRC).forEach((src) => { const im = new Image(); im.src = src; });
  }

  function caseNo(name) {
    let h = 7; for (const ch of String(name || "")) h = (h * 31 + ch.codePointAt(0)) % 9000;
    return String(1000 + h);
  }

  function build(role, opts) {
    const r = ROLES[role] || ROLES.civilian;
    const no = caseNo(opts.name);
    const bars = [88, 64].map((w) => `<div class="bar" style="width:${w}%"></div>`).join("");
    return `
      <div class="fd-lift">
        <div class="fd">
          <div class="fd-back">
            <div class="fd-sheet" style="--rc:${r.color}">
              <div class="hd"><span>ДОСЬЄ</span><span>№ ${no}</span></div>
              <div class="ev"><img src="${ITEM_SRC[role] || ITEM_SRC.civilian}" alt="" draggable="false" /><span class="ev-tag">ДОКАЗ № 1</span></div>
              <div class="row">ОСОБА: <b>${esc(opts.name || "—")}</b></div>
              <div class="row note">${esc(r.note)}</div>
              ${bars}
              <div class="fd-stamp">${r.stamp}</div>
            </div>
            <div class="fd-shade"></div>
          </div>
          <div class="fd-cover">
            <div class="fd-face fd-front">
              <div class="fd-label"><div class="l1">Справа</div><div class="l2">№ ${no}</div><div class="line"></div><div class="line"></div></div>
              <div class="fd-secret">ЦІЛКОМ ТАЄМНО</div>
              <div class="fd-string"><i></i><b></b><i></i></div>
            </div>
            <div class="fd-face fd-inner">
              ${CLIP}
              <div class="fd-photo"><div class="pic">${opts.avatarHtml || ""}</div><div class="cap">${esc(opts.name || "")}</div></div>
              ${opts.isDon && role === "mafia" ? '<div class="fd-don">ДОН</div>' : ""}
              <div class="fd-hand">Тримати в таємниці.<br>Нікому не показувати!</div>
            </div>
          </div>
        </div>
      </div>`;
  }

  function play(role, opts) {
    opts = opts || {};
    if (!stage) throw new Error("MafiaRoleReveal.play() called before mount()");
    stage.classList.remove("run");
    stage.innerHTML = build(role, opts);
    void stage.offsetWidth;
    stage.classList.add("run");
    clearTimeout(doneTimer);
    const total = DURATION_MS + (opts.isDon && role === "mafia" ? DON_EXTRA_MS : 0);
    if (typeof opts.onDone === "function") doneTimer = setTimeout(opts.onDone, total);
  }

  window.MafiaRoleReveal = { mount, play, DURATION_MS };
})();
