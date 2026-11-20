import { describe, expect, it } from 'vitest';
import { offlineClockOffset, offlineSoldAtMs } from './offline-clock.js';

describe('offlineClockOffset', () => {
    it('uses the round-trip midpoint', () => {
        // Terminal 5 minutes slow, 200 ms round trip.
        expect(offlineClockOffset(1000, 1200, 1100 + 300_000)).toBe(300_000);
        expect(offlineClockOffset(5000, 5000, 4000)).toBe(-1000);
    });
});

describe('offlineSoldAtMs', () => {
    const issued = '2026-11-20T00:00:10.500Z';
    const issuedMs = Date.parse(issued);
    it('returns the corrected clock when it is after every floor', () => {
        expect(offlineSoldAtMs(issuedMs + 5000.4, issued, [])).toBe(
            issuedMs + 5000,
        );
    });
    it('never goes before the lease issue time', () => {
        expect(offlineSoldAtMs(issuedMs - 800, issued, [])).toBe(issuedMs);
    });
    it('never goes before a proof iat', () => {
        const iat = Math.floor(issuedMs / 1000) + 2;
        expect(offlineSoldAtMs(issuedMs, issued, [iat - 1, iat])).toBe(
            iat * 1000,
        );
    });
});
