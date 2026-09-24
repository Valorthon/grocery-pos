/**
 * Store-timezone day boundaries.
 *
 * Mongo stores `createdAt` as UTC instants, while "a day" is a calendar day in
 * the store's timezone. These helpers translate calendar dates into the UTC
 * instants that bound them, using only the platform `Intl` API so they do not
 * depend on the Node process's own `TZ`.
 */

export interface CalendarDate {
    year: number;
    /** 1-12. */
    month: number;
    day: number;
}

/** Half-open range `[start, end)` of UTC instants. */
export interface InstantRange {
    start: Date;
    end: Date;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
    let formatter = formatterCache.get(timeZone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
        formatterCache.set(timeZone, formatter);
    }
    return formatter;
}

export function isValidTimeZone(timeZone: string): boolean {
    if (!timeZone) return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone });
        return true;
    } catch {
        return false;
    }
}

/** Wall-clock fields of `instant` as seen in `timeZone` (second precision). */
function wallClockInZone(instant: Date, timeZone: string) {
    const parts = formatterFor(timeZone).formatToParts(instant);
    const get = (type: Intl.DateTimeFormatPartTypes): number =>
        Number(parts.find((p) => p.type === type)?.value);

    return {
        year: get('year'),
        month: get('month'),
        day: get('day'),
        hour: get('hour'),
        minute: get('minute'),
        second: get('second'),
    };
}

/** Offset of `timeZone` from UTC at `instant`, in ms (Manila: +8h). */
function offsetMs(instant: Date, timeZone: string): number {
    const w = wallClockInZone(instant, timeZone);
    const wallAsUtc = Date.UTC(
        w.year,
        w.month - 1,
        w.day,
        w.hour,
        w.minute,
        w.second,
    );
    const truncated = Math.floor(instant.getTime() / 1000) * 1000;
    return wallAsUtc - truncated;
}

/** The calendar date that `instant` falls on in `timeZone`. */
export function calendarDateInZone(
    instant: Date,
    timeZone: string,
): CalendarDate {
    const { year, month, day } = wallClockInZone(instant, timeZone);
    return { year, month, day };
}

/** Parses a strict `YYYY-MM-DD` string; returns null if it is not a real date. */
export function parseIsoDate(value: string): CalendarDate | null {
    const match = ISO_DATE.exec(value);
    if (!match) return null;

    const [year, month, day] = match.slice(1).map(Number);
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (
        probe.getUTCFullYear() !== year ||
        probe.getUTCMonth() !== month - 1 ||
        probe.getUTCDate() !== day
    ) {
        return null;
    }
    return { year, month, day };
}

function sameDate(a: CalendarDate, b: CalendarDate): boolean {
    return a.year === b.year && a.month === b.month && a.day === b.day;
}

function addDays(date: CalendarDate, days: number): CalendarDate {
    const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
    return {
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
    };
}

/**
 * The first instant of `date` in `timeZone`. Usually local midnight; in zones
 * whose DST transition skips midnight it is the first wall time that exists.
 */
export function startOfDayInZone(date: CalendarDate, timeZone: string): Date {
    const midnightAsUtc = Date.UTC(date.year, date.month - 1, date.day);

    // Two passes cover an offset change between the guess and the answer.
    const first = midnightAsUtc - offsetMs(new Date(midnightAsUtc), timeZone);
    const second = midnightAsUtc - offsetMs(new Date(first), timeZone);

    const onDate = [first, second]
        .filter((t) =>
            sameDate(calendarDateInZone(new Date(t), timeZone), date),
        )
        .sort((a, b) => a - b);

    if (onDate.length > 0) return new Date(onDate[0]);

    // Midnight falls in a DST gap: the day starts at the transition, which
    // lies between the two candidates. Binary-search it to the millisecond.
    let lo = Math.min(first, second);
    let hi = Math.max(first, second);
    while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (sameDate(calendarDateInZone(new Date(mid), timeZone), date)) {
            hi = mid;
        } else {
            lo = mid;
        }
    }
    return new Date(hi);
}

/** `[start of date, start of next date)` in `timeZone`, as UTC instants. */
export function dayRangeInZone(
    date: CalendarDate,
    timeZone: string,
): InstantRange {
    return {
        start: startOfDayInZone(date, timeZone),
        end: startOfDayInZone(addDays(date, 1), timeZone),
    };
}

/**
 * Builds a Mongo filter for a calendar-date range in `timeZone`. Either end
 * may be omitted; both ends are inclusive of their whole day. Returns
 * undefined when neither end is given.
 */
export function dateRangeFilter(
    from: string | undefined,
    to: string | undefined,
    timeZone: string,
): { $gte?: Date; $lt?: Date } | undefined {
    const filter: { $gte?: Date; $lt?: Date } = {};

    if (from) {
        const date = parseIsoDate(from);
        if (!date) throw new RangeError(`Invalid date: ${from}`);
        filter.$gte = startOfDayInZone(date, timeZone);
    }
    if (to) {
        const date = parseIsoDate(to);
        if (!date) throw new RangeError(`Invalid date: ${to}`);
        filter.$lt = dayRangeInZone(date, timeZone).end;
    }

    return filter.$gte || filter.$lt ? filter : undefined;
}
