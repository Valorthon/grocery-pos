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
        // Vitest 4's restoreMocks only restores vi.spyOn spies; mockReset also
        // resets every vi.fn() (calls and queued returns) between tests, as
        // restoreMocks did on Vitest 3.
        mockReset: true,
        restoreMocks: true,
        coverage: {
            provider: 'v8',
            include: ['src/**/*.{ts,vue}'],
            exclude: ['src/**/*.spec.ts', 'src/testing/**'],
            reporter: ['text-summary', 'lcov'],
            // Ratchet (#28): just below the measured level. Raise it when
            // coverage rises; never lower it to make a change pass.
            thresholds: {
                statements: 92,
                branches: 87,
                functions: 88,
                lines: 92,
            },
        },
    },
});
