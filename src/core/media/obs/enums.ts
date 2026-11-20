// Numeric OSN values <-> domain strings (m1-design 2.4). Collection files store the same numbers.
import type { BlendingMethod, BlendingMode, ScaleFilter } from '../../../shared/contracts';

export const SCALE_FILTERS: ScaleFilter[] = [
  'disable',
  'point',
  'bicubic',
  'bilinear',
  'lanczos',
  'area',
];
export const BLENDING_MODES: BlendingMode[] = [
  'normal',
  'additive',
  'subtract',
  'screen',
  'multiply',
  'lighten',
  'darken',
];
export const BLENDING_METHODS: BlendingMethod[] = ['default', 'srgb-off'];

export const toScaleFilter = (v: ScaleFilter) => Math.max(0, SCALE_FILTERS.indexOf(v));
export const toBlendingMode = (v: BlendingMode) => Math.max(0, BLENDING_MODES.indexOf(v));
export const toBlendingMethod = (v: BlendingMethod) => Math.max(0, BLENDING_METHODS.indexOf(v));

/** ESourceOutputFlags */
export const OUTPUT_VIDEO = 1;
export const OUTPUT_AUDIO = 2;
export const OUTPUT_ASYNC = 4;
export const OUTPUT_DO_NOT_DUPLICATE = 128;

/** ESourceFlags */
export const FLAG_FORCE_MONO = 2;

/** EFaderType */
export const FADER_IEC = 1;

/** ERenderingMode */
export const RENDERING_MODES = { main: 0, streaming: 1, recording: 2 } as const;

/** Defaults of a fresh horizontal canvas (settings-v2/default-settings-data.ts). */
export const HORIZONTAL_DEFAULTS = {
  fpsNum: 30,
  fpsDen: 1,
  baseWidth: 1280,
  baseHeight: 720,
  outputWidth: 1280,
  outputHeight: 720,
  outputFormat: 1, // I420
  colorspace: 2, // CS709
  range: 2, // Full
  scaleType: 3, // Bilinear
  fpsType: 1, // Integer
};

export function msToTimeSpec(ms: number): { sec: number; nsec: number } {
  const sec = Math.floor(ms / 1000);
  return { sec, nsec: Math.round((ms - sec * 1000) * 1_000_000) };
}

export const timeSpecToMs = (t: { sec: number; nsec: number }) =>
  Math.round(t.sec * 1000 + t.nsec / 1_000_000);
