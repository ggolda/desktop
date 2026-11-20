// Pure placement of the dialog window (no Electron import: unit tested).

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Pure: clamps the size to the work area, and centers on the parent bounds (legacy `centerChildWindow`). */
export function placeDialog(
  size: { width: number; height: number },
  parent: Rect | null,
  workArea: Rect,
  center: boolean,
): { width: number; height: number; x?: number; y?: number } {
  const width = Math.min(size.width, workArea.width);
  const height = Math.min(size.height, workArea.height);
  if (!center) return { width, height };
  const p = parent ?? workArea;
  const x = Math.min(
    Math.max(Math.round(p.x + (p.width - width) / 2), workArea.x),
    workArea.x + workArea.width - width,
  );
  const y = Math.min(
    Math.max(Math.round(p.y + (p.height - height) / 2), workArea.y),
    workArea.y + workArea.height - height,
  );
  return { width, height, x, y };
}
