import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { STOCK_COUNT_LINE_MAX } from '@grocery-pos/contracts';
import {
    CreateStockCountDto,
    SaveStockCountDto,
    StockCountQueryDto,
} from './stock-count.dto';
const id = '507f1f77bcf86cd799439011';
describe('stock count request boundaries', () => {
    it.each([0, 1, Number.MAX_SAFE_INTEGER])(
        'accepts a whole minor-unit count %s including explicit zero',
        (countedQty) => {
            expect(
                validateSync(
                    plainToInstance(SaveStockCountDto, {
                        version: 0,
                        lines: [{ line: id, countedQty }],
                    }),
                ),
            ).toEqual([]);
        },
    );
    it.each([undefined, null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, '1'])(
        'rejects uncounted/malformed quantity %s rather than silently treating it as zero',
        (countedQty) => {
            expect(
                validateSync(
                    plainToInstance(SaveStockCountDto, {
                        version: 0,
                        lines: [{ line: id, countedQty }],
                    }),
                ).length,
            ).toBeGreaterThan(0);
        },
    );
    it.each([-1, 0.5, null, Number.MAX_SAFE_INTEGER + 1])(
        'rejects malformed edit versions %s',
        (version) => {
            expect(
                validateSync(
                    plainToInstance(SaveStockCountDto, {
                        version,
                        lines: [{ line: id, countedQty: 0 }],
                    }),
                ).length,
            ).toBeGreaterThan(0);
        },
    );
    it('bounds count edits to one adjustment-size batch', () => {
        expect(
            validateSync(
                plainToInstance(SaveStockCountDto, { version: 0, lines: [] }),
            ).length,
        ).toBeGreaterThan(0);
        expect(
            validateSync(
                plainToInstance(SaveStockCountDto, {
                    version: 0,
                    lines: Array.from(
                        { length: STOCK_COUNT_LINE_MAX + 1 },
                        () => ({ line: id, countedQty: 0 }),
                    ),
                }),
            ).length,
        ).toBeGreaterThan(0);
    });
    it('rejects duplicate picked products and invalid category references', () => {
        expect(
            validateSync(
                plainToInstance(CreateStockCountDto, {
                    scope: 'products',
                    products: [id, id],
                }),
            ).length,
        ).toBeGreaterThan(0);
        expect(
            validateSync(
                plainToInstance(CreateStockCountDto, {
                    scope: 'category',
                    category: null,
                }),
            ).length,
        ).toBeGreaterThan(0);
    });
    it('bounds pagination and rejects unknown states', () => {
        expect(
            validateSync(
                plainToInstance(StockCountQueryDto, {
                    page: '1',
                    limit: '100',
                    status: 'OPEN',
                }),
            ),
        ).toEqual([]);
        expect(
            validateSync(
                plainToInstance(StockCountQueryDto, {
                    page: '0',
                    limit: '101',
                    status: 'INVALID',
                }),
            ).length,
        ).toBeGreaterThan(0);
    });
});
