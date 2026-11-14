// Менеджер ввода: клавиатура + мышь (позиция, кнопки, колесо)
// Task 50: ПЕРЕХВАТ МЫШИ (pointer lock) — клик по канвасу захватывает
// курсор: мышь крутит камеру без зажатия ПКМ, ESC возвращает курсор
export class InputManager {
  keys = new Set<string>();
  justPressed = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  mouseDX = 0;
  mouseDY = 0;
  wheelDelta = 0;
  lmb = false;
  rmb = false;
  lmbJust = false;
  rmbJust = false;
  /** курсор ЗАХВАЧЕН (pointer lock активен) */
  pointerLocked = false;
  /** настройка controls.mouseCapture — разрешён ли перехват */
  private captureEnabled = false;
  private el: HTMLElement;
  private handlers: Array<[string, EventListener, EventTarget]> = [];
  private preventCodes = new Set<string>(['Tab', 'Space', 'KeyF', 'KeyE', 'KeyQ', 'KeyR', 'KeyC']);

  /** Включить/выключить перехват мыши (настройка «Управление») */
  setMouseCapture(on: boolean) {
    this.captureEnabled = on;
    if (!on && this.pointerLocked && document.pointerLockElement) {
      try { document.exitPointerLock(); } catch { /* ignore */ }
    }
  }

  /** Захватить курсор (клик по канвасу); в headless/без жеста —
   *  запрос может быть отклонён — это не ошибка */
  requestLock() {
    if (this.captureEnabled || this.pointerLocked) {
      if (!this.pointerLocked && this.el.requestPointerLock) {
        try {
          const r = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
          if (r && typeof r.catch === 'function') r.catch(() => { /* отказ — играем как раньше */ });
        } catch { /* ignore */ }
      }
    }
  }

  /** Освободить курсор (панели/диалоги поверх игры) */
  releaseLock() {
    if (this.pointerLocked && document.pointerLockElement) {
      try { document.exitPointerLock(); } catch { /* ignore */ }
    }
  }

  /** Обновить набор клавиш, которые не должен съедать браузер (из настроек) */
  setPreventCodes(codes: Set<string>) {
    this.preventCodes = codes;
  }

  constructor(el: HTMLElement) {
    this.el = el;
    const bind = (target: EventTarget, type: string, fn: EventListener) => {
      target.addEventListener(type, fn);
      this.handlers.push([type, fn, target]);
    };
    bind(window, 'keydown', (e) => {
      const ev = e as KeyboardEvent;
      if (ev.repeat) return;
      const code = ev.code;
      this.keys.add(code);
      this.justPressed.add(code);
      if (this.preventCodes.has(code)) ev.preventDefault();
    });
    bind(window, 'keyup', (e) => this.keys.delete((e as KeyboardEvent).code));
    // Task 40 ФИКС «не стреляет при прицеливании»: pointerdown по
    // спецификации Pointer Events срабатывает ТОЛЬКО при переходе
    // из «нет кнопок» в «есть кнопки» — нажатие ЛКМ при УЖЕ
    // зажатом ПКМ (прицел пистолета) не даёт события, выстрел был
    // невозможен. mousedown/mouseup срабатывают на КАЖДУЮ кнопку —
    // дублируем обработку (boolean-флаги идемпотентны; synthetic
    // pointerdown из E2E продолжает работать).
    bind(window, 'mousedown', (e) => {
      const ev = e as MouseEvent;
      this.mouseX = ev.clientX; this.mouseY = ev.clientY;
      if (ev.button === 0) { this.lmb = true; this.lmbJust = true; }
      if (ev.button === 2) { this.rmb = true; this.rmbJust = true; }
    });
    bind(window, 'mouseup', (e) => {
      const ev = e as MouseEvent;
      if (ev.button === 0) this.lmb = false;
      if (ev.button === 2) this.rmb = false;
    });
    bind(el, 'pointerdown', (e) => {
      const ev = e as PointerEvent;
      this.mouseX = ev.clientX; this.mouseY = ev.clientY;
      if (ev.button === 0) { this.lmb = true; this.lmbJust = true; }
      if (ev.button === 2) { this.rmb = true; this.rmbJust = true; }
      // Task 50: ЛКМ по канвасу — захватить курсор (если разрешено)
      if (ev.button === 0 && ev.target === el) this.requestLock();
    });
    bind(window, 'pointermove', (e) => {
      const ev = e as PointerEvent;
      if (this.pointerLocked) {
        // курсор скрыт: считаем ДЕЛЬТЫ движения (movementX/Y), позиция
        // не меняется — UI-прицеливание в этом режиме не работает
        this.mouseDX += ev.movementX || 0;
        this.mouseDY += ev.movementY || 0;
        return;
      }
      this.mouseDX += ev.clientX - this.mouseX;
      this.mouseDY += ev.clientY - this.mouseY;
      this.mouseX = ev.clientX; this.mouseY = ev.clientY;
    });
    // Task 50: вход/выход pointer lock (ESC освобождает курсор сам)
    bind(document, 'pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.el;
    });
    bind(el, 'wheel', (e) => {
      const ev = e as WheelEvent;
      this.wheelDelta += ev.deltaY;
      ev.preventDefault();
    }, );
    bind(el, 'contextmenu', (e) => e.preventDefault());
    bind(window, 'blur', () => { this.keys.clear(); this.lmb = false; this.rmb = false; });
  }

  isDown(code: string): boolean { return this.keys.has(code); }
  pressed(code: string): boolean { return this.justPressed.has(code); }

  /** Вызывается в конце кадра — сброс one-shot состояний */
  endFrame() {
    this.justPressed.clear();
    this.mouseDX = 0; this.mouseDY = 0; this.wheelDelta = 0;
    this.lmbJust = false; this.rmbJust = false;
  }

  dispose() {
    for (const [type, fn, target] of this.handlers) target.removeEventListener(type, fn);
    this.handlers = [];
  }
}
