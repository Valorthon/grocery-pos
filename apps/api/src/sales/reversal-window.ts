import { SELLER_REVERSAL_WINDOW_DAYS } from '@grocery-pos/contracts';
import {
    addDays,
    calendarDateInZone,
    startOfDayInZone,
} from '../common/utils/timezone';

/**
 * The first instant a SELLER may reverse (#526): the start of the store
 * day `SELLER_REVERSAL_WINDOW_DAYS - 1` days before today, so the window
 * is today plus the 29 store days before it.
 */
export function sellerReversalCutoff(timeZone: string, now = new Date()): Date {
    const today = calendarDateInZone(now, timeZone);
    return startOfDayInZone(
        addDays(today, -(SELLER_REVERSAL_WINDOW_DAYS - 1)),
        timeZone,
    );
}

/** Sales that occurred (`soldAt`, else `createdAt`) at or after `cutoff`. */
export function occurredSinceFilter(cutoff: Date) {
    return {
        $or: [
            { soldAt: { $gte: cutoff } },
            { soldAt: { $exists: false }, createdAt: { $gte: cutoff } },
        ],
    };
}

/** Whether a sale occurred at or after `cutoff`. */
export function occurredSince(
    sale: { soldAt?: Date | null; createdAt?: Date | null },
    cutoff: Date,
): boolean {
    const at = sale.soldAt ?? sale.createdAt;
    return !!at && new Date(at).getTime() >= cutoff.getTime();
}
