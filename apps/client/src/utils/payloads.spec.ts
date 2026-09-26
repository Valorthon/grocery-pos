import { describe, expect, it } from 'vitest';
import { DiscountType } from '@grocery-pos/contracts';
import {
    newProductLines,
    toAdjustmentBody,
    toChangePasswordBody,
    toEnsureValidQuery,
    toNewProductsBody,
    toRestockBody,
    toSaleTicket,
    type ProductDraft,
    type RestockDraft,
} from './payloads';

// The API's e2e specs post these same shapes (issue #33):
// apps/api/src/product/product.payloads.e2e.spec.ts and
// apps/api/src/inventory-man/inventory-payloads.e2e.spec.ts.

const PRODUCT = '507f1f77bcf86cd799439011';

/** A draft as the product dialog emits it, barcode typed. */
const typed: ProductDraft = {
    EAN: '4006381333931',
    name: 'Bread',
    price: 1999,
    autoGenerateEAN: false,
};

/** Auto-generate ticked after typing "abc": the stale value stays in the form. */
const autoWithStaleEAN: ProductDraft = {
    EAN: 'abc',
    name: 'Milk',
    price: 5000,
    autoGenerateEAN: true,
};

describe('toEnsureValidQuery (GET /products/ensureValid)', () => {
    it('sends exactly EAN, name and autoGenerateEAN', () => {
        expect(toEnsureValidQuery(typed)).toEqual({
            EAN: '4006381333931',
            name: 'Bread',
            autoGenerateEAN: false,
        });
    });

    it('omits the EAN when auto-generating, even a stale typed one', () => {
        const query = toEnsureValidQuery(autoWithStaleEAN);

        expect(query).toEqual({ name: 'Milk', autoGenerateEAN: true });
        expect(query).not.toHaveProperty('EAN');
    });

    it('drops the rest of the restock form (price, quantity, unitCost, ...)', () => {
        const form = {
            ...typed,
            quantity: 3,
            unitCost: 10,
            isNewProduct: true,
            product: '',
            price: 19.99,
        };

        expect(Object.keys(toEnsureValidQuery(form)).sort()).toEqual([
            'EAN',
            'autoGenerateEAN',
            'name',
        ]);
    });
});

describe('toNewProductsBody (POST /products/bulk)', () => {
    it('sends only EAN, name and price per product, never autoGenerateEAN', () => {
        expect(toNewProductsBody([typed, autoWithStaleEAN])).toEqual({
            newProducts: [
                { EAN: '4006381333931', name: 'Bread', price: 1999 },
                { name: 'Milk', price: 5000 },
            ],
        });
    });

    it('omits the EAN key entirely when auto-generating', () => {
        const [line] = toNewProductsBody([autoWithStaleEAN]).newProducts;

        expect(Object.keys(line!).sort()).toEqual(['name', 'price']);
    });
});

describe('toRestockBody (POST /restocks)', () => {
    const existing: RestockDraft = {
        isNewProduct: false,
        product: PRODUCT,
        EAN: '4006381333931',
        name: 'bread',
        autoGenerateEAN: false,
        quantity: 3,
        unitCost: 1000,
        price: 0,
    };
    const created: RestockDraft = {
        ...autoWithStaleEAN,
        isNewProduct: true,
        product: '',
        quantity: 2,
        unitCost: 3500,
    };

    it('sends an existing product line as product, quantity and unitCost', () => {
        const { restockDetails } = toRestockBody([existing], 'delivery');

        expect(restockDetails).toEqual([
            { product: PRODUCT, quantity: 3, unitCost: 1000 },
        ]);
    });

    it('sends a new product line as newProduct, without a stale EAN', () => {
        expect(toRestockBody([created], 'delivery')).toEqual({
            restockDetails: [
                {
                    newProduct: { name: 'Milk', price: 5000 },
                    quantity: 2,
                    unitCost: 3500,
                },
            ],
            description: 'delivery',
        });
    });

    it('keeps a typed barcode on a new product', () => {
        const { restockDetails } = toRestockBody(
            [{ ...created, ...typed }],
            'delivery',
        );

        expect(restockDetails[0]).toEqual({
            newProduct: { EAN: '4006381333931', name: 'Bread', price: 1999 },
            quantity: 2,
            unitCost: 3500,
        });
    });
});

describe('toAdjustmentBody (POST /adjustments)', () => {
    it('sends only product, change and reason per line, not EAN or name', () => {
        const draft = {
            EAN: '4006381333931',
            name: 'bread',
            product: PRODUCT,
            change: -2,
            reason: 'damaged',
        };

        expect(toAdjustmentBody([draft], 'weekly count')).toEqual({
            adjustDetails: [
                { product: PRODUCT, change: -2, reason: 'damaged' },
            ],
            description: 'weekly count',
        });
    });
});

describe('newProductLines', () => {
    it('lists the draft line of each new product, in insert order', () => {
        expect(
            newProductLines([
                { isNewProduct: false },
                { isNewProduct: true },
                { isNewProduct: false },
                { isNewProduct: true },
            ]),
        ).toEqual([1, 3]);
    });
});

describe('draft row ids (issue #19)', () => {
    it('never reach a request body', () => {
        const draftId = 'draft-7';
        const product = { ...typed, draftId };
        const restock = {
            ...autoWithStaleEAN,
            isNewProduct: true as const,
            quantity: 2,
            unitCost: 3500,
            draftId,
        };
        const existing = {
            ...typed,
            isNewProduct: false as const,
            product: PRODUCT,
            quantity: 1,
            unitCost: 100,
            draftId,
        };
        const adjustment = {
            EAN: '4006381333931',
            name: 'bread',
            product: PRODUCT,
            change: 1,
            reason: 'recount',
            draftId,
        };

        const bodies = [
            toEnsureValidQuery(product),
            toNewProductsBody([product]),
            toRestockBody([restock, existing], 'delivery'),
            toAdjustmentBody([adjustment], 'count'),
        ];
        for (const body of bodies) {
            expect(JSON.stringify(body)).not.toContain(draftId);
        }
    });
});

describe('toSaleTicket (POST /sales ticket, #23)', () => {
    const lines = [
        {
            product: PRODUCT,
            EAN: '4006381333931',
            name: 'Bread',
            unitPrice: 1999,
            quantity: 2,
        },
        {
            product: '507f1f77bcf86cd799439012',
            EAN: '1',
            name: 'Milk',
            unitPrice: 5000,
            quantity: 1,
        },
    ];

    it('sends exactly product and quantity per line, and no discount key without one', () => {
        const body = toSaleTicket(lines, null);
        expect(body).toEqual({
            sellDetails: [
                { product: PRODUCT, quantity: 2 },
                { product: '507f1f77bcf86cd799439012', quantity: 1 },
            ],
        });
        expect(body).not.toHaveProperty('discount');
    });

    it('sends a FIXED discount as type, centavos and trimmed reason only', () => {
        const body = toSaleTicket(lines, {
            type: DiscountType.FIXED,
            value: 1500,
            reason: '  damaged box ',
        });
        expect(body.discount).toEqual({
            type: DiscountType.FIXED,
            value: 1500,
            reason: 'damaged box',
        });
        expect(Object.keys(body).sort()).toEqual(['discount', 'sellDetails']);
    });

    it('sends a PERCENT discount as a whole percent', () => {
        expect(
            toSaleTicket(lines, {
                type: DiscountType.PERCENT,
                value: 10,
                reason: 'senior',
            }).discount,
        ).toEqual({ type: DiscountType.PERCENT, value: 10, reason: 'senior' });
    });
});

describe('toChangePasswordBody (PATCH /users/me/password, #88)', () => {
    it('sends exactly currentPassword and newPassword, untrimmed, never the confirmation', () => {
        const body = toChangePasswordBody({
            currentPassword: ' old secret ',
            newPassword: ' new secret ',
            confirmPassword: ' new secret ',
        });

        expect(body).toEqual({
            currentPassword: ' old secret ',
            newPassword: ' new secret ',
        });
        expect(Object.keys(body).sort()).toEqual([
            'currentPassword',
            'newPassword',
        ]);
    });
});
