import { describe, expect, it } from 'vitest';
import {
    ErrorCode,
    offlineTerminalSuffix,
    shiftOtherTerminalMessage,
    TERMINAL_ID_PATTERN,
} from './errors.js';

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

describe('offlineTerminalSuffix (#454)', () => {
    it('shows the last 8 characters, upper case', () => {
        expect(
            offlineTerminalSuffix('3f2a1b4c-0000-4000-8000-00ab12cd34ef'),
        ).toBe('12CD34EF');
        expect(offlineTerminalSuffix('abc')).toBe('ABC');
    });
});

describe('shift terminal binding (#509)', () => {
    it('words the other-terminal refusal as the owner approved', () => {
        expect(shiftOtherTerminalMessage('Lane 2')).toBe(
            'Your shift is open on Lane 2. Close it there, or ask an admin to force-close.',
        );
    });

    it('accepts a UUID terminal id and refuses blanks or symbols', () => {
        expect(TERMINAL_ID_PATTERN.test(crypto.randomUUID())).toBe(true);
        expect(TERMINAL_ID_PATTERN.test('')).toBe(false);
        expect(TERMINAL_ID_PATTERN.test('lane 1!')).toBe(false);
    });
});
