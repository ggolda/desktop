// SolidJS port of the "editor" window (spec: src/vanilla/editor.js). State lives in a Solid store;
// core messages are applied with path setters so only the touched text nodes / styles update.
import '../../shared/styles.js';
import { render } from 'solid-js/web';
import { batch, createSignal, createSelector, For } from 'solid-js';
import { createStore } from 'solid-js/store';
import { connectCore } from '../../shared/client.js';
import { ICONS } from '../../shared/icons.js';

const BTN = 'px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700';
const SCENE_CLS = 'px-3 py-1.5 cursor-pointer hover:bg-neutral-800';
const ACTIVE_CLS = ' bg-blue-600/30 text-white';
const fmtTime = s =>
  [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':');

const core = await connectCore();
const snap = core.snapshot;

const [state, setState] = createStore({
  scenes: snap.scenes,
  sources: snap.sources,
  mixer: snap.mixer.map(m => ({ ...m, peaks: [0, 0] })),
  stats: snap.stats,
});
const [activeSceneId, setActiveSceneId] = createSignal(snap.activeSceneId);
const sourceIdx = new Map(snap.sources.map((s, i) => [s.id, i]));
const mixerIdx = new Map(snap.mixer.map((m, i) => [m.id, i]));
const patchSource = (id, patch) => setState('sources', sourceIdx.get(id), patch);

function App() {
  const isActiveScene = createSelector(activeSceneId);
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
            <For each={state.scenes}>
              {sc => (
                <li
                  class={SCENE_CLS + (isActiveScene(sc.id) ? ACTIVE_CLS : '')}
                  onClick={() => setActiveSceneId(sc.id)}
                >
                  {sc.name}
                </li>
              )}
            </For>
          </ul>
        </section>
        <div class="flex-1 flex items-center justify-center bg-black">
          <div class="aspect-video w-4/5 bg-neutral-950 border border-neutral-800" />
        </div>
        <section class="w-72 flex flex-col border-l border-neutral-800">
          <div class="px-3 py-2 text-xs uppercase text-neutral-400">Sources</div>
          <ul class="flex-1 overflow-auto m-0 p-0 list-none">
            <For each={state.sources}>
              {src => (
                <li class="flex items-center gap-2 px-3 py-1.5 hover:bg-neutral-800">
                  <svg viewBox="0 0 24 24" class="w-4 h-4 shrink-0 fill-current">
                    <path d={ICONS[src.type]} />
                  </svg>
                  <span class="flex-1 truncate">{src.name}</span>
                  <button
                    class="w-10 text-xs text-neutral-400"
                    onClick={() => patchSource(src.id, { visible: !src.visible })}
                  >
                    {src.visible ? 'on' : 'off'}
                  </button>
                  <button
                    class="w-12 text-xs text-neutral-400"
                    onClick={() => patchSource(src.id, { locked: !src.locked })}
                  >
                    {src.locked ? 'locked' : 'free'}
                  </button>
                </li>
              )}
            </For>
          </ul>
        </section>
      </div>
      <section class="h-40 border-t border-neutral-800 px-3 py-2 flex flex-col gap-2">
        <div class="text-xs uppercase text-neutral-400">Mixer</div>
        <For each={state.mixer}>
          {(m, i) => (
            <div class="flex items-center gap-3">
              <span class="w-32 truncate">{m.name}</span>
              <span class="w-14 text-right tabular-nums">{`${m.volumeDb.toFixed(1)} dB`}</span>
              <div class="flex-1 flex flex-col gap-0.5">
                <div class="h-1.5 bg-neutral-800 rounded overflow-hidden">
                  <div class="h-full bg-green-500" style={{ width: `${m.peaks[0] * 100}%` }} />
                </div>
                <div class="h-1.5 bg-neutral-800 rounded overflow-hidden">
                  <div class="h-full bg-green-500" style={{ width: `${m.peaks[1] * 100}%` }} />
                </div>
              </div>
              <button class={BTN} onClick={() => setState('mixer', i(), 'muted', v => !v)}>
                {m.muted ? 'Unmute' : 'Mute'}
              </button>
            </div>
          )}
        </For>
      </section>
      <footer class="flex items-center gap-4 px-3 h-8 border-t border-neutral-800 text-xs text-neutral-400 tabular-nums">
        <span>{`CPU ${state.stats.cpu}%`}</span>
        <span>{`FPS ${state.stats.fps}`}</span>
        <span>{`Dropped ${state.stats.dropped}`}</span>
        <span class="ml-auto">{fmtTime(state.stats.elapsed)}</span>
      </footer>
    </div>
  );
}

render(() => <App />, document.getElementById('app'));

core.on('meters', list => batch(() => {
  for (const { id, peaks } of list) {
    const i = mixerIdx.get(id);
    setState('mixer', i, 'peaks', 0, peaks[0]);
    setState('mixer', i, 'peaks', 1, peaks[1]);
  }
}));
core.on('stats', s => setState('stats', s));
core.on('sourceUpdate', ({ id, patch }) => patchSource(id, patch));
core.painted();
