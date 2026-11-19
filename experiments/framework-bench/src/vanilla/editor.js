// Reference implementation (plain DOM) of the "editor" window. Ports must render the same DOM
// structure and classes and react to the same messages (see experiments/framework-bench/README.md).
import '../../shared/styles.js';
import { connectCore } from '../../shared/client.js';
import { ICONS } from '../../shared/icons.js';

const BTN = 'px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700';
const h = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
};
const svgIcon = type => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'w-4 h-4 shrink-0 fill-current');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[type]);
  svg.appendChild(path);
  return svg;
};
const fmtTime = s =>
  [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':');

const core = await connectCore();
const state = core.snapshot;

const root = h('div', 'flex flex-col h-screen bg-neutral-900 text-neutral-200 text-sm font-sans select-none');

// top bar
const top = h('header', 'flex items-center gap-2 px-3 h-10 border-b border-neutral-800');
top.append(h('span', 'font-semibold mr-auto', 'Studio'), h('button', BTN, 'Go Live'), h('button', BTN, 'Record'), h('button', BTN, 'Settings'));

// scenes
const main = h('div', 'flex flex-1 min-h-0');
const scenesSec = h('section', 'w-56 flex flex-col border-r border-neutral-800');
const scenesList = h('ul', 'flex-1 overflow-auto m-0 p-0 list-none');
const sceneEls = new Map();
const SCENE_CLS = 'px-3 py-1.5 cursor-pointer hover:bg-neutral-800';
const ACTIVE_CLS = ' bg-blue-600/30 text-white';
for (const sc of state.scenes) {
  const li = h('li', SCENE_CLS + (sc.id === state.activeSceneId ? ACTIVE_CLS : ''), sc.name);
  li.onclick = () => {
    sceneEls.get(state.activeSceneId).className = SCENE_CLS;
    state.activeSceneId = sc.id;
    li.className = SCENE_CLS + ACTIVE_CLS;
  };
  sceneEls.set(sc.id, li);
  scenesList.append(li);
}
scenesSec.append(h('div', 'px-3 py-2 text-xs uppercase text-neutral-400', 'Scenes'), scenesList);

// preview placeholder
const preview = h('div', 'flex-1 flex items-center justify-center bg-black');
preview.append(h('div', 'aspect-video w-4/5 bg-neutral-950 border border-neutral-800'));

// sources
const sourcesSec = h('section', 'w-72 flex flex-col border-l border-neutral-800');
const sourcesList = h('ul', 'flex-1 overflow-auto m-0 p-0 list-none');
const sourceEls = new Map();
for (const src of state.sources) {
  const li = h('li', 'flex items-center gap-2 px-3 py-1.5 hover:bg-neutral-800');
  const name = h('span', 'flex-1 truncate', src.name);
  const vis = h('button', 'w-10 text-xs text-neutral-400', src.visible ? 'on' : 'off');
  const lock = h('button', 'w-12 text-xs text-neutral-400', src.locked ? 'locked' : 'free');
  vis.onclick = () => applySource(src.id, { visible: !src.visible });
  lock.onclick = () => applySource(src.id, { locked: !src.locked });
  li.append(svgIcon(src.type), name, vis, lock);
  sourceEls.set(src.id, { src, name, vis, lock });
  sourcesList.append(li);
}
sourcesSec.append(h('div', 'px-3 py-2 text-xs uppercase text-neutral-400', 'Sources'), sourcesList);
function applySource(id, patch) {
  const e = sourceEls.get(id);
  Object.assign(e.src, patch);
  if ('name' in patch) e.name.textContent = e.src.name;
  if ('visible' in patch) e.vis.textContent = e.src.visible ? 'on' : 'off';
  if ('locked' in patch) e.lock.textContent = e.src.locked ? 'locked' : 'free';
}
main.append(scenesSec, preview, sourcesSec);

// mixer
const mixerSec = h('section', 'h-40 border-t border-neutral-800 px-3 py-2 flex flex-col gap-2');
mixerSec.append(h('div', 'text-xs uppercase text-neutral-400', 'Mixer'));
const meterEls = new Map();
for (const m of state.mixer) {
  const row = h('div', 'flex items-center gap-3');
  const meter = h('div', 'flex-1 flex flex-col gap-0.5');
  const fills = [0, 1].map(() => {
    const bar = h('div', 'h-1.5 bg-neutral-800 rounded overflow-hidden');
    const fill = h('div', 'h-full bg-green-500');
    fill.style.width = '0%';
    bar.append(fill);
    meter.append(bar);
    return fill;
  });
  const mute = h('button', BTN, m.muted ? 'Unmute' : 'Mute');
  mute.onclick = () => {
    m.muted = !m.muted;
    mute.textContent = m.muted ? 'Unmute' : 'Mute';
  };
  row.append(h('span', 'w-32 truncate', m.name), h('span', 'w-14 text-right tabular-nums', `${m.volumeDb.toFixed(1)} dB`), meter, mute);
  meterEls.set(m.id, fills);
  mixerSec.append(row);
}

// footer stats
const footer = h('footer', 'flex items-center gap-4 px-3 h-8 border-t border-neutral-800 text-xs text-neutral-400 tabular-nums');
const cpu = h('span'), fps = h('span'), dropped = h('span'), time = h('span', 'ml-auto');
footer.append(cpu, fps, dropped, time);
function renderStats(s) {
  cpu.textContent = `CPU ${s.cpu}%`;
  fps.textContent = `FPS ${s.fps}`;
  dropped.textContent = `Dropped ${s.dropped}`;
  time.textContent = fmtTime(s.elapsed);
}
renderStats(state.stats);

root.append(top, main, mixerSec, footer);
document.getElementById('app').append(root);

core.on('meters', list => {
  for (const { id, peaks } of list) {
    const fills = meterEls.get(id);
    fills[0].style.width = `${peaks[0] * 100}%`;
    fills[1].style.width = `${peaks[1] * 100}%`;
  }
});
core.on('stats', renderStats);
core.on('sourceUpdate', ({ id, patch }) => applySource(id, patch));
core.painted();
