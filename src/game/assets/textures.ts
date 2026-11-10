import * as THREE from 'three';

// ============================================================
// ЦЕНТРАЛЬНЫЙ ФАЙЛ ТЕКСТУР (Task 39): ЕДИНОЕ место, где
// перечислены ВСЕ поверхности игры, которые можно покрыть
// СВОЕЙ текстурой по ссылке (URL) вместо процедурной.
//
// Что здесь есть:
//  1) TEXTURE_SLOTS — каталог слотов (земля, борт, палуба,
//     парус, вода): подписи, подсказки, повторяемость плитки,
//     лимиты ссылок. Настройки (вкладка «Ресурсы»), загрузчик
//     и E2E читают ОДИН этот список — добавить новый слот =
//     добавить запись сюда + register*() в месте создания
//     материала.
//  2) textureUrls — реестр URL-текстур: хранит ссылку и
//     состояние загрузки на слот, грузит через TextureLoader
//     (CORS, sRGB), раскладывает текстуру по ЗАРЕГИСТРИРОВАННЫМ
//     материалам (WeakRef — мёртвые материалы не мешают GC)
//     и оповещает слушателей (рельеф пересобирает материал).
//
// Правила ссылок — единые для всех слотов (как в UI):
//   • http(s)://… или /относительный/путь — до 600 символов
//   • data:image/… (вшитая картинка) — до 200 000 символов
//   • пустая строка — процедурная текстура игры (по умолчанию)
// Пока ссылка грузится или при ошибке — остаётся ПРОЦЕДУРНАЯ
// текстура (ничего не чернеет).
// ============================================================

/** Идентификаторы слотов (ключи в настройках assets.texUrls) */
export type TextureSlotId = 'terrain' | 'hull' | 'deck' | 'sail' | 'water'
  | 'sand' | 'grass' | 'dirt' | 'rock';

/** Описание слота текстуры — каталог для UI/загрузчика/тестов */
export interface TextureSlotDef {
  id: TextureSlotId;
  /** Подпись в настройках */
  label: string;
  /** Что за поверхность — подсказка игроку */
  hint: string;
  /** Пример в placeholder поля ввода */
  placeholder: string;
  /** Повтор плитки (wrapS/T repeat) для Standard-материалов.
   *  UV корпуса/палубы — в метрах: 0.35 ≈ плитка каждые ~3 м.
   *  Для воды/рельефа не используется (свой масштаб в шейдере) */
  repeat: [number, number];
  /** Максимум символов для http(s)/относительной ссылки */
  maxLink: number;
  /** Максимум символов для data:URL */
  maxDataUrl: number;
  /** Task 40: группа «рельеф» — поля показываются в разделе
   *  «Текстуры островов» (режим url — слот terrain, режим zones —
   *  слоты зон), а НЕ в общем списке «Свои текстуры» */
  group?: 'terrain';
}

/** КАТАЛОГ ВСЕХ СЛОТОВ — единственное место перечисления */
export const TEXTURE_SLOTS: TextureSlotDef[] = [
  {
    id: 'terrain',
    label: 'Земля (острова)',
    hint: 'рельеф: песок/трава/скалы поверх цвета биома; включается режимом «Своя текстура» выше',
    placeholder: 'https://…/sand_ground.jpg',
    repeat: [1, 1],          // масштаб — настройка «Масштаб текстуры» (texScale)
    maxLink: 600, maxDataUrl: 200000,
    group: 'terrain',
  },
  {
    id: 'hull',
    label: 'Доски бортов (корпус корабля)',
    hint: 'обшивка бортов всех судов; краска ватерлинии/поясов заменяется вашей картинкой',
    placeholder: 'https://…/planks.png',
    repeat: [0.35, 0.35],    // UV корпуса — в метрах: плитка ≈ каждые 3 м
    maxLink: 600, maxDataUrl: 200000,
  },
  {
    id: 'deck',
    label: 'Палуба (настил)',
    hint: 'доски палубы с конопачением всех судов',
    placeholder: 'https://…/deck_wood.jpg',
    repeat: [0.3, 0.3],      // UV палубы — в метрах: плитка ≈ каждые 3.3 м
    maxLink: 600, maxDataUrl: 200000,
  },
  {
    id: 'sail',
    label: 'Ткань парусов',
    hint: 'полотнища парусов всех судов; швы/заплатки/пробоины остаются поверх',
    placeholder: 'https://…/canvas.png',
    repeat: [1, 1],          // UV паруса 0..1 — картинка на всё полотно
    maxLink: 600, maxDataUrl: 200000,
  },
  {
    id: 'water',
    label: 'Вода (море)',
    hint: 'поверхность моря: ваша текстура подмешивается к цвету волн (плитка 80 м)',
    placeholder: 'https://…/water.png',
    repeat: [1, 1],          // не используется: масштаб в шейдере (мир, 80 м/плитка)
    maxLink: 600, maxDataUrl: 200000,
  },
  // Task 40: ЗОНЫ ОСТРОВОВ — свои текстуры песка/травы/грязи/скал
  // накладываются по высоте и уклону рельефа (режим «Зоны»);
  // пока ссылка не задана/грузится/ошибка — зона остаётся с цветом
  // вершин (ничего не чернеет)
  {
    id: 'sand',
    label: 'Песок (пляжи)',
    hint: 'полоса пляжа у воды и морское дно у кромки; включается режимом «Зоны» выше',
    placeholder: 'https://…/sand.jpg',
    repeat: [1, 1],
    maxLink: 600, maxDataUrl: 200000,
    group: 'terrain',
  },
  {
    id: 'grass',
    label: 'Трава (луга)',
    hint: 'зелёные склоны выше пляжа (зона по умолчанию)',
    placeholder: 'https://…/grass.jpg',
    repeat: [1, 1],
    maxLink: 600, maxDataUrl: 200000,
    group: 'terrain',
  },
  {
    id: 'dirt',
    label: 'Земля / грязь (тропы)',
    hint: 'грязевые проплешины на лугах и склонах',
    placeholder: 'https://…/dirt.jpg',
    repeat: [1, 1],
    maxLink: 600, maxDataUrl: 200000,
    group: 'terrain',
  },
  {
    id: 'rock',
    label: 'Скалы / камни',
    hint: 'крутые склоны и обрывы',
    placeholder: 'https://…/rock.jpg',
    repeat: [1, 1],
    maxLink: 600, maxDataUrl: 200000,
    group: 'terrain',
  },
];

export const TEXTURE_SLOT_IDS = TEXTURE_SLOTS.map(s => s.id);

/** Проверка и обрезка ссылки по правилам слота (UI + настройки) */
export function sanitizeTexUrl(raw: string, slot: TextureSlotId): string {
  const def = TEXTURE_SLOTS.find(s => s.id === slot)!;
  const u = raw.trim().slice(0, /^data:image\//i.test(raw) ? def.maxDataUrl : def.maxLink);
  if (u === '' || /^(https?:\/\/|data:image\/|\/)/i.test(u)) return u;
  return ''; // неизвестный протокол — считаем «не задано»
}

// ------------------------------------------------------------
// РЕЕСТР URL-ТЕКСТУР
// ------------------------------------------------------------

export type TexUrlState = 'none' | 'loading' | 'ok' | 'error';

/** Зарегистрированный «получатель» текстуры слота */
type TexTarget =
  | { kind: 'std'; ref: WeakRef<THREE.MeshStandardMaterial> }   // подмена .map (+запомнить исходную)
  | { kind: 'sail'; ref: WeakRef<THREE.ShaderMaterial> }        // uniforms.uTex/uTexOn
  | { kind: 'water'; ref: WeakRef<THREE.ShaderMaterial> }       // uniforms.uTex/uTexOn (масштаб мира)
  | { kind: 'listen'; cb: () => void };                         // произвольный слушатель (рельеф)

interface SlotRec {
  url: string;
  tex: THREE.Texture | null;
  state: TexUrlState;
  targets: TexTarget[];
}

class TextureUrlRegistry {
  private slots = new Map<TextureSlotId, SlotRec>(
    TEXTURE_SLOT_IDS.map(id => [id, { url: '', tex: null, state: 'none', targets: [] }]));
  private loader = new THREE.TextureLoader();

  /** Применить набор ссылок из настроек (меняются только отличающиеся) */
  setFromAssets(urls: Partial<Record<TextureSlotId, string>>) {
    for (const id of TEXTURE_SLOT_IDS) {
      const u = sanitizeTexUrl(urls[id] ?? '', id);
      if (u !== this.slot(id).url) this.setUrl(id, u);
    }
  }

  /** Задать ссылку слота: '' — вернуть процедурную, иначе загрузить */
  setUrl(id: TextureSlotId, url: string) {
    const rec = this.slot(id);
    const u = sanitizeTexUrl(url, id);
    rec.url = u;
    if (!u) {
      // сброс: сразу вернуть процедурные текстуры
      rec.tex?.dispose();
      rec.tex = null;
      rec.state = 'none';
      this.apply(rec);
      return;
    }
    rec.state = 'loading';
    this.loader.setCrossOrigin('anonymous');
    this.loader.load(u, tex => {
      // ссылка могла смениться, пока грузилась эта
      if (rec.url !== u) { tex.dispose(); return; }
      const def = TEXTURE_SLOTS.find(s => s.id === id)!;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      if (def.repeat[0] !== 1 || def.repeat[1] !== 1) {
        if (id === 'hull' || id === 'deck') tex.repeat.set(def.repeat[0], def.repeat[1]);
      }
      rec.tex?.dispose();
      rec.tex = tex;
      rec.state = 'ok';
      this.apply(rec);
    }, undefined, () => {
      if (rec.url !== u) return;
      rec.state = 'error';
      rec.tex?.dispose();
      rec.tex = null;
      this.apply(rec);
    });
  }

  /** Текущая загруженная текстура слота (null — процедурная) */
  get(id: TextureSlotId): THREE.Texture | null { return this.slot(id).tex; }

  /** Ссылка слота (как задана в настройках) */
  url(id: TextureSlotId): string { return this.slot(id).url; }

  /** Состояние загрузки: none/loading/ok/error */
  state(id: TextureSlotId): TexUrlState { return this.slot(id).state; }

  /** Зарегистрировать Standard-материал (подмена map): корпус/палуба.
   *  Исходная процедурная текстура запоминается в userData.origMap. */
  registerStd(id: TextureSlotId, mat: THREE.MeshStandardMaterial) {
    if (mat.userData.origMap === undefined) mat.userData.origMap = mat.map ?? null;
    this.push(id, { kind: 'std', ref: new WeakRef(mat) });
    const tex = this.slot(id).tex;
    if (tex) { mat.map = tex; mat.needsUpdate = true; }
  }

  /** Зарегистрировать шейдер паруса (uniforms uTex/uTexOn) */
  registerSail(id: TextureSlotId, mat: THREE.ShaderMaterial) {
    this.push(id, { kind: 'sail', ref: new WeakRef(mat) });
    const tex = this.slot(id).tex;
    if (tex) { mat.uniforms.uTex.value = tex; mat.uniforms.uTexOn.value = 1; }
  }

  /** Зарегистрировать шейдер воды (uniforms uTex/uTexOn/uTexScale) */
  registerWater(id: TextureSlotId, mat: THREE.ShaderMaterial) {
    this.push(id, { kind: 'water', ref: new WeakRef(mat) });
    const tex = this.slot(id).tex;
    if (tex) { mat.uniforms.uTex.value = tex; mat.uniforms.uTexOn.value = 1; }
  }

  /** Слушатель слота (рельеф: пересобирает материал по готовности) */
  listen(id: TextureSlotId, cb: () => void) {
    this.push(id, { kind: 'listen', cb });
  }

  /** Сводка по слотам (настройки/E2E): длина ссылки + состояние */
  describe(): Record<string, { urlLen: number; state: TexUrlState }> {
    const out: Record<string, { urlLen: number; state: TexUrlState }> = {};
    for (const id of TEXTURE_SLOT_IDS) {
      const rec = this.slot(id);
      out[id] = { urlLen: rec.url.length, state: rec.state };
    }
    return out;
  }

  private slot(id: TextureSlotId): SlotRec {
    let s = this.slots.get(id);
    if (!s) { s = { url: '', tex: null, state: 'none', targets: [] }; this.slots.set(id, s); }
    return s;
  }

  private push(id: TextureSlotId, t: TexTarget) {
    const rec = this.slot(id);
    rec.targets.push(t);
    if (rec.targets.length > 400) this.prune(rec);
  }

  /** убрать мёртвые WeakRef (корабли пересобираются — материалы умирают) */
  private prune(rec: SlotRec) {
    rec.targets = rec.targets.filter(t => t.kind === 'listen' || !!t.ref.deref());
  }

  /** разложить текущую текстуру слота по целям */
  private apply(rec: SlotRec) {
    for (const t of rec.targets) {
      if (t.kind === 'listen') { t.cb(); continue; }
      if (t.kind === 'std') {
        const m = t.ref.deref();
        if (!m) continue;
        m.map = rec.tex ?? (m.userData.origMap as THREE.Texture | null);
        m.needsUpdate = true;
      } else {
        const m = t.ref.deref();
        if (!m) continue;
        m.uniforms.uTex.value = rec.tex;
        m.uniforms.uTexOn.value = rec.tex ? 1 : 0;
      }
    }
    if (rec.targets.length > 64) this.prune(rec);
  }
}

/** Глобальный реестр URL-текстур (один на игру) */
export const textureUrls = new TextureUrlRegistry();
