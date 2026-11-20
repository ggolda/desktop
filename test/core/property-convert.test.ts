import { describe, expect, it } from 'vitest';
import type { BackendProperty } from '@/core/media/backend';
import { convertProperty, parsePathFilters } from '@/core/properties/convert';
import { buildCatalogue } from '@/core/sources/catalogue';
import { defaultsFor, sharedResourcesDir } from '@/core/sources/defaults';

const bp = (p: Partial<BackendProperty> & { type: number }): BackendProperty => ({
  name: 'p',
  description: 'P',
  longDescription: '',
  enabled: true,
  visible: true,
  value: undefined,
  ...p,
});

describe('convertProperty', () => {
  it('bool, numbers and slider', () => {
    expect(convertProperty(bp({ type: 1, value: 1 }))).toMatchObject({ kind: 'bool', value: true });
    expect(
      convertProperty(
        bp({ type: 2, value: 5, number: { slider: false, min: 0, max: 9, step: 1 } }),
      ),
    ).toEqual(expect.objectContaining({ kind: 'int', value: 5, min: 0, max: 9, step: 1 }));
    expect(
      convertProperty(
        bp({ type: 3, value: 1.5, number: { slider: false, min: 0, max: 9, step: 0.1 } }),
      ),
    ).toMatchObject({ kind: 'float', value: 1.5 });
    expect(
      convertProperty(
        bp({ type: 2, value: 3, number: { slider: true, min: 0, max: 100, step: 1 } }),
      ),
    ).toMatchObject({ kind: 'slider', numberType: 'int', value: 3 });
  });

  it('text variants and info severity', () => {
    const t = (type: number, infoType = 0) =>
      convertProperty(bp({ type: 4, value: 'x', text: { type, infoType } }));
    expect(t(0).kind).toBe('text');
    expect(t(1).kind).toBe('password');
    expect(t(2).kind).toBe('multiline');
    expect(t(3, 1)).toMatchObject({ kind: 'info', severity: 'warning', value: 'x' });
    expect(t(3, 2)).toMatchObject({ severity: 'error' });
  });

  it('paths with filters', () => {
    const path = (type: number) =>
      convertProperty(
        bp({
          type: 5,
          value: 'C:\\a',
          path: { type, filter: 'Images (*.png *.jpg);;All Files (*.*)', defaultPath: 'C:\\' },
        }),
      );
    expect(path(0)).toMatchObject({
      kind: 'path-file',
      value: 'C:\\a',
      defaultPath: 'C:\\',
      filters: [
        { name: 'Images', extensions: ['png', 'jpg'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    expect(path(1).kind).toBe('path-save');
    expect(path(2).kind).toBe('path-dir');
  });

  it('list formats and the unset value', () => {
    const list = (format: number, value: unknown) =>
      convertProperty(
        bp({
          type: 6,
          value,
          list: {
            format,
            items: [
              { name: 'A', value: format === 3 ? 'a' : 1 },
              { name: 'B', value: format === 3 ? 'b' : 2 },
            ],
          },
        }),
      );
    expect(list(3, 'b')).toMatchObject({ kind: 'list', format: 'string', value: 'b' });
    expect(list(1, 2)).toMatchObject({ format: 'int', value: 2 });
    expect(list(2, 2)).toMatchObject({ format: 'float' });
    expect(list(3, undefined)).toMatchObject({ value: 'a' });
  });

  it('color (signed int32 and alpha), button, font, editable list, unsupported', () => {
    expect(convertProperty(bp({ type: 7, value: -1 }))).toMatchObject({
      kind: 'color',
      value: 4294967295,
      alpha: false,
    });
    expect(convertProperty(bp({ type: 13, value: 0x80ff0000 }))).toMatchObject({
      kind: 'color',
      alpha: true,
    });
    expect(convertProperty(bp({ type: 8 })).kind).toBe('button');
    expect(
      convertProperty(
        bp({ type: 9, value: { face: 'Arial', style: '', size: 36, flags: 0, path: 'C:\\f.ttf' } }),
      ),
    ).toMatchObject({
      kind: 'font',
      value: { face: 'Arial', size: 36, flags: 0, path: 'C:\\f.ttf' },
    });
    expect(convertProperty(bp({ type: 9, value: { face: 'Arial', path: '' } }))).toMatchObject({
      kind: 'font',
      value: { face: 'Arial' },
    });
    expect(
      convertProperty(
        bp({
          type: 10,
          value: [{ value: 'a.png', selected: false, hidden: false }, 'b.png'],
          editable: { type: 2, filter: 'Images (*.png)', defaultPath: 'D' },
        }),
      ),
    ).toMatchObject({
      kind: 'editable-list',
      listType: 'files-and-urls',
      value: ['a.png', 'b.png'],
      filters: [{ name: 'Images', extensions: ['png'] }],
      defaultPath: 'D',
    });
    for (const type of [11, 12, 14, 0]) {
      expect(convertProperty(bp({ type }))).toMatchObject({
        kind: 'unsupported',
        backendType: type,
      });
    }
  });

  it('keeps visibility, enabled state and the long description', () => {
    expect(
      convertProperty(bp({ type: 1, visible: false, enabled: false, longDescription: 'tip' })),
    ).toMatchObject({ visible: false, enabled: false, longDescription: 'tip' });
  });
});

describe('parsePathFilters', () => {
  it('follows the legacy rules', () => {
    expect(parsePathFilters('*.*')).toEqual([{ name: 'All Files', extensions: ['*'] }]);
    expect(parsePathFilters('')).toEqual([]);
    expect(parsePathFilters('Text Files (*.txt);;junk;;Other (*.a *.b)')).toEqual([
      { name: 'Text Files', extensions: ['txt'] },
      { name: 'Other', extensions: ['a', 'b'] },
    ]);
  });
});

describe('catalogue', () => {
  const all = ['image_source', 'color_source', 'browser_source', 'ffmpeg_source', 'game_capture'];
  it('availability follows the backend, the OS, scenes and features', () => {
    const c = buildCatalogue({ backendTypes: all, sceneCount: 1 });
    const by = (id: string) => c.entries.find(e => e.id === id)!;
    expect(by('image_source').availability).toBe('available');
    expect(by('slideshow')).toMatchObject({ availability: 'hidden', reason: 'backend' });
    expect(by('text_ft2_source')).toMatchObject({ availability: 'hidden', reason: 'backend' });
    expect(by('scene')).toMatchObject({ availability: 'hidden', reason: 'scenes' });
    expect(by('replay')).toMatchObject({ availability: 'hidden', reason: 'feature' });
    expect(by('streamlabel')).toMatchObject({ availability: 'hidden', reason: 'login' });
    expect(by('game_capture')).toMatchObject({ essentialOrder: 1 });
    expect(by('dshow_input').essentialOrder).toBe(2);
    expect(by('ffmpeg_source').essentialOrder).toBe(3);
    expect(c.initial).toBe('ffmpeg_source');
    expect(c.widgets).toEqual({ available: false, reason: 'login' });
    expect(
      buildCatalogue({ backendTypes: all, sceneCount: 2 }).entries.find(e => e.id === 'scene')!
        .availability,
    ).toBe('available');
    const ids = c.entries.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('wasapi_process_output_capture');
  });
});

describe('defaultsFor', () => {
  it('matches the legacy creation settings', () => {
    expect(defaultsFor('browser_source', 'x')).toEqual({
      shutdown: true,
      url: 'https://streamlabs.com/browser-source',
    });
    expect(defaultsFor('text_gdiplus', 'Hi')).toEqual({ text: 'Hi', version: 3 });
    expect(defaultsFor('ffmpeg_source', 'm')).toEqual({ is_media_flag: false });
    expect(defaultsFor('color_source', 'c')).toEqual({});
    expect(defaultsFor('image_source', 'i')).toEqual({});
    const g = defaultsFor('screen_capture', 's', { userData: '/u', sharedResources: '/r' });
    expect(g).toMatchObject({ capture_overlays: true });
    expect(String(g.auto_capture_rules_path).replace(/\\/g, '/')).toBe('/u/game_capture_list.json');
    expect(String(g.window_placeholder_image).replace(/\\/g, '/')).toBe(
      '/r/capture-placeholder.png',
    );
  });

  it('locates shared-resources like legacy getSharedResource', () => {
    expect(sharedResourcesDir('/repo').replace(/\\/g, '/')).toMatch(/\/repo\/shared-resources$/);
    expect(sharedResourcesDir('/inst/resources/app.asar').replace(/\\/g, '/')).toMatch(
      /\/inst\/shared-resources$/,
    );
  });
});
