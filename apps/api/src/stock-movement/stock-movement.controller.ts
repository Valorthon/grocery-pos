import { Controller, Get, Param, Query } from '@nestjs/common';
import {
    Role,
    type Paginated,
    type StockMovementView,
    type StockIntegrityView,
} from '@grocery-pos/contracts';
import { Roles } from '../auth/auth.decorator';
import { StockMovementService } from './stock-movement.service';
import {
    StockMovementProductDto,
    StockMovementQueryDto,
} from './stock-movement.dto';
@Roles(Role.Restocker, Role.Adjuster)
@Controller('products')
export class StockMovementController {
    constructor(private service: StockMovementService) {}
    @Get(':id/movements')
    list(
        @Param() dto: StockMovementProductDto,
        @Query() query: StockMovementQueryDto,
    ): Promise<Paginated<StockMovementView>> {
        return this.service.list(dto.id, query);
    }
    @Get(':id/movements/integrity')
    integrity(
        @Param() dto: StockMovementProductDto,
    ): Promise<StockIntegrityView> {
        return this.service.integrity(dto.id);
    }
}
