/**
 * Safety checks for `pnpm seed`, which drops and refills every collection
 * (issue #12). Kept apart from seed.ts so they can be tested without running
 * the seed.
 */

export const FORCE_DESTROY_FLAG = '--force-destroy-data';

/** Environments whose database holds real data. */
const PROTECTED_ENVS = ['prod', 'stage'];

/**
 * Throws unless seeding is allowed: always outside prod/stage, and there
 * only when `argv` carries `--force-destroy-data`.
 */
export function assertSeedAllowed(
    nodeEnv: string | undefined,
    argv: readonly string[],
): void {
    const env = nodeEnv?.trim().toLowerCase() ?? '';
    if (!PROTECTED_ENVS.includes(env)) return;
    if (argv.includes(FORCE_DESTROY_FLAG)) return;

    throw new Error(
        `Refusing to seed: NODE_ENV is '${env}', and seeding DROPS every ` +
            `collection. Pass ${FORCE_DESTROY_FLAG} if you really mean to ` +
            `wipe this database.`,
    );
}

/**
 * `host(s)/database` of a MongoDB connection string, without the
 * credentials or options, for telling the operator what is about to be
 * wiped. The database is `test` when the URL names none (the driver's
 * default).
 */
export function describeDatabase(url: string): string {
    const withoutScheme = url.replace(/^mongodb(\+srv)?:\/\//, '');
    const slash = withoutScheme.indexOf('/');
    const authority =
        slash === -1 ? withoutScheme : withoutScheme.slice(0, slash);
    const rest = slash === -1 ? '' : withoutScheme.slice(slash + 1);

    const hosts = authority.slice(authority.lastIndexOf('@') + 1);
    const database = rest.split('?')[0] || 'test';

    return `${hosts}/${database}`;
}
