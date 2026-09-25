import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from '@/router';
import { useAuthStore } from '@/stores/auth';
import './assets/main.css';

const app = createApp(App);

app.use(createPinia());
// Start re-reading the signed-in user's roles right away; the router's
// guard awaits the same request before the first navigation resolves.
void useAuthStore().initSession();
app.use(router);

app.mount('#app');
