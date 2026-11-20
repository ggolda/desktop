<script setup lang="ts">
import { useDocumentVisibility, useWindowFocus } from '@vueuse/core';
import { computed, reactive, ref, watch } from 'vue';
import type { DeepReadonly } from 'vue';
import type { SourceTypeEntry } from '@/shared/contracts';

type Entry = DeepReadonly<SourceTypeEntry>;
import { commands } from '@/ui/core';
import DialogLayout from '@/ui/dialog/DialogLayout.vue';
import { closeDialogWindow, useDialog } from '@/ui/dialog/useDialog';
import { t } from '@/ui/i18n';
import { demoUrl, sleepingKevin } from './demos';
import SourceTile from './SourceTile.vue';

// legacy SourceShowcase: tabs, search, collapsible sections of 3-column tiles, 300 px side panel
const { state } = useDialog<'source-showcase'>();

type Tab = 'all' | 'general' | 'widgets' | 'apps';
const tab = ref<Tab>('all');
const search = ref('');
const selectedId = ref<string>('');
const collapsed = reactive(new Set<string>()); // in memory only (legacy: all sections open)

const entries = computed<readonly Entry[]>(
  () => state.value?.data.catalogue.entries.filter(e => e.availability !== 'hidden') ?? [],
);
watch(
  () => state.value?.data.catalogue.initial,
  id => {
    if (id && !selectedId.value) selectedId.value = id;
  },
  { immediate: true },
);

const selected = computed(() => entries.value.find(e => e.id === selectedId.value));
const hasApps = computed(() => entries.value.some(e => e.group === 'app'));
const tabs = computed<[Tab, string][]>(() => [
  ['all', 'All Sources'],
  ['general', 'Media Categories'],
  ['widgets', 'Widgets'],
  ...(hasApps.value ? ([['apps', 'Apps']] as [Tab, string][]) : []),
]);

// legacy matches with Fuse (keys type, name, short description, description; threshold .3): every
// token must appear in one of those fields, which is the same result for the usual queries
const matches = (e: Entry) => {
  const q = search.value.trim().toLowerCase();
  if (!q) return true;
  const hay = [e.sourceType, e.name, e.shortDescription ?? '', e.description]
    .join('\n')
    .toLowerCase();
  return q.split(/\s+/).every(tok => hay.includes(tok));
};
const visible = computed(() => entries.value.filter(matches));

interface Section {
  id: string;
  title: string;
  tiles: Entry[];
}
const sections = computed<Section[]>(() => {
  const list = visible.value;
  const grp = (g: Entry['group']) => list.filter(e => e.group === g);
  const essentials = list
    .filter(e => e.essentialOrder !== undefined)
    .sort((a, b) => a.essentialOrder! - b.essentialOrder!);
  const groups: Section[] = [
    { id: 'captureSources', title: 'Capture Sources', tiles: grp('capture') },
    { id: 'avSources', title: 'Video and Audio', tiles: grp('av') },
    { id: 'mediaSources', title: 'Media', tiles: grp('media') },
  ];
  const out: Section[] = [];
  if (tab.value === 'all') {
    out.push({ id: 'essentialSources', title: 'Essentials', tiles: essentials });
    out.push(...groups);
    out.push({ id: 'widgets', title: 'Widgets', tiles: grp('widget') });
    if (!search.value.trim()) out.push({ id: 'apps', title: 'Apps', tiles: grp('app') });
  } else if (tab.value === 'general') {
    out.push(...groups);
  } else if (tab.value === 'widgets') {
    out.push({ id: 'widgets', title: 'Widgets', tiles: grp('widget') });
  } else {
    out.push({ id: 'apps', title: 'Apps', tiles: grp('app') });
  }
  return out.filter(s => s.tiles.length > 0).map(s => ({ ...s, title: t(s.title) }));
});

const widgetsAvailable = computed(() => state.value?.data.catalogue.widgets.available ?? false);
// the Widgets tab shows the logged-out placeholder (no login button until the `user` feature exists)
const showWidgetsPlaceholder = computed(() => tab.value === 'widgets' && !widgetsAvailable.value);

function toggle(id: string) {
  if (!collapsed.delete(id)) collapsed.add(id);
}

const adding = ref(false);
async function pick(entry: Entry | undefined = selected.value) {
  if (!entry || entry.availability !== 'available' || adding.value) return;
  adding.value = true;
  try {
    await commands.dialogs.open({
      kind: 'add-source',
      params: { catalogueId: entry.id },
      title: 'Add Source',
    });
  } catch (e) {
    console.error('[dialog] open add-source failed:', e instanceof Error ? e.message : e);
    adding.value = false;
  }
}
function pickTile(e: Entry) {
  selectedId.value = e.id;
  void pick(e);
}

// side panel preview: image, or a looping video only while the window is visible and focused
const previewSrc = computed(() =>
  selected.value?.demo ? demoUrl(selected.value.demo.file) : undefined,
);
const isVideo = computed(() => !!selected.value?.demo?.video);
const video = ref<HTMLVideoElement | null>(null);
const pageVisible = useDocumentVisibility();
const focused = useWindowFocus();
watch(
  [video, pageVisible, focused, previewSrc],
  ([el, vis, foc]) => {
    if (!el) return;
    if (vis === 'visible' && foc) void el.play().catch(() => {});
    else el.pause();
  },
  { flush: 'post' },
);

function openLink(url: string) {
  window.open(url, '_blank', 'noopener');
}
</script>

<template>
  <DialogLayout v-if="state" :title="state.title" :padded="false" :scroll="false">
    <div class="flex h-full" data-testid="showcase">
      <div class="flex min-w-0 flex-1 flex-col">
        <div class="flex h-[46px] shrink-0 items-center border-b border-solid border-line">
          <nav class="flex h-full" role="tablist">
            <button
              v-for="[key, label] in tabs"
              :key="key"
              role="tab"
              :aria-selected="tab === key"
              :data-testid="`tab-${key}`"
              class="relative m-0 box-border h-full cursor-pointer border-0 bg-transparent px-5 font-[inherit] text-[14px] whitespace-nowrap transition-colors"
              :class="tab === key ? 'text-title' : 'text-para hover:text-title'"
              @click="tab = key"
            >
              {{ t(label) }}
              <span v-if="tab === key" class="absolute inset-x-5 bottom-0 h-[2px] bg-title" />
            </button>
          </nav>
          <div class="flex-1" />
          <div v-if="tab !== 'apps'" class="relative mr-2 w-[242px]">
            <i
              class="fas fa-search pointer-events-none absolute top-1/2 left-[11px] -translate-y-1/2 text-[12px] text-icon"
            />
            <input
              v-model="search"
              type="text"
              class="sl-input !pr-[28px] !pl-[30px]"
              :placeholder="t('Search...')"
              data-testid="search"
            />
            <i
              v-if="search"
              class="icon-close absolute top-1/2 right-[10px] -translate-y-1/2 cursor-pointer text-[12px] text-icon hover:text-title"
              data-testid="search-clear"
              @click="search = ''"
            />
          </div>
        </div>

        <div class="dlg-scroll min-h-0 flex-1 overflow-y-auto" data-testid="grid">
          <div
            v-if="showWidgetsPlaceholder"
            class="flex flex-col items-center text-center"
            data-testid="widgets-empty"
          >
            <img :src="sleepingKevin" alt="" class="w-[115px]" draggable="false" />
            <div class="mt-[4px] text-[14px] text-para">
              {{ t('You must be logged in to use Widgets') }}
            </div>
          </div>
          <template v-else>
            <section v-for="s in sections" :key="s.id" :data-testid="`section-${s.id}`">
              <button
                class="m-0 flex h-[54px] w-full cursor-pointer items-center border-0 bg-transparent p-0 pl-3 text-left font-[inherit] text-[20px] text-title"
                :aria-expanded="!collapsed.has(s.id)"
                @click="toggle(s.id)"
              >
                <svg
                  class="mr-3 shrink-0 text-icon"
                  :class="collapsed.has(s.id) && '-rotate-90'"
                  width="12"
                  height="12"
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.1"
                  aria-hidden="true"
                >
                  <path d="M1.5 3.25 5 6.75l3.5-3.5" />
                </svg>
                {{ s.title }}
              </button>
              <div
                v-show="!collapsed.has(s.id)"
                class="grid grid-cols-3 gap-2 pt-[13px] pr-[10px] pb-5 pl-4"
              >
                <SourceTile
                  v-for="(e, i) in s.tiles"
                  :key="`${s.id}:${e.id}:${i}`"
                  :entry="e"
                  :active="e.id === selectedId"
                  @inspect="selectedId = e.id"
                  @pick="pickTile(e)"
                />
              </div>
            </section>
          </template>
        </div>
      </div>

      <aside
        v-if="selected"
        class="dlg-scroll box-border h-full w-[300px] shrink-0 overflow-y-auto bg-section py-6 pr-[18px] pl-6"
        data-testid="side-panel"
      >
        <template v-if="previewSrc">
          <video
            v-if="isVideo"
            ref="video"
            :key="previewSrc"
            :src="previewSrc"
            class="block h-auto w-full"
            loop
            muted
            playsinline
          />
          <img v-else :key="previewSrc" :src="previewSrc" class="block h-auto w-full" alt="" />
        </template>
        <h2 class="mt-[26px] mb-[9px] text-[16px] leading-[1.35] font-bold text-title">
          {{ t(selected.name) }}
        </h2>
        <div>{{ t(selected.description) }}</div>
        <div v-if="selected.supports?.length" class="mt-6">{{ t('Supports:') }}</div>
        <ul v-if="selected.supports?.length" class="m-0 list-disc pl-10 text-[13px]">
          <li v-for="s in selected.supports" :key="s">{{ t(s) }}</li>
        </ul>
        <span
          v-if="selected.link"
          class="cursor-pointer underline"
          data-testid="info-link"
          @click="openLink(selected.link.url)"
          >{{ t(selected.link.text) }}</span
        >
      </aside>
    </div>

    <template #footer>
      <button class="button-default" data-testid="showcase-close" @click="closeDialogWindow">
        {{ t('Close') }}
      </button>
      <button
        class="button-action"
        data-testid="showcase-add"
        :disabled="!selected || selected.availability !== 'available' || adding"
        @click="pick()"
      >
        {{ t('Add Source') }}
      </button>
    </template>
  </DialogLayout>
</template>
