import type { SaleDoc } from '../../src/sales/sales.schema';
import { JwtService } from '@nestjs/jwt';
/** Manager approval authority against real transactions, indexes and HTTP. */
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import {
    DiscountType,
    ErrorCode,
    OverrideAction,
    Role,
    SaleStatus,
    TenderType,
    MANAGER_OVERRIDE_SHAPE,
    wireShapeDiff,
    type ManagerOverrideResponse,
} from '@grocery-pos/contracts';
import { ManagerOverrideService } from '../../src/auth/override/override.service';
import { OverrideGrant } from '../../src/auth/override/override-grant.schema';
import { runInTransaction } from '../../src/common/utils/db';
import {
    approvalHeaders,
    discountApprovalHeaders,
    ensureApprovalFixtures,
    FIXTURE_MANAGER,
} from './approval-fixtures';
import {
    bootDbApp,
    caller,
    cashSale,
    openShift,
    read,
    grantStepUp,
    seedProduct,
    stockOf,
    type DbApp,
    type Caller,
} from './db-app';

let db: DbApp;
let seller: Caller;
let product: string;
let service: ManagerOverrideService;
const admin = caller('override-admin', Role.Admin);
const discounted = () => ({
    ...cashSale(product, 1, 1000),
    discount: { type: DiscountType.PERCENT, value: 10, reason: 'Promotion' },
});
beforeAll(async () => {
    db = await bootDbApp();
    await Promise.all(
        [
            'User',
            'OverrideGrant',
            'Sales',
            'SalesDetails',
            'Shift',
            'Inventory',
            'Product',
        ].map((name) => db.model(name).init()),
    );
    await ensureApprovalFixtures(db, admin);
    service = db.app.get(ManagerOverrideService);
});
afterAll(async () => {
    await db?.close();
});
beforeEach(async () => {
    seller = caller(`cashier-${randomUUID().slice(0, 8)}`, Role.Seller);
    await ensureApprovalFixtures(db, seller);
    await openShift(db, seller);
    product = await seedProduct(db, 1000, 10);
    await grantStepUp(db, admin);
});
async function issueDiscount(body = discounted()) {
    const headers = await discountApprovalHeaders(db, seller, body);
    return { body, headers };
}
async function storedSale(id: string) {
    return db.connection
        .db!.collection<SaleDoc>('sales')
        .findOne({ _id: new Types.ObjectId(id) });
}
async function saleId() {
    const response = await read(
        await db.call(seller, 'POST', '/sales', cashSale(product, 1, 1000)),
    );
    expect(response.status).toBe(201);
    return response.body._id as string;
}

describe('manager overrides (#34)', () => {
    it('refuses even the smallest discount without approval, with no stock or sale written', async () => {
        const body = {
            ...discounted(),
            discount: {
                type: DiscountType.FIXED,
                value: 1,
                reason: 'One centavo',
            },
        };
        const result = await read(
            await db.call(seller, 'POST', '/sales', body),
        );
        expect(result.status).toBe(403);
        expect(result.body.error).toBe(ErrorCode.OVERRIDE_REQUIRED);
        expect(await stockOf(db, product)).toBe(10);
        expect(
            await db
                .model('Sales')
                .countDocuments({ idempotencyKey: body.idempotencyKey }),
        ).toBe(0);
    });
    it('issues approval through HTTP and stores the ADMIN who approved the discount', async () => {
        const body = discounted();
        const approval = await read<ManagerOverrideResponse>(
            await db.call(seller, 'POST', '/auth/override', {
                username: ` ${FIXTURE_MANAGER.toUpperCase()} `,
                pin: '012345',
                action: OverrideAction.DISCOUNT,
                context: { sale: body, expectedSubtotal: 1000 },
            }),
        );
        expect(approval.status).toBe(201);
        expect(wireShapeDiff(approval.body, MANAGER_OVERRIDE_SHAPE)).toEqual({
            missing: [],
            unexpected: [],
        });
        const result = await read(
            await db.call(seller, 'POST', '/sales', body, {
                'X-Manager-Approval': approval.body.token,
            }),
        );
        expect(result.status).toBe(201);
        expect(result.body.totalAmount).toBe(900);
        const stored = await storedSale(result.body._id as string);
        expect(String(stored!.discount!.approvedBy)).toBe(
            approval.body.approver._id,
        );
        expect(String(stored!.discount!.approvedBy)).not.toBe(seller.userId);
    });
    it('replays an approved sale without another PIN or grant consumption', async () => {
        const { body, headers } = await issueDiscount();
        const first = await read(
            await db.call(seller, 'POST', '/sales', body, headers),
        );
        const replay = await read(
            await db.call(seller, 'POST', '/sales', body),
        );
        expect(first.status).toBe(201);
        expect(replay.status).toBe(201);
        expect(replay.body._id).toBe(first.body._id);
        expect(await stockOf(db, product)).toBe(9);
    });
    it('does not transfer approval to another checkout key, reason or cashier', async () => {
        const { body, headers } = await issueDiscount();
        for (const changed of [
            { ...body, idempotencyKey: randomUUID() },
            { ...body, discount: { ...body.discount, reason: 'Other' } },
        ]) {
            const result = await read(
                await db.call(seller, 'POST', '/sales', changed, headers),
            );
            expect(result.status).toBe(403);
            expect(result.body.error).toBe(ErrorCode.OVERRIDE_INVALID);
        }
        const other = caller(`other-${randomUUID().slice(0, 8)}`, Role.Seller);
        await ensureApprovalFixtures(db, other);
        await openShift(db, other);
        expect(
            (await db.call(other, 'POST', '/sales', body, headers)).status,
        ).toBe(403);
        expect(await stockOf(db, product)).toBe(10);
    });
    it('rejects prices changed since approval, even when the request is unchanged', async () => {
        const { body, headers } = await issueDiscount();
        await db
            .model('Product')
            .updateOne({ _id: product }, { $set: { price: 1100 } });
        const result = await read(
            await db.call(seller, 'POST', '/sales', body, headers),
        );
        expect(result.status).toBe(403);
        expect(await stockOf(db, product)).toBe(10);
    });
    it('rejects expired grants before asynchronous TTL deletion', async () => {
        const { body, headers } = await issueDiscount();
        await db
            .model(OverrideGrant.name)
            .updateMany(
                { cashier: seller.userId },
                { $set: { expiresAt: new Date(Date.now() - 1) } },
            );
        expect(
            (await db.call(seller, 'POST', '/sales', body, headers)).status,
        ).toBe(403);
    });
    it('consumes a grant exactly once under concurrent transactions', async () => {
        const { headers } = await issueDiscount();
        const grant = await db
            .model<OverrideGrant>(OverrideGrant.name)
            .findOne({ cashier: seller.userId })
            .lean();
        const decoded = db.app
            .get(JwtService)
            .decode<{ grantId: string }>(headers['X-Manager-Approval']);
        expect(decoded.grantId).toBe(String(grant!._id));
        expect(grant).toMatchObject({
            cashier: new Types.ObjectId(seller.userId),
            sessionId: seller.userId,
            action: OverrideAction.DISCOUNT,
            consumedAt: null,
        });
        expect(grant!.expiresAt.getTime()).toBeGreaterThan(Date.now());
        const results = await Promise.allSettled(
            Array.from({ length: 6 }, () =>
                runInTransaction(async (session) => {
                    return service.consume(
                        headers['X-Manager-Approval'],
                        { ...seller, sid: seller.userId },
                        OverrideAction.DISCOUNT,
                        grant!.contextHash,
                        session,
                    );
                }, db.connection),
            ),
        );
        if (results.every((r) => r.status === 'rejected')) {
            const first = results[0];
            if (first.reason instanceof Error) throw first.reason;
        }
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const rejected = results.filter(
            (r): r is PromiseRejectedResult => r.status === 'rejected',
        );
        expect(rejected).toHaveLength(5);
        for (const r of rejected)
            expect(r.reason).toMatchObject({
                code: ErrorCode.OVERRIDE_INVALID,
            });
    });
    it('rolls grant consumption back when the surrounding monetary transaction fails', async () => {
        const { body, headers } = await issueDiscount();
        // Insufficient cash is detected after approval consumption, but before sale creation.
        const insufficient = {
            ...body,
            tenders: [{ type: TenderType.CASH, amount: 1 }],
        };
        const insufficientHeaders = await discountApprovalHeaders(
            db,
            seller,
            insufficient,
        );
        expect(
            (
                await db.call(
                    seller,
                    'POST',
                    '/sales',
                    insufficient,
                    insufficientHeaders,
                )
            ).status,
        ).toBe(400);
        const grants = await db
            .model<OverrideGrant>(OverrideGrant.name)
            .find({ cashier: seller.userId })
            .lean();
        expect(grants.every((g) => g.consumedAt === null)).toBe(true);
        expect(
            (await db.call(seller, 'POST', '/sales', body, headers)).status,
        ).toBe(201);
    });
    it('invalidates a pending grant when the admin PIN is reset', async () => {
        const { body, headers } = await issueDiscount();
        const manager = await db
            .model('User')
            .findOne({ name: FIXTURE_MANAGER })
            .lean();
        expect(
            (
                await db.call(
                    admin,
                    'PATCH',
                    `/users/${String(manager!._id)}/override-pin`,
                    { pin: '012345' },
                )
            ).status,
        ).toBe(200);
        expect(
            (await db.call(seller, 'POST', '/sales', body, headers)).status,
        ).toBe(403);
    });
    it('invalidates approver deactivation, and does not revive an old grant after reactivation', async () => {
        const { body, headers } = await issueDiscount();
        const manager = await db
            .model('User')
            .findOne({ name: FIXTURE_MANAGER })
            .lean();
        for (const isActive of [false, true]) {
            expect(
                (
                    await db.call(admin, 'PATCH', '/users', {
                        updates: [
                            {
                                user: String(manager!._id),
                                update: { isActive },
                            },
                        ],
                    })
                ).status,
            ).toBe(200);
        }
        expect(
            (await db.call(seller, 'POST', '/sales', body, headers)).status,
        ).toBe(403);
    });
    it('revokes manager approvals on role changes and clears PINs when the role loses approval authority', async () => {
        const { body, headers } = await issueDiscount();
        const manager = await db
            .model('User')
            .findOne({ name: FIXTURE_MANAGER })
            .lean();
        for (const roles of [[Role.Seller], [Role.Admin]]) {
            expect(
                (
                    await db.call(admin, 'PATCH', '/users', {
                        updates: [
                            { user: String(manager!._id), update: { roles } },
                        ],
                    })
                ).status,
            ).toBe(200);
        }
        expect(
            (await db.call(seller, 'POST', '/sales', body, headers)).status,
        ).toBe(403);
        await expect(
            discountApprovalHeaders(db, seller, body),
        ).rejects.toMatchObject({
            code: ErrorCode.OVERRIDE_CREDENTIALS_INVALID,
        });
        expect(
            (
                await db.call(
                    admin,
                    'PATCH',
                    `/users/${String(manager!._id)}/override-pin`,
                    { pin: '012345' },
                )
            ).status,
        ).toBe(200);
    });

    it('does not revive a cashier approval after deactivation and reactivation', async () => {
        const { body, headers } = await issueDiscount();
        for (const isActive of [false, true]) {
            expect(
                (
                    await db.call(admin, 'PATCH', '/users', {
                        updates: [
                            { user: seller.userId, update: { isActive } },
                        ],
                    })
                ).status,
            ).toBe(200);
        }
        expect(
            (await db.call(seller, 'POST', '/sales', body, headers)).status,
        ).toBe(403);
    });

    it('checks the requester current role rather than a stale ADMIN token', async () => {
        const id = await saleId();
        const headers = await approvalHeaders(db, admin, OverrideAction.VOID, {
            reversal: { saleId: id, reason: 'Wrong ring' },
        });
        await db
            .model('User')
            .updateOne(
                { _id: admin.userId },
                { $set: { roles: [Role.Seller] } },
            );
        expect(
            (
                await db.call(
                    admin,
                    'POST',
                    `/sales/${id}/void`,
                    { reason: 'Wrong ring' },
                    headers,
                )
            ).status,
        ).toBe(403);
        await db
            .model('User')
            .updateOne(
                { _id: admin.userId },
                { $set: { roles: [Role.Admin] } },
            );
    });
    it('allows an approved cashier reversal only for their own open-shift sale', async () => {
        const id = await saleId();
        expect(
            (
                await db.call(seller, 'POST', `/sales/${id}/void`, {
                    reason: 'Wrong ring',
                })
            ).status,
        ).toBe(403);
        const headers = await approvalHeaders(db, seller, OverrideAction.VOID, {
            reversal: { saleId: id, reason: 'Wrong ring' },
        });
        const result = await read(
            await db.call(
                seller,
                'POST',
                `/sales/${id}/void`,
                { reason: 'Wrong ring' },
                headers,
            ),
        );
        expect(result.status).toBe(201);
        expect(result.body.status).toBe(SaleStatus.VOIDED);
        expect(result.body.reversal).not.toHaveProperty('payoutShift');
        expect(result.body.reversal).not.toHaveProperty('payoutAmount');
        expect(await stockOf(db, product)).toBe(10);
        const other = caller(`other-${randomUUID().slice(0, 8)}`, Role.Seller);
        await ensureApprovalFixtures(db, other);
        await openShift(db, other);
        await expect(
            approvalHeaders(db, other, OverrideAction.VOID, {
                reversal: { saleId: id, reason: 'Other' },
            }),
        ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });
    it('does not let a cashier redirect the payout or reverse after their shift closes', async () => {
        const id = await saleId();
        const headers = await approvalHeaders(
            db,
            seller,
            OverrideAction.REFUND,
            { reversal: { saleId: id, reason: 'Returned' } },
        );
        expect(
            (
                await db.call(
                    seller,
                    'POST',
                    `/sales/${id}/refund`,
                    {
                        reason: 'Returned',
                        payoutShiftId: new Types.ObjectId().toString(),
                    },
                    headers,
                )
            ).status,
        ).toBe(403);
        await db
            .model('Shift')
            .updateOne(
                { cashier: seller.userId, status: 'OPEN' },
                { $set: { status: 'CLOSED' } },
            );
        expect(
            (
                await db.call(
                    seller,
                    'POST',
                    `/sales/${id}/refund`,
                    { reason: 'Returned' },
                    headers,
                )
            ).status,
        ).toBe(404);
    });
    it('hides PIN hashes and versions from user listings and enforces admin PIN management', async () => {
        const manager = await db
            .model('User')
            .findOne({ name: FIXTURE_MANAGER })
            .lean();
        const listing = await read(
            await db.call(admin, 'GET', '/users?page=1&limit=100'),
        );
        expect(JSON.stringify(listing.body)).not.toMatch(
            /overridePin|overrideApprovalLock|passwordHash/,
        );
        expect(
            (
                await db.call(
                    seller,
                    'PATCH',
                    `/users/${String(manager!._id)}/override-pin`,
                    { pin: '012345' },
                )
            ).status,
        ).toBe(403);
        expect(
            (
                await db.call(
                    admin,
                    'PATCH',
                    `/users/${String(manager!._id)}/override-pin`,
                    { pin: '12345' },
                )
            ).status,
        ).toBe(400);
    });
    it('accepts supervisor PINs for reversal but never discounts', async () => {
        const supervisor = caller('approval-supervisor', Role.Supervisor);
        await ensureApprovalFixtures(db, supervisor);
        expect(
            (
                await db.call(
                    admin,
                    'PATCH',
                    `/users/${supervisor.userId}/override-pin`,
                    { pin: '012345' },
                )
            ).status,
        ).toBe(200);
        const id = await saleId();
        const approved = await service.issue(
            { ...seller, sid: seller.userId },
            {
                username: supervisor.username,
                pin: '012345',
                action: OverrideAction.REFUND,
                context: { reversal: { saleId: id, reason: 'Returned' } },
            },
        );
        expect(
            (
                await db.call(
                    seller,
                    'POST',
                    `/sales/${id}/refund`,
                    { reason: 'Returned' },
                    { 'X-Manager-Approval': approved.token },
                )
            ).status,
        ).toBe(201);
        await expect(
            service.issue(
                { ...seller, sid: seller.userId },
                {
                    username: supervisor.username,
                    pin: '012345',
                    action: OverrideAction.DISCOUNT,
                    context: { sale: discounted(), expectedSubtotal: 1000 },
                },
            ),
        ).rejects.toMatchObject({
            code: ErrorCode.OVERRIDE_CREDENTIALS_INVALID,
        });
    });
    it('rate-limits normalized manager PIN attempts without revealing account existence', async () => {
        const username = 'does-not-exist';
        for (let attempt = 0; attempt < 6; attempt++) {
            const response = await read(
                await db.call(seller, 'POST', '/auth/override', {
                    username:
                        attempt % 2 ? ` ${username.toUpperCase()} ` : username,
                    pin: '999999',
                    action: OverrideAction.DISCOUNT,
                    context: { sale: discounted(), expectedSubtotal: 1000 },
                }),
            );
            expect(response.status).toBe(attempt < 5 ? 403 : 429);
            if (attempt < 5)
                expect(response.body.message).toBe(
                    'Invalid manager username or PIN',
                );
        }
    });
});
