// React 19 port of the "Rename Source" dialog (see ../vanilla/rename.js).
import '../../shared/styles.js';
import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { connectCore } from '../../shared/client.js';

const BTN = 'px-3 py-1.5 rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-200 border-0';

const core = await connectCore();
const initialName = core.snapshot.sources[3].name;

function App() {
  const [name, setName] = useState(initialName);
  useEffect(() => core.painted(), []);
  return (
    <div className="h-screen flex items-center justify-center bg-neutral-900 text-neutral-200 text-sm font-sans">
      <div className="w-96 p-6 rounded-lg bg-neutral-800 flex flex-col gap-4">
        <h2 className="text-base font-semibold m-0">Rename Source</h2>
        <input className="bg-neutral-900 rounded px-2 py-1.5 text-neutral-200 border-0" value={name} onChange={e => setName(e.target.value)} />
        <div className="flex justify-end gap-2">
          <button className={BTN}>Cancel</button>
          <button className={BTN + ' bg-blue-600 hover:bg-blue-500'}>Done</button>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('app')).render(<App />);
