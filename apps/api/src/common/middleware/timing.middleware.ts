import { Request, Response, NextFunction } from 'express';
import { Logger } from '@nestjs/common';
import { requestIdOf } from '../request-id/request-id';

const logger = new Logger('Timing');

/**
 * The request path without its query string. Queries carry search terms,
 * dates and ids that do not belong in a default-level access log (#16).
 */
export function pathOf(req: Request): string {
    const url = req.originalUrl ?? req.url ?? '';
    const query = url.indexOf('?');
    return query === -1 ? url : url.slice(0, query);
}

/**
 * One access-log line per request: method, path (no query string), status,
 * duration and the request id (#8), so the line can be matched to an error
 * log and to the `X-Request-Id` the client saw.
 *
 * `requestIdOf` assigns the id if `RequestIdMiddleware` has not run yet,
 * and `RequestIdMiddleware` reuses it, so the id is the same either way,
 * whatever order Nest applies the two in.
 */
export function TimingMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
): void {
    const start = performance.now();
    const { method } = req;
    const path = pathOf(req);
    const requestId = requestIdOf(req, res);
    let isLogged = false;

    const logTime = () => {
        if (isLogged) return;
        isLogged = true;

        const duration = performance.now() - start;
        logger.log(
            `[${method}] ${path} - ${res.statusCode} - ${duration.toFixed(2)}ms - ${requestId}`,
        );
    };

    res.on('finish', logTime);
    res.on('close', logTime);

    next();
}
