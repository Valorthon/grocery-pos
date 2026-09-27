import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { clientIp, CspReportLimiter } from '../auth/rate-limit/rate-limit';
import { RateLimitError } from '../common/errors';
import { loggedByRaiser } from '../common/global/global.filter';
import { CSP_REPORT_PATH } from './csp-report';
import { CspReportLog } from './csp-report.log';

/**
 * Installs `POST /v1/csp-report`'s per-IP rate limit ahead of every body
 * parser (#108), when CspReportModule is part of the app. `useBodyParsers`
 * calls it first, so the global JSON/urlencoded parsers and the route's
 * own text parser all run after it: a report refused while parsing (413,
 * a bad charset or Content-Encoding, malformed JSON) counts against
 * `RATE_LIMITS.cspReport` like an accepted one, and once an IP is over the
 * limit its bodies are not read at all. The 429 goes to GlobalFilter,
 * which answers it as usual but does not log it: `CspReportLog` counts
 * those per client IP and writes one line per IP a window, so a flood of
 * blocked requests cannot flood the log either.
 *
 * Only POST counts: the Reporting API's CORS preflight is answered by the
 * CORS middleware before this runs.
 */
export function useCspReportLimit(app: INestApplication): void {
    let limiter: CspReportLimiter;
    let log: CspReportLog;
    try {
        limiter = app.get(CspReportLimiter, { strict: false });
        log = app.get(CspReportLog, { strict: false });
    } catch {
        return; // No CspReportModule (e.g. the access harness): no route.
    }
    app.use(CSP_REPORT_PATH, cspReportLimit(limiter, log));
}

/**
 * The middleware itself: one hit per POST. A 429 is counted in the log's
 * window and passed to `next` marked `loggedByRaiser`; any other failure
 * (the storage) is passed on as it is.
 */
export function cspReportLimit(
    limiter: Pick<CspReportLimiter, 'hit'>,
    log: Pick<CspReportLog, 'rateLimited'>,
) {
    return (req: Request, res: Response, next: NextFunction): void => {
        if (req.method !== 'POST') return next();
        void limiter.hit(req, res).then(
            () => next(),
            (err: unknown) => {
                if (err instanceof RateLimitError) {
                    log.rateLimited(clientIp(req));
                    return next(loggedByRaiser(err));
                }
                next(err);
            },
        );
    };
}
