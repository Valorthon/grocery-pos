import type { INestApplication } from '@nestjs/common';
import { json, urlencoded } from 'body-parser';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { useCspReportLimit } from '../csp-report/csp-report.throttle';

/**
 * The shape GlobalFilter reads off a body-parser failure: its status,
 * whether it is a client error, and its `type` (`BODY_ERROR_MESSAGES`).
 */
export interface BodyParserFailure extends Error {
    status: number;
    statusCode: number;
    expose: boolean;
    type?: string;
}

/**
 * A body-parser error as a plain `Error` holding only its status, `expose`
 * and `type`: never its message, which can quote request headers
 * (`unsupported content encoding "<value>"`) or the body (a JSON syntax
 * error). It must not stay a `SyntaxError` either: Nest turns an external
 * SyntaxError into `new BadRequestException(err.message)` (RoutesResolver's
 * `mapExternalException`), dropping the `type` and keeping the quote (#94).
 *
 * A 5xx (a rare server-side failure such as `stream.encoding.set` or
 * `stream.not.readable`) keeps the original error as a non-enumerable
 * `cause`, so GlobalFilter's error log (`stackWithCauses`) still shows
 * what went wrong; a 5xx response never carries it (#108). A 4xx keeps
 * no cause: its message is the client's own input.
 */
export function bodyParserFailure(err: unknown): BodyParserFailure {
    const e = (typeof err === 'object' && err !== null ? err : {}) as {
        status?: unknown;
        statusCode?: unknown;
        expose?: unknown;
        type?: unknown;
    };
    const raw = Number(e.status ?? e.statusCode);
    const status = Number.isInteger(raw) && raw >= 400 && raw < 600 ? raw : 500;
    const failure = Object.assign(new Error('Request body refused'), {
        name: 'BodyParserError',
        status,
        statusCode: status,
        expose: e.expose === true && status < 500,
        type: typeof e.type === 'string' ? e.type : undefined,
    });
    if (status >= 500) {
        Object.defineProperty(failure, 'cause', {
            value: err,
            enumerable: false,
            writable: true,
            configurable: true,
        });
    }
    return failure;
}

/** `parser`, with any error it raises passed on as a `bodyParserFailure`. */
export function withSafeErrors(parser: RequestHandler): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) =>
        parser(req, res, (err?: unknown) =>
            err === undefined || err === null
                ? next()
                : next(bodyParserFailure(err)),
        );
}

/**
 * The app's global body parsers: Nest's defaults (JSON, and urlencoded with
 * `extended: true`, body-parser's 100kb limit), installed by hand so their
 * errors go through `withSafeErrors`. Create the app with
 * `bodyParser: false`, then call this before `listen`/`init`.
 *
 * First, anything that must see a request before its body is read: the
 * CSP report route's per-IP rate limit, so a refused body counts (#108).
 */
export function useBodyParsers(app: INestApplication): void {
    useCspReportLimit(app);
    app.use(withSafeErrors(json()));
    app.use(withSafeErrors(urlencoded({ extended: true })));
}
