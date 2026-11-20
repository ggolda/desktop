// Pure operations on a scene's flat node list (UI order, a folder followed by its descendants).
import {
  type FolderRec,
  type ItemRec,
  type NodeRec,
  type SceneRec,
  reindexParents,
} from '../collections/document';
import type { MoveDestination } from '../../shared/contracts';

interface T {
  n: NodeRec;
  kids: T[];
}

function buildTree(nodes: NodeRec[]): { roots: T[]; byId: Map<string, T> } {
  const byId = new Map<string, T>();
  for (const n of nodes) byId.set(n.id, { n, kids: [] });
  const roots: T[] = [];
  for (const n of nodes) {
    const t = byId.get(n.id)!;
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    if (parent) parent.kids.push(t);
    else roots.push(t);
  }
  return { roots, byId };
}

function flatten(roots: T[], out: NodeRec[] = []): NodeRec[] {
  for (const t of roots) {
    out.push(t.n);
    if (t.n.kind === 'folder') {
      t.n.childrenIds = t.kids.map(k => k.n.id);
      flatten(t.kids, out);
    }
  }
  return out;
}

/** Replaces the visible nodes of the scene (in place, in order) by `flat`; hidden nodes keep their index. */
function commit(scene: SceneRec, flat: NodeRec[]) {
  let i = 0;
  scene.nodes = scene.nodes.map(n => (n.hidden ? n : flat[i++]));
  // nodes that were not in `flat` (removed) are gone; appended ones go to the end
  while (i < flat.length) scene.nodes.push(flat[i++]);
  reindexParents(scene);
}

function descendantsOf(t: T, out = new Set<string>()): Set<string> {
  for (const k of t.kids) {
    out.add(k.n.id);
    descendantsOf(k, out);
  }
  return out;
}

/** The ids plus every descendant of the folders among them, in current UI order. */
export function expandIds(scene: SceneRec, ids: string[]): string[] {
  const vis = scene.nodes.filter(n => !n.hidden);
  const { byId } = buildTree(vis);
  const want = new Set<string>();
  for (const id of ids) {
    const t = byId.get(id);
    if (!t) continue;
    want.add(id);
    for (const d of descendantsOf(t)) want.add(d);
  }
  return vis.filter(n => want.has(n.id)).map(n => n.id);
}

/**
 * Moves nodes (with their descendants). Returns false when the move is invalid (unknown id, or a
 * folder into itself) and nothing changed.
 */
export function moveNodes(scene: SceneRec, nodeIds: string[], to: MoveDestination): boolean {
  const vis = scene.nodes.filter(n => !n.hidden);
  const { roots, byId } = buildTree(vis);
  const moving = nodeIds.filter(id => byId.has(id));
  if (moving.length === 0 || moving.length !== new Set(nodeIds).size) return false;
  // drop nodes whose ancestor moves too
  const all = new Set<string>();
  const top = new Set<string>();
  for (const id of moving) for (const d of descendantsOf(byId.get(id)!)) all.add(d);
  for (const id of moving) if (!all.has(id)) top.add(id);
  const order = vis.filter(n => top.has(n.id)).map(n => byId.get(n.id)!);

  const forbidden = new Set<string>();
  for (const t of order) {
    forbidden.add(t.n.id);
    for (const d of descendantsOf(t)) forbidden.add(d);
  }
  const anchorId = 'id' in to ? to.id : 'folderId' in to ? to.folderId : null;
  if (anchorId !== null && (!byId.has(anchorId) || forbidden.has(anchorId))) return false;
  if ('folderId' in to && byId.get(to.folderId)!.n.kind !== 'folder') return false;

  const detach = (list: T[]) => {
    for (const t of order) {
      const i = list.indexOf(t);
      if (i >= 0) list.splice(i, 1);
    }
  };
  detach(roots);
  for (const t of byId.values()) if (t.n.kind === 'folder') detach(t.kids);

  const parentList = (t: T): T[] => {
    const p = t.n.parentId ? byId.get(t.n.parentId) : undefined;
    return p && !forbidden.has(p.n.id) ? p.kids : roots;
  };
  if ('folderId' in to) {
    byId.get(to.folderId)!.kids.unshift(...order);
  } else if ('id' in to) {
    const target = byId.get(to.id)!;
    const list = parentList(target);
    const i = list.indexOf(target);
    list.splice(to.type === 'before' ? i : i + 1, 0, ...order);
  } else if (to.type === 'top') {
    roots.unshift(...order);
  } else {
    roots.push(...order);
  }
  commit(scene, flatten(roots));
  return true;
}

/** Inserts a node at the top of the scene (root level). */
export function insertOnTop(scene: SceneRec, node: NodeRec) {
  scene.nodes.unshift(node);
  reindexParents(scene);
}

/** Removes nodes and the descendants of removed folders. Returns the removed records. */
export function removeNodes(scene: SceneRec, ids: string[]): NodeRec[] {
  const gone = new Set(expandIds(scene, ids));
  const removed = scene.nodes.filter(n => gone.has(n.id) && !n.hidden);
  scene.nodes = scene.nodes.filter(n => !(gone.has(n.id) && !n.hidden));
  for (const n of scene.nodes) {
    if (n.kind === 'folder') n.childrenIds = n.childrenIds.filter(c => !gone.has(c));
  }
  reindexParents(scene);
  return removed;
}

/** Top-first refs of all visible items that exist in the backend. */
export function itemRefsTopFirst(scene: SceneRec): number[] {
  const out: number[] = [];
  for (const n of scene.nodes) {
    if (n.kind === 'item' && !n.hidden && n.ref !== undefined) out.push(n.ref);
  }
  return out;
}

export function isFolder(n: NodeRec | undefined): n is FolderRec {
  return n?.kind === 'folder';
}
export function isItem(n: NodeRec | undefined): n is ItemRec {
  return n?.kind === 'item';
}
