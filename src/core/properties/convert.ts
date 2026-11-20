// Pure conversion of backend property data (`BackendProperty`) into the wire `Property` of
// contracts/properties.ts (m1-dialogs-design 4.1). No backend, no I/O.
import type {
  FontValue,
  ListProperty,
  PathFilter,
  Property,
  PropertyBase,
} from '../../shared/contracts';
import type { BackendProperty } from '../media/backend';

/** EPropertyType (obs-studio-node). */
const T = {
  Boolean: 1,
  Int: 2,
  Float: 3,
  Text: 4,
  Path: 5,
  List: 6,
  Color: 7,
  Button: 8,
  Font: 9,
  EditableList: 10,
  ColorAlpha: 13,
} as const;

/**
 * libobs filter string `Name (*.a *.b);;Other (*.c)` -> native dialog filters (legacy
 * `parsePathFilters`). `*.*` alone is "All Files". Entries that do not parse are dropped.
 */
export function parsePathFilters(filterStr: string | undefined | null): PathFilter[] {
  if (!filterStr) return [];
  if (filterStr === '*.*') return [{ name: 'All Files', extensions: ['*'] }];
  const out: PathFilter[] = [];
  for (const part of filterStr.split(';;')) {
    if (!part) continue;
    const m = part.match(/^(.*)\((.*)\)\s*$/);
    if (!m) continue;
    const extensions: string[] = [];
    for (const t of m[2].split(' ')) {
      const e = t.match(/^\*\.(.+)$/);
      if (e) extensions.push(e[1]);
    }
    if (extensions.length) out.push({ name: m[1].trim(), extensions });
  }
  return out;
}

const LIST_FORMATS = { 1: 'int', 2: 'float', 3: 'string' } as const;
const EDITABLE_TYPES = ['strings', 'files', 'files-and-urls'] as const;
const SEVERITIES = ['normal', 'warning', 'error'] as const;

function toFont(v: unknown): FontValue {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const out: FontValue = {};
  if (typeof o.face === 'string') out.face = o.face;
  if (typeof o.style === 'string') out.style = o.style;
  if (typeof o.size === 'number') out.size = o.size;
  if (typeof o.flags === 'number') out.flags = o.flags;
  if (typeof o.path === 'string' && o.path) out.path = o.path;
  return out;
}

/** Editable list values are `string[]` or `{ value, selected, hidden }[]` depending on the source. */
function toStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(e =>
    typeof e === 'string' ? e : String((e as { value?: unknown } | null)?.value ?? ''),
  );
}

export function convertProperty(bp: BackendProperty): Property {
  const base: PropertyBase = {
    kind: 'unsupported',
    name: bp.name,
    description: bp.description ?? '',
    enabled: !!bp.enabled,
    visible: !!bp.visible,
  };
  if (bp.longDescription) base.longDescription = bp.longDescription;
  const v = bp.value;
  switch (bp.type) {
    case T.Boolean:
      return { ...base, kind: 'bool', value: !!v };
    case T.Int:
    case T.Float: {
      const n = bp.number ?? { slider: false, min: 0, max: 0, step: 1 };
      const numberType = bp.type === T.Int ? 'int' : 'float';
      return {
        ...base,
        kind: n.slider ? 'slider' : numberType,
        value: Number(v ?? 0),
        min: n.min,
        max: n.max,
        step: n.step,
        ...(n.slider ? { numberType } : {}),
      } as Property;
    }
    case T.Text: {
      const t = bp.text ?? { type: 0, infoType: 0 };
      if (t.type === 3) {
        return {
          ...base,
          kind: 'info',
          value: String(v ?? ''),
          severity: SEVERITIES[t.infoType] ?? 'normal',
        };
      }
      const kind = t.type === 1 ? 'password' : t.type === 2 ? 'multiline' : 'text';
      return { ...base, kind, value: String(v ?? '') };
    }
    case T.Path: {
      const p = bp.path ?? { type: 0, filter: '', defaultPath: '' };
      const kind = p.type === 1 ? 'path-save' : p.type === 2 ? 'path-dir' : 'path-file';
      return {
        ...base,
        kind,
        value: String(v ?? ''),
        filters: parsePathFilters(p.filter),
        defaultPath: p.defaultPath ?? '',
      };
    }
    case T.List: {
      const l = bp.list ?? { format: 3, items: [] };
      const items = l.items.map(i => ({ name: i.name, value: i.value }));
      // legacy: an unset value takes the first item
      const value =
        v === undefined || v === null ? (items[0]?.value ?? '') : (v as string | number);
      const out: ListProperty = {
        ...base,
        kind: 'list',
        value,
        format: LIST_FORMATS[l.format as 1 | 2 | 3] ?? 'string',
        items,
      };
      return out;
    }
    case T.Color:
    case T.ColorAlpha:
      // libobs stores 0xAABBGGRR; OSN can hand it back as a signed int32
      return {
        ...base,
        kind: 'color',
        value: Number(v ?? 0) >>> 0,
        alpha: bp.type === T.ColorAlpha,
      };
    case T.Button:
      return { ...base, kind: 'button' };
    case T.Font:
      return { ...base, kind: 'font', value: toFont(v) };
    case T.EditableList: {
      const e = bp.editable ?? { type: 0, filter: '', defaultPath: '' };
      return {
        ...base,
        kind: 'editable-list',
        value: toStringList(v),
        listType: EDITABLE_TYPES[e.type] ?? 'strings',
        filters: parsePathFilters(e.filter),
        defaultPath: e.defaultPath ?? '',
      };
    }
    default:
      return { ...base, kind: 'unsupported', backendType: bp.type };
  }
}

export const convertProperties = (list: BackendProperty[]): Property[] => list.map(convertProperty);
