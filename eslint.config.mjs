import js from '@eslint/js';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import prettier from 'eslint-plugin-prettier/recommended';
import { importX } from 'eslint-plugin-import-x';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      'legacy/**',
      'bundles/**',
      'build/**',
      'dist/**',
      'updater/**',
      'vendor/**',
      'media/**',
      'shared-resources/**',
      'experiments/**',
      'docs/**',
      'scripts/ui-reference/**', // dev tooling (CDP, browser globals)
      'electron-builder/**',
      'slobs-virtual-cam-installer/**',
      'bin/**',
      'src/types/**',
      // legacy CJS helper scripts, not part of the new code base
      'scripts/*.js',
      'scripts/bench/**',
      'scripts/ci/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          noWarnOnMultipleProjects: true,
          project: ['./tsconfig.app.json', './tsconfig.node.json'],
        }),
      ],
    },
    rules: {
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            // SPEC 5.2: core-process code never imports UI/window code or .vue files.
            ...['./src/windows', './src/ui', './src/**/*.vue'].map(from => ({
              target: './src/core',
              from,
              message: 'core must not import window/UI code',
            })),
            // Core reads features/registry.ts only.
            {
              target: './src/core',
              from: './src/features',
              except: ['./registry.ts'],
              message: 'core may import only src/features/registry.ts',
            },
            // Window code never imports core or main (only src/shared contracts).
            ...['./src/core', './src/main', './src/preload'].map(from => ({
              target: ['./src/windows', './src/ui'],
              from,
              message: 'windows/ui talk to core through ports; import src/shared contracts only',
            })),
            // shared is usable everywhere: no Node-side or UI imports.
            ...['./src/core', './src/main', './src/preload', './src/windows', './src/ui'].map(
              from => ({ target: './src/shared', from }),
            ),
          ],
        },
      ],
    },
  },
  {
    // SPEC 4: only core/media/obs may import obs-studio-node.
    files: ['src/**/*.{ts,vue}'],
    ignores: ['src/core/media/obs/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'obs-studio-node', message: 'Only src/core/media/obs may use OSN' }] },
      ],
    },
  },
  {
    files: ['src/windows/**', 'src/ui/**'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: [
      'src/main/**',
      'src/preload/**',
      'src/core/**',
      'vite.*.ts',
      'uno.config.ts',
      'scripts/*.mjs',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // shadcn-vue components are generated; keep their style as-is apart from formatting.
    files: ['src/ui/components/ui/**'],
    rules: { 'vue/require-default-prop': 'off' },
  },
  prettier,
);
