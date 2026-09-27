/**
 * Content-Security-Policy violation reports (#94): what the browser sends
 * to `POST /v1/csp-report`, and the one log line each report becomes.
 *
 * Two formats arrive, depending on the browser and which CSP directive
 * sent them (nginx.conf.template sets both):
 * - `report-uri` (legacy, every browser): `application/csp-report`, one
 *   object `{"csp-report": {"document-uri", "blocked-uri",
 *   "effective-directive", "violated-directive", ...}}`.
 * - `report-to` (Reporting API, Chromium): `application/reports+json`, an
 *   array of `{type: "csp-violation", url, body: {documentURL, blockedURL,
 *   effectiveDirective, ...}}`, possibly batched.
 *
 * Validation is deliberately loose: fields vary by browser and version, and
 * the sender is anonymous. Only the four fields logged are read; anything
 * else in a report (the sample, the referrer, the source file, the whole
 * policy) is ignored and never logged.
 */

import { API_VERSION_PREFIX } from '../constants';

/** The controller's route, and its full path under URI version 1. */
export const CSP_REPORT_ROUTE = 'csp-report';
export const CSP_REPORT_PATH = `${API_VERSION_PREFIX}/${CSP_REPORT_ROUTE}`;

export const CSP_REPORT_CONTENT_TYPES = [
    'application/csp-report',
    'application/reports+json',
] as const;

/** Body cap for this route (the app-wide JSON limit is body-parser's 100kb). */
export const CSP_REPORT_MAX_BYTES = 16 * 1024;

/**
 * At most this many reports of one request are logged; the rest are
 * counted in one extra line. 16KB of minimal reports would otherwise be
 * hundreds of log lines per request; a page load rarely has more distinct
 * violations than this.
 */
export const CSP_REPORTS_LOGGED_MAX = 5;

/**
 * De-duplication (#108): a violation (directive + blocked URI + document
 * URI, as logged) is logged once per window; repeats within the window are
 * counted and summarised in one line when it ends.
 */
export const CSP_REPORT_DEDUP_WINDOW_MS = 60_000;

/**
 * At most this many distinct violations are tracked per window (each key
 * is at most ~600 characters). Once full, further new violations are not
 * logged, only counted in one line at the window's end.
 */
export const CSP_REPORT_DEDUP_MAX_KEYS = 1000;

/**
 * At most this many client IPs have their rate-limited reports counted per
 * window (one summary line each at its end); requests from further IPs are
 * counted in one overflow line.
 */
export const CSP_REPORT_LIMITED_MAX_IPS = 1000;

/** The longest logged value; longer ones are cut and marked with `…`. */
const FIELD_MAX = 200;

export interface CspViolation {
    directive: string;
    blockedUri: string;
    documentUri: string;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

/**
 * A report field made safe for one log line: the query string and
 * fragment dropped (they can carry tokens or search terms), user info
 * dropped from a URL, anything but printable ASCII replaced (no newlines
 * or ANSI codes into the log), and the length capped. Keywords such as
 * `inline`, `eval` or `data` pass through unchanged. Empty is `-`.
 */
export function logSafe(raw: string): string {
    let value = raw.split(/[?#]/, 1)[0];
    try {
        const url = new URL(value);
        if (url.username || url.password) {
            url.username = '';
            url.password = '';
            value = url.href;
        }
    } catch {
        // Not a URL (a keyword, garbage, or a URL `new URL` refuses, such
        // as one with a bad port): any `userinfo@` after `//` is still
        // dropped, up to the last `@` of the authority, then the rest is
        // escaped below.
        value = value.replace(
            /^((?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\/)[^/]*@/,
            '$1',
        );
    }
    value = value.replace(/[^\x21-\x7e]/g, '_');
    if (value.length > FIELD_MAX) value = `${value.slice(0, FIELD_MAX)}…`;
    return value || '-';
}

function fromLegacy(report: Json): CspViolation {
    return {
        directive: logSafe(
            str(report['effective-directive']) ||
                str(report['violated-directive']),
        ),
        blockedUri: logSafe(str(report['blocked-uri'])),
        documentUri: logSafe(str(report['document-uri'])),
    };
}

function fromReportingApi(report: Json): CspViolation | null {
    if (report.type !== 'csp-violation' || !isObject(report.body)) return null;
    const body = report.body;
    return {
        directive: logSafe(
            str(body.effectiveDirective) || str(body.violatedDirective),
        ),
        blockedUri: logSafe(str(body.blockedURL)),
        documentUri: logSafe(str(body.documentURL) || str(report.url)),
    };
}

/**
 * The violations in a parsed report body, or `null` when the body is not a
 * report at all (the caller answers 400). Entries of a Reporting API batch
 * that are not CSP violations, or not objects, are skipped.
 */
export function parseCspReports(
    contentType: (typeof CSP_REPORT_CONTENT_TYPES)[number],
    body: unknown,
): CspViolation[] | null {
    if (contentType === 'application/csp-report') {
        if (!isObject(body) || !isObject(body['csp-report'])) return null;
        return [fromLegacy(body['csp-report'])];
    }
    if (!Array.isArray(body)) return null;
    return body.flatMap((entry) => {
        if (!isObject(entry)) return [];
        const violation = fromReportingApi(entry);
        return violation ? [violation] : [];
    });
}

/** The warn line for one violation (the request id is the correlation id). */
export function cspReportLine(
    requestId: string,
    { directive, blockedUri, documentUri }: CspViolation,
): string {
    return `[${requestId}] CSP violation: directive=${directive} blocked=${blockedUri} document=${documentUri}`;
}

/** The de-duplication key: exactly the three logged fields, unambiguous. */
export function cspViolationKey({
    directive,
    blockedUri,
    documentUri,
}: CspViolation): string {
    return JSON.stringify([directive, blockedUri, documentUri]);
}

/** The window-end line for a violation that repeated after being logged. */
export function cspRepeatLine(
    requestId: string,
    violation: CspViolation,
    repeats: number,
): string {
    const { directive, blockedUri, documentUri } = violation;
    return `[${requestId}] CSP violation repeated ${repeats} more ${repeats === 1 ? 'time' : 'times'} in this window: directive=${directive} blocked=${blockedUri} document=${documentUri}`;
}

/** The window-end line for the reports refused by the rate limit. */
export function cspRateLimitedLine(ip: string, count: number): string {
    return `CSP reports rate-limited: ${count} from ${logSafe(ip)} in this window`;
}
