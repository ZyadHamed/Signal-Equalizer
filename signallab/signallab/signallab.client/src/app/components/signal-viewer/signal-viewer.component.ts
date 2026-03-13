import {
  Component, OnInit, OnDestroy, AfterViewInit,
  ViewChild, ViewChildren, QueryList,
  ElementRef, NgZone, ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CineViewerComponent } from '../cine-viewer/cine-viewer.component';
import { GenericModePanelComponent } from '../generic-mode-panel/generic-mode-panel.component';
import { EqSidebarComponent } from '../eq-sidebar/eq-sidebar.component';

export type AppMode = 'generic' | 'musical' | 'animal' | 'human' | 'ecg';
export interface FreqRange  { from: number; to: number; }
export interface FreqBand   { label: string; ranges: FreqRange[]; gain: number; }
export interface ModeConfig { name: string; bands: FreqBand[]; }
export type PlayTarget = 'input' | 'output' | 'both';

const MODE_NAMES: Record<AppMode, string> = {
  generic: 'Generic',
  musical: 'Musical Instruments',
  animal:  'Animal Sounds',
  human:   'Human Voices',
  ecg:     'ECG Abnormalities',
};

@Component({
  selector: 'app-signal-viewer',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CineViewerComponent,
    EqSidebarComponent,
    GenericModePanelComponent
  ],
  templateUrl: './signal-viewer.component.html',
  styleUrls:   ['./signal-viewer.component.css'],
})
export class SignalViewerComponent implements OnInit, AfterViewInit, OnDestroy {

  @ViewChild('fileInput')     fileInputRef!:     ElementRef<HTMLInputElement>;
  @ViewChild('inputCine')     inputCineRef!:     CineViewerComponent;
  @ViewChild('outputCine')    outputCineRef!:    CineViewerComponent;

  // ── Mode ───────────────────────────────────────────────────────────
  readonly modeKeys: AppMode[] = ['generic', 'musical', 'animal', 'human', 'ecg'];
  currentMode: AppMode = 'generic';

  // Per-mode band state — each mode keeps its own bands independently
  public modeBands: Record<AppMode, FreqBand[]> = {
    generic: [],
    musical: [],
    animal:  [],
    human:   [],
    ecg:     [],
  };

  // Bands currently active (driven by currentMode)
  activeBands: FreqBand[] = [];

  // ── Signal ─────────────────────────────────────────────────────────
  inputSamples:  any = new Float32Array(0);
  outputSamples: any = new Float32Array(0);
  sampleRate  = 44100;
  fileName    = '';
  isProcessing = false;
  isAudioSignal = false;

  // ── Shared viewer state ────────────────────────────────────────────
  viewStart        = 0;
  viewWindow       = 0;
  currentSampleIdx = 0;

  // ── Global transport ───────────────────────────────────────────────
  playTarget:    PlayTarget = 'both';
  isPlaying      = false;
  isPaused       = false;
  playbackSpeed  = 1;
  loop           = false;

  // ── Global RAF ────────────────────────────────────────────────────
  private _rafId       = 0;
  private _lastRafTime = 0;
  private _destroyed   = false;

  // ── Audio — global transport ───────────────────────────────────────
  private audioCtx: AudioContext | null = null;

  private inputAudioBuffer:   AudioBuffer | null = null;
  private inputAudioSource:   AudioBufferSourceNode | null = null;
  private inputAudioPauseOff  = 0;

  private outputAudioBuffer:  AudioBuffer | null = null;
  private outputAudioSource:  AudioBufferSourceNode | null = null;
  private outputAudioPauseOff = 0;

  constructor(private zone: NgZone, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {}

  ngAfterViewInit(): void {}

  ngOnDestroy(): void {
    this._destroyed = true;
    this.stopRaf();
    this.stopAllAudio();
    this.audioCtx?.close();
  }

  // ── Helpers ────────────────────────────────────────────────────────

  getModeName(m: AppMode): string { return MODE_NAMES[m]; }

  // ── Mode switching ─────────────────────────────────────────────────

  switchMode(mode: AppMode): void {
    // Persist current mode's bands before switching
    this.modeBands[this.currentMode] = this.activeBands;
    this.currentMode = mode;
    // Restore the new mode's bands (empty on first visit — mode component
    // will emit its defaults via bandsChange on ngOnInit)
    this.activeBands = this.modeBands[mode];
    // Re-run EQ with whatever bands are now active
    this.applyEqualizer();
  }

  // Called by every mode component whenever its bands change
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
    else if (ext === 'mat')  await this.loadMatFile(file);    // ← add this
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
    }
    else if (Array.isArray(obj?.signals) && obj.signals.length) {
      raw = (obj.signals as number[][]).map(row => row[0]);
    }

    if (!raw || raw.length === 0) {
      alert('JSON format not recognised.\nSupported: { samples }, { Samples }, { data }, { Leads[].Samples }, { signals[][] }');
      return;
    }

    this.sampleRate   = obj.sampleRate ?? obj.fs ?? obj.SampleRate ?? 44100;
    this.inputSamples = new Float32Array(raw);
    this.initViewWindow();
    await this.applyEqualizer();
  }

  private async loadMatFile(file: File): Promise<void> {
  this.isAudioSignal = false;
  this.isProcessing = true;
  this.cdr.detectChanges();

  try {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('http://127.0.0.1:8000/convertecgtojson', {
      method: 'POST',
      body:   formData,
    });

    if (!response.ok) {
      alert(`ECG conversion failed: ${response.status} ${response.statusText}`);
      this.isProcessing = false;
      this.cdr.detectChanges();
      return;
    }

    const obj = await response.json();

    // obj = { signals: number[][], channels: string[], fs: number }
    if (!Array.isArray(obj?.signals) || !Array.isArray(obj?.channels)) {
      alert('Unexpected response from ECG conversion API.');
      this.isProcessing = false;
      this.cdr.detectChanges();
      return;
    }

    // Find Lead II — try common naming variants
    const leadNames  = ['II', 'Lead II', 'ii', 'lead ii', 'LEAD II'];
    let channelIndex = -1;

    for (const name of leadNames) {
      const idx = (obj.channels as string[]).findIndex(
        (c: string) => c.trim() === name
      );
      if (idx !== -1) { channelIndex = idx; break; }
    }

    // Fall back to index 1 (second lead) if name not found
    if (channelIndex === -1) {
      console.warn(
        `Lead II not found in channels: [${obj.channels.join(', ')}]. ` +
        `Falling back to channel index 1.`
      );
      channelIndex = Math.min(1, obj.signals[0].length - 1);
    }

    // signals is number[][] — rows are time steps, columns are channels
    const raw: number[] = (obj.signals as number[][]).map(
      (row: number[]) => row[channelIndex]
    );

    this.sampleRate   = obj.fs ?? 500;
    this.inputSamples = new Float32Array(raw);
    this.initViewWindow();
    await this.applyEqualizer();

  } catch (err) {
    console.error('ECG load error:', err);
    alert('Could not connect to ECG conversion API. Make sure the server is running at http://127.0.0.1:8000');
  }

  this.isProcessing = false;
  this.cdr.detectChanges();
}

  private initViewWindow(): void {
    this.viewStart  = 0;
    this.viewWindow = Math.floor(this.sampleRate * 2);
    // Do NOT touch currentSampleIdx or playback state
  }

  // ── Equalizer ──────────────────────────────────────────────────────

  async applyEqualizer(): Promise<void> {
    if (!this.inputSamples.length) return;
    
    if (!this.isAudioSignal) {
    // For non-audio signals (ECG etc.), output = filtered input via pure JS
    this.outputSamples = this.applyEqDirect(this.inputSamples, this.activeBands);
    this.cdr.detectChanges();
    return;
  }

    this.isProcessing = true;
    this.cdr.detectChanges();
    try {
      this.outputSamples = await this.runOfflineEq();
      this.rebuildOutputAudioBuffer();
    } catch (e) {
      console.error('EQ error:', e);
      this.outputSamples = this.inputSamples.slice();
      this.rebuildOutputAudioBuffer();
    }
    this.isProcessing = false;
    this.cdr.detectChanges();
  }

  private applyEqDirect(input: any, bands: FreqBand[]): Float32Array {
  const output = new Float32Array(input.length);
  // Copy input first
  for (let i = 0; i < input.length; i++) output[i] = input[i];

  for (const band of bands) {
    if (band.gain === 1) continue; // no-op band, skip
    for (const range of band.ranges) {
      const gainLin = band.gain;           // already linear (0–2 scale)
      const fs      = this.sampleRate;
      const fc      = (range.from + range.to) / 2;   // centre freq
      const Q       = fc / Math.max(1, range.to - range.from);

      // Peak/bell biquad coefficients
      const A  = Math.sqrt(Math.max(gainLin, 1e-6));
      const w0 = 2 * Math.PI * fc / fs;
      const cosW = Math.cos(w0);
      const sinW = Math.sin(w0);
      const alpha = sinW / (2 * Q);

      const b0 =  1 + alpha * A;
      const b1 = -2 * cosW;
      const b2 =  1 - alpha * A;
      const a0 =  1 + alpha / A;
      const a1 = -2 * cosW;
      const a2 =  1 - alpha / A;

      const nb0 = b0 / a0, nb1 = b1 / a0, nb2 = b2 / a0;
      const na1 = a1 / a0, na2 = a2 / a0;

      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < output.length; i++) {
        const x0 = output[i];
        const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
        x2 = x1; x1 = x0;
        y2 = y1; y1 = y0;
        output[i] = y0;
      }
    }
  }
  return output;
}

  private async runOfflineEq(): Promise<Float32Array> {
    const N       = this.inputSamples.length;
    const offline = new OfflineAudioContext(1, N, this.sampleRate);

    const srcBuf = offline.createBuffer(1, N, this.sampleRate);
    srcBuf.copyToChannel(this.inputSamples, 0);
    const src = offline.createBufferSource();
    src.buffer = srcBuf;

    const dest = offline.createGain();
    dest.gain.value = 1;
    dest.connect(offline.destination);

    if (!this.activeBands.length) {
      src.connect(dest);
    } else {
      this.activeBands.forEach(band => {
        const bandGain = offline.createGain();
        bandGain.gain.value = band.gain;
        bandGain.connect(dest);
        band.ranges.forEach(range => {
          const center = (range.from + range.to) / 2;
          const bw     = Math.max(range.to - range.from, 1);
          const bp     = offline.createBiquadFilter();
          bp.type            = 'bandpass';
          bp.frequency.value = Math.max(center, 1);
          bp.Q.value         = center / bw;
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
    if (!this.isAudioSignal) return;
    
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
      if (this.isAudioSignal && target !== 'output') this.resumeAudio('input');   // ← guard
      if (this.isAudioSignal && target !== 'input')  this.resumeAudio('output');  // ← guard
      return;
    }

    this.isPlaying = true;
    this.isPaused  = false;
    this.startRaf();

    const offset = this.currentSampleIdx / this.sampleRate;
    if (this.isAudioSignal && target !== 'output') this.startAudioFrom('input',  offset);  // ← guard
    if (this.isAudioSignal && target !== 'input')  this.startAudioFrom('output', offset);  // ← guard
  }

  pauseGlobal(): void {
    if (!this.isPlaying || this.isPaused) return;
    this.isPaused            = true;
    this.inputAudioPauseOff  = this.currentSampleIdx / this.sampleRate;
    this.outputAudioPauseOff = this.inputAudioPauseOff;
    if (this.isAudioSignal) this.stopAudioSource('input');   // ← guard
    if (this.isAudioSignal) this.stopAudioSource('output');  // ← guard
    this.stopRaf();
  }

  stopGlobal(): void {
    this.isPlaying           = false;
    this.isPaused            = false;
    this.currentSampleIdx    = 0;
    this.viewStart           = 0;
    this.inputAudioPauseOff  = 0;
    this.outputAudioPauseOff = 0;
    this.stopRaf();
    if (this.isAudioSignal) this.stopAllAudio();
    this.cdr.detectChanges();
  }

  // ── Cine viewer event passthrough ──────────────────────────────────
  // Individual cine viewers emit their idx during independent play.
  // We update viewStart so the sibling viewer pans with it.

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

  // ── Global RAF ─────────────────────────────────────────────────────

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

      const elapsed     = ts - this._lastRafTime;
      this._lastRafTime = ts;

      if (!this.isPaused && this.inputSamples.length) {
        this.currentSampleIdx += Math.round((elapsed / 1000) * this.sampleRate * this.playbackSpeed);
        const maxIdx = this.inputSamples.length - 1;

        if (this.currentSampleIdx >= maxIdx) {
          if (this.loop) {
            this.currentSampleIdx = 0;
            this.viewStart        = 0;
          } else {
            this.currentSampleIdx = maxIdx;
            this.zone.run(() => { this.stopGlobal(); });
            return;
          }
        }

        const halfWin  = Math.floor(this.viewWindow / 2);
        this.viewStart = Math.max(
          0,
          Math.min(this.currentSampleIdx - halfWin, this.inputSamples.length - this.viewWindow)
        );

        this.zone.run(() => { this.cdr.detectChanges(); });
      }

      this._rafId = requestAnimationFrame(loop);
    };

    this.zone.runOutsideAngular(() => {
      this._rafId = requestAnimationFrame(loop);
    });
  }

  private stopRaf(): void {
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = 0; }
  }

  // ── Zoom / pan / seek ──────────────────────────────────────────────

  zoomIn(): void {
    this.viewWindow = Math.max(Math.floor(this.sampleRate * 0.1), Math.floor(this.viewWindow / 1.5));
    this.clampView();
  }

  zoomOut(): void {
    this.viewWindow = Math.min(
      this.inputSamples.length || this.sampleRate * 10,
      Math.floor(this.viewWindow * 1.5)
    );
    this.clampView();
  }

  panLeft(): void {
    this.viewStart = Math.max(0, this.viewStart - Math.floor(this.viewWindow * 0.2));
  }

  panRight(): void {
    this.viewStart = Math.min(
      Math.max(0, this.inputSamples.length - this.viewWindow),
      this.viewStart + Math.floor(this.viewWindow * 0.2)
    );
  }

  resetView(): void {
    this.viewWindow = Math.floor(this.sampleRate * 2);
    this.clampView();
  }

private clampView(): void {
  // Re-center around the current playhead after every zoom
  const halfWin  = Math.floor(this.viewWindow / 2);
  this.viewStart = Math.max(
    0,
    Math.min(
      this.currentSampleIdx - halfWin,
      Math.max(0, this.inputSamples.length - this.viewWindow)
    )
  );
}

  onProgressClick(event: MouseEvent): void {
    if (!this.inputSamples.length) return;
    const pct             = event.offsetX / (event.currentTarget as HTMLElement).offsetWidth;
    this.currentSampleIdx = Math.floor(pct * this.inputSamples.length);
    const halfWin         = Math.floor(this.viewWindow / 2);
    this.viewStart        = Math.max(0, this.currentSampleIdx - halfWin);
    this.clampView();

  if (this.isAudioSignal && this.isPlaying && !this.isPaused) {
    const off = this.currentSampleIdx / this.sampleRate;
    if (this.playTarget !== 'output') { this.stopAudioSource('input');  this.startAudioFrom('input',  off); }
    if (this.playTarget !== 'input')  { this.stopAudioSource('output'); this.startAudioFrom('output', off); }
  }

    // Tell child cine viewers to seek to the clicked position
    this.inputCineRef?.seekTo(this.currentSampleIdx);
    this.outputCineRef?.seekTo(this.currentSampleIdx);
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
    src.buffer              = buf;
    src.playbackRate.value  = this.playbackSpeed;
    src.connect(this.audioCtx!.destination);
    src.start(0, Math.max(0, offset));

    if (stream === 'input') {
      this.inputAudioSource  = src;
      this.inputAudioPauseOff = 0;
    } else {
      this.outputAudioSource  = src;
      this.outputAudioPauseOff = 0;
    }
  }

  private resumeAudio(stream: 'input' | 'output'): void {
    const off = stream === 'input' ? this.inputAudioPauseOff : this.outputAudioPauseOff;
    this.startAudioFrom(stream, off);
  }

  private stopAudioSource(stream: 'input' | 'output'): void {
    if (stream === 'input') {
      try { this.inputAudioSource?.stop(); }  catch {}
      this.inputAudioSource = null;
    } else {
      try { this.outputAudioSource?.stop(); } catch {}
      this.outputAudioSource = null;
    }
  }

  private stopAllAudio(): void {
    this.stopAudioSource('input');
    this.stopAudioSource('output');
  }

  playOutputAsSound(): void {
    if (!this.outputSamples.length) return;
    this.stopAudioSource('output');
    this.startAudioFrom('output', 0);
  }

  // ── Computed ───────────────────────────────────────────────────────

  get duration():    number { return this.inputSamples.length / this.sampleRate; }
  get currentTime(): number { return this.currentSampleIdx / this.sampleRate; }
  get progressPct(): number { return this.duration ? (this.currentTime / this.duration) * 100 : 0; }

  formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(1).padStart(4, '0');
    return `${m}:${s}`;
  }

  onProgressMouseDown(event: MouseEvent): void {
  if (!this.inputSamples.length) return;
  event.preventDefault();

  const bar = event.currentTarget as HTMLElement;

  const move = (e: MouseEvent) => {
    const rect = bar.getBoundingClientRect();
    const pct  = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    this.currentSampleIdx = Math.floor(pct * this.inputSamples.length);
    const halfWin  = Math.floor(this.viewWindow / 2);
    this.viewStart = Math.max(0, this.currentSampleIdx - halfWin);
    this.clampView();
    this.inputCineRef?.seekTo(this.currentSampleIdx);
    this.outputCineRef?.seekTo(this.currentSampleIdx);
    this.cdr.detectChanges();
  };

  const up = (e: MouseEvent) => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup',   up);
    // If playing, re-sync audio to new position
    if (this.isPlaying && !this.isPaused) {
      const off = this.currentSampleIdx / this.sampleRate;
      if (this.playTarget !== 'output') { this.stopAudioSource('input');  this.startAudioFrom('input',  off); }
      if (this.playTarget !== 'input')  { this.stopAudioSource('output'); this.startAudioFrom('output', off); }
    }
  };

  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup',   up);
  }
  // X scale steps: index maps to seconds (0 = 0.5s … 7 = full)
readonly X_SCALE_STEPS = [0.5, 1, 2, 5, 10, 30, 60, 0];
xScaleIndex = 2; // default: 2s

get xScaleLabel(): string {
  const v = this.X_SCALE_STEPS[this.xScaleIndex];
  if (v === 0) return 'All';
  return v < 1 ? `${v}s` : v >= 60 ? `${v / 60}m` : `${v}s`;
}

onXScaleChange(idx: string): void {
  this.xScaleIndex   = parseInt(idx);
  const secs         = this.X_SCALE_STEPS[this.xScaleIndex];
  this.viewWindow    = secs === 0
    ? this.inputSamples.length
    : Math.floor(secs * this.sampleRate);
  this.clampView();
  this.cdr.detectChanges();
  }
}