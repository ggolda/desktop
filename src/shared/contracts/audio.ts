import type { Contract } from './types';

// M1 contract: audio mixer. See docs/rework/chapter2/m1-design.md.

export type MonitoringType = 'none' | 'monitor-only' | 'monitor-and-output';

export interface AudioSourceState {
  id: string;
  muted: boolean;
  /** Linear multiplier as persisted in the collection (`volume`). */
  mul: number;
  db: number;
  /** 0..1 fader position (IEC curve); this is what the slider edits. */
  deflection: number;
  forceMono: boolean;
  /** Milliseconds. */
  syncOffsetMs: number;
  /** Bitmask of audio tracks 1..6 (legacy default 255). */
  mixers: number;
  monitoring: MonitoringType;
  /** Hidden from the mixer by the user (`mixerHidden`). */
  hidden: boolean;
}

export interface AudioState {
  /** Every source that has audio. */
  sources: Record<string, AudioSourceState>;
  /**
   * What the mixer shows for the active scene: global channels plus nested scene sources, in display
   * order. `rev` increases whenever `ids` changes; the meters frame carries the same `rev`.
   */
  mixer: { rev: number; ids: string[] };
}

export interface AudioPatch {
  forceMono?: boolean;
  syncOffsetMs?: number;
  mixers?: number;
  monitoring?: MonitoringType;
  hidden?: boolean;
}

export interface FaderPatch {
  /** Exactly one of these, whichever the UI edits. */
  deflection?: number;
  db?: number;
  mul?: number;
}

/**
 * Layout of one frame on the `meters` channel (a Float32Array, <= 15 Hz, only while a window has
 * meters on). All values are dB; -65535 means "no signal / muted".
 *
 *   [0] frame version (1)
 *   [1] mixer.rev the frame was built for (drop the frame if it differs from the slice's rev)
 *   [2] n = number of sources, in `mixer.ids` order
 *   then n records: [ch, peak[0..ch), magnitude[0..ch), inputPeak[0..ch)]   (ch <= 8, 0 = no data yet)
 */
export type MeterFrame = Float32Array | number[];

export interface AudioContract extends Contract {
  slices: { audio: AudioState };
  commands: {
    audio: {
      setMuted(id: string, muted: boolean): void;
      /** High rate while dragging: the UI throttles to one call per frame. */
      setFader(id: string, patch: FaderPatch): void;
      setSettings(id: string, patch: AudioPatch): void;
      unhideAll(): void;
    };
  };
  events: Record<never, never>;
}
