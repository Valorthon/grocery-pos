import { describe, expect, it } from 'vitest';
import {
    PurchaseOrderStatus,
    draftSendBlockers,
    purchaseOrderReference,
    type PurchaseOrderView,
} from './purchase-order.js';

const line = (name: string, productActive: boolean) =>
    ({ name, EAN: '1', productActive }) as PurchaseOrderView['lines'][number];

describe('purchase order helpers', () => {
    it('makes a short readable reference', () => {
        expect(purchaseOrderReference('507f1f77bcf86cd799439abc')).toBe(
            'PO-99439ABC',
        );
    });
    it('names what blocks sending a draft, and nothing otherwise', () => {
        const draft = {
            status: PurchaseOrderStatus.DRAFT,
            supplier: { _id: 's', name: 'Farm', isActive: false },
            lines: [line('rice', false), line('soap', true), line('', false)],
        };
        expect(draftSendBlockers(draft)).toEqual([
            'Supplier Farm is archived.',
            'Archived products: rice, 1.',
        ]);
        expect(
            draftSendBlockers({
                ...draft,
                lines: [line('rice', false)],
                supplier: null,
            }),
        ).toEqual(['Archived product: rice.']);
        expect(
            draftSendBlockers({ ...draft, status: PurchaseOrderStatus.SENT }),
        ).toEqual([]);
    });
});
