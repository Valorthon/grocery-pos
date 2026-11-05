import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
} from '@nestjs/common';
import { Roles } from '../auth/auth.decorator';
import { CurrentUser, Role, type AuthUser } from '../auth/types';
import { asJson } from '../common/wire';
import type {
    Paginated,
    ProductCostView,
    SupplierView,
} from '@grocery-pos/contracts';
import {
    SupplierFieldsDto,
    SupplierIdDto,
    SupplierQueryDto,
    UpdateSupplierDto,
    ProductCostsDto,
} from './supplier.dto';
import { SupplierService } from './supplier.service';

@Roles(Role.Restocker)
@Controller('suppliers')
export class SupplierController {
    constructor(private service: SupplierService) {}
    @Get('costs') async costs(
        @Query() dto: ProductCostsDto,
        @CurrentUser() user: AuthUser,
    ): Promise<ProductCostView[]> {
        return this.service.costs(
            dto.products,
            user.roles.includes(Role.Admin),
        );
    }
    @Get() async list(
        @Query() dto: SupplierQueryDto,
    ): Promise<Paginated<SupplierView>> {
        return asJson(await this.service.list(dto));
    }
    @Post() async create(
        @Body() dto: SupplierFieldsDto,
    ): Promise<SupplierView> {
        return asJson(await this.service.create(dto));
    }
    @Patch(':id') async update(
        @Param() p: SupplierIdDto,
        @Body() dto: UpdateSupplierDto,
    ): Promise<SupplierView> {
        return asJson(await this.service.update(p.id, dto));
    }
    @Delete(':id') async remove(@Param() p: SupplierIdDto): Promise<void> {
        await this.service.remove(p.id);
    }
}
