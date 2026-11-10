import {
    IsString,
    IsBoolean,
    ValidateIf,
    IsOptional,
    IsPositive,
    IsNumber,
    IsNotEmpty,
    MaxLength,
    IsInt,
    Min,
    Max,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { NUMERIC_LIMITS, STRING_LIMITS, PAGINATION } from '../../../constants';
import { Trim, TrimLowercase } from '../../../common/validators';

export class GetAllDto {
    @ValidateIf((_object, value: unknown) => value !== undefined)
    @IsBoolean()
    @Transform(({ obj, key }) => {
        const raw = (obj as Record<string, unknown>)[key];
        return raw === 'true' ? true : raw === 'false' ? false : raw;
    })
    lowStock?: boolean;

    /** Active products at or below zero stock: the dashboard's Out of Stock count. */
    @ValidateIf((_object, value: unknown) => value !== undefined)
    @IsBoolean()
    @Transform(({ obj, key }) => {
        const raw = (obj as Record<string, unknown>)[key];
        return raw === 'true' ? true : raw === 'false' ? false : raw;
    })
    outOfStock?: boolean;

    /** Rows with stock at or below this; 0 lists what is out of stock. */
    @IsOptional()
    @IsInt()
    @Min(NUMERIC_LIMITS.STOCK_MIN)
    maxStock?: number;

    /** Matched anywhere in the product name. */
    @IsString()
    @IsOptional()
    @MaxLength(STRING_LIMITS.PRODUCT_NAME)
    @TrimLowercase()
    name?: string;

    /** Matched as a barcode prefix. */
    @IsString()
    @IsOptional()
    @MaxLength(STRING_LIMITS.EAN)
    @Trim()
    EAN?: string;

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
