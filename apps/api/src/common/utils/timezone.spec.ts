import {
    calendarDateInZone,
    dateRangeFilter,
    dayRangeInZone,
    isValidTimeZone,
    parseIsoDate,
    startOfDayInZone,
} from './timezone';

const MANILA = 'Asia/Manila';

describe('isValidTimeZone', () => {
    it('accepts IANA names', () => {
        expect(isValidTimeZone('Asia/Manila')).toBe(true);
        expect(isValidTimeZone('America/New_York')).toBe(true);
        expect(isValidTimeZone('UTC')).toBe(true);
    });

    it('rejects unknown zones and empty strings', () => {
        expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
        expect(isValidTimeZone('')).toBe(false);
    });
});

describe('parseIsoDate', () => {
    it('parses a strict YYYY-MM-DD date', () => {
        expect(parseIsoDate('2026-01-05')).toEqual({
            year: 2026,
            month: 1,
            day: 5,
        });
    });

    it('rejects impossible dates and other formats', () => {
        expect(parseIsoDate('2026-02-30')).toBeNull();
        expect(parseIsoDate('2026-1-5')).toBeNull();
        expect(parseIsoDate('2026-01-05T00:00:00.000Z')).toBeNull();
        expect(parseIsoDate('')).toBeNull();
    });
});

describe('calendarDateInZone', () => {
    it('UTC 23:30 of the previous day is 07:30 today in Manila', () => {
        const instant = new Date('2026-01-04T23:30:00.000Z');

        expect(calendarDateInZone(instant, MANILA)).toEqual({
            year: 2026,
            month: 1,
            day: 5,
        });
        expect(calendarDateInZone(instant, 'UTC')).toEqual({
            year: 2026,
            month: 1,
            day: 4,
        });
    });
});

describe('dayRangeInZone', () => {
    it('bounds a Manila day by 16:00 UTC on either side', () => {
        const { start, end } = dayRangeInZone(
            { year: 2026, month: 1, day: 5 },
            MANILA,
        );

        expect(start.toISOString()).toBe('2026-01-04T16:00:00.000Z');
        expect(end.toISOString()).toBe('2026-01-05T16:00:00.000Z');

        const localMorning = new Date('2026-01-04T23:30:00.000Z');
        expect(localMorning >= start && localMorning < end).toBe(true);
    });

    it('rolls over month and year ends', () => {
        const { start, end } = dayRangeInZone(
            { year: 2025, month: 12, day: 31 },
            MANILA,
        );

        expect(start.toISOString()).toBe('2025-12-30T16:00:00.000Z');
        expect(end.toISOString()).toBe('2025-12-31T16:00:00.000Z');
    });

    it('gives a 23-hour day on a DST spring-forward date', () => {
        // New York moves from EST (-5) to EDT (-4) on 2026-03-08.
        const { start, end } = dayRangeInZone(
            { year: 2026, month: 3, day: 8 },
            'America/New_York',
        );

        expect(start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
        expect(end.toISOString()).toBe('2026-03-09T04:00:00.000Z');
        expect(end.getTime() - start.getTime()).toBe(23 * 3600 * 1000);
    });

    it('gives a 25-hour day on a DST fall-back date', () => {
        const { start, end } = dayRangeInZone(
            { year: 2026, month: 11, day: 1 },
            'America/New_York',
        );

        expect(start.toISOString()).toBe('2026-11-01T04:00:00.000Z');
        expect(end.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    });

    it('starts the day at 01:00 when DST skips midnight', () => {
        // Santiago springs forward at 24:00 -> 01:00 on 2026-09-06.
        const start = startOfDayInZone(
            { year: 2026, month: 9, day: 6 },
            'America/Santiago',
        );

        expect(start.toISOString()).toBe('2026-09-06T04:00:00.000Z');
        expect(calendarDateInZone(start, 'America/Santiago')).toEqual({
            year: 2026,
            month: 9,
            day: 6,
        });
        expect(
            calendarDateInZone(
                new Date(start.getTime() - 1),
                'America/Santiago',
            ).day,
        ).toBe(5);
    });

    describe('a fall-back that repeats midnight (#16)', () => {
        // Amman left DST on 2021-10-29 at 01:00 +03, back to 00:00 +02: that
        // date has two local midnights, 21:00Z and 22:00Z on the 28th. The
        // day starts at the first; the old two-pass guess returned the second.
        const AMMAN = 'Asia/Amman';
        const OCT_29 = { year: 2021, month: 10, day: 29 };

        it('starts the day at the first of the two midnights', () => {
            const start = startOfDayInZone(OCT_29, AMMAN);

            expect(start.toISOString()).toBe('2021-10-28T21:00:00.000Z');
            expect(calendarDateInZone(start, AMMAN)).toEqual(OCT_29);
            expect(
                calendarDateInZone(new Date(start.getTime() - 1), AMMAN).day,
            ).toBe(28);
        });

        it('ends the day before at that first midnight, so no hour is in both', () => {
            const before = dayRangeInZone(
                { year: 2021, month: 10, day: 28 },
                AMMAN,
            );
            const day = dayRangeInZone(OCT_29, AMMAN);

            expect(before.end.toISOString()).toBe('2021-10-28T21:00:00.000Z');
            expect(day.start).toEqual(before.end);
            // 25 hours: 00:00 +03 to 00:00 +02 on the 30th.
            expect(day.end.getTime() - day.start.getTime()).toBe(
                25 * 60 * 60 * 1000,
            );
        });

        it('handles Gaza’s repeated midnight too', () => {
            expect(
                startOfDayInZone(
                    { year: 2020, month: 10, day: 24 },
                    'Asia/Gaza',
                ).toISOString(),
            ).toBe('2020-10-23T21:00:00.000Z');
        });

        it('leaves Manila, which has no DST, at 16:00Z the day before', () => {
            for (const [month, day] of [
                [1, 1],
                [3, 31],
                [10, 29],
                [12, 31],
            ]) {
                const start = startOfDayInZone(
                    { year: 2021, month, day },
                    MANILA,
                );
                const expected = new Date(
                    Date.UTC(2021, month - 1, day) - 8 * 3600 * 1000,
                );
                expect(start.toISOString()).toBe(expected.toISOString());
            }
        });
    });

    it('does not depend on the process timezone', () => {
        const original = process.env.TZ;
        try {
            process.env.TZ = 'America/Los_Angeles';
            const { start } = dayRangeInZone(
                { year: 2026, month: 1, day: 5 },
                MANILA,
            );
            expect(start.toISOString()).toBe('2026-01-04T16:00:00.000Z');
        } finally {
            process.env.TZ = original;
        }
    });
});

describe('dateRangeFilter', () => {
    it('returns undefined when neither end is given', () => {
        expect(dateRangeFilter(undefined, undefined, MANILA)).toBeUndefined();
        expect(dateRangeFilter('', '', MANILA)).toBeUndefined();
    });

    it('covers whole days on both ends', () => {
        expect(dateRangeFilter('2026-01-05', '2026-01-06', MANILA)).toEqual({
            $gte: new Date('2026-01-04T16:00:00.000Z'),
            $lt: new Date('2026-01-06T16:00:00.000Z'),
        });
    });

    it('applies a start-only range', () => {
        expect(dateRangeFilter('2026-01-05', undefined, MANILA)).toEqual({
            $gte: new Date('2026-01-04T16:00:00.000Z'),
        });
    });

    it('applies an end-only range', () => {
        expect(dateRangeFilter(undefined, '2026-01-05', MANILA)).toEqual({
            $lt: new Date('2026-01-05T16:00:00.000Z'),
        });
    });

    it('rejects malformed dates', () => {
        expect(() => dateRangeFilter('01/05/2026', undefined, MANILA)).toThrow(
            RangeError,
        );
    });
});
