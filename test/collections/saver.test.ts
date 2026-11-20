import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CollectionDocument } from '@/core/collections/document';
import { DEBOUNCE_MS, MAX_WAIT_MS, createSaver } from '@/core/collections/saver';
import type { Ctx } from '@/core/context';
import { ID, buildV5, toText } from '../fixtures/synthetic';

function setup() {
  const doc = CollectionDocument.parse(toText(buildV5()));
  const writes: string[] = [];
  const ctx = {
    doc,
    activeId: 'c1',
    saveBlocked: false,
    backendReady: false,
    loading: false,
    slices: { canvases: {} },
    store: {
      write: vi.fn(async (_id: string, text: string) => {
        writes.push(text);
      }),
    },
    requireDoc: () => doc,
  } as unknown as Ctx;
  const saved: string[] = [];
  const saver = createSaver(ctx, {
    onSaved: async id => {
      saved.push(id);
    },
  });
  let n = 0;
  const touch = () => {
    doc.source(ID.image)!.name = `name ${n++}`;
    doc.touchSource(ID.image);
    saver.schedule();
  };
  return { doc, ctx, saver, writes, saved, touch };
}

describe('save scheduling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('writes nothing when clean', async () => {
    const { saver, writes } = setup();
    expect(await saver.flush()).toBe(false);
    saver.schedule(); // nothing dirty: the timer fires but there is nothing to write
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(writes).toHaveLength(0);
  });

  it('debounces: one write 2 s after the last change', async () => {
    const { saver, writes, touch } = setup();
    touch();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    expect(writes).toHaveLength(0);
    touch(); // restarts the debounce
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    expect(writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(writes).toHaveLength(1);
    expect(saver.pending()).toBe(false);
  });

  it('never waits longer than 30 s under a constant stream of changes', async () => {
    const { writes, touch } = setup();
    touch();
    for (let t = 0; t < MAX_WAIT_MS - 1000; t += 1000) {
      await vi.advanceTimersByTimeAsync(1000); // always faster than the debounce
      touch();
    }
    expect(writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(writes).toHaveLength(1);
  });

  it('has no timer while idle and after a save', async () => {
    const { saver, touch } = setup();
    expect(saver.pending()).toBe(false);
    touch();
    expect(saver.pending()).toBe(true);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 1);
    expect(saver.pending()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('flush writes at once and clears the timer; a blocked collection is never saved', async () => {
    const { saver, writes, touch, ctx } = setup();
    touch();
    expect(await saver.flush()).toBe(true);
    expect(saver.pending()).toBe(false);
    expect(writes).toHaveLength(1);
    (ctx as { saveBlocked: boolean }).saveBlocked = true;
    touch();
    expect(await saver.flush()).toBe(false);
    expect(writes).toHaveLength(1);
  });

  it('a failed write keeps the data dirty and retries', async () => {
    const { saver, ctx, touch, writes } = setup();
    const write = ctx.store.write as unknown as ReturnType<typeof vi.fn>;
    write.mockRejectedValueOnce(new Error('disk full'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    touch();
    await expect(saver.flush()).rejects.toThrow('disk full');
    expect(saver.pending()).toBe(true);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 1);
    expect(writes).toHaveLength(1);
  });
});
