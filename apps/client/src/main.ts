import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from '@/router';
import { useAuthStore } from '@/stores/auth';
// The Fresh market fonts are bundled with the app, not loaded from Google
// Fonts (#26, #153): the client has no external runtime assets. Each is one
// variable file per subset, covering every weight.
import '@fontsource-variable/instrument-sans';
import '@fontsource-variable/bricolage-grotesque';
import './assets/main.css';

const app = createApp(App);

app.use(createPinia());
// Start re-reading the logged-in user's roles right away; the router's
// guard awaits the same request before the first navigation resolves.
void useAuthStore().initSession();
app.use(router);

app.mount('#app');

// New workers wait for old tabs to close; an update never reloads an active checkout.
if (import.meta.env.PROD) {
    void import('./offline/pwa-source').then(({ registerOfflineWorker }) =>
        registerOfflineWorker(),
    );
}
