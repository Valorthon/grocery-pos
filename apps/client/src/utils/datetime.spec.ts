import { describe, expect, it } from 'vitest';
import { formatStoreDateTime, formatStoreTime } from './datetime';

/** ICU may put U+202F or U+00A0 before AM/PM; compare with plain spaces. */
const plain = (text: string) => text.replace(/\s+/g, ' ');

describe('formatStoreDateTime', () => {
    it("puts a UTC instant on the store's (Manila) calendar day", () => {
        // 16:30 UTC on the 24th is 00:30 on the 25th in Manila.
        expect(plain(formatStoreDateTime('2026-09-24T16:30:00.000Z'))).toBe(
            'Sep 25, 2026, 12:30 AM',
        );
        expect(plain(formatStoreTime('2026-09-24T16:30:00.000Z'))).toBe(
            '12:30 AM',
        );
    });

    it('is empty, never "now", for a missing or unreadable value', () => {
        expect(formatStoreDateTime(undefined)).toBe('');
        expect(formatStoreDateTime(null)).toBe('');
        expect(formatStoreDateTime('not a date')).toBe('');
        expect(formatStoreTime(undefined)).toBe('');
    });
});
