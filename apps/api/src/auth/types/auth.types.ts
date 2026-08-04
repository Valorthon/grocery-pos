import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '@grocery-pos/shared';

export { Role };

export class JWTPayload {
    userId!: string;
    username!: string;
    roles!: Role[];
}

export type AuthUser = JWTPayload;

interface RequestWithUser {
    user: AuthUser;
}

export const CurrentUser = createParamDecorator(
    (data: unknown, ctx: ExecutionContext): AuthUser => {
        const req = ctx.switchToHttp().getRequest<RequestWithUser>();
        return req.user;
    },
);
