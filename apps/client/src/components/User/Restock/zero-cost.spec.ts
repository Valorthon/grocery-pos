import { describe, expect, it } from 'vitest';
import { ZERO_COST_NAMED, zeroCostRequest } from './validation';

const line = (name: string, unitCost: number, EAN = '4800361002516') => ({
    name,
    unitCost,
    EAN,
});

describe('zeroCostRequest (#85)', () => {
    it('asks nothing when every line has a cost', () => {
        expect(zeroCostRequest([line('Milk', 1250)])).toBeNull();
        expect(zeroCostRequest([])).toBeNull();
    });

    it('names the one ₱0 line, in the singular', () => {
        expect(
            zeroCostRequest([line('Milk', 1250), line('Sample', 0)]),
        ).toEqual({
            title: 'Record at ₱0 cost?',
            message: '1 line has a ₱0 unit cost: Sample. Record it at ₱0 cost?',
            confirmLabel: 'Record at ₱0',
            cancelLabel: 'Go back',
        });
    });

    it('names several in the plural, falling back to the barcode', () => {
        expect(
            zeroCostRequest([line('Sample', 0), line('  ', 0, '4006381333931')])
                ?.message,
        ).toBe(
            '2 lines have a ₱0 unit cost: Sample, 4006381333931. Record them at ₱0 cost?',
        );
    });

    it('names a few and counts the rest', () => {
        const lines = Array.from({ length: ZERO_COST_NAMED + 2 }, (_, i) =>
            line(`P${i + 1}`, 0),
        );
        expect(zeroCostRequest(lines)?.message).toBe(
            '7 lines have a ₱0 unit cost: P1, P2, P3, P4, P5 and 2 more. Record them at ₱0 cost?',
        );
    });
});
