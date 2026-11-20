import { describe, expect, it, vi } from 'vitest';
import { MIN_PIXEL_CHANGE, MeterPainter, parseMeterFrame } from '@/ui/audio/meters';

const frame = (rev: number, ...sources: number[][]) => {
  const out = [1, rev, sources.length];
  for (const peaks of sources) out.push(peaks.length, ...peaks, ...peaks, ...peaks);
  return new Float32Array(out);
};

describe('parseMeterFrame', () => {
  it('reads the per-source peaks in mixer order', () => {
    const f = frame(3, [-10, -12], [-30, -31]);
    expect(parseMeterFrame(f, 3)).toEqual([
      [-10, -12],
      [-30, -31],
    ]);
  });
  it('drops frames for another mixer revision, another version or garbage', () => {
    expect(parseMeterFrame(frame(2, [-10]), 3)).toBeNull();
    expect(parseMeterFrame([2, 3, 0], 3)).toBeNull();
    expect(parseMeterFrame([], 3)).toBeNull();
    expect(parseMeterFrame([1, 3, 2, 2, -1], 3)).toBeNull(); // truncated
  });
  it('accepts plain arrays and an unknown rev', () => {
    expect(parseMeterFrame([1, 7, 1, 1, -5, -5, -5], undefined)).toEqual([[-5]]);
  });
});

function painter(width = 600) {
  const ctx = { fillRect: vi.fn(), setTransform: vi.fn(), fillStyle: '' };
  const canvas = { width: 0, height: 0, style: { width: '', height: '' }, getContext: () => ctx };
  const p = new MeterPainter(canvas as never);
  p.resize(width, 1);
  return { p, ctx, canvas };
}

describe('MeterPainter', () => {
  it('sizes the canvas for the channel count (3 px bars, 2 px gap)', () => {
    const { p, canvas } = painter(600);
    p.draw([-30, -30]);
    expect(canvas.height).toBe(MeterPainter.heightFor(2));
    expect(canvas.height).toBe(8);
    expect(canvas.style.width).toBe('600px');
  });

  it('repaints only when a level moved by at least 2 px', () => {
    const { p } = painter(600); // 10 px per dB
    expect(p.draw([-30, -30])).toBe(true);
    expect(p.paints).toBe(1);
    expect(p.draw([-30, -30])).toBe(false); // identical
    expect(p.draw([-29.95, -30])).toBe(false); // 0.5 px
    expect(p.draw([-29.7, -30])).toBe(true); // 3 px
    expect(MIN_PIXEL_CHANGE).toBe(2);
  });

  it('forces a repaint after a resize and treats -65535 (muted) as empty', () => {
    const { p } = painter(600);
    p.draw([-65535, -65535]);
    expect(p.dbToPx(-65535)).toBe(0);
    p.resize(300, 1);
    expect(p.draw([-65535, -65535])).toBe(true);
  });

  it('does not paint before it has a width (hidden panel)', () => {
    const { p } = painter(0);
    expect(p.draw([-10, -10])).toBe(false);
  });
});
