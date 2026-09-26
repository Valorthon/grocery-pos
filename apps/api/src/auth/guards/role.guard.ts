import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { Role } from '../types';
import { ADMIN_BYPASS_KEY, IS_PUBLIC_KEY, ROLES_KEY } from '../auth.decorator';

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

        // Fail closed (issue #61): a non-public route that states no roles
        // (a forgotten or empty @Roles()) is refused, not opened to every
        // signed-in user. "Anyone signed in" is @Roles(...ASSIGNABLE_ROLES).
        if (requiredRoles.length === 0) return false;

        if (requiredRoles.some((role: Role) => user.roles.includes(role)))
            return true;

        // ADMIN holds every role, except on a @RequireOwnRole route
        // (issue #84): there only the listed roles themselves count.
        const adminBypass =
            this.reflector.getAllAndOverride<boolean | undefined>(
                ADMIN_BYPASS_KEY,
                targets,
            ) !== false;
        return adminBypass && user.roles.includes(Role.Admin);
    }
}
