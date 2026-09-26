import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { parseClientEnv } from './src/config/validation.env';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const result = parseClientEnv(env);

    if (!result.success) {
        console.error('Invalid .env variables', result.error);

        throw new Error('Invalid .env variables. Check console for info.');
    }

    // Once per build or dev-server start (#86: the VITE_NODE_ENV fallback).
    if (result.warning) {
        console.warn(`[env] ${result.warning}`);
    }

    return {
        plugins: [vue(), tailwindcss()],
        resolve: {
            alias: {
                '@': fileURLToPath(new URL('./src', import.meta.url)),
            },
        },
    };
});
