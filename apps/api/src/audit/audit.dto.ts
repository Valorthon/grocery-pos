import { Transform, Type } from 'class-transformer';
import {
    IsEnum,
    IsInt,
    IsString,
    Max,
    MaxLength,
    Min,
    ValidateIf,
} from 'class-validator';
import {
    AuditAction,
    PAGINATION,
    STRING_LIMITS,
    type AuditListQuery,
} from '@grocery-pos/contracts';
import { IsCalendarDate, IsNotBefore } from '../common/validators';

export class AuditQueryDto implements AuditListQuery {
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(PAGINATION.PAGE_MAX)
    page: number = 1;
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(PAGINATION.LIMIT_MAX)
    limit: number = 20;
    /**
     * The actor's current username, matched as stored (trimmed, lower
     * case, exact). It resolves to that user's id, so entries recorded
     * before a rename still match (#143).
     */
    @ValidateIf((_o, value: unknown) => value !== undefined)
    @IsString()
    @MaxLength(STRING_LIMITS.USERNAME)
    @Transform(({ value }) =>
        typeof value === 'string'
            ? value.trim().toLowerCase()
            : (value as unknown),
    )
    username?: string;
    @ValidateIf((_o, value: unknown) => value !== undefined)
    @IsEnum(AuditAction)
    action?: AuditAction;
    @ValidateIf((_o, value: unknown) => value !== undefined)
    @IsCalendarDate()
    from?: string;
    @ValidateIf((_o, value: unknown) => value !== undefined)
    @IsCalendarDate()
    @IsNotBefore('from')
    to?: string;
}
