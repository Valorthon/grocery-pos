import { receiptCost } from './cost';
import { NUMERIC_LIMITS } from '@grocery-pos/contracts';
describe('latest receipt basis', () => {
    it.each([undefined, null])('keeps absent basis %s unknown', (value) =>
        expect(receiptCost(value)).toBeUndefined(),
    );
    it.each([0, 1, NUMERIC_LIMITS.AMOUNT_MAX])(
        'preserves explicit cost %s exactly',
        (value) => expect(receiptCost(value)).toBe(value),
    );
    it.each([-1, 0.5, NaN, Infinity, '0', {}, NUMERIC_LIMITS.AMOUNT_MAX + 1])(
        'rejects corrupt stored cost %j',
        (value) =>
            expect(() => receiptCost(value)).toThrow(
                'Invalid stored receipt cost',
            ),
    );
});
