import {
  Component, Input, AfterViewInit, OnChanges,
  ViewChild, ElementRef, ChangeDetectorRef,
  SimpleChanges, OnDestroy, NgZone,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface SignalData {
  id: string; label: string; data: number[];
  sampleRate?: number; color?: string; thickness?: number;
  visible?: boolean; opacity?: number; yOffset?: number; yScale?: number;
}
export interface SignalViewerConfig {
  xLabel?: string; yLabel?: string; showGrid?: boolean; showLegend?: boolean;
  textColor?: string; gridColor?: string;
}

@Component({
  selector: 'app-signal-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
<div class="sv">

  <!-- ── Playback Bar ── -->
  <div class="sv-pb">
    <button class="pb-play" (click)="togglePlay()" [class.active]="playing">
      <span>{{playing ? '⏸' : '▶'}}</span>
    </button>
    <button class="pb-stop" (click)="stopPlay()" title="Stop & Reset">⏹</button>

    <!-- seek track -->
    <div class="pb-track" (click)="seek($event)">
      <div class="pb-fill" [style.width.%]="pct"></div>
      <div class="pb-thumb" [style.left.%]="pct"></div>
    </div>

    <span class="pb-time">{{ playHead | number:'1.1-1' }}s / {{ totalDur | number:'1.1-1' }}s</span>

    <label class="pb-field">
      Speed
      <select [(ngModel)]="speed">
        <option [value]="0.25">0.25×</option>
        <option [value]="0.5">0.5×</option>
        <option [value]="1">1×</option>
        <option [value]="2">2×</option>
        <option [value]="4">4×</option>
      </select>
    </label>

    <label class="pb-field">
      Window
      <input type="range" min="0.5" max="30" step="0.25"
        [(ngModel)]="winSec" (ngModelChange)="redraw()" />
      <b>{{ winSec | number:'1.1-1' }}s</b>
    </label>

    <label class="pb-check">
      <input type="checkbox" [(ngModel)]="loop" /> Loop
    </label>
  </div>

  <!-- ── Toolbar ── -->
  <div class="sv-tb">
    <button class="tb" (click)="resetView()" title="Reset">↺</button>
    <button class="tb" (click)="yZoomIn()"   title="+Y">+Y</button>
    <button class="tb" (click)="yZoomOut()"  title="-Y">-Y</button>
    <button class="tb" (click)="toggleGrid()" title="Grid">⊟</button>
    <button class="tb expand" (click)="emitFit()" title="Expand">⤢</button>
    <span class="tb-hint">SCROLL=X-zoom · SHIFT+SCROLL=Y-zoom · DRAG=pan</span>
  </div>

  <!-- ── Canvas ── -->
  <div class="sv-canvas-wrap" #wrap>
    <canvas #cv
      (mousedown)="mDown($event)"
      (mousemove)="mMove($event)"
      (mouseup)="mUp()"
      (mouseleave)="mLeave()"
      (wheel)="mWheel($event)"
      (dblclick)="resetView()">
    </canvas>
    <!-- crosshair tooltip -->
    <div class="sv-tip" *ngIf="tip"
      [style.left.px]="tip.px + 14"
      [style.top.px]="tip.py - 50">
      <span class="tip-t">t = {{ tip.t | number:'1.3-3' }} s</span>
      <span class="tip-y">y = {{ tip.y | number:'1.4-4' }}</span>
    </div>
  </div>

  <!-- ── Signal Controls ── -->
  <div class="sv-ctrls" *ngIf="signals?.length">
    <div class="ctrls-hdr">
      <span class="ctrls-title">Signal Controls</span>
    </div>
    <div class="sig-row" *ngFor="let s of signals">
      <label class="sig-vis" [style.--clr]="s.color || '#44aaff'">
        <input type="checkbox" [checked]="s.visible !== false" (change)="toggleVis(s)" />
        <span class="sig-dot"></span>
        <span class="sig-lbl">{{ s.label }}</span>
      </label>
      <div class="sig-props">
        <div class="prop">
          <span>Color</span>
          <input type="color" [value]="s.color || '#44aaff'"
            (input)="setColor(s, $event)" />
        </div>
        <div class="prop">
          <span>Line {{ s.thickness || 1.5 | number:'1.1-1' }}</span>
          <input type="range" min="0.5" max="6" step="0.5"
            [value]="s.thickness || 1.5"
            (input)="setNum(s, 'thickness', $event)" />
        </div>
        <div class="prop">
          <span>Amp {{ s.yScale || 1 | number:'1.1-1' }}×</span>
          <input type="range" min="0.1" max="10" step="0.1"
            [value]="s.yScale || 1"
            (input)="setNum(s, 'yScale', $event)" />
        </div>
        <div class="prop">
          <span>Offset {{ s.yOffset || 0 | number:'1.1-1' }}</span>
          <input type="range" min="-5" max="5" step="0.1"
            [value]="s.yOffset || 0"
            (input)="setNum(s, 'yOffset', $event)" />
        </div>
        <div class="prop">
          <span>Alpha {{ (s.opacity ?? 1) | number:'1.2-2' }}</span>
          <input type="range" min="0.05" max="1" step="0.05"
            [value]="s.opacity ?? 1"
            (input)="setNum(s, 'opacity', $event)" />
        </div>
      </div>
    </div>
  </div>

</div>
  `,
  styles: [`
:host { display:block; font-family:'JetBrains Mono',monospace; }
.sv   { display:flex; flex-direction:column; background:#060a0f; }

/* ── Playback bar ── */
.sv-pb {
  display:flex; align-items:center; gap:8px; padding:7px 14px;
  background:#0c1220; border-bottom:1px solid #1a2840; flex-wrap:wrap;
}
.pb-play {
  width:34px; height:34px; border-radius:50%; border:2px solid #1d4ed8;
  background:#0f172a; color:#60a5fa; cursor:pointer; font-size:14px;
  display:flex; align-items:center; justify-content:center; flex-shrink:0;
  transition:all .2s;
}
.pb-play.active { background:#1d4ed8; color:#fff; border-color:#3b82f6; }
.pb-play:hover  { background:#1e3a8a; }

.pb-stop {
  width:28px; height:28px; border-radius:4px; border:1px solid #1e293b;
  background:#0f172a; color:#64748b; cursor:pointer; font-size:11px;
  display:flex; align-items:center; justify-content:center; flex-shrink:0;
  transition:all .15s;
}
.pb-stop:hover { background:#1e293b; color:#94a3b8; }

.pb-track {
  flex:1; min-width:80px; height:5px; background:#1e293b;
  border-radius:3px; position:relative; cursor:pointer;
}
.pb-fill {
  height:100%; background:linear-gradient(90deg,#2563eb,#0ea5e9);
  border-radius:3px; pointer-events:none;
}
.pb-thumb {
  position:absolute; top:50%; width:13px; height:13px; background:#fff;
  border-radius:50%; transform:translate(-50%,-50%); pointer-events:none;
  box-shadow:0 0 8px #2563eb99;
}

.pb-time { font-size:10px; color:#64748b; white-space:nowrap; }

.pb-field {
  display:flex; align-items:center; gap:5px;
  font-size:9px; color:#475569; cursor:default;
}
.pb-field select {
  background:#0f172a; border:1px solid #1e293b; color:#94a3b8;
  border-radius:3px; padding:2px 5px; font-size:9px;
  font-family:inherit; cursor:pointer;
}
.pb-field input[type=range] { width:70px; accent-color:#2563eb; cursor:pointer; }
.pb-field b { color:#38bdf8; font-weight:400; }

.pb-check {
  display:flex; align-items:center; gap:4px;
  font-size:9px; color:#475569; cursor:pointer;
}
.pb-check input { accent-color:#2563eb; }

/* ── Toolbar ── */
.sv-tb {
  display:flex; align-items:center; gap:4px; padding:4px 10px;
  background:#060a0f; border-bottom:1px solid #111827;
}
.tb {
  background:#0f172a; border:1px solid #1e293b; color:#475569;
  padding:3px 8px; height:24px; border-radius:3px; cursor:pointer;
  font-size:10px; font-family:inherit; transition:all .15s;
  display:flex; align-items:center;
}
.tb:hover { color:#e2e8f0; background:#1e293b; }
.tb.expand { border-color:#1e4080; color:#3b82f6; }
.tb.expand:hover { background:#1e2f5e; color:#60a5fa; }
.tb-hint { font-size:9px; color:#1e293b; margin-left:4px; }

/* ── Canvas ── */
.sv-canvas-wrap { position:relative; overflow:hidden; }
canvas { display:block; cursor:crosshair; width:100%; }

.sv-tip {
  position:absolute; background:#0c1220ee; border:1px solid #2563eb44;
  padding:5px 10px; border-radius:5px; color:#e2e8f0; font-size:10px;
  pointer-events:none; display:flex; flex-direction:column; gap:3px;
  white-space:nowrap; z-index:20; backdrop-filter:blur(4px);
}
.tip-t { color:#60a5fa; }
.tip-y { color:#34d399; }

/* ── Signal Controls ── */
.sv-ctrls {
  padding:10px 14px; border-top:1px solid #111827;
  background:#060a0f; max-height:240px; overflow-y:auto;
}
.sv-ctrls::-webkit-scrollbar { width:3px; }
.sv-ctrls::-webkit-scrollbar-thumb { background:#1e293b; border-radius:2px; }

.ctrls-hdr { margin-bottom:8px; }
.ctrls-title { font-size:9px; color:#334155; text-transform:uppercase; letter-spacing:1.5px; }

.sig-row {
  display:flex; align-items:center; gap:12px;
  padding:6px 0; border-bottom:1px solid #0c1220; flex-wrap:wrap;
}
.sig-row:last-child { border-bottom:none; }

.sig-vis {
  display:flex; align-items:center; gap:8px;
  min-width:130px; cursor:pointer;
}
.sig-vis input[type=checkbox] { display:none; }
.sig-dot {
  width:10px; height:10px; border-radius:50%;
  background:var(--clr, #44aaff); flex-shrink:0;
  transition:transform .15s, opacity .15s;
}
.sig-vis input:not(:checked) ~ .sig-dot { opacity:.3; transform:scale(.7); }
.sig-lbl { font-size:11px; color:#94a3b8; }

.sig-props { display:flex; gap:10px; flex-wrap:wrap; flex:1; }
.prop { display:flex; flex-direction:column; gap:3px; min-width:80px; }
.prop span { font-size:9px; color:#334155; }
.prop input[type=range] { accent-color:#2563eb; width:100%; cursor:pointer; }
.prop input[type=color]  { width:30px; height:20px; border:none; background:none; cursor:pointer; padding:0; border-radius:3px; }
  `]
})
export class SignalViewerComponent implements AfterViewInit, OnChanges, OnDestroy {

  @Input() signals: SignalData[] = [];
  @Input() config: SignalViewerConfig = {};
  @Input() height: number = 280;
  @Input() onFit!: () => void;

  @ViewChild('cv') cvRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('wrap') wrapRef!: ElementRef<HTMLDivElement>;

  private ctx!: CanvasRenderingContext2D;
  private rafId = 0;
  private ro!: ResizeObserver;

  // view state
  private panX = 0;    // manual pan in seconds
  private panY = 0;    // manual pan in normalized Y
  private zoomY = 1;
  private gridOn = true;
  private dragging = false; private dX = 0; private dY = 0;

  // playback
  playing = false;
  playHead = 0;     // seconds
  totalDur = 0;
  speed = 1;
  winSec = 5;
  loop = false;
  private ticker: any = null;

  get pct() { return this.totalDur > 0 ? (this.playHead / this.totalDur) * 100 : 0; }

  tip: { px: number; py: number; t: number; y: number } | null = null;

  // canvas margins
  private readonly ML = 72; private readonly MR = 16;
  private readonly MT = 20; private readonly MB = 42;

  constructor(private cdr: ChangeDetectorRef, private zone: NgZone) { }

  // ── Lifecycle ─────────────────────────────────────────────────────

  ngAfterViewInit() {
    this.setup();
    this.zone.runOutsideAngular(() => {
      this.ro = new ResizeObserver(() => { this.setup(); this.redraw(); });
      this.ro.observe(this.wrapRef.nativeElement);
    });
    this.redraw();
  }

  ngOnChanges(ch: SimpleChanges) {
    const dur = this.calcDur();
    if (ch['signals']) {
      this.totalDur = dur;
      if (!this.playing) {
        // reset view when new signals loaded
        this.playHead = 0;
        this.panX = 0;
      }
      // auto-set window: show full signal if short, else 10s
      if (ch['signals'].firstChange || !this.playing) {
        this.winSec = Math.min(Math.max(dur, 1), 10);
      }
    }
    if (ch['height'] && this.ctx) this.setup();
    if (this.ctx) this.redraw();
  }

  ngOnDestroy() {
    this.ro?.disconnect();
    cancelAnimationFrame(this.rafId);
    this.killTicker();
  }

  // ── Canvas Setup ──────────────────────────────────────────────────

  private setup() {
    const w = this.wrapRef?.nativeElement;
    const c = this.cvRef?.nativeElement;
    if (!w || !c) return;
    const dpr = window.devicePixelRatio || 1;
    const W = w.clientWidth || 800;
    const H = this.height;
    c.style.width = W + 'px';
    c.style.height = H + 'px';
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    this.ctx = c.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
  }

  // ── Render ────────────────────────────────────────────────────────

  redraw() {
    cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(() => this.render());
  }

  private render() {
    const cv = this.cvRef?.nativeElement;
    if (!cv || !this.ctx) return;

    const W = cv.clientWidth, H = cv.clientHeight;
    const { ML, MR, MT, MB } = this;
    const pW = W - ML - MR, pH = H - MT - MB;
    const ctx = this.ctx;

    // Background
    ctx.fillStyle = '#060a0f';
    ctx.fillRect(0, 0, W, H);
    if (pW <= 0 || pH <= 0) return;

    // Visible signals
    const vis = (this.signals || []).filter(s => s.visible !== false && s.data?.length > 0);

    if (!vis.length) {
      ctx.fillStyle = '#1e293b';
      ctx.font = '12px JetBrains Mono,monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No signal — select a domain or upload a file', W / 2, H / 2);
      return;
    }

    // ── Y range ──
    let yMin = Infinity, yMax = -Infinity;
    for (const s of vis) {
      const sc = s.yScale || 1, off = s.yOffset || 0;
      for (const v of s.data) {
        const y = v * sc + off;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
    if (!isFinite(yMin)) { yMin = -1; yMax = 1; }
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    const yR = yMax - yMin;
    const yPad = yR * 0.1;
    yMin -= yPad; yMax += yPad;

    // ── X window ──
    const winDur = this.winSec;
    let autoWinL: number;
    if (this.playing) {
      // During play: playhead sits at ~15% from left — signal scrolls left
      autoWinL = Math.max(0, this.playHead - winDur * 0.15);
    } else {
      // Stopped/paused: show from start (or pan offset) so full signal visible
      autoWinL = Math.max(0, this.panX);
    }
    const winL = autoWinL + (this.playing ? this.panX : 0);
    const winR = winL + winDur;

    const x2c = (t: number) => ML + ((t - winL) / winDur) * pW;
    const y2c = (y: number) => {
      const norm = (y - yMin) / (yMax - yMin);
      const shifted = norm + this.panY;
      const zoomed = (shifted - 0.5) * this.zoomY + 0.5;
      return MT + pH - zoomed * pH;
    };

    // ── Clip ──
    ctx.save();
    ctx.beginPath();
    ctx.rect(ML, MT, pW, pH);
    ctx.clip();

    // ── Grid ──
    if (this.gridOn) {
      ctx.strokeStyle = '#0f1e30';
      ctx.lineWidth = 1;
      for (const xt of nTicks(winL, winR, 8)) {
        const cx = x2c(xt);
        if (cx < ML || cx > ML + pW) continue;
        ctx.beginPath(); ctx.moveTo(cx, MT); ctx.lineTo(cx, MT + pH); ctx.stroke();
      }
      for (const yt of nTicks(yMin, yMax, 6)) {
        const cy = y2c(yt);
        if (cy < MT || cy > MT + pH) continue;
        ctx.beginPath(); ctx.moveTo(ML, cy); ctx.lineTo(ML + pW, cy); ctx.stroke();
      }
    }

    // ── Draw signals ──
    // playing  → reveal progressively up to playHead (oscilloscope animation)
    // stopped  → show full signal so user can inspect it
    for (const s of vis) {
      const sr = s.sampleRate || 1;
      const sc = s.yScale || 1;
      const off = s.yOffset || 0;

      const maxI = this.playing
        ? Math.floor(this.playHead * sr)  // only revealed samples
        : s.data.length - 1;              // all samples when not playing
      const iStart = Math.max(0, Math.floor((winL - 0.5) * sr));
      const iEnd = Math.min(maxI, Math.ceil((winR + 0.5) * sr));

      if (iStart > iEnd) continue;

      ctx.save();
      ctx.globalAlpha = s.opacity ?? 1;
      ctx.strokeStyle = s.color || '#44aaff';
      ctx.lineWidth = s.thickness || 1.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();

      let started = false;
      for (let i = iStart; i <= iEnd; i++) {
        const cx = x2c(i / sr);
        const cy = y2c(s.data[i] * sc + off);
        if (!started) { ctx.moveTo(cx, cy); started = true; }
        else ctx.lineTo(cx, cy);
      }
      ctx.stroke();
      ctx.restore();
    }

    // ── Playhead vertical line ──
    const phX = x2c(this.playHead);
    if (phX >= ML && phX <= ML + pW) {
      // glow
      ctx.save();
      ctx.shadowColor = '#f97316';
      ctx.shadowBlur = 8;
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(phX, MT); ctx.lineTo(phX, MT + pH); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // time label above playhead
      ctx.fillStyle = '#f97316';
      ctx.font = '9px JetBrains Mono,monospace';
      ctx.textAlign = 'center';
      ctx.fillText(nFmt(this.playHead) + 's', phX, MT - 5);
    }

    ctx.restore(); // end clip

    // ── Y axis ──
    ctx.font = '10px JetBrains Mono,monospace';
    ctx.fillStyle = '#334155'; ctx.textAlign = 'right';
    for (const yt of nTicks(yMin, yMax, 6)) {
      const cy = y2c(yt);
      if (cy < MT - 2 || cy > MT + pH + 2) continue;
      ctx.fillText(nFmt(yt), ML - 6, cy + 3.5);
      ctx.strokeStyle = '#111827'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ML - 3, cy); ctx.lineTo(ML, cy); ctx.stroke();
    }

    // ── X axis ──
    ctx.fillStyle = '#334155'; ctx.textAlign = 'center';
    for (const xt of nTicks(winL, winR, 8)) {
      const cx = x2c(xt);
      if (cx < ML - 2 || cx > ML + pW + 2) continue;
      ctx.fillText(nFmt(xt), cx, MT + pH + 17);
      ctx.strokeStyle = '#111827'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, MT + pH); ctx.lineTo(cx, MT + pH + 4); ctx.stroke();
    }

    // ── Axis border ──
    ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ML, MT); ctx.lineTo(ML, MT + pH); ctx.lineTo(ML + pW, MT + pH);
    ctx.stroke();

    // ── Labels ──
    ctx.fillStyle = '#334155'; ctx.textAlign = 'center';
    ctx.font = '10px JetBrains Mono,monospace';
    ctx.fillText(this.config?.xLabel || 'Time (s)', ML + pW / 2, H - 6);
    ctx.save();
    ctx.translate(14, MT + pH / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText(this.config?.yLabel || 'Amplitude', 0, 0);
    ctx.restore();

    // ── Legend ──
    let lY = MT + 8;
    for (const s of vis) {
      ctx.strokeStyle = s.color || '#44aaff';
      ctx.lineWidth = s.thickness || 1.5;
      ctx.beginPath(); ctx.moveTo(ML + 6, lY + 5); ctx.lineTo(ML + 24, lY + 5); ctx.stroke();
      ctx.fillStyle = '#94a3b8'; ctx.font = '9px JetBrains Mono,monospace';
      ctx.textAlign = 'left';
      ctx.fillText(s.label, ML + 28, lY + 9);
      lY += 15;
    }
  }

  // ── Playback ──────────────────────────────────────────────────────

  private calcDur() {
    const v = (this.signals || []).filter(s => s.data?.length > 0);
    return v.length ? Math.max(...v.map(s => s.data.length / (s.sampleRate || 1))) : 0;
  }

  togglePlay() {
    if (this.playing) {
      this.killTicker(); this.playing = false; return;
    }
    if (this.playHead >= this.totalDur) { this.playHead = 0; this.panX = 0; }
    this.playing = true;

    // Use RAF loop for smooth animation
    const step = 1 / 60; // 60fps target
    let last = performance.now();

    this.zone.runOutsideAngular(() => {
      const tick = (now: number) => {
        if (!this.playing) return;
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        this.playHead = Math.min(this.playHead + dt * this.speed, this.totalDur);
        this.render(); // direct call — no RAF wrapping inside RAF
        this.zone.run(() => this.cdr.detectChanges());

        if (this.playHead >= this.totalDur) {
          if (this.loop) {
            this.playHead = 0; this.panX = 0;
          } else {
            this.zone.run(() => { this.playing = false; this.cdr.detectChanges(); });
            return;
          }
        }
        this.ticker = requestAnimationFrame(tick);
      };
      this.ticker = requestAnimationFrame(tick);
    });
  }

  stopPlay() {
    this.killTicker();
    this.playing = false;
    this.playHead = 0;
    this.panX = 0;
    this.redraw();
  }

  private killTicker() {
    if (this.ticker) { cancelAnimationFrame(this.ticker); this.ticker = null; }
  }

  seek(e: MouseEvent) {
    const bar = e.currentTarget as HTMLElement;
    this.playHead = clamp((e.offsetX / bar.clientWidth) * this.totalDur, 0, this.totalDur);
    this.panX = 0;
    this.redraw(); this.cdr.detectChanges();
  }

  // ── Mouse ─────────────────────────────────────────────────────────

  mDown(e: MouseEvent) { this.dragging = true; this.dX = e.offsetX; this.dY = e.offsetY; }
  mUp() { this.dragging = false; }
  mLeave() { this.dragging = false; this.tip = null; }

  mMove(e: MouseEvent) {
    if (this.dragging) {
      const pW = this.cvRef.nativeElement.clientWidth - this.ML - this.MR;
      const pH = this.cvRef.nativeElement.clientHeight - this.MT - this.MB;
      this.panX -= (e.offsetX - this.dX) / pW * this.winSec;
      this.panY -= (e.offsetY - this.dY) / pH;
      this.dX = e.offsetX; this.dY = e.offsetY;
      this.redraw();
    } else {
      this.updateTip(e);
    }
  }

  mWheel(e: WheelEvent) {
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    if (e.shiftKey) {
      this.zoomY = clamp(this.zoomY * f, 0.1, 50);
    } else {
      this.winSec = clamp(this.winSec / f, 0.2, this.totalDur || 60);
    }
    this.redraw();
  }

  private updateTip(e: MouseEvent) {
    const cv = this.cvRef.nativeElement;
    const { ML, MR, MT, MB } = this;
    const pW = cv.clientWidth - ML - MR, pH = cv.clientHeight - MT - MB;
    if (e.offsetX < ML || e.offsetX > ML + pW || e.offsetY < MT || e.offsetY > MT + pH) {
      this.tip = null; return;
    }
    const vis = (this.signals || []).filter(s => s.visible !== false && s.data?.length > 0);
    if (!vis.length) { this.tip = null; return; }

    let yMin = Infinity, yMax = -Infinity;
    for (const s of vis) {
      const sc = s.yScale || 1, off = s.yOffset || 0;
      for (const v of s.data) { const t = v * sc + off; if (t < yMin) yMin = t; if (t > yMax) yMax = t; }
    }
    if (!isFinite(yMin)) { yMin = -1; yMax = 1; }
    const yPad = (yMax - yMin) * 0.1; yMin -= yPad; yMax += yPad;

    const autoWinL = Math.max(0, this.playHead - this.winSec * 0.15);
    const winL = autoWinL + this.panX;
    const relX = (e.offsetX - ML) / pW;
    const relY = (e.offsetY - MT) / pH;
    const norm = (1 - relY) / this.zoomY - this.panY;
    const yVal = (norm - 0.5 + 0.5) * (yMax - yMin) + yMin;

    this.tip = { px: e.offsetX, py: e.offsetY, t: winL + relX * this.winSec, y: yVal };
  }

  // ── View controls ─────────────────────────────────────────────────

  resetView() { this.panX = 0; this.panY = 0; this.zoomY = 1; this.redraw(); }
  yZoomIn() { this.zoomY = clamp(this.zoomY * 1.3, 0.1, 50); this.redraw(); }
  yZoomOut() { this.zoomY = clamp(this.zoomY / 1.3, 0.1, 50); this.redraw(); }
  toggleGrid() { this.gridOn = !this.gridOn; this.redraw(); }
  emitFit() { if (this.onFit) this.onFit(); }

  // ── Signal Controls ───────────────────────────────────────────────

  toggleVis(s: SignalData) {
    s.visible = s.visible === false ? true : false;
    this.redraw();
  }

  setColor(s: SignalData, e: Event) {
    s.color = (e.target as HTMLInputElement).value;
    this.redraw();
  }

  setNum(s: SignalData, key: keyof SignalData, e: Event) {
    (s as any)[key] = +(e.target as HTMLInputElement).value;
    this.redraw();
    this.cdr.detectChanges();
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function nTicks(min: number, max: number, count: number): number[] {
  const r = max - min;
  if (r === 0) return [min];
  const step = Math.pow(10, Math.floor(Math.log10(r / count)));
  const ns = [1, 2, 5, 10].find(f => r / (f * step) <= count) || 10;
  const s = ns * step;
  const start = Math.ceil(min / s) * s;
  const arr: number[] = [];
  for (let t = start; t <= max + 1e-9; t += s)
    arr.push(parseFloat(t.toPrecision(10)));
  return arr;
}

function nFmt(v: number): string {
  if (Math.abs(v) >= 10000 || (Math.abs(v) < 0.01 && v !== 0))
    return v.toExponential(1);
  return parseFloat(v.toPrecision(4)).toString();
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
