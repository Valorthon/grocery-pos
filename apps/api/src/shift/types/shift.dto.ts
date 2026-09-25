import { Transform } from 'class-transformer';
import {
    IsEnum,
    IsIn,
    IsInt,
    IsMongoId,
    IsNotEmpty,
    IsOptional,
    IsString,
    Max,
    MaxLength,
    Min,
    registerDecorator,
} from 'class-validator';
import {
    type BillCounts,
    CASHIER_DRAWER_MOVEMENTS,
    type CashierDrawerMovement,
    isDenomination,
    SHIFT_LIMITS,
    ShiftStatus,
} from '@grocery-pos/contracts';
import { NUMERIC_LIMITS, STRING_LIMITS, PAGINATION } from '../../constants';

/**
 * A drawer count: a plain object of denomination id (see
 * `CASH_DENOMINATIONS`) to a whole number of pieces, 0 to PIECES_MAX. The
 * server adds it up itself; the client never sends a total.
 */
export function IsBillCounts() {
    return function (target: object, propertyName: string) {
        registerDecorator({
            name: 'isBillCounts',
            target: target.constructor,
            propertyName,
            validator: {
                validate(value: unknown) {
                    if (
                        typeof value !== 'object' ||
                        value === null ||
                        Array.isArray(value)
                    ) {
                        return false;
                    }
                    return Object.entries(value).every(
                        ([id, pieces]) =>
                            isDenomination(id) &&
                            Number.isInteger(pieces) &&
                            (pieces as number) >= 0 &&
                            (pieces as number) <= SHIFT_LIMITS.PIECES_MAX,
                    );
                },
                defaultMessage() {
                    return `${propertyName} must map known denominations to whole numbers of pieces (0-${SHIFT_LIMITS.PIECES_MAX})`;
                },
            },
        });
    };
}

/** Body of `POST /shifts`: the opening float, counted. */
export class OpenShiftDto {
    @IsNotEmpty()
    @IsBillCounts()
    counts!: BillCounts;
}

/**
 * Body of `POST /shifts/current/close` and `POST /shifts/:id/close`: the
 * blind closing count.
 */
export class CloseShiftDto {
    @IsNotEmpty()
    @IsBillCounts()
    counts!: BillCounts;
}

/** Body of `POST /shifts/current/drawer`. */
export class DrawerMovementDto {
    @IsNotEmpty()
    @IsIn(CASHIER_DRAWER_MOVEMENTS)
    type!: CashierDrawerMovement;

    /** Centavos. */
    @IsNotEmpty()
    @IsInt()
    @Min(NUMERIC_LIMITS.AMOUNT_MIN)
    @Max(NUMERIC_LIMITS.AMOUNT_MAX)
    amount!: number;

    @IsNotEmpty()
    @IsString()
    @MaxLength(STRING_LIMITS.REASON)
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : (value as unknown),
    )
    reason!: string;
}

/** Query of `GET /shifts`. */
export class ListShiftsDto {
    @IsInt()
    @Min(1)
    @Max(PAGINATION.PAGE_MAX)
    page!: number;

    @IsInt()
    @Min(1)
    @Max(PAGINATION.LIMIT_MAX)
    limit!: number;

    @IsOptional()
    @IsEnum(ShiftStatus)
    status?: ShiftStatus;
}

export class ShiftIdParamDto {
    @IsNotEmpty()
    @IsMongoId()
    id!: string;
}
