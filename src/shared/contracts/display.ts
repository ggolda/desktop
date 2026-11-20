import type { CanvasId } from './scenes';
import type { Contract } from './types';

// M1 contract: preview displays (SPEC 2.1). The window reports a placeholder rect; core creates and
// moves the native OBS display. No polling anywhere. See docs/rework/chapter2/m1-design.md.

/** CSS pixels relative to the top-left of the window's web contents. */
export interface DisplayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Everything core needs to place the display. Sent on every change (ResizeObserver etc.). */
export interface DisplayView {
  rect: DisplayRect;
  /** window.devicePixelRatio at the time of measuring (core converts to device pixels). */
  dpr: number;
  /**
   * False when the placeholder is not on screen: display:none, scrolled out, window hidden or minimized,
   * or covered by an in-window overlay (popover, menu), which a native child window would draw over.
   */
  visible: boolean;
}

export type DisplayRenderingMode = 'main' | 'streaming' | 'recording';

export interface DisplayCreateOptions {
  canvas?: CanvasId;
  /** A source preview display instead of the program canvas. */
  sourceId?: string;
  renderingMode?: DisplayRenderingMode;
  paddingSize?: number;
  paddingColor?: { r: number; g: number; b: number };
  /** Draw selection handles and guides (the main editor display). */
  drawUi?: boolean;
}

export interface DisplayState {
  /** The id the window chose in `display.create`. */
  id: string;
  /**
   * `absent`: not created (yet or any more); `pending`: waiting for the backend or the native handle;
   * `ready`; `hidden`: created but sized to zero because the view is not visible; `error`.
   */
  status: 'absent' | 'pending' | 'ready' | 'hidden' | 'error';
  canvas: CanvasId;
  /**
   * Where the canvas is drawn inside the display, in the same CSS-pixel space as `DisplayView.rect`
   * but relative to the placeholder's top-left (backend value divided by dpr). Null until known.
   * The editor uses it for hit testing and handles.
   */
  outputRegion: DisplayRect | null;
  error?: string;
}

export interface DisplayContract extends Contract {
  slices: { [k: `display:${string}`]: DisplayState };
  commands: {
    display: {
      /** Owner = the calling window's connection: its displays are destroyed when it disconnects. */
      create(id: string, options: DisplayCreateOptions, view: DisplayView): void;
      /** Fire and forget; core keeps only the latest view per display. */
      update(id: string, view: DisplayView): void;
      setOptions(
        id: string,
        patch: Pick<DisplayCreateOptions, 'drawUi' | 'paddingColor' | 'paddingSize'> & {
          guidelines?: boolean;
        },
      ): void;
      destroy(id: string): void;
    };
  };
  events: Record<never, never>;
}
