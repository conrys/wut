/* Карти з редактора (ads/mapedit) — підвантаження в ігри.
   Підключення одразу після world.js (і після agents/maps.js), до game.js:
     <script src="../maps-remote.js" data-world="hns" data-game="khovanky"></script>
   data-world: «hns» — карти Хованок (Хованки, Монстр, Агенти), «ph» — карти Перевтілення.
   data-game: яка це гра — нові карти потрапляють лише в ігри, позначені в редакторі.
   data-select="none" — не додавати нові карти у #mapSel (гра робить список сама).

   RTDB /maps/{world}_{id} = JSON-рядок карти. Виправлена вбудована карта (той самий id) замінює вбудовану на місці;
   нова карта додається в кінець HNSWorld.MAPS. Останній знімок лежить у localStorage, тож карти є й офлайн
   і вже в першому раунді; свіже з бази застосовується, щойно прийде (до наступного раунду). */
(function () {
  const HW = window.HNSWorld; if (!HW) return;
  const sc = document.currentScript, world = (sc && sc.dataset.world) || "hns", game = (sc && sc.dataset.game) || "", noSel = sc && sc.dataset.select === "none";
  const KEY = "maps41_" + world;
  const builtin = {}; HW.MAPS.forEach((m) => { builtin[m.id] = Object.assign({}, m); });
  const FIELDS = ["name", "rows", "floor", "furn", "grass", "spawn", "noHide", "waypoints", "rooms"];
  const applied = new Set();

  function valid(m) {
    if (!m || typeof m.id !== "string" || !Array.isArray(m.rows) || m.rows.length < 4 || m.rows.length > 80) return false;
    const w = m.rows[0].length; if (w < 4 || w > 80 || !m.rows.every((r) => typeof r === "string" && r.length === w)) return false;
    if (!m.floor || typeof m.floor !== "object" || !Array.isArray(m.furn) || !Array.isArray(m.spawn)) return false;
    for (const r of m.rows) for (const ch of r) if (ch !== "#" && !m.floor[ch]) return false;
    return true;
  }
  function addOpt(i, name) {
    if (noSel) return;
    const put = () => { const s = document.getElementById("mapSel"); if (!s || [...s.options].some((o) => o.value === String(i))) return;
      const o = document.createElement("option"); o.value = String(i); o.textContent = name + " ✎"; s.appendChild(o); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", put); else put();
  }
  function apply(list) {
    const seen = new Set();
    for (const m of list.slice().sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (!valid(m)) continue; seen.add(m.id);
      const i = HW.MAPS.findIndex((x) => x.id === m.id);
      if (builtin[m.id]) { const d = HW.MAPS[i]; for (const k of FIELDS) if (m[k] !== undefined) d[k] = m[k]; d.edited = true; applied.add(m.id); continue; }
      if (!(m.games || []).includes(game)) continue;
      const def = { id: m.id, custom: true }; for (const k of FIELDS) if (m[k] !== undefined) def[k] = m[k];
      if (!def.waypoints || !def.waypoints.length) def.waypoints = [def.spawn];
      if (i >= 0) Object.assign(HW.MAPS[i], def); else { HW.MAPS.push(def); addOpt(HW.MAPS.length - 1, def.name || "Нова карта"); }
    }
    // виправлення прибрали в редакторі — повертаємо вбудовану
    for (const id of [...applied]) if (!seen.has(id)) { const d = HW.MAPS.find((x) => x.id === id); if (d) { for (const k of FIELDS) d[k] = builtin[id][k]; delete d.edited; } applied.delete(id); }
    window.dispatchEvent(new CustomEvent("maps41", { detail: { world } }));
  }
  try { const c = JSON.parse(localStorage.getItem(KEY) || "[]"); if (Array.isArray(c)) apply(c); } catch (e) {}
  try {
    if (!window.firebase || !firebase.database) return;
    firebase.database().ref("maps").once("value").then((snap) => {
      const v = snap.val() || {}, list = [];
      for (const k in v) { if (k.indexOf(world + "_") !== 0) continue; try { list.push(JSON.parse(v[k])); } catch (e) {} }
      try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {}
      apply(list);
    }, () => {});
  } catch (e) {}
})();
