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
} from 'class-validator';
import { IsCalendarDate, RequiresOne } from '../../../common/validators';
import { NewProductFields } from '../../../product/types';
import { NUMERIC_LIMITS, STRING_LIMITS } from '../../../constants';

export class GetDetailsParamDto {
    @IsNotEmpty()
    @IsMongoId()
    restock!: string;
}
export class GetDetailsQueryDto {
    @IsString()
    @IsOptional()
    @MaxLength(STRING_LIMITS.PRODUCT_NAME)
    name!: string;

    @IsString()
    @IsOptional()
    @MaxLength(STRING_LIMITS.EAN)
    EAN!: string;

    @IsNumber()
    @IsPositive()
    @IsNotEmpty()
    page!: number;

    @IsNumber()
    @IsPositive()
    @IsNotEmpty()
    limit!: number;
}

export type GetDetailsDto = GetDetailsQueryDto & GetDetailsParamDto;

export class RestockFields {
    @IsOptional()
    @ValidateNested()
    @Type(() => NewProductFields)
    newProduct?: NewProductFields;

    @IsOptional()
    @IsMongoId()
    product?: string;

    @RequiresOne(['newProduct', 'product'])
    dummy?: unknown;

    @IsNumber()
    @IsNotEmpty()
    @Type(() => Number)
    @Min(NUMERIC_LIMITS.QUANTITY_MIN)
    @IsInt()
    quantity!: number;

    /** Centavos. */
    @IsInt()
    @IsNotEmpty()
    @Type(() => Number)
    @Min(NUMERIC_LIMITS.PRICE_MIN)
    @Max(NUMERIC_LIMITS.AMOUNT_MAX)
    unitCost!: number;
}
export class RestockDto {
    @ValidateNested({ each: true })
    @ArrayNotEmpty()
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
    dateTo?: string;

    @IsPositive()
    @IsNumber()
    @IsNotEmpty()
    page!: number;

    @IsPositive()
    @IsNumber()
    @IsNotEmpty()
    limit!: number;
}
