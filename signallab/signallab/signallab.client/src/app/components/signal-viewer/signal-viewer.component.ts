import {
  Component, OnInit, OnDestroy, AfterViewInit,
  ViewChild, ElementRef, NgZone, ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CineViewerComponent } from '../cine-viewer/cine-viewer.component';
import { EqSidebarComponent, WaveletInstruction } from '../eq-sidebar/eq-sidebar.component';
import { GenericModePanelComponent } from '../generic-mode-panel/generic-mode-panel.component';

export type AppMode = 'generic' | 'musical' | 'animal' | 'human' | 'ecg';
export interface FreqRange  { from: number; to: number; }
export interface FreqBand   { label: string; ranges: FreqRange[]; gain: number; }
export interface ModeConfig { name: string; bands: FreqBand[]; }
export type PlayTarget = 'input' | 'output' | 'both';

declare const Plotly: any;

const MODE_NAMES: Record<AppMode, string> = {
  generic: 'Generic',
  musical: 'Musical Instruments',
  animal:  'Animal Sounds',
  human:   'Human Voices',
  ecg:     'ECG Abnormalities',
};

const BAND_COLORS = [
  '#1a73e8','#34a853','#fbbc04','#ea4335','#9c27b0',
  '#00bcd4','#ff9800','#607d8b','#e91e63','#4caf50',
];

const INPUT_FFT_ID  = 'sv-input-fft-graph';
const OUTPUT_FFT_ID = 'sv-output-fft-graph';

// Audiogram standard range
const AUDIOGRAM_MIN = 100;
const AUDIOGRAM_MAX = 10000;

@Component({
  selector: 'app-signal-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule, CineViewerComponent, EqSidebarComponent, GenericModePanelComponent],
  templateUrl: './signal-viewer.component.html',
  styleUrls:   ['./signal-viewer.component.css'],
})
export class SignalViewerComponent implements OnInit, AfterViewInit, OnDestroy {

  @ViewChild('fileInput')  fileInputRef!:  ElementRef<HTMLInputElement>;
  @ViewChild('inputCine')  inputCineRef!:  CineViewerComponent;
  @ViewChild('outputCine') outputCineRef!: CineViewerComponent;

  // ── Mode ───────────────────────────────────────────────────────────
  readonly modeKeys: AppMode[] = ['generic', 'musical', 'animal', 'human', 'ecg'];
  currentMode: AppMode = 'generic';

  public modeBands: Record<AppMode, FreqBand[]> = {
    generic: [], musical: [], animal: [], human: [], ecg: [],
  };

  activeBands: FreqBand[] = [];

  // ── Signal ─────────────────────────────────────────────────────────
  inputSamples:  any = new Float32Array(0);
  outputSamples: any = new Float32Array(0);
  sampleRate   = 44100;
  fileName     = '';
  isProcessing = false;
  isAudioSignal = false;
  eqVersion = 0

  // ── FFT ────────────────────────────────────────────────────────────
  inputFftMagnitude:  number[] = [];
  outputFftMagnitude: number[] = [];
  fftFreqScale: 'linear' | 'audiogram' = 'linear';
  private inputFftFetched = false;
  private cachedSignalArr: number[] | null = null;

  /**
   * FFT view state — stored as (center, windowSize) so pan and zoom
   * sliders have stable, independent min/max values.
   *
   * fftXMin / fftXMax are DERIVED getters; never set them directly.
   */
  fftCenter     = 0;   // Hz — centre of the visible window
  fftWindowSize = 0;   // Hz — full width of the visible window (0 = all)

  get nyquist(): number { return this.sampleRate / 2; }

  /** Derived lower bound of FFT x-axis (Hz). */
  get fftXMin(): number {
    if (this.fftFreqScale === 'audiogram') return AUDIOGRAM_MIN;
    if (!this.fftWindowSize) return 0;
    return Math.max(0, this.fftCenter - this.fftWindowSize / 2);
  }

  /** Derived upper bound of FFT x-axis (Hz). */
  get fftXMax(): number {
    if (this.fftFreqScale === 'audiogram') return AUDIOGRAM_MAX;
    if (!this.fftWindowSize) return this.nyquist;
    return Math.min(this.nyquist, this.fftCenter + this.fftWindowSize / 2);
  }

  /** Label shown next to the zoom slider. */
  get fftWindowLabel(): string {
    if (!this.fftWindowSize) return 'All';
    const v = this.fftWindowSize;
    return v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${v.toFixed(0)} Hz`;
  }

  /** Label shown next to the pan slider. */
  get fftRangeLabel(): string {
    const lo = this.fftXMin.toFixed(0);
    const hi = this.fftXMax.toFixed(0);
    return `${lo}–${hi} Hz`;
  }

  // ── Shared viewer state ────────────────────────────────────────────
  viewStart        = 0;
  viewWindow       = 0;
  currentSampleIdx = 0;

  // ── Global transport ───────────────────────────────────────────────
  playTarget:   PlayTarget = 'both';
  isPlaying     = false;
  isPaused      = false;
  playbackSpeed = 1;
  loop          = false;

  // ── Global RAF ────────────────────────────────────────────────────
  private _rafId       = 0;
  private _lastRafTime = 0;
  private _destroyed   = false;

  // ── Audio ──────────────────────────────────────────────────────────
  private audioCtx: AudioContext | null = null;
  private inputAudioBuffer:   AudioBuffer | null = null;
  private inputAudioSource:   AudioBufferSourceNode | null = null;
  private inputAudioPauseOff  = 0;
  private outputAudioBuffer:  AudioBuffer | null = null;
  private outputAudioSource:  AudioBufferSourceNode | null = null;
  private outputAudioPauseOff = 0;

  // ── X scale (waveform) ─────────────────────────────────────────────
  readonly X_SCALE_STEPS = [0.5, 1, 2, 5, 10, 30, 60, 0];
  xScaleIndex = 2;

  constructor(private zone: NgZone, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {}
  ngAfterViewInit(): void {}

  ngOnDestroy(): void {
    this._destroyed = true;
    this.stopRaf();
    this.stopAllAudio();
    this.audioCtx?.close();
    const el1 = document.getElementById(INPUT_FFT_ID);
    const el2 = document.getElementById(OUTPUT_FFT_ID);
    if (el1) Plotly.purge(el1);
    if (el2) Plotly.purge(el2);
  }

  // ── Helpers ────────────────────────────────────────────────────────

  getModeName(m: AppMode): string { return MODE_NAMES[m]; }

  get xScaleLabel(): string {
    const v = this.X_SCALE_STEPS[this.xScaleIndex];
    if (v === 0) return 'All';
    return v < 1 ? `${v}s` : v >= 60 ? `${v / 60}m` : `${v}s`;
  }

  get duration():    number { return this.inputSamples.length / this.sampleRate; }
  get currentTime(): number { return this.currentSampleIdx / this.sampleRate; }
  get progressPct(): number { return this.duration ? (this.currentTime / this.duration) * 100 : 0; }

  formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(1).padStart(4, '0');
    return `${m}:${s}`;
  }

  // ── Mode switching ─────────────────────────────────────────────────

  switchMode(mode: AppMode): void {
    this.modeBands[this.currentMode] = this.activeBands;
    this.currentMode = mode;
    this.activeBands = this.modeBands[mode];
    this.applyEqualizer();
  }

  onBandsChange(bands: FreqBand[]): void {
    this.modeBands[this.currentMode] = bands;
    this.activeBands = bands;
    this.applyEqualizer();
  }

  // ── File upload ────────────────────────────────────────────────────

  triggerFileInput(): void { this.fileInputRef.nativeElement.click(); }

  async onFileSelected(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.fileName = file.name;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if      (ext === 'json') await this.loadJsonSignal(file);
    else if (ext === 'mat')  await this.loadMatFile(file);
    else                     await this.loadAudioFile(file);
    (event.target as HTMLInputElement).value = '';
  }

  private async loadAudioFile(file: File): Promise<void> {
    this.isAudioSignal = true;
    this.ensureAudioCtx();
    try {
      this.inputAudioBuffer = await this.audioCtx!.decodeAudioData(await file.arrayBuffer());
      this.sampleRate       = this.inputAudioBuffer.sampleRate;
      this.inputSamples     = this.inputAudioBuffer.getChannelData(0).slice();
    } catch {
      alert('Cannot decode audio. Use MP3 or WAV.'); return;
    }
    this.initViewWindow();
    await this.applyEqualizer();
  }

  private async loadJsonSignal(file: File): Promise<void> {
    this.isAudioSignal = false;
    let obj: any;
    try { obj = JSON.parse(await file.text()); }
    catch { alert('Invalid JSON file.'); return; }

    let raw: number[] | null = null;
    if      (Array.isArray(obj?.samples)) raw = obj.samples;
    else if (Array.isArray(obj?.Samples)) raw = obj.Samples;
    else if (Array.isArray(obj?.data))    raw = obj.data;
    else if (Array.isArray(obj?.Leads) && obj.Leads.length) {
      const lead = obj.Leads[0];
      raw = Array.isArray(lead?.Samples) ? lead.Samples
          : Array.isArray(lead?.samples) ? lead.samples : null;
    } else if (Array.isArray(obj?.signals) && obj.signals.length) {
      raw = (obj.signals as number[][]).map(row => row[0]);
    }

    if (!raw?.length) {
      alert('JSON format not recognised.'); return;
    }

    this.sampleRate   = obj.sampleRate ?? obj.fs ?? obj.SampleRate ?? 44100;
    this.inputSamples = new Float32Array(raw);
    this.initViewWindow();
    await this.applyEqualizer();
  }

  private async loadMatFile(file: File): Promise<void> {
    this.isAudioSignal = false;
    this.isProcessing  = true;
    this.cdr.detectChanges();

    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('http://127.0.0.1:8000/convertecgtojson', {
        method: 'POST', body: formData,
      });
      if (!response.ok) {
        alert(`ECG conversion failed: ${response.status} ${response.statusText}`);
        this.isProcessing = false; this.cdr.detectChanges(); return;
      }
      const obj = await response.json();
      if (!Array.isArray(obj?.signals) || !Array.isArray(obj?.channels)) {
        alert('Unexpected response from ECG conversion API.');
        this.isProcessing = false; this.cdr.detectChanges(); return;
      }

      const leadNames = ['II', 'Lead II', 'ii', 'lead ii', 'LEAD II'];
      let channelIndex = -1;
      for (const name of leadNames) {
        const idx = (obj.channels as string[]).findIndex((c: string) => c.trim() === name);
        if (idx !== -1) { channelIndex = idx; break; }
      }
      if (channelIndex === -1) {
        console.warn(`Lead II not found. Falling back to index 1.`);
        channelIndex = Math.min(1, obj.signals[0].length - 1);
      }

      this.sampleRate   = obj.fs ?? 500;
      this.inputSamples = new Float32Array(
        (obj.signals as number[][]).map((row: number[]) => row[channelIndex])
      );
      this.initViewWindow();
      await this.applyEqualizer();
    } catch (err) {
      console.error('ECG load error:', err);
      alert('Could not connect to ECG conversion API.');
    }

    this.isProcessing = false;
    this.cdr.detectChanges();
  }

  private initViewWindow(): void {
    this.viewStart  = 0;
    this.viewWindow = Math.floor(this.sampleRate * 2);
    this.inputFftFetched  = false;
    this.cachedSignalArr  = null;
    // Reset FFT view: show full spectrum, centered
    this.fftWindowSize = 0;                  // 0 = "show all"
    this.fftCenter     = this.nyquist / 2;   // centre of full range
  }

  // ── Equalizer + FFT ────────────────────────────────────────────────

  private async applyEqualizer(): Promise<void> {
    if (!this.inputSamples.length) return;
    this.isProcessing = true;
    this.cdr.detectChanges();

    try {
      const gainBands = this.activeBands.flatMap(band =>
        band.ranges.map(r => ({
          lowerLimit: r.from,
          upperLimit: r.to,
          gain:       band.gain,
        }))
      );

      if (!this.cachedSignalArr) {
        this.cachedSignalArr = Array.from(this.inputSamples) as number[];
      }
      const signalArr = this.cachedSignalArr;

      let inputData: any;
      let outputData: any;

      if (!this.inputFftFetched) {
        const [inputRes, outputRes] = await Promise.all([
          fetch('http://127.0.0.1:8000/applyfrequencygains', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              signal: signalArr, sampling_rate: this.sampleRate, gain_bands: [],
            }),
          }),
          fetch('http://127.0.0.1:8000/applyfrequencygains', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              signal: signalArr, sampling_rate: this.sampleRate, gain_bands: gainBands,
            }),
          }),
        ]);
        if (!inputRes.ok || !outputRes.ok) {
          console.error('EQ/FFT fetch failed');
          this.isProcessing = false; this.cdr.detectChanges(); return;
        }
        [inputData, outputData] = await Promise.all([inputRes.json(), outputRes.json()]);
        this.inputFftMagnitude = inputData.modified_fft_magnitude;
        this.inputFftFetched   = true;
      } else {
        const outputRes = await fetch('http://127.0.0.1:8000/applyfrequencygains', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            signal: signalArr, sampling_rate: this.sampleRate, gain_bands: gainBands,
          }),
        });
        if (!outputRes.ok) {
          console.error('EQ fetch failed');
          this.isProcessing = false; this.cdr.detectChanges(); return;
        }
        outputData = await outputRes.json();
      }

      this.outputFftMagnitude = outputData.modified_fft_magnitude;
      this.outputSamples      = new Float32Array(outputData.modified_signal);

      if (this.isAudioSignal) this.rebuildOutputAudioBuffer();

      setTimeout(() => {
        this.drawFft(INPUT_FFT_ID,  this.inputFftMagnitude,  'Input FFT',       '#1a73e8');
        this.drawFft(OUTPUT_FFT_ID, this.outputFftMagnitude, 'Output FFT (EQ)', '#34a853');
      }, 0);

    } catch (err) {
      console.error('EQ error:', err);
    }
    this.eqVersion++;
    this.isProcessing = false;
    this.cdr.detectChanges();
  }

  // ── FFT drawing ────────────────────────────────────────────────────

  toggleFftScale(): void {
    this.fftFreqScale = this.fftFreqScale === 'linear' ? 'audiogram' : 'linear';
    // Reset pan/zoom when switching scale modes
    this.fftWindowSize = 0;
    this.fftCenter     = this.nyquist / 2;
    this.redrawFfts();
  }

  private drawFft(
    graphId:   string,
    magnitude: number[],
    title:     string,
    color:     string,
  ): void {
    const el = document.getElementById(graphId);
    if (!el || !magnitude.length) { if (el) Plotly.purge(el); return; }

    const totalBins   = magnitude.length;
    // The backend returns the full FFT array. Only the first half (positive
    // frequencies) is meaningful; the second half mirrors it.
    const half        = Math.floor(totalBins / 2);
    const nyquist     = this.nyquist;
    const isAudiogram = this.fftFreqScale === 'audiogram';

    // Resolved view bounds in Hz
    const xMin = this.fftXMin;
    const xMax = this.fftXMax;

    // Build x / y arrays, skipping DC (k=0) and filtering to [xMin, xMax]
    const x: number[] = [];
    const y: number[] = [];
    for (let k = 1; k < half; k++) {
      const freq = (k / half) * nyquist;
      if (freq < xMin || freq > xMax) continue;
      x.push(isAudiogram ? Math.log10(freq) : freq);
      y.push(magnitude[k]);
    }

    // Compute yMax only from the VISIBLE bins to avoid off-screen outliers
    // (e.g. a giant DC spike or out-of-range bin) from collapsing the chart.
    let peakMag = 0;
    for (const v of y) { if (v > peakMag) peakMag = v; }
    const yMax = peakMag * 1.1 || 1;

    // Band overlay traces
    const traces: any[] = [
      {
        x, y, type: 'scatter', mode: 'lines', name: title,
        line: { color, width: 1.5 },
        fill: 'tozeroy',
        fillcolor: color + '18',
      },
    ];

    this.activeBands.forEach((band, i) => {
      const c = BAND_COLORS[i % BAND_COLORS.length];
      band.ranges.forEach(r => {
        const rFrom = isAudiogram ? Math.log10(Math.max(r.from, 1)) : r.from;
        const rTo   = isAudiogram ? Math.log10(Math.max(r.to,   1)) : r.to;
        traces.push({
          x: [rFrom, rFrom, rTo, rTo, rFrom],
          y: [0, yMax, yMax, 0, 0],
          type: 'scatter', mode: 'lines', fill: 'toself',
          fillcolor: c + '28', line: { color: c + '66', width: 1 },
          name: band.label, showlegend: false, hoverinfo: 'name',
        });
      });
    });

    const audiogramTickVals = [125, 250, 500, 1000, 2000, 4000, 8000].map(f => Math.log10(f));
    const audiogramTickText = ['125', '250', '500', '1k', '2k', '4k', '8k'];

    const xAxisLinear = {
      title: 'Frequency (Hz)',
      range: [xMin, xMax],
      gridcolor: '#e8edf3',
    };

    const xAxisAudiogram = {
      title: 'Frequency (Hz)',
      gridcolor: '#e8edf3',
      range: [Math.log10(AUDIOGRAM_MIN), Math.log10(AUDIOGRAM_MAX)],
      tickmode: 'array',
      tickvals: audiogramTickVals,
      ticktext: audiogramTickText,
    };

    Plotly.react(
      graphId,
      traces,
      {
        uirevision: `${graphId}-${this.fftFreqScale}-${xMin}-${xMax}`,
        title: { text: title, font: { size: 13, color: '#1a2b4a' } },
        height: 240,
        margin: { l: 60, r: 20, t: 44, b: 55 },
        xaxis: isAudiogram ? xAxisAudiogram : xAxisLinear,
        yaxis: {
          title: 'Magnitude',
          range: [0, yMax],
          gridcolor: '#f0f4f8',
          zeroline: true,
          zerolinecolor: '#c8d5e2',
        },
        showlegend: false,
        plot_bgcolor: '#ffffff',
        paper_bgcolor: '#f8fafc',
      },
      {
        responsive: true,
        displayModeBar: true,
        displaylogo: false,
        modeBarButtonsToRemove: ['toImage', 'sendDataToCloud'],
      },
    );
  }

  onWaveletChange(instructions: WaveletInstruction[]): void {
  // Send to your wavelet backend endpoint here
  console.log('Wavelet instructions:', instructions);
}

  // ── FFT pan / zoom handlers ────────────────────────────────────────

  /**
   * Called by the zoom slider.
   * `val` is the desired window size in Hz (0 = show all).
   */
  onFftZoomChange(val: string): void {
    const w = parseFloat(val);
    this.fftWindowSize = w;
    // Clamp center so window stays inside [0, nyquist]
    this.clampFftCenter();
    this.redrawFfts();
  }

  /**
   * Called by the pan slider.
   * `val` is the desired center frequency in Hz.
   */
  onFftPanChange(val: string): void {
    this.fftCenter = parseFloat(val);
    this.clampFftCenter();
    this.redrawFfts();
  }

  private clampFftCenter(): void {
    const half = this.fftWindowSize / 2;
    const lo   = Math.max(0,           half);
    const hi   = Math.min(this.nyquist, this.nyquist - half);
    this.fftCenter = Math.max(lo, Math.min(hi, this.fftCenter));
  }

  private redrawFfts(): void {
    if (!this.inputFftMagnitude.length) return;
    this.drawFft(INPUT_FFT_ID,  this.inputFftMagnitude,  'Input FFT',       '#1a73e8');
    this.drawFft(OUTPUT_FFT_ID, this.outputFftMagnitude, 'Output FFT (EQ)', '#34a853');
  }

  // ── Rebuild output audio buffer ────────────────────────────────────

  private rebuildOutputAudioBuffer(): void {
    if (!this.outputSamples.length || !this.isAudioSignal) return;
    this.ensureAudioCtx();
    const buf = this.audioCtx!.createBuffer(1, this.outputSamples.length, this.sampleRate);
    buf.copyToChannel(this.outputSamples, 0);
    this.outputAudioBuffer = buf;
  }

  // ── Global transport ───────────────────────────────────────────────

  playAll():    void { this.playGlobal('both'); }
  playInput():  void { this.playGlobal('input'); }
  playOutput(): void { this.playGlobal('output'); }

  private playGlobal(target: PlayTarget): void {
    if (!this.inputSamples.length) return;
    this.playTarget = target;
    if (this.isPlaying && this.isPaused) {
      this.isPaused = false;
      this.startRaf();
      if (this.isAudioSignal && target !== 'output') this.resumeAudio('input');
      if (this.isAudioSignal && target !== 'input')  this.resumeAudio('output');
      return;
    }
    this.isPlaying = true;
    this.isPaused  = false;
    this.startRaf();
    const offset = this.currentSampleIdx / this.sampleRate;
    if (this.isAudioSignal && target !== 'output') this.startAudioFrom('input',  offset);
    if (this.isAudioSignal && target !== 'input')  this.startAudioFrom('output', offset);
  }

  pauseGlobal(): void {
    if (!this.isPlaying || this.isPaused) return;
    this.isPaused            = true;
    this.inputAudioPauseOff  = this.currentSampleIdx / this.sampleRate;
    this.outputAudioPauseOff = this.inputAudioPauseOff;
    if (this.isAudioSignal) { this.stopAudioSource('input'); this.stopAudioSource('output'); }
    this.stopRaf();
  }

  stopGlobal(): void {
    this.isPlaying = false; this.isPaused = false;
    this.currentSampleIdx = 0; this.viewStart = 0;
    this.inputAudioPauseOff = 0; this.outputAudioPauseOff = 0;
    this.stopRaf();
    if (this.isAudioSignal) this.stopAllAudio();
    this.cdr.detectChanges();
  }

  playOutputAsSound(): void {
    if (!this.outputSamples.length) return;
    this.stopAudioSource('output');
    this.startAudioFrom('output', 0);
  }

  // ── Cine viewer passthrough ────────────────────────────────────────

  onInputSampleIdxChange(idx: number): void {
    if (this.isPlaying) return;
    const halfWin  = Math.floor(this.viewWindow / 2);
    this.viewStart = Math.max(0, Math.min(idx - halfWin, this.inputSamples.length - this.viewWindow));
  }

  onOutputSampleIdxChange(idx: number): void {
    if (this.isPlaying) return;
    const halfWin  = Math.floor(this.viewWindow / 2);
    this.viewStart = Math.max(0, Math.min(idx - halfWin, this.outputSamples.length - this.viewWindow));
  }

  // ── RAF ────────────────────────────────────────────────────────────

  private startRaf(): void {
    this.stopRaf();
    this._lastRafTime = 0;
    const loop = (ts: number) => {
      if (this._destroyed) return;
      if (!this._lastRafTime) { this._lastRafTime = ts; this._rafId = requestAnimationFrame(loop); return; }
      const elapsed = ts - this._lastRafTime;
      this._lastRafTime = ts;
      if (!this.isPaused && this.inputSamples.length) {
        this.currentSampleIdx += Math.round((elapsed / 1000) * this.sampleRate * this.playbackSpeed);
        const maxIdx = this.inputSamples.length - 1;
        if (this.currentSampleIdx >= maxIdx) {
          if (this.loop) { this.currentSampleIdx = 0; this.viewStart = 0; }
          else { this.currentSampleIdx = maxIdx; this.zone.run(() => { this.stopGlobal(); }); return; }
        }
        const halfWin  = Math.floor(this.viewWindow / 2);
        this.viewStart = Math.max(0, Math.min(this.currentSampleIdx - halfWin, this.inputSamples.length - this.viewWindow));
        this.zone.run(() => { this.cdr.detectChanges(); });
      }
      this._rafId = requestAnimationFrame(loop);
    };
    this.zone.runOutsideAngular(() => { this._rafId = requestAnimationFrame(loop); });
  }

  private stopRaf(): void {
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = 0; }
  }

  // ── Zoom / pan / seek (waveform) ───────────────────────────────────

  zoomIn():    void { this.viewWindow = Math.max(Math.floor(this.sampleRate * 0.1), Math.floor(this.viewWindow / 1.5)); this.clampView(); }
  zoomOut():   void { this.viewWindow = Math.min(this.inputSamples.length || this.sampleRate * 10, Math.floor(this.viewWindow * 1.5)); this.clampView(); }
  panLeft():   void { this.viewStart  = Math.max(0, this.viewStart - Math.floor(this.viewWindow * 0.2)); }
  panRight():  void { this.viewStart  = Math.min(Math.max(0, this.inputSamples.length - this.viewWindow), this.viewStart + Math.floor(this.viewWindow * 0.2)); }
  resetView(): void { this.viewWindow = Math.floor(this.sampleRate * 2); this.clampView(); }

  private clampView(): void {
    const halfWin  = Math.floor(this.viewWindow / 2);
    this.viewStart = Math.max(0, Math.min(this.currentSampleIdx - halfWin, Math.max(0, this.inputSamples.length - this.viewWindow)));
  }

  onXScaleChange(idx: string): void {
    this.xScaleIndex = parseInt(idx);
    const secs       = this.X_SCALE_STEPS[this.xScaleIndex];
    this.viewWindow  = secs === 0 ? this.inputSamples.length : Math.floor(secs * this.sampleRate);
    this.clampView();
    this.cdr.detectChanges();
  }

  onProgressClick(event: MouseEvent): void {
    if (!this.inputSamples.length) return;
    const pct             = event.offsetX / (event.currentTarget as HTMLElement).offsetWidth;
    this.currentSampleIdx = Math.floor(pct * this.inputSamples.length);
    this.clampView();
    if (this.isAudioSignal && this.isPlaying && !this.isPaused) {
      const off = this.currentSampleIdx / this.sampleRate;
      if (this.playTarget !== 'output') { this.stopAudioSource('input');  this.startAudioFrom('input',  off); }
      if (this.playTarget !== 'input')  { this.stopAudioSource('output'); this.startAudioFrom('output', off); }
    }
    this.inputCineRef?.seekTo(this.currentSampleIdx);
    this.outputCineRef?.seekTo(this.currentSampleIdx);
  }

  onProgressMouseDown(event: MouseEvent): void {
    if (!this.inputSamples.length) return;
    event.preventDefault();
    const bar = event.currentTarget as HTMLElement;
    const move = (e: MouseEvent) => {
      const rect = bar.getBoundingClientRect();
      const pct  = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      this.currentSampleIdx = Math.floor(pct * this.inputSamples.length);
      this.clampView();
      this.inputCineRef?.seekTo(this.currentSampleIdx);
      this.outputCineRef?.seekTo(this.currentSampleIdx);
      this.cdr.detectChanges();
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup',   up);
      if (this.isAudioSignal && this.isPlaying && !this.isPaused) {
        const off = this.currentSampleIdx / this.sampleRate;
        if (this.playTarget !== 'output') { this.stopAudioSource('input');  this.startAudioFrom('input',  off); }
        if (this.playTarget !== 'input')  { this.stopAudioSource('output'); this.startAudioFrom('output', off); }
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup',   up);
  }

  onSpeedChange(val: string): void {
    this.playbackSpeed = parseFloat(val);
    if (this.inputAudioSource)  this.inputAudioSource.playbackRate.value  = this.playbackSpeed;
    if (this.outputAudioSource) this.outputAudioSource.playbackRate.value = this.playbackSpeed;
  }



  // ── Audio ──────────────────────────────────────────────────────────

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
    src.buffer = buf; src.playbackRate.value = this.playbackSpeed;
    src.connect(this.audioCtx!.destination);
    src.start(0, Math.max(0, offset));
    if (stream === 'input') { this.inputAudioSource  = src; this.inputAudioPauseOff  = 0; }
    else                    { this.outputAudioSource = src; this.outputAudioPauseOff = 0; }
  }

  private resumeAudio(stream: 'input' | 'output'): void {
    this.startAudioFrom(stream, stream === 'input' ? this.inputAudioPauseOff : this.outputAudioPauseOff);
  }

  private stopAudioSource(stream: 'input' | 'output'): void {
    if (stream === 'input')  { try { this.inputAudioSource?.stop();  } catch {} this.inputAudioSource  = null; }
    else                     { try { this.outputAudioSource?.stop(); } catch {} this.outputAudioSource = null; }
  }

  private stopAllAudio(): void {
    this.stopAudioSource('input'); this.stopAudioSource('output');
  }
}