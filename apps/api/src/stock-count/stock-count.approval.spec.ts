import { JwtService } from '@nestjs/jwt';
import { Connection, Model, Types, type ClientSession } from 'mongoose';
import {
    OverrideAction,
    Role,
    StockCountStatus,
    UnitOfMeasure,
    type AuthUser,
} from '@grocery-pos/contracts';
import { ManagerOverrideService } from '../auth/override/override.service';
import { StockCount } from './stock-count.schema';
import { stockCountContext } from './stock-count.context';
import type { OverrideGrant } from '../auth/override/override-grant.schema';
import type { User } from '../user/user.schema';
import type { Sales } from '../sales/sales.schema';
import type { Shift } from '../shift/shift.schema';
import type { ProductService } from '../product/product.service';
import type { TypedConfigService } from '../common/typed-config/typed-config.service';
import type { ManagerOverrideDto } from '../auth/override/override.dto';
jest.mock('argon2', () => ({
    hash: jest.fn(async () => 'hash'),
    verify: jest.fn(async () => true),
}));
const id = () => new Types.ObjectId();
const actor: AuthUser = {
    userId: String(id()),
    username: 'adjuster',
    roles: [Role.Adjuster],
    sid: 'session',
};
const secret = 'stock-count-approval-purpose-tests-123456789';
function query<T>(value: T) {
    const q = { select: () => q, session: () => q, lean: async () => value };
    return q;
}
let count: StockCount;
let service: ManagerOverrideService;
const users = { findOne: jest.fn(), updateOne: jest.fn() },
    counts = { findById: jest.fn() },
    grants = { create: jest.fn(), findOneAndUpdate: jest.fn() };
const manager = {
    _id: id(),
    name: 'manager',
    isActive: true,
    roles: [Role.Supervisor],
    overridePinHash: 'hash',
    overridePinVersion: 'v1',
};
const request = (): ManagerOverrideDto => ({
    username: 'manager',
    pin: '012345',
    action: OverrideAction.STOCK_COUNT,
    context: {
        stockCount: { countId: String(count._id), version: count.version },
    },
});
beforeEach(() => {
    jest.clearAllMocks();
    count = {
        _id: id(),
        scope: 'all',
        status: StockCountStatus.SUBMITTED,
        version: 4,
        createdBy: id(),
        createdAt: new Date(),
        updatedAt: new Date(),
        lines: [
            {
                _id: id(),
                product: id(),
                unit: UnitOfMeasure.PIECE,
                name: 'Rice',
                EAN: '123',
                tracksExpiry: false,
                expectedQty: 10,
                countedQty: 8,
            },
        ],
    };
    users.findOne.mockReturnValue(query(manager));
    users.updateOne.mockResolvedValue({ matchedCount: 1 });
    counts.findById.mockImplementation(() => query(count));
    grants.create.mockResolvedValue([{ _id: id() }]);
    grants.findOneAndUpdate.mockReturnValue(
        query({
            approver: manager._id,
            approverPinVersion: 'v1',
            requesterVersion: null,
        }),
    );
    service = new ManagerOverrideService(
        {} as Connection,
        grants as unknown as Model<OverrideGrant>,
        users as unknown as Model<User>,
        {} as Model<Sales>,
        {} as Model<Shift>,
        {} as ProductService,
        new JwtService(),
        { get: () => secret } as unknown as TypedConfigService,
        counts as unknown as Model<StockCount>,
    );
});
it.each([Role.Adjuster, Role.Admin])(
    'issues and consumes scoped stock-count grants for %s without seller privileges',
    async (role) => {
        const requester = { ...actor, roles: [role] };
        const approved = await service.issue(requester, request());
        expect(grants.create).toHaveBeenCalledWith([
            expect.objectContaining({
                action: OverrideAction.STOCK_COUNT,
                contextHash: stockCountContext(count),
            }),
        ]);
        await expect(
            service.consume(
                approved.token,
                requester,
                OverrideAction.STOCK_COUNT,
                stockCountContext(count),
                {} as ClientSession,
            ),
        ).resolves.toBe(String(manager._id));
        expect(users.updateOne).toHaveBeenLastCalledWith(
            expect.objectContaining({
                roles: { $in: [Role.Adjuster, Role.Admin] },
            }),
            expect.anything(),
            expect.anything(),
        );
    },
);
it.each([
    { context: {} },
    {
        context: {
            stockCount: { countId: 'id', version: 4 },
            expectedSubtotal: 1,
        },
    },
    { roles: [Role.Seller] },
    { roles: [Role.Supervisor] },
])(
    'rejects ambiguous/mismatched requester approval context %j',
    async (input) => {
        const dto = request();
        if (input.context) dto.context = input.context;
        await expect(
            service.issue(
                input.roles ? { ...actor, roles: input.roles } : actor,
                dto,
            ),
        ).rejects.toThrow();
    },
);
it.each([
    StockCountStatus.OPEN,
    StockCountStatus.APPROVED,
    StockCountStatus.CANCELLED,
])('rejects grants for %s counts', async (status) => {
    count.status = status;
    await expect(service.issue(actor, request())).rejects.toThrow('changed');
});
it('rejects stale versions, absent sessions/counts, or revoked requesters', async () => {
    const dto = request();
    dto.context.stockCount!.version--;
    await expect(service.issue(actor, dto)).rejects.toThrow('changed');
    counts.findById.mockReturnValueOnce(query(null));
    await expect(service.issue(actor, request())).rejects.toThrow('changed');
    await expect(
        service.issue({ ...actor, sid: undefined }, request()),
    ).rejects.toThrow('Log in');
    users.findOne
        .mockReturnValueOnce(query(manager))
        .mockReturnValueOnce(query(null));
    await expect(service.issue(actor, request())).rejects.toThrow('no longer');
});
it('binds category and batch snapshots and current counted quantity into the grant fingerprint', () => {
    const original = stockCountContext(count);
    count.category = id();
    expect(stockCountContext(count)).not.toBe(original);
    delete count.category;
    count.lines[0].batch = id();
    expect(stockCountContext(count)).not.toBe(original);
    delete count.lines[0].batch;
    count.lines[0].countedQty = 7;
    expect(stockCountContext(count)).not.toBe(original);
});
