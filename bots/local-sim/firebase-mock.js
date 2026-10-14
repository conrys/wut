// Minimal Firebase compat mock (RTDB + Firestore) backed by a local WebSocket server.
// Only the API surface used by the 41 Games project is implemented.
(function () {
  if (window.firebase && window.firebase.__mock) return;
  const WS_URL = "ws://127.0.0.1:" + (window.__MOCK_PORT || 8787) + "/__mock";

  // ---------------- transport ----------------
  let ws = null, reqId = 0;
  const pending = new Map();
  const outbox = [];
  let synced = false;
  const syncWaiters = [];
  const fsWatchers = new Set();
  function onSynced() { return synced ? Promise.resolve() : new Promise((r) => syncWaiters.push(r)); }
  function rawSend(msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); else outbox.push(msg);
  }
  function request(msg) {
    return new Promise((res, rej) => {
      msg.id = ++reqId;
      pending.set(msg.id, { res, rej });
      rawSend(msg);
    });
  }
  function connect() {
    ws = new WebSocket(WS_URL);
    ws.onopen = () => { while (outbox.length) ws.send(JSON.stringify(outbox.shift())); };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === "init") {
        tree = m.tree || null;
        synced = true;
        syncWaiters.splice(0).forEach((r) => r());
        notifyAll();
      } else if (m.t === "patches") {
        for (const p of m.list) tree = setAt(tree, split(p.path), p.value);
        notifyPaths(m.list.map((p) => split(p.path)));
      } else if (m.t === "ack") {
        const p = pending.get(m.id);
        if (p) { pending.delete(m.id); m.error ? p.rej(new Error(m.error)) : p.res(m); }
      } else if (m.t === "fschange") {
        fsWatchers.forEach((w) => { if (w.col === m.col) w.refresh(); });
      }
    };
    ws.onclose = () => { synced = false; setTimeout(connect, 500); };
  }

  // ---------------- tree helpers ----------------
  let tree = null;
  function split(path) { return String(path || "").split("/").filter(Boolean); }
  function getAt(node, segs) {
    for (const s of segs) {
      if (node === null || typeof node !== "object" || !(s in node)) return null;
      node = node[s];
    }
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
    const allInt = keys.length && keys.every((k) => /^(0|[1-9]\d*)$/.test(k));
    if (allInt) {
      const max = Math.max(...keys.map(Number));
      if (max < keys.length * 2) {
        const arr = new Array(max + 1);
        keys.forEach((k) => { arr[Number(k)] = toVal(v[k]); });
        return arr;
      }
    }
    const o = {};
    keys.forEach((k) => { o[k] = toVal(v[k]); });
    return o;
  }
  function stable(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
  }
  function sortKeys(keys) {
    const ints = keys.filter((k) => /^-?\d+$/.test(k) && String(Number(k)) === k).sort((a, b) => a - b);
    const strs = keys.filter((k) => !ints.includes(k)).sort();
    return ints.concat(strs);
  }
  const SERVER_TS = { ".sv": "timestamp" };
  function resolveLocal(v) {
    if (v && typeof v === "object") {
      if (v[".sv"] === "timestamp") return Date.now();
      if (v[".sv"] && typeof v[".sv"] === "object" && "increment" in v[".sv"]) return v; // server resolves
      const o = Array.isArray(v) ? [] : {};
      for (const k in v) o[k] = resolveLocal(v[k]);
      return o;
    }
    return v;
  }

  // ---------------- listeners ----------------
  const listeners = []; // {segs, ev, cb, last, known}
  let notifyScheduled = false;
  const dirty = new Set();
  function prefixRelated(a, b) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function notifyPaths(segsList) {
    for (const l of listeners) if (segsList.some((s) => prefixRelated(s, l.segs))) dirty.add(l);
    schedule();
  }
  function notifyAll() { listeners.forEach((l) => dirty.add(l)); schedule(); }
  function schedule() {
    if (notifyScheduled) return;
    notifyScheduled = true;
    setTimeout(() => {
      notifyScheduled = false;
      const list = Array.from(dirty); dirty.clear();
      for (const l of list) fire(l);
    }, 0);
  }
  function fire(l) {
    if (l.removed || !synced) return;
    const raw = getAt(tree, l.segs);
    if (l.ev === "value") {
      const s = stable(raw);
      if (l.last === s) return;
      l.last = s;
      safe(() => l.cb(new Snapshot(new Ref(l.segs), raw)));
    } else if (l.ev === "child_added" || l.ev === "child_removed" || l.ev === "child_changed") {
      const cur = raw && typeof raw === "object" ? raw : {};
      const prev = l.known || {};
      const now = {};
      for (const k of sortKeys(Object.keys(cur))) {
        now[k] = stable(cur[k]);
        if (l.ev === "child_added" && !(k in prev)) safe(() => l.cb(new Snapshot(new Ref(l.segs.concat(k)), cur[k])));
        if (l.ev === "child_changed" && k in prev && prev[k] !== now[k]) safe(() => l.cb(new Snapshot(new Ref(l.segs.concat(k)), cur[k])));
      }
      if (l.ev === "child_removed") for (const k in prev) if (!(k in now)) safe(() => l.cb(new Snapshot(new Ref(l.segs.concat(k)), null)));
      l.known = now;
    }
  }
  function safe(fn) { try { fn(); } catch (e) { setTimeout(() => { throw e; }); } }

  // ---------------- RTDB API ----------------
  const PUSH_CHARS = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";
  let lastPushTime = 0, lastRand = [];
  function pushId() {
    let now = Date.now();
    const dup = now === lastPushTime; lastPushTime = now;
    const t = new Array(8);
    for (let i = 7; i >= 0; i--) { t[i] = PUSH_CHARS.charAt(now % 64); now = Math.floor(now / 64); }
    let id = t.join("");
    if (!dup) { for (let i = 0; i < 12; i++) lastRand[i] = Math.floor(Math.random() * 64); }
    else { let i = 11; for (; i >= 0 && lastRand[i] === 63; i--) lastRand[i] = 0; if (i >= 0) lastRand[i]++; }
    for (let i = 0; i < 12; i++) id += PUSH_CHARS.charAt(lastRand[i]);
    return id;
  }

  function localWrite(list) {
    for (const p of list) tree = setAt(tree, split(p.path), norm(resolveLocal(p.value)));
    notifyPaths(list.map((p) => split(p.path)));
  }
  function cbWrap(promise, onComplete) {
    if (typeof onComplete === "function") promise.then(() => onComplete(null), (e) => onComplete(e));
    return promise;
  }

  class Snapshot {
    constructor(ref, raw) { this.ref = ref; this.key = ref.key; this._raw = raw === undefined ? null : raw; }
    val() { return toVal(this._raw); }
    exportVal() { return this.val(); }
    toJSON() { return this.val(); }
    exists() { return this._raw !== null; }
    child(p) { return new Snapshot(this.ref.child(p), getAt(this._raw, split(p))); }
    hasChild(p) { return getAt(this._raw, split(p)) !== null; }
    hasChildren() { return !!(this._raw && typeof this._raw === "object" && Object.keys(this._raw).length); }
    numChildren() { return this._raw && typeof this._raw === "object" ? Object.keys(this._raw).length : 0; }
    get size() { return this.numChildren(); }
    forEach(cb) {
      if (!this._raw || typeof this._raw !== "object") return false;
      for (const k of sortKeys(Object.keys(this._raw))) if (cb(new Snapshot(this.ref.child(k), this._raw[k])) === true) return true;
      return false;
    }
  }

  class Ref {
    constructor(segs) { this.segs = segs; this.key = segs.length ? segs[segs.length - 1] : null; this.path = "/" + segs.join("/"); }
    get parent() { return this.segs.length ? new Ref(this.segs.slice(0, -1)) : null; }
    get root() { return new Ref([]); }
    get ref() { return this; }
    child(p) { return new Ref(this.segs.concat(split(p))); }
    toString() { return "mock://" + this.path; }
    isEqual(o) { return o && o.path === this.path; }
    on(ev, cb, cancel, ctx) {
      if (typeof cancel === "object" && cancel) { ctx = cancel; }
      const fn = ctx ? cb.bind(ctx) : cb;
      if (this.segs[0] === ".info") {
        const v = this.segs[1] === "connected" ? true : this.segs[1] === "serverTimeOffset" ? 0 : null;
        setTimeout(() => fn(new Snapshot(this, v)), 5);
        return cb;
      }
      const l = { segs: this.segs, ev, cb: fn, orig: cb, last: undefined, known: null };
      listeners.push(l);
      onSynced().then(() => { dirty.add(l); schedule(); });
      return cb;
    }
    off(ev, cb) {
      for (let i = listeners.length - 1; i >= 0; i--) {
        const l = listeners[i];
        if (l.segs.join("/") !== this.segs.join("/")) continue;
        if (ev && l.ev !== ev) continue;
        if (cb && l.orig !== cb) continue;
        l.removed = true; listeners.splice(i, 1);
      }
    }
    once(ev, cb) {
      ev = ev || "value";
      return onSynced().then(() => {
        if (this.segs[0] === ".info") return new Snapshot(this, this.segs[1] === "connected" ? true : 0);
        const snap = new Snapshot(this, getAt(tree, this.segs));
        if (typeof cb === "function") cb(snap);
        return snap;
      });
    }
    get() { return this.once("value"); }
    set(v, onComplete) {
      const list = [{ path: this.segs.join("/"), value: v }];
      localWrite(list);
      return cbWrap(request({ op: "write", list }).then(() => undefined), onComplete);
    }
    update(obj, onComplete) {
      const base = this.segs.join("/");
      const list = Object.keys(obj || {}).map((k) => ({ path: base + "/" + k, value: obj[k] }));
      localWrite(list);
      return cbWrap(request({ op: "write", list }).then(() => undefined), onComplete);
    }
    remove(onComplete) { return this.set(null, onComplete); }
    push(v, onComplete) {
      const ref = this.child(pushId());
      const p = v === undefined ? Promise.resolve() : ref.set(v, onComplete);
      ref.then = (a, b) => p.then(() => ref).then(a, b);
      ref.catch = (b) => p.catch(b);
      return ref;
    }
    async transaction(fn, onComplete) {
      await onSynced();
      for (let attempt = 0; attempt < 50; attempt++) {
        const curRaw = getAt(tree, this.segs);
        const cur = toVal(curRaw);
        let next;
        try { next = fn(cur === null ? null : JSON.parse(JSON.stringify(cur))); }
        catch (e) { if (onComplete) onComplete(e, false, null); throw e; }
        if (next === undefined) {
          const snap = new Snapshot(this, curRaw);
          if (onComplete) onComplete(null, false, snap);
          return { committed: false, snapshot: snap };
        }
        const r = await request({ op: "cas", path: this.segs.join("/"), expect: stable(curRaw), value: next });
        if (r.ok) {
          await new Promise((res) => setTimeout(res, 0));
          const snap = new Snapshot(this, getAt(tree, this.segs));
          if (onComplete) onComplete(null, true, snap);
          return { committed: true, snapshot: snap };
        }
        await new Promise((res) => setTimeout(res, 5 + Math.random() * 20));
      }
      const err = new Error("maxretry");
      if (onComplete) onComplete(err, false, null);
      throw err;
    }
    onDisconnect() {
      const path = this.segs.join("/");
      return {
        set: (v) => request({ op: "od", path, kind: "set", value: v }).then(() => undefined),
        update: (v) => request({ op: "od", path, kind: "update", value: v }).then(() => undefined),
        remove: () => request({ op: "od", path, kind: "set", value: null }).then(() => undefined),
        cancel: () => request({ op: "od", path, kind: "cancel" }).then(() => undefined),
      };
    }
    orderByChild() { return this; } orderByKey() { return this; } orderByValue() { return this; }
    limitToLast() { return this; } limitToFirst() { return this; } equalTo() { return this; } startAt() { return this; } endAt() { return this; }
  }

  const database = {
    ref: (p) => new Ref(split(p)),
    goOnline() {}, goOffline() {},
  };

  // ---------------- Firestore API ----------------
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  class DocSnap {
    constructor(ref, data) { this.ref = ref; this.id = ref.id; this._d = data; this.exists = data != null; this.metadata = { fromCache: false, hasPendingWrites: false }; }
    data() { return this._d == null ? undefined : clone(this._d); }
    get(f) { return this._d ? this._d[f] : undefined; }
  }
  class QuerySnap {
    constructor(docs) { this.docs = docs; this.size = docs.length; this.empty = !docs.length; }
    forEach(cb) { this.docs.forEach(cb); }
    docChanges() { return this.docs.map((d) => ({ type: "added", doc: d })); }
  }
  class DocRef {
    constructor(col, id) { this.col = col; this.id = id || pushId(); this.path = col + "/" + this.id; }
    get parent() { return new Query(this.col, []); }
    async get() { const r = await request({ op: "fsGet", col: this.col, docId: this.id }); return new DocSnap(this, r.data); }
    set(data, opts) { return request({ op: "fsSet", col: this.col, docId: this.id, data: clone(data), merge: !!(opts && opts.merge) }).then(() => undefined); }
    update(data) { return request({ op: "fsSet", col: this.col, docId: this.id, data: clone(data), merge: true, mustExist: true }).then(() => undefined); }
    delete() { return request({ op: "fsDelete", col: this.col, docId: this.id }).then(() => undefined); }
    collection(sub) { return new Query(this.path + "/" + sub, []); }
    onSnapshot(cb, err) {
      const w = { col: this.col, refresh: () => this.get().then(cb, err) };
      fsWatchers.add(w); w.refresh();
      return () => fsWatchers.delete(w);
    }
  }
  class Query {
    constructor(col, wheres, lim, order) { this.col = col; this.id = col.split("/").pop(); this.wheres = wheres; this.lim = lim; this.order = order; }
    doc(id) { return new DocRef(this.col, id); }
    where(f, op, v) { return new Query(this.col, this.wheres.concat([[f, op, v]]), this.lim, this.order); }
    orderBy(f, dir) { return new Query(this.col, this.wheres, this.lim, [f, dir || "asc"]); }
    limit(n) { return new Query(this.col, this.wheres, n, this.order); }
    async get() {
      const r = await request({ op: "fsQuery", col: this.col, wheres: this.wheres, limit: this.lim || null, order: this.order || null });
      return new QuerySnap(r.docs.map((d) => new DocSnap(new DocRef(this.col, d.id), d.data)));
    }
    async add(data) { const ref = this.doc(); await ref.set(data); return ref; }
    onSnapshot(cb, err) {
      const w = { col: this.col, refresh: () => this.get().then(cb, err) };
      fsWatchers.add(w); w.refresh();
      return () => fsWatchers.delete(w);
    }
  }
  const firestore = {
    collection: (c) => new Query(c, []),
    doc: (p) => { const s = split(p); return new DocRef(s.slice(0, -1).join("/"), s[s.length - 1]); },
    settings() {}, enableNetwork: () => Promise.resolve(), disableNetwork: () => Promise.resolve(),
    enablePersistence: () => Promise.resolve(),
    batch() {
      const ops = [];
      return {
        set(ref, data, opts) { ops.push(() => ref.set(data, opts)); return this; },
        update(ref, data) { ops.push(() => ref.update(data)); return this; },
        delete(ref) { ops.push(() => ref.delete()); return this; },
        commit() { return Promise.all(ops.map((f) => f())).then(() => undefined); },
      };
    },
    runTransaction: async (fn) => fn({
      get: (ref) => ref.get(), set: (ref, d, o) => ref.set(d, o), update: (ref, d) => ref.update(d), delete: (ref) => ref.delete(),
    }),
  };

  const apps = [];
  const firestoreFn = () => firestore;
  firestoreFn.FieldValue = { serverTimestamp: () => Date.now(), delete: () => null };
  const databaseFn = () => database;
  databaseFn.ServerValue = { TIMESTAMP: SERVER_TS, increment: (n) => ({ ".sv": { increment: n } }) };
  window.firebase = {
    __mock: true, apps,
    initializeApp(cfg) { const a = { options: cfg, name: "[DEFAULT]" }; apps.push(a); return a; },
    app: () => apps[0],
    firestore: firestoreFn,
    database: databaseFn,
  };
  connect();
})();
