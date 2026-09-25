import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpException,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
    AppError,
    AppErrorResponse,
    classifyDbError,
    ErrorCode,
} from '../errors';
import { requestIdOf } from '../request-id/request-id';

/** The only message a client ever sees for an unexpected failure. */
export const INTERNAL_MESSAGE = 'Internal server error';

/**
 * The ErrorCode for an HttpException that Nest or a library raised (a
 * guard's 403, an unknown route's 404, ...): it keeps its real status and
 * gets a code that matches it.
 */
const CODE_FOR_STATUS: Partial<Record<number, ErrorCode>> = {
    [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_INVALID_INPUT,
    [HttpStatus.UNAUTHORIZED]: ErrorCode.AUTH_INVALID_TOKEN,
    [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
    [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
    [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
    [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
};

export function codeForStatus(status: number): ErrorCode {
    return (
        CODE_FOR_STATUS[status] ??
        (status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.HTTP_ERROR)
    );
}

/** `err.stack`, followed by the stack of each `cause` in the chain. */
export function stackWithCauses(err: unknown): string | undefined {
    const parts: string[] = [];
    const seen = new Set<unknown>();
    let current: unknown = err;
    while (current !== undefined && current !== null && !seen.has(current)) {
        seen.add(current);
        parts.push(
            current instanceof Error
                ? (current.stack ?? `${current.name}: ${current.message}`)
                : safeString(current),
        );
        current = current instanceof Error ? current.cause : undefined;
    }
    return parts.length > 0 ? parts.join('\nCaused by: ') : undefined;
}

function safeString(value: unknown): string {
    try {
        return typeof value === 'string' ? value : JSON.stringify(value);
    } catch {
        return String(value);
    }
}

/**
 * Turns every exception into an `AppErrorResponse` (issue #8).
 *
 * - `AppError`: its own status, code and `details` (none on a 5xx).
 * - An `InternalError` or raw error from the database is classified first
 *   (`classifyDbError`, also unwrapping a `cause`): a duplicate key or
 *   validation failure is a 400, not a 500.
 * - `HttpException` (Nest, guards, `ValidationPipe`): its real status and a
 *   matching code (`codeForStatus`). The ValidationPipe's message list is
 *   joined into `message` and kept in `details.messages`.
 * - Anything else: 500 INTERNAL_ERROR with a generic message.
 *
 * Every body carries the request's correlation id. A 5xx is logged as an
 * error with the stack (and every `cause`); a 4xx as one warning line.
 * Request bodies are never logged.
 */
@Catch()
export class GlobalFilter implements ExceptionFilter {
    private readonly logger = new Logger(GlobalFilter.name);

    catch(exception: unknown, host: ArgumentsHost): void {
        const ctx = host.switchToHttp();
        const res = ctx.getResponse<Response>();
        const req = ctx.getRequest<Request>();
        const requestId = requestIdOf(req, res);

        const body = this.toResponse(exception, req.url, requestId);
        this.log(exception, body, req);

        res.status(body.statusCode).json(body);
    }

    private toResponse(
        exception: unknown,
        path: string,
        requestId: string,
    ): AppErrorResponse {
        const classified =
            classifyDbError(exception) ??
            (exception instanceof AppError && exception.statusCode >= 500
                ? classifyDbError(exception.cause)
                : null);
        if (classified) return classified.toResponse(path, requestId);

        if (exception instanceof AppError) {
            return exception.toResponse(path, requestId);
        }

        if (exception instanceof HttpException) {
            return this.fromHttpException(exception, path, requestId);
        }

        return {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            error: ErrorCode.INTERNAL_ERROR,
            message: INTERNAL_MESSAGE,
            timestamp: new Date().toISOString(),
            path,
            details: null,
            requestId,
        };
    }

    private fromHttpException(
        exception: HttpException,
        path: string,
        requestId: string,
    ): AppErrorResponse {
        const status = exception.getStatus();
        const base = {
            statusCode: status,
            error: codeForStatus(status),
            timestamp: new Date().toISOString(),
            path,
            requestId,
        };

        if (status >= 500) {
            return { ...base, message: INTERNAL_MESSAGE, details: null };
        }

        const response = exception.getResponse();
        const raw =
            typeof response === 'object' && response !== null
                ? (response as { message?: unknown }).message
                : response;

        if (Array.isArray(raw)) {
            const messages = raw.map(String);
            return {
                ...base,
                message: messages.join(', '),
                details: { messages },
            };
        }

        return {
            ...base,
            message: typeof raw === 'string' ? raw : exception.message,
            details: null,
        };
    }

    private log(exception: unknown, body: AppErrorResponse, req: Request) {
        // The path without the query string: queries can carry search terms.
        const path = (req.originalUrl ?? req.url ?? '').split('?')[0];
        const line = `[${body.requestId}] ${req.method} ${path} -> ${body.statusCode} ${body.error}`;

        if (body.statusCode >= 500) {
            const details =
                exception instanceof AppError && exception.details !== null
                    ? ` details=${safeString(exception.details)}`
                    : '';
            const message =
                exception instanceof Error
                    ? `${exception.name}: ${exception.message}`
                    : safeString(exception);
            this.logger.error(
                `${line}: ${message}${details}`,
                stackWithCauses(exception),
            );
            return;
        }

        this.logger.warn(`${line}: ${body.message}`);
    }
}
