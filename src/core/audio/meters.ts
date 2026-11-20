// Meters path (m1-design 8): backend volmeter batches -> one accumulator per source -> one Float32Array
// frame per runtime tick (<= 15 Hz, only while a window has meters on). Volmeters exist only while
// somebody looks, and are destroyed 2 s after the last window leaves.
import type { Ctx } from '../context';

const MAX_CH = 8;
const NO_SIGNAL = -65535;
const OFF_DELAY_MS = 2000;

interface Acc {
  peak: number[];
  magnitude: number[];
  inputPeak: number[];
  fresh: boolean;
}

export function createMeters(ctx: Ctx) {
  const { backend } = ctx;
  const acc = new Map<string, Acc>();
  let wanted = false; // a window has meters on
  let enabled = false; // backend volmeters exist
  let offTimer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe: (() => void) | null = null;

  function onData(
    batch: { id: string; peak: number[]; magnitude: number[]; inputPeak: number[] }[],
  ) {
    const doc = ctx.doc;
    for (const b of batch) {
      const rec = doc?.source(b.id);
      let { peak, magnitude, inputPeak } = b;
      if (rec?.muted && rec.type.startsWith('wasapi_input')) {
        // legacy: muted inputs draw nothing (audio/audio.ts:329)
        peak = peak.map(() => NO_SIGNAL);
        magnitude = magnitude.map(() => NO_SIGNAL);
        inputPeak = inputPeak.map(() => NO_SIGNAL);
      }
      const a = acc.get(b.id);
      if (!a || !a.fresh) {
        acc.set(b.id, {
          peak: peak.slice(0, MAX_CH),
          magnitude: magnitude.slice(0, MAX_CH),
          inputPeak: inputPeak.slice(0, MAX_CH),
          fresh: true,
        });
      } else {
        a.peak = peak.slice(0, MAX_CH).map((v, i) => Math.max(v, a.peak[i] ?? v));
        a.magnitude = magnitude.slice(0, MAX_CH);
        a.inputPeak = inputPeak.slice(0, MAX_CH);
      }
    }
  }

  async function enable() {
    if (!ctx.backendReady || enabled) return;
    enabled = true;
    unsubscribe ??= backend.audio.onMeterData(onData);
    await backend.audio.setMetersEnabled(true, [...ctx.slices.audio.mixer.ids]);
    ctx.perf.mark('meters.on');
  }

  async function disable() {
    if (!enabled) return;
    enabled = false;
    unsubscribe?.();
    unsubscribe = null;
    acc.clear();
    await backend.audio.setMetersEnabled(false, []);
    ctx.perf.mark('meters.off');
  }

  const clearTimer = () => {
    if (offTimer) clearTimeout(offTimer);
    offTimer = null;
  };

  return {
    onActiveChange(active: boolean) {
      wanted = active;
      clearTimer();
      if (active) void enable().catch(e => console.error('[meters] enable failed', e));
      else {
        offTimer = setTimeout(() => {
          offTimer = null;
          if (!wanted) void disable().catch(e => console.error('[meters] disable failed', e));
        }, OFF_DELAY_MS);
      }
    },
    backendReady() {
      if (wanted) void enable().catch(e => console.error('[meters] enable failed', e));
    },
    /** The mixer changed: re-sync the volmeters. */
    resync(ids: string[]) {
      if (!enabled) return;
      void backend.audio.setMetersEnabled(true, [...ids]).catch(e => console.error('[meters]', e));
    },
    /** Stops volmeters immediately and forgets pending timers (collection switch). */
    async pause() {
      clearTimer();
      await disable();
    },
    async stop() {
      clearTimer();
      wanted = false;
      await disable();
    },
    sample(): Float32Array {
      const { ids, rev } = ctx.slices.audio.mixer;
      const out: number[] = [1, rev, ids.length];
      for (const id of ids) {
        const a = acc.get(id);
        if (!a || !a.fresh) {
          out.push(0);
          continue;
        }
        const ch = a.peak.length;
        out.push(ch);
        for (let i = 0; i < ch; i++) out.push(a.peak[i]);
        for (let i = 0; i < ch; i++) out.push(a.magnitude[i] ?? NO_SIGNAL);
        for (let i = 0; i < ch; i++) out.push(a.inputPeak[i] ?? NO_SIGNAL);
        a.fresh = false;
      }
      return new Float32Array(out);
    },
  };
}
