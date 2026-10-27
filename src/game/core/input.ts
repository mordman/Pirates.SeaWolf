// Менеджер ввода: клавиатура + мышь (позиция, кнопки, колесо)
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
  private el: HTMLElement;
  private handlers: Array<[string, EventListener, EventTarget]> = [];
  private preventCodes = new Set<string>(['Tab', 'Space', 'KeyF', 'KeyE', 'KeyQ', 'KeyR', 'KeyC']);

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
    bind(el, 'pointerdown', (e) => {
      const ev = e as PointerEvent;
      this.mouseX = ev.clientX; this.mouseY = ev.clientY;
      if (ev.button === 0) { this.lmb = true; this.lmbJust = true; }
      if (ev.button === 2) { this.rmb = true; this.rmbJust = true; }
    });
    bind(window, 'pointerup', (e) => {
      const ev = e as PointerEvent;
      if (ev.button === 0) this.lmb = false;
      if (ev.button === 2) this.rmb = false;
    });
    bind(window, 'pointermove', (e) => {
      const ev = e as PointerEvent;
      this.mouseDX += ev.clientX - this.mouseX;
      this.mouseDY += ev.clientY - this.mouseY;
      this.mouseX = ev.clientX; this.mouseY = ev.clientY;
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
