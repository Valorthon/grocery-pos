import { describe, expect, it } from 'vitest';
import {
    PaymentType,
    PurchaseOrderStatus,
    Role,
    SaleStatus,
    ShiftStatus,
    StockCountStatus,
    StockMovementType,
    ASSIGNABLE_ROLES,
} from '@grocery-pos/contracts';
import type { HelpItem } from '@/components/ui/types';
import {
    PURCHASE_ORDER_HELP,
    PURCHASE_ORDER_STATUS,
} from '@/components/User/PurchaseOrder/purchase-order';
import { SALE_HELP, SALE_STATUS } from '@/components/User/Sales/sale-status';
import {
    BATCH_HELP,
    BATCH_STATUS,
    INVENTORY_HELP,
    STOCK_HISTORY_HELP,
    STOCK_STATUS,
} from '@/components/User/Inventory/inventory-help';
import {
    STOCK_COUNT_HELP,
    STOCK_COUNT_STATUS,
} from './StockCounts/stock-count-help';
import {
    PRODUCT_HELP,
    PRODUCT_STATUS,
    SHIFT_HELP,
    SHIFT_STATUS,
    USER_HELP,
} from './list-help';

const terms = (help: HelpItem[]) => help.map((item) => item.term);
const labels = (map: Record<string, { label: string }>) =>
    Object.values(map).map((entry) => entry.label);

describe('column help lists every value (#263)', () => {
    it.each([
        [
            'purchase order',
            PURCHASE_ORDER_HELP.status,
            PURCHASE_ORDER_STATUS,
            PurchaseOrderStatus,
        ],
        [
            'stock count',
            STOCK_COUNT_HELP.status,
            STOCK_COUNT_STATUS,
            StockCountStatus,
        ],
        ['shift', SHIFT_HELP.status, SHIFT_STATUS, ShiftStatus],
    ] as const)(
        '%s status, from its badge map and enum',
        (_, help, map, values) => {
            expect(terms(help)).toEqual(labels(map));
            expect(help).toHaveLength(Object.values(values).length);
            for (const item of help) expect(item.meaning).not.toBe('');
        },
    );

    it('sale status (plus the revenue note) and payment type', () => {
        expect(terms(SALE_HELP.status)).toEqual([
            ...labels(SALE_STATUS),
            'Revenue',
        ]);
        expect(SALE_HELP.status).toHaveLength(
            Object.values(SaleStatus).length + 1,
        );
        expect(terms(SALE_HELP.payment).sort()).toEqual(
            Object.values(PaymentType).sort(),
        );
    });

    it('stock movement type, as shown raw, plus derived history', () => {
        expect(terms(STOCK_HISTORY_HELP.type)).toEqual([
            ...Object.values(StockMovementType),
            '(derived history)',
        ]);
    });

    it('batch expiry, inventory and product status', () => {
        expect(terms(BATCH_HELP.expiry)).toEqual(labels(BATCH_STATUS));
        expect(terms(INVENTORY_HELP.status)).toEqual(labels(STOCK_STATUS));
        // Below sm the status sits under Stock, so Stock explains it too.
        expect(terms(INVENTORY_HELP.stock)).toEqual([
            'Stock',
            ...labels(STOCK_STATUS),
        ]);
        expect(terms(PRODUCT_HELP.status)).toEqual(labels(PRODUCT_STATUS));
    });

    it('purchase order Ordered and Expected cost (#288)', () => {
        expect(PURCHASE_ORDER_HELP.ordered).toBe(
            "How much you're ordering from the supplier, in the product's unit. Stock doesn't change until you receive it.",
        );
        expect(PURCHASE_ORDER_HELP.expectedCost).toBe(
            'What you expect to pay per unit. Prefilled from the latest receipt; you confirm the real cost when receiving.',
        );
    });

    it('every assignable role, as shown raw', () => {
        expect(terms(USER_HELP.roles).sort()).toEqual(
            [...ASSIGNABLE_ROLES].sort(),
        );
        expect(terms(USER_HELP.roles)).not.toContain(Role.Unauthenticated);
    });
});
