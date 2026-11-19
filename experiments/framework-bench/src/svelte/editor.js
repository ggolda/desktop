import '../../shared/styles.js';
import { mount, flushSync } from 'svelte';
import { connectCore } from '../../shared/client.js';
import Editor from './Editor.svelte';

const core = await connectCore();
mount(Editor, { target: document.getElementById('app'), props: { core } });
flushSync(); // make sure the initial render is fully committed before reporting
core.painted();
