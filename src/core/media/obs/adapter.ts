// MediaBackend on obs-studio-node. The only implementation that touches native objects; every call
// is synchronous IPC inside an async function (m1-design 11.1), so core instruments them.
import type { BackendEvents, MediaBackend } from '../backend';
import { createAudio } from './audio';
import { createCanvases } from './canvases';
import { createDisplays } from './displays';
import { getOsn, initObs, shutdownObs } from './osn';
import { createScenes } from './scenes';
import { createSources } from './sources';
import type { ObsState } from './state';
import { createTransitions } from './transitions';

export function createObsBackend(): MediaBackend {
  const listeners = new Map<string, Set<(p: never) => void>>();
  let st: ObsState | null = null;

  const emit: ObsState['emit'] = (e, p) => {
    for (const l of listeners.get(e) ?? []) (l as (p: unknown) => void)(p);
  };

  // Namespaces resolve the state lazily: they exist before `init`, they work after it.
  const lazy = <T extends object>(make: (s: ObsState) => T): T => {
    let made: T | null = null;
    return new Proxy({} as T, {
      get(_t, key) {
        if (!st) throw Object.assign(new Error('backend not initialized'), { code: 'ENOTREADY' });
        made ??= make(st);
        return made[key as keyof T];
      },
    });
  };

  return {
    info: { name: 'obs-studio-node' },
    async init(opts) {
      const r = initObs({
        osnPath: opts.installPath,
        appDataPath: opts.appDataPath,
        version: opts.version,
      });
      if (!r.ok) throw new Error(r.error ?? `OBS init failed (${r.code})`);
      st = {
        osn: getOsn(),
        inputs: new Map(),
        scenes: new Map(),
        transitions: new Map(),
        faders: new Map(),
        volmeters: new Map(),
        video: { horizontal: null },
        program: { sceneId: null },
        emit,
      };
      return { name: 'obs-studio-node', version: opts.version };
    },
    async shutdown() {
      const s = st;
      if (s) {
        // order: volmeters, displays (core destroyed them), scenes, sources, transitions, backend
        const quiet = (f: () => void) => {
          try {
            f();
          } catch (e) {
            console.error('[obs] release failed', e);
          }
        };
        for (const v of s.volmeters.values()) quiet(() => (v.detach(), v.destroy()));
        s.volmeters.clear();
        for (const f of s.faders.values()) quiet(() => (f.detach(), f.destroy()));
        s.faders.clear();
        for (const sc of s.scenes.values()) quiet(() => sc.scene.release());
        s.scenes.clear();
        for (const i of s.inputs.values()) quiet(() => i.release());
        s.inputs.clear();
        for (const t of s.transitions.values()) quiet(() => t.release());
        s.transitions.clear();
        quiet(() => s.osn.Global.setOutputSource(0, null));
      }
      const r = shutdownObs();
      st = null;
      if (!r.ok) console.error('[obs] shutdown:', r.error);
    },
    on<K extends keyof BackendEvents>(e: K, cb: (p: BackendEvents[K]) => void) {
      let set = listeners.get(e);
      if (!set) listeners.set(e, (set = new Set()));
      set.add(cb as (p: never) => void);
      return () => set.delete(cb as (p: never) => void);
    },
    canvases: lazy(createCanvases),
    sources: lazy(createSources),
    scenes: lazy(createScenes),
    transitions: lazy(createTransitions),
    audio: lazy(createAudio),
    displays: lazy(createDisplays),
  };
}
