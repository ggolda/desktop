// Faders (always, cheap) and volmeters (only while meters are enabled).
import type { MediaBackend } from '../backend';
import { FADER_IEC, FLAG_FORCE_MONO, msToTimeSpec } from './enums';
import { type ObsState, missing } from './state';
import type { OsnFader, OsnInput } from './types';

export function createAudio(st: ObsState): MediaBackend['audio'] {
  const input = (id: string): OsnInput => {
    const i = st.inputs.get(id);
    if (!i) throw missing('source', id);
    return i;
  };
  const read = (f: OsnFader) => ({ db: f.db || 0, deflection: f.deflection, mul: f.mul });

  const listeners = new Set<
    (b: { id: string; peak: number[]; magnitude: number[]; inputPeak: number[] }[]) => void
  >();
  let callbackBound = false;
  function bindCallback() {
    if (callbackBound) return;
    callbackBound = true;
    // one global callback, registered when the first volmeter is created; it does nothing while
    // nobody listens
    st.osn.NodeObs.RegisterVolmeterCallback(objs => {
      if (listeners.size === 0) return;
      const batch = objs
        .filter(o => st.volmeters.has(o.sourceName))
        .map(o => ({
          id: o.sourceName,
          peak: o.peak,
          magnitude: o.magnitude,
          inputPeak: o.inputPeak,
        }));
      if (batch.length) for (const l of listeners) l(batch);
    });
  }

  function dropVolmeter(id: string) {
    const v = st.volmeters.get(id);
    if (!v) return;
    st.volmeters.delete(id);
    try {
      v.detach();
      v.destroy();
    } catch (e) {
      console.error('[obs] volmeter cleanup failed', e);
    }
  }

  return {
    async attach(id, mul) {
      const old = st.faders.get(id);
      if (old) return read(old);
      const f = st.osn.FaderFactory.create(FADER_IEC);
      f.attach(input(id));
      // `input.volume` is not reliable right after creation (reads garbage/0), so the persisted
      // volume is applied through the fader, like legacy audio.setMul (scene-collections nodes/sources)
      if (mul !== undefined && Number.isFinite(mul)) f.mul = mul;
      st.faders.set(id, f);
      return read(f);
    },
    async detach(id) {
      dropVolmeter(id);
      const f = st.faders.get(id);
      if (!f) return;
      st.faders.delete(id);
      f.detach();
      f.destroy();
    },
    async setMuted(id, muted) {
      input(id).muted = muted;
    },
    async setFader(id, patch) {
      const f = st.faders.get(id);
      if (!f) throw missing('fader', id);
      // never set db directly (legacy audio.ts:301): convert it to a multiplier
      if (patch.deflection != null) f.deflection = patch.deflection;
      else if (patch.mul != null) f.mul = patch.mul;
      else if (patch.db != null) f.mul = 10 ** (patch.db / 20);
      return read(f);
    },
    async setSettings(id, patch) {
      const i = input(id);
      if (patch.syncOffsetMs !== undefined) i.syncOffset = msToTimeSpec(patch.syncOffsetMs);
      if (patch.mixers !== undefined) i.audioMixers = patch.mixers;
      if (patch.monitoring !== undefined) i.monitoringType = patch.monitoring;
      if (patch.forceMono !== undefined) {
        const flags = i.flags;
        i.flags = patch.forceMono ? flags | FLAG_FORCE_MONO : flags & ~FLAG_FORCE_MONO;
      }
    },
    async setMetersEnabled(enabled, ids) {
      const want = new Set(enabled ? ids : []);
      for (const id of [...st.volmeters.keys()]) if (!want.has(id)) dropVolmeter(id);
      for (const id of want) {
        if (st.volmeters.has(id) || !st.inputs.has(id)) continue;
        bindCallback();
        const v = st.osn.VolmeterFactory.create(FADER_IEC);
        v.attach(input(id));
        st.volmeters.set(id, v);
      }
    },
    onMeterData(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
