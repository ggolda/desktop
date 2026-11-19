// Mock core (utilityProcess): sends the snapshot, then live updates like the real core would.
// BENCH_SCENARIO: idle (meters 10/s + stats 1/s) | busy (idle + 20 source edits/s) | static (no updates)
const path = require('path');
const scenario = process.env.BENCH_SCENARIO || 'idle';

let seed = 1;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

process.parentPort.on('message', async e => {
  const port = e.ports[0];
  if (!port) return;
  const dataUrl = require('url').pathToFileURL(path.join(__dirname, '..', 'shared', 'data.js')).href;
  const { makeSnapshot } = await import(dataUrl);
  const snap = makeSnapshot();
  port.on('message', m => {
    if (m.data && m.data.type === 'hello') port.postMessage({ type: 'snapshot', data: snap });
  });
  port.start();
  if (scenario === 'static') return;

  setInterval(
    () => port.postMessage({ type: 'meters', data: snap.mixer.map(m => ({ id: m.id, peaks: [rnd(), rnd()] })) }),
    100,
  );
  let elapsed = 0;
  setInterval(
    () =>
      port.postMessage({
        type: 'stats',
        data: { cpu: +(rnd() * 3).toFixed(1), fps: 60, dropped: 0, elapsed: ++elapsed },
      }),
    1000,
  );
  if (scenario === 'busy') {
    setInterval(() => {
      const s = snap.sources[Math.floor(rnd() * snap.sources.length)];
      const k = Math.floor(rnd() * 3);
      const patch =
        k === 0
          ? { name: `${s.name.split(' #')[0]} #${Math.floor(rnd() * 1000)}` }
          : k === 1
          ? { visible: rnd() > 0.5 }
          : { locked: rnd() > 0.5 };
      Object.assign(s, patch);
      port.postMessage({ type: 'sourceUpdate', data: { id: s.id, patch } });
    }, 50);
  }
});
