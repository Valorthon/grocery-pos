import { randomUUID } from 'node:crypto';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { REQUEST_ID_HEADER } from '@grocery-pos/contracts';
import type { NextFunction, Request, Response } from 'express';

export { REQUEST_ID_HEADER };

/**
 * An incoming `X-Request-Id` is kept only if it is short and made of safe
 * characters, so it cannot inject into log lines or headers.
 */
const SANE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

type WithRequestId = Request & { requestId?: string };

/** The incoming id if sane, otherwise a fresh UUID. */
export function pickRequestId(incoming: unknown): string {
    return typeof incoming === 'string' && SANE_REQUEST_ID.test(incoming)
        ? incoming
        : randomUUID();
}

/**
 * The request's correlation id. Assigns one (and sets the response
 * header) if `RequestIdMiddleware` has not run, e.g. for a request that
 * failed before reaching it.
 */
export function requestIdOf(req: Request, res?: Response): string {
    const r = req as WithRequestId;
    if (!r.requestId) {
        r.requestId = pickRequestId(
            req.headers?.[REQUEST_ID_HEADER.toLowerCase()],
        );
        if (res && !res.headersSent)
            res.setHeader(REQUEST_ID_HEADER, r.requestId);
    }
    return r.requestId;
}

/**
 * Gives every request a correlation id (issue #8): a sane incoming
 * `X-Request-Id` or a generated UUID, echoed in the `X-Request-Id`
 * response header. GlobalFilter puts it in error bodies and logs.
 */
export function RequestIdMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
): void {
    requestIdOf(req, res);
    next();
}

/** Applies `RequestIdMiddleware` to every route. */
@Module({})
export class RequestIdModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(RequestIdMiddleware).forRoutes('*');
    }
}
