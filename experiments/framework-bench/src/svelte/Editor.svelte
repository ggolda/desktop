<script>
  import { ICONS } from '../../shared/icons.js';

  // core is a static channel object handed in once at mount; it never changes
  const props = $props();
  // svelte-ignore state_referenced_locally
  const core = props.core;
  const snap = core.snapshot;

  const BTN = 'px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700';
  const SCENE_CLS = 'px-3 py-1.5 cursor-pointer hover:bg-neutral-800';
  const ACTIVE_CLS = SCENE_CLS + ' bg-blue-600/30 text-white';
  const fmtTime = s =>
    [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':');

  // scenes are static; only the active id is reactive
  const scenes = snap.scenes;
  let activeSceneId = $state(snap.activeSceneId);

  // deep $state proxies: per-property fine-grained signals
  const sources = $state(snap.sources);
  const mixer = $state(snap.mixer.map(m => ({ ...m, peaks: [0, 0] })));
  let stats = $state.raw(snap.stats);

  const sourceById = new Map(sources.map(s => [s.id, s]));
  const mixerById = new Map(mixer.map(m => [m.id, m]));

  core.on('meters', list => {
    for (const { id, peaks } of list) {
      const p = mixerById.get(id).peaks;
      p[0] = peaks[0];
      p[1] = peaks[1];
    }
  });
  core.on('stats', s => (stats = s));
  core.on('sourceUpdate', ({ id, patch }) => Object.assign(sourceById.get(id), patch));
</script>

<div class="flex flex-col h-screen bg-neutral-900 text-neutral-200 text-sm font-sans select-none">
  <header class="flex items-center gap-2 px-3 h-10 border-b border-neutral-800">
    <span class="font-semibold mr-auto">Studio</span><button class={BTN}>Go Live</button><button class={BTN}>Record</button><button class={BTN}>Settings</button>
  </header>
  <div class="flex flex-1 min-h-0">
    <section class="w-56 flex flex-col border-r border-neutral-800">
      <div class="px-3 py-2 text-xs uppercase text-neutral-400">Scenes</div>
      <ul class="flex-1 overflow-auto m-0 p-0 list-none">
        {#each scenes as sc (sc.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
          <li class={sc.id === activeSceneId ? ACTIVE_CLS : SCENE_CLS} onclick={() => (activeSceneId = sc.id)}>{sc.name}</li>
        {/each}
      </ul>
    </section>
    <div class="flex-1 flex items-center justify-center bg-black">
      <div class="aspect-video w-4/5 bg-neutral-950 border border-neutral-800"></div>
    </div>
    <section class="w-72 flex flex-col border-l border-neutral-800">
      <div class="px-3 py-2 text-xs uppercase text-neutral-400">Sources</div>
      <ul class="flex-1 overflow-auto m-0 p-0 list-none">
        {#each sources as src (src.id)}
          <li class="flex items-center gap-2 px-3 py-1.5 hover:bg-neutral-800">
            <svg viewBox="0 0 24 24" class="w-4 h-4 shrink-0 fill-current"><path d={ICONS[src.type]} /></svg><span class="flex-1 truncate">{src.name}</span><button class="w-10 text-xs text-neutral-400" onclick={() => (src.visible = !src.visible)}>{src.visible ? 'on' : 'off'}</button><button class="w-12 text-xs text-neutral-400" onclick={() => (src.locked = !src.locked)}>{src.locked ? 'locked' : 'free'}</button>
          </li>
        {/each}
      </ul>
    </section>
  </div>
  <section class="h-40 border-t border-neutral-800 px-3 py-2 flex flex-col gap-2">
    <div class="text-xs uppercase text-neutral-400">Mixer</div>
    {#each mixer as m (m.id)}
      <div class="flex items-center gap-3">
        <span class="w-32 truncate">{m.name}</span><span class="w-14 text-right tabular-nums">{m.volumeDb.toFixed(1)} dB</span><div class="flex-1 flex flex-col gap-0.5">
          <div class="h-1.5 bg-neutral-800 rounded overflow-hidden"><div class="h-full bg-green-500" style:width="{m.peaks[0] * 100}%"></div></div>
          <div class="h-1.5 bg-neutral-800 rounded overflow-hidden"><div class="h-full bg-green-500" style:width="{m.peaks[1] * 100}%"></div></div>
        </div><button class={BTN} onclick={() => (m.muted = !m.muted)}>{m.muted ? 'Unmute' : 'Mute'}</button>
      </div>
    {/each}
  </section>
  <footer class="flex items-center gap-4 px-3 h-8 border-t border-neutral-800 text-xs text-neutral-400 tabular-nums">
    <span>CPU {stats.cpu}%</span><span>FPS {stats.fps}</span><span>Dropped {stats.dropped}</span><span class="ml-auto">{fmtTime(stats.elapsed)}</span>
  </footer>
</div>
