import {
  Component, Input, Output, EventEmitter,
  OnChanges, OnDestroy, SimpleChanges,
  NgZone, ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';

declare const Plotly: any;

export interface CineViewerState {
  sampleIdx: number;
  isPlaying: boolean;
  isPaused:  boolean;
}

@Component({
  selector: 'app-cine-viewer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './cine-viewer.component.html',
  styleUrls:   ['./cine-viewer.component.css'],
})
export class CineViewerComponent implements OnChanges, OnDestroy {

  @Input() graphId!:    string;
  @Input() label  =     'Signal';
  @Input() color  =     '#1a73e8';
  @Input() samples: any = new Float32Array(0);
  @Input() sampleRate   = 44100;
  @Input() playbackSpeed = 1;
  @Input() loop         = false;
  @Input() externalSampleIdx: number | null = null;
  @Input() viewStart    = 0;
  @Input() viewWindow   = 0;
  @Input() isAudioSignal = true;

  @Output() sampleIdxChange = new EventEmitter<number>();
  @Output() stateChange     = new EventEmitter<CineViewerState>();

  // ── Internal state ────────────────────────────────────────────────
  currentIdx = 0;
  isPlaying  = false;
  isPaused   = false;

  private _rafId     = 0;
  private _lastTs    = 0;
  private _destroyed = false;

  // ── Audio ──────────────────────────────────────────────────────────
  private audioCtx:        AudioContext | null           = null;
  private audioBuffer:     AudioBuffer | null            = null;
  private audioSource:     AudioBufferSourceNode | null  = null;
  private audioPauseOffset = 0;
  
  private _cachedPeak = 1;


  constructor(private zone: NgZone, private cdr: ChangeDetectorRef) {}
// In ngOnChanges, update it only when samples change:
ngOnChanges(changes: SimpleChanges): void {
  if (changes['samples'] && this.samples.length) {
    this._cachedPeak = this.computePeak();
    if (this.isAudioSignal) this.rebuildAudioBuffer();  // ← guard
  }
  if (changes['externalSampleIdx'] && this.externalSampleIdx !== null) {
    this.currentIdx = this.externalSampleIdx;
  }
  if (
    changes['samples']           ||
    changes['viewStart']         ||
    changes['viewWindow']        ||
    changes['externalSampleIdx']
  ) {
    this.draw();
  }
}

// Add this private method:
private computePeak(): number {
  let peak = 0;
  for (let i = 0; i < this.samples.length; i++) {
    const v = Math.abs(this.samples[i]);
    if (v > peak) peak = v;
  }
  return peak || 1;
}

  ngOnDestroy(): void {
    this._destroyed = true;
    this.cancelRaf();
    this.stopAudioSource();
    this.audioCtx?.close();
    const el = document.getElementById(this.graphId);
    if (el) Plotly.purge(el);
  }

  // ── Public controls (called by parent) ────────────────────────────

  onPlay(): void {
    if (!this.samples.length) return;
    if (this.isPlaying && this.isPaused) {
      this.isPaused = false;
      if (this.isAudioSignal) this.resumeAudio();        // ← guard
      this.startRaf();
      this.emitState();
      return;
    }
    this.isPlaying = true;
    this.isPaused  = false;
    if (this.isAudioSignal) this.startAudioFrom(this.currentIdx / this.sampleRate); // ← guard
    this.startRaf();
    this.emitState();
  }

  onPause(): void {
    if (!this.isPlaying || this.isPaused) return;
    this.isPaused         = true;
    this.audioPauseOffset = this.currentIdx / this.sampleRate;
    if (this.isAudioSignal) this.stopAudioSource();      // ← guard
    this.cancelRaf();
    this.emitState();
  }

  onStop(): void {
    this.isPlaying        = false;
    this.isPaused         = false;
    this.currentIdx       = 0;
    this.audioPauseOffset = 0;
    this.cancelRaf();
    if (this.isAudioSignal) this.stopAudioSource();      // ← guard
    this.draw();
    this.emitState();
  }

  seekTo(idx: number): void {
    this.currentIdx = Math.max(0, Math.min(idx, this.samples.length - 1));
    if (this.isAudioSignal && this.isPlaying && !this.isPaused) {
      this.stopAudioSource();
      this.startAudioFrom(this.currentIdx / this.sampleRate);
    }
    this.draw();
  }

  // ── RAF ────────────────────────────────────────────────────────────

  private startRaf(): void {
    this.cancelRaf();
    this._lastTs = 0;

    const loop = (ts: number) => {
      if (this._destroyed || !this.isPlaying || this.isPaused) return;
      if (this._lastTs) {
        const elapsed = ts - this._lastTs;
        this.currentIdx += Math.round((elapsed / 1000) * this.sampleRate * this.playbackSpeed);
        const maxIdx = this.samples.length - 1;
        if (this.currentIdx >= maxIdx) {
          if (this.loop) { this.currentIdx = 0; }
          else {
            this.currentIdx = maxIdx;
            this.zone.run(() => { this.onStop(); });
            return;
          }
        }
        this.zone.run(() => {
          this.sampleIdxChange.emit(this.currentIdx);
          this.draw();
          this.cdr.detectChanges();
        });
      }
      this._lastTs = ts;
      this._rafId  = requestAnimationFrame(loop);
    };

    this.zone.runOutsideAngular(() => {
      this._rafId = requestAnimationFrame(loop);
    });
  }

  private cancelRaf(): void {
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = 0; }
  }

  // ── Plotly ─────────────────────────────────────────────────────────

  draw(): void {
    const el = document.getElementById(this.graphId);
    if (!el) return;
    if (!this.samples.length) { Plotly.purge(el); return; }

    const fs              = this.sampleRate;
    const effectiveWindow = this.viewWindow || Math.floor(fs * 2);
    const start           = Math.max(0, this.viewStart);
    const end             = Math.min(start + effectiveWindow, this.samples.length);

    const step = Math.max(1, Math.floor((end - start) / 4000));
    const xArr: number[] = [];
    const yArr: number[] = [];
    for (let i = start; i < end; i += step) {
      xArr.push(i / fs);
      yArr.push(this.samples[i]);
    }
    const peak = this._cachedPeak;
    const yPad = peak * 0.12;
    const playX = this.currentIdx / fs;

    Plotly.react(
      this.graphId,
      [
        {
          x: xArr, y: yArr, type: 'scatter', mode: 'lines', name: this.label,
          line: { color: this.color, width: 1.5 },
          hovertemplate: 'Time: %{x:.3f}s<br>Amp: %{y:.5f}<extra></extra>',
        },
        {
          x: [playX, playX], y: [-(peak + yPad), peak + yPad],
          type: 'scatter', mode: 'lines', showlegend: false, hoverinfo: 'none',
          line: { color: '#fbbc04', width: 2, dash: 'dot' },
        },
      ],
      {
        uirevision: this.graphId,
        title: { text: `${this.label} Signal`, font: { size: 13, color: '#1a2b4a' } },
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
        showlegend:    false,
        plot_bgcolor:  '#ffffff',
        paper_bgcolor: '#f8fafc',
      },
      { responsive: true, displayModeBar: false }
    );
  }

  // ── Audio ──────────────────────────────────────────────────────────

  private ensureAudioCtx(): void {
    if (!this.audioCtx) this.audioCtx = new AudioContext();
  }

  private rebuildAudioBuffer(): void {
    if (!this.samples.length) return;
    this.ensureAudioCtx();
    const buf = this.audioCtx!.createBuffer(1, this.samples.length, this.sampleRate);
    buf.copyToChannel(this.samples, 0);
    this.audioBuffer = buf;
  }

  private startAudioFrom(offset: number): void {
    if (!this.audioBuffer) return;
    this.ensureAudioCtx();
    if (this.audioCtx!.state === 'suspended') this.audioCtx!.resume();
    this.stopAudioSource();
    const src = this.audioCtx!.createBufferSource();
    src.buffer             = this.audioBuffer;
    src.playbackRate.value = this.playbackSpeed;
    src.connect(this.audioCtx!.destination);
    src.start(0, Math.max(0, offset));
    this.audioSource      = src;
    this.audioPauseOffset = 0;
  }

  private resumeAudio(): void {
    this.startAudioFrom(this.audioPauseOffset);
  }

  private stopAudioSource(): void {
    try { this.audioSource?.stop(); } catch {}
    this.audioSource = null;
  }

  // ── Helpers ────────────────────────────────────────────────────────

  get currentTime(): string {
    const sec = this.currentIdx / this.sampleRate;
    const m   = Math.floor(sec / 60);
    const s   = (sec % 60).toFixed(1).padStart(4, '0');
    return `${m}:${s}`;
  }

  get totalTime(): string {
    const sec = this.samples.length / this.sampleRate;
    const m   = Math.floor(sec / 60);
    const s   = (sec % 60).toFixed(1).padStart(4, '0');
    return `${m}:${s}`;
  }

  private emitState(): void {
    this.stateChange.emit({
      sampleIdx: this.currentIdx,
      isPlaying: this.isPlaying,
      isPaused:  this.isPaused,
    });
  }
}