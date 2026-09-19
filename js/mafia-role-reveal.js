// ==========================================================================
// mafia-role-reveal.js — анімація розкриття ролі (слайд знизу → пауза →
// перегортання аркуша). Портовано з окремого тестового стенду
// (role_reveal_test.html) без змін логіки/таймінгу — лише обгорнуто в
// модуль з публічним API замість керування кнопками/скрабером.
//
// Перспективне перегортання (перше, крихке) свідомо НЕ додано — лишається
// на потім. Це поточна робоча версія: 2D rotateY + "bulge" (scaleX), яка
// вже була перевірена на всіх чотирьох ролях в тестовому стенді.
//
// Публічний API:
//   MafiaRoleReveal.mount(containerEl) — один раз, будує розмітку/стилі
//     всередині containerEl. Стилі інжектяться в <head> лише один раз,
//     навіть якщо mount() викликати кілька разів (напр. hot-reload).
//   MafiaRoleReveal.play(role, opts) — role: "mafia"|"doctor"|"sheriff"|
//     "civilian" (це РІВНО ті ключі, що й у ROLE_META з mafia-game.js —
//     конвертація в role_* ключі тестового стенду відбувається всередині).
//     opts.isDon (bool, за замовчуванням false) — показати бейдж
//     "Дон мафії" під аркушем (тільки для role==="mafia").
//     opts.onDone (function, необов'язково) — викликається один раз, коли
//     анімація фізично завершилась (t >= TOTAL).
//   MafiaRoleReveal.DURATION_MS — загальна тривалість анімації в мс,
//     щоб виклику зовні було зручно звірити з тривалістю фази (наразі
//     2200мс проти PHASE_DURATIONS.role_reveal = 5000мс в mafia-game.js —
//     є запас, аркуш встигає долежати відкритим кілька секунд).
// ==========================================================================
(function () {
  "use strict";

  const SLIDE = 700, PAUSE = 500, FLIP = 1000;
  const TOTAL = SLIDE + PAUSE + FLIP;
  const CONTENT_Y_OFFSET = -292; // див. коментар в тестовому стенді (тест-9)

  // role_mafia/role_doctor/role_detective/role_civilian — оригінальні ключі
  // з витягнутих SVG (детектив = шериф за грою). ROLE_KEY_MAP переводить
  // ігрові ключі ролей (ROLE_META з mafia-game.js) в ключі цієї таблиці.
  const ROLE_KEY_MAP = { mafia: "role_mafia", doctor: "role_doctor", sheriff: "role_detective", civilian: "role_civilian" };

  const ROLE_DATA = {
    role_mafia: {
      sheet: `<rect id="лист_фон" x="143" y="399" class="role_mafia-st3" width="535" height="749" />
	<rect x="183" y="436" class="role_mafia-st9" width="181" height="245" />
	<rect x="389.95" y="442.72" class="role_mafia-st4" width="243.31" height="66.28" />
	<text transform="matrix(1 0 0 1.2 405.4468 500.3521)" class="role_mafia-st6 role_mafia-st7">МАФІЯ</text>
	<line class="role_mafia-st10" x1="388" y1="593" x2="628" y2="593" />
	<line class="role_mafia-st11" x1="388.5" y1="629.5" x2="628.5" y2="629.5" />
	<line class="role_mafia-st11" x1="388.5" y1="663.5" x2="628.5" y2="663.5" />
	<line class="role_mafia-st11" x1="218.5" y1="718.5" x2="629" y2="718.5" />
	<line class="role_mafia-st11" x1="479" y1="1104" x2="590" y2="1104" />
	<line class="role_mafia-st11" x1="178" y1="1002" x2="355.5" y2="1002" />
	<line class="role_mafia-st11" x1="177.5" y1="957.5" x2="628.5" y2="957.5" />
	<line class="role_mafia-st11" x1="628.5" y1="920.5" x2="177.5" y2="920.5" />
	<line class="role_mafia-st11" x1="177.5" y1="880.5" x2="628.5" y2="880.5" />
	<line class="role_mafia-st11" x1="628.5" y1="841.5" x2="177.5" y2="841.5" />
	<line class="role_mafia-st11" x1="177.5" y1="801.5" x2="628.5" y2="801.5" />
	<line class="role_mafia-st11" x1="628.5" y1="757.5" x2="177.5" y2="757.5" />
	<rect x="193" y="449.81" class="role_mafia-st12" width="161" height="197.38" />
	<path class="role_mafia-st19" d="M194.87,646.28c0-17.2,0-34.39,0-51.59c12.93-5.23,25.86-10.47,38.79-15.7c-4.31-5.23-8.62-10.47-12.93-15.7 c7.9-6.73,15.8-13.46,23.7-20.19c-1.47-2.55-2.97-5.54-4.31-8.97c-2.67-6.81-3.82-13.06-4.31-17.94c-2.87,0.08-7.57-0.17-12.93-2.24 c-5.09-1.97-8.67-4.79-10.77-6.73c2.68-2.15,6.26-4.61,10.77-6.73c5.84-2.74,11.16-3.94,15.08-4.49c1.54-9.06,4.3-23.12,8.62-35.89 c1.03-3.05,2.68-7.6,6.46-8.97c3.63-1.31,7.85,0.79,10.77,2.24c2.99,1.49,5.14,3.26,6.46,4.49c1.9-1.25,4.82-2.97,8.62-4.49 c4.5-1.79,7.61-3.03,10.77-2.24c4.06,1.01,6.52,4.92,8.62,8.97c2.95,5.7,7.69,16.49,10.77,33.65c3.37-0.44,7.81-0.67,12.93,0 c6.42,0.85,11.56,2.8,15.08,4.49c-2.26,2.97-6.42,7.61-12.93,11.22c-5.04,2.79-9.7,3.96-12.93,4.49c0.5,4.46,0.72,11.89-2.15,20.19 c-1.26,3.62-2.83,6.61-4.31,8.97c7.18,5.98,14.37,11.96,21.55,17.94c-3.59,5.98-7.18,11.96-10.77,17.94 c12.21,3.74,24.42,7.48,36.63,11.22l0.45,55.62C300.2,646.58,247.31,645.53,194.87,646.28z" />`,
      hidden: `<rect x="856" y="444" class="role_mafia-st4" width="463" height="74" />
	<g id="пістоль">
		<path class="role_mafia-st13" d="M1124.26,820.4c6.91,5.17,14.84,8.18,22.97,9.17c-10.38,9.79-26.57,10.78-38.07,2.17 c-9.17-6.85-14.9-17.3-15.72-28.71c-0.69-9.45,2.07-18.73,7.62-26.24c0.69,13.91,6.32,27.59,16.81,38.09 C1119.89,816.89,1122.04,818.75,1124.26,820.4z" />
		<path class="role_mafia-st14" d="M1078.17,951.16c1.82,1.82,2.83,4.25,2.83,6.83s-1,5.01-2.83,6.83c-1.82,1.82-4.25,2.83-6.83,2.83 c-2.57,0-5-1-6.83-2.83c-3.76-3.78-3.76-9.91,0-13.67c1.84-1.82,4.26-2.83,6.83-2.83C1073.92,948.33,1076.34,949.33,1078.17,951.16 z" />
		<path class="role_mafia-st15" d="M1154.4,1020.42c1.52,2.31,1.21,5.4-0.75,7.35l-41,41c-1.69,1.69-3.68,1.78-4.69,1.68s-2.94-0.56-4.28-2.54 L987.73,896.2c-1.56-2.31-1.26-5.43,0.7-7.39l42.81-42.81c1.41-1.42,3.01-1.71,4.12-1.71c0.22,0,0.43,0.01,0.6,0.03 c1.03,0.1,2.96,0.59,4.29,2.6L1154.4,1020.42z M1099.66,957.99c0-7.57-2.94-14.67-8.3-20.03c-2.67-2.68-5.79-4.75-9.17-6.16 c-3.4-1.41-7.06-2.14-10.85-2.14c-7.57,0-14.67,2.94-20.03,8.3c-11.04,11.04-11.04,29.01,0,40.05c5.35,5.35,12.46,8.3,20.03,8.3 c7.57,0,14.69-2.94,20.03-8.3C1096.72,972.66,1099.66,965.56,1099.66,957.99z" />
		<path class="role_mafia-st16" d="M1217.79,628.93l-42.36,42.36c-13.97,13.95-19.57,33.65-16.35,52.17c-15.98-3.22-33.1,1.42-45.55,13.87 l-21.86,21.85c-11.92,11.93-18.06,28.4-16.84,45.21c1.22,16.81,9.66,32.24,23.16,42.31c6.91,5.18,14.87,8.2,23.03,9.19l-0.52,0.5 c-15.93,15.93-18.53,41.19-6.2,60.04l69.48,106.12c1.87,2.86,1.48,6.7-0.95,9.12l-72.41,72.42c-2.1,2.1-4.54,2.21-5.81,2.1 c-1.26-0.11-3.65-0.67-5.33-3.13l-98.75-143.77c-14.36-20.92-38.01-32.63-62.3-32.63c-9.75,0-19.61,1.88-28.98,5.83 c-7.01,2.94-14.9,0.85-19.55-4.82l313.42-313.42L1217.79,628.93z M1166.84,1040.97c8.18-8.18,9.5-21.13,3.14-30.81l-114.14-173.49 c-4.08-6.19-10.62-10.16-17.99-10.91c-7.36-0.75-14.59,1.81-19.81,7.05l-42.81,42.79c-8.28,8.28-9.53,21.35-2.99,31.05 l115.95,171.7c4.11,6.09,10.67,9.98,17.97,10.68c0.79,0.09,1.58,0.11,2.37,0.11c6.46,0,12.68-2.54,17.3-7.18L1166.84,1040.97z" />
		<polygon class="role_mafia-st17" points="1307.66,526.64 1224.78,609.53 1216.28,601.03 1299.18,518.16 " />
		
			<rect x="1016.97" y="668.8" transform="matrix(0.7072 -0.707 0.707 0.7072 -165.845 946.2259)" class="role_mafia-st17" width="85.05" height="9.1" />
		<path class="role_mafia-st18" d="M1327.46,520.05c3.65,3.65,3.65,9.55,0,13.19l-89.49,89.49c1.51,1.71,2.35,3.89,2.35,6.19 c0,2.47-0.98,4.84-2.73,6.59l-48.97,48.97c-14.17,14.17-15.79,36.95-3.76,52.99l9.58,12.76c14.31,19.09,12.39,46.21-4.49,63.09 l-56.25,56.26c-9.72,9.72-11.31,25.11-3.79,36.61l69.47,106.12c6.69,10.22,5.28,23.9-3.36,32.54l-72.41,72.41 c-4.9,4.9-11.47,7.59-18.32,7.59c-0.79,0-1.59-0.04-2.4-0.11c-7.69-0.7-14.61-4.77-18.99-11.14l-98.75-143.77 c-15.15-22.05-44.04-30.52-68.69-20.16c-8.43,3.53-17.47,3.6-25.51,0.79c-5.2,4.72-11.76,7.12-18.35,7.12 c-6.99,0-13.98-2.66-19.29-7.98c-5.15-5.15-8-12-7.98-19.28c0-7.29,2.84-14.14,8-19.29c1.19-1.21,2.48-2.25,3.85-3.2l-1.92-3.5 c-12.45-22.61-8.38-51.16,9.88-69.42l2.47-2.47l-5.8-5.8c-3.65-3.65-3.65-9.55,0-13.19c3.65-3.65,9.56-3.65,13.21,0l5.79,5.8 l327.94-327.93c-0.67-0.4-1.32-0.88-1.9-1.45c-3.65-3.65-3.65-9.56,0-13.19l17.57-17.57c3.63-3.65,9.55-3.65,13.19,0 c0.57,0.57,1.05,1.22,1.45,1.89l13.25-13.25c1.74-1.75,4.12-2.74,6.59-2.74c2.47,0,4.85,0.99,6.6,2.74l45.45,45.45 c3.14,3.14,3.57,8,1.28,11.6L1327.46,520.05z M1224.78,609.53l82.88-82.89l-8.48-8.48l-82.89,82.88L1224.78,609.53z M973.76,817.17 l317.38-317.38l-32.26-32.26l-159.32,159.32l13.02,13.02c1.75,1.75,2.74,4.13,2.74,6.6c0,2.47-0.99,4.85-2.74,6.6l-73.33,73.33 c-1.82,1.82-4.21,2.73-6.6,2.73c-2.38,0-4.77-0.9-6.59-2.73l-13.04-13.04l-71.52,71.53L973.76,817.17z M1175.43,671.29l42.36-42.36 l-14.7-14.7L889.68,927.64c4.65,5.67,12.55,7.77,19.55,4.82c9.37-3.95,19.24-5.83,28.98-5.83c24.29,0,47.95,11.71,62.3,32.63 l98.75,143.77c1.68,2.45,4.06,3.01,5.33,3.13c1.28,0.11,3.72,0,5.81-2.1l72.41-72.42c2.43-2.41,2.81-6.26,0.95-9.12l-69.48-106.12 c-12.33-18.85-9.73-44.1,6.2-60.04l0.52-0.5c-8.15-0.99-16.12-4.01-23.03-9.19c-13.49-10.06-21.94-25.5-23.16-42.31 s4.92-33.28,16.84-45.21l21.86-21.85c12.45-12.45,29.57-17.08,45.55-13.87C1155.86,704.94,1161.46,685.24,1175.43,671.29z M1176.75,800.12c10.42-10.41,11.59-26.9,2.76-38.69l-8.99-11.99c-11.51-10.42-28.45-10.98-40.51-1.79 c-0.73,0.56-1.39,1.22-1.97,1.95c-12.23,15.48-11.05,38,3.04,52.08c1.36,1.36,2.83,2.64,4.35,3.78c5.27,3.95,11.53,5.89,17.76,5.89 c7.65,0,15.26-2.93,20.96-8.63L1176.75,800.12z M1147.23,829.58c-8.13-0.99-16.06-4.01-22.97-9.17c-2.23-1.65-4.38-3.52-6.39-5.53 c-10.49-10.49-16.12-24.18-16.81-38.09c-5.56,7.51-8.31,16.8-7.62,26.24c0.82,11.41,6.55,21.86,15.72,28.71 C1120.66,840.36,1136.85,839.37,1147.23,829.58z M1032.65,706.62l60.15-60.14l-6.43-6.43l-60.15,60.14L1032.65,706.62z M954.89,836.04l5.67-5.67l-32.26-32.26l-5.67,5.67L954.89,836.04z M936.03,854.9l5.67-5.67l-32.26-32.26l-5.67,5.67L936.03,854.9z M917.17,873.76l5.66-5.67l-32.26-32.26l-5.66,5.67L917.17,873.76z M880.1,910.82l23.86-23.86l-31.45-31.45 c-7.25,11.94-7.84,27.23-0.92,39.84L880.1,910.82z M866.49,936.41c2.21,2.21,5.31,2.93,8.15,2.24c-1.12-1.44-2.15-2.96-3.06-4.61 l-5.28-9.59c-1.51,1.59-2.33,3.68-2.33,5.87C863.98,932.62,864.87,934.79,866.49,936.41z" />
		<path class="role_mafia-st13" d="M1291.14,499.8L973.76,817.17l-32.26-32.26l71.52-71.53l13.04,13.04c1.82,1.82,4.21,2.73,6.59,2.73 c2.4,0,4.78-0.9,6.6-2.73l73.33-73.33c1.75-1.75,2.74-4.13,2.74-6.6c0-2.47-0.99-4.85-2.74-6.6l-13.02-13.02l159.32-159.32 L1291.14,499.8z" />
		<path class="role_mafia-st18" d="M1169.99,1010.16c6.36,9.68,5.04,22.62-3.14,30.81l-41,41c-4.62,4.64-10.84,7.18-17.3,7.18 c-0.79,0-1.58-0.03-2.37-0.11c-7.31-0.7-13.87-4.59-17.97-10.68l-115.95-171.7c-6.55-9.7-5.3-22.77,2.99-31.05l42.81-42.79 c5.23-5.24,12.45-7.8,19.81-7.05c7.36,0.75,13.91,4.72,17.99,10.91L1169.99,1010.16z M1153.65,1027.77 c1.95-1.95,2.27-5.04,0.75-7.35l-114.14-173.5c-1.34-2.01-3.26-2.5-4.29-2.6c-0.17-0.01-0.39-0.03-0.6-0.03 c-1.11,0-2.71,0.29-4.12,1.71l-42.81,42.81c-1.97,1.97-2.27,5.08-0.7,7.39l115.95,171.71c1.34,1.98,3.26,2.44,4.28,2.54 s3,0.01,4.69-1.68L1153.65,1027.77z" />
		<path class="role_mafia-st18" d="M1091.36,937.96c5.35,5.35,8.3,12.46,8.3,20.03c0,7.57-2.94,14.67-8.3,20.03c-5.34,5.35-12.46,8.3-20.03,8.3 c-7.57,0-14.67-2.94-20.03-8.3c-11.04-11.04-11.04-29.01,0-40.05c5.35-5.35,12.46-8.3,20.03-8.3c3.79,0,7.45,0.73,10.85,2.14 C1085.58,933.21,1088.69,935.28,1091.36,937.96z M1081,957.99c0-2.58-1-5.01-2.83-6.83s-4.25-2.83-6.83-2.83c-2.57,0-5,1-6.83,2.83 c-3.76,3.76-3.76,9.89,0,13.67c1.84,1.82,4.26,2.83,6.83,2.83c2.58,0,5.01-1,6.83-2.83C1079.99,963,1081,960.57,1081,957.99z" />
		
			<rect x="937.59" y="794.26" transform="matrix(0.7071 -0.7071 0.7071 0.7071 -301.9703 905.1235)" class="role_mafia-st13" width="8.02" height="45.62" />
		
			<rect x="918.72" y="813.13" transform="matrix(0.7071 -0.7071 0.7071 0.7071 -320.8337 897.3099)" class="role_mafia-st13" width="8.02" height="45.62" />
		<polygon class="role_mafia-st13" points="922.82,868.09 917.17,873.76 884.91,841.51 890.57,835.84 " />
		<path class="role_mafia-st13" d="M903.96,886.96l-23.86,23.86l-8.51-15.48c-6.92-12.6-6.33-27.89,0.92-39.84L903.96,886.96z" />`
    },
    role_doctor: {
      sheet: `<rect id="лист_фон" x="143" y="399" class="role_doctor-st2" width="535" height="749" />
	<rect x="389.95" y="442.72" class="role_doctor-st3" width="243.31" height="66.28" />
	<text transform="matrix(1 0 0 1.2 418.3262 508.9502)" class="role_doctor-st4 role_doctor-st5">ЛІКАР</text>
	<line class="role_doctor-st6" x1="388" y1="593" x2="628" y2="593" />
	<line class="role_doctor-st7" x1="388.5" y1="629.5" x2="628.5" y2="629.5" />
	<line class="role_doctor-st7" x1="388.5" y1="663.5" x2="628.5" y2="663.5" />
	<line class="role_doctor-st7" x1="218.5" y1="718.5" x2="629" y2="718.5" />
	<line class="role_doctor-st7" x1="479" y1="1104" x2="590" y2="1104" />
	<line class="role_doctor-st7" x1="178" y1="1002" x2="355.5" y2="1002" />
	<line class="role_doctor-st7" x1="177.5" y1="957.5" x2="628.5" y2="957.5" />
	<line class="role_doctor-st7" x1="628.5" y1="920.5" x2="177.5" y2="920.5" />
	<line class="role_doctor-st7" x1="177.5" y1="880.5" x2="628.5" y2="880.5" />
	<line class="role_doctor-st7" x1="628.5" y1="841.5" x2="177.5" y2="841.5" />
	<line class="role_doctor-st7" x1="177.5" y1="801.5" x2="628.5" y2="801.5" />
	<line class="role_doctor-st7" x1="628.5" y1="757.5" x2="177.5" y2="757.5" />
	<line class="role_doctor-st8" x1="269" y1="463" x2="269" y2="633" />
	<line class="role_doctor-st8" x1="184" y1="548" x2="354" y2="548" />`,
      hidden: `<path id="Path_192" d="M1307.73,917.54l-81.13-63.29l26.74-34.27c2.95-3.79,1.31-10-3.67-13.89l-90.14-70.33 c-4.98-3.88-11.41-3.96-14.36-0.18l-26.74,34.27l-81.13-63.29c-4.98-3.88-11.41-3.96-14.36-0.18L894.6,870.89 c-2.95,3.79-1.31,10,3.67,13.89l270.42,210.98c4.98,3.88,11.41,3.96,14.36,0.18l128.35-164.52 C1314.35,927.64,1312.71,921.42,1307.73,917.54z M1136.47,783.92l21.39-27.42l72.11,56.26l-21.39,27.42 c-11.81,15.14-37.53,14.82-57.45-0.71S1124.65,799.06,1136.47,783.92z M1170.37,1075.02L917.97,878.1l117.66-150.81l75.43,58.85 c-5.16,22.31,6.59,49.14,29.37,67.03c22.89,17.75,51.77,22.62,72.16,12.19l75.43,58.85L1170.37,1075.02z M1110.03,873.56 c11.81-15.14,5.25-40.01-14.66-55.55s-45.63-15.85-57.45-0.71c-11.81,15.14-5.25,40.01,14.66,55.55 C1072.49,888.39,1098.21,888.7,1110.03,873.56z M1063.28,859.14c-9.96-7.77-13.24-20.2-7.33-27.77c5.91-7.57,18.77-7.41,28.72,0.36 c9.96,7.77,13.24,20.2,7.33,27.77C1086.09,867.07,1073.23,866.91,1063.28,859.14z M1070.61,886.92l-36.06-28.13 c-24.89-19.42-57.04-19.82-71.81-0.89c-8.86,11.36-3.94,30.01,11,41.66l72.11,56.26c14.93,11.65,34.23,11.89,43.09,0.53 C1103.71,937.42,1095.5,906.34,1070.61,886.92z M1056.55,942.11l-72.11-56.26c-4.98-3.88-6.62-10.1-3.67-13.89 c8.86-11.36,28.15-11.12,43.09,0.53l36.06,28.13c14.93,11.65,19.86,30.3,11,41.66C1067.96,946.07,1061.53,945.99,1056.55,942.11z M1228.89,944.24c4.98,3.88,6.62,10.1,3.67,13.89c-2.95,3.79-9.38,3.71-14.36-0.18l-72.11-56.26c-4.98-3.88-6.62-10.1-3.67-13.89 c2.95-3.79,9.38-3.71,14.36,0.18L1228.89,944.24z M1200.47,999.26c-2.95,3.79-9.38,3.71-14.36-0.18l-54.08-42.2 c-4.98-3.88-6.62-10.1-3.67-13.89c2.95-3.79,9.38-3.71,14.36,0.18l54.08,42.2C1201.78,989.26,1203.42,995.47,1200.47,999.26z M1168.38,1040.39c-2.95,3.79-9.38,3.71-14.36-0.18l-54.08-42.2c-4.98-3.88-6.62-10.1-3.67-13.89c2.95-3.79,9.38-3.71,14.36,0.18 l54.08,42.2C1169.69,1030.38,1171.34,1036.6,1168.38,1040.39z" />`
    },
    role_detective: {
      sheet: `<rect id="лист_фон" x="143" y="399" class="role_detective-st2" width="535" height="749" />
	<rect x="389.95" y="442.72" class="role_detective-st3" width="243.31" height="66.28" />
	<text transform="matrix(1 0 0 1.2 394.7344 508.9502)" class="role_detective-st4 role_detective-st5">ШЕРИФ</text>
	<line class="role_detective-st6" x1="388" y1="593" x2="628" y2="593" />
	<line class="role_detective-st7" x1="388.5" y1="629.5" x2="628.5" y2="629.5" />
	<line class="role_detective-st7" x1="388.5" y1="663.5" x2="628.5" y2="663.5" />
	<line class="role_detective-st7" x1="218.5" y1="718.5" x2="629" y2="718.5" />
	<line class="role_detective-st7" x1="479" y1="1104" x2="590" y2="1104" />
	<line class="role_detective-st7" x1="178" y1="1002" x2="355.5" y2="1002" />
	<line class="role_detective-st7" x1="177.5" y1="957.5" x2="628.5" y2="957.5" />
	<line class="role_detective-st7" x1="628.5" y1="920.5" x2="177.5" y2="920.5" />
	<line class="role_detective-st7" x1="177.5" y1="880.5" x2="628.5" y2="880.5" />
	<line class="role_detective-st7" x1="628.5" y1="841.5" x2="177.5" y2="841.5" />
	<line class="role_detective-st7" x1="177.5" y1="801.5" x2="628.5" y2="801.5" />
	<line class="role_detective-st7" x1="628.5" y1="757.5" x2="177.5" y2="757.5" />
	<rect x="193" y="449.81" class="role_detective-st8" width="161" height="197.38" />
	<g>
		<path d="M328.32,585.74c-18.03-6.93-23.23-9.01-24.97-9.36c-0.35,0-1.04,0-1.39,0.35l-16.3,11.09c-0.34,0.35-0.69,0.69-0.69,1.39 c0,0.35,0,1.04,0.34,1.39l8.32,8.32l-9.36,9.36c-0.7,0.7-0.7,1.73,0,2.43l8.32,10.75l-11.44,22.89c-0.35,0.69-0.35,1.04,0,1.73 c0.35,0.34,1.04,0.69,1.39,0.69h69.35c1.04,0,1.73-0.69,1.73-1.73C354.33,637.06,356.75,596.84,328.32,585.74z" />
		<path d="M255.16,621.11l8.32-10.75c0.69-0.69,0.35-1.73,0-2.42l-9.36-9.36l8.32-8.32c0.35-0.34,0.69-1.04,0.35-1.38 c0-0.35-0.35-1.04-0.69-1.39l-16.3-11.1c-0.35-0.35-1.04-0.35-1.39-0.35c-1.39,0.35-6.59,2.43-24.96,9.36 c-28.43,11.44-26.01,51.66-25.31,59.64c0,1.04,0.69,1.73,1.73,1.73h69.35l0,0c0.69,0,1.04-0.35,1.39-0.69 c0.35-0.35,0.35-1.04,0-1.73L255.16,621.11z" />
		<path class="role_detective-st9" d="M285.67,620.76l-9.36-11.79l9.01-9.02c0.34-0.35,0.34-0.69,0.34-1.38c0-0.7-0.34-1.04-0.34-1.39l-10.06-10.05 c-0.69-0.69-1.73-0.69-2.43,0l-10.06,10.05c-0.69,0.69-0.69,1.73,0,2.43l9.02,9.01l-9.36,11.79c-0.35,0.34-0.35,1.04-0.35,1.73 l10.4,22.88c0.35,0.69,1.04,1.04,1.73,1.04c0.69,0,1.39-0.35,1.73-1.04l10.4-22.88C286.37,622.15,286.37,621.46,285.67,620.76z" />
		<path d="M309.95,517.78c-9.01-4.85-22.54-7.63-36.06-7.63c-13.52,0-27.04,2.77-36.06,7.63c-0.35,0.35-0.69,0.69-0.69,1.04 c0,0.35,0,1.04,0.35,1.39c7.63,11.79,28.09,12.14,32.25,12.14l0,0h9.01c4.16,0,24.62-0.69,32.25-12.14 c0.34-0.35,0.34-1.04,0.34-1.39C310.64,518.48,310.29,517.78,309.95,517.78z" />
		<path d="M273.89,571.18L273.89,571.18L273.89,571.18c23.23-0.34,41.95-19.07,41.95-42.3c0-0.69,0-1.73,0-2.77 c0-0.69-0.34-1.39-1.04-1.39c-0.69-0.35-1.39,0-1.73,0.35c-10.06,10.05-28.43,11.1-33.98,11.1h-9.36c-5.55,0-23.92-0.69-33.98-11.1 c-0.35-0.35-1.04-0.69-1.73-0.35c-0.69,0.35-1.04,0.69-1.04,1.39c0,1.04,0,1.73,0,2.77C231.93,552.11,250.66,570.83,273.89,571.18z " />
		<path d="M228.81,503.57c0.69,0.35,1.39,0.69,2.08,0.35c6.24-3.47,25.66-9.36,42.65-9.36c17.33,0,36.75,5.89,43,9.36 c0.34,0,0.69,0.35,0.69,0.35c0.35,0,0.69,0,1.04-0.35c4.16-3.81,7.28-6.59,8.32-7.63c0.69-0.69,0.69-1.73,0.35-2.43 c-0.35-0.35-0.69-0.69-1.04-1.39c-1.73-1.73-4.16-4.51-5.2-9.02l-0.7-2.43c-0.69-6.24-1.04-8.67-7.28-9.36h-1.73 c-6.59-0.69-16.99-1.73-25.31-9.02c-6.94-6.24-9.71-6.93-11.79-6.93c-2.08,0-4.85,0.69-11.79,6.93 c-8.32,7.28-18.72,8.32-25.31,9.02h-1.73c-6.24,0.69-6.93,3.12-7.97,9.02l-0.69,2.43c-1.04,4.51-3.47,6.93-5.2,9.02 c-0.35,0.35-0.69,1.04-1.04,1.39c-0.69,0.69-0.35,1.73,0.35,2.43C221.88,496.98,224.65,499.76,228.81,503.57z" />
		<path d="M314.11,513.62c0.35-0.35,0.69-0.69,1.04-1.39l0.69-3.47c0-0.69-0.34-1.73-1.04-1.73c-4.85-2.08-22.19-8.32-40.57-8.32 c-18.72,0-35.71,6.24-40.57,8.32c-0.69,0.35-1.04,1.04-1.04,1.73l0.69,3.47c0,0.69,0.35,1.04,1.04,1.39c0.35,0,0.35,0.35,0.69,0.35 c0.35,0,0.69,0,0.69-0.35c10.06-4.85,23.58-7.63,38.83-7.63c14.91,0,28.78,2.77,38.83,7.63 C313.07,513.62,313.76,513.62,314.11,513.62z" />`,
      hidden: `<path class="role_detective-st10" d="M1221.54,856.69l-12.13-32.8c-16.23,1.24-34.37-2.21-50.1-9.44c-15.73-7.24-30.21-18.94-39.76-31.91 c-16.06,1.18-34.37-2.21-50.1-9.44c-15.73-7.24-30.15-18.77-39.76-31.91l-32.8,12.13c0,0,12.13,32.8,1.79,55.27 s-53.48,57.06-63.82,79.52c-20.68,44.93,81.31,119.08,81.31,119.08s122.66,29.22,143.34-15.71c10.34-22.47,8.55-77.73,18.89-100.2 C1188.74,868.82,1221.54,856.69,1221.54,856.69 M1079.12,960.62l-24.98-36.81l-44.1,5.02l27.3-35.08l-18.46-40.34l41.82,15.02 l32.67-29.88l-1.28,44.19l38.61,21.99l-42.65,12.23L1079.12,960.62z" />
	<path class="role_detective-st11" d="M1294.74,837.03l-17.78-48.1c-23.79,1.83-50.4-3.23-73.46-13.84s-44.3-27.77-58.3-46.78 c-23.55,1.74-50.4-3.23-73.46-13.84c-23.06-10.61-44.21-27.53-58.3-46.78l-48.1,17.78c0,0,17.78,48.1,2.62,81.03 c-15.16,32.94-78.41,83.66-93.57,116.6c-30.31,65.88,119.22,174.6,119.22,174.6s179.85,42.85,210.16-23.03 c15.16-32.94,12.53-113.97,27.69-146.91C1246.64,854.81,1294.74,837.03,1294.74,837.03 M1085.92,989.4l-36.63-53.97l-64.66,7.37 l40.03-51.43l-27.06-59.15l61.31,22.03l47.9-43.81l-1.88,64.79l56.61,32.24l-62.53,17.92L1085.92,989.4z" />
	<path class="role_detective-st12" d="M1145.23,728.34c-13.85,0.79-42.47,0.55-74.23-14.15c-31.33-14.51-49.89-35.77-58.3-46.78 c-15.57,5.86-31.14,11.73-46.7,17.59c13.29,40.03,8.08,65.55,1.23,81.22C951.59,802.02,924.7,815.78,886,863 c-4.25,5.19-13.28,16.76-16.11,33.54c0,0-0.43,2.53-0.64,5.06c-3.23,38.47,28.32,69.82,68.73,108.89 c13.26,12.82,31.89,29.35,55.57,47.22 M1105.94,810.99l0.68-0.63 M1049.79,935.64c-21.78,2.37-43.57,4.73-65.35,7.1l40.03-51.43 l-27.06-59.15l61.31,22.03c16.09-14.31,32.17-28.61,48.26-42.92 M1145.01,728.25`
    },
    role_civilian: {
      sheet: `<rect id="лист_фон" x="143" y="399" class="role_civilian-st2" width="535" height="749" />
	<rect x="154" y="407" class="role_civilian-st3" width="512.72" height="84" />
	<text transform="matrix(1 0 0 1.2 222.2183 490.9502)" class="role_civilian-st4 role_civilian-st5">ЦИВІЛЬНИЙ</text>
	<line class="role_civilian-st6" x1="388" y1="593" x2="628" y2="593" />
	<line class="role_civilian-st7" x1="322.5" y1="629.5" x2="628.5" y2="629.5" />
	<line class="role_civilian-st7" x1="322.5" y1="663.5" x2="628.5" y2="663.5" />
	<line class="role_civilian-st7" x1="245.5" y1="718.5" x2="629" y2="718.5" />
	<line class="role_civilian-st7" x1="479" y1="1104" x2="590" y2="1104" />
	<line class="role_civilian-st7" x1="238.5" y1="920.5" x2="177.5" y2="920.5" />
	<line class="role_civilian-st7" x1="177.5" y1="880.5" x2="628.5" y2="880.5" />
	<line class="role_civilian-st7" x1="628.5" y1="841.5" x2="177.5" y2="841.5" />
	<line class="role_civilian-st7" x1="177.5" y1="801.5" x2="628.5" y2="801.5" />
	<line class="role_civilian-st7" x1="628.5" y1="757.5" x2="177.5" y2="757.5" />`,
      hidden: ``
    }
  };

  const STYLE_ID = "mafia-role-reveal-styles";
  const CSS = `
.rr-stage-wrap {
  width: min(92vw, 380px);
  aspect-ratio: 1500 / 900;
  position: relative;
  margin: 12px auto 8px;
  perspective: 1600px;
  overflow: visible;
}
.rr-stage-svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.rr-stage-inner { transform-style: preserve-3d; transform: translateY(140%); transition: none; }
.rr-sheet-face, .rr-hidden-content, .rr-sheet-hinge, .rr-sheet-bulge { transform-box: view-box; }
.rr-sheet-hinge { transform-style: preserve-3d; transform-origin: 749px 773.5px; transition: none; }
.rr-sheet-bulge { transform-style: preserve-3d; transform-origin: 820px 773.5px; transition: none; }
.rr-sheet-face { backface-visibility: hidden; -webkit-backface-visibility: hidden; }
#rrSheetFront { visibility: visible; }
#rrSheetBack { visibility: hidden; transform: rotateY(180deg); transform-origin: 749px 773.5px; }
.rr-don-tag {
  display: none; text-align: center; font-size: 12px; color: var(--accent, #d9b45c);
  background: rgba(0,0,0,0.6); padding: 3px 10px; border-radius: 8px;
  margin: 0 auto; width: fit-content; font-family: 'Space Grotesk', sans-serif; font-weight: 700;
}
.rr-don-tag.visible { display: block; }

/* card_back */
.card_back-st0{fill:#E5CFAE;stroke:#000000;stroke-width:2;stroke-miterlimit:10;}
.card_back-st1{fill:#FFFFEF;stroke:#000000;stroke-miterlimit:10;}
.card_back-st4{fill:none;}
.card_back-st5{fill:#FF0000;}
.card_back-st6{font-family:'Candara';}
.card_back-st7{font-size:71px;}
.card_back-st8{fill:none;stroke:#FF0000;stroke-width:3;stroke-miterlimit:10;}
/* role_mafia */
.role_mafia-st3{fill:#FFFFEF;}
.role_mafia-st4{fill:none;}
.role_mafia-st6{font-family:'Candara';}
.role_mafia-st7{font-size:71px;}
.role_mafia-st9{fill:#F9F9F9;}
.role_mafia-st10{stroke:#000000;stroke-width:27;stroke-miterlimit:10;}
.role_mafia-st11{fill:none;stroke:#000000;stroke-width:27;stroke-miterlimit:10;}
.role_mafia-st12{fill:#A3A3A3;}
.role_mafia-st13{fill:#808080;}
.role_mafia-st14{fill:#42210B;}
.role_mafia-st15{fill:#603813;}
.role_mafia-st16{fill:#4D4D4D;}
.role_mafia-st17{fill:#666666;}
.role_mafia-st18{fill:#333333;}
.role_mafia-st19{stroke:#000000;stroke-miterlimit:10;}
/* role_doctor */
.role_doctor-st2{fill:#FFFFEF;}
.role_doctor-st3{fill:none;}
.role_doctor-st4{font-family:'Candara';}
.role_doctor-st5{font-size:71px;}
.role_doctor-st6{stroke:#000000;stroke-width:27;stroke-miterlimit:10;}
.role_doctor-st7{fill:none;stroke:#000000;stroke-width:27;stroke-miterlimit:10;}
.role_doctor-st8{fill:none;stroke:#FF0000;stroke-width:20;stroke-linecap:round;stroke-miterlimit:10;}
/* role_detective */
.role_detective-st2{fill:#FFFFEF;}
.role_detective-st3{fill:none;}
.role_detective-st4{font-family:'Candara';}
.role_detective-st5{font-size:71px;}
.role_detective-st6{stroke:#000000;stroke-width:27;stroke-miterlimit:10;}
.role_detective-st7{fill:none;stroke:#000000;stroke-width:27;stroke-miterlimit:10;}
.role_detective-st8{fill:#A3A3A3;}
.role_detective-st9{fill:#134364;}
.role_detective-st10{fill:#666666;}
.role_detective-st11{fill:#C1C12B;}
.role_detective-st12{fill:#D3DB3B;}
/* role_civilian */
.role_civilian-st2{fill:#FFFFEF;}
.role_civilian-st3{fill:none;}
.role_civilian-st4{font-family:'Candara';}
.role_civilian-st5{font-size:71px;}
.role_civilian-st6{stroke:#000000;stroke-width:27;stroke-miterlimit:10;}
.role_civilian-st7{fill:none;stroke:#000000;stroke-width:27;stroke-miterlimit:10;}
`;

  const STAGE_HTML = `
<svg class="rr-stage-svg" viewBox="0 0 1500 1500">
  <g class="rr-stage-inner" id="rrStageInner">
    <g class="card-frame">
      <path class="card_back-st0" d="M109.26,943.52h598.85 c23.19,0,42-18.8,42-42V73.9c0-11.6-4.7-22.1-12.3-29.7c0,0-10.27-10.28-29.7-12.3c-23.39-2.43-284.37-2.44-640.85,0 c-6.88,2.71-19.03,8.58-30.1,20.64c-13.9,15.16-18.28,31.59-19.78,39.05c0,63.81,0,127.62,0,191.44c0.03,6.9,0.98,31.67,19.78,52.46 c10.8,11.94,23.01,17.62,30.1,20.25c0,181.93,0,363.85,0,545.78C67.27,924.71,86.07,943.52,109.26,943.52z" />
      <path class="card_back-st0" d="M1391.12,943.27H792.27c-23.19,0-42-18.8-42-42V73.66c0-11.6,4.7-22.1,12.3-29.7 c0,0,10.27-10.28,29.7-12.3c23.39-2.43,284.37-2.44,640.85,0c6.88,2.71,19.03,8.58,30.1,20.64c13.9,15.16,18.28,31.59,19.78,39.05 c0,63.81,0,127.62,0,191.44c-0.03,6.9-0.98,31.67-19.78,52.46c-10.8,11.94-23.01,17.62-30.1,20.25c0,181.93,0,363.85,0,545.78 C1433.12,924.47,1414.32,943.27,1391.12,943.27z" />
    </g>
    <g class="hidden-item" id="rrHiddenItem"></g>
    <g class="rr-sheet-hinge" id="rrSheetHinge">
      <g class="rr-sheet-bulge" id="rrSheetBulge">
        <g class="rr-sheet-face" id="rrSheetFront">
          <rect x="820" y="107" class="card_back-st1" width="535" height="749" />
          <rect x="856" y="444" class="card_back-st4" width="463" height="74" />
          <text transform="matrix(1 0 0 1 859.9043 505.4922)" class="card_back-st5 card_back-st6 card_back-st7">CONFIDENTIAL</text>
          <rect x="856.5" y="444.5" class="card_back-st8" width="462" height="74" />
        </g>
        <g class="rr-sheet-face" id="rrSheetBack"></g>
      </g>
    </g>
    <g class="card-clip">
      <path class="card_back-st2" style="fill:none;stroke:#000000;stroke-width:3;stroke-linejoin:round;stroke-miterlimit:10;" d="M846.5,30.5 c-0.88-8.44,8.08-16.42,18.07-17c11.02-0.64,21.75,7.6,20.93,17c0,41.63,0.27,82.31,0.27,123.94c0.45,9.3-9.91,17.03-22.34,17.25 c-12.95,0.23-24.09-7.77-23.47-17.45c0-31.21,0-62.42,0-93.63" />
    </g>
  </g>
</svg>
<div class="rr-don-tag" id="rrDonTag">Дон мафії</div>`;

  function bezierEase(x1, y1, x2, y2) {
    function sample(t, p1, p2) {
      const c = 3 * p1, b = 3 * (p2 - p1) - c, a = 1 - c - b;
      return ((a * t + b) * t + c) * t;
    }
    function sampleDerivative(t, p1, p2) {
      const c = 3 * p1, b = 3 * (p2 - p1) - c, a = 1 - c - b;
      return (3 * a * t + 2 * b) * t + c;
    }
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 8; i++) {
        const d = sampleDerivative(t, x1, x2);
        if (Math.abs(d) < 1e-6) break;
        t -= (sample(t, x1, x2) - x) / d;
      }
      return sample(t, y1, y2);
    };
  }
  function buildSpeedEase(speedPoints, samples) {
    samples = samples || 400;
    const n = speedPoints.length - 1;
    function speedAt(t) {
      const scaled = clamp01(t) * n;
      const i = Math.min(n - 1, Math.floor(scaled));
      const local = scaled - i;
      const p0 = speedPoints[Math.max(0, i - 1)];
      const p1 = speedPoints[i];
      const p2 = speedPoints[Math.min(n, i + 1)];
      const p3 = speedPoints[Math.min(n, i + 2)];
      const t2 = local * local, t3 = t2 * local;
      return 0.5 * (
        (2 * p1) +
        (-p0 + p2) * local +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t3
      );
    }
    const pos = new Float64Array(samples + 1);
    const dt = 1 / samples;
    let acc = 0;
    let prevV = Math.max(0, speedAt(0));
    for (let i = 1; i <= samples; i++) {
      const v = Math.max(0, speedAt(i * dt));
      acc += (v + prevV) / 2 * dt;
      pos[i] = acc;
      prevV = v;
    }
    const total = pos[samples];
    for (let i = 0; i <= samples; i++) pos[i] /= total;

    return function ease(x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      const idx = x * samples;
      const i0 = Math.floor(idx);
      const i1 = Math.min(samples, i0 + 1);
      const frac = idx - i0;
      return pos[i0] * (1 - frac) + pos[i1] * frac;
    };
  }
  const slideEase = bezierEase(.2, .8, .2, 1);
  const flipEase = buildSpeedEase([20, 40, 100, 60, 20, 60, 100, 40, 20]);

  function clamp01(x) { return Math.max(0, Math.min(1, x)); }

  let els = null; // DOM-рефи після mount()
  let animRaf = null;
  let currentRoleKey = null;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function mount(container) {
    ensureStyles();
    container.innerHTML = STAGE_HTML;
    els = {
      stageInner: container.querySelector("#rrStageInner"),
      sheetHinge: container.querySelector("#rrSheetHinge"),
      sheetBulge: container.querySelector("#rrSheetBulge"),
      sheetFront: container.querySelector("#rrSheetFront"),
      sheetBack: container.querySelector("#rrSheetBack"),
      hiddenItem: container.querySelector("#rrHiddenItem"),
      donTag: container.querySelector("#rrDonTag"),
    };
    resetStage();
  }

  function loadRoleContent(roleKey) {
    const data = ROLE_DATA[roleKey] || ROLE_DATA.role_civilian;
    els.sheetBack.innerHTML = `<g transform="translate(0,${CONTENT_Y_OFFSET})">${data.sheet}</g>`;
    els.hiddenItem.innerHTML = `<g transform="translate(0,${CONTENT_Y_OFFSET})">${data.hidden}</g>`;
  }

  function stopAnim() {
    if (animRaf != null) { cancelAnimationFrame(animRaf); animRaf = null; }
  }

  function applyExactFrame(t) {
    const slideT = slideEase(clamp01(t / SLIDE));
    els.stageInner.style.transform = `translateY(${(1 - slideT) * 140}%)`;

    const flipRaw = clamp01((t - SLIDE - PAUSE) / FLIP);
    const flipAngle = flipEase(flipRaw) * 180;
    els.sheetHinge.style.transform = `rotateY(${flipAngle}deg)`;

    const BULGE_MAX = 0.07;
    const bulge = 1 + BULGE_MAX * Math.sin(Math.PI * flipRaw);
    els.sheetBulge.style.transform = `scaleX(${bulge})`;

    const showBack = flipRaw >= 0.5;
    els.sheetFront.style.visibility = showBack ? "hidden" : "visible";
    els.sheetBack.style.visibility = showBack ? "visible" : "hidden";
  }

  function resetStage() {
    if (!els) return;
    applyExactFrame(0);
  }

  // role: "mafia"|"doctor"|"sheriff"|"civilian" (ігрові ключі ROLE_META).
  // opts: { isDon, onDone }
  function play(role, opts) {
    opts = opts || {};
    if (!els) throw new Error("MafiaRoleReveal.play() called before mount()");
    stopAnim();
    currentRoleKey = ROLE_KEY_MAP[role] || "role_civilian";
    loadRoleContent(currentRoleKey);
    els.donTag.classList.toggle("visible", !!(opts.isDon && role === "mafia"));
    resetStage();

    const startedAt = performance.now();
    function tick(now) {
      const t = Math.min(TOTAL, now - startedAt);
      applyExactFrame(t);
      if (t < TOTAL) {
        animRaf = requestAnimationFrame(tick);
      } else {
        animRaf = null;
        if (typeof opts.onDone === "function") opts.onDone();
      }
    }
    animRaf = requestAnimationFrame(tick);
  }

  window.MafiaRoleReveal = { mount, play, DURATION_MS: TOTAL };
})();
