import {
    Injectable,
    Logger,
    OnModuleDestroy,
    OnModuleInit,
} from '@nestjs/common';
import {
    CSP_REPORT_DEDUP_MAX_KEYS,
    CSP_REPORT_DEDUP_WINDOW_MS,
    CSP_REPORTS_LOGGED_MAX,
    cspRepeatLine,
    cspReportLine,
    CspViolation,
    cspViolationKey,
} from './csp-report';

interface Seen {
    violation: CspViolation;
    /** The request whose line logged it: the summary's correlation id. */
    requestId: string;
    repeats: number;
}

/**
 * The CSP report log lines (#94), de-duplicated (#108).
 *
 * Windows are fixed (`CSP_REPORT_DEDUP_WINDOW_MS`, a timer). In a window,
 * the first report of a violation (its three logged fields) is logged as
 * usual; later ones are only counted, and at the window's end each
 * violation that repeated gets one summary line with the count, under the
 * request id of the line it repeats. Then the window starts empty.
 *
 * Memory is bounded: at most `CSP_REPORT_DEDUP_MAX_KEYS` violations are
 * tracked per window. Once full, a new violation is not logged but counted
 * in one overflow line at the window's end. Per request, at most
 * `CSP_REPORTS_LOGGED_MAX` new violations are logged, the rest counted in
 * one line (and not tracked, so a later report can still log them).
 *
 * Process memory, like the throttler's counters: one API instance.
 */
@Injectable()
export class CspReportLog implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger('CspReport');
    private seen = new Map<string, Seen>();
    private overflow = 0;
    private timer?: NodeJS.Timeout;

    onModuleInit(): void {
        this.timer = setInterval(
            () => this.flush(),
            CSP_REPORT_DEDUP_WINDOW_MS,
        );
        this.timer.unref();
    }

    onModuleDestroy(): void {
        clearInterval(this.timer);
        this.timer = undefined;
        this.flush();
    }

    /** Logs one request's violations. */
    report(requestId: string, violations: CspViolation[]): void {
        let logged = 0;
        let notLogged = 0;
        for (const violation of violations) {
            const key = cspViolationKey(violation);
            const seen = this.seen.get(key);
            if (seen) {
                seen.repeats++;
            } else if (logged >= CSP_REPORTS_LOGGED_MAX) {
                notLogged++;
            } else if (this.seen.size >= CSP_REPORT_DEDUP_MAX_KEYS) {
                this.overflow++;
            } else {
                this.seen.set(key, { violation, requestId, repeats: 0 });
                this.logger.warn(cspReportLine(requestId, violation));
                logged++;
            }
        }
        if (notLogged > 0) {
            this.logger.warn(
                `[${requestId}] CSP violation: ${notLogged} more in this request not logged`,
            );
        }
    }

    /** Ends the window: logs the summaries, then forgets everything. */
    flush(): void {
        for (const { violation, requestId, repeats } of this.seen.values()) {
            if (repeats > 0) {
                this.logger.warn(cspRepeatLine(requestId, violation, repeats));
            }
        }
        if (this.overflow > 0) {
            this.logger.warn(
                `CSP violation: ${this.overflow} reports of other violations not logged in this window (${CSP_REPORT_DEDUP_MAX_KEYS} distinct already)`,
            );
        }
        this.seen = new Map();
        this.overflow = 0;
    }
}
