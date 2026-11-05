import {
    Body,
    Controller,
    Get,
    Headers,
    Param,
    Patch,
    Post,
    Query,
} from '@nestjs/common';
import {
    Role,
    StockCountStatus,
    type AuthUser,
    type Paginated,
    type StockCountView,
} from '@grocery-pos/contracts';
import { Roles } from '../auth/auth.decorator';
import { CurrentUser } from '../auth/types';
import { StockCountService } from './stock-count.service';
import {
    CreateStockCountDto,
    SaveStockCountDto,
    StockCountIdDto,
    StockCountQueryDto,
    StockCountVersionDto,
} from './stock-count.dto';
@Roles(Role.Adjuster)
@Controller('stock-counts')
export class StockCountController {
    constructor(private service: StockCountService) {}
    @Get() list(
        @Query() dto: StockCountQueryDto,
    ): Promise<Paginated<StockCountView>> {
        return this.service.list(dto);
    }
    @Get(':id') get(@Param() { id }: StockCountIdDto): Promise<StockCountView> {
        return this.service.get(id);
    }
    @Post() create(
        @CurrentUser() actor: AuthUser,
        @Body() dto: CreateStockCountDto,
    ): Promise<StockCountView> {
        return this.service.create(actor, dto);
    }
    @Patch(':id') save(
        @CurrentUser() actor: AuthUser,
        @Param() { id }: StockCountIdDto,
        @Body() dto: SaveStockCountDto,
    ): Promise<StockCountView> {
        return this.service.save(actor, id, dto);
    }
    @Post(':id/submit') submit(
        @CurrentUser() actor: AuthUser,
        @Param() { id }: StockCountIdDto,
        @Body() dto: StockCountVersionDto,
    ): Promise<StockCountView> {
        return this.service.transition(
            actor,
            id,
            dto.version,
            StockCountStatus.SUBMITTED,
        );
    }
    @Post(':id/cancel') cancel(
        @CurrentUser() actor: AuthUser,
        @Param() { id }: StockCountIdDto,
        @Body() dto: StockCountVersionDto,
    ): Promise<StockCountView> {
        return this.service.transition(
            actor,
            id,
            dto.version,
            StockCountStatus.CANCELLED,
        );
    }
    @Post(':id/approve') approve(
        @CurrentUser() actor: AuthUser,
        @Param() { id }: StockCountIdDto,
        @Body() dto: StockCountVersionDto,
        @Headers('x-manager-approval') token?: string,
    ): Promise<StockCountView> {
        return this.service.approve(actor, id, dto.version, token);
    }
}
