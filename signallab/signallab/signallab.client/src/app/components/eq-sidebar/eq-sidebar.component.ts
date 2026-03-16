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
export interface WaveletBand  { level: number; name: string; coeffStart: number; coeffEnd: number}

export interface EntityConfig {
  label:        string;
  freqBands:    FreqRange[];
  freqGain:     number;
  wavelet:      string;
  waveletBands: WaveletBand[];
  waveletGain:  number;
}

export interface AdvancedEqConfig { entities: EntityConfig[]; }

export interface WaveletInstruction {
  entityLabel:  string;
  wavelet:      string;
  waveletBands: WaveletBand[];
  gain:         number;
}


export interface WaveletBandRequest {
  level:       number;
  gain:        number;
  coeff_start: number | null;
  coeff_end:   number | null;
}

// ── AI Mode types ──────────────────────────────────────────────────────────

export interface AiSlider {
  key:    string;
  label:  string;
  weight: number;
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
        freqBands: [{ from: 38, to: 233 }],
        waveletBands: [
          { level: 0, name: 'Approximation', coeffStart: 11698, coeffEnd: 54003 },
          { level: 1, name: 'Detail 1',       coeffStart: 11717, coeffEnd: 53567 },
        ],
      },
      {
        label: 'Piano', freqGain: 1, wavelet: 'db4', waveletGain: 1,
        freqBands: [{ from: 363, to: 1571 }],
        waveletBands: [
          { level: 0, name: 'Approximation', coeffStart:  5385, coeffEnd: 53209 },
          { level: 1, name: 'Detail 1',       coeffStart:  8478, coeffEnd: 35276 },
          { level: 2, name: 'Detail 2',       coeffStart: 16953, coeffEnd: 70089 },
        ],
      },
      {
        label: 'Guitar', freqGain: 1, wavelet: 'db4', waveletGain: 1,
        freqBands: [{ from: 452, to: 3198 }],
        waveletBands: [
          { level: 0, name: 'Approximation', coeffStart: 38577, coeffEnd: 54072 },
          { level: 1, name: 'Detail 1',       coeffStart: 38581, coeffEnd: 54079 },
        ],
      },
      {
        label: 'Drums', freqGain: 1, wavelet: 'db4', waveletGain: 1,
        freqBands: [{ from: 151, to: 1639 }],
        waveletBands: [
          { level: 0, name: 'Approximation', coeffStart: 11688, coeffEnd: 53660 },
          { level: 2, name: 'Detail 2',       coeffStart: 24997, coeffEnd: 105513 },
          { level: 3, name: 'Detail 3',       coeffStart: 49990, coeffEnd: 211429 },
          { level: 4, name: 'Detail 4',       coeffStart: 93569, coeffEnd: 409104 },
        ],
      },
    ],
  },
animal: {
    entities: [
      {
        label: 'Dog', freqGain: 1, wavelet: 'db4', waveletGain: 1,
        freqBands: [{ from: 500, to: 2000 }],
        waveletBands: [{ level: 2, name: 'Detail 2', coeffStart: 1000, coeffEnd: 5000 }],
      },
      {
        label: 'Cat', freqGain: 1, wavelet: 'db4', waveletGain: 1,
        freqBands: [{ from: 2000, to: 5000 }],
        waveletBands: [
          { level: 1, name: 'Detail 1', coeffStart: 2000, coeffEnd: 6000 },
          { level: 2, name: 'Detail 2', coeffStart: 1000, coeffEnd: 3000 },
        ],
      },
      {
        label: 'Bird', freqGain: 1, wavelet: 'sym5', waveletGain: 1,
        freqBands: [{ from: 5000, to: 10000 }],
        waveletBands: [{ level: 1, name: 'Detail 1', coeffStart: 5000, coeffEnd: 12000 }],
      },
      {
        label: 'Frog', freqGain: 1, wavelet: 'haar', waveletGain: 1,
        freqBands: [{ from: 100, to: 800 }],
        waveletBands: [{ level: 3, name: 'Detail 3', coeffStart: 500, coeffEnd: 4000 }],
      },
    ],
  },
human: {
  entities: [
    {
      label: 'Speaker 1', freqGain: 1, wavelet: 'db8', waveletGain: 1,
      freqBands: [{ from: 125, to: 500 }],
      waveletBands: [
        { level: 4, name: 'Detail 4', coeffStart: 69,  coeffEnd: 12705 },  // 500–1000 Hz, mean_e=0.0086
        { level: 3, name: 'Detail 3', coeffStart: 48,  coeffEnd: 6970  },  // 1000–2000 Hz, mean_e=0.0080
        { level: 5, name: 'Detail 5', coeffStart: 172, coeffEnd: 25488 },  // 250–500 Hz,  mean_e=0.0050
      ],
    },
    {
      label: 'Speaker 2', freqGain: 1, wavelet: 'db8', waveletGain: 1,
      freqBands: [{ from: 250, to: 1000 }],
      waveletBands: [
        { level: 4, name: 'Detail 4', coeffStart: 603, coeffEnd: 13719 },  // 500–1000 Hz, mean_e=0.0258
        { level: 3, name: 'Detail 3', coeffStart: 272, coeffEnd: 6849  },  // 1000–2000 Hz, mean_e=0.0158
        { level: 5, name: 'Detail 5', coeffStart: 231, coeffEnd: 27718 },  // 250–500 Hz,  mean_e=0.0185
      ],
    },
    {
      label: 'Speaker 3', freqGain: 1, wavelet: 'db8', waveletGain: 1,
      freqBands: [{ from: 250, to: 1000 }],
      waveletBands: [
        { level: 4, name: 'Detail 4', coeffStart: 2310, coeffEnd: 13280 }, // 500–1000 Hz, mean_e=0.0319
        { level: 3, name: 'Detail 3', coeffStart: 2052, coeffEnd: 6610  }, // 1000–2000 Hz, mean_e=0.0225
        { level: 5, name: 'Detail 5', coeffStart: 743,  coeffEnd: 26385 }, // 250–500 Hz,  mean_e=0.0149
      ],
    },
    {
      label: 'Speaker 4', freqGain: 1, wavelet: 'db8', waveletGain: 1,
      freqBands: [{ from: 125, to: 500 }],
      waveletBands: [
        { level: 3, name: 'Detail 3', coeffStart: 33,  coeffEnd: 6962  },  // 1000–2000 Hz, mean_e=0.0110
        { level: 4, name: 'Detail 4', coeffStart: 81,  coeffEnd: 13526 },  // 500–1000 Hz,  mean_e=0.0098
        { level: 2, name: 'Detail 2', coeffStart: 17,  coeffEnd: 3493  },  // 2000–4000 Hz, mean_e=0.0071
      ],
    },
  ],
},
  ecg: {
    entities: [
      {
        label: 'Normal Sinus', freqGain: 1, wavelet: 'db4', waveletGain: 1,
        freqBands: [{ from: 0.5, to: 40 }],
        waveletBands: [
          { level: 4, name: 'Approximation', coeffStart: 100, coeffEnd: 2000 },
          { level: 3, name: 'Detail 3',       coeffStart: 200, coeffEnd: 4000 },
        ],
      },
      {
        label: 'Atrial Flutter', freqGain: 1, wavelet: 'sym4', waveletGain: 1,
        freqBands: [{ from: 6, to: 12 }, { from: 24, to: 48 }],
        waveletBands: [{ level: 2, name: 'Detail 2', coeffStart: 300, coeffEnd: 3000 }],
      },
      {
        label: 'Ventricular Fibr.', freqGain: 1, wavelet: 'db8', waveletGain: 1,
        freqBands: [{ from: 150, to: 500 }],
        waveletBands: [{ level: 1, name: 'Detail 1', coeffStart: 500, coeffEnd: 5000 }],
      },
      {
        label: 'Bradycardia', freqGain: 1, wavelet: 'db4', waveletGain: 1,
        freqBands: [{ from: 0.5, to: 1 }],
        waveletBands: [{ level: 5, name: 'Approximation', coeffStart: 50, coeffEnd: 1000 }],
      },
    ],
  },
};

// ── AI slider definitions per mode ─────────────────────────────────────────

const AI_SLIDERS: Record<Exclude<AppMode, 'generic'>, AiSlider[]> = {
  ecg: [
    { key: 'N', label: 'Normal Beat',                       weight: 1 },
    { key: 'L', label: 'Left Bundle Branch Block Beat',     weight: 1 },
    { key: 'R', label: 'Right Bundle Branch Block Beat',    weight: 1 },
    { key: 'V', label: 'Premature Ventricular Contraction', weight: 1 },
    { key: 'A', label: 'Atrial Premature Beat',             weight: 1 },
  ],
  musical: [
    { key: 'guitar', label: 'Guitar', weight: 1 },
    { key: 'piano',  label: 'Piano',  weight: 1 },
    { key: 'bass',   label: 'Bass',   weight: 1 },
    { key: 'drums',  label: 'Drums',  weight: 1 },
  ],
  animal: [
    { key: 'cat',  label: 'Cat',  weight: 1 },
    { key: 'dog',  label: 'Dog',  weight: 1 },
    { key: 'cow',  label: 'Cow',  weight: 1 },
    { key: 'lion', label: 'Lion', weight: 1 },
  ],
  human: [
    { key: 'speaker1', label: 'Speaker 1', weight: 1 },
    { key: 'speaker2', label: 'Speaker 2', weight: 1 },
    { key: 'speaker3', label: 'Speaker 3', weight: 1 },
    { key: 'speaker4', label: 'Speaker 4', weight: 1 },
  ],
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

  @Input()  mode:       AppMode    = 'generic';
  /** The File the parent already loaded — AI mode reuses it directly. */
  @Input()  signalFile: File | null = null;

  @Output() bandsChange    = new EventEmitter<FreqBand[]>();
  @Output() waveletChange  = new EventEmitter<WaveletInstruction[]>();
  @Output() aiOutputChange = new EventEmitter<Float32Array>();
  @Output() waveletOutputChange = new EventEmitter<Float32Array>();

  @ViewChild('configInput') configInputRef!: ElementRef<HTMLInputElement>;

  // ── Generic mode state ─────────────────────────────────────────────
  bands:       FreqBand[] = [];
  newBandLabel = 'New Band';
  newBandFrom  = 0;
  newBandTo    = 1000;
  newBandGain  = 1;

  // ── Advanced mode state ────────────────────────────────────────────
  entities:   EntityConfig[] = [];
  activeTabs: Record<number, 'freq' | 'wavelet'> = {};

  configError = '';

  // ── AI Mode state ──────────────────────────────────────────────────
  isAiMode        = false;
  aiSliders:      AiSlider[] = [];
  aiComponents:   Map<string, Float32Array> = new Map();
  aiIsLoading     = false;
  aiError         = '';
  aiHasComponents = false;

  get isGeneric(): boolean { return this.mode === 'generic'; }

  // ── Lifecycle ──────────────────────────────────────────────────────

  ngOnInit(): void { this.loadDefault(); }

  ngOnChanges(c: SimpleChanges): void {
    // Mode switched — reset AI state and reload EQ defaults
    if (c['mode'] && !c['mode'].firstChange) {
      this.configError     = '';
      this.isAiMode        = false;
      this.aiComponents.clear();
      this.aiHasComponents = false;
      this.aiError         = '';
      this.loadDefault();
      this.resetAiSliders();
    }

    // Parent loaded a new file while AI mode is already active → re-decompose
    if (c['signalFile'] && !c['signalFile'].firstChange
        && this.isAiMode && this.signalFile) {
      this.aiComponents.clear();
      this.aiHasComponents = false;
      this.decomposeSignal(this.signalFile);
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

  private async applyWaveletGains(signal: Float32Array, instructions: WaveletInstruction[]): Promise<Float32Array> {
  // Flatten all wavelet bands from all entities into one request per entity
  for (const instruction of instructions) {
    const gainBands: WaveletBandRequest[] = instruction.waveletBands.map(b => ({
      level:       b.level,
      gain:        instruction.gain,
      coeff_start: b.coeffStart ?? null,
      coeff_end:   b.coeffEnd   ?? null,
    }));

    const res = await fetch('http://127.0.0.1:8000/applywaveletgains', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signal:     Array.from(signal),
        wavelet:    instruction.wavelet,
        level:      5,
        gain_bands: gainBands,
      }),
    });

    if (!res.ok) throw new Error(`Wavelet gain failed for ${instruction.entityLabel}: ${res.status}`);

    const data = await res.json();
    signal = new Float32Array(data.modified_signal);
  }

  // Return final signal after all entities have been applied in sequence
  return signal;
}

async applyWavelet(signal: Float32Array): Promise<void> {
  if (!this.isGeneric && this.entities.length > 0) {
    const instructions: WaveletInstruction[] = this.entities.map(e => ({
      entityLabel:  e.label,
      wavelet:      e.wavelet,
      waveletBands: e.waveletBands,
      gain:         e.waveletGain,
    }));

    try {
      const processed = await this.applyWaveletGains(signal, instructions);
      this.waveletOutputChange.emit(processed);   // ← was aiOutputChange
    } catch (err: any) {
      this.aiError = err?.message ?? 'Wavelet processing failed.';
    }
  }
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

  // ── AI Mode ────────────────────────────────────────────────────────

  toggleAiMode(): void {
    this.isAiMode = !this.isAiMode;
    if (this.isAiMode) {
      if (this.aiSliders.length === 0) this.resetAiSliders();
      if (!this.aiHasComponents) {
        if (this.signalFile) {
          this.decomposeSignal(this.signalFile);
        } else {
          this.aiError = 'No signal loaded yet. Load a signal file first.';
        }
      }
    }
  }

  private resetAiSliders(): void {
    if (this.isGeneric) { this.aiSliders = []; return; }
    const defs = AI_SLIDERS[this.mode as Exclude<AppMode, 'generic'>];
    this.aiSliders = defs.map(s => ({ ...s, weight: 1 }));
  }

  async decomposeSignal(file: File): Promise<void> {
    this.aiIsLoading     = true;
    this.aiError         = '';
    this.aiComponents.clear();
    this.aiHasComponents = false;

    try {
      switch (this.mode) {
        case 'ecg':     await this.decomposeEcg(file);     break;
        case 'musical': await this.decomposeMusical(file); break;
        case 'animal':  await this.decomposeAnimal(file);  break;
        case 'human':   await this.decomposeHuman(file);   break;
        default:
          this.aiError = 'AI mode not supported for this signal type.';
      }
    } catch (err: any) {
      this.aiError = err?.message ?? 'Unknown error during decomposition.';
    }

    this.aiIsLoading = false;
  }

  // ── ECG decomposition (live) ───────────────────────────────────────

  private async decomposeEcg(file: File): Promise<void> {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('http://127.0.0.1:8000/decomposeecg', {
      method: 'POST', body: formData,
    });

    if (!res.ok) {
      throw new Error(`ECG decomposition failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();

    if (!data?.components || typeof data.components !== 'object') {
      throw new Error('Unexpected response from /decomposeecg — missing "components" key.');
    }

    for (const [key, arr] of Object.entries(data.components)) {
      this.aiComponents.set(key, new Float32Array(arr as number[]));
    }

    this.aiHasComponents = true;
    this.emitAiBlend();
  }

  // ── Musical decomposition ──────────────────────────────────────────

  private async decomposeMusical(file: File): Promise<void> {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('http://127.0.0.1:8000/segmentmusic', {
      method: 'POST', body: formData,
    });
    if (!res.ok) {
      throw new Error(`Music decomposition failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    // Response shape: { bass: { audio_b64, sample_rate, ... }, drums: {...}, guitar: {...}, piano: {...} }
    const keys = ['bass', 'drums', 'guitar', 'piano'] as const;
    for (const key of keys) {
      if (!data[key]?.audio_b64) throw new Error(`Missing stem "${key}" in response.`);
      this.aiComponents.set(key, await this.decodeWavB64(data[key].audio_b64));
    }

    this.aiHasComponents = true;
    this.emitAiBlend();
  }

  // ── Human voice decomposition ──────────────────────────────────────

  private async decomposeHuman(file: File): Promise<void> {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('http://127.0.0.1:8000/segmenthumanvoice', {
      method: 'POST', body: formData,
    });
    if (!res.ok) {
      throw new Error(`Voice decomposition failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    // Response shape: { voice_1: { audio_b64, sample_rate, ... }, voice_2: {...}, ... }
    const keyMap: Record<string, string> = {
      voice_1: 'speaker1',
      voice_2: 'speaker2',
      voice_3: 'speaker3',
      voice_4: 'speaker4',
    };
    for (const [responseKey, sliderKey] of Object.entries(keyMap)) {
      if (!data[responseKey]?.audio_b64) throw new Error(`Missing speaker "${responseKey}" in response.`);
      this.aiComponents.set(sliderKey, await this.decodeWavB64(data[responseKey].audio_b64));
    }

    this.aiHasComponents = true;
    this.emitAiBlend();
  }

  // ── Stub decomposition ─────────────────────────────────────────────

  /** TODO: POST to /decomposeanimal — expected keys: cat, dog, cow, lion */
  private async decomposeAnimal(_file: File): Promise<void> {
    throw new Error('Animal decomposition endpoint is not yet connected.');
  }

  // ── WAV base64 decoder ─────────────────────────────────────────────
  // Decodes a base64-encoded WAV file into a normalised Float32Array
  // using the browser's AudioContext so all WAV formats are handled.

  private async decodeWavB64(b64: string): Promise<Float32Array> {
    const binary  = atob(b64);
    const bytes   = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    // AudioContext.decodeAudioData handles PCM / float / compressed WAV
    const audioCtx = new AudioContext();
    const buffer   = await audioCtx.decodeAudioData(bytes.buffer);
    audioCtx.close();

    // Always return mono: if stereo, average the two channels
    if (buffer.numberOfChannels === 1) {
      return buffer.getChannelData(0).slice();
    }
    const ch0    = buffer.getChannelData(0);
    const ch1    = buffer.getChannelData(1);
    const mono   = new Float32Array(ch0.length);
    for (let i = 0; i < ch0.length; i++) mono[i] = (ch0[i] + ch1[i]) * 0.5;
    return mono;
  }

  // ── Slider weight change ───────────────────────────────────────────

  onAiWeightChange(sliderIndex: number, val: string): void {
    this.aiSliders[sliderIndex] = { ...this.aiSliders[sliderIndex], weight: parseFloat(val) };
    this.emitAiBlend();
  }

  resetAiWeights(): void {
    this.aiSliders = this.aiSliders.map(s => ({ ...s, weight: 1 }));
    this.emitAiBlend();
  }

  // ── Blend & emit ───────────────────────────────────────────────────

  private emitAiBlend(): void {
    if (!this.aiHasComponents || this.aiComponents.size === 0) return;

    let length = 0;
    for (const arr of this.aiComponents.values()) { length = arr.length; break; }
    if (length === 0) return;

    const blended = new Float32Array(length);
    for (const slider of this.aiSliders) {
      const component = this.aiComponents.get(slider.key);
      if (!component) continue;
      const w = slider.weight;
      for (let i = 0; i < length; i++) blended[i] += component[i] * w;
    }

    this.aiOutputChange.emit(blended);
  }

  // ── Emit (freq / wavelet) ──────────────────────────────────────────

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