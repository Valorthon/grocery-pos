import { Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CookieService } from '../common/utils/cookie/cookie.service';
import { LoginAttemptLimiter } from './rate-limit/rate-limit';

/**
 * Logout edge cases the e2e flow (auth.e2e.spec.ts) does not reach: the
 * refresh token cannot be revoked. Logout must still clear every cookie,
 * or the browser keeps a session the user asked to end.
 */
describe('AuthController.logout', () => {
    let service: { logout: jest.Mock };
    let cookies: {
        removeJwt: jest.Mock;
        removeRefresh: jest.Mock;
        removeDummy: jest.Mock;
    };
    let controller: AuthController;
    const res = {} as Response;

    function request(refresh: unknown): Request {
        return { signedCookies: { refresh } } as unknown as Request;
    }

    function expectCookiesCleared() {
        expect(cookies.removeJwt).toHaveBeenCalledWith(res);
        expect(cookies.removeRefresh).toHaveBeenCalledWith(res);
        expect(cookies.removeDummy).toHaveBeenCalledWith(res);
    }

    beforeEach(() => {
        service = { logout: jest.fn() };
        cookies = {
            removeJwt: jest.fn(),
            removeRefresh: jest.fn(),
            removeDummy: jest.fn(),
        };
        controller = new AuthController(
            service as unknown as AuthService,
            cookies as unknown as CookieService,
            {} as LoginAttemptLimiter,
        );
    });

    it('revokes the refresh token it names, then clears the cookies', async () => {
        const refreshId = new Types.ObjectId().toString();
        await controller.logout(res, request(JSON.stringify({ refreshId })));
        expect(service.logout).toHaveBeenCalledWith(refreshId);
        expectCookiesCleared();
    });

    it('still clears the cookies (and does not fail) when revoking fails', async () => {
        // A database hiccup must not leave the browser signed in.
        const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => {});
        service.logout.mockRejectedValue(new Error('db down'));
        const refreshId = new Types.ObjectId().toString();

        await expect(
            controller.logout(res, request(JSON.stringify({ refreshId }))),
        ).resolves.toBeUndefined();
        expectCookiesCleared();
        expect(warn).toHaveBeenCalledWith(
            'Could not revoke refresh token on logout',
            expect.any(Error),
        );
    });

    it.each([
        ['no cookie', undefined],
        ['a tampered cookie (cookie-parser gives false)', false],
        ['a cookie that is not JSON', 'not json'],
        ['an id that is not an ObjectId', JSON.stringify({ refreshId: 'x' })],
        ['no id', JSON.stringify({})],
    ])(
        'with %s: revokes nothing, clears the cookies',
        async (_label, cookie) => {
            await controller.logout(res, request(cookie));
            expect(service.logout).not.toHaveBeenCalled();
            expectCookiesCleared();
        },
    );
});
