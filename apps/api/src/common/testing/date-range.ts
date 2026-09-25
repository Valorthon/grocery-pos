/**
 * Shared cases for a list query's `dateFrom`/`dateTo` range (issue #20):
 * every GetAll DTO with a date range refuses a reversed one with the same
 * message and accepts the rest. Call it inside a spec file.
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

export const REVERSED_RANGE = 'dateTo must not be before dateFrom';

export function describeDateRange(
    name: string,
    dto: new () => object,
    base: Record<string, unknown> = { page: 1, limit: 5 },
): void {
    async function messages(range: Record<string, unknown>) {
        const errors = await validate(
            plainToInstance(dto, { ...base, ...range }),
        );
        return errors.flatMap((e) => Object.values(e.constraints ?? {}));
    }

    describe(`${name}: date range (issue #20)`, () => {
        it('refuses dateTo before dateFrom', async () => {
            expect(
                await messages({
                    dateFrom: '2026-03-02',
                    dateTo: '2026-03-01',
                }),
            ).toEqual([REVERSED_RANGE]);
            // Across a month and a year, not just the day digits.
            expect(
                await messages({
                    dateFrom: '2026-01-01',
                    dateTo: '2025-12-31',
                }),
            ).toEqual([REVERSED_RANGE]);
        });

        it.each([
            [
                'a one-day range',
                { dateFrom: '2026-03-01', dateTo: '2026-03-01' },
            ],
            [
                'a forward range',
                { dateFrom: '2026-02-28', dateTo: '2026-03-01' },
            ],
            ['only dateFrom', { dateFrom: '2026-03-01' }],
            ['only dateTo', { dateTo: '2026-03-01' }],
            ['no range', {}],
        ])('accepts %s', async (_label, range) => {
            expect(await messages(range)).toEqual([]);
        });

        it('reports a malformed end once, as a format error', async () => {
            expect(
                await messages({ dateFrom: '2026-03-02', dateTo: '2026-3-1' }),
            ).toEqual(['dateTo must be a date in YYYY-MM-DD format']);
        });
    });
}
