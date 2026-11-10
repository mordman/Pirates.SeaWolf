#!/usr/bin/env python3
"""Task 39: вставить закрытие экрана создания капитана в старые e2e-тесты.
Экран открывается в начале игры (и после reload) и блокирует КЛАВИАТУРУ
(uiOpen) — сценарии, которые жмут клавиши (v38/v54b), обязаны его закрыть.
"""
import re

DISMISS = """// Task 39: экран создания капитана открывается В НАЧАЛЕ — закрыть
// («Позже», без применения): он блокирует клавиатуру (uiOpen)
await sleep(1200);
ev(`(() => { const scr = document.querySelector('[data-char-screen]'); if (scr) { const b = [...scr.querySelectorAll('button')].find(b => b.textContent.includes('Позже')); if (b) b.click(); return 'char-closed'; } return 'no-screen'; })()`);
await sleep(900);
"""


def patch(path, anchors):
    with open(path, encoding='utf-8') as f:
        src = f.read()
    if 'char-screen' in src:
        print(f'{path}: already patched')
        return
    n = 0
    for anchor in anchors:
        # вставка ПОСЛЕ строки-якоря
        idx = 0
        while True:
            i = src.find(anchor, idx)
            if i < 0:
                break
            end = src.find('\n', i) + 1
            src = src[:end] + DISMISS + src[end:]
            idx = end + len(DISMISS)
            n += 1
    with open(path, 'w', encoding='utf-8') as f:
        f.write(src)
    print(f'{path}: вставлено {n} блоков')


patch('scripts/e2e_v38.mjs', ["run('reload');\nawait sleep(9000);"])
patch('scripts/e2e_v53.mjs', [
    "ev(`window.__jsErrors = []; window.addEventListener('error', e => window.__jsErrors.push(String(e.message))); 'ok'`);",
    "ev(`window.__jsErrors = []; window.addEventListener('error', e => window.__jsErrors.push(String(e.message))); 'rearmed'`);",
])
patch('scripts/e2e_v54b.mjs', [
    "ev(`window.__jsErrors = []; window.addEventListener('error', e => window.__jsErrors.push(String(e.message))); 'ok'`);",
])
patch('scripts/e2e_v54c.mjs', [
    "ev(`window.__game.start()`);",
    "ev(`window.__jsErrors = []; window.addEventListener('error', e => window.__jsErrors.push(String(e.message))); 'ok'`);",
])
patch('scripts/e2e_v55.mjs', [
    "ev(`window.__jsErrors = []; window.addEventListener('error', e => window.__jsErrors.push(String(e.message))); 'ok'`);",
])
