// React 19 port of the "editor" window (see ../vanilla/editor.js for the reference).
// State lives in a keyed external store read with useSyncExternalStore: each source row, meter and
// the footer subscribe only to their own key; rows are React.memo with stable props/callbacks.
import '../../shared/styles.js';
import { memo, useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { connectCore } from '../../shared/client.js';
import { ICONS } from '../../shared/icons.js';
import { createStore, useStoreKey } from './store.js';

const BTN = 'px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700';
const SCENE_CLS = 'px-3 py-1.5 cursor-pointer hover:bg-neutral-800';
const ACTIVE_CLS = ' bg-blue-600/30 text-white';
const fmtTime = s =>
  [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':');

const core = await connectCore();
const snap = core.snapshot;

// ---- state ----
// keys: 'activeSceneId', 'stats', `src:<id>` (source object), `meter:<id>` ([l, r])
const init = { activeSceneId: snap.activeSceneId, stats: snap.stats };
for (const s of snap.sources) init[`src:${s.id}`] = s;
for (const m of snap.mixer) init[`meter:${m.id}`] = [0, 0];
const store = createStore(init);
const sourceIds = snap.sources.map(s => s.id);

function patchSource(id, patch) {
  const key = `src:${id}`;
  store.set(key, { ...store.get(key), ...patch });
}
const selectScene = id => store.set('activeSceneId', id);
const toggleVisible = id => patchSource(id, { visible: !store.get(`src:${id}`).visible });
const toggleLocked = id => patchSource(id, { locked: !store.get(`src:${id}`).locked });

// ---- components ----
const SceneRow = memo(function SceneRow({ id, name }) {
  // selector: the row re-renders only when its own `active` flag flips
  const isActive = useCallback(activeId => activeId === id, [id]);
  const active = useStoreKey(store, 'activeSceneId', isActive);
  const onClick = useCallback(() => selectScene(id), [id]);
  return (
    <li className={SCENE_CLS + (active ? ACTIVE_CLS : '')} onClick={onClick}>
      {name}
    </li>
  );
});

const SourceRow = memo(function SourceRow({ id }) {
  const src = useStoreKey(store, `src:${id}`);
  const onVis = useCallback(() => toggleVisible(id), [id]);
  const onLock = useCallback(() => toggleLocked(id), [id]);
  return (
    <li className="flex items-center gap-2 px-3 py-1.5 hover:bg-neutral-800">
      <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0 fill-current">
        <path d={ICONS[src.type]} />
      </svg>
      <span className="flex-1 truncate">{src.name}</span>
      <button className="w-10 text-xs text-neutral-400" onClick={onVis}>
        {src.visible ? 'on' : 'off'}
      </button>
      <button className="w-12 text-xs text-neutral-400" onClick={onLock}>
        {src.locked ? 'locked' : 'free'}
      </button>
    </li>
  );
});

const Meter = memo(function Meter({ id }) {
  const peaks = useStoreKey(store, `meter:${id}`);
  return (
    <div className="flex-1 flex flex-col gap-0.5">
      <div className="h-1.5 bg-neutral-800 rounded overflow-hidden">
        <div className="h-full bg-green-500" style={{ width: `${peaks[0] * 100}%` }} />
      </div>
      <div className="h-1.5 bg-neutral-800 rounded overflow-hidden">
        <div className="h-full bg-green-500" style={{ width: `${peaks[1] * 100}%` }} />
      </div>
    </div>
  );
});

const MixerRow = memo(function MixerRow({ m }) {
  const [muted, setMuted] = useState(m.muted);
  const onMute = useCallback(() => setMuted(v => !v), []);
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 truncate">{m.name}</span>
      <span className="w-14 text-right tabular-nums">{`${m.volumeDb.toFixed(1)} dB`}</span>
      <Meter id={m.id} />
      <button className={BTN} onClick={onMute}>
        {muted ? 'Unmute' : 'Mute'}
      </button>
    </div>
  );
});

const Footer = memo(function Footer() {
  const s = useStoreKey(store, 'stats');
  return (
    <footer className="flex items-center gap-4 px-3 h-8 border-t border-neutral-800 text-xs text-neutral-400 tabular-nums">
      <span>{`CPU ${s.cpu}%`}</span>
      <span>{`FPS ${s.fps}`}</span>
      <span>{`Dropped ${s.dropped}`}</span>
      <span className="ml-auto">{fmtTime(s.elapsed)}</span>
    </footer>
  );
});

function App() {
  // first commit is in the DOM when effects run
  useEffect(() => core.painted(), []);
  return (
    <div className="flex flex-col h-screen bg-neutral-900 text-neutral-200 text-sm font-sans select-none">
      <header className="flex items-center gap-2 px-3 h-10 border-b border-neutral-800">
        <span className="font-semibold mr-auto">Studio</span>
        <button className={BTN}>Go Live</button>
        <button className={BTN}>Record</button>
        <button className={BTN}>Settings</button>
      </header>
      <div className="flex flex-1 min-h-0">
        <section className="w-56 flex flex-col border-r border-neutral-800">
          <div className="px-3 py-2 text-xs uppercase text-neutral-400">Scenes</div>
          <ul className="flex-1 overflow-auto m-0 p-0 list-none">
            {snap.scenes.map(sc => (
              <SceneRow key={sc.id} id={sc.id} name={sc.name} />
            ))}
          </ul>
        </section>
        <div className="flex-1 flex items-center justify-center bg-black">
          <div className="aspect-video w-4/5 bg-neutral-950 border border-neutral-800" />
        </div>
        <section className="w-72 flex flex-col border-l border-neutral-800">
          <div className="px-3 py-2 text-xs uppercase text-neutral-400">Sources</div>
          <ul className="flex-1 overflow-auto m-0 p-0 list-none">
            {sourceIds.map(id => (
              <SourceRow key={id} id={id} />
            ))}
          </ul>
        </section>
      </div>
      <section className="h-40 border-t border-neutral-800 px-3 py-2 flex flex-col gap-2">
        <div className="text-xs uppercase text-neutral-400">Mixer</div>
        {snap.mixer.map(m => (
          <MixerRow key={m.id} m={m} />
        ))}
      </section>
      <Footer />
    </div>
  );
}

createRoot(document.getElementById('app')).render(<App />);

core.on('meters', list => {
  for (const { id, peaks } of list) store.set(`meter:${id}`, peaks);
});
core.on('stats', s => store.set('stats', s));
core.on('sourceUpdate', ({ id, patch }) => patchSource(id, patch));
