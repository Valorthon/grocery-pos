import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { REQUEST_ID_HEADER } from '@grocery-pos/contracts';

/**
 * CORS for the SPA (main.ts). `exposedHeaders` lets the browser client read
 * `X-Request-Id` off cross-origin responses, so it can show or report the
 * id the server logged a failure under (#8).
 *
 * The same rules answer the CORS preflight Chromium sends before a
 * Reporting API upload to `POST /csp-report` (#94): the report comes from
 * the client's origin, without cookies, as `application/reports+json`.
 */
export function corsOptions(frontendUrl: string): CorsOptions {
    return {
        origin: frontendUrl,
        credentials: true,
        methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
        exposedHeaders: [REQUEST_ID_HEADER],
    };
}
