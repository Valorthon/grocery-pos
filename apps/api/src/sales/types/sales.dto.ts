import { Transform, Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayNotEmpty,
    IsArray,
    IsEnum,
    IsInt,
    IsMongoId,
    IsNotEmpty,
    IsNotEmptyObject,
    IsObject,
    IsNumber,
    IsOptional,
    IsPositive,
    IsString,
    Matches,
    MaxLength,
    Min,
    MinLength,
    ValidateIf,
    ValidateNested,
    ValidationArguments,
    registerDecorator,
} from 'class-validator';
import {
    DiscountType,
    PaymentType,
    ReversalType,
    SaleStatus,
    TenderType,
} from './sales.types';
import {
    DISCOUNT_LIMITS,
    NUMERIC_LIMITS,
    REFERENCE_NUMBER_LIMITS,
    STRING_LIMITS,
} from '../../constants';
import { normalizeReferenceNumber } from '@grocery-pos/contracts';

export class GetDetailsDto {
    @IsNotEmpty()
    @IsMongoId()
    sales!: string;
}
class SellDetailsFields {
    @IsNotEmpty()
    @IsMongoId()
    product!: string;

    @IsNotEmpty()
    @IsInt()
    @Min(NUMERIC_LIMITS.QUANTITY_MIN)
    quantity!: number;
}

/** Caps `value` at 100 when the discount is a percent; FIXED is unbounded here. */
function IsPercentInRange() {
    return function (target: object, propertyName: string) {
        registerDecorator({
            name: 'isPercentInRange',
            target: target.constructor,
            propertyName,
            validator: {
                validate(value: unknown, args: ValidationArguments) {
                    const { type } = args.object as DiscountFields;
                    return (
                        type !== DiscountType.PERCENT ||
                        (typeof value === 'number' &&
                            value <= DISCOUNT_LIMITS.PERCENT_MAX)
                    );
                },
                defaultMessage() {
                    return `A percent discount cannot exceed ${DISCOUNT_LIMITS.PERCENT_MAX}%`;
                },
            },
        });
    };
}

export class DiscountFields {
    @IsNotEmpty()
    @IsEnum(DiscountType)
    type!: DiscountType;

    /** A whole percent (1-100) for PERCENT, centavos for FIXED. */
    @IsNotEmpty()
    @IsInt()
    // PERCENT_MIN and FIXED_MIN are both 1: one lower bound serves both types.
    @Min(DISCOUNT_LIMITS.PERCENT_MIN)
    @IsPercentInRange()
    value!: number;

    @IsNotEmpty()
    @IsString()
    @MaxLength(STRING_LIMITS.REASON)
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : (value as unknown),
    )
    reason!: string;
}

export class TenderFields {
    @IsNotEmpty()
    @IsEnum(TenderType)
    type!: TenderType;

    /** Centavos handed over (CASH) or transferred (GCASH). */
    @IsNotEmpty()
    @IsInt()
    @Min(NUMERIC_LIMITS.AMOUNT_MIN)
    amount!: number;
}

/**
 * Rejects a reference number on a pure CASH sale, where it would mean
 * nothing and would still take a slot in the unique index.
 */
function IsNotOnCashSale() {
    return function (target: object, propertyName: string) {
        registerDecorator({
            name: 'isNotOnCashSale',
            target: target.constructor,
            propertyName,
            validator: {
                validate(_value: unknown, args: ValidationArguments) {
                    return (
                        (args.object as SellDto).paymentType !==
                        PaymentType.CASH
                    );
                },
                defaultMessage() {
                    return 'A cash sale must not have a reference number';
                },
            },
        });
    };
}

export class SellDto {
    @IsNotEmpty()
    @IsEnum(PaymentType)
    paymentType!: PaymentType;

    /**
     * The GCash reference number: 13 digits. Spaces are stripped first, so
     * the grouping GCash prints (`1234 567 890123`) is accepted.
     */
    // Required for GCASH and SPLIT; on CASH it is only validated (and
    // rejected) when sent.
    @ValidateIf(
        (o: SellDto) =>
            o.paymentType !== PaymentType.CASH ||
            o.referenceNumber !== undefined,
    )
    @IsNotOnCashSale()
    @IsNotEmpty()
    @IsString()
    @MinLength(REFERENCE_NUMBER_LIMITS.MIN_LENGTH)
    @MaxLength(REFERENCE_NUMBER_LIMITS.MAX_LENGTH)
    @Matches(REFERENCE_NUMBER_LIMITS.PATTERN, {
        message: 'referenceNumber must contain digits only',
    })
    @Transform(({ value }) =>
        typeof value === 'string'
            ? normalizeReferenceNumber(value)
            : (value as unknown),
    )
    referenceNumber?: string;

    /**
     * How the customer paid, in centavos. The server checks the tenders
     * against the total it computes and works out the change.
     */
    @IsArray()
    @ArrayNotEmpty()
    @ArrayMaxSize(Object.keys(TenderType).length)
    @ValidateNested({ each: true })
    @Type(() => TenderFields)
    tenders!: TenderFields[];

    @ValidateNested({ each: true })
    @ArrayNotEmpty()
    @Type(() => SellDetailsFields)
    sellDetails!: SellDetailsFields[];

    /** Optional whole-sale discount; the server computes its amount. */
    @IsOptional()
    // Without this an array passes: ValidateNested checks each element.
    @IsObject()
    @IsNotEmptyObject()
    @ValidateNested()
    @Type(() => DiscountFields)
    discount?: DiscountFields;
}

export class ReceiptFields {
    productName!: string;
    quantity!: number;
    /** Centavos. */
    amount!: number;
}

export class ReceiptDiscount {
    type!: DiscountType;
    value!: number;
    reason!: string;
    /** Centavos taken off the subtotal. */
    amount!: number;
}

export class ReceiptDto {
    /** The sale's id, to look it up later. */
    _id!: string;
    createdAt!: Date;
    status!: SaleStatus;
    paymentType!: PaymentType;
    /** Null for a cash sale. */
    referenceNumber!: string | null;
    tenders!: TenderFields[];
    /** Centavos: the sum of the tenders. */
    amountTendered!: number;
    /** Centavos, paid out of the cash tender. */
    changeGiven!: number;
    cashierName!: string;
    items!: ReceiptFields[];
    /** Centavos: the sum of the undiscounted lines. */
    subtotal!: number;
    /** Null when the sale has no discount. */
    discount!: ReceiptDiscount | null;
    /** Centavos: the charged total, `subtotal - discount.amount`. */
    totalAmount!: number;
}

export class GetAllDto {
    @IsPositive()
    @IsNumber()
    @IsNotEmpty()
    page!: number;

    @IsPositive()
    @IsNumber()
    @IsNotEmpty()
    limit!: number;
}

export class ReverseSaleParamDto {
    @IsNotEmpty()
    @IsMongoId()
    id!: string;
}

/** Body of `POST /sales/:id/void` and `POST /sales/:id/refund`. */
export class ReverseSaleDto {
    @IsNotEmpty()
    @IsString()
    @MaxLength(STRING_LIMITS.REASON)
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : (value as unknown),
    )
    reason!: string;
}

export type ReverseSaleInput = ReverseSaleDto & { type: ReversalType };
