// Lets tests import .vue components (type-checked for real by vue-tsc in tsconfig.app.json).
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
