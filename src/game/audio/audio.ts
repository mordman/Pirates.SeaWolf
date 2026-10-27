// ============================================================
// Процедурный звук (Web Audio): океан, ветер, пушки, всплески,
// скрип дерева, крики чаек. Без аудиофайлов.
// ============================================================

export class AudioSys {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private oceanGain!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private creakTimer = 0;
  private gullTimer = 6;
  enabled = false;
  private volume = 0.55;

  /** Громкость (0..1) — применяется сразу, даже до init() */
  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.master) this.master.gain.value = this.volume;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);

    // белый шум 2 сек
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // океанский гул
    const ocean = ctx.createBufferSource();
    ocean.buffer = this.noiseBuf;
    ocean.loop = true;
    const oceanF = ctx.createBiquadFilter();
    oceanF.type = 'lowpass';
    oceanF.frequency.value = 420;
    this.oceanGain = ctx.createGain();
    this.oceanGain.gain.value = 0.14;
    ocean.connect(oceanF).connect(this.oceanGain).connect(this.master);
    ocean.start();
    // медленная модуляция волн
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.05;
    lfo.connect(lfoG).connect(this.oceanGain.gain);
    lfo.start();

    // ветер
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuf;
    wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 700;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.05;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    wind.start();

    this.enabled = true;
  }

  private noiseBurst(dur: number, freq: number, type: BiquadFilterType, gain: number, sweep?: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, sweep), ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(ctx.currentTime, Math.random() * 1.5);
    src.stop(ctx.currentTime + dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', slideTo?: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(ctx.currentTime + dur + 0.05);
  }

  cannon(power = 1, dist = 0) {
    const a = 1 / (1 + dist / 120);
    this.noiseBurst(0.5 * power, 900, 'lowpass', 0.9 * a, 120);
    this.tone(70, 0.6 * power, 0.7 * a, 'sine', 38);
    this.tone(240, 0.12, 0.25 * a, 'square', 90);
  }

  splash(dist = 0) {
    const a = 1 / (1 + dist / 100);
    this.noiseBurst(0.4, 2400, 'highpass', 0.32 * a, 900);
    this.tone(320, 0.18, 0.12 * a, 'sine', 120);
  }

  woodHit(dist = 0) {
    const a = 1 / (1 + dist / 100);
    this.tone(140, 0.16, 0.5 * a, 'triangle', 65);
    this.noiseBurst(0.18, 800, 'lowpass', 0.3 * a);
  }

  bell() {
    this.tone(660, 1.2, 0.35, 'sine');
    this.tone(1320, 0.9, 0.15, 'sine');
  }

  gull() {
    const f = 900 + Math.random() * 500;
    this.tone(f, 0.22, 0.08, 'sawtooth', f * 1.7);
    setTimeout(() => this.ctx && this.tone(f * 0.8, 0.3, 0.06, 'sawtooth', f * 0.5), 180);
  }

  creak(intensity: number) {
    this.tone(90 + Math.random() * 120, 0.4, 0.05 + intensity * 0.1, 'sawtooth', 60);
  }

  fireCrackle() {
    this.noiseBurst(0.15, 3000, 'highpass', 0.06);
  }

  update(dt: number, opts: { windSpeed: number; speed: number; rollRate: number; nearLand: boolean; dayF: number }) {
    if (!this.ctx) return;
    this.windFilter.frequency.value = 500 + opts.windSpeed * 55;
    this.windGain.gain.value = 0.02 + Math.min(0.14, opts.windSpeed / 90 + opts.speed / 120);
    this.oceanGain.gain.value = 0.1 + Math.min(0.1, opts.speed / 90);
    // скрип при качке
    this.creakTimer -= dt;
    if (Math.abs(opts.rollRate) > 0.16 && this.creakTimer < 0) {
      this.creakTimer = 2 + Math.random() * 5;
      this.creak(Math.abs(opts.rollRate));
    }
    // чайки у острова днём
    this.gullTimer -= dt;
    if (opts.nearLand && opts.dayF > 0.4 && this.gullTimer < 0) {
      this.gullTimer = 4 + Math.random() * 9;
      this.gull();
    }
  }
}
