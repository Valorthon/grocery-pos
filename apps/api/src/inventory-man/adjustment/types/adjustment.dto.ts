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
    MaxLength,
    NotEquals,
    ValidateNested,
    Max,
    ArrayMaxSize,
} from 'class-validator';
import {
    VALIDATION,
    STRING_LIMITS,
    PAGINATION,
    BATCH_LIMITS,
} from '../../../constants';
import {
    IsCalendarDate,
    IsNotBefore,
    Trim,
    TrimLowercase,
} from '../../../common/validators';

export class GetDetailsParamDto {
    @IsNotEmpty()
    @IsMongoId()
    adjustment!: string;
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

export class AdjustFields {
    @IsNotEmpty()
    @IsMongoId()
    product!: string;

    @IsNotEmpty()
    @IsInt()
    @NotEquals(VALIDATION.CHANGE_NOT_ZERO, { message: 'Change must not be 0' })
    change!: number;

    @IsNotEmpty()
    @IsString()
    @MaxLength(STRING_LIMITS.REASON)
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : (value as unknown),
    )
    reason!: string;
}

export class AdjustDto {
    @IsNotEmpty()
    @IsString()
    @MaxLength(STRING_LIMITS.DESCRIPTION)
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : (value as unknown),
    )
    description!: string;

    @ArrayNotEmpty()
    @ValidateNested({ each: true })
    @ArrayMaxSize(BATCH_LIMITS.ADJUSTMENT_LINES)
    @Type(() => AdjustFields)
    adjustDetails!: AdjustFields[];
}

export class GetAllDto {
    @IsMongoId()
    @IsOptional()
    adjustedBy!: string;

    /** Inclusive start day, `YYYY-MM-DD`, read in the store timezone. */
    @IsOptional()
    @IsCalendarDate()
    dateFrom?: string;

    /** Inclusive end day, `YYYY-MM-DD`, read in the store timezone. */
    @IsOptional()
    @IsCalendarDate()
    @IsNotBefore('dateFrom')
    dateTo?: string;

    @IsNumber()
    @IsPositive()
    @IsInt()
    @Max(PAGINATION.LIMIT_MAX)
    limit!: number;

    @IsNumber()
    @IsPositive()
    @IsInt()
    @Max(PAGINATION.PAGE_MAX)
    page!: number;
}
