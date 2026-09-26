/**
 * `POST /v1/csp-report` over real HTTP (#94): the real CspReportModule
 * (its route-scoped body parser and rate limit) behind the global
 * JWTAuthGuard, RoleGuard, GlobalFilter, RequestIdModule, main.ts's
 * ValidationPipe and CORS options. No caller signs in: browsers send
 * reports without credentials.
 */
import type { AddressInfo } from 'node:net';
import {
    Body,
    Controller,
    INestApplication,
    Logger,
    Post,
    VersioningType,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getStorageToken } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import { Public } from '../auth/auth.decorator';
import { JWTAuthGuard } from '../auth/guards/jwt.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { JWTStrategy } from '../auth/jwt.strategy';
import { RATE_LIMITS } from '../auth/rate-limit/rate-limit';
import { useBodyParsers } from '../common/body-parsers';
import { corsOptions } from '../common/cors';
import { ErrorCode } from '../common/errors';
import { GlobalFilter } from '../common/global/global.filter';
import { createValidationPipe } from '../common/pipes/validation.pipe';
import { RequestIdModule } from '../common/request-id/request-id';
import { TypedConfigService } from '../common/typed-config/typed-config.service';
import { CSP_REPORT_MAX_BYTES, CSP_REPORTS_LOGGED_MAX } from './csp-report';
import { CspReportModule } from './csp-report.module';

const FRONTEND = 'https://pos.example.com';
const CONFIG: Record<string, unknown> = {
    APP_ENV: 'test',
    COOKIE_SECRET: 'csp-report-cookie-secret-0123456789abc',
    JWT_SECRET: 'csp-report-jwt-secret-0123456789abcdef',
};

/** Tells whether the app's global body parsing still ignores report types. */
@Controller('probe')
class ProbeController {
    @Public()
    @Post()
    echo(@Body() body: unknown): { parsed: boolean } {
        return {
            parsed:
                typeof body === 'string' ||
                (typeof body === 'object' &&
                    body !== null &&
                    Object.keys(body).length > 0),
        };
    }
}

/** What Chromium sends for `report-uri` (trimmed to the usual fields). */
function legacyReport(overrides: Record<string, unknown> = {}) {
    return {
        'csp-report': {
            'document-uri': 'https://pos.example.com/seller/sell?q=secret-term',
            referrer: '',
            'violated-directive': 'script-src-elem',
            'effective-directive': 'script-src-elem',
            'original-policy':
                "default-src 'self'; script-src 'self'; report-uri https://api.example.com/v1/csp-report",
            disposition: 'enforce',
            'blocked-uri': 'https://evil.example.net/x.js?token=hunter2',
            'status-code': 200,
            'script-sample': 'alert("sample-must-not-be-logged")',
            ...overrides,
        },
    };
}

/** What Chromium sends for `report-to` (one Reporting API entry). */
function reportingApiEntry(blockedURL: string, effectiveDirective: string) {
    return {
        age: 12,
        type: 'csp-violation',
        url: 'https://pos.example.com/login?next=%2Fadmin',
        user_agent: 'Mozilla/5.0 HeadlessChrome',
        body: {
            blockedURL,
            disposition: 'enforce',
            documentURL: 'https://pos.example.com/login?next=%2Fadmin',
            effectiveDirective,
            originalPolicy: "default-src 'self'",
            referrer: '',
            sample: 'sample-must-not-be-logged',
            statusCode: 200,
        },
    };
}

describe('POST /v1/csp-report (e2e, #94)', () => {
    let app: INestApplication;
    let base: string;
    let throttles: { storage: Map<string, unknown> };
    let warn: jest.SpyInstance;

    function post(
        body: string,
        contentType: string,
        headers: Record<string, string> = {},
    ): Promise<Response> {
        return fetch(`${base}/csp-report`, {
            method: 'POST',
            headers: { 'content-type': contentType, ...headers },
            body,
        });
    }

    /** The CSP warn lines logged (the filter's own warnings excluded). */
    function reportLines(): string[] {
        return warn.mock.calls
            .map((call) => String(call[0]))
            .filter((line) => line.includes('CSP violation'));
    }

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [JwtModule.register({}), RequestIdModule, CspReportModule],
            controllers: [ProbeController],
            providers: [
                JWTStrategy,
                {
                    provide: TypedConfigService,
                    useValue: { get: (key: string) => CONFIG[key] },
                },
                { provide: APP_GUARD, useClass: JWTAuthGuard },
                { provide: APP_GUARD, useClass: RoleGuard },
                { provide: APP_FILTER, useClass: GlobalFilter },
            ],
        }).compile();

        app = moduleRef.createNestApplication({
            logger: false,
            bodyParser: false,
        });
        app.useGlobalPipes(createValidationPipe());
        app.use(cookieParser(String(CONFIG.COOKIE_SECRET)));
        app.enableVersioning({ defaultVersion: '1', type: VersioningType.URI });
        app.enableCors(corsOptions(FRONTEND));
        // After CORS, as in main.ts.
        useBodyParsers(app);
        await app.listen(0, '127.0.0.1');

        const { port } = app.getHttpServer().address() as AddressInfo;
        base = `http://127.0.0.1:${port}/v1`;
        throttles = app.get(getStorageToken());
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(() => {
        throttles.storage.clear();
        warn = jest
            .spyOn(Logger.prototype, 'warn')
            .mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, 'error').mockImplementation(
            () => undefined,
        );
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('takes a legacy report-uri report with no credentials: 204, one line, no query strings or samples', async () => {
        const res = await post(
            JSON.stringify(legacyReport()),
            'application/csp-report',
            { cookie: 'jwt=cookie-must-not-be-logged' },
        );

        expect(res.status).toBe(204);
        expect(await res.text()).toBe('');
        const requestId = res.headers.get('x-request-id');
        expect(reportLines()).toEqual([
            `[${requestId}] CSP violation: directive=script-src-elem blocked=https://evil.example.net/x.js document=https://pos.example.com/seller/sell`,
        ]);
        const logged = JSON.stringify(warn.mock.calls);
        for (const secret of [
            'hunter2',
            'secret-term',
            'sample-must-not-be-logged',
            'cookie-must-not-be-logged',
            'original-policy',
        ]) {
            expect(logged).not.toContain(secret);
        }
    });

    it('falls back to violated-directive when there is no effective-directive (older browsers)', async () => {
        const res = await post(
            JSON.stringify(
                legacyReport({
                    'effective-directive': undefined,
                    'violated-directive': 'style-src',
                    'blocked-uri': 'inline',
                }),
            ),
            'application/csp-report; charset=utf-8',
        );

        expect(res.status).toBe(204);
        expect(reportLines()).toEqual([
            expect.stringContaining(
                'directive=style-src blocked=inline document=',
            ),
        ]);
    });

    it('takes a Reporting API batch: one line per CSP report, other report types skipped', async () => {
        const res = await post(
            JSON.stringify([
                reportingApiEntry('eval', 'script-src'),
                {
                    type: 'deprecation',
                    url: 'https://pos.example.com/',
                    body: {},
                },
                reportingApiEntry(
                    'https://user:pw@cdn.example.org/f.woff2#x',
                    'font-src',
                ),
                'not-an-object',
            ]),
            'application/reports+json',
        );

        expect(res.status).toBe(204);
        expect(reportLines()).toEqual([
            expect.stringContaining(
                'CSP violation: directive=script-src blocked=eval document=https://pos.example.com/login',
            ),
            expect.stringContaining(
                'directive=font-src blocked=https://cdn.example.org/f.woff2 document=https://pos.example.com/login',
            ),
        ]);
        expect(JSON.stringify(warn.mock.calls)).not.toContain('pw@');
    });

    it(`logs at most ${CSP_REPORTS_LOGGED_MAX} reports of one request, then counts the rest`, async () => {
        const batch = Array.from({ length: CSP_REPORTS_LOGGED_MAX + 5 }, () =>
            reportingApiEntry('inline', 'style-src-attr'),
        );
        const res = await post(
            JSON.stringify(batch),
            'application/reports+json',
        );

        expect(res.status).toBe(204);
        const lines = reportLines();
        expect(lines).toHaveLength(CSP_REPORTS_LOGGED_MAX + 1);
        expect(lines.at(-1)).toContain('5 more in this request not logged');
    });

    it(`refuses a body over ${CSP_REPORT_MAX_BYTES} bytes with 413, logging no report`, async () => {
        const res = await post(
            JSON.stringify(
                legacyReport({
                    'script-sample': 'x'.repeat(CSP_REPORT_MAX_BYTES),
                }),
            ),
            'application/csp-report',
            { origin: FRONTEND },
        );
        const body = (await res.json()) as Record<string, unknown>;

        expect(res.status).toBe(413);
        // The parsers run after CORS, so the client can read the refusal.
        expect(res.headers.get('access-control-allow-origin')).toBe(FRONTEND);
        expect(body).toMatchObject({
            statusCode: 413,
            error: ErrorCode.HTTP_ERROR,
            details: null,
            requestId: res.headers.get('x-request-id'),
        });
        expect(reportLines()).toEqual([]);
    });

    it.each([
        [
            'not JSON',
            'application/csp-report',
            '{"csp-report": {"blocked-uri": "echo-me',
        ],
        [
            'no csp-report object',
            'application/csp-report',
            '{"blocked-uri": "echo-me"}',
        ],
        ['a JSON string', 'application/csp-report', '"echo-me"'],
        ['not an array', 'application/reports+json', '{"type": "echo-me"}'],
        ['empty', 'application/reports+json', ''],
    ])(
        'answers a malformed body (%s) with 400 and echoes nothing',
        async (_label, contentType, raw) => {
            const res = await post(raw, contentType);
            const text = await res.text();

            expect(res.status).toBe(400);
            expect(JSON.parse(text)).toMatchObject({
                error: ErrorCode.VALIDATION_INVALID_INPUT,
                message: 'Malformed CSP report',
                details: null,
            });
            expect(text).not.toContain('echo-me');
            expect(reportLines()).toEqual([]);
        },
    );

    it('answers another media type with 415', async () => {
        const res = await post(
            JSON.stringify(legacyReport()),
            'application/json',
        );

        expect(res.status).toBe(415);
        expect(((await res.json()) as { error: string }).error).toBe(
            ErrorCode.HTTP_ERROR,
        );
        expect(reportLines()).toEqual([]);
    });

    it('treats an empty Reporting API batch as nothing to log', async () => {
        const res = await post('[]', 'application/reports+json');
        expect(res.status).toBe(204);
        expect(reportLines()).toEqual([]);
    });

    it(`rate-limits per IP: ${RATE_LIMITS.cspReport.ip.limit} reports a minute, then 429`, async () => {
        const body = JSON.stringify(legacyReport());
        for (let i = 0; i < RATE_LIMITS.cspReport.ip.limit; i++) {
            expect((await post(body, 'application/csp-report')).status).toBe(
                204,
            );
        }

        const res = await post(body, 'application/csp-report');
        expect(res.status).toBe(429);
        expect(((await res.json()) as { error: string }).error).toBe(
            ErrorCode.RATE_LIMITED,
        );
        expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
        expect(reportLines()).toHaveLength(RATE_LIMITS.cspReport.ip.limit);
    });

    it("answers the Reporting API's CORS preflight from the client origin", async () => {
        const res = await fetch(`${base}/csp-report`, {
            method: 'OPTIONS',
            headers: {
                origin: FRONTEND,
                'access-control-request-method': 'POST',
                'access-control-request-headers': 'content-type',
            },
        });

        expect(res.status).toBe(204);
        expect(res.headers.get('access-control-allow-origin')).toBe(FRONTEND);
        expect(res.headers.get('access-control-allow-methods')).toContain(
            'POST',
        );
        expect(
            res.headers.get('access-control-allow-headers')?.toLowerCase(),
        ).toContain('content-type');
    });

    it('takes a cross-origin report and answers it with the CORS header', async () => {
        const res = await post(
            JSON.stringify([reportingApiEntry('inline', 'script-src-elem')]),
            'application/reports+json',
            { origin: FRONTEND },
        );

        expect(res.status).toBe(204);
        expect(res.headers.get('access-control-allow-origin')).toBe(FRONTEND);
        expect(reportLines()).toHaveLength(1);
    });

    it('leaves global body parsing alone: report media types are not parsed on other routes', async () => {
        const report = JSON.stringify(legacyReport());
        for (const type of [
            'application/csp-report',
            'application/reports+json',
        ]) {
            const res = await fetch(`${base}/probe`, {
                method: 'POST',
                headers: { 'content-type': type },
                body: report,
            });
            expect(res.status).toBe(201);
            expect(await res.json()).toEqual({ parsed: false });
        }

        const json = await fetch(`${base}/probe`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: report,
        });
        expect(await json.json()).toEqual({ parsed: true });
    });

    /**
     * body-parser's own messages quote the Content-Encoding and charset it
     * refuses; GlobalFilter answers and logs a fixed message per error
     * type instead, on this route and on every JSON route.
     */
    describe('never echoes a refused Content-Encoding or charset', () => {
        const MARK = 'echoed-header-value';
        const longEncoding = `x-${MARK}-${'a'.repeat(4000)}`;
        const report = JSON.stringify(legacyReport());

        it.each([
            [
                'the CSP route, bogus Content-Encoding',
                '/csp-report',
                {
                    'content-type': 'application/csp-report',
                    'content-encoding': longEncoding,
                },
                'Unsupported content encoding',
                'encoding.unsupported',
            ],
            [
                'the CSP route, bogus charset',
                '/csp-report',
                { 'content-type': `application/reports+json; charset=${MARK}` },
                'Unsupported charset',
                'charset.unsupported',
            ],
            [
                'a JSON route, bogus Content-Encoding',
                '/probe',
                {
                    'content-type': 'application/json',
                    'content-encoding': longEncoding,
                },
                'Unsupported content encoding',
                'encoding.unsupported',
            ],
            [
                'a JSON route, bogus charset',
                '/probe',
                { 'content-type': `application/json; charset=${MARK}` },
                'Unsupported charset',
                'charset.unsupported',
            ],
        ])(
            '%s: 415, fixed message, type logged',
            async (_label, path, headers, message, type) => {
                const res = await fetch(`${base}${path}`, {
                    method: 'POST',
                    headers,
                    body: report,
                });
                const text = await res.text();

                expect(res.status).toBe(415);
                expect(JSON.parse(text)).toMatchObject({
                    statusCode: 415,
                    error: ErrorCode.HTTP_ERROR,
                    message,
                    details: null,
                });
                expect(text.toLowerCase()).not.toContain(MARK);

                const logged = warn.mock.calls.map((call) => String(call[0]));
                expect(logged).toEqual([
                    expect.stringContaining(
                        `-> 415 ${ErrorCode.HTTP_ERROR}: body-parser ${type}`,
                    ),
                ]);
                expect(logged.join('\n').toLowerCase()).not.toContain(MARK);
                expect(reportLines()).toEqual([]);
            },
        );

        it('answers malformed JSON on a JSON route without quoting the body', async () => {
            const res = await fetch(`${base}/probe`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: `{"x": ${MARK}`,
            });
            const text = await res.text();

            expect(res.status).toBe(400);
            expect(JSON.parse(text)).toMatchObject({
                error: ErrorCode.VALIDATION_INVALID_INPUT,
                message: 'Malformed request body',
            });
            expect(text).not.toContain(MARK);
            expect(JSON.stringify(warn.mock.calls)).not.toContain(MARK);
        });
    });
});
