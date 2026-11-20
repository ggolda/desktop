import { describe, expect, it } from 'vitest';
import type { EditorGeometry } from '@/shared/contracts';
import {
  EditorInteraction,
  type EditorDeps,
  type PointerInput,
  SEND_INTERVAL_MS,
  type TransformUpdate,
} from '@/ui/editor/interaction';
import { geo, item } from './helpers';

/**
 * Display: canvas 1920x1080 drawn in a 960x540 region at (0,0) of the placeholder, so one CSS px is
 * two canvas px. Snapping is off unless a test turns it on.
 */
const region = { x: 0, y: 0, width: 960, height: 540 };

function setup(g: EditorGeometry, selected: string[] = [], snap = false) {
  const log: string[] = [];
  const sent: { t: number; updates: TransformUpdate[] }[] = [];
  const selection = { ids: selected };
  let now = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let nextTimer = 1;
  const resolvers: (() => void)[] = [];
  let holdSends = false;
  let fetches = 0;
  const cursors: string[] = [];
  const deps: EditorDeps = {
    async fetchGeometry() {
      fetches++;
      return g;
    },
    cachedGeometry: () => g,
    region: () => region,
    selection: () => selection,
    select(ids) {
      selection.ids = ids;
      log.push(`select:${ids.join(',')}`);
    },
    addToSelection(ids) {
      selection.ids = [...new Set([...selection.ids, ...ids])];
      log.push(`add:${ids.join(',')}`);
    },
    removeFromSelection(ids) {
      selection.ids = selection.ids.filter(i => !ids.includes(i));
      log.push(`remove:${ids.join(',')}`);
    },
    clearSelection() {
      selection.ids = [];
      log.push('clear');
    },
    sendTransforms(_scene, updates) {
      sent.push({ t: now, updates });
      if (!holdSends) return Promise.resolve();
      return new Promise<void>(r => resolvers.push(r));
    },
    openMenu(ids) {
      log.push(`menu:${ids.join(',')}`);
    },
    setCursor: c => cursors.push(c),
    now: () => now,
    setTimer(fn, ms) {
      const id = nextTimer++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimer(h) {
      const i = timers.findIndex(t => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
    snap: snap ? undefined : { enabled: false, distance: 10, screen: true, source: true },
  };
  const inter = new EditorInteraction(deps);
  const ev = (x: number, y: number, o: Partial<PointerInput> = {}): PointerInput => ({
    x,
    y,
    button: 0,
    buttons: 0,
    ctrl: false,
    shift: false,
    alt: false,
    ...o,
  });
  return {
    inter,
    log,
    sent,
    selection,
    cursors,
    ev,
    get fetches() {
      return fetches;
    },
    /** Advances the fake clock, firing due timers (in order). */
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const t = timers[0];
        if (!t || t.at > end) break;
        timers.shift();
        now = Math.max(now, t.at);
        t.fn();
        await Promise.resolve();
        await Promise.resolve();
      }
      now = end;
    },
    hold(v: boolean) {
      holdSends = v;
    },
    release() {
      resolvers.splice(0).forEach(r => r());
    },
    get timersPending() {
      return timers.length;
    },
  };
}

// item 'a': canvas 100..300 x 100..200 (CSS px 50..150 x 50..100); item 'b' overlaps it on top
const scene = () =>
  geo([
    item('b', { x: 200, y: 150, width: 200, height: 100 }),
    item('a', { x: 100, y: 100, width: 200, height: 100 }),
    item('locked', { x: 800, y: 100, width: 200, height: 100, locked: true }),
  ]);

const click = async (
  s: ReturnType<typeof setup>,
  x: number,
  y: number,
  o: Partial<PointerInput> = {},
) => {
  await s.inter.pointerDown(s.ev(x, y, { buttons: 1, ...o }));
  await s.inter.pointerUp(s.ev(x, y, o));
};

describe('click selection (legacy mouseup)', () => {
  it('selects the front-most unlocked item under the cursor', async () => {
    const s = setup(scene());
    await click(s, 60, 60); // only 'a' is here
    expect(s.log).toEqual(['select:a']);
    s.log.length = 0;
    await click(s, 125, 87); // both: 'b' is in front
    expect(s.log).toEqual(['select:b']);
  });

  it('ignores locked items and clears the selection on an empty area', async () => {
    const s = setup(scene(), ['a']);
    await click(s, 450, 60); // the locked item is at canvas 800..1000 = css 400..500
    expect(s.log).toEqual(['clear']);
  });

  it('Ctrl toggles an item in and out of the selection', async () => {
    const s = setup(scene(), ['a']);
    await click(s, 190, 110, { ctrl: true }); // 'b' only (css 100..200 x 75..125 minus a's 150 edge)
    expect(s.log).toEqual(['add:b']);
    s.log.length = 0;
    await click(s, 60, 60, { ctrl: true }); // 'a' only, already selected
    expect(s.log).toEqual(['remove:a']);
  });

  it('clicking inside an already selected stack cycles to the next item', async () => {
    const s = setup(scene(), ['b']);
    await click(s, 125, 87); // 'b' and 'a' here, 'b' selected -> 'a'
    expect(s.log).toEqual(['select:a']);
  });
});

describe('context menu', () => {
  it('right click on a selected item opens the menu for the selection', async () => {
    const s = setup(scene(), ['a']);
    await click(s, 60, 60, { button: 2 });
    expect(s.log).toEqual(['menu:a']);
  });
  it('right click on an unselected item selects it first; on an empty area opens the scene menu', async () => {
    const s = setup(scene(), ['a']);
    await click(s, 190, 110, { button: 2 });
    expect(s.log).toEqual(['select:b', 'menu:b']);
    s.log.length = 0;
    await click(s, 700, 400, { button: 2 });
    expect(s.log).toEqual(['menu:']);
  });
});

describe('drag', () => {
  it('starts on the first move (no threshold), never without movement or from an empty area', async () => {
    const s = setup(scene());
    await s.inter.pointerDown(s.ev(60, 60, { buttons: 1 }));
    await s.inter.pointerMove(s.ev(60, 60, { buttons: 1 })); // zero-distance move event
    await s.inter.pointerUp(s.ev(60, 60));
    expect(s.sent.length).toBe(0);
    expect(s.log).toEqual(['select:a']); // a click, not a drag
    const m = setup(scene());
    await m.inter.pointerDown(m.ev(60, 60, { buttons: 1 }));
    await m.inter.pointerMove(m.ev(61, 60, { buttons: 1 })); // 1 px is enough, first delta applied
    await m.inter.pointerUp(m.ev(61, 60));
    expect(m.sent.at(-1)!.updates).toEqual([
      { id: 'a', transform: { position: { x: 102, y: 100 } } },
    ]);
    const e = setup(scene());
    await e.inter.pointerDown(e.ev(700, 400, { buttons: 1 }));
    await e.inter.pointerMove(e.ev(750, 450, { buttons: 1 }));
    await e.inter.pointerUp(e.ev(750, 450));
    expect(e.sent.length).toBe(0);
  });

  it('selects the item under the cursor, moves it and sends the exact final position on release', async () => {
    const s = setup(scene());
    await s.inter.pointerDown(s.ev(60, 60, { buttons: 1 }));
    await s.inter.pointerMove(s.ev(70, 70, { buttons: 1 }));
    expect(s.log).toEqual(['select:a']);
    await s.inter.pointerMove(s.ev(80, 90, { buttons: 1 }));
    await s.inter.pointerUp(s.ev(90, 100));
    const last = s.sent.at(-1)!.updates;
    // (90-60) css px = 60 canvas px, (100-60) = 80
    expect(last).toEqual([{ id: 'a', transform: { position: { x: 160, y: 180 } } }]);
    expect(s.timersPending).toBe(0);
  });

  it('throttles transform commands to 30 per second and keeps one in flight', async () => {
    const s = setup(scene());
    await s.inter.pointerDown(s.ev(60, 60, { buttons: 1 }));
    await s.inter.pointerMove(s.ev(70, 60, { buttons: 1 }));
    expect(s.sent.length).toBe(1); // the first move goes out at once
    // 20 more moves within 10 ms: nothing new is sent
    for (let i = 0; i < 20; i++) {
      await s.advance(0.5);
      await s.inter.pointerMove(s.ev(71 + i, 60, { buttons: 1 }));
    }
    expect(s.sent.length).toBe(1);
    await s.advance(SEND_INTERVAL_MS);
    expect(s.sent.length).toBe(2);
    // 1 second of 1 kHz moves: about 30 commands, never more
    const before = s.sent.length;
    for (let i = 0; i < 1000; i++) {
      await s.advance(1);
      await s.inter.pointerMove(s.ev(100 + (i % 200), 60, { buttons: 1 }));
    }
    const rate = s.sent.length - before;
    expect(rate).toBeLessThanOrEqual(31);
    expect(rate).toBeGreaterThanOrEqual(28);
  });

  it('latest wins while a command is in flight and flushes the final value on release', async () => {
    const s = setup(scene());
    s.hold(true); // the core does not answer yet
    await s.inter.pointerDown(s.ev(60, 60, { buttons: 1 }));
    await s.inter.pointerMove(s.ev(70, 60, { buttons: 1 }));
    await s.advance(100);
    await s.inter.pointerMove(s.ev(80, 60, { buttons: 1 }));
    await s.advance(100);
    await s.inter.pointerMove(s.ev(90, 60, { buttons: 1 }));
    await s.advance(100);
    expect(s.sent.length).toBe(1); // still waiting for the first answer
    const up = s.inter.pointerUp(s.ev(100, 60));
    await Promise.resolve();
    s.release();
    await Promise.resolve();
    await Promise.resolve();
    s.release();
    await up;
    expect(s.sent.length).toBe(2);
    expect(s.sent.at(-1)!.updates[0].transform.position).toEqual({ x: 180, y: 100 });
  });

  it('dragging a selected item moves the whole selection, Ctrl keeps the selection when starting', async () => {
    const s = setup(scene(), ['a', 'b']);
    await s.inter.pointerDown(s.ev(60, 60, { buttons: 1 }));
    await s.inter.pointerMove(s.ev(80, 60, { buttons: 1 }));
    await s.inter.pointerUp(s.ev(80, 60));
    const ids = s.sent
      .at(-1)!
      .updates.map(u => u.id)
      .sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('snaps to the canvas edge while dragging', async () => {
    const s = setup(scene(), [], true);
    await s.inter.pointerDown(s.ev(60, 60, { buttons: 1 }));
    // item a would end at x = 100 - 2*52 = -4 canvas px: snaps to 0
    await s.inter.pointerMove(s.ev(8, 60, { buttons: 1 }));
    await s.inter.pointerUp(s.ev(8, 60));
    expect(s.sent.at(-1)!.updates[0].transform.position!.x).toBe(0);
  });
});

describe('resize and crop', () => {
  it('pointerdown on a handle of the selection resizes instead of dragging', async () => {
    const s = setup(scene(), ['a']);
    // a's se corner: canvas (300,200) = css (150,100)
    await s.inter.pointerDown(s.ev(150, 100, { buttons: 1 }));
    await s.inter.pointerMove(s.ev(250, 150, { buttons: 1, shift: true }));
    await s.inter.pointerUp(s.ev(250, 150, { shift: true }));
    const u = s.sent.at(-1)!.updates[0];
    expect(u.id).toBe('a');
    // shift = free aspect: width 200 -> 400 canvas px (x2), height 100 -> 200 (x2)
    expect(u.transform.scale).toEqual({ x: 2, y: 2 });
    expect(u.transform.position).toEqual({ x: 100, y: 100 });
  });

  it('Alt on an edge handle crops', async () => {
    const s = setup(scene(), ['a']);
    // a's east handle: canvas (300,150) = css (150,75)
    await s.inter.pointerDown(s.ev(150, 75, { buttons: 1, alt: true }));
    await s.inter.pointerMove(s.ev(125, 75, { buttons: 1, alt: true }));
    await s.inter.pointerUp(s.ev(125, 75, { alt: true }));
    const u = s.sent.at(-1)!.updates[0];
    expect(u.transform.crop?.right).toBeGreaterThan(0);
    expect(u.transform.scale).toBeUndefined();
  });
});

describe('cursor', () => {
  it('shows resize cursors over handles, grab over items and default elsewhere', async () => {
    const s = setup(scene(), ['a']);
    await s.inter.pointerMove(s.ev(150, 100)); // se handle
    await s.inter.pointerMove(s.ev(100, 50)); // n handle
    await s.inter.pointerMove(s.ev(75, 75)); // inside a, no handle
    await s.inter.pointerMove(s.ev(700, 400)); // nothing
    expect(s.cursors).toEqual(['nwse-resize', 'ns-resize', 'grab', 'default']);
  });
  it('shows grabbing while dragging', async () => {
    const s = setup(scene());
    await s.inter.pointerDown(s.ev(60, 60, { buttons: 1 }));
    await s.inter.pointerMove(s.ev(80, 60, { buttons: 1 }));
    expect(s.cursors).toContain('grabbing');
  });
});

describe('idle cost', () => {
  it('hover does no IPC and keeps no timers', async () => {
    const s = setup(scene(), ['a']);
    for (let i = 0; i < 50; i++) await s.inter.pointerMove(s.ev(i, i));
    expect(s.fetches).toBe(0);
    expect(s.timersPending).toBe(0);
  });
  it('geometry is fetched fresh on every pointerdown', async () => {
    const s = setup(scene());
    await click(s, 60, 60);
    await click(s, 60, 60);
    expect(s.fetches).toBe(2);
  });
});
