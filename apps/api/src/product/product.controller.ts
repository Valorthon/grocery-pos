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

@Roles(Role.Restocker, Role.Adjuster)
@Controller('products')
export class ProductController {
    constructor(private service: ProductService) {}

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

    @Patch()
    async update(@Body() dto: UpdateBulkDto) {
        await this.service.update(dto);
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
