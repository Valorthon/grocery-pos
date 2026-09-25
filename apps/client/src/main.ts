import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from '@/router';
import { useAuthStore } from '@/stores/auth';
// Poppins is bundled with the app, not loaded from Google Fonts (#26): the
// client has no external runtime assets.
import '@fontsource/poppins/latin-300.css';
import '@fontsource/poppins/latin-400.css';
import '@fontsource/poppins/latin-500.css';
import '@fontsource/poppins/latin-600.css';
import '@fontsource/poppins/latin-700.css';
import './assets/main.css';

const app = createApp(App);

app.use(createPinia());
// Start re-reading the signed-in user's roles right away; the router's
// guard awaits the same request before the first navigation resolves.
void useAuthStore().initSession();
app.use(router);

app.mount('#app');
