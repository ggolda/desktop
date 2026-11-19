// SolidJS port of the "Rename Source" dialog (spec: src/vanilla/rename.js).
import '../../shared/styles.js';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { connectCore } from '../../shared/client.js';

const BTN = 'px-3 py-1.5 rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-200 border-0';

const core = await connectCore();

function App(props) {
  const [name, setName] = createSignal(props.initial);
  return (
    <div class="h-screen flex items-center justify-center bg-neutral-900 text-neutral-200 text-sm font-sans">
      <div class="w-96 p-6 rounded-lg bg-neutral-800 flex flex-col gap-4">
        <h2 class="text-base font-semibold m-0">Rename Source</h2>
        <input
          class="bg-neutral-900 rounded px-2 py-1.5 text-neutral-200 border-0"
          value={name()}
          onInput={e => setName(e.currentTarget.value)}
        />
        <div class="flex justify-end gap-2">
          <button class={BTN}>Cancel</button>
          <button class={BTN + ' bg-blue-600 hover:bg-blue-500'}>Done</button>
        </div>
      </div>
    </div>
  );
}

render(() => <App initial={core.snapshot.sources[3].name} />, document.getElementById('app'));
core.painted();
