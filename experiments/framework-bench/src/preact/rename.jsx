// Preact + @preact/signals port of the "Rename Source" dialog (see ../vanilla/rename.js).
import '../../shared/styles.js';
import { render } from 'preact';
import { signal } from '@preact/signals';
import { connectCore } from '../../shared/client.js';

const BTN = 'px-3 py-1.5 rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-200 border-0';

const core = await connectCore();
const name = signal(core.snapshot.sources[3].name);

function App() {
  return (
    <div class="h-screen flex items-center justify-center bg-neutral-900 text-neutral-200 text-sm font-sans">
      <div class="w-96 p-6 rounded-lg bg-neutral-800 flex flex-col gap-4">
        <h2 class="text-base font-semibold m-0">Rename Source</h2>
        <input class="bg-neutral-900 rounded px-2 py-1.5 text-neutral-200 border-0" value={name} onInput={e => (name.value = e.currentTarget.value)} />
        <div class="flex justify-end gap-2">
          <button class={BTN}>Cancel</button>
          <button class={BTN + ' bg-blue-600 hover:bg-blue-500'}>Done</button>
        </div>
      </div>
    </div>
  );
}

render(<App />, document.getElementById('app'));
core.painted();
