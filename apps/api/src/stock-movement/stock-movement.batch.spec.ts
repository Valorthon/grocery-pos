import { settingsMock } from '../common/testing/business-collaborators';
import { SettingsService } from '../settings/settings.service';
import { Types } from 'mongoose';
import {
    StockMovementSource,
    StockMovementType,
    UnitOfMeasure,
} from '@grocery-pos/contracts';
import { StockMovementService } from './stock-movement.service';

const session = {} as never;
const context = {
    type: StockMovementType.RESTOCK,
    refModel: StockMovementSource.RESTOCK,
    refId: new Types.ObjectId().toString(),
    user: new Types.ObjectId().toString(),
};

function fixture(count: number, opening: boolean) {
    const ids = Array.from({ length: count }, () => new Types.ObjectId());
    const current = ids.map((product) => ({ product, stock: 10 }));
    const definitions = ids.map((_id) => ({ _id, unit: UnitOfMeasure.KG }));
    const latest = ids.map((product) => ({
        _id: product,
        sequence: 7,
        balanceAfter: 8,
    }));
    const operations: string[] = [];
    let activeOperation = false;
    async function operation(name: string, result: unknown) {
        expect(activeOperation).toBe(false);
        activeOperation = true;
        await Promise.resolve();
        operations.push(name);
        activeOperation = false;
        return result;
    }
    const queries: ReturnType<typeof query>[] = [];
    function query(name: string, result: unknown) {
        const value = {
            session: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            sort: jest.fn().mockReturnThis(),
            lean: jest.fn(async () => {
                return operation(name, result);
            }),
        };
        return value;
    }
    function read(name: string, result: unknown) {
        const value = query(name, result);
        queries.push(value);
        return value;
    }
    const inventory = {
        findOne: jest.fn(() => read('inventory', current[0])),
        find: jest.fn(() => read('inventory', current)),
    };
    const products = {
        findById: jest.fn(() => read('product', definitions[0])),
        find: jest.fn(() => read('product', definitions)),
    };
    const insert = jest.fn(async (rows: unknown[], options: unknown) => {
        expect(Array.isArray(rows)).toBe(true);
        expect(options).toEqual({ session, ordered: true });
        return operation('insert', []);
    });
    const movements = {
        findOne: jest.fn(() => read('latest', opening ? null : latest[0])),
        aggregate: jest.fn(() => ({
            session: jest.fn(async () => {
                return operation('latest', opening ? [] : latest);
            }),
        })),
        create: insert,
        insertMany: insert,
    };
    const service = new StockMovementService(
        movements as never,
        inventory as never,
        products as never,
        settingsMock() as unknown as SettingsService,
    );
    return {
        service,
        ids,
        current,
        definitions,
        latest,
        operations,
        queries,
        inventory,
        products,
        movements,
        insert,
    };
}

describe('stock ledger batched posting work', () => {
    it.each([1, 200])(
        'uses three serial reads and one insert for %i existing products',
        async (count) => {
            const f = fixture(count, false);
            await f.service.record(
                f.ids.map((product) => ({
                    product: product.toString(),
                    quantity: 2,
                })),
                context,
                session,
            );
            console.info(
                `existing products=${count} awaited model operations=${f.operations.length}`,
            );
            expect(f.operations).toEqual([
                'inventory',
                'product',
                'latest',
                'insert',
            ]);
            expect(f.insert).toHaveBeenCalledTimes(1);
            expect(f.insert.mock.calls[0]?.[0]).toHaveLength(count);
        },
    );
    it.each([1, 200])(
        'batches openings for %i products and nets repeated lines before reading',
        async (count) => {
            const f = fixture(count, true);
            await f.service.record(
                f.ids.flatMap((product) => [
                    { product: product.toString().toUpperCase(), quantity: 3 },
                    { product: product.toString(), quantity: -1 },
                ]),
                context,
                session,
            );
            console.info(
                `first-use products=${count} awaited model operations=${f.operations.length}`,
            );
            expect(f.operations).toEqual([
                'inventory',
                'product',
                'latest',
                'insert',
            ]);
            expect(f.insert.mock.calls[0]?.[0]).toHaveLength(count * 2);
        },
    );
    it('preserves net quantities, units, sequences and unattributed openings in a mixed batch', async () => {
        const f = fixture(2, false);
        f.latest.pop();
        f.definitions[1]!.unit = UnitOfMeasure.L;
        const occurredAt = new Date('2025-01-01T00:00:00Z');
        await f.service.record(
            f.ids.flatMap((product) => [
                { product: product.toString(), quantity: 5 },
                { product: product.toString().toUpperCase(), quantity: -3 },
            ]),
            { ...context, occurredAt },
            session,
        );
        expect(f.insert).toHaveBeenCalledWith(
            [
                expect.objectContaining({
                    product: f.ids[0],
                    quantity: 2,
                    balanceAfter: 10,
                    unit: 'KG',
                    sequence: 8,
                    occurredAt,
                }),
                expect.objectContaining({
                    product: f.ids[1],
                    type: 'OPENING',
                    quantity: 8,
                    balanceAfter: 8,
                    unit: 'L',
                    sequence: 0,
                }),
                expect.objectContaining({
                    product: f.ids[1],
                    quantity: 2,
                    balanceAfter: 10,
                    unit: 'L',
                    sequence: 1,
                    occurredAt,
                }),
            ],
            { session, ordered: true },
        );
        const opening = f.insert.mock.calls[0]?.[0][1];
        expect(opening).not.toHaveProperty('user');
        expect(opening).not.toHaveProperty('refId');
        for (const query of f.queries)
            expect(query.session).toHaveBeenCalledWith(session);
        const pipeline = f.movements.aggregate.mock.results[0]?.value;
        expect(pipeline?.session).toHaveBeenCalledWith(session);
    });
    it.each([
        'missing inventory',
        'missing product',
        'invalid unit',
        'unsafe balance',
        'ledger mismatch',
        'invalid sequence',
        'negative sequence',
    ])(
        'validates the entire batch before inserting on %s',
        async (corruption) => {
            const f = fixture(2, false);
            if (corruption === 'missing inventory') f.current.pop();
            if (corruption === 'missing product') f.definitions.pop();
            if (corruption === 'invalid unit')
                Reflect.set(f.definitions[1]!, 'unit', 'INVALID');
            if (corruption === 'unsafe balance') f.current[1]!.stock = Infinity;
            if (corruption === 'ledger mismatch') f.latest[1]!.balanceAfter = 9;
            if (corruption === 'invalid sequence') f.latest[1]!.sequence = 0.5;
            if (corruption === 'negative sequence') f.latest[1]!.sequence = -1;
            await expect(
                f.service.record(
                    f.ids.map((product) => ({
                        product: product.toString(),
                        quantity: 2,
                    })),
                    context,
                    session,
                ),
            ).rejects.toThrow();
            expect(f.insert).not.toHaveBeenCalled();
        },
    );
    it('does no model work for net-zero events and rejects unsafe accumulation before reads', async () => {
        const f = fixture(1, true);
        const product = f.ids[0]!.toString();
        await f.service.record(
            [
                { product, quantity: 1 },
                { product, quantity: -1 },
            ],
            context,
            session,
        );
        await expect(
            f.service.record(
                [
                    { product, quantity: Number.MAX_SAFE_INTEGER },
                    { product, quantity: 1 },
                ],
                context,
                session,
            ),
        ).rejects.toThrow('quantity');
        expect(f.operations).toEqual([]);
    });
});
