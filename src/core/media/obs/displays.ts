// Native preview displays: `NodeObs.OBS_content_*` (untyped in OSN; argument lists from legacy
// video.ts:377-444). Sizes and positions are device pixels relative to the parent window.
import type { MediaBackend } from '../backend';
import { RENDERING_MODES } from './enums';
import type { ObsState } from './state';

// legacy video.ts: default padding color (11, 22, 28), passed raw to the backend. The backend encodes it
// to sRGB on output, which is what gives the grey-blue preview surround of the legacy editor.
const DEFAULT_PADDING = { r: 11, g: 22, b: 28 };

export function createDisplays(st: ObsState): MediaBackend['displays'] {
  const names = new Set<string>();
  const n = () => st.osn.NodeObs;
  const setPad = (id: string, c: { r: number; g: number; b: number }) =>
    n().OBS_content_setPaddingColor(id, c.r, c.g, c.b);
  return {
    async create(spec) {
      if (spec.canvas !== 'horizontal') {
        throw Object.assign(new Error('only the horizontal canvas exists'), { code: 'EUNSUPPORTED' });
      }
      const video = st.video.horizontal;
      if (!video) throw new Error('canvas not created');
      const handle = Buffer.from(spec.handle);
      if (spec.sourceId) {
        n().OBS_content_createSourcePreviewDisplay(handle, spec.sourceId, spec.id, false, video);
      } else {
        n().OBS_content_createDisplay(handle, spec.id, RENDERING_MODES[spec.mode], false, video);
      }
      names.add(spec.id);
      // legacy customization.setTheme: dark theme = night display colors
      n().OBS_content_setDayTheme(false);
      const pad = spec.paddingColor ?? DEFAULT_PADDING;
      setPad(spec.id, pad);
      if (spec.paddingSize !== undefined) n().OBS_content_setPaddingSize(spec.id, spec.paddingSize);
      n().OBS_content_setShouldDrawUI(spec.id, spec.drawUi);
      if (spec.drawUi) n().OBS_content_setDrawGuideLines(spec.id, true); // legacy: on by default
    },
    async moveResize(id, r) {
      n().OBS_content_moveDisplay(id, r.x, r.y);
      n().OBS_content_resizeDisplay(id, r.width, r.height);
    },
    async setDrawUi(id, draw) {
      n().OBS_content_setShouldDrawUI(id, draw);
    },
    async setGuidelines(id, on) {
      n().OBS_content_setDrawGuideLines(id, on);
    },
    async setPadding(id, p) {
      if (p.color) setPad(id, p.color);
      if (p.size !== undefined) n().OBS_content_setPaddingSize(id, p.size);
    },
    async getOutputRegion(id) {
      const o = n().OBS_content_getDisplayPreviewOffset(id) as { x: number; y: number };
      const s = n().OBS_content_getDisplayPreviewSize(id) as { width: number; height: number };
      return { x: o.x, y: o.y, width: s.width, height: s.height };
    },
    async destroy(id) {
      if (!names.delete(id)) return;
      n().OBS_content_destroyDisplay(id);
    },
  };
}
