// Deterministic test data shared by the mock core and all implementations (docs/rework/chapter2).
export const SOURCE_TYPES = ['camera', 'display', 'browser', 'image', 'audio'];

export function makeSnapshot() {
  const scenes = Array.from({ length: 30 }, (_, i) => ({ id: `scene-${i}`, name: `Scene ${i + 1}` }));
  const sources = Array.from({ length: 60 }, (_, i) => ({
    id: `source-${i}`,
    name: `Source ${i + 1} - ${SOURCE_TYPES[i % SOURCE_TYPES.length]}`,
    type: SOURCE_TYPES[i % SOURCE_TYPES.length],
    visible: i % 7 !== 0,
    locked: i % 5 === 0,
  }));
  const mixer = Array.from({ length: 4 }, (_, i) => ({
    id: `audio-${i}`,
    name: ['Desktop Audio', 'Mic/Aux', 'Music', 'Browser'][i],
    volumeDb: -6 * i,
    muted: false,
  }));
  return {
    activeSceneId: 'scene-0',
    scenes,
    sources,
    mixer,
    stats: { cpu: 1.2, fps: 60, dropped: 0, elapsed: 0 },
    settings: makeSettingsSchema(),
  };
}

// Settings form schema, like the backend-neutral PropertySchema proposed for the media backend.
export function makeSettingsSchema() {
  const categories = ['General', 'Stream', 'Output', 'Audio', 'Video', 'Hotkeys', 'Advanced', 'Appearance'];
  const kinds = ['text', 'number', 'select', 'checkbox', 'slider'];
  return categories.map((name, c) => ({
    id: `cat-${c}`,
    name,
    fields: Array.from({ length: c === 0 ? 150 : 20 }, (_, i) => {
      const kind = kinds[i % kinds.length];
      return {
        id: `f-${c}-${i}`,
        label: `${name} option ${i + 1}`,
        description: `Description for ${name.toLowerCase()} option ${i + 1}.`,
        kind,
        options:
          kind === 'select'
            ? Array.from({ length: 10 }, (_, o) => ({ value: `o${o}`, label: `Choice ${o + 1}` }))
            : undefined,
        value:
          kind === 'checkbox'
            ? i % 2 === 0
            : kind === 'number' || kind === 'slider'
            ? i
            : kind === 'select'
            ? 'o0'
            : `value ${i}`,
      };
    }),
  }));
}
