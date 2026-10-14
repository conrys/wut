// Local stand-in for Firebase RTDB + Firestore, plus a static file server.
// Usage: node bots/local-sim/server.js [siteRoot] [port]  (siteRoot defaults to the project root)
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { WebSocketServer } = require("ws");

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, "..", ".."));
const PORT = Number(process.argv[3] || 8787);
const MOCK_JS = fs.readFileSync(path.join(__dirname, "firebase-mock.js"), "utf8");

let tree = null;
const fsdb = {}; // col -> { id: data }
const authUsers = {}; // uid -> { email, password } | { anon }
const stats = { writes: 0, bytesOut: 0, cas: 0, casFail: 0 };

function split(p) { return String(p || "").split("/").filter(Boolean); }
function getAt(node, segs) {
  for (const s of segs) { if (node === null || typeof node !== "object" || !(s in node)) return null; node = node[s]; }
  return node === undefined ? null : node;
}
function isEmpty(v) { return v === null || v === undefined || (typeof v === "object" && Object.keys(v).length === 0); }
function norm(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === "number" && !isFinite(v)) return null;
  if (typeof v !== "object") return v;
  const out = {};
  const entries = Array.isArray(v) ? v.map((x, i) => [String(i), x]) : Object.entries(v);
  for (const [k, x] of entries) { const n = norm(x); if (!isEmpty(n)) out[k] = n; }
  return Object.keys(out).length ? out : null;
}
function setAt(node, segs, value) {
  if (!segs.length) return isEmpty(value) ? null : value;
  const base = node && typeof node === "object" ? Object.assign({}, node) : {};
  const [h, ...rest] = segs;
  const next = setAt(base[h] === undefined ? null : base[h], rest, value);
  if (isEmpty(next)) delete base[h]; else base[h] = next;
  return Object.keys(base).length ? base : null;
}
function toVal(v) {
  if (v === null || typeof v !== "object") return v === undefined ? null : v;
  const keys = Object.keys(v);
  if (keys.length && keys.every((k) => /^(0|[1-9]\d*)$/.test(k))) {
    const max = Math.max(...keys.map(Number));
    if (max < keys.length * 2) { const arr = new Array(max + 1).fill(null); keys.forEach((k) => { arr[Number(k)] = toVal(v[k]); }); return arr; }
  }
  const o = {}; keys.forEach((k) => { o[k] = toVal(v[k]); }); return o;
}
function stable(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
}
function resolveSv(v, segs) {
  if (v && typeof v === "object") {
    if (v[".sv"] === "timestamp") return Date.now();
    if (v[".sv"] && typeof v[".sv"] === "object" && "increment" in v[".sv"]) {
      const cur = getAt(tree, segs);
      return (typeof cur === "number" ? cur : 0) + v[".sv"].increment;
    }
    const o = Array.isArray(v) ? [] : {};
    for (const k in v) o[k] = resolveSv(v[k], segs.concat(k));
    return o;
  }
  return v;
}
const clients = new Set();
function broadcast(list) {
  const msg = JSON.stringify({ t: "patches", list });
  for (const c of clients) if (c.readyState === 1) { c.send(msg); stats.bytesOut += msg.length; }
}
function applyWrites(list) {
  const out = [];
  for (const p of list) {
    const segs = split(p.path);
    const value = norm(resolveSv(p.value, segs));
    tree = setAt(tree, segs, value);
    out.push({ path: segs.join("/"), value: getAt(tree, segs) });
  }
  stats.writes += list.length;
  stats.byPath = stats.byPath || {};
  for (const p of out) {
    const k = p.path.split("/").slice(0, 5).map((x, i) => (i === 1 ? "<room>" : /^(vlad|olena|andrii|marta|taras|iryna|bohdan|sofiia|dmytro|kateryna|maksym|yuliia|oleh|nataliia|serhii|anastasiia|roman|viktoriia|petro|khrystyna|ivan|daria|testbot_\w+)$/.test(x) ? "<user>" : x)).join("/");
    stats.byPath[k] = (stats.byPath[k] || 0) + 1;
  }
  broadcast(out);
}

// ---------------- Firestore ----------------
function fsMatch(d, wheres) {
  return (wheres || []).every(([f, op, v]) => {
    const x = d[f];
    switch (op) {
      case "==": return x === v; case "!=": return x !== v;
      case "<": return x < v; case "<=": return x <= v; case ">": return x > v; case ">=": return x >= v;
      case "in": return Array.isArray(v) && v.includes(x);
      case "array-contains": return Array.isArray(x) && x.includes(v);
      default: return false;
    }
  });
}
function fsNotify(col) {
  const msg = JSON.stringify({ t: "fschange", col });
  for (const c of clients) if (c.readyState === 1) c.send(msg);
}

function handle(ws, m) {
  const ack = (extra) => ws.send(JSON.stringify(Object.assign({ t: "ack", id: m.id }, extra || {})));
  switch (m.op) {
    case "write": applyWrites(m.list); return ack({ ok: true });
    case "cas": {
      stats.cas++;
      const segs = split(m.path);
      if (stable(getAt(tree, segs)) !== m.expect) { stats.casFail++; return ack({ ok: false }); }
      applyWrites([{ path: m.path, value: m.value }]);
      return ack({ ok: true });
    }
    case "od": {
      if (m.kind === "cancel") ws.od = ws.od.filter((o) => !(o.path === m.path || o.path.startsWith(m.path + "/")));
      else ws.od.push({ path: m.path, kind: m.kind, value: m.value });
      return ack({ ok: true });
    }
    case "authAnon": { const uid = "anon_" + Math.random().toString(36).slice(2, 12); authUsers[uid] = { anon: true }; return ack({ uid }); }
    case "authSignUp": {
      if (Object.values(authUsers).some((u) => u.email === m.email)) return ack({ authError: "auth/email-already-in-use" });
      const uid = "u_" + Math.random().toString(36).slice(2, 12); authUsers[uid] = { email: m.email, password: m.password }; return ack({ uid });
    }
    case "authSignIn": {
      const e = Object.entries(authUsers).find(([, u]) => u.email === m.email && u.password === m.password);
      return e ? ack({ uid: e[0] }) : ack({ authError: "auth/invalid-credential" });
    }
    case "authLink": {
      if (Object.values(authUsers).some((u) => u.email === m.email)) return ack({ authError: "auth/email-already-in-use" });
      authUsers[m.uid] = { email: m.email, password: m.password }; return ack({ ok: true });
    }
    case "authDelete": { delete authUsers[m.uid]; return ack({ ok: true }); }
    case "fsGet": { const c = fsdb[m.col] || {}; return ack({ data: c[m.docId] == null ? null : c[m.docId] }); }
    case "fsSet": {
      const c = (fsdb[m.col] = fsdb[m.col] || {});
      if (m.mustExist && !c[m.docId]) return ack({ error: "not-found: No document to update" });
      const merged = m.merge ? Object.assign({}, c[m.docId] || {}, m.data) : Object.assign({}, m.data);
      for (const k of Object.keys(merged)) if (merged[k] && merged[k].__mockDelete) delete merged[k];
      c[m.docId] = merged;
      fsNotify(m.col); return ack({ ok: true });
    }
    case "fsDelete": { const c = fsdb[m.col] || {}; delete c[m.docId]; fsNotify(m.col); return ack({ ok: true }); }
    case "fsQuery": {
      const c = fsdb[m.col] || {};
      let docs = Object.entries(c).filter(([, d]) => fsMatch(d, m.wheres)).map(([id, data]) => ({ id, data }));
      if (m.order) { const [f, dir] = m.order; docs.sort((a, b) => (a.data[f] > b.data[f] ? 1 : a.data[f] < b.data[f] ? -1 : 0) * (dir === "desc" ? -1 : 1)); }
      if (m.limit) docs = docs.slice(0, m.limit);
      return ack({ docs });
    }
    default: return ack({ error: "unknown op " + m.op });
  }
}

// ---------------- HTTP (static + REST like Firebase) ----------------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".gif": "image/gif", ".mp3": "audio/mpeg", ".wav": "audio/wav" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/__mock/firebase.js") { res.writeHead(200, { "Content-Type": TYPES[".js"] }); return res.end(MOCK_JS); }
  if (url.pathname === "/__mock/stats") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(Object.assign({ clients: clients.size, treeBytes: JSON.stringify(tree || {}).length }, stats))); }
  if (url.pathname === "/__mock/reset") { tree = null; stats.writes = 0; stats.bytesOut = 0; stats.byPath = {}; stats.cas = 0; stats.casFail = 0; for (const k in authUsers) delete authUsers[k]; for (const k in fsdb) delete fsdb[k]; res.writeHead(200); return res.end("ok"); }
  if (url.pathname === "/__mock/fs") {
    if (req.method === "POST") { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { const { col, id, data } = JSON.parse(b); (fsdb[col] = fsdb[col] || {})[id] = data; res.end("ok"); }); return; }
    res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(fsdb));
  }
  if (url.pathname.endsWith(".json") && url.pathname.startsWith("/db/")) {
    const segs = split(decodeURIComponent(url.pathname.slice(4, -5)));
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const send = (v) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(v)); };
      if (req.method === "GET") return send(toVal(getAt(tree, segs)));
      const v = body ? JSON.parse(body) : null;
      if (req.method === "PUT") { applyWrites([{ path: segs.join("/"), value: v }]); return send(v); }
      if (req.method === "PATCH") { applyWrites(Object.keys(v || {}).map((k) => ({ path: segs.concat(split(k)).join("/"), value: v[k] }))); return send(v); }
      if (req.method === "DELETE") { applyWrites([{ path: segs.join("/"), value: null }]); return send(null); }
      res.writeHead(405); res.end();
    });
    return;
  }
  let p = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!p.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(p).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  });
});
const wss = new WebSocketServer({ server, path: "/__mock" });
wss.on("connection", (ws) => {
  ws.od = [];
  clients.add(ws);
  ws.send(JSON.stringify({ t: "init", tree }));
  ws.on("message", (data) => { try { handle(ws, JSON.parse(data)); } catch (e) { console.error("handle error", e); } });
  ws.on("close", () => {
    clients.delete(ws);
    const list = [];
    for (const o of ws.od) {
      if (o.kind === "set") list.push({ path: o.path, value: o.value });
      else if (o.kind === "update") for (const k in o.value || {}) list.push({ path: o.path + "/" + k, value: o.value[k] });
    }
    if (list.length) applyWrites(list);
  });
});
server.listen(PORT, "127.0.0.1", () => console.log(`mock firebase + static on http://127.0.0.1:${PORT} root=${ROOT}`));
