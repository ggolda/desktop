// `editor.*`: on-demand geometry for the preview overlay (SPEC R10, m1-design 9.6). Source sizes come
// from the backend during the call (a window capture can change size at any time), so nothing here is
// cached or kept current by timers.
import type { CanvasId, EditorGeometry, EditorItemGeometry } from '../../shared/contracts';
import { type Ctx } from '../context';

export function registerEditor(ctx: Ctx) {
  const { rt, backend } = ctx;

  rt.registerCommands('editor', {
    async getGeometry(canvas: CanvasId = 'horizontal'): Promise<EditorGeometry | null> {
      const doc = ctx.doc;
      const sceneId = ctx.slices.scenes.activeSceneId;
      const base = ctx.slices.canvases[canvas];
      const scene = sceneId ? doc?.scene(sceneId) : undefined;
      if (!doc || !sceneId || !scene || !base || ctx.loading || !ctx.backendReady) return null;

      const nodes = scene.nodes.filter(n => !n.hidden && n.canvas === canvas);
      const inputIds = new Set<string>();
      for (const n of nodes)
        if (n.kind === 'item' && !doc.scene(n.sourceId)) inputIds.add(n.sourceId);
      const sizes = inputIds.size ? await backend.sources.getSizes([...inputIds]) : {};

      const items: EditorItemGeometry[] = [];
      const folders: EditorGeometry['folders'] = [];
      for (const n of nodes) {
        if (n.kind === 'folder') {
          folders.push({ id: n.id, parentId: n.parentId });
          continue;
        }
        // a nested scene is as big as the canvas, other sources report their own size
        const nested = !!doc.scene(n.sourceId);
        const sz = nested ? { width: base.baseWidth, height: base.baseHeight } : sizes[n.sourceId];
        const t = n.transform;
        items.push({
          id: n.id,
          sourceId: n.sourceId,
          parentId: n.parentId,
          x: t.position.x,
          y: t.position.y,
          scaleX: t.scale.x,
          scaleY: t.scale.y,
          rotation: ((t.rotation % 360) + 360) % 360,
          crop: { ...t.crop },
          width: sz?.width ?? 0,
          height: sz?.height ?? 0,
          visible: n.settings.visible,
          locked: n.settings.locked,
        });
      }
      return {
        sceneId,
        canvas,
        baseWidth: base.baseWidth,
        baseHeight: base.baseHeight,
        items,
        folders,
      };
    },
  });
}
