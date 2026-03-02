import { Component, OnInit } from '@angular/core';
import { SignalViewerComponent, SignalData, SignalViewerConfig } from './signal-viewer/signal-viewer.component';

interface TransformPanel {
  id: string; title: string; xLabel: string; yLabel: string;
  description: string; signals: SignalData[];
  config: SignalViewerConfig; height: number;
  expanded: boolean; selected: boolean;
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent implements OnInit {

  activePanel = 'time';
  signalSource: 'preset' | 'file' = 'preset';
  uploadedFileName = '';
  currentPreset = 'multi';
  globalSampleRate = 1000;
  globalDuration = 1.0;
  noiseLevel = 0.05;

  private uploadedRawData: number[] = [];
  private uploadedSR = 1000;

  presets = [
    { id: 'multi', label: 'Multi' }, { id: 'sine', label: 'Sine' },
    { id: 'square', label: 'Square' }, { id: 'ecg', label: 'ECG' },
    { id: 'chirp', label: 'Chirp' }, { id: 'noise', label: 'Noise' },
  ];

  panelIcons: { [k: string]: string } = {
    time: '⏱', fourier: '〜', laplace: 'ℒ', z: 'ℤ', wavelet: '≈'
  };

  panels: TransformPanel[] = [];

  get allSelected() { return this.panels.every(p => p.selected); }
  get selectedCount() { return this.panels.filter(p => p.selected).length; }

  ngOnInit() { this.initPanels(); this.loadPreset('multi'); }

  initPanels() {
    const mk = (id: string, title: string, xl: string, yl: string, desc: string): TransformPanel => ({
      id, title, xLabel: xl, yLabel: yl, description: desc, signals: [],
      config: { showLegend: true, showGrid: true, xLabel: xl, yLabel: yl },
      height: 280, expanded: false, selected: true,
    });
    this.panels = [
      mk('time', 'Time Domain', 'Time (s)', 'Amplitude', 'Raw signal — x(t)'),
      mk('fourier', 'Fourier Transform (FFT)', 'Frequency (Hz)', '|X(f)|', 'DFT — X(f) = ∫ x(t)·e^(-j2πft) dt'),
      mk('laplace', 'Laplace Transform', 'ω (rad/s)', '|X(s)|', 'X(s) = ∫ x(t)·e^(-st) dt, on jω axis'),
      mk('z', 'Z-Transform', 'Norm. Freq (ω/π)', '|X(z)|', 'X(z) = Σ x[n]·z^(-n), unit circle'),
      mk('wavelet', 'Wavelet Transform', 'Time index', 'Coeff.', 'W(a,b) = ∫ x(t)·ψ*((t-b)/a) dt'),
    ];
  }

  // ── fit callback (passed as [onFit] input) ──────────────────────
  getFitFn(panel: TransformPanel): () => void {
    return () => this.fitPanel(panel);
  }

  fitPanel(panel: TransformPanel) {
    panel.expanded = !panel.expanded;
    panel.height = panel.expanded ? 520 : 280;
  }

  // ── selection ───────────────────────────────────────────────────
  toggleSelectAll() {
    const v = !this.allSelected;
    this.panels.forEach(p => p.selected = v);
    this.regenerateSignals();
  }

  onDomainToggle(_: TransformPanel) { this.regenerateSignals(); }

  selectPanel(id: string) {
    this.activePanel = id;
    document.getElementById('panel_' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── file upload ─────────────────────────────────────────────────
  onFileUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];
    this.uploadedFileName = file.name;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) || '';
      const parsed = this.parseFile(text);
      if (parsed.data.length > 0) {
        this.uploadedRawData = parsed.data;
        this.uploadedSR = parsed.sr;
        this.signalSource = 'file';
        this.globalSampleRate = parsed.sr;
        this.globalDuration = parseFloat((parsed.data.length / parsed.sr).toFixed(3));
        this.regenerateSignals();
      }
    };
    reader.readAsText(file);
    input.value = '';
  }

  private parseFile(text: string): { data: number[]; sr: number } {
    let sr = this.globalSampleRate;
    let data: number[] = [];

    // JSON array
    if (text.trim().startsWith('[')) {
      try {
        const arr = JSON.parse(text.trim());
        if (Array.isArray(arr)) {
          if (arr.length > 0 && Array.isArray(arr[0])) {
            data = arr.map((r: number[]) => r[r.length - 1]);
            if (arr.length > 1 && arr[1][0] - arr[0][0] > 0)
              sr = Math.round(1 / (arr[1][0] - arr[0][0]));
          } else {
            data = arr.map(Number).filter((v: number) => !isNaN(v));
          }
        }
      } catch { }
    }

    // CSV / TXT
    if (data.length === 0) {
      const lines = text.split(/[\r\n]+/).map(l => l.trim()).filter(l => l);
      const vals: number[] = [];
      let dtSum = 0, dtN = 0, tPrev: number | null = null;

      for (const line of lines) {
        // SR header
        const m = line.match(/(?:sample.?rate|fs|sr)\s*[=:]\s*([\d.]+)/i);
        if (m) { sr = parseFloat(m[1]); continue; }
        if (/^[#%\/;]/.test(line)) continue;

        const cols = line.split(/[,\t ]+/).map(Number).filter(v => !isNaN(v));
        if (!cols.length) continue;

        if (cols.length >= 2) {
          const t = cols[0], v = cols[cols.length - 1];
          if (tPrev !== null && t - tPrev > 0) { dtSum += t - tPrev; dtN++; }
          tPrev = t; vals.push(v);
        } else {
          vals.push(cols[0]);
        }
      }
      if (dtN > 0) sr = Math.round(1 / (dtSum / dtN));
      data = vals;
    }

    return { data, sr: sr > 0 ? sr : 1000 };
  }

  // ── presets ─────────────────────────────────────────────────────
  loadPreset(id: string) {
    this.currentPreset = id; this.signalSource = 'preset'; this.uploadedFileName = '';
    this.regenerateSignals();
  }

  // ── regenerate ──────────────────────────────────────────────────
  regenerateSignals() {
    const N = Math.round(this.globalSampleRate * this.globalDuration);
    const sr = this.globalSampleRate;

    let raw: SignalData[];
    if (this.signalSource === 'file' && this.uploadedRawData.length > 0) {
      raw = [{
        id: 'up', label: this.uploadedFileName || 'Signal',
        color: '#44aaff', thickness: 1.5, visible: true, yScale: 1,
        data: [...this.uploadedRawData], sampleRate: this.uploadedSR,
      }];
    } else {
      raw = this.genRaw(N, sr);
    }

    const useSR = this.signalSource === 'file' ? this.uploadedSR : sr;

    this.panels.forEach((p, i) => {
      if (!p.selected) { p.signals = []; return; }
      switch (i) {
        case 0: p.signals = raw.map(s => ({ ...s, sampleRate: useSR })); break;
        case 1: p.signals = raw.map(s => { const r = this.fft(s.data, useSR); return { ...s, id: s.id + '_f', label: s.label + ' |FFT|', data: r.mag, sampleRate: r.df }; }); break;
        case 2: p.signals = raw.map(s => { const r = this.lap(s.data, useSR); return { ...s, id: s.id + '_l', label: s.label + ' ℒ', data: r.mag, sampleRate: r.df }; }); break;
        case 3: p.signals = raw.map(s => { const r = this.dtft(s.data); return { ...s, id: s.id + '_z', label: s.label + ' Z', data: r, sampleRate: r.length / 2 }; }); break;
        case 4: p.signals = raw.map((s, j) => { const r = this.cwt(s.data, j); return { ...s, id: s.id + '_w', label: s.label + ' WT', data: r, sampleRate: useSR / 4 }; }); break;
      }
    });
  }

  // ── signal gen ──────────────────────────────────────────────────
  private genRaw(N: number, sr: number): SignalData[] {
    const t = Array.from({ length: N }, (_, i) => i / sr);
    const C = ['#44aaff', '#ff7744', '#44ff99', '#ff44aa', '#aaff44'];
    const n = (a: number[]) => a.map(v => v + (Math.random() * 2 - 1) * this.noiseLevel);
    switch (this.currentPreset) {
      case 'sine': return [{ id: 's1', label: '50Hz', color: C[0], thickness: 1.5, visible: true, yScale: 1, data: n(t.map(x => Math.sin(2 * Math.PI * 50 * x))) }];
      case 'square': return [{ id: 's1', label: 'Square', color: C[0], thickness: 1.5, visible: true, yScale: 1, data: n(t.map(x => Math.sign(Math.sin(2 * Math.PI * 50 * x)))) }];
      case 'ecg': return [{ id: 's1', label: 'ECG', color: '#ff7744', thickness: 1.5, visible: true, yScale: 1, data: n(this.ecg(t)) }];
      case 'chirp': return [{ id: 's1', label: 'Chirp', color: C[2], thickness: 1.5, visible: true, yScale: 1, data: n(t.map(x => Math.sin(2 * Math.PI * (10 + 200 * x / this.globalDuration) * x))) }];
      case 'noise': return [{ id: 's1', label: 'Noise', color: C[4], thickness: 1, visible: true, yScale: 1, data: t.map(() => Math.random() * 2 - 1) }];
      default: return [
        { id: 's1', label: '10Hz', color: C[0], thickness: 1.5, visible: true, yScale: 1, data: n(t.map(x => .8 * Math.sin(2 * Math.PI * 10 * x))) },
        { id: 's2', label: '50Hz', color: C[1], thickness: 1.5, visible: true, yScale: 1, data: n(t.map(x => .5 * Math.sin(2 * Math.PI * 50 * x))) },
        { id: 's3', label: '120Hz', color: C[2], thickness: 1.2, visible: true, yScale: 1, data: n(t.map(x => .3 * Math.sin(2 * Math.PI * 120 * x))) },
      ];
    }
  }

  private ecg(t: number[]): number[] {
    return t.map(x => {
      const ph = x % 1;
      return .15 * Math.exp(-.5 * ((ph - .10) / .040) ** 2) - .10 * Math.exp(-.5 * ((ph - .22) / .010) ** 2)
        + 1.0 * Math.exp(-.5 * ((ph - .25) / .008) ** 2) - .20 * Math.exp(-.5 * ((ph - .28) / .010) ** 2)
        + .30 * Math.exp(-.5 * ((ph - .45) / .050) ** 2);
    });
  }

  // ── transforms (Member C replaces) ──────────────────────────────
  private fft(d: number[], sr: number): { mag: number[]; df: number } {
    const N = Math.min(d.length, 2048), h = N >> 1, m: number[] = [];
    for (let k = 0; k < h; k++) { let re = 0, im = 0; for (let n = 0; n < N; n++) { const a = -2 * Math.PI * k * n / N; re += d[n] * Math.cos(a); im += d[n] * Math.sin(a); } m.push(Math.sqrt(re * re + im * im) / N); }
    return { mag: m, df: sr / N };
  }
  private lap(d: number[], sr: number): { mag: number[]; df: number } {
    const N = Math.min(d.length, 512), h = N >> 1, s = 1.5, m: number[] = [];
    for (let k = 0; k < h; k++) { let re = 0, im = 0; for (let n = 0; n < N; n++) { const dc = Math.exp(-s * n / sr), a = -2 * Math.PI * k * n / N; re += d[n] * dc * Math.cos(a); im += d[n] * dc * Math.sin(a); } m.push(Math.sqrt(re * re + im * im) / N); }
    return { mag: m, df: sr / N };
  }
  private dtft(d: number[]): number[] {
    const M = 256, N = Math.min(d.length, 256), m: number[] = [];
    for (let k = 0; k < M; k++) { const w = Math.PI * k / M; let re = 0, im = 0; for (let n = 0; n < N; n++) { re += d[n] * Math.cos(-w * n); im += d[n] * Math.sin(-w * n); } m.push(Math.sqrt(re * re + im * im) / N); }
    return m;
  }
  private cwt(d: number[], idx: number): number[] {
    const sc = 6 + idx * 3, N = Math.min(d.length, 512), r: number[] = [];
    for (let b = 0; b < Math.floor(N / 4); b++) { const c = b * 4, hw = Math.round(3 * sc); let re = 0, im = 0; for (let dt = -hw; dt <= hw; dt++) { const n = c + dt; if (n < 0 || n >= N) continue; const u = dt / sc, g = Math.exp(-.5 * u * u); re += d[n] * g * Math.cos(5 * u); im += d[n] * g * Math.sin(5 * u); } r.push(Math.sqrt(re * re + im * im) / Math.sqrt(sc)); }
    return r;
  }
}
