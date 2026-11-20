/**
 * Stand-in for UI modules (Vue/React components, styles) in the worker bundle.
 * See webpack.worker.config.js and docs/rework (worker-only bundle).
 *
 * The worker never renders anything, but some services import UI modules (e.g. the
 * WindowsService component registry). Any property access, call or `new` returns this
 * stub, so module-level code that touches UI exports (registrations, `extends`,
 * decorators) evaluates harmlessly. If worker code ever *uses* a stubbed value for real,
 * that is a bug to fix by moving the code out of the UI folders.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-function
const target = function WorkerUiStub() {};
const stub = new Proxy(target, {
  get(t, prop) {
    if (prop === '__esModule') return false;
    if (prop === Symbol.toPrimitive) return () => '';
    if (prop === 'then') return undefined; // not a thenable
    if (prop in t) return t[prop];
    return stub;
  },
  apply() {
    return stub;
  },
  construct() {
    return stub;
  },
});

module.exports = stub;
