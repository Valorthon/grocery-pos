import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.spec.ts'],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.spec.ts'],
            reporter: ['text-summary', 'lcov'],
            // Ratchet (#28): just below the measured level.
            thresholds: {
                statements: 76,
                branches: 94,
                functions: 95,
                lines: 74,
            },
        },
    },
});
