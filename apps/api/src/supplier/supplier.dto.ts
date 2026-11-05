import { Transform, Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayNotEmpty,
    IsArray,
    IsBoolean,
    IsEmail,
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
    PAGINATION,
    SUPPLIER_LIMITS,
    type CreateSupplierRequest,
    type UpdateSupplierRequest,
} from '@grocery-pos/contracts';
import { AtLeastOneOf, Trim } from '../common/validators';

export class SupplierIdDto {
    @IsMongoId() id!: string;
}
export class SupplierQueryDto {
    @Type(() => Number) @IsInt() @Min(1) @Max(PAGINATION.PAGE_MAX) page = 1;
    @Type(() => Number) @IsInt() @Min(1) @Max(PAGINATION.LIMIT_MAX) limit = 100;
    @IsOptional()
    @IsIn(['active', 'archived', 'all'])
    @Trim()
    status?: 'active' | 'archived' | 'all';
    @IsOptional()
    @IsString()
    @MaxLength(SUPPLIER_LIMITS.NAME)
    @Trim()
    name?: string;
}
export class SupplierFieldsDto implements CreateSupplierRequest {
    @IsString()
    @IsNotEmpty()
    @MaxLength(SUPPLIER_LIMITS.NAME)
    @Trim()
    name!: string;
    @ValidateIf((_o, v: unknown) => v !== undefined)
    @IsString()
    @MaxLength(SUPPLIER_LIMITS.CONTACT)
    @Trim()
    contactPerson?: string;
    @ValidateIf((_o, v: unknown) => v !== undefined)
    @IsString()
    @MaxLength(SUPPLIER_LIMITS.PHONE)
    @Trim()
    phone?: string;
    @ValidateIf((_o, v: unknown) => v !== undefined && v !== '')
    @IsEmail()
    @MaxLength(SUPPLIER_LIMITS.EMAIL)
    @Trim()
    email?: string;
    @ValidateIf((_o, v: unknown) => v !== undefined)
    @IsString()
    @MaxLength(SUPPLIER_LIMITS.ADDRESS)
    @Trim()
    address?: string;
    @ValidateIf((_o, v: unknown) => v !== undefined)
    @IsString()
    @MaxLength(SUPPLIER_LIMITS.TIN)
    @Trim()
    TIN?: string;
}
@AtLeastOneOf([
    'name',
    'contactPerson',
    'phone',
    'email',
    'address',
    'TIN',
    'isActive',
])
export class UpdateSupplierDto implements UpdateSupplierRequest {
    @ValidateIf((_o, v: unknown) => v !== undefined)
    @IsString()
    @IsNotEmpty()
    @MaxLength(SUPPLIER_LIMITS.NAME)
    @Trim()
    name?: string;
    @ValidateIf((_o, v: unknown) => v !== undefined)
    @IsString()
    @MaxLength(SUPPLIER_LIMITS.CONTACT)
    @Trim()
    contactPerson?: string;
    @ValidateIf((_o, v: unknown) => v !== undefined)
    @IsString()
    @MaxLength(SUPPLIER_LIMITS.PHONE)
    @Trim()
    phone?: string;
    @ValidateIf((_o, v: unknown) => v !== undefined && v !== '')
    @IsEmail()
    @MaxLength(SUPPLIER_LIMITS.EMAIL)
    @Trim()
    email?: string;
    @ValidateIf((_o, v: unknown) => v !== undefined)
    @IsString()
    @MaxLength(SUPPLIER_LIMITS.ADDRESS)
    @Trim()
    address?: string;
    @ValidateIf((_o, v: unknown) => v !== undefined)
    @IsString()
    @MaxLength(SUPPLIER_LIMITS.TIN)
    @Trim()
    TIN?: string;
    @ValidateIf((_o, v: unknown) => v !== undefined)
    @IsBoolean()
    isActive?: boolean;
}

export class ProductCostsDto {
    @Transform(({ value }: { value: unknown }) =>
        typeof value === 'string' ? value.split(',') : value,
    )
    @IsArray()
    @ArrayNotEmpty()
    @ArrayMaxSize(200)
    @IsMongoId({ each: true })
    products!: string[];
}
