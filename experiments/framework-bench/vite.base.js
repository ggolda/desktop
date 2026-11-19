// Shared Vite config factory: every implementation builds src/<fw>/{editor,settings,rename}.html
// into dist/<fw>/ with UnoCSS, relative paths (loaded via file://), no minification differences.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import UnoCSS from 'unocss/vite';

const here = path.dirname(fileURLToPath(import.meta.url));

// file:// pages can't satisfy `crossorigin` module/preload fetches; strip the attribute.
const stripCrossorigin = () => ({
  name: 'strip-crossorigin',
  transformIndexHtml: html => html.replace(/ crossorigin/g, ''),
});

export function makeConfig(fw, frameworkPlugins = []) {
  const root = path.join(here, 'src', fw);
  return {
    root,
    base: './',
    logLevel: 'warn',
    plugins: [UnoCSS({ configFile: path.join(here, 'uno.config.js') }), ...frameworkPlugins, stripCrossorigin()],
    build: {
      outDir: path.join(here, 'dist', fw),
      emptyOutDir: true,
      modulePreload: false,
      reportCompressedSize: false,
      rollupOptions: {
        input: {
          editor: path.join(root, 'editor.html'),
          settings: path.join(root, 'settings.html'),
          rename: path.join(root, 'rename.html'),
        },
      },
    },
  };
}
