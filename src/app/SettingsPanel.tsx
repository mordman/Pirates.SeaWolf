'use client';

import { useEffect, useRef, useState } from 'react';
import type { GameSettings, QualityPreset, ControlsSettings, WeatherMode } from '@/game/core/settings';
import { QUALITY_PRESETS, CONTROL_LABELS, keyLabel, DEFAULT_SETTINGS, applyPreset, WEATHER_PRESETS } from '@/game/core/settings';
import { PART_REGISTRY } from '@/game/glb/glbParts';

// ============================================================
// Экран настроек: Графика (пресеты, дальность, вода, тени),
// Управление (переназначение клавиш), Звук. Всё применяется
// сразу и сохраняется в localStorage.
// ============================================================

type Tab = 'graphics' | 'weather' | 'gameplay' | 'controls' | 'audio';

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
            {([['graphics', 'Графика'], ['weather', 'Погода'], ['gameplay', 'Игра'], ['controls', 'Управление'], ['audio', 'Звук']] as [Tab, string][]).map(([t, label]) => (
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
                <Row label="Качество пены" hint="слои шума и прожилки на гребнях">
                  <select value={g.foamQuality} onChange={e => update(d => { d.graphics.foamQuality = Number(e.target.value); })}
                    className={inputCls}>
                    <option value={0}>Простая</option>
                    <option value={1}>Обычная</option>
                    <option value={2}>Богатая</option>
                  </select>
                </Row>
                <div className="mt-1 rounded border border-stone-800 bg-stone-900/40 px-2 py-1.5 text-[10px] leading-relaxed text-stone-400">
                  🌊 Высота волн зависит только от силы ветра (вкладка «Погода»):
                  штиль — рябь, штормовой ветер — высокие гребни.
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
                <Row label="3D-модели деталей (GLB)" hint="загруженные .glb-модели вместо процедурных деталей; при ошибке — процедурные">
                  <input type="checkbox" checked={g.useGLBModels} onChange={e => update(d => { d.graphics.useGLBModels = e.target.checked; })}
                    className="h-4 w-4 accent-amber-500" />
                </Row>
              </div>
              {/* Каталог заменяемых деталей: единые описания + промпты генерации */}
              <div className="py-2">
                <div className="mb-1.5 text-[10px] uppercase tracking-wide text-stone-500">Замена деталей на GLB-модели</div>
                <div className="space-y-1.5">
                  {PART_REGISTRY.map(p => (
                    <details key={p.id} className="group rounded border border-stone-800 bg-stone-900/40 px-2 py-1.5">
                      <summary className="flex cursor-pointer list-none items-center justify-between text-[11px] font-semibold text-stone-300 group-open:text-amber-200">
                        <span>{p.label}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                          p.file ? 'text-emerald-300 bg-emerald-950/60' : 'text-stone-400 bg-stone-800/60'}`}>
                          {p.file ? '.glb готова' : 'процедурная'}
                        </span>
                      </summary>
                      <div className="mt-1.5 space-y-1 text-[10px] leading-relaxed text-stone-400">
                        <div>{p.description}</div>
                        <div className="text-stone-500">Куда встраивается: <span className="text-stone-400">{p.target}</span></div>
                        <div className="rounded bg-black/40 p-1.5 font-mono text-[9px] text-stone-500">{p.prompt}</div>
                      </div>
                    </details>
                  ))}
                </div>
                <div className="mt-1.5 text-[10px] text-stone-500">
                  Промпт — для генерации модели внешним инструментом (текст→3D);
                  готовый .glb кладётся в public/models и прописывается в реестре.
                </div>
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
                <Row label="Модель моря" hint="волна-опора: корабль идёт по поверхности — нос всходит на волну и спускается; физическая: честный Архимед по точкам корпуса, корабль режет волны; штормовой модуль: море + качка из приложенных файлов sea.js / shipPhysics.js">
                  <select value={s.weather.seaModel}
                    onChange={e => update(d => { d.weather.seaModel = e.target.value as 'physical' | 'riding' | 'storm'; })}
                    className={inputCls}>
                    <option value="physical">Физическая (Архимед, режет волны)</option>
                    <option value="riding">Волна-опора (по поверхности)</option>
                    <option value="storm">Штормовой модуль (sea.js)</option>
                  </select>
                </Row>
                <div className="mt-1 text-[10px] text-stone-500">
                  «Волна-опора» — реализация из штормового демо «Фрегат „Перун“»:
                  крутые валы с фазами, корабль держится на воде и не ныряет глубоко.
                </div>
              </div>

              {s.weather.seaModel === 'storm' && (
                <div className="py-2">
                  <div className="mb-1.5 text-[10px] uppercase tracking-wide text-stone-500">
                    Штормовой модуль (sea.js)
                  </div>
                  <div className="mb-1 text-[10px] text-stone-500">
                    Сила и направление ветра — общие настройки выше («Сила ветра» и
                    «Направление ветра»): модуль слушает их так же, как паруса и погода.
                    Солнце, небо и туман — из глобального неба (день/ночь, гроза).
                  </div>
                  <Row label="Высота волн" hint="множитель крутизны штормовых вал (0.3 — зыбь, 2 — валы с гору)">
                    <Slider value={s.sea.waveHeight} min={0.3} max={2} step={0.05}
                      onChange={v => update(d => { d.sea.waveHeight = v; })}
                      format={v => `×${v.toFixed(2)}`} />
                  </Row>
                  <Row label="Длина волн" hint="масштаб длин волн спектра (0.6 — короткая chop, 1.8 — длинная зыбь)">
                    <Slider value={s.sea.waveLength} min={0.6} max={1.8} step={0.05}
                      onChange={v => update(d => { d.sea.waveLength = v; })}
                      format={v => `×${v.toFixed(2)}`} />
                  </Row>
                  <Row label="Пена" hint="барашки на гребнях, обводка корпуса, кильватер и бурун у форштевня">
                    <Slider value={s.sea.foam} min={0} max={1.5} step={0.05}
                      onChange={v => update(d => { d.sea.foam = v; })}
                      format={v => `${Math.round(v * 100)}%`} />
                  </Row>
                  <Row label="Дальняя сетка" hint="сегменты по стороне: качество волн до горизонта (128 быстро … 320 детально)">
                    <Slider value={s.sea.farSeg} min={128} max={320} step={32}
                      onChange={v => update(d => { d.sea.farSeg = Math.round(v / 16) * 16; })}
                      format={v => `${v}`} />
                  </Row>
                  <Row label="Ближняя сетка" hint="сегменты детальной сетки вокруг корабля (мелкая рябь)">
                    <Slider value={s.sea.nearSeg} min={128} max={320} step={32}
                      onChange={v => update(d => { d.sea.nearSeg = Math.round(v / 16) * 16; })}
                      format={v => `${v}`} />
                  </Row>
                  <Row label="Размер ближней сетки" hint="сторона детального квадрата вокруг корабля, м (дальность — из настроек графики)">
                    <Slider value={s.sea.nearSize} min={260} max={500} step={20}
                      onChange={v => update(d => { d.sea.nearSize = v; })}
                      format={v => `${v} м`} />
                  </Row>
                </div>
              )}

              {s.weather.seaModel === 'storm' && (
                <div className="py-2">
                  <div className="mb-1.5 text-[10px] uppercase tracking-wide text-stone-500">
                    Качка корпуса (shipPhysics.js)
                  </div>
                  <Row label="Жёсткость качки" hint="пружина вертикальной качки: больше — резче подскакивает на волне">
                    <Slider value={s.buoyancy.heaveStiffness} min={1} max={12} step={0.5}
                      onChange={v => update(d => { d.buoyancy.heaveStiffness = v; })}
                      format={v => v.toFixed(1)} />
                  </Row>
                  <Row label="Демпфер качки" hint="как быстро гаснет вертикальная качка">
                    <Slider value={s.buoyancy.heaveDamping} min={0.5} max={6} step={0.1}
                      onChange={v => update(d => { d.buoyancy.heaveDamping = v; })}
                      format={v => v.toFixed(1)} />
                  </Row>
                  <Row label="Отзывчивость корпуса" hint="скорость доворота к склону волны: меньше — лениво переваливается, больше — липнет к волне">
                    <Slider value={s.buoyancy.orientResponse} min={0.5} max={8} step={0.1}
                      onChange={v => update(d => { d.buoyancy.orientResponse = v; })}
                      format={v => `${v.toFixed(1)} 1/с`} />
                  </Row>
                  <Row label="Заглубление от крена" hint="сколько корпус садится при наклоне поверхности, м">
                    <Slider value={s.buoyancy.sinkHeel} min={0} max={3} step={0.1}
                      onChange={v => update(d => { d.buoyancy.sinkHeel = v; })}
                      format={v => `${v.toFixed(1)} м`} />
                  </Row>
                  <Row label="Заглубление от хода" hint="динамическое погружение на скорости (м/м·с⁻¹)">
                    <Slider value={s.buoyancy.sinkSpeed} min={0} max={0.08} step={0.005}
                      onChange={v => update(d => { d.buoyancy.sinkSpeed = v; })}
                      format={v => v.toFixed(3)} />
                  </Row>
                  <Row label="Замер: нос/корма" hint="доля длины корпуса для точек замера воды">
                    <Slider value={s.buoyancy.sampleForeAft} min={0.2} max={0.6} step={0.02}
                      onChange={v => update(d => { d.buoyancy.sampleForeAft = v; })}
                      format={v => v.toFixed(2)} />
                  </Row>
                  <Row label="Замер: борта" hint="доля полуширины для точек замера воды">
                    <Slider value={s.buoyancy.sampleSide} min={0.4} max={1} step={0.02}
                      onChange={v => update(d => { d.buoyancy.sampleSide = v; })}
                      format={v => v.toFixed(2)} />
                  </Row>
                  <Row label="Посадка: крупные суда" hint="0.5 — проектная осадка; больше — сидит выше (фрегаты и линейные)">
                    <Slider value={s.buoyancy.immersionFrigate} min={0.25} max={0.75} step={0.05}
                      onChange={v => update(d => { d.buoyancy.immersionFrigate = v; })}
                      format={v => v.toFixed(2)} />
                  </Row>
                  <Row label="Посадка: шлюпка" hint="лёгкий ял сидит выше корпуса (0.65 по умолчанию)">
                    <Slider value={s.buoyancy.immersionBoat} min={0.25} max={0.85} step={0.05}
                      onChange={v => update(d => { d.buoyancy.immersionBoat = v; })}
                      format={v => v.toFixed(2)} />
                  </Row>
                  <Row label="Посадка: прочие суда" hint="шлюпы, торговцы и прочие">
                    <Slider value={s.buoyancy.immersionDefault} min={0.25} max={0.75} step={0.05}
                      onChange={v => update(d => { d.buoyancy.immersionDefault = v; })}
                      format={v => v.toFixed(2)} />
                  </Row>
                  <Row label="Пауза заливаний" hint="минимальный интервал события «волна залила палубу», с">
                    <Slider value={s.buoyancy.floodCooldown} min={0.5} max={6} step={0.1}
                      onChange={v => update(d => { d.buoyancy.floodCooldown = v; })}
                      format={v => `${v.toFixed(1)} с`} />
                  </Row>
                </div>
              )}
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
