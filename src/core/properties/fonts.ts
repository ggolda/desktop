// System font list through the native `font-manager` (an existing prebuilt module, SPEC 1). Loaded
// lazily, only when a font property is shown, never at startup.
import type { FontFace } from '../../shared/contracts';

export interface FontDescriptor {
  family: string;
  style: string;
  weight: number;
  italic: boolean;
  oblique: boolean;
}

const BOLD = 1;
const ITALIC = 2;

export function faceOf(f: FontDescriptor): FontFace {
  return {
    family: f.family,
    style: f.style,
    // legacy ObsSystemFontSelector.getFlagsFromFont
    flags: (f.italic || f.oblique ? ITALIC : 0) | (f.weight > 400 ? BOLD : 0),
    weight: f.weight,
    italic: !!(f.italic || f.oblique),
  };
}

export function sortFaces(list: FontFace[]): FontFace[] {
  return list.sort((a, b) => a.family.localeCompare(b.family) || a.weight - b.weight);
}

/** Reads the installed fonts. `loader` is injectable for tests. */
export async function loadSystemFonts(
  loader: () => Promise<FontDescriptor[]> = defaultLoader,
): Promise<FontFace[]> {
  return sortFaces((await loader()).map(faceOf));
}

function defaultLoader(): Promise<FontDescriptor[]> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fm = require('font-manager') as {
    getAvailableFonts(cb: (fonts: FontDescriptor[]) => void): void;
  };
  return new Promise(resolve => fm.getAvailableFonts(resolve));
}
