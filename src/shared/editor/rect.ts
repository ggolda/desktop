// Port of the legacy `ScalableRectangle` (legacy/app/util/ScalableRectangle.ts): rectangles with
// scale (negative = flipped), crop and 90-degree rotations, normalized so editor math can ignore them.
// Kept line-for-line close to the original so the editor behaves the same.

export interface Vec2 {
  x: number;
  y: number;
}

export interface Crop {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface ScalableRectInit {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX?: number;
  scaleY?: number;
  crop?: Partial<Crop>;
  rotation?: number;
}

export enum AnchorPoint {
  North,
  NorthEast,
  East,
  SouthEast,
  South,
  SouthWest,
  West,
  NorthWest,
  Center,
}

/** Positions on a positive unit grid. */
export const AnchorPositions: Record<AnchorPoint, Vec2> = {
  [AnchorPoint.North]: { x: 0.5, y: 0 },
  [AnchorPoint.NorthEast]: { x: 1, y: 0 },
  [AnchorPoint.East]: { x: 1, y: 0.5 },
  [AnchorPoint.SouthEast]: { x: 1, y: 1 },
  [AnchorPoint.South]: { x: 0.5, y: 1 },
  [AnchorPoint.SouthWest]: { x: 0, y: 1 },
  [AnchorPoint.West]: { x: 0, y: 0.5 },
  [AnchorPoint.NorthWest]: { x: 0, y: 0 },
  [AnchorPoint.Center]: { x: 0.5, y: 0.5 },
};

/** Plain axis-aligned rectangle. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** `{ x: 0, y: 0 }` is the top-left corner of the box, `{ x: 1, y: 1 }` the bottom-right. */
export const offsetFromOrigin = (b: Box, origin: Vec2): Vec2 => ({
  x: b.x + b.width * origin.x,
  y: b.y + b.height * origin.y,
});
export const originFromOffset = (b: Box, offset: Vec2): Vec2 => ({
  x: (offset.x - b.x) / b.width,
  y: (offset.y - b.y) / b.height,
});

type Field =
  | 'width'
  | 'height'
  | 'scaleX'
  | 'scaleY'
  | 'crop.top'
  | 'crop.right'
  | 'crop.bottom'
  | 'crop.left';

export class ScalableRectangle implements Box {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  crop: Crop;
  rotation: number;
  private origin: Vec2 = { ...AnchorPositions[AnchorPoint.NorthWest] };

  constructor(o: ScalableRectInit) {
    this.x = o.x;
    this.y = o.y;
    this.width = o.width;
    this.height = o.height;
    this.scaleX = o.scaleX || 1;
    this.scaleY = o.scaleY || 1;
    this.crop = { top: 0, bottom: 0, left: 0, right: 0, ...o.crop };
    this.rotation = o.rotation || 0;
  }

  get croppedWidth() {
    return this.width - this.crop.left - this.crop.right;
  }
  get croppedHeight() {
    return this.height - this.crop.top - this.crop.bottom;
  }
  get scaledWidth() {
    return this.scaleX * this.croppedWidth;
  }
  get scaledHeight() {
    return this.scaleY * this.croppedHeight;
  }
  get aspectRatio() {
    return this.width / this.height;
  }
  get scaledAspectRatio() {
    return this.scaledWidth / this.scaledHeight;
  }

  setAnchor(anchor: AnchorPoint) {
    this.setOrigin(AnchorPositions[anchor]);
  }

  setOrigin(newOrigin: Vec2) {
    const dx = newOrigin.x - this.origin.x;
    const dy = newOrigin.y - this.origin.y;
    this.x += dx * this.scaledWidth;
    this.y += dy * this.scaledHeight;
    this.origin = { x: newOrigin.x, y: newOrigin.y };
  }

  private get(f: Field): number {
    return f.startsWith('crop.') ? this.crop[f.slice(5) as keyof Crop] : this[f as 'width'];
  }
  private set(f: Field, v: number) {
    if (f.startsWith('crop.')) this.crop[f.slice(5) as keyof Crop] = v;
    else this[f as 'width'] = v;
  }
  private mapFields(fields: Partial<Record<Field, Field>>) {
    const entries = Object.entries(fields) as [Field, Field][];
    const values = entries.map(([, from]) => this.get(from));
    entries.forEach(([to], i) => this.set(to, values[i]));
  }

  /**
   * Adjusts width, height, position and crop to make this look like an unrotated object. Only works on
   * 90 degree increments. Returns a function that undoes the operation.
   */
  private zeroRotation() {
    let map: Partial<Record<Field, Field>> = {};
    let origin = AnchorPositions[AnchorPoint.NorthWest];
    if (this.rotation === 90) {
      map = {
        width: 'height',
        height: 'width',
        scaleX: 'scaleY',
        scaleY: 'scaleX',
        'crop.top': 'crop.left',
        'crop.right': 'crop.top',
        'crop.bottom': 'crop.right',
        'crop.left': 'crop.bottom',
      };
      origin = AnchorPositions[AnchorPoint.NorthEast];
    } else if (this.rotation === 180) {
      map = {
        'crop.top': 'crop.bottom',
        'crop.right': 'crop.left',
        'crop.bottom': 'crop.top',
        'crop.left': 'crop.right',
      };
      origin = AnchorPositions[AnchorPoint.SouthEast];
    } else if (this.rotation === 270) {
      map = {
        width: 'height',
        height: 'width',
        scaleX: 'scaleY',
        scaleY: 'scaleX',
        'crop.top': 'crop.right',
        'crop.right': 'crop.bottom',
        'crop.bottom': 'crop.left',
        'crop.left': 'crop.top',
      };
      origin = AnchorPositions[AnchorPoint.SouthWest];
    }
    this.mapFields(map);
    this.origin = { ...origin };
    // the editor math assumes all rectangles are anchored at the north-west corner
    this.setAnchor(AnchorPoint.NorthWest);
    const rotation = this.rotation;
    this.rotation = 0;
    const inverse: Partial<Record<Field, Field>> = {};
    for (const [to, from] of Object.entries(map) as [Field, Field][]) inverse[from] = to;
    return () => {
      this.rotation = rotation;
      this.setOrigin(origin);
      this.mapFields(inverse);
    };
  }

  withAnchor(anchor: AnchorPoint, fun: () => void) {
    this.withOrigin(AnchorPositions[anchor], fun);
  }

  withOrigin(origin: Vec2, fun: () => void) {
    const old = this.origin;
    this.setOrigin(origin);
    fun();
    this.setOrigin(old);
  }

  /** Removes negative scales and rotation. Returns a function that undoes it. */
  normalize(): () => void {
    const derotate = this.zeroRotation();
    const xFlipped = this.scaleX < 0;
    const yFlipped = this.scaleY < 0;
    if (xFlipped) this.flipX();
    if (yFlipped) this.flipY();
    return () => {
      if (xFlipped) this.flipX();
      if (yFlipped) this.flipY();
      derotate();
    };
  }

  normalized(fun: () => void) {
    const denormalize = this.normalize();
    fun();
    denormalize();
  }

  flipX() {
    this.scaleX *= -1;
    this.x -= this.scaledWidth;
    const left = this.crop.left;
    this.crop.left = this.crop.right;
    this.crop.right = left;
  }

  flipY() {
    this.scaleY *= -1;
    this.y -= this.scaledHeight;
    const top = this.crop.top;
    this.crop.top = this.crop.bottom;
    this.crop.bottom = top;
  }
}

/** The visual bounding box of an item: normalized, scaled and cropped (legacy `getBoundingRect`). */
export function boundingBox(o: ScalableRectInit): Box {
  const r = new ScalableRectangle(o);
  r.normalize();
  return { x: r.x, y: r.y, width: r.scaledWidth, height: r.scaledHeight };
}
