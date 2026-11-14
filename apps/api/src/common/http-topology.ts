import { isDeployedEnv, isSinglePcEnv } from './typed-config/app-env';

/**
 * Where the API listens and which proxy it trusts, per APP_ENV (#358).
 * main.ts applies these; they live here so they can be tested.
 */

/** The loopback listener addresses single-pc accepts. */
export const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', '::1'];

export function isLoopbackHost(host: string): boolean {
    return LOOPBACK_HOSTS.includes(host);
}

/**
 * HOST when set, else 127.0.0.1 in single-pc (only the local proxy may
 * reach the API) and 0.0.0.0 elsewhere (cloud containers, unchanged).
 */
export function listenHost(appEnv: string, host: string | undefined): string {
    if (host) return host;
    return isSinglePcEnv(appEnv) ? '127.0.0.1' : '0.0.0.0';
}

/**
 * Express `trust proxy`:
 * - prod/stage sit behind exactly one cloud proxy hop, which appends the
 *   real client to X-Forwarded-For. Trusting that one hop makes `req.ip`
 *   the client (the login/refresh rate limits key on it); trusting more
 *   (or `true`) would let a client pick its own IP.
 * - single-pc: the proxy runs on loopback beside the API, so only a
 *   loopback peer is trusted; a forwarded header from anything else is
 *   ignored (the API binds loopback anyway).
 * - dev/test have no proxy: undefined, the header is ignored.
 */
export function trustProxySetting(appEnv: string): number | string | undefined {
    if (isDeployedEnv(appEnv)) return 1;
    if (isSinglePcEnv(appEnv)) return 'loopback';
    return undefined;
}
