import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from './codes';
import type { AppErrorResponse } from '@grocery-pos/contracts';

export type { AppErrorResponse } from '@grocery-pos/contracts';

export class AppError extends Error {
    /**
     * @param options.cause the underlying error (e.g. a Mongo driver error).
     *   It is logged by GlobalFilter and never sent to the client.
     */
    constructor(
        public readonly code: ErrorCode,
        public readonly statusCode: number,
        message: string,
        public readonly details: unknown = null,
        options?: { cause?: unknown },
    ) {
        super(message, options);
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }

    /**
     * The response body. A 5xx never carries `details`: whatever an
     * internal failure knows stays in the server log (issue #8).
     */
    toResponse(path: string, requestId: string): AppErrorResponse {
        return {
            statusCode: this.statusCode,
            error: this.code,
            message: this.message,
            timestamp: new Date().toISOString(),
            path,
            details: this.statusCode >= 500 ? null : this.details,
            requestId,
        };
    }

    static getHttpStatus(code: ErrorCode): number {
        switch (code) {
            // Every AUTH_* code means "this caller is not (or no longer)
            // authenticated": the client refreshes the session on a 401 and
            // sends the user back to login when the refresh itself 401s.
            case ErrorCode.AUTH_INVALID_CREDENTIALS:
            case ErrorCode.AUTH_TOKEN_EXPIRED:
            case ErrorCode.AUTH_MISSING_REFRESH_TOKEN:
            case ErrorCode.AUTH_INVALID_TOKEN:
                return HttpStatus.UNAUTHORIZED;
            // Signed in, but not allowed to do this. Never 401: the client
            // would treat it as an expired session and refresh.
            case ErrorCode.FORBIDDEN:
            case ErrorCode.USER_ROLE_NOT_GRANTABLE:
            case ErrorCode.USER_SELF_ROLE_CHANGE:
            case ErrorCode.USER_TARGET_FORBIDDEN:
            case ErrorCode.USER_PASSWORD_RESET_FORBIDDEN:
            case ErrorCode.USER_LAST_ADMIN:
            case ErrorCode.USER_WRONG_PASSWORD:
            case ErrorCode.PRODUCT_PRICE_CHANGE_FORBIDDEN:
                return HttpStatus.FORBIDDEN;
            case ErrorCode.VALIDATION_INVALID_INPUT:
            case ErrorCode.VALIDATION_EAN_INVALID:
            case ErrorCode.PRODUCT_DUPLICATE:
            case ErrorCode.DB_DUPLICATE_KEY:
            case ErrorCode.DB_VALIDATION_ERROR:
                return HttpStatus.BAD_REQUEST;
            case ErrorCode.PRODUCT_NOT_FOUND:
            case ErrorCode.NOT_FOUND:
                return HttpStatus.NOT_FOUND;
            // Valid requests the current state of a sale or shift does not
            // allow (shift codes: issue #2).
            case ErrorCode.SALE_DUPLICATE_REFERENCE:
            case ErrorCode.SALE_NOT_REVERSIBLE:
            case ErrorCode.SALE_IDEMPOTENCY_MISMATCH:
            case ErrorCode.SALE_IN_PROGRESS:
            case ErrorCode.SHIFT_NOT_OPEN:
            case ErrorCode.SHIFT_ALREADY_OPEN:
            case ErrorCode.SHIFT_CLOSED:
            case ErrorCode.SHIFT_PAYOUT_REQUIRED:
            case ErrorCode.SHIFT_PAYOUT_NO_OPEN_SHIFT:
            case ErrorCode.CONFLICT:
                return HttpStatus.CONFLICT;
            case ErrorCode.RATE_LIMITED:
                return HttpStatus.TOO_MANY_REQUESTS;
            case ErrorCode.INTERNAL_ERROR:
                return HttpStatus.INTERNAL_SERVER_ERROR;
            default:
                return HttpStatus.INTERNAL_SERVER_ERROR;
        }
    }
}

/** 401: the caller is not authenticated (see the AUTH_* codes). */
export class AuthError extends AppError {
    constructor(code: ErrorCode, message: string, details: unknown = null) {
        super(code, AppError.getHttpStatus(code), message, details);
    }
}

export class ValidationError extends AppError {
    constructor(code: ErrorCode, message: string, details: unknown = null) {
        super(code, AppError.getHttpStatus(code), message, details);
    }
}

export class NotFoundError extends AppError {
    constructor(code: ErrorCode, message: string, details: unknown = null) {
        super(code, AppError.getHttpStatus(code), message, details);
    }
}

/** 403: the caller is authenticated but may not perform this action. */
export class ForbiddenError extends AppError {
    constructor(code: ErrorCode, message: string, details: unknown = null) {
        super(code, AppError.getHttpStatus(code), message, details);
    }
}

/** 409: the request is valid but clashes with the current state of the data. */
export class ConflictError extends AppError {
    constructor(code: ErrorCode, message: string, details: unknown = null) {
        super(code, AppError.getHttpStatus(code), message, details);
    }
}

/** 429: too many attempts on a rate-limited route (see `RateLimitGuard`). */
export class RateLimitError extends AppError {
    constructor(message: string, details: unknown = null) {
        super(
            ErrorCode.RATE_LIMITED,
            AppError.getHttpStatus(ErrorCode.RATE_LIMITED),
            message,
            details,
        );
    }
}

export class DuplicateError extends AppError {
    constructor(message: string, details: unknown = null) {
        super(
            ErrorCode.PRODUCT_DUPLICATE,
            HttpStatus.BAD_REQUEST,
            message,
            details,
        );
    }
}

/**
 * 500. `details` and `cause` are for the server log only: the response
 * carries neither (see `AppError.toResponse`).
 */
export class InternalError extends AppError {
    constructor(
        message: string,
        details: unknown = null,
        options?: { cause?: unknown },
    ) {
        super(
            ErrorCode.INTERNAL_ERROR,
            HttpStatus.INTERNAL_SERVER_ERROR,
            message,
            details,
            options,
        );
    }
}
