import { Types, type Connection, type Model } from 'mongoose';
import {
    OverrideAction,
    Role,
    StockCountStatus,
    UnitOfMeasure,
    type AuthUser,
} from '@grocery-pos/contracts';
import { StockCountService } from './stock-count.service';
import { StockCount } from './stock-count.schema';
import type { Product } from '../product/product.schema';
import type { Inventory } from '../inventory-man/inventory/inventory.schema';
import type { InventoryBatch } from '../inventory-man/batch/batch.schema';
import type { Adjustment } from '../inventory-man/adjustment/adjustment.schema';
import type { AdjustmentDetails } from '../inventory-man/adjustment/adjustment-details.schema';
import type { User } from '../user/user.schema';
import type { InventoryService } from '../inventory-man/inventory/inventory.service';
import type { ManagerOverrideService } from '../auth/override/override.service';
import { stockCountContext } from './stock-count.context';
jest.mock('../common/utils/db', () => ({
    runInTransaction: async (fn: (s: object) => Promise<unknown>) => fn({}),
}));
class Query<T> {
    constructor(private value: T) {}
    select() {
        return this;
    }
    session() {
        return this;
    }
    sort() {
        return this;
    }
    skip() {
        return this;
    }
    limit() {
        return this;
    }
    async lean() {
        return this.value;
    }
}
const user = new Types.ObjectId(),
    id = new Types.ObjectId(),
    product = new Types.ObjectId(),
    lineId = new Types.ObjectId();
const actor: AuthUser = {
    userId: String(user),
    username: 'adjuster',
    roles: [Role.Adjuster],
    sid: 'session',
};
function record(): StockCount {
    return {
        _id: id,
        scope: 'products',
        status: StockCountStatus.OPEN,
        version: 0,
        createdBy: user,
        createdAt: new Date(),
        updatedAt: new Date(),
        lines: [
            {
                _id: lineId,
                product,
                name: 'Rice',
                EAN: '123',
                unit: UnitOfMeasure.KG,
                tracksExpiry: false,
                expectedQty: 1000,
            },
        ],
    };
}
let row: StockCount;
const counts = {
    init: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    countDocuments: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn(),
};
const products = { find: jest.fn(), findById: jest.fn() };
const inventory = { find: jest.fn() },
    batches = { find: jest.fn() };
const adjustments = { create: jest.fn() },
    details = { insertMany: jest.fn() },
    users = { find: jest.fn(), updateOne: jest.fn() };
const stock = { adjust: jest.fn() },
    approvals = { consume: jest.fn() };
let service: StockCountService;
beforeEach(() => {
    jest.clearAllMocks();
    row = record();
    counts.init.mockResolvedValue(undefined);
    counts.findById.mockImplementation(() => new Query(row));
    counts.find.mockReturnValue(new Query([{ _id: id }]));
    counts.countDocuments.mockResolvedValue(1);
    counts.create.mockImplementation(async (data: StockCount[]) => [
        { ...data[0], _id: id },
    ]);
    counts.updateOne.mockResolvedValue({ matchedCount: 1 });
    products.find.mockReturnValue(
        new Query([
            { _id: product, name: 'Rice', EAN: '123', unit: UnitOfMeasure.KG },
        ]),
    );
    products.findById.mockReturnValue(new Query({ unit: UnitOfMeasure.KG }));
    inventory.find.mockReturnValue(new Query([{ product, stock: 1000 }]));
    batches.find.mockReturnValue(new Query([]));
    users.find.mockReturnValue(new Query([{ _id: user, name: 'adjuster' }]));
    users.updateOne.mockResolvedValue({ matchedCount: 1 });
    adjustments.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);
    details.insertMany.mockResolvedValue([]);
    stock.adjust.mockResolvedValue(undefined);
    approvals.consume.mockResolvedValue(String(user));
    service = new StockCountService(
        {} as Connection,
        counts as unknown as Model<StockCount>,
        products as unknown as Model<Product>,
        inventory as unknown as Model<Inventory>,
        batches as unknown as Model<InventoryBatch>,
        adjustments as unknown as Model<Adjustment>,
        details as unknown as Model<AdjustmentDetails>,
        users as unknown as Model<User>,
        stock as unknown as InventoryService,
        approvals as unknown as ManagerOverrideService,
    );
});
it('awaits index readiness and propagates index startup failures', async () => {
    await service.onModuleInit();
    expect(counts.init).toHaveBeenCalled();
    counts.init.mockRejectedValueOnce(new Error('index'));
    await expect(service.onModuleInit()).rejects.toThrow('index');
});
it('lists paginated sessions and snapshots legacy measures without changing stock', async () => {
    await expect(service.list({ page: 1, limit: 20 })).resolves.toMatchObject({
        totalItems: 1,
    });
    await service.create(actor, {
        scope: 'products',
        products: [String(product)],
    });
    expect(stock.adjust).not.toHaveBeenCalled();
    expect(counts.create).toHaveBeenCalledWith(
        [expect.objectContaining({ createdBy: actor.userId })],
        expect.anything(),
    );
});
it.each([
    { scope: 'all' as const, category: String(id) },
    { scope: 'category' as const },
    { scope: 'products' as const },
    {
        scope: 'products' as const,
        products: [String(product), String(product)],
    },
])('refuses inconsistent scope %j', async (dto) => {
    await expect(service.create(actor, dto)).rejects.toThrow();
});
it('refuses unavailable/oversized product selections and inactive requester', async () => {
    products.find.mockReturnValueOnce(new Query([]));
    await expect(service.create(actor, { scope: 'all' })).rejects.toThrow(
        'No active',
    );
    products.find.mockReturnValueOnce(
        new Query(Array.from({ length: 201 }, () => ({ _id: product }))),
    );
    await expect(service.create(actor, { scope: 'all' })).rejects.toThrow(
        'smaller',
    );
    products.find.mockReturnValueOnce(new Query([{ _id: product }]));
    await expect(
        service.create(actor, {
            scope: 'products',
            products: [String(product), String(id)],
        }),
    ).rejects.toThrow('unavailable');
    users.updateOne.mockResolvedValueOnce({ matchedCount: 0 });
    await expect(service.create(actor, { scope: 'all' })).rejects.toThrow(
        'active',
    );
});
it('creates category snapshots and treats missing inventory as zero', async () => {
    inventory.find.mockReturnValue(new Query([]));
    await service.create(actor, { scope: 'category', category: String(id) });
    expect(counts.create).toHaveBeenCalledWith(
        [expect.objectContaining({ category: id })],
        expect.anything(),
    );
});
it('snapshots tracked batch balances, metadata and empty zero-stock tracked products', async () => {
    products.find.mockReturnValue(
        new Query([
            { _id: product, name: 'Rice', EAN: '123', tracksExpiry: true },
        ]),
    );
    batches.find.mockReturnValue(
        new Query([
            {
                _id: lineId,
                product,
                remainingQty: 1000,
                batchNo: 'lot',
                expiryDate: '2099-01-01',
            },
        ]),
    );
    await service.create(actor, { scope: 'all' });
    expect(counts.create).toHaveBeenCalledWith(
        [
            expect.objectContaining({
                lines: [
                    expect.objectContaining({
                        batch: lineId,
                        expectedQty: 1000,
                    }),
                ],
            }),
        ],
        expect.anything(),
    );
    inventory.find.mockReturnValue(new Query([]));
    batches.find.mockReturnValue(new Query([]));
    await service.create(actor, { scope: 'all' });
});
it('refuses corrupt stock, mismatched batches, unsafe batch totals and oversized lot scopes', async () => {
    inventory.find.mockReturnValueOnce(new Query([{ product, stock: NaN }]));
    await expect(service.create(actor, { scope: 'all' })).rejects.toThrow(
        'Invalid inventory',
    );
    products.find.mockReturnValue(
        new Query([
            { _id: product, name: 'Rice', EAN: '123', tracksExpiry: true },
        ]),
    );
    await expect(service.create(actor, { scope: 'all' })).rejects.toThrow(
        'reconciliation',
    );
    batches.find.mockReturnValueOnce(
        new Query([{ _id: lineId, product, remainingQty: Infinity }]),
    );
    await expect(service.create(actor, { scope: 'all' })).rejects.toThrow(
        'Invalid batch',
    );
    inventory.find.mockReturnValue(new Query([{ product, stock: 201 }]));
    batches.find.mockReturnValue(
        new Query(
            Array.from({ length: 201 }, () => ({
                _id: lineId,
                product,
                remainingQty: 1,
            })),
        ),
    );
    await expect(service.create(actor, { scope: 'all' })).rejects.toThrow(
        'smaller',
    );
});
it('reads names only, optional batch metadata and current balances, with deleted creator fallback', async () => {
    row.lines[0] = {
        ...row.lines[0],
        batch: lineId,
        batchNo: 'A',
        expiryDate: '2099-01-01',
        countedQty: 900,
    };
    row.category = id;
    row.approvedBy = id;
    row.adjustment = id;
    batches.find.mockReturnValue(
        new Query([{ _id: lineId, remainingQty: 800 }]),
    );
    users.find.mockReturnValue(new Query([]));
    const view = await service.get(String(id));
    expect(view.createdBy).toBeNull();
    expect(view.approvedBy).toBeNull();
    expect(view.lines[0]).toMatchObject({
        currentQty: 800,
        variance: -100,
        batchNo: 'A',
    });
    row.status = StockCountStatus.APPROVED;
    expect((await service.get(String(id))).lines[0].currentQty).toBeUndefined();
    counts.findById.mockReturnValueOnce(new Query(null));
    await expect(service.get(String(id))).rejects.toThrow('not found');
});
it('saves explicit zero with immutable opening values and optimistic version filter', async () => {
    await service.save(actor, String(id), {
        version: 0,
        lines: [{ line: String(lineId), countedQty: 0 }],
    });
    expect(counts.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ version: 0, status: 'OPEN' }),
        expect.objectContaining({ $inc: { version: 1 } }),
        expect.anything(),
    );
});
it('preserves unedited lines and rejects stale, duplicate, foreign and overflowing edits', async () => {
    await service.save(actor, String(id), { version: 0, lines: [] });
    await expect(
        service.save(actor, String(id), { version: 1, lines: [] }),
    ).rejects.toThrow('changed');
    await expect(
        service.save(actor, String(id), {
            version: 0,
            lines: [
                { line: String(lineId), countedQty: 0 },
                { line: String(lineId), countedQty: 1 },
            ],
        }),
    ).rejects.toThrow('distinct');
    await expect(
        service.save(actor, String(id), {
            version: 0,
            lines: [{ line: String(id), countedQty: 0 }],
        }),
    ).rejects.toThrow('belong');
    row.lines[0].expectedQty = -1;
    await expect(
        service.save(actor, String(id), {
            version: 0,
            lines: [
                { line: String(lineId), countedQty: Number.MAX_SAFE_INTEGER },
            ],
        }),
    ).rejects.toThrow('limits');
    counts.updateOne.mockResolvedValueOnce({ matchedCount: 0 });
    await expect(
        service.save(actor, String(id), { version: 0, lines: [] }),
    ).rejects.toThrow('changed');
});
it('requires completed lines before submission, permits cancellation of submitted count, and guards races', async () => {
    await expect(
        service.transition(actor, String(id), 0, StockCountStatus.SUBMITTED),
    ).rejects.toThrow('every line');
    row.lines[0].countedQty = 0;
    await service.transition(actor, String(id), 0, StockCountStatus.SUBMITTED);
    row.status = StockCountStatus.SUBMITTED;
    await service.transition(actor, String(id), 0, StockCountStatus.CANCELLED);
    await expect(
        service.transition(actor, String(id), 0, StockCountStatus.SUBMITTED),
    ).rejects.toThrow('changed');
    row.status = StockCountStatus.OPEN;
    counts.updateOne.mockResolvedValueOnce({ matchedCount: 0 });
    await expect(
        service.transition(actor, String(id), 0, StockCountStatus.CANCELLED),
    ).rejects.toThrow('changed');
});
it('posts exact fixed variances and manager identity once, skips zero changes, and returns idempotent result', async () => {
    row.status = StockCountStatus.SUBMITTED;
    row.lines[0].countedQty = 900;
    await service.approve(actor, String(id), 0, 'grant');
    expect(approvals.consume).toHaveBeenCalledWith(
        'grant',
        actor,
        OverrideAction.STOCK_COUNT,
        stockCountContext(row),
        expect.anything(),
    );
    expect(stock.adjust).toHaveBeenCalledWith(
        actor.userId,
        expect.objectContaining({
            adjustDetails: [
                expect.objectContaining({
                    change: -100,
                    product: String(product),
                }),
            ],
        }),
        expect.anything(),
        expect.objectContaining({
            type: 'COUNT',
            refId: String(id),
            user: actor.userId,
        }),
    );
    row.lines[0].countedQty = 1000;
    stock.adjust.mockClear();
    await service.approve(actor, String(id), 0, 'grant');
    expect(stock.adjust).not.toHaveBeenCalled();
    row.status = StockCountStatus.APPROVED;
    approvals.consume.mockClear();
    await service.approve(actor, String(id), 0, undefined);
    expect(approvals.consume).not.toHaveBeenCalled();
});
it('fails missing/stale/incomplete/changed-measure/unsafe count approvals instead of posting unintended stock', async () => {
    counts.findById.mockReturnValueOnce(new Query(null));
    await expect(
        service.approve(actor, String(id), 0, 'grant'),
    ).rejects.toThrow('not found');
    await expect(
        service.approve(actor, String(id), 0, 'grant'),
    ).rejects.toThrow('changed');
    row.status = StockCountStatus.SUBMITTED;
    await expect(
        service.approve(actor, String(id), 0, 'grant'),
    ).rejects.toThrow('incomplete');
    row.lines[0].countedQty = 900;
    products.findById.mockReturnValueOnce(new Query(null));
    await expect(
        service.approve(actor, String(id), 0, 'grant'),
    ).rejects.toThrow('changed');
    products.findById.mockReturnValueOnce(
        new Query({ unit: UnitOfMeasure.PIECE }),
    );
    await expect(
        service.approve(actor, String(id), 0, 'grant'),
    ).rejects.toThrow('changed');
    row.lines[0].expectedQty = -1;
    row.lines[0].countedQty = Number.MAX_SAFE_INTEGER;
    await expect(
        service.approve(actor, String(id), 0, 'grant'),
    ).rejects.toThrow('limits');
});
it('targets tracked lot variances and refuses positive additions without a real batch', async () => {
    row.status = StockCountStatus.SUBMITTED;
    row.lines[0] = {
        ...row.lines[0],
        tracksExpiry: true,
        batch: lineId,
        countedQty: 900,
    };
    products.findById.mockReturnValue(
        new Query({ unit: UnitOfMeasure.KG, tracksExpiry: true }),
    );
    await service.approve(actor, String(id), 0, 'grant');
    expect(details.insertMany).toHaveBeenCalledWith(
        [expect.objectContaining({ batch: String(lineId), change: -100 })],
        expect.anything(),
    );
    delete row.lines[0].batch;
    await expect(
        service.approve(actor, String(id), 0, 'grant'),
    ).rejects.toThrow('no batch');
    row.lines[0].batch = lineId;
    counts.updateOne.mockResolvedValueOnce({ matchedCount: 0 });
    await expect(
        service.approve(actor, String(id), 0, 'grant'),
    ).rejects.toThrow('changed');
});
it('fingerprints bind exact count version, product, batch, unit and quantities', () => {
    const original = stockCountContext(row);
    row.version++;
    expect(stockCountContext(row)).not.toBe(original);
    row.version--;
    row.lines[0].countedQty = 900;
    expect(stockCountContext(row)).not.toBe(original);
});
