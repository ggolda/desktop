import { svelte } from '@sveltejs/vite-plugin-svelte';
import { makeConfig } from './vite.base.js';
export default makeConfig('svelte', [svelte()]);
