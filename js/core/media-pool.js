// ==========================================================================
// Хмарні картинки для ігор (завантажуються з телефона через upload.html).
//
// Файл лежить у Firebase Storage: games41_media/<гра>/<file>
// Список — у Firestore games41_media/{id}: { game, file, text, by, uid, w, h, size, createdAt }
//
// Посилання на файл будується з імені напряму (без запиту до Storage і без
// токена), тож гра може зберігати в кімнаті лише ім'я файлу — кожен телефон
// відкриє ту саму картинку. Читання Storage для цієї папки відкрите правилами.
//
// Вбудовані картинки (memes/, img/fakenews/, ql_img/) лишаються як були —
// хмарні просто додаються до них.
// ==========================================================================
(function () {
  const COLLECTION = "games41_media";
  const ROOT = "games41_media";
  const BUCKET = (typeof firebaseConfig !== "undefined" && firebaseConfig.storageBucket) || "kzl-crm.firebasestorage.app";
  const LIST_TIMEOUT_MS = 5000;

  // Ігри, які беруть хмарні картинки. text — що просити підписати при завантаженні.
  const GAMES = {
    memology: { label: "Мемологія", hint: "Меми й смішні фото без тексту. Також ідуть у «Римейк».", text: null },
    fakenews: { label: "Fake News", hint: "Фото, до яких гравці вигадують заголовки.", text: { label: "Що на фото (бачать гравці)", required: true, max: 80 } },
    quiplash: { label: "Сміхлист · фінал", hint: "Картинка для фінального раунду, всі підписують одну.", text: { label: "Завдання (необов'язково)", required: false, max: 120, placeholder: "Придумайте смішний підпис до цієї картинки" } },
  };

  function path(game, file) { return ROOT + "/" + game + "/" + file; }
  function url(fullPath) {
    return "https://firebasestorage.googleapis.com/v0/b/" + BUCKET + "/o/" + encodeURIComponent(fullPath) + "?alt=media";
  }
  function fileUrl(game, file) { return url(path(game, file)); }

  const cache = {};
  // Promise<[{ id, game, file, url, text, by, createdAt }]>, найстаріші першими.
  // Ніколи не відхиляється: немає мережі/бази — порожній список, гра йде на вбудованих.
  function list(game, opts) {
    if (!GAMES[game]) return Promise.resolve([]);
    if (cache[game] && !(opts && opts.fresh)) return cache[game];
    if (!window.firebaseReady || typeof db === "undefined" || !db) return Promise.resolve([]);
    const p = Promise.race([
      db.collection(COLLECTION).where("game", "==", game).get(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), LIST_TIMEOUT_MS)),
    ]).then((snap) => {
      const out = [];
      snap.forEach((d) => {
        const x = d.data() || {};
        if (typeof x.file !== "string" || !/^[a-z0-9]+\.(webp|jpg)$/.test(x.file)) return;
        out.push({
          id: d.id, game, file: x.file, url: fileUrl(game, x.file),
          text: typeof x.text === "string" ? x.text.trim() : "",
          by: x.by || "", createdAt: Number(x.createdAt) || 0, w: x.w || 0, h: x.h || 0,
        });
      });
      out.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
      return out;
    }).catch((e) => {
      console.warn("MediaPool.list(" + game + "):", e && e.message);
      delete cache[game];
      return [];
    });
    cache[game] = p;
    return p;
  }

  window.MediaPool = { COLLECTION, ROOT, BUCKET, GAMES, path, url, fileUrl, list };
})();
