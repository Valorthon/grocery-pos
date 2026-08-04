/**
 * main.ts
 *
 * Bootstraps Vuetify and other plugins then mounts the App`
 */

// Plugins
import { registerPlugins } from '@/plugins';
import axios from '@/axios';
import 'vuetify/styles';

// Composables
import { createApp } from 'vue';
import { createPinia } from 'pinia';

// Components
import App from './App.vue';

// window.addEventListener('unhandledrejection', (event) => {
//     const error = event.reason
//     console.warn('Unhandled error:', error)

//     const uiStore = useUIStore()

//     uiStore.queueMessage(Color.ERROR, '')
// })

const app = createApp(App);
app.use(createPinia());

registerPlugins(app);

// Add Axios to the global properties
app.config.globalProperties.$axios = axios;

app.mount('#app');
