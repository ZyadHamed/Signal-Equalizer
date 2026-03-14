import {
  Component, OnInit, OnChanges, Input, Output,
  EventEmitter, ViewChild, ElementRef, SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FreqBand, AppMode } from '../signal-viewer/signal-viewer.component';

// ── Shared types ───────────────────────────────────────────────────────────

export interface BandConfig   { label: string; from: number; to: number; gain: number; }
export interface EqConfig     { bands: BandConfig[]; }

export interface FreqRange    { from: number; to: number; }
export interface WaveletBand  { level: number; name: string; }

export interface EntityConfig {
  label:        string;
  freqBands:    FreqRange[];
  freqGain:     number;
  wavelet:      string;
  waveletBands: WaveletBand[];
  waveletGain:  number;
}

export interface AdvancedEqConfig { entities: EntityConfig[]; }

// What we emit to the parent for frequency processing (unchanged contract)
// For wavelet we emit a separate output
export interface WaveletInstruction {
  entityLabel:  string;
  wavelet:      string;
  waveletBands: WaveletBand[];
  gain:         number;
}

// ── Defaults ───────────────────────────────────────────────────────────────

const GENERIC_DEFAULT: EqConfig = {
  bands: [
    { label: 'Sub Bass',   from: 20,    to: 60,    gain: 1 },
    { label: 'Bass',       from: 60,    to: 250,   gain: 1 },
    { label: 'Low Mid',    from: 250,   to: 2000,  gain: 1 },
    { label: 'High Mid',   from: 2000,  to: 6000,  gain: 1 },
    { label: 'Presence',   from: 6000,  to: 12000, gain: 1 },
    { label: 'Brilliance', from: 12000, to: 20000, gain: 1 },
  ],
};

const ADVANCED_DEFAULTS: Record<Exclude<AppMode, 'generic'>, AdvancedEqConfig> = {
  musical: {
    entities: [
      {
        label: 'Bass Guitar', freqGain: 1, wavelet: 'db4', waveletGain: 1,
        freqBands: [{ from: 40, to: 300 }],
        waveletBands: [{ level: 1, name: 'Detail 1' }, { level: 2, name: 'Detail 2' }],
      },
      {
        label: 'Piano', freqGain: 1, wavelet: 'db4', waveletGain: 1,
        freqBands: [{ from: 300, to: 1000 }, { from: 2000, to: 4000 }],
        waveletBands: [{ level: 2, name: 'Detail 2' }, { level: 3, name: 'Detail 3' }],
      },
      {
        label: 'Violin', freqGain: 1, wavelet: 'sym5', waveletGain: 1,
        freqBands: [{ from: 600, to: 2000 }, { from: 4000, to: 8000 }],
        waveletBands: [{ level: 1, name: 'Detail 1' }, { level: 3, name: 'Detail 3' }],
      },
      {
        label: 'Drums', freqGain: 1, wavelet: 'haar', waveletGain: 1,
        freqBands: [{ from: 40, to: 200 }, { from: 6000, to: 16000 }],
        waveletBands: [{ level: 1, name: 'Detail 1' }],
      },
    ],
  },
  animal: {
    entities: [
      {
        label: 'Dog', freqGain: 1, wavelet: 'db4', waveletGain: 1,
        freqBands: [{ from: 500, to: 2000 }],
        waveletBands: [{ level: 2, name: 'Detail 2' }],
      },
      {
        label: 'Cat', freqGain: 1, wavelet: 'db4', waveletGain: 1,
        freqBands: [{ from: 2000, to: 5000 }],
        waveletBands: [{ level: 1, name: 'Detail 1' }, { level: 2, name: 'Detail 2' }],
      },
      {
        label: 'Bird', freqGain: 1, wavelet: 'sym5', waveletGain: 1,
        freqBands: [{ from: 5000, to: 10000 }],
        waveletBands: [{ level: 1, name: 'Detail 1' }],
      },
      {
        label: 'Frog', freqGain: 1, wavelet: 'haar', waveletGain: 1,
        freqBands: [{ from: 100, to: 800 }],
        waveletBands: [{ level: 3, name: 'Detail 3' }],
      },
    ],
  },
  human: {
    entities: [
      {
        label: 'Male (Low)', freqGain: 1, wavelet: 'db6', waveletGain: 1,
        freqBands: [{ from: 85, to: 200 }],
        waveletBands: [{ level: 3, name: 'Approximation' }],
      },
      {
        label: 'Male (High)', freqGain: 1, wavelet: 'db6', waveletGain: 1,
        freqBands: [{ from: 100, to: 300 }],
        waveletBands: [{ level: 2, name: 'Detail 2' }],
      },
      {
        label: 'Female (Low)', freqGain: 1, wavelet: 'db6', waveletGain: 1,
        freqBands: [{ from: 165, to: 400 }],
        waveletBands: [{ level: 2, name: 'Detail 2' }],
      },
      {
        label: 'Female (High)', freqGain: 1, wavelet: 'db6', waveletGain: 1,
        freqBands: [{ from: 200, to: 500 }],
        waveletBands: [{ level: 1, name: 'Detail 1' }],
      },
    ],
  },
  ecg: {
    entities: [
      {
        label: 'Normal Sinus', freqGain: 1, wavelet: 'db4', waveletGain: 1,
        freqBands: [{ from: 0.5, to: 40 }],
        waveletBands: [{ level: 4, name: 'Approximation' }, { level: 3, name: 'Detail 3' }],
      },
      {
        label: 'Atrial Flutter', freqGain: 1, wavelet: 'sym4', waveletGain: 1,
        freqBands: [{ from: 6, to: 12 }, { from: 24, to: 48 }],
        waveletBands: [{ level: 2, name: 'Detail 2' }],
      },
      {
        label: 'Ventricular Fibr.', freqGain: 1, wavelet: 'db8', waveletGain: 1,
        freqBands: [{ from: 150, to: 500 }],
        waveletBands: [{ level: 1, name: 'Detail 1' }],
      },
      {
        label: 'Bradycardia', freqGain: 1, wavelet: 'db4', waveletGain: 1,
        freqBands: [{ from: 0.5, to: 1 }],
        waveletBands: [{ level: 5, name: 'Approximation' }],
      },
    ],
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function genericConfigToBands(cfg: EqConfig): FreqBand[] {
  return cfg.bands.map(b => ({
    label:  b.label,
    gain:   b.gain ?? 1,
    ranges: [{ from: b.from, to: b.to }],
  }));
}

function advancedConfigToBands(cfg: AdvancedEqConfig): FreqBand[] {
  return cfg.entities.map(e => ({
    label:  e.label,
    gain:   e.freqGain,
    ranges: e.freqBands,
  }));
}

@Component({
  selector: 'app-eq-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './eq-sidebar.component.html',
  styleUrls:   ['./eq-sidebar.component.css'],
})
export class EqSidebarComponent implements OnInit, OnChanges {

  @Input()  mode: AppMode = 'generic';
  @Output() bandsChange          = new EventEmitter<FreqBand[]>();
  @Output() waveletChange        = new EventEmitter<WaveletInstruction[]>();

  @ViewChild('configInput') configInputRef!: ElementRef<HTMLInputElement>;

  // ── Generic mode state ─────────────────────────────────────────────
  bands:       FreqBand[] = [];
  newBandLabel = 'New Band';
  newBandFrom  = 0;
  newBandTo    = 1000;
  newBandGain  = 1;

  // ── Advanced mode state ────────────────────────────────────────────
  entities:    EntityConfig[] = [];
  /** Which tab is active per entity index: 'freq' | 'wavelet' */
  activeTabs:  Record<number, 'freq' | 'wavelet'> = {};

  configError = '';

  get isGeneric(): boolean { return this.mode === 'generic'; }

  // ── Lifecycle ──────────────────────────────────────────────────────

  ngOnInit():    void { this.loadDefault(); }
  ngOnChanges(c: SimpleChanges): void {
    if (c['mode'] && !c['mode'].firstChange) {
      this.configError = '';
      this.loadDefault();
    }
  }

  // ── Config I/O ─────────────────────────────────────────────────────

  triggerConfigInput(): void { this.configInputRef.nativeElement.click(); }

  async onConfigSelected(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      if (this.isGeneric) {
        if (!this.isValidGenericConfig(obj)) {
          this.configError = 'Expected: { bands: [{ label, from, to, gain }] }'; return;
        }
        this.configError = '';
        this.applyGenericConfig(obj);
      } else {
        if (!this.isValidAdvancedConfig(obj)) {
          this.configError = 'Expected: { entities: [{ label, freqBands, freqGain, wavelet, waveletBands, waveletGain }] }'; return;
        }
        this.configError = '';
        this.applyAdvancedConfig(obj);
      }
    } catch { this.configError = 'Could not parse JSON file.'; }
    (event.target as HTMLInputElement).value = '';
  }

  downloadCurrentConfig(): void {
    let payload: any;
    if (this.isGeneric) {
      payload = {
        bands: this.bands.map(b => ({
          label: b.label, from: b.ranges[0].from, to: b.ranges[0].to, gain: b.gain,
        })),
      };
    } else {
      payload = { entities: this.entities };
    }
    const a = document.createElement('a');
    a.href     = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    a.download = `${this.mode}_eq_config.json`;
    a.click();
  }

  resetToDefault(): void { this.configError = ''; this.loadDefault(); }

  // ── Internal loaders ───────────────────────────────────────────────

  private loadDefault(): void {
    if (this.isGeneric) {
      this.applyGenericConfig(GENERIC_DEFAULT);
      const last = GENERIC_DEFAULT.bands.at(-1);
      if (last) {
        this.newBandFrom  = last.to;
        this.newBandTo    = last.to + 1000;
        this.newBandLabel = `Band ${GENERIC_DEFAULT.bands.length + 1}`;
        this.newBandGain  = 1;
      }
    } else {
      this.applyAdvancedConfig(ADVANCED_DEFAULTS[this.mode as Exclude<AppMode, 'generic'>]);
    }
  }

  private applyGenericConfig(cfg: EqConfig): void {
    this.bands = genericConfigToBands(cfg);
    this.emitFreq();
  }

  private applyAdvancedConfig(cfg: AdvancedEqConfig): void {
    this.entities   = cfg.entities.map(e => ({ ...e }));
    this.activeTabs = {};
    this.entities.forEach((_, i) => this.activeTabs[i] = 'freq');
    this.emitFreq();
    this.emitWavelet();
  }

  // ── Validation ─────────────────────────────────────────────────────

  private isValidGenericConfig(o: any): o is EqConfig {
    return Array.isArray(o?.bands) && o.bands.length > 0 &&
      o.bands.every((b: any) => typeof b.label === 'string' && typeof b.from === 'number' && typeof b.to === 'number');
  }

  private isValidAdvancedConfig(o: any): o is AdvancedEqConfig {
    return Array.isArray(o?.entities) && o.entities.length > 0 &&
      o.entities.every((e: any) =>
        typeof e.label === 'string' &&
        Array.isArray(e.freqBands) &&
        typeof e.wavelet === 'string' &&
        Array.isArray(e.waveletBands)
      );
  }

  // ── Generic band management ────────────────────────────────────────

  get canAddBands(): boolean { return this.isGeneric; }

  addBand(): void {
    if (this.newBandTo <= this.newBandFrom) { this.configError = '"To" must be greater than "From".'; return; }
    this.configError = '';
    this.bands = [...this.bands, {
      label:  this.newBandLabel || `Band ${this.bands.length + 1}`,
      ranges: [{ from: this.newBandFrom, to: this.newBandTo }],
      gain:   this.newBandGain,
    }];
    this.newBandFrom  = this.newBandTo;
    this.newBandTo   += 1000;
    this.newBandLabel = `Band ${this.bands.length + 1}`;
    this.newBandGain  = 1;
    this.emitFreq();
  }

  removeBand(i: number): void {
    this.bands = this.bands.filter((_, idx) => idx !== i);
    this.emitFreq();
  }

  onGainChange(i: number, val: string): void {
    this.bands = this.bands.map((b, idx) => idx === i ? { ...b, gain: parseFloat(val) } : b);
    this.emitFreq();
  }

  // ── Advanced entity management ─────────────────────────────────────

  setTab(i: number, tab: 'freq' | 'wavelet'): void {
    this.activeTabs = { ...this.activeTabs, [i]: tab };
  }

  onEntityFreqGainChange(i: number, val: string): void {
    this.entities[i] = { ...this.entities[i], freqGain: parseFloat(val) };
    this.emitFreq();
  }

  onEntityWaveletGainChange(i: number, val: string): void {
    this.entities[i] = { ...this.entities[i], waveletGain: parseFloat(val) };
    this.emitWavelet();
  }

  onWaveletNameChange(i: number, val: string): void {
    this.entities[i] = { ...this.entities[i], wavelet: val };
    this.emitWavelet();
  }

  // ── Emit ───────────────────────────────────────────────────────────

  private emitFreq(): void {
    if (this.isGeneric) {
      this.bandsChange.emit(this.bands);
    } else {
      this.bandsChange.emit(advancedConfigToBands({ entities: this.entities }));
    }
  }

  private emitWavelet(): void {
    if (this.isGeneric) return;
    this.waveletChange.emit(
      this.entities.map(e => ({
        entityLabel:  e.label,
        wavelet:      e.wavelet,
        waveletBands: e.waveletBands,
        gain:         e.waveletGain,
      }))
    );
  }
}