/**
 * Placeholder for the legacy `$t` / `$translateIfExist`: reborn has no i18n layer yet, so every text is
 * its English key. Components call `t()` so a real implementation can drop in later.
 */
export const t = (key: string, vars?: Record<string, string | number>): string =>
  vars ? key.replace(/%\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? '')) : key;
