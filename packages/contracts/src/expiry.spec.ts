import { describe, expect, it } from 'vitest';
import {
    EXPIRY_LIMITS,
    INVENTORY_BATCH_SHAPE,
    isExpiryDate,
} from './expiry.js';
import { wireShapeDiff } from './wire-shape.js';
describe('expiry calendar dates', () => {
    it.each(['2026-01-01', '2024-02-29', '2000-02-29', '2026-12-31'])(
        'accepts real calendar date %s',
        (date) => expect(isExpiryDate(date)).toBe(true),
    );
    it.each([
        undefined,
        null,
        1,
        '',
        '2026-2-01',
        '2026-02-30',
        '2026-02-29',
        '1900-02-29',
        '2026-13-01',
        '2026-00-01',
        '2026-01-00',
        '2026-01-32',
        '2026-01-01T00:00:00Z',
        ' 2026-01-01',
        '2026-01-01 ',
    ])('rejects invalid receipt date %s', (date) =>
        expect(isExpiryDate(date)).toBe(false),
    );
    it('defines bounded list and batch-label inputs and complete wire keys', () => {
        expect(EXPIRY_LIMITS).toEqual({
            BATCH_NO: 80,
            DAYS_MAX: 365,
            DEFAULT_DAYS: 7,
        });
        expect(
            wireShapeDiff(
                {
                    _id: 'b',
                    product: {},
                    receivedQty: 0,
                    remainingQty: -1,
                    reconciliation: true,
                    createdAt: 'now',
                    updatedAt: 'now',
                },
                INVENTORY_BATCH_SHAPE,
            ),
        ).toEqual({ missing: [], unexpected: [] });
    });
});
