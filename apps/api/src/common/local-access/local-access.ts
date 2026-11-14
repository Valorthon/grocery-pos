import { ForbiddenException, type INestApplication } from '@nestjs/common';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { TypedConfigService } from '../typed-config/typed-config.service';
import { isSinglePcEnv } from '../typed-config/app-env';

type LocalAccessCheck = (req: Request) => string | null;

/** Health probes: they expose no data, and local diagnostics call the API port directly. */
function isHealthProbe(req: Request): boolean {
    return (
        (req.method === 'GET' || req.method === 'HEAD') &&
        /^\/v1\/health(\/|$|\?)/.test(req.originalUrl ?? req.url)
    );
}

/**
 * The single-pc entry check (#358). The browser reaches the API only
 * through the local HTTPS proxy at FRONTEND_URL (`https://localhost:1443`),
 * which forwards the original Host. So every request must name that host,
 * and a request that carries an Origin must come from that origin. This
 * refuses DNS-rebinding pages (a foreign Host), other local web origins (a
 * foreign Origin, the CSRF defence: SameSite=Lax treats every localhost
 * port as the same site) and a direct call to the loopback API port that
 * does not name the proxy's host. GET/HEAD health probes are exempt.
 * Returns the refusal reason, or null.
 */
export function localAccessCheck(frontendUrl: string): LocalAccessCheck {
    const url = new URL(frontendUrl);
    const origin = url.origin;
    const host = url.host.toLowerCase();
    return (req) => {
        if (isHealthProbe(req)) return null;
        if (req.headers.host?.toLowerCase() !== host) {
            return 'Unexpected host.';
        }
        const requestOrigin = req.headers.origin;
        if (requestOrigin !== undefined && requestOrigin !== origin) {
            return 'Unexpected origin.';
        }
        return null;
    };
}

/** Express middleware: a refusal goes to GlobalFilter as a 403. */
export function localAccessMiddleware(frontendUrl: string): RequestHandler {
    const check = localAccessCheck(frontendUrl);
    return (req: Request, _res: Response, next: NextFunction) => {
        const refusal = check(req);
        next(refusal ? new ForbiddenException(refusal) : undefined);
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
    app.use(localAccessMiddleware(config.get('FRONTEND_URL')));
}
