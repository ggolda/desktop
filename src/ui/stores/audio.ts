import { defineStore } from 'pinia';
import { computed } from 'vue';
import { commands, useSlice } from '@/ui/core';
import { openDialog } from '@/ui/dialog/open';
import { run } from '@/ui/lib/run';
import { propertiesTitle } from '@/ui/source-types';

export interface MixerRowData {
  id: string;
  /** Position in `mixer.ids` = record index in the meters frame. */
  index: number;
  name: string;
  muted: boolean;
  /** 0..1 fader position (the slider edits this); `db` is what core says it means. */
  deflection: number;
  db: number;
}

/** Mixer rows: `audio` slice (`mixer.ids` order) + names from `sources`. Meters are not in slices. */
export const useAudioStore = defineStore('audio', () => {
  const audio = useSlice('audio');
  const sources = useSlice('sources');

  const rev = computed(() => audio.value?.mixer.rev);
  const rows = computed<MixerRowData[]>(() => {
    const a = audio.value;
    if (!a) return [];
    const out: MixerRowData[] = [];
    a.mixer.ids.forEach((id, index) => {
      const s = a.sources[id];
      if (!s || s.hidden) return;
      out.push({
        id,
        index,
        name: sources.value?.sources[id]?.name ?? id,
        muted: s.muted,
        deflection: s.deflection,
        db: s.db,
      });
    });
    return out;
  });
  return {
    rev,
    rows,
    setMuted: (id: string, muted: boolean) => run(commands.audio.setMuted(id, muted), 'setMuted'),
    setDeflection: (id: string, deflection: number) =>
      run(commands.audio.setFader(id, { deflection }), 'setFader'),
    setHidden: (id: string, hidden: boolean) =>
      run(commands.audio.setSettings(id, { hidden }), 'setSettings'),
    /** Legacy has no inline rename: the Rename Source window. */
    startRename: (id: string) =>
      openDialog({ kind: 'rename-source', params: { sourceId: id }, title: 'Rename Source' }),
    openProperties: (id: string) => {
      const src = sources.value?.sources[id];
      if (src?.status !== 'ready') return;
      openDialog({
        kind: 'source-properties',
        params: { sourceId: id },
        title: propertiesTitle(src.type),
      });
    },
    unhideAll: () => run(commands.audio.unhideAll(), 'unhideAll'),
  };
});
