import { Transform, Type } from 'class-transformer';
import {
    ArrayNotEmpty,
    IsArray,
    IsDate,
    IsMongoId,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsPositive,
    IsString,
    MaxLength,
    NotEquals,
    ValidateNested,
} from 'class-validator';
import { VALIDATION, STRING_LIMITS } from '../../../constants';

export class GetDetailsParamDto {
    @IsNotEmpty()
    @IsMongoId()
    adjustment!: string;
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

class AdjustFields {
    @IsNotEmpty()
    @IsMongoId()
    product!: string;

    @IsNotEmpty()
    @IsNumber()
    @NotEquals(VALIDATION.CHANGE_NOT_ZERO, { message: 'Change must not be 0' })
    change!: number;

    @IsOptional()
    @IsString()
    @MaxLength(STRING_LIMITS.REASON)
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : (value as unknown),
    )
    reason?: string;
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
    @Type(() => AdjustFields)
    adjustDetails!: AdjustFields[];
}

export class GetAllDto {
    @IsMongoId()
    @IsOptional()
    adjustedBy!: string;

    @IsArray()
    @IsDate({ each: true })
    @IsOptional()
    @Transform(
        ({ value }) => (Array.isArray(value) ? value : [value]) as unknown[],
    )
    @Type(() => Date)
    dateRange!: Date[];

    @IsNumber()
    @IsPositive()
    limit!: number;

    @IsNumber()
    @IsPositive()
    page!: number;
}
