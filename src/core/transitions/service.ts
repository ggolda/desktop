// Transitions in M1: loaded from the collection and used for scene switching only (owner decision 5).
// Editing, studio mode and hotkeys are M3; the data is preserved verbatim.
import { randomUUID } from 'node:crypto';
import type { Ctx } from '../context';

export interface TransitionsApi {
  /** Creates the backend transitions of the open collection (and a default cut if there is none). */
  load(): Promise<void>;
  unload(): Promise<void>;
  /** Program switch from `fromId` (null at load) to `toId`. */
  switchTo(fromId: string | null, toId: string): Promise<void>;
}

const MAX_DURATION_MS = 20_000;

export function createTransitions(ctx: Ctx): TransitionsApi {
  const { backend } = ctx;
  let created: string[] = [];

  function pick(fromId: string | null, toId: string) {
    const t = ctx.requireDoc().transitions;
    const byId = (id: string) => t.items.find(i => i.id === id);
    const exact = t.connections.find(c => c.fromSceneId === fromId && c.toSceneId === toId);
    if (exact && byId(exact.transitionId)) return byId(exact.transitionId)!;
    const wildcard =
      t.connections.find(c => c.fromSceneId === 'ALL' && c.toSceneId === toId) ??
      t.connections.find(c => c.fromSceneId === fromId && c.toSceneId === 'ALL');
    if (wildcard && byId(wildcard.transitionId)) return byId(wildcard.transitionId)!;
    return byId(t.defaultTransitionId) ?? t.items[0];
  }

  return {
    async load() {
      const t = ctx.requireDoc().transitions;
      if (t.items.length === 0) {
        const id = randomUUID();
        t.items.push({
          id,
          name: 'Global Transition',
          type: 'cut_transition',
          duration: 300,
          settings: {},
          propertiesManagerSettings: {},
          raw: null,
        });
        t.defaultTransitionId = id;
        ctx.touch.transitions();
      } else if (!t.items.some(i => i.id === t.defaultTransitionId)) {
        t.defaultTransitionId = t.items[0].id;
        ctx.touch.transitions();
      }
      for (const i of t.items) {
        await backend.transitions.create({ id: i.id, type: i.type, settings: i.settings });
        created.push(i.id);
      }
    },
    async unload() {
      for (const id of created) await backend.transitions.remove(id);
      created = [];
    },
    async switchTo(fromId, toId) {
      const tr = fromId ? pick(fromId, toId) : undefined;
      await backend.transitions.switchScene(
        toId,
        tr?.id ?? null,
        tr ? Math.min(tr.duration, MAX_DURATION_MS) : 0,
      );
    },
  };
}
