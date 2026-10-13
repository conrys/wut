// ==========================================================================
// room-code-ui.js — спільний екран "код кімнати" для party-ігор поверх
// online-engine.js. Виносить у ОДНЕ місце те, що раніше писалось власноруч
// у mafia.html (і зараз копіюється в кожну гру, яка переходить на номерні
// кімнати замість Engine.SHARED_ROOM_ID):
//
// - генерація короткого коду кімнати (5 символів, без 0/O/1/I/L — щоб не
//   плутати на слух/при передачі голосом)
// - екран "обери активну кімнату / введи код / створи нову"
// - підтримка ?room=CODE в URL (прямий лінк — той, хто відкрив лінк,
//   одразу заходить у потрібну кімнату, без екрана вибору)
// - список активних кімнат з ДОВІЛЬНИМ рендером кожного айтема — гра сама
//   вирішує, що показати (кількість гравців, фазу, аватарки тощо), ця
//   бібліотека лише малює обгортку .room-item і вішає клік
//
// Підключати ПІСЛЯ online-engine.js і game.js конкретної гри, ПЕРЕД
// власним <script> сторінки, що викликає RoomCodeUI.mount(...).
//
// Очікувана розмітка на сторінці (класи/стилі вже є в кожній грі —
// скопійовані з mafia.html):
//   <div class="rooms-list" id="..."></div>
//   <input class="text-input" id="..." maxlength="5" />
//   <button id="...">Приєднатись</button>
//   <button id="...">Створити нову кімнату</button>
// ==========================================================================
(function () {
  const ROOM_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // без 0/O/1/I/L

  function randomRoomCode(len) {
    len = len || 5;
    let s = "";
    for (let i = 0; i < len; i++) s += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    return s;
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s || "";
    return d.innerHTML;
  }

  // opts:
  //   containerId      — id елемента списку активних кімнат (.rooms-list)
  //   codeInputId      — id інпута коду (опційно, якщо нема ручного вводу)
  //   joinBtnId        — id кнопки "приєднатись" (опційно)
  //   createBtnId      — id кнопки "створити нову" (опційно)
  //   watchActiveRooms — (callback) => unsubscribe, з API самої гри
  //   renderRoomItem   — (room) => innerHTML одного .room-item (без обгортки)
  //   emptyListHtml    — html, коли активних кімнат нема (опційно)
  //   codeLength       — довжина коду для createBtn (дефолт 5)
  //   onEnter(roomId)  — викликається, коли обрано/введено/згенеровано код
  //                      (сторінка сама викликає GameApi.start(username, roomId))
  //   autoFromUrl      — за замовчуванням true: якщо в URL є ?room=, одразу
  //                      onEnter() без показу списку
  //   setUrlParam      — за замовчуванням true: записувати ?room=CODE в URL
  //                      при вході (щоб можна було поділитись лінком)
  // Повертає { stop() } — виклич stop() перед тим, як onEnter поведе гравця
  // далі (сторінка або сама зупиняє список, або лишає — на sub'скрайб це
  // не впливає, просто зайвий listener).
  function mount(opts) {
    opts = opts || {};
    const autoFromUrl = opts.autoFromUrl !== false;
    const setUrlParam = opts.setUrlParam !== false;
    let unsubscribe = null;

    function stop() {
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    }

    function enter(roomId) {
      stop();
      if (setUrlParam) history.replaceState(null, "", location.pathname + "?room=" + roomId);
      opts.onEnter(roomId);
    }

    function render(rooms) {
      const listEl = opts.containerId && document.getElementById(opts.containerId);
      if (!listEl) return;
      if (!rooms.length) {
        listEl.innerHTML = opts.emptyListHtml || '<div class="hint-text">Активних кімнат поки нема — створи нову.</div>';
        return;
      }
      listEl.innerHTML = rooms.map((r) =>
        `<div class="room-item" data-room="${escapeHtml(r.roomId)}">${opts.renderRoomItem(r)}</div>`
      ).join("");
      listEl.querySelectorAll(".room-item").forEach((item) => {
        item.addEventListener("click", () => enter(item.dataset.room));
      });
    }

    const urlRoom = autoFromUrl ? new URLSearchParams(location.search).get("room") : null;
    if (urlRoom) {
      enter(urlRoom.toUpperCase());
      return { stop };
    }

    if (opts.watchActiveRooms) unsubscribe = opts.watchActiveRooms(render);

    const codeInput = opts.codeInputId && document.getElementById(opts.codeInputId);
    const joinBtn = opts.joinBtnId && document.getElementById(opts.joinBtnId);
    const createBtn = opts.createBtnId && document.getElementById(opts.createBtnId);

    if (codeInput) codeInput.addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase(); });
    if (joinBtn) joinBtn.addEventListener("click", () => {
      const code = (codeInput && codeInput.value.trim().toUpperCase()) || "";
      if (!code) return;
      enter(code);
    });
    if (createBtn) createBtn.addEventListener("click", () => enter(randomRoomCode(opts.codeLength)));

    return { stop };
  }

  window.RoomCodeUI = { randomRoomCode, escapeHtml, mount };
})();
