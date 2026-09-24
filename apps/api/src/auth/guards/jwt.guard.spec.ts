import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JsonWebTokenError, TokenExpiredError } from '@nestjs/jwt';
import { JWTAuthGuard } from './jwt.guard';
import { JWTInvalidError, Role } from '../types';
import { AuthController } from '../auth.controller';
import { SalesController } from '../../sales/sales.controller';
import { AppError, ErrorCode } from '../../common/errors';

function contextFor(
    controller: { prototype: object },
    handler: string,
): ExecutionContext {
    return {
        getHandler: () =>
            (controller.prototype as Record<string, unknown>)[handler],
        getClass: () => controller,
    } as unknown as ExecutionContext;
}

const PROTECTED = contextFor(SalesController, 'sell');

function thrownBy(fn: () => unknown): AppError {
    try {
        fn();
    } catch (err) {
        return err as AppError;
    }
    throw new Error('expected a throw');
}

describe('JWTAuthGuard.handleRequest', () => {
    const guard = new JWTAuthGuard(new Reflector());

    it('rejects an expired token with 401 AUTH_TOKEN_EXPIRED', () => {
        const info = new TokenExpiredError('jwt expired', new Date(0));

        const err = thrownBy(() =>
            guard.handleRequest(null, false, info, PROTECTED),
        );

        expect(err).toBeInstanceOf(JWTInvalidError);
        expect(err).toBeInstanceOf(AppError);
        expect(err.statusCode).toBe(401);
        expect(err.code).toBe(ErrorCode.AUTH_TOKEN_EXPIRED);
    });

    it.each([
        ['missing', new Error('No auth token')],
        ['garbage', new JsonWebTokenError('jwt malformed')],
        ['badly signed', new JsonWebTokenError('invalid signature')],
        ['unexplained', undefined],
    ])('rejects a %s token with 401 AUTH_INVALID_TOKEN', (_label, info) => {
        const err = thrownBy(() =>
            guard.handleRequest(null, false, info, PROTECTED),
        );

        expect(err.statusCode).toBe(401);
        expect(err.code).toBe(ErrorCode.AUTH_INVALID_TOKEN);
    });

    it('rethrows a strategy error as-is instead of calling it a bad token', () => {
        const boom = new Error('validate blew up');

        const err = thrownBy(() =>
            guard.handleRequest(boom, false, undefined, PROTECTED),
        );

        expect(err).toBe(boom);
        expect(err).not.toBeInstanceOf(AppError);
    });

    it('passes the decoded user through on a valid token', () => {
        const user = { userId: 'u1', username: 'a', roles: [Role.Seller] };

        expect(guard.handleRequest(null, user, undefined, PROTECTED)).toBe(
            user,
        );
    });

    it.each(['login', 'refresh', 'logout'])(
        'lets an expired or missing token through on public /auth/%s',
        (handler) => {
            const ctx = contextFor(AuthController, handler);
            const expired = new TokenExpiredError('jwt expired', new Date(0));

            expect(() =>
                guard.handleRequest(null, false, expired, ctx),
            ).not.toThrow();
            expect(() =>
                guard.handleRequest(null, false, undefined, ctx),
            ).not.toThrow();
        },
    );
});
