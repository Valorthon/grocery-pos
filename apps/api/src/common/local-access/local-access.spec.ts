import { ForbiddenException } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { TypedConfigService } from '../typed-config/typed-config.service';
import { localAccessCheck, LocalAccessMiddleware } from './local-access';

const FRONTEND = 'https://localhost:1443';

function req(headers: Record<string, string>): Request {
    return { headers } as unknown as Request;
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
});

describe('LocalAccessMiddleware', () => {
    function middleware(env: Record<string, string>) {
        return new LocalAccessMiddleware({
            get: (key: string) => env[key],
        } as unknown as TypedConfigService);
    }
    const res = {} as Response;

    it('throws a 403 for a foreign host in single-pc', () => {
        const next = jest.fn();
        expect(() =>
            middleware({ APP_ENV: 'single-pc', FRONTEND_URL: FRONTEND }).use(
                req({ host: 'evil.example' }),
                res,
                next,
            ),
        ).toThrow(ForbiddenException);
        expect(next).not.toHaveBeenCalled();
    });

    it('passes the proxy host in single-pc', () => {
        const next = jest.fn();
        middleware({ APP_ENV: 'single-pc', FRONTEND_URL: FRONTEND }).use(
            req({ host: 'localhost:1443' }),
            res,
            next,
        );
        expect(next).toHaveBeenCalled();
    });

    it.each(['prod', 'stage', 'dev', 'test'])('does nothing in %s', (env) => {
        const next = jest.fn();
        middleware({
            APP_ENV: env,
            FRONTEND_URL: 'https://pos.example.com',
        }).use(req({ host: 'api.example.com', origin: 'x' }), res, next);
        expect(next).toHaveBeenCalled();
    });
});
