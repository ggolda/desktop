import '@unocss/reset/tailwind.css';
import 'virtual:uno.css';
import '@/ui/assets/roboto.css';
import '@/ui/assets/icomoon.css';
import '@/ui/assets/fontawesome.css';
import '@/ui/theme.css';
import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';

createApp(App).use(createPinia()).mount('#app');
