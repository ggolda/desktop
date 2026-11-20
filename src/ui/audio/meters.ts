/**
 * Meters channel helpers (contract: shared/contracts/audio.ts `MeterFrame`). Pure, no DOM except the
 * painter, which only needs a canvas-like 2d context.
 */

export const METER_MIN_DB = -60;
/** Draw only when a level moved at least this many pixels (chapter 1 GLVolmeters finding). */
export const MIN_PIXEL_CHANGE = 2;
const CHANNEL_HEIGHT = 3;
const PADDING_HEIGHT = 2;
const PEAK_WIDTH = 4;
/** Counted in frames (<= 15 per second): 33 frames hold the peak for about 2-3 s. */
const PEAK_HOLD_FRAMES = 33;
const WARNING_DB = -20;
const DANGER_DB = -9;
const GREEN = [49, 195, 162];
const YELLOW = [255, 205, 71];
const RED = [252, 62, 63];

/**
 * Per-source peak levels (dB, one entry per channel) in `mixer.ids` order, or null when the frame is
 * unusable: other version, empty, or built for a different `mixer.rev` than the slice has now.
 */
export function parseMeterFrame(
  frame: Float32Array | number[],
  expectedRev: number | undefined,
): number[][] | null {
  if (!frame || frame.length < 3 || frame[0] !== 1) return null;
  if (expectedRev !== undefined && frame[1] !== expectedRev) return null;
  const n = frame[2];
  const out: number[][] = [];
  let i = 3;
  for (let s = 0; s < n; s++) {
    if (i >= frame.length) return null;
    const ch = Math.min(frame[i++], 8);
    const peak: number[] = [];
    for (let c = 0; c < ch; c++) peak.push(frame[i + c]);
    i += ch * 3; // peak, magnitude, inputPeak
    out.push(peak);
  }
  return out;
}

export const rgb = (c: number[], m = 1) => `rgb(${c.map(v => Math.round(v * m)).join(',')})`;

export interface PainterTarget {
  width: number;
  height: number;
  style: { width: string; height: string };
  getContext(id: '2d', opts?: object): CanvasRenderingContext2D | null;
}

/** Draws the channel bars of one mixer row. Stateful: peak hold and last drawn pixel positions. */
export class MeterPainter {
  private ctx: CanvasRenderingContext2D | null;
  private cssWidth = 0;
  private dpr = 1;
  private channels = 0;
  private holds: number[] = [];
  private holdFrames: number[] = [];
  private lastPx: number[] = [];
  private lastHoldPx: number[] = [];
  /** Number of actual repaints (tests, diagnostics). */
  paints = 0;

  constructor(
    private canvas: PainterTarget,
    private bg = 'rgb(9,22,29)',
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false });
  }

  static heightFor(channels: number) {
    return Math.max(channels * (CHANNEL_HEIGHT + PADDING_HEIGHT) - PADDING_HEIGHT, 0);
  }

  /** Call when the element width or the DPR changes. Forces the next draw. */
  resize(cssWidth: number, dpr = 1) {
    this.cssWidth = Math.max(0, Math.floor(cssWidth));
    this.dpr = dpr || 1;
    this.applySize();
    this.lastPx = [];
    this.clear(); // resizing a canvas blanks it: paint the background right away
  }

  private applySize() {
    const h = MeterPainter.heightFor(this.channels);
    this.canvas.width = Math.round(this.cssWidth * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${this.cssWidth}px`;
    this.canvas.style.height = `${h}px`;
  }

  dbToPx(db: number) {
    const clamped = Math.max(METER_MIN_DB, Math.min(0, db));
    return Math.round(((clamped - METER_MIN_DB) * this.cssWidth) / 60);
  }

  /** Returns true when the canvas was repainted. */
  draw(peaks: readonly number[]): boolean {
    if (!this.ctx || this.cssWidth <= 0) return false;
    if (peaks.length !== this.channels) {
      this.channels = peaks.length;
      this.holds = [];
      this.lastPx = [];
      this.applySize();
    }
    const px = peaks.map(p => this.dbToPx(p));
    const holdPx = peaks.map((p, c) => {
      if (this.holdFrames[c] === undefined || p > this.holds[c] || this.holdFrames[c] <= 0) {
        this.holds[c] = p;
        this.holdFrames[c] = PEAK_HOLD_FRAMES;
      } else this.holdFrames[c]--;
      return this.dbToPx(this.holds[c]);
    });
    const moved =
      this.lastPx.length !== px.length ||
      px.some((v, c) => Math.abs(v - this.lastPx[c]) >= MIN_PIXEL_CHANGE) ||
      holdPx.some((v, c) => Math.abs(v - (this.lastHoldPx[c] ?? -99)) >= MIN_PIXEL_CHANGE);
    if (!moved) return false;
    this.lastPx = px;
    this.lastHoldPx = holdPx;
    this.paint(peaks, px, holdPx);
    return true;
  }

  private paint(peaks: readonly number[], px: number[], holdPx: number[]) {
    const ctx = this.ctx!;
    const w = this.cssWidth;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.bg;
    ctx.fillRect(0, 0, w, MeterPainter.heightFor(this.channels));
    const warn = this.dbToPx(WARNING_DB);
    const danger = this.dbToPx(DANGER_DB);
    peaks.forEach((peak, c) => {
      const y = c * (CHANNEL_HEIGHT + PADDING_HEIGHT);
      // dim scale, then the lit part
      ctx.fillStyle = rgb(GREEN, 0.2);
      ctx.fillRect(0, y, warn, CHANNEL_HEIGHT);
      ctx.fillStyle = rgb(YELLOW, 0.2);
      ctx.fillRect(warn, y, danger - warn, CHANNEL_HEIGHT);
      ctx.fillStyle = rgb(RED, 0.2);
      ctx.fillRect(danger, y, w - danger, CHANNEL_HEIGHT);
      ctx.fillStyle = rgb(GREEN);
      ctx.fillRect(0, y, Math.min(px[c], warn), CHANNEL_HEIGHT);
      if (peak > WARNING_DB) {
        ctx.fillStyle = rgb(YELLOW);
        ctx.fillRect(warn, y, Math.min(px[c], danger) - warn, CHANNEL_HEIGHT);
      }
      if (peak > DANGER_DB) {
        ctx.fillStyle = rgb(RED);
        ctx.fillRect(danger, y, px[c] - danger, CHANNEL_HEIGHT);
      }
      const hold = this.holds[c];
      ctx.fillStyle = rgb(hold > DANGER_DB ? RED : hold > WARNING_DB ? YELLOW : GREEN);
      ctx.fillRect(holdPx[c], y, PEAK_WIDTH, CHANNEL_HEIGHT);
    });
    this.paints++;
  }

  /** Clears the bars (row muted or meters paused). */
  clear() {
    if (!this.ctx) return;
    this.lastPx = [];
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.fillStyle = this.bg;
    this.ctx.fillRect(0, 0, this.cssWidth, MeterPainter.heightFor(this.channels));
  }
}
