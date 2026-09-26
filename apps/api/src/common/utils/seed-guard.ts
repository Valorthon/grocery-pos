/**
 * Safety checks for `pnpm seed`, which drops and refills every collection
 * (issue #12). Kept apart from seed.ts so they can be tested without running
 * the seed.
 */

export const FORCE_DESTROY_FLAG = '--force-destroy-data';

/**
 * The only environments seeded without `--force-destroy-data`. An
 * allow-list: prod, stage, an unset APP_ENV or a typo all need the flag.
 */
const SEEDABLE_ENVS = ['dev', 'test'];

/**
 * Throws unless seeding is allowed: freely when APP_ENV (resolved by
 * `resolveAppEnv`) is `dev` or `test`, otherwise only when `argv` carries
 * `--force-destroy-data`.
 */
export function assertSeedAllowed(
    appEnv: string | undefined,
    argv: readonly string[],
): void {
    const env = appEnv?.trim().toLowerCase() ?? '';
    if (SEEDABLE_ENVS.includes(env)) return;
    if (argv.includes(FORCE_DESTROY_FLAG)) return;

    throw new Error(
        `Refusing to seed: APP_ENV is ${env ? `'${env}'` : 'unset'}, and ` +
            `seeding DROPS every collection. Seeding runs freely only in ` +
            `${SEEDABLE_ENVS.join(' or ')}; pass ${FORCE_DESTROY_FLAG} if you ` +
            `really mean to wipe this database.`,
    );
}

/**
 * `host(s)/database` of a MongoDB connection string, never the credentials
 * or options, for telling the operator what is about to be wiped. The
 * database is `test` when the URL names none (the driver's default).
 *
 * Host names cannot contain `@`, so the host list starts after the LAST
 * `@`: a password with an unencoded `@`, `/` or `?` stays hidden. (An `@`
 * inside the options would make the printed host wrong, but still hide the
 * credentials.)
 */
export function describeDatabase(url: string): string {
    const rest = url.replace(/^mongodb(\+srv)?:\/\//, '');
    const afterCredentials = rest.slice(rest.lastIndexOf('@') + 1);

    const end = afterCredentials.search(/[/?]/);
    const hosts =
        end === -1 ? afterCredentials : afterCredentials.slice(0, end);
    const path =
        end !== -1 && afterCredentials[end] === '/'
            ? afterCredentials.slice(end + 1)
            : '';
    const database = path.split('?')[0] || 'test';

    return `${hosts}/${database}`;
}
