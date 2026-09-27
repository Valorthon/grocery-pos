import { Logger } from '@nestjs/common';
import {
    CSP_REPORT_DEDUP_MAX_KEYS,
    CSP_REPORT_DEDUP_WINDOW_MS,
    CSP_REPORT_LIMITED_MAX_IPS,
    CSP_REPORTS_LOGGED_MAX,
    CspViolation,
    cspViolationKey,
} from './csp-report';
import { CspReportLog } from './csp-report.log';

function violation(
    blockedUri: string,
    documentUri = 'https://a.example/',
): CspViolation {
    return { directive: 'script-src', blockedUri, documentUri };
}

describe('CspReportLog (#108)', () => {
    let log: CspReportLog;
    let warn: jest.SpyInstance;

    const lines = () => warn.mock.calls.map((call) => String(call[0]));

    beforeEach(() => {
        warn = jest
            .spyOn(Logger.prototype, 'warn')
            .mockImplementation(() => undefined);
        log = new CspReportLog();
    });

    afterEach(() => {
        log.onModuleDestroy();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('logs the first report of a violation, counts the repeats, and summarises them when the window ends', () => {
        log.report('r1', [violation('eval')]);
        log.report('r2', [violation('eval'), violation('eval')]);
        log.report('r3', [violation('inline')]);
        expect(lines()).toEqual([
            '[r1] CSP violation: directive=script-src blocked=eval document=https://a.example/',
            '[r3] CSP violation: directive=script-src blocked=inline document=https://a.example/',
        ]);

        warn.mockClear();
        log.flush();
        // Under the id of the line it repeats; a violation that did not
        // repeat gets no summary.
        expect(lines()).toEqual([
            '[r1] CSP violation repeated 2 more times in this window: directive=script-src blocked=eval document=https://a.example/',
        ]);

        warn.mockClear();
        log.flush();
        expect(lines()).toEqual([]);
        log.report('r4', [violation('eval')]);
        expect(lines()).toEqual([expect.stringContaining('[r4]')]);
    });

    it('ends each window on a timer, and flushes on shutdown', () => {
        jest.useFakeTimers();
        log.onModuleInit();
        log.report('r1', [violation('eval'), violation('eval')]);
        warn.mockClear();

        jest.advanceTimersByTime(CSP_REPORT_DEDUP_WINDOW_MS - 1);
        expect(lines()).toEqual([]);
        jest.advanceTimersByTime(1);
        expect(lines()).toEqual([
            expect.stringContaining('repeated 1 more time in this window'),
        ]);

        warn.mockClear();
        log.report('r2', [violation('eval'), violation('eval')]);
        log.onModuleDestroy();
        expect(lines()).toEqual([
            expect.stringContaining('[r2] CSP violation: '),
            expect.stringContaining('[r2] CSP violation repeated 1 more time'),
        ]);
        jest.advanceTimersByTime(CSP_REPORT_DEDUP_WINDOW_MS);
        expect(lines()).toHaveLength(2);
    });

    it(`logs at most ${CSP_REPORTS_LOGGED_MAX} new violations per request, without tracking the rest`, () => {
        const batch = Array.from(
            { length: CSP_REPORTS_LOGGED_MAX + 2 },
            (_, i) => violation(`https://c.example/${i}.js`),
        );
        log.report('r1', [...batch, violation('https://c.example/0.js')]);
        expect(lines()).toHaveLength(CSP_REPORTS_LOGGED_MAX + 1);
        expect(lines().at(-1)).toBe(
            '[r1] CSP violation: 2 more in this request not logged',
        );

        // The untracked two are still new to a later request.
        warn.mockClear();
        log.report('r2', batch.slice(CSP_REPORTS_LOGGED_MAX));
        expect(lines()).toHaveLength(2);
    });

    it(`tracks at most ${CSP_REPORT_DEDUP_MAX_KEYS} violations a window, then counts new ones in one line`, () => {
        for (let i = 0; i < CSP_REPORT_DEDUP_MAX_KEYS; i++) {
            log.report(`r${i}`, [violation(`https://c.example/${i}.js`)]);
        }
        expect(lines()).toHaveLength(CSP_REPORT_DEDUP_MAX_KEYS);

        warn.mockClear();
        log.report('full', [violation('https://c.example/new.js')]);
        log.report('full2', [violation('https://c.example/new.js')]);
        log.report('seen', [violation('https://c.example/0.js')]);
        expect(lines()).toEqual([]);

        log.flush();
        expect(lines()).toEqual([
            '[r0] CSP violation repeated 1 more time in this window: directive=script-src blocked=https://c.example/0.js document=https://a.example/',
            `CSP violation: 2 reports of other violations not logged in this window (${CSP_REPORT_DEDUP_MAX_KEYS} distinct already)`,
        ]);

        warn.mockClear();
        log.report('next', [violation('https://c.example/new.js')]);
        expect(lines()).toEqual([expect.stringContaining('[next]')]);
    });

    it('keys violations unambiguously: fields containing spaces never collide', () => {
        log.report('r1', [
            { directive: 'a b', blockedUri: 'c', documentUri: 'd' },
            { directive: 'a', blockedUri: 'b c', documentUri: 'd' },
        ]);
        expect(lines()).toHaveLength(2);
        expect(
            cspViolationKey({
                directive: 'a b',
                blockedUri: 'c',
                documentUri: 'd',
            }),
        ).not.toBe(
            cspViolationKey({
                directive: 'a',
                blockedUri: 'b c',
                documentUri: 'd',
            }),
        );
    });

    it('counts rate-limited requests per IP and logs one line per IP when the window ends', () => {
        for (let i = 0; i < 3; i++) log.rateLimited('203.0.113.7');
        log.rateLimited('2001:db8::1');
        expect(lines()).toEqual([]);

        log.flush();
        expect(lines()).toEqual([
            'CSP reports rate-limited: 3 from 203.0.113.7 in this window',
            'CSP reports rate-limited: 1 from 2001:db8::1 in this window',
        ]);

        warn.mockClear();
        log.flush();
        expect(lines()).toEqual([]);
    });

    it(`counts rate-limited requests from at most ${CSP_REPORT_LIMITED_MAX_IPS} IPs a window, the rest in one line`, () => {
        for (let i = 0; i < CSP_REPORT_LIMITED_MAX_IPS; i++) {
            log.rateLimited(`ip-${i}`);
        }
        log.rateLimited('ip-0');
        log.rateLimited('one-too-many');
        log.rateLimited('two-too-many');

        log.flush();
        expect(lines()).toHaveLength(CSP_REPORT_LIMITED_MAX_IPS + 1);
        expect(lines()[0]).toBe(
            'CSP reports rate-limited: 2 from ip-0 in this window',
        );
        expect(lines().at(-1)).toBe(
            `CSP reports rate-limited: 2 from other IPs in this window (${CSP_REPORT_LIMITED_MAX_IPS} IPs already)`,
        );
    });
});
