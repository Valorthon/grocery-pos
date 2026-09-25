import {
    IsString,
    IsOptional,
    IsPositive,
    IsNumber,
    IsNotEmpty,
    MaxLength,
    IsInt,
    Min,
    Max,
} from 'class-validator';
import { NUMERIC_LIMITS, STRING_LIMITS, PAGINATION } from '../../../constants';
import { Trim, TrimLowercase } from '../../../common/validators';

export class GetAllDto {
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
    page!: number;

    @IsPositive()
    @IsNumber()
    @IsNotEmpty()
    @Max(PAGINATION.LIMIT_MAX)
    limit!: number;
}
