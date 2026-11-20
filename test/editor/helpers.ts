import type { EditorGeometry, EditorItemGeometry } from '@/shared/contracts';

export const item = (id: string, over: Partial<EditorItemGeometry> = {}): EditorItemGeometry => ({
  id,
  sourceId: `src-${id}`,
  parentId: null,
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  crop: { left: 0, top: 0, right: 0, bottom: 0 },
  width: 100,
  height: 50,
  visible: true,
  locked: false,
  ...over,
});
export const geo = (
  items: EditorItemGeometry[],
  folders: EditorGeometry['folders'] = [],
): EditorGeometry => ({
  sceneId: 's',
  canvas: 'horizontal',
  baseWidth: 1920,
  baseHeight: 1080,
  items,
  folders,
});
