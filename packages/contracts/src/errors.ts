import type { WireShape } from './wire-shape.js';

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

    /**
     * The caller has no open shift: `POST /sales` and the cashier's
     * drawer and close routes need one (issue #2). Also returned when an
     * ADMIN force-closed the shift in the meantime.
     */
    SHIFT_NOT_OPEN = 'SHIFT_001',
    /** The caller already has an open shift; resume it instead. */
    SHIFT_ALREADY_OPEN = 'SHIFT_002',
    /** The shift named in the request is already closed. */
    SHIFT_CLOSED = 'SHIFT_003',
    /**
     * A void or refund pays cash back, and the sale's own shift is closed
     * (or the sale predates shifts): the ADMIN must name an open shift to
     * pay it from (`payoutShiftId`). `details.openShifts` says how many
     * are open.
     */
    SHIFT_PAYOUT_REQUIRED = 'SHIFT_004',
    /**
     * A void or refund pays cash back but no shift is open to pay it from.
     * Nothing was reversed; open a shift first.
     */
    SHIFT_PAYOUT_NO_OPEN_SHIFT = 'SHIFT_005',

    /** The caller is signed in but may not do this (generic 403). */
    FORBIDDEN = 'FORBIDDEN_001',
    /**
     * Generic 409 for a conflict with no more specific code (e.g. a Nest
     * `ConflictException`).
     */
    CONFLICT = 'CONFLICT_001',
    /**
     * Any other 4xx the API refused with no more specific code (e.g. 405,
     * 413, 415). The response keeps the real HTTP status.
     */
    HTTP_ERROR = 'HTTP_001',

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

    /**
     * A write clashed with a unique index (e.g. a product name that already
     * exists). 400; `details` lists the clashing fields as
     * `{ msg, property, index? }` (`index`: position in a bulk insert).
     */
    DB_DUPLICATE_KEY = 'DB_002',
    /**
     * The database or Mongoose schema rejected a document (validation or
     * cast failure). 400; `details` lists `{ field, message }`.
     */
    DB_VALIDATION_ERROR = 'DB_003',

    INTERNAL_ERROR = 'INTERNAL_001',
}

/**
 * Correlation id header. The API accepts a sane incoming value or generates
 * one, echoes it on every response and puts it in every error body
 * (`AppErrorResponse.requestId`) so users can quote it (issue #8).
 */
export const REQUEST_ID_HEADER = 'X-Request-Id';

/** Body returned by the API's GlobalFilter for every error response. */
export interface AppErrorResponse {
    statusCode: number;
    /** What went wrong, for the client to branch on. */
    error: ErrorCode;
    message: string;
    timestamp: string;
    path: string;
    /**
     * Extra, intentional context for 4xx errors. Always `null` on a 5xx:
     * internals stay in the server log, found by `requestId`.
     */
    details: unknown;
    /** The request's correlation id (also the `X-Request-Id` header). */
    requestId: string;
}

export const APP_ERROR_RESPONSE_SHAPE: WireShape<AppErrorResponse> = {
    statusCode: 'required',
    error: 'required',
    message: 'required',
    timestamp: 'required',
    path: 'required',
    details: 'required',
    requestId: 'required',
};

/** Shape of every paginated list endpoint. */
export interface Paginated<T> {
    /** One page of rows. */
    data: T[];
    /** Rows matching the filters across every page (`countDocuments`). */
    totalItems: number;
}

export const PAGINATED_SHAPE: WireShape<Paginated<unknown>> = {
    data: 'required',
    totalItems: 'required',
};
