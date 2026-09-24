import { SetMetadata } from '@nestjs/common';
import { Role } from './types';

export const IS_PUBLIC_KEY = 'isPublic';
/**
 * Marks a route (or controller) as callable whether or not the caller is
 * signed in: `JWTAuthGuard` lets a missing or bad token through and
 * `RoleGuard` skips its role check. Do not combine with `@Roles`.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
