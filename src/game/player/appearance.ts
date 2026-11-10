import type { PlayerAppearance } from '../core/settings';
import { APPEARANCE_SKIN, APPEARANCE_SHIRT, APPEARANCE_PANTS } from '../core/settings';
import type { Traits } from '../ship/crew';

// ============================================================
// ВНЕШНОСТЬ КАПИТАНА (Task 39): экран создания персонажа в начале
// игры хранит выбор в настройках (settings.player), а здесь он
// превращается вTraits фигурки (crew.buildFigure) — тот же
// процедурный «человечек», что и вся команда, но с ВЫБРАННЫМИ
// одеждой/головным убором/бородой/повязкой/попугаем/протезами.
// ============================================================

/** Настройки внешности → признаки процедурной фигурки.
 *  Крюк и деревянная нога — правые (side +1); тельняшку капитан
 *  не носит (кафтан будет у ролей-офицеров, игрок — ходок). */
export function appearanceToTraits(a: PlayerAppearance): Traits {
  return {
    skin: a.skin,
    shirt: a.shirt,
    pants: a.pants,
    beard: a.beard,
    hook: a.hook ? 1 : 0,
    pegLeg: a.pegLeg ? 1 : 0,
    eyePatch: a.eyePatch,
    headwear: a.headwear,
    striped: false,
    height: 1,
    parrot: a.parrot,
  };
}

/** Случайный моряк для кнопки «Наугад» на экране создания */
export function randomAppearance(rnd: () => number): PlayerAppearance {
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
  return {
    skin: pick(APPEARANCE_SKIN),
    shirt: pick(APPEARANCE_SHIRT),
    pants: pick(APPEARANCE_PANTS),
    headwear: rnd() < 0.5 ? 'bandana' : rnd() < 0.5 ? 'hat' : 'none',
    beard: rnd() < 0.6 ? (rnd() < 0.5 ? 2 : 1) : 0,
    eyePatch: rnd() < 0.3,
    parrot: rnd() < 0.5,
    pegLeg: rnd() < 0.25,
    hook: rnd() < 0.25,
  };
}
