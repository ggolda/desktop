import type { PatchOp, PatchPath } from './protocol';

type Container = Record<string | number, unknown>;

function resolve(root: unknown, path: PatchPath, upTo: number): Container | undefined {
  let cur = root as Container | undefined;
  for (let i = 0; i < upTo; i++) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = cur[path[i]] as Container | undefined;
  }
  return cur !== null && typeof cur === 'object' ? cur : undefined;
}

/**
 * Applies patch ops to `root` in place. Works through Vue reactive proxies too (fine-grained
 * triggers). Ops addressing a path that no longer exists are skipped (they are stale by definition).
 */
export function applyOps(root: object, ops: readonly PatchOp[]): void {
  for (const op of ops) {
    switch (op[0]) {
      case 's': {
        const path = op[1];
        const parent = resolve(root, path, path.length - 1);
        if (parent) parent[path[path.length - 1]] = op[2];
        break;
      }
      case 'd': {
        const path = op[1];
        const parent = resolve(root, path, path.length - 1);
        if (parent) delete parent[path[path.length - 1]];
        break;
      }
      case 'x': {
        const arr = resolve(root, op[1], op[1].length);
        if (Array.isArray(arr)) arr.splice(op[2], op[3], ...op[4]);
        break;
      }
      case 'l': {
        const arr = resolve(root, op[1], op[1].length);
        if (Array.isArray(arr)) arr.length = op[2];
        break;
      }
    }
  }
}
