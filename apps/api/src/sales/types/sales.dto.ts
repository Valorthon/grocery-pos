import { Transform, Type } from 'class-transformer';
import {
    ArrayNotEmpty,
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
    MaxLength,
    Min,
    ValidateNested,
    ValidationArguments,
    registerDecorator,
} from 'class-validator';
import { DiscountType, PaymentType } from './sales.types';
import {
    DISCOUNT_LIMITS,
    NUMERIC_LIMITS,
    STRING_LIMITS,
} from '../../constants';

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

export class SellDto {
    @IsNotEmpty()
    @IsEnum(PaymentType)
    paymentType!: PaymentType;

    @IsOptional()
    @IsString()
    @MaxLength(STRING_LIMITS.REFERENCE_NUMBER)
    referenceNumber?: string;

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
