import { ForbiddenException, type INestApplication } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { TypedConfigService } from '../typed-config/typed-config.service';
import {
    ErrorCode,
    WIRE_VERSION,
    WIRE_VERSION_HEADER,
} from '@grocery-pos/contracts';
import { ConflictError } from '../errors/app-error';
import {
    isOutdatedClient,
    localAccessCheck,
    localAccessMiddleware,
    useLocalAccess,
} from './local-access';

const FRONTEND = 'https://localhost:1443';

function req(
    headers: Record<string, string>,
    method = 'POST',
    url = '/v1/auth/login',
): Request {
    return { headers, method, url, originalUrl: url } as unknown as Request;
}

describe('localAccessCheck (#358)', () => {
    const check = localAccessCheck(FRONTEND);

    it('accepts the proxy host, with or without the same Origin', () => {
        expect(check(req({ host: 'localhost:1443' }))).toBeNull();
        expect(check(req({ host: 'LOCALHOST:1443' }))).toBeNull();
        expect(
            check(req({ host: 'localhost:1443', origin: FRONTEND })),
        ).toBeNull();
    });

    it.each([
        [{}],
        [{ host: '127.0.0.1:13000' }],
        [{ host: 'localhost:13000' }],
        [{ host: 'localhost' }],
        [{ host: 'rebind.example:1443' }],
    ])('refuses the host in %j', (headers) => {
        expect(check(req(headers))).toBe('Unexpected host.');
    });

    it.each([
        'http://localhost:1443',
        'https://localhost:1444',
        'https://evil.example',
        'null',
    ])('refuses the Origin %s', (origin) => {
        expect(check(req({ host: 'localhost:1443', origin }))).toBe(
            'Unexpected origin.',
        );
    });

    it.each([
        ['GET', '/v1/health/live'],
        ['HEAD', '/v1/health/ready'],
        ['GET', '/v1/health'],
    ])('lets %s %s through from any host', (method, url) => {
        expect(check(req({ host: '127.0.0.1:13000' }, method, url))).toBeNull();
    });

    it.each([
        ['POST', '/v1/health/live'],
        ['GET', '/v1/healthy'],
        ['GET', '/v1/users'],
    ])('still checks %s %s', (method, url) => {
        expect(check(req({ host: '127.0.0.1:13000' }, method, url))).toBe(
            'Unexpected host.',
        );
    });
});

describe('localAccessMiddleware', () => {
    const res = {} as Response;

    it('passes a ForbiddenException on for a refusal', () => {
        const next = jest.fn();
        localAccessMiddleware(FRONTEND)(req({ host: 'evil' }), res, next);
        expect(next).toHaveBeenCalledWith(expect.any(ForbiddenException));
    });

    it('calls next() plainly for the proxy host', () => {
        const next = jest.fn();
        localAccessMiddleware(FRONTEND)(
            req({
                host: 'localhost:1443',
                [WIRE_VERSION_HEADER]: String(WIRE_VERSION),
            }),
            res,
            next,
        );
        expect(next).toHaveBeenCalledWith(undefined);
    });
});

describe('stale clients after an upgrade (#364)', () => {
    const res = {} as Response;
    const host = { host: 'localhost:1443' };

    it('passes only the current wire version', () => {
        expect(
            isOutdatedClient(
                req({ ...host, [WIRE_VERSION_HEADER]: String(WIRE_VERSION) }),
            ),
        ).toBe(false);
        // No single-pc client predates the header: missing is outdated.
        expect(isOutdatedClient(req(host))).toBe(true);
        // A duplicated header (Node gives an array or a joined value).
        const twice = req(host);
        (twice.headers as Record<string, unknown>)[WIRE_VERSION_HEADER] = [
            String(WIRE_VERSION),
            String(WIRE_VERSION),
        ];
        expect(isOutdatedClient(twice)).toBe(true);
        expect(
            isOutdatedClient(
                req({
                    ...host,
                    [WIRE_VERSION_HEADER]: `${WIRE_VERSION}, ${WIRE_VERSION}`,
                }),
            ),
        ).toBe(true);
    });

    it('exempts health probes and the browser CSP reports', () => {
        expect(isOutdatedClient(req(host, 'GET', '/v1/health/ready'))).toBe(
            false,
        );
        expect(isOutdatedClient(req(host, 'HEAD', '/v1/health/live'))).toBe(
            false,
        );
        expect(isOutdatedClient(req(host, 'POST', '/v1/csp-report'))).toBe(
            false,
        );
        expect(isOutdatedClient(req(host, 'POST', '/v1/health/ready'))).toBe(
            true,
        );
        expect(isOutdatedClient(req(host, 'POST', '/v1/offline/sync'))).toBe(
            true,
        );
    });

    it.each(['0', String(WIRE_VERSION + 1), '', 'x', undefined])(
        'refuses wire version %j with 409 CLIENT_OUTDATED before the body',
        (sent) => {
            const next = jest.fn();
            localAccessMiddleware(FRONTEND)(
                req(
                    sent === undefined
                        ? host
                        : { ...host, [WIRE_VERSION_HEADER]: sent },
                    'POST',
                    '/v1/offline/sync',
                ),
                res,
                next,
            );
            const [error] = next.mock.calls[0] as [ConflictError];
            expect(error).toBeInstanceOf(ConflictError);
            expect(error.code).toBe(ErrorCode.CLIENT_OUTDATED);
            expect(error.statusCode).toBe(409);
        },
    );

    it('lets health probes through whatever they send', () => {
        const next = jest.fn();
        localAccessMiddleware(FRONTEND)(
            req(
                { ...host, [WIRE_VERSION_HEADER]: '0' },
                'GET',
                '/v1/health/ready',
            ),
            res,
            next,
        );
        expect(next).toHaveBeenCalledWith(undefined);
    });

    it('a foreign host is still a 403 first', () => {
        const next = jest.fn();
        localAccessMiddleware(FRONTEND)(
            req({ host: 'evil', [WIRE_VERSION_HEADER]: '0' }),
            res,
            next,
        );
        expect(next).toHaveBeenCalledWith(expect.any(ForbiddenException));
    });
});

describe('useLocalAccess', () => {
    function app(env: Record<string, string> | null) {
        const use = jest.fn();
        const get = jest.fn(() => {
            if (!env) throw new Error('no provider');
            return {
                get: (key: string) => env[key],
            } as unknown as TypedConfigService;
        });
        return { app: { use, get } as unknown as INestApplication, use };
    }

    it('installs the check in single-pc', () => {
        const a = app({ APP_ENV: 'single-pc', FRONTEND_URL: FRONTEND });
        useLocalAccess(a.app);
        expect(a.use).toHaveBeenCalledTimes(1);
    });

    it.each(['prod', 'stage', 'dev', 'test'])('installs nothing in %s', (e) => {
        const a = app({ APP_ENV: e, FRONTEND_URL: 'https://pos.example.com' });
        useLocalAccess(a.app);
        expect(a.use).not.toHaveBeenCalled();
    });

    it('installs nothing without a config service', () => {
        const a = app(null);
        useLocalAccess(a.app);
        expect(a.use).not.toHaveBeenCalled();
    });
});
