import {
  Component, Input, OnChanges, OnDestroy,
  SimpleChanges, ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';

declare const Plotly: any;

const FFT_ID         = 'gm-fft-graph';
const AUDIOGRAM_ID   = 'gm-audiogram-graph';
const SPECTROGRAM_ID = 'gm-spectrogram-graph';

const BAND_COLORS = [
  '#e74c3c','#f39c12','#9b59b6','#1abc9c',
  '#e67e22','#3498db','#c0392b','#16a085',
];

export type FreqScale = 'linear' | 'audiogram';

@Component({
  selector: 'app-generic-mode-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './generic-mode-panel.component.html',
  styleUrls: ['./generic-mode-panel.component.css'],
})
export class GenericModePanelComponent implements OnChanges, OnDestroy {

  @Input() inputSamples:  any = new Float32Array(0);
  @Input() outputSamples: any = new Float32Array(0);
  @Input() sampleRate = 44100;
  @Input() bands: any[] = [];

  freqScale: FreqScale = 'linear';

  readonly fftId         = FFT_ID;
  readonly audiogramId   = AUDIOGRAM_ID;
  readonly spectrogramId = SPECTROGRAM_ID;

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (
      changes['inputSamples'] ||
      changes['outputSamples'] ||
      changes['sampleRate'] ||
      changes['bands']
    ) {
      setTimeout(() => {
        this.drawFft();
        this.drawAudiogramPlaceholder();
        this.drawSpectrogramPlaceholder();
      }, 0);
    }
  }

  ngOnDestroy(): void {
    [FFT_ID, AUDIOGRAM_ID, SPECTROGRAM_ID].forEach(id => {
      const el = document.getElementById(id);
      if (el) Plotly.purge(el);
    });
  }

  toggleFreqScale(): void {
    this.freqScale = this.freqScale === 'linear' ? 'audiogram' : 'linear';
    this.drawFft();
  }

  // ── FFT ────────────────────────────────────────────────────────────

  drawFft(): void {
    const el = document.getElementById(FFT_ID);
    if (!el || !this.inputSamples?.length) {
      if (el) Plotly.purge(el);
      return;
    }

    const FFT_N   = 4096;
    const half    = FFT_N / 2;
    const nyquist = this.sampleRate / 2;
    const isAudiogram = this.freqScale === 'audiogram';

    const inMag  = this.computeFftDb(this.inputSamples, FFT_N);
    const outMag = this.outputSamples?.length
      ? this.computeFftDb(this.outputSamples, FFT_N)
      : null;

    const freqToX = (f: number) =>
      isAudiogram ? Math.log10(Math.max(f, 1)) : f;

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

    const { x: xIn,  y: yIn  } = buildXY(inMag);
    const { x: xOut, y: yOut } = outMag
      ? buildXY(outMag)
      : { x: [], y: [] };

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

    this.bands.forEach((band: any, i: number) => {
      const c = BAND_COLORS[i % BAND_COLORS.length];
      band.ranges.forEach((r: any) => {
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
      FFT_ID,
      traces,
      {
        uirevision: `fft-${this.freqScale}`,
        title: {
          text: isAudiogram
            ? 'Frequency Domain — Audiogram Scale (100 Hz – 10 kHz)'
            : 'Frequency Domain — Linear Scale',
          font: { size: 13, color: '#1a2b4a' },
        },
        height: 280,
        margin: { l: 60, r: 20, t: 44, b: 55 },
        xaxis: isAudiogram
          ? {
              title: 'Frequency (Hz)', gridcolor: '#e8edf3',
              range: [Math.log10(100), Math.log10(10000)],
              tickmode: 'array',
              tickvals: audiogramTickVals,
              ticktext: audiogramTickText,
            }
          : { title: 'Frequency (Hz)', range: [0, nyquist], gridcolor: '#e8edf3' },
        yaxis: {
          title: 'Magnitude (dB)', range: [-100, 10],
          gridcolor: '#f0f4f8', zeroline: true, zerolinecolor: '#c8d5e2',
        },
        showlegend: true,
        legend: { orientation: 'h', y: -0.22 },
        plot_bgcolor:  '#ffffff',
        paper_bgcolor: '#f8fafc',
      },
      {
        responsive: true, displayModeBar: true, displaylogo: false,
        modeBarButtonsToRemove: ['toImage', 'sendDataToCloud'],
      }
    );
  }

  // ── Audiogram placeholder ──────────────────────────────────────────

  drawAudiogramPlaceholder(): void {
    const el = document.getElementById(AUDIOGRAM_ID);
    if (!el) return;

    const freqs     = [125, 250, 500, 1000, 2000, 4000, 8000];
    const leftEar   = [-10, -5,  0,   5,   20,   35,   45];
    const rightEar  = [-5,  0,   5,   10,  25,   40,   50];

    Plotly.react(
      AUDIOGRAM_ID,
      [
        {
          x: freqs, y: leftEar, type: 'scatter', mode: 'lines+markers',
          name: 'Left Ear (placeholder)',
          line: { color: '#1a73e8', width: 2, dash: 'dot' },
          marker: { symbol: 'x', size: 10, color: '#1a73e8' },
        },
        {
          x: freqs, y: rightEar, type: 'scatter', mode: 'lines+markers',
          name: 'Right Ear (placeholder)',
          line: { color: '#e74c3c', width: 2, dash: 'dot' },
          marker: { symbol: 'circle-open', size: 10, color: '#e74c3c' },
        },
      ],
      {
        title: {
          text: 'Audiogram — Hearing Threshold (placeholder)',
          font: { size: 13, color: '#1a2b4a' },
        },
        height: 280,
        margin: { l: 60, r: 20, t: 44, b: 55 },
        xaxis: {
          title: 'Frequency (Hz)',
          type: 'log',
          tickmode: 'array',
          tickvals: freqs,
          ticktext: ['125', '250', '500', '1k', '2k', '4k', '8k'],
          gridcolor: '#e8edf3',
        },
        yaxis: {
          title: 'Hearing Level (dB HL)',
          range: [80, -20],   // inverted — audiogram convention
          gridcolor: '#f0f4f8',
          zeroline: true, zerolinecolor: '#c8d5e2',
        },
        showlegend: true,
        legend: { orientation: 'h', y: -0.22 },
        plot_bgcolor:  '#ffffff',
        paper_bgcolor: '#f8fafc',
        annotations: [{
          text: 'Placeholder — real audiogram data not yet computed',
          xref: 'paper', yref: 'paper',
          x: 0.5, y: 0.5,
          showarrow: false,
          font: { size: 11, color: '#94a3b8' },
          bgcolor: 'rgba(255,255,255,0.7)',
        }],
      },
      { responsive: true, displayModeBar: false }
    );
  }

  // ── Spectrogram placeholder ────────────────────────────────────────

  drawSpectrogramPlaceholder(): void {
    const el = document.getElementById(SPECTROGRAM_ID);
    if (!el) return;

    // Generate fake noise-like spectrogram data
    const timeSteps = 60;
    const freqBins  = 40;
    const z: number[][] = [];

    for (let f = 0; f < freqBins; f++) {
      const row: number[] = [];
      for (let t = 0; t < timeSteps; t++) {
        // Fake data: low freqs louder, decays with frequency
        const base  = Math.max(0, 80 - f * 1.8);
        const noise = (Math.random() - 0.5) * 15;
        row.push(base + noise);
      }
      z.push(row);
    }

    const nyquist   = this.sampleRate / 2;
    const freqLabels = Array.from({ length: freqBins }, (_, i) =>
      Math.round((i / freqBins) * nyquist)
    );
    const timeLabels = Array.from({ length: timeSteps }, (_, i) =>
      parseFloat((i * 0.1).toFixed(1))
    );

    Plotly.react(
      SPECTROGRAM_ID,
      [
        {
          z,
          x: timeLabels,
          y: freqLabels,
          type: 'heatmap',
          colorscale: 'Viridis',
          colorbar: { title: 'dB', thickness: 14 },
          zmin: 0,
          zmax: 80,
        },
      ],
      {
        title: {
          text: 'Spectrogram (placeholder — not computed from signal)',
          font: { size: 13, color: '#1a2b4a' },
        },
        height: 280,
        margin: { l: 60, r: 70, t: 44, b: 55 },
        xaxis: { title: 'Time (s)', gridcolor: '#e8edf3' },
        yaxis: { title: 'Frequency (Hz)', gridcolor: '#f0f4f8' },
        plot_bgcolor:  '#ffffff',
        paper_bgcolor: '#f8fafc',
        annotations: [{
          text: 'Placeholder — real spectrogram not yet computed',
          xref: 'paper', yref: 'paper',
          x: 0.5, y: 0.5,
          showarrow: false,
          font: { size: 11, color: '#ffffff' },
        }],
      },
      { responsive: true, displayModeBar: false }
    );
  }

  // ── FFT helper ─────────────────────────────────────────────────────

  private computeFftDb(samples: Float32Array, N: number): number[] {
    const half = N / 2;
    const len  = Math.min(N, samples.length);
    const mag  = new Array(half).fill(-100);
    for (let k = 0; k < half; k++) {
      let re = 0, im = 0;
      for (let n = 0; n < len; n++) {
        const w     = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (len - 1)));
        const angle = (2 * Math.PI * k * n) / N;
        re += samples[n] * w * Math.cos(angle);
        im -= samples[n] * w * Math.sin(angle);
      }
      mag[k] = 20 * Math.log10(Math.sqrt(re * re + im * im) / len + 1e-10);
    }
    return mag;
  }
}