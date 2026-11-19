<script>
  // core is a static channel object handed in once at mount; it never changes
  const props = $props();
  // svelte-ignore state_referenced_locally
  const core = props.core;
  const BTN = 'px-3 py-1.5 rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-200 border-0';
  let name = $state(core.snapshot.sources[3].name);
</script>

<div class="h-screen flex items-center justify-center bg-neutral-900 text-neutral-200 text-sm font-sans">
  <div class="w-96 p-6 rounded-lg bg-neutral-800 flex flex-col gap-4">
    <h2 class="text-base font-semibold m-0">Rename Source</h2>
    <input class="bg-neutral-900 rounded px-2 py-1.5 text-neutral-200 border-0" bind:value={name} />
    <div class="flex justify-end gap-2">
      <button class={BTN}>Cancel</button>
      <button class="{BTN} bg-blue-600 hover:bg-blue-500">Done</button>
    </div>
  </div>
</div>
