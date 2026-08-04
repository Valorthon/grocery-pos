/**
 * plugins/index.ts
 *
 * Automatically included in `./src/main.ts`
 */

import type { App } from 'vue';

// Plugins
import vuetify from './vuetify';
import router from '@/router';
import Toast from 'vue-toast-notification';
import 'vue-toast-notification/dist/theme-default.css'; // Import default theme CSS

export function registerPlugins(app: App): void {
    app.use(Toast).use(vuetify).use(router);
}
