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
 * - A raw error from the database is classified first (`classifyDbError`):
 *   a duplicate key or validation failure is a 400, not a 500.
 * - `HttpException` (Nest, guards, `ValidationPipe`): its real status and a
 *   matching code (`codeForStatus`). The ValidationPipe's message list is
 *   joined into `message` and kept in `details.messages`.
 * - An exposed `http-errors` 4xx (body-parser's 413, malformed JSON, a bad
 *   charset or Content-Encoding): its status, a matching code and a fixed
 *   message for its `type` (`BODY_ERROR_MESSAGES`), never its own message,
 *   which can quote request headers or the body (#94). main.ts installs
 *   the parsers through `body-parsers.ts`, so a JSON syntax error reaches
 *   this filter as such rather than as Nest's BadRequestException.
 * - Anything else: 500 INTERNAL_ERROR with a generic message.
 *
 * Every body carries the request's correlation id. A 5xx is logged as an
 * error with the stack (and every `cause`); a 4xx as one warning line,
 * plus the stack and causes for a classified database error.
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
        // A raw database error thrown outside `runInTransaction` (inside
        // one, db.ts has already classified it).
        const classified = classifyDbError(exception);
        if (classified) return classified.toResponse(path, requestId);

        if (exception instanceof AppError) {
            return exception.toResponse(path, requestId);
        }

        if (exception instanceof HttpException) {
            return this.fromHttpException(exception, path, requestId);
        }

        const base = {
            timestamp: new Date().toISOString(),
            path,
            details: null,
            requestId,
        };

        const httpError = exposedClientError(exception);
        if (httpError) {
            return {
                ...base,
                statusCode: httpError.status,
                error: codeForStatus(httpError.status),
                message: httpError.message,
            };
        }

        return {
            ...base,
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            error: ErrorCode.INTERNAL_ERROR,
            message: INTERNAL_MESSAGE,
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
        const message =
            exception instanceof Error
                ? `${exception.name}: ${exception.message}`
                : safeString(exception);

        if (body.statusCode >= 500) {
            const details =
                exception instanceof AppError && exception.details !== null
                    ? ` details=${safeString(exception.details)}`
                    : '';
            this.logger.error(
                `${line}: ${message}${details}`,
                stackWithCauses(exception),
            );
            return;
        }

        // A classified database error (a duplicate key, a validation
        // failure) is a 4xx, but its stack and the driver error behind it
        // are what explain it: still a warning, with the stack and causes
        // in the same entry.
        if (isClassifiedDbError(exception)) {
            this.logger.warn(
                `${line}: ${message}\n${stackWithCauses(exception)}`,
            );
            return;
        }

        // A body-parser error: its type only. Its own message can quote
        // request headers or the body.
        const httpError = exposedClientError(exception);
        if (
            httpError &&
            !(exception instanceof AppError) &&
            !(exception instanceof HttpException)
        ) {
            this.logger.warn(`${line}: body-parser ${httpError.type}`);
            return;
        }

        this.logger.warn(`${line}: ${body.message}`);
    }
}

/**
 * A database error that answers 4xx: raw (classified by the filter) or
 * already classified by `runInTransaction` (an AppError whose `cause` is
 * the driver or Mongoose error).
 */
function isClassifiedDbError(exception: unknown): boolean {
    return (
        classifyDbError(exception) !== null ||
        (exception instanceof AppError && exception.cause !== undefined)
    );
}

/**
 * The fixed client message for each `type` body-parser and raw-body give
 * their errors. Their own messages can quote the request: `unsupported
 * content encoding "<Content-Encoding>"`, `unsupported charset "<charset>"`,
 * or a JSON syntax error quoting the body. So the message sent and logged
 * is chosen by `type` (#94), never taken from the error.
 */
export const BODY_ERROR_MESSAGES: Readonly<Record<string, string>> = {
    'entity.too.large': 'request entity too large',
    'entity.parse.failed': 'Malformed request body',
    'entity.verify.failed': 'Request body verification failed',
    'charset.unsupported': 'Unsupported charset',
    'encoding.unsupported': 'Unsupported content encoding',
    'request.aborted': 'Request aborted',
    'request.size.invalid': 'Request size did not match its content length',
    'parameters.too.many': 'Too many parameters',
    'querystring.parse.rangeError': 'Too deeply nested parameters',
};

/** For an exposed http error of no known `type`. */
export const BODY_ERROR_FALLBACK_MESSAGE = 'Request body refused';

/**
 * An `http-errors` client error, as body-parser raises it (413 entity too
 * large, 400 malformed JSON, 415 unsupported charset or encoding): `expose`
 * is true for a client error. Its status is kept; its message is the fixed
 * one for its `type`, and `type` is what gets logged.
 */
function exposedClientError(
    exception: unknown,
): { status: number; message: string; type: string } | null {
    if (!(exception instanceof Error)) return null;
    const e = exception as Error & {
        expose?: unknown;
        status?: unknown;
        statusCode?: unknown;
        type?: unknown;
    };
    const status = Number(e.status ?? e.statusCode);
    if (e.expose !== true || !Number.isInteger(status)) return null;
    if (status < 400 || status >= 500) return null;
    const type =
        typeof e.type === 'string' && Object.hasOwn(BODY_ERROR_MESSAGES, e.type)
            ? e.type
            : 'unknown';
    return {
        status,
        type,
        message: BODY_ERROR_MESSAGES[type] ?? BODY_ERROR_FALLBACK_MESSAGE,
    };
}
