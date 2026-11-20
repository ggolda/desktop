// Video contexts. M1 creates only the horizontal one (owner decision 4); the vertical canvas and
// everything about dual output is preserved in the documents but not created.
import type { CanvasId } from '../../../shared/contracts';
import type { CanvasInfo, MediaBackend } from '../backend';
import { HORIZONTAL_DEFAULTS } from './enums';
import type { ObsState } from './state';
import type { OsnVideo, VideoInfo } from './types';

const invalidFps = (num: number, den: number) => num / den > 1000 || num / den < 1;

function toInfo(id: CanvasId, v: VideoInfo): CanvasInfo {
  return {
    id,
    baseWidth: v.baseWidth,
    baseHeight: v.baseHeight,
    outputWidth: v.outputWidth,
    outputHeight: v.outputHeight,
    fpsNum: v.fpsNum,
    fpsDen: v.fpsDen,
  };
}

const unsupported = (id: CanvasId) =>
  Object.assign(new Error(`canvas ${id} is not supported in M1`), { code: 'EUNSUPPORTED' });

export function createCanvases(st: ObsState): MediaBackend['canvases'] {
  const copy = (v: VideoInfo): VideoInfo => ({ ...v });
  return {
    async ensure(id) {
      if (id !== 'horizontal') throw unsupported(id);
      if (!st.video.horizontal) {
        const ctx: OsnVideo = st.osn.VideoFactory.create();
        // settings come from OBS's own config (legacySettings) the first time; a fresh profile reads
        // back 0x0 and is seeded with the defaults (settings-v2/video.ts:340-360). We never write the
        // config files; only the context's `video` is set (not `legacySettings`).
        const legacy = copy(ctx.legacySettings);
        const next =
          !legacy.baseWidth || !legacy.baseHeight ? { ...HORIZONTAL_DEFAULTS } : legacy;
        if (invalidFps(next.fpsNum, next.fpsDen)) {
          next.fpsNum = 30;
          next.fpsDen = 1;
        }
        ctx.video = next;
        st.osn.Video.video = next;
        st.video.horizontal = ctx;
      }
      return toInfo(id, copy(st.video.horizontal.video));
    },
    async get(id) {
      if (id !== 'horizontal' || !st.video.horizontal) return null;
      return toInfo(id, copy(st.video.horizontal.video));
    },
    async setBaseResolution(id, size) {
      if (id !== 'horizontal') throw unsupported(id);
      const ctx = st.video.horizontal;
      if (!ctx) throw new Error('canvas not created');
      const next = { ...copy(ctx.video), baseWidth: size.width, baseHeight: size.height };
      ctx.video = next;
      st.osn.Video.video = next;
    },
    async destroy(id) {
      if (id !== 'horizontal' || !st.video.horizontal) return;
      st.video.horizontal.destroy();
      st.video.horizontal = null;
    },
  };
}
