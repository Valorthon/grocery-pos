import { describe, expect, it } from 'vitest';
import { offlineSaleNumber, REPORT_LIMITS } from './reports.js';

describe('offlineSaleNumber (#416)', () => {
    it('is the last 8 of the client receipt id, upper case', () => {
        const n = offlineSaleNumber('11ff62e4-9076-4ebd-afc6-ab17bec8a876');
        expect(n).toBe('BEC8A876');
        expect(REPORT_LIMITS.SALE_SEARCH.test(n)).toBe(true);
    });
});
