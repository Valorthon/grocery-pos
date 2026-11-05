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
import { Role } from '../auth/types';
import { asJson } from '../common/wire';
import type { CategoryDto, Paginated } from '@grocery-pos/contracts';
import {
    CategoryIdDto,
    CategoryQueryDto,
    CreateCategoryDto,
    UpdateCategoryDto,
} from './category.dto';
import { CategoryService } from './category.service';
@Roles(Role.Admin)
@Controller('categories')
export class CategoryController {
    constructor(private service: CategoryService) {}
    @Roles(Role.Restocker, Role.Adjuster)
    @Get()
    async list(
        @Query() dto: CategoryQueryDto,
    ): Promise<Paginated<CategoryDto>> {
        return asJson(await this.service.list(dto));
    }
    @Post() async create(@Body() dto: CreateCategoryDto): Promise<CategoryDto> {
        return asJson(await this.service.create(dto));
    }
    @Patch(':id') async update(
        @Param() p: CategoryIdDto,
        @Body() dto: UpdateCategoryDto,
    ): Promise<CategoryDto> {
        return asJson(await this.service.update(p.id, dto));
    }
    @Delete(':id') async remove(@Param() p: CategoryIdDto): Promise<void> {
        await this.service.remove(p.id);
    }
}
