import { storePresentation } from '@/settings/presentation';
export const STORE_TIME_ZONE = 'Asia/Manila'; // legacy fallback only
export function formatStoreDateTime(
    iso: string | null | undefined,
    timezone = storePresentation.value.timezone,
): string {
    if (!iso) return '';
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
        ? ''
        : new Intl.DateTimeFormat('en-PH', {
              timeZone: timezone,
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
          }).format(date);
}
export function formatStoreTime(
    iso: string | null | undefined,
    timezone = storePresentation.value.timezone,
): string {
    if (!iso) return '';
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
        ? ''
        : new Intl.DateTimeFormat('en-PH', {
              timeZone: timezone,
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
          }).format(date);
}
