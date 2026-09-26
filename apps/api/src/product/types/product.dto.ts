import { Transform, Type } from 'class-transformer';
import {
    ArrayNotEmpty,
    IsArray,
    IsBoolean,
    IsDefined,
    IsEnum,
    IsInt,
    IsMongoId,
    IsNotEmpty,
    IsNumber,
    IsObject,
    IsOptional,
    IsPositive,
    IsString,
    Max,
    MaxLength,
    Min,
    ValidateNested,
    ArrayMaxSize,
} from 'class-validator';
import type {
    NewProductRequest,
    NewProductsRequest,
} from '@grocery-pos/contracts';
import { Category } from './product.types';
import {
    NUMERIC_LIMITS,
    STRING_LIMITS,
    PAGINATION,
    BATCH_LIMITS,
} from '../../constants';
import {
    AtLeastOneOf,
    IsBarcode,
    Trim,
    TrimLowercase,
} from '../../common/validators';

export class EnsureValidDto {
    @IsOptional()
    @IsString()
    @MaxLength(STRING_LIMITS.EAN)
    @Trim()
    EAN!: string;

    @IsOptional()
    @IsString()
    @MaxLength(STRING_LIMITS.PRODUCT_NAME)
    @TrimLowercase()
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

export class NewProductFields implements NewProductRequest {
    /**
     * The barcode as scanned: EAN-13, UPC-A or EAN-8 with a valid check
     * digit, outside the store's generated range (`IsBarcode`). Omitted or
     * blank: the server generates one.
     */
    @IsOptional()
    @IsString()
    @IsBarcode()
    @Transform(({ value }) => {
        if (typeof value !== 'string') return value as unknown;
        const trimmed = value.trim();
        return trimmed === '' ? undefined : trimmed;
    })
    EAN?: string;

    @IsNotEmpty()
    @IsString()
    @MaxLength(STRING_LIMITS.PRODUCT_NAME)
    @TrimLowercase()
    name!: string;

    @IsOptional()
    @IsEnum(Category, {
        message: `Category must be a valid enum value: ${Object.values(Category).join(', ')}`,
    })
    category!: Category;

    /** Centavos. */
    @IsNotEmpty()
    @IsInt()
    @Type(() => Number)
    @Min(NUMERIC_LIMITS.PRICE_MIN)
    @Max(NUMERIC_LIMITS.AMOUNT_MAX)
    price!: number;
}

export class NewProductsDto implements NewProductsRequest {
    @ValidateNested({ each: true })
    @ArrayNotEmpty()
    @ArrayMaxSize(BATCH_LIMITS.NEW_PRODUCTS)
    @Type(() => NewProductFields)
    newProducts!: NewProductFields[];
}
export class GetDto {
    @IsNotEmpty()
    @IsString()
    @MaxLength(STRING_LIMITS.EAN)
    @Trim()
    EAN!: string;
}
/** A product edit: at least one field, never an empty `$set` (issue #14). */
@AtLeastOneOf(['name', 'price'])
class UpdateFields {
    @IsOptional()
    @IsString()
    @MaxLength(STRING_LIMITS.PRODUCT_NAME)
    @TrimLowercase()
    @IsNotEmpty()
    name?: string;

    /** Centavos. */
    @IsOptional()
    @IsInt()
    @Min(NUMERIC_LIMITS.PRICE_MIN)
    @Max(NUMERIC_LIMITS.AMOUNT_MAX)
    price?: number;
}
class UpdateBulkFields {
    @IsNotEmpty()
    @IsMongoId()
    product!: string;

    // Without these a line with no `update` skips ValidateNested (and so
    // AtLeastOneOf) and reaches the service as `update: undefined`.
    @IsDefined()
    @IsObject()
    @ValidateNested()
    @Type(() => UpdateFields)
    update!: UpdateFields;
}
export class UpdateBulkDto {
    @ValidateNested({ each: true })
    @Type(() => UpdateBulkFields)
    @IsArray()
    @ArrayNotEmpty()
    @ArrayMaxSize(BATCH_LIMITS.PRODUCT_UPDATES)
    updates!: UpdateBulkFields[];
}

export class GetAllDto {
    /** Matched anywhere in the name. */
    @IsString()
    @IsOptional()
    @MaxLength(STRING_LIMITS.PRODUCT_NAME)
    @TrimLowercase()
    name!: string;

    /** Matched as a barcode prefix. */
    @IsString()
    @IsOptional()
    @MaxLength(STRING_LIMITS.EAN)
    @Trim()
    EAN!: string;

    @IsPositive()
    @IsNumber()
    @IsNotEmpty()
    @IsInt()
    @Max(PAGINATION.PAGE_MAX)
    page!: number;

    @IsPositive()
    @IsNumber()
    @IsNotEmpty()
    @IsInt()
    @Max(PAGINATION.LIMIT_MAX)
    limit!: number;
}

export class MatchesDto {
    @IsOptional()
    @IsString()
    @MaxLength(STRING_LIMITS.EAN)
    @Trim()
    EAN!: string;

    /** A name fragment; a digits-only term also matches part of an EAN. */
    @IsOptional()
    @IsString()
    @MaxLength(STRING_LIMITS.PRODUCT_NAME)
    @TrimLowercase()
    name!: string;
}
