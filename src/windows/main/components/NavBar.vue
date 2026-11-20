<script setup lang="ts">
import { useWindowSize } from '@vueuse/core';
import { computed } from 'vue';

// Legacy top navigation (components-react/nav-menu): 46 px, icon + label items. Only the editor is
// functional in M1; the other pages are features that arrive later and render inert.
interface Item {
  id: string;
  title: string;
  icon: string;
  badge?: string;
}
const features: Item[] = [
  { id: 'editor', title: 'Editor', icon: 'icon-studio' },
  { id: 'layouts', title: 'Layouts', icon: 'fas fa-th-large' },
  { id: 'overlays', title: 'Overlays', icon: 'icon-themes' },
  { id: 'appstore', title: 'App Store', icon: 'icon-store' },
  { id: 'highlighter', title: 'Highlighter', icon: 'icon-highlighter', badge: 'beta' },
  { id: 'cloudbot', title: 'Cloudbot', icon: 'icon-cloudbot' },
  { id: 'vision', title: 'Vision', icon: 'icon-ai' },
  { id: 'ultra', title: 'Ultra', icon: 'icon-ultra' },
];
defineProps<{ active: string }>();

// legacy hides the toggle labels when the bar gets crowded (data-nav-collapse); 1280 hides, 1920 shows
const { width } = useWindowSize();
const labels = computed(() => width.value >= 1500);
const avatar = new URL('../../../../media/images/user.png', import.meta.url).href;
const soon = (t: string) => `${t} (not available yet)`;
</script>

<template>
  <!-- legacy ant-menu-horizontal bottom line: 1 px var(--border), rendered rgb(47,56,62), measured in editor-default-1920x1080 (y=75) -->
  <nav
    class="relative box-border flex h-[46px] w-full shrink-0 items-center border-0 border-b border-solid border-b-[var(--border)]"
    aria-label="Main navigation"
  >
    <button
      v-for="item in features"
      :key="item.id"
      class="flex h-[46px] items-center border-0 bg-transparent px-4 text-[14px] transition-colors"
      :class="
        item.id === active
          ? 'cursor-pointer text-[var(--nav-active)]'
          : 'cursor-default text-para hover:text-title'
      "
      :title="item.id === active ? item.title : soon(item.title)"
      :aria-current="item.id === active ? 'page' : undefined"
      :aria-disabled="item.id !== active || undefined"
      :data-testid="`nav-${item.id}`"
    >
      <i :class="item.icon" class="w-[14px] text-[14px]" aria-hidden="true" />
      <span class="ml-[10px] flex items-center">
        {{ item.title }}
        <span
          v-if="item.badge"
          class="ml-2 rounded-[4px] bg-button px-[6px] py-[2px] text-[12px] leading-[18px] text-para"
          >{{ item.badge }}</span
        >
      </span>
    </button>

    <div class="ml-auto flex h-[46px] items-center">
      <button
        class="flex h-[46px] cursor-default items-center border-0 bg-transparent px-4 text-[14px] text-para"
        :title="soon('Dual Output')"
        aria-disabled="true"
        data-testid="nav-dual-output"
      >
        <i class="icon-dual-output w-[14px] text-[14px]" aria-hidden="true" />
        <span v-if="labels" class="ml-[10px]">Dual Output</span>
        <span class="sl-switch ml-[10px]" aria-hidden="true" />
      </button>
      <button
        class="flex h-[46px] cursor-default items-center border-0 bg-transparent px-4 text-[14px] text-para"
        :title="soon('Studio Mode')"
        aria-disabled="true"
        data-testid="nav-studio-mode"
      >
        <i class="icon-studio-mode-3 w-[14px] text-[14px]" aria-hidden="true" />
        <span v-if="labels" class="ml-[10px]">Studio Mode</span>
        <span class="sl-switch ml-[10px]" aria-hidden="true" />
      </button>
      <div
        class="mx-4 h-1/2 w-0 border-l-2 border-line"
        style="border-left-style: solid"
        aria-hidden="true"
      />
      <button
        class="flex h-[46px] cursor-default items-center border-0 bg-transparent px-2 text-para hover:text-title"
        :title="soon('Help')"
        aria-disabled="true"
        data-testid="nav-help"
      >
        <i class="icon-question text-[16px]" aria-hidden="true" />
      </button>
      <button
        class="flex h-[46px] cursor-default items-center border-0 bg-transparent px-2 text-para hover:text-title"
        :title="soon('Settings')"
        aria-disabled="true"
        data-testid="nav-settings"
      >
        <i class="icon-settings text-[16px]" aria-hidden="true" />
      </button>
      <button
        class="flex h-[46px] cursor-default items-center border-0 bg-transparent px-4"
        :title="soon('Log in')"
        aria-disabled="true"
        data-testid="nav-login"
      >
        <img class="size-6 rounded-full" :src="avatar" alt="" draggable="false" />
      </button>
    </div>
  </nav>
</template>
