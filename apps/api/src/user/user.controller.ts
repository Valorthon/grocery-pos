import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
import { UserService } from './user.service';
import {
    ChangePasswordDto,
    CreateBulkDto,
    UpdateBulkDto,
} from './types/user.dto';
import { Roles } from '../auth/auth.decorator';
import { ASSIGNABLE_ROLES } from '@grocery-pos/contracts';
import { CurrentUser, Role } from '../auth/types';
import type { AuthUser } from '../auth/types';
import { GetAllDto } from '../product/types';

@Roles(Role.UserManager)
@Controller('users')
export class UserController {
    constructor(private service: UserService) {}

    // Any user holding at least one assignable role (issue #13: an explicit
    // list, never an empty @Roles()). A session with no roles, or only
    // legacy/unassignable ones, gets 403 here; that is intended.
    @Roles(...ASSIGNABLE_ROLES)
    @Get('/profile')
    getProfile(@CurrentUser() user: AuthUser) {
        return {
            username: user.username,
            roles: user.roles,
        };
    }

    @Get()
    async getAll(@Query() dto: GetAllDto) {
        const data = await this.service.getAll(dto);
        return data;
    }

    // Any user holding at least one assignable role (cashiers included);
    // empty or legacy-only roles get 403, as on /profile. The current
    // password is required.
    @Roles(...ASSIGNABLE_ROLES)
    @Patch('/me/password')
    async changeOwnPassword(
        @CurrentUser() user: AuthUser,
        @Body() dto: ChangePasswordDto,
    ) {
        await this.service.changeOwnPassword(user, dto);
    }

    @Patch()
    async update(@CurrentUser() user: AuthUser, @Body() dto: UpdateBulkDto) {
        await this.service.update(user, dto);
    }

    @Post()
    async create(@CurrentUser() user: AuthUser, @Body() dto: CreateBulkDto) {
        await this.service.create(user, dto);
    }
}
