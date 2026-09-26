import { Controller, Get, Query } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { Roles } from '../../auth/auth.decorator';
import { Role } from '../../auth/types';
import { GetAllDto } from './types';
import type { InventoryRow, Paginated } from '@grocery-pos/contracts';
import { asJson } from '../../common/wire';

@Roles(Role.Restocker, Role.Adjuster)
@Controller('inventories')
export class InventoryController {
    constructor(private service: InventoryService) {}

    @Get()
    async getAll(@Query() dto: GetAllDto): Promise<Paginated<InventoryRow>> {
        return asJson(await this.service.getAll(dto));
    }
}
