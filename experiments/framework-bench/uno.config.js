import { defineConfig } from 'unocss';
import presetWind3 from '@unocss/preset-wind3';

// Same atomic CSS engine for every implementation (Tailwind-compatible utilities).
export default defineConfig({
  presets: [presetWind3()],
  content: {
    pipeline: {
      // default excludes plain .js/.ts; the vanilla reference keeps class strings in .js
      include: [/\.(vue|svelte|[jt]sx?|mdx?|astro|html)($|\?)/],
      // never scan framework runtimes (words like 'hidden'/'container' would become CSS rules)
      exclude: [/[\/]node_modules[\/]/, /\.(css|postcss|sass|scss|less)($|\?)/],
    },
  },
});
