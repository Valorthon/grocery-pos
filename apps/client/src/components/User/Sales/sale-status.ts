import { PaymentType, SaleStatus } from '@grocery-pos/contracts';
import type { StatusMap } from '@/components/ui/status-badge';
import { enumHelp, statusHelp } from '@/components/ui/column-help';
import type { ColumnHelp } from '@/components/ui/types';

/** A sale's status badge: voided red, refunded amber (#243). */
export const SALE_STATUS: StatusMap<SaleStatus> = {
    [SaleStatus.COMPLETED]: { label: 'Completed', color: 'success' },
    [SaleStatus.VOIDED]: { label: 'Voided', color: 'error' },
    [SaleStatus.REFUNDED]: { label: 'Refunded', color: 'warning' },
};

/** Column help for sales lists (#263): Sales history and the dashboard. */
export const SALE_HELP = {
    amount: 'The charged total, after any discount.',
    payment: enumHelp<PaymentType>({
        [PaymentType.CASH]: 'Paid in cash.',
        [PaymentType.GCASH]:
            'Paid by GCash, with a reference number of 13 digits.',
        [PaymentType.SPLIT]: 'Part cash, part GCash.',
    }),
    status: [
        ...statusHelp(SALE_STATUS, {
            [SaleStatus.COMPLETED]: 'Sold and counted as revenue.',
            [SaleStatus.VOIDED]:
                'Reversed as a mis-ring: stock put back, any cash paid out of a drawer.',
            [SaleStatus.REFUNDED]:
                'Reversed as a customer return: stock put back, any cash paid out of a drawer.',
        }),
        {
            term: 'Revenue',
            meaning: "Voided and refunded sales don't count as revenue.",
        },
    ],
} satisfies Record<string, ColumnHelp>;
