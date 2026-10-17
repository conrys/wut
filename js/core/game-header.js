// ==========================================================================
// Спільний модуль глобального ігрового хедера (#gameHeader / .game-header).
// Раніше кожен з login.js / back-button.js / records.js створював хедер
// самостійно (три копії однієї й тієї ж функції) — тепер структуру створює
// й роздає слоти лише цей модуль, а інші лише кладуть у них свої елементи.
//
// Підключати в <head>: CSS одразу, скрипт із defer перед сторінковими модулями.
// Хедер позиціонується від viewport, а spacer лише резервує місце в потоці гри.
//   <link rel="stylesheet" href="js/game-header.css">
//   <script src="js/game-header.js" defer></script>
// Після цього модулі можуть додавати елементи через GameHeader.slot(...).
// ==========================================================================
(function () {
  const SLOT_NAMES = ["left", "center", "right"];
  const currentPath = window.location.pathname.split("/").pop();
  const isIndex = currentPath === "index.html" || currentPath === "";
  // Головна — від адреси самого скрипта (js/core/ → ../../index.html), а не від кореня
  // диска/сервера: так «Назад» працює і з file://, і з підпапок (ads/<гра>/).
  const HOME_URL = document.currentScript && document.currentScript.src
    ? new URL("../../index.html", document.currentScript.src).href
    : new URL("index.html", window.location.href).href;
  let spacer;
  let resizeObserver;

  function ensure() {
    let header = document.getElementById("gameHeader");
    if (!header) {
      header = document.createElement("div");
      header.id = "gameHeader";
      header.className = "game-header";
      document.body.appendChild(header);
    }

    for (const name of SLOT_NAMES) {
      if (!header.querySelector(`[data-header-slot="${name}"]`)) {
        const slot = document.createElement("div");
        slot.className = `slot-${name}`;
        slot.dataset.headerSlot = name;
        header.appendChild(slot);
      }
    }

    const fixedHeader = header.classList.contains("game-header--fixed");
    const page = header.closest(".page") || document.querySelector(".page") || document.body;
    if (!spacer) {
      spacer = document.createElement("div");
      spacer.className = "game-header-spacer";
      page.insertBefore(spacer, page.firstChild);
    }
    spacer.classList.toggle("game-header-spacer--fixed", fixedHeader);
    if (header.parentElement !== document.body) document.body.appendChild(header);

    const syncSpacer = () => {
      spacer.style.setProperty("--game-header-page-padding-top", fixedHeader ? "0px" : getComputedStyle(page).paddingTop);
      spacer.style.height = `${header.getBoundingClientRect().height + 12}px`;
    };
    syncSpacer();
    if (!resizeObserver && window.ResizeObserver) {
      resizeObserver = new ResizeObserver(syncSpacer);
      resizeObserver.observe(header);
    }
    if (!header.dataset.spacerSync) {
      window.addEventListener("resize", syncSpacer, { passive: true });
      document.addEventListener("appsettingschange", syncSpacer);
      header.dataset.spacerSync = "true";
    }

    if (!isIndex && !header.querySelector("#backBtn")) {
      const backBtn = document.createElement("button");
      backBtn.type = "button";
      backBtn.className = "app-back-btn";
      backBtn.id = "backBtn";
      backBtn.title = "До списку ігор";
      backBtn.setAttribute("aria-label", "Назад");
      backBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
      backBtn.addEventListener("click", () => {
        window.location.href = HOME_URL;
      });
      header.querySelector(".slot-left").appendChild(backBtn);
    }

    return header;
  }

  function slot(name) {
    if (!SLOT_NAMES.includes(name)) {
      throw new Error(`Unknown game header slot: ${name}`);
    }
    return ensure().querySelector(`.slot-${name}`);
  }

  window.GameHeader = { ensure, slot };
  if (!isIndex) ensure();
})();
