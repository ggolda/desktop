// Framework-agnostic client for the mock core: the target architecture's window <-> core channel.
// Usage:
//   const core = await connectCore();
//   core.snapshot                      // initial state
//   core.on('meters' | 'stats' | 'sourceUpdate', fn)
//   core.painted()                     // call once the initial data is rendered
export function connectCore() {
  return new Promise(resolve => {
    window.addEventListener('message', function onMsg(e) {
      if (e.data !== 'core-port' || !e.ports[0]) return;
      window.removeEventListener('message', onMsg);
      const port = e.ports[0];
      const handlers = {};
      let snapshotResolve;
      const snapshot = new Promise(r => (snapshotResolve = r));
      port.onmessage = ev => {
        const msg = ev.data;
        if (msg.type === 'snapshot') snapshotResolve(msg.data);
        else (handlers[msg.type] || []).forEach(h => h(msg.data));
      };
      port.start();
      port.postMessage({ type: 'hello' });
      snapshot.then(data =>
        resolve({
          snapshot: data,
          on(type, fn) {
            (handlers[type] = handlers[type] || []).push(fn);
          },
          send(msg) {
            port.postMessage(msg);
          },
          // reported after two animation frames = the first painted frame with data
          painted() {
            requestAnimationFrame(() =>
              requestAnimationFrame(() => window.bench && window.bench.painted()),
            );
          },
        }),
      );
    });
  });
}
