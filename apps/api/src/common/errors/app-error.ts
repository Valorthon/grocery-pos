import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from './codes';

export interface AppErrorResponse {
    statusCode: number;
    error: string;
    message: string;
    timestamp: string;
    path: string;
    details: unknown;
}

export class AppError extends Error {
    constructor(
        public readonly code: ErrorCode,
        public readonly statusCode: number,
        message: string,
        public readonly details: unknown = null,
    ) {
        super(message);
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }

    toResponse(path: string): AppErrorResponse {
        return {
            statusCode: this.statusCode,
            error: this.code,
            message: this.message,
            timestamp: new Date().toISOString(),
            path,
            details: this.details,
        };
    }

    static getHttpStatus(code: ErrorCode): number {
        switch (code) {
            case ErrorCode.AUTH_INVALID_CREDENTIALS:
            case ErrorCode.AUTH_TOKEN_EXPIRED:
            case ErrorCode.AUTH_MISSING_REFRESH_TOKEN:
            case ErrorCode.AUTH_INVALID_TOKEN:
            case ErrorCode.VALIDATION_INVALID_INPUT:
            case ErrorCode.VALIDATION_EAN_INVALID:
            case ErrorCode.PRODUCT_DUPLICATE:
                return HttpStatus.BAD_REQUEST;
            case ErrorCode.PRODUCT_NOT_FOUND:
            case ErrorCode.NOT_FOUND:
                return HttpStatus.NOT_FOUND;
            case ErrorCode.INTERNAL_ERROR:
                return HttpStatus.INTERNAL_SERVER_ERROR;
            default:
                return HttpStatus.INTERNAL_SERVER_ERROR;
        }
    }
}

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

export class InternalError extends AppError {
    constructor(message: string, details: unknown = null) {
        super(
            ErrorCode.INTERNAL_ERROR,
            HttpStatus.INTERNAL_SERVER_ERROR,
            message,
            details,
        );
    }
}
