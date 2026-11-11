import type { DatePreset } from '@/views/User/Reports/presets';

const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
];

/** "Nov 1" from a YYYY-MM-DD store date, with the year when asked. */
function short(date: string, withYear: boolean): string {
    const [year, month, day] = date.split('-').map(Number);
    const text = `${MONTHS[month - 1] ?? '?'} ${day}`;
    return withYear ? `${text}, ${year}` : text;
}

/**
 * What the date-range button shows (#254): the preset's name, else the
 * range ("Nov 1 – Nov 11", with years when they differ), else "All dates".
 */
export function dateRangeLabel(
    preset: DatePreset | null,
    from: string,
    to: string,
): string {
    if (preset && preset !== 'Custom') return preset;
    if (from && to) {
        const years = from.slice(0, 4) !== to.slice(0, 4);
        return from === to
            ? short(from, false)
            : `${short(from, years)} – ${short(to, years)}`;
    }
    if (from) return `From ${short(from, false)}`;
    if (to) return `Until ${short(to, false)}`;
    return preset === 'Custom' ? 'Custom' : 'All dates';
}
