import {
  Component, OnInit, OnDestroy, AfterViewInit,
  ViewChild, ElementRef, NgZone, ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

declare const Plotly: any;

// ─── Types ────────────────────────────────────────────────────────────────────

export type AppMode = 'generic' | 'musical' | 'animal' | 'voice' | 'ecg';
export type FreqScale = 'linear' | 'audiogram';

export interface FreqRange { from: number; to: number; }

export interface FreqBand {
  label: string;
  ranges: FreqRange[];
  gain: number; // 0–2
}

export interface ModeConfig {
  name: string;
  bands: FreqBand[];
}

/** Which stream(s) the global cine is playing */
export type PlayTarget = 'input' | 'output' | 'both';

// ─── Mode presets ─────────────────────────────────────────────────────────────

const MODE_PRESETS: Record<AppMode, ModeConfig> = {
  generic: {
    name: 'Generic',
    bands: [
      { label: 'Sub Bass', ranges: [{ from: 20, to: 60 }], gain: 1 },
      { label: 'Bass', ranges: [{ from: 60, to: 250 }], gain: 1 },
      { label: 'Low Mid', ranges: [{ from: 250, to: 2000 }], gain: 1 },
      { label: 'High Mid', ranges: [{ from: 2000, to: 6000 }], gain: 1 },
      { label: 'Presence', ranges: [{ from: 6000, to: 12000 }], gain: 1 },
      { label: 'Brilliance', ranges: [{ from: 12000, to: 20000 }], gain: 1 },
    ],
  },
  musical: {
    name: 'Musical Instruments',
    bands: [
      { label: 'Bass Guitar', ranges: [{ from: 40, to: 300 }], gain: 1 },
      { label: 'Piano', ranges: [{ from: 300, to: 1000 }, { from: 2000, to: 4000 }], gain: 1 },
      { label: 'Violin', ranges: [{ from: 600, to: 2000 }, { from: 4000, to: 8000 }], gain: 1 },
      { label: 'Drums', ranges: [{ from: 40, to: 200 }, { from: 6000, to: 16000 }], gain: 1 },
    ],
  },
  animal: {
    name: 'Animal Sounds',
    bands: [
      { label: 'Dog', ranges: [{ from: 500, to: 2000 }], gain: 1 },
      { label: 'Cat', ranges: [{ from: 2000, to: 5000 }], gain: 1 },
      { label: 'Bird', ranges: [{ from: 5000, to: 10000 }], gain: 1 },
      { label: 'Frog', ranges: [{ from: 100, to: 800 }], gain: 1 },
    ],
  },
  voice: {
    name: 'Human Voices',
    bands: [
      { label: 'Male Old', ranges: [{ from: 85, to: 200 }], gain: 1 },
      { label: 'Male Young', ranges: [{ from: 100, to: 300 }], gain: 1 },
      { label: 'Female Old', ranges: [{ from: 165, to: 400 }], gain: 1 },
      { label: 'Female Young', ranges: [{ from: 200, to: 500 }], gain: 1 },
    ],
  },
  ecg: {
    name: 'ECG Abnormalities',
    bands: [
      { label: 'Normal Sinus', ranges: [{ from: 0.5, to: 40 }], gain: 1 },
      { label: 'Atrial Flutter', ranges: [{ from: 6, to: 12 }, { from: 24, to: 48 }], gain: 1 },
      { label: 'Ventricular Fibr.', ranges: [{ from: 150, to: 500 }], gain: 1 },
      { label: 'Bradycardia', ranges: [{ from: 0.5, to: 1 }], gain: 1 },
    ],
  },
};

// ─── Pure helper ─────────────────────────────────────────────────────────────

function globalPeak(arr: Float32Array): number {
  let m = 0;
  for (let i = 0; i < arr.length; i++) { const v = Math.abs(arr[i]); if (v > m) m = v; }
  return m || 1;
}

// ─── Component ────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-signal-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './signal-viewer.component.html',
  styleUrls: ['./signal-viewer.component.css'],
})
export class SignalViewerComponent implements OnInit, AfterViewInit, OnDestroy {

  @ViewChild('fileInput') fileInputRef!: ElementRef<HTMLInputElement>;
  @ViewChild('settingsInput') settingsInputRef!: ElementRef<HTMLInputElement>;

  // ── Mode ──────────────────────────────────────────────────────────
  readonly modeKeys: AppMode[] = ['generic', 'musical', 'animal', 'voice', 'ecg'];
  currentMode: AppMode = 'musical';
  bands: FreqBand[] = [];
  freqScale: FreqScale = 'linear';

  // Generic add-band form
  newBandLabel = 'New Band';
  newBandFrom = 0;
  newBandTo = 1000;

  // ── Signal (two global streams) ────────────────────────────────────
  inputSamples: Float32Array = new Float32Array(0);
  outputSamples: Float32Array = new Float32Array(0);
  sampleRate = 44100;
  fileName = '';
  isProcessing = false;

  // ── Shared linked-viewer state ─────────────────────────────────────
  /** Sample index of the left edge of the visible window (shared) */
  viewStart = 0;
  /** Number of samples visible at once (shared) */
  viewWindow = 0;
  /** Current playhead position in samples (shared) */
  currentSampleIdx = 0;

  // ── Playback state ─────────────────────────────────────────────────
  /** Which streams the global transport drives */
  playTarget: PlayTarget = 'both';
  isPlaying = false;
  isPaused = false;
  playbackSpeed = 1;
  loop = false;

  // Per-stream independent cine states
  inputPlaying = false;
  inputPaused = false;
  inputIdx = 0;

  outputPlaying = false;
  outputPaused = false;
  outputIdx = 0;

  // ── RAF / Web Audio internals ──────────────────────────────────────
  private _rafId = 0;
  private _lastRafTime = 0;
  private _destroyed = false;

  private audioCtx: AudioContext | null = null;

  // Input audio
  private inputAudioBuffer: AudioBuffer | null = null;
  private inputAudioSource: AudioBufferSourceNode | null = null;
  private inputAudioPauseOff = 0;
  private inputAudioStartTime = 0;

  // Output audio (EQ-processed, rebuilt on applyEqualizer)
  private outputAudioBuffer: AudioBuffer | null = null;
  private outputAudioSource: AudioBufferSourceNode | null = null;
  private outputAudioPauseOff = 0;
  private outputAudioStartTime = 0;

  // ── Plotly div IDs ─────────────────────────────────────────────────
  readonly INPUT_GRAPH = 'sv-input-graph';
  readonly OUTPUT_GRAPH = 'sv-output-graph';
  readonly FFT_GRAPH = 'sv-fft-graph';

  constructor(private zone: NgZone, private cdr: ChangeDetectorRef) { }

  ngOnInit(): void { this.loadMode(this.currentMode); }
  ngAfterViewInit(): void { setTimeout(() => this.drawAll(), 150); }

  ngOnDestroy(): void {
    this._destroyed = true;
    this.stopRaf();
    this.stopAllAudio();
    this.audioCtx?.close();
    [this.INPUT_GRAPH, this.OUTPUT_GRAPH, this.FFT_GRAPH].forEach(id => {
      const el = document.getElementById(id);
      if (el) Plotly.purge(el);
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // MODE
  // ────────────────────────────────────────────────────────────────────

  loadMode(mode: AppMode): void {
    this.currentMode = mode;
    this.bands = MODE_PRESETS[mode].bands.map(b => ({
      label: b.label,
      gain: 1,
      ranges: b.ranges.map(r => ({ ...r })),
    }));
    this.applyEqualizer();
  }

  getModeName(m: AppMode): string { return MODE_PRESETS[m].name; }

  // ────────────────────────────────────────────────────────────────────
  // FILE UPLOAD
  // ────────────────────────────────────────────────────────────────────

  triggerFileInput(): void { this.fileInputRef.nativeElement.click(); }
  triggerSettingsInput(): void { this.settingsInputRef.nativeElement.click(); }

  async onFileSelected(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.fileName = file.name;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'json') await this.loadJsonSignal(file);
    else await this.loadAudioFile(file);
    (event.target as HTMLInputElement).value = '';
  }

  private async loadAudioFile(file: File): Promise<void> {
    this.ensureAudioCtx();
    try {
      this.inputAudioBuffer = await this.audioCtx!.decodeAudioData(await file.arrayBuffer());
      this.sampleRate = this.inputAudioBuffer.sampleRate;
      this.inputSamples = this.inputAudioBuffer.getChannelData(0).slice();
    } catch {
      alert('Cannot decode audio. Use MP3 or WAV.'); return;
    }
    this.resetPlayback();
    await this.applyEqualizer();
  }

  /**
   * Flexible JSON loader — supports:
   *  1. { samples: number[] }                         ← original
   *  2. { Leads: [{ LeadName, Samples: number[] }] }  ← ECG with capital S
   *  3. { data: number[] }                            ← generic data array
   *  4. { signals: number[][], channels, fs }         ← multi-channel (takes ch0)
   */
  private async loadJsonSignal(file: File): Promise<void> {
    let obj: any;
    try { obj = JSON.parse(await file.text()); }
    catch { alert('Invalid JSON file.'); return; }

    let raw: number[] | null = null;

    if (Array.isArray(obj?.samples)) raw = obj.samples;
    else if (Array.isArray(obj?.Samples)) raw = obj.Samples;
    else if (Array.isArray(obj?.data)) raw = obj.data;
    else if (Array.isArray(obj?.Leads) && obj.Leads.length) {
      const lead = obj.Leads[0];
      raw = Array.isArray(lead?.Samples) ? lead.Samples
        : Array.isArray(lead?.samples) ? lead.samples
          : null;
    }
    else if (Array.isArray(obj?.signals) && obj.signals.length) {
      // multi-channel: flatten first channel
      raw = (obj.signals as number[][]).map(row => row[0]);
    }

    if (!raw || raw.length === 0) {
      alert(
        'JSON format not recognised.\n' +
        'Supported: { samples }, { Samples }, { data }, { Leads[].Samples }, { signals[][] }'
      );
      return;
    }

    this.sampleRate = obj.sampleRate ?? obj.fs ?? obj.SampleRate ?? 44100;
    this.inputSamples = new Float32Array(raw);
    this.resetPlayback();
    await this.applyEqualizer();
  }

  private resetPlayback(): void {
    this.stopGlobal();
    this.stopIndividual('input');
    this.stopIndividual('output');
    this.currentSampleIdx = 0;
    this.inputIdx = 0;
    this.outputIdx = 0;
    this.viewStart = 0;
    this.viewWindow = Math.floor(this.sampleRate * 2);
  }

  // ────────────────────────────────────────────────────────────────────
  // SETTINGS
  // ────────────────────────────────────────────────────────────────────

  saveSettings(): void {
    const cfg: ModeConfig = { name: this.getModeName(this.currentMode), bands: this.bands };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' }));
    a.download = `${this.currentMode}_eq_settings.json`;
    a.click();
  }

  async onSettingsSelected(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const obj: ModeConfig = JSON.parse(await file.text());
      if (!Array.isArray(obj.bands)) { alert('Invalid settings file.'); return; }
      this.bands = obj.bands.map((b: FreqBand) => ({
        label: b.label ?? 'Band',
        gain: b.gain ?? 1,
        ranges: (b.ranges ?? []).map((r: FreqRange) => ({ ...r })),
      }));
      await this.applyEqualizer();
    } catch { alert('Cannot parse settings JSON.'); }
    (event.target as HTMLInputElement).value = '';
  }

  // ────────────────────────────────────────────────────────────────────
  // GENERIC BANDS
  // ────────────────────────────────────────────────────────────────────

  addGenericBand(): void {
    this.bands.push({
      label: this.newBandLabel || `Band ${this.bands.length + 1}`,
      ranges: [{ from: this.newBandFrom, to: this.newBandTo }],
      gain: 1,
    });
    this.newBandFrom = this.newBandTo;
    this.newBandTo += 1000;
    this.newBandLabel = `Band ${this.bands.length + 1}`;
    this.applyEqualizer();
  }

  removeBand(i: number): void { this.bands.splice(i, 1); this.applyEqualizer(); }

  // ────────────────────────────────────────────────────────────────────
  // EQUALIZER  — slider change triggers immediate update
  // ────────────────────────────────────────────────────────────────────

  onGainChange(i: number, val: string): void {
    this.bands[i].gain = parseFloat(val);
    this.applyEqualizer();
  }

  async applyEqualizer(): Promise<void> {
    if (!this.inputSamples.length) { this.drawAll(); return; }
    this.isProcessing = true;
    this.cdr.detectChanges();
    try {
      this.outputSamples = await this.runOfflineEq();
      // Rebuild output audio buffer so playOutput uses the latest EQ result
      this.rebuildOutputAudioBuffer();
    } catch (e) {
      console.error('EQ error:', e);
      this.outputSamples = this.inputSamples.slice();
      this.rebuildOutputAudioBuffer();
    }
    this.isProcessing = false;
    this.drawAll();
    this.cdr.detectChanges();
  }

  private async runOfflineEq(): Promise<Float32Array> {
    const N = this.inputSamples.length;
    const offline = new OfflineAudioContext(1, N, this.sampleRate);

    const srcBuf = offline.createBuffer(1, N, this.sampleRate);
    srcBuf.copyToChannel(this.inputSamples, 0);
    const src = offline.createBufferSource();
    src.buffer = srcBuf;

    const dest = offline.createGain();
    dest.gain.value = 1;
    dest.connect(offline.destination);

    if (!this.bands.length) {
      src.connect(dest);
    } else {
      this.bands.forEach(band => {
        const bandGain = offline.createGain();
        bandGain.gain.value = band.gain;
        bandGain.connect(dest);
        band.ranges.forEach(range => {
          const center = (range.from + range.to) / 2;
          const bw = Math.max(range.to - range.from, 1);
          const bp = offline.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.value = Math.max(center, 1);
          bp.Q.value = center / bw;
          src.connect(bp);
          bp.connect(bandGain);
        });
      });
    }

    src.start(0);
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0).slice();
  }

  private rebuildOutputAudioBuffer(): void {
    if (!this.outputSamples.length) return;
    this.ensureAudioCtx();
    const buf = this.audioCtx!.createBuffer(1, this.outputSamples.length, this.sampleRate);
    buf.copyToChannel(this.outputSamples, 0);
    this.outputAudioBuffer = buf;
  }

  // ────────────────────────────────────────────────────────────────────
  // PLOTLY RENDERING
  // ────────────────────────────────────────────────────────────────────

  drawAll(): void {
    this.drawCine(this.INPUT_GRAPH, this.inputSamples, 'Input', '#1a73e8');
    this.drawCine(this.OUTPUT_GRAPH, this.outputSamples, 'Output', '#34a853');
    this.drawFftGraph();
  }

  private drawCine(id: string, samples: Float32Array, label: string, color: string): void {
    const el = document.getElementById(id);
    if (!el) return;
    if (!samples.length) { Plotly.purge(el); return; }

    const fs = this.sampleRate;
    const start = Math.max(0, this.viewStart);
    const end = Math.min(start + this.viewWindow, samples.length);

    // Downsample for perf — max 4000 pts rendered
    const step = Math.max(1, Math.floor((end - start) / 4000));
    const xArr: number[] = [];
    const yArr: number[] = [];
    for (let i = start; i < end; i += step) {
      xArr.push(i / fs);
      yArr.push(samples[i]);
    }

    const peak = globalPeak(samples);
    const yPad = peak * 0.12;
    const playX = this.currentSampleIdx / fs;

    Plotly.react(
      id,
      [
        {
          x: xArr, y: yArr, type: 'scatter', mode: 'lines', name: label,
          line: { color, width: 1.5 },
          hovertemplate: 'Time: %{x:.3f}s<br>Amp: %{y:.5f}<extra></extra>',
        },
        {
          x: [playX, playX], y: [-(peak + yPad), peak + yPad],
          type: 'scatter', mode: 'lines', showlegend: false, hoverinfo: 'none',
          line: { color: '#fbbc04', width: 2, dash: 'dot' },
        },
      ],
      {
        uirevision: id,
        title: { text: `${label} Signal`, font: { size: 13, color: '#1a2b4a' } },
        height: 220,
        margin: { l: 60, r: 20, t: 40, b: 44 },
        xaxis: {
          title: 'Time (s)',
          range: [start / fs, (end - 1) / fs],
          gridcolor: '#e8edf3',
          autorange: false,
          fixedrange: false,
        },
        yaxis: {
          range: [-(peak + yPad), peak + yPad],
          gridcolor: '#f0f4f8',
          zeroline: true, zerolinecolor: '#c8d5e2',
          autorange: false,
          fixedrange: false,
        },
        showlegend: false,
        plot_bgcolor: '#ffffff',
        paper_bgcolor: '#f8fafc',
      },
      { responsive: true, displayModeBar: false }
    );
  }

  private drawFftGraph(): void {
    const el = document.getElementById(this.FFT_GRAPH);
    if (!el || !this.inputSamples.length) { if (el) Plotly.purge(el); return; }

    const FFT_N = 4096;
    const half = FFT_N / 2;
    const nyquist = this.sampleRate / 2;
    const isAudiogram = this.freqScale === 'audiogram';

    const inMag = this.computeFftDb(this.inputSamples, FFT_N);
    const outMag = this.outputSamples.length ? this.computeFftDb(this.outputSamples, FFT_N) : null;

    const freqToX = (freq: number) => isAudiogram ? Math.log10(Math.max(freq, 1)) : freq;

    const buildXY = (mag: number[]) => {
      const x: number[] = [], y: number[] = [];
      for (let k = 1; k < half; k++) {
        const freq = (k / half) * nyquist;
        if (isAudiogram && (freq < 100 || freq > 10000)) continue;
        x.push(freqToX(freq));
        y.push(mag[k]);
      }
      return { x, y };
    };

    const { x: xIn, y: yIn } = buildXY(inMag);
    const { x: xOut, y: yOut } = outMag ? buildXY(outMag) : { x: [], y: [] };

    const BAND_COLORS = ['#e74c3c', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#3498db', '#c0392b', '#16a085'];

    const traces: any[] = [
      {
        x: xIn, y: yIn, type: 'scatter', mode: 'lines', name: 'Input',
        line: { color: '#1a73e8', width: 1.5 },
        fill: 'tozeroy', fillcolor: 'rgba(26,115,232,0.07)',
      },
    ];

    if (outMag) {
      traces.push({
        x: xOut, y: yOut, type: 'scatter', mode: 'lines', name: 'Output (EQ)',
        line: { color: '#34a853', width: 1.5 },
        fill: 'tozeroy', fillcolor: 'rgba(52,168,83,0.07)',
      });
    }

    this.bands.forEach((band, i) => {
      const c = BAND_COLORS[i % BAND_COLORS.length];
      band.ranges.forEach(r => {
        traces.push({
          x: [freqToX(r.from), freqToX(r.from), freqToX(r.to), freqToX(r.to), freqToX(r.from)],
          y: [-120, 10, 10, -120, -120],
          type: 'scatter', mode: 'lines', fill: 'toself',
          fillcolor: c + '28', line: { color: c + '66', width: 1 },
          name: band.label, showlegend: false, hoverinfo: 'name',
        });
      });
    });

    const audiogramTickVals = [125, 250, 500, 1000, 2000, 4000, 8000].map(f => Math.log10(f));
    const audiogramTickText = ['125', '250', '500', '1k', '2k', '4k', '8k'];

    Plotly.react(
      this.FFT_GRAPH,
      traces,
      {
        uirevision: `fft-${this.freqScale}`,
        title: {
          text: isAudiogram
            ? 'Frequency Domain — Audiogram (125 Hz – 8 kHz, log)'
            : 'Frequency Domain — Linear',
          font: { size: 13, color: '#1a2b4a' },
        },
        height: 260,
        margin: { l: 60, r: 20, t: 44, b: 55 },
        xaxis: isAudiogram
          ? {
            title: 'Frequency (Hz)',
            gridcolor: '#e8edf3',
            range: [Math.log10(100), Math.log10(10000)],
            tickmode: 'array', tickvals: audiogramTickVals, ticktext: audiogramTickText,
          }
          : { title: 'Frequency (Hz)', range: [0, nyquist], gridcolor: '#e8edf3' },
        yaxis: {
          title: 'Magnitude (dB)', range: [-100, 10],
          gridcolor: '#f0f4f8', zeroline: true, zerolinecolor: '#c8d5e2',
        },
        showlegend: true,
        legend: { orientation: 'h', y: -0.22 },
        plot_bgcolor: '#ffffff',
        paper_bgcolor: '#f8fafc',
      },
      {
        responsive: true, displayModeBar: true, displaylogo: false,
        modeBarButtonsToRemove: ['toImage', 'sendDataToCloud']
      }
    );
  }

  private computeFftDb(samples: Float32Array, N: number): number[] {
    const half = N / 2;
    const len = Math.min(N, samples.length);
    const mag = new Array(half).fill(-100);
    for (let k = 0; k < half; k++) {
      let re = 0, im = 0;
      for (let n = 0; n < len; n++) {
        const w = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (len - 1)));
        const angle = (2 * Math.PI * k * n) / N;
        re += samples[n] * w * Math.cos(angle);
        im -= samples[n] * w * Math.sin(angle);
      }
      mag[k] = 20 * Math.log10(Math.sqrt(re * re + im * im) / len + 1e-10);
    }
    return mag;
  }

  // ────────────────────────────────────────────────────────────────────
  // GLOBAL CINE (Input + Output linked, playhead shared)
  // ────────────────────────────────────────────────────────────────────

  playAll(): void { this.playGlobal('both'); }
  playInput(): void { this.playGlobal('input'); }
  playOutput(): void { this.playGlobal('output'); }

  private playGlobal(target: PlayTarget): void {
    if (!this.inputSamples.length) return;
    this.playTarget = target;

    if (this.isPlaying && this.isPaused) {
      // Resume
      this.isPaused = false;
      this.startRaf();
      if (target !== 'output') this.resumeAudio('input');
      if (target !== 'input') this.resumeAudio('output');
      return;
    }

    this.isPlaying = true;
    this.isPaused = false;
    this.startRaf();

    const offset = this.currentSampleIdx / this.sampleRate;
    if (target !== 'output') this.startAudioFrom('input', offset);
    if (target !== 'input') this.startAudioFrom('output', offset);
  }

  pauseGlobal(): void {
    if (!this.isPlaying || this.isPaused) return;
    this.isPaused = true;
    this.inputAudioPauseOff = this.currentSampleIdx / this.sampleRate;
    this.outputAudioPauseOff = this.inputAudioPauseOff;
    this.stopAudioSource('input');
    this.stopAudioSource('output');
  }

  stopGlobal(): void {
    this.isPlaying = false;
    this.isPaused = false;
    this.currentSampleIdx = 0;
    this.viewStart = 0;
    this.inputAudioPauseOff = 0;
    this.outputAudioPauseOff = 0;
    this.stopRaf();
    this.stopAudioSource('input');
    this.stopAudioSource('output');
    this.drawAll();
  }

  // ── Per-stream independent cine ────────────────────────────────────

  playIndividual(stream: 'input' | 'output'): void {
    if (!this.inputSamples.length) return;
    const samples = stream === 'input' ? this.inputSamples : this.outputSamples;
    if (!samples.length) return;

    if (stream === 'input') {
      if (this.inputPlaying && this.inputPaused) {
        this.inputPaused = false;
        this.resumeAudio('input');
        this.startIndividualRaf(stream);
        return;
      }
      this.inputPlaying = true;
      this.inputPaused = false;
      this.startAudioFrom('input', this.inputIdx / this.sampleRate);
    } else {
      if (this.outputPlaying && this.outputPaused) {
        this.outputPaused = false;
        this.resumeAudio('output');
        this.startIndividualRaf(stream);
        return;
      }
      this.outputPlaying = true;
      this.outputPaused = false;
      this.startAudioFrom('output', this.outputIdx / this.sampleRate);
    }
    this.startIndividualRaf(stream);
  }

  pauseIndividual(stream: 'input' | 'output'): void {
    if (stream === 'input') {
      if (!this.inputPlaying || this.inputPaused) return;
      this.inputPaused = true;
      this.inputAudioPauseOff = this.inputIdx / this.sampleRate;
      this.stopAudioSource('input');
    } else {
      if (!this.outputPlaying || this.outputPaused) return;
      this.outputPaused = true;
      this.outputAudioPauseOff = this.outputIdx / this.sampleRate;
      this.stopAudioSource('output');
    }
  }

  stopIndividual(stream: 'input' | 'output'): void {
    if (stream === 'input') {
      this.inputPlaying = false;
      this.inputPaused = false;
      this.inputIdx = 0;
      this.inputAudioPauseOff = 0;
      this.stopAudioSource('input');
    } else {
      this.outputPlaying = false;
      this.outputPaused = false;
      this.outputIdx = 0;
      this.outputAudioPauseOff = 0;
      this.stopAudioSource('output');
    }
  }

  // ── Individual RAF (advances only one stream's idx) ───────────────
  private _inputRafId = 0;
  private _outputRafId = 0;
  private _inputLastTs = 0;
  private _outputLastTs = 0;

  private startIndividualRaf(stream: 'input' | 'output'): void {
    if (stream === 'input') {
      if (this._inputRafId) cancelAnimationFrame(this._inputRafId);
      this._inputLastTs = 0;
      const loop = (ts: number) => {
        if (this._destroyed || !this.inputPlaying || this.inputPaused) return;
        if (this._inputLastTs) {
          const elapsed = ts - this._inputLastTs;
          this.inputIdx += Math.round((elapsed / 1000) * this.sampleRate * this.playbackSpeed);
          const maxIdx = this.inputSamples.length - 1;
          if (this.inputIdx >= maxIdx) {
            if (this.loop) { this.inputIdx = 0; }
            else { this.inputIdx = maxIdx; this.zone.run(() => { this.stopIndividual('input'); }); return; }
          }
          this.zone.run(() => { this.drawAll(); this.cdr.detectChanges(); });
        }
        this._inputLastTs = ts;
        this._inputRafId = requestAnimationFrame(loop);
      };
      this.zone.runOutsideAngular(() => { this._inputRafId = requestAnimationFrame(loop); });
    } else {
      if (this._outputRafId) cancelAnimationFrame(this._outputRafId);
      this._outputLastTs = 0;
      const loop = (ts: number) => {
        if (this._destroyed || !this.outputPlaying || this.outputPaused) return;
        if (this._outputLastTs) {
          const elapsed = ts - this._outputLastTs;
          this.outputIdx += Math.round((elapsed / 1000) * this.sampleRate * this.playbackSpeed);
          const maxIdx = this.outputSamples.length - 1;
          if (this.outputIdx >= maxIdx) {
            if (this.loop) { this.outputIdx = 0; }
            else { this.outputIdx = maxIdx; this.zone.run(() => { this.stopIndividual('output'); }); return; }
          }
          this.zone.run(() => { this.drawAll(); this.cdr.detectChanges(); });
        }
        this._outputLastTs = ts;
        this._outputRafId = requestAnimationFrame(loop);
      };
      this.zone.runOutsideAngular(() => { this._outputRafId = requestAnimationFrame(loop); });
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // GLOBAL RAF LOOP — advances shared viewStart + currentSampleIdx
  // ────────────────────────────────────────────────────────────────────

  private startRaf(): void {
    this.stopRaf();
    this._lastRafTime = 0;

    const loop = (ts: number) => {
      if (this._destroyed) return;
      if (!this._lastRafTime) {
        this._lastRafTime = ts;
        this._rafId = requestAnimationFrame(loop);
        return;
      }

      const elapsed = ts - this._lastRafTime;
      this._lastRafTime = ts;

      if (!this.isPaused && this.inputSamples.length) {
        this.currentSampleIdx += Math.round((elapsed / 1000) * this.sampleRate * this.playbackSpeed);
        const maxIdx = this.inputSamples.length - 1;

        if (this.currentSampleIdx >= maxIdx) {
          if (this.loop) {
            this.currentSampleIdx = 0;
            this.viewStart = 0;
          } else {
            this.currentSampleIdx = maxIdx;
            this.zone.run(() => { this.stopGlobal(); });
            return;
          }
        }

        // Linked: both viewers share viewStart
        const halfWin = Math.floor(this.viewWindow / 2);
        this.viewStart = Math.max(
          0,
          Math.min(this.currentSampleIdx - halfWin, this.inputSamples.length - this.viewWindow)
        );

        this.zone.run(() => { this.drawAll(); this.cdr.detectChanges(); });
      }

      this._rafId = requestAnimationFrame(loop);
    };

    this.zone.runOutsideAngular(() => { this._rafId = requestAnimationFrame(loop); });
  }

  private stopRaf(): void {
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = 0; }
    if (this._inputRafId) { cancelAnimationFrame(this._inputRafId); this._inputRafId = 0; }
    if (this._outputRafId) { cancelAnimationFrame(this._outputRafId); this._outputRafId = 0; }
  }

  // ────────────────────────────────────────────────────────────────────
  // SPEED / ZOOM / PAN / SEEK
  // ────────────────────────────────────────────────────────────────────

  onSpeedChange(val: string): void {
    this.playbackSpeed = parseFloat(val);
    if (this.inputAudioSource) this.inputAudioSource.playbackRate.value = this.playbackSpeed;
    if (this.outputAudioSource) this.outputAudioSource.playbackRate.value = this.playbackSpeed;
  }

  zoomIn(): void {
    this.viewWindow = Math.max(Math.floor(this.sampleRate * 0.1), Math.floor(this.viewWindow / 1.5));
    this.clampView(); this.drawAll();
  }
  zoomOut(): void {
    this.viewWindow = Math.min(
      this.inputSamples.length || this.sampleRate * 10,
      Math.floor(this.viewWindow * 1.5)
    );
    this.clampView(); this.drawAll();
  }
  panLeft(): void {
    this.viewStart = Math.max(0, this.viewStart - Math.floor(this.viewWindow * 0.2));
    this.drawAll();
  }
  panRight(): void {
    this.viewStart = Math.min(
      Math.max(0, (this.inputSamples.length || 0) - this.viewWindow),
      this.viewStart + Math.floor(this.viewWindow * 0.2)
    );
    this.drawAll();
  }
  resetView(): void {
    this.viewWindow = Math.floor(this.sampleRate * 2);
    this.clampView(); this.drawAll();
  }

  private clampView(): void {
    const max = Math.max(0, (this.inputSamples.length || 0) - this.viewWindow);
    this.viewStart = Math.min(Math.max(0, this.viewStart), max);
  }

  onProgressClick(event: MouseEvent): void {
    if (!this.inputSamples.length) return;
    const pct = event.offsetX / (event.currentTarget as HTMLElement).offsetWidth;
    this.currentSampleIdx = Math.floor(pct * this.inputSamples.length);
    const halfWin = Math.floor(this.viewWindow / 2);
    this.viewStart = Math.max(0, this.currentSampleIdx - halfWin);
    this.clampView();
    if (this.isPlaying && !this.isPaused) {
      const off = this.currentSampleIdx / this.sampleRate;
      if (this.playTarget !== 'output') { this.stopAudioSource('input'); this.startAudioFrom('input', off); }
      if (this.playTarget !== 'input') { this.stopAudioSource('output'); this.startAudioFrom('output', off); }
    }
    this.drawAll();
  }

  toggleFreqScale(): void {
    this.freqScale = this.freqScale === 'linear' ? 'audiogram' : 'linear';
    this.drawFftGraph();
  }

  // ────────────────────────────────────────────────────────────────────
  // AUDIO
  // ────────────────────────────────────────────────────────────────────

  private ensureAudioCtx(): void {
    if (!this.audioCtx) this.audioCtx = new AudioContext();
  }

  private startAudioFrom(stream: 'input' | 'output', offset: number): void {
    const buf = stream === 'input' ? this.inputAudioBuffer : this.outputAudioBuffer;
    if (!buf) return;
    this.ensureAudioCtx();
    if (this.audioCtx!.state === 'suspended') this.audioCtx!.resume();
    this.stopAudioSource(stream);

    const src = this.audioCtx!.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = this.playbackSpeed;
    src.connect(this.audioCtx!.destination);
    src.start(0, Math.max(0, offset));

    if (stream === 'input') {
      this.inputAudioSource = src;
      this.inputAudioStartTime = this.audioCtx!.currentTime - offset;
      this.inputAudioPauseOff = 0;
    } else {
      this.outputAudioSource = src;
      this.outputAudioStartTime = this.audioCtx!.currentTime - offset;
      this.outputAudioPauseOff = 0;
    }
  }

  private resumeAudio(stream: 'input' | 'output'): void {
    const off = stream === 'input' ? this.inputAudioPauseOff : this.outputAudioPauseOff;
    this.startAudioFrom(stream, off);
  }

  private stopAudioSource(stream: 'input' | 'output'): void {
    if (stream === 'input') {
      try { this.inputAudioSource?.stop(); } catch { }
      this.inputAudioSource = null;
    } else {
      try { this.outputAudioSource?.stop(); } catch { }
      this.outputAudioSource = null;
    }
  }

  private stopAllAudio(): void {
    this.stopAudioSource('input');
    this.stopAudioSource('output');
  }

  // ── Play only EQ output as one-shot preview ────────────────────────
  playOutputAsSound(): void {
    if (!this.outputSamples.length) return;
    this.stopAudioSource('output');
    this.startAudioFrom('output', 0);
  }

  // ────────────────────────────────────────────────────────────────────
  // COMPUTED GETTERS
  // ────────────────────────────────────────────────────────────────────

  get duration(): number { return this.inputSamples.length / this.sampleRate; }
  get currentTime(): number { return this.currentSampleIdx / this.sampleRate; }
  get progressPct(): number { return this.duration ? (this.currentTime / this.duration) * 100 : 0; }

  get inputCurrentTime(): number { return this.inputIdx / this.sampleRate; }
  get outputCurrentTime(): number { return this.outputIdx / this.sampleRate; }

  formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(1).padStart(4, '0');
    return `${m}:${s}`;
  }
}
