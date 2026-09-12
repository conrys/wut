// Гра: Зіпсований телефон  |  Файл: public/draw-canvas.js
// Уніфікований модуль малювання на canvas — спільний для Крокодила/Галереї (drawer)
// і Зіпсованого телефону. Координати нормалізовані (0..1) відносно фіксованого логічного
// розміру, тому штрихи однаково лягають на будь-якому екрані незалежно від того, як CSS
// масштабує сам canvas — це заразом усуває стару проблему "canvas 0x0 одразу після показу".
//
// Підтримує колір, товщину, ластик, live-трансляцію штрихів (onStroke/addStroke) та
// скасування останнього штриха: кожен безперервний рух пальця (pointerdown..pointerup)
// має свій strokeId, і "скасувати" прибирає ВЕСЬ цей штрих (усі його сегменти), а не піксель.
function createDrawCanvas(canvas, { readOnly = false, onStroke } = {}) {
  const W = 600, H = 450;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  let currentColor = '#1a1a1a';
  let currentWidth = 6;
  let eraserOn = false;
  let history = []; // усі сегменти з початку малювання (кожен позначений strokeId) — для скасування й перемальовки

  function clearCanvas() {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
  }
  clearCanvas();

  function drawSegment(x0, y0, x1, y1, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x0 * W, y0 * H);
    ctx.lineTo(x1 * W, y1 * H);
    ctx.stroke();
  }

  function redrawFromHistory() {
    clearCanvas();
    history.forEach((s) => drawSegment(s.x0, s.y0, s.x1, s.y1, s.color, s.width));
  }

  function activeColor() { return eraserOn ? '#ffffff' : currentColor; }
  function activeWidth() { return eraserOn ? currentWidth * 3 : currentWidth; }

  let drawing = false;
  let last = null;
  let currentStrokeId = null;

  function pointFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  }

  function emitAndDraw(x0, y0, x1, y1, color, width, strokeId) {
    drawSegment(x0, y0, x1, y1, color, width);
    const seg = { x0, y0, x1, y1, color, width, strokeId };
    history.push(seg);
    if (onStroke) onStroke(seg);
  }

  if (!readOnly) {
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => {
      drawing = true;
      last = pointFromEvent(e);
      currentStrokeId = 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      canvas.setPointerCapture(e.pointerId);
      const color = activeColor(); const width = activeWidth();
      // крапка одним тапом
      emitAndDraw(last.x, last.y, last.x + 0.0001, last.y + 0.0001, color, width, currentStrokeId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = pointFromEvent(e);
      const color = activeColor(); const width = activeWidth();
      emitAndDraw(last.x, last.y, p.x, p.y, color, width, currentStrokeId);
      last = p;
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => canvas.addEventListener(ev, () => {
      drawing = false; last = null; currentStrokeId = null;
    }));
  }

  return {
    clear: () => { history = []; clearCanvas(); },
    addStroke: (s) => { history.push(s); drawSegment(s.x0, s.y0, s.x1, s.y1, s.color || '#1a1a1a', s.width || 6); },
    // прибирає ВЕСЬ штрих (усі сегменти одного pointerdown..pointerup) за його strokeId і перемальовує решту.
    // Використовується для застосування "скасування", яке прийшло від сервера/іншого клієнта.
    removeStroke: (strokeId) => {
      if (!strokeId) return;
      const before = history.length;
      history = history.filter((s) => s.strokeId !== strokeId);
      if (history.length !== before) redrawFromHistory();
    },
    // скасовує ОСТАННІЙ штрих локально; повертає його strokeId (щоб викликач міг синхронізувати
    // мережею — напр. повідомити сервер, аби інші глядачі теж побачили скасування), або null,
    // якщо скасовувати нічого (порожньо, або останній сегмент прийшов ззовні без strokeId).
    undo: () => {
      if (history.length === 0) return null;
      const lastStrokeId = history[history.length - 1].strokeId;
      if (!lastStrokeId) return null;
      history = history.filter((s) => s.strokeId !== lastStrokeId);
      redrawFromHistory();
      return lastStrokeId;
    },
    exportImage: () => canvas.toDataURL('image/png'),
    loadStrokes: (arr) => { history = [...(arr || [])]; redrawFromHistory(); },
    setColor: (c) => { currentColor = c; eraserOn = false; },
    setWidth: (w) => { currentWidth = w; },
    setEraser: (v) => { eraserOn = v; },
    isEraser: () => eraserOn,
    getColor: () => currentColor,
  };
}
window.createDrawCanvas = createDrawCanvas;
