/**
 * APP_ENV is the app's deployment stage (#29). NODE_ENV is left to Node,
 * Express and libraries, which key off `production`; the API image sets
 * `NODE_ENV=production`.
 *
 * NODE_ENV is never read as the stage (#86 removed the one-release
 * fallback): an unset APP_ENV fails startup whatever NODE_ENV holds.
 */
export const APP_ENVS = ['dev', 'prod', 'stage', 'test'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

/** Deployed over HTTPS behind Railway's proxy: prod and stage. */
export function isDeployedEnv(appEnv: string): boolean {
    return appEnv === 'prod' || appEnv === 'stage';
}

/**
 * The trimmed APP_ENV, or undefined when it is unset or blank (the schema
 * then rejects it). NODE_ENV plays no part.
 */
export function resolveAppEnv(raw: { APP_ENV?: unknown }): string | undefined {
    const appEnv = typeof raw.APP_ENV === 'string' ? raw.APP_ENV.trim() : '';
    return appEnv || undefined;
}
