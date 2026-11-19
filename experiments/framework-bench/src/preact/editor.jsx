// Preact + @preact/signals port of the "editor" window (see ../vanilla/editor.js for the reference).
// Fine-grained: every source field, meter bar and stat is its own signal; signals passed directly
// into JSX (text / props) update the DOM without re-rendering the component.
import '../../shared/styles.js';
import { render } from 'preact';
import { signal, computed, batch, useComputed, useSignal } from '@preact/signals';
import { connectCore } from '../../shared/client.js';
import { ICONS } from '../../shared/icons.js';

const BTN = 'px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700';
const SCENE_CLS = 'px-3 py-1.5 cursor-pointer hover:bg-neutral-800';
const ACTIVE_CLS = ' bg-blue-600/30 text-white';
const fmtTime = s =>
  [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':');

const core = await connectCore();
const snap = core.snapshot;

// ---- state ----
const activeSceneId = signal(snap.activeSceneId);
const sources = snap.sources.map(s => ({
  id: s.id,
  type: s.type,
  name: signal(s.name),
  visible: signal(s.visible),
  locked: signal(s.locked),
}));
const sourceById = new Map(sources.map(s => [s.id, s]));
const meters = snap.mixer.map(m => {
  const l = signal(0);
  const r = signal(0);
  return { ...m, l, r, lStyle: computed(() => `width: ${l.value * 100}%`), rStyle: computed(() => `width: ${r.value * 100}%`) };
});
const meterById = new Map(meters.map(m => [m.id, m]));
const stats = signal(snap.stats);
const cpuText = computed(() => `CPU ${stats.value.cpu}%`);
const fpsText = computed(() => `FPS ${stats.value.fps}`);
const droppedText = computed(() => `Dropped ${stats.value.dropped}`);
const timeText = computed(() => fmtTime(stats.value.elapsed));

function applySource(id, patch) {
  const s = sourceById.get(id);
  if ('name' in patch) s.name.value = patch.name;
  if ('visible' in patch) s.visible.value = patch.visible;
  if ('locked' in patch) s.locked.value = patch.locked;
}

// ---- components ----
function SceneRow({ scene }) {
  const cls = useComputed(() => SCENE_CLS + (activeSceneId.value === scene.id ? ACTIVE_CLS : ''));
  return (
    <li class={cls} onClick={() => (activeSceneId.value = scene.id)}>
      {scene.name}
    </li>
  );
}

function SourceRow({ src }) {
  const visText = useComputed(() => (src.visible.value ? 'on' : 'off'));
  const lockText = useComputed(() => (src.locked.value ? 'locked' : 'free'));
  return (
    <li class="flex items-center gap-2 px-3 py-1.5 hover:bg-neutral-800">
      <svg viewBox="0 0 24 24" class="w-4 h-4 shrink-0 fill-current">
        <path d={ICONS[src.type]} />
      </svg>
      <span class="flex-1 truncate">{src.name}</span>
      <button class="w-10 text-xs text-neutral-400" onClick={() => (src.visible.value = !src.visible.peek())}>
        {visText}
      </button>
      <button class="w-12 text-xs text-neutral-400" onClick={() => (src.locked.value = !src.locked.peek())}>
        {lockText}
      </button>
    </li>
  );
}

function MixerRow({ m }) {
  const muted = useSignal(m.muted);
  const muteText = useComputed(() => (muted.value ? 'Unmute' : 'Mute'));
  return (
    <div class="flex items-center gap-3">
      <span class="w-32 truncate">{m.name}</span>
      <span class="w-14 text-right tabular-nums">{`${m.volumeDb.toFixed(1)} dB`}</span>
      <div class="flex-1 flex flex-col gap-0.5">
        <div class="h-1.5 bg-neutral-800 rounded overflow-hidden">
          <div class="h-full bg-green-500" style={m.lStyle} />
        </div>
        <div class="h-1.5 bg-neutral-800 rounded overflow-hidden">
          <div class="h-full bg-green-500" style={m.rStyle} />
        </div>
      </div>
      <button class={BTN} onClick={() => (muted.value = !muted.peek())}>
        {muteText}
      </button>
    </div>
  );
}

function App() {
  return (
    <div class="flex flex-col h-screen bg-neutral-900 text-neutral-200 text-sm font-sans select-none">
      <header class="flex items-center gap-2 px-3 h-10 border-b border-neutral-800">
        <span class="font-semibold mr-auto">Studio</span>
        <button class={BTN}>Go Live</button>
        <button class={BTN}>Record</button>
        <button class={BTN}>Settings</button>
      </header>
      <div class="flex flex-1 min-h-0">
        <section class="w-56 flex flex-col border-r border-neutral-800">
          <div class="px-3 py-2 text-xs uppercase text-neutral-400">Scenes</div>
          <ul class="flex-1 overflow-auto m-0 p-0 list-none">
            {snap.scenes.map(sc => (
              <SceneRow key={sc.id} scene={sc} />
            ))}
          </ul>
        </section>
        <div class="flex-1 flex items-center justify-center bg-black">
          <div class="aspect-video w-4/5 bg-neutral-950 border border-neutral-800" />
        </div>
        <section class="w-72 flex flex-col border-l border-neutral-800">
          <div class="px-3 py-2 text-xs uppercase text-neutral-400">Sources</div>
          <ul class="flex-1 overflow-auto m-0 p-0 list-none">
            {sources.map(s => (
              <SourceRow key={s.id} src={s} />
            ))}
          </ul>
        </section>
      </div>
      <section class="h-40 border-t border-neutral-800 px-3 py-2 flex flex-col gap-2">
        <div class="text-xs uppercase text-neutral-400">Mixer</div>
        {meters.map(m => (
          <MixerRow key={m.id} m={m} />
        ))}
      </section>
      <footer class="flex items-center gap-4 px-3 h-8 border-t border-neutral-800 text-xs text-neutral-400 tabular-nums">
        <span>{cpuText}</span>
        <span>{fpsText}</span>
        <span>{droppedText}</span>
        <span class="ml-auto">{timeText}</span>
      </footer>
    </div>
  );
}

render(<App />, document.getElementById('app'));

core.on('meters', list => batch(() => {
  for (const { id, peaks } of list) {
    const m = meterById.get(id);
    m.l.value = peaks[0];
    m.r.value = peaks[1];
  }
}));
core.on('stats', s => (stats.value = s));
core.on('sourceUpdate', ({ id, patch }) => batch(() => applySource(id, patch)));
core.painted();
