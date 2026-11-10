/** Date presets shared by Reports and every dated list filter (#215). */
export type DatePreset =
    | 'Today'
    | 'Yesterday'
    | 'This week'
    | 'Last week'
    | 'This month'
    | 'Last month'
    | 'Last 30 days'
    | 'Custom';
export const DATE_PRESETS: DatePreset[] = [
    'Today',
    'Yesterday',
    'This week',
    'Last week',
    'This month',
    'Last month',
    'Last 30 days',
    'Custom',
];
export type ReportPreset = DatePreset;
export const REPORT_PRESETS = DATE_PRESETS;
export const DATE_PRESET_OPTIONS = DATE_PRESETS.map((value) => ({
    label: value,
    value,
}));

/**
 * Calendar arithmetic uses the server's store-date string, never
 * device-local midnight. Weeks start on Monday. Never a reversed range.
 */
export function presetRange(
    preset: DatePreset,
    today: string,
): { from: string; to: string } | null {
    if (preset === 'Custom') return null;
    const [year, month, day] = today.split('-').map(Number);
    const at = (y: number, m: number, d: number) =>
        new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
    const weekday =
        (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
    switch (preset) {
        case 'Today':
            return { from: today, to: today };
        case 'Yesterday': {
            const d = at(year, month - 1, day - 1);
            return { from: d, to: d };
        }
        case 'This week':
            return { from: at(year, month - 1, day - weekday), to: today };
        case 'Last week':
            return {
                from: at(year, month - 1, day - weekday - 7),
                to: at(year, month - 1, day - weekday - 1),
            };
        case 'This month':
            return { from: at(year, month - 1, 1), to: today };
        case 'Last month':
            return {
                from: at(year, month - 2, 1),
                to: at(year, month - 1, 0),
            };
        case 'Last 30 days':
            return { from: at(year, month - 1, day - 29), to: today };
    }
}
