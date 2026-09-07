import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser } from '@grocery-pos/contracts';

export { Role } from '@grocery-pos/contracts';
export type { JWTPayload, AuthUser } from '@grocery-pos/contracts';

interface RequestWithUser {
    user: AuthUser;
}

export const CurrentUser = createParamDecorator(
    (data: unknown, ctx: ExecutionContext): AuthUser => {
        const req = ctx.switchToHttp().getRequest<RequestWithUser>();
        return req.user;
    },
);
