// ==========================================================================
// Журнал онлайн-ігор: що відбувалось у кімнаті — щоб розбиратись у дивних моментах
// («гра сама пішла далі, хоч таймер ще йшов») не з чиїхось спогадів, а за записом.
//
// Пише кожен телефон у кімнаті (Realtime Database):
//   glogi/{гра}/{журнал}         — короткий опис для списку (кімната, гравці, час)
//   glog/{гра}/{журнал}/{подія}  — { t: час сервера (момент запису пачки), o: скільки мс до того сталася
//                                   подія (за годинником телефона — збитий годинник не плутає порядок),
//                                   u: гравець, k: вид, d: JSON-деталі, s: сесія (дві вкладки одного гравця) }
// Журнал = кімната + «ігровий день» (день міняється о 06:00 за Києвом, тож нічна
// гра лишається одним журналом). Переглядати — logs.html (вкладка dev).
//
//   GameLog.attach({ game, room, user, now })  — під'єднатись до кімнати (рушій робить сам)
//   GameLog.ev(kind, data)                      — записати подію
//
// Самі ловляться: помилки JS, згортання/повернення застосунку, втрата мережі,
// розрив/відновлення з'єднання з базою, закриття сторінки.
// Події збираються пачкою і пишуться раз на ~3 с одним запитом; ліміт — 2500 на сесію.
// ==========================================================================
(function () {
  // заглушка з online-engine.js могла вже назбирати події й виклик attach — підхоплюємо
  const stub = window.GameLog && window.GameLog._stub ? window.GameLog : null;
  const pre = stub ? stub._q : [];
  const MAX_EVENTS = 2500, FLUSH_MS = 3000, D_MAX = 3800;
  let ctx = null, queue = [], sent = 0, timer = null, connWatch = false, lastConn = null;
  const session = Math.random().toString(36).slice(2, 7);

  const now = () => (ctx && ctx.now ? ctx.now() : Date.now());
  const clean = (s) => String(s || "").replace(/[.#$\[\]\/]/g, "_").slice(0, 60) || "_";
  function day(t) {
    // «ігровий день» за Києвом, межа о 06:00
    try {
      const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t - 6 * 3600e3));
      return p.replace(/-/g, "");
    } catch (e) { return new Date(t - 4 * 3600e3).toISOString().slice(0, 10).replace(/-/g, ""); }
  }
  function client() {
    const C = window.Capacitor, app = !!(C && C.isNativePlatform && C.isNativePlatform());
    const ua = navigator.userAgent || "";
    const os = /Android [\d.]+/.exec(ua) || /iPhone OS [\d_]+/.exec(ua) || /Windows NT [\d.]+/.exec(ua) || /Mac OS X [\d_]+/.exec(ua);
    const br = /SamsungBrowser\/[\d.]+/.exec(ua) || /Firefox\/[\d.]+/.exec(ua) || /CriOS\/[\d.]+/.exec(ua) || /Chrome\/[\d]+/.exec(ua) || /Version\/[\d.]+ (Mobile\/\w+ )?Safari/.exec(ua);
    return { app, os: os ? os[0] : "?", br: br ? br[0] : "?", w: innerWidth, h: innerHeight };
  }

  function ev(kind, data) {
    if (!ctx) { pre.push([kind, data]); return; }
    if (sent + queue.length >= MAX_EVENTS) return;
    let d = null;
    if (data !== undefined && data !== null) {
      try { d = typeof data === "string" ? data : JSON.stringify(data); } catch (e) { d = String(data); }
      if (d.length > D_MAX) d = d.slice(0, D_MAX) + "…";
    }
    const e = { lt: Date.now(), u: ctx.user, k: String(kind).slice(0, 38) };
    if (d !== null) e.d = d;
    e.s = session;
    queue.push(e);
    if (queue.length >= 25) flush(); else if (!timer) timer = setTimeout(flush, FLUSH_MS);
  }

  function flush() {
    clearTimeout(timer); timer = null;
    if (!ctx || !queue.length || !window.rtdb) return;
    const batch = queue.splice(0, queue.length), base = window.rtdb.ref(`glog/${ctx.game}/${ctx.id}`), upd = {};
    const TS = firebase.database.ServerValue.TIMESTAMP, fl = Date.now();
    batch.forEach((e) => {
      const o = Object.assign({ t: TS, o: Math.max(0, fl - e.lt) }, e); delete o.lt;
      upd[base.push().key] = o;
    });
    sent += batch.length;
    base.update(upd).catch((err) => console.warn("[GameLog]", err && err.code));
    window.rtdb.ref(`glogi/${ctx.game}/${ctx.id}`).update({ room: ctx.room, lastAt: TS, [`players/${clean(ctx.user)}`]: TS }).catch(() => {});
  }

  function attach(o) {
    if (!o || !o.game || !o.room || !o.user) return;
    const t = (o.now || Date.now)();
    const id = clean(o.room) + "_" + day(t);
    if (ctx && ctx.game === clean(o.game) && ctx.id === id && ctx.user === o.user) return;
    if (ctx) flush();
    ctx = { game: clean(o.game), room: String(o.room).slice(0, 40), id, user: String(o.user).slice(0, 50), now: o.now };
    // clk — «час сервера» на думку телефона: різниця з справжнім покаже збитий годинник
    ev("join", Object.assign({ page: location.pathname.split("/").pop() || "index", clk: Math.round(now()) }, client()));
    pre.splice(0).forEach(([k, d]) => ev(k, d));
    if (!connWatch && window.rtdb) {
      connWatch = true;
      window.rtdb.ref(".info/connected").on("value", (s) => {
        const v = s.val() === true;
        if (lastConn !== null && v !== lastConn) ev(v ? "db-on" : "db-off");
        lastConn = v;
      });
    }
  }
  function detach() { if (ctx) { ev("leave"); flush(); ctx = null; } }

  // ---- те, що ловиться саме ----
  addEventListener("error", (e) => ev("err", { m: String(e.message || e.error || "?").slice(0, 300), at: (e.filename || "").split("/").pop() + ":" + (e.lineno || 0) }));
  addEventListener("unhandledrejection", (e) => { const r = e.reason; ev("err", { m: "promise: " + String((r && (r.message || r.code)) || r).slice(0, 300) }); });
  document.addEventListener("visibilitychange", () => { ev(document.visibilityState === "visible" ? "back" : "hidden"); if (document.visibilityState === "hidden") flush(); });
  addEventListener("online", () => ev("net-on"));
  addEventListener("offline", () => ev("net-off"));
  addEventListener("pagehide", () => { ev("close"); flush(); });

  window.GameLog = { attach, detach, ev, flush, get ctx() { return ctx && { game: ctx.game, id: ctx.id, room: ctx.room }; } };
  if (stub && stub._a) attach(stub._a);
})();
