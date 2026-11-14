import { ForbiddenException, type INestApplication } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { TypedConfigService } from '../typed-config/typed-config.service';
import {
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
            req({ host: 'localhost:1443' }),
            res,
            next,
        );
        expect(next).toHaveBeenCalledWith(undefined);
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
