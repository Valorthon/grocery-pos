import { describe, it, expect } from 'vitest';
import { presetRange } from './presets';
describe('store-date report presets', () => {
    it('uses the supplied server calendar date instead of the device timezone', () =>
        expect(presetRange('Today', '2026-11-05')).toEqual({
            from: '2026-11-05',
            to: '2026-11-05',
        }));
    it('handles previous leap-day/year boundaries', () => {
        expect(presetRange('Yesterday', '2024-03-01')).toEqual({
            from: '2024-02-29',
            to: '2024-02-29',
        });
        expect(presetRange('Yesterday', '2026-01-01')).toEqual({
            from: '2025-12-31',
            to: '2025-12-31',
        });
    });
    it('uses Monday weeks, including Sunday', () => {
        expect(presetRange('This week', '2026-11-08')).toEqual({
            from: '2026-11-02',
            to: '2026-11-08',
        });
        expect(presetRange('This week', '2026-11-02')).toEqual({
            from: '2026-11-02',
            to: '2026-11-02',
        });
    });
    it('keeps month-to-date and leaves custom dates alone', () => {
        expect(presetRange('This month', '2026-11-05')).toEqual({
            from: '2026-11-01',
            to: '2026-11-05',
        });
        expect(presetRange('Custom', '2026-11-05')).toBeNull();
    });
});
