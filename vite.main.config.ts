import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import { nodeBundle, root } from './vite.shared';

// Electron main process: CJS, lives in app.asar (not hotfixable).
const config = nodeBundle({
  entry: 'src/main/index.ts',
  outDir: 'build/main',
  fileName: 'index.js',
});

// core-loader.cjs is plain JS, forked as the core utilityProcess entry (see core-process.ts).
config.plugins = [
  {
    name: 'slobs:copy-core-loader',
    apply: 'build',
    closeBundle() {
      const out = path.join(root, 'build/main');
      fs.mkdirSync(out, { recursive: true });
      fs.copyFileSync(
        path.join(root, 'src/main/core-loader.cjs'),
        path.join(out, 'core-loader.cjs'),
      );
    },
  },
];

export default defineConfig(config);
