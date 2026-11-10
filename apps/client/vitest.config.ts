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
        // theme-tokens.spec.ts and layout-drift.spec.ts read the CSS files
        // as ?raw; Vitest blanks any CSS it does not process, so they would
        // silently check nothing. Only .css files: Vue <style> blocks stay
        // unprocessed, as before.
        css: { include: [/\/src\/[^?]*\.css(\?raw)?$/] },
        include: ['src/**/*.spec.ts'],
        // Vitest 4's restoreMocks only restores vi.spyOn spies; mockReset also
        // resets every vi.fn() (calls and queued returns) between tests, as
        // restoreMocks did on Vitest 3.
        // #225: jest (API) runs beside this under `pnpm -r test`; default
        // worker counts on both exhausted memory and timed tests out. CI
        // runners are small (4 vCPUs), so the cap applies only off CI.
        maxWorkers: process.env.CI ? undefined : '25%',
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
                statements: 93,
                branches: 89,
                functions: 92,
                lines: 95,
            },
        },
    },
});
