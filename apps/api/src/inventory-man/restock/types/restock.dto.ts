import { Transform, Type } from 'class-transformer';
import {
    ArrayNotEmpty,
    IsInt,
    IsMongoId,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsPositive,
    IsString,
    Max,
    MaxLength,
    Min,
    ValidateNested,
    ArrayMaxSize,
} from 'class-validator';
import {
    ExactlyOneOf,
    IsCalendarDate,
    IsNotBefore,
    Trim,
    TrimLowercase,
} from '../../../common/validators';
import type { RestockLineFields, RestockRequest } from '@grocery-pos/contracts';
import { NewProductFields } from '../../../product/types';
import {
    NUMERIC_LIMITS,
    STRING_LIMITS,
    PAGINATION,
    BATCH_LIMITS,
} from '../../../constants';

export class GetDetailsParamDto {
    @IsNotEmpty()
    @IsMongoId()
    restock!: string;
}
export class GetDetailsQueryDto {
    /** Matched anywhere in the product name. */
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

    @IsNumber()
    @IsPositive()
    @IsNotEmpty()
    @IsInt()
    @Max(PAGINATION.PAGE_MAX)
    page!: number;

    @IsNumber()
    @IsPositive()
    @IsNotEmpty()
    @IsInt()
    @Max(PAGINATION.LIMIT_MAX)
    limit!: number;
}

export type GetDetailsDto = GetDetailsQueryDto & GetDetailsParamDto;

/**
 * One restock line: an existing `product` or a `newProduct` to create,
 * never both and never neither (issue #14).
 */
@ExactlyOneOf(['newProduct', 'product'])
export class RestockFields implements RestockLineFields {
    @IsOptional()
    @ValidateNested()
    @Type(() => NewProductFields)
    newProduct?: NewProductFields;

    @IsOptional()
    @IsMongoId()
    product?: string;

    @IsNumber()
    @IsNotEmpty()
    @Type(() => Number)
    @Min(NUMERIC_LIMITS.QUANTITY_MIN)
    @IsInt()
    quantity!: number;

    /** Centavos. ₱0 is accepted (the client confirms it first, #85). */
    @IsInt()
    @IsNotEmpty()
    @Type(() => Number)
    @Min(NUMERIC_LIMITS.UNIT_COST_MIN)
    @Max(NUMERIC_LIMITS.AMOUNT_MAX)
    unitCost!: number;
}
export class RestockDto implements RestockRequest {
    @ValidateNested({ each: true })
    @ArrayNotEmpty()
    @ArrayMaxSize(BATCH_LIMITS.RESTOCK_LINES)
    @Type(() => RestockFields)
    restockDetails!: RestockFields[];

    @IsNotEmpty()
    @IsString()
    @MaxLength(STRING_LIMITS.DESCRIPTION)
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : (value as unknown),
    )
    description!: string;
}

export class GetAllDto {
    @IsMongoId()
    @IsOptional()
    restockedBy!: string;

    /** Inclusive start day, `YYYY-MM-DD`, read in the store timezone. */
    @IsOptional()
    @IsCalendarDate()
    dateFrom?: string;

    /** Inclusive end day, `YYYY-MM-DD`, read in the store timezone. */
    @IsOptional()
    @IsCalendarDate()
    @IsNotBefore('dateFrom')
    dateTo?: string;

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
