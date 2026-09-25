import { SalesSchema } from './sales.schema';

/** The index keys a schema declares, options dropped. */
function keysOf(schema: typeof SalesSchema) {
    return schema.indexes().map(([keys]) => keys);
}

describe('Sales indexes (issue #16)', () => {
    it('serves the admin list and the dashboard’s day match, newest first', () => {
        expect(keysOf(SalesSchema)).toContainEqual({ createdAt: -1 });
    });

    it('serves the admin’s cashier filter with the sort', () => {
        expect(keysOf(SalesSchema)).toContainEqual({
            cashier: 1,
            createdAt: -1,
        });
    });

    it('serves a seller’s shift scope, and the Z-read’s find by shift, with the sort', () => {
        expect(keysOf(SalesSchema)).toContainEqual({
            shift: 1,
            createdAt: -1,
        });
    });

    it('drops the single-field shift index the compound one makes redundant', () => {
        expect(keysOf(SalesSchema)).not.toContainEqual({ shift: 1 });
    });

    it('keeps the unique partial indexes on reference number and idempotency key', () => {
        const unique = SalesSchema.indexes().filter(
            ([, options]) => options?.unique,
        );

        expect(unique).toEqual([
            [
                { referenceNumber: 1 },
                expect.objectContaining({
                    partialFilterExpression: {
                        referenceNumber: { $type: 'string' },
                    },
                }),
            ],
            [
                { idempotencyKey: 1 },
                expect.objectContaining({
                    partialFilterExpression: {
                        idempotencyKey: { $type: 'string' },
                    },
                }),
            ],
        ]);
    });
});
