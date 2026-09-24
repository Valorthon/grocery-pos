import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../auth.decorator';
import { JWTInvalidError, Role } from '../types';

@Injectable()
export class JWTAuthGuard extends AuthGuard('jwt') {
    constructor(private reflector: Reflector) {
        super();
    }

    handleRequest<TUser = unknown>(
        err: unknown,
        user: unknown,
        info: unknown,
        context: ExecutionContext,
    ): TUser {
        const isPublic = this.reflector.getAllAndOverride<boolean>(
            IS_PUBLIC_KEY,
            [context.getHandler(), context.getClass()],
        );

        if (err || !user) {
            if (isPublic) return { roles: Role.Unauthenticated } as TUser;

            // passport-jwt reports a missing, expired or bad token through
            // `info` (user = false). `err` is only set when something broke
            // while authenticating (e.g. `validate` threw): that is a server
            // fault, not a bad token, so it must surface as-is, not as a 401.
            if (err)
                throw err instanceof Error
                    ? err
                    : new Error('Authentication failed', { cause: err });

            throw JWTInvalidError.from(info);
        }

        return user as TUser;
    }
}
