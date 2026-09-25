import {
    DrawerMovementType,
    PaymentType,
    SaleStatus,
    saleNetCash,
    TenderType,
    type ZReadReport,
} from '@grocery-pos/contracts';

/** The fields of a sale the Z-read reads. */
export interface ShiftSale {
    amount: number;
    paymentType: PaymentType;
    tenders?: { type: TenderType; amount: number }[] | null;
    changeGiven?: number | null;
    status?: SaleStatus | null;
    discount?: { amount: number } | null;
}

/** The fields of a shift the Z-read reads. */
export interface ShiftLedger {
    openingFloat: number;
    movements: { type: DrawerMovementType; amount: number }[];
}

export type ZReadFigures = Pick<ZReadReport, 'sales' | 'tenders' | 'drawer'>;

function sumOf(
    movements: ShiftLedger['movements'],
    type: DrawerMovementType,
): { count: number; amount: number } {
    return movements
        .filter((m) => m.type === type)
        .reduce(
            (acc, m) => ({
                count: acc.count + 1,
                amount: acc.amount + m.amount,
            }),
            { count: 0, amount: 0 },
        );
}

/**
 * The money figures of a shift's Z-read, from its drawer movements and every
 * sale rung into it (reversed ones included), all in centavos.
 *
 * Expected cash is what should be in the drawer:
 *
 *   openingFloat + cash in - cash drops
 *   + net cash of every sale rung in the shift (cash tender - change)
 *   - reversal payouts charged to this shift
 *
 * A sale is counted in full even if it was later voided or refunded: the
 * cash it brought in did enter this drawer, and the payout that handed it
 * back is a movement on whichever shift paid it (this one while it was
 * open, so the two cancel; another open shift if this one had closed).
 */
export function computeZRead(
    shift: ShiftLedger,
    sales: ShiftSale[],
    countedCash: number,
): ZReadFigures {
    let gross = 0;
    let cash = 0;
    let gcash = 0;
    const discounts = { count: 0, amount: 0 };
    const voids = { count: 0, amount: 0 };
    const refunds = { count: 0, amount: 0 };

    for (const sale of sales) {
        gross += sale.amount;
        const saleCash = saleNetCash(sale);
        cash += saleCash;
        // Whatever the cash did not pay was paid by GCash.
        gcash += sale.amount - saleCash;

        if (sale.discount?.amount) {
            discounts.count += 1;
            discounts.amount += sale.discount.amount;
        }
        if (sale.status === SaleStatus.VOIDED) {
            voids.count += 1;
            voids.amount += sale.amount;
        } else if (sale.status === SaleStatus.REFUNDED) {
            refunds.count += 1;
            refunds.amount += sale.amount;
        }
    }

    const cashIn = sumOf(shift.movements, DrawerMovementType.CASH_IN).amount;
    const cashDrops = sumOf(
        shift.movements,
        DrawerMovementType.CASH_DROP,
    ).amount;
    const reversalPayouts = sumOf(
        shift.movements,
        DrawerMovementType.REVERSAL_PAYOUT,
    );

    const expectedCash =
        shift.openingFloat + cashIn - cashDrops + cash - reversalPayouts.amount;

    return {
        sales: {
            count: sales.length,
            gross,
            discounts,
            voids,
            refunds,
            net: gross - voids.amount - refunds.amount,
        },
        tenders: { cash, gcash },
        drawer: {
            openingFloat: shift.openingFloat,
            cashIn,
            cashDrops,
            reversalPayouts,
            expectedCash,
            countedCash,
            overShort: countedCash - expectedCash,
        },
    };
}
