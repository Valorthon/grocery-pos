import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PaymentType, SalesReportGroup } from '@grocery-pos/contracts';
import { SalesReportQuery } from './reports.dto';

const errors = async (body: Record<string, unknown>) =>
    validate(plainToInstance(SalesReportQuery, body));
describe('sales report boundaries', () => {
    it('accepts a leap year inclusive, defaults group, and accepts filters', async () => {
        const dto = plainToInstance(SalesReportQuery, {
            from: '2024-01-01',
            to: '2024-12-31',
            cashier: '0123456789abcdef01234567',
            category: 'abcdef0123456789abcdef01',
            paymentType: PaymentType.SPLIT,
        });
        expect(await validate(dto)).toEqual([]);
        expect(dto.groupBy).toBe(SalesReportGroup.DAY);
    });
    it.each([
        {},
        { from: '2026-01-01' },
        { to: '2026-01-01' },
        { from: '2026-02-30', to: '2026-03-01' },
        { from: '2026-01-02', to: '2026-01-01' },
        { from: '2024-01-01', to: '2025-01-01' },
        { from: '2026-01-01', to: '2026-01-01', groupBy: 'private' },
        { from: '2026-01-01', to: '2026-01-01', cashier: 'bad' },
        { from: '2026-01-01', to: '2026-01-01', category: 'bad' },
        { from: '2026-01-01', to: '2026-01-01', paymentType: 'CARD' },
    ])('rejects malformed/unbounded requests %j', async (body) => {
        expect((await errors(body)).length).toBeGreaterThan(0);
    });
    it.each(Object.values(SalesReportGroup))(
        'accepts %s grouping',
        async (groupBy) => {
            expect(
                await errors({ from: '2026-01-01', to: '2026-01-01', groupBy }),
            ).toEqual([]);
        },
    );
});
