import { cspReportLine, logSafe, parseCspReports } from './csp-report';

describe('logSafe (#94)', () => {
    it.each([
        ['https://a.example/p?q=1#f', 'https://a.example/p'],
        ['https://a.example/p#f?x', 'https://a.example/p'],
        ['https://u:p@a.example/p', 'https://a.example/p'],
        ['https://u@a.example/', 'https://a.example/'],
        ['inline', 'inline'],
        ['eval', 'eval'],
        ['data', 'data'],
        ['', '-'],
        ['?only-a-query', '-'],
        ['line\nbreak\u001b[31m red', 'line_break_[31m_red'],
        ['café x', 'caf__x'],
    ])('%j logs as %j', (raw, logged) => {
        expect(logSafe(raw)).toBe(logged);
    });

    it('caps the length', () => {
        const logged = logSafe(`https://a.example/${'x'.repeat(500)}`);
        expect(logged).toHaveLength(201);
        expect(logged.endsWith('…')).toBe(true);
    });
});

describe('parseCspReports (#94)', () => {
    it('reads nothing but strings from a legacy report', () => {
        expect(
            parseCspReports('application/csp-report', {
                'csp-report': {
                    'effective-directive': 42,
                    'violated-directive': ['x'],
                    'blocked-uri': null,
                },
            }),
        ).toEqual([{ directive: '-', blockedUri: '-', documentUri: '-' }]);
    });

    it('takes a Reporting API entry without a documentURL from its url', () => {
        expect(
            parseCspReports('application/reports+json', [
                {
                    type: 'csp-violation',
                    url: 'https://pos.example.com/a?b',
                    body: { violatedDirective: 'img-src', blockedURL: 'data' },
                },
                { type: 'csp-violation', body: 'not an object' },
                null,
            ]),
        ).toEqual([
            {
                directive: 'img-src',
                blockedUri: 'data',
                documentUri: 'https://pos.example.com/a',
            },
        ]);
    });

    it.each([
        ['application/csp-report', null],
        ['application/csp-report', []],
        ['application/csp-report', { 'csp-report': [] }],
        ['application/reports+json', {}],
        ['application/reports+json', undefined],
    ] as const)('%s %j is not a report', (type, body) => {
        expect(parseCspReports(type, body)).toBeNull();
    });

    it('formats one line with the request id', () => {
        expect(
            cspReportLine('req-1', {
                directive: 'script-src',
                blockedUri: 'eval',
                documentUri: 'https://pos.example.com/',
            }),
        ).toBe(
            '[req-1] CSP violation: directive=script-src blocked=eval document=https://pos.example.com/',
        );
    });
});
