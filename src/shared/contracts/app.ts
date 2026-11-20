import type { CoreStatus } from '../protocol';
import type { Contract } from './types';

// Demo contract for M0 step 2b; replaced by the real domain contracts in M1.

export interface AppItem {
  id: number;
  name: string;
}

export interface AppState {
  obs: CoreStatus;
  counter: number;
  items: AppItem[];
}

/** Startup marks and backend call timing (docs: m1-design 7). Dev diagnostics. */
export interface CoreStats {
  /** ms since core start, by mark name. */
  marks: Record<string, number>;
  /** Longest single backend call (= longest event-loop stall caused by the backend). */
  maxStallMs: number;
  maxStallMethod: string;
  backend: Record<string, { count: number; totalMs: number; maxMs: number; slow: number }>;
}

export interface AppContract extends Contract {
  slices: { app: AppState };
  commands: {
    app: {
      increment(): number;
      addItem(name: string): number;
      renameItem(id: number, name: string): void;
      removeItem(id: number): void;
      /** Emits one `app.tick` event on demand (there is no timer behind it). */
      tick(): void;
      /** Backend call timing and startup marks. */
      stats(): CoreStats;
    };
  };
  events: { 'app.tick': { n: number; ts: number } };
}
