import {
  Component, OnInit, OnChanges, Input, Output,
  EventEmitter, ViewChild, ElementRef, SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FreqBand, AppMode } from '../signal-viewer/signal-viewer.component';

export interface BandConfig {
  label: string;
  from:  number;
  to:    number;
  gain:  number;
}

export interface EqConfig {
  bands: BandConfig[];
}

const DEFAULT_CONFIGS: Record<AppMode, EqConfig> = {
  generic: {
    bands: [
      { label: 'Sub Bass',   from: 20,    to: 60,    gain: 1 },
      { label: 'Bass',       from: 60,    to: 250,   gain: 1 },
      { label: 'Low Mid',    from: 250,   to: 2000,  gain: 1 },
      { label: 'High Mid',   from: 2000,  to: 6000,  gain: 1 },
      { label: 'Presence',   from: 6000,  to: 12000, gain: 1 },
      { label: 'Brilliance', from: 12000, to: 20000, gain: 1 },
    ],
  },
  musical: {
    bands: [
      { label: 'Bass Guitar', from: 40,  to: 300,  gain: 1 },
      { label: 'Piano Low',   from: 300, to: 1000, gain: 1 },
      { label: 'Piano High',  from: 2000,to: 4000, gain: 1 },
      { label: 'Violin Low',  from: 600, to: 2000, gain: 1 },
      { label: 'Violin High', from: 4000,to: 8000, gain: 1 },
      { label: 'Drums Low',   from: 40,  to: 200,  gain: 1 },
      { label: 'Drums High',  from: 6000,to: 16000,gain: 1 },
    ],
  },
  animal: {
    bands: [
      { label: 'Dog',  from: 500,  to: 2000,  gain: 1 },
      { label: 'Cat',  from: 2000, to: 5000,  gain: 1 },
      { label: 'Bird', from: 5000, to: 10000, gain: 1 },
      { label: 'Frog', from: 100,  to: 800,   gain: 1 },
    ],
  },
  human: {
    bands: [
      { label: 'Male Old',     from: 85,  to: 200, gain: 1 },
      { label: 'Male Young',   from: 100, to: 300, gain: 1 },
      { label: 'Female Old',   from: 165, to: 400, gain: 1 },
      { label: 'Female Young', from: 200, to: 500, gain: 1 },
    ],
  },
  ecg: {
    bands: [
      { label: 'Normal Sinus',      from: 0.5, to: 40,  gain: 1 },
      { label: 'Atrial Flutter Lo', from: 6,   to: 12,  gain: 1 },
      { label: 'Atrial Flutter Hi', from: 24,  to: 48,  gain: 1 },
      { label: 'Ventricular Fibr.', from: 150, to: 500, gain: 1 },
      { label: 'Bradycardia',       from: 0.5, to: 1,   gain: 1 },
    ],
  },
};

function configToBands(cfg: EqConfig): FreqBand[] {
  return cfg.bands.map(b => ({
    label:  b.label,
    gain:   b.gain ?? 1,
    ranges: [{ from: b.from, to: b.to }],
  }));
}

// Generic mode allows adding/removing bands. All other modes are fixed.
const ADDABLE_MODES: AppMode[] = ['generic'];

@Component({
  selector: 'app-eq-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './eq-sidebar.component.html',
  styleUrls:   ['./eq-sidebar.component.css'],
})
export class EqSidebarComponent implements OnInit, OnChanges {

  @Input()  mode: AppMode = 'generic';
  @Output() bandsChange = new EventEmitter<FreqBand[]>();

  @ViewChild('configInput') configInputRef!: ElementRef<HTMLInputElement>;

  bands:       FreqBand[] = [];
  configError  = '';

  // Add-band form (generic only)
  newBandLabel = 'New Band';
  newBandFrom  = 0;
  newBandTo    = 1000;
  newBandGain  = 1;

  get canAddBands(): boolean { return ADDABLE_MODES.includes(this.mode); }

  ngOnInit(): void {
    this.loadDefaultConfig();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['mode'] && !changes['mode'].firstChange) {
      this.configError = '';
      this.loadDefaultConfig();
    }
  }

  // ── Config ────────────────────────────────────────────────────────

  triggerConfigInput(): void {
    this.configInputRef.nativeElement.click();
  }

  async onConfigSelected(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      if (!this.isValidConfig(obj)) {
        this.configError = 'Invalid config. Expected: { bands: [{ label, from, to, gain }] }';
        return;
      }
      this.configError = '';
      this.applyConfig(obj as EqConfig);
    } catch {
      this.configError = 'Could not parse JSON file.';
    }
    (event.target as HTMLInputElement).value = '';
  }

  downloadCurrentConfig(): void {
    const cfg: EqConfig = {
      bands: this.bands.map(b => ({
        label: b.label,
        from:  b.ranges[0].from,
        to:    b.ranges[0].to,
        gain:  b.gain,
      })),
    };
    const a = document.createElement('a');
    a.href     = URL.createObjectURL(
      new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' })
    );
    a.download = `${this.mode}_eq_config.json`;
    a.click();
  }

  resetToDefault(): void {
    this.configError = '';
    this.loadDefaultConfig();
  }

  private loadDefaultConfig(): void {
    this.applyConfig(DEFAULT_CONFIGS[this.mode]);
    const cfg    = DEFAULT_CONFIGS[this.mode];
    const last   = cfg.bands[cfg.bands.length - 1];
    if (last) {
      this.newBandFrom  = last.to;
      this.newBandTo    = last.to + 1000;
      this.newBandLabel = `Band ${cfg.bands.length + 1}`;
      this.newBandGain  = 1;
    }
  }

  private applyConfig(cfg: EqConfig): void {
    this.bands = configToBands(cfg);
    this.emit();
  }

  private isValidConfig(obj: any): obj is EqConfig {
    return (
      obj &&
      Array.isArray(obj.bands) &&
      obj.bands.length > 0 &&
      obj.bands.every(
        (b: any) =>
          typeof b.label === 'string' &&
          typeof b.from  === 'number' &&
          typeof b.to    === 'number'
      )
    );
  }

  // ── Band management ───────────────────────────────────────────────

  addBand(): void {
    if (this.newBandTo <= this.newBandFrom) {
      this.configError = '"To" must be greater than "From".';
      return;
    }
    this.configError = '';
    this.bands = [
      ...this.bands,
      {
        label:  this.newBandLabel || `Band ${this.bands.length + 1}`,
        ranges: [{ from: this.newBandFrom, to: this.newBandTo }],
        gain:   this.newBandGain,
      },
    ];
    this.newBandFrom  = this.newBandTo;
    this.newBandTo   += 1000;
    this.newBandLabel = `Band ${this.bands.length + 1}`;
    this.newBandGain  = 1;
    this.emit();
  }

  removeBand(i: number): void {
    this.bands = this.bands.filter((_, idx) => idx !== i);
    this.emit();
  }

  onGainChange(i: number, val: string): void {
    this.bands = this.bands.map((b, idx) =>
      idx === i ? { ...b, gain: parseFloat(val) } : b
    );
    this.emit();
  }

  private emit(): void {
    this.bandsChange.emit(this.bands);
  }
}