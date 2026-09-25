import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { REQUEST_ID_HEADER } from '@grocery-pos/contracts';

/**
 * CORS for the SPA (main.ts). `exposedHeaders` lets the browser client read
 * `X-Request-Id` off cross-origin responses, so it can show or report the
 * id the server logged a failure under (#8).
 */
export function corsOptions(frontendUrl: string): CorsOptions {
    return {
        origin: frontendUrl,
        credentials: true,
        methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
        exposedHeaders: [REQUEST_ID_HEADER],
    };
}
