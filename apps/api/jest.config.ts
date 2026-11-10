import type { Config } from 'jest';

/**
 * The unit suite (`pnpm test`). #225: locally jest runs beside the client's
 * vitest under `pnpm -r test`, and both default worker counts together
 * exhausted memory. CI runners are small (4 vCPUs), so the cap applies only
 * off CI.
 */
const config: Config = {
    moduleFileExtensions: ['js', 'json', 'ts'],
    rootDir: 'src',
    testRegex: '.*\\.spec\\.ts$',
    transform: { '^.+\\.(t|j)s$': 'ts-jest' },
    collectCoverageFrom: ['**/*.(t|j)s', '!**/testing/**'],
    coverageDirectory: '../coverage',
    testEnvironment: 'node',
    coverageReporters: ['text-summary', 'lcov'],
    // Ratchet (#28): raise when coverage rises; never lower.
    coverageThreshold: {
        global: { statements: 97, branches: 85, functions: 96, lines: 97 },
    },
    maxWorkers: process.env.CI ? undefined : '25%',
};

export default config;
