import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

// Deliberately separate from vite.config.ts: that config validates .env at load
// time and throws, which would make the test run depend on a populated .env.
export default defineConfig({
    plugins: [vue()],
    resolve: {
        alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    test: {
        environment: 'jsdom',
        include: ['src/**/*.spec.ts'],
        restoreMocks: true,
    },
});
