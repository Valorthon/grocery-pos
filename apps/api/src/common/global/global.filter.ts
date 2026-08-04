import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AppError, AppErrorResponse, ErrorCode } from '../errors';

@Catch()
export class GlobalFilter implements ExceptionFilter {
    catch(exception: unknown, host: ArgumentsHost): void {
        const ctx = host.switchToHttp();
        const res = ctx.getResponse<Response>();
        const req = ctx.getRequest<Request>();

        if (exception instanceof AppError) {
            res.status(exception.statusCode).json(
                exception.toResponse(req.url),
            );
            return;
        }

        if (
            exception instanceof Error &&
            exception.name === 'MongoServerError'
        ) {
            MongoErrorHandler.handle(exception, res, req);
            return;
        }

        const errorResponse = this.buildErrorResponse(exception, req.url);
        res.status(errorResponse.statusCode).json(errorResponse);
    }

    private buildErrorResponse(
        exception: unknown,
        path: string,
    ): AppErrorResponse {
        const error = exception as {
            getStatus?: () => number;
            status?: number;
            getResponse?: () => unknown;
            message?: string;
        };

        const status =
            error.getStatus?.() ??
            error.status ??
            HttpStatus.INTERNAL_SERVER_ERROR;

        const response = error.getResponse?.();

        if (typeof response === 'object' && response !== null) {
            const respObj = response as { message?: string | string[] };
            const message = Array.isArray(respObj.message)
                ? respObj.message.join(', ')
                : (respObj.message ?? 'Internal Server Error');

            return {
                statusCode: status,
                error: ErrorCode.VALIDATION_INVALID_INPUT,
                message,
                timestamp: new Date().toISOString(),
                path,
                details: respObj.message !== message ? respObj : null,
            };
        }

        return {
            statusCode: status,
            error: ErrorCode.INTERNAL_ERROR,
            message:
                typeof response === 'string'
                    ? response
                    : 'Internal Server Error',
            timestamp: new Date().toISOString(),
            path,
            details: null,
        };
    }
}

class MongoErrorHandler {
    static handle(err: Error, res: Response, req: Request): void {
        const error = err as {
            code?: number | string;
            name?: string;
            message?: string;
            writeErrors?: Array<{
                err?: {
                    op?: Record<string, unknown>;
                    errmsg?: string;
                };
            }>;
            errorResponse?: {
                errmsg?: string;
                validationErrors?: Array<{
                    path: string;
                    message: string;
                }>;
            };
        };

        const code = Number(error.code);

        switch (code) {
            case 11000:
                return this.handleDuplicateKey(error, res, req);
            case 121:
                return this.handleValidationFailure(error, res, req);
            case 112:
                return this.handleWriteConflict(error, res, req);
            default:
                return this.handleGenericError(error, res, req);
        }
    }

    private static handleDuplicateKey(
        err: Record<string, unknown>,
        res: Response,
        req: Request,
    ): void {
        const error = err as {
            name?: string;
            writeErrors?: Array<{
                err?: {
                    op?: Record<string, unknown>;
                    errmsg?: string;
                };
            }>;
            errorResponse?: { errmsg?: string };
        };

        const baseErrMsg = 'Already exists';
        const getKey = (origMsg: string) =>
            origMsg.split('dup key: { ')[1]?.split(':')[0] ?? 'unknown';

        let details: unknown;

        if (error.name === 'MongoBulkWriteError') {
            details = error.writeErrors?.map(({ err: writeErr }) => {
                const op = writeErr?.op;
                const entry: Record<string, unknown> = {
                    msg: baseErrMsg,
                    property: getKey(writeErr?.errmsg ?? ''),
                };
                if (op?._id) {
                    entry._id = op._id;
                }
                return entry;
            });
        } else {
            details = [
                {
                    msg: baseErrMsg,
                    property: getKey(error.errorResponse?.errmsg ?? ''),
                },
            ];
        }

        const appError = new AppError(
            ErrorCode.DB_DUPLICATE_KEY,
            HttpStatus.BAD_REQUEST,
            baseErrMsg,
            details,
        );
        res.status(appError.statusCode).json(appError.toResponse(req.url));
    }

    private static handleValidationFailure(
        err: Record<string, unknown>,
        res: Response,
        req: Request,
    ): void {
        const error = err as {
            errorResponse?: {
                errmsg?: string;
                validationErrors?: Array<{
                    path: string;
                    message: string;
                }>;
            };
        };

        const validationErrors =
            error.errorResponse?.validationErrors?.map((v) => ({
                field: v.path,
                message: v.message,
            })) ?? [];

        const appError = new AppError(
            ErrorCode.DB_VALIDATION_ERROR,
            HttpStatus.BAD_REQUEST,
            'Document validation failed',
            validationErrors.length > 0 ? validationErrors : null,
        );
        res.status(appError.statusCode).json(appError.toResponse(req.url));
    }

    private static handleWriteConflict(
        err: Record<string, unknown>,
        res: Response,
        req: Request,
    ): void {
        const appError = new AppError(
            ErrorCode.INTERNAL_ERROR,
            HttpStatus.INTERNAL_SERVER_ERROR,
            'Write conflict - please retry',
            { originalError: err.message },
        );
        res.status(appError.statusCode).json(appError.toResponse(req.url));
    }

    private static handleGenericError(
        err: Record<string, unknown>,
        res: Response,
        req: Request,
    ): void {
        const appError = new AppError(
            ErrorCode.INTERNAL_ERROR,
            HttpStatus.INTERNAL_SERVER_ERROR,
            'Database error',
            { originalError: err.message },
        );
        res.status(appError.statusCode).json(appError.toResponse(req.url));
    }
}
