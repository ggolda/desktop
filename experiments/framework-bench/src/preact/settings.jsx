// Preact + @preact/signals port of the "settings" dialog (see ../vanilla/settings.js).
// Each field value is a signal; a Field component re-renders only when its own value changes.
import '../../shared/styles.js';
import { render } from 'preact';
import { signal } from '@preact/signals';
import { connectCore } from '../../shared/client.js';

const INPUT = 'bg-neutral-800 rounded px-2 py-1 w-80 text-neutral-200 border-0';
const NAV_CLS = 'block w-full text-left px-4 py-1.5 bg-transparent text-neutral-200 border-0 hover:bg-neutral-800';

const core = await connectCore();
const categories = core.snapshot.settings.map(cat => ({
  id: cat.id,
  name: cat.name,
  fields: cat.fields.map(f => ({ ...f, value: signal(f.value) })),
}));
const active = signal(0);

function Control({ field }) {
  const v = field.value;
  if (field.kind === 'select') {
    return (
      <select class={INPUT} value={v.value} onChange={e => (v.value = e.currentTarget.value)}>
        {field.options.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.kind === 'checkbox') {
    return <input type="checkbox" checked={v.value} onChange={e => (v.value = e.currentTarget.checked)} />;
  }
  if (field.kind === 'slider') {
    return (
      <input class="w-80" type="range" min="0" max="200" value={String(v.value)} onInput={e => (v.value = Number(e.currentTarget.value))} />
    );
  }
  const num = field.kind === 'number';
  return (
    <input
      class={INPUT}
      type={num ? 'number' : 'text'}
      value={String(v.value)}
      onInput={e => (v.value = num ? Number(e.currentTarget.value) : e.currentTarget.value)}
    />
  );
}

function Field({ field }) {
  return (
    <label class="flex flex-col gap-1">
      <span class="font-medium">{field.label}</span>
      <Control field={field} />
      <span class="text-xs text-neutral-500">{field.description}</span>
    </label>
  );
}

function App() {
  const a = active.value;
  const cat = categories[a];
  return (
    <div class="flex h-screen bg-neutral-900 text-neutral-200 text-sm font-sans">
      <nav class="w-48 border-r border-neutral-800 py-2">
        {categories.map((c, i) => (
          <button key={c.id} class={NAV_CLS + (i === a ? ' bg-neutral-800' : '')} onClick={() => (active.value = i)}>
            {c.name}
          </button>
        ))}
      </nav>
      <main class="flex-1 overflow-auto p-6">
        <h1 class="text-lg font-semibold mb-4 mt-0">{cat.name}</h1>
        <div class="flex flex-col gap-4" key={cat.id}>
          {cat.fields.map(f => (
            <Field key={f.id} field={f} />
          ))}
        </div>
      </main>
    </div>
  );
}

render(<App />, document.getElementById('app'));
core.painted();
