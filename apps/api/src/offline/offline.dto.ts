import { Transform, Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayNotEmpty,
    IsArray,
    IsDateString,
    IsInt,
    IsMongoId,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    MaxLength,
    Min,
    MinLength,
    ValidateNested,
} from 'class-validator';
import {
    BATCH_LIMITS,
    NUMERIC_LIMITS,
    PAGINATION,
    STRING_LIMITS,
    type OfflineCatalogRequest,
    type OfflineLeaseRequest,
    type OfflineSaleLine,
    type OfflineSaleRequest,
    type ReconcileOfflineSaleRequest,
} from '@grocery-pos/contracts';
const trim = ({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value;
export class OfflineLeaseDto implements OfflineLeaseRequest {
    @Transform(trim) @IsUUID('4') terminalId!: string;
}
export class OfflineLeaseParamDto {
    @Transform(trim) @IsMongoId() id!: string;
}
export class OfflineCatalogDto implements OfflineCatalogRequest {
    @Transform(trim) @IsMongoId() lease!: string;
    @IsOptional() @Transform(trim) @IsString() @MaxLength(100) after?: string;
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(PAGINATION.LIMIT_MAX)
    limit?: number;
}
export class OfflineLineDto implements OfflineSaleLine {
    @Transform(trim) @IsMongoId() product!: string;
    @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) quantity!: number;
    @Transform(trim) @IsString() @MinLength(1) @MaxLength(4096) proof!: string;
}
export class OfflineSaleDto implements OfflineSaleRequest {
    @Transform(trim) @IsMongoId() lease!: string;
    @Transform(trim) @IsUUID('4') idempotencyKey!: string;
    @Transform(trim) @IsDateString({ strict: true }) soldAt!: string;
    @IsInt()
    @Min(NUMERIC_LIMITS.AMOUNT_MIN)
    @Max(NUMERIC_LIMITS.AMOUNT_MAX)
    amountTendered!: number;
    @IsArray()
    @ArrayNotEmpty()
    @ArrayMaxSize(BATCH_LIMITS.SALE_LINES)
    @ValidateNested({ each: true })
    @Type(() => OfflineLineDto)
    lines!: OfflineLineDto[];
}
export class ReconcileOfflineSaleDto
    extends OfflineSaleDto
    implements ReconcileOfflineSaleRequest
{
    @Transform(trim)
    @IsString()
    @MinLength(1)
    @MaxLength(STRING_LIMITS.REASON)
    reason!: string;
}
