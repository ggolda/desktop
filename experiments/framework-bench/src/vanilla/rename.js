// Reference implementation (plain DOM) of a tiny dialog ("Rename Source").
import '../../shared/styles.js';
import { connectCore } from '../../shared/client.js';

const BTN = 'px-3 py-1.5 rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-200 border-0';
const h = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
};

const core = await connectCore();
const source = core.snapshot.sources[3];
let name = source.name;

const root = h('div', 'h-screen flex items-center justify-center bg-neutral-900 text-neutral-200 text-sm font-sans');
const card = h('div', 'w-96 p-6 rounded-lg bg-neutral-800 flex flex-col gap-4');
const input = h('input', 'bg-neutral-900 rounded px-2 py-1.5 text-neutral-200 border-0');
input.value = name;
input.oninput = () => (name = input.value);
const buttons = h('div', 'flex justify-end gap-2');
buttons.append(h('button', BTN, 'Cancel'), h('button', BTN + ' bg-blue-600 hover:bg-blue-500', 'Done'));
card.append(h('h2', 'text-base font-semibold m-0', 'Rename Source'), input, buttons);
root.append(card);
document.getElementById('app').append(root);
core.painted();
