import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
import { UserService } from './user.service';
import {
    ChangePasswordDto,
    CreateBulkDto,
    GetAllDto,
    UpdateBulkDto,
} from './types/user.dto';
import { Roles } from '../auth/auth.decorator';
import { ASSIGNABLE_ROLES } from '@grocery-pos/contracts';
import { CurrentUser, Role } from '../auth/types';
import type { AuthUser } from '../auth/types';
import { RefreshTokenService } from '../auth/refresh-token/refresh-token.service';
import { PasswordChangeRateLimit } from '../auth/rate-limit/rate-limit';

@Roles(Role.UserManager)
@Controller('users')
export class UserController {
    constructor(
        private service: UserService,
        private refreshTokens: RefreshTokenService,
    ) {}

    // Any user holding at least one assignable role (issue #13: an explicit
    // list, never an empty @Roles()). A session with no roles, or only
    // legacy/unassignable ones, gets 403 here; that is intended.
    @Roles(...ASSIGNABLE_ROLES)
    @Get('/profile')
    getProfile(@CurrentUser() user: AuthUser) {
        return {
            // The client keys this cashier's saved basket by it (#23).
            userId: user.userId,
            username: user.username,
            roles: user.roles,
        };
    }

    @Get()
    async getAll(@Query() dto: GetAllDto) {
        const data = await this.service.getAll(dto);
        return data;
    }

    /**
     * Any user holding at least one assignable role (cashiers included);
     * empty or legacy-only roles get 403, as on /profile. The current
     * password is required. Rate limited against guessing it with a stolen session.
     *
     * Ends the user's OTHER sessions: every refresh token outside the
     * caller's own session (`sid` in the access token). An access token
     * issued before sessions had ids carries no `sid`; then every session
     * ends, the caller's included, and they sign in again once their
     * access token expires.
     */
    @Roles(...ASSIGNABLE_ROLES)
    @PasswordChangeRateLimit()
    @Patch('/me/password')
    async changeOwnPassword(
        @CurrentUser() user: AuthUser,
        @Body() dto: ChangePasswordDto,
    ) {
        await this.service.changeOwnPassword(user, dto);
        await this.refreshTokens.revokeAllForUser(user.userId, {
            keepSid: user.sid,
        });
    }

    /**
     * Revokes every session of the users deactivated, given different roles
     * or given a new password, after the change has committed. Their access
     * tokens stay valid until they expire (`JWT_EXPIRY_S`); user management
     * itself re-checks the actor in the database, so that window grants no
     * user-management power.
     */
    @Patch()
    async update(@CurrentUser() user: AuthUser, @Body() dto: UpdateBulkDto) {
        const affected = await this.service.update(user, dto);
        await this.refreshTokens.revokeAllForUsers(affected);
    }

    @Post()
    async create(@CurrentUser() user: AuthUser, @Body() dto: CreateBulkDto) {
        await this.service.create(user, dto);
    }
}
