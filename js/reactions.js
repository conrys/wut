// ==========================================================================
// Живі реакції-емодзі — спільний модуль для БУДЬ-ЯКОЇ мультиплеєрної гри.
// Гравець тапає емодзі → воно летить бульбашкою по екранах усіх у кімнаті
// (включно з TV-екраном, якщо підключити той самий rebind/mountOverlay там).
// Ефемерне: RTDB-запис сам себе видаляє через REACTION_TTL_MS, нічого не
// накопичується в кімнаті і не заважає validateRoomShape в online-engine.js
// (шлях "reactions" не входить у жодну гру-схему, ігнорується нею спокійно).
//
// Підключення в грі (після того, як online-engine.js уже створив кімнату,
// тобто після onStateChange з непорожнім state — не одразу на завантаженні
// сторінки):
//   <link rel="stylesheet" href="js/reactions.css">
//   <script src="js/reactions.js"></script>
//   ...
//   if (!reactionsMounted) { reactionsMounted = true;
//     GameReactions.mount(theEnginesRoomRef, myUsername);
//   }
//
// Для TV/глядацьких сторінок без власних кнопок — тільки анімація, без бару:
//   GameReactions.mountOverlay(theEnginesRoomRef);
//
// Якщо кімната гри може підмінятись (реконект в іншу roomId) — виклич
// GameReactions.rebind(newRoomRef) замість повторного mount().
// ==========================================================================
(function () {
  const EMOJIS = ["😂", "🔥", "💀", "👏", "😮"];
  const REACTION_TTL_MS = 4000;
  const FLY_ANIMATION_MS = 1800;

  let overlayEl = null;
  let reactionsRef = null;
  let barMounted = false;

  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement("div");
    overlayEl.className = "reactions-overlay";
    document.body.appendChild(overlayEl);
    return overlayEl;
  }

  function spawnBubble(emoji) {
    const overlay = ensureOverlay();
    const bubble = document.createElement("div");
    bubble.className = "reaction-bubble";
    bubble.textContent = emoji;
    bubble.style.left = (15 + Math.random() * 70) + "%";
    bubble.style.setProperty("--drift", (Math.random() * 40 - 20).toFixed(0) + "px");
    overlay.appendChild(bubble);
    setTimeout(() => bubble.remove(), FLY_ANIMATION_MS);
  }

  function watchRoom(roomRef) {
    if (reactionsRef) { try { reactionsRef.off("child_added"); } catch (e) {} }
    reactionsRef = roomRef ? roomRef.child("reactions") : null;
    if (!reactionsRef) return;
    reactionsRef.on("child_added", (snap) => {
      const v = snap.val();
      if (v && v.emoji) spawnBubble(v.emoji);
    });
  }

  function sendReaction(roomRef, username, emoji) {
    if (!roomRef) return;
    const node = roomRef.child("reactions").push();
    node.set({ emoji, username: username || "", at: Date.now() });
    setTimeout(() => node.remove().catch(() => {}), REACTION_TTL_MS);
  }

  function mountOverlay(roomRef) {
    ensureOverlay();
    watchRoom(roomRef);
  }

  // Плаваюча кнопка знизу-справа (щоб не перекривати ігрові контроли, які в
  // різних іграх по-різному сидять знизу-по-центру/зліва) — тап розгортає
  // ряд емодзі, тап по емодзі шле реакцію і згортає назад.
  function mount(roomRef, username) {
    mountOverlay(roomRef);
    if (barMounted) return;
    barMounted = true;

    const wrap = document.createElement("div");
    wrap.className = "reactions-wrap";
    wrap.innerHTML = `
      <div class="reactions-row" id="reactionsRow"></div>
      <button type="button" class="reactions-toggle" id="reactionsToggle">😀</button>
    `;
    document.body.appendChild(wrap);

    const row = wrap.querySelector("#reactionsRow");
    row.innerHTML = EMOJIS.map((e) => `<button type="button" class="reaction-btn">${e}</button>`).join("");
    const toggle = wrap.querySelector("#reactionsToggle");

    toggle.addEventListener("click", () => wrap.classList.toggle("open"));
    row.querySelectorAll(".reaction-btn").forEach((btn, i) => {
      btn.addEventListener("click", () => {
        sendReaction(roomRef, username, EMOJIS[i]);
        wrap.classList.remove("open");
      });
    });
  }

  function rebind(roomRef) { watchRoom(roomRef); }

  window.GameReactions = { mount, mountOverlay, rebind, sendReaction, EMOJIS };
})();
