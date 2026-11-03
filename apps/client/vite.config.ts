import { fileURLToPath, URL } from 'node:url';
import { createHash } from 'node:crypto';
import { offlineWorkerSource } from './src/offline/pwa-source';
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
        plugins: [
            vue(),
            tailwindcss(),
            {
                name: 'grocery-pos-offline-shell',
                apply: 'build',
                enforce: 'post',
                generateBundle: {
                    order: 'post',
                    handler(_options, bundle) {
                        const files = Object.keys(bundle)
                            .filter((name) => !name.endsWith('.map'))
                            .sort();
                        const version = createHash('sha256')
                            .update(JSON.stringify(files))
                            .digest('hex')
                            .slice(0, 16);
                        this.emitFile({
                            type: 'asset',
                            fileName: 'sw.js',
                            source: offlineWorkerSource(
                                [
                                    '/index.html',
                                    '/manifest.webmanifest',
                                    '/favicon.svg',
                                    ...files
                                        .filter((name) => name !== 'index.html')
                                        .map((name) => '/' + name),
                                ],
                                version,
                            ),
                        });
                    },
                },
            },
        ],
        resolve: {
            alias: {
                '@': fileURLToPath(new URL('./src', import.meta.url)),
            },
        },
    };
});
