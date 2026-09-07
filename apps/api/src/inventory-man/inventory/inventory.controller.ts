import { Controller, Get, Query } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { Roles } from '../../auth/auth.decorator';
import { Role } from '../../auth/types';
import { GetAllDto } from './types';

@Roles(Role.Restocker, Role.Adjuster)
@Controller('inventories')
export class InventoryController {
    constructor(private service: InventoryService) {}

    @Get()
    async getAll(@Query() dto: GetAllDto) {
        const data = await this.service.getAll(dto);
        return data;
    }
}
