import { describe, it, expect } from 'vitest';
import { DATE_PRESETS, presetRange } from './presets';
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
describe('presets added in #215', () => {
    it('offers the eight presets in order', () =>
        expect(DATE_PRESETS).toEqual([
            'Today',
            'Yesterday',
            'This week',
            'Last week',
            'This month',
            'Last month',
            'Last 30 days',
            'Custom',
        ]));
    it('last week is the previous Monday-to-Sunday, also from a Sunday and across a year', () => {
        expect(presetRange('Last week', '2026-11-10')).toEqual({
            from: '2026-11-02',
            to: '2026-11-08',
        });
        expect(presetRange('Last week', '2026-11-08')).toEqual({
            from: '2026-10-26',
            to: '2026-11-01',
        });
        expect(presetRange('Last week', '2026-01-02')).toEqual({
            from: '2025-12-22',
            to: '2025-12-28',
        });
    });
    it('last month is the whole previous month, including February and January', () => {
        expect(presetRange('Last month', '2024-03-31')).toEqual({
            from: '2024-02-01',
            to: '2024-02-29',
        });
        expect(presetRange('Last month', '2026-01-15')).toEqual({
            from: '2025-12-01',
            to: '2025-12-31',
        });
    });
    it('last 30 days includes today and crosses month ends', () => {
        expect(presetRange('Last 30 days', '2026-03-01')).toEqual({
            from: '2026-01-31',
            to: '2026-03-01',
        });
    });
    it('this month on the first is a single day', () =>
        expect(presetRange('This month', '2026-11-01')).toEqual({
            from: '2026-11-01',
            to: '2026-11-01',
        }));
});
