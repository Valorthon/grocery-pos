import { Transform, Type } from 'class-transformer';
import {
    IsEnum,
    IsInt,
    IsMongoId,
    IsNotEmpty,
    IsObject,
    IsOptional,
    IsString,
    Matches,
    Max,
    MaxLength,
    Min,
    ValidateIf,
    ValidateNested,
} from 'class-validator';
import {
    OverrideAction,
    OVERRIDE_PIN_LENGTH,
    STRING_LIMITS,
    NUMERIC_LIMITS,
    type ManagerOverrideRequest,
    type OverrideContextRequest,
    type OverrideReversalRequest,
    type SetOverridePinRequest,
} from '@grocery-pos/contracts';
import { StockCountVersionDto } from '../../stock-count/stock-count.dto';
import { SellDto, ReverseSaleDto } from '../../sales/types/sales.dto';

export class OverrideReversalDto
    extends ReverseSaleDto
    implements OverrideReversalRequest
{
    @IsMongoId()
    saleId!: string;
}

export class OverrideStockCountDto
    extends StockCountVersionDto
    implements NonNullable<OverrideContextRequest['stockCount']>
{
    @IsMongoId() countId!: string;
}

export class OverrideContextDto implements OverrideContextRequest {
    @IsOptional()
    @IsObject()
    @ValidateNested()
    @Type(() => OverrideStockCountDto)
    stockCount?: OverrideStockCountDto;

    @IsOptional()
    @IsObject()
    @ValidateNested()
    @Type(() => SellDto)
    sale?: SellDto;

    @IsOptional()
    @IsObject()
    @ValidateNested()
    @Type(() => OverrideReversalDto)
    reversal?: OverrideReversalDto;

    @IsOptional()
    @IsInt()
    @Min(NUMERIC_LIMITS.AMOUNT_MIN)
    @Max(NUMERIC_LIMITS.AMOUNT_MAX)
    expectedSubtotal?: number;
}

export class ManagerOverrideDto implements ManagerOverrideRequest {
    @IsString()
    @IsNotEmpty()
    @MaxLength(STRING_LIMITS.USERNAME)
    @Transform(({ value }) =>
        typeof value === 'string'
            ? value.trim().toLowerCase()
            : (value as unknown),
    )
    username!: string;

    @IsString()
    @Matches(new RegExp(`^[0-9]{${OVERRIDE_PIN_LENGTH}}$`))
    pin!: string;

    @IsEnum(OverrideAction)
    action!: OverrideAction;

    @IsObject()
    @ValidateNested()
    @Type(() => OverrideContextDto)
    context!: OverrideContextDto;
}

export class SetOverridePinDto implements SetOverridePinRequest {
    /** Secrets are never trimmed; null explicitly clears an existing PIN. */
    @ValidateIf((_object, value: unknown) => value !== null)
    @IsString()
    @Matches(new RegExp(`^[0-9]{${OVERRIDE_PIN_LENGTH}}$`))
    pin!: string | null;
}

export class OverrideUserParamDto {
    @IsMongoId()
    id!: string;
}
