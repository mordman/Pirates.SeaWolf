'use client';

import { useEffect, useState } from 'react';
import type { GameSettings, QualityPreset, ControlsSettings, WeatherMode } from '@/game/core/settings';
import { QUALITY_PRESETS, CONTROL_LABELS, keyLabel, DEFAULT_SETTINGS, applyPreset, WEATHER_PRESETS } from '@/game/core/settings';

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

const inputCls = 'rounded border border-stone-600 bg-stone-900 px-2 py-1 text-[11px] text-stone-200 focus:border-amber-500 focus:outline-none';

export default function SettingsPanel({ initial, onApply, onClose }:
{ initial: GameSettings; onApply: (s: GameSettings) => void; onClose: () => void }) {
  const [s, setS] = useState<GameSettings>(() => structuredClone(initial));
  const [tab, setTab] = useState<Tab>('graphics');
  const [binding, setBinding] = useState<{ key: keyof ControlsSettings; ammoIdx?: number } | null>(null);

  // применяем сразу при каждом изменении
  const update = (patch: (draft: GameSettings) => void) => {
    setS(prev => {
      const next = structuredClone(prev);
      patch(next);
      onApply(next);
      return next;
    });
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
                <Row label="Высота волн" hint="предел волнения при штормовом ветре">
                  <Slider value={g.waveHeight} min={0.6} max={1.3} step={0.05}
                    onChange={v => update(d => { d.graphics.waveHeight = v; })}
                    format={v => v <= 0.75 ? 'Спокойное' : v <= 1.05 ? 'Обычное' : v <= 1.2 ? 'Свежее' : 'Шторм'} />
                </Row>
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
                  <Slider value={s.gameplay.provingDistance} min={50} max={400} step={5}
                    onChange={v => update(d => { d.gameplay.provingDistance = v; })}
                    format={v => `${v} м`} />
                </Row>
                <div className="mt-1 text-[10px] text-stone-500">
                  Полигон доступен из главного меню — корабли стоят параллельно,
                  мишень на якоре с правого борта.
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
