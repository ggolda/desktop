// Demo images / videos of the side panel (legacy `media/source-demos/<night|day>/`). The glob makes Vite
// emit the files next to the other flat bundles; only this entry references them.
const night = import.meta.glob('../../../media/source-demos/night/*', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const byFile = new Map(Object.entries(night).map(([p, url]) => [p.split('/').pop()!, url]));

export const demoUrl = (file: string): string | undefined => byFile.get(file);

export const sleepingKevin = new URL(
  '../../../media/images/sleeping-kevin-night.png',
  import.meta.url,
).href;
