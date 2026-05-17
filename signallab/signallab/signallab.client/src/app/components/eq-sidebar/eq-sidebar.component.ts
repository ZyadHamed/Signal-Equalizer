import {
  Component, OnInit, OnChanges, OnDestroy, Input, Output,
  EventEmitter, ViewChild, ElementRef, SimpleChanges, HostListener
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FreqBand, AppMode } from '../signal-viewer/signal-viewer.component';

// ── Shared types ───────────────────────────────────────────────────────────

export interface BandConfig   { label: string; from: number; to: number; gain: number; }
export interface EqConfig     { bands: BandConfig[]; }

export interface FreqRange    { from: number; to: number; }
export interface WaveletBand  { level: number; name: string; coeffStart: number; coeffEnd: number; }

export interface EntityConfig {
  label:        string;
  freqBands:    FreqRange[];   // purely informational — defines the Hz range(s) this entity covers
  freqGain:     number;        // single gain/intensity for this entity (0–4 slider)
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

export interface AiSlider {
  key:    string;
  label:  string;
  weight: number;
}

// ── Drag state ─────────────────────────────────────────────────────────────

interface DragState {
  type:       'generic-gain' | 'entity-freq-gain' | 'entity-wavelet-gain' | 'ai-weight';
  index:      number;
  trackLeft:  number;
  trackWidth: number;
  minValue:   number;
  maxValue:   number;
  step:       number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const SLIDER_MIN  = 0;
const SLIDER_MAX  = 4;
const SLIDER_STEP = 0.01;

// ── ECG band definitions ───────────────────────────────────────────────────

const ECG_FREQ_RANGES: Record<string, Array<[number, number]>> = {
  'Normal Sinus': [[14, 22]],
  'RBBB':         [[5, 8]],
  'LBBB':         [[2,  5]],
  'APB':          [[11, 14]],
};

// ── Default configs ────────────────────────────────────────────────────────

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
          { level: 0, name: 'Approximation', coeffStart:  11688, coeffEnd:  53660 },
          { level: 2, name: 'Detail 2',       coeffStart:  24997, coeffEnd: 105513 },
          { level: 3, name: 'Detail 3',       coeffStart:  49990, coeffEnd: 211429 },
          { level: 4, name: 'Detail 4',       coeffStart:  93569, coeffEnd: 409104 },
        ],
      },
    ],
  },
animal: {
  entities: [
    {
      label: 'Cow', freqGain: 1, wavelet: 'sym4', waveletGain: 1,
      freqBands: [{ from: 250, to: 480 }],
      waveletBands: [
          { level: 3, name: 'Detail 3', coeffStart: 21705, coeffEnd: 39940 },
          { level: 2, name: 'Detail 2', coeffStart: 43345, coeffEnd: 69546 },
          { level: 1, name: 'Detail 1', coeffStart: 89633, coeffEnd: 128050 }
      ],
    },
    {
      label: 'Dog', freqGain: 1, wavelet: 'sym4', waveletGain: 1,
      freqBands: [{ from: 520, to: 760 }],
      waveletBands: [
          { level: 1, name: 'Detail 1', coeffStart: 64141, coeffEnd: 67825 },
          { level: 1, name: 'Detail 1', coeffStart: 79488, coeffEnd: 81695 },
          { level: 1, name: 'Detail 1', coeffStart: 85222, coeffEnd: 88554 }
      ],
    },
    {
      label: 'Cat', freqGain: 1, wavelet: 'sym4', waveletGain: 1,
      freqBands: [{ from: 1050, to: 1800 }],
      waveletBands: [
          { level: 3, name: 'Detail 3', coeffStart: 16605, coeffEnd: 19849 },
          { level: 2, name: 'Detail 2', coeffStart: 33310, coeffEnd: 38890 },
          { level: 1, name: 'Detail 1', coeffStart: 66599, coeffEnd: 74143 }
      ],
    },
    {
      label: 'Sheep', freqGain: 1, wavelet: 'sym4', waveletGain: 1,
      freqBands: [{ from: 1900, to: 4000 }],
      waveletBands: [
          { level: 3, name: 'Detail 3', coeffStart: 19406, coeffEnd: 24999 },
          { level: 2, name: 'Detail 2', coeffStart: 38689, coeffEnd: 49965 },
          { level: 1, name: 'Detail 1', coeffStart: 73408, coeffEnd: 99890 }
      ],
    },
  ],
},
human: {
  entities: [
    {
      label: 'Male', freqGain: 1, wavelet: 'db8', waveletGain: 1,
      freqBands: [
        { from:  40, to: 365 },
        { from: 415, to: 465 },
        { from: 565, to: 640 },
        { from: 690, to: 765 },
      ],
      waveletBands: [
        { level: 9, name: 'Detail 9', coeffStart: 0, coeffEnd:  861 },
        { level: 8, name: 'Detail 8', coeffStart: 0, coeffEnd: 1722 },
        { level: 7, name: 'Detail 7', coeffStart: 0, coeffEnd: 3445 },
        { level: 6, name: 'Detail 6', coeffStart: 0, coeffEnd: 6890 },
      ],
    },
    {
      label: 'Female', freqGain: 1, wavelet: 'db8', waveletGain: 1,
      freqBands: [
        { from:  390, to:  415 },
        { from:  490, to:  565 },
        { from:  765, to:  790 },
        { from:  840, to:  865 },
        { from:  940, to:  990 },
        { from: 1040, to: 1115 },
        { from: 1165, to: 1190 },
        { from: 1340, to: 1415 },
        { from: 1440, to: 1465 },
        { from: 1540, to: 1615 },
        { from: 1840, to: 1865 },
      ],
      waveletBands: [
        { level: 6, name: 'Detail 6', coeffStart: 0, coeffEnd:  6890 },
        { level: 5, name: 'Detail 5', coeffStart: 0, coeffEnd: 13781 },
        { level: 4, name: 'Detail 4', coeffStart: 0, coeffEnd: 27562 },
      ],
    },
  ],
},
ecg: {
  entities: [
    {
      label: 'Normal Sinus', freqGain: 1, wavelet: 'bior3.7', waveletGain: 1,
      freqBands: ECG_FREQ_RANGES['Normal Sinus'].map(([from, to]) => ({ from, to })),
      waveletBands: [
        { level: 4, name: 'Detail 4', coeffStart: 100, coeffEnd: 2000 },
        { level: 5, name: 'Detail 5', coeffStart:  50, coeffEnd: 1000 },
      ],
    },
    {
      label: 'RBBB', freqGain: 1, wavelet: 'bior3.7', waveletGain: 1,
      freqBands: ECG_FREQ_RANGES['RBBB'].map(([from, to]) => ({ from, to })),
      waveletBands: [
        { level: 6, name: 'Detail 6', coeffStart:  25, coeffEnd:  500 },
        { level: 7, name: 'Detail 7', coeffStart:  12, coeffEnd:  250 },
      ],
    },
    {
      label: 'LBBB', freqGain: 1, wavelet: 'bior3.7', waveletGain: 1,
      freqBands: ECG_FREQ_RANGES['LBBB'].map(([from, to]) => ({ from, to })),
      waveletBands: [
        { level: 7, name: 'Detail 7', coeffStart:  12, coeffEnd:  250 },
        { level: 8, name: 'Detail 8', coeffStart:   6, coeffEnd:  125 },
      ],
    },
    {
      label: 'APB', freqGain: 1, wavelet: 'bior3.7', waveletGain: 1,
      freqBands: ECG_FREQ_RANGES['APB'].map(([from, to]) => ({ from, to })),
      waveletBands: [
        { level: 5, name: 'Detail 5', coeffStart:  50, coeffEnd: 1000 },
        { level: 6, name: 'Detail 6', coeffStart:  25, coeffEnd:  500 },
      ],
    },
  ],
},
};

const AI_SLIDERS: Record<Exclude<AppMode, 'generic'>, AiSlider[]> = {
  ecg: [
    { key: 'N', label: 'Normal Beat',                       weight: 1 },
    { key: 'L', label: 'Left Bundle Branch Block Beat',     weight: 1 },
    { key: 'R', label: 'Right Bundle Branch Block Beat',    weight: 1 },
    { key: 'A', label: 'Atrial Premature Beat',             weight: 1 },
  ],
  musical: [
    { key: 'guitar', label: 'Guitar', weight: 1 },
    { key: 'piano',  label: 'Piano',  weight: 1 },
    { key: 'bass',   label: 'Bass',   weight: 1 },
    { key: 'drums',  label: 'Drums',  weight: 1 },
  ],
  animal: [
    { key: 'Cat',  label: 'Cat',  weight: 1 },
    { key: 'Dog',  label: 'Dog',  weight: 1 },
    { key: 'Cow',  label: 'Cow',  weight: 1 },
    { key: 'Sheep', label: 'Lion', weight: 1 },
  ],
  human: [
    { key: 'speaker1', label: 'Speaker 1', weight: 1 },
    { key: 'speaker2', label: 'Speaker 2', weight: 1 },
    { key: 'speaker3', label: 'Speaker 3', weight: 1 },
    { key: 'speaker4', label: 'Speaker 4', weight: 1 },
  ],
};

// ── Pure helpers ───────────────────────────────────────────────────────────

function clampToStep(val: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, val));
  return parseFloat((Math.round(clamped / step) * step).toFixed(2));
}

function ratioToValue(ratio: number, min: number, max: number, step: number): number {
  return clampToStep(min + ratio * (max - min), min, max, step);
}

export function valueToPercent(val: number, min: number, max: number): number {
  return ((val - min) / (max - min)) * 100;
}

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

// ── Component ──────────────────────────────────────────────────────────────

@Component({
  selector: 'app-eq-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './eq-sidebar.component.html',
  styleUrls:   ['./eq-sidebar.component.css'],
})
export class EqSidebarComponent implements OnInit, OnChanges, OnDestroy {

  @Input()  mode:       AppMode    = 'generic';
  @Input()  signalFile: File | null = null;

  @Output() bandsChange         = new EventEmitter<FreqBand[]>();
  @Output() waveletChange       = new EventEmitter<WaveletInstruction[]>();
  @Output() aiOutputChange      = new EventEmitter<Float32Array>();
  @Output() waveletOutputChange = new EventEmitter<Float32Array>();
  @Output() humanEqChange = new EventEmitter<Float32Array>();

  @ViewChild('configInput') configInputRef!: ElementRef<HTMLInputElement>;

  // ── Generic state ─────────────────────────────────────────────────
  bands:       FreqBand[] = [];
  newBandLabel = 'New Band';
  newBandFrom  = 0;
  newBandTo    = 1000;
  newBandGain  = 1;

  // ── Advanced state ────────────────────────────────────────────────
  entities:  EntityConfig[] = [];
  masterTab: 'freq' | 'wavelet' = 'freq';   // ← single master toggle

  configError = '';

  // ── AI state ──────────────────────────────────────────────────────
  isAiMode        = false;
  aiSliders:      AiSlider[] = [];
  aiComponents:   Map<string, Float32Array> = new Map();
  aiIsLoading     = false;
  aiError         = '';
  aiHasComponents = false;

  // ── Drag state ────────────────────────────────────────────────────
  drag: DragState | null = null;

  // ── Expose to template ────────────────────────────────────────────
  readonly valueToPercent = valueToPercent;
  readonly SLIDER_MIN     = SLIDER_MIN;
  readonly SLIDER_MAX     = SLIDER_MAX;

  get isGeneric(): boolean { return this.mode === 'generic'; }
  get isEcg():     boolean { return this.mode === 'ecg'; }

  // ── Lifecycle ──────────────────────────────────────────────────────

  ngOnInit(): void { this.loadDefault(); }

  ngOnChanges(c: SimpleChanges): void {
    if (c['mode'] && !c['mode'].firstChange) {
      this.configError     = '';
      this.isAiMode        = false;
      this.aiComponents.clear();
      this.aiHasComponents = false;
      this.aiError         = '';
      this.drag            = null;
      this.masterTab       = 'freq';
      this.loadDefault();
      this.resetAiSliders();
    }
    if (c['signalFile'] && !c['signalFile'].firstChange
        && this.isAiMode && this.signalFile) {
      this.aiComponents.clear();
      this.aiHasComponents = false;
      this.decomposeSignal(this.signalFile);
    }
  }

  ngOnDestroy(): void { this.drag = null; }

  // ── Master tab ─────────────────────────────────────────────────────

  setMasterTab(tab: 'freq' | 'wavelet'): void {
    this.masterTab = tab;
  }

  // ── Global mouse handlers ──────────────────────────────────────────

  @HostListener('document:mousemove', ['$event'])
  onMouseMove(e: MouseEvent): void {
    if (!this.drag) return;
    e.preventDefault();
    const ratio = Math.min(1, Math.max(0,
      (e.clientX - this.drag.trackLeft) / this.drag.trackWidth));
    this.applyDragValue(ratioToValue(ratio,
      this.drag.minValue, this.drag.maxValue, this.drag.step));
  }

  @HostListener('document:mouseup')
  onMouseUp(): void {
    if (!this.drag) return;
    this.flushDrag();
    this.drag = null;
  }

  // ── Internal drag helpers ──────────────────────────────────────────

  private applyDragValue(value: number): void {
    if (!this.drag) return;
    switch (this.drag.type) {
      case 'generic-gain':
        this.bands = this.bands.map((b, i) =>
          i === this.drag!.index ? { ...b, gain: value } : b);
        break;
      case 'entity-freq-gain':
        this.entities[this.drag.index] = {
          ...this.entities[this.drag.index], freqGain: value };
        break;
      case 'entity-wavelet-gain':
        this.entities[this.drag.index] = {
          ...this.entities[this.drag.index], waveletGain: value };
        break;
      case 'ai-weight':
        this.aiSliders[this.drag.index] = {
          ...this.aiSliders[this.drag.index], weight: value };
        break;
    }
  }

private flushDrag(): void {
  if (!this.drag) return;
  switch (this.drag.type) {
    case 'generic-gain':
      this.emitFreq();
      break;
    case 'entity-freq-gain':
      if (this.mode === 'human') {
        this.applyHumanEq().catch(err => this.aiError = err?.message ?? 'Human EQ failed.');
      } else {
        this.emitFreq();
      }
      break;
    case 'entity-wavelet-gain':
      this.emitWavelet();
      break;
    case 'ai-weight':
      this.emitAiBlend();
      break;
  }
}

  private beginDrag(
    event:    MouseEvent,
    track:    HTMLElement,
    type:     DragState['type'],
    index:    number,
    min = SLIDER_MIN,
    max = SLIDER_MAX,
    step = SLIDER_STEP,
  ): void {
    event.preventDefault();
    const rect  = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0,
      (event.clientX - rect.left) / rect.width));
    this.drag = {
      type, index,
      trackLeft: rect.left, trackWidth: rect.width,
      minValue: min, maxValue: max, step,
    };
    this.applyDragValue(ratioToValue(ratio, min, max, step));
  }

  // ── Public drag-start methods ──────────────────────────────────────

  startGenericGainDrag(event: MouseEvent, track: HTMLElement, index: number): void {
    this.beginDrag(event, track, 'generic-gain', index);
  }

  startEntityFreqGainDrag(event: MouseEvent, track: HTMLElement, index: number): void {
    this.beginDrag(event, track, 'entity-freq-gain', index);
  }

  startEntityWaveletGainDrag(event: MouseEvent, track: HTMLElement, index: number): void {
    this.beginDrag(event, track, 'entity-wavelet-gain', index);
  }

  startAiWeightDrag(event: MouseEvent, track: HTMLElement, index: number): void {
    this.beginDrag(event, track, 'ai-weight', index);
  }

  isDragging(type: DragState['type'], index: number): boolean {
    if (!this.drag) return false;
    return this.drag.type === type && this.drag.index === index;
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

  private async applyHumanEq(): Promise<void> {
  if (this.mode !== 'human' || !this.signalFile) return;

  const signal = await this.signalFile.arrayBuffer()
    .then(buf => new AudioContext().decodeAudioData(buf))
    .then(audioBuf => audioBuf.getChannelData(0));

  const maleEntity   = this.entities.find(e => e.label === 'Male');
  const femaleEntity = this.entities.find(e => e.label === 'Female');

  const res = await fetch('http://127.0.0.1:8000/equalizeaudio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      signal:       Array.from(signal),
      sampling_rate: 44100,
      male_gain:   maleEntity?.freqGain   ?? 1,
      female_gain: femaleEntity?.freqGain ?? 1,
    }),
  });

  if (!res.ok) throw new Error(`equalizeaudio failed: ${res.status}`);
  const data = await res.json();
  this.humanEqChange.emit(new Float32Array(data.equalized_audio));
}

  downloadCurrentConfig(): void {
    const payload = this.isGeneric
      ? { bands: this.bands.map(b => ({
          label: b.label, from: b.ranges[0].from, to: b.ranges[0].to, gain: b.gain })) }
      : { entities: this.entities };
    const a = document.createElement('a');
    a.href     = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
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
      this.applyAdvancedConfig(
        ADVANCED_DEFAULTS[this.mode as Exclude<AppMode, 'generic'>]);
    }
  }

  private applyGenericConfig(cfg: EqConfig): void {
    this.bands = genericConfigToBands(cfg);
    this.emitFreq();
  }

private applyAdvancedConfig(cfg: AdvancedEqConfig): void {
  this.entities  = cfg.entities.map(e => ({
    ...e, freqBands: e.freqBands.map(r => ({ ...r })) }));
  this.masterTab = 'freq';
  this.emitFreq();
  this.emitWavelet();
  if (this.mode === 'human' && this.signalFile) {
    this.applyHumanEq().catch(err => this.aiError = err?.message ?? 'Human EQ failed.');
  }
}

  // ── Wavelet processing ─────────────────────────────────────────────

  private async applyWaveletGains(
    signal: Float32Array,
    instructions: WaveletInstruction[],
  ): Promise<Float32Array> {
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
          level:      9,
          gain_bands: gainBands,
        }),
      });
      if (!res.ok)
        throw new Error(`Wavelet gain failed for ${instruction.entityLabel}: ${res.status}`);
      signal = new Float32Array((await res.json()).modified_signal);
    }
    return signal;
  }

  async applyWavelet(signal: Float32Array): Promise<void> {
    if (this.isGeneric || this.entities.length === 0) return;
    try {
      const instructions = this.entities.map(e => ({
        entityLabel:  e.label,
        wavelet:      e.wavelet,
        waveletBands: e.waveletBands,
        gain:         e.waveletGain,
      }));
      this.waveletOutputChange.emit(
        await this.applyWaveletGains(signal, instructions));
    } catch (err: any) {
      this.aiError = err?.message ?? 'Wavelet processing failed.';
    }
  }

  // ── Validation ─────────────────────────────────────────────────────

  private isValidGenericConfig(o: any): o is EqConfig {
    return Array.isArray(o?.bands) && o.bands.length > 0 &&
      o.bands.every((b: any) =>
        typeof b.label === 'string' &&
        typeof b.from  === 'number' &&
        typeof b.to    === 'number');
  }

  private isValidAdvancedConfig(o: any): o is AdvancedEqConfig {
    return Array.isArray(o?.entities) && o.entities.length > 0 &&
      o.entities.every((e: any) =>
        typeof e.label   === 'string' &&
        Array.isArray(e.freqBands) &&
        typeof e.wavelet === 'string' &&
        Array.isArray(e.waveletBands));
  }

  // ── Generic band management ────────────────────────────────────────

  addBand(): void {
    if (this.newBandTo <= this.newBandFrom) {
      this.configError = '"To" must be greater than "From".'; return;
    }
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

  // ── Advanced entity management ─────────────────────────────────────

  // onWaveletNameChange removed — wavelet is fixed per entity from ADVANCED_DEFAULTS

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
        default: this.aiError = 'AI mode not supported for this signal type.';
      }
    } catch (err: any) {
      this.aiError = err?.message ?? 'Unknown error during decomposition.';
    }
    this.aiIsLoading = false;
  }

  private async decomposeEcg(file: File): Promise<void> {
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch('http://127.0.0.1:8000/decomposeecg',
      { method: 'POST', body: fd });
    if (!res.ok)
      throw new Error(`ECG decomposition failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    if (!data?.components || typeof data.components !== 'object')
      throw new Error('Unexpected response from /decomposeecg — missing "components" key.');
    for (const [key, arr] of Object.entries(data.components))
      this.aiComponents.set(key, new Float32Array(arr as number[]));
    this.aiHasComponents = true;
    this.emitAiBlend();
  }

  private async decomposeMusical(file: File): Promise<void> {
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch('http://127.0.0.1:8000/segmentmusic',
      { method: 'POST', body: fd });
    if (!res.ok)
      throw new Error(`Music decomposition failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    for (const key of ['bass', 'drums', 'guitar', 'piano'] as const) {
      if (!data[key]?.audio_b64)
        throw new Error(`Missing stem "${key}" in response.`);
      this.aiComponents.set(key, await this.decodeWavB64(data[key].audio_b64));
    }
    this.aiHasComponents = true;
    this.emitAiBlend();
  }

  private async decomposeHuman(file: File): Promise<void> {
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch('http://127.0.0.1:8000/segmenthumanvoice',
      { method: 'POST', body: fd });
    if (!res.ok)
      throw new Error(`Voice decomposition failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    const keyMap: Record<string, string> = {
      voice_1: 'speaker1', voice_2: 'speaker2',
      voice_3: 'speaker3', voice_4: 'speaker4',
    };
    for (const [rk, sk] of Object.entries(keyMap)) {
      if (!data[rk]?.audio_b64)
        throw new Error(`Missing speaker "${rk}" in response.`);
      this.aiComponents.set(sk, await this.decodeWavB64(data[rk].audio_b64));
    }
    this.aiHasComponents = true;
    this.emitAiBlend();
  }

private async decomposeAnimal(file: File): Promise<void> {
  const fd = new FormData(); fd.append('file', file);
  const res = await fetch('http://127.0.0.1:8000/segmentanimals',
    { method: 'POST', body: fd });
  if (!res.ok)
    throw new Error(`Animal decomposition failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  const keyMap: Record<string, string> = {
    Dog:  'Dog',
    Cow:  'Cow',
    Sheep:  'Sheep',
    Cat: 'Cat',
  };
  for (const [rk, sk] of Object.entries(keyMap)) {
    if (!data[rk]?.audio_b64)
      throw new Error(`Missing animal "${rk}" in response.`);
    this.aiComponents.set(sk, await this.decodeWavB64(data[rk].audio_b64));
  }
  this.aiHasComponents = true;
  this.emitAiBlend();
}

  private async decodeWavB64(b64: string): Promise<Float32Array> {
    const binary = atob(b64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const ctx = new AudioContext();
    const buf = await ctx.decodeAudioData(bytes.buffer);
    ctx.close();
    if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice();
    const ch0 = buf.getChannelData(0), ch1 = buf.getChannelData(1);
    const mono = new Float32Array(ch0.length);
    for (let i = 0; i < ch0.length; i++) mono[i] = (ch0[i] + ch1[i]) * 0.5;
    return mono;
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
    for (const s of this.aiSliders) {
      const comp = this.aiComponents.get(s.key);
      if (!comp) continue;
      for (let i = 0; i < length; i++) blended[i] += comp[i] * s.weight;
    }
    this.aiOutputChange.emit(blended);
  }

  private emitFreq(): void {
    this.bandsChange.emit(
      this.isGeneric
        ? this.bands
        : advancedConfigToBands({ entities: this.entities })
    );
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