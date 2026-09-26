import type { Config } from 'jest';

/**
 * The real-database suite (issue #30): `pnpm --filter grocery-pos-api test:db`.
 *
 * Behaviour that mocks cannot prove (unique partial indexes, transactions
 * under concurrency, rollback) runs here against a real MongoDB replica set
 * named by MONGO_URI_TEST. Each spec file works in its own throwaway
 * database and drops it afterwards (test/db/db-app.ts).
 *
 * Kept out of the default `jest` run (and its coverage) on purpose: the
 * specs live under `test/db/` and end in `.db-spec.ts`, which neither the
 * default `rootDir: src` nor its `\.spec\.ts$` regex matches, so the four
 * local gates still pass without Docker.
 */
const config: Config = {
    rootDir: '.',
    testRegex: 'test/db/.*\\.db-spec\\.ts$',
    moduleFileExtensions: ['js', 'json', 'ts'],
    transform: { '^.+\\.(t|j)s$': 'ts-jest' },
    testEnvironment: 'node',
    globalSetup: '<rootDir>/test/db/global-setup.ts',
    setupFiles: ['<rootDir>/test/db/setup-env.ts'],
    // One file at a time: the files share one server, and the concurrency
    // they test is inside each file, not between them.
    maxWorkers: 1,
    // Transactions retry for a while under contention.
    testTimeout: 120_000,
};

export default config;
