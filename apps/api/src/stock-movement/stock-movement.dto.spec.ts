import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
    StockMovementProductDto,
    StockMovementQueryDto,
} from './stock-movement.dto';

describe('stock movement query boundaries', () => {
    it('accepts defaults and bounded store-calendar ranges', () => {
        const query = plainToInstance(StockMovementQueryDto, {
            page: '2',
            limit: '100',
            from: '2026-01-01',
            to: '2026-12-31',
        });
        expect(validateSync(query)).toEqual([]);
        expect(query.page).toBe(2);
        expect(query.limit).toBe(100);
        expect(validateSync(new StockMovementQueryDto())).toEqual([]);
    });
    it.each([
        { page: 0 },
        { page: 1.5 },
        { page: null },
        { limit: 0 },
        { limit: 101 },
        { limit: 1.5 },
        { from: null },
        { to: null },
        { from: '2026-02-30' },
        { from: '2026-11-03T00:00:00Z' },
        { from: '2026-11-03', to: '2026-11-02' },
    ])('rejects invalid pagination and dates %j', (input) => {
        expect(
            validateSync(plainToInstance(StockMovementQueryDto, input)).length,
        ).toBeGreaterThan(0);
    });
    it('rejects product names and malformed IDs instead of treating them as a barcode', () => {
        expect(
            validateSync(
                plainToInstance(StockMovementProductDto, { id: 'milk' }),
            ).length,
        ).toBeGreaterThan(0);
        expect(
            validateSync(
                plainToInstance(StockMovementProductDto, {
                    id: 'ABCDEF123456ABCDEF123456',
                }),
            ),
        ).toEqual([]);
    });
});
