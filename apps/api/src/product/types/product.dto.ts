import { Transform, Type } from 'class-transformer';
import {
    ArrayNotEmpty,
    IsArray,
    IsBoolean,
    IsEnum,
    IsMongoId,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsPositive,
    IsString,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';
import { Category } from './product.types';
import { NUMERIC_LIMITS, STRING_LIMITS } from '../../constants';

export class EnsureValidDto {
    @IsOptional()
    @IsString()
    @MaxLength(STRING_LIMITS.EAN)
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : (value as unknown),
    )
    EAN!: string;

    @IsOptional()
    @IsString()
    @MaxLength(STRING_LIMITS.PRODUCT_NAME)
    @Transform(({ value }) =>
        typeof value === 'string'
            ? value.trim().toLowerCase()
            : (value as unknown),
    )
    name!: string;

    @IsOptional()
    @IsBoolean()
    @Transform(({ obj, key }) => {
        // Access the RAW value from the incoming object
        // before any implicit conversion messes with it
        const rawValue = (obj as Record<string, unknown>)[key];

        if (rawValue === 'true' || rawValue === true) return true;
        if (rawValue === 'false' || rawValue === false) return false;

        // Return the raw value for anything else so @IsBoolean can catch bad data
        return rawValue;
    })
    autoGenerateEAN!: boolean;
}

export class NewProductFields {
    @IsOptional()
    @IsString()
    @MaxLength(STRING_LIMITS.EAN)
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : (value as unknown),
    )
    EAN!: string;

    @IsNotEmpty()
    @IsString()
    @MaxLength(50)
    @Transform(({ value }) =>
        typeof value === 'string'
            ? value.trim().toLowerCase()
            : (value as unknown),
    )
    name!: string;

    @IsOptional()
    @IsEnum(Category, {
        message: `Category must be a valid enum value: ${Object.values(Category).join(', ')}`,
    })
    category!: Category;

    @IsNotEmpty()
    @IsNumber()
    @Type(() => Number)
    @Min(NUMERIC_LIMITS.PRICE_MIN)
    price!: number;
}

export class NewProductsDto {
    @ValidateNested({ each: true })
    @ArrayNotEmpty()
    newProducts!: NewProductFields[];
}
export class GetDto {
    @IsNotEmpty()
    @IsString()
    @MaxLength(50)
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : (value as unknown),
    )
    EAN!: string;
}
class UpdateFields {
    @IsOptional()
    @IsString()
    @MaxLength(STRING_LIMITS.PRODUCT_NAME)
    @Transform(({ value }) =>
        typeof value === 'string'
            ? value.trim().toLowerCase()
            : (value as unknown),
    )
    @IsNotEmpty()
    name?: string;

    @IsOptional()
    @IsNumber()
    @Min(NUMERIC_LIMITS.PRICE_MIN)
    price?: number;
}
class UpdateBulkFields {
    @IsNotEmpty()
    @IsMongoId()
    product!: string;

    @ValidateNested()
    @Type(() => UpdateFields)
    update!: UpdateFields;
}
export class UpdateBulkDto {
    @ValidateNested({ each: true })
    @Type(() => UpdateBulkFields)
    @IsArray()
    @ArrayNotEmpty()
    updates!: UpdateBulkFields[];
}

export class GetAllDto {
    @IsString()
    @IsOptional()
    @MaxLength(STRING_LIMITS.PRODUCT_NAME)
    @Transform(({ value }) =>
        typeof value === 'string'
            ? value.trim().toLowerCase()
            : (value as unknown),
    )
    name!: string;

    @IsString()
    @IsOptional()
    @MaxLength(STRING_LIMITS.EAN)
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : (value as unknown),
    )
    EAN!: string;

    @IsPositive()
    @IsNumber()
    @IsNotEmpty()
    page!: number;

    @IsPositive()
    @IsNumber()
    @IsNotEmpty()
    limit!: number;
}

export class MatchesDto {
    @IsOptional()
    @IsString()
    @MaxLength(STRING_LIMITS.EAN)
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : (value as unknown),
    )
    EAN!: string;

    @IsOptional()
    @MaxLength(STRING_LIMITS.PRODUCT_NAME)
    @Transform(({ value }) =>
        typeof value === 'string'
            ? value.trim().toLowerCase()
            : (value as unknown),
    )
    name!: string;
}
