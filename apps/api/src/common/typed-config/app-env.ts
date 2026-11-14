/**
 * APP_ENV is the app's deployment stage (#29). NODE_ENV is left to Node,
 * Express and libraries, which key off `production`; the API image sets
 * `NODE_ENV=production`.
 *
 * NODE_ENV is never read as the stage (#86 removed the one-release
 * fallback): an unset APP_ENV fails startup whatever NODE_ENV holds.
 */
export const APP_ENVS = ['dev', 'prod', 'stage', 'test', 'single-pc'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

/** Deployed over HTTPS behind Railway's proxy: prod and stage. */
export function isDeployedEnv(appEnv: string): boolean {
    return appEnv === 'prod' || appEnv === 'stage';
}

/**
 * The single-PC production edition (#358): one Windows computer, Chrome on
 * `https://localhost:1443`, a local HTTPS proxy on loopback in front of an
 * API bound to loopback. Not a development mode: secrets are as strict as
 * prod's. It is not "deployed" (no DOMAIN, no cloud proxy hop): its
 * cookies are host-only and its proxy trust is loopback only.
 */
export function isSinglePcEnv(appEnv: string): boolean {
    return appEnv === 'single-pc';
}

/** Environments that refuse placeholder or shared secrets. */
export function requiresStrictSecrets(appEnv: string): boolean {
    return isDeployedEnv(appEnv) || isSinglePcEnv(appEnv);
}

/**
 * The trimmed APP_ENV, or undefined when it is unset or blank (the schema
 * then rejects it). NODE_ENV plays no part.
 */
export function resolveAppEnv(raw: { APP_ENV?: unknown }): string | undefined {
    const appEnv = typeof raw.APP_ENV === 'string' ? raw.APP_ENV.trim() : '';
    return appEnv || undefined;
}
