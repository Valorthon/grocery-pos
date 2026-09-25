import { describe, expect, it } from 'vitest';
import { formatStoreDateTime } from './datetime';

describe('formatStoreDateTime', () => {
    it("puts a UTC instant on the store's (Manila) calendar day", () => {
        // 16:30 UTC on the 24th is 00:30 on the 25th in Manila.
        expect(formatStoreDateTime('2026-09-24T16:30:00.000Z')).toBe(
            'Sep 25, 2026, 12:30 AM',
        );
    });

    it('is empty, never "now", for a missing or unreadable value', () => {
        expect(formatStoreDateTime(undefined)).toBe('');
        expect(formatStoreDateTime(null)).toBe('');
        expect(formatStoreDateTime('not a date')).toBe('');
    });
});
