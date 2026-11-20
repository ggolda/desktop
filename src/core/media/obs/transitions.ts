// Transitions: creation and the program switch (legacy transitions.ts:347-390).
import { randomUUID } from 'node:crypto';
import type { MediaBackend } from '../backend';
import { type ObsState, missing } from './state';

export function createTransitions(st: ObsState): MediaBackend['transitions'] {
  return {
    async create(spec) {
      if (st.transitions.has(spec.id)) return;
      st.transitions.set(
        spec.id,
        st.osn.TransitionFactory.create(spec.type, spec.id, spec.settings),
      );
    },
    async remove(id) {
      const t = st.transitions.get(id);
      if (!t) return;
      st.transitions.delete(id);
      t.release();
    },
    async switchScene(toSceneId, transitionId, durationMs) {
      const to = st.scenes.get(toSceneId);
      if (!to) throw missing('scene', toSceneId);
      const from = st.program.sceneId ? st.scenes.get(st.program.sceneId) : undefined;
      const tr = transitionId ? st.transitions.get(transitionId) : undefined;
      if (tr && from) {
        tr.set(from.scene);
        st.osn.Global.setOutputSource(0, tr);
        tr.start(durationMs, to.scene);
      } else {
        // first scene or a cut: a throw-away cut transition carries the scene to the output
        const cut = st.osn.TransitionFactory.create('cut_transition', randomUUID());
        cut.set(to.scene);
        st.osn.Global.setOutputSource(0, cut);
        cut.release();
      }
      st.program.sceneId = toSceneId;
    },
  };
}
