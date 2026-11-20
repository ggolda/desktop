import { defineConfig } from 'vite';
import { nodeBundle } from './vite.shared';

// Core utilityProcess entry: CJS Node bundle, forked by main.
export default defineConfig(
  nodeBundle({ entry: 'src/core/index.ts', outDir: 'bundles', fileName: 'core.js', hashed: true }),
);
