// ==========================================================================
// «Що нового»: разове вікно на головній після великого оновлення.
// Показується один раз на телефон для кожного нового запису; новачок бачить
// лише найсвіжіший. Щоб розповісти про оновлення — допиши запис ЗВЕРХУ в ENTRIES
// (id — дата, більший за попередній; другий запис за день: 2026-11-03b).
// Лише те, що бачать гравці: без ігор із вкладки dev і службових правок.
// ==========================================================================
(function () {
  const ENTRIES = [
    {
      id: "2026-11-09",
      title: "Що нового",
      groups: [
        { name: "Три в ряд", items: ["Нова соло-гра в «Аркадах»: дві складності й нескінченні рівні", "У рекордах видно бали й рівень"] },
      ],
    },
    {
      id: "2026-11-03",
      title: "Що нового",
      groups: [
        { name: "Косинка", items: ["Коли всі карти відкриті, партія збирається сама", "У стилі шапки «лише кнопки» знову працюють Рекорди й інші кнопки"] },
        { name: "Шахи", items: ["Кнопка «Скасувати хід»: проти бота, удвох на одному телефоні й онлайн за згодою суперника"] },
      ],
    },
  ];
  const KEY = "whats_new_seen";
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function seen() { try { return localStorage.getItem(KEY); } catch (e) { return ENTRIES[0].id; } }
  function remember() { try { localStorage.setItem(KEY, ENTRIES[0].id); } catch (e) {} }

  function show(list) {
    const css = document.createElement("style");
    css.textContent = `
      .wn-back{position:fixed;inset:0;z-index:9500;background:rgba(6,8,14,.66);display:flex;align-items:center;justify-content:center;padding:16px}
      .wn-box{background:#1E1B25;color:#F4F1EA;border:1px solid #33303D;border-radius:20px;width:100%;max-width:380px;max-height:80dvh;overflow-y:auto;padding:20px;box-sizing:border-box;font:15px/1.45 'Inter',system-ui,sans-serif}
      .wn-box h2{margin:0 0 12px;font-size:22px;line-height:1.2}
      .wn-box h3{margin:14px 0 4px;font-size:14px;color:#FFC93C}
      .wn-box ul{margin:0;padding-left:18px}.wn-box li{margin-bottom:4px}
      .wn-close{display:block;width:100%;margin-top:16px;min-height:46px;border:0;border-radius:14px;background:#FFC93C;color:#2A2000;font-weight:700;font-size:16px;cursor:pointer}
      .wn-close:focus-visible{outline:3px solid #59C3FF;outline-offset:2px}`;
    document.head.appendChild(css);
    const back = document.createElement("div"); back.className = "wn-back";
    const body = list.map((e) => e.groups.map((g) => `<h3>${esc(g.name)}</h3><ul>${g.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`).join("")).join("");
    back.innerHTML = `<div class="wn-box" role="dialog" aria-modal="true" aria-labelledby="wnTitle"><h2 id="wnTitle">${esc(list[0].title)}</h2>${body}<button class="wn-close" type="button">Зрозуміло</button></div>`;
    const close = () => { remember(); back.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    back.querySelector(".wn-close").addEventListener("click", close);
    back.addEventListener("click", (e) => { if (e.target === back) close(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(back);
    back.querySelector(".wn-close").focus({ preventScroll: true });
  }

  function open() {
    const last = seen();
    const list = last ? ENTRIES.filter((e) => e.id > last) : ENTRIES.slice(0, 1);
    if (list.length) show(list);
  }
  window.WhatsNew = { open };
  addEventListener("load", () => setTimeout(open, 900));
})();
