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

    it('wraps a non-Error strategy failure in an Error that keeps it as the cause', () => {
        // Still a server fault (a 500 with a stack in the log), never a 401
        // that would sign the user out over a bug.
        const raw = { reason: 'strategy threw a plain object' };

        const err = thrownBy(() =>
            guard.handleRequest(raw, false, undefined, PROTECTED),
        ) as unknown as Error;

        expect(err).toBeInstanceOf(Error);
        expect(err).not.toBeInstanceOf(AppError);
        expect(err.cause).toBe(raw);
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

    it('gives an anonymous caller on a public route an array of roles', () => {
        const ctx = contextFor(AuthController, 'login');

        const user = guard.handleRequest<{ roles: unknown }>(
            null,
            false,
            undefined,
            ctx,
        );

        expect(user).toEqual({ roles: [Role.Unauthenticated] });
        expect(Array.isArray(user.roles)).toBe(true);
    });
});
