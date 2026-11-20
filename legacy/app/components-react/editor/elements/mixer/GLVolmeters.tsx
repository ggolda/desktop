import React, { useEffect, useMemo, useRef } from 'react';
import { debounce } from 'lodash-decorators';
import { IVolmeter } from 'services/audio';
import { ipcRenderer } from 'electron';
import * as remote from '@electron/remote';
import difference from 'lodash/difference';
import { Services } from 'components-react/service-provider';
import { assertIsDefined, getDefined } from 'util/properties-type-guards';
import { useController } from 'components-react/hooks/zustand';

// Configuration
const CHANNEL_HEIGHT = 3;
const SPACE_BETWEEN_CHANNELS = 2;
// When height of audio mixer elements changes, these paddings values also should be updated
const PADDING_TOP = 39;
const PADDING_BOTTOM = 57;
const PEAK_WIDTH = 4;
// Counted in draws: 33 draws at 10 fps ≈ 3.3 s (same hold time as 100 draws at the old 30 fps).
const PEAK_HOLD_CYCLES = 33;
const WARNING_LEVEL = -20;
const DANGER_LEVEL = -9;

// Colors (RGB)
const GREEN = [128, 245, 210];
const LIGHT_MODE_GREEN = [18, 128, 121];
const YELLOW = [255, 205, 71];
const RED = [252, 62, 63];

interface IVolmeterSubscription {
  sourceId: string;
  channelId?: string;
  channelsCount: number;
  // peakHolds show the maximum peak value for a given time range
  peakHoldCounters: number[];
  peakHolds: number[];
  // Store previous peaks values for smooth interpolated rendering
  prevPeaks: number[];
  // Current peak values
  currentPeaks: number[];
  // interpolated peaks are using for rendering
  interpolatedPeaks: number[];
  // the time of last received peaks
  lastEventTime: number;
}

export default function GLVolmetersWithContext() {
  const controller = useMemo(() => new GLVolmetersController(), []);
  return (
    <GLVolmetersCtx.Provider value={controller}>
      <GLVolmeters />
    </GLVolmetersCtx.Provider>
  );
}

/**
 * Component that renders the volume for audio sources via WebGL
 */
function GLVolmeters() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const controller = useController(GLVolmetersCtx);

  // start rendering volmeters when the canvas is ready
  useEffect(() => {
    assertIsDefined(canvasRef.current);
    controller.setupNewCanvas(canvasRef.current);
    return () => controller.beforeDestroy(); // cleanup on unmount
  }, []);

  return (
    <div style={{ position: 'absolute', height: '100%', width: '100%' }}>
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          position: 'absolute',
          top: 0,
          right: 0,
          left: 0,
          paddingLeft: '16px',
          paddingRight: '16px',
          height: '100%',
        }}
      />
    </div>
  );
}

const GLVolmetersCtx = React.createContext<GLVolmetersController | null>(null);

/**
 * Renders the mixer volume meters on a single 2D canvas (docs/rework, H17).
 *
 * Cost model: in Chromium every visible change costs a full frame across renderer,
 * compositor, GPU process and DWM — regardless of how small the canvas is. So the
 * controller works hard to produce as few frames as possible:
 *  - event-driven: draw only when a level visibly moves (≥ MIN_PIXEL_CHANGE px) or an
 *    animation (interpolation, peak-hold decay) is still running; no rAF loop
 *  - capped at FPS_LIMIT
 *  - paused (unsubscribed from data) while the main window is not focused — e.g. while
 *    the streamer is in a game — and resumed on focus
 *  - a CPU-backed 2D canvas instead of WebGL: no GL context in the GPU process
 */
const FPS_LIMIT = 10;
const MIN_PIXEL_CHANGE = 2;

class GLVolmetersController {
  private customizationService = Services.CustomizationService;
  private audioService = Services.AudioService;

  subscriptions: Dictionary<IVolmeterSubscription> = {};

  private ctx: CanvasRenderingContext2D | null = null;
  private canvasWidth = 0;
  private canvasHeight = 0;
  private resizeObserver: ResizeObserver | null = null;
  private themeSubscription: { unsubscribe(): void } | null = null;

  // time between 2 received peaks. Used to render extra interpolated frames
  interpolationTime = 35;
  private bg: { r: number; g: number; b: number };
  private bgMultiplier = 0.2;
  private green = GREEN;
  private sourcesOrder: string[] = [];
  private drawTimer: number | null = null;
  private lastDrawTime = 0;

  // Window focus (not document focus: typing in the chat BrowserView inside the main
  // window must not pause the meters). Dialog windows taking focus do pause them.
  private win = remote.getCurrentWindow();
  private paused = false;
  private onFocusChange = () => {
    const active = !this.win.isDestroyed() && this.win.isFocused() && !this.win.isMinimized();
    if (!active && !this.paused) {
      this.paused = true;
      Object.keys(this.subscriptions).forEach(sourceId => this.unsubscribeVolmeter(sourceId));
      if (this.drawTimer !== null) clearTimeout(this.drawTimer);
      this.drawTimer = null;
    } else if (active && this.paused) {
      this.paused = false;
      this.subscribeVolmeters();
      this.requestDraw();
    }
  };

  init() {
    this.paused = !this.win.isFocused();
    this.subscribeVolmeters();
    this.refreshColors();
  }

  $refs = {
    canvas: null! as HTMLCanvasElement,
  };

  // TODO: refactor into a single source of truth between Mixer and Volmeters
  get audioSources() {
    return this.audioService.views.sourcesForCurrentScene.filter(source => {
      return !source.mixerHidden && source.isControlledViaObs;
    });
  }

  /**
   * add or remove subscription for volmeters depending on current scene
   */
  @debounce(500)
  private subscribeVolmeters() {
    const audioSources = this.audioSources;
    const sourcesOrder = audioSources.map(source => source.sourceId);
    this.sourcesOrder = sourcesOrder;

    // Nobody is looking at the meters: don't receive data.
    if (this.paused) return;

    // subscribe volmeters
    audioSources.forEach(source => {
      const sourceId = source.sourceId;

      // skip already subscribed volmeters
      if (this.subscriptions[sourceId]) return;

      // create listener
      const listener = (e: { data: IVolmeter }) => {
        const subscription = this.subscriptions[sourceId];
        if (!subscription) return;
        const peaks = Array.from(e.data.peak);
        // Silence or a barely changing level: ignore it when the meter is settled and
        // would look the same, so nothing is redrawn.
        if (this.isSettled(subscription) && this.samePixels(peaks, subscription.currentPeaks)) {
          return;
        }
        subscription.channelsCount = peaks.length;
        subscription.prevPeaks = subscription.interpolatedPeaks;
        subscription.currentPeaks = peaks;
        subscription.lastEventTime = performance.now();
        this.requestDraw();
      };

      const IDLE_PEAK = -60;
      const INITIAL_PEAKS = [IDLE_PEAK, IDLE_PEAK];

      // create a subscription object
      this.subscriptions[sourceId] = {
        sourceId,
        // Assume 2 channels until we know otherwise. This prevents too much
        // visual jank as the volmeters are initializing.
        channelsCount: 2,
        // HACK: Initialize currentPeaks to an idle-ish peak, if the source
        // has never emitted any events, volmeters won't get drawn and we get
        // a missing bar on app load or source device switch.
        currentPeaks: INITIAL_PEAKS,
        prevPeaks: [],
        interpolatedPeaks: [],
        lastEventTime: 0,
        peakHolds: [],
        peakHoldCounters: [],
      };

      this.audioService.actions.return.subscribeVolmeter(sourceId).then(id => {
        ipcRenderer.once(`port-${id}`, e => {
          if (!this.subscriptions[sourceId]) {
            // unsubscribed (paused/unmounted) before the port arrived
            this.audioService.actions.unsubscribeVolmeter(sourceId, id);
            return;
          }
          this.subscriptions[sourceId].channelId = id;
          e.ports[0].onmessage = listener;
        });

        ipcRenderer.send('request-message-channel-out', id);
      });
    });

    // unsubscribe from not longer relevant volmeters
    const subscribedSourcesIds = Object.keys(this.subscriptions);
    const sourcesToUnsubscribe = difference(subscribedSourcesIds, sourcesOrder);
    sourcesToUnsubscribe.forEach(sourceId => this.unsubscribeVolmeter(sourceId));
  }

  private unsubscribeVolmeter(sourceId: string) {
    if (this.subscriptions[sourceId].channelId) {
      this.audioService.actions.unsubscribeVolmeter(
        sourceId,
        this.subscriptions[sourceId].channelId!,
      );
    }

    delete this.subscriptions[sourceId];
  }

  beforeDestroy() {
    this.win.removeListener('focus', this.onFocusChange);
    this.win.removeListener('blur', this.onFocusChange);
    this.win.removeListener('minimize', this.onFocusChange);
    this.win.removeListener('restore', this.onFocusChange);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.themeSubscription?.unsubscribe();
    this.themeSubscription = null;
    // unsubscribe all volmeters
    Object.keys(this.subscriptions).forEach(sourceId => this.unsubscribeVolmeter(sourceId));

    // cancel pending frame rendering
    if (this.drawTimer !== null) clearTimeout(this.drawTimer);
    this.drawTimer = null;
    this.ctx = null;
  }

  setupNewCanvas($canvasEl: HTMLCanvasElement) {
    this.$refs.canvas = $canvasEl;
    this.canvasWidth = 0;
    this.canvasHeight = 0;

    // willReadFrequently: keeps the canvas CPU-backed (no GPU context/shared image for a
    // few rectangles); the small bitmap is uploaded when a frame is drawn.
    this.ctx = getDefined($canvasEl.getContext('2d', { alpha: false, willReadFrequently: true }));

    this.setCanvasSize();
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => {
      this.setCanvasSize();
      this.requestDraw();
    });
    this.resizeObserver.observe(getDefined($canvasEl.parentElement));
    this.themeSubscription?.unsubscribe();
    this.themeSubscription = this.customizationService.settingsChanged.subscribe(() => {
      this.refreshColors();
      this.requestDraw();
    });

    for (const ev of ['focus', 'blur', 'minimize', 'restore'] as const) {
      this.win.removeListener(ev as any, this.onFocusChange);
      this.win.on(ev as any, this.onFocusChange);
    }

    this.requestDraw();
  }

  /**
   * Schedule one draw, respecting the FPS cap. Called when data or size changes, and by
   * a draw whose meters are still animating (interpolation, peak-hold decay).
   */
  private requestDraw() {
    if (this.drawTimer !== null || !this.ctx) return;
    const wait = Math.max(0, this.lastDrawTime + 1000 / FPS_LIMIT - performance.now());
    this.drawTimer = window.setTimeout(() => {
      this.drawTimer = null;
      if (!this.$refs.canvas || !this.ctx) return; // destroyed
      this.lastDrawTime = performance.now();
      this.drawVolmeters();
      if (!this.paused && !this.allSettled()) this.requestDraw();
    }, wait);
  }

  /** px position of a level on the canvas — what the user can actually see change */
  private toPixels(db: number) {
    return Math.round(this.dbToUnitScalar(db) * (this.canvasWidth || 0));
  }

  private samePixels(a: number[], b: number[]) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => Math.abs(this.toPixels(v) - this.toPixels(b[i])) < MIN_PIXEL_CHANGE);
  }

  /** nothing left to animate: interpolation finished, peak holds sit on the current level */
  private isSettled(volmeter: IVolmeterSubscription) {
    if (performance.now() - volmeter.lastEventTime < this.interpolationTime) return false;
    return volmeter.currentPeaks.every(
      (peak, ch) =>
        volmeter.peakHolds[ch] === undefined ||
        this.toPixels(volmeter.peakHolds[ch]) - this.toPixels(peak) < MIN_PIXEL_CHANGE,
    );
  }

  private allSettled() {
    return Object.values(this.subscriptions).every(v => this.isSettled(v));
  }

  private refreshColors() {
    this.bg = this.customizationService.sectionBackground;
    this.bgMultiplier = this.customizationService.isDarkTheme ? 0.2 : 0.5;
    this.green = this.customizationService.isDarkTheme ? GREEN : LIGHT_MODE_GREEN;
  }

  private setCanvasSize() {
    const $parent = getDefined(this.$refs.canvas?.parentElement);
    const width = Math.floor($parent.offsetWidth);
    const height = Math.floor($parent.offsetHeight);

    if (width !== this.canvasWidth) {
      this.canvasWidth = width;
      this.$refs.canvas.width = width;
      this.$refs.canvas.style.width = `${width}px`;
    }

    if (height !== this.canvasHeight) {
      this.canvasHeight = height;
      this.$refs.canvas.height = this.canvasHeight;
      this.$refs.canvas.style.height = `${this.canvasHeight}px`;
    }
  }

  private drawVolmeters() {
    const ctx = this.ctx!;
    const bg = this.bg;
    ctx.fillStyle = `rgb(${bg.r},${bg.g},${bg.b})`;
    ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);

    if (this.canvasWidth <= 0 || this.canvasHeight <= 0 || !this.sourcesOrder) return;

    let offsetTop = 0;
    this.sourcesOrder.forEach(sourceId => {
      offsetTop += PADDING_TOP;
      const volmeter = this.subscriptions[sourceId];
      if (volmeter) this.drawVolmeter(volmeter, offsetTop);
      offsetTop += PADDING_BOTTOM;
    });
  }

  private drawVolmeter(volmeter: IVolmeterSubscription, offsetTop: number) {
    volmeter.currentPeaks.forEach((peak, channel) => {
      this.drawVolmeterChannel(volmeter, channel, offsetTop);
    });
  }

  /** Same look as the former WebGL shader: colored zones, lit up to the level and at the peak hold. */
  private drawVolmeterChannel(volmeter: IVolmeterSubscription, channel: number, offsetTop: number) {
    const peak = volmeter.currentPeaks[channel];
    this.updatePeakHold(volmeter, peak, channel);

    const prevPeak = volmeter.prevPeaks[channel] ? volmeter.prevPeaks[channel] : peak;
    const timeDelta = performance.now() - volmeter.lastEventTime;
    let alpha = timeDelta / this.interpolationTime;
    if (alpha > 1) alpha = 1;
    const interpolatedPeak = this.lerp(prevPeak, peak, alpha);
    volmeter.interpolatedPeaks[channel] = interpolatedPeak;

    const y = channel * (CHANNEL_HEIGHT + SPACE_BETWEEN_CHANNELS) + offsetTop;
    const volume = this.dbToUnitScalar(interpolatedPeak);
    const hold = this.dbToUnitScalar(volmeter.peakHolds[channel]);

    this.fillZones(0, 1, y, false); // dimmed background bar
    if (volume > 0) this.fillZones(0, volume, y, true);
    if (hold !== 0) this.fillZones(hold, hold + PEAK_WIDTH / this.canvasWidth, y, true);
  }

  /** fill [x0, x1) (unit coordinates) split into green / yellow / red zones */
  private fillZones(x0: number, x1: number, y: number, lit: boolean) {
    const ctx = this.ctx!;
    const w = this.canvasWidth;
    const warning = this.dbToUnitScalar(WARNING_LEVEL);
    const danger = this.dbToUnitScalar(DANGER_LEVEL);
    const zones: [number, number, number[]][] = [
      [0, warning, this.green],
      [warning, danger, YELLOW],
      [danger, Infinity, RED],
    ];
    const m = lit ? 1 : this.bgMultiplier;
    for (const [a, b, color] of zones) {
      const start = Math.max(a, x0);
      const end = Math.min(b, x1);
      if (end <= start) continue;
      ctx.fillStyle = `rgb(${color[0] * m},${color[1] * m},${color[2] * m})`;
      ctx.fillRect(start * w, y, (end - start) * w, CHANNEL_HEIGHT);
    }
  }

  private dbToUnitScalar(db: number) {
    return Math.max((db + 60) * (1 / 60), 0);
  }

  updatePeakHold(volmeter: IVolmeterSubscription, peak: number, channel: number) {
    if (!volmeter.peakHoldCounters[channel] || peak > volmeter.peakHolds[channel]) {
      volmeter.peakHolds[channel] = peak;
      volmeter.peakHoldCounters[channel] = PEAK_HOLD_CYCLES;
      return;
    }
    volmeter.peakHoldCounters[channel] -= 1;
  }

  /**
   * Linearly interpolates between val1 and val2
   * alpha = 0 will be val1, and alpha = 1 will be val2.
   */
  lerp(val1: number, val2: number, alpha: number) {
    return val1 + (val2 - val1) * alpha;
  }
}
