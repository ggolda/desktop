import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // UI component tests opt in to a DOM with `// @vitest-environment happy-dom` in the file.
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
