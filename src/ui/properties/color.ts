/** Backend colour int `0xAABBGGRR` (legacy `Utils.rgbaToInt` / `intToRgba`) <-> `#rrggbbaa`. */
export function intToHex(value: number): string {
  const u = value >>> 0;
  const ch = [u & 255, (u >>> 8) & 255, (u >>> 16) & 255, (u >>> 24) & 255];
  return '#' + ch.map(c => c.toString(16).padStart(2, '0')).join('');
}

/** Accepts `#rgb`, `#rrggbb`, `#rrggbbaa` (with or without `#`); null when it is not a colour. */
export function hexToInt(hex: string, fallbackAlpha = 255): number | null {
  let h = hex.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = [...h].map(c => c + c).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) : fallbackAlpha;
  return r + g * 256 + b * 65536 + a * 16777216;
}

/** `#rrggbb` part of a colour int (what `<input type=color>` understands). */
export const intToRgbHex = (value: number) => intToHex(value).slice(0, 7);

export const alphaOf = (value: number) => (value >>> 24) & 255;
