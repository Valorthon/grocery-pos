import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
import { UserService } from './user.service';
import { CreateBulkDto, UpdateBulkDto } from './types/user.dto';
import { Roles } from '../auth/auth.decorator';
import { CurrentUser, Role } from '../auth/types';
import type { AuthUser } from '../auth/types';
import { GetAllDto } from '../product/types';

@Roles(Role.UserManager)
@Controller('users')
export class UserController {
    constructor(private service: UserService) {}

    // Empty Roles() allow all authenticated users to access the endpoint
    @Roles()
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

    @Patch()
    async update(@Body() dto: UpdateBulkDto) {
        await this.service.update(dto);
    }

    @Post()
    async create(@Body() dto: CreateBulkDto) {
        await this.service.create(dto);
    }
}
