import '@unocss/reset/tailwind.css';
import 'virtual:uno.css';
import '@/ui/assets/roboto.css';
import '@/ui/assets/icomoon.css';
import '@/ui/assets/fontawesome.css';
import '@/ui/theme.css';
import { createPinia } from 'pinia';
import { createApp, reactive } from 'vue';
import { setCoreClient } from '@/ui/core';
import { createFakeCore } from '@/ui/dev/fake-core';
import App from './App.vue';

// Dev-only page (npx vite --config vite.windows.config.ts, open /main/fake.html). Query: ?scenes=&sources=
const q = new URLSearchParams(location.search);
const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
const fake = createFakeCore({ scenes: num('scenes'), sources: num('sources') });
setCoreClient(fake.connect(reactive));

createApp(App).use(createPinia()).mount('#app');
