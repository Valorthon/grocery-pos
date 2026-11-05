import { Body, Controller, Get, Patch } from '@nestjs/common';
import { Roles } from '../auth/auth.decorator';
import { CurrentUser, Role, type AuthUser } from '../auth/types';
import { ASSIGNABLE_ROLES, type StoreSettings } from '@grocery-pos/contracts';
import { SettingsService } from './settings.service';
import { SettingsAdminService } from './settings-admin.service';
import { UpdateSettingsDto } from './settings.dto';
@Controller('settings')
export class SettingsController {
    constructor(
        private settings: SettingsService,
        private admin: SettingsAdminService,
    ) {}
    @Get()
    @Roles(...ASSIGNABLE_ROLES)
    async get(): Promise<StoreSettings> {
        return this.settings.read();
    }
    @Patch()
    @Roles(Role.Admin)
    async update(
        @CurrentUser() actor: AuthUser,
        @Body() dto: UpdateSettingsDto,
    ): Promise<StoreSettings> {
        return this.admin.update(actor, dto);
    }
}
