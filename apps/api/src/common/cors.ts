import type {
    CorsOptions,
    CorsOptionsDelegate,
} from '@nestjs/common/interfaces/external/cors-options.interface';
import type { Request } from 'express';
import { REQUEST_ID_HEADER } from '@grocery-pos/contracts';
import { allowedOrigins } from './local-access/local-access';

/**
 * CORS for the SPA (main.ts). `exposedHeaders` lets the browser client read
 * `X-Request-Id` off cross-origin responses, so it can show or report the
 * id the server logged a failure under (#8).
 *
 * The same rules answer the CORS preflight Chromium sends before a
 * Reporting API upload to `POST /csp-report` (#94): the report comes from
 * the client's origin, without cookies, as `application/reports+json`.
 *
 * With a single-pc LAN origin (#394) there are two allowed origins, and a
 * request may use only the one whose host it names (single-pc is
 * same-origin through Caddy), so neither site can make credentialed reads
 * of the other.
 */
export function corsOptions(frontendUrl: string): CorsOptions {
    return {
        origin: frontendUrl,
        credentials: true,
        methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
        exposedHeaders: [REQUEST_ID_HEADER],
    };
}

/** main.ts's CORS: the static options, or per-Host ones with LAN_ORIGIN. */
export function corsFor(
    frontendUrl: string,
    lanOrigin?: string,
): CorsOptions | CorsOptionsDelegate<Request> {
    if (lanOrigin === undefined) return corsOptions(frontendUrl);
    const origins = allowedOrigins(frontendUrl, lanOrigin);
    return (req, callback) => {
        const origin = origins.get(req.headers.host?.toLowerCase() ?? '');
        callback(null, {
            ...corsOptions(frontendUrl),
            origin: origin ?? false,
        });
    };
}
