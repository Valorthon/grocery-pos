import { describe, expect, it } from 'vitest';
import { ErrorCode } from './errors.js';

describe('ErrorCode', () => {
    const entries = Object.entries(ErrorCode);

    it('gives every code its own wire value', () => {
        // The client tells errors apart by this string (apiErrorCode): two
        // names sharing one would make it act on the wrong error, e.g.
        // treat a duplicate reference as a sale in progress.
        const values = entries.map(([, value]) => value);
        expect(new Set(values).size).toBe(values.length);
    });

    it('names each value after its area: AREA_nnn, with the name in that area', () => {
        // Keeps the codes greppable, and catches a code filed under the
        // wrong area (e.g. a SALE_ name answering SHIFT_001).
        for (const [name, value] of entries) {
            expect(value).toMatch(/^[A-Z]+(?:_[A-Z]+)*_\d{3}$/);
            const area = value.replace(/_\d{3}$/, '');
            expect(name.startsWith(area)).toBe(true);
        }
    });
});
