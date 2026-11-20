import { defineConfig, presetTypography } from 'unocss';
import transformerDirectives from '@unocss/transformer-directives';
import { presetWind3 } from '@unocss/preset-wind3';
import presetAnimations from 'unocss-preset-animations';
import { presetShadcn } from 'unocss-preset-shadcn';

// Theme colors come from CSS variables in src/ui/theme.css (ported from the legacy night theme).
export default defineConfig({
  transformers: [transformerDirectives()],
  presets: [
    presetWind3(),
    // Transient enter/leave transitions only. No `infinite` animations on persistent UI.
    presetAnimations(),
    presetTypography(),
    presetShadcn({ color: 'neutral' }, { componentLibrary: 'reka' }),
  ],
  theme: {
    colors: {
      'sl-teal': 'hsl(var(--sl-teal))',
      'sl-red': 'hsl(var(--sl-red))',
      // legacy night theme variables (see theme.css)
      section: 'var(--section)',
      'section-alt': 'var(--section-alt)',
      wrapper: 'var(--section-wrapper)',
      title: 'var(--title)',
      para: 'var(--paragraph)',
      icon: 'var(--icon)',
      nav: 'var(--nav-icon-inactive)',
      warn: 'var(--warning)',
      button: 'var(--button)',
      'button-hover': 'var(--button-hover)',
      'sl-purple': 'hsl(var(--sl-purple))',
      teal: 'var(--teal)',
      line: 'var(--border)',
      'solid-input': 'var(--solid-input)',
      titlebar: 'var(--titlebar-bg)',
      bg3: 'var(--background-solid)',
    },
  },
  shortcuts: {
    fcb: 'flex items-center justify-between',
    fcc: 'flex items-center justify-center',
    // NOTE: never name a shortcut `icon-*`: the legacy icomoon rule matches [class^='icon-'].
    'no-drag': '[-webkit-app-region:no-drag]',
    'drag-region': '[-webkit-app-region:drag]',
  },
  content: {
    pipeline: {
      include: [/\.(vue|[jt]sx|html)($|\?)/, 'src/ui/**/*.{js,ts}'],
    },
  },
});
