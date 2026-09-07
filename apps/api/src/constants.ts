export {
    STRING_LIMITS,
    NUMERIC_LIMITS,
    EAN_COUNTER,
    VALIDATION,
} from '@grocery-pos/contracts';

/**
 * URI version prefix applied by `app.enableVersioning()` in main.ts.
 * Anything that needs to know a real request path (notably the refresh
 * cookie's Path attribute) must build it from here, or the cookie ends up
 * scoped to a route that does not exist.
 */
export const API_VERSION = '1';
export const API_VERSION_PREFIX = `/v${API_VERSION}`;
export const REFRESH_ROUTE = `${API_VERSION_PREFIX}/auth/refresh`;

/** Cookie maxAge and Date arithmetic are milliseconds; config expiries are seconds. */
export const MS_PER_SECOND = 1000;
