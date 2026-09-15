// ==========================================================================
// Спільний модуль глобального ігрового хедера (#gameHeader / .game-header).
// Раніше кожен з login.js / back-button.js / records.js створював хедер
// самостійно (три копії однієї й тієї ж функції) — тепер структуру створює
// й роздає слоти лише цей модуль, а інші лише кладуть у них свої елементи.
//
// Підключати ПЕРЕД js/login.js, js/back-button.js, js/records.js:
//   <link rel="stylesheet" href="css/game-header.css">
//   <script src="js/game-header.js"></script>
//   <script src="js/login.js"></script>
//   <script src="js/records.js"></script>
//   <script src="js/back-button.js"></script>
// ==========================================================================
(function () {
  const SLOT_NAMES = ["left", "center", "right"];

  function ensure() {
    let header = document.getElementById("gameHeader");
    if (!header) {
      header = document.createElement("div");
      header.id = "gameHeader";
      header.className = "game-header";
      header.innerHTML = SLOT_NAMES
        .map((name) => `<div class="slot-${name}" data-header-slot="${name}"></div>`)
        .join("");
      const page = document.querySelector(".page") || document.body;
      page.insertBefore(header, page.firstChild);
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
})();
