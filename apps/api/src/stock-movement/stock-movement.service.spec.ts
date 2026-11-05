import { Types } from 'mongoose';
import {
    StockMovementType,
    StockMovementSource,
    UnitOfMeasure,
} from '@grocery-pos/contracts';
import {
    StockMovementService,
    netStockChanges,
} from './stock-movement.service';
import { StockMovementController } from './stock-movement.controller';
import { StockMovementQueryDto } from './stock-movement.dto';
const id = new Types.ObjectId().toString(),
    user = new Types.ObjectId().toString(),
    source = new Types.ObjectId().toString();
const context = {
    type: StockMovementType.RESTOCK,
    refModel: StockMovementSource.RESTOCK,
    refId: source,
    user,
};
const session = {} as never;
function chain(value: unknown) {
    return {
        session: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(value),
    };
}
function fixture() {
    const marker = jest.fn().mockResolvedValue(null);
    const current = chain({ stock: 5 });
    const definition = chain({ unit: UnitOfMeasure.KG });
    const latest = chain(null);
    const date = new Date('2026-11-05T00:00:00Z');
    const rows = chain([
        {
            _id: new Types.ObjectId(),
            product: new Types.ObjectId(id),
            type: StockMovementType.RESTOCK,
            quantity: 3,
            balanceAfter: 5,
            unit: UnitOfMeasure.KG,
            sequence: 1,
            refModel: StockMovementSource.RESTOCK,
            refId: new Types.ObjectId(source),
            user: { _id: new Types.ObjectId(user), name: 'Rita' },
            occurredAt: date,
            createdAt: date,
            historical: false,
        },
    ]);
    const aggregate = {
        session: jest
            .fn()
            .mockResolvedValue([{ total: Types.Decimal128.fromString('5') }]),
    };
    const movements = {
        init: jest.fn().mockResolvedValue(undefined),
        db: { collection: () => ({ findOne: marker }) },
        findOne: jest.fn(() => latest),
        find: jest.fn(() => rows),
        countDocuments: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn(() => aggregate),
    };
    const inventory = {
        findOne: jest.fn(() => current),
        db: {
            transaction: jest.fn(async (fn: (s: unknown) => unknown) =>
                fn(session),
            ),
        },
    };
    const products = {
        findById: jest.fn(() => definition),
        exists: jest.fn().mockResolvedValue(true),
    };
    const service = new StockMovementService(
        movements as never,
        inventory as never,
        products as never,
        { get: () => 'Asia/Manila' } as never,
    );
    return {
        service,
        movements,
        inventory,
        products,
        current,
        definition,
        latest,
        rows,
        aggregate,
        marker,
    };
}
describe('stock ledger exact posting', () => {
    it('nets canonical IDs, drops zero net changes and refuses unsafe accumulation', () => {
        expect(
            netStockChanges([
                { product: id.toUpperCase(), quantity: 3 },
                { product: id, quantity: -1 },
            ]),
        ).toEqual([[id, 2]]);
        expect(
            netStockChanges([
                { product: id, quantity: 1 },
                { product: id, quantity: -1 },
            ]),
        ).toEqual([]);
        expect(() => netStockChanges([{ product: id, quantity: 0.5 }])).toThrow(
            'Invalid stock',
        );
        expect(() =>
            netStockChanges([
                { product: id, quantity: Number.MAX_SAFE_INTEGER },
                { product: id, quantity: 1 },
            ]),
        ).toThrow('Invalid stock');
    });
    it('awaits unique indexes and propagates startup failure', async () => {
        const f = fixture();
        await f.service.onModuleInit();
        expect(f.movements.init).toHaveBeenCalledTimes(1);
        f.movements.init.mockRejectedValueOnce(new Error('Index failed'));
        await expect(f.service.onModuleInit()).rejects.toThrow('Index failed');
    });
    it.each(['running', 'incomplete'])(
        'refuses to serve an unfinished %s migration',
        async (status) => {
            const f = fixture();
            f.marker.mockResolvedValue({ status });
            await expect(f.service.onModuleInit()).rejects.toThrow(
                'migration must complete',
            );
            expect(f.movements.init).not.toHaveBeenCalled();
        },
    );
    it('creates an explicit unknown opening before the first change and preserves original occurrence separately', async () => {
        const f = fixture(),
            occurredAt = new Date('2026-01-01');
        await f.service.record(
            [{ product: id, quantity: 3 }],
            { ...context, occurredAt },
            session,
        );
        expect(
            f.movements.create.mock.calls.map((call) => (call as unknown[])[0]),
        ).toMatchObject([
            [
                {
                    type: 'OPENING',
                    quantity: 2,
                    balanceAfter: 2,
                    sequence: 0,
                    refModel: 'Opening',
                    unit: 'KG',
                },
            ],
            [
                {
                    type: 'RESTOCK',
                    quantity: 3,
                    balanceAfter: 5,
                    sequence: 1,
                    refId: new Types.ObjectId(source),
                    occurredAt,
                    user: new Types.ObjectId(user),
                },
            ],
        ]);
        expect(
            (f.movements.create.mock.calls[0] as unknown[])[0],
        ).not.toHaveProperty('user');
    });
    it('extends a matching ledger without another baseline and defaults legacy unit to pieces', async () => {
        const f = fixture();
        f.latest.lean.mockResolvedValue({ balanceAfter: 2, sequence: 7 });
        f.definition.lean.mockResolvedValue({});
        await f.service.record(
            [{ product: id, quantity: 3 }],
            context,
            session,
        );
        expect(f.movements.create).toHaveBeenCalledTimes(1);
        expect(f.movements.create.mock.calls[0]).toMatchObject([
            [{ sequence: 8, unit: 'PIECE' }],
            { session },
        ]);
    });
    it('does not create entries for a net zero event', async () => {
        const f = fixture();
        await f.service.record(
            [{ product: id, quantity: 0 }],
            context,
            session,
        );
        expect(f.movements.create).not.toHaveBeenCalled();
    });
    it.each([null, { stock: 0.5 }, { stock: Infinity }])(
        'rejects missing/corrupt stock %j',
        async (value) => {
            const f = fixture();
            f.current.lean.mockResolvedValue(value);
            await expect(
                f.service.record(
                    [{ product: id, quantity: 3 }],
                    context,
                    session,
                ),
            ).rejects.toThrow('missing or invalid');
        },
    );
    it('rejects a missing product, unsafe baseline, sequence overflow and mismatched ledger rather than silently repairing', async () => {
        const f = fixture();
        f.definition.lean.mockResolvedValue(null);
        await expect(
            f.service.record([{ product: id, quantity: 3 }], context, session),
        ).rejects.toThrow('missing or invalid');
        f.definition.lean.mockResolvedValue({});
        f.current.lean.mockResolvedValue({ stock: Number.MIN_SAFE_INTEGER });
        await expect(
            f.service.record([{ product: id, quantity: 1 }], context, session),
        ).rejects.toThrow('opening inventory');
        f.current.lean.mockResolvedValue({ stock: 5 });
        f.latest.lean.mockResolvedValue({
            balanceAfter: 2,
            sequence: Number.MAX_SAFE_INTEGER,
        });
        await expect(
            f.service.record([{ product: id, quantity: 3 }], context, session),
        ).rejects.toThrow('sequence exhausted');
        f.latest.lean.mockResolvedValue({ balanceAfter: 100, sequence: 1 });
        await expect(
            f.service.record([{ product: id, quantity: 3 }], context, session),
        ).rejects.toThrow('does not reconcile');
    });
    it('propagates ledger write failure so caller transaction can roll back stock', async () => {
        const f = fixture();
        f.movements.create.mockRejectedValue(new Error('Disk'));
        await expect(
            f.service.record([{ product: id, quantity: 3 }], context, session),
        ).rejects.toThrow('Disk');
    });
});
describe('stock ledger reads', () => {
    it('returns only declared wire fields and name-only actor with bounded posted-date query', async () => {
        const f = fixture(),
            dto = Object.assign(new StockMovementQueryDto(), {
                page: 2,
                limit: 5,
                from: '2026-01-01',
                to: '2026-01-01',
            });
        const data = await f.service.list(id, dto);
        expect(data.data[0]).toMatchObject({
            product: id,
            refId: source,
            user: { _id: user, name: 'Rita' },
            createdAt: '2026-11-05T00:00:00.000Z',
        });
        expect(f.rows.skip).toHaveBeenCalledWith(5);
        expect(f.movements.find).toHaveBeenCalledWith({
            product: new Types.ObjectId(id),
            createdAt: {
                $gte: new Date('2025-12-31T16:00:00Z'),
                $lt: new Date('2026-01-01T16:00:00Z'),
            },
        });
    });
    it('preserves unattributed opening and missing/deleted actor instead of leaking user fields', async () => {
        const f = fixture();
        f.rows.lean.mockResolvedValue([
            {
                _id: 'row',
                product: id,
                type: 'OPENING',
                quantity: 2,
                balanceAfter: 2,
                unit: 'PIECE',
                sequence: 0,
                refModel: 'Opening',
                occurredAt: new Date(),
                createdAt: new Date(),
                historical: true,
            },
        ]);
        expect(
            (await f.service.list(id, new StockMovementQueryDto())).data[0]
                .user,
        ).toBeNull();
    });
    it('returns an empty page and404 for nonexistent products', async () => {
        const f = fixture();
        f.rows.lean.mockResolvedValue([]);
        expect(
            (await f.service.list(id, new StockMovementQueryDto())).data,
        ).toEqual([]);
        f.products.exists.mockResolvedValue(false);
        await expect(
            f.service.list(id, new StockMovementQueryDto()),
        ).rejects.toThrow('Product not found');
        await expect(f.service.integrity(id)).rejects.toThrow(
            'Product not found',
        );
    });
    it('checks sum and inventory within one snapshot transaction without repairing mismatches', async () => {
        const f = fixture();
        expect(await f.service.integrity(id)).toMatchObject({
            stock: 5,
            movementTotal: 5,
            difference: 0,
            matches: true,
        });
        expect(f.inventory.db.transaction).toHaveBeenCalledWith(
            expect.any(Function),
            { readConcern: { level: 'snapshot' } },
        );
        f.aggregate.session.mockResolvedValue([
            { total: Types.Decimal128.fromString('3') },
        ]);
        expect(await f.service.integrity(id)).toMatchObject({
            difference: 2,
            matches: false,
        });
    });
    it('treats no inventory/no movements as zero and refuses corrupt sums', async () => {
        const f = fixture();
        f.current.lean.mockResolvedValue(null);
        f.aggregate.session.mockResolvedValue([]);
        expect(await f.service.integrity(id)).toMatchObject({
            stock: 0,
            movementTotal: 0,
            matches: true,
        });
        f.aggregate.session.mockResolvedValue([
            { total: Types.Decimal128.fromString('9007199254740992') },
        ]);
        await expect(f.service.integrity(id)).rejects.toThrow(
            'Invalid stock ledger sum',
        );
    });
    it('controller forwards validated product and query without accepting a client ledger write', async () => {
        const f = fixture(),
            controller = new StockMovementController(f.service);
        const dto = new StockMovementQueryDto();
        await expect(controller.list({ id }, dto)).resolves.toHaveProperty(
            'data',
        );
        await expect(controller.integrity({ id })).resolves.toHaveProperty(
            'matches',
            true,
        );
    });
});
