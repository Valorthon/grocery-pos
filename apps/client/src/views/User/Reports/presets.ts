export type ReportPreset =
    'Today' | 'Yesterday' | 'This week' | 'This month' | 'Custom';
export const REPORT_PRESETS: ReportPreset[] = [
    'Today',
    'Yesterday',
    'This week',
    'This month',
    'Custom',
];
/** Calendar arithmetic uses the server's store-date string, never device-local midnight. */
export function presetRange(
    preset: ReportPreset,
    today: string,
): { from: string; to: string } | null {
    if (preset === 'Custom') return null;
    const [year, month, day] = today.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    if (preset === 'Yesterday') {
        date.setUTCDate(date.getUTCDate() - 1);
        return { from: iso(date), to: iso(date) };
    }
    if (preset === 'This week')
        date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    if (preset === 'This month') date.setUTCDate(1);
    return { from: iso(date), to: today };
}
