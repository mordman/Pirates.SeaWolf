import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ============================================================
// GLB-СИСТЕМА ЗАМЕНЫ ДЕТАЛЕЙ: единый реестр заменяемых частей
// мира/корабля с описанием и промптом генерации, асинхронная
// загрузка .glb с автоматическим фолбэком на процедурную
// геометрию (нет файла / ошибка сети — остаётся процедурная).
// ============================================================

/** Заменяемая часть: описание + промпт + файл модели */
export interface GLBPartSpec {
  id: string;          // ключ вида растительности/детали ('palm', ...)
  label: string;       // человекочитаемое название
  target: string;      // куда встраивается (veg.palm / ship.figurehead …)
  /** ЕДИНОЕ ОПИСАНИЕ детали — что это, габариты, стиль, ограничения */
  description: string;
  /** Промпт для генерации модели внешним инструментом (текст-в-3D) */
  prompt: string;
  /** URL .glb-файла; null — модели пока нет, работает процедурная */
  file: string | null;
  /** Целевая высота нормализации, м (0 — не нормализовать) */
  normHeight: number;
}

/** Реестр заменяемых частей: пальма — РАБОЧИЙ демо-конвейер
 *  (public/models/palm_demo.glb), остальные — описания и промпты
 *  для будущих моделей; без файла используется процедурная деталь. */
export const PART_REGISTRY: GLBPartSpec[] = [
  {
    id: 'palm',
    label: 'Кокосовая пальма',
    target: 'veg.palm',
    description: 'Пальма архипелага: изогнутый ствол 8–9 м, 9–10 веерных листьев-крон, гроздь кокосов у кроны. Ставится инстансами на пляжах и в гаванях всех островов; ветром качается верхняя часть.',
    prompt: 'Low-poly coconut palm tree for a stylized pirate game, curved slightly bent trunk about 8.5 m tall, 9 drooping pinnate fronds forming the crown, a small cluster of coconuts at the crown base, warm brown trunk, two-tone green fronds, flat vertex colors, no textures, under 350 triangles, single mesh, Y-up, origin at trunk base.',
    file: '/models/palm_demo.glb',
    normHeight: 8.6,
  },
  {
    id: 'ficus',
    label: 'Фикус (джунгли)',
    target: 'veg.ficus',
    description: 'Широкий фикус внутренних джунглей: коренастый ствол 4–5 м и раскидистая крона диаметром до 5 м, тёмно-зелёные листья.',
    prompt: 'Low-poly banyan-like ficus tree for a stylized pirate game, stout trunk about 4.5 m, wide spreading canopy up to 5 m across, dark green foliage clumps, flat vertex colors, no textures, under 400 triangles, single mesh, Y-up, origin at trunk base.',
    file: null,
    normHeight: 7.2,
  },
  {
    id: 'figurehead',
    label: 'Гальюнная фигура (нос корабля)',
    target: 'ship.figurehead',
    description: 'Резная фигура на форштевне парусника: русалка/лев/череп 1–1.4 м, позолоченное дерево, крепится на наклонный форштевень.',
    prompt: 'Low-poly ship figurehead of a golden mermaid, carved gilded wood, about 1.2 m tall, stylized pirate age of sail, flat vertex colors, no textures, under 600 triangles, Y-up, origin at mounting base.',
    file: null,
    normHeight: 0,
  },
  {
    id: 'cannon',
    label: 'Корабельная пушка',
    target: 'ship.cannon',
    description: 'Бортовое орудие на лафете: ствол 1.2–1.6 м чугунный тёмный, деревянный лафет с колёсами, стоит в пушечном порту.',
    prompt: 'Low-poly age of sail naval cannon on a wooden carriage, dark cast iron barrel about 1.4 m, wooden truck carriage with two wheels, stylized pirate game, flat vertex colors, no textures, under 500 triangles, Y-up, origin at deck.',
    file: null,
    normHeight: 0,
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
