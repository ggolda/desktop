// Scenes: slices `scenes` and `sceneItems:<sceneId>` plus the `scenes.*` and `sceneItems.*` commands.
import { randomUUID } from 'node:crypto';
import type { CanvasId, SceneItemsState } from '../../shared/contracts';
import {
  type FolderRec,
  type ItemRec,
  type NodeRec,
  type SceneRec,
  newFolderRec,
  newItemRec,
  reindexParents,
} from '../collections/document';
import { type Ctx, type Services, assignDeep, coded, nodeView, visibleNodes } from '../context';
import type { ItemSpec } from '../media/backend';
import { expandIds, insertOnTop, itemRefsTopFirst, removeNodes } from './tree';
import { registerSceneItems } from './items';

export interface ScenesApi {
  /** Fills the `scenes` slice from the document. */
  syncAll(): void;
  /** Refreshes the `sceneItems:<id>` slice if somebody subscribed. */
  refreshItems(sceneId: string): void;
  removeItemsOfSource(sourceId: string): Promise<void>;
  remove(id: string): Promise<void>;
  rename(id: string, name: string): void;
  makeActive(id: string): Promise<void>;
  /** Forget slices of the previous collection. */
  reset(): void;
  create(name: string, opts?: { duplicateFrom?: string; makeActive?: boolean }): Promise<string>;
  /** Adds an existing source on top of a scene. */
  addItem(
    sceneId: string,
    sourceId: string,
    opts?: { canvas?: CanvasId; select?: boolean },
  ): Promise<string>;
  /** Pushes the backend order of a scene after a structural change. */
  reorderBackend(scene: SceneRec): Promise<void>;
}

export function itemSpecOf(n: ItemRec): ItemSpec {
  return {
    sourceId: n.sourceId,
    canvas: n.canvas,
    transform: structuredClone(n.transform),
    ...n.settings,
  };
}

export function createScenesService(ctx: Ctx, svc: () => Services): ScenesApi {
  const { rt, backend } = ctx;
  const slice = ctx.slices.scenes;

  ctx.rt.defineSliceFactory('sceneItems', {
    create(sceneId): SceneItemsState {
      const scene = ctx.doc?.scene(sceneId);
      return { sceneId, nodes: scene ? visibleNodes(scene).map(nodeView) : [] };
    },
  });

  function syncAll() {
    const doc = ctx.doc;
    const next = doc ? doc.scenes.map(s => ({ id: s.id, name: s.name })) : [];
    const same =
      next.length === slice.scenes.length &&
      next.every((s, i) => s.id === slice.scenes[i].id && s.name === slice.scenes[i].name);
    if (!same) slice.scenes = next;
    if (slice.activeSceneId !== (doc?.activeSceneId ?? null)) {
      slice.activeSceneId = doc?.activeSceneId ?? null;
    }
  }

  function refreshItems(sceneId: string) {
    const s = rt.getSlice(`sceneItems:${sceneId}`);
    const scene = ctx.doc?.scene(sceneId);
    if (!s) return;
    if (!scene) {
      if (s.nodes.length) s.nodes = [];
      return;
    }
    const view = visibleNodes(scene).map(nodeView);
    const sameIds =
      view.length === s.nodes.length &&
      view.every((n, i) => n.id === s.nodes[i].id && n.kind === s.nodes[i].kind);
    if (sameIds) {
      view.forEach((n, i) =>
        assignDeep(
          s.nodes[i] as unknown as Record<string, unknown>,
          n as unknown as Record<string, unknown>,
        ),
      );
    } else s.nodes = view;
  }

  function scene(id: string): SceneRec {
    const sc = ctx.requireDoc().scene(id);
    if (!sc) throw coded(`unknown scene: ${id}`, 'ENOENT');
    return sc;
  }

  /** Scenes (transitively) contained in `sceneId`, used to refuse cycles. */
  function containsScene(sceneId: string, target: string, seen = new Set<string>()): boolean {
    if (seen.has(sceneId)) return false;
    seen.add(sceneId);
    const sc = ctx.doc?.scene(sceneId);
    if (!sc) return false;
    for (const n of sc.nodes) {
      if (n.kind !== 'item') continue;
      if (n.sourceId === target) return true;
      if (ctx.doc?.scene(n.sourceId) && containsScene(n.sourceId, target, seen)) return true;
    }
    return false;
  }

  async function addItem(
    sceneId: string,
    sourceId: string,
    opts: { canvas?: CanvasId; select?: boolean } = {},
  ): Promise<string> {
    ctx.requireMedia();
    const doc = ctx.requireDoc();
    const sc = scene(sceneId);
    const canvas = opts.canvas ?? 'horizontal';
    if (canvas !== 'horizontal') throw coded('only the horizontal canvas exists', 'EUNSUPPORTED');
    const src = doc.source(sourceId);
    const nested = doc.scene(sourceId);
    if (nested) {
      if (sourceId === sceneId || containsScene(sourceId, sceneId)) {
        throw coded('a scene cannot contain itself', 'ECYCLE');
      }
    } else if (!src || src.status !== 'ready') {
      throw coded(`unknown source: ${sourceId}`, 'ENOENT');
    }
    const rec = newItemRec({ sourceId, canvas });
    const [info] = await backend.scenes.addItems(sceneId, [itemSpecOf(rec)]);
    rec.ref = info.ref;
    rec.transform = info.transform;
    insertOnTop(sc, rec);
    ctx.touch.scene(sceneId);
    ctx.touch.item(rec.id);
    refreshItems(sceneId);
    svc().audio.recomputeMixer();
    rt.bus.emit('sceneItem.added', { sceneId, id: rec.id, sourceId });
    if (opts.select) svc().selection.setIds([rec.id]);
    return rec.id;
  }

  async function reorderBackend(sc: SceneRec) {
    await backend.scenes.reorder(sc.id, itemRefsTopFirst(sc));
  }

  async function removeNodesOf(sceneId: string, ids: string[]): Promise<string[]> {
    const sc = scene(sceneId);
    // backend first, then model and slices in one synchronous block (one patch batch)
    const gone = new Set(expandIds(sc, ids));
    for (const n of sc.nodes) {
      if (n.kind === 'item' && !n.hidden && gone.has(n.id) && n.ref !== undefined) {
        await backend.scenes.removeItem(sceneId, n.ref);
      }
    }
    const doomed = removeNodes(sc, ids);
    for (const n of doomed) if (n.kind === 'item') n.ref = undefined;
    ctx.touch.scene(sceneId);
    refreshItems(sceneId);
    svc().selection.prune();
    for (const n of doomed) {
      if (n.kind === 'item')
        rt.bus.emit('sceneItem.removed', { sceneId, id: n.id, sourceId: n.sourceId });
    }
    svc().audio.recomputeMixer();
    return doomed.flatMap(n => (n.kind === 'item' ? [n.sourceId] : []));
  }

  async function removeItemsOfSource(sourceId: string) {
    const doc = ctx.requireDoc();
    for (const sc of doc.scenes) {
      const ids = sc.nodes
        .filter((n): n is ItemRec => n.kind === 'item' && n.sourceId === sourceId)
        .filter(n => !n.hidden)
        .map(n => n.id);
      if (ids.length) await removeNodesOf(sc.id, ids);
      // foreign/unavailable leftovers of this source go too: the source is gone
      const dangling = sc.nodes.filter(
        n => n.kind === 'item' && n.hidden && n.sourceId === sourceId,
      );
      if (dangling.length) {
        sc.nodes = sc.nodes.filter(n => !dangling.includes(n));
        reindexParents(sc);
        ctx.touch.scene(sc.id);
      }
    }
  }

  async function makeActive(id: string) {
    ctx.requireMedia();
    const doc = ctx.requireDoc();
    const to = scene(id);
    const fromId = doc.activeSceneId;
    if (fromId === id) return;
    doc.activeSceneId = id;
    if (fromId) ctx.touch.scene(fromId);
    ctx.touch.scene(id);
    slice.activeSceneId = id;
    svc().selection.reset();
    await svc().transitions.switchTo(fromId, to.id);
    svc().audio.recomputeMixer();
    rt.bus.emit('scene.switched', { fromId, toId: id });
  }

  async function create(name: string, opts: { duplicateFrom?: string; makeActive?: boolean } = {}) {
    ctx.requireMedia();
    const doc = ctx.requireDoc();
    const id = `scene_${randomUUID()}`;
    const src = opts.duplicateFrom ? scene(opts.duplicateFrom) : null;
    const rec: SceneRec = { id, name, raw: null, nodes: [], hotkeysRaw: null };
    await backend.scenes.create(id);
    if (src) {
      // new item ids, same sources; folders keep their structure
      const idMap = new Map<string, string>();
      const copies: NodeRec[] = [];
      for (const n of visibleNodes(src)) {
        if (n.kind === 'item') {
          const c = newItemRec({ sourceId: n.sourceId, canvas: n.canvas });
          c.settings = { ...n.settings };
          c.transform = structuredClone(n.transform);
          if (n.cropRef) c.cropRef = { ...n.cropRef };
          idMap.set(n.id, c.id);
          copies.push(c);
        } else {
          const c: FolderRec = newFolderRec(n.name, n.canvas);
          idMap.set(n.id, c.id);
          copies.push(c);
        }
      }
      visibleNodes(src).forEach(n => {
        if (n.kind === 'folder') {
          const c = copies.find(x => x.id === idMap.get(n.id)) as FolderRec;
          c.childrenIds = n.childrenIds.map(k => idMap.get(k)).filter((k): k is string => !!k);
        }
      });
      rec.nodes = copies;
      reindexParents(rec);
      const items = [...copies].reverse().filter((n): n is ItemRec => n.kind === 'item');
      const infos = items.length
        ? await backend.scenes.addItems(
            id,
            items.map(n => itemSpecOf(n)),
          )
        : [];
      items.forEach((n, i) => {
        n.ref = infos[i].ref;
        n.transform = infos[i].transform;
      });
    }
    doc.addScene(rec);
    ctx.touch.scene(id);
    for (const n of rec.nodes) ctx.touch.item(n.id);
    syncAll();
    svc().sources.sync(id);
    rt.bus.emit('scene.added', { id, name });
    if (opts.makeActive) await makeActive(id);
    return id;
  }

  async function remove(id: string) {
    ctx.requireMedia();
    const doc = ctx.requireDoc();
    scene(id);
    if (doc.scenes.length <= 1) throw coded('cannot remove the last scene', 'EINVAL');
    if (doc.activeSceneId === id) {
      const other = doc.scenes.find(s => s.id !== id)!;
      await makeActive(other.id);
    }
    await removeItemsOfSource(id);
    await backend.scenes.remove(id);
    doc.removeScene(id);
    const t = doc.transitions;
    const before = t.connections.length;
    t.connections = t.connections.filter(c => c.fromSceneId !== id && c.toSceneId !== id);
    if (t.connections.length !== before) ctx.touch.transitions();
    syncAll();
    delete ctx.slices.sources.sources[id];
    ctx.touch.structure();
    rt.bus.emit('scene.removed', { id });
  }

  function rename(id: string, name: string) {
    const sc = scene(id);
    sc.name = name;
    ctx.touch.scene(id);
    syncAll();
    svc().sources.sync(id);
    rt.bus.emit('scene.renamed', { id, name });
  }

  rt.registerCommands('scenes', {
    create: (name, opts) => create(name, opts),
    remove: id => remove(id),
    rename: (id, name) => rename(id, name),
    makeActive: id => makeActive(id),
    reorder(ids) {
      const doc = ctx.requireDoc();
      const cur = doc.scenes.map(s => s.id);
      if (
        ids.length !== cur.length ||
        !ids.every(i => cur.includes(i)) ||
        new Set(ids).size !== ids.length
      ) {
        throw coded('reorder needs the full list of scene ids', 'EINVAL');
      }
      const byId = new Map(doc.scenes.map(s => [s.id, s]));
      doc.scenes.splice(0, doc.scenes.length, ...ids.map(i => byId.get(i)!));
      ctx.touch.structure();
      syncAll();
    },
  });

  registerSceneItems(ctx, svc, { scene, addItem, refreshItems, reorderBackend, removeNodesOf });

  return {
    syncAll,
    refreshItems,
    removeItemsOfSource,
    remove,
    rename,
    makeActive,
    addItem,
    create,
    reorderBackend,
    reset() {
      slice.scenes = [];
      slice.activeSceneId = null;
    },
  };
}
