import { describe, expect, it } from 'vitest';
import * as contracts from './index.js';
import {
    MONGOOSE_INTERNAL_KEYS,
    type WireShape,
    wireShapeDiff,
} from './wire-shape.js';

interface Sample {
    id: string;
    note?: string;
    parent: string | null;
}

const SAMPLE_SHAPE: WireShape<Sample> = {
    id: 'required',
    note: 'optional',
    parent: 'required',
};

describe('wireShapeDiff', () => {
    it('matches a value with every required key and only known keys', () => {
        expect(wireShapeDiff({ id: 'a', parent: null }, SAMPLE_SHAPE)).toEqual({
            missing: [],
            unexpected: [],
        });
        expect(
            wireShapeDiff({ id: 'a', note: 'n', parent: 'b' }, SAMPLE_SHAPE),
        ).toEqual({ missing: [], unexpected: [] });
    });

    it('reports a missing required key and an unexpected key, sorted', () => {
        // A renamed field is both: the old name missing, the new one extra.
        expect(
            wireShapeDiff({ ID: 'a', zeta: 1, alpha: 2 }, SAMPLE_SHAPE),
        ).toEqual({
            missing: ['id', 'parent'],
            unexpected: ['ID', 'alpha', 'zeta'],
        });
    });

    it("ignores Mongoose's version key by default, and only what it is told to", () => {
        const doc = { id: 'a', parent: null, __v: 0 };
        expect(MONGOOSE_INTERNAL_KEYS).toEqual(['__v']);
        expect(wireShapeDiff(doc, SAMPLE_SHAPE).unexpected).toEqual([]);
        expect(wireShapeDiff(doc, SAMPLE_SHAPE, []).unexpected).toEqual([
            '__v',
        ]);
    });

    it('treats a non-object as missing every required key', () => {
        for (const value of [null, undefined, 'id', 3, [{ id: 'a' }]]) {
            expect(wireShapeDiff(value, SAMPLE_SHAPE)).toEqual({
                missing: ['id', 'parent'],
                unexpected: [],
            });
        }
    });
});

describe('exported wire shapes', () => {
    const shapes = Object.entries(contracts).filter(([name]) =>
        name.endsWith('_SHAPE'),
    );

    it('are exported for the wire types', () => {
        expect(shapes.map(([name]) => name)).toEqual(
            expect.arrayContaining([
                'RECEIPT_SHAPE',
                'SALE_ROW_SHAPE',
                'Z_READ_REPORT_SHAPE',
                'DASHBOARD_VIEW_SHAPE',
                'APP_ERROR_RESPONSE_SHAPE',
                'PAGINATED_SHAPE',
            ]),
        );
    });

    it('mark every key required or optional', () => {
        for (const [, shape] of shapes) {
            for (const need of Object.values(shape as object)) {
                expect(['required', 'optional']).toContain(need);
            }
        }
    });

    it('keep the ADMIN-only dashboard keys optional', () => {
        for (const key of contracts.DASHBOARD_MONEY_KEYS) {
            expect(contracts.DASHBOARD_VIEW_SHAPE[key]).toBe('optional');
        }
        expect(contracts.RESTOCK_ACTIVITY_SHAPE.totalCost).toBe('optional');
    });
});
