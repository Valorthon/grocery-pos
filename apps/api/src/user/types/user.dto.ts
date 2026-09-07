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
    ValidateNested,
} from 'class-validator';
import { Role } from '../../auth/types';
import { STRING_LIMITS } from '../../constants';

class CreateFields {
    @IsString()
    @IsNotEmpty()
    @MaxLength(STRING_LIMITS.USERNAME)
    @Transform(({ value }) =>
        typeof value === 'string'
            ? value.trim().toLowerCase()
            : (value as unknown),
    )
    name!: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(STRING_LIMITS.PASSWORD)
    password!: string;

    @IsEnum(Role, { each: true })
    @ArrayNotEmpty()
    roles!: Role[];
}
export class CreateBulkDto {
    @ValidateNested({ each: true })
    @IsArray()
    @ArrayNotEmpty()
    @Type(() => CreateFields)
    users!: CreateFields[];
}
class UpdateFields {
    @IsOptional()
    @IsString()
    @MaxLength(STRING_LIMITS.USERNAME)
    @Transform(({ value }) =>
        typeof value === 'string'
            ? value.trim().toLowerCase()
            : (value as unknown),
    )
    name?: string;

    @IsOptional()
    @IsString()
    @MaxLength(STRING_LIMITS.PASSWORD)
    password?: string;

    @IsOptional()
    @IsArray()
    roles?: Role[];

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}
class UpdateBulkFields {
    @IsNotEmpty()
    @IsMongoId()
    user!: string;

    @ValidateNested()
    @IsNotEmpty()
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
    @MaxLength(STRING_LIMITS.USERNAME)
    @Transform(({ value }) =>
        typeof value === 'string'
            ? value.trim().toLowerCase()
            : (value as unknown),
    )
    name!: string;

    @IsPositive()
    @IsNumber()
    @IsNotEmpty()
    page!: number;

    @IsPositive()
    @IsNumber()
    @IsNotEmpty()
    limit!: number;
}
