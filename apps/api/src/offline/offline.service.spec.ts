import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import {
    ErrorCode,
    NUMERIC_LIMITS,
    PaymentType,
    Role,
    SaleStatus,
    ShiftStatus,
    TenderType,
    UnitOfMeasure,
} from '@grocery-pos/contracts';
import { OfflineService, offlineRequestHash } from './offline.service';
import type { OfflineSaleDto } from './offline.dto';

class Query<T> {
    constructor(readonly value: T) {}
    select() {
        return this;
    }
    session() {
        return this;
    }
    sort() {
        return this;
    }
    limit() {
        return this;
    }
    lean() {
        return Promise.resolve(this.value);
    }
    then<R>(resolve: (value: T) => R) {
        return Promise.resolve(this.value).then(resolve);
    }
}
const id = () => new Types.ObjectId();
const SECRET = 'offline-unit-signature-0123456789abcdef';
const AUDIENCE = 'grocery-pos-offline-price-v1';
function fixture() {
    const userId = id();
    const adminId = id();
    const productId = id();
    const shiftId = id();
    const leaseId = id();
    const actor = {
        userId: String(userId),
        username: 'seller',
        roles: [Role.Seller],
        sid: String(userId),
    };
    const admin = {
        userId: String(adminId),
        username: 'admin',
        roles: [Role.Admin],
        sid: String(adminId),
    };
    const user = {
        _id: userId,
        name: 'seller',
        roles: [Role.Seller],
        isActive: true,
        overridePinVersion: 'v1',
    };
    const manager = {
        _id: adminId,
        name: 'admin',
        roles: [Role.Admin],
        isActive: true,
    };
    const lease = {
        _id: leaseId,
        cashier: userId,
        shift: shiftId,
        sid: actor.sid,
        terminalId: 'terminal',
        securityVersion: 'v1',
        issuedAt: new Date(Date.now() - 5000),
        expiresAt: new Date(Date.now() + 3600000),
        active: true,
    };
    const shift = {
        _id: shiftId,
        cashier: userId,
        status: ShiftStatus.OPEN,
        cashierName: 'seller',
        openedAt: new Date(Date.now() - 60000),
        terminal: 'A',
        openingFloat: 10000,
        movements: [],
    };
    const product = {
        _id: productId,
        EAN: '4006381333931',
        name: 'rice',
        price: 18000,
        unit: UnitOfMeasure.KG,
        updatedAt: new Date(Date.now() - 10000),
        createdAt: new Date(Date.now() - 10000),
    };
    const jwt = new JwtService();
    const proof = (changes: Record<string, unknown> = {}) =>
        jwt.sign(
            {
                purpose: 'offline-price-v1',
                lease: String(leaseId),
                cashier: actor.userId,
                shift: String(shiftId),
                product: String(productId),
                EAN: product.EAN,
                price: product.price,
                unit: product.unit,
                iat: Math.floor(Date.now() / 1000) - 1,
                exp: Math.floor(lease.expiresAt.getTime() / 1000),
                ...changes,
            },
            { secret: SECRET, audience: AUDIENCE },
        );
    const body: OfflineSaleDto = {
        lease: String(leaseId),
        idempotencyKey: 'b423583a-5cbf-4d70-ae8b-1c55e1075103',
        soldAt: new Date().toISOString(),
        amountTendered: 10000,
        lines: [{ product: String(productId), quantity: 450, proof: proof() }],
    };
    const auth = { expiry: lease.expiresAt };
    const users = {
        findOne: jest.fn(
            (filter: Record<string, unknown>) =>
                new Query(filter._id === admin.userId ? manager : user),
        ),
        findById: jest.fn(() => new Query(user)),
        updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const leases = {
        findOne: jest.fn(() => new Query<typeof lease | null>(lease)),
        findById: jest.fn(() => new Query<typeof lease | null>(lease)),
        create: jest.fn().mockResolvedValue([lease]),
        updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
        updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    };
    const products = {
        updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
        find: jest.fn(() => new Query([product])),
        findById: jest.fn(() => new Query<typeof product | null>(product)),
    };
    const shifts = {
        findOneAndUpdate: jest.fn(() => new Query<typeof shift | null>(shift)),
        findById: jest.fn(() => new Query<typeof shift | null>(shift)),
        exists: jest.fn().mockResolvedValue({ _id: shiftId }),
        updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const sessions = {
        findOne: jest.fn(() => new Query<typeof auth | null>(auth)),
    };
    const stock = { stock: 450 };
    const inventory = {
        findOne: jest.fn(() => new Query<typeof stock | null>(stock)),
        updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const createdSale = {
        _id: id(),
        cashier: userId,
        createdAt: new Date(),
        amount: 8100,
    };
    const sales = {
        findOne: jest.fn(() => new Query<Record<string, unknown> | null>(null)),
        create: jest.fn().mockResolvedValue([createdSale]),
        findById: jest.fn(
            () => new Query<typeof createdSale | null>(createdSale),
        ),
    };
    const details = { insertMany: jest.fn().mockResolvedValue([]) };
    const receipt = {
        _id: String(createdSale._id),
        createdAt: new Date(),
        status: SaleStatus.COMPLETED,
        paymentType: PaymentType.CASH,
        referenceNumber: null,
        tenders: [{ type: TenderType.CASH, amount: 10000 }],
        amountTendered: 10000,
        changeGiven: 1900,
        cashierName: 'seller',
        items: [],
        subtotal: 8100,
        discount: null,
        totalAmount: 8100,
    };
    const receipts = { receiptOf: jest.fn().mockResolvedValue(receipt) };
    const session = {
        withTransaction: async (fn: (session: unknown) => Promise<void>) =>
            fn(session),
        endSession: jest.fn(),
    };
    const connection = { startSession: jest.fn().mockResolvedValue(session) };
    const config = { get: jest.fn().mockReturnValue(SECRET) };
    const costQuotes = {
        create: jest.fn(async () => ({ _id: id() })),
        findOne: jest.fn(
            () => new Query<{ unitCost?: number } | null>({ unitCost: 6000 }),
        ),
    };
    const service = new OfflineService(
        connection as never,
        leases as never,
        products as never,
        users as never,
        shifts as never,
        inventory as never,
        sessions as never,
        sales as never,
        details as never,
        receipts as never,
        jwt,
        config as never,
        costQuotes as never,
    );
    return {
        service,
        costQuotes,
        actor,
        admin,
        user,
        manager,
        lease,
        shift,
        product,
        stock,
        jwt,
        proof,
        body,
        users,
        leases,
        products,
        shifts,
        sessions,
        inventory,
        sales,
        details,
        receipts,
        receipt,
        createdSale,
    };
}
let f: ReturnType<typeof fixture>;
beforeEach(() => {
    f = fixture();
});
describe('offline lease and signed catalogue', () => {
    it('returns an existing terminal/shift lease with blind shift view', async () => {
        expect(
            await f.service.lease(f.actor, { terminalId: 'terminal' }),
        ).toMatchObject({
            _id: String(f.lease._id),
            cashier: f.actor.userId,
            shift: { _id: String(f.shift._id) },
        });
    });
    it('creates a lease only with an active seller, session and open shift', async () => {
        f.leases.findOne.mockReturnValue(new Query(null));
        expect(
            await f.service.lease(f.actor, { terminalId: 'terminal' }),
        ).toHaveProperty('_id');
        expect(f.leases.create).toHaveBeenCalled();
    });
    it.each([
        'no-sid',
        'invalid-sid',
        'no-session',
        'no-seller',
        'no-shift',
        'expired',
    ])('refuses issuance with %s', async (mode) => {
        if (mode === 'no-sid') f.actor.sid = '';
        if (mode === 'invalid-sid') f.actor.sid = 'invalid';
        if (mode === 'no-session')
            f.sessions.findOne.mockReturnValue(new Query(null));
        if (mode === 'no-seller')
            f.users.findOne.mockReturnValue(new Query(null) as never);
        if (mode === 'no-shift')
            f.shifts.findOneAndUpdate.mockReturnValue(new Query(null));
        if (mode === 'expired') f.lease.expiresAt = new Date(0);
        await expect(
            f.service.lease(f.actor, { terminalId: 'terminal' }),
        ).rejects.toMatchObject({
            code: ErrorCode.OFFLINE_RECONCILIATION_REQUIRED,
        });
    });
    it('signs price/unit/owner/shift proofs and returns bounded cursor pages', async () => {
        const page = await f.service.catalog(f.actor, {
            lease: String(f.lease._id),
            limit: 1,
        });
        expect(page.products[0]).toMatchObject({
            price: 18000,
            unit: UnitOfMeasure.KG,
        });
        expect(page.next).toContain('|');
        expect(
            f.jwt.verify(page.products[0]!.proof, {
                secret: SECRET,
                audience: AUDIENCE,
            }),
        ).toMatchObject({
            lease: String(f.lease._id),
            cashier: f.actor.userId,
            product: String(f.product._id),
            price: 18000,
        });
        await expect(
            f.service.catalog(f.actor, {
                lease: String(f.lease._id),
                after: page.next!,
            }),
        ).resolves.toHaveProperty('products');
    });
    it('defaults legacy products to PIECE and returns no next cursor for a short page', async () => {
        f.product.unit = undefined as never;
        expect(
            (await f.service.catalog(f.actor, { lease: String(f.lease._id) }))
                .products[0]!.unit,
        ).toBe(UnitOfMeasure.PIECE);
        expect(
            (await f.service.catalog(f.actor, { lease: String(f.lease._id) }))
                .next,
        ).toBeNull();
    });
    it('returns an empty completed page', async () => {
        f.products.find.mockReturnValue(new Query([]));
        await expect(
            f.service.catalog(f.actor, { lease: String(f.lease._id) }),
        ).resolves.toEqual({ products: [], next: null });
    });
    it.each(['lease', 'version', 'session', 'shift'])(
        'refuses catalogue after %s changes',
        async (mode) => {
            if (mode === 'lease')
                f.leases.findOne.mockReturnValue(new Query(null));
            if (mode === 'version') f.user.overridePinVersion = 'changed';
            if (mode === 'session')
                f.sessions.findOne.mockReturnValue(new Query(null));
            if (mode === 'shift') f.shifts.exists.mockResolvedValue(null);
            await expect(
                f.service.catalog(f.actor, { lease: String(f.lease._id) }),
            ).rejects.toMatchObject({
                code: ErrorCode.OFFLINE_RECONCILIATION_REQUIRED,
            });
        },
    );
    it.each(['bad', 'bad|bad', '2026-01-01T00:00:00Z|not-an-id'])(
        'rejects malformed cursor %s',
        async (after) => {
            await expect(
                f.service.catalog(f.actor, {
                    lease: String(f.lease._id),
                    after,
                }),
            ).rejects.toMatchObject({ code: ErrorCode.OFFLINE_INVALID });
        },
    );
    it.each([0, NaN, NUMERIC_LIMITS.AMOUNT_MAX + 1])(
        'refuses invalid stored product price %s',
        async (price) => {
            f.product.price = price;
            await expect(
                f.service.catalog(f.actor, { lease: String(f.lease._id) }),
            ).rejects.toMatchObject({ statusCode: 500 });
        },
    );
    it('releases only the caller’s exact terminal lease', async () => {
        await f.service.release(f.actor, String(f.lease._id), {
            terminalId: 'terminal',
        });
        expect(f.leases.findOne).toHaveBeenCalledWith({
            _id: String(f.lease._id),
            cashier: f.actor.userId,
            terminalId: 'terminal',
        });
        expect(f.leases.updateOne).toHaveBeenCalled();
    });
    it('refuses an unknown release', async () => {
        f.leases.findOne.mockReturnValue(new Query(null));
        await expect(
            f.service.release(f.actor, String(f.lease._id), {
                terminalId: 'other',
            }),
        ).rejects.toMatchObject({ code: ErrorCode.OFFLINE_INVALID });
    });
});
describe('offline cash synchronization', () => {
    it('records signed price and original time with exact stock, tender and replay key', async () => {
        expect(await f.service.sync(f.actor, f.body)).toEqual(f.receipt);
        expect(f.sales.create).toHaveBeenCalledWith(
            [
                expect.objectContaining({
                    amount: 8100,
                    soldAt: new Date(f.body.soldAt),
                    offline: true,
                    changeGiven: 1900,
                    stockShortfall: false,
                }),
            ],
            expect.anything(),
        );
        expect(f.details.insertMany).toHaveBeenCalledWith(
            [
                expect.objectContaining({
                    quantity: 450,
                    unitPrice: 18000,
                    unit: UnitOfMeasure.KG,
                }),
            ],
            expect.anything(),
        );
    });
    it('records stock shortfalls and upserts missing inventory', async () => {
        f.inventory.findOne.mockReturnValue(new Query(null));
        await f.service.sync(f.actor, f.body);
        expect(f.sales.create.mock.calls[0]?.[0][0]).toMatchObject({
            stockShortfall: true,
        });
        expect(f.inventory.updateOne.mock.calls[0]?.[1]).toMatchObject({
            $set: { offlineShortfall: true },
        });
    });
    it.each([
        'lease',
        'owner',
        'past',
        'future',
        'expired',
        'duplicates',
        'quantity',
        'large',
        'empty-total',
    ])('rejects invalid %s before recording', async (mode) => {
        if (mode === 'lease')
            f.leases.findById.mockReturnValue(new Query(null));
        if (mode === 'owner') f.actor.userId = String(id());
        if (mode === 'past') f.body.soldAt = new Date(0).toISOString();
        if (mode === 'future')
            f.body.soldAt = new Date(Date.now() + 300000).toISOString();
        if (mode === 'expired')
            f.body.soldAt = new Date(Date.now() + 7200000).toISOString();
        if (mode === 'duplicates') f.body.lines.push(f.body.lines[0]!);
        if (mode === 'quantity') f.body.lines[0]!.quantity = 0;
        if (mode === 'large')
            f.body.lines[0]!.quantity = Number.MAX_SAFE_INTEGER;
        if (mode === 'empty-total') f.body.lines = [];
        await expect(f.service.sync(f.actor, f.body)).rejects.toMatchObject({
            statusCode: mode === 'empty-total' ? 400 : 409,
        });
        expect(f.sales.create).not.toHaveBeenCalled();
    });
    it.each([
        'forged',
        'purpose',
        'lease',
        'cashier',
        'shift',
        'product',
        'unit',
        'price',
        'iat',
        'exp',
        'exp-beyond-lease',
        'fractional-iat',
        'fractional-exp',
    ])('rejects %s proof', async (mode) => {
        const patch: Record<string, unknown> = {};
        if (mode === 'purpose') patch.purpose = 'login';
        if (['lease', 'cashier', 'shift', 'product'].includes(mode))
            patch[mode] = String(id());
        if (mode === 'unit') patch.unit = 'BOX';
        if (mode === 'price') patch.price = 0;
        if (mode === 'iat') patch.iat = Math.floor(Date.now() / 1000) + 30;
        if (mode === 'exp') patch.exp = Math.floor(Date.now() / 1000) - 30;
        if (mode === 'fractional-iat') patch.iat = Date.now() / 1000 - 0.12345;
        if (mode === 'fractional-exp')
            patch.exp = f.lease.expiresAt.getTime() / 1000 - 0.12345;
        if (mode === 'exp-beyond-lease')
            patch.exp = Math.floor(Date.now() / 1000) + 90000;
        f.body.lines[0]!.proof = mode === 'forged' ? 'invalid' : f.proof(patch);
        await expect(f.service.sync(f.actor, f.body)).rejects.toMatchObject({
            code: ErrorCode.OFFLINE_INVALID,
        });
    });
    it.each([1, NUMERIC_LIMITS.AMOUNT_MAX + 1])(
        'refuses insufficient or over-cap cash %s',
        async (amount) => {
            f.body.amountTendered = amount;
            await expect(f.service.sync(f.actor, f.body)).rejects.toMatchObject(
                { statusCode: 400 },
            );
        },
    );
    it.each([
        'inactive',
        'role',
        'sid',
        'version',
        'closed',
        'inactive-lease',
        'expired-lease',
        'session',
    ])('requires admin after %s', async (mode) => {
        if (mode === 'inactive') f.user.isActive = false;
        if (mode === 'role') f.user.roles = [];
        if (mode === 'sid') f.actor.sid = String(id());
        if (mode === 'version') f.user.overridePinVersion = 'changed';
        if (mode === 'closed') f.shift.status = ShiftStatus.CLOSED;
        if (mode === 'inactive-lease') f.lease.active = false;
        if (mode === 'expired-lease')
            f.lease.expiresAt = new Date(Date.now() - 1);
        if (mode === 'session')
            f.sessions.findOne.mockReturnValue(new Query(null));
        await expect(f.service.sync(f.actor, f.body)).rejects.toMatchObject({
            code: expect.stringMatching(/OFFLINE/),
        });
    });
    it.each([
        'cashier',
        'shift',
        'ownership',
        'product',
        'unit',
        'EAN',
        'lease-lock',
        'shift-lock',
        'stock',
    ])('refuses missing or changed %s atomically', async (mode) => {
        if (mode === 'cashier')
            f.users.findById.mockReturnValue(new Query(null) as never);
        if (mode === 'shift')
            f.shifts.findById.mockReturnValue(new Query(null));
        if (mode === 'ownership') f.shift.cashier = id();
        if (mode === 'product')
            f.products.findById.mockReturnValue(new Query(null));
        if (mode === 'unit') f.product.unit = UnitOfMeasure.L;
        if (mode === 'EAN') f.product.EAN = 'changed';
        if (mode === 'lease-lock')
            f.leases.updateOne.mockResolvedValue({ matchedCount: 0 });
        if (mode === 'shift-lock')
            f.shifts.updateOne.mockResolvedValue({ matchedCount: 0 });
        if (mode === 'stock') f.stock.stock = NaN;
        await expect(f.service.sync(f.actor, f.body)).rejects.toHaveProperty(
            'statusCode',
        );
        expect(f.sales.create).not.toHaveBeenCalled();
    });
    it('lets an active admin reconcile an inactive cashier’s closed shift without replacing Z-read', async () => {
        f.user.isActive = false;
        f.shift.status = ShiftStatus.CLOSED;
        await f.service.sync(
            f.admin,
            { ...f.body, reason: 'Verified counted cash' },
            true,
        );
        expect(f.sales.create.mock.calls[0]?.[0][0]).toMatchObject({
            lateOffline: true,
            reconciledBy: expect.any(Types.ObjectId),
            reconciliationReason: 'Verified counted cash',
        });
        expect(f.shifts.updateOne).toHaveBeenCalledWith(
            { _id: f.shift._id },
            { $inc: { lateOfflineCount: 1 } },
            expect.anything(),
        );
    });
    it.each(['admin', 'reason', 'missing-reason'])(
        'refuses admin reconciliation without %s',
        async (mode) => {
            if (mode === 'admin')
                f.users.findOne.mockReturnValue(new Query(null) as never);
            await expect(
                f.service.sync(
                    f.admin,
                    mode === 'missing-reason'
                        ? f.body
                        : {
                              ...f.body,
                              reason: mode === 'reason' ? '' : 'verified',
                          },
                    true,
                ),
            ).rejects.toMatchObject({ statusCode: 403 });
        },
    );
    it('replays already synced cash before expiry/shift checks without another decrement', async () => {
        f.sales.findOne.mockReturnValue(
            new Query({
                ...f.createdSale,
                requestHash: offlineRequestHash(f.actor.userId, f.body),
            }),
        );
        f.shift.status = ShiftStatus.CLOSED;
        expect(await f.service.sync(f.actor, f.body)).toEqual(f.receipt);
        expect(f.inventory.updateOne).not.toHaveBeenCalled();
    });
    it('refuses idempotency collisions without exposing a different cashier’s receipt', async () => {
        f.sales.findOne.mockReturnValue(
            new Query({ ...f.createdSale, requestHash: 'different' }),
        );
        await expect(f.service.sync(f.actor, f.body)).rejects.toMatchObject({
            code: ErrorCode.SALE_IDEMPOTENCY_MISMATCH,
        });
        expect(f.receipts.receiptOf).not.toHaveBeenCalled();
    });
    it('recovers a committed winner after a concurrent transaction error', async () => {
        f.sales.findOne
            .mockReturnValueOnce(new Query(null))
            .mockReturnValueOnce(
                new Query({
                    ...f.createdSale,
                    requestHash: offlineRequestHash(f.actor.userId, f.body),
                }),
            );
        f.sales.create.mockRejectedValue(new Error('concurrent winner'));
        expect(await f.service.sync(f.actor, f.body)).toEqual(f.receipt);
    });
    it('does not claim a missing recorded sale succeeded', async () => {
        f.sales.findById.mockReturnValue(new Query(null));
        await expect(f.service.sync(f.actor, f.body)).rejects.toMatchObject({
            statusCode: 500,
        });
    });
    it('uses a clear receipt name if the user disappeared after recording', async () => {
        f.users.findById
            .mockReturnValueOnce(new Query(f.user))
            .mockReturnValueOnce(new Query(null) as never);
        await f.service.sync(f.actor, f.body);
        expect(f.receipts.receiptOf.mock.calls[0]?.[1]).toMatchObject({
            username: 'Former cashier',
        });
    });
    it('canonicalizes ObjectId casing and line order for replay hashes', () => {
        const second = { ...f.body.lines[0]!, product: String(id()) };
        const body = { ...f.body, lines: [...f.body.lines, second] };
        expect(offlineRequestHash(f.actor.userId, body)).toBe(
            offlineRequestHash(f.actor.userId, {
                ...body,
                lines: [...body.lines]
                    .reverse()
                    .map((l) => ({ ...l, product: l.product.toUpperCase() })),
            }),
        );
    });
});

describe('sub-second offline selling deadline', () => {
    afterEach(() => jest.restoreAllMocks());
    function boundary() {
        const clock = jest.spyOn(Date, 'now').mockReturnValue(100900);
        f = fixture();
        f.lease.expiresAt = new Date(200500);
        f.body.soldAt = new Date(199500).toISOString();
        return clock;
    }
    it.each([
        [100900, 200500],
        [100100, 200500],
        [100000, 200000],
        [199999, 200000],
        [200499, 200500],
        [100999, 200001],
    ])(
        'preserves only the issuer rounding window for issuance %s / deadline %s',
        async (issued, deadline) => {
            const clock = jest.spyOn(Date, 'now').mockReturnValue(issued);
            f = fixture();
            f.lease.expiresAt = new Date(deadline);
            const page = await f.service.catalog(f.actor, {
                lease: String(f.lease._id),
            });
            const payload = f.jwt.decode<{ iat: number; exp: number }>(
                page.products[0].proof,
            );
            expect(payload.exp).toBe(Math.ceil(deadline / 1000));
            f.body.soldAt = new Date(deadline - 1).toISOString();
            f.body.lines[0].proof = f.proof({
                iat: Math.floor(issued / 1000),
                exp:
                    Math.floor(issued / 1000) +
                    Math.max(1, Math.floor((deadline - issued) / 1000)),
            });
            clock.mockReturnValue(deadline - 1);
            await expect(f.service.sync(f.actor, f.body)).resolves.toEqual(
                f.receipt,
            );
        },
    );
    it('signs the absolute lease deadline without flooring the remaining lifetime twice', async () => {
        boundary();
        const page = await f.service.catalog(f.actor, {
            lease: String(f.lease._id),
        });
        expect(
            f.jwt.decode<{ iat: number; exp: number }>(page.products[0].proof),
        ).toMatchObject({ iat: 100, exp: 201 });
    });
    it.each([false, true])(
        'accepts collected boundary cash with a catalogue proof (admin=%s)',
        async (admin) => {
            const clock = boundary();
            const page = await f.service.catalog(f.actor, {
                lease: String(f.lease._id),
            });
            f.body.lines[0].proof = page.products[0].proof;
            clock.mockReturnValue(admin ? 210000 : 199500);
            await expect(
                f.service.sync(
                    admin ? f.admin : f.actor,
                    { ...f.body, reason: 'Verified boundary cash' },
                    admin,
                ),
            ).resolves.toEqual(f.receipt);
        },
    );
    it.each([false, true])(
        'recovers immutable legacy cash inside the historical double-flooring band (admin=%s)',
        async (admin) => {
            const clock = boundary();
            // The actual historical issuer: floor(iat) + floor(remaining seconds).
            const proof = f.proof({
                iat: 100,
                exp: 100 + Math.floor((200500 - 100900) / 1000),
            });
            expect(f.jwt.decode<{ exp: number }>(proof).exp).toBe(199);
            f.body.lines[0].proof = proof;
            clock.mockReturnValue(admin ? 210000 : 199500);
            await expect(
                f.service.sync(
                    admin ? f.admin : f.actor,
                    { ...f.body, reason: 'Verified legacy boundary cash' },
                    admin,
                ),
            ).resolves.toEqual(f.receipt);
            expect(f.body.lines[0].proof).toBe(proof);
        },
    );
    it('does not treat an impossible historical expiry as rounding loss', async () => {
        const clock = boundary();
        f.lease.expiresAt = new Date(200999);
        f.body.soldAt = new Date(200998).toISOString();
        // At this deadline every millisecond in iat=100 yields exp=200,
        // so exp=199 is unrelated early expiry, despite being one second off.
        f.body.lines[0].proof = f.proof({ iat: 100, exp: 199 });
        clock.mockReturnValue(200998);
        await expect(f.service.sync(f.actor, f.body)).rejects.toMatchObject({
            code: ErrorCode.OFFLINE_INVALID,
        });
    });
    it.each([false, true])(
        'refuses expiry outside the historical rounding band (admin=%s)',
        async (admin) => {
            const clock = boundary();
            f.body.lines[0].proof = f.proof({ iat: 100, exp: 198 });
            clock.mockReturnValue(admin ? 210000 : 199500);
            await expect(
                f.service.sync(
                    admin ? f.admin : f.actor,
                    { ...f.body, reason: 'Review' },
                    admin,
                ),
            ).rejects.toMatchObject({ code: ErrorCode.OFFLINE_INVALID });
            expect(f.sales.create).not.toHaveBeenCalled();
        },
    );
    it.each([false, true])(
        'rejects cash at the exact lease deadline even when JWT rounds up (admin=%s)',
        async (admin) => {
            const clock = boundary();
            f.body.lines[0].proof = f.proof({ iat: 100, exp: 201 });
            f.body.soldAt = new Date(200500).toISOString();
            clock.mockReturnValue(admin ? 210000 : 200500);
            await expect(
                f.service.sync(
                    admin ? f.admin : f.actor,
                    { ...f.body, reason: 'Review' },
                    admin,
                ),
            ).rejects.toMatchObject({ code: ErrorCode.OFFLINE_INVALID });
            expect(f.sales.create).not.toHaveBeenCalled();
        },
    );
});

describe('confidential offline cost evidence', () => {
    it.each([0, 6000, undefined])(
        'copies the server-held known/unknown cost %s without exposing it in the proof',
        async (cost) => {
            Object.assign(f.product, { lastCost: cost });
            const page = await f.service.catalog(f.actor, {
                lease: String(f.lease._id),
            });
            const payload = f.jwt.decode<Record<string, unknown>>(
                page.products[0].proof,
            );
            expect(payload).toHaveProperty('costRef');
            expect(payload).not.toHaveProperty('unitCost');
            expect(payload).not.toHaveProperty('lastCost');
            expect(f.costQuotes.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    product: f.product._id,
                    lease: f.lease._id,
                    ...(cost !== undefined && { unitCost: cost }),
                }),
            );
        },
    );
    it.each([0, 6000, undefined])(
        'records immutable evidence cost %s when consuming a price proof',
        async (cost) => {
            const ref = String(id());
            f.costQuotes.findOne.mockReturnValue(
                new Query({ ...(cost !== undefined && { unitCost: cost }) }),
            );
            f.body.lines[0].proof = f.proof({ costRef: ref });
            await f.service.sync(f.actor, f.body);
            expect(f.costQuotes.findOne).toHaveBeenCalledWith({
                _id: ref,
                lease: f.lease._id,
                product: f.body.lines[0].product,
                unit: UnitOfMeasure.KG,
            });
            const lines = f.details.insertMany.mock.calls[0][0] as {
                unitCost?: number;
            }[];
            if (cost === undefined)
                expect(lines[0]).not.toHaveProperty('unitCost');
            else expect(lines[0].unitCost).toBe(cost);
        },
    );
    it.each(['missing', 'malformed'])(
        'refuses %s evidence rather than guessing a later cost',
        async (mode) => {
            f.costQuotes.findOne.mockReturnValue(new Query(null));
            f.body.lines[0].proof = f.proof({
                costRef: mode === 'missing' ? String(id()) : 'invalid',
            });
            await expect(f.service.sync(f.actor, f.body)).rejects.toMatchObject(
                { code: ErrorCode.OFFLINE_INVALID },
            );
            expect(f.details.insertMany).not.toHaveBeenCalled();
        },
    );
});
