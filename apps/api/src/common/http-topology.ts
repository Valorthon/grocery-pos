import type { NestExpressApplication } from '@nestjs/platform-express';
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
 * The client address as rate limits and audit record it: IPv6 loopback
 * (and IPv4-mapped `::ffff:127.0.0.1`) become `127.0.0.1`, so the main PC
 * is one client whether its browser reached Caddy over 127.0.0.1 or [::1]
 * (#395). Other addresses are returned unchanged.
 */
export function canonicalClientIp(ip: string): string {
    return ip === '::1' || ip === '::ffff:127.0.0.1' ? '127.0.0.1' : ip;
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
 * - single-pc: `'loopback'` (#395), never a hop count or `true`. Caddy on
 *   the main PC is the only proxy and replaces any client-sent
 *   X-Forwarded-For with the real peer, so `req.ip` is each LAN terminal's
 *   address (its own rate-limit buckets and audit IP). A non-loopback peer's
 *   header is ignored. Accepted trade-off (owner, #395): a local process on
 *   the main PC can forge the header to the loopback API.
 * - dev and test: undefined, X-Forwarded-For is ignored and `req.ip` is the
 *   socket peer.
 */
export function trustProxySetting(
    appEnv: string,
): number | 'loopback' | undefined {
    if (isDeployedEnv(appEnv)) return 1;
    return isSinglePcEnv(appEnv) ? 'loopback' : undefined;
}

/** Applies `trustProxySetting` (main.ts and the DB suite's app). */
export function applyTrustProxy(
    app: NestExpressApplication,
    appEnv: string,
): void {
    const trustProxy = trustProxySetting(appEnv);
    if (trustProxy !== undefined) app.set('trust proxy', trustProxy);
}
