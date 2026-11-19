// SolidJS port of the "settings" dialog (spec: src/vanilla/settings.js): category nav + a form
// rendered from a schema (150 fields in the first category), two-way bound to a Solid store.
import '../../shared/styles.js';
import { render } from 'solid-js/web';
import { createSignal, createSelector, For } from 'solid-js';
import { createStore } from 'solid-js/store';
import { connectCore } from '../../shared/client.js';

const INPUT = 'bg-neutral-800 rounded px-2 py-1 w-80 text-neutral-200 border-0';
const NAV_CLS = 'block w-full text-left px-4 py-1.5 bg-transparent text-neutral-200 border-0 hover:bg-neutral-800';

const core = await connectCore();

function Control(props) {
  // kind is static per field: pick the control once, bind the value reactively
  const f = props.field;
  const set = props.set;
  if (f.kind === 'select') {
    return (
      <select class={INPUT} value={f.value} onChange={e => set(e.currentTarget.value)}>
        <For each={f.options}>{o => <option value={o.value}>{o.label}</option>}</For>
      </select>
    );
  }
  if (f.kind === 'checkbox') {
    return <input type="checkbox" checked={f.value} onChange={e => set(e.currentTarget.checked)} />;
  }
  if (f.kind === 'slider') {
    return (
      <input
        class="w-80"
        type="range"
        min="0"
        max="200"
        value={String(f.value)}
        onInput={e => set(Number(e.currentTarget.value))}
      />
    );
  }
  const isNum = f.kind === 'number';
  return (
    <input
      class={INPUT}
      type={isNum ? 'number' : 'text'}
      value={String(f.value)}
      onInput={e => set(isNum ? Number(e.currentTarget.value) : e.currentTarget.value)}
    />
  );
}

function App(props) {
  const [cats, setCats] = createStore(props.categories);
  const [active, setActive] = createSignal(0);
  const isActive = createSelector(active);
  return (
    <div class="flex h-screen bg-neutral-900 text-neutral-200 text-sm font-sans">
      <nav class="w-48 border-r border-neutral-800 py-2">
        <For each={cats}>
          {(cat, i) => (
            <button class={NAV_CLS + (isActive(i()) ? ' bg-neutral-800' : '')} onClick={() => setActive(i())}>
              {cat.name}
            </button>
          )}
        </For>
      </nav>
      <main class="flex-1 overflow-auto p-6">
        <h1 class="text-lg font-semibold mb-4 mt-0">{cats[active()].name}</h1>
        <div class="flex flex-col gap-4">
          <For each={cats[active()].fields}>
            {(f, i) => {
              const c = active();
              return (
                <label class="flex flex-col gap-1">
                  <span class="font-medium">{f.label}</span>
                  <Control field={f} set={v => setCats(c, 'fields', i(), 'value', v)} />
                  <span class="text-xs text-neutral-500">{f.description}</span>
                </label>
              );
            }}
          </For>
        </div>
      </main>
    </div>
  );
}

render(() => <App categories={core.snapshot.settings} />, document.getElementById('app'));
core.painted();
