import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
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

        Logger.log({ isPublic, err, user });

        if (err || !user) {
            if (isPublic) return { roles: Role.Unauthenticated } as TUser;

            throw new JWTInvalidError();
        }

        return user as TUser;
    }
}
