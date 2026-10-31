import * as THREE from 'three';
import { woodNormalTex, woodRoughTex, metalNormalTex, metalRoughTex } from './pbr';
import { makeHullTextures } from './hullDeco';
import { buildFigurehead } from './figurehead';

// ============================================================
// Процедурная постройка кораблей (исторические силуэты
// XVI–XVIII веков): шлюп, флейт, бриг (игрок/торговцы/патруль)
// + каравелла с латинскими парусами, пинасс с плоским носом,
// когг с надстройками-«замками», галеон с гальюном и двумя
// батареями, фрегат. Корпус — по шпангоутам, паруса — шейдер
// с «пузом», такелаж — линиями. Все размеры в метрах, 1u = 1м.
// ============================================================

export interface ShipPreset {
  id: string;
  name: string;
  length: number; beam: number; draft: number; freeboard: number;
  masts: 2 | 3;
  gunsPerSide: number;
  mass: number;          // кг
  maxSpeed: number;      // м/с
  hullHP: number; sailHP: number; maxCrew: number;
  cargo: number;         // грузоподъёмность, т
  colors: { hull: number; deck: number; trim: number; sail: number };
  flagKind: FlagKind;
  // --- классификация (энциклопедия, мини-карта) ---
  category: 'war' | 'merchant';          // военный / торговый
  shipClass: string;                     // класс/ранг судна
  year?: number;                         // год постройки
  country?: string;                      // страна
  // --- архитектура XVI–XVIII веков ---
  rig?: 'full' | 'single' | 'lateenMix' | 'lateen'; // полное / один парус на мачту (когг) / фок прямой + латинские (каравелла) / все латинские (шебека, галера)
  gunportRows?: number;  // рядов пушечных портов по борту (1–4)
  castleH?: number;      // высота надстроек-«замков» (когг)
  flatBow?: boolean;     // пинасс: почти плоская носовая переборка
  beakhead?: boolean;    // галеон: низкий бак с гальюном
  gallery?: boolean;     // кормовая галерея с окнами
  oars?: number;         // вёсел на борт (гребные суда: шебека, галера)
  stripes?: { y0: number; y1: number; color: number }[]; // цветные полосы борта (доли свободного борта): «Victory stripe»
  /** высота квартердека над главной палубой, м (у судов, где он
   *  был в реальности: фрегаты, линейные, ост-индцы, галеон…);
   *  0/нет — открытая палуба по всей длине */
  quarter?: number;
}

export const PRESETS: Record<string, ShipPreset> = {
  // ================= base set =================
  sloop: {
    id: 'sloop', name: 'Шлюп «Бриз»',
    length: 28, beam: 7.4, draft: 2.2, freeboard: 2.7,
    masts: 2, gunsPerSide: 5,
    mass: 150_000, maxSpeed: 8.8,
    hullHP: 100, sailHP: 100, maxCrew: 24, cargo: 60,
    colors: { hull: 0x5c4326, deck: 0xa8895f, trim: 0x2e2013, sail: 0xe9dcc2 },
    flagKind: 'pirate',
    category: 'war', shipClass: 'Шлюп', year: 1715, country: 'Британские колонии',
  },
  fluyt: {
    id: 'fluyt', name: 'Флейт «Морская корова»',
    length: 36, beam: 8.8, draft: 3.1, freeboard: 3.0,
    masts: 3, gunsPerSide: 3,
    mass: 360_000, maxSpeed: 5.6,
    hullHP: 150, sailHP: 110, maxCrew: 20, cargo: 220,
    colors: { hull: 0x4a3a2a, deck: 0x9d8158, trim: 0x241a10, sail: 0xd8cbae },
    flagKind: 'merchant', quarter: 1.2,
    category: 'merchant', shipClass: 'Флейт', year: 1605, country: 'Голландия',
  },
  brig: {
    id: 'brig', name: 'Бриг «Ревнитель»',
    length: 31, beam: 8.4, draft: 2.8, freeboard: 2.9,
    masts: 2, gunsPerSide: 7,
    mass: 280_000, maxSpeed: 7.6,
    hullHP: 180, sailHP: 120, maxCrew: 60, cargo: 90,
    colors: { hull: 0x3d3d46, deck: 0x8f7752, trim: 0x1c1c22, sail: 0xdfd6bd },
    flagKind: 'navy', quarter: 1.1,
    category: 'war', shipClass: 'Бриг', year: 1780, country: 'Великобритания',
  },
  caravel: {
    id: 'caravel', name: 'Каравелла «Нинья»',
    length: 21, beam: 6.4, draft: 1.9, freeboard: 2.9,
    masts: 3, gunsPerSide: 3,
    mass: 130_000, maxSpeed: 7.9,
    hullHP: 110, sailHP: 105, maxCrew: 26, cargo: 70,
    colors: { hull: 0x6e4c2a, deck: 0xa8895f, trim: 0x2c1f12, sail: 0xe6d7b2 },
    flagKind: 'merchant',
    rig: 'lateenMix', quarter: 0.8,
    category: 'merchant', shipClass: 'Каравелла', year: 1490, country: 'Португалия',
  },
  pinnace: {
    id: 'pinnace', name: 'Пинасс «Морской пёс»',
    length: 34, beam: 7.8, draft: 2.7, freeboard: 3.1,
    masts: 3, gunsPerSide: 4,
    mass: 300_000, maxSpeed: 6.3,
    hullHP: 165, sailHP: 115, maxCrew: 34, cargo: 190,
    colors: { hull: 0x54402c, deck: 0x9d8158, trim: 0x241a10, sail: 0xd9ccb0 },
    flagKind: 'merchant',
    flatBow: true, quarter: 0.9,
    category: 'merchant', shipClass: 'Пинасс', year: 1600, country: 'Англия',
  },
  cog: {
    id: 'cog', name: 'Когг «Ганзейский волк»',
    length: 26, beam: 8.0, draft: 2.6, freeboard: 3.0,
    masts: 2, gunsPerSide: 3,
    mass: 340_000, maxSpeed: 5.2,
    hullHP: 190, sailHP: 95, maxCrew: 30, cargo: 210,
    colors: { hull: 0x4f3b26, deck: 0x93764f, trim: 0x23180d, sail: 0xd6c8a8 },
    flagKind: 'merchant',
    rig: 'single', castleH: 2.6,
    category: 'merchant', shipClass: 'Когг', year: 1350, country: 'Ганзейский союз',
  },
  galleon: {
    id: 'galleon', name: 'Галеон «Золотая лань»',
    length: 33, beam: 8.6, draft: 3.2, freeboard: 3.4,
    masts: 3, gunsPerSide: 6,
    mass: 420_000, maxSpeed: 7.0,
    hullHP: 250, sailHP: 130, maxCrew: 75, cargo: 120,
    colors: { hull: 0x3a2e22, deck: 0x8f7752, trim: 0x8a6a2a, sail: 0xe3d8bd },
    flagKind: 'navy',
    gunportRows: 2, beakhead: true, gallery: true, quarter: 2.1,
    category: 'war', shipClass: 'Галеон', year: 1577, country: 'Англия',
  },
  frigate: {
    id: 'frigate', name: 'Фрегат «Неустрашимый»',
    length: 38, beam: 9.2, draft: 3.0, freeboard: 3.3,
    masts: 3, gunsPerSide: 8,
    mass: 500_000, maxSpeed: 8.2,
    hullHP: 300, sailHP: 140, maxCrew: 90, cargo: 100,
    colors: { hull: 0x2a2d33, deck: 0x8f7752, trim: 0x9a7a33, sail: 0xe9e0c8 },
    flagKind: 'navy',
    gunportRows: 2, gallery: true, quarter: 1.9,
    category: 'war', shipClass: 'Фрегат 5 ранга', year: 1750, country: 'Великобритания',
  },

  // ================= военные корабли XVIII века =================
  victory: {
    id: 'victory', name: 'HMS Victory',
    length: 57, beam: 15.5, draft: 7.0, freeboard: 7.2,
    masts: 3, gunsPerSide: 14, gunportRows: 3,
    mass: 3_500_000, maxSpeed: 6.4,
    hullHP: 950, sailHP: 320, maxCrew: 850, cargo: 550,
    colors: { hull: 0x1c1c22, deck: 0xa8895f, trim: 0x8a6a2a, sail: 0xece3cb },
    flagKind: 'navy', gallery: true, quarter: 2.4,
    category: 'war', shipClass: 'Линейный корабль 1 ранга', year: 1765, country: 'Великобритания',
    stripes: [{ y0: 0.24, y1: 0.36, color: 0xc9a24a }, { y0: 0.41, y1: 0.53, color: 0xc9a24a }, { y0: 0.58, y1: 0.70, color: 0xc9a24a }],
  },
  santisima: {
    id: 'santisima', name: 'Santísima Trinidad',
    length: 61, beam: 16.2, draft: 7.4, freeboard: 7.6,
    masts: 3, gunsPerSide: 15, gunportRows: 4,
    mass: 4_300_000, maxSpeed: 6.0,
    hullHP: 1100, sailHP: 340, maxCrew: 1050, cargo: 620,
    colors: { hull: 0x7a2a22, deck: 0xa8895f, trim: 0x8a6a2a, sail: 0xe9e0c8 },
    flagKind: 'navy', gallery: true, quarter: 2.5,
    category: 'war', shipClass: 'Линейный корабль 1 ранга', year: 1769, country: 'Испания',
    stripes: [{ y0: 0.23, y1: 0.33, color: 0xd8d2c2 }, { y0: 0.35, y1: 0.45, color: 0xd8d2c2 }, { y0: 0.47, y1: 0.57, color: 0xd8d2c2 }, { y0: 0.60, y1: 0.70, color: 0xd8d2c2 }],
  },
  soleil: {
    id: 'soleil', name: 'Soleil Royal',
    length: 50, beam: 14.0, draft: 6.5, freeboard: 6.8,
    masts: 3, gunsPerSide: 12, gunportRows: 3,
    mass: 2_800_000, maxSpeed: 6.6,
    hullHP: 880, sailHP: 300, maxCrew: 850, cargo: 500,
    colors: { hull: 0x27406b, deck: 0xa8895f, trim: 0xc9a24a, sail: 0xece3cb },
    flagKind: 'navy', gallery: true, quarter: 2.3,
    category: 'war', shipClass: 'Линейный корабль 1 ранга', year: 1693, country: 'Франция',
    stripes: [{ y0: 0.24, y1: 0.36, color: 0xc9a24a }, { y0: 0.41, y1: 0.53, color: 0xc9a24a }, { y0: 0.58, y1: 0.70, color: 0xc9a24a }],
  },
  blago: {
    id: 'blago', name: '«Благополучие»',
    length: 46, beam: 12.0, draft: 5.4, freeboard: 5.8,
    masts: 3, gunsPerSide: 11, gunportRows: 2,
    mass: 1_900_000, maxSpeed: 6.4,
    hullHP: 620, sailHP: 240, maxCrew: 470, cargo: 400,
    colors: { hull: 0x4c4030, deck: 0x9d8158, trim: 0x2b4a6b, sail: 0xe3d8bd },
    flagKind: 'navy', quarter: 2.2,
    category: 'war', shipClass: 'Линейный корабль 3 ранга', year: 1741, country: 'Россия',
    stripes: [{ y0: 0.36, y1: 0.54, color: 0x9db3c9 }],
  },
  agamemnon: {
    id: 'agamemnon', name: 'HMS Agamemnon',
    length: 48, beam: 13.2, draft: 5.8, freeboard: 6.0,
    masts: 3, gunsPerSide: 11, gunportRows: 2,
    mass: 2_200_000, maxSpeed: 6.5,
    hullHP: 660, sailHP: 250, maxCrew: 500, cargo: 380,
    colors: { hull: 0x1c1c22, deck: 0xa8895f, trim: 0x8a6a2a, sail: 0xe9e0c8 },
    flagKind: 'navy', quarter: 2.2,
    category: 'war', shipClass: 'Линейный корабль 3 ранга', year: 1781, country: 'Великобритания',
    stripes: [{ y0: 0.36, y1: 0.54, color: 0xc9a24a }],
  },
  ingermanland: {
    id: 'ingermanland', name: '«Ингерманланд»',
    length: 46, beam: 12.0, draft: 5.4, freeboard: 5.8,
    masts: 3, gunsPerSide: 11, gunportRows: 2,
    mass: 1_900_000, maxSpeed: 6.4,
    hullHP: 630, sailHP: 240, maxCrew: 470, cargo: 400,
    colors: { hull: 0x6e6a5c, deck: 0x9d8158, trim: 0x2b5a8a, sail: 0xe3d8bd },
    flagKind: 'navy', gallery: true, quarter: 2.2,
    category: 'war', shipClass: 'Линейный корабль 3 ранга', year: 1715, country: 'Россия',
    stripes: [{ y0: 0.38, y1: 0.56, color: 0x2b5a8a }],
  },
  constitution: {
    id: 'constitution', name: 'USS Constitution',
    length: 53, beam: 13.0, draft: 6.0, freeboard: 6.2,
    masts: 3, gunsPerSide: 12, gunportRows: 2,
    mass: 2_200_000, maxSpeed: 7.8,
    hullHP: 740, sailHP: 280, maxCrew: 450, cargo: 380,
    colors: { hull: 0x17171c, deck: 0xa8895f, trim: 0xd8d2c2, sail: 0xece3cb },
    flagKind: 'navy', gallery: true, quarter: 2.3,
    category: 'war', shipClass: 'Тяжёлый фрегат 4 ранга', year: 1797, country: 'США',
    stripes: [{ y0: 0.34, y1: 0.54, color: 0xd8d2c2 }],
  },
  surprise: {
    id: 'surprise', name: 'HMS Surprise',
    length: 38, beam: 9.6, draft: 4.4, freeboard: 4.6,
    masts: 3, gunsPerSide: 9, gunportRows: 1,
    mass: 700_000, maxSpeed: 8.6,
    hullHP: 290, sailHP: 170, maxCrew: 200, cargo: 150,
    colors: { hull: 0x2a2d33, deck: 0x9d8158, trim: 0x1c1c22, sail: 0xe9e0c8 },
    flagKind: 'navy', quarter: 1.8,
    category: 'war', shipClass: 'Фрегат 6 ранга', year: 1796, country: 'Великобритания',
    stripes: [{ y0: 0.34, y1: 0.56, color: 0xc9b45a }],
  },
  hermione: {
    id: 'hermione', name: 'Hermione',
    length: 44, beam: 10.8, draft: 4.9, freeboard: 5.0,
    masts: 3, gunsPerSide: 10, gunportRows: 1,
    mass: 1_050_000, maxSpeed: 8.0,
    hullHP: 330, sailHP: 200, maxCrew: 255, cargo: 180,
    colors: { hull: 0x2b4a7a, deck: 0x9d8158, trim: 0xc9a24a, sail: 0xece3cb },
    flagKind: 'navy', gallery: true, quarter: 1.9,
    category: 'war', shipClass: 'Фрегат (класс Concorde)', year: 1779, country: 'Франция',
    stripes: [{ y0: 0.32, y1: 0.54, color: 0xc9a24a }],
  },
  mystique: {
    id: 'mystique', name: 'Le Mystique',
    length: 36, beam: 8.2, draft: 3.4, freeboard: 3.8,
    masts: 3, gunsPerSide: 8, gunportRows: 1,
    mass: 400_000, maxSpeed: 8.2,
    hullHP: 240, sailHP: 200, maxCrew: 150, cargo: 120,
    colors: { hull: 0x6e3423, deck: 0xa8895f, trim: 0x2c1f12, sail: 0xe6d7b2 },
    flagKind: 'navy',
    rig: 'lateen', oars: 8, quarter: 1.1,
    category: 'war', shipClass: 'Военная шебека (гребная)', year: 1750, country: 'Франция',
  },
  galley: {
    id: 'galley', name: 'Галера «Капудана»',
    length: 50, beam: 7.6, draft: 2.5, freeboard: 3.2,
    masts: 3, gunsPerSide: 4,
    mass: 340_000, maxSpeed: 7.0,
    hullHP: 260, sailHP: 150, maxCrew: 260, cargo: 100,
    colors: { hull: 0x5c3020, deck: 0x93764f, trim: 0xc9a24a, sail: 0xdccfa8 },
    flagKind: 'navy',
    rig: 'lateen', oars: 12, quarter: 1.2,
    category: 'war', shipClass: 'Военная галера (гребная)', year: 1750, country: 'Средиземноморье',
  },
  blackpearl: {
    // Легендарный корабль: чёрный корпус, чёрные паруса и
    // СВЕРХЪЕСТЕСТВЕННАЯ скорость — обгоняет даже «Летучего
    // голландца». 32 пушки: 18 на нижней палубе + 14 на верхней
    id: 'blackpearl', name: 'Чёрная жемчужина',
    length: 40, beam: 10, draft: 3.4, freeboard: 3.6,
    masts: 3, gunsPerSide: 16, gunportRows: 2,
    mass: 640_000, maxSpeed: 10.6,
    hullHP: 430, sailHP: 220, maxCrew: 130, cargo: 160,
    colors: { hull: 0x141419, deck: 0x453c33, trim: 0x1e1e26, sail: 0x1a1a20 },
    flagKind: 'pirate', gallery: true, beakhead: true, quarter: 2.0,
    category: 'war', shipClass: 'Легендарный галеон', year: 1693, country: 'Карибское море',
  },

  // ================= торговые и гражданские суда XVIII века =================
  amsterdam: {
    id: 'amsterdam', name: 'Amsterdam',
    length: 52, beam: 14.0, draft: 6.4, freeboard: 6.8,
    masts: 3, gunsPerSide: 8, gunportRows: 1,
    mass: 1_800_000, maxSpeed: 5.6,
    hullHP: 520, sailHP: 260, maxCrew: 120, cargo: 1400,
    colors: { hull: 0x4a3a2a, deck: 0x9d8158, trim: 0x241a10, sail: 0xd8cbae },
    flagKind: 'merchant', gallery: true, quarter: 1.8,
    category: 'merchant', shipClass: 'Ост-Индский корабль', year: 1748, country: 'Голландия',
    stripes: [{ y0: 0.30, y1: 0.50, color: 0x6b7a86 }],
  },
  abergavenny: {
    id: 'abergavenny', name: 'Earl of Abergavenny',
    length: 48, beam: 12.8, draft: 6.0, freeboard: 6.4,
    masts: 3, gunsPerSide: 10, gunportRows: 1,
    mass: 1_700_000, maxSpeed: 5.5,
    hullHP: 560, sailHP: 280, maxCrew: 160, cargo: 1500,
    colors: { hull: 0x3d3226, deck: 0x9d8158, trim: 0x241a10, sail: 0xd8cbae },
    flagKind: 'merchant', gallery: true, quarter: 1.8,
    category: 'merchant', shipClass: 'Ост-Индский корабль', year: 1796, country: 'Великобритания',
    stripes: [{ y0: 0.30, y1: 0.52, color: 0x2b4a6b }],
  },
  gotheborg: {
    id: 'gotheborg', name: 'Götheborg',
    length: 47, beam: 12.5, draft: 5.6, freeboard: 6.0,
    masts: 3, gunsPerSide: 9, gunportRows: 1,
    mass: 1_500_000, maxSpeed: 5.9,
    hullHP: 480, sailHP: 250, maxCrew: 140, cargo: 1200,
    colors: { hull: 0x5f4a2e, deck: 0x9d8158, trim: 0x27406b, sail: 0xd8cbae },
    flagKind: 'merchant', gallery: true, quarter: 1.7,
    category: 'merchant', shipClass: 'Ост-Индский корабль', year: 1738, country: 'Швеция',
    stripes: [{ y0: 0.32, y1: 0.52, color: 0x27406b }],
  },
  friendship: {
    id: 'friendship', name: 'Friendship of Salem',
    length: 38, beam: 9.4, draft: 4.4, freeboard: 4.6,
    masts: 3, gunsPerSide: 6, gunportRows: 1,
    mass: 700_000, maxSpeed: 6.4,
    hullHP: 340, sailHP: 190, maxCrew: 24, cargo: 420,
    colors: { hull: 0x17171c, deck: 0xa8895f, trim: 0xd8d2c2, sail: 0xd8cbae },
    flagKind: 'merchant', quarter: 1.4,
    category: 'merchant', shipClass: 'Торговый Индский корабль', year: 1797, country: 'США',
    stripes: [{ y0: 0.34, y1: 0.56, color: 0xd8d2c2 }],
  },
  endeavour: {
    id: 'endeavour', name: 'HMS Endeavour',
    length: 30, beam: 8.8, draft: 3.9, freeboard: 4.2,
    masts: 3, gunsPerSide: 5,
    mass: 400_000, maxSpeed: 5.8,
    hullHP: 250, sailHP: 130, maxCrew: 85, cargo: 380,
    colors: { hull: 0x5c4028, deck: 0x93764f, trim: 0x241a10, sail: 0xd6c8a8 },
    flagKind: 'navy', flatBow: true, quarter: 1.3,
    category: 'merchant', shipClass: 'Исследовательское судно', year: 1764, country: 'Великобритания',
  },
  bounty: {
    id: 'bounty', name: 'HMS Bounty',
    length: 31, beam: 8.6, draft: 3.8, freeboard: 4.0,
    masts: 3, gunsPerSide: 4,
    mass: 380_000, maxSpeed: 6.8,
    hullHP: 210, sailHP: 140, maxCrew: 46, cargo: 320,
    colors: { hull: 0x4f3b26, deck: 0x93764f, trim: 0x2e2013, sail: 0xdccfa8 },
    flagKind: 'navy', quarter: 1.3,
    category: 'merchant', shipClass: 'Вооружённое транспортное судно', year: 1784, country: 'Великобритания',
  },
  essex: {
    id: 'essex', name: 'Whaler Essex',
    length: 28, beam: 7.4, draft: 3.5, freeboard: 3.8,
    masts: 3, gunsPerSide: 3,
    mass: 340_000, maxSpeed: 6.6,
    hullHP: 190, sailHP: 130, maxCrew: 21, cargo: 350,
    colors: { hull: 0x3a2e22, deck: 0x93764f, trim: 0x23180d, sail: 0xd6c8a8 },
    flagKind: 'merchant',
    category: 'merchant', shipClass: 'Китобойное судно', year: 1799, country: 'США',
  },
  rebecca: {
    id: 'rebecca', name: 'Rebecca',
    length: 26, beam: 7.0, draft: 3.2, freeboard: 3.4,
    masts: 2, gunsPerSide: 3,
    mass: 220_000, maxSpeed: 7.2,
    hullHP: 150, sailHP: 110, maxCrew: 15, cargo: 190,
    colors: { hull: 0x54402c, deck: 0x9d8158, trim: 0x241a10, sail: 0xd9ccb0 },
    flagKind: 'merchant',
    category: 'merchant', shipClass: 'Торговый бриг', year: 1790, country: 'Британия / США',
  },
  svati: {
    id: 'svati', name: '«Свати»',
    length: 24, beam: 6.6, draft: 2.9, freeboard: 3.1,
    masts: 2, gunsPerSide: 2,
    mass: 160_000, maxSpeed: 6.8,
    hullHP: 120, sailHP: 105, maxCrew: 16, cargo: 170,
    colors: { hull: 0x4c4030, deck: 0x93764f, trim: 0x2b4a6b, sail: 0xd9ccb0 },
    flagKind: 'merchant',
    category: 'merchant', shipClass: 'Галиот / шхуна', year: 1780, country: 'Россия',
  },
  ladyw: {
    id: 'ladyw', name: 'Lady Washington',
    length: 17, beam: 5.2, draft: 2.2, freeboard: 2.5,
    masts: 2, gunsPerSide: 2,
    mass: 90_000, maxSpeed: 6.6,
    hullHP: 85, sailHP: 90, maxCrew: 12, cargo: 60,
    colors: { hull: 0x5c4326, deck: 0xa8895f, trim: 0x2e2013, sail: 0xe6d7b2 },
    flagKind: 'merchant',
    category: 'merchant', shipClass: 'Торговый шлюп', year: 1780, country: 'США',
  },
};

export const WAR_PRESET_IDS = Object.values(PRESETS).filter(p => p.category === 'war').map(p => p.id);
export const MERCHANT_PRESET_IDS = Object.values(PRESETS).filter(p => p.category === 'merchant').map(p => p.id);

export interface ShipVisual {
  group: THREE.Group;
  sails: SailRig;
  gunsPort: THREE.Object3D[];
  gunsStarboard: THREE.Object3D[];
  flag: THREE.Mesh;
  flagMat: THREE.ShaderMaterial;
  dims: { length: number; beam: number; draft: number };
  outline: THREE.Vector2[];       // контур ватерлинии (для пены)
  masts: THREE.Object3D[];        // для ломания мачт
  lantern?: THREE.PointLight;
  wheel: THREE.Object3D;
  detail?: THREE.Group;           // мелкие детали — видны только вблизи (LOD)
  oars?: THREE.Object3D[];        // вёсла гребных судов (анимация гребков)
  rudderMesh?: THREE.Mesh;        // руль на корме (поворачивается с рулём)
  /** Ломаемые детали палубы: штурвал, шпиль, фонарь, носовая фигура —
   *  срываются прямыми попаданиями и при затоплении (Ship.damageProp) */
  breakables: THREE.Object3D[];
  /** Обвязка мачт: ванты/штаги — обрываются вместе со своей мачтой */
  rigging: Rigging;
  /** материалы дерева корпуса (для скина «цвет корабля») — без экипажа */
  tintMats: THREE.MeshStandardMaterial[];
  /** Пушечные порты: крышки на верхних петлях + орудия закрытых
   *  батарей, выезжающие наружу при открытии (Ship.portsOpen) */
  gunPorts: GunPortVis[];
  /** ванты с выбленками из группы мелких деталей — ПОКАЖИТЕЛЬНАЯ
   *  принадлежность мачте: рвутся вместе с ней */
  detailRigs: { mast: number; lines: THREE.LineSegments }[];
  /** материал обшивки (для покупки украшений бортов) */
  hullMat: THREE.MeshStandardMaterial;
  /** текущая гальюнная фигура (покупается в порту) */
  figurehead: THREE.Group;
  /** магнитная стрелка нактоуза (плавает, смотрит на север) */
  binnacleNeedle?: THREE.Object3D;
  /** квартердек (если был у прототипа): геометрия + ориентиры */
  quarter?: QuarterVis;
}

/** Пушечный порт закрытой батареи: крышка + орудие */
export interface GunPortVis {
  side: -1 | 1;
  z: number; y: number;
  lid: THREE.Object3D;   // группа-петля вверху порта
  gun: THREE.Object3D;   // орудие (выезжает из порта)
  open: number;          // 0 закрыт .. 1 открыт (текущая анимация)
}

/** Квартердек: геометрия + ключевые точки для экипажа/штурвала */
export interface QuarterVis {
  height: number;      // подъём над главной палубой
  frontZ: number;      // передняя кромка (лесенки/балюстрада)
  sternZ: number;      // кормовая кромка
  wheelZ: number;      // штурвал на квартердеке
  mastIndex: number;   // мачта, проходящая сквозь квартердек
  floorY(z: number): number;  // высота настила в точке z
}

export interface SailRig {
  sails: SailInfo[];
}
/** Квадралateral полотна для проверки прострелов (координаты КОРАБЛЯ) */
export interface SailHitQuad {
  pivot: THREE.Vector3;      // ось брасопки (у мачты) в координатах корабля
  corners: THREE.Vector3[];  // 4 угла полотна при brace=0
  uvs: THREE.Vector2[];      // UV углов (для пробоин)
  rotates: boolean;          // квадратный парус вращается брасопкой
}
export interface SailInfo {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;      // свой материал на парус (своё рифление uFurl)
  brace?: THREE.Group;            // поворотная группа (рея+парус) — брасопка
  setAt: number;                  // доля тяги (sailFrac), при которой парус ПОЛНОСТЬЮ поставлен
  furl: number;                   // текущее рифление 0..1 (анимируется, 1 = убран)
  square: boolean;                // квадратный парус (рея брасопится)
  braceAngle: number;             // текущий угол брасопки (рад)
  mastIndex: number;              // мачта-носитель (падает вместе с ней)
  quad: SailHitQuad;              // зона прострела полотна
  holeW: number;                  // размер полотна вдоль UV.u, м (круглые дыры)
  holeH: number;                  // размер полотна вдоль UV.v, м
}

/** Пробоина в парусе (UV + радиус в долях holeH) — пишется в uniform-массив */
export function sailAddHole(s: SailInfo, u: number, v: number, r: number) {
  const arr = s.mat.uniforms.uHoles.value as THREE.Vector3[];
  const n = s.mat.uniforms.uHoleN.value as number;
  if (n < arr.length) {
    arr[n].set(u, v, r);
    s.mat.uniforms.uHoleN.value = n + 1;
  } else {
    // парус уже изрешечён — рвём существующюю дыру шире
    const h = arr[(Math.random() * arr.length) | 0];
    h.z = Math.min(0.34, h.z + r * 0.6);
  }
}

// ---------- шейдер паруса ----------
function sailMaterial(baseColor: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uBelly: { value: 0.5 },
      uFlutter: { value: 0.3 },
      uTime: { value: 0 },
      uDamage: { value: 0 },
      uColor: { value: new THREE.Color(baseColor) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
      uFurl: { value: 0 },
      // пробоины от картечи/ядер/книппеля: (u, v, радиус в долях высоты)
      uHoles: { value: Array.from({ length: 8 }, () => new THREE.Vector3(0, 0, 0)) },
      uHoleN: { value: 0 },
      uAspect: { value: 1 },      // ширина/высота — дыры круглые в метрах
    },
    vertexShader: /* glsl */`
      uniform float uBelly, uTime, uFurl, uFlutter;
      varying vec2 vUv;
      varying vec3 vN;
      varying float vDmgU;
      uniform float uDamage;
      void main() {
        vUv = uv;
        vDmgU = uDamage;
        vec3 p = position;
        // «пузо» паруса: синус по ширине и высоте, кромки закреплены.
        // асимметрия по высоте: максимум ниже середины — наполненное
        // полотно не выглядит плоским мешком. uBelly задан на CPU с
        // учётом ветра и степени постановки
        float belly = uBelly * sin(uv.x * 3.14159) * sin(uv.y * 3.14159)
                    * (0.72 + 0.28 * (1.0 - uv.y));
        // трепет свободной кромки: две волны, сильнее при слабом пузе (флюктер)
        float flut = uFlutter * (
          sin(uv.x * 9.0 + uTime * 7.3) * 0.6 +
          sin(uv.x * 17.0 - uTime * 11.7) * 0.4
        ) * sin(uv.y * 3.14159) * (1.0 - uv.y * 0.75);
        float dz = belly + flut;
        p.z += dz;
        // нормаль аналитически (по пуза) — с полным наклоном, чтобы
        // выпуклость читалась и в освещении, а не только в силуэте
        float dzu = uBelly * cos(uv.x * 3.14159) * 3.14159 * sin(uv.y * 3.14159);
        float dzv = uBelly * sin(uv.x * 3.14159) * 3.14159 * cos(uv.y * 3.14159);
        vN = normalize(vec3(-dzu * 0.8, -dzv * 0.8, 1.0));
        // рифление: при uFurl парус собирается к рее/штагу
        p.y *= mix(1.0, 0.10, uFurl);
        p.x *= mix(1.0, 0.55, uFurl);
        p.z *= mix(1.0, 0.08, uFurl);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      varying vec2 vUv;
      varying vec3 vN;
      varying float vDmgU;
      uniform vec3 uColor;
      uniform vec3 uSunDir;
      uniform vec3 uHoles[8];
      uniform float uHoleN;
      uniform float uAspect;
      float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
      float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
        return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),u.x), u.y); }
      void main() {
        vec3 col = uColor;
        // швы (горизонтальные полотнища)
        float seams = smoothstep(0.035, 0.0, abs(fract(vUv.y * 5.0) - 0.5) - 0.46);
        col *= 1.0 - seams * 0.16;
        // заплатки и рваные края от повреждений
        float dmg = vDmgU;
        float patches = step(0.55, vnoise(vUv * 4.7 + 7.3)) * dmg;
        col = mix(col, col * 0.55, patches);
        float holes = step(0.82 - dmg * 0.15, vnoise(vUv * 7.1 + 2.9)) * dmg * 1.4;
        // ===== ПРОБОИНЫ от снарядов (картечь/ядро/книппель) =====
        // рваный тёмный край + сквозная дыра (discard);
        // uAspect приводит UV к метрам — дыры круглые
        for (int i = 0; i < 8; i++) {
          if (float(i) >= uHoleN) break;
          vec2 hd = (vUv - uHoles[i].xy) * vec2(uAspect, 1.0);
          float hdist = length(hd);
          float n = vnoise(vUv * 17.0 + float(i) * 7.31);
          float rr = uHoles[i].z * (0.78 + 0.5 * n);
          if (hdist < rr) {
            col *= 0.42;
            if (hdist < rr * 0.58) discard;   // рваный сквозной проём
          }
        }
        // простое освещение
        float ndl = max(dot(normalize(vN), normalize(uSunDir)), 0.0) * 0.5 + 0.55;
        col *= ndl;
        float a = 1.0 - clamp(holes, 0.0, 0.9);
        if (a < 0.55) discard; // дыры — без полупрозрачности (нет проблем сортировки)
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });
}

// ---------- флаг ----------
/** Все флаги игры (скины): стандартные + покупные расцветки */
export type FlagKind = 'pirate' | 'merchant' | 'navy' | 'pirateRed' | 'jollyCrown' | 'blackplain' | 'maiden';

function drawSkull(x: CanvasRenderingContext2D, bone: string, skull: string) {
  x.fillStyle = skull;
  x.beginPath(); x.arc(64, 32, 13, 0, Math.PI * 2); x.fill(); // череп
  x.fillStyle = bone;
  x.beginPath(); x.arc(59, 30, 3, 0, Math.PI * 2); x.arc(69, 30, 3, 0, Math.PI * 2); x.fill();
  x.fillStyle = skull;
  x.save(); x.translate(64, 50); x.rotate(0.5); x.fillRect(-26, -2.5, 52, 5); x.restore();
  x.save(); x.translate(64, 50); x.rotate(-0.5); x.fillRect(-26, -2.5, 52, 5); x.restore();
}

function makeFlagTexture(kind: FlagKind): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 80;
  const x = c.getContext('2d')!;
  if (kind === 'pirate') {
    x.fillStyle = '#14100c'; x.fillRect(0, 0, 128, 80);
    drawSkull(x, '#14100c', '#e8e4d8');
  } else if (kind === 'pirateRed') {
    // «Кровавый Роджер»: алое поле, чёрный череп
    x.fillStyle = '#8a1f16'; x.fillRect(0, 0, 128, 80);
    drawSkull(x, '#8a1f16', '#1a1512');
  } else if (kind === 'jollyCrown') {
    // «Роджер с короной»: чёрное поле, череп в золотой короне
    x.fillStyle = '#0d0a08'; x.fillRect(0, 0, 128, 80);
    drawSkull(x, '#0d0a08', '#e8e4d8');
    x.fillStyle = '#d8b45a';
    x.beginPath();
    x.moveTo(52, 20); x.lineTo(56, 12); x.lineTo(61, 19); x.lineTo(64, 9);
    x.lineTo(67, 19); x.lineTo(72, 12); x.lineTo(76, 20); x.closePath(); x.fill();
  } else if (kind === 'blackplain') {
    // «Проклятый»: чисто чёрное полотнище
    x.fillStyle = '#0a0908'; x.fillRect(0, 0, 128, 80);
  } else if (kind === 'maiden') {
    // «Дева моря»: белое поле, алое сердце и якорь
    x.fillStyle = '#efe7d2'; x.fillRect(0, 0, 128, 80);
    x.fillStyle = '#a3362c';
    x.beginPath();
    x.moveTo(64, 58); x.bezierCurveTo(38, 40, 44, 20, 64, 32);
    x.bezierCurveTo(84, 20, 90, 40, 64, 58); x.fill();
    x.strokeStyle = '#2c3a4a'; x.lineWidth = 5;
    x.beginPath(); x.moveTo(64, 30); x.lineTo(64, 60); x.stroke();
    x.beginPath(); x.arc(64, 52, 9, Math.PI * 0.15, Math.PI * 0.85, true); x.stroke();
  } else if (kind === 'merchant') {
    x.fillStyle = '#efe7d2'; x.fillRect(0, 0, 128, 80);
    x.fillStyle = '#a3362c'; x.fillRect(0, 32, 128, 16);
  } else {
    x.fillStyle = '#efe7d2'; x.fillRect(0, 0, 128, 80);
    x.fillStyle = '#a3362c';
    x.fillRect(56, 0, 16, 80); x.fillRect(0, 32, 128, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function flagMesh(kind: FlagKind): { mesh: THREE.Mesh; mat: THREE.ShaderMaterial } {
  const g = new THREE.PlaneGeometry(2.0, 1.2, 12, 5);
  g.translate(1.0, 0, 0); // крепление у древка (x=0)
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uTex: { value: makeFlagTexture(kind) } },
    vertexShader: /* glsl */`
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position;
        float w = sin(p.x * 3.0 - uTime * 7.0) * 0.12 * p.x + sin(p.x * 6.0 - uTime * 11.0) * 0.05 * p.x;
        p.z += w; p.y += sin(p.x * 2.0 - uTime * 5.0) * 0.04 * p.x;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D uTex;
      varying vec2 vUv;
      void main() { gl_FragColor = texture2D(uTex, vUv); }
    `,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  return { mesh, mat };
}

// ---------- корпус по шпангоутам ----------
export function hullProfile(t: number, P: ShipPreset) {
  // t: 0 корма -> 1 нос. Полуширина, осадка, высота фальшборта
  const B = P.beam / 2;
  let w: number;
  if (t < 0.45) w = THREE.MathUtils.lerp(0.58, 1.0, smooth01(t / 0.45));
  else w = THREE.MathUtils.lerp(1.0, 0.0, Math.pow(smooth01((t - 0.45) / 0.55), 0.75));
  // пинасс: сужение только в самом конце — почти вертикальный плоский нос
  if (P.flatBow && t > 0.82) w = Math.max(w, THREE.MathUtils.lerp(0.74, 0.42, smooth01((t - 0.82) / 0.18)));
  const draft = P.draft * (0.72 + 0.28 * Math.sin(Math.PI * Math.min(1, t * 1.15)));
  let bulwark: number;
  if (P.beakhead) {
    // галеон: высокая корма, низкий бак — характерный силуэт с гальюном
    bulwark = P.freeboard * (0.85 + 0.36 * Math.pow(1 - t, 2.4) + 0.08 * Math.pow(Math.max(0, t - 0.7) / 0.3, 2));
  } else {
    bulwark = P.freeboard * (0.82 + 0.35 * Math.pow(Math.max(0, t - 0.75) / 0.25, 1.4) + 0.5 * Math.pow(1 - t, 2.2) * 0.6);
  }
  return { w: w * B, draft, bulwark };
}
function smooth01(x: number) { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); }

// ---------- раскладка орудий по палубам ----------
/** Слот орудия: z — вдоль корпуса (м, локально), tier 0 = открытая
 *  (верхнепалубная) батарея с лафетами, 1.. — закрытые орудийные деки,
 *  чьи стволы смотрят наружу из пушечных портов. */
export interface GunSlot { z: number; tier: number; y: number; }

/** Раскладка ВСЕХ орудий борта (число всегда = gunsPerSide — отрисовка
 *  соответствует количеству). Без gunportRows всё на палубе (шлюп/флейт);
 *  1 ряд портов — палуба + одна закрытая батарея; 2–4 ряда — палуба +
 *  (rows−1) деков, порт-ряды идут сверху вниз (0.62F … 0.28F). */
export function gunLayout(P: ShipPreset): GunSlot[] {
  const N = Math.max(0, Math.round(P.gunsPerSide));
  if (N === 0) return [];
  const L = P.length;
  const rows = Math.max(0, Math.min(4, P.gunportRows ?? 0));
  const tiers = rows === 0 ? 1 : Math.max(2, rows);
  // у судов с квартердеком открытая батарея начинается ОТ его
  // передней кромки (под квартердеком орудий на палубе не ставят)
  const qFront = P.quarter ? quarterFrontZ(P) : -Infinity;
  // распределение стволов по ярусам: поровну, остаток — верхним ярусам
  const counts = new Array<number>(tiers).fill(0);
  for (let i = 0; i < N; i++) counts[i % tiers]++;
  const slots: GunSlot[] = [];
  for (let tier = 0; tier < tiers; tier++) {
    const n = counts[tier];
    if (n <= 0) continue;
    if (tier === 0) {
      // открытая палуба: от квартердека (или кормы) до полубака
      const z0 = Math.max(-L * 0.22, qFront + Math.max(0.9, L * 0.025));
      const z1 = P.castleH ? L * 0.18 : L * 0.24;
      for (let i = 0; i < n; i++) {
        const z = THREE.MathUtils.lerp(z0, z1, n === 1 ? 0.5 : i / (n - 1));
        slots.push({ z, tier: 0, y: 0 }); // y палубы считает потребитель
      }
    } else {
      // закрытая батарея: высота порт-ряда (tier−1), чуть уже по длине —
      // корпус в оконечностях сужается, порты там не ставили
      const y = P.freeboard * (rows === 1 ? 0.5 : 0.62 - (tier - 1) * (0.34 / (rows - 1)));
      const z0 = -L * 0.24, z1 = L * 0.18;
      for (let i = 0; i < n; i++) {
        const z = THREE.MathUtils.lerp(z0, z1, n === 1 ? 0.5 : i / (n - 1));
        slots.push({ z, tier, y });
      }
    }
  }
  return slots;
}

// ---------- квартердек ----------
/** Передняя кромка квартердека (лесенки): чуть ПЕРЕД мачтой,
 *  которая сквозь него проходит (бизань — у 3-мачтовых, грот — у 2-мачтовых) */
export function quarterMastZ(P: ShipPreset): number {
  return P.masts === 2 ? -P.length * 0.10 : -P.length * 0.28;
}
export function quarterFrontZ(P: ShipPreset): number {
  return quarterMastZ(P) + THREE.MathUtils.clamp(P.length * 0.045, 1.1, 2.4);
}
/** Штурвал: ЗА мачтой квартердека (рулевой видит бизань над головой) */
export function quarterWheelZ(P: ShipPreset): number {
  return quarterMastZ(P) - THREE.MathUtils.clamp(P.length * 0.035, 1.0, 2.2);
}
/** Позиция штурвала на ЛЮБОМ судне: на квартердеке, если он есть,
 *  иначе — в корме, не задевая бизань (жалоба «штурвал в мачте») */
export function wheelZFor(P: ShipPreset): number {
  if (P.quarter) return quarterWheelZ(P);
  if (P.castleH) return THREE.MathUtils.lerp(-P.length / 2, P.length / 2, 0.29);
  // 3-мачтовые без квартердека: бизань на −0.28L — уходим в корму от неё
  return P.masts === 3 ? -P.length * 0.40 : THREE.MathUtils.lerp(-P.length / 2, P.length / 2, 0.2);
}

function buildHull(P: ShipPreset): { geometry: THREE.BufferGeometry; outline: THREE.Vector2[] } {
  const S = 26, R = 8;
  const L = P.length;
  const pos: number[] = [];
  const col: number[] = [];
  const uvs: number[] = [];
  const cHull = new THREE.Color(P.colors.hull);
  const cBelow = new THREE.Color(0x33402a); // подводная часть — обрастание
  const cBoot = new THREE.Color(0xd8d2c2); // пояс ватерлинии
  const cWale = new THREE.Color(P.colors.trim);
  const tmp = new THREE.Color();
  // цветные полосы борта (доли свободного борта) — «Victory stripe»
  const F = P.freeboard;
  const stripes = (P.stripes ?? []).map(st => ({
    y0: st.y0 * F, y1: st.y1 * F, c: new THREE.Color(st.color),
  }));
  // высотные зоны МАСШТАБИРУЮТСЯ под высоту борта (у линейных кораблей
  // ватерлинионный пояс и вельс не должны лепиться у самой палубы)
  const bootTop = Math.max(0.42, F * 0.13);        // верх ватерлинионного пояса
  const waleY0 = Math.max(0.9, F * 0.22);          // вельс (дополнительный пояс прочности)
  const waleY1 = waleY0 + Math.max(0.45, F * 0.09);

  const stations: { z: number; w: number; draft: number; bulwark: number }[] = [];
  for (let s = 0; s <= S; s++) {
    const t = s / S;
    const p = hullProfile(t, P);
    stations.push({ z: THREE.MathUtils.lerp(-L / 2, L / 2, t), w: p.w, draft: p.draft, bulwark: p.bulwark });
  }

  const pushPoint = (x: number, y: number, z: number) => {
    pos.push(x, y, z);
    // UV для PBR: u — вдоль корабля (планки по длине), v — по высоте;
    // тайл = ширина корпуса — как у палубы, масштаб рельефа совпадает
    uvs.push(z / P.beam, y / P.beam);
    // раскраска по высоте: подводная часть -> ватерлинионный пояс ->
    // (полосы пресета) -> вельс -> основной цвет борта
    let stripeC: THREE.Color | null = null;
    if (y > 0.1) {
      for (const st of stripes) {
        if (y >= st.y0 && y <= st.y1) { stripeC = st.c; break; }
      }
    }
    if (y < -0.15) tmp.copy(cHull).lerp(cBelow, Math.min(1, (-y + 0.15) / P.draft));
    else if (y < bootTop) tmp.copy(cBoot);
    else if (stripeC) tmp.copy(stripeC);
    else if (y > waleY0 && y < waleY1) tmp.copy(cWale);
    else tmp.copy(cHull);
    // лёгкая полосатость обшивки
    const stripe = 1.0 - 0.06 * (Math.sin(y * 9.0) * 0.5 + 0.5);
    col.push(tmp.r * stripe, tmp.g * stripe, tmp.b * stripe);
  };

  for (const st of stations) {
    for (let r = 0; r <= R; r++) {
      const u = r / R;
      const y = THREE.MathUtils.lerp(-st.draft, st.bulwark, u);
      const flare = Math.pow(u, 0.6);
      const halfW = st.w * (0.16 + 0.84 * flare);
      pushPoint(halfW, y, st.z);
      pushPoint(-halfW, y, st.z);
    }
  }
  const idx: number[] = [];
  const rowLen = (R + 1) * 2;
  for (let s = 0; s < S; s++) {
    for (let r = 0; r < R; r++) {
      const a = s * rowLen + r * 2, b = a + 1, c = a + 2, d = a + 3;
      const e = a + rowLen, f = e + 1, g = e + 2, h = e + 3;
      idx.push(a, c, e, c, g, e);
      // зеркальная сторона (обратный порядок): два РАЗНЫХ треугольника квада —
      // раньше (b,f,d) пушлся дважды (e+1===f!), второй (f,h,d) отсутствовал →
      // левый борт был решетом из чередующихся треугольников
      idx.push(b, f, d, f, h, d);
    }
  }
  // транцевая корма: веер от центра к ПОСЛЕДОВАТЕЛЬНЫМ граничным вершинам
  // (правые снизу вверх, затем левые сверху вниз) — без дыр между хордами.
  // ВАЖНО: контур ЗАМКНУТ последним треугольником (левая-верх → правая-верх):
  // раньше верхний клин транца не закрывался — сквозь корму «просвечивало»
  const st0 = stations[0];
  const centerIdx = pos.length / 3;
  pushPoint(0, -st0.draft * 0.55, st0.z - 0.01);
  const boundary: number[] = [];
  for (let r = R; r >= 0; r--) boundary.push(r * 2);      // правые: верх → низ
  for (let r = 0; r <= R; r++) boundary.push(r * 2 + 1);  // левые: низ → верх
  boundary.push(boundary[0]);                             // замыкание контура
  for (let i = 0; i < boundary.length - 1; i++) {
    idx.push(centerIdx, boundary[i], boundary[i + 1]); // нормаль наружу (−Z)
  }
  // днище: замыкаем корпус снизу (r=0 — нижняя кромка шпангоутов),
  // нормали вниз — при крене/под водой не «просвечивает»
  for (let s = 0; s < S; s++) {
    const a = s * rowLen + 1;        // левый борт, низ
    const b = s * rowLen;            // правый борт, низ
    const c = (s + 1) * rowLen + 1;
    const d = (s + 1) * rowLen;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();

  // контур ватерлинии
  const outline: THREE.Vector2[] = [];
  for (let s = 0; s <= S; s += 2) {
    const st = stations[s];
    const u = (st.draft) / (st.draft + st.bulwark); // u при y=0
    const flare = Math.pow(u, 0.6);
    const halfW = Math.max(0.25, st.w * (0.16 + 0.84 * flare));
    outline.push(new THREE.Vector2(halfW, st.z));
  }
  for (let s = S; s >= 0; s -= 2) {
    const st = stations[s];
    const u = st.draft / (st.draft + st.bulwark);
    const flare = Math.pow(u, 0.6);
    const halfW = Math.max(0.25, st.w * (0.16 + 0.84 * flare));
    outline.push(new THREE.Vector2(-halfW, st.z));
  }
  return { geometry: g, outline };
}

function buildDeck(P: ShipPreset): THREE.BufferGeometry {
  // палуба: полоса по длине чуть ниже фальшборта, вплотную к обшивке.
  // ВАЖНО: порядок вершин (a,b,c)(b,d,c) даёт нормали ВВЕРХ —
  // иначе палуба отсекается backface-куллингом и «просвечивает».
  // UV: u — поперёк (0..1 = полная ширина), v — вдоль (тайл = ширина),
  // доски идут вдоль корпуса, у краёв — тёмный водосток (в текстуре).
  const S = 20, L = P.length;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let s = 0; s <= S; s++) {
    const t = s / S;
    const p = hullProfile(t, P);
    const z = THREE.MathUtils.lerp(-L / 2, L / 2, t);
    const deckY = p.bulwark - 1.0;
    // полуширина корпуса на высоте палубы — та же формула, что в buildHull,
    // чтобы палуба доходила до борта без щели
    const u = Math.min(1, Math.max(0, (deckY + p.draft) / (p.draft + p.bulwark)));
    const flare = Math.pow(u, 0.6);
    const w = Math.max(0.15, p.w * (0.16 + 0.84 * flare) - 0.05);
    pos.push(w, deckY, z, -w, deckY, z);
    const vv = z / P.beam;
    uv.push(0.5 + w / P.beam, vv, 0.5 - w / P.beam, vv);
  }
  for (let s = 0; s < S; s++) {
    const a = s * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Текстура палубных досок: конопаченые швы, разбежка стыков, гвозди,
 *  волокна, потёртости; тёмные водосточные планки по краям (u≈0 и u≈1) */
function makeDeckTexture(baseColor: number, seed: number): THREE.Texture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const x = c.getContext('2d')!;
  const base = new THREE.Color(baseColor);
  let rs = seed * 2654435761 % 2147483647;
  const rnd = () => { rs = (rs * 16807) % 2147483647; return rs / 2147483647; };
  const N = 30, pw = S / N;
  for (let i = 0; i < N; i++) {
    const v = 0.84 + rnd() * 0.26;
    x.fillStyle = `rgb(${Math.round(base.r * 255 * v)},${Math.round(base.g * 255 * v)},${Math.round(base.b * 255 * v)})`;
    x.fillRect(i * pw, 0, pw + 1, S);
    // волокна дерева
    x.strokeStyle = 'rgba(30,18,8,0.10)';
    x.lineWidth = 1;
    for (let k = 0; k < 3; k++) {
      const gx = i * pw + pw * (0.2 + 0.6 * rnd());
      x.beginPath();
      x.moveTo(gx, 0);
      for (let y = 0; y <= S; y += 32) x.lineTo(gx + Math.sin(y * 0.045 + i * 7 + k * 3) * 2.2, y);
      x.stroke();
    }
    // стыки досок с разбежкой + гвозди
    const b1 = (i * 137 + 61) % S, b2 = (b1 + Math.round(S * 0.55)) % S;
    for (const by of [b1, b2]) {
      x.fillStyle = 'rgba(22,14,7,0.6)';
      x.fillRect(i * pw, by, pw + 1, 2);
      x.fillStyle = 'rgba(32,32,36,0.85)';
      x.beginPath(); x.arc(i * pw + pw * 0.3, by + 5, 1.4, 0, 7); x.fill();
      x.beginPath(); x.arc(i * pw + pw * 0.7, by - 3, 1.4, 0, 7); x.fill();
    }
    // конопаченый шов между досками
    x.fillStyle = 'rgba(20,13,7,0.72)';
    x.fillRect(i * pw, 0, 1.6, S);
  }
  // водосточный жёлоб по краям палубы (тёмные продольные планки)
  for (const [x0, wW] of [[0, S * 0.075], [S * 0.925, S * 0.075]] as [number, number][]) {
    const gr = x.createLinearGradient(x0, 0, x0 + wW, 0);
    gr.addColorStop(0, 'rgba(24,15,7,0.5)');
    gr.addColorStop(1, 'rgba(24,15,7,0.12)');
    x.fillStyle = gr;
    x.fillRect(x0, 0, wW, S);
  }
  // потёртости и разводы
  for (let k = 0; k < 26; k++) {
    const rx = rnd() * S, ry = rnd() * S, rr = 18 + rnd() * 55;
    const rg = x.createRadialGradient(rx, ry, 0, rx, ry, rr);
    rg.addColorStop(0, 'rgba(28,18,8,0.09)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = rg;
    x.fillRect(rx - rr, ry - rr, rr * 2, rr * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Планширь: планка, закрывающая верхнюю кромку фальшборта */
function buildCapRail(P: ShipPreset): THREE.BufferGeometry {
  const S = 26, L = P.length;
  const pos: number[] = [], col: number[] = [], idx: number[] = [], uvs: number[] = [];
  const cRail = new THREE.Color(P.colors.trim).multiplyScalar(1.25);
  const cRail2 = new THREE.Color(P.colors.trim);
  const push = (px: number, py: number, z: number, c: THREE.Color) => {
    pos.push(px, py, z); col.push(c.r, c.g, c.b);
    // UV как у корпуса: планки по длине (u вдоль корабля)
    uvs.push(z / P.beam, py / P.beam);
  };
  for (let s = 0; s <= S; s++) {
    const t = s / S;
    const p = hullProfile(t, P);
    const z = THREE.MathUtils.lerp(-L / 2, L / 2, t);
    const y = p.bulwark;
    // внутренняя и внешняя кромки планки (лёгкий свес наружу)
    push(p.w - 0.26, y + 0.07, z, cRail);
    push(p.w + 0.13, y + 0.015, z, cRail2);
    push(-p.w + 0.26, y + 0.07, z, cRail);
    push(-p.w - 0.13, y + 0.015, z, cRail2);
  }
  for (let s = 0; s < S; s++) {
    const a = s * 4;
    // правый борт
    idx.push(a, a + 4, a + 1, a + 1, a + 4, a + 5);
    // левый борт
    idx.push(a + 2, a + 3, a + 6, a + 3, a + 7, a + 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Мишень для слияния реквизита в один меш (uv — диагональная
 *  коробочная развёртка: рельеф мелким деталям без растяжений) */
interface BakedTarget { pos: number[]; col: number[]; uv: number[] }

/** Запечь геометрию в общие массивы (для слияния реквизита в один меш) */
function bakeInto(target: BakedTarget, geo: THREE.BufferGeometry,
  color: THREE.Color, x: number, y: number, z: number, euler?: THREE.Euler) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    if (euler) v.applyEuler(euler);
    target.pos.push(v.x + x, v.y + y, v.z + z);
    target.col.push(color.r, color.g, color.b);
    // тайл ~1.5 м — нормали металла/дерева без пикселизации
    target.uv.push((v.x + x + v.z + z) * 0.33, (v.y + y + v.z + z) * 0.33);
  }
}

/** Палубный реквизит: решётчатый люк, бочки, канаты, кнехты, колокол,
 *  ядра, сундук, ведро — всё сливается в ОДИН меш с vertex colors */
function buildDeckProps(P: ShipPreset): THREE.BufferGeometry {
  const L = P.length;
  const t: BakedTarget = { pos: [], col: [], uv: [] };
  const deckYAt = (tt: number) => hullProfile(tt, P).bulwark - 1.0;
  const cWood = new THREE.Color(0x7a5c38);
  const cWoodD = new THREE.Color(0x4a3420);
  const cDark = new THREE.Color(P.colors.trim);
  const cIron = new THREE.Color(0x24262b);
  const cBrass = new THREE.Color(0xb8912f);
  const cRope = new THREE.Color(0xa08656);
  const cBarrel = new THREE.Color(0x8a6a42);

  // --- решётчатый люк (гратинг) с коомингом ---
  const hx = L * 0.08, hz = L * 0.05; // пол-размера (между мачтами)
  const hy = deckYAt(0.48);
  // кооминг (рамка)
  bakeInto(t, new THREE.BoxGeometry(hx * 2 + 0.24, 0.22, 0.12), cWoodD, 0, hy + 0.11, hz);
  bakeInto(t, new THREE.BoxGeometry(hx * 2 + 0.24, 0.22, 0.12), cWoodD, 0, hy + 0.11, -hz);
  bakeInto(t, new THREE.BoxGeometry(0.12, 0.22, hz * 2), cWoodD, hx, hy + 0.11, 0);
  bakeInto(t, new THREE.BoxGeometry(0.12, 0.22, hz * 2), cWoodD, -hx, hy + 0.11, 0);
  // продольные планки
  const nL = 9;
  for (let i = 0; i < nL; i++) {
    const px = -hx + 0.12 + (i / (nL - 1)) * (hx * 2 - 0.24);
    bakeInto(t, new THREE.BoxGeometry(0.09, 0.07, hz * 2 - 0.1), cWood, px, hy + 0.24, 0);
  }
  // поперечные планки
  const nT = 5;
  for (let i = 0; i < nT; i++) {
    const pz = -hz + 0.1 + (i / (nT - 1)) * (hz * 2 - 0.2);
    bakeInto(t, new THREE.BoxGeometry(hx * 2 - 0.16, 0.07, 0.09), cWood, 0, hy + 0.30, pz);
  }

  // --- бочки (2 стоя, 1 лёжа) ---
  const barrelG = new THREE.CylinderGeometry(0.34, 0.34, 0.8, 10);
  const hoopG = new THREE.TorusGeometry(0.345, 0.022, 5, 12);
  const hoopE = new THREE.Euler(Math.PI / 2, 0, 0);
  const mkBarrel = (x: number, z: number, lying = false) => {
    const y = deckYAt(0.5 + z / L) + (lying ? 0.34 : 0.4);
    const e = lying ? new THREE.Euler(0, lying ? 0.7 : 0, Math.PI / 2) : undefined;
    bakeInto(t, barrelG, cBarrel, x, y, z, e);
    if (lying) {
      bakeInto(t, hoopG, cIron, x, y - 0.25, z, e);
      bakeInto(t, hoopG, cIron, x, y + 0.25, z, e);
    } else {
      bakeInto(t, hoopG, cIron, x, y - 0.28, z, hoopE);
      bakeInto(t, hoopG, cIron, x, y + 0.28, z, hoopE);
    }
  };
  mkBarrel(P.beam * 0.24, L * 0.10);
  mkBarrel(-P.beam * 0.26, L * 0.04);
  mkBarrel(P.beam * 0.22, -L * 0.12, true);
  // --- бухты канатов ---
  const coilG = new THREE.TorusGeometry(0.30, 0.10, 6, 14);
  const coilE = new THREE.Euler(Math.PI / 2, 0, 0);
  bakeInto(t, coilG, cRope, P.beam * 0.20, deckYAt(0.75) + 0.10, P.castleH ? L * 0.2 : L * 0.30, coilE);
  bakeInto(t, coilG, cRope, -P.beam * 0.18, deckYAt(0.62) + 0.10, L * 0.18, coilE);
  bakeInto(t, coilG, cRope, P.beam * 0.34, deckYAt(0.36) + 0.10, -L * 0.15, coilE);

  // --- кнехты (битенги) с поперечиной у носа (на кораблях с «замками» нос занят надстройкой) ---
  const bittG = new THREE.BoxGeometry(0.15, 0.6, 0.15);
  if (!P.castleH) for (const side of [-1, 1]) {
    bakeInto(t, bittG, cWoodD, side * 0.42, deckYAt(0.85) + 0.3, L * 0.36);
    bakeInto(t, bittG, cWoodD, side * 0.42, deckYAt(0.85) + 0.3, L * 0.36 - 0.5);
    bakeInto(t, new THREE.BoxGeometry(0.13, 0.13, 0.75), cWoodD, side * 0.42, deckYAt(0.85) + 0.55, L * 0.36 - 0.25);
  }

  // --- корабельный колокол у штурвала ---
  const bellZ = THREE.MathUtils.lerp(-L / 2, L / 2, 0.2) + 1.6;
  bakeInto(t, new THREE.BoxGeometry(0.12, 0.8, 0.12), cWoodD, 0.8, deckYAt(0.22) + 0.4, bellZ);
  bakeInto(t, new THREE.CylinderGeometry(0.05, 0.13, 0.2, 8), cBrass, 0.8, deckYAt(0.22) + 0.85, bellZ);

  // --- пирамиды ядер у мачты ---
  const ballG = new THREE.SphereGeometry(0.105, 7, 6);
  const pile = (x: number, z: number) => {
    const y0 = deckYAt(0.5 + z / L);
    for (const [dx, dz] of [[-0.115, 0], [0, 0], [0.115, 0], [-0.058, 0.1], [0.058, 0.1], [0, 0.05]]) {
      bakeInto(t, ballG, cIron, x + dx, y0 + 0.105, z + dz);
    }
  };
  pile(0.85, -L * 0.16);
  pile(-P.beam * 0.20, L * 0.09);

  // --- сундук с инструментом ---
  bakeInto(t, new THREE.BoxGeometry(0.72, 0.42, 0.5), cWoodD, -P.beam * 0.26, deckYAt(0.42) + 0.21, -L * 0.2);
  bakeInto(t, new THREE.BoxGeometry(0.78, 0.1, 0.56), cDark, -P.beam * 0.26, deckYAt(0.42) + 0.46, -L * 0.2);

  // --- ведро ---
  bakeInto(t, new THREE.CylinderGeometry(0.17, 0.13, 0.3, 8, 1, true), cWood, -P.beam * 0.2, deckYAt(0.72) + 0.15, L * 0.24);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(t.col, 3));
  g.computeVertexNormals();
  return g;
}

/** Полуширина корпуса на высоте y в шпации t (та же формула развала бортов, что в buildHull) */
function hullHalfWidthAt(P: ShipPreset, t: number, y: number): number {
  const p = hullProfile(t, P);
  const u = Math.min(1, Math.max(0, (y + p.draft) / (p.draft + p.bulwark)));
  const flare = Math.pow(u, 0.6);
  return p.w * (0.16 + 0.84 * flare);
}

/** Выпечь массивы в геометрию с vertex colors */
function bakedGeo(t: BakedTarget): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(t.col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(t.uv, 2));
  g.computeVertexNormals();
  return g;
}

/** Надстройки-«замки» когга: массивые кормовый и носовой — ганзейский силуэт */
function buildCastles(P: ShipPreset): THREE.BufferGeometry {
  const L = P.length;
  const t: BakedTarget = { pos: [], col: [], uv: [] };
  const cWall = new THREE.Color(P.colors.trim).multiplyScalar(1.15);
  const cWoodD = new THREE.Color(0x4a3420);
  const cRail = new THREE.Color(P.colors.trim).multiplyScalar(1.35);
  const ch = P.castleH || 0;

  const mkCastle = (t0: number, t1: number, extra: number) => {
    const zA = THREE.MathUtils.lerp(-L / 2, L / 2, t0);
    const zB = THREE.MathUtils.lerp(-L / 2, L / 2, t1);
    const zc = (zA + zB) / 2, d = Math.abs(zB - zA);
    const prof = hullProfile((t0 + t1) / 2, P);
    const w = Math.max(1.2, prof.w * 0.92);
    const deckY = prof.bulwark - 1.0;
    const topY = deckY + extra;
    // массивная надстройка от палубы до площадки
    bakeInto(t, new THREE.BoxGeometry(w * 2, topY - deckY, d), cWall, 0, (deckY + topY) / 2, zc);
    // площадка чуть шире стен
    bakeInto(t, new THREE.BoxGeometry(w * 2 + 0.3, 0.22, d + 0.35), cWoodD, 0, topY + 0.11, zc);
    // стойки ограждения + продольный поручень
    for (const side of [-1, 1]) {
      for (let k = 0; k <= 4; k++) {
        const zz = zA + (k / 4) * (zB - zA);
        bakeInto(t, new THREE.BoxGeometry(0.12, 0.55, 0.12), cRail, side * (w + 0.05), topY + 0.5, zz);
      }
      bakeInto(t, new THREE.BoxGeometry(0.08, 0.08, d), cRail, side * (w + 0.05), topY + 0.76, zc);
    }
  };
  mkCastle(0.08, 0.24, ch);          // кормовый (ахтеркастель) — выше
  mkCastle(0.74, 0.88, ch * 0.72);   // носовой (бак) — ниже
  return bakedGeo(t);
}

/** Квартердек / кормовая надстройка: приподнятый настил с фальшбортом,
 *  передней переборкой, двумя трапами с перилами, балюстрадой,
 *  нактоузом (компас с лампой под стеклом), световыми люками
 *  в медной оправе и нагельными планками с концами к мачте.
 *  Возвращает группу + точку подвеса штурвала и стрелку компаса */
function buildQuarterdeck(
  P: ShipPreset,
  mastIndex: number,
): { group: THREE.Group; vis: QuarterVis; needle: THREE.Object3D; pinRopeEnds: { a: THREE.Vector3; b: THREE.Vector3 }[] } {
  const L = P.length;
  const group = new THREE.Group();
  const q = P.quarter ?? 0;
  const railH = THREE.MathUtils.clamp(q * 0.55, 0.62, 1.05); // фальшборт квартердека
  const frontZ = quarterFrontZ(P);
  const sternZ = -L / 2 + Math.max(0.35, L * 0.012);
  const mastZ = quarterMastZ(P);
  const deckYAt = (z: number) => {
    const t = clamp2((z + L / 2) / L, 0, 1);
    return hullProfile(t, P).bulwark - 1.0;
  };
  const floorY = (z: number) => deckYAt(z) + q;

  // дерево квартердека чуть светлее палубы — читается как надстройка
  const cWall = new THREE.Color(P.colors.trim).lerp(new THREE.Color(0x6e5433), 0.5);
  const cWallD = new THREE.Color(P.colors.trim);
  const cFloor = new THREE.Color(P.colors.deck).multiplyScalar(0.92);
  const cGold = new THREE.Color(0xc9a24a);
  const cCopper = new THREE.Color(0x9a6a3a);
  const cWoodPeg = new THREE.Color(0xb08a58);
  const t: BakedTarget = { pos: [], col: [], uv: [] };
  // металл (медная оправа люков/нактоуза) — отдельным мешем
  const tm: BakedTarget = { pos: [], col: [], uv: [] };

  // === НАСТИЛ: полоса от кормы до передней кромки, вплотную к бортам ===
  const S = 12;
  const floorPos: number[] = [], floorIdx: number[] = [];
  for (let s = 0; s <= S; s++) {
    const z = THREE.MathUtils.lerp(sternZ, frontZ, s / S);
    const tt = clamp2((z + L / 2) / L, 0, 1);
    const y = floorY(z);
    // ширина настила = корпус на высоте настила минус зазор на обшивку стены
    const w = Math.max(0.3, hullHalfWidthAt(P, tt, y) - 0.16);
    floorPos.push(w, y, z, -w, y, z);
  }
  for (let s = 0; s < S; s++) {
    const a = s * 2, b = a + 1, c = a + 2, d = a + 3;
    floorIdx.push(a, b, c, b, d, c); // нормали вверх
  }
  const floorGeo = new THREE.BufferGeometry();
  floorGeo.setAttribute('position', new THREE.Float32BufferAttribute(floorPos, 3));
  floorGeo.setIndex(floorIdx);
  floorGeo.computeVertexNormals();
  const floorMesh = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({
    vertexColors: false, color: cFloor.getHex(), metalness: 0.04,
    normalMap: woodNormalTex('deck'), roughnessMap: woodRoughTex('deck'),
    normalScale: new THREE.Vector2(0.5, 0.5), roughness: 1, side: THREE.DoubleSide,
  }));
  group.add(floorMesh);

  // === БОРТОВЫЕ СТЕНЫ: от главной палубы до планширя квартердека ===
  // (сплошные — щелей и просветов между корпусом и настилом нет)
  const SW = 14;
  for (let s = 0; s < SW; s++) {
    const z0 = THREE.MathUtils.lerp(sternZ, frontZ, s / SW);
    const z1 = THREE.MathUtils.lerp(sternZ, frontZ, (s + 1) / SW);
    const tt = clamp2(((z0 + z1) / 2 + L / 2) / L, 0, 1);
    const yBase = deckYAt((z0 + z1) / 2);
    const yTop = floorY((z0 + z1) / 2) + railH;
    const hw = Math.max(0.3, hullHalfWidthAt(P, tt, yBase)); // ширина на уровне палубы
    const h = yTop - yBase;
    for (const side of [-1, 1]) {
      bakeInto(t, new THREE.BoxGeometry(0.26, h, (z1 - z0) * 1.04), cWall,
        side * (hw - 0.03), yBase + h / 2, (z0 + z1) / 2);
    }
  }
  // планширь по верхней кромке
  for (let s = 0; s < SW; s++) {
    const z0 = THREE.MathUtils.lerp(sternZ, frontZ, s / SW);
    const z1 = THREE.MathUtils.lerp(sternZ, frontZ, (s + 1) / SW);
    const tt = clamp2(((z0 + z1) / 2 + L / 2) / L, 0, 1);
    const yTop = floorY((z0 + z1) / 2) + railH;
    const hw = Math.max(0.3, hullHalfWidthAt(P, tt, deckYAt((z0 + z1) / 2)));
    bakeInto(t, new THREE.BoxGeometry(0.4, 0.09, (z1 - z0) * 1.05),
      new THREE.Color(P.colors.trim).multiplyScalar(1.35), 0, yTop, (z0 + z1) / 2);
    bakeInto(t, new THREE.BoxGeometry(0.34, 0.07, (z1 - z0) * 1.05),
      new THREE.Color(P.colors.trim).multiplyScalar(1.35), hw - 0.03, yTop, (z0 + z1) / 2);
    bakeInto(t, new THREE.BoxGeometry(0.34, 0.07, (z1 - z0) * 1.05),
      new THREE.Color(P.colors.trim).multiplyScalar(1.35), -(hw - 0.03), yTop, (z0 + z1) / 2);
  }

  // === ПЕРЕДНЯЯ ПЕРЕБОРКА (сплошная — сквозь квартердек не видно) ===
  {
    const tt = clamp2((frontZ + L / 2) / L, 0, 1);
    const hw = Math.max(0.4, hullHalfWidthAt(P, tt, deckYAt(frontZ)) - 0.18);
    const h = floorY(frontZ) + railH - deckYAt(frontZ);
    bakeInto(t, new THREE.BoxGeometry(hw * 2, h, 0.22), cWall, 0,
      deckYAt(frontZ) + h / 2, frontZ - 0.02);
    // золочёный поручень переборки
    bakeInto(t, new THREE.BoxGeometry(hw * 2, 0.1, 0.3), cGold, 0,
      floorY(frontZ) + railH + 0.03, frontZ - 0.02);
  }

  // === ТРАПЫ С ПЕРИЛАМИ: два, у бортов, вдоль диаметрали ===
  const nSteps = Math.max(3, Math.ceil(q / 0.26));
  const runLen = nSteps * 0.34;
  for (const side of [-1, 1]) {
    const tt = clamp2((frontZ + runLen * 0.5 + L / 2) / L, 0, 1);
    const xStair = Math.max(0.55, hullHalfWidthAt(P, tt, deckYAt(frontZ)) - 0.52) * side;
    for (let i = 0; i < nSteps; i++) {
      const z = frontZ + runLen * (1 - (i + 0.5) / nSteps);
      const y = deckYAt(z) + (q * (i + 1)) / nSteps;
      bakeInto(t, new THREE.BoxGeometry(0.86, 0.07, 0.36), cFloor, xStair, y - 0.035, z);
    }
    // перила трапа: стойки + наклонный поручень + средний трос
    const zTop = frontZ + 0.1, zBot = frontZ + runLen;
    const yTop = floorY(zTop) + railH * 0.8, yBot = deckYAt(zBot) + 0.9;
    const xRail = xStair - side * 0.42; // внутренняя сторона
    for (let k = 0; k <= 2; k++) {
      const f = k / 2;
      const z = THREE.MathUtils.lerp(zBot, zTop, f);
      const y = THREE.MathUtils.lerp(yBot, yTop, f);
      bakeInto(t, new THREE.BoxGeometry(0.09, 0.95, 0.09), cWallD, xRail, y - 0.42, z);
    }
    const railLen = Math.hypot(zTop - zBot, yTop - yBot);
    const railAng = Math.atan2(yTop - yBot, -(zTop - zBot));
    const rail = new THREE.BoxGeometry(0.08, 0.08, railLen * 1.02);
    bakeInto(t, rail, cGold, xRail, (yTop + yBot) / 2, (zTop + zBot) / 2,
      new THREE.Euler(0, 0, railAng));
    const railMid = new THREE.BoxGeometry(0.05, 0.05, railLen * 1.02);
    bakeInto(t, railMid, cWallD, xRail, (yTop + yBot) / 2 - 0.32, (zTop + zBot) / 2,
      new THREE.Euler(0, 0, railAng));
  }

  // === БАЛЮСТРАДА по передней кромке (между трапами): резные балясины ===
  {
    const tt = clamp2((frontZ + L / 2) / L, 0, 1);
    const spanHalf = Math.max(0.3, hullHalfWidthAt(P, tt, floorY(frontZ)) - 0.75);
    const y0 = floorY(frontZ);
    for (let x = -spanHalf; x <= spanHalf + 0.001; x += 0.42) {
      // точёная балясина: база + ножка с яблоком + капитель
      bakeInto(t, new THREE.BoxGeometry(0.12, 0.07, 0.12), cWallD, x, y0 + 0.035, frontZ - 0.24);
      bakeInto(t, new THREE.CylinderGeometry(0.028, 0.04, railH - 0.22, 5), cWall, x, y0 + railH / 2, frontZ - 0.24);
      bakeInto(t, new THREE.SphereGeometry(0.055, 5, 4), cWall, x, y0 + railH * 0.52, frontZ - 0.24);
      bakeInto(t, new THREE.BoxGeometry(0.13, 0.06, 0.13), cWallD, x, y0 + railH - 0.03, frontZ - 0.24);
    }
    // поручень балюстрады
    bakeInto(t, new THREE.BoxGeometry(spanHalf * 2 + 0.3, 0.09, 0.16),
      new THREE.Color(P.colors.trim).multiplyScalar(1.3), 0, y0 + railH + 0.045, frontZ - 0.24);
    // нижний прогон
    bakeInto(t, new THREE.BoxGeometry(spanHalf * 2 + 0.2, 0.06, 0.1), cWallD, 0, y0 + 0.1, frontZ - 0.24);
  }

  // === НАКТОУЗ (компас): тумба перед штурвалом, лампа под стеклом,
  //     магнитная стрелка плавает и смотрит на север ===
  const binnacleZ = frontZ - THREE.MathUtils.clamp(L * 0.02, 0.7, 1.2);
  const binnacleY = floorY(binnacleZ);
  const needle = new THREE.Group();
  {
    // шкафчик-тумба (медь по кромкам, дерево внутри)
    bakeInto(t, new THREE.BoxGeometry(0.6, 0.92, 0.44), cWall, 0, binnacleY + 0.46, binnacleZ);
    bakeInto(tm, new THREE.BoxGeometry(0.66, 0.1, 0.5), cCopper, 0, binnacleY + 0.95, binnacleZ);
    bakeInto(tm, new THREE.BoxGeometry(0.66, 0.08, 0.5), cCopper, 0, binnacleY + 0.04, binnacleZ);
    // компасный котелок под стеклом
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.16, 10),
      new THREE.MeshStandardMaterial({
        color: 0x9fc8dc, transparent: true, opacity: 0.35,
        metalness: 0.4, roughness: 0.08,
      }));
    glass.position.set(0, binnacleY + 1.06, binnacleZ);
    group.add(glass);
    // лампа: тёплое свечение под стеклом (горит и ночью)
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 5),
      new THREE.MeshStandardMaterial({
        color: 0xffd88a, emissive: 0xffa644, emissiveIntensity: 2.2,
      }));
    lamp.position.set(0, binnacleY + 1.14, binnacleZ);
    group.add(lamp);
    // магнитная стрелка (двусторонняя: красный конец — на север)
    const nRed = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.015, 0.14),
      new THREE.MeshStandardMaterial({ color: 0xb02020, emissive: 0x400808 }));
    nRed.position.z = 0.07;
    const nWhite = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.015, 0.14),
      new THREE.MeshStandardMaterial({ color: 0xe8e0d0 }));
    nWhite.position.z = -0.07;
    needle.add(nRed, nWhite);
    needle.position.set(0, binnacleY + 1.06, binnacleZ);
    group.add(needle);
  }

  // === СВЕТОВЫЕ ЛЮКИ: плоские коробки со стеклом в медной оправе,
  //     по центру палубы (свет в кают-компанию внизу) ===
  const nSky = L > 42 ? 2 : 1;
  for (let k = 0; k < nSky; k++) {
    const z = mastZ - L * (0.06 + k * 0.09);
    const y = floorY(z) + 0.14;
    bakeInto(t, new THREE.BoxGeometry(1.15, 0.26, 0.85), cWall, 0, y, z);
    bakeInto(tm, new THREE.BoxGeometry(1.25, 0.1, 0.95), cCopper, 0, y + 0.16, z);
    const skyGlass = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.05, 0.65),
      new THREE.MeshStandardMaterial({
        color: 0x2e4a56, metalness: 0.55, roughness: 0.22,
        emissive: 0x0c1a20, emissiveIntensity: 0.6,
        transparent: true, opacity: 0.85,
      }));
    skyGlass.position.set(0, y + 0.15, z);
    group.add(skyGlass);
    // ребра-переплёты
    bakeInto(tm, new THREE.BoxGeometry(1.0, 0.04, 0.06), cCopper, 0, y + 0.17, z);
    bakeInto(tm, new THREE.BoxGeometry(0.06, 0.04, 0.7), cCopper, 0, y + 0.17, z);
  }

  // === НАГЕЛЬНЫЕ ПЛАНКИ: брусья с колышками вдоль бортов,
  //     концы к бизани (обрываются вместе с мачтой — в buildRigging) ===
  const pinRopeEnds: { a: THREE.Vector3; b: THREE.Vector3 }[] = [];
  const pinZ0 = sternZ + L * 0.05, pinZ1 = mastZ - 0.9;
  const nPegs = Math.max(2, Math.floor((pinZ1 - pinZ0) / 0.6));
  for (const side of [-1, 1]) {
    const zc = (pinZ0 + pinZ1) / 2;
    const tt = clamp2((zc + L / 2) / L, 0, 1);
    const xPin = Math.max(0.4, hullHalfWidthAt(P, tt, floorY(zc) + 0.5) - 0.34) * side;
    bakeInto(t, new THREE.BoxGeometry(0.14, 0.12, pinZ1 - pinZ0), cWallD, xPin, floorY(zc) + 0.5, zc);
    for (let i = 0; i < nPegs; i++) {
      const z = THREE.MathUtils.lerp(pinZ0, pinZ1, nPegs === 1 ? 0.5 : i / (nPegs - 1));
      bakeInto(t, new THREE.CylinderGeometry(0.03, 0.035, 0.2, 5), cWoodPeg, xPin, floorY(z) + 0.64, z);
      if (i % 2 === 0 && pinRopeEnds.length < 8) {
        pinRopeEnds.push({
          a: new THREE.Vector3(xPin, floorY(z) + 0.72, z),
          b: new THREE.Vector3(0, 2.2, mastZ), // до пяты бизани
        });
      }
    }
  }

  const walls = new THREE.Mesh(bakedGeo(t), new THREE.MeshStandardMaterial({
    vertexColors: true, metalness: 0.05, side: THREE.DoubleSide,
    normalMap: woodNormalTex('spar'), roughnessMap: woodRoughTex('spar'),
    normalScale: new THREE.Vector2(0.4, 0.4), roughness: 1,
  }));
  walls.castShadow = true;
  group.add(walls);
  const copper = new THREE.Mesh(bakedGeo(tm), new THREE.MeshStandardMaterial({
    vertexColors: true, metalness: 0.75, roughness: 0.45,
    normalMap: metalNormalTex(), roughnessMap: metalRoughTex(),
    normalScale: new THREE.Vector2(0.35, 0.35),
  }));
  group.add(copper);

  const vis: QuarterVis = {
    height: q, frontZ, sternZ,
    wheelZ: quarterWheelZ(P), mastIndex, floorY,
  };
  return { group, vis, needle, pinRopeEnds };
}

/** Наружный декор корпуса: пушечные порты с вельсовыми полосами
 *  (галеон/фрегат), кормовая галерея с окнами, плоская носовая
 *  переборка пинасса, гальюн галеона */
function buildHullOrnaments(P: ShipPreset): THREE.BufferGeometry | null {
  const L = P.length;
  const t: BakedTarget = { pos: [], col: [], uv: [] };
  const cPort = new THREE.Color(0x17100d);
  const cGold = new THREE.Color(P.colors.trim).lerp(new THREE.Color(0xd8b45a), 0.55);
  const cGlass = new THREE.Color(0x1d2a33);
  const cWoodD = new THREE.Color(0x4a3420);
  let any = false;

  // пушечные порты: РОВНО под стволами закрытых батарей (gunLayout) —
  // число портов соответствует числу орудий деку + золочёный вельс над батареей
  const rows = P.gunportRows || 0;
  if (rows > 0) {
    const layout = gunLayout(P).filter(s => s.tier > 0);
    const decks = [...new Set(layout.map(s => s.tier))];
    for (const tier of decks) {
      const y = layout.find(s => s.tier === tier)!.y;
      for (const side of [-1, 1]) {
        for (const slot of layout.filter(s => s.tier === tier)) {
          const tt = clamp2((slot.z + L / 2) / L, 0, 1);
          if (tt < 0.12 || tt > 0.86) continue;
          const hw = hullHalfWidthAt(P, tt, y);
          bakeInto(t, new THREE.BoxGeometry(0.06, Math.min(0.5, P.freeboard * 0.09), 0.62), cPort, side * (hw + 0.02), y, slot.z);
        }
        const S2 = 26;
        for (let s = 0; s < S2; s++) {
          const zA = THREE.MathUtils.lerp(-L * 0.32, L * 0.32, s / S2);
          const zB = THREE.MathUtils.lerp(-L * 0.32, L * 0.32, (s + 1) / S2);
          const tt = ((zA + zB) / 2 + L / 2) / L;
          if (tt < 0.1 || tt > 0.88) continue;
          const hw = hullHalfWidthAt(P, tt, y + 0.42);
          bakeInto(t, new THREE.BoxGeometry(0.05, 0.1, (zB - zA) * 1.05), cGold,
            side * (hw + 0.015), y + 0.42, (zA + zB) / 2);
        }
      }
    }
    any = true;
  }

  // кормовая галерея: два яруса окон с золочёными рамами.
  // Высоты — как на настоящих кораблях: верхний ярус на уровне
  // каюты ПОД квартердеком (у судов с квартердеком окна выше)
  if (P.gallery) {
    const rowsY = P.quarter
      ? [P.freeboard * 0.46, P.freeboard * 0.80]
      : [P.freeboard * 0.30, P.freeboard * 0.64];
    for (const y of rowsY) {
      for (const xoff of [-P.beam * 0.24, 0, P.beam * 0.24]) {
        bakeInto(t, new THREE.BoxGeometry(0.62, 0.54, 0.1), cGold, xoff, y, -L / 2 + 0.02);
        bakeInto(t, new THREE.BoxGeometry(0.46, 0.38, 0.12), cGlass, xoff, y, -L / 2 + 0.03);
      }
    }
    any = true;
  }

  // пинасс: почти плоская носовая переборка с планкирём
  if (P.flatBow) {
    const tt = 0.93;
    const prof = hullProfile(tt, P);
    const w = prof.w * 0.96;
    const z = THREE.MathUtils.lerp(-L / 2, L / 2, tt);
    bakeInto(t, new THREE.BoxGeometry(w * 2, prof.bulwark + P.draft * 0.5, 0.16), cWoodD,
      0, (prof.bulwark - P.draft * 0.5) / 2, z);
    bakeInto(t, new THREE.BoxGeometry(w * 2 + 0.14, 0.14, 0.2),
      new THREE.Color(P.colors.trim).multiplyScalar(1.3), 0, prof.bulwark + 0.05, z);
    any = true;
  }

  // галеон: гальюн — решётчатая площадка от низкого бака к бушприту
  if (P.beakhead) {
    const y = hullProfile(0.92, P).bulwark * 0.55;
    const z0 = L / 2 - 1.2, z1 = L / 2 + L * 0.1;
    for (let k = 0; k < 3; k++) {
      bakeInto(t, new THREE.BoxGeometry(1.7 - k * 0.5, 0.09, 0.09), cWoodD, 0, y,
        THREE.MathUtils.lerp(z0, z1, k / 2));
    }
    bakeInto(t, new THREE.BoxGeometry(0.09, 0.09, z1 - z0), cWoodD, -0.55, y, (z0 + z1) / 2);
    bakeInto(t, new THREE.BoxGeometry(0.09, 0.09, z1 - z0), cWoodD, 0.55, y, (z0 + z1) / 2);
    any = true;
  }

  if (!any) return null;
  return bakedGeo(t);
}

/** Мелкие детали, видимые только вблизи (LOD): выбленки на вантах,
 *  шлюпка вверх дном, настоящие якоря у скул, крышки пушечных портов,
 *  камбуз с трубой, кранцы, стол экипажа, блоки у мачт.
 *  Ванты с выбленками — ОТДЕЛЬНЫМИ линиями на мачту (detailRigs):
 *  вместе с мачтой они ОБРЫВАЮТСЯ (Ship.snapRigging прячет свою пару) */
function buildShipDetail(P: ShipPreset, mastDefs: { z: number; h: number }[]): {
  group: THREE.Group;
  detailRigs: { mast: number; lines: THREE.LineSegments }[];
} {
  const L = P.length;
  const group = new THREE.Group();
  const deckYAt = (tt: number) => hullProfile(tt, P).bulwark - 1.0;
  const cWood = new THREE.Color(0x7a5c38);
  const cWoodD = new THREE.Color(0x4a3420);
  const cRope = new THREE.Color(0xa08656);

  // --- ванты с выбленками (верёвочная лестница) — СВОЯ пара
  //     LineSegments на каждую мачту (рвётся вместе с ней) ---
  const detailRigs: { mast: number; lines: THREE.LineSegments }[] = [];
  const ropeMat = new THREE.LineBasicMaterial({ color: 0x241c12, transparent: true, opacity: 0.9 });
  mastDefs.forEach((m, mastIdx) => {
    const pts: number[] = [];
    const addLine = (a: THREE.Vector3, b: THREE.Vector3) => { pts.push(a.x, a.y, a.z, b.x, b.y, b.z); };
    for (const side of [-1, 1]) {
      const N = 5;
      const tops: THREE.Vector3[] = [], bases: THREE.Vector3[] = [];
      for (let k = 0; k < N; k++) {
        tops.push(new THREE.Vector3(0, m.h * (0.55 + k * 0.09), m.z));
        bases.push(new THREE.Vector3(side * 2.6, 1.6, m.z - 2.0 + k * 1.0));
      }
      for (let k = 0; k < N; k++) addLine(tops[k], bases[k]); // плотный веер вант
      for (let k = 0; k < N - 1; k++) {
        for (let f = 0.15; f <= 0.78; f += 0.09) {
          const a = new THREE.Vector3().lerpVectors(bases[k], tops[k], f);
          const b = new THREE.Vector3().lerpVectors(bases[k + 1], tops[k + 1], f);
          addLine(a, b); // выбленки
        }
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(lg, ropeMat);
    group.add(lines);
    detailRigs.push({ mast: mastIdx, lines });
  });

  const t: BakedTarget = { pos: [], col: [], uv: [] };
  // разрозненные снасти (фалы якорей, фалини кранцев) — отдельные
  // линии, НЕ принадлежащие мачтам (не рвутся с ними)
  const miscPts: number[] = [];
  const addLine = (a: THREE.Vector3, b: THREE.Vector3) => { miscPts.push(a.x, a.y, a.z, b.x, b.y, b.z); };
  // металлическая выпечка (якоря): отдельный меш с PBR-металлом —
  // отражает небо, кованая фактура картой нормалей
  const tm: BakedTarget = { pos: [], col: [], uv: [] };
  const cAnchor = new THREE.Color(0x454a52); // светлый gunmetal (тёмный в metalness-пайплайне не бликует)

  // --- шлюпка вверх дном у борта ---
  const boatG = new THREE.CapsuleGeometry(0.45, L * 0.14, 3, 8);
  boatG.rotateX(Math.PI / 2);
  boatG.scale(1, 0.5, 1);
  bakeInto(t, boatG, new THREE.Color(0x7d6446), P.beam * 0.16, deckYAt(0.63) + 0.22, L * 0.13);
  bakeInto(t, new THREE.BoxGeometry(0.08, 0.1, L * 0.3), cWoodD, P.beam * 0.16, deckYAt(0.63) + 0.44, L * 0.13);

  // --- настоящие якоря на фалах у скул носа ---
  for (const side of [-1, 1]) {
    const z = L / 2 - L * 0.1;
    const prof = hullProfile(0.85, P);
    const ax = side * (prof.w + 0.3), ay = P.freeboard * 0.55;
    bakeInto(tm, new THREE.BoxGeometry(0.1, 1.35, 0.1), cAnchor, ax, ay, z);          // веретено
    bakeInto(t, new THREE.BoxGeometry(0.9, 0.11, 0.11), cWoodD, ax, ay + 0.6, z);  // шток
    const armG = new THREE.TorusGeometry(0.4, 0.05, 5, 10, Math.PI);
    armG.rotateZ(Math.PI); // нижняя полуокружность — рога
    bakeInto(tm, armG, cAnchor, ax, ay - 0.6, z);
    for (const s2 of [-1, 1]) { // лапы
      const fl = new THREE.ConeGeometry(0.15, 0.36, 4);
      fl.rotateZ(s2 * Math.PI / 2);
      bakeInto(tm, fl, cAnchor, ax + s2 * 0.42, ay - 0.55, z);
    }
    const ring = new THREE.TorusGeometry(0.14, 0.03, 5, 10);
    bakeInto(tm, ring, cAnchor, ax, ay + 0.75, z);                                    // рым
    addLine(new THREE.Vector3(side * prof.w * 0.7, prof.bulwark, z - 1.2),
      new THREE.Vector3(ax, ay + 0.75, z));                                        // фал
  }

  // --- крышки пушечных портов (открытые, на верхних петлях) — только
  //     под ПАЛУБНЫМИ орудиями (закрытые деки стреляют из своих портов) ---
  for (const slot of gunLayout(P)) {
    if (slot.tier !== 0) continue;
    const tt = clamp2((slot.z + L / 2) / L, 0, 1);
    const y = hullProfile(tt, P).bulwark - 0.72;
    for (const side of [-1, 1]) {
      const hw = hullHalfWidthAt(P, tt, y);
      bakeInto(t, new THREE.BoxGeometry(0.06, 0.55, 0.6), cWoodD,
        side * (hw + 0.14), y + 0.3, slot.z, new THREE.Euler(0, 0, side * 0.55));
    }
  }

  // --- камбуз (печь) с трубой ---
  bakeInto(t, new THREE.BoxGeometry(0.85, 0.75, 0.85), new THREE.Color(0x5c4034),
    -P.beam * 0.26, deckYAt(0.56) + 0.38, L * 0.06);
  bakeInto(t, new THREE.CylinderGeometry(0.09, 0.12, 1.5, 7), new THREE.Color(0x2b2d31),
    -P.beam * 0.26, deckYAt(0.56) + 1.35, L * 0.06);

  // --- стол экипажа со скамьёй ---
  bakeInto(t, new THREE.BoxGeometry(1.5, 0.08, 0.7), cWood, P.beam * 0.12, deckYAt(0.4) + 0.62, -L * 0.1);
  for (const [lx, lz] of [[-0.65, -0.28], [0.65, -0.28], [-0.65, 0.28], [0.65, 0.28]] as [number, number][]) {
    bakeInto(t, new THREE.CylinderGeometry(0.045, 0.045, 0.62, 5), cWoodD,
      P.beam * 0.12 + lx, deckYAt(0.4) + 0.31, -L * 0.1 + lz);
  }
  bakeInto(t, new THREE.BoxGeometry(1.7, 0.09, 0.34), cWood, P.beam * 0.12, deckYAt(0.4) + 0.28, -L * 0.1 + 0.75);

  // --- кранцы: канатные шары на фалинях у планширя ---
  for (let k = 0; k < 3; k++) {
    const z = L * (0.08 + k * 0.2);
    const prof = hullProfile(0.5 + z / L, P);
    for (const side of [-1, 1]) {
      const hx = side * (prof.w + 0.06), hy = prof.bulwark + 0.28;
      bakeInto(t, new THREE.SphereGeometry(0.13, 6, 5), cRope, hx, hy, z);
      addLine(new THREE.Vector3(side * prof.w * 0.92, prof.bulwark + 0.05, z),
        new THREE.Vector3(hx, hy, z));
    }
  }

  // --- блоки у мачт ---
  for (const md of mastDefs) {
    bakeInto(t, new THREE.CylinderGeometry(0.09, 0.09, 0.14, 6), cWoodD, 0.35, deckYAt(0.5 + md.z / L) + 0.35, md.z - 0.6);
    bakeInto(t, new THREE.CylinderGeometry(0.09, 0.09, 0.14, 6), cWoodD, -0.35, deckYAt(0.5 + md.z / L) + 0.35, md.z - 0.6);
  }

  const mesh = new THREE.Mesh(bakedGeo(t),
    new THREE.MeshStandardMaterial({
      vertexColors: true, metalness: 0.2, side: THREE.DoubleSide,
      normalMap: woodNormalTex('spar'), roughnessMap: woodRoughTex('spar'),
      normalScale: new THREE.Vector2(0.35, 0.35), roughness: 1,
    }));
  group.add(mesh);
  if (miscPts.length) {
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.Float32BufferAttribute(miscPts, 3));
    group.add(new THREE.LineSegments(mg, ropeMat));
  }
  // якоря — кованое железо: PBR-металл с картой окружения неба
  if (tm.pos.length) {
    const mm = new THREE.Mesh(bakedGeo(tm),
      new THREE.MeshStandardMaterial({
        vertexColors: true, metalness: 0.88,
        normalMap: metalNormalTex(), roughnessMap: metalRoughTex(),
        normalScale: new THREE.Vector2(0.5, 0.5), roughness: 1,
      }));
    group.add(mm);
  }
  return { group, detailRigs };
}

/** Вёсла гребных судов (шебека, галера): вальные порты по борту +
 *  вёсла с лопастями. Модель поворота — ДВА чистых поворота в осях
 *  КОРАБЛЯ (как у весла на уключине):
 *    yaw  — гребок: лопасть метёт по горизонтали от носа к корме;
 *    roll — погружение: лопасть опускается в воду на рабочем ходу.
 *  Гребут ВСЕ вёсла СИНХРОННО (одна фаза на оба борта — как на
 *  галере; раньше борта были в противофазе, а фаза «ехала» вдоль
 *  корпуса). Задний ход — зеркальный гребок (лопасть метёт к носу).
 *  УБРАНОЕ положение: вал вдоль борта к корме, горизонтально,
 *  прижат к скуле — не «палки вниз» и не вертикально вверх. */
function buildOars(P: ShipPreset): { group: THREE.Group; oars: THREE.Object3D[] } {
  const group = new THREE.Group();
  const oars: THREE.Object3D[] = [];
  const n = P.oars || 0;
  if (!n) return { group, oars };
  const L = P.length;
  const shaftMat = new THREE.MeshStandardMaterial({
    color: 0x8a6a42,
    normalMap: woodNormalTex('spar'), roughnessMap: woodRoughTex('spar'),
    normalScale: new THREE.Vector2(0.45, 0.45), roughness: 1,
  });
  const portMat = new THREE.MeshStandardMaterial({ color: 0x14100d, roughness: 0.9 });
  const leatherMat = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.85 });
  const oarLen = clamp2(L * 0.17, 4.5, 11);
  const z0 = -L * 0.26, z1 = L * 0.30;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const z = THREE.MathUtils.lerp(z0, z1, t);
    const tt = clamp2((z + L / 2) / L, 0, 1);
    const y = P.freeboard * 0.30; // вальная палуба — ниже орудийной
    const hw = hullHalfWidthAt(P, tt, y);
    for (const side of [-1, 1]) {
      // тёмный вальный порт (обшивка уключины)
      const port = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.3), portMat);
      port.position.set(side * (hw + 0.01), y, z);
      group.add(port);
      // весло: вал + лопасть, вытянуто вдоль локального ±X (наружу)
      const dir = side;
      const oar = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, oarLen, 5), shaftMat);
      shaft.rotation.z = Math.PI / 2;
      shaft.position.x = dir * oarLen * 0.42;
      oar.add(shaft);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(oarLen * 0.3, 0.03, 0.2), shaftMat);
      blade.position.x = dir * oarLen * 0.92;
      oar.add(blade);
      // кожаная обмотка уключины — читается место опоры
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.3, 6), leatherMat);
      collar.rotation.z = Math.PI / 2;
      collar.position.x = dir * oarLen * 0.06;
      oar.add(collar);
      oar.position.set(side * (hw + 0.04), y, z);
      // УБРАНО: вал вдоль борта к корме (yaw ~87°), лопать приподнята
      const stowQ = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0, side * 1.52, side * 0.10, 'YZX'));
      oar.quaternion.copy(stowQ);
      oar.userData.side = side;
      oar.userData.stowQ = stowQ;
      group.add(oar);
      oars.push(oar);
    }
  }
  return { group, oars };
}
function clamp2(v: number, a: number, b: number) { return v < a ? a : v > b ? b : v; }

// ---------- такелаж (линии) ----------
/** Одна снасть обвязки: ванта/штаг/бакштаг. Принадлежит своей мачте —
 *  при её ломке обвязка ОБРЫВАЕТСЯ (Ship.snapRigging) */
export interface RigLine {
  mast: number;                        // индекс мачты-владельца
  a: THREE.Vector3; b: THREE.Vector3;  // оригинальные концы (для восстановления)
}
export interface Rigging {
  lines: THREE.LineSegments;
  meta: RigLine[];
}
function buildRigging(P: ShipPreset, masts: { z: number; h: number }[], bowspritTip: THREE.Vector3,
  pinRopes?: { mast: number; ends: { a: THREE.Vector3; b: THREE.Vector3 }[] }): Rigging {
  const meta: RigLine[] = [];
  const L = P.length;
  const addLine = (mast: number, a: THREE.Vector3, b: THREE.Vector3) => {
    meta.push({ mast, a, b });
  };
  for (let mi = 0; mi < masts.length; mi++) {
    const m = masts[mi];
    const top = new THREE.Vector3(0, m.h, m.z);
    // штаги к носу и корме
    addLine(mi, top.clone(), bowspritTip.clone());
    addLine(mi, top.clone(), new THREE.Vector3(0, 1.2, -L / 2 + 0.4));
    // ванты к бортам
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const zz = m.z - 1.5 + k * 1.5;
        addLine(mi, new THREE.Vector3(side * 2.6, 1.6, zz),
          new THREE.Vector3(0, m.h * (0.55 + k * 0.15), m.z));
      }
    }
  }
  // бакштаги к корме от грот-мачты
  if (masts.length >= 2) {
    const mainIdx = masts.length - 1 > 1 ? masts.length - 2 : 0;
    const main = masts[mainIdx];
    addLine(mainIdx, new THREE.Vector3(0, main.h * 0.8, main.z), new THREE.Vector3(2.4, 1.4, -L / 2 + 0.3));
    addLine(mainIdx, new THREE.Vector3(0, main.h * 0.8, main.z), new THREE.Vector3(-2.4, 1.4, -L / 2 + 0.3));
  }
  // концы с нагельных планок квартердека — к СВОЕЙ мачте
  // (вместе с ней рвутся — «тросы падают вместе с мачтой»)
  if (pinRopes) {
    for (const e of pinRopes.ends) addLine(pinRopes.mast, e.a, e.b);
  }
  const pts: number[] = [];
  for (const l of meta) pts.push(l.a.x, l.a.y, l.a.z, l.b.x, l.b.y, l.b.z);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0x241c12, transparent: true, opacity: 0.85 });
  return { lines: new THREE.LineSegments(g, mat), meta };
}

// ---------- полная сборка ----------
export function buildShip(P: ShipPreset): ShipVisual {
  const group = new THREE.Group();
  const L = P.length;

  // корпус
  const { geometry: hullGeo, outline } = buildHull(P);
  // DoubleSide: даже если камера (или волна) заглянет под корпус/за корму —
  // стенки видны, «прозрачной кормы» нет (изнутри односторонние грани куллятся)
  // PBR: пояс обшивки + волокна — нормали, крашеное дерево — шероховатость.
  // ТЕКСТУРА БОРТОВ (вместо вершинных цветов): бесплатная текстура
  // дерева (three.js examples, CC) + ОКРАСКА (подводная часть, пояс
  // ватерлинии, полосы, вельс — как раньше в вершинах) + швы/потёки
  // + покупные ЗОЛОТЫЕ узоры полным цветом. Золото блестит за счёт
  // тёмных пятен на карте шероховатости и светлых на металличности —
  // дерево остаётся матовым.
  const hullTex = makeHullTextures(P, 'deco.none',
    gunLayout(P).filter(s => s.tier > 0).map(s => ({ z: s.z, y: s.y })));
  const hullMat = new THREE.MeshStandardMaterial({
    vertexColors: false, metalness: 1.0, roughness: 1.0,
    side: THREE.DoubleSide,
    map: hullTex.map,
    roughnessMap: hullTex.rough,
    metalnessMap: hullTex.metal,
    normalMap: woodNormalTex('hull'),
    normalScale: new THREE.Vector2(0.6, 0.6),
    envMapIntensity: 1.35,
  });
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.castShadow = true;
  group.add(hull);

  // палуба: текстура досок с конопачением (DoubleSide — страховка от куллинга);
  // нормали канавок/стыков/гвоздей СОВПАДАЮТ с нарисованными досками
  const deckMat = new THREE.MeshStandardMaterial({
    map: makeDeckTexture(P.colors.deck, P.colors.deck + P.length),
    normalMap: woodNormalTex('deck'), roughnessMap: woodRoughTex('deck'),
    normalScale: new THREE.Vector2(0.5, 0.5), roughness: 1,
    side: THREE.DoubleSide,
  });
  const deck = new THREE.Mesh(buildDeck(P), deckMat);
  group.add(deck);

  // планширь по верхней кромке фальшборта
  const capRail = new THREE.Mesh(buildCapRail(P),
    new THREE.MeshStandardMaterial({
      vertexColors: true, metalness: 0.05,
      normalMap: woodNormalTex('hull'), roughnessMap: woodRoughTex('hull'),
      normalScale: new THREE.Vector2(0.4, 0.4), roughness: 1,
    }));
  group.add(capRail);

  // рангоут — оструганные брёвна: вертикальные волокна;
  // тёмная окраска (darkMat) — крашеное дерево: рельеф обшивки мягче
  const woodMat = new THREE.MeshStandardMaterial({
    color: 0x6e5433,
    normalMap: woodNormalTex('spar'), roughnessMap: woodRoughTex('spar'),
    normalScale: new THREE.Vector2(0.5, 0.5), roughness: 1,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: P.colors.trim,
    normalMap: woodNormalTex('hull'), roughnessMap: woodRoughTex('hull'),
    normalScale: new THREE.Vector2(0.35, 0.35), roughness: 1,
  });

  // бушприт
  const bowsprit = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.16, L * 0.32, 6), woodMat);
  bowsprit.rotation.x = Math.PI / 2 - 0.18;
  bowsprit.position.set(0, P.freeboard * 0.75, L / 2 + L * 0.12);
  group.add(bowsprit);
  const bowspritTip = new THREE.Vector3(0, P.freeboard * 0.75 + L * 0.32 * 0.18, L / 2 + L * 0.12 + L * 0.32 * Math.cos(0.18) * 0.98);

  // мачты
  const mastDefs: { z: number; h: number }[] = [];
  const H = P.freeboard + L * 0.78;
  if (P.masts === 2) {
    mastDefs.push({ z: L * 0.16, h: H * 0.88 });
    mastDefs.push({ z: -L * 0.10, h: H });
  } else {
    mastDefs.push({ z: L * 0.18, h: H * 0.8 });
    mastDefs.push({ z: -L * 0.05, h: H });
    mastDefs.push({ z: -L * 0.28, h: H * 0.62 });
  }
  const masts: THREE.Object3D[] = [];
  for (const md of mastDefs) {
    const mast = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.24, md.h, 7), woodMat);
    pole.position.y = md.h / 2 - P.draft * 0.3;
    pole.castShadow = true;
    mast.add(pole);
    // марс (платформа)
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.6, 0.28, 8), darkMat);
    top.position.y = md.h * 0.72 - P.draft * 0.3;
    mast.add(top);
    mast.position.set(0, -P.draft * 0.3 > 0 ? 0 : 0, md.z);
    mast.userData.height = md.h;
    masts.push(mast);
    group.add(mast);
  }

  // паруса: каждый со своим материалом (своё рифление), квадратные —
  // на поворотной группе «рея+парус» для брасопки по ветру
  const sails: SailInfo[] = [];
  const addSquareSail = (mastIndex: number, level: number, width: number, height: number, setAt: number) => {
    const md = mastDefs[mastIndex];
    const g = new THREE.PlaneGeometry(width, height, 10, 7);
    g.translate(0, -height / 2, 0); // верхняя кромка у реи
    const mat = sailMaterial(P.colors.sail);
    mat.uniforms.uAspect.value = width / height;
    const mesh = new THREE.Mesh(g, mat);
    const y = md.h * level - P.draft * 0.3;
    // поворотная группа: ось вращения — мачта (брасопка рея по ветру)
    // рея+парус — потомок МАЧТЫ: сломанная мачта валится вместе с ними
    const pivot = new THREE.Group();
    pivot.position.set(0, y + 0.05, 0);
    // рея
    const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, width * 1.04, 5), woodMat);
    yard.rotation.z = Math.PI / 2;
    pivot.add(yard);
    mesh.position.set(0, 0, -0.25);
    pivot.add(mesh);
    masts[mastIndex].add(pivot);
    // зона прострела: прямоугольник полотна в координатах корабля (brace=0);
    // при проверке поворачивается на текущий угол брасопки вокруг мачты
    const quad: SailHitQuad = {
      pivot: new THREE.Vector3(0, y + 0.05, md.z),
      corners: [
        new THREE.Vector3(-width / 2, -height, -0.25), // uv(0,0) — нижний-лево
        new THREE.Vector3(width / 2, -height, -0.25),  // uv(1,0)
        new THREE.Vector3(width / 2, 0, -0.25),        // uv(1,1)
        new THREE.Vector3(-width / 2, 0, -0.25),       // uv(0,1)
      ],
      uvs: [
        new THREE.Vector2(0, 0), new THREE.Vector2(1, 0),
        new THREE.Vector2(1, 1), new THREE.Vector2(0, 1),
      ],
      rotates: true,
    };
    sails.push({ mesh, mat, brace: pivot, setAt, furl: 1, square: true, braceAngle: 0, mastIndex, quad, holeW: width, holeH: height });
  };
  // латинский парус (каравелла): длинная рейка от мачты к носу,
  // треугольное полотно в диаметральной плоскости, «пузо» — на борт
  const addLateenSail = (mastIndex: number, setAt: number, yLen: number, drop: number, aftFrac: number) => {
    const md = mastDefs[mastIndex];
    // локальная плоскость XY: +X -> нос, +Y вверх; поворот меша
    // развернёт её в диаметральную, «пузо» (локальный +Z) — на борт
    const H = { x: 0, y: 0 };
    const T = { x: yLen, y: -drop * 0.62 };        // нижний конец рея — вперёд и вниз
    const C = { x: -yLen * aftFrac, y: -drop };     // шкотовый угол — к корме
    const NU = 9, NV = 6;
    const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
    for (let i = 0; i <= NU; i++) {
      const u = i / NU;
      const ex = THREE.MathUtils.lerp(H.x, T.x, u), ey = THREE.MathUtils.lerp(H.y, T.y, u);
      const fx = THREE.MathUtils.lerp(H.x, C.x, u), fy = THREE.MathUtils.lerp(H.y, C.y, u);
      for (let j = 0; j <= NV; j++) {
        const v = j / NV;
        pos.push(THREE.MathUtils.lerp(ex, fx, v), THREE.MathUtils.lerp(ey, fy, v), 0);
        uvs.push(u, v);
      }
    }
    const row = NV + 1;
    for (let i = 0; i < NU; i++) {
      for (let j = 0; j < NV; j++) {
        const p0 = i * row + j, p1 = p0 + 1, p2 = p0 + row, p3 = p2 + 1;
        idx.push(p0, p1, p2, p1, p3, p2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mat = sailMaterial(P.colors.sail);
    // зона прострела латинского паруса — треугольник H(голова)-T(конец реи)-C(шкот):
    // в локалях меша +X -> нос после поворота меша на -90° вокруг Y
    const yardLenM = Math.hypot(T.x - H.x, T.y - H.y);
    mat.uniforms.uAspect.value = Math.max(0.3, (yardLenM + Math.abs(C.x)) / Math.max(1, drop));
    const mesh = new THREE.Mesh(g, mat);
    mesh.rotation.y = -Math.PI / 2; // локальный +X -> нос, «пузо» -> борт
    mesh.frustumCulled = false;
    const pivot = new THREE.Group();
    pivot.position.set(0, md.h * 0.72 - P.draft * 0.3, 0);
    // рея: от головы у мачты к носу-вниз
    const yardLen = Math.hypot(T.x - H.x, T.y - H.y) * 1.06;
    const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.085, yardLen, 5), woodMat);
    yard.rotation.z = Math.atan2(T.y - H.y, T.x - H.x) - Math.PI / 2;
    yard.position.set(T.x / 2, T.y / 2, 0);
    pivot.add(yard);
    pivot.add(mesh);
    masts[mastIndex].add(pivot);
    // поворот меша -90° вокруг Y: (x, y, 0) -> (0, y, x)
    const rotP = (x: number, y: number) => new THREE.Vector3(0, y, x);
    const pv = new THREE.Vector3(0, md.h * 0.72 - P.draft * 0.3, md.z);
    const quad: SailHitQuad = {
      pivot: pv,
      corners: [rotP(H.x, H.y), rotP(T.x, T.y), rotP(C.x, C.y), rotP(C.x, C.y)],
      uvs: [
        new THREE.Vector2(0, 0), new THREE.Vector2(1, 0),
        new THREE.Vector2(1, 1), new THREE.Vector2(1, 1),
      ],
      rotates: false,
    };
    sails.push({
      mesh, mat, setAt, furl: 1, square: false, braceAngle: 0, mastIndex,
      quad, holeW: yardLenM + Math.abs(C.x), holeH: drop,
    });
  };
  if (P.rig === 'single') {
    // когг: один большой прямой парус на мачту
    addSquareSail(0, 0.7, L * 0.42, L * 0.24, 0.5);
    addSquareSail(1, 0.76, L * 0.4, L * 0.22, 0.72);
  } else if (P.rig === 'lateenMix') {
    // каравелла редонда: прямой фок + латинские грот и бизань
    addSquareSail(0, 0.6, L * 0.28, L * 0.13, 0.55);
    addLateenSail(1, 0.45, L * 0.5, mastDefs[1].h * 0.5, 0.85);
    addLateenSail(2, 0.8, L * 0.32, mastDefs[2].h * 0.5, 0.55);
  } else if (P.rig === 'lateen') {
    // шебека / галера: огромные латинские паруса на всех мачтах
    addLateenSail(0, 0.68, L * 0.34, mastDefs[0].h * 0.46, 0.5);
    addLateenSail(1, 0.45, L * 0.52, mastDefs[1].h * 0.52, 0.85);
    addLateenSail(2, 0.78, L * 0.3, mastDefs[2].h * 0.44, 0.5);
  } else if (P.masts === 2) {
    addSquareSail(0, 0.66, L * 0.3, L * 0.16, 0.62);   // фок
    addSquareSail(1, 0.72, L * 0.36, L * 0.2, 0.45);   // грот нижний — ставится первым
    addSquareSail(1, 0.45, L * 0.26, L * 0.14, 0.92);  // грот верхний (брамсель)
  } else {
    addSquareSail(0, 0.62, L * 0.24, L * 0.13, 0.60);
    addSquareSail(1, 0.7, L * 0.34, L * 0.18, 0.45);
    addSquareSail(1, 0.44, L * 0.24, L * 0.13, 0.92);
    addSquareSail(2, 0.5, L * 0.18, L * 0.11, 0.78);
  }

  // кливера (треугольные) от бушприта к фок-мачте: сетка с uv —
  // есть «пузо» и трепет; при рифлении собираются к голове
  const addJib = (tip: THREE.Vector3, foot: THREE.Vector3, headY: number, mastZ: number, setAt: number) => {
    const head = new THREE.Vector3(0, headY, mastZ - 0.3);
    // локальная система: X = −мирZ (продольная), Y = мирY, Z = мирX (пузо вбок)
    const a = { x: -(tip.z - head.z), y: tip.y - head.y };
    const b = { x: -(foot.z - head.z), y: foot.y - head.y };
    const NU = 8, NV = 5;
    const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
    for (let i = 0; i <= NU; i++) {
      const u = i / NU;
      // точка на штаге (к галсовому углу) и на шкаторине
      const lx = a.x * u, ly = a.y * u;
      const rx = b.x * u, ry = b.y * u;
      for (let j = 0; j <= NV; j++) {
        const v = j / NV;
        pos.push(THREE.MathUtils.lerp(lx, rx, v), THREE.MathUtils.lerp(ly, ry, v), 0);
        uvs.push(u, v);
      }
    }
    const row = NV + 1;
    for (let i = 0; i < NU; i++) {
      for (let j = 0; j < NV; j++) {
        const p0 = i * row + j, p1 = p0 + 1, p2 = p0 + row, p3 = p2 + 1;
        idx.push(p0, p1, p2, p1, p3, p2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mat = sailMaterial(P.colors.sail);
    mat.uniforms.uAspect.value = Math.max(0.3, Math.hypot(a.x, a.y) / Math.max(1, Math.hypot(b.x, b.y)));
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.set(head.x, head.y, head.z - mastZ);
    mesh.rotation.y = Math.PI / 2; // локальный Z (пузо) -> мир X (борт)
    mesh.frustumCulled = false;
    masts[0].add(mesh); // потомок фок-мачты — падает вместе с ней
    // зона прострела: треугольник голова-(конец штага)-(галсовый угол);
    // поворот меша +90° вокруг Y: (x, y, 0) -> (0, y, -x)
    const rotP = (x: number, y: number) => new THREE.Vector3(0, y, -x);
    const pv = new THREE.Vector3(head.x, head.y, head.z);
    const quad: SailHitQuad = {
      pivot: pv,
      corners: [rotP(0, 0), rotP(a.x, a.y), rotP(b.x, b.y), rotP(b.x, b.y)],
      uvs: [
        new THREE.Vector2(0, 0), new THREE.Vector2(1, 0),
        new THREE.Vector2(1, 1), new THREE.Vector2(1, 1),
      ],
      rotates: false,
    };
    sails.push({
      mesh, mat, setAt, furl: 1, square: false, braceAngle: 0, mastIndex: 0,
      quad, holeW: Math.hypot(a.x, a.y), holeH: Math.hypot(b.x, b.y),
    });
  };
  // кливера — только на «полных» вооружениях (у когга, каравеллы и шебеки их нет)
  const foreTop = mastDefs[0];
  if (P.rig !== 'lateenMix' && P.rig !== 'single' && P.rig !== 'lateen') {
    addJib(bowspritTip, new THREE.Vector3(0, P.freeboard * 0.72, L / 2 - 1.0), foreTop.h * 0.62 - P.draft * 0.3, foreTop.z, 0.72);
    addJib(new THREE.Vector3(bowspritTip.x * 0.55, bowspritTip.y - (bowspritTip.y - P.freeboard * 0.72) * 0.45, bowspritTip.z - L * 0.1),
      new THREE.Vector3(0, P.freeboard * 0.72, L / 2 - 2.0), foreTop.h * 0.78 - P.draft * 0.3, foreTop.z, 1.0);
  }

  // флаг на топе грот-мачты (потомок мачты — валится вместе с ней)
  const mainMastIdx = 1; // грот-мачта и у 2-, и у 3-мачтовых
  const mainMast = mastDefs[mainMastIdx];
  const { mesh: flag, mat: flagMat } = flagMesh(P.flagKind);
  flag.position.set(0.05, mainMast.h - P.draft * 0.3 - 0.4, 0);
  masts[mainMastIdx].add(flag);

  // пушки по бортам — по раскладке gunLayout: ИТОГО ровно gunsPerSide
  // на борт. Верхняя палуба — полные лафеты, закрытые деки — стволы
  // ЗА ПОРТАМИ: при закрытых крышках орудие УБРАНО внутрь (не видно),
  // при открытии — крышка откидывается вверх, лафет выезжает наружу
  // (Ship.portsOpen анимирует lid.rotation и gun.position).
  // Ядра вылетают ИЗ ДУЛА: muzzleLocal = позиция орудия + ось ствола.
  const gunsPort: THREE.Object3D[] = [];
  const gunsStarboard: THREE.Object3D[] = [];
  const gunPorts: GunPortVis[] = [];
  const barrelMat = new THREE.MeshStandardMaterial({
    // СВЕТЛЫЙ gunmetal — тёмное железо в metalness-пайплайне
    // отражает ~12% неба и выглядит «картонкой»; светлее + глянец +
    // усиленные отражения неба = видимый солнечный блик по стволу
    color: 0x4a4e57, metalness: 0.9, envMapIntensity: 1.6,
    normalMap: metalNormalTex(), roughnessMap: metalRoughTex(),
    normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.72,
  });
  const lidMat = new THREE.MeshStandardMaterial({
    color: 0x5a2f26, metalness: 0.06, roughness: 0.8,
    normalMap: woodNormalTex('hull'), roughnessMap: woodRoughTex('hull'),
    normalScale: new THREE.Vector2(0.4, 0.4),
  });
  for (const slot of gunLayout(P)) {
    const tt = clamp2((slot.z + L / 2) / L, 0, 1);
    const isDeck = slot.tier === 0;
    const prof = hullProfile(tt, P);
    for (const side of [-1, 1]) {
      const gun = new THREE.Group();
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 1.15, 12), barrelMat);
      barrel.rotation.z = Math.PI / 2;
      barrel.position.set(side * 0.62, 0.08, 0);
      gun.add(barrel);
      const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.55), darkMat);
      gun.add(carriage);
      gun.userData.side = side;
      gun.userData.tier = slot.tier;
      // дуло в локальных осях орудия (ствол длиной 1.15, центр 0.62)
      gun.userData.muzzleX = side * (0.62 + 0.575);
      if (isDeck) {
        gun.position.set(side * (prof.w * 0.9 - 0.15), prof.bulwark - 0.72, slot.z);
      } else {
        // закрытая батарея: УБРАНО (дульный срез за обшивкой),
        // при открытии порта лафет ВЫЕЗЖАЕТ наружу — ствол выдаётся
        // за борт на ~0.85 м (как при ran out guns перед залпом)
        const hw = hullHalfWidthAt(P, tt, slot.y);
        const baseX = side * (hw - 1.55);
        gun.position.set(baseX, slot.y, slot.z);
        gun.userData.baseX = baseX;
        gun.userData.slideX = side * 1.0;
        // крышка порта: петля ВВЕРХУ, закрыта — висит, закрывая порт;
        // открыта — откинута вверх-наружу, прижата к борту
        const lidH = Math.min(0.52, Math.max(0.4, P.freeboard * 0.095));
        const lid = new THREE.Group();
        lid.position.set(side * (hw + 0.05), slot.y + lidH / 2, slot.z);
        const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, lidH, 0.66), lidMat);
        lidMesh.position.y = -lidH / 2;
        lid.add(lidMesh);
        group.add(lid);
        gunPorts.push({ side: side as -1 | 1, z: slot.z, y: slot.y, lid, gun, open: 0 });
      }
      group.add(gun);
      // локальный −X = штирборт (правый борт), локальный +X = порт (левый)
      (side < 0 ? gunsStarboard : gunsPort).push(gun);
    }
  }

  // штурвал: пьедестал (не вращается) + колесо, начало координат
  // вращающейся группы — в ступице, чтобы крутился вокруг СВОЕЙ оси
  const wheelAsm = new THREE.Group();
  const wheel = new THREE.Group();
  const wheelR = 0.55;
  const hubY = 0.98; // высота оси над палубой
  const wheelTorus = new THREE.Mesh(new THREE.TorusGeometry(wheelR, 0.045, 6, 18), darkMat);
  wheel.add(wheelTorus);
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI;
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, wheelR * 2.3, 4), darkMat);
    spoke.rotation.z = ang;
    wheel.add(spoke);
    // рукоятки наружу, к рулевому (в сторону кормы, -Z)
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.26, 5), woodMat);
    handle.rotation.x = Math.PI / 2;
    handle.position.set(-Math.sin(ang) * (wheelR + 0.02), Math.cos(ang) * (wheelR + 0.02), -0.14);
    wheel.add(handle);
  }
  const wheelHub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.34, 8), woodMat);
  wheelHub.rotation.x = Math.PI / 2;
  wheel.add(wheelHub);
  wheel.position.set(0, hubY, 0);
  wheelAsm.add(wheel);
  // стойка, подкосы и ось — вне вращающейся группы
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, hubY, 0.12), darkMat);
  post.position.set(0, hubY / 2, 0);
  wheelAsm.add(post);
  for (const sgn of [-1, 1]) {
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.08, hubY * 1.2, 0.08), darkMat);
    brace.position.set(sgn * 0.24, hubY * 0.5, 0);
    brace.rotation.z = sgn * 0.55;
    wheelAsm.add(brace);
  }
  const wheelAxle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.55, 6), darkMat);
  wheelAxle.rotation.x = Math.PI / 2;
  wheelAxle.position.set(0, hubY, 0.12);
  wheelAsm.add(wheelAxle);
  // штурвал стоит НА КВАРТЕРДЕКЕ (если он есть) — ЗА мачтой, которая
  // сквозь него проходит; на судах без квартердека — в корме,
  // гарантированно не задевая бизань (жалоба «штурвал в мачте»)
  const wheelZ = wheelZFor(P);
  const wheelDeckY = P.quarter
    ? hullProfile(clamp2((wheelZ + L / 2) / L, 0, 1), P).bulwark - 1.0 + P.quarter
    : hullProfile(clamp2((wheelZ + L / 2) / L, 0, 1), P).bulwark - 1.0;
  wheelAsm.position.set(0, wheelDeckY, wheelZ);
  group.add(wheelAsm);

  // === КВАРТЕРДЕК (кормовая надстройка): настил + переборка +
  // трапы + балюстрада + нактоуз + световые люки + нагельные планки.
  // Концы с нагелей уходят к мачте и рвутся вместе с ней ===
  let quarterVis: QuarterVis | undefined;
  let binnacleNeedle: THREE.Object3D | undefined;
  let pinRopes: { mast: number; ends: { a: THREE.Vector3; b: THREE.Vector3 }[] } | undefined;
  if (P.quarter) {
    const qMastIdx = P.masts === 2 ? 1 : 2; // грот / бизань
    const qd = buildQuarterdeck(P, qMastIdx);
    group.add(qd.group);
    quarterVis = qd.vis;
    binnacleNeedle = qd.needle;
    if (qd.pinRopeEnds.length) pinRopes = { mast: qMastIdx, ends: qd.pinRopeEnds };
  }

  // палубный реквизит: гратинг-люк, бочки, канаты, кнехты, колокол, ядра,
  // сундук, ведро — одним мешом
  const props = new THREE.Mesh(buildDeckProps(P),
    new THREE.MeshStandardMaterial({
      vertexColors: true, side: THREE.DoubleSide,
      normalMap: woodNormalTex('spar'), roughnessMap: woodRoughTex('spar'),
      normalScale: new THREE.Vector2(0.35, 0.35), roughness: 1,
    }));
  props.castShadow = true;
  group.add(props);

  // шпиль, фонарь, якоря — строго на палубе
  const deckYAt = (t: number) => hullProfile(t, P).bulwark - 1.0;
  // шпиль — ПЕРЕД квартердеком (у судов с ним): не прячется под настилом
  const capstanZ = P.quarter
    ? quarterFrontZ(P) + Math.max(1.2, L * 0.05)
    : -L * 0.16;
  const capstan = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.7, 8), woodMat);
  capstan.position.set(0, deckYAt(clamp2((capstanZ + L / 2) / L, 0, 1)) + 0.35, capstanZ);
  group.add(capstan);
  const sternLantern = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8),
    new THREE.MeshStandardMaterial({
      color: 0xffd88a, emissive: 0xffaa33, emissiveIntensity: 1.6,
      metalness: 0.9,
      normalMap: metalNormalTex(), roughnessMap: metalRoughTex(),
      normalScale: new THREE.Vector2(0.4, 0.4), roughness: 1,
    }));
  sternLantern.position.set(0, P.freeboard * 1.15, -L / 2 - 0.15);
  group.add(sternLantern);
  let lantern: THREE.PointLight | undefined;
  // гальюнная фигура на носу — ШТАТНАЯ (конус); покупные фигуры
  // ставит setFigurehead (порт → «Убранство»), ломается как и штатная
  const figurehead = buildFigurehead(P, 'figure.stock');
  const figScale = THREE.MathUtils.clamp(P.freeboard * 0.30, 0.8, 1.6);
  figurehead.scale.setScalar(figScale);
  figurehead.position.set(0, P.freeboard * 1.02, L / 2 - 0.15);
  figurehead.rotation.x = 0.08;
  group.add(figurehead);
  // (простые якоря-коробки заменены настоящими якорями в группе мелких деталей)

  // такелаж (+ концы с нагельных планок квартердека — к своей мачте)
  const rigging = buildRigging(P, mastDefs, bowspritTip, pinRopes);
  group.add(rigging.lines);

  // надстройки-«замки» (когг) — силуэт виден издалека
  if (P.castleH) {
    const castles = new THREE.Mesh(buildCastles(P),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        normalMap: woodNormalTex('spar'), roughnessMap: woodRoughTex('spar'),
        normalScale: new THREE.Vector2(0.35, 0.35), roughness: 1,
      }));
    castles.castShadow = true;
    group.add(castles);
  }
  // наружный декор: пушечные порты, вельсы, кормовая галерея, нос/гальюн
  const ornGeo = buildHullOrnaments(P);
  if (ornGeo) {
    group.add(new THREE.Mesh(ornGeo,
      new THREE.MeshStandardMaterial({
        vertexColors: true, metalness: 0.15,
        normalMap: woodNormalTex('spar'), roughnessMap: woodRoughTex('spar'),
        normalScale: new THREE.Vector2(0.35, 0.35), roughness: 1,
      })));
  }
  // мелкие детали — только вблизи (LOD, переключает game.ts);
  // ванты с выбленками — отдельными парами на мачту (рвутся с ней)
  const detailRes = buildShipDetail(P, mastDefs);
  const detail = detailRes.group;
  detail.visible = false;
  group.add(detail);

  // вёсла (шебека, галера)
  let oarsVis: THREE.Object3D[] | undefined;
  if (P.oars) {
    const o = buildOars(P);
    group.add(o.group);
    oarsVis = o.oars;
  }

  // руль за транцем: перо на петлях, поворачивается вместе с рулём
  const rudLen = Math.min(2.6, Math.max(1.4, L * 0.045));
  const rudGeo = new THREE.BoxGeometry(0.15, Math.max(1.2, P.draft * 0.72), rudLen);
  rudGeo.translate(0, 0, -rudLen / 2); // ось вращения — передняя кромка
  const rudderMesh = new THREE.Mesh(rudGeo, darkMat);
  rudderMesh.position.set(0, -P.draft * 0.40, -L / 2 + 0.03);
  rudderMesh.castShadow = true;
  group.add(rudderMesh);

  const rig: SailRig = { sails };

  // ломаемые детали палубы: срываются попаданиями / давлением воды
  const breakables: THREE.Object3D[] = [wheelAsm, capstan, sternLantern, figurehead, rudderMesh];

  // материалы дерева для скина «цвет корабля» (собираем ДО того, как
  // в группу добавится экипаж с общим CREW_MAT — его тонировать нельзя)
  const tintSet = new Set<THREE.MeshStandardMaterial>();
  group.traverse(o => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    const arr = Array.isArray(m) ? m : [m];
    for (const mm of arr) {
      if ((mm as THREE.MeshStandardMaterial).isMeshStandardMaterial) tintSet.add(mm as THREE.MeshStandardMaterial);
    }
  });

  return {
    group, sails: rig, gunsPort, gunsStarboard, flag, flagMat,
    dims: { length: L, beam: P.beam, draft: P.draft }, outline,
    masts, lantern, wheel, detail, breakables, rigging, tintMats: [...tintSet],
    oars: oarsVis, rudderMesh,
    gunPorts, detailRigs: detailRes.detailRigs, hullMat,
    figurehead, binnacleNeedle, quarter: quarterVis,
  };
}

/** Включить фонарь (ночь) — только для игрока, ради перфа */
export function enableLantern(vis: ShipVisual) {
  if (vis.lantern) return;
  vis.lantern = new THREE.PointLight(0xffa644, 6, 26, 1.6);
  vis.lantern.position.set(0, vis.dims.length * 0.06, -vis.dims.length / 2 - 0.4);
  vis.group.add(vis.lantern);
}

// ---------- скины (порт): флаг, паруса, корпус ----------
/** Сменить флаг корабля (купленный скин) */
export function setFlagKind(vis: ShipVisual, kind: FlagKind) {
  const old = vis.flagMat.uniforms.uTex.value as THREE.Texture;
  vis.flagMat.uniforms.uTex.value = makeFlagTexture(kind);
  old.dispose();
}

/** Сменить цвет парусов (у каждого полотна свой uniform) */
export function setSailColor(vis: ShipVisual, hex: number) {
  const c = new THREE.Color(hex);
  for (const s of vis.sails.sails) (s.mat.uniforms.uColor.value as THREE.Color).copy(c);
}

/** Сменить тон корпуса/палубы — множитель над вершинными цветами дерева */
export function setHullTint(vis: ShipVisual, hex: number) {
  const c = new THREE.Color(hex);
  for (const m of vis.tintMats) m.color.copy(c);
}

// ---------- гальюнные фигуры и украшения бортов (порт) ----------
/** Пресет по id фигуры (для покупок/сохранений) */
export function setFigurehead(vis: ShipVisual, P: ShipPreset, id: string) {
  const old = vis.figurehead;
  const pos = old.position.clone();
  const rot = old.rotation.clone();
  const broken = !old.visible; // фигура уже сорвана — новая тоже сорвана
  vis.group.remove(old);
  old.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
  const fh = buildFigurehead(P, id);
  fh.scale.setScalar(THREE.MathUtils.clamp(P.freeboard * 0.30, 0.8, 1.6));
  fh.position.copy(pos);
  fh.rotation.copy(rot);
  fh.visible = !broken;
  vis.group.add(fh);
  vis.figurehead = fh;
  // держим ломаемые детали в синхроне (damageProp/clearDamage)
  const i = vis.breakables.indexOf(old);
  if (i >= 0) vis.breakables[i] = fh;
}

/** Применить купленное украшение бортов: заново собрать тройку
 *  холстов (золото на карте цвета + ТЁМНОЕ золото на карте
 *  шероховатости = глянцевый металл + СВЕТЛОЕ на металличности) */
export function setDecoration(vis: ShipVisual, P: ShipPreset, decoId: string) {
  const tex = makeHullTextures(P, decoId,
    gunLayout(P).filter(s => s.tier > 0).map(s => ({ z: s.z, y: s.y })));
  vis.hullMat.map = tex.map;
  vis.hullMat.roughnessMap = tex.rough;
  vis.hullMat.metalnessMap = tex.metal;
  vis.hullMat.needsUpdate = true;
}

/** Цена судна на верфи (золото) — от ТТХ; легендарные суда дороже */
export function shipPrice(P: ShipPreset): number {
  if (P.id === 'blackpearl') return 35000; // легенда не продаётся дёшево
  const p = P.hullHP * 3 + Math.pow(P.gunsPerSide, 1.6) * 90
    + P.maxCrew * 3 + P.cargo * 0.8 + P.maxSpeed * 120;
  return Math.round(p / 10) * 10;
}
