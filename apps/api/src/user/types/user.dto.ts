import { Transform, Type } from 'class-transformer';
import {
    ArrayNotEmpty,
    ArrayUnique,
    IsArray,
    IsBoolean,
    IsEnum,
    IsIn,
    IsMongoId,
    IsNotEmpty,
    IsNumber,
    IsObject,
    IsOptional,
    IsPositive,
    IsString,
    MaxLength,
    MinLength,
    ValidateNested,
    Max,
    ArrayMaxSize,
    IsInt,
} from 'class-validator';
import { ASSIGNABLE_ROLES } from '@grocery-pos/contracts';
import { Role } from '../../auth/types';
import { STRING_LIMITS, PAGINATION, BATCH_LIMITS } from '../../constants';

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
    @MinLength(STRING_LIMITS.PASSWORD_MIN)
    @MaxLength(STRING_LIMITS.PASSWORD)
    password!: string;

    @IsEnum(Role, { each: true })
    @IsIn(ASSIGNABLE_ROLES, {
        each: true,
        message: `each value in roles must be one of: ${ASSIGNABLE_ROLES.join(', ')}`,
    })
    @ArrayUnique()
    @ArrayNotEmpty()
    @ArrayMaxSize(ASSIGNABLE_ROLES.length)
    @IsArray()
    roles!: Role[];
}
export class CreateBulkDto {
    @ValidateNested({ each: true })
    @IsArray()
    @ArrayNotEmpty()
    @ArrayMaxSize(BATCH_LIMITS.USERS)
    @Type(() => CreateFields)
    users!: CreateFields[];
}
class UpdateFields {
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(STRING_LIMITS.USERNAME)
    @Transform(({ value }) =>
        typeof value === 'string'
            ? value.trim().toLowerCase()
            : (value as unknown),
    )
    name?: string;

    /** An admin reset: the same policy as a new account's password. */
    @IsOptional()
    @IsString()
    @MinLength(STRING_LIMITS.PASSWORD_MIN)
    @MaxLength(STRING_LIMITS.PASSWORD)
    password?: string;

    @IsOptional()
    @IsEnum(Role, { each: true })
    @IsIn(ASSIGNABLE_ROLES, {
        each: true,
        message: `each value in roles must be one of: ${ASSIGNABLE_ROLES.join(', ')}`,
    })
    @ArrayUnique()
    @ArrayNotEmpty()
    @ArrayMaxSize(ASSIGNABLE_ROLES.length)
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
    @IsObject()
    @IsNotEmpty()
    @Type(() => UpdateFields)
    update!: UpdateFields;
}
export class UpdateBulkDto {
    @ValidateNested({ each: true })
    @Type(() => UpdateBulkFields)
    // One entry per user: the permission and last-admin checks reason about
    // each target's state before and after exactly one change.
    @ArrayUnique((entry: UpdateBulkFields) => entry?.user, {
        message: 'each user may appear only once in updates',
    })
    @IsArray()
    @ArrayNotEmpty()
    @ArrayMaxSize(BATCH_LIMITS.USERS)
    updates!: UpdateBulkFields[];
}

/** `PATCH /users/me/password`: any signed-in user changes their own password. */
export class ChangePasswordDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(STRING_LIMITS.PASSWORD)
    currentPassword!: string;

    @IsString()
    @MinLength(STRING_LIMITS.PASSWORD_MIN)
    @MaxLength(STRING_LIMITS.PASSWORD)
    newPassword!: string;
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
