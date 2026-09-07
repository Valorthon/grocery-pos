import {
    CanActivate,
    ExecutionContext,
    Injectable,
    Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { Role } from '../types';
import { ROLES_KEY } from '../auth.decorator';

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
        const request = context.switchToHttp().getRequest<RequestWithUser>();
        const user = request.user;
        Logger.log({ user });

        if (!user) return false;

        const requiredRoles: Role[] =
            this.reflector.getAllAndOverride(ROLES_KEY, [
                context.getHandler(),
                context.getClass(),
            ]) ?? [];

        Logger.log({ requiredRoles });

        if (requiredRoles.length === 0) return true;

        return (
            user.roles.includes(Role.Admin) ||
            requiredRoles.some((role: Role) => user.roles.includes(role))
        );
    }
}
