import {
  Component, Input, OnChanges, SimpleChanges,
  ChangeDetectionStrategy, ChangeDetectorRef, NgZone,
  OnDestroy, ElementRef, ViewChild, AfterViewInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

declare const Plotly: any;

const INPUT_SPEC_ID  = 'gmp-input-spectrogram';
const OUTPUT_SPEC_ID = 'gmp-output-spectrogram';

@Component({
  selector: 'app-generic-mode-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './generic-mode-panel.component.html',
  styleUrls: ['./generic-mode-panel.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GenericModePanelComponent implements OnChanges, OnDestroy, AfterViewInit {

  /** Raw input samples (Float32Array or number[]). */
  @Input() inputSamples:  Float32Array | number[] = new Float32Array(0);
  /** Raw output samples after EQ applied. */
  @Input() outputSamples: Float32Array | number[] = new Float32Array(0);
  /** Sampling rate in Hz. */
  @Input() sampleRate = 44100;
  /**
   * Increment this counter from the parent whenever an equalisation has been
   * applied — the component watches it and redraws only the output spectrogram.
   */
  @Input() eqVersion = 0;

  // ── Spectrogram parameters ─────────────────────────────────────────
  windowSize = 256;
  overlap    = 128;

  // ── Internal state ─────────────────────────────────────────────────
  isLoadingInput  = false;
  isLoadingOutput = false;
  errorMsg        = '';

  private inputFetched  = false;   // once per signal load
  private prevInputLen  = 0;
  private prevEqVersion = -1;

  // Cached raw spectrogram data (needed to redraw on param change)
  private inputSpecData:  { frequencies: number[]; times: number[]; spectrogram_array: number[][] } | null = null;
  private outputSpecData: { frequencies: number[]; times: number[]; spectrogram_array: number[][] } | null = null;

  constructor(private cdr: ChangeDetectorRef) {}

  ngAfterViewInit(): void {}

  ngOnChanges(changes: SimpleChanges): void {
    const inputChanged = changes['inputSamples'] &&
      (this.inputSamples as any).length !== this.prevInputLen;

    const eqChanged = changes['eqVersion'] &&
      this.eqVersion !== this.prevEqVersion;

    if (inputChanged) {
      this.prevInputLen  = (this.inputSamples as any).length;
      this.inputFetched  = false;
      this.inputSpecData = null;
      this.outputSpecData = null;
      if ((this.inputSamples as any).length) {
        this.fetchInputSpectrogram();
        // Output is freshly computed alongside input on first load
        this.fetchOutputSpectrogram();
        this.prevEqVersion = this.eqVersion;
      }
      return;
    }

    if (eqChanged && this.eqVersion !== this.prevEqVersion) {
      this.prevEqVersion = this.eqVersion;
      if ((this.outputSamples as any).length) {
        this.fetchOutputSpectrogram();
      }
    }
  }

  ngOnDestroy(): void {
    const el1 = document.getElementById(INPUT_SPEC_ID);
    const el2 = document.getElementById(OUTPUT_SPEC_ID);
    if (el1) Plotly.purge(el1);
    if (el2) Plotly.purge(el2);
  }

  // ── Param change handler ───────────────────────────────────────────

  onParamsChange(): void {
    // Parameters changed — cached data is stale, always re-fetch
    if ((this.inputSamples as any).length) {
      this.inputSpecData = null;
      this.fetchInputSpectrogram();
    }
    if ((this.outputSamples as any).length) {
      this.outputSpecData = null;
      this.fetchOutputSpectrogram();
    }
  }

  // ── Fetch helpers ──────────────────────────────────────────────────

  private async fetchInputSpectrogram(): Promise<void> {
    if (!(this.inputSamples as any).length) return;
    this.isLoadingInput = true;
    this.errorMsg = '';
    this.cdr.detectChanges();

    try {
      const data = await this.postSpectrogram(this.inputSamples);
      this.inputSpecData = data;
      this.inputFetched  = true;
      setTimeout(() => this.drawSpectrogram(INPUT_SPEC_ID, data, 'Input', '#1a73e8'), 0);
    } catch (e: any) {
      this.errorMsg = `Input spectrogram error: ${e?.message ?? e}`;
    }

    this.isLoadingInput = false;
    this.cdr.detectChanges();
  }

  private async fetchOutputSpectrogram(): Promise<void> {
    if (!(this.outputSamples as any).length) return;
    this.isLoadingOutput = true;
    this.errorMsg = '';
    this.cdr.detectChanges();

    try {
      const data = await this.postSpectrogram(this.outputSamples);
      this.outputSpecData = data;
      setTimeout(() => this.drawSpectrogram(OUTPUT_SPEC_ID, data, 'Output (EQ)', '#34a853'), 0);
    } catch (e: any) {
      this.errorMsg = `Output spectrogram error: ${e?.message ?? e}`;
    }

    this.isLoadingOutput = false;
    this.cdr.detectChanges();
  }

  private async postSpectrogram(
    samples: Float32Array | number[],
  ): Promise<{ frequencies: number[]; times: number[]; spectrogram_array: number[][] }> {
    const response = await fetch('http://127.0.0.1:8000/computespectrogram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signal:       Array.from(samples),
        sampling_rate: this.sampleRate,
        window_size:  this.windowSize,
        overlap:      this.overlap,
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`${response.status} ${response.statusText} — ${detail}`);
    }
    return response.json();
  }

  // ── Drawing ────────────────────────────────────────────────────────

  private drawSpectrogram(
    graphId: string,
    data:    { frequencies: number[]; times: number[]; spectrogram_array: number[][] },
    title:   string,
    color:   string,
  ): void {
    const el = document.getElementById(graphId);
    if (!el) return;

    const { frequencies, times, spectrogram_array } = data;

    // spectrogram_array shape: [freq_bins][time_bins]  (rows = frequencies)
    const trace: any = {
      type:        'heatmap',
      x:           times,
      y:           frequencies,
      z:           spectrogram_array,
      colorscale:  this.buildColorscale(color),
      zsmooth:     'best',
      showscale:   true,
      colorbar: {
        title:      'dB',
        titleside:  'right',
        thickness:  14,
        len:        0.85,
        tickfont:   { size: 10, color: '#5a7a9a' },
        titlefont:  { size: 11, color: '#5a7a9a' },
      },
      hovertemplate: 'Time: %{x:.3f}s<br>Freq: %{y:.0f}Hz<br>Mag: %{z:.4e}<extra></extra>',
    };

    const layout: any = {
      uirevision: graphId,
      title: { text: `${title} — Spectrogram`, font: { size: 13, color: '#1a2b4a', family: 'JetBrains Mono, monospace' } },
      height: 280,
      margin: { l: 68, r: 70, t: 46, b: 58 },
      xaxis: {
        title: { text: 'Time (s)', font: { size: 11 } },
        gridcolor: '#d0dce8',
        zeroline: false,
        tickfont: { size: 10, color: '#5a7a9a' },
      },
      yaxis: {
        title: { text: 'Frequency (Hz)', font: { size: 11 } },
        gridcolor: '#d0dce8',
        zeroline: false,
        tickfont: { size: 10, color: '#5a7a9a' },
      },
      plot_bgcolor:  '#f0f5fa',
      paper_bgcolor: '#f8fafc',
    };

    Plotly.react(graphId, [trace], layout, {
      responsive:   true,
      displayModeBar: true,
      displaylogo:  false,
      modeBarButtonsToRemove: ['toImage', 'sendDataToCloud'],
    });
  }

  /** Build a two-stop colorscale that fades from near-black to the accent color. */
  private buildColorscale(hex: string): [number, string][] {
    return [
      [0,   '#0a0f1a'],
      [0.3, hex + 'aa'],
      [0.7, hex],
      [1,   '#ffffff'],
    ];
  }

  // ── Validation ─────────────────────────────────────────────────────

  get overlapMax(): number { return Math.max(0, this.windowSize - 1); }

  onWindowSizeChange(val: string): void {
    this.windowSize = parseInt(val, 10);
    if (this.overlap >= this.windowSize) {
      this.overlap = this.windowSize - 1;
    }
    this.onParamsChange();
  }

  onOverlapChange(val: string): void {
    this.overlap = parseInt(val, 10);
    this.onParamsChange();
    console.log("Nice!!")
  }
}