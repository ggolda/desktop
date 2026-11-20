// `sceneItems.*` commands: add, remove, update, transform, move, folders.
import type {
  CanvasId,
  PartialTransform,
  SceneItemPatch,
  SceneItemSettings,
  SourceCreateSpec,
  TransformAction,
} from '../../shared/contracts';
import { type ItemRec, type SceneRec, newFolderRec } from '../collections/document';
import { type Ctx, type Services, coded } from '../context';
import { moveNodes } from './tree';

export interface ItemHelpers {
  scene(id: string): SceneRec;
  addItem(
    sceneId: string,
    sourceId: string,
    opts?: { canvas?: CanvasId; select?: boolean },
  ): Promise<string>;
  refreshItems(sceneId: string): void;
  reorderBackend(scene: SceneRec): Promise<void>;
  /** Returns the source ids of the removed items. */
  removeNodesOf(sceneId: string, ids: string[]): Promise<string[]>;
}

const num = (v: number, d: number) => (Number.isFinite(v) ? v : d);

/** The size of an item before scaling and cropping, in source pixels. */
function sourceSize(ctx: Ctx, n: ItemRec): { w: number; h: number } {
  const doc = ctx.requireDoc();
  const src = doc.source(n.sourceId);
  if (src) return { w: src.width, h: src.height };
  if (doc.scene(n.sourceId)) {
    const c = ctx.slices.canvases.horizontal;
    return { w: c?.baseWidth ?? 0, h: c?.baseHeight ?? 0 };
  }
  return { w: 0, h: 0 };
}

/** New transform for a transform action (m1-design: computed in core from canvas, source size). */
function applyAction(ctx: Ctx, n: ItemRec, action: TransformAction): PartialTransform | null {
  const t = n.transform;
  const canvas = ctx.slices.canvases.horizontal;
  const cw = canvas?.baseWidth ?? 0;
  const ch = canvas?.baseHeight ?? 0;
  const { w: sw, h: sh } = sourceSize(ctx, n);
  const cropW = Math.max(sw - t.crop.left - t.crop.right, 0);
  const cropH = Math.max(sh - t.crop.top - t.crop.bottom, 0);
  const w = cropW * Math.abs(t.scale.x);
  const h = cropH * Math.abs(t.scale.y);
  switch (action.type) {
    case 'reset':
      return {
        scale: { x: 1, y: 1 },
        rotation: 0,
        crop: { left: 0, top: 0, right: 0, bottom: 0 },
      };
    case 'flipX':
      return {
        scale: { x: -t.scale.x },
        position: { x: t.position.x + (t.scale.x >= 0 ? w : -w) },
      };
    case 'flipY':
      return {
        scale: { y: -t.scale.y },
        position: { y: t.position.y + (t.scale.y >= 0 ? h : -h) },
      };
    case 'stretch':
      if (!cropW || !cropH || !cw || !ch) return null;
      return { position: { x: 0, y: 0 }, scale: { x: cw / cropW, y: ch / cropH }, rotation: 0 };
    case 'fit': {
      if (!cropW || !cropH || !cw || !ch) return null;
      const s = Math.min(cw / cropW, ch / cropH);
      return {
        position: { x: (cw - cropW * s) / 2, y: (ch - cropH * s) / 2 },
        scale: { x: s, y: s },
        rotation: 0,
      };
    }
    case 'center':
      if (!cw || !ch) return null;
      return {
        position: {
          x: (cw - w) / 2 + (t.scale.x < 0 ? w : 0),
          y: (ch - h) / 2 + (t.scale.y < 0 ? h : 0),
        },
      };
    case 'rotate': {
      // rotate around the visual center
      const sx = t.scale.x >= 0 ? 1 : -1;
      const sy = t.scale.y >= 0 ? 1 : -1;
      const half = { x: (w / 2) * sx, y: (h / 2) * sy };
      const rot = (deg: number, v: { x: number; y: number }) => {
        const r = (deg * Math.PI) / 180;
        return {
          x: v.x * Math.cos(r) - v.y * Math.sin(r),
          y: v.x * Math.sin(r) + v.y * Math.cos(r),
        };
      };
      const c0 = rot(t.rotation, half);
      const center = { x: t.position.x + c0.x, y: t.position.y + c0.y };
      const next = (((t.rotation + action.deg) % 360) + 360) % 360;
      const c1 = rot(next, half);
      return { rotation: next, position: { x: center.x - c1.x, y: center.y - c1.y } };
    }
  }
}

export function registerSceneItems(ctx: Ctx, svc: () => Services, h: ItemHelpers) {
  const { rt, backend } = ctx;

  function itemsOf(sceneId: string, ids: string[]): ItemRec[] {
    const sc = h.scene(sceneId);
    return ids.map(id => {
      const n = sc.nodes.find(x => x.id === id && !x.hidden);
      if (!n || n.kind !== 'item') throw coded(`unknown item: ${id}`, 'ENOENT');
      return n;
    });
  }

  /** Applies a settings/transform patch per item (one backend call each), then updates everything once. */
  async function patchItems(sceneId: string, entries: { item: ItemRec; patch: SceneItemPatch }[]) {
    ctx.requireMedia();
    for (const { item, patch } of entries) {
      if (item.ref === undefined) continue;
      const info = await backend.scenes.updateItem(sceneId, item.ref, patch);
      const settings: Partial<SceneItemSettings> = { ...patch };
      delete (settings as SceneItemPatch).transform;
      Object.assign(item.settings, settings);
      item.transform = info.transform;
      ctx.touch.item(item.id);
    }
    h.refreshItems(sceneId);
    for (const { item } of entries) rt.bus.emit('sceneItem.updated', { sceneId, id: item.id });
  }

  rt.registerCommands('sceneItems', {
    add: (sceneId, sourceId, opts) => h.addItem(sceneId, sourceId, opts),
    async addNew(sceneId, spec: SourceCreateSpec, opts) {
      ctx.requireMedia();
      h.scene(sceneId);
      const sourceId = await svc().sources.create(spec);
      try {
        const itemId = await h.addItem(sceneId, sourceId, opts);
        return { sourceId, itemId };
      } catch (e) {
        await svc()
          .sources.remove(sourceId)
          .catch(() => undefined);
        throw e;
      }
    },
    async remove(sceneId, nodeIds) {
      const sourceIds = await h.removeNodesOf(sceneId, nodeIds);
      // legacy onSceneItemRemovedHandler: a source whose last item is gone is removed with it
      // (scenes stay: they are removed explicitly)
      const doc = ctx.requireDoc();
      for (const id of new Set(sourceIds)) {
        if (!doc.source(id) || doc.scene(id)) continue;
        const used = doc.scenes.some(sc =>
          sc.nodes.some(n => n.kind === 'item' && n.sourceId === id),
        );
        if (!used) await svc().sources.remove(id);
      }
    },
    async update(sceneId, itemIds, patch) {
      const items = itemsOf(sceneId, itemIds);
      await patchItems(
        sceneId,
        items.map(item => ({ item, patch })),
      );
    },
    async transform(sceneId, updates) {
      const items = itemsOf(
        sceneId,
        updates.map(u => u.id),
      );
      await patchItems(
        sceneId,
        items.map((item, i) => ({ item, patch: { transform: updates[i].transform } })),
      );
    },
    async translate(sceneId, itemIds, delta) {
      const items = itemsOf(sceneId, itemIds);
      await patchItems(
        sceneId,
        items.map(item => ({
          item,
          patch: {
            transform: {
              position: {
                x: item.transform.position.x + num(delta.x, 0),
                y: item.transform.position.y + num(delta.y, 0),
              },
            },
          },
        })),
      );
    },
    async transformAction(sceneId, itemIds, action) {
      const items = itemsOf(sceneId, itemIds);
      const entries: { item: ItemRec; patch: SceneItemPatch }[] = [];
      for (const item of items) {
        const t = applyAction(ctx, item, action);
        if (!t) continue;
        // sanitize
        if (t.position) {
          t.position.x = t.position.x === undefined ? undefined : num(t.position.x, 0);
          t.position.y = t.position.y === undefined ? undefined : num(t.position.y, 0);
        }
        entries.push({ item, patch: { transform: t } });
      }
      await patchItems(sceneId, entries);
    },
    async move(sceneId, nodeIds, to) {
      ctx.requireMedia();
      const sc = h.scene(sceneId);
      if (!moveNodes(sc, nodeIds, to)) throw coded('invalid move', 'EINVAL');
      ctx.touch.scene(sceneId);
      for (const id of nodeIds) ctx.touch.item(id);
      for (const n of sc.nodes) if (n.kind === 'folder') ctx.touch.item(n.id);
      h.refreshItems(sceneId);
      await h.reorderBackend(sc);
    },
    async createFolder(sceneId, name, nodeIds) {
      ctx.requireMedia();
      const sc = h.scene(sceneId);
      const folder = newFolderRec(name);
      if (nodeIds?.length) {
        const first = sc.nodes.findIndex(n => !n.hidden && nodeIds.includes(n.id));
        if (first < 0) throw coded('unknown node', 'ENOENT');
        sc.nodes.splice(first, 0, folder);
        if (!moveNodes(sc, nodeIds, { type: 'into', folderId: folder.id })) {
          sc.nodes.splice(first, 1);
          throw coded('invalid move', 'EINVAL');
        }
      } else {
        sc.nodes.unshift(folder);
      }
      ctx.touch.scene(sceneId);
      ctx.touch.item(folder.id);
      for (const n of sc.nodes)
        if (n.kind === 'folder' || nodeIds?.includes(n.id)) ctx.touch.item(n.id);
      h.refreshItems(sceneId);
      await h.reorderBackend(sc);
      return folder.id;
    },
    renameFolder(sceneId, folderId, name) {
      const sc = h.scene(sceneId);
      const f = sc.nodes.find(n => n.id === folderId && !n.hidden);
      if (!f || f.kind !== 'folder') throw coded(`unknown folder: ${folderId}`, 'ENOENT');
      f.name = name;
      ctx.touch.scene(sceneId);
      ctx.touch.item(folderId);
      h.refreshItems(sceneId);
    },
  });
}
