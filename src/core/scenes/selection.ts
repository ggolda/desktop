// Selection of the active scene. Core owns it because the backend draws the selection guides; only
// changed selections reach the backend (legacy touched every item, selection/index.ts:136).
import { type Ctx, coded } from '../context';
import { expandIds } from './tree';

export interface SelectionApi {
  /** Selection of the active scene, ids that no longer exist are dropped. */
  prune(): void;
  /** Called when the program scene changed or the collection was replaced. */
  reset(): void;
  /** Re-sends the selection to the backend (new objects after a load). */
  resync(): void;
  /** Same as the `selection.set` command. */
  setIds(ids: string[]): void;
}

export function createSelection(ctx: Ctx): SelectionApi {
  const { rt, backend } = ctx;
  const state = ctx.slices.selection;
  /** What the backend currently shows: scene id + refs. */
  let sent: { sceneId: string | null; refs: number[] } = { sceneId: null, refs: [] };

  function refsOf(sceneId: string, ids: string[]): number[] {
    const scene = ctx.doc?.scene(sceneId);
    if (!scene) return [];
    const wanted = new Set(expandIds(scene, ids));
    const out: number[] = [];
    for (const n of scene.nodes) {
      if (n.kind === 'item' && !n.hidden && n.ref !== undefined && wanted.has(n.id))
        out.push(n.ref);
    }
    return out;
  }

  function pushToBackend() {
    if (!ctx.backendReady || ctx.loading) return;
    const sceneId = state.sceneId;
    if (sent.sceneId && sent.sceneId !== sceneId) {
      const old = sent.sceneId;
      if (ctx.doc?.scene(old)) void backend.scenes.setSelected(old, []).catch(logErr);
      sent = { sceneId: null, refs: [] };
    }
    if (!sceneId) return;
    const refs = refsOf(sceneId, state.ids);
    const same =
      sent.sceneId === sceneId &&
      sent.refs.length === refs.length &&
      sent.refs.every((r, i) => r === refs[i]);
    if (same) return;
    sent = { sceneId, refs };
    void backend.scenes.setSelected(sceneId, refs).catch(logErr);
  }

  const logErr = (e: unknown) => console.error('[selection] backend failed', e);

  function validIds(ids: string[]): string[] {
    const sceneId = state.sceneId;
    const scene = sceneId ? ctx.doc?.scene(sceneId) : undefined;
    if (!scene) throw coded('no active scene', 'ENOENT');
    const known = new Set(scene.nodes.filter(n => !n.hidden).map(n => n.id));
    for (const id of ids) if (!known.has(id)) throw coded(`unknown node: ${id}`, 'ENOENT');
    // keep UI order, no duplicates
    return scene.nodes.filter(n => !n.hidden && ids.includes(n.id)).map(n => n.id);
  }

  function apply(ids: string[]) {
    const same = ids.length === state.ids.length && ids.every((id, i) => id === state.ids[i]);
    if (!same) {
      state.ids = ids;
      state.lastId = ids.length ? ids[ids.length - 1] : null;
    }
    pushToBackend();
  }

  rt.registerCommands('selection', {
    set: ids => apply(validIds(ids)),
    add(ids) {
      apply(validIds([...new Set([...state.ids, ...ids])]));
    },
    remove(ids) {
      const drop = new Set(ids);
      apply(state.ids.filter(id => !drop.has(id)));
    },
    selectAll() {
      const sceneId = state.sceneId;
      const scene = sceneId ? ctx.doc?.scene(sceneId) : undefined;
      if (!scene) return;
      apply(scene.nodes.filter(n => !n.hidden).map(n => n.id));
    },
    clear: () => apply([]),
  });

  return {
    prune() {
      const sceneId = state.sceneId;
      const scene = sceneId ? ctx.doc?.scene(sceneId) : undefined;
      if (!scene) return apply([]);
      const known = new Set(scene.nodes.filter(n => !n.hidden).map(n => n.id));
      apply(state.ids.filter(id => known.has(id)));
    },
    reset() {
      state.sceneId = ctx.slices.scenes.activeSceneId;
      state.ids = [];
      state.lastId = null;
      pushToBackend();
    },
    resync() {
      sent = { sceneId: null, refs: [] };
      pushToBackend();
    },
    setIds: ids => apply(validIds(ids)),
  };
}
