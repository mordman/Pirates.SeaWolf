import type { PlayerAppearance } from '../core/settings';
import { APPEARANCE_SKIN, APPEARANCE_SHIRT, APPEARANCE_PANTS,
  HEADWEAR_KINDS, TORSO_KINDS, PANTS_KINDS } from '../core/settings';
import type { Traits } from '../ship/crew';

// ============================================================
// ВНЕШНОСТЬ КАПИТАНА (Task 39): экран создания персонажа в начале
// игры хранит выбор в настройках (settings.player), а здесь он
// превращается вTraits фигурки (crew.buildFigure) — тот же
// процедурный «человечек», что и вся команда, но с ВЫБРАННЫМИ
// одеждой/головным убором/бородой/повязкой/попугаем/протезами.
// Task 42: гардероб — торс (8 видов), крой штанов (3 вида),
// головной убор (7 видов).
// ============================================================

/** Настройки внешности → признаки процедурной фигурки.
 *  Крюк и деревянная нога — правые (side +1). */
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
    torso: a.torso,
    pantsKind: a.pantsKind,
    height: 1,
    parrot: a.parrot,
    bald: false,           // Task 50: у капитана игрока волосы всегда есть
  };
}

/** Случайный моряк для кнопки «Наугад» на экране создания */
export function randomAppearance(rnd: () => number): PlayerAppearance {
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
  return {
    skin: pick(APPEARANCE_SKIN),
    shirt: pick(APPEARANCE_SHIRT),
    pants: pick(APPEARANCE_PANTS),
    headwear: pick(HEADWEAR_KINDS),
    torso: pick(TORSO_KINDS),
    pantsKind: pick(PANTS_KINDS),
    beard: rnd() < 0.6 ? (rnd() < 0.5 ? 2 : 1) : 0,
    eyePatch: rnd() < 0.3,
    parrot: rnd() < 0.5,
    pegLeg: rnd() < 0.25,
    hook: rnd() < 0.25,
  };
}
