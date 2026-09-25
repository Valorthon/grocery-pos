/**
 * The store's timezone. The API's `STORE_TIMEZONE` defaults to the same
 * zone and decides its day boundaries; the client shows times in it too,
 * so a receipt reads the same on any device. Store settings (#47) may make
 * it configurable.
 */
export const STORE_TIME_ZONE = 'Asia/Manila';

const dateTime = new Intl.DateTimeFormat('en-PH', {
    timeZone: STORE_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
});

/**
 * An ISO timestamp as a date and time in the store's timezone, e.g.
 * "Sep 25, 2026, 8:05 AM". Empty for a missing or unreadable value, never
 * the current time.
 */
export function formatStoreDateTime(iso: string | null | undefined): string {
    if (!iso) return '';
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : dateTime.format(date);
}

const time = new Intl.DateTimeFormat('en-PH', {
    timeZone: STORE_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
});

/** An ISO timestamp as a time of day in the store's timezone, e.g. "8:05 AM". */
export function formatStoreTime(iso: string | null | undefined): string {
    if (!iso) return '';
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : time.format(date);
}
