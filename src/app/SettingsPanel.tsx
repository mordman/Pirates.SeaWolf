'use client';

import { useEffect, useRef, useState } from 'react';
import type { GameSettings, QualityPreset, ControlsSettings, WeatherMode, IslandTextureMode, TerrainShaderKind } from '@/game/core/settings';
import { QUALITY_PRESETS, CONTROL_LABELS, keyLabel, DEFAULT_SETTINGS, applyPreset, WEATHER_PRESETS, ISLAND_TEXTURE_MODE_LABELS, TERRAIN_SHADER_LABELS } from '@/game/core/settings';
import { PART_REGISTRY, PART_GROUP_ORDER, type PartGroup } from '@/game/glb/glbParts';

// ============================================================
// Экран настроек: Графика, Погода, Физика, Игра, Управление,
// Звук + РЕСУРСЫ (Task 37): текстуры рельефа (3 режима, шейдер,
// PBR-параметры) и каталог всех процедурных объектов с
// габаритами для подмены на GLB. Всё применяется сразу и
// сохраняется в localStorage.
// ============================================================

type Tab = 'graphics' | 'assets' | 'weather' | 'physics' | 'gameplay' | 'controls' | 'audio';

const PRESET_LABELS: Record<QualityPreset, string> = {
  low: 'Низкое', medium: 'Среднее', high: 'Высокое', ultra: 'Ультра',
};

const WEATHER_LABELS: Record<WeatherMode, string> = {
  clear: '☀ Ясно', rain: '🌧 Дождь', storm: '⛈ Гроза', fog: '🌫 Туман',
};

/** Роза ветров: подпись направления (откуда дует) */
function windDirLabel(deg: number): string {
  const names = ['С', 'ССВ', 'СВ', 'ВСВ', 'В', 'ВЮВ', 'ЮВ', 'ЮЮВ', 'Ю', 'ЮЮЗ', 'ЮЗ', 'ЗЮЗ', 'З', 'ЗСЗ', 'СЗ', 'ССЗ'];
  return names[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <div className="min-w-0">
        <div className="text-xs text-stone-200">{label}</div>
        {hint && <div className="text-[10px] text-stone-500">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function Slider({ value, min, max, step, onChange, format }:
{ value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string }) {
  return (
    <div className="flex items-center gap-2">
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="h-1.5 w-44 cursor-pointer appearance-none rounded-full bg-stone-700 accent-amber-500" />
      <span className="w-16 text-right text-[11px] font-semibold text-amber-200">{format(value)}</span>
    </div>
  );
}

/** Числовой ввод количества боеприпасов (0..999) с кнопками ±5 */
function AmmoInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const set = (v: number) => onChange(Math.min(999, Math.max(0, Math.round(v) || 0)));
  return (
    <div className="flex items-center gap-1">
      <button onClick={() => set(value - 5)}
        className="h-6 w-6 rounded border border-stone-600 bg-stone-900 text-xs font-bold text-stone-300 transition hover:border-amber-500 hover:text-amber-200">−</button>
      <input type="number" min={0} max={999} value={value}
        onChange={e => set(Number(e.target.value))}
        className="w-16 rounded border border-stone-600 bg-stone-900 px-1.5 py-1 text-center text-[11px] font-semibold text-amber-200 focus:border-amber-500 focus:outline-none" />
      <button onClick={() => set(value + 5)}
        className="h-6 w-6 rounded border border-stone-600 bg-stone-900 text-xs font-bold text-stone-300 transition hover:border-amber-500 hover:text-amber-200">+</button>
    </div>
  );
}

/** Ввод количества золота (0..100000) с кнопками ±50/±500 */
function MoneyInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const set = (v: number) => onChange(Math.min(100000, Math.max(0, Math.round(v) || 0)));
  return (
    <div className="flex items-center gap-1">
      <button onClick={() => set(value - 50)}
        className="h-6 w-6 rounded border border-stone-600 bg-stone-900 text-xs font-bold text-stone-300 transition hover:border-amber-500 hover:text-amber-200">−</button>
      <input type="number" min={0} max={100000} value={value}
        onChange={e => set(Number(e.target.value))}
        className="w-24 rounded border border-stone-600 bg-stone-900 px-1.5 py-1 text-center text-[11px] font-semibold text-amber-200 focus:border-amber-500 focus:outline-none" />
      <button onClick={() => set(value + 50)}
        className="h-6 w-6 rounded border border-stone-600 bg-stone-900 text-xs font-bold text-stone-300 transition hover:border-amber-500 hover:text-amber-200">+</button>
      <button onClick={() => set(value + 500)}
        className="h-6 w-7 rounded border border-stone-600 bg-stone-900 text-[10px] font-bold text-stone-300 transition hover:border-amber-500 hover:text-amber-200">+500</button>
    </div>
  );
}

const inputCls = 'rounded border border-stone-600 bg-stone-900 px-2 py-1 text-[11px] text-stone-200 focus:border-amber-500 focus:outline-none';

/** Габарит модели: до 2 знаков без хвостовых нулей (0.5, 1.72, 3.4) */
const fmtM = (v: number) => String(+(+v).toFixed(2));

export default function SettingsPanel({ initial, onApply, onClose }:
{ initial: GameSettings; onApply: (s: GameSettings) => void; onClose: () => void }) {
  const [s, setS] = useState<GameSettings>(() => structuredClone(initial));
  const [tab, setTab] = useState<Tab>('graphics');
  const [binding, setBinding] = useState<{ key: keyof ControlsSettings; ammoIdx?: number } | null>(null);
  // зеркало актуального состояния — обновление из обработчиков событий
  // (НЕ из фазы рендера: вызов onApply внутри setS(prev=>...) —
  // setState-в-рендере, React ругается «Cannot update a component…»)
  const sRef = useRef(s);

  // применяем сразу при каждом изменении
  const update = (patch: (draft: GameSettings) => void) => {
    const next = structuredClone(sRef.current);
    patch(next);
    sRef.current = next;
    setS(next);
    onApply(next);
  };

  // захват клавиши для переназначения
  useEffect(() => {
    if (!binding) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') { setBinding(null); return; }
      update(d => {
        if (binding.ammoIdx !== undefined) {
          d.controls.ammo[binding.ammoIdx] = e.code;
        } else {
          const k = binding.key;
          if (k !== 'ammo' && k !== 'invertRudder') d.controls[k] = e.code;
        }
      });
      setBinding(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [binding]);

  // все занятые коды (для подсветки конфликтов)
  const usedCodes = new Map<string, string>();
  (Object.keys(s.controls) as (keyof ControlsSettings)[]).forEach(k => {
    if (k === 'invertRudder') return;
    if (k === 'ammo') s.controls.ammo.forEach(c => usedCodes.set(c, 'Боеприпас'));
    else usedCodes.set(s.controls[k] as string, CONTROL_LABELS[k]);
  });

  const bindBtn = (code: string, action: { key: keyof ControlsSettings; ammoIdx?: number }) => {
    const conflict = binding === null && usedCodes.get(code) && usedCodes.get(code) !== CONTROL_LABELS[action.key];
    const listening = binding && binding.key === action.key && binding.ammoIdx === action.ammoIdx;
    return (
      <button
        onClick={() => setBinding(action)}
        className={`min-w-[72px] rounded border px-2 py-1 text-[11px] font-bold transition ${
          listening
            ? 'animate-pulse border-amber-400 bg-amber-500/30 text-amber-100'
            : conflict
              ? 'border-red-700 bg-red-950/40 text-red-300'
              : 'border-stone-600 bg-stone-900 text-amber-200 hover:border-amber-600'}`}
      >
        {listening ? 'Нажмите…' : keyLabel(code)}
      </button>
    );
  };

  const g = s.graphics;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[560px] max-h-[86vh] overflow-hidden rounded-xl border-2 border-amber-800 bg-[#1a120a] shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-amber-900/60 px-5 py-3">
          <h2 className="font-serif text-xl font-bold text-amber-300">⚙ Настройки</h2>
          <div className="flex gap-1">
            {([['graphics', 'Графика'], ['assets', 'Ресурсы'], ['weather', 'Погода'], ['physics', 'Физика'], ['gameplay', 'Игра'], ['controls', 'Управление'], ['audio', 'Звук']] as [Tab, string][]).map(([t, label]) => (
              <button key={t} onClick={() => setTab(t)}
                className={`rounded px-3 py-1 text-xs font-semibold transition ${
                  tab === t ? 'bg-amber-700/60 text-amber-100' : 'text-stone-400 hover:text-amber-200'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-[62vh] overflow-y-auto px-5 py-3">
          {tab === 'graphics' && (
            <div className="divide-y divide-stone-800/60">
              <div className="pb-2">
                <div className="mb-1.5 text-[10px] uppercase tracking-wide text-stone-500">Пресет качества</div>
                <div className="flex gap-1.5">
                  {(Object.keys(PRESET_LABELS) as QualityPreset[]).map(p => (
                    <button key={p} onClick={() => update(d => { d.graphics = applyPreset(d.graphics, p); })}
                      className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-semibold transition ${
                        g.preset === p
                          ? 'border-amber-400 bg-amber-700/50 text-amber-100'
                          : 'border-stone-700 bg-stone-900/60 text-stone-300 hover:border-amber-700'}`}>
                      {PRESET_LABELS[p]}
                    </button>
                  ))}
                </div>
                <div className="mt-1 text-[10px] text-stone-500">
                  Пресет задаёт все параметры ниже — их можно менять по отдельности
                </div>
              </div>
              <div className="py-1">
                <Row label="Дальность прорисовки" hint="радиус воды и видимости, туман подстраивается">
                  <Slider value={g.drawDistance} min={2000} max={8000} step={200}
                    onChange={v => update(d => { d.graphics.drawDistance = v; })}
                    format={v => `${(v / 1000).toFixed(1)} км`} />
                </Row>
                <Row label="Детализация воды" hint="сегментов на сторону чанка (шаг 16)">
                  <Slider value={g.waterDetail} min={64} max={208} step={16}
                    onChange={v => update(d => { d.graphics.waterDetail = v; })}
                    format={v => `${v}²`} />
                </Row>
                <Row label="Размер чанка воды" hint="сторона детального участка моря вокруг корабля">
                  <Slider value={g.waterChunkSize} min={300} max={2000} step={50}
                    onChange={v => update(d => { d.graphics.waterChunkSize = v; })}
                    format={v => `${v} м`} />
                </Row>
                <Row label="Дальние кольца воды" hint="рост ячейки за кольцо: плавнее или экономнее">
                  <select value={g.waterLodStep} onChange={e => update(d => { d.graphics.waterLodStep = Number(e.target.value); })}
                    className={inputCls}>
                    <option value={0}>Плавные (×2)</option>
                    <option value={1}>Баланс (×4)</option>
                    <option value={2}>Экономные (×8)</option>
                  </select>
                </Row>
                <Row label="Детализация вблизи" hint="дистанция показа мелких деталей кораблей: выбленки, якоря, порты">
                  <Slider value={g.detailLod} min={100} max={420} step={10}
                    onChange={v => update(d => { d.graphics.detailLod = v; })}
                    format={v => `${v} м`} />
                </Row>
                <div className="mt-1 rounded border border-stone-800 bg-stone-900/40 px-2 py-1.5 text-[10px] leading-relaxed text-stone-400">
                  🌊 Высота волн зависит только от силы ветра (вкладка «Погода»):
                  штиль — рябь, штормовой ветер — высокие гребни. Открытое море
                  чистое, без пены — белая пена только у берегов (прибой).
                </div>
              </div>
              <div className="py-1">
                <Row label="Тени" hint="тени кораблей и деревьев">
                  <input type="checkbox" checked={g.shadows} onChange={e => update(d => { d.graphics.shadows = e.target.checked; })}
                    className="h-4 w-4 accent-amber-500" />
                </Row>
                <Row label="Разрешение теней" hint={g.shadows ? undefined : 'включите тени'}>
                  <select value={g.shadowRes} disabled={!g.shadows}
                    onChange={e => update(d => { d.graphics.shadowRes = Number(e.target.value); })}
                    className={inputCls}>
                    <option value={512}>512</option>
                    <option value={1024}>1024</option>
                    <option value={2048}>2048</option>
                  </select>
                </Row>
                <Row label="Резкость (pixel ratio)" hint="больше = чётче, но тяжелее для GPU">
                  <Slider value={g.pixelRatio} min={1} max={2} step={0.25}
                    onChange={v => update(d => { d.graphics.pixelRatio = v; })}
                    format={v => `×${v.toFixed(2)}`} />
                </Row>
                {/* Текстуры рельефа и GLB-модели — вкладка «Ресурсы» (Task 37) */}
              </div>
              <div className="py-2">
                <div className="mb-1.5 text-[10px] uppercase tracking-wide text-stone-500">Каркас: только треугольники без текстур</div>
                <div className="mb-1 text-[10px] text-stone-500">
                  Показать сетку объекта — отдельно для каждой категории.
                  Полезно для отладки геометрии: вода, корабли, острова, растительность.
                </div>
                <Row label="🌊 Вода" hint="треугольная сетка поверхности моря">
                  <input type="checkbox" checked={g.wireframe.water} onChange={e => update(d => { d.graphics.wireframe.water = e.target.checked; })}
                    className="h-4 w-4 accent-amber-500" />
                </Row>
                <Row label="⛵ Корабли" hint="корпуса, паруса и экипаж всех судов">
                  <input type="checkbox" checked={g.wireframe.ships} onChange={e => update(d => { d.graphics.wireframe.ships = e.target.checked; })}
                    className="h-4 w-4 accent-amber-500" />
                </Row>
                <Row label="🏝 Острова" hint="рельеф, постройки, причалы, животные">
                  <input type="checkbox" checked={g.wireframe.islands} onChange={e => update(d => { d.graphics.wireframe.islands = e.target.checked; })}
                    className="h-4 w-4 accent-amber-500" />
                </Row>
                <Row label="🌴 Растительность" hint="деревья, кусты, валуны">
                  <input type="checkbox" checked={g.wireframe.vegetation} onChange={e => update(d => { d.graphics.wireframe.vegetation = e.target.checked; })}
                    className="h-4 w-4 accent-amber-500" />
                </Row>
              </div>
            </div>
          )}

          {tab === 'assets' && (
            <div className="divide-y divide-stone-800/60">
              {/* ============ ТЕКСТУРЫ ОСТРОВОВ ============ */}
              <div className="py-2">
                <div className="mb-1.5 text-[10px] uppercase tracking-wide text-stone-500">Текстуры рельефа островов</div>
                <div className="mb-2 flex gap-1.5">
                  {(Object.keys(ISLAND_TEXTURE_MODE_LABELS) as IslandTextureMode[]).map(m => (
                    <button key={m} onClick={() => update(d => { d.assets.islandTextures = m; })}
                      className={`flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition ${
                        s.assets.islandTextures === m
                          ? 'border-amber-400 bg-amber-700/50 text-amber-100'
                          : 'border-stone-700 bg-stone-900/60 text-stone-300 hover:border-amber-700'}`}>
                      {ISLAND_TEXTURE_MODE_LABELS[m]}
                    </button>
                  ))}
                </div>
                <Row label="Масштаб текстуры" hint="размер повторения на местности: меньше — мельче зерно">
                  <Slider value={s.assets.texScale} min={3} max={30} step={1}
                    onChange={v => update(d => { d.assets.texScale = v; })}
                    format={v => `${v} м`} />
                </Row>
                <Row label="Шейдер рельефа" hint="Standard/Physical — PBR-материалы; Lambert/Phong — упрощённые (быстрее)">
                  <select value={s.assets.terrainShader}
                    onChange={e => update(d => { d.assets.terrainShader = e.target.value as TerrainShaderKind; })}
                    className={inputCls}>
                    {(Object.keys(TERRAIN_SHADER_LABELS) as TerrainShaderKind[]).map(k => (
                      <option key={k} value={k}>{TERRAIN_SHADER_LABELS[k]}</option>
                    ))}
                  </select>
                </Row>
                <Row label="Шероховатость" hint={s.assets.terrainShader === 'lambert' ? 'не поддерживается Lambert' : '0 — глянец, 1 — матовая земля'}>
                  <Slider value={s.assets.roughness} min={0} max={1} step={0.05}
                    onChange={v => update(d => { d.assets.roughness = v; })}
                    format={v => v.toFixed(2)} />
                </Row>
                <Row label="Металличность" hint="земля/камень — 0; блеск появляется у металла">
                  <Slider value={s.assets.metalness} min={0} max={1} step={0.05}
                    onChange={v => update(d => { d.assets.metalness = v; })}
                    format={v => v.toFixed(2)} />
                </Row>
                <Row label="Сила рельефа (нормали)" hint={s.assets.islandTextures === 'pbr' ? '0 — гладко, 2 — грубая крошка' : 'только в режиме PBR'}>
                  <Slider value={s.assets.normalStrength} min={0} max={2} step={0.1}
                    onChange={v => update(d => { d.assets.normalStrength = v; })}
                    format={v => `×${v.toFixed(1)}`} />
                </Row>
                <div className="mt-1 rounded border border-stone-800 bg-stone-900/40 px-2 py-1.5 text-[10px] leading-relaxed text-stone-400">
                  Биом (песок/трава/джунгли/скалы) задаётся цветом вершин рельефа,
                  текстура — детализация поверх: «зерно» — нейтральная крошка,
                  «PBR» — альбедо + карта нормалей + карта шероховатости
                  (реакция на свет). Применяется мгновенно, без перестройки мира.
                </div>
              </div>

              {/* ============ 3D-МОДЕЛИ (GLB) ============ */}
              <div className="py-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-wide text-stone-500">3D-модели: подмена процедурных объектов на GLB</div>
                </div>
                <Row label="Использовать GLB-модели" hint="загруженные .glb вместо процедурных деталей; при ошибке — тихий фолбэк на процедурные">
                  <input type="checkbox" checked={g.useGLBModels} onChange={e => update(d => { d.graphics.useGLBModels = e.target.checked; })}
                    className="h-4 w-4 accent-amber-500" />
                </Row>
                <div className="mb-2 text-[10px] leading-relaxed text-stone-500">
                  Каталог ВСЕХ процедурных объектов игры с габаритами (Ш×В×Г, м) —
                  эталон для подгонки готовой GLB-модели под правильный размер.
                  Файл кладётся в <span className="font-mono text-stone-400">public/models/</span> и
                  прописывается в реестре (<span className="font-mono text-stone-400">src/game/glb/glbParts.ts</span>).
                  Растительность подменяется сразу; остальные слоты — по мере подключения.
                </div>
                {PART_GROUP_ORDER.map((grp: PartGroup) => {
                  const parts = PART_REGISTRY.filter(p => p.group === grp);
                  if (!parts.length) return null;
                  return (
                    <div key={grp} className="mb-2">
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-amber-600/80">{grp}</div>
                      <div className="space-y-1.5">
                        {parts.map(p => (
                          <details key={p.id} className="group rounded border border-stone-800 bg-stone-900/40 px-2 py-1.5">
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[11px] font-semibold text-stone-300 group-open:text-amber-200">
                              <span className="min-w-0 truncate">{p.label}</span>
                              <span className="flex shrink-0 items-center gap-1.5">
                                <span className="rounded bg-black/50 px-1.5 py-0.5 font-mono text-[9px] text-stone-400"
                                  title="Габариты процедурной модели: ширина × высота × глубина, м">
                                  {fmtM(p.size.w)}×{fmtM(p.size.h)}×{fmtM(p.size.d)} м
                                </span>
                                <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                                  p.file ? 'text-emerald-300 bg-emerald-950/60' : p.wired ? 'text-amber-500/90 bg-amber-950/40' : 'text-stone-400 bg-stone-800/60'}`}>
                                  {p.file ? '.glb' : p.wired ? 'слот готов' : 'процедурная'}
                                </span>
                              </span>
                            </summary>
                            <div className="mt-1.5 space-y-1 text-[10px] leading-relaxed text-stone-400">
                              <div>{p.description}</div>
                              <div className="text-stone-500">Куда встраивается: <span className="font-mono text-stone-400">{p.target}</span>
                                {p.normHeight > 0 && <> · нормализация по высоте: <span className="text-stone-400">{p.normHeight} м</span></>}
                              </div>
                              <div className="rounded bg-black/40 p-1.5 font-mono text-[9px] text-stone-500">{p.prompt}</div>
                            </div>
                          </details>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === 'weather' && (
            <div className="divide-y divide-stone-800/60">
              <div className="py-2">
                <div className="mb-1.5 text-[10px] uppercase tracking-wide text-stone-500">Погодные явления</div>
                <div className="flex gap-1.5">
                  {(Object.keys(WEATHER_LABELS) as WeatherMode[]).map(m => (
                    <button key={m}
                      onClick={() => update(d => {
                        d.weather.mode = m;
                        // рекомендуемый ветер для режима (можно поменять после)
                        d.weather.windSpeed = WEATHER_PRESETS[m].windSpeed;
                      })}
                      className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-semibold transition ${
                        s.weather.mode === m
                          ? 'border-amber-400 bg-amber-700/50 text-amber-100'
                          : 'border-stone-700 bg-stone-900/60 text-stone-300 hover:border-amber-700'}`}>
                      {WEATHER_LABELS[m]}
                    </button>
                  ))}
                </div>
                <div className="mt-1 text-[10px] text-stone-500">
                  Гроза — ливень, вспышки молний с раскатами грома; туман снижает видимость.
                  На полигоне всегда чистое море.
                </div>
              </div>
              <div className="py-2">
                <Row label="Сила ветра" hint="от ветра зависит волнение моря и ход под парусами">
                  <Slider value={s.weather.windSpeed} min={0} max={24} step={0.5}
                    onChange={v => update(d => { d.weather.windSpeed = v; })}
                    format={v => `${v.toFixed(1)} м/с`} />
                </Row>
                <Row label="Направление ветра" hint={`откуда дует: ${windDirLabel(s.weather.windDir)} (${s.weather.windDir}°)`}>
                  <Slider value={s.weather.windDir} min={0} max={355} step={5}
                    onChange={v => update(d => { d.weather.windDir = v; })}
                    format={v => `${windDirLabel(v)} ${v}°`} />
                </Row>
              </div>
              <div className="py-2">
                <div className="mb-1.5 text-[10px] uppercase tracking-wide text-stone-500">Море и волны</div>
                <div className="rounded border border-stone-800 bg-stone-900/40 px-2.5 py-2 text-[10px] leading-relaxed text-stone-400">
                  🌊 ЕДИНОЕ МОРЕ — волны Герстнера с микронормалями поверхности
                  (FBM-шум): одна реализация для картинки и физики.
                  <b className="text-stone-300">Высота волн зависит от силы ветра</b>
                  (ползунок выше): штиль — стеклянная рябь, свежий ветер —
                  бодрая зыбь, шторм — валы с барашками. Волны бегут по ветру и
                  <b className="text-stone-300"> разбиваются об острова</b> — у берега
                  гаснут с полосой прибоя (у горных берегов — узкой).
                  Качка корабля — вкладка «Физика».
                </div>
              </div>
              <div className="py-2">
                <div className="mb-1.5 text-[10px] uppercase tracking-wide text-stone-500">Дым и огонь выстрелов</div>
                <Row label="Видимость дыма" hint="полностью скрывает дым и вспышки">
                  <input type="checkbox" checked={s.fx.smokeVisible}
                    onChange={e => update(d => { d.fx.smokeVisible = e.target.checked; })}
                    className="h-4 w-4 accent-amber-500" />
                </Row>
                <Row label="Размер дыма" hint="диаметр клубов порохового дыма">
                  <Slider value={s.fx.smokeSize} min={0.3} max={2.5} step={0.1}
                    onChange={v => update(d => { d.fx.smokeSize = v; })}
                    format={v => `×${v.toFixed(1)}`} />
                </Row>
                <Row label="Плотность дыма" hint="количество клубов у дул и в следе ядра">
                  <Slider value={s.fx.smokeDensity} min={0} max={2} step={0.1}
                    onChange={v => update(d => { d.fx.smokeDensity = v; })}
                    format={v => `${Math.round(v * 100)}%`} />
                </Row>
                <Row label="Прозрачность дыма" hint="100% = еле заметный, 0% = плотный">
                  <Slider value={s.fx.smokeTransparency} min={0} max={0.95} step={0.05}
                    onChange={v => update(d => { d.fx.smokeTransparency = v; })}
                    format={v => `${Math.round(v * 100)}%`} />
                </Row>
              </div>
            </div>
          )}

          {tab === 'physics' && (
            <div className="divide-y divide-stone-800/60">
              <div className="py-2">
                <div className="mb-1.5 text-[10px] uppercase tracking-wide text-stone-500">Физика корабля</div>
                <Row label="Режим физики" hint="обе плывут ПО поверхности волн; реалистичная — крен/дифферент от честных моментов (ветер, поворот, затопление, склон волны), простая — лёгкая кинематическая рамка">
                  <select value={s.physics.mode}
                    onChange={e => update(d => { d.physics.mode = e.target.value as 'realistic' | 'simple'; })}
                    className={inputCls}>
                    <option value="realistic">Реалистичная (моменты: крен/дифферент)</option>
                    <option value="simple">Простая (по поверхности волн)</option>
                  </select>
                </Row>
                <div className="mt-1 text-[10px] text-stone-500">
                  Обе физики — на ОДНОМ море (Герстнер + FBM); переключение
                  мгновенное и действует на все корабли.
                </div>
              </div>
              <div className="py-2">
                <div className="mb-1.5 text-[10px] uppercase tracking-wide text-stone-500">Плавучесть и посадка</div>
                <div className="mb-1 text-[10px] text-stone-500">
                  Настройки плавучести переделаны (Task 33): только общие для обеих
                  физик величины. У реалистичной осадка меняется перекалибровкой
                  гидростатики (ровный киль сохраняется), у простой — сдвигом посадки.
                </div>
                <Row label="Осадка: глубже / мельче" hint="±м: корабль сидит глубже/мельче с тем же ровным килем">
                  <Slider value={s.physics.buoyancy.draftOffset} min={-0.8} max={0.8} step={0.05}
                    onChange={v => update(d => { d.physics.buoyancy.draftOffset = v; })}
                    format={v => `${v > 0 ? '+' : ''}${v.toFixed(2)} м`} />
                </Row>
                <Row label="Макс. крен" hint="предел статического крена (ветер/поворот/затопление), ° — кромка палубы не ныряет">
                  <Slider value={s.physics.buoyancy.heelMaxDeg} min={6} max={35} step={0.5}
                    onChange={v => update(d => { d.physics.buoyancy.heelMaxDeg = v; })}
                    format={v => `${v.toFixed(1)}°`} />
                </Row>
                <Row label="Макс. дифферент" hint="предел наклона носом/кормой, °">
                  <Slider value={s.physics.buoyancy.pitchMaxDeg} min={8} max={35} step={0.5}
                    onChange={v => update(d => { d.physics.buoyancy.pitchMaxDeg = v; })}
                    format={v => `${v.toFixed(1)}°`} />
                </Row>
                <Row label="Осадка шлюпки" hint="множитель посадки яла на воде: планширь ближе/дальше от воды">
                  <Slider value={s.physics.buoyancy.boatDraftMul} min={0.5} max={3} step={0.1}
                    onChange={v => update(d => { d.physics.buoyancy.boatDraftMul = v; })}
                    format={v => `×${v.toFixed(1)}`} />
                </Row>
                <Row label="Плавность посадки шлюпки" hint="скорость сглаживания посадки яла на волны, 1/с: меньше — ял мягче всходит на гребень">
                  <Slider value={s.physics.buoyancy.boatSmooth} min={6} max={25} step={1}
                    onChange={v => update(d => { d.physics.buoyancy.boatSmooth = v; })}
                    format={v => `${v} 1/с`} />
                </Row>
              </div>
              <div className="py-2">
                <div className="mb-1.5 text-[10px] uppercase tracking-wide text-stone-500">Залитие палубы и смыв моряков</div>
                <div className="mb-1 text-[10px] text-stone-500">
                  Большая волна заливает палубу (зелёная вода) — и может СМЫТЬ
                  матроса за борт. Пока палуба над водой — никого не смывает.
                </div>
                <Row label="Вероятность смыва матроса" hint="шанс унести человека за борт при глубоком залитии палубы (волна по палубе, > 0.15 м воды над кромкой); 0% — никогда, 100% — каждое залитие">
                  <Slider value={s.physics.buoyancy.washProbabilityPct} min={0} max={100} step={5}
                    onChange={v => update(d => { d.physics.buoyancy.washProbabilityPct = v; })}
                    format={v => `${v}%`} />
                </Row>
                <Row label="Пауза между смывами" hint="минимальный интервал между бросками на смыв, с">
                  <Slider value={s.physics.buoyancy.washCooldownS} min={2} max={25} step={1}
                    onChange={v => update(d => { d.physics.buoyancy.washCooldownS = v; })}
                    format={v => `${v} с`} />
                </Row>
              </div>
            </div>
          )}

          {tab === 'gameplay' && (
            <div className="divide-y divide-stone-800/60">
              <div className="py-2">
                <Row label="Дистанция до мишени на полигоне" hint="расстояние между кораблями, м (применяется сразу)">
                  <Slider value={s.gameplay.provingDistance} min={10} max={400} step={5}
                    onChange={v => update(d => { d.gameplay.provingDistance = v; })}
                    format={v => `${v} м`} />
                </Row>
                <div className="mt-1 text-[10px] text-stone-500">
                  Полигон доступен из главного меню — корабли стоят параллельно,
                  мишень на якоре с правого борта.
                </div>
              </div>
              <div className="py-2">
                <div className="mb-1.5 text-[11px] font-semibold text-amber-200/90">Корабль и управление</div>
                <Row label="🚤 Количество шлюпок" hint="сколько ялов на шлюпбалках бортов: 2 — оба борта (штирборт + порт), 1 — только штирборт, 0 — без шлюпок; применяется сразу (корабль пересобирается)">
                  <select value={s.gameplay.boatCount}
                    onChange={e => update(d => { d.gameplay.boatCount = Number(e.target.value); })}
                    className={inputCls}>
                    <option value={0}>Без шлюпок</option>
                    <option value={1}>1 — штирборт</option>
                    <option value={2}>2 — оба борта</option>
                  </select>
                </Row>
                <Row label="🎮 Упрощённое управление" hint="руль работает на любой скорости, паруса тянут одинаково при любом курсе к ветру (без «мёртвых зон» в левентик) — аркада">
                  <input type="checkbox" checked={s.gameplay.simpleControls}
                    onChange={e => update(d => { d.gameplay.simpleControls = e.target.checked; })}
                    className="h-4 w-4 accent-amber-500" />
                </Row>
                <Row label="🐱 Экипаж из котов" hint="заменить всех матросов на котов: капитан-кот у штурвала, боцман-кот у шпиля, канониры-коты таскают ядра; корабельные коты из порта остаются на палубе; применяется сразу (только ваш корабль)">
                  <input type="checkbox" checked={s.gameplay.catsInsteadOfCrew}
                    onChange={e => update(d => { d.gameplay.catsInsteadOfCrew = e.target.checked; })}
                    className="h-4 w-4 accent-amber-500" />
                </Row>
              </div>
              <div className="py-2">
                <div className="mb-1 text-[11px] font-semibold text-amber-200/90">Кошелёк капитана</div>
                <Row label="💰 Стартовое золото" hint="применяется сразу: кошелёк игрока становится равен этому числу">
                  <MoneyInput value={s.gameplay.startMoney}
                    onChange={v => update(d => { d.gameplay.startMoney = v; })} />
                </Row>
                <div className="mt-1 text-[10px] text-stone-500">
                  Золото в море добывай трофеями и торговлей — а здесь можно
                  выдать себе любой стартовый капитал (до 100 000 зол.).
                </div>
              </div>
              <div className="py-2">
                <div className="mb-1 text-[11px] font-semibold text-amber-200/90">Боезапас (применяется сразу)</div>
                <Row label="⚫ Ядра" hint="основной калибр — корпус и экипаж">
                  <AmmoInput value={s.gameplay.startingAmmo.ball}
                    onChange={v => update(d => { d.gameplay.startingAmmo.ball = v; })} />
                </Row>
                <Row label="⛓ Книппели" hint="два ядра на цепи — рвут паруса и мачты">
                  <AmmoInput value={s.gameplay.startingAmmo.chain}
                    onChange={v => update(d => { d.gameplay.startingAmmo.chain = v; })} />
                </Row>
                <Row label="🧨 Картечь" hint="россыпь пуль — экипаж и лёгкий корпус">
                  <AmmoInput value={s.gameplay.startingAmmo.grape}
                    onChange={v => update(d => { d.gameplay.startingAmmo.grape = v; })} />
                </Row>
                <Row label="🔥 Зажигательные" hint="поджигают палубы">
                  <AmmoInput value={s.gameplay.startingAmmo.fire}
                    onChange={v => update(d => { d.gameplay.startingAmmo.fire = v; })} />
                </Row>
                <Row label="♾ Не расходовать боеприпасы" hint="чит-режим для испытаний">
                  <input type="checkbox" checked={s.gameplay.infiniteAmmo}
                    onChange={e => update(d => { d.gameplay.infiniteAmmo = e.target.checked; })}
                    className="h-4 w-4 accent-amber-500" />
                </Row>
                <Row label="🎲 Недостача боезапаса 1–10%" hint="реализм: при выходе в море каждого типа снарядов не хватает наугад — применяется на новом корабле/возрождении">
                  <input type="checkbox" checked={s.gameplay.ammoJitter}
                    onChange={e => update(d => { d.gameplay.ammoJitter = e.target.checked; })}
                    className="h-4 w-4 accent-amber-500" />
                </Row>
              </div>
              <div className="py-2">
                <Row label="Прочность кораблей" hint="корпус, паруса и мачты всех судов — применяется сразу">
                  <Slider value={s.gameplay.hullDurability} min={0.5} max={3} step={0.25}
                    onChange={v => update(d => { d.gameplay.hullDurability = v; })}
                    format={v => `×${v.toFixed(2)}`} />
                </Row>
                <div className="mt-1 text-[10px] text-stone-500">
                  ×0.5 — «стеклянные» корпуса, ×3 — морские крепости.
                    При смене прочности текущие повреждения сохраняются пропорционально.
                </div>
              </div>
            </div>
          )}

          {tab === 'controls' && (
            <div>
              <div className="mb-2 text-[10px] text-stone-500">
                Нажмите на клавишу справа, затем нажмите новую клавишу (Esc — отмена).
                Красным подсвечены дубликаты.
              </div>
              <div className="divide-y divide-stone-800/60">
                {(Object.keys(CONTROL_LABELS) as (keyof ControlsSettings)[]).map(k => (
                  <div key={k} className="flex items-center justify-between py-1.5">
                    <span className="text-xs text-stone-200">{CONTROL_LABELS[k]}</span>
                    {k === 'invertRudder' ? (
                      <input type="checkbox" checked={s.controls.invertRudder}
                        onChange={e => update(d => { d.controls.invertRudder = e.target.checked; })}
                        className="h-4 w-4 accent-amber-500" />
                    ) : k === 'ammo' ? (
                      <div className="flex gap-1.5">
                        {s.controls.ammo.map((code, i) => (
                          <span key={i}>{bindBtn(code, { key: k, ammoIdx: i })}</span>
                        ))}
                      </div>
                    ) : (
                      bindBtn(s.controls[k] as string, { key: k })
                    )}
                  </div>
                ))}
              </div>
              <button onClick={() => update(d => { d.controls = structuredClone(DEFAULT_SETTINGS.controls); })}
                className="mt-3 w-full rounded-lg border border-stone-700 bg-stone-900/60 px-3 py-1.5 text-xs text-stone-300 transition hover:border-amber-700 hover:text-amber-200">
                Сбросить управление по умолчанию (WASD)
              </button>
            </div>
          )}

          {tab === 'audio' && (
            <div>
              <Row label="Общая громкость" hint="океан, ветер, пушки, чайки">
                <Slider value={s.audio.volume} min={0} max={1} step={0.05}
                  onChange={v => update(d => { d.audio.volume = v; })}
                  format={v => `${Math.round(v * 100)}%`} />
              </Row>
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-amber-900/60 px-5 py-3">
          <button onClick={onClose}
            className="rounded-lg border border-amber-600 bg-gradient-to-b from-amber-600 to-amber-800 px-6 py-1.5 font-serif text-sm font-bold text-amber-50 transition hover:from-amber-500 active:scale-95">
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}
