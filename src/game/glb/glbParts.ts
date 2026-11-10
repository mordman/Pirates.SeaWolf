import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ============================================================
// GLB-СИСТЕМА ЗАМЕНЫ ДЕТАЛЕЙ: единый реестр заменяемых частей
// мира/корабля с описанием и промптом генерации, асинхронная
// загрузка .glb с автоматическим фолбэком на процедурную
// геометрию (нет файла / ошибка сети — остаётся процедурная).
// ============================================================

/** Заменяемая часть: описание + промпт + файл модели + ГАБАРИТЫ
 *  (Ш×В×Г в метрах — чтобы готовую GLB-модель подогнать под
 *  правильный размер: нормализация по высоте или ручной масштаб) */
export interface GLBPartSpec {
  id: string;          // ключ вида растительности/детали ('palm', ...)
  label: string;       // человекочитаемое название
  group: PartGroup;    // категория каталога (вкладка «Ресурсы»)
  target: string;      // куда встраивается (veg.palm / ship.figurehead ...)
  /** ЕДИНОЕ ОПИСАНИЕ детали — что это, габариты, стиль, ограничения */
  description: string;
  /** Габариты процедурной модели Ш×В×Г, м — эталон для подгонки GLB */
  size: { w: number; h: number; d: number };
  /** Промпт для генерации модели внешним инструментом (текст-в-3D) */
  prompt: string;
  /** URL .glb-файла; null — модели пока нет, работает процедурная */
  file: string | null;
  /** Целевая высота нормализации, м (0 — не нормализовать) */
  normHeight: number;
  /** подмена включена в рантайме (растительность — сразу) */
  wired: boolean;
}

export type PartGroup = 'Растительность' | 'Корабельные детали' | 'Люди' | 'Постройки' | 'Животные';

export const PART_GROUP_ORDER: PartGroup[] =
  ['Растительность', 'Корабельные детали', 'Люди', 'Постройки', 'Животные'];

/** Реестр ВСЕХ процедурных объектов игры (Task 37) — каталог для
 *  подмены на GLB. Размеры — фактические габариты процедурных
 *  моделей в метрах (Ш×В×Г); normHeight — высота нормализации
 *  GLB при загрузке (0 — слот ещё не подключён к подмене).
 *  РАБОЧИЙ конвейер подмены — вся растительность (veg.*): файл
 *  кладётся в public/models/<id>.glb и прописывается в file. */
export const PART_REGISTRY: GLBPartSpec[] = [
  // ================= РАСТИТЕЛЬНОСТЬ (подмена РАБОТАЕТ) =================
  {
    id: 'palm',
    label: 'Кокосовая пальма',
    group: 'Растительность',
    target: 'veg.palm',
    description: 'Пальма архипелага: изогнутый ствол 8.5 м, 7 веерных листьев-крон, гроздь кокосов у кроны. Ставится инстансами на пляжах и в гаванях всех островов; ветром качается верхняя часть. Рабочий демо-конвейер GLB.',
    size: { w: 3.4, h: 8.9, d: 3.4 },
    prompt: 'Low-poly coconut palm tree for a stylized pirate game, curved slightly bent trunk about 8.5 m tall, 9 drooping pinnate fronds forming the crown, a small cluster of coconuts at the crown base, warm brown trunk, two-tone green fronds, flat vertex colors, no textures, under 350 triangles, single mesh, Y-up, origin at trunk base.',
    file: '/models/palm_demo.glb',
    normHeight: 8.6,
    wired: true,
  },
  {
    id: 'ficus',
    label: 'Фикус (джунгли)',
    group: 'Растительность',
    target: 'veg.ficus',
    description: 'Широкий фикус внутренних джунглей: коренастый ствол 4.2 м и раскидистая крона до 6.6 м в поперечнике из трёх сфер листвы, тёмно-зелёные листья.',
    size: { w: 6.6, h: 7.4, d: 6.6 },
    prompt: 'Low-poly banyan-like ficus tree for a stylized pirate game, stout trunk about 4.5 m, wide spreading canopy up to 6.5 m across made of three foliage spheres, dark green foliage clumps, flat vertex colors, no textures, under 400 triangles, single mesh, Y-up, origin at trunk base.',
    file: null,
    normHeight: 7.2,
    wired: true,
  },
  {
    id: 'jungle',
    label: 'Дерево джунглей',
    group: 'Растительность',
    target: 'veg.jungle',
    description: 'Высокое дерево густых джунглей: ствол 5.4 м, вытянутая крона-эллипсоид до 8.4 м — основной «непроходимый» массив вместе с фикусами.',
    size: { w: 4.5, h: 8.4, d: 4.5 },
    prompt: 'Low-poly tall jungle tree for a stylized pirate game, straight trunk about 5.4 m, elongated ellipsoid canopy on top reaching 8.4 m total height, layered green foliage, flat vertex colors, no textures, under 400 triangles, single mesh, Y-up, origin at trunk base.',
    file: null,
    normHeight: 8.4,
    wired: true,
  },
  {
    id: 'bush',
    label: 'Кустарник',
    group: 'Растительность',
    target: 'veg.bush',
    description: 'Низкий куст из двух сфер листвы — нижний ярус растительности: от открытых лугов до подлеска джунглей; рубится саблей на берегу.',
    size: { w: 2.0, h: 1.45, d: 2.0 },
    prompt: 'Low-poly bush for a stylized pirate game, two overlapping foliage spheres about 1.4 m tall and 2 m wide, mid-green with slight color variation, flat vertex colors, no textures, under 120 triangles, single mesh, Y-up, origin at ground.',
    file: null,
    normHeight: 1.45,
    wired: true,
  },
  {
    id: 'bamboo',
    label: 'Бамбуковая рощица',
    group: 'Растительность',
    target: 'veg.bamboo',
    description: 'Пучок из 5 стеблей бамбука 5.2 м с лёгкими наклонами — светлые заросли на склонах и у троп.',
    size: { w: 1.1, h: 5.3, d: 1.1 },
    prompt: 'Low-poly bamboo clump for a stylized pirate game, five thin yellow-green culms about 5.2 m tall with slight random tilts, small leaf clusters on top, flat vertex colors, no textures, under 200 triangles, single mesh, Y-up, origin at ground.',
    file: null,
    normHeight: 5.2,
    wired: true,
  },
  {
    id: 'stump',
    label: 'Сухой пень',
    group: 'Растительность',
    target: 'veg.stump',
    description: 'Обломанное мёртвое дерево: рваная наклонная верхушка и 4 корневые лапы у основания — мёртвый лес на скалистых островах.',
    size: { w: 1.3, h: 1.95, d: 1.3 },
    prompt: 'Low-poly dead tree stump for a stylized pirate game, broken jagged top about 1.9 m tall, four root flares at the base, dry grey-brown wood, flat vertex colors, no textures, under 150 triangles, single mesh, Y-up, origin at ground.',
    file: null,
    normHeight: 1.95,
    wired: true,
  },
  {
    id: 'rock',
    label: 'Камень',
    group: 'Растительность',
    target: 'veg.rock',
    description: 'Двенадцатигранный камень 2.6 м — россыпь на склонах и каменистых берегах.',
    size: { w: 2.6, h: 2.6, d: 2.6 },
    prompt: 'Low-poly rock for a stylized pirate game, dodecahedron boulder about 2.6 m across, warm grey with flat facets, flat vertex colors, no textures, under 60 triangles, single mesh, Y-up, origin at ground.',
    file: null,
    normHeight: 2.6,
    wired: true,
  },
  {
    id: 'boulder',
    label: 'Валун берега',
    group: 'Растительность',
    target: 'veg.boulder',
    description: 'Сплюснутый валун с двумя соседями поменьше — каменные осыпи у кромки воды и на рок-берегах.',
    size: { w: 4.1, h: 1.4, d: 3.1 },
    prompt: 'Low-poly coastal boulder cluster for a stylized pirate game, one large flattened icosahedron boulder 4 m wide and 1.4 m tall with two smaller companions, grey weathered stone, flat vertex colors, no textures, under 150 triangles, single mesh, Y-up, origin at ground.',
    file: null,
    normHeight: 1.4,
    wired: true,
  },
  // ================= КОРАБЕЛЬНЫЕ ДЕТАЛИ =================
  {
    id: 'cannon',
    label: 'Корабельная пушка',
    group: 'Корабельные детали',
    target: 'ship.cannon',
    description: 'Бортовое орудие на лафете: чугунный ствол 1.15 м (дульный срез на 1.2 м от оси поворота) на деревянном лафете-платформе; стоит в пушечном порту или на верхней палубе.',
    size: { w: 1.2, h: 0.45, d: 0.6 },
    prompt: 'Low-poly age of sail naval cannon on a wooden carriage, dark cast iron barrel 1.15 m long pointing along +X, wooden truck carriage with two wheels, total footprint 1.2 x 0.45 x 0.6 m, stylized pirate game, flat vertex colors, no textures, under 500 triangles, Y-up, origin at deck under the carriage, barrel axis along +X.',
    file: null,
    normHeight: 0,
    wired: false,
  },
  {
    id: 'hatch',
    label: 'Решётчатый люк (гратинг)',
    group: 'Корабельные детали',
    target: 'ship.hatch',
    description: 'Палубный световой люк между мачтами: деревянный кооминг-рама + решётка из продольных и поперечных планок. Размер зависит от корабля: у шлюпа «Бриз» ≈ 3.5×2.2 м.',
    size: { w: 3.5, h: 0.3, d: 2.2 },
    prompt: 'Low-poly ship deck grating hatch for a stylized pirate game, wooden coaming frame 3.5 x 2.2 m with slatted grid of longitudinal and cross planks inside, dark oak wood, flat vertex colors, no textures, under 300 triangles, single mesh, Y-up, origin at deck level.',
    file: null,
    normHeight: 0,
    wired: false,
  },
  {
    id: 'barrel',
    label: 'Бочка',
    group: 'Корабельные детали',
    target: 'ship.barrel',
    description: 'Матросская бочка: клёпаный корпус 0.68×0.8 м с двумя железными обручами; на палубах стоит и лежит.',
    size: { w: 0.68, h: 0.8, d: 0.68 },
    prompt: 'Low-poly wooden barrel for a stylized pirate game, staved barrel 0.68 m diameter and 0.8 m tall with two dark iron hoops, warm brown wood, flat vertex colors, no textures, under 200 triangles, single mesh, Y-up, origin at base.',
    file: null,
    normHeight: 0,
    wired: false,
  },
  {
    id: 'figurehead',
    label: 'Гальюнная фигура (нос корабля)',
    group: 'Корабельные детали',
    target: 'ship.figurehead',
    description: 'Резная фигура на форштевне парусника: русалка/лев/череп 1–1.4 м, позолоченное дерево, крепится на наклонный форштевень.',
    size: { w: 0.5, h: 1.3, d: 0.6 },
    prompt: 'Low-poly ship figurehead of a golden mermaid, carved gilded wood, about 1.2 m tall, stylized pirate age of sail, flat vertex colors, no textures, under 600 triangles, Y-up, origin at mounting base.',
    file: null,
    normHeight: 0,
    wired: false,
  },
  {
    id: 'wheel',
    label: 'Штурвал',
    group: 'Корабельные детали',
    target: 'ship.wheel',
    description: 'Рулевой штурвал на квартердеке: колесо диаметром 1.1 м с 8 рукоятками, смотрящими к рулевому, на деревянном пьедестале; вращается при перекладке руля.',
    size: { w: 1.2, h: 1.3, d: 0.35 },
    prompt: 'Low-poly ship steering wheel for a stylized pirate game, spoked wooden wheel 1.1 m diameter with 8 outward handles, on a wooden pedestal stand, total height 1.3 m, dark oak with brass hub, flat vertex colors, no textures, under 300 triangles, Y-up, origin at deck, wheel axis along Z.',
    file: null,
    normHeight: 0,
    wired: false,
  },
  {
    id: 'boat',
    label: 'Шлюпка-ял',
    group: 'Корабельные детали',
    target: 'ship.boat',
    description: 'Корабельная гребная шлюпка (ял): острая носовая оконечность, транцевая корма, 3 банки, два вёсла. Длина зависит от корабля-носителя: у шлюпа ≈ 3.7 м, у крупных судов до 6.2 м. Спускается на воду и управляется.',
    size: { w: 1.0, h: 0.9, d: 3.7 },
    prompt: 'Low-poly ship\'s boat (cutter yawl) for a stylized pirate game, clinker-built hull 3.7 m long, 1 m wide, fine bow entry and transom stern, three rowing benches, two oars laid along the gunwales, warm wood with painted stern panel, flat vertex colors, no textures, under 800 triangles, Y-up, keel at y=0, bow pointing +Z.',
    file: null,
    normHeight: 0,
    wired: false,
  },
  // ================= ЛЮДИ =================
  {
    id: 'pirate',
    label: 'Матрос / пират / житель',
    group: 'Люди',
    target: 'crew.figure',
    description: 'Фигурка человека (рост 1.72 м): экипаж кораблей (капитан в треуголке, боцман, канониры, вахтенные, гребцы), пираты, рыбаки на пирсах и жители деревень — одна процедурная фигура на всех. Гибы/попадания работают по CAPSULE-хитбоксу, ноги — анимация шага.',
    size: { w: 0.5, h: 1.72, d: 0.35 },
    prompt: 'Low-poly sailor figure for a stylized pirate game, standing pose, 1.72 m tall, simple boxy body with shirt, pants, bare feet or boots, no face details, arms down along the body, flat vertex colors, no textures, under 250 triangles, single mesh, Y-up, origin at feet, legs separated for walk animation.',
    file: null,
    normHeight: 0,
    wired: false,
  },
  {
    id: 'cat',
    label: 'Корабельный кот',
    group: 'Люди',
    target: 'crew.cat',
    description: 'Кот (длина 0.58 м): корабельные коты игрока (гуляют по палубе, ловят мышей) и режим «экипаж из котов» — капитан-кот в треуголке у штурвала. 4 ноги диагональной рысью + хвост.',
    size: { w: 0.28, h: 0.42, d: 0.58 },
    prompt: 'Low-poly cat for a stylized pirate game, sitting-to-standing quadruped 0.58 m long nose to tail base and 0.4 m tall, simple boxy body, head with ears, four separate legs and a tail, various fur colors (ginger, grey, black, white socks), flat vertex colors, no textures, under 200 triangles, Y-up, origin at ground, legs separated for trot animation.',
    file: null,
    normHeight: 0,
    wired: false,
  },
  // ================= ПОСТРОЙКИ =================
  {
    id: 'hut',
    label: 'Хижина деревни',
    group: 'Постройки',
    target: 'port.hut',
    description: 'Жилая хижина порта/деревни: стены-коробка 8.4×7 м высотой 4.2 м + четырёхскатная соломенная крыша (верх 7.5 м) + дверь. Расстановка зависит от уровня порта.',
    size: { w: 8.4, h: 7.5, d: 7.0 },
    prompt: 'Low-poly tropical hut for a stylized pirate game, wooden plank walls 8.4 x 7 m and 4.2 m tall, four-sided thatched palm roof peaking at 7.5 m, single plank door, weathered brown wood, straw-colored roof, flat vertex colors, no textures, under 400 triangles, single mesh, Y-up, origin at ground.',
    file: null,
    normHeight: 0,
    wired: false,
  },
  {
    id: 'pier',
    label: 'Пирс (причал)',
    group: 'Постройки',
    target: 'port.pier',
    description: 'Деревянный пирс гавани: настил 7.2 м шириной и 62–124 м длиной (по уровню порта) на сваях, два фонаря на входе. Точка швартовки кораблей.',
    size: { w: 7.2, h: 5.5, d: 124 },
    prompt: 'Low-poly wooden pier for a stylized pirate game, plank deck 7.2 m wide on driven timber piles, two lantern posts at the sea end, weathered grey-brown wood, modular 20 m section that tiles along its length, flat vertex colors, no textures, under 600 triangles, Y-up, origin at waterline center of section, length along Z.',
    file: null,
    normHeight: 0,
    wired: false,
  },
  {
    id: 'fishingBoat',
    label: 'Рыбацкая лодка',
    group: 'Постройки',
    target: 'port.fishingBoat',
    description: 'Рыбацкая плоскодонка гавани (3.5 м): качается у пирса на волнах или вытащена на песок; тонет от разрыва снаряда рядом.',
    size: { w: 0.95, h: 0.75, d: 3.5 },
    prompt: 'Low-poly fishing skiff for a stylized pirate game, flat-bottomed rowboat 3.5 m long and under 1 m wide, small transom stern, oars inside, faded painted hull with visible plank lines, flat vertex colors, no textures, under 300 triangles, single mesh, Y-up, keel at y=0, bow pointing +Z.',
    file: null,
    normHeight: 0,
    wired: false,
  },
  {
    id: 'marketStall',
    label: 'Рыночный прилавок',
    group: 'Постройки',
    target: 'port.market',
    description: 'Прилавок городского рынка (порты уровня 2–3): стол на четырёх ножках, полосатый тент на двух шестах. Четыре штуки в ряд у площади.',
    size: { w: 4.6, h: 2.6, d: 2.8 },
    prompt: 'Low-poly market stall for a stylized pirate game, wooden table 4.2 x 2.1 m on four legs with a striped canvas awning on two poles, total height 2.6 m, red-and-cream or blue-and-cream stripes, flat vertex colors, no textures, under 250 triangles, single mesh, Y-up, origin at ground.',
    file: null,
    normHeight: 0,
    wired: false,
  },
  // ================= ЖИВОТНЫЕ =================
  {
    id: 'gull',
    label: 'Чайка',
    group: 'Животные',
    target: 'animals.gull',
    description: 'Чайка в полёте (размах 1.1 м): кружит над островами и ходит за кораблём игрока; крылья машут шейдером, белый силуэт.',
    size: { w: 1.1, h: 0.4, d: 0.45 },
    prompt: 'Low-poly seagull in flight for a stylized pirate game, spread wings 1.1 m span, simple flat silhouette body, white with light grey wingtips, flat vertex colors, no textures, under 60 triangles, single mesh, Y-up, origin at body center, wings in X plane for flap shader.',
    file: null,
    normHeight: 0,
    wired: false,
  },
  {
    id: 'crab',
    label: 'Краб',
    group: 'Животные',
    target: 'animals.crab',
    description: 'Прибрежный краб: тёмно-оранжевое тело 0.5 м с двумя клешнями, бегает по пляжам трёх островов.',
    size: { w: 0.76, h: 0.25, d: 0.5 },
    prompt: 'Low-poly crab for a stylized pirate game, dark orange boxy body 0.5 m wide with two raised claws, small legs implied by silhouette, flat vertex colors, no textures, under 100 triangles, single mesh, Y-up, origin at ground.',
    file: null,
    normHeight: 0,
    wired: false,
  },
  {
    id: 'turtle',
    label: 'Черепаха',
    group: 'Животные',
    target: 'animals.turtle',
    description: 'Морская черепаха 2 м: оливковый панцирь-эллипсоид, голова и ласты; медленно кружит у рифов.',
    size: { w: 1.5, h: 0.65, d: 2.0 },
    prompt: 'Low-poly sea turtle for a stylized pirate game, olive ellipsoid shell 1.5 m wide and 2 m long, head and four flippers, swimming pose, flat vertex colors, no textures, under 150 triangles, single mesh, Y-up, origin at body center, heading +Z.',
    file: null,
    normHeight: 0,
    wired: false,
  },
  {
    id: 'monkey',
    label: 'Обезьяна',
    group: 'Животные',
    target: 'animals.monkey',
    description: 'Обезьяна джунглей (0.85 м с согнутыми лапами): прыгает между точками в глубине островов, коричневая шкура.',
    size: { w: 0.6, h: 0.85, d: 0.55 },
    prompt: 'Low-poly monkey for a stylized pirate game, crouching brown primate about 0.85 m tall, boxy body, round head with ears, long curved tail, flat vertex colors, no textures, under 120 triangles, single mesh, Y-up, origin at ground.',
    file: null,
    normHeight: 0,
    wired: false,
  },
  {
    id: 'boar',
    label: 'Кабан',
    group: 'Животные',
    target: 'animals.boar',
    description: 'Кабан 1.7 м: коренастое тело, вытянутая морда с клыками; бродит по лугам четырёх островов.',
    size: { w: 1.7, h: 0.76, d: 0.55 },
    prompt: 'Low-poly wild boar for a stylized pirate game, stocky brown body 1.7 m long and 0.76 m tall, elongated snout with small tusks, short legs, flat vertex colors, no textures, under 150 triangles, single mesh, Y-up, origin at ground, heading +X.',
    file: null,
    normHeight: 0,
    wired: false,
  },
  {
    id: 'sharkFin',
    label: 'Плавник акулы',
    group: 'Животные',
    target: 'animals.shark',
    description: 'Спинной плавник акулы: тёмный треугольный плавник 1.15 м, режет воду по кругам у скал и рифов.',
    size: { w: 0.35, h: 1.15, d: 0.2 },
    prompt: 'Low-poly shark dorsal fin for a stylized pirate game, dark triangular fin 1.15 m tall cutting the water surface, slight curve, slate grey, flat vertex colors, no textures, under 30 triangles, single mesh, Y-up, origin at waterline base.',
    file: null,
    normHeight: 0,
    wired: false,
  },
];

export type PartStatus = 'proc' | 'loading' | 'glb' | 'error';

/** Загрузчик GLB-частей: качает файлы, нормализует и подменяет
 *  геометрию через колбэк; любая ошибка = тихий фолбэк на процедурную. */
export class GLBPartSystem {
  private loader = new GLTFLoader();
  private cache = new Map<string, THREE.BufferGeometry>();
  /** статус по id части — для настроек/телеметрии */
  status: Record<string, PartStatus> = {};
  /** сколько инстансов переведено на GLB (по id) */
  applied: Record<string, number> = {};
  /** последний промах (url) — телеметрия фолбэка */
  lastError = '';

  constructor(
    /** применить геометрию к миру (null — вернуть процедурную);
     *  возвращает число затронутых инстансов */
    private applyTo: (id: string, geo: THREE.BufferGeometry | null) => number,
  ) {
    for (const p of PART_REGISTRY) this.status[p.id] = p.file ? 'loading' : 'proc';
  }

  /** Запустить загрузку всех частей с файлами */
  loadAll() {
    for (const p of PART_REGISTRY) if (p.file) void this.load(p);
  }

  /** Выключить GLB (настройка): вернуть процедурные геометрии */
  disableAll() {
    for (const p of PART_REGISTRY) {
      if (this.status[p.id] === 'glb') {
        this.applied[p.id] = this.applyTo(p.id, null);
        this.status[p.id] = 'proc';
      }
    }
  }

  /** Включить GLB: подставить уже загруженные (или загрузить) */
  enableAll() {
    for (const p of PART_REGISTRY) {
      const geo = this.cache.get(p.id);
      if (geo) {
        this.applied[p.id] = this.applyTo(p.id, geo);
        this.status[p.id] = 'glb';
      } else if (p.file) {
        this.status[p.id] = 'loading';
        void this.load(p);
      }
    }
  }

  private async load(spec: GLBPartSpec): Promise<void> {
    if (!spec.file) return;
    try {
      const cached = this.cache.get(spec.id);
      if (cached) {
        this.applied[spec.id] = this.applyTo(spec.id, cached);
        this.status[spec.id] = 'glb';
        return;
      }
      const gltf = await this.loader.loadAsync(spec.file);
      const geo = glbToGeometry(gltf.scene, spec.normHeight);
      if (!geo) throw new Error('пустая сцена');
      this.cache.set(spec.id, geo);
      this.applied[spec.id] = this.applyTo(spec.id, geo);
      this.status[spec.id] = 'glb';
    } catch (e) {
      // фолбэк: остаётся процедурная деталь, мир продолжает работать
      this.lastError = `${spec.id}: ${(e as Error).message}`;
      this.status[spec.id] = 'error';
      this.applyTo(spec.id, null);
    }
  }

  /** Телеметрия для E2E/настроек */
  info(): Record<string, { status: PartStatus; applied: number; file: string | null }> {
    const out: Record<string, { status: PartStatus; applied: number; file: string | null }> = {};
    for (const p of PART_REGISTRY) out[p.id] = { status: this.status[p.id], applied: this.applied[p.id] ?? 0, file: p.file };
    return out;
  }
}

/** Сцена GLB → одна геометрия с вершинными цветами:
 *  собираем все меши, выпрямляем трансформы, при отсутствии
 *  COLOR_0 заливаем белым (материал растительности vertexColors),
 *  нормализуем высоту и ставим базис на y=0. */
export function glbToGeometry(scene: THREE.Object3D, normHeight: number): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    parts.push(g);
  });
  if (!parts.length) return null;
  // выравнивание наборов атрибутов: position+normal+color
  for (const g of parts) {
    if (!g.getAttribute('color')) {
      const n = g.getAttribute('position').count;
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    }
    // лишние атрибуты (uv и пр.) мешают merge — убираем
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);
    }
    if (!g.getAttribute('normal')) g.computeVertexNormals();
  }
  let merged = mergeGeometries(parts, false);
  if (!merged) {
    // индексированные + неиндексированные не слились — выпрямляем
    for (const g of parts) if (g.index) g.toNonIndexed();
    merged = mergeGeometries(parts, false);
  }
  if (!merged) return null;
  merged.computeBoundingBox();
  const bb = merged.boundingBox!;
  if (normHeight > 0) {
    const s = normHeight / Math.max(0.01, bb.max.y - bb.min.y);
    merged.scale(s, s, s);
    merged.computeBoundingBox();
  }
  merged.translate(0, -merged.boundingBox!.min.y, 0);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}
