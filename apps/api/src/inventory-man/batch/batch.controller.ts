import { Controller, Get, Query } from '@nestjs/common';
import {
    IsBoolean,
    IsInt,
    IsMongoId,
    IsOptional,
    Max,
    Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
    EXPIRY_LIMITS,
    PAGINATION,
    type InventoryBatchView,
    type Paginated,
} from '@grocery-pos/contracts';
import { Roles } from '../../auth/auth.decorator';
import { Role } from '../../auth/types';
import { InventoryBatchService } from './batch.service';
export class BatchQuery {
    @IsInt()
    @Min(1)
    @Max(PAGINATION.PAGE_MAX)
    page: number = 1;
    @IsInt()
    @Min(1)
    @Max(PAGINATION.LIMIT_MAX)
    limit: number = 25;
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(EXPIRY_LIMITS.DAYS_MAX)
    days?: number;
    @IsOptional()
    @IsMongoId()
    product?: string;
    @IsOptional()
    @IsBoolean()
    @Transform(({ obj, key }) => {
        const raw = (obj as Record<string, unknown>)[key];
        return raw === 'true' ? true : raw === 'false' ? false : raw;
    })
    expiring?: boolean;
}
@Roles(Role.Restocker, Role.Adjuster)
@Controller('inventories')
export class InventoryBatchController {
    constructor(private service: InventoryBatchService) {}
    @Get('expiring')
    async expiring(
        @Query() dto: BatchQuery,
    ): Promise<Paginated<InventoryBatchView>> {
        return this.service.list({ ...dto, expiring: true });
    }
    @Get('batches')
    async batches(
        @Query() dto: BatchQuery,
    ): Promise<Paginated<InventoryBatchView>> {
        return this.service.list(dto);
    }
}
