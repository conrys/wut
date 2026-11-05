/* Містечко — 3D-картинка (three.js), керування пальцем, збереження. Логіка — у sim.js (MistoSim). */
(function () {
  'use strict';
  const M = window.MistoSim, B = M.B, RES = M.RES, W = M.W, H = M.H, DX = M.DX, DY = M.DY;
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  const SAVE_KEY = 'misto_v1', STEP = 0.1, HS = 0.5;   // крок симуляції (с), висота одного рівня
  let S = null, acc = 0;

  // ================= збереження: телефон + хмара (якщо є акаунт 41 Games) =================
  function loadLocal() { try { const o = JSON.parse(ls.get(SAVE_KEY) || 'null'); return o && o.v === M.VER ? o : null; } catch (e) { return null; } }
  function saveLocal() { if (!S) return; S.saved = Date.now(); ls.set(SAVE_KEY, JSON.stringify(M.pack(S))); }
  let cloud = null, cloudT = 0;
  function cloudInit() {
    if (!window.firebase || !firebase.auth || !firebase.database) return;
    firebase.auth().onAuthStateChanged((u) => {
      if (!u || u.isAnonymous) { cloud = null; return; }
      cloud = firebase.database().ref('misto/' + u.uid);
      cloud.once('value').then((sn) => {
        const v = sn.val(); if (!v || typeof v.s !== 'string') return;
        let o = null; try { o = JSON.parse(v.s); } catch (e) { return; }
        if (o && o.v === M.VER && (o.saved || 0) > ((S && S.saved) || 0) + 5000) { S = o; rebuildAll(); toast('Завантажено з хмари'); }
      }).catch(() => {});
    });
  }
  function saveCloud() { if (!cloud || !S || Date.now() - cloudT < 30000) return; cloudT = Date.now(); cloud.set({ s: JSON.stringify(M.pack(S)), t: firebase.database.ServerValue.TIMESTAMP }).catch(() => {}); }
  setInterval(() => { saveLocal(); saveCloud(); }, 10000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { saveLocal(); cloudT = 0; saveCloud(); } });

  // ================= сцена =================
  const cv = $('gl');
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#9ED3F2');
  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 200);
  scene.add(new THREE.HemisphereLight('#FFFFFF', '#7A8F5A', 0.75));
  const sun = new THREE.DirectionalLight('#FFF6E0', 0.75); sun.position.set(-20, 40, 12); scene.add(sun);
  const cam = { x: W / 2, z: H / 2, yaw: Math.PI / 4, dist: 26, pitch: 0.95 };
  function placeCam() {
    cam.x = Math.max(0, Math.min(W, cam.x)); cam.z = Math.max(0, Math.min(H, cam.z)); cam.dist = Math.max(8, Math.min(60, cam.dist));
    const cy = Math.cos(cam.pitch), sy = Math.sin(cam.pitch);
    camera.position.set(cam.x + Math.sin(cam.yaw) * cy * cam.dist, sy * cam.dist + 1, cam.z + Math.cos(cam.yaw) * cy * cam.dist);
    camera.lookAt(cam.x, 1, cam.z);
  }
  function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  addEventListener('resize', resize); resize();
  const topY = (i) => (S.h[i] + 1) * HS;
  const tx = (i) => (i % W) + 0.5, tz = (i) => Math.floor(i / W) + 0.5;

  // ================= рельєф: стовпчики землі + верхній шар трави =================
  const boxG = new THREE.BoxGeometry(1, 1, 1), mat = (c) => new THREE.MeshLambertMaterial({ color: c });
  const dirt = new THREE.InstancedMesh(boxG, mat('#FFFFFF'), W * H), top = new THREE.InstancedMesh(boxG, mat('#FFFFFF'), W * H);
  scene.add(dirt); scene.add(top);
  const trunkG = new THREE.CylinderGeometry(0.07, 0.09, 0.45, 6), crownG = new THREE.ConeGeometry(0.34, 0.8, 7), crown2G = new THREE.ConeGeometry(0.26, 0.55, 7);
  const trunks = new THREE.InstancedMesh(trunkG, mat('#7A5230'), W * H), crowns = new THREE.InstancedMesh(crownG, mat('#FFFFFF'), W * H), crowns2 = new THREE.InstancedMesh(crown2G, mat('#FFFFFF'), W * H);
  const rockG = new THREE.DodecahedronGeometry(0.42, 0), rocks = new THREE.InstancedMesh(rockG, mat('#FFFFFF'), W * H);
  const stumpG = new THREE.CylinderGeometry(0.1, 0.12, 0.14, 6), stumpsM = new THREE.InstancedMesh(stumpG, mat('#8A6038'), W * H);
  [trunks, crowns, crowns2, rocks, stumpsM].forEach((m) => scene.add(m));
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), col = new THREE.Color();
  const hsh = (i, k) => { let h = (i * 374761393 + (k || 0) * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const GRASS = ['#7CC05A', '#8BCB62', '#76B755', '#84C45C'], CLIFF = ['#B07A4A', '#A06D42', '#BC8653', '#94663E'];
  let terrSig = '';
  function buildTerrain() {
    let nt = 0, nr = 0, ns = 0;
    for (let i = 0; i < W * H; i++) {
      const x = i % W, z = (i - x) / W, h = (S.h[i] + 1) * HS;
      m4.compose(v3.set(x + 0.5, (h - 0.1) / 2, z + 0.5), q4.identity(), s3.set(1, h - 0.1, 1)); dirt.setMatrixAt(i, m4);
      dirt.setColorAt(i, col.set(CLIFF[S.h[i] % 4]).multiplyScalar(0.92 + hsh(i) * 0.12));
      m4.compose(v3.set(x + 0.5, h - 0.05, z + 0.5), q4.identity(), s3.set(1, 0.1, 1)); top.setMatrixAt(i, m4);
      top.setColorAt(i, S.pa[i] ? col.set('#D8BE8A').multiplyScalar(0.95 + hsh(i, 3) * 0.08) : col.set(GRASS[Math.floor(hsh(i, 1) * 4)]).multiplyScalar(0.9 + S.h[i] * 0.05));
      if (S.tr[i]) {
        const sc = 0.85 + hsh(i, 2) * 0.35, ox = (hsh(i, 4) - 0.5) * 0.3, oz = (hsh(i, 5) - 0.5) * 0.3;
        m4.compose(v3.set(x + 0.5 + ox, h + 0.22 * sc, z + 0.5 + oz), q4.identity(), s3.set(sc, sc, sc)); trunks.setMatrixAt(nt, m4);
        m4.compose(v3.set(x + 0.5 + ox, h + 0.75 * sc, z + 0.5 + oz), q4.identity(), s3.set(sc, sc, sc)); crowns.setMatrixAt(nt, m4); crowns.setColorAt(nt, col.set(hsh(i, 6) < 0.5 ? '#2F7D3A' : '#3B8E45'));
        m4.compose(v3.set(x + 0.5 + ox, h + 1.12 * sc, z + 0.5 + oz), q4.identity(), s3.set(sc, sc, sc)); crowns2.setMatrixAt(nt, m4); crowns2.setColorAt(nt, col.set(hsh(i, 6) < 0.5 ? '#3A9145' : '#48A352'));
        nt++;
      } else if (S.sp && S.sp[i]) { m4.compose(v3.set(x + 0.5, h + 0.07, z + 0.5), q4.identity(), s3.set(1, 1, 1)); stumpsM.setMatrixAt(ns++, m4); }
      if (S.rk[i]) { const sc = 0.9 + hsh(i, 7) * 0.4; q4.setFromAxisAngle(v3.set(0, 1, 0), hsh(i, 8) * 6); m4.compose(v3.set(x + 0.5, h + 0.18, z + 0.5), q4, s3.set(sc, sc * 0.8, sc)); rocks.setMatrixAt(nr, m4); rocks.setColorAt(nr, col.set('#9097A0').multiplyScalar(0.85 + hsh(i, 9) * 0.3)); nr++; }
    }
    trunks.count = crowns.count = crowns2.count = nt; rocks.count = nr; stumpsM.count = ns;
    [dirt, top, trunks, crowns, crowns2, rocks, stumpsM].forEach((m) => { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
  }
  function terrainSig() { let a = 0; for (let i = 0; i < W * H; i++) a = (a * 31 + S.tr[i] * 2 + S.pa[i] * 3 + (S.sp && S.sp[i] ? 5 : 0)) | 0; return a; }

  // ================= будівлі: свої прості моделі з фігур =================
  const G = {
    box: (w, h, d, c, x, y, z) => { const m = new THREE.Mesh(boxG, mat(c)); m.scale.set(w, h, d); m.position.set(x || 0, (y || 0) + h / 2, z || 0); return m; },
    roof: (w, h, d, c, x, y, z) => { const g = new THREE.ConeGeometry(0.71, 1, 4); const m = new THREE.Mesh(g, mat(c)); m.rotation.y = Math.PI / 4; m.scale.set(w, h, d); m.position.set(x || 0, (y || 0) + h / 2, z || 0); return m; },
    cyl: (r, h, c, x, y, z, seg) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg || 10), mat(c)); m.position.set(x || 0, (y || 0) + h / 2, z || 0); return m; },
  };
  function model(b) {
    const g = new THREE.Group(), add = (m) => (g.add(m), m), k = b.k;
    if (k === 'hall') { add(G.box(0.9, 0.5, 0.9, '#EFE4C8')); add(G.roof(1, 0.4, 1, '#C0503A', 0, 0.5)); add(G.box(0.25, 0.5, 0.25, '#EFE4C8', 0.25, 0.5, 0.25)); add(G.roof(0.3, 0.25, 0.3, '#C0503A', 0.25, 1, 0.25)); add(G.box(0.02, 0.3, 0.02, '#444', 0.25, 1.2, 0.25)); add(G.box(0.15, 0.09, 0.01, '#3F7FD0', 0.33, 1.4, 0.25)); }
    else if (k === 'store') { add(G.box(0.85, 0.45, 0.85, '#B88452')); add(G.box(0.95, 0.06, 0.95, '#7A5532', 0, 0.45)); add(G.box(0.22, 0.22, 0.22, '#D9A45B', 0.38, 0, 0.38)); add(G.box(0.2, 0.2, 0.2, '#C8934A', 0.38, 0.22, 0.38)); }
    else if (k === 'wood') { add(G.box(0.5, 0.35, 0.5, '#9C6B3E', -0.15, 0, -0.15)); add(G.roof(0.6, 0.3, 0.6, '#4F7F3A', -0.15, 0.35, -0.15)); for (let n = 0; n < 3; n++) { const l = add(G.cyl(0.07, 0.55, '#8B5A2B', 0.25, 0.07 + n * 0.12, 0.2, 7)); l.rotation.x = Math.PI / 2; } }
    else if (k === 'quarry') { add(G.box(0.55, 0.32, 0.55, '#8C939B', -0.12, 0, -0.12)); add(G.roof(0.65, 0.25, 0.65, '#5E656D', -0.12, 0.32, -0.12)); add(G.box(0.2, 0.15, 0.2, '#A7ADB4', 0.25, 0, 0.25)); add(G.box(0.15, 0.12, 0.15, '#9AA0A6', 0.3, 0.15, 0.18)); }
    else if (k === 'farm') { add(G.box(0.95, 0.05, 0.95, '#8A5A35')); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) add(G.box(0.09, 0.22, 0.09, '#E3C04A', -0.33 + c * 0.22, 0.05, -0.33 + r * 0.22)); }
    else if (k === 'saw') { [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]].forEach(([x, z]) => add(G.box(0.07, 0.45, 0.07, '#7A5532', x, 0, z))); add(G.roof(1, 0.25, 1, '#8E6A44', 0, 0.45)); add(G.box(0.6, 0.18, 0.25, '#6C7178', 0, 0, 0)); const bl = add(G.cyl(0.16, 0.03, '#C9CED4', 0, 0.2, 0, 14)); bl.rotation.x = Math.PI / 2; g.userData.spin = bl; g.userData.spinAx = 'z'; }
    else if (k === 'chop') { add(G.cyl(0.18, 0.18, '#9C6B3E', -0.2, 0, -0.15, 8)); for (let n = 0; n < 6; n++) add(G.box(0.36, 0.08, 0.08, '#A0522D', 0.2, (n % 3) * 0.09, 0.1 + Math.floor(n / 3) * 0.1)); }
    else if (k === 'mill') { add(G.cyl(0.3, 0.75, '#EDE2CC', 0, 0, 0, 10)); add(G.roof(0.55, 0.35, 0.55, '#7A5C3E', 0, 0.75)); const hub = new THREE.Group(); hub.position.set(0, 0.8, 0.33); for (let n = 0; n < 4; n++) { const sl = G.box(0.08, 0.6, 0.02, '#F7F1E3', 0, -0.3, 0); const arm = new THREE.Group(); arm.add(sl); arm.rotation.z = (n * Math.PI) / 2; hub.add(arm); } add(hub); g.userData.spin = hub; g.userData.spinAx = 'z'; }
    else if (k === 'bakery') { add(G.box(0.8, 0.45, 0.7, '#F1D3A3')); add(G.roof(0.9, 0.3, 0.8, '#B5452E', 0, 0.45)); add(G.box(0.14, 0.4, 0.14, '#8D6E63', 0.25, 0.45, 0.15)); g.userData.smoke = [0.25, 0.9, 0.15]; }
    else if (k === 'market') { [[-0.38, -0.3], [0.38, -0.3], [-0.38, 0.3], [0.38, 0.3]].forEach(([x, z]) => add(G.box(0.05, 0.5, 0.05, '#7A5532', x, 0, z))); for (let n = 0; n < 5; n++) add(G.box(0.17, 0.05, 0.75, n % 2 ? '#F4F1EA' : '#D9423A', -0.34 + n * 0.17, 0.5, 0)); add(G.box(0.75, 0.25, 0.3, '#B88452', 0, 0, -0.1)); add(G.box(0.12, 0.08, 0.12, '#C9813A', -0.2, 0.25, -0.1)); add(G.box(0.12, 0.08, 0.12, '#A0522D', 0.15, 0.25, -0.1)); }
    else if (k === 'house') { const big = b.lv > 1; add(G.box(0.7, big ? 0.6 : 0.4, 0.6, big ? '#F4E9D8' : '#EADCC2')); add(G.roof(0.82, 0.35, 0.72, big ? '#3D6F9E' : '#A65B3A', 0, big ? 0.6 : 0.4)); add(G.box(0.14, 0.2, 0.02, '#6B4A2E', 0, 0, 0.31)); add(G.box(0.12, 0.1, 0.02, '#BFE3F7', -0.2, big ? 0.35 : 0.2, 0.31)); g.userData.smoke = [-0.2, big ? 0.95 : 0.75, -0.1]; }
    return g;
  }
  const bMeshes = new Map();
  // значок над будівлею: чого бракує / що готово
  const spriteCache = new Map();
  function emojiSprite(t, bg) {
    const key = t + bg; if (spriteCache.has(key)) return spriteCache.get(key);
    const c = document.createElement('canvas'); c.width = c.height = 96; const x = c.getContext('2d');
    x.fillStyle = bg; x.beginPath(); x.arc(48, 44, 38, 0, 7); x.fill(); x.beginPath(); x.moveTo(36, 76); x.lineTo(48, 94); x.lineTo(60, 76); x.fill();
    x.font = '46px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(t, 48, 46);
    const m = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }); spriteCache.set(key, m); return m;
  }
  function syncBuildings() {
    for (const [id, g] of bMeshes) if (!S.b[id] || g.userData.lv !== S.b[id].lv) { scene.remove(g); bMeshes.delete(id); }
    for (const id in S.b) {
      const b = S.b[id]; let g = bMeshes.get(+id);
      if (!g) { g = model(b); g.userData.lv = b.lv; const i = M.idx(b.x, b.y); g.position.set(b.x + 0.5, topY(i), b.y + 0.5); scene.add(g); bMeshes.set(+id, g); g.userData.icon = new THREE.Sprite(emojiSprite('⏳', '#fff')); g.userData.icon.scale.set(0.5, 0.5, 1); g.userData.icon.position.set(0, 1.5, 0); g.userData.icon.renderOrder = 10; g.add(g.userData.icon); }
    }
  }
  // ================= стрічки, жолоби, підйомники =================
  const arrowTex = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 64; const x = c.getContext('2d'); x.fillStyle = '#4A4E55'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#6F757D'; x.beginPath(); x.moveTo(14, 18); x.lineTo(32, 6); x.lineTo(50, 18); x.lineTo(50, 28); x.lineTo(32, 16); x.lineTo(14, 28); x.fill(); x.beginPath(); x.moveTo(14, 50); x.lineTo(32, 38); x.lineTo(50, 50); x.lineTo(50, 60); x.lineTo(32, 48); x.lineTo(14, 60); x.fill(); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; })();
  const beltMat = new THREE.MeshLambertMaterial({ map: arrowTex }), beltG = new THREE.PlaneGeometry(0.8, 1);
  const cMeshes = new Map();
  function convModel(c, i) {
    const g = new THREE.Group(), h = topY(i);
    if (c.k === 'belt') { g.add(G.box(0.92, 0.06, 1, '#2F3237', 0, 0)); const p = new THREE.Mesh(beltG, beltMat); p.rotation.x = -Math.PI / 2; p.position.y = 0.065; g.add(p); g.add(G.box(0.06, 0.1, 1, '#8D949C', -0.45, 0)); g.add(G.box(0.06, 0.1, 1, '#8D949C', 0.45, 0)); }
    else if (c.k === 'chute') { g.add(G.box(0.7, 0.05, 1, '#B07A45', 0, 0.05)); g.add(G.box(0.06, 0.16, 1, '#8A5A2B', -0.36, 0.05)); g.add(G.box(0.06, 0.16, 1, '#8A5A2B', 0.36, 0.05)); }
    else { g.add(G.box(0.8, HS + 0.1, 0.8, '#7C838C', 0, 0)); g.add(G.box(0.86, 0.06, 0.86, '#E0B84A', 0, HS + 0.1)); const a = new THREE.Mesh(beltG, beltMat); a.scale.set(0.6, 0.6, 1); a.rotation.x = -Math.PI / 2; a.position.y = HS + 0.17; g.add(a); }
    g.position.set(tx(i), h, tz(i)); g.rotation.y = -c.d * Math.PI / 2 + Math.PI / 2;   // локальна вісь -z → напрям d
    return g;
  }
  function syncConv() {
    for (const [i, g] of cMeshes) { const c = S.cv[i]; if (!c || g.userData.k !== c.k + c.d) { scene.remove(g); cMeshes.delete(i); } }
    for (const key in S.cv) { const i = +key; if (cMeshes.has(i)) continue; const c = S.cv[i], g = convModel(c, i); g.userData.k = c.k + c.d; scene.add(g); cMeshes.set(i, g); }
  }
  // ================= товари на стрічках, носії =================
  const MAXI = 800, itemG = new THREE.BoxGeometry(0.2, 0.2, 0.2), items = new THREE.InstancedMesh(itemG, mat('#FFFFFF'), MAXI); items.count = 0; scene.add(items);
  const bodyG = new THREE.CylinderGeometry(0.1, 0.13, 0.32, 8), headG = new THREE.SphereGeometry(0.1, 10, 8);
  const bodies = new THREE.InstancedMesh(bodyG, mat('#FFFFFF'), 120), heads = new THREE.InstancedMesh(headG, mat('#F1C9A5'), 120); scene.add(bodies); scene.add(heads);
  const SHIRTS = ['#3F7FD0', '#D9423A', '#43A047', '#F2B53C', '#8E24AA', '#FB8C00'];
  // кольори екземплярів треба створити до першого кадру, інакше шейдер зібереться без них
  for (const [m, n, c] of [[items, MAXI, '#FFFFFF'], [bodies, 120, '#3F7FD0'], [crowns, W * H, '#2F7D3A'], [crowns2, W * H, '#3A9145'], [rocks, W * H, '#9097A0']]) { m.instanceColor = null; m.count = n; for (let k = 0; k < n; k++) m.setColorAt(k, col.set(c)); }
  items.count = 0;
  function syncMovers(alpha) {
    let n = 0;
    for (const key in S.cv) {
      const i = +key, c = S.cv[i], h = topY(i), sp = M.CONV[c.k].sp;
      for (const q of c.it) {
        if (n >= MAXI) break;
        const p = Math.min(1, q[1] + sp * STEP * alpha * (q[1] < 1 ? 1 : 0)), o = p - 0.5;
        let y = h + (c.k === 'belt' ? 0.17 : c.k === 'chute' ? 0.2 : 0.28);
        if (c.k === 'lift') y = h + 0.18 + p * HS;
        m4.compose(v3.set(tx(i) + DX[c.d] * o, y, tz(i) + DY[c.d] * o), q4.identity(), s3.set(1, 1, 1)); items.setMatrixAt(n, m4); items.setColorAt(n, col.set(RES[q[0]].c)); n++;
      }
    }
    let m = 0;
    for (const c of S.cr || []) {
      if (m >= 120) break;
      const p = c.path, a = p ? p[Math.min(c.k || 0, p.length - 1)] : c.i, b = p && c.k < p.length - 1 ? p[c.k + 1] : a, f = Math.min(1, c.f || 0);
      const x = tx(a) + (tx(b) - tx(a)) * f, z = tz(a) + (tz(b) - tz(a)) * f, y = topY(a) + (topY(b) - topY(a)) * f;
      const bob = c.job ? Math.abs(Math.sin(performance.now() / 120 + m)) * 0.04 : 0;
      m4.compose(v3.set(x, y + 0.16 + bob, z), q4.identity(), s3.set(1, 1, 1)); bodies.setMatrixAt(m, m4); bodies.setColorAt(m, col.set(SHIRTS[m % SHIRTS.length]));
      m4.compose(v3.set(x, y + 0.42 + bob, z), q4.identity(), s3.set(1, 1, 1)); heads.setMatrixAt(m, m4);
      if (c.it && n < MAXI) { m4.compose(v3.set(x, y + 0.62 + bob, z), q4.identity(), s3.set(0.9, 0.9, 0.9)); items.setMatrixAt(n, m4); items.setColorAt(n, col.set(RES[c.it].c)); n++; }
      m++;
    }
    items.count = n; bodies.count = heads.count = m;
    [items, bodies, heads].forEach((q) => { q.instanceMatrix.needsUpdate = true; if (q.instanceColor) q.instanceColor.needsUpdate = true; });
  }
  // дим
  const smokeG = new THREE.SphereGeometry(0.08, 6, 5), smokeM = new THREE.MeshLambertMaterial({ color: '#F0ECE4', transparent: true, opacity: 0.6 }), puffs = new THREE.InstancedMesh(smokeG, smokeM, 200); scene.add(puffs);
  function syncDeco(t) {
    let n = 0;
    for (const [id, g] of bMeshes) {
      const b = S.b[id]; if (!b) continue;
      const working = B[b.k].job ? b.on && !b.why : b.k === 'house' ? M.happyOf(S, b) > 0 : false;
      if (g.userData.spin && working) g.userData.spin.rotation[g.userData.spinAx] += 0.06;
      if (g.userData.smoke && working && n < 190) for (let k = 0; k < 4; k++) { const ph = ((t / 2400 + k / 4 + id * 0.13) % 1), [sx, sy, sz] = g.userData.smoke; const sc = 0.6 + ph * 1.6; m4.compose(v3.set(g.position.x + sx + ph * 0.25, g.position.y + sy + ph * 0.9, g.position.z + sz), q4.identity(), s3.set(sc, sc, sc)); puffs.setMatrixAt(n++, m4); }
      // значок
      const ic = g.userData.icon, w = M.why(S, b);
      let em = '';
      if (w) em = b.why === 'worker' ? '👷' : b.why === 'full' ? RES[B[b.k].out].ic : b.why === 'tree' ? '🌲' : b.why === 'rock' ? '🪨' : RES[b.why] ? RES[b.why].ic : '⚠';
      if (b.stuck && S.t - b.stuck < 5) em = '🚧';
      if (b.k === 'house' && M.happyOf(S, b) < 1) { const need = M.NEEDS[b.lv > 1 ? 1 : 0].find((r) => !(b.hb[r] && S.t - b.hb[r] < 90)); em = need ? RES[need].ic : ''; }
      ic.visible = !!em; if (em) { ic.material = emojiSprite(em, w || b.k === 'house' ? '#FFF3D6' : '#fff'); ic.position.y = 1.35 + Math.sin(t / 300 + id) * 0.05; }
    }
    puffs.count = n; puffs.instanceMatrix.needsUpdate = true;
  }
  // ================= підсвітка клітинки й привид будівлі =================
  const hiG = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 0.02, 1)), hi = new THREE.LineSegments(hiG, new THREE.LineBasicMaterial({ color: '#FFFFFF' })); hi.visible = false; scene.add(hi);
  let ghost = null;
  function showHi(i, ok) { if (i < 0) { hi.visible = false; if (ghost) ghost.visible = false; return; } hi.visible = true; hi.position.set(tx(i), topY(i) + 0.02, tz(i)); hi.material.color.set(ok === false ? '#FF6B6B' : '#FFFFFF'); if (ghost) { ghost.visible = true; ghost.position.set(tx(i), topY(i), tz(i)); } }
  function setGhost(k) {
    if (ghost) { scene.remove(ghost); ghost = null; } if (!k) return;
    ghost = model({ k, lv: 1 }); ghost.traverse((o) => { if (o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.55; } }); ghost.visible = false; scene.add(ghost);
  }
  function rebuildAll() { buildTerrain(); terrSig = terrainSig(); for (const g of bMeshes.values()) scene.remove(g); bMeshes.clear(); for (const g of cMeshes.values()) scene.remove(g); cMeshes.clear(); syncBuildings(); syncConv(); hud(); }

  // ================= вибір клітинки пальцем =================
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pickTile(px, py) {
    ndc.set((px / innerWidth) * 2 - 1, -(py / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([top, dirt], false); if (hits.length && hits[0].instanceId !== undefined) return hits[0].instanceId;
    return -1;
  }

  // ================= інструменти =================
  let tool = 'look', dir = 0;
  const TOOLS = { look: 'Огляд', belt: 'Стрічка', chute: 'Жолоб', lift: 'Підйомник', path: 'Стежка', erase: 'Знести' };
  function setTool(t) {
    tool = t; document.querySelectorAll('.tb').forEach((b) => b.classList.toggle('on', b.dataset.t === t || (t.startsWith('b:') && b.dataset.t === 'build')));
    setGhost(t.startsWith('b:') ? t.slice(2) : null);
    const tip = t.startsWith('b:') ? 'Торкнись клітинки, щоб поставити: ' + B[t.slice(2)].n + ' (' + M.costTxt(B[t.slice(2)].cost) + ')' : t === 'belt' || t === 'chute' || t === 'lift' ? M.CONV[t].n + ': веди пальцем, куди має їхати товар. ' + M.CONV[t].hint + ' Двома пальцями — рух камери.' : t === 'path' ? 'Стежка: веди пальцем. Носії по ній ходять швидше.' : t === 'erase' ? 'Знести: торкнись або веди пальцем. Повертається половина ціни.' : '';
    $('mode').hidden = t === 'look'; $('modeT').textContent = tip;
    if (t === 'look') showHi(-1);
  }
  document.querySelectorAll('.tb').forEach((b) => b.addEventListener('click', () => { au(); const t = b.dataset.t; if (t === 'build') openBuild(); else setTool(tool === t ? 'look' : t); }));
  $('modeX').addEventListener('click', () => setTool('look'));
  function doAct(a, quiet) { const r = M.act(S, a); if (!r.ok) { if (!quiet) { toast(r.err, true); sfx('err'); } return r; } sfx(a.t === 'erase' ? 'chop' : 'build'); syncBuildings(); syncConv(); hud(); return r; }

  // малювання стрічки: кожна клітинка дивиться туди, куди пішов палець
  let drawLast = -1;
  function drawAt(i) {
    if (i < 0) return; const x = i % W, y = (i - x) / W;
    if (tool === 'path') { doAct({ t: 'path', x, y }, true); return; }
    if (tool === 'erase') { doAct({ t: 'erase', x, y }, true); return; }
    if (drawLast >= 0 && drawLast !== i) {
      const lx = drawLast % W, ly = (drawLast - lx) / W, ddx = x - lx, ddy = y - ly;
      if (Math.abs(ddx) + Math.abs(ddy) === 1) { dir = ddx === 1 ? 0 : ddy === 1 ? 1 : ddx === -1 ? 2 : 3; if (S.cv[drawLast]) doAct({ t: 'conv', k: S.cv[drawLast].k, x: lx, y: ly, d: dir }, true); }
    }
    doAct({ t: 'conv', k: tool, x, y, d: dir }, drawLast >= 0); drawLast = i;
  }

  // ================= жести =================
  const ptr = new Map(); let gest = null;
  cv.addEventListener('pointerdown', (e) => {
    au(); cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
    ptr.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
    if (ptr.size === 1) { gest = { moved: false, draw: tool !== 'look' && !tool.startsWith('b:'), cx: cam.x, cz: cam.z }; drawLast = -1; if (gest.draw) { gest.wait = true; } }
    if (ptr.size === 2) { const [a, b] = [...ptr.values()]; gest = { two: true, d0: Math.hypot(a.x - b.x, a.y - b.y), a0: Math.atan2(b.y - a.y, b.x - a.x), dist0: cam.dist, yaw0: cam.yaw, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, cx: cam.x, cz: cam.z }; drawLast = -1; }
  });
  function panBy(dx, dy, g) {
    const k = cam.dist / innerHeight * 1.1, s = Math.sin(cam.yaw), c = Math.cos(cam.yaw);
    const fy = 1 / Math.sin(cam.pitch);   // рух уперед на екрані — укорочений нахилом камери
    cam.x = g.cx - (dx * c + dy * s * fy) * k; cam.z = g.cz - (-dx * s + dy * c * fy) * k;
  }
  cv.addEventListener('pointermove', (e) => {
    const p = ptr.get(e.pointerId);
    if (!p) { if (tool !== 'look' && e.pointerType === 'mouse') { const i = pickTile(e.clientX, e.clientY); showHi(i, okHere(i)); } return; }
    p.x = e.clientX; p.y = e.clientY; if (!gest) return;
    if (gest.two && ptr.size >= 2) {
      const [a, b] = [...ptr.values()], d = Math.hypot(a.x - b.x, a.y - b.y), an = Math.atan2(b.y - a.y, b.x - a.x);
      cam.dist = gest.dist0 * gest.d0 / Math.max(20, d); cam.yaw = gest.yaw0 - (an - gest.a0);
      panBy((a.x + b.x) / 2 - gest.mx, (a.y + b.y) / 2 - gest.my, gest);
    } else if (!gest.two) {
      if (Math.hypot(p.x - p.x0, p.y - p.y0) > 8) gest.moved = true;
      if (gest.draw) { if (gest.moved || performance.now() - p.t0 > 120) { const i = pickTile(p.x, p.y); showHi(i, okHere(i)); drawAt(i); } }
      else if (gest.moved) panBy(p.x - p.x0, p.y - p.y0, gest);
    }
  });
  const up = (e) => {
    const p = ptr.get(e.pointerId); ptr.delete(e.pointerId); if (!p || !gest) return;
    if (!gest.two && !gest.moved && ptr.size === 0 && performance.now() - p.t0 < 500) tap(p.x, p.y);
    if (ptr.size === 0) { gest = null; drawLast = -1; if (tool === 'look') showHi(-1); }
    else if (gest.two) { const q = [...ptr.values()][0]; q.x0 = q.x; q.y0 = q.y; gest = { moved: true, cx: cam.x, cz: cam.z }; }
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', (e) => { ptr.delete(e.pointerId); if (!ptr.size) gest = null; });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist *= Math.exp(e.deltaY * 0.0012); }, { passive: false });
  $('rotL').addEventListener('click', () => { cam.yaw += Math.PI / 4; });
  $('rotR').addEventListener('click', () => { cam.yaw -= Math.PI / 4; });
  function okHere(i) {
    if (i < 0) return false; const x = i % W, y = (i - x) / W;
    if (tool.startsWith('b:')) { const k = tool.slice(2); if (M.bAt(S, x, y) || S.tr[i] || S.rk[i] || S.cv[i]) return false; if (B[k].near === 'rock') return [0, 1, 2, 3].some((d) => M.inb(x + DX[d], y + DY[d]) && S.rk[M.idx(x + DX[d], y + DY[d])]); return true; }
    return true;
  }
  function tap(px, py) {
    const i = pickTile(px, py); if (i < 0) return; const x = i % W, y = (i - x) / W;
    if (tool.startsWith('b:')) { const k = tool.slice(2), r = doAct({ t: 'build', k, x, y }); showHi(i, okHere(i)); if (r.ok && !M.canPay(S, B[k].cost)) setTool('look'); return; }
    if (tool !== 'look') { drawLast = -1; if ((tool === 'belt' || tool === 'chute' || tool === 'lift') && S.cv[i]) { doAct({ t: 'turn', x, y }); return; } drawAt(i); return; }
    const b = M.bAt(S, x, y);
    if (b) { openBuilding(b.id); return; }
    if (S.cv[i]) { doAct({ t: 'turn', x, y }); toast(M.CONV[S.cv[i].k].n + ': розвернуто'); return; }
    if (S.tr[i]) { const r = doAct({ t: 'clear', x, y }); if (r.ok) toast('+2 🪵'); return; }
    if (S.rk[i]) { toast('Скеля: постав поруч каменярню'); return; }
    openBuild();
  }

  // ================= HUD і шторки =================
  function hud() {
    if (!S) return; const st = M.staff(S), hp = Math.round(M.happy(S) * 100);
    $('hCu').textContent = '🪙 ' + Math.floor(S.cu); $('hPop').textContent = '👷 ' + st.free + '/' + st.pop; $('hHp').textContent = (hp >= 70 ? '😊 ' : hp >= 30 ? '😐 ' : '😟 ') + hp + '%';
    const s3 = ['log', 'plank', 'stone']; $('hSt').textContent = s3.map((r) => RES[r].ic + ' ' + (S.st[r] || 0)).join('  ');
    tipLine();
  }
  function tipLine() {
    const has = (k) => Object.values(S.b).some((b) => b.k === k); let t = '';
    if (!has('wood')) t = '🪓 Почни з лісоруба біля дерев: 🏗 → Лісоруб';
    else if (!has('house')) t = '🏠 Збудуй хату: більше робітників-носіїв';
    else if (!has('saw')) t = '🪚 Тартак робить дошки — для стрічок і складніших будівель';
    else if (!Object.keys(S.cv).length) t = '➡ Спробуй стрічку: від тартака до ратуші, товар поїде сам';
    else if (!has('quarry')) t = '⛏ Каменярня — впритул до скелі';
    else if (!has('market')) t = '🍞 Ферма → Млин → Пекарня → Крамниця: хати платять міддю';
    $('tip').hidden = !t || tool !== 'look'; $('tip').textContent = t;
  }
  let sheetFn = null;
  function openSheet(title, render) { $('shT').textContent = title; sheetFn = () => { $('shB').innerHTML = render(); bind(); }; sheetFn(); $('sheet').classList.add('open'); }
  function closeSheet() { $('sheet').classList.remove('open'); sheetFn = null; }
  $('shX').addEventListener('click', closeSheet);
  function bind() {
    $('shB').querySelectorAll('[data-b]').forEach((el) => el.addEventListener('click', () => { au(); closeSheet(); setTool('b:' + el.dataset.b); }));
    $('shB').querySelectorAll('[data-a]').forEach((el) => el.addEventListener('click', () => { au(); const a = JSON.parse(el.dataset.a); if (a.t === 'erase' && el.dataset.sure !== '1') { el.dataset.sure = '1'; el.textContent = 'Точно знести?'; return; } const r = doAct(a); if (r.ok && a.t === 'erase') closeSheet(); else if (sheetFn) sheetFn(); }));
    const rs = $('resetB'); if (rs) rs.onclick = () => { if (rs.dataset.sure !== '1') { rs.dataset.sure = '1'; rs.textContent = 'Точно почати заново? Натисни ще раз'; return; } S = M.create((Math.random() * 2 ** 31) | 0); saveLocal(); cloudT = 0; saveCloud(); rebuildAll(); closeSheet(); centerCam(); };
  }
  const A = (o) => esc(JSON.stringify(o));
  const items2 = (o) => Object.keys(o || {}).map((r) => RES[r].ic + '×' + o[r]).join(' ');
  function openBuild() {
    openSheet('🏗 Будувати', () => {
      let h = '<div class="grid">';
      for (const k in B) { const d = B[k]; if (d.nobuild) continue; const ok = M.canPay(S, d.cost);
        const rec = d.in ? items2(d.in) + ' → ' + RES[d.out].ic + '×' + d.q + ' · ' + d.t + ' с' : d.out ? RES[d.out].ic + '×' + d.q + ' · ' + d.t + ' с' : '';
        h += '<button class="card2' + (ok ? '' : ' off') + '" data-b="' + k + '"><span class="ic">' + d.ic + '</span><b>' + d.n + '</b><small>' + (rec || esc(d.hint || '')) + '</small><span class="pr">' + M.costTxt(d.cost) + '</span></button>'; }
      return h + '</div><p class="note">Стрічки, жолоби, підйомники й стежки — у нижній панелі.</p>';
    });
  }
  function openBuilding(id) {
    openSheet(B[S.b[id].k].ic + ' ' + B[S.b[id].k].n, () => {
      const b = S.b[id]; if (!b) { setTimeout(closeSheet); return ''; } const d = B[b.k]; let h = '';
      if (d.hint) h += '<p class="note">' + esc(d.hint) + '</p>';
      if (d.out) {
        const rec = (d.in ? items2(d.in) + ' → ' : '') + RES[d.out].ic + '×' + d.q;
        h += '<div class="row"><span class="ic">' + d.ic + '</span><span class="tx"><b>' + rec + '</b><small>цикл ' + d.t + ' с · швидкість ×' + M.speed(S).toFixed(2) + ' від щастя</small></span></div>';
        const w = M.why(S, b);
        h += '<div class="row"><span class="tx"><b>' + (w ? '⏸ ' + esc(w) : b.t > 0 ? '⚙ працює: ' + Math.floor(100 * b.t / d.t) + '%' : '⚙ готова') + '</b><small>готово: ' + b.out.length + '/' + M.OUT_CAP + (d.in ? ' · є: ' + (items2(b.inp) || 'нічого') : '') + (M.outConvs(S, b).length ? ' · віддає на стрічку' : ' · забирають носії') + '</small></span></div>';
      }
      if (d.stor) h += '<div class="row"><span class="tx"><b>Склад міста: по ' + M.storCap(S) + ' кожного</b><small>' + (Object.keys(S.st).filter((r) => S.st[r] > 0).map((r) => RES[r].ic + ' ' + S.st[r]).join(' · ') || 'порожньо') + '</small></span></div>';
      if (d.sells) h += '<div class="row"><span class="tx"><b>На полицях</b><small>' + d.sells.map((r) => RES[r].ic + ' ' + (b.mk[r] || 0) + '/' + M.MK_CAP).join(' · ') + ' · хати в радіусі ' + d.r + ' клітинок</small></span></div>';
      if (b.k === 'house') {
        const need = M.NEEDS[b.lv > 1 ? 1 : 0];
        h += '<div class="row"><span class="tx"><b>Рівень ' + b.lv + ' · живе ' + (b.lv > 1 ? 4 : 2) + ' · щастя ' + Math.round(100 * M.happyOf(S, b)) + '%</b><small>хоче: ' + need.map((r) => RES[r].ic + (b.hb[r] && S.t - b.hb[r] < 90 ? '✓' : '✗')).join(' ') + ' · платить ' + (b.lv > 1 ? 'удвічі' : 'звичайно') + '</small></span></div>';
        if (b.lv < 2) h += '<div class="btns"><button class="btn" data-a="' + A({ t: 'up', id: b.id }) + '"' + (M.canPay(S, B.house.up) ? '' : ' disabled') + '>⬆ Покращити<small>' + M.costTxt(B.house.up) + ' · 4 жителі, ще й дрова</small></button></div>';
      }
      if (b.k !== 'hall') h += '<div class="btns"><button class="btn red" data-a="' + A({ t: 'erase', x: b.x, y: b.y }) + '">🗑 Знести</button></div>';
      else h += '<div class="btns"><button class="btn sec" id="resetB">↺ Почати місто заново</button></div>';
      return h;
    });
  }
  $('hSt').addEventListener('click', () => { const hall = Object.values(S.b).find((b) => b.k === 'hall'); if (hall) openBuilding(hall.id); });
  setInterval(() => { if (sheetFn) sheetFn(); }, 1000);

  // ================= повідомлення й звук =================
  let toastT = 0;
  function toast(t, bad) { const el = $('toast'); el.textContent = t; el.classList.toggle('bad', !!bad); el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2400); }
  let AC = null;
  function au() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (AC && AC.state === 'suspended') AC.resume(); }
  function tone(f, d, type, vol, at) { if (!AC) return; const t = AC.currentTime + (at || 0), o = AC.createOscillator(), g = AC.createGain(); o.type = type || 'sine'; o.frequency.setValueAtTime(f, t); g.gain.setValueAtTime(vol || 0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + d); o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + d); }
  function sfx(k) { if (k === 'build') { tone(180, 0.12, 'triangle'); tone(260, 0.1, 'triangle', 0.06, 0.06); } else if (k === 'chop') tone(140, 0.1, 'square', 0.05); else if (k === 'err') tone(120, 0.15, 'sawtooth', 0.05); }

  // ================= цикл =================
  function centerCam() { const hall = Object.values(S.b).find((b) => b.k === 'hall'); if (hall) { cam.x = hall.x + 0.5; cam.z = hall.y + 0.5; } cam.dist = innerWidth < 600 ? 22 : 28; }
  let last = performance.now(), sigT = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.25, (t - last) / 1000); last = t;
    if (S && !document.hidden) {
      acc += dt; let n = 0; while (acc >= STEP && n < 6) { M.step(S, STEP); acc -= STEP; n++; } if (n === 6) acc = 0;
      if (t - sigT > 700) { sigT = t; const sg = terrainSig(); if (sg !== terrSig) { terrSig = sg; buildTerrain(); } hud(); syncBuildings(); }
      arrowTex.offset.y = (arrowTex.offset.y - dt * 1.2) % 1;
      syncMovers(acc / STEP); syncDeco(t);
    }
    placeCam(); renderer.render(scene, camera);
  }

  // ================= старт =================
  S = loadLocal() || M.create((Math.random() * 2 ** 31) | 0);
  rebuildAll(); centerCam(); setTool('look'); cloudInit(); requestAnimationFrame(frame);
  window.MISTO = { get S() { return S; }, M, cam, setTool, tap, pickTile, openBuild, closeSheet, step(n) { for (let k = 0; k < n; k++) M.step(S, STEP); }, rebuildAll, get tool() { return tool; } };
})();
