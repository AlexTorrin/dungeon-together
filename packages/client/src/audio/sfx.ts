import Phaser from 'phaser';
import { loadMuted, saveMuted } from '../storage/soundSetting';

export type SfxName =
  | 'step'
  | 'bump'
  | 'swing'
  | 'bow'
  | 'wand'
  | 'hit'
  | 'death'
  | 'coin'
  | 'pickup'
  | 'equip'
  | 'drink'
  | 'door'
  | 'won'
  | 'lost';

const VOLUME = 0.5;
/** Одинаковые звуки ближе этого (с) сливаются в один: пять монстров шагнули — один шаг. */
const MERGE_S = 0.03;
const NOISE_SECONDS = 1;

type Wave = OscillatorType;

interface Filter {
  readonly type: BiquadFilterType;
  readonly from: number;
  readonly to?: number;
  readonly q?: number;
}

/**
 * Звуковые эффекты. Файлов нет: каждый звук синтезируется на лету (procedural audio) —
 * генератор тона или шума, фильтр и огибающая громкости (быстрая атака, затухание).
 * Контекст Web Audio берём у Phaser: он сам «разблокирует» звук после первого клика или
 * клавиши — до этого браузеры звук не пускают. Без Web Audio звука просто нет.
 */
export class Sfx {
  private readonly ctx: AudioContext | null;
  private readonly master: GainNode | null;
  private readonly noise: AudioBuffer | null;
  private readonly lastAt = new Map<SfxName, number>();
  private mutedNow = loadMuted();

  constructor(sound: Phaser.Sound.BaseSoundManager) {
    this.ctx = sound instanceof Phaser.Sound.WebAudioSoundManager ? sound.context : null;
    if (!this.ctx) {
      this.master = null;
      this.noise = null;
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.mutedNow ? 0 : VOLUME;
    this.master.connect(this.ctx.destination);
    this.noise = this.makeNoise(this.ctx);
  }

  get muted(): boolean {
    return this.mutedNow;
  }

  /** Вкл/выкл звук; настройка запоминается в браузере. Возвращает новое состояние. */
  toggleMute(): boolean {
    this.mutedNow = !this.mutedNow;
    saveMuted(this.mutedNow);
    this.master?.gain.setValueAtTime(this.mutedNow ? 0 : VOLUME, this.ctx?.currentTime ?? 0);
    return this.mutedNow;
  }

  /** Сыграть звук через delayMs — в момент, когда его анимация до него дойдёт. */
  play(name: SfxName, delayMs = 0): void {
    const ctx = this.ctx;
    if (!ctx || this.mutedNow || ctx.state !== 'running') return;
    const t = ctx.currentTime + delayMs / 1000;
    const last = this.lastAt.get(name);
    if (last !== undefined && Math.abs(t - last) < MERGE_S) return;
    this.lastAt.set(name, t);
    this.recipe(name, t);
  }

  /** Отключиться от выхода — при уходе со сцены. */
  destroy(): void {
    this.master?.disconnect();
  }

  // Рецепты: частоты в Гц, длительности в секундах, громкость 0…1.
  private recipe(name: SfxName, t: number): void {
    switch (name) {
      case 'step':
        return this.hiss(t, 0.05, 0.1, { type: 'lowpass', from: 500 });
      case 'bump':
        return this.tone(t, 'sine', 120, 60, 0.08, 0.3);
      case 'swing':
        return this.hiss(t, 0.14, 0.2, { type: 'bandpass', from: 600, to: 3000, q: 1.5 });
      case 'bow':
        this.tone(t, 'triangle', 330, 160, 0.12, 0.25);
        return this.hiss(t, 0.03, 0.12, { type: 'highpass', from: 2000 });
      case 'wand':
        this.tone(t, 'square', 1400, 250, 0.18, 0.06);
        return this.tone(t, 'sine', 2000, 600, 0.18, 0.08);
      case 'hit':
        this.hiss(t, 0.08, 0.35, { type: 'lowpass', from: 1800 });
        return this.tone(t, 'sine', 160, 50, 0.12, 0.4);
      case 'death':
        return this.tone(t, 'sawtooth', 300, 60, 0.45, 0.1);
      case 'coin':
        this.tone(t, 'square', 988, 988, 0.07, 0.06);
        return this.tone(t + 0.07, 'square', 1319, 1319, 0.18, 0.06);
      case 'pickup':
        return this.tone(t, 'triangle', 520, 780, 0.1, 0.18);
      case 'equip':
        this.hiss(t, 0.03, 0.15, { type: 'highpass', from: 3000 });
        return this.tone(t, 'square', 220, 220, 0.04, 0.05);
      case 'drink':
        for (const [i, f] of [500, 650, 560].entries()) {
          this.tone(t + i * 0.08, 'sine', f, f * 1.6, 0.06, 0.15);
        }
        return;
      case 'door':
        this.tone(t, 'square', 90, 70, 0.35, 0.07);
        return this.hiss(t, 0.3, 0.12, { type: 'lowpass', from: 400 });
      case 'won':
        for (const [i, f] of [523, 659, 784, 1047].entries()) {
          this.tone(t + i * 0.1, 'triangle', f, f, 0.15, 0.2);
        }
        return;
      case 'lost':
        for (const [i, f] of [392, 330, 262, 196].entries()) {
          this.tone(t + i * 0.18, 'triangle', f, f, 0.25, 0.2);
        }
        return;
    }
  }

  /** Тон: частота скользит от from к to, громкость — щелчок атаки и затухание. */
  private tone(t: number, wave: Wave, from: number, to: number, dur: number, vol: number): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(from, t);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    this.voice(osc, t, dur, vol);
  }

  /** Шум через фильтр: шорох шага, свист взмаха, удар. */
  private hiss(t: number, dur: number, vol: number, filter: Filter): void {
    if (!this.ctx || !this.noise) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const biquad = this.ctx.createBiquadFilter();
    biquad.type = filter.type;
    biquad.Q.value = filter.q ?? 1;
    biquad.frequency.setValueAtTime(filter.from, t);
    if (filter.to) biquad.frequency.exponentialRampToValueAtTime(filter.to, t + dur);
    src.connect(biquad);
    this.voice(src, t, dur, vol, biquad);
  }

  /** Огибающая громкости и запуск: источник (через узел out, если есть) → gain → master. */
  private voice(
    src: AudioScheduledSourceNode,
    t: number,
    dur: number,
    vol: number,
    out: AudioNode = src,
  ): void {
    if (!this.ctx || !this.master) return;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    out.connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * NOISE_SECONDS, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
}
