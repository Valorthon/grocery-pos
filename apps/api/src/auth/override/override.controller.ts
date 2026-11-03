import { Body, Controller, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
    Role,
    type AuthUser,
    type ManagerOverrideResponse,
} from '@grocery-pos/contracts';
import { Roles } from '../auth.decorator';
import { CurrentUser } from '../types';
import {
    LoginAttemptLimiter,
    LoginRateLimit,
    clientIp,
} from '../rate-limit/rate-limit';
import {
    ManagerOverrideDto,
    OverrideUserParamDto,
    SetOverridePinDto,
} from './override.dto';
import { ManagerOverrideService } from './override.service';

@Controller('auth/override')
export class ManagerOverrideController {
    constructor(
        private service: ManagerOverrideService,
        private limiter: LoginAttemptLimiter,
    ) {}

    @Roles(Role.Seller, Role.Admin)
    @LoginRateLimit()
    @Post()
    async approve(
        @CurrentUser() user: AuthUser,
        @Body() dto: ManagerOverrideDto,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ): Promise<ManagerOverrideResponse> {
        await this.limiter.hit(res, clientIp(req), dto.username, 'override');
        return this.service.issue(user, dto);
    }
}

@Roles(Role.Admin)
@Controller('users')
export class OverridePinController {
    constructor(private service: ManagerOverrideService) {}

    @Patch(':id/override-pin')
    async setPin(
        @CurrentUser() user: AuthUser,
        @Param() { id }: OverrideUserParamDto,
        @Body() dto: SetOverridePinDto,
    ): Promise<void> {
        await this.service.setPin(user, id, dto);
    }
}
