export {
    STRING_LIMITS,
    NUMERIC_LIMITS,
    EAN_COUNTER,
    VALIDATION,
    DISCOUNT_LIMITS,
    REFERENCE_NUMBER_LIMITS,
    REVERSED_SALE_STATUSES,
} from '@grocery-pos/contracts';

/**
 * URI version prefix applied by `app.enableVersioning()` in main.ts.
 * Anything that needs to know a real request path (notably the refresh
 * cookie's Path attribute) must build it from here, or the cookie ends up
 * scoped to a route that does not exist.
 */
export const API_VERSION = '1';
export const API_VERSION_PREFIX = `/v${API_VERSION}`;
/**
 * Path of the refresh cookie: every auth route, so the browser sends it to
 * both `/auth/refresh` and `/auth/logout` (which must see it to revoke the
 * session), and to nothing else.
 */
export const REFRESH_COOKIE_PATH = `${API_VERSION_PREFIX}/auth`;
/**
 * Where the refresh cookie used to live (issue #12). Cleared whenever the
 * refresh cookie is set or removed, so browsers still holding one migrate.
 */
export const LEGACY_REFRESH_COOKIE_PATH = `${API_VERSION_PREFIX}/auth/refresh`;

/** Cookie maxAge and Date arithmetic are milliseconds; config expiries are seconds. */
export const MS_PER_SECOND = 1000;
