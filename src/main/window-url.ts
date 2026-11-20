/**
 * The ONE place that decides where window pages load from.
 * - dev: the Vite dev server (HMR), set by scripts/dev.mjs
 * - otherwise: slbundle://app/<name>.html, served by the bundle updater's protocol handler from the
 *   active bundle set (app.asar, or the completed hotfix cache). The handler resolves files by the URL
 *   path only, so a query string (`?dialog=<id>`) never affects which file is served.
 */
export function windowUrl(name: string, query?: Record<string, string>): string {
  const dev = process.env.VITE_DEV_SERVER_URL;
  const base = dev ? `${dev.replace(/\/$/, '')}/${name}/index.html` : `slbundle://app/${name}.html`;
  if (!query || Object.keys(query).length === 0) return base;
  return `${base}?${new URLSearchParams(query).toString()}`;
}
