/* Мережа для Хованок і Перевтілення — Firebase Realtime Database 41 Games.
   Підключення (до game.js):
     firebase-app/auth/database-compat → ../../js/core/firebase-config.js →
     <script src="../net-firebase.js" data-root="hns"></script>   (Перевтілення: data-root="ph")

   Дані: /{root}/{код}/{peerId} = { p: "<JSON стану гравця>", t: serverTimestamp }.
   Стан пишемо JSON-рядком: RTDB викидає порожні масиви й обʼєкти, а гра на них розраховує.
   Запис — не частіше ~15 разів/с; onDisconnect прибирає гравця, якщо зник звʼязок.
   У кімнаті до 10 гравців (join кидає Error('full')).
   Гра потребує лише: ready() -> bool, join(code) -> { presence(patch), peers(), leave() }. */
(function () {
  const root = (document.currentScript && document.currentScript.dataset.root) || "hns";
  const MAX_PLAYERS = 10; // більше — тісно на картах і рідко шукаєш; одинадцятому — «Кімната повна»
  if (!window.firebase || !firebase.database || !firebase.auth) return; // офлайн — лише гра з ботами

  // Запис у базу — лише з входом (як у Змійці). Хто не входив у 41 Games, отримує анонімний вхід.
  function signedIn() {
    return new Promise((resolve) => {
      const auth = firebase.auth();
      const done = setTimeout(() => resolve(false), 8000);
      const off = auth.onAuthStateChanged((user) => {
        off();
        if (user) { clearTimeout(done); resolve(true); return; }
        auth.signInAnonymously().then(() => { clearTimeout(done); resolve(true); }, () => { clearTimeout(done); resolve(false); });
      });
    });
  }

  window.HNS_TRANSPORT = {
    async ready() { return signedIn(); },
    async join(code) {
      const db = firebase.database();
      const roomRef = db.ref(root + "/" + code);
      const before = (await roomRef.once("value")).val() || {};
      const inRoom = Object.values(before).filter((v) => { try { return !!JSON.parse(v.p).n; } catch (e) { return false; } }).length;
      if (inRoom >= MAX_PLAYERS) throw new Error("full");
      const id = db.ref().push().key, meRef = roomRef.child(id);
      let mine = {}, dirty = true, last = 0, list = [{ id, isMe: true, presence: {}, updatedAt: Date.now() }];
      const seen = new Map();
      const meNow = () => ({ id, isMe: true, presence: Object.freeze({ ...mine }), updatedAt: Date.now() });
      meRef.onDisconnect().remove();
      roomRef.on("value", (snap) => {
        const v = snap.val() || {}, now = Date.now(), next = [];
        for (const pid in v) {
          if (pid === id) continue;
          const raw = v[pid] && v[pid].p;
          if (typeof raw !== "string") continue;
          const old = seen.get(pid);
          let pres = old && old.raw === raw ? old.pres : null;
          if (!pres) { try { pres = Object.freeze(JSON.parse(raw)); } catch (e) { continue; } }
          const updatedAt = old && old.raw === raw ? old.updatedAt : now;
          seen.set(pid, { raw, pres, updatedAt });
          next.push({ id: pid, isMe: false, presence: pres, updatedAt });
        }
        for (const pid of [...seen.keys()]) if (!(pid in v)) seen.delete(pid);
        list = [meNow()].concat(next);
      });
      const pump = setInterval(() => {
        if (!dirty) return;
        const t = Date.now();
        if (t - last < 66) return;
        last = t; dirty = false;
        meRef.set({ p: JSON.stringify(mine), t: firebase.database.ServerValue.TIMESTAMP }).catch(() => {});
      }, 33);
      return {
        presence(patch) {
          for (const k in patch) { if (patch[k] === null) delete mine[k]; else mine[k] = patch[k]; }
          dirty = true;
          list = [meNow()].concat(list.filter((p) => !p.isMe));
          return Promise.resolve();
        },
        peers() { return list; },
        leave() { clearInterval(pump); roomRef.off(); meRef.onDisconnect().cancel(); return meRef.remove().catch(() => {}); },
      };
    },
  };
})();
