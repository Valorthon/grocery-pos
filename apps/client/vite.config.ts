import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import vueDevTools from 'vite-plugin-vue-devtools';
import vuetify from 'vite-plugin-vuetify';
import { envSchema } from './src/config/validation.env';
import * as zod from 'zod';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const result = envSchema.safeParse(env);

    if (!result.success) {
        console.error(
            'Invalid .env variables',
            JSON.stringify(zod.treeifyError(result.error), null, 2),
        );

        throw new Error('Invalid .env variables. Check console for info.');
    }

    return {
        plugins: [
            vue(),
            vueDevTools(),
            vuetify({
                autoImport: true,
                styles: {
                    configFile: 'src/assets/settings.scss',
                },
            }),
        ],
        resolve: {
            alias: {
                '@': fileURLToPath(new URL('./src', import.meta.url)),
            },
        },
    };
});
