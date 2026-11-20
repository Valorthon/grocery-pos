import { ForbiddenException, type INestApplication } from '@nestjs/common';
import {
    ErrorCode,
    WIRE_VERSION,
    WIRE_VERSION_HEADER,
} from '@grocery-pos/contracts';
import { ConflictError } from '../errors/app-error';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { TypedConfigService } from '../typed-config/typed-config.service';
import { isSinglePcEnv } from '../typed-config/app-env';

type LocalAccessCheck = (req: Request) => string | null;

/**
 * Health probes. They need no login and return heap, RSS and disk figures,
 * so they are exempt from the Host check only for local callers
 * (diagnostics call the API port directly); on the LAN site they are
 * refused (#394; Caddy refuses them there too, #396).
 */
function isHealthProbe(req: Request): boolean {
    return (
        (req.method === 'GET' || req.method === 'HEAD') &&
        /^\/v1\/health(\/|$|\?)/.test(req.originalUrl ?? req.url)
    );
}

/**
 * The allowed origins keyed by their lower-case host: FRONTEND_URL
 * (`https://localhost:1443`) and, with LAN terminals, LAN_ORIGIN
 * (`https://<fixed LAN IP>:1443`, #394). Never any other host.
 */
export function allowedOrigins(
    frontendUrl: string,
    lanOrigin?: string,
): Map<string, string> {
    const origins = new Map<string, string>();
    for (const value of [frontendUrl, lanOrigin]) {
        if (value === undefined) continue;
        const url = new URL(value);
        origins.set(url.host.toLowerCase(), url.origin);
    }
    return origins;
}

/**
 * The single-pc entry check (#358, #394). The browser reaches the API only
 * through the local HTTPS proxy, at FRONTEND_URL on the main PC or at
 * LAN_ORIGIN from a LAN terminal, and the proxy forwards the original Host.
 * So every request must name one of those two hosts, and a request that
 * carries an Origin must come from the origin of that same host (a LAN page
 * can't act on the localhost site, nor the reverse). This refuses
 * DNS-rebinding pages (a foreign Host), other local web origins (a foreign
 * Origin, the CSRF defence: SameSite=Lax treats every localhost port as the
 * same site) and a direct call to the loopback API port that does not name
 * an allowed host. GET/HEAD health probes are exempt, except on the LAN host.
 * Returns the refusal reason, or null.
 */
export function localAccessCheck(
    frontendUrl: string,
    lanOrigin?: string,
): LocalAccessCheck {
    const origins = allowedOrigins(frontendUrl, lanOrigin);
    const lanHost =
        lanOrigin === undefined ? undefined : new URL(lanOrigin).host;
    return (req) => {
        const host = req.headers.host?.toLowerCase();
        if (isHealthProbe(req)) {
            return host !== undefined && host === lanHost
                ? 'Health checks are not available on the LAN.'
                : null;
        }
        const origin = host === undefined ? undefined : origins.get(host);
        if (origin === undefined) return 'Unexpected host.';
        const requestOrigin = req.headers.origin;
        if (requestOrigin !== undefined && requestOrigin !== origin) {
            return 'Unexpected origin.';
        }
        return null;
    };
}

export const CLIENT_OUTDATED_MESSAGE =
    'Grocery POS was updated. Reload to continue.';

/**
 * Requests that are not a client build's: the browser's own CSP reports
 * (sent without our headers). Health probes are exempt separately.
 */
function isCspReport(req: Request): boolean {
    return (
        req.method === 'POST' &&
        /^\/v1\/csp-report(\/|$|\?)/.test(req.originalUrl ?? req.url)
    );
}

/**
 * A stale browser tab after an upgrade (#364): the single-pc client sends
 * its build's `WIRE_VERSION` in `WIRE_VERSION_HEADER`. A different value,
 * a duplicated header or none at all is refused: every single-pc client
 * sends it (no single-pc installation predates #364), so a missing header
 * is an older build. Health probes and CSP reports are exempt.
 */
export function isOutdatedClient(req: Request): boolean {
    if (isHealthProbe(req) || isCspReport(req)) return false;
    const sent = req.headers[WIRE_VERSION_HEADER];
    return sent !== String(WIRE_VERSION);
}

/**
 * Express middleware: a Host/Origin refusal goes to GlobalFilter as a 403,
 * then a stale client as 409 `CLIENT_OUTDATED`. Both run before any body is
 * read, so an old-shape body is never validated (an offline upload refused
 * as a 400 would be blocked for reconciliation; a 409 stays queued).
 */
export function localAccessMiddleware(
    frontendUrl: string,
    lanOrigin?: string,
): RequestHandler {
    const check = localAccessCheck(frontendUrl, lanOrigin);
    return (req: Request, _res: Response, next: NextFunction) => {
        const refusal = check(req);
        if (refusal) return next(new ForbiddenException(refusal));
        if (isOutdatedClient(req))
            return next(
                new ConflictError(
                    ErrorCode.CLIENT_OUTDATED,
                    CLIENT_OUTDATED_MESSAGE,
                ),
            );
        next(undefined);
    };
}

/**
 * Installs the check in single-pc only, ahead of every body parser and the
 * CSP report limiter (`useBodyParsers` calls it first), so a refused
 * request's body is never read. A no-op in every other APP_ENV, or without
 * a TypedConfigService (a bare test module).
 */
export function useLocalAccess(app: INestApplication): void {
    let config: TypedConfigService;
    try {
        config = app.get(TypedConfigService, { strict: false });
    } catch {
        return;
    }
    if (!isSinglePcEnv(config.get('APP_ENV'))) return;
    app.use(
        localAccessMiddleware(
            config.get('FRONTEND_URL'),
            config.get('LAN_ORIGIN'),
        ),
    );
}
