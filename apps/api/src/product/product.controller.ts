import {
    Body,
    Controller,
    Get,
    Logger,
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

/**
 * Effective roles per route (handler @Roles replaces the class's; Admin
 * passes every check):
 *
 *   GET   /products/matches      Restocker, Adjuster, Seller
 *   GET   /products/ensureValid  Restocker, Adjuster
 *   GET   /products/:EAN         Restocker, Adjuster, Seller
 *   PATCH /products              Restocker, Adjuster; a batch that sets
 *                                `price` is Admin only (403
 *                                PRODUCT_PRICE_CHANGE_FORBIDDEN, issue #13)
 *   GET   /products              Restocker, Adjuster
 *   POST  /products/bulk         Restocker, Adjuster (a new product's first
 *                                price is not a price change)
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
    async getMatches(@Query() dto: MatchesDto) {
        const data = await this.service.getMatches(dto);
        return data;
    }

    @Get('ensureValid')
    async ensureValid(@Query() dto: EnsureValidDto) {
        Logger.log(dto);
        await this.service.ensureValid(dto);
    }

    @Roles(Role.Restocker, Role.Adjuster, Role.Seller)
    @Get(':EAN')
    async getByBarcode(@Param() dto: GetDto) {
        const data = await this.service.getByBarcode(dto);
        return data;
    }

    // Non-price fields: Restocker, Adjuster. `price`: Admin only; the whole
    // batch is a 403 otherwise (see assertMayChangePrices).
    @Patch()
    async update(@CurrentUser() user: AuthUser, @Body() dto: UpdateBulkDto) {
        await this.service.update(user, dto);
    }

    @Get()
    async getAll(@Query() dto: GetAllDto) {
        const data = await this.service.getAll(dto);
        return data;
    }

    @Post('bulk')
    async addMany(@CurrentUser() user: AuthUser, @Body() dto: NewProductsDto) {
        await this.service.addMany(user, dto);
    }
}
