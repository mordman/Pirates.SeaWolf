// ============================================================
// ПЛАВУЧЕСТЬ: единый конфиг всех судов (Task 33, «настройки
// плавучести по новой»). Прежние три модели моря с их пружинами/
// замерами/посадками УДАЛЕНЫ — остались только настройки, общие
// для обеих физик (реалистичной и простой):
//   • пределы крена/дифферента (стопы и кромки);
//   • осадка ± и посадка шлюпки;
//   • ЗАЛИВАНИЕ ПАЛУБЫ → СМЫВ МАТРОСА с настраиваемой
//     вероятностью (по умолчанию 30%) и паузой.
// ============================================================

export interface BuoyancyConfig {
  /** предел СТАТИЧЕСКОГО крена, рад (ветер/поворот/затопление) */
  heelMax: number;
  /** предел дифферента, рад */
  pitchMax: number;
  /** осадка глубже(+)/мельче(−), м — реалистичная модель
   *  перекалибровкой гидростатики, простая — сдвигом посадки */
  draftOffset: number;
  /** множитель осадки шлюпки-яла */
  boatDraftMul: number;
  /** скорость сглаживания посадки шлюпки на волны, 1/с */
  boatSmooth: number;
  /** вероятность смыва матроса за борт при глубоком заливании
   *  палубы (>0.15 м воды над кромкой — волна по палубе), 0..1 —
   *  НАСТРОЙКА «залитие палубы может смыть моряков (30%)» */
  washProbability: number;
  /** пауза между БРОСКАМИ на смыв, с (кулдаун механики) */
  washCooldown: number;
}

/** дефолты = выверенные значения прежних моделей (поведение по
 *  умолчанию не меняется), вероятность смыва — 30% по ТЗ */
export const BUOYANCY_CONFIG: BuoyancyConfig = {
  heelMax: 0.36,          // 20.6°
  pitchMax: 0.42,         // 24.1°
  draftOffset: 0,
  boatDraftMul: 1,
  boatSmooth: 13,
  washProbability: 0.30,
  washCooldown: 8,
};

/** Применить настройки (панель → конфиг): новые экземпляры судов
 *  берут его при создании, живые — читают напрямую каждый шаг */
export function applyBuoyancyConfig(src: Partial<BuoyancyConfig>) {
  if (typeof src.heelMax === 'number') BUOYANCY_CONFIG.heelMax = src.heelMax;
  if (typeof src.pitchMax === 'number') BUOYANCY_CONFIG.pitchMax = src.pitchMax;
  if (typeof src.draftOffset === 'number') BUOYANCY_CONFIG.draftOffset = src.draftOffset;
  if (typeof src.boatDraftMul === 'number') BUOYANCY_CONFIG.boatDraftMul = src.boatDraftMul;
  if (typeof src.boatSmooth === 'number') BUOYANCY_CONFIG.boatSmooth = src.boatSmooth;
  if (typeof src.washProbability === 'number') BUOYANCY_CONFIG.washProbability = src.washProbability;
  if (typeof src.washCooldown === 'number') BUOYANCY_CONFIG.washCooldown = src.washCooldown;
}

// ============================================================
// РЕЖИМ ФИЗИКИ: «реалистичная» (Архимед по точкам корпуса —
// корабль режет волны носом, кренят моменты) и «простая»
// (корабль скользит ПО поверхности — нос всходит на гребень и
// спускается, глубоких нырков нет). Выбор — в настройках.
// ============================================================
export type PhysicsMode = 'realistic' | 'simple';

/** активный режим (Game применяет из настроек; Ship/launch читают) */
export const PHYSICS: { mode: PhysicsMode } = { mode: 'realistic' };

/** УПРОЩЁННОЕ УПРАВЛЕНИЕ (настройка): руль работает на любой
 *  скорости, паруса тянут одинаково при любом курсе к ветру —
 *  аркада вместо парусных поляр */
export const CONTROLS: { simple: boolean } = { simple: false };
