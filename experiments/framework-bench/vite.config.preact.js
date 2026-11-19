import preact from '@preact/preset-vite';
import { makeConfig } from './vite.base.js';
export default makeConfig('preact', [preact()]);
