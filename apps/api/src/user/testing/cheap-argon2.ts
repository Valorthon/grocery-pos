/**
 * A test-only argon2 whose `hash` uses the cheapest parameters argon2
 * accepts, for specs that run real hashes and verifies (#109).
 *
 * Production calls `argon.hash(password)` with the library defaults
 * (64 MiB, t=3, p=4). A handful of those per test, with jest workers
 * doing the same in parallel on a loaded runner, went past jest's 5s
 * timeout. Here every hash is still a real argon2id hash, and `verify`
 * is the real one: it reads the parameters from the hash, so verifying a
 * cheap hash is cheap and still proves the password matches.
 *
 * Both are `jest.fn` wrappers, so a spec can check how production called
 * them, e.g. that it passes no options, i.e. uses the defaults.
 *
 * Use it from a spec, before the module under test is imported:
 *
 *     jest.mock('argon2', () =>
 *         jest
 *             .requireActual<typeof import('./testing/cheap-argon2')>(
 *                 './testing/cheap-argon2',
 *             )
 *             .cheapArgon2(),
 *     );
 */
import type * as Argon2 from 'argon2';

export const CHEAP_ARGON2 = {
    memoryCost: 1024,
    timeCost: 2,
    parallelism: 1,
} as const;

export function cheapArgon2(): typeof Argon2 {
    const actual = jest.requireActual<typeof Argon2>('argon2');
    return {
        ...actual,
        hash: jest.fn((password: Buffer | string, options?: Argon2.Options) =>
            actual.hash(password, { ...options, ...CHEAP_ARGON2 }),
        ) as unknown as typeof actual.hash,
        verify: jest.fn(actual.verify),
    };
}
