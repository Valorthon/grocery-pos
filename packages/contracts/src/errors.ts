export enum ErrorCode {
    AUTH_INVALID_CREDENTIALS = 'AUTH_001',
    AUTH_TOKEN_EXPIRED = 'AUTH_002',
    AUTH_MISSING_REFRESH_TOKEN = 'AUTH_003',
    AUTH_INVALID_TOKEN = 'AUTH_004',

    VALIDATION_INVALID_INPUT = 'VALIDATION_001',
    VALIDATION_EAN_INVALID = 'VALIDATION_002',

    NOT_FOUND = 'NOT_FOUND_001',
    PRODUCT_NOT_FOUND = 'PRODUCT_001',
    PRODUCT_DUPLICATE = 'PRODUCT_002',
    /**
     * `PATCH /products` changed a price without ADMIN. Price changes are
     * ADMIN-only (issue #13); the whole batch is refused, nothing is written.
     */
    PRODUCT_PRICE_CHANGE_FORBIDDEN = 'PRODUCT_003',

    /** A GCash reference number already used by another sale. */
    SALE_DUPLICATE_REFERENCE = 'SALE_001',
    /** The sale is already voided or refunded. */
    SALE_NOT_REVERSIBLE = 'SALE_002',
    /**
     * `POST /sales` reused an idempotency key that already recorded a
     * different sale (other lines, quantities, discount or payment).
     */
    SALE_IDEMPOTENCY_MISMATCH = 'SALE_003',
    /**
     * A sale with this idempotency key is being recorded by a concurrent
     * request and is not visible yet: retry with the same key.
     */
    SALE_IN_PROGRESS = 'SALE_004',

    /** The caller is signed in but may not do this (generic 403). */
    FORBIDDEN = 'FORBIDDEN_001',

    /** Granting a role the actor does not hold (e.g. ADMIN as USER_MANAGER). */
    USER_ROLE_NOT_GRANTABLE = 'USER_001',
    /** Nobody may change their own roles, not even an ADMIN. */
    USER_SELF_ROLE_CHANGE = 'USER_002',
    /** The target holds a role the actor does not hold (e.g. an ADMIN). */
    USER_TARGET_FORBIDDEN = 'USER_003',
    /**
     * Resetting another user's password is ADMIN-only; your own password is
     * changed through `PATCH /users/me/password`.
     */
    USER_PASSWORD_RESET_FORBIDDEN = 'USER_004',
    /** The change would leave no active ADMIN. */
    USER_LAST_ADMIN = 'USER_005',
    /** `currentPassword` did not match on a self-service password change. */
    USER_WRONG_PASSWORD = 'USER_006',

    /**
     * Too many attempts on a rate-limited route (login, refresh, password
     * change). Answered with 429, a `Retry-After` header (seconds) and
     * `details.retryAfterS`.
     */
    RATE_LIMITED = 'RATE_001',

    DB_DUPLICATE_KEY = 'DB_002',
    DB_VALIDATION_ERROR = 'DB_003',

    INTERNAL_ERROR = 'INTERNAL_001',
}

/** Body returned by the API's GlobalFilter for every error response. */
export interface AppErrorResponse {
    statusCode: number;
    error: string;
    message: string;
    timestamp: string;
    path: string;
    details: unknown;
}

/** Shape of every paginated list endpoint. */
export interface Paginated<T> {
    data: T[];
    totalItems: number;
}
