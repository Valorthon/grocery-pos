import {
    Body,
    Controller,
    Get,
    Param,
    Patch,
    Post,
    Query,
} from '@nestjs/common';
import { ProductService } from './product.service';
import { Roles } from '../auth/auth.decorator';
import { CurrentUser, Role, type AuthUser } from '../auth/types';
import {
    EnsureValidDto,
    GetAllDto,
    GetDto,
    MatchesDto,
    NewProductsDto,
    UpdateBulkDto,
} from './types';
import type {
    Paginated,
    ProductMatch,
    ProductView,
} from '@grocery-pos/contracts';
import { asJson } from '../common/wire';

/**
 * Effective roles per route (handler @Roles replaces the class's; Admin
 * passes every check):
 *
 *   GET   /products/matches      Restocker, Adjuster, Seller
 *   GET   /products/ensureValid  Restocker
 *   GET   /products/:EAN         Restocker, Adjuster, Seller
 *   PATCH /products              Restocker; a batch that sets `price` is
 *                                Admin only (403
 *                                PRODUCT_PRICE_CHANGE_FORBIDDEN, issue #13)
 *   GET   /products              Restocker, Adjuster
 *   POST  /products/bulk         Restocker (a new product's first price is
 *                                not a price change)
 *
 * Adding and editing products is Restocker and Admin only (#83); an
 * Adjuster only looks products up, to pick them for an adjustment.
 *
 * product.access.e2e.spec.ts pins this table.
 */
@Roles(Role.Restocker, Role.Adjuster)
@Controller('products')
export class ProductController {
    constructor(private service: ProductService) {}

    // The register's name / partial-barcode search.
    @Roles(Role.Restocker, Role.Adjuster, Role.Seller)
    @Get('matches')
    async getMatches(@Query() dto: MatchesDto): Promise<ProductMatch[]> {
        return await this.service.getMatches(dto);
    }

    @Roles(Role.Restocker)
    @Get('ensureValid')
    async ensureValid(@Query() dto: EnsureValidDto): Promise<void> {
        await this.service.ensureValid(dto);
    }

    @Roles(Role.Restocker, Role.Adjuster, Role.Seller)
    @Get(':EAN')
    async getByBarcode(@Param() dto: GetDto): Promise<ProductView> {
        return asJson(await this.service.getByBarcode(dto));
    }

    // Non-price fields: Restocker. `price`: Admin only; the whole batch is a
    // 403 otherwise (see assertMayChangePrices).
    @Roles(Role.Restocker)
    @Patch()
    async update(
        @CurrentUser() user: AuthUser,
        @Body() dto: UpdateBulkDto,
    ): Promise<void> {
        await this.service.update(user, dto);
    }

    @Get()
    async getAll(@Query() dto: GetAllDto): Promise<Paginated<ProductView>> {
        return asJson(await this.service.getAll(dto));
    }

    @Roles(Role.Restocker)
    @Post('bulk')
    async addMany(
        @CurrentUser() user: AuthUser,
        @Body() dto: NewProductsDto,
    ): Promise<void> {
        await this.service.addMany(user, dto);
    }
}
