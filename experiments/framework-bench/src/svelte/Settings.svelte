<script>
  // core is a static channel object handed in once at mount; it never changes
  const props = $props();
  // svelte-ignore state_referenced_locally
  const core = props.core;
  const INPUT = 'bg-neutral-800 rounded px-2 py-1 w-80 text-neutral-200 border-0';
  const NAV_CLS = 'block w-full text-left px-4 py-1.5 bg-transparent text-neutral-200 border-0 hover:bg-neutral-800';
  // deep $state proxy: field values are fine-grained signals, created lazily on access
  const categories = $state(core.snapshot.settings);
  let active = $state(0);
  const cat = $derived(categories[active]);
</script>

<div class="flex h-screen bg-neutral-900 text-neutral-200 text-sm font-sans">
  <nav class="w-48 border-r border-neutral-800 py-2">
    {#each categories as c, i (c.id)}
      <button class={i === active ? NAV_CLS + ' bg-neutral-800' : NAV_CLS} onclick={() => (active = i)}>{c.name}</button>
    {/each}
  </nav>
  <main class="flex-1 overflow-auto p-6">
    <h1 class="text-lg font-semibold mb-4 mt-0">{cat.name}</h1>
    <div class="flex flex-col gap-4">
      {#each cat.fields as f (f.id)}
        <label class="flex flex-col gap-1">
          <span class="font-medium">{f.label}</span>
          {#if f.kind === 'select'}
            <select class={INPUT} bind:value={f.value}>
              {#each f.options as o (o.value)}
                <option value={o.value}>{o.label}</option>
              {/each}
            </select>
          {:else if f.kind === 'checkbox'}
            <input type="checkbox" bind:checked={f.value} />
          {:else if f.kind === 'slider'}
            <input class="w-80" type="range" min="0" max="200" bind:value={f.value} />
          {:else if f.kind === 'number'}
            <input class={INPUT} type="number" bind:value={f.value} />
          {:else}
            <input class={INPUT} type="text" bind:value={f.value} />
          {/if}
          <span class="text-xs text-neutral-500">{f.description}</span>
        </label>
      {/each}
    </div>
  </main>
</div>
