import { Component, computed, inject, OnDestroy } from '@angular/core';
import {
  TunerService,
  GUITAR_STRINGS, HALF_STEP_DOWN_STRINGS, D_STANDARD_STRINGS, FACGCE_STRINGS,
  BANJO_GDGBD_STRINGS, BASS_4_STRINGS,
  Tuning, Instrument,
} from './tuner.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnDestroy {
  private tuner = inject(TunerService);
  readonly state = this.tuner.state;
  readonly instrument = this.tuner.instrument;
  readonly tuning = this.tuner.tuning;
  readonly lockedStringIndex = this.tuner.lockedStringIndex;

  readonly strings = computed(() => {
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
  });

  errorMessage = '';

  setInstrument(instrument: Instrument): void {
    this.tuner.stop();
    this.tuner.setInstrument(instrument);
  }

  setTuning(tuning: Tuning): void {
    this.tuner.stop();
    this.tuner.setTuning(tuning);
  }

  async selectString(index: number): Promise<void> {
    const { isListening } = this.state();

    if (!isListening) {
      try {
        this.errorMessage = '';
        this.tuner.setLockedString(index);
        await this.tuner.start();
      } catch {
        this.tuner.setLockedString(-1);
        this.errorMessage = 'Microphone access denied. Please allow microphone access and try again.';
      }
    } else if (this.lockedStringIndex() === index) {
      this.tuner.stop();
    } else {
      this.tuner.setLockedString(index);
    }
  }

  readonly displayNoteName = computed(() => {
    const locked = this.lockedStringIndex();
    if (locked >= 0) return this.strings()[locked]?.name ?? '--';
    return '--';
  });

  readonly needleAngle = computed(() => {
    const { hasSignal, cents } = this.state();
    if (!hasSignal) return 0;
    return Math.max(-90, Math.min(90, cents * 1.8));
  });

  readonly tuneStatus = computed(() => {
    const { hasSignal, cents } = this.state();
    if (!hasSignal) return 'inactive';
    if (Math.abs(cents) <= 5) return 'in-tune';
    if (Math.abs(cents) <= 15) return 'close';
    return 'off';
  });

  readonly displayFreq = computed(() => {
    const f = this.state().detectedFreq;
    return f > 0 ? `${f.toFixed(1)} Hz` : '';
  });

  readonly displayCents = computed(() => {
    const { hasSignal, cents } = this.state();
    if (!hasSignal) return '';
    const sign = cents >= 0 ? '+' : '';
    return `${sign}${Math.round(cents)}`;
  });

  readonly statusLabel = computed(() => {
    const status = this.tuneStatus();
    if (status === 'in-tune') return 'IN TUNE';
    if (status === 'close') return 'CLOSE';
    if (this.state().isListening) return 'PLAY THE STRING...';
    return 'TAP A STRING TO START';
  });

  ngOnDestroy(): void {
    this.tuner.stop();
  }
}
