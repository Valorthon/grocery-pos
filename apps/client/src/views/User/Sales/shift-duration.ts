/** How long a shift has been open, e.g. "2h 05m" or "12m" (#167). */
export function formatShiftDuration(openedAt: string, now: number): string {
    const start = new Date(openedAt).getTime();
    if (Number.isNaN(start)) return '';
    const minutes = Math.max(0, Math.floor((now - start) / 60_000));
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours === 0) return `${rest}m`;
    return `${hours}h ${String(rest).padStart(2, '0')}m`;
}
