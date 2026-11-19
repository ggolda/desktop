import '../../shared/styles.js';
import { mount, flushSync } from 'svelte';
import { connectCore } from '../../shared/client.js';
import Settings from './Settings.svelte';

const core = await connectCore();
mount(Settings, { target: document.getElementById('app'), props: { core } });
flushSync(); // make sure the initial render is fully committed before reporting
core.painted();
