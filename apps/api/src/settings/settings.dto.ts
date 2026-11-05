import {
    IsInt,
    IsNotEmpty,
    IsString,
    Max,
    MaxLength,
    Min,
    ValidateBy,
    ValidateIf,
} from 'class-validator';
import {
    SETTINGS_LIMITS,
    type UpdateStoreSettingsRequest,
} from '@grocery-pos/contracts';
import { AtLeastOneOf, Trim } from '../common/validators';

export function validTimezone(value: unknown): boolean {
    if (typeof value !== 'string' || !value.includes('/'))
        return value === 'UTC';
    try {
        new Intl.DateTimeFormat('en', { timeZone: value }).format();
        return true;
    } catch {
        return false;
    }
}

@AtLeastOneOf([
    'storeName',
    'branchName',
    'address',
    'contactNumber',
    'tin',
    'receiptFooter',
    'timezone',
    'defaultReorderLevel',
])
export class UpdateSettingsDto implements UpdateStoreSettingsRequest {
    @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) version!: number;
    @ValidateIf((_o, value: unknown) => value !== undefined)
    @IsString()
    @IsNotEmpty()
    @MaxLength(SETTINGS_LIMITS.STORE_NAME)
    @Trim()
    storeName?: string;
    @ValidateIf((_o, value: unknown) => value !== undefined)
    @IsString()
    @MaxLength(SETTINGS_LIMITS.BRANCH_NAME)
    @Trim()
    branchName?: string;
    @ValidateIf((_o, value: unknown) => value !== undefined)
    @IsString()
    @MaxLength(SETTINGS_LIMITS.ADDRESS)
    @Trim()
    address?: string;
    @ValidateIf((_o, value: unknown) => value !== undefined)
    @IsString()
    @MaxLength(SETTINGS_LIMITS.CONTACT)
    @Trim()
    contactNumber?: string;
    @ValidateIf((_o, value: unknown) => value !== undefined)
    @IsString()
    @MaxLength(SETTINGS_LIMITS.TIN)
    @Trim()
    tin?: string;
    @ValidateIf((_o, value: unknown) => value !== undefined)
    @IsString()
    @MaxLength(SETTINGS_LIMITS.FOOTER)
    @Trim()
    receiptFooter?: string;
    @ValidateIf((_o, value: unknown) => value !== undefined)
    @IsString()
    @MaxLength(SETTINGS_LIMITS.TIMEZONE)
    @Trim()
    @ValidateBy({
        name: 'settingsTimezone',
        validator: {
            validate: validTimezone,
            defaultMessage: () => 'timezone must be an IANA timezone',
        },
    })
    timezone?: string;
    @ValidateIf((_o, value: unknown) => value !== undefined)
    @IsInt()
    @Min(0)
    @Max(SETTINGS_LIMITS.REORDER_LEVEL)
    defaultReorderLevel?: number;
}
