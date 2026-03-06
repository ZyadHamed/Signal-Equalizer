import {
  Component, OnInit, OnDestroy, AfterViewInit,
  ViewChild, ElementRef, NgZone, ChangeDetectorRef, ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

declare const Plotly: any;

export type AppMode = 'generic' | 'musical' | 'animal' | 'voice' | 'ecg';
export type FreqScale = 'linear' | 'audiogram';
export interface FreqRange { from: number; to: number; }
export interface FreqBand { label: string; ranges: FreqRange[]; gain: number; }
export interface ModeConfig { name: string; bands: FreqBand[]; }

const MODE_PRESETS: Record<AppMode, ModeConfig> = {
  generic: {
    name: 'Generic', bands: [
      { label: 'Sub Bass', ranges: [{ from: 20, to: 60 }], gain: 1 },
      { label: 'Bass', ranges: [{ from: 60, to: 250 }], gain: 1 },
      { label: 'Low Mid', ranges: [{ from: 250, to: 2000 }], gain: 1 },
      { label: 'High Mid', ranges: [{ from: 2000, to: 6000 }], gain: 1 },
      { label: 'Presence', ranges: [{ from: 6000, to: 12000 }], gain: 1 },
      { label: 'Brilliance', ranges: [{ from: 12000, to: 20000 }], gain: 1 },
    ]
  },
  musical: {
    name: 'Musical Instruments', bands: [
      { label: 'Bass Guitar', ranges: [{ from: 40, to: 300 }], gain: 1 },
      { label: 'Piano', ranges: [{ from: 300, to: 1000 }, { from: 2000, to: 4000 }], gain: 1 },
      { label: 'Violin', ranges: [{ from: 600, to: 2000 }, { from: 4000, to: 8000 }], gain: 1 },
      { label: 'Drums', ranges: [{ from: 40, to: 200 }, { from: 6000, to: 16000 }], gain: 1 },
    ]
  },
  animal: {
    name: 'Animal Sounds', bands: [
      { label: 'Dog', ranges: [{ from: 500, to: 2000 }], gain: 1 },
      { label: 'Cat', ranges: [{ from: 2000, to: 5000 }], gain: 1 },
      { label: 'Bird', ranges: [{ from: 5000, to: 10000 }], gain: 1 },
      { label: 'Frog', ranges: [{ from: 100, to: 800 }], gain: 1 },
    ]
  },
  voice: {
    name: 'Human Voices', bands: [
      { label: 'Male Old', ranges: [{ from: 85, to: 200 }], gain: 1 },
      { label: 'Male Young', ranges: [{ from: 100, to: 300 }], gain: 1 },
      { label: 'Female Old', ranges: [{ from: 165, to: 400 }], gain: 1 },
      { label: 'Female Young', ranges: [{ from: 200, to: 500 }], gain: 1 },
    ]
  },
  ecg: {
    name: 'ECG Abnormalities', bands: [
      { label: 'Normal Sinus', ranges: [{ from: 0.5, to: 40 }], gain: 1 },
      { label: 'Atrial Flutter', ranges: [{ from: 6, to: 12 }, { from: 24, to: 48 }], gain: 1 },
      { label: 'Ventricular Fibr.', ranges: [{ from: 150, to: 500 }], gain: 1 },
      { label: 'Bradycardia', ranges: [{ from: 0.5, to: 1 }], gain: 1 },
    ]
  },
};

function globalPeak(arr: Float32Array): number {
  let m = 0;
  for (let i = 0; i < arr.length; i++) { const v = Math.abs(arr[i]); if (v > m) m = v; }
  return m || 1;
}

const PLOT_INPUT = 'sv-plot-input';
const PLOT_OUTPUT = 'sv-plot-output';
const PLOT_FFT = 'sv-fft-graph';

@Component({
  selector: 'app-signal-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './signal-viewer.component.html',
  styleUrls: ['./signal-viewer.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignalViewerComponent implements OnInit, AfterViewInit, OnDestroy {

  @ViewChild('fileInput') fileInputRef!: ElementRef<HTMLInputElement>;
  @ViewChild('settingsInput') settingsInputRef!: ElementRef<HTMLInputElement>;

  readonly PLOT_INPUT = PLOT_INPUT;
  readonly PLOT_OUTPUT = PLOT_OUTPUT;
  readonly PLOT_FFT = PLOT_FFT;

  readonly modeKeys: AppMode[] = ['generic', 'musical', 'animal', 'voice', 'ecg'];
  currentMode: AppMode = 'musical';
  bands: FreqBand[] = [];
  freqScale: FreqScale = 'linear';
  newBandLabel = 'New Band';
  newBandFrom = 0;
  newBandTo = 1000;

  inputSamples: Float32Array = new Float32Array(0);
  outputSamples: Float32Array = new Float32Array(0);
  sampleRate = 500;
  fileName = '';
  isProcessing = false;

  viewStart = 0;
  viewWindow = 0;

  globalPlaying = false;
  globalPaused = false;
  inputPlaying = false;
  outputPlaying = false;
  currentIdx = 0;
  playbackSpeed = 1;
  loop = false;

  private audioCtx: AudioContext | null = null;
  private inputAudioBuffer: AudioBuffer | null = null;
  private outputAudioBuffer: AudioBuffer | null = null;
  private audioSource: AudioBufferSourceNode | null = null;
  private audioPauseOffset = 0;
  private audioStartTime = 0;

  private _rafId = 0;
  private _lastTs = 0;
  private _inputRaf = 0;
  private _outputRaf = 0;
  private _destroyed = false;

  constructor(private zone: NgZone, private cdr: ChangeDetectorRef) { }

  ngOnInit(): void { this.loadMode(this.currentMode); }
  ngAfterViewInit() { setTimeout(() => this.drawAll(), 150); }

  ngOnDestroy(): void {
    this._destroyed = true;
    this.cancelAllRaf();
    this.stopAudioSource();
    this.audioCtx?.close();
    [PLOT_INPUT, PLOT_OUTPUT, PLOT_FFT].forEach(id => {
      const el = document.getElementById(id);
      if (el) try { Plotly.purge(el); } catch { }
    });
  }

  loadMode(mode: AppMode): void {
    this.currentMode = mode;
    this.bands = MODE_PRESETS[mode].bands.map(b => ({
      label: b.label, gain: 1, ranges: b.ranges.map(r => ({ ...r })),
    }));
    this.applyEqualizer();
  }

  getModeName(m: AppMode): string { return MODE_PRESETS[m].name; }

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
    this.audioCtx = this.audioCtx ?? new AudioContext();
    try {
      this.inputAudioBuffer = await this.audioCtx.decodeAudioData(await file.arrayBuffer());
      this.sampleRate = this.inputAudioBuffer.sampleRate;
      this.inputSamples = this.inputAudioBuffer.getChannelData(0).slice();
    } catch { alert('Cannot decode audio. Use MP3 or WAV.'); return; }
    this.initView();
    await this.applyEqualizer();
  }

  private async loadJsonSignal(file: File): Promise<void> {
    let obj: any;
    try { obj = JSON.parse(await file.text()); }
    catch { alert('Invalid JSON file.'); return; }

    let raw: number[] = [];
    let fs = 500;

    if (Array.isArray(obj.signals) && obj.signals.length) {
      fs = obj.fs ?? obj.sampleRate ?? obj.sample_rate ?? 500;
      raw = obj.signals[0];
    } else if (Array.isArray(obj.Leads) && obj.Leads.length) {
      fs = obj.SampleRate ?? obj.sampleRate ?? obj.fs ?? 500;
      const lead = obj.Leads[0];
      raw = lead.Samples ?? lead.samples ?? lead.data ?? [];
    } else if (Array.isArray(obj.samples) && obj.samples.length) {
      fs = obj.sampleRate ?? obj.fs ?? 500;
      raw = obj.samples;
    } else if (Array.isArray(obj.data) && obj.data.length) {
      fs = obj.fs ?? obj.sampleRate ?? 500;
      raw = Array.isArray(obj.data[0]) ? obj.data[0] : obj.data;
    } else {
      alert('Cannot parse JSON.\nSupported: signals[][], Leads[{LeadName,Samples}], samples[], data[]');
      return;
    }

    this.sampleRate = fs;
    this.inputSamples = new Float32Array(raw.map(Number).filter(isFinite));
    this.audioCtx = this.audioCtx ?? new AudioContext();
    this.inputAudioBuffer = this.audioCtx.createBuffer(1, this.inputSamples.length, this.sampleRate);
    this.inputAudioBuffer.copyToChannel(this.inputSamples, 0);
    this.initView();
    await this.applyEqualizer();
  }

  private initView(): void {
    this.stopAll();
    this.currentIdx = 0;
    this.viewStart = 0;
    this.viewWindow = Math.min(this.inputSamples.length, Math.floor(this.sampleRate * 2));
  }

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
      this.bands = obj.bands.map(b => ({
        label: b.label ?? 'Band', gain: b.gain ?? 1,
        ranges: (b.ranges ?? []).map((r: FreqRange) => ({ ...r })),
      }));
      await this.applyEqualizer();
    } catch { alert('Cannot parse settings JSON.'); }
    (event.target as HTMLInputElement).value = '';
  }

  addGenericBand(): void {
    this.bands.push({
      label: this.newBandLabel || `Band ${this.bands.length + 1}`,
      ranges: [{ from: this.newBandFrom, to: this.newBandTo }], gain: 1,
    });
    this.newBandFrom = this.newBandTo;
    this.newBandTo += 1000;
    this.newBandLabel = `Band ${this.bands.length + 1}`;
    this.applyEqualizer();
  }

  removeBand(i: number): void { this.bands.splice(i, 1); this.applyEqualizer(); }

  onGainChange(i: number, val: string): void {
    this.bands[i].gain = parseFloat(val);
    this.applyEqualizer();
  }

  async applyEqualizer(): Promise<void> {
    if (!this.inputSamples.length) { this.drawAll(); return; }
    this.isProcessing = true;
    this.cdr.markForCheck();
    try { this.outputSamples = await this.runOfflineEq(); }
    catch { this.outputSamples = this.inputSamples.slice(); }
    this.audioCtx = this.audioCtx ?? new AudioContext();
    this.outputAudioBuffer = this.audioCtx.createBuffer(1, this.outputSamples.length, this.sampleRate);
    this.outputAudioBuffer.copyToChannel(this.outputSamples, 0);
    this.isProcessing = false;
    this.drawAll();
    this.cdr.markForCheck();
  }

  private async runOfflineEq(): Promise<Float32Array> {
    const N = this.inputSamples.length;
    const offline = new OfflineAudioContext(1, N, this.sampleRate);
    const srcBuf = offline.createBuffer(1, N, this.sampleRate);
    srcBuf.copyToChannel(this.inputSamples, 0);
    const src = offline.createBufferSource(); src.buffer = srcBuf;
    const dest = offline.createGain(); dest.gain.value = 1; dest.connect(offline.destination);
    if (!this.bands.length) {
      src.connect(dest);
    } else {
      this.bands.forEach(band => {
        const bg = offline.createGain(); bg.gain.value = band.gain; bg.connect(dest);
        band.ranges.forEach(range => {
          const center = (range.from + range.to) / 2;
          const bw = Math.max(range.to - range.from, 1);
          const bp = offline.createBiquadFilter();
          bp.type = 'bandpass'; bp.frequency.value = Math.max(center, 1); bp.Q.value = center / bw;
          src.connect(bp); bp.connect(bg);
        });
      });
    }
    src.start(0);
    return (await offline.startRendering()).getChannelData(0).slice();
  }

  toggleFreqScale(): void {
    this.freqScale = this.freqScale === 'linear' ? 'audiogram' : 'linear';
    this.drawFftGraph();
  }

  onSpeedChange(val: string): void {
    this.playbackSpeed = parseFloat(val);
    if (this.audioSource) this.audioSource.playbackRate.value = this.playbackSpeed;
  }

  zoomIn(): void {
    const min = Math.floor(this.sampleRate * 0.1);
    this.viewWindow = Math.max(min, Math.floor(this.viewWindow / 1.5));
    this.clampView(); this.relayoutBoth();
  }

  zoomOut(): void {
    const max = this.inputSamples.length || this.sampleRate * 10;
    this.viewWindow = Math.min(max, Math.floor(this.viewWindow * 1.5));
    this.clampView(); this.relayoutBoth();
  }

  panLeft(): void {
    this.viewStart = Math.max(0, this.viewStart - Math.floor(this.viewWindow * 0.2));
    this.relayoutBoth();
  }

  panRight(): void {
    const max = Math.max(0, this.inputSamples.length - this.viewWindow);
    this.viewStart = Math.min(max, this.viewStart + Math.floor(this.viewWindow * 0.2));
    this.relayoutBoth();
  }

  resetView(): void {
    this.stopAll();
    this.viewStart = 0;
    this.viewWindow = Math.min(this.inputSamples.length, Math.floor(this.sampleRate * 2));
    this.drawAll();
  }

  onProgressClick(event: MouseEvent): void {
    if (!this.inputSamples.length) return;
    const pct = event.offsetX / (event.currentTarget as HTMLElement).offsetWidth;
    this.currentIdx = Math.floor(pct * this.inputSamples.length);
    const hw = Math.floor(this.viewWindow / 2);
    this.viewStart = Math.max(0, Math.min(this.currentIdx - hw, this.inputSamples.length - this.viewWindow));
    if (this.globalPlaying && !this.globalPaused) {
      this.stopAudioSource();
      this.startAudioFrom(this.currentIdx / this.sampleRate, 'input');
    }
    this.relayoutBoth();
  }

  private clampView(): void {
    const max = Math.max(0, this.inputSamples.length - this.viewWindow);
    this.viewStart = Math.min(Math.max(0, this.viewStart), max);
  }

  private relayoutBoth(): void {
    const fs = this.sampleRate;
    const xMin = this.viewStart / fs;
    const xMax = (this.viewStart + this.viewWindow - 1) / fs;
    const curX = this.currentIdx / fs;
    const xUpd = { 'xaxis.range[0]': xMin, 'xaxis.range[1]': xMax };
    try { Plotly.relayout(PLOT_INPUT, xUpd); } catch { }
    try { Plotly.relayout(PLOT_OUTPUT, xUpd); } catch { }
    try { Plotly.restyle(PLOT_INPUT, { x: [[curX, curX]] }, [1]); } catch { }
    try { Plotly.restyle(PLOT_OUTPUT, { x: [[curX, curX]] }, [1]); } catch { }
  }

  playAll(): void {
    if (!this.inputSamples.length) return;
    if (this.globalPlaying && !this.globalPaused) return;
    this.globalPlaying = true; this.globalPaused = false;
    this.startGlobalRaf();
    this.startAudioFrom(this.audioPauseOffset, 'input');
    this.cdr.markForCheck();
  }

  pauseAll(): void {
    if (!this.globalPlaying || this.globalPaused) return;
    this.globalPaused = true;
    this.audioPauseOffset = this.audioCtx
      ? this.audioCtx.currentTime - this.audioStartTime
      : this.currentIdx / this.sampleRate;
    this.stopAudioSource();
    this.cancelGlobalRaf();
    this.cdr.markForCheck();
  }

  stopAll(): void {
    this.globalPlaying = false; this.globalPaused = false;
    this.inputPlaying = false; this.outputPlaying = false;
    this.audioPauseOffset = 0; this.currentIdx = 0;
    this.viewStart = 0;
    this.cancelAllRaf();
    this.stopAudioSource();
    this.drawAll();
    this.cdr.markForCheck();
  }

  playInput(): void {
    if (!this.inputSamples.length) return;
    this.inputPlaying = true;
    this.startAudioFrom(this.currentIdx / this.sampleRate, 'input');
    this.startStreamRaf('input');
    this.cdr.markForCheck();
  }

  stopInput(): void {
    this.inputPlaying = false;
    cancelAnimationFrame(this._inputRaf); this._inputRaf = 0;
    this.stopAudioSource(); this.cdr.markForCheck();
  }

  playOutput(): void {
    if (!this.outputSamples.length) return;
    this.outputPlaying = true;
    this.startAudioFrom(this.currentIdx / this.sampleRate, 'output');
    this.startStreamRaf('output');
    this.cdr.markForCheck();
  }

  stopOutput(): void {
    this.outputPlaying = false;
    cancelAnimationFrame(this._outputRaf); this._outputRaf = 0;
    this.stopAudioSource(); this.cdr.markForCheck();
  }

  playOutputAsSound(): void {
    if (this.outputAudioBuffer) this.startAudioFrom(0, 'output');
  }

  private startGlobalRaf(): void {
    this.cancelGlobalRaf(); this._lastTs = 0;
    const loop = (ts: number) => {
      if (this._destroyed) return;
      if (!this._lastTs) { this._lastTs = ts; this._rafId = requestAnimationFrame(loop); return; }
      const elapsed = ts - this._lastTs; this._lastTs = ts;
      if (!this.globalPaused) {
        this.currentIdx += Math.round((elapsed / 1000) * this.sampleRate * this.playbackSpeed);
        if (this.currentIdx >= this.inputSamples.length - 1) {
          if (this.loop) { this.currentIdx = 0; this.viewStart = 0; }
          else { this.zone.run(() => this.stopAll()); return; }
        }
        const hw = Math.floor(this.viewWindow / 2);
        this.viewStart = Math.max(0, Math.min(this.currentIdx - hw, this.inputSamples.length - this.viewWindow));
        this.zone.run(() => { this.relayoutBoth(); this.cdr.markForCheck(); });
      }
      this._rafId = requestAnimationFrame(loop);
    };
    this.zone.runOutsideAngular(() => { this._rafId = requestAnimationFrame(loop); });
  }

  private cancelGlobalRaf(): void {
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = 0; }
  }

  private startStreamRaf(stream: 'input' | 'output'): void {
    if (stream === 'input') { cancelAnimationFrame(this._inputRaf); this._inputRaf = 0; }
    else { cancelAnimationFrame(this._outputRaf); this._outputRaf = 0; }
    const sig = stream === 'input' ? this.inputSamples : this.outputSamples;
    let last = 0;
    const loop = (ts: number) => {
      if (this._destroyed) return;
      if (!last) last = ts;
      const elapsed = ts - last; last = ts;
      const active = stream === 'input' ? this.inputPlaying : this.outputPlaying;
      if (!active) return;
      this.currentIdx += Math.round((elapsed / 1000) * this.sampleRate * this.playbackSpeed);
      if (this.currentIdx >= sig.length) {
        if (this.loop) { this.currentIdx = 0; this.viewStart = 0; }
        else { this.zone.run(() => stream === 'input' ? this.stopInput() : this.stopOutput()); return; }
      }
      const hw = Math.floor(this.viewWindow / 2);
      this.viewStart = Math.max(0, Math.min(this.currentIdx - hw, sig.length - this.viewWindow));
      this.zone.run(() => { this.relayoutBoth(); this.cdr.markForCheck(); });
      if (stream === 'input') this._inputRaf = requestAnimationFrame(loop);
      else this._outputRaf = requestAnimationFrame(loop);
    };
    this.zone.runOutsideAngular(() => {
      if (stream === 'input') this._inputRaf = requestAnimationFrame(loop);
      else this._outputRaf = requestAnimationFrame(loop);
    });
  }

  private cancelAllRaf(): void {
    this.cancelGlobalRaf();
    cancelAnimationFrame(this._inputRaf); this._inputRaf = 0;
    cancelAnimationFrame(this._outputRaf); this._outputRaf = 0;
  }

  private startAudioFrom(offsetSec: number, stream: 'input' | 'output'): void {
    const buf = stream === 'input' ? this.inputAudioBuffer : this.outputAudioBuffer;
    if (!buf) return;
    this.audioCtx = this.audioCtx ?? new AudioContext();
    if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
    this.stopAudioSource();
    this.audioSource = this.audioCtx.createBufferSource();
    this.audioSource.buffer = buf;
    this.audioSource.playbackRate.value = this.playbackSpeed;
    this.audioSource.connect(this.audioCtx.destination);
    this.audioSource.start(0, Math.max(0, offsetSec));
    this.audioStartTime = this.audioCtx.currentTime - offsetSec;
    this.audioPauseOffset = 0;
  }

  private stopAudioSource(): void {
    try { this.audioSource?.stop(); } catch { }
    this.audioSource = null;
  }

  drawAll(): void {
    this.drawSignalPlot(PLOT_INPUT, this.inputSamples, 'Input Signal', '#1a73e8');
    this.drawSignalPlot(PLOT_OUTPUT, this.outputSamples, 'Output Signal', '#34a853');
    this.drawFftGraph();
  }

  private drawSignalPlot(divId: string, samples: Float32Array, title: string, color: string): void {
    const el = document.getElementById(divId);
    if (!el) return;
    if (!samples.length) { try { Plotly.purge(el); } catch { } return; }
    const fs = this.sampleRate;
    const from = this.viewStart;
    const to = Math.min(from + this.viewWindow, samples.length);
    const step = Math.max(1, Math.floor((to - from) / 4000));
    const xArr: number[] = [], yArr: number[] = [];
    for (let i = from; i < to; i += step) { xArr.push(i / fs); yArr.push(samples[i]); }
    const peak = globalPeak(samples);
    const yPad = peak * 0.12;
    const curX = this.currentIdx / fs;
    Plotly.react(divId,
      [
        {
          x: xArr, y: yArr, type: 'scatter', mode: 'lines', name: title,
          line: { color, width: 1.5 },
          hovertemplate: 'Time: %{x:.3f}s<br>Amp: %{y:.5f}<extra></extra>'
        },
        {
          x: [curX, curX], y: [-(peak + yPad), peak + yPad],
          type: 'scatter', mode: 'lines', showlegend: false, hoverinfo: 'none',
          line: { color: '#fbbc04', width: 2, dash: 'dot' }
        },
      ],
      {
        uirevision: divId,
        title: { text: title, font: { size: 13, color: '#1a2b4a' } },
        height: 200, margin: { l: 55, r: 20, t: 36, b: 40 },
        xaxis: {
          title: 'Time (s)', range: [from / fs, (to - 1) / fs],
          gridcolor: '#e8edf3', autorange: false, fixedrange: false
        },
        yaxis: {
          range: [-(peak + yPad), peak + yPad], title: 'Amplitude',
          gridcolor: '#f0f4f8', zeroline: true, zerolinecolor: '#c8d5e2',
          autorange: false, fixedrange: false
        },
        showlegend: false, plot_bgcolor: '#ffffff', paper_bgcolor: '#f8fafc'
      },
      {
        responsive: true, displayModeBar: true, displaylogo: false,
        modeBarButtonsToRemove: ['toImage', 'sendDataToCloud']
      }
    );
  }

  private drawFftGraph(): void {
    const el = document.getElementById(PLOT_FFT);
    if (!el || !this.inputSamples.length) { if (el) try { Plotly.purge(el); } catch { } return; }
    const FFT_N = 4096, half = FFT_N / 2, nyquist = this.sampleRate / 2;
    const isAudio = this.freqScale === 'audiogram';
    const inMag = this.computeFftDb(this.inputSamples, FFT_N);
    const outMag = this.outputSamples.length ? this.computeFftDb(this.outputSamples, FFT_N) : null;
    const fx = (f: number) => isAudio ? Math.log10(Math.max(f, 1)) : f;
    const buildXY = (mag: number[]) => {
      const x: number[] = [], y: number[] = [];
      for (let k = 1; k < half; k++) {
        const freq = (k / half) * nyquist;
        if (isAudio && (freq < 125 || freq > 8000)) continue;
        x.push(fx(freq)); y.push(mag[k]);
      }
      return { x, y };
    };
    const { x: xIn, y: yIn } = buildXY(inMag);
    const { x: xOut, y: yOut } = outMag ? buildXY(outMag) : { x: [], y: [] };
    const BC = ['#e74c3c', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#3498db', '#c0392b', '#16a085'];
    const traces: any[] = [
      {
        x: xIn, y: yIn, type: 'scatter', mode: 'lines', name: 'Input',
        line: { color: '#1a73e8', width: 1.5 }, fill: 'tozeroy', fillcolor: 'rgba(26,115,232,0.07)'
      },
    ];
    if (outMag) traces.push({
      x: xOut, y: yOut, type: 'scatter', mode: 'lines', name: 'Output (EQ)',
      line: { color: '#34a853', width: 1.5 }, fill: 'tozeroy', fillcolor: 'rgba(52,168,83,0.07)',
    });
    this.bands.forEach((band, i) => {
      const c = BC[i % BC.length];
      band.ranges.forEach(r => traces.push({
        x: [fx(r.from), fx(r.from), fx(r.to), fx(r.to), fx(r.from)],
        y: [-120, 10, 10, -120, -120],
        type: 'scatter', mode: 'lines', fill: 'toself',
        fillcolor: c + '28', line: { color: c + '66', width: 1 },
        name: band.label, showlegend: false, hoverinfo: 'name',
      }));
    });
    const audTv = [125, 250, 500, 1000, 2000, 4000, 8000].map(f => Math.log10(f));
    const audTt = ['125', '250', '500', '1k', '2k', '4k', '8k'];
    Plotly.react(PLOT_FFT, traces, {
      uirevision: `fft-${this.freqScale}`,
      title: {
        text: isAudio ? 'Frequency Domain — Audiogram Scale (125 Hz - 8 kHz, log)' : 'Frequency Domain — Linear',
        font: { size: 13, color: '#1a2b4a' }
      },
      height: 260, margin: { l: 60, r: 20, t: 44, b: 55 },
      xaxis: isAudio
        ? {
          title: 'Frequency (Hz)', gridcolor: '#e8edf3',
          range: [Math.log10(125), Math.log10(8000)], tickmode: 'array', tickvals: audTv, ticktext: audTt
        }
        : { title: 'Frequency (Hz)', range: [0, nyquist], gridcolor: '#e8edf3' },
      yaxis: {
        title: 'Magnitude (dB)', range: [-100, 10],
        gridcolor: '#f0f4f8', zeroline: true, zerolinecolor: '#c8d5e2'
      },
      showlegend: true, legend: { orientation: 'h', y: -0.22 },
      plot_bgcolor: '#ffffff', paper_bgcolor: '#f8fafc',
    }, {
      responsive: true, displayModeBar: true, displaylogo: false,
      modeBarButtonsToRemove: ['toImage', 'sendDataToCloud']
    });
  }

  private computeFftDb(samples: Float32Array, N: number): number[] {
    const half = N / 2, len = Math.min(N, samples.length);
    const mag = new Array<number>(half).fill(-100);
    for (let k = 0; k < half; k++) {
      let re = 0, im = 0;
      for (let n = 0; n < len; n++) {
        const w = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (len - 1)));
        const a = (2 * Math.PI * k * n) / N;
        re += samples[n] * w * Math.cos(a);
        im -= samples[n] * w * Math.sin(a);
      }
      mag[k] = 20 * Math.log10(Math.sqrt(re * re + im * im) / len + 1e-10);
    }
    return mag;
  }

  get totalSamples(): number { return this.inputSamples.length; }
  get duration(): number { return this.totalSamples / this.sampleRate; }
  get currentTime(): number { return this.currentIdx / this.sampleRate; }
  get progressPct(): number { return this.duration ? (this.currentTime / this.duration) * 100 : 0; }

  formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(1).padStart(4, '0');
    return `${m}:${s}`;
  }
}
