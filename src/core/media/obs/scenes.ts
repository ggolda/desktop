// Scenes and scene items. Items are addressed by the backend's numeric id (ItemRef); the order is
// tracked locally (top-first) so reordering needs no read-back.
import type { PartialTransform, Transform } from '../../../shared/contracts';
import type { ItemInfo, ItemSpec, MediaBackend } from '../backend';
import {
  toBlendingMethod,
  toBlendingMode,
  toScaleFilter,
} from './enums';
import { type ObsState, type SceneState, missing } from './state';
import type { OsnInput, OsnSceneItem, OsnSceneItemInfo } from './types';

function scene(st: ObsState, id: string): SceneState {
  const s = st.scenes.get(id);
  if (!s) throw missing('scene', id);
  return s;
}

function readTransform(item: OsnSceneItem): Transform {
  // `position`/`scale` like the legacy app: `transformInfo.pos` is snapped to half pixels
  const p = item.position;
  const sc = item.scale;
  const c = item.crop;
  return {
    position: { x: p.x, y: p.y },
    scale: { x: sc.x, y: sc.y },
    rotation: item.rotation,
    crop: { left: c.left, top: c.top, right: c.right, bottom: c.bottom },
  };
}

export function createScenes(st: ObsState): MediaBackend['scenes'] {
  /** The input to add: a plain input, or the scene's own source for nested scenes. */
  function sourceOf(id: string): OsnInput {
    const i = st.inputs.get(id);
    if (i) return i;
    const nested = st.scenes.get(id);
    if (nested) return nested.scene.source;
    throw missing('source', id);
  }

  function toInfoObj(spec: ItemSpec): OsnSceneItemInfo {
    const t = spec.transform;
    return {
      name: spec.sourceId,
      crop: { ...t.crop },
      scaleX: t.scale.x,
      scaleY: t.scale.y,
      visible: spec.visible,
      x: t.position.x,
      y: t.position.y,
      rotation: t.rotation,
      streamVisible: spec.streamVisible,
      recordingVisible: spec.recordingVisible,
      scaleFilter: toScaleFilter(spec.scaleFilter),
      blendingMode: toBlendingMode(spec.blendingMode),
      blendingMethod: toBlendingMethod(spec.blendingMethod),
    };
  }

  function register(s: SceneState, items: OsnSceneItem[]): ItemInfo[] {
    const out: ItemInfo[] = [];
    for (const item of items) {
      const ref = item.id;
      s.items.set(ref, item);
      s.order.unshift(ref); // the newest item is the top one
      out.push({ ref, transform: readTransform(item) });
    }
    return out;
  }

  return {
    async create(id) {
      if (st.scenes.has(id)) return;
      const s = st.osn.SceneFactory.create(id);
      st.scenes.set(id, { scene: s, items: new Map(), order: [], selected: new Set() });
    },
    async remove(id) {
      const s = st.scenes.get(id);
      if (!s) return;
      st.scenes.delete(id);
      if (st.program.sceneId === id) st.program.sceneId = null;
      s.scene.release();
    },
    async duplicateItems() {
      // not used by core: duplicating a scene is "new item ids, same sources" through addItems, which
      // yields the refs core needs
      throw Object.assign(new Error('duplicateItems is not implemented'), { code: 'EUNSUPPORTED' });
    },
    async addItems(sceneId, specs) {
      const s = scene(st, sceneId);
      if (specs.length === 0) return [];
      for (const spec of specs) if (spec.canvas !== 'horizontal') throw Object.assign(new Error('canvas'), { code: 'EUNSUPPORTED' });
      // One call per item with the canvas video context bound explicitly, like legacy (scene.ts:493):
      // items added through the bulk `addItems` have no canvas and OBS does not draw their selection.
      const video = st.video.horizontal;
      if (!video) throw new Error('canvas not created');
      const made = specs.map(spec => s.scene.add(sourceOf(spec.sourceId), toInfoObj(spec), video));
      return register(s, made);
    },
    async removeItem(sceneId, ref) {
      const s = scene(st, sceneId);
      const item = s.items.get(ref);
      if (!item) return;
      item.remove();
      s.items.delete(ref);
      s.selected.delete(ref);
      const i = s.order.indexOf(ref);
      if (i >= 0) s.order.splice(i, 1);
    },
    async updateItem(sceneId, ref, patch) {
      const s = scene(st, sceneId);
      const item = s.items.get(ref);
      if (!item) throw missing('scene item', ref);
      const { transform, ...settings } = patch;
      item.deferUpdateBegin();
      try {
        if (transform) applyTransform(item, transform);
        if (settings.visible !== undefined) item.visible = settings.visible;
        if (settings.streamVisible !== undefined) item.streamVisible = settings.streamVisible;
        if (settings.recordingVisible !== undefined) item.recordingVisible = settings.recordingVisible;
        if (settings.scaleFilter !== undefined) item.scaleFilter = toScaleFilter(settings.scaleFilter);
        if (settings.blendingMode !== undefined) item.blendingMode = toBlendingMode(settings.blendingMode);
        if (settings.blendingMethod !== undefined) {
          item.blendingMethod = toBlendingMethod(settings.blendingMethod);
        }
        // `locked` is an app-level flag, the backend does not know it
      } finally {
        item.deferUpdateEnd();
      }
      return { ref, transform: readTransform(item) };
    },
    async reorder(sceneId, refsTopFirst) {
      const s = scene(st, sceneId);
      // legacy reconcile (scene.ts:437), with indexes tracked locally; indexes are top-first
      const target = refsTopFirst.filter(r => s.items.has(r));
      for (let to = 0; to < target.length; to++) {
        const from = s.order.indexOf(target[to]);
        if (from < 0 || from === to) continue;
        s.scene.moveItem(from, to);
        s.order.splice(from, 1);
        s.order.splice(to, 0, target[to]);
      }
    },
    async setSelected(sceneId, refs) {
      const s = scene(st, sceneId);
      const want = new Set(refs);
      for (const r of [...s.selected]) {
        if (want.has(r)) continue;
        const item = s.items.get(r);
        if (item) item.selected = false;
        s.selected.delete(r);
      }
      for (const r of want) {
        if (s.selected.has(r)) continue;
        const item = s.items.get(r);
        if (!item) continue;
        item.selected = true;
        s.selected.add(r);
      }
    },
    async getItem(sceneId, ref) {
      const item = scene(st, sceneId).items.get(ref);
      return item ? { ref, transform: readTransform(item) } : null;
    },
  };
}

function applyTransform(item: OsnSceneItem, t: PartialTransform) {
  if (t.position && (t.position.x !== undefined || t.position.y !== undefined)) {
    const cur = item.position;
    item.position = { x: t.position.x ?? cur.x, y: t.position.y ?? cur.y };
  }
  if (t.scale && (t.scale.x !== undefined || t.scale.y !== undefined)) {
    const cur = item.scale;
    item.scale = { x: t.scale.x ?? cur.x, y: t.scale.y ?? cur.y };
  }
  if (t.rotation !== undefined) item.rotation = t.rotation;
  if (t.crop) {
    const c = item.crop;
    item.crop = {
      left: t.crop.left ?? c.left,
      top: t.crop.top ?? c.top,
      right: t.crop.right ?? c.right,
      bottom: t.crop.bottom ?? c.bottom,
    };
  }
}
