import { defineConfig } from 'vite';
import { nodeBundle } from './vite.shared';

// Single sandboxed preload for all windows: one CJS file.
export default defineConfig(
  nodeBundle({
    entry: 'src/preload/index.ts',
    outDir: 'bundles',
    fileName: 'preload.js',
    hashed: true,
  }),
);
