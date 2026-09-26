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

export const CSP_REPORT_CONTENT_TYPES = [
    'application/csp-report',
    'application/reports+json',
] as const;

/** Body cap for this route (the app-wide JSON limit is body-parser's 100kb). */
export const CSP_REPORT_MAX_BYTES = 16 * 1024;

/**
 * At most this many reports of one request are logged; the rest are
 * counted in one extra line. 16KB of minimal reports would otherwise be
 * hundreds of log lines per request.
 */
export const CSP_REPORTS_LOGGED_MAX = 20;

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
        // Not a URL (a keyword or garbage): kept as is, then escaped below.
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
