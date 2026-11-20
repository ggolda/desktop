import { shallowRef } from 'vue';
import { commands } from '@/ui/core';

export interface FontStyle {
  style: string;
  /** OBS font flags of the face: 1 bold, 2 italic. */
  flags: number;
}

/** family -> faces. Filled once, lazily, when the first Font property is shown. */
export const fontFamilies = shallowRef<Map<string, FontStyle[]>>(new Map());
let loading: Promise<void> | undefined;

/**
 * Installed system fonts: core reads them with the native `font-manager` on the first call
 * (`properties.fonts`, design open question 4). A failure leaves the list empty; the Font input then
 * offers only the current value.
 */
export function loadSystemFonts(): Promise<void> {
  loading ??= commands.properties
    .fonts()
    .then(faces => {
      const map = new Map<string, FontStyle[]>();
      for (const f of faces) {
        const list = map.get(f.family) ?? [];
        if (!list.some(s => s.style === f.style)) list.push({ style: f.style, flags: f.flags });
        map.set(f.family, list);
      }
      fontFamilies.value = new Map([...map].sort(([a], [b]) => a.localeCompare(b)));
    })
    .catch(e => {
      console.error('[properties] fonts failed:', e instanceof Error ? e.message : e);
      loading = undefined;
    });
  return loading;
}

/** Fallback flags from a style name (when the face is not in the list). */
export function flagsForStyle(style: string): number {
  const s = style.toLowerCase();
  return (s.includes('bold') ? 1 : 0) | (s.includes('italic') || s.includes('oblique') ? 2 : 0);
}
