// React 19 port of the "settings" dialog (see ../vanilla/settings.js).
// Each field is a React.memo row owning its controlled value (useState); edits are written back to
// the schema object so values survive category switches.
import '../../shared/styles.js';
import { memo, useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { connectCore } from '../../shared/client.js';

const INPUT = 'bg-neutral-800 rounded px-2 py-1 w-80 text-neutral-200 border-0';
const NAV_CLS = 'block w-full text-left px-4 py-1.5 bg-transparent text-neutral-200 border-0 hover:bg-neutral-800';

const core = await connectCore();
const categories = core.snapshot.settings;

function Control({ field }) {
  const [value, setValue] = useState(field.value);
  const update = useCallback(
    v => {
      field.value = v;
      setValue(v);
    },
    [field],
  );
  if (field.kind === 'select') {
    return (
      <select className={INPUT} value={value} onChange={e => update(e.target.value)}>
        {field.options.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.kind === 'checkbox') {
    return <input type="checkbox" checked={value} onChange={e => update(e.target.checked)} />;
  }
  if (field.kind === 'slider') {
    return <input className="w-80" type="range" min="0" max="200" value={value} onChange={e => update(Number(e.target.value))} />;
  }
  const num = field.kind === 'number';
  return (
    <input
      className={INPUT}
      type={num ? 'number' : 'text'}
      value={String(value)}
      onChange={e => {
        // keep the raw string as the displayed value (so an emptied number box stays empty)
        const raw = e.target.value;
        field.value = num ? Number(raw) : raw;
        setValue(raw);
      }}
    />
  );
}

const Field = memo(function Field({ field }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-medium">{field.label}</span>
      <Control field={field} />
      <span className="text-xs text-neutral-500">{field.description}</span>
    </label>
  );
});

const NavButton = memo(function NavButton({ index, name, active, onSelect }) {
  return (
    <button className={NAV_CLS + (active ? ' bg-neutral-800' : '')} onClick={() => onSelect(index)}>
      {name}
    </button>
  );
});

function App() {
  const [active, setActive] = useState(0);
  useEffect(() => core.painted(), []);
  const cat = categories[active];
  return (
    <div className="flex h-screen bg-neutral-900 text-neutral-200 text-sm font-sans">
      <nav className="w-48 border-r border-neutral-800 py-2">
        {categories.map((c, i) => (
          <NavButton key={c.id} index={i} name={c.name} active={i === active} onSelect={setActive} />
        ))}
      </nav>
      <main className="flex-1 overflow-auto p-6">
        <h1 className="text-lg font-semibold mb-4 mt-0">{cat.name}</h1>
        <div className="flex flex-col gap-4" key={cat.id}>
          {cat.fields.map(f => (
            <Field key={f.id} field={f} />
          ))}
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById('app')).render(<App />);
