import { Injectable, signal } from '@angular/core';

export interface GuitarString {
  name: string;
  freq: number;
}

export const GUITAR_STRINGS: GuitarString[] = [
  { name: 'E2', freq: 82.41 },
  { name: 'A', freq: 110.0 },
  { name: 'D', freq: 146.83 },
  { name: 'G', freq: 196.0 },
  { name: 'B', freq: 246.94 },
  { name: 'E4', freq: 329.63 },
];

// All strings tuned one semitone down (× 2^(−1/12))
export const HALF_STEP_DOWN_STRINGS: GuitarString[] = [
  { name: 'Eb2', freq: 77.78 },
  { name: 'Ab', freq: 103.83 },
  { name: 'Db', freq: 138.59 },
  { name: 'Gb', freq: 185.0 },
  { name: 'Bb', freq: 233.08 },
  { name: 'Eb4', freq: 311.13 },
];

// All strings tuned two semitones down (× 2^(−2/12))
export const D_STANDARD_STRINGS: GuitarString[] = [
  { name: 'D2', freq: 73.42 },
  { name: 'G', freq: 98.0 },
  { name: 'C', freq: 130.81 },
  { name: 'F', freq: 174.61 },
  { name: 'A', freq: 220.0 },
  { name: 'D4', freq: 293.66 },
];

export const FACGCE_STRINGS: GuitarString[] = [
  { name: 'F2', freq: 87.31 },
  { name: 'A', freq: 110.0 },
  { name: 'C3', freq: 130.81 },
  { name: 'G', freq: 196.0 },
  { name: 'C4', freq: 261.63 },
  { name: 'E4', freq: 329.63 },
];

// 5-string banjo open G: 5th-string drone (g4) + strings 4–1
export const BANJO_GDGBD_STRINGS: GuitarString[] = [
  { name: 'g',  freq: 392.0  },
  { name: 'D',  freq: 146.83 },
  { name: 'G',  freq: 196.0  },
  { name: 'B',  freq: 246.94 },
  { name: 'D4', freq: 293.66 },
];

// Standard 4-string bass (E1–A1–D2–G2)
export const BASS_4_STRINGS: GuitarString[] = [
  { name: 'E1', freq: 41.20 },
  { name: 'A1', freq: 55.00 },
  { name: 'D2', freq: 73.42 },
  { name: 'G2', freq: 98.00 },
];

export type Tuning = 'standard' | 'half-step-down' | 'd-standard' | 'facgce';
export type Instrument = 'guitar' | 'banjo' | 'bass';

export interface TunerState {
  isListening: boolean;
  hasSignal: boolean;
  detectedFreq: number;
  targetFreq: number;
  noteName: string;
  stringIndex: number;
  cents: number;
}

@Injectable({ providedIn: 'root' })
export class TunerService {
  readonly instrument = signal<Instrument>('guitar');
  readonly tuning = signal<Tuning>('standard');
  readonly lockedStringIndex = signal<number>(-1);

  setLockedString(index: number): void {
    this.lockedStringIndex.set(index);
  }

  readonly activeStrings = () => {
    switch (this.instrument()) {
      case 'banjo': return BANJO_GDGBD_STRINGS;
      case 'bass':  return BASS_4_STRINGS;
      default:
        switch (this.tuning()) {
          case 'half-step-down': return HALF_STEP_DOWN_STRINGS;
          case 'd-standard':     return D_STANDARD_STRINGS;
          case 'facgce':         return FACGCE_STRINGS;
          default:               return GUITAR_STRINGS;
        }
    }
  };

  setInstrument(instrument: Instrument): void {
    this.instrument.set(instrument);
  }

  setTuning(tuning: Tuning): void {
    this.tuning.set(tuning);
  }

  readonly state = signal<TunerState>({
    isListening: false,
    hasSignal: false,
    detectedFreq: 0,
    targetFreq: 0,
    noteName: '',
    stringIndex: -1,
    cents: 0,
  });

  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private rafId: number | null = null;
  private buf: Float32Array<ArrayBuffer> | null = null;
  private recentFreqs: number[] = [];

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    // 4096 samples gives a maxLag of 2048, covering frequencies down to ~21 Hz —
    // enough for bass E1 (41 Hz) with margin to spare.
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0;

    const lowpass = this.ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 500;

    const source = this.ctx.createMediaStreamSource(this.stream);
    source.connect(lowpass);
    lowpass.connect(this.analyser);

    this.buf = new Float32Array(this.analyser.fftSize) as Float32Array<ArrayBuffer>;
    this.recentFreqs = [];
    this.state.update((s) => ({ ...s, isListening: true }));
    this.loop();
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.stream = null;
    this.ctx = null;
    this.analyser = null;
    this.buf = null;
    this.lockedStringIndex.set(-1);
    this.state.set({
      isListening: false,
      hasSignal: false,
      detectedFreq: 0,
      targetFreq: 0,
      noteName: '',
      stringIndex: -1,
      cents: 0,
    });
  }

  private loop = (): void => {
    this.rafId = requestAnimationFrame(this.loop);
    if (!this.analyser || !this.buf || !this.ctx) return;

    this.analyser.getFloatTimeDomainData(this.buf);

    // Lower bound for pitch search: 20% below the lowest string in the active set.
    const lowestStringFreq = Math.min(...this.activeStrings().map((s) => s.freq));
    const freq = this.detectPitch(this.buf, this.ctx.sampleRate, lowestStringFreq * 0.8);

    if (freq > 0) {
      this.recentFreqs.push(freq);
      if (this.recentFreqs.length > 5) this.recentFreqs.shift();
      const smooth = this.recentFreqs.reduce((a, b) => a + b) / this.recentFreqs.length;

      const match = this.findClosestNote(smooth);
      this.state.update((s) => ({
        ...s,
        hasSignal: true,
        detectedFreq: smooth,
        targetFreq: match.freq,
        noteName: match.name,
        stringIndex: match.index,
        cents: match.cents,
      }));
    } else {
      this.recentFreqs = [];
      this.state.update((s) => ({ ...s, hasSignal: false }));
    }
  };

  private detectPitch(
    buf: Float32Array<ArrayBuffer>,
    sampleRate: number,
    minFreq: number,
  ): number {
    let rms = 0;
    for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / buf.length);
    if (rms < 0.005) return -1;

    const n = buf.length;
    const minLag = Math.floor(sampleRate / 400);
    const maxLag = Math.min(Math.ceil(sampleRate / minFreq), Math.floor(n / 2));

    const corr = new Float32Array(maxLag + 1) as Float32Array<ArrayBuffer>;
    for (let lag = 0; lag <= maxLag; lag++) {
      let sum = 0;
      const len = n - lag;
      for (let i = 0; i < len; i++) sum += buf[i] * buf[i + lag];
      corr[lag] = sum / len;
    }

    if (corr[0] <= 0) return -1;

    // Find where the initial downslope ends (the dip)
    let dipEnd = 1;
    while (dipEnd < maxLag - 1 && corr[dipEnd + 1] < corr[dipEnd]) dipEnd++;
    dipEnd = Math.max(dipEnd, minLag);

    // Find the best peak after the dip
    let maxCorr = -1;
    let maxLagIdx = -1;
    for (let lag = dipEnd; lag <= maxLag; lag++) {
      if (corr[lag] > maxCorr) {
        maxCorr = corr[lag];
        maxLagIdx = lag;
      }
    }

    if (maxLagIdx < 0 || maxCorr / corr[0] < 0.5) return -1;

    // Parabolic interpolation for sub-sample accuracy
    let refined = maxLagIdx;
    if (maxLagIdx > 0 && maxLagIdx < maxLag) {
      const y1 = corr[maxLagIdx - 1];
      const y2 = corr[maxLagIdx];
      const y3 = corr[maxLagIdx + 1];
      const a = y1 + y3 - 2 * y2;
      if (Math.abs(a) > 0.00001) {
        refined = maxLagIdx + (y1 - y3) / (2 * a);
      }
    }

    return sampleRate / refined;
  }

  private findClosestNote(freq: number): {
    name: string;
    freq: number;
    cents: number;
    index: number;
  } {
    const strings = this.activeStrings();
    const locked = this.lockedStringIndex();

    if (locked >= 0 && locked < strings.length) {
      const s = strings[locked];
      return { name: s.name, freq: s.freq, cents: 1200 * Math.log2(freq / s.freq), index: locked };
    }

    let best = { name: strings[0].name, freq: strings[0].freq, cents: 0, index: 0 };
    let minAbsCents = Infinity;
    for (let i = 0; i < strings.length; i++) {
      const s = strings[i];
      const cents = 1200 * Math.log2(freq / s.freq);
      if (Math.abs(cents) < minAbsCents) {
        minAbsCents = Math.abs(cents);
        best = { name: s.name, freq: s.freq, cents, index: i };
      }
    }
    return best;
  }
}
