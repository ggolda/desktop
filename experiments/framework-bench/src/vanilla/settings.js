// Reference implementation (plain DOM) of the "settings" dialog: category nav + a form rendered from
// a schema (150 fields in the first category). Values are two-way bound to local state.
import '../../shared/styles.js';
import { connectCore } from '../../shared/client.js';

const h = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
};
const INPUT = 'bg-neutral-800 rounded px-2 py-1 w-80 text-neutral-200 border-0';

const core = await connectCore();
const categories = core.snapshot.settings;
let active = 0;

const root = h('div', 'flex h-screen bg-neutral-900 text-neutral-200 text-sm font-sans');
const nav = h('nav', 'w-48 border-r border-neutral-800 py-2');
const content = h('main', 'flex-1 overflow-auto p-6');
const NAV_CLS = 'block w-full text-left px-4 py-1.5 bg-transparent text-neutral-200 border-0 hover:bg-neutral-800';
const navBtns = categories.map((cat, i) => {
  const b = h('button', NAV_CLS + (i === active ? ' bg-neutral-800' : ''), cat.name);
  b.onclick = () => {
    navBtns[active].className = NAV_CLS;
    active = i;
    b.className = NAV_CLS + ' bg-neutral-800';
    renderCategory();
  };
  nav.append(b);
  return b;
});

function control(field) {
  let el;
  if (field.kind === 'select') {
    el = h('select', INPUT);
    for (const o of field.options) {
      const opt = h('option', null, o.label);
      opt.value = o.value;
      el.append(opt);
    }
    el.value = field.value;
    el.onchange = () => (field.value = el.value);
  } else if (field.kind === 'checkbox') {
    el = h('input');
    el.type = 'checkbox';
    el.checked = field.value;
    el.onchange = () => (field.value = el.checked);
  } else if (field.kind === 'slider') {
    el = h('input', 'w-80');
    el.type = 'range';
    el.min = '0';
    el.max = '200';
    el.value = String(field.value);
    el.oninput = () => (field.value = Number(el.value));
  } else {
    el = h('input', INPUT);
    el.type = field.kind === 'number' ? 'number' : 'text';
    el.value = String(field.value);
    el.oninput = () => (field.value = field.kind === 'number' ? Number(el.value) : el.value);
  }
  return el;
}

function renderCategory() {
  const cat = categories[active];
  const list = h('div', 'flex flex-col gap-4');
  for (const f of cat.fields) {
    const row = h('label', 'flex flex-col gap-1');
    row.append(h('span', 'font-medium', f.label), control(f), h('span', 'text-xs text-neutral-500', f.description));
    list.append(row);
  }
  content.replaceChildren(h('h1', 'text-lg font-semibold mb-4 mt-0', cat.name), list);
}

renderCategory();
root.append(nav, content);
document.getElementById('app').append(root);
core.painted();
