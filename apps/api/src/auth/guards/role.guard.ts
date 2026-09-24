import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { Role } from '../types';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../auth.decorator';

interface RequestWithUser {
    user?: {
        roles: Role[];
    };
}

@Injectable()
export class RoleGuard implements CanActivate {
    constructor(private reflector: Reflector) {}

    canActivate(
        context: ExecutionContext,
    ): boolean | Promise<boolean> | Observable<boolean> {
        const targets = [context.getHandler(), context.getClass()];

        // Public routes (login, refresh, logout, health) are reachable by
        // anyone, signed in or not, so no role applies to them.
        if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets))
            return true;

        const request = context.switchToHttp().getRequest<RequestWithUser>();
        const user = request.user;

        if (!user) return false;

        const requiredRoles: Role[] =
            this.reflector.getAllAndOverride(ROLES_KEY, targets) ?? [];

        if (requiredRoles.length === 0) return true;

        return (
            user.roles.includes(Role.Admin) ||
            requiredRoles.some((role: Role) => user.roles.includes(role))
        );
    }
}
