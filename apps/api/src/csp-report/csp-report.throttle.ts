import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { CspReportLimiter } from '../auth/rate-limit/rate-limit';
import { CSP_REPORT_PATH } from './csp-report';

/**
 * Installs `POST /v1/csp-report`'s per-IP rate limit ahead of every body
 * parser (#108), when CspReportModule is part of the app. `useBodyParsers`
 * calls it first, so the global JSON/urlencoded parsers and the route's
 * own text parser all run after it: a report refused while parsing (413,
 * a bad charset or Content-Encoding, malformed JSON) counts against
 * `RATE_LIMITS.cspReport` like an accepted one, and once an IP is over the
 * limit its bodies are not read at all. The 429 goes to GlobalFilter.
 *
 * Only POST counts: the Reporting API's CORS preflight is answered by the
 * CORS middleware before this runs.
 */
export function useCspReportLimit(app: INestApplication): void {
    let limiter: CspReportLimiter;
    try {
        limiter = app.get(CspReportLimiter, { strict: false });
    } catch {
        return; // No CspReportModule (e.g. the access harness): no route.
    }
    app.use(CSP_REPORT_PATH, cspReportLimit(limiter));
}

/** The middleware itself: one hit per POST, a 429 passed to `next`. */
export function cspReportLimit(limiter: Pick<CspReportLimiter, 'hit'>) {
    return (req: Request, res: Response, next: NextFunction): void => {
        if (req.method !== 'POST') return next();
        void limiter.hit(req, res).then(() => next(), next);
    };
}
