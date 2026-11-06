import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayNotEmpty,
    IsIn,
    IsInt,
    IsMongoId,
    IsString,
    Matches,
    Max,
    MaxLength,
    Min,
    ValidateIf,
    ValidateNested,
} from 'class-validator';
import {
    EXPIRY_LIMITS,
    NUMERIC_LIMITS,
    PAGINATION,
    PURCHASE_ORDER_LIMITS,
    PurchaseOrderStatus,
    STRING_LIMITS,
    SUPPLIER_LIMITS,
    type CreatePurchaseOrderRequest,
    type PurchaseOrderLineInput,
    type PurchaseOrderReceiptLineInput,
    type PurchaseOrderVersionRequest,
    type ReceivePurchaseOrderRequest,
    type UpdatePurchaseOrderRequest,
} from '@grocery-pos/contracts';
import { BATCH_LIMITS } from '../constants';
import { IsCalendarDate, Trim } from '../common/validators';

const defined = (_o: unknown, value: unknown) => value !== undefined;

export class PurchaseOrderIdDto {
    @IsMongoId() id!: string;
}
export class PurchaseOrderQueryDto {
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
    @ValidateIf(defined)
    @IsIn(Object.values(PurchaseOrderStatus))
    status?: PurchaseOrderStatus;
    @ValidateIf(defined)
    @IsMongoId()
    supplier?: string;
}
export class PurchaseOrderLineDto implements PurchaseOrderLineInput {
    @IsMongoId() product!: string;
    @IsInt()
    @Min(NUMERIC_LIMITS.QUANTITY_MIN)
    @Max(Number.MAX_SAFE_INTEGER)
    orderedQty!: number;
    /** Centavos; ₱0 allowed, confirmed again at receipt (#85). */
    @IsInt()
    @Min(NUMERIC_LIMITS.UNIT_COST_MIN)
    @Max(NUMERIC_LIMITS.AMOUNT_MAX)
    expectedCost!: number;
}
export class CreatePurchaseOrderDto implements CreatePurchaseOrderRequest {
    @IsMongoId() supplier!: string;
    @ValidateIf(defined)
    @IsString()
    @MaxLength(PURCHASE_ORDER_LIMITS.NOTE)
    @Trim()
    note?: string;
    @ValidateNested({ each: true })
    @ArrayNotEmpty()
    @ArrayMaxSize(BATCH_LIMITS.RESTOCK_LINES)
    @Type(() => PurchaseOrderLineDto)
    lines!: PurchaseOrderLineDto[];
}
export class UpdatePurchaseOrderDto
    extends CreatePurchaseOrderDto
    implements UpdatePurchaseOrderRequest
{
    @IsInt() @Min(0) version!: number;
}
export class PurchaseOrderVersionDto implements PurchaseOrderVersionRequest {
    @IsInt() @Min(0) version!: number;
}
export class PurchaseOrderReceiptLineDto implements PurchaseOrderReceiptLineInput {
    @IsMongoId() line!: string;
    @IsInt()
    @Min(NUMERIC_LIMITS.QUANTITY_MIN)
    @Max(Number.MAX_SAFE_INTEGER)
    quantity!: number;
    @IsInt()
    @Min(NUMERIC_LIMITS.UNIT_COST_MIN)
    @Max(NUMERIC_LIMITS.AMOUNT_MAX)
    unitCost!: number;
    @ValidateIf(defined)
    @IsCalendarDate()
    expiryDate?: string;
    @ValidateIf(defined)
    @IsString()
    @MaxLength(EXPIRY_LIMITS.BATCH_NO)
    @Trim()
    batchNo?: string;
}
export class ReceivePurchaseOrderDto implements ReceivePurchaseOrderRequest {
    @IsInt() @Min(0) version!: number;
    @IsString()
    @Matches(/^[A-Za-z0-9_-]{8,64}$/)
    @MaxLength(PURCHASE_ORDER_LIMITS.IDEMPOTENCY_KEY)
    @Trim()
    idempotencyKey!: string;
    @ValidateIf(defined)
    @IsString()
    @MaxLength(SUPPLIER_LIMITS.INVOICE)
    @Trim()
    invoiceNumber?: string;
    @ValidateIf(defined)
    @IsString()
    @MaxLength(STRING_LIMITS.DESCRIPTION)
    @Trim()
    description?: string;
    @ValidateNested({ each: true })
    @ArrayNotEmpty()
    @ArrayMaxSize(BATCH_LIMITS.RESTOCK_LINES)
    @Type(() => PurchaseOrderReceiptLineDto)
    lines!: PurchaseOrderReceiptLineDto[];
}
