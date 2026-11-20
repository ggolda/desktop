import vue from '@vitejs/plugin-vue';
import fs from 'node:fs';
import path from 'node:path';
import UnoCSS from 'unocss/vite';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';
import { alias, root, slobsManifest } from './vite.shared';

// One entry per window type: src/windows/<name>/index.html. The dialog entries are the legacy child
// window pages (m1-dialogs-design 3.2); the hotfix manifest picks them up through `slobsManifest`.
const windows = [
  'main',
  'dialog-source-showcase',
  'dialog-add-source',
  'dialog-source-properties',
  'dialog-name-scene',
  'dialog-rename-source',
  'dialog-name-folder',
];

/**
 * Production output is flat: bundles/<name>.html next to hashed assets (same flat layout the
 * hotfix manifest expects). Vite emits <name>/index.html with ../ asset paths, so move + rewrite.
 */
function flatHtml(): Plugin {
  let outDir = '';
  return {
    name: 'slobs:flat-html',
    apply: 'build',
    configResolved(cfg) {
      outDir = path.resolve(cfg.root, cfg.build.outDir);
    },
    closeBundle() {
      for (const name of windows) {
        const dir = path.join(outDir, name);
        const file = path.join(dir, 'index.html');
        if (!fs.existsSync(file)) continue;
        const html = fs.readFileSync(file, 'utf8').replace(/(src|href)="\.\.\//g, '$1="./');
        fs.writeFileSync(path.join(outDir, `${name}.html`), html);
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

/** Fonts every dialog window needs for its first frame (see src/ui/dialog/ready.ts): latin Roboto, icons. */
const DIALOG_FONTS =
  /^(roboto-(400|500|700)-latin|icomoon|fa-solid-900|fa-regular-400)\.[\w-]+\.(woff2?)$/;

/**
 * `<link rel="preload" as="font">` for the dialog pages, with the hashed file names of the build, so the
 * fonts download in parallel with the scripts instead of after the first layout (no font swap, no late
 * icons). Hrefs start with `../` like Vite's own, which `flatHtml` rewrites.
 */
function preloadDialogFonts(): Plugin {
  return {
    name: 'slobs:preload-dialog-fonts',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        if (!ctx.bundle || !/dialog-/.test(ctx.path)) return;
        return Object.values(ctx.bundle)
          .filter(o => o.type === 'asset' && DIALOG_FONTS.test(o.fileName))
          .map(o => ({
            tag: 'link',
            attrs: {
              rel: 'preload',
              as: 'font',
              type: o.fileName.endsWith('.woff2') ? 'font/woff2' : 'font/woff',
              href: `../${o.fileName}`,
              crossorigin: '',
            },
            injectTo: 'head-prepend' as const,
          }));
      },
    },
  };
}

export default defineConfig({
  root: path.join(root, 'src/windows'),
  base: './',
  publicDir: false,
  cacheDir: path.join(root, 'node_modules/.vite'),
  plugins: [
    vue(),
    UnoCSS({ configFile: path.join(root, 'uno.config.ts') }),
    AutoImport({
      imports: ['vue', '@vueuse/core', 'pinia'],
      dts: path.join(root, 'src/types/auto-imports.d.ts'),
      vueTemplate: true,
    }),
    Components({
      dirs: [path.join(root, 'src/ui/components')],
      dts: path.join(root, 'src/types/components.d.ts'),
      deep: true,
      extensions: ['vue'],
    }),
    preloadDialogFonts(),
    flatHtml(),
    slobsManifest(),
  ],
  resolve: { alias },
  server: { host: 'localhost', port: 5173, strictPort: true },
  build: {
    outDir: path.join(root, 'bundles'),
    emptyOutDir: false, // scripts/build.mjs cleans bundles/ once; preload/core share the folder
    assetsDir: '',
    target: 'chrome140',
    sourcemap: true,
    rollupOptions: {
      input: Object.fromEntries(
        windows.map(w => [w, path.join(root, `src/windows/${w}/index.html`)]),
      ),
      output: {
        entryFileNames: '[name].[hash].js',
        chunkFileNames: '[name].[hash].js',
        assetFileNames: '[name].[hash][extname]',
      },
    },
  },
});
