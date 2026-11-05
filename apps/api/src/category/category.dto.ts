import { Type } from 'class-transformer';
import {
    IsBoolean,
    IsIn,
    IsInt,
    IsMongoId,
    IsNotEmpty,
    IsOptional,
    IsString,
    Max,
    MaxLength,
    Min,
    ValidateIf,
} from 'class-validator';
import {
    CATEGORY_NAME_MAX,
    CATEGORY_SORT_MAX,
    PAGINATION,
    type CreateCategoryRequest,
    type UpdateCategoryRequest,
} from '@grocery-pos/contracts';
import { AtLeastOneOf, Trim } from '../common/validators';
export class CategoryIdDto {
    @IsMongoId() id!: string;
}
export class CategoryQueryDto {
    @Type(() => Number) @IsInt() @Min(1) @Max(PAGINATION.PAGE_MAX) page = 1;
    @Type(() => Number) @IsInt() @Min(1) @Max(PAGINATION.LIMIT_MAX) limit = 100;
    @IsOptional() @IsIn(['active', 'archived', 'all']) @Trim() status?:
        'active' | 'archived' | 'all';
    @IsOptional()
    @IsString()
    @MaxLength(CATEGORY_NAME_MAX)
    @Trim()
    name?: string;
}
export class CreateCategoryDto implements CreateCategoryRequest {
    @IsString()
    @IsNotEmpty()
    @MaxLength(CATEGORY_NAME_MAX)
    @Trim()
    name!: string;
    @IsOptional() @IsInt() @Min(0) @Max(CATEGORY_SORT_MAX) sortOrder?: number;
}
@AtLeastOneOf(['name', 'isActive', 'sortOrder'])
export class UpdateCategoryDto implements UpdateCategoryRequest {
    @ValidateIf((_o, v: unknown) => v !== undefined)
    @IsString()
    @IsNotEmpty()
    @MaxLength(CATEGORY_NAME_MAX)
    @Trim()
    name?: string;
    @ValidateIf((_o, v: unknown) => v !== undefined)
    @IsBoolean()
    isActive?: boolean;
    @ValidateIf((_o, v: unknown) => v !== undefined)
    @IsInt()
    @Min(0)
    @Max(CATEGORY_SORT_MAX)
    sortOrder?: number;
}
