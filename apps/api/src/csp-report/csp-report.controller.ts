import {
    Controller,
    HttpCode,
    HttpStatus,
    Logger,
    Post,
    Req,
    UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/auth.decorator';
import { CspReportRateLimit } from '../auth/rate-limit/rate-limit';
import { ErrorCode, ValidationError } from '../common/errors';
import { requestIdOf } from '../common/request-id/request-id';
import {
    CSP_REPORT_CONTENT_TYPES,
    CSP_REPORTS_LOGGED_MAX,
    cspReportLine,
    parseCspReports,
} from './csp-report';

/**
 * `POST /v1/csp-report` (#94): the browser's Content-Security-Policy
 * violation reports, from the client's nginx CSP (`report-uri` and
 * `report-to`). Public: browsers send reports without credentials. Each
 * report becomes one warn line; the body itself, the headers and cookies
 * are never logged, and nothing is echoed back.
 *
 * The body arrives as text: `CspReportModule` parses only this route's two
 * report media types, capped at `CSP_REPORT_MAX_BYTES`, leaving the app's
 * global JSON parsing untouched. It is parsed here so a malformed report
 * gets a fixed message rather than a JSON error quoting the body.
 */
@Controller('csp-report')
export class CspReportController {
    private readonly logger = new Logger('CspReport');

    @Public()
    @CspReportRateLimit()
    @Post()
    @HttpCode(HttpStatus.NO_CONTENT)
    report(@Req() req: Request): void {
        const type = req.is([...CSP_REPORT_CONTENT_TYPES]);
        if (
            type !== CSP_REPORT_CONTENT_TYPES[0] &&
            type !== CSP_REPORT_CONTENT_TYPES[1]
        ) {
            throw new UnsupportedMediaTypeException(
                `Expected ${CSP_REPORT_CONTENT_TYPES.join(' or ')}`,
            );
        }

        const violations = parseCspReports(type, parseJson(req.body));
        if (!violations) {
            throw new ValidationError(
                ErrorCode.VALIDATION_INVALID_INPUT,
                'Malformed CSP report',
            );
        }

        const requestId = requestIdOf(req);
        for (const violation of violations.slice(0, CSP_REPORTS_LOGGED_MAX)) {
            this.logger.warn(cspReportLine(requestId, violation));
        }
        const dropped = violations.length - CSP_REPORTS_LOGGED_MAX;
        if (dropped > 0) {
            this.logger.warn(
                `[${requestId}] CSP violation: ${dropped} more in this request not logged`,
            );
        }
    }
}

/** The text body as JSON, or `undefined` when it is not JSON at all. */
function parseJson(body: unknown): unknown {
    if (typeof body !== 'string') return undefined;
    try {
        return JSON.parse(body) as unknown;
    } catch {
        return undefined;
    }
}
