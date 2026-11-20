import crypto from 'node:crypto';
import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InlineConfig, Plugin } from 'vite';

export const root = fileURLToPath(new URL('.', import.meta.url));

/** The only native modules the app may use (SPEC R5). Never bundled. */
export const nativeModules = [
  'obs-studio-node',
  'crash-handler',
  'font-manager',
  'node-fontinfo',
  'node-libuiohook',
  'game_overlay',
  'color-picker',
  'node-window-rendering',
  'node-win32-np',
  'node-screenshots',
  'realm',
];

export const alias = { '@': `${root}src` };

const HASHED = /^(.+)\.[A-Za-z0-9_-]{8}(\.[A-Za-z0-9]+(?:\.map)?)$/;

/**
 * Writes bundles/manifest.json in the format the bundle updater (and the release CDN) expect:
 * `logicalName -> fileName` for every file in the flat bundles dir (`.map` included), plus
 * `checksums: { fileName: md5 }` for every non-map file. Scans the whole folder, so it can run
 * after each of the builds (preload, core, windows) that share it. `prune` removes stale
 * hashed outputs of the same entry (dev watch builds).
 */
export function slobsManifest(opts: { prune?: string[] } = {}): Plugin {
  let outDir = '';
  return {
    name: 'slobs:manifest',
    apply: 'build',
    configResolved(cfg) {
      outDir = path.resolve(cfg.root, cfg.build.outDir);
    },
    closeBundle: {
      order: 'post',
      sequential: true,
      handler() {
        const all = fs.readdirSync(outDir).filter(f => f !== 'manifest.json');
        for (const prefix of opts.prune ?? []) {
          const mine = all.filter(f => f.startsWith(`${prefix}.`) && HASHED.test(f));
          const newest = mine
            .filter(f => !f.endsWith('.map'))
            .map(f => ({ f, t: fs.statSync(path.join(outDir, f)).mtimeMs }))
            .sort((a, b) => b.t - a.t)[0]?.f;
          for (const f of mine) {
            if (newest && !f.startsWith(newest.replace(/\.js$/, ''))) {
              fs.rmSync(path.join(outDir, f), { force: true });
            }
          }
        }
        const files = fs
          .readdirSync(outDir, { withFileTypes: true })
          .filter(d => d.isFile() && d.name !== 'manifest.json')
          .map(d => d.name)
          .sort();
        const manifest: Record<string, unknown> = {};
        const checksums: Record<string, string> = {};
        for (const f of files) {
          const m = HASHED.exec(f);
          let key = m ? `${m[1]}${m[2]}` : f;
          if (key in manifest && manifest[key] !== f) key = f; // name clash between builds
          manifest[key] = f;
          if (!f.endsWith('.map')) {
            checksums[f] = crypto
              .createHash('md5')
              .update(fs.readFileSync(path.join(outDir, f)))
              .digest('hex');
          }
        }
        manifest.checksums = checksums;
        fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
      },
    },
  };
}

/** Shared settings for the Node-side bundles: one CJS file, externals, no minification. */
export function nodeBundle(opts: {
  entry: string;
  outDir: string;
  fileName: string;
  /** Content-hash the output (`name.<hash>.js`) and add it to bundles/manifest.json. */
  hashed?: boolean;
}): InlineConfig {
  const external = [
    'electron',
    ...nativeModules,
    ...builtinModules,
    /^node:/,
    ...nativeModules.map(m => new RegExp(`^${m}/`)),
  ];
  return {
    root,
    configFile: false,
    publicDir: false,
    resolve: { alias },
    plugins: opts.hashed ? [slobsManifest({ prune: [opts.fileName.replace(/\.js$/, '')] })] : [],
    build: {
      outDir: opts.outDir,
      emptyOutDir: false,
      target: 'node22',
      minify: false,
      sourcemap: true,
      lib: {
        entry: opts.entry,
        formats: ['cjs'],
        fileName: () => opts.fileName,
      },
      rollupOptions: {
        external,
        output: opts.hashed
          ? { entryFileNames: opts.fileName.replace(/\.js$/, '.[hash].js') }
          : undefined,
      },
    },
  };
}
