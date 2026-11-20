import { describe, expect, it } from 'vitest';
import { placeDialog } from '../../src/main/dialog-geometry';
import { windowUrl } from '../../src/main/window-url';

const work = { x: 0, y: 0, width: 1920, height: 1040 };

describe('placeDialog', () => {
  it('centers on the main window', () => {
    const r = placeDialog(
      { width: 600, height: 800 },
      { x: 100, y: 50, width: 1400, height: 900 },
      work,
      true,
    );
    expect(r).toEqual({ width: 600, height: 800, x: 500, y: 100 });
  });
  it('clamps the size and the position to the work area', () => {
    const r = placeDialog(
      { width: 900, height: 2000 },
      { x: 1800, y: 0, width: 100, height: 100 },
      work,
      true,
    );
    expect(r.height).toBe(1040);
    expect(r.x).toBe(1920 - 900);
    expect(r.y).toBe(0);
  });
  it('keeps the position when not centering', () => {
    expect(placeDialog({ width: 400, height: 250 }, null, work, false)).toEqual({
      width: 400,
      height: 250,
    });
  });
  it('centers on the work area without a main window', () => {
    expect(placeDialog({ width: 400, height: 240 }, null, work, true)).toMatchObject({
      x: 760,
      y: 400,
    });
  });
});

describe('windowUrl', () => {
  it('adds the dialog query for slbundle and the dev server', () => {
    delete process.env.VITE_DEV_SERVER_URL;
    expect(windowUrl('dialog-add-source', { dialog: 'abc' })).toBe(
      'slbundle://app/dialog-add-source.html?dialog=abc',
    );
    expect(windowUrl('main')).toBe('slbundle://app/main.html');
    process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173/';
    try {
      expect(windowUrl('dialog-name-scene', { dialog: 'x' })).toBe(
        'http://localhost:5173/dialog-name-scene/index.html?dialog=x',
      );
    } finally {
      delete process.env.VITE_DEV_SERVER_URL;
    }
  });
});
