import '@unocss/reset/tailwind.css';
import 'virtual:uno.css';
import '@/ui/assets/roboto.css';
import '@/ui/assets/icomoon.css';
import '@/ui/assets/fontawesome.css';
import '@/ui/theme.css';
import './dialog.css';
import { createPinia } from 'pinia';
import { createApp, type Component } from 'vue';
import { connect } from '@/ui/core';

/**
 * Entry of every thin dialog window: asks the preload for the core port right away (the page subscribes
 * `dialog:<id>` as soon as it is connected) and mounts the dialog. Dev pages with a fake core call
 * `setCoreClient` first and `mountDialog` directly.
 */
export function bootDialog(App: Component) {
  void connect();
  mountDialog(App);
}

export function mountDialog(App: Component) {
  createApp(App).use(createPinia()).mount('#app');
}
