import { JwtService } from '@nestjs/jwt';
import { Connection, Model, Types, type ClientSession } from 'mongoose';
import {
    DiscountType,
    ErrorCode,
    OverrideAction,
    PaymentType,
    Role,
    SaleStatus,
    TenderType,
    type AuthUser,
} from '@grocery-pos/contracts';
import { ManagerOverrideService } from './override.service';
import { OverrideGrant } from './override-grant.schema';
import { User } from '../../user/user.schema';
import { Sales, type SaleDoc } from '../../sales/sales.schema';
import { Shift } from '../../shift/shift.schema';
import { ProductService } from '../../product/product.service';
import { TypedConfigService } from '../../common/typed-config/typed-config.service';
import { ManagerOverrideDto } from './override.dto';
import type { SellDto } from '../../sales/types/sales.dto';

jest.mock('argon2', () => ({
    hash: jest.fn((value: string) => Promise.resolve(`hash:${value}`)),
    verify: jest.fn((hash: string, value: string) =>
        Promise.resolve(hash === `hash:${value}`),
    ),
}));

const SECRET = 'manager-approval-tests-only-0123456789';
const id = () => new Types.ObjectId().toString();
const USER = id();
const MANAGER = id();
const PRODUCT = id();
const SHIFT = id();
const SALE = id();
const GRANT = id();
const session = {} as ClientSession;
const actor: AuthUser = {
    userId: USER,
    username: 'cashier',
    sid: id(),
    roles: [Role.Seller],
};
const admin: AuthUser = { ...actor, roles: [Role.Admin] };
const ticket: SellDto = {
    idempotencyKey: '9d2b1992-d4ca-4c01-878a-c7ae109e0000',
    paymentType: PaymentType.CASH,
    tenders: [{ type: TenderType.CASH, amount: 1000 }],
    sellDetails: [{ product: PRODUCT, quantity: 2 }],
    discount: { type: DiscountType.PERCENT, value: 10, reason: 'Promotion' },
};
function query<T>(value: T) {
    interface Query {
        select(): Query;
        session(): Query;
        lean(): Promise<T>;
    }
    const chain: Query = {
        select: () => chain,
        session: () => chain,
        lean: () => Promise.resolve(value),
    };
    return chain;
}

const sale = {
    _id: new Types.ObjectId(SALE),
    cashier: new Types.ObjectId(USER),
    shift: new Types.ObjectId(SHIFT),
    amount: 1000,
    status: SaleStatus.COMPLETED,
    paymentType: PaymentType.CASH,
    tenders: [{ type: TenderType.CASH, amount: 1000 }],
    changeGiven: 0,
} as SaleDoc;

describe('manager approvals (#34)', () => {
    let service: ManagerOverrideService;
    let users: {
        findOne: jest.Mock;
        findById: jest.Mock;
        updateOne: jest.Mock;
    };
    let grants: { create: jest.Mock; findOneAndUpdate: jest.Mock };
    let sales: { findOne: jest.Mock };
    let shifts: { findOne: jest.Mock };
    let products: { getMany: jest.Mock };
    let jwt: JwtService;
    let transaction: { withTransaction: jest.Mock; endSession: jest.Mock };
    const manager = {
        _id: new Types.ObjectId(MANAGER),
        name: 'manager',
        roles: [Role.Admin],
        isActive: true,
        overridePinHash: 'hash:012345',
        overridePinVersion: 'pin-v1',
    };
    const request = (): ManagerOverrideDto => ({
        username: 'manager',
        pin: '012345',
        action: OverrideAction.DISCOUNT,
        context: { sale: structuredClone(ticket), expectedSubtotal: 1000 },
    });
    beforeEach(() => {
        users = {
            findOne: jest.fn(() => query(manager)),
            findById: jest.fn(() => query(manager)),
            updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
        };
        grants = {
            create: jest.fn().mockResolvedValue([{ _id: GRANT }]),
            findOneAndUpdate: jest.fn(() =>
                query({ approver: MANAGER, approverPinVersion: 'pin-v1' }),
            ),
        };
        sales = { findOne: jest.fn(() => query(sale)) };
        shifts = {
            findOne: jest.fn(() => query({ _id: new Types.ObjectId(SHIFT) })),
        };
        products = {
            getMany: jest
                .fn()
                .mockResolvedValue(new Map([[PRODUCT, { price: 500 }]])),
        };
        jwt = new JwtService();
        transaction = {
            withTransaction: jest.fn(
                async (fn: (session: ClientSession) => Promise<unknown>) =>
                    fn(session),
            ),
            endSession: jest.fn(),
        };
        service = new ManagerOverrideService(
            { startSession: async () => transaction } as unknown as Connection,
            grants as unknown as Model<OverrideGrant>,
            users as unknown as Model<User>,
            sales as unknown as Model<Sales>,
            shifts as unknown as Model<Shift>,
            products as unknown as ProductService,
            jwt,
            { get: () => SECRET } as unknown as TypedConfigService,
        );
    });
    function token(
        payload: object = { grantId: GRANT },
        opts: { expiresIn?: number; audience?: string } = {},
    ) {
        return jwt.sign(payload, {
            secret: SECRET,
            audience: 'grocery-pos-manager-override',
            expiresIn: 60,
            ...opts,
        });
    }

    it('requires admin approval for every positive discount', () => {
        expect(service.requiresDiscountApproval(1)).toBe(true);
        expect(service.requiresDiscountApproval(0)).toBe(false);
    });
    it('issues a 60s session/action/effect-bound grant without returning credentials', async () => {
        service.onModuleInit();
        const result = await service.issue(actor, request());
        expect(result.approver).toEqual({ _id: MANAGER, name: 'manager' });
        expect(result).not.toHaveProperty('pin');
        expect(result).not.toHaveProperty('overridePinHash');
        expect(
            jwt.verify(result.token, {
                secret: SECRET,
                audience: 'grocery-pos-manager-override',
            }),
        ).toMatchObject({ grantId: GRANT });
        expect(grants.create).toHaveBeenCalledWith([
            expect.objectContaining({
                cashier: USER,
                sessionId: actor.sid,
                approverPinVersion: 'pin-v1',
                action: OverrideAction.DISCOUNT,
            }),
        ]);
        expect(Date.parse(result.expiresAt) - Date.now()).toBeGreaterThan(
            59000,
        );
    });
    it.each([
        null,
        { ...manager, isActive: false },
        { ...manager, roles: [Role.Seller] },
        { ...manager, roles: [Role.Supervisor] },
        { ...manager, overridePinVersion: undefined },
        { ...manager, overridePinHash: undefined },
    ])(
        'keeps invalid or ineligible manager credentials generic (%j)',
        async (found) => {
            users.findOne.mockReturnValue(query(found));
            await expect(service.issue(actor, request())).rejects.toMatchObject(
                {
                    code: ErrorCode.OVERRIDE_CREDENTIALS_INVALID,
                    message: 'Invalid manager username or PIN',
                },
            );
            expect(grants.create).not.toHaveBeenCalled();
        },
    );
    it('rejects wrong PIN and absent session', async () => {
        await expect(
            service.issue(actor, { ...request(), pin: '999999' }),
        ).rejects.toMatchObject({
            code: ErrorCode.OVERRIDE_CREDENTIALS_INVALID,
        });
        await expect(
            service.issue({ ...actor, sid: undefined }, request()),
        ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });
    it.each([
        { sale: undefined },
        { reversal: { saleId: SALE, reason: 'x' } },
        { expectedSubtotal: undefined },
        { sale: { ...ticket, discount: undefined } },
    ])('rejects malformed discount context (%j)', async (change) => {
        const dto = request();
        dto.context = { ...dto.context, ...change };
        await expect(service.issue(actor, dto)).rejects.toMatchObject({
            code: ErrorCode.VALIDATION_INVALID_INPUT,
        });
    });
    it('does not let an admin-only account approve a fabricated cashier discount request', async () => {
        await expect(service.issue(admin, request())).rejects.toMatchObject({
            code: ErrorCode.VALIDATION_INVALID_INPUT,
        });
    });
    it('rejects unknown products, changed displayed prices and nonsensical discounts', async () => {
        products.getMany.mockResolvedValueOnce(new Map());
        await expect(service.issue(actor, request())).rejects.toMatchObject({
            code: ErrorCode.VALIDATION_INVALID_INPUT,
        });
        await expect(
            service.issue(actor, {
                ...request(),
                context: { ...request().context, expectedSubtotal: 900 },
            }),
        ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
        for (const value of [0, 100]) {
            const dto = request();
            dto.context.sale!.discount!.value = value;
            await expect(service.issue(actor, dto)).rejects.toMatchObject({
                code: ErrorCode.VALIDATION_INVALID_INPUT,
            });
        }
    });
    it.each([OverrideAction.VOID, OverrideAction.REFUND])(
        'allows supervisor approval for %s, restricted to the current cashier scope',
        async (action) => {
            users.findOne.mockReturnValue(
                query({ ...manager, roles: [Role.Supervisor] }),
            );
            const result = await service.issue(actor, {
                ...request(),
                action,
                context: { reversal: { saleId: SALE, reason: 'Return' } },
            });
            expect(result.token).toBeTruthy();
            expect(sales.findOne).toHaveBeenCalledWith({
                _id: SALE,
                cashier: new Types.ObjectId(USER),
                shift: new Types.ObjectId(SHIFT),
            });
        },
    );
    it('requires an exact reversal context and disallows cashier payout redirection', async () => {
        for (const context of [
            {},
            { sale: ticket },
            { reversal: { saleId: SALE, reason: 'x' }, expectedSubtotal: 1000 },
        ]) {
            await expect(
                service.issue(actor, {
                    ...request(),
                    action: OverrideAction.VOID,
                    context,
                }),
            ).rejects.toMatchObject({
                code: ErrorCode.VALIDATION_INVALID_INPUT,
            });
        }
        await expect(
            service.issue(actor, {
                ...request(),
                action: OverrideAction.VOID,
                context: {
                    reversal: {
                        saleId: SALE,
                        reason: 'x',
                        payoutShiftId: SHIFT,
                    },
                },
            }),
        ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });
    it('refuses already-reversed sales and hides sales outside current scope', async () => {
        sales.findOne.mockReturnValueOnce(
            query({ ...sale, status: SaleStatus.VOIDED }),
        );
        await expect(
            service.issue(actor, {
                ...request(),
                action: OverrideAction.VOID,
                context: { reversal: { saleId: SALE, reason: 'x' } },
            }),
        ).rejects.toMatchObject({ code: ErrorCode.SALE_NOT_REVERSIBLE });
        shifts.findOne.mockReturnValueOnce(query(null));
        await expect(
            service.visibleReversalSale(actor, SALE),
        ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
        sales.findOne.mockReturnValueOnce(query(null));
        await expect(
            service.visibleReversalSale(admin, SALE, session),
        ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });
    it('retains admins global scope and supports legacy sales without shifts', async () => {
        const legacy = { ...sale, shift: undefined };
        sales.findOne.mockReturnValue(query(legacy));
        await service.visibleReversalSale(admin, SALE, session);
        expect(sales.findOne).toHaveBeenCalledWith({ _id: SALE });
        expect(
            service.reversalContext(OverrideAction.VOID, legacy, 'x', SHIFT),
        ).toHaveLength(64);
    });

    it('requires a token and rejects malformed, wrong-purpose, expired or invalid-claim tokens', async () => {
        await expect(
            service.consume(
                undefined,
                actor,
                OverrideAction.DISCOUNT,
                'context',
                session,
            ),
        ).rejects.toMatchObject({ code: ErrorCode.OVERRIDE_REQUIRED });
        for (const value of [
            'bad',
            token({}, { audience: 'access' }),
            token({}, { expiresIn: -1 }),
            token({}),
            token({ grantId: 'bad' }),
            token({ grantId: 4 }),
        ]) {
            await expect(
                service.consume(
                    value,
                    actor,
                    OverrideAction.DISCOUNT,
                    'context',
                    session,
                ),
            ).rejects.toMatchObject({ code: ErrorCode.OVERRIDE_INVALID });
        }
    });
    it('consumes a grant with an atomic session/action/context/expiry guard and current admin permission', async () => {
        expect(
            await service.consume(
                token(),
                actor,
                OverrideAction.DISCOUNT,
                'context',
                session,
            ),
        ).toBe(MANAGER);
        expect(grants.findOneAndUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                cashier: new Types.ObjectId(USER),
                sessionId: actor.sid,
                action: OverrideAction.DISCOUNT,
                contextHash: 'context',
                consumedAt: null,
                expiresAt: { $gt: expect.any(Date) },
            }),
            expect.anything(),
            { session, new: true },
        );
        expect(users.updateOne).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: MANAGER,
                overridePinVersion: 'pin-v1',
                isActive: true,
                roles: { $in: [Role.Admin] },
            }),
            expect.anything(),
            { session },
        );
    });
    it('refuses spent, changed or unmatched grants and absent requester session', async () => {
        grants.findOneAndUpdate.mockReturnValue(query(null));
        await expect(
            service.consume(
                token(),
                { ...actor, sid: undefined },
                OverrideAction.VOID,
                'ctx',
                session,
            ),
        ).rejects.toMatchObject({ code: ErrorCode.OVERRIDE_INVALID });
        expect(grants.findOneAndUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ sessionId: '' }),
            expect.anything(),
            expect.anything(),
        );
    });
    it('refuses revocation or deactivation after approval', async () => {
        users.updateOne.mockResolvedValueOnce({ matchedCount: 0 });
        await expect(
            service.consume(
                token(),
                actor,
                OverrideAction.DISCOUNT,
                'ctx',
                session,
            ),
        ).rejects.toMatchObject({ code: ErrorCode.OVERRIDE_INVALID });
        users.updateOne
            .mockResolvedValueOnce({ matchedCount: 1 })
            .mockResolvedValueOnce({ matchedCount: 0 });
        await expect(
            service.consume(
                token(),
                actor,
                OverrideAction.REFUND,
                'ctx',
                session,
            ),
        ).rejects.toMatchObject({ code: ErrorCode.OVERRIDE_INVALID });
    });
    it('checks supervisor-or-admin eligibility for reversal grants', async () => {
        await service.consume(
            token(),
            actor,
            OverrideAction.VOID,
            'ctx',
            session,
        );
        expect(users.updateOne).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: MANAGER,
                roles: { $in: [Role.Admin, Role.Supervisor] },
            }),
            expect.anything(),
            expect.anything(),
        );
    });
    it('sets and clears a PIN only through an active stored admin', async () => {
        await service.setPin(admin, MANAGER, { pin: '012345' });
        expect(users.updateOne).toHaveBeenCalledWith(
            { _id: MANAGER },
            {
                $set: {
                    overridePinHash: 'hash:012345',
                    overridePinVersion: expect.any(String),
                },
            },
            { session },
        );
        await service.setPin(admin, MANAGER, { pin: null });
        expect(users.updateOne).toHaveBeenCalledWith(
            { _id: MANAGER },
            {
                $unset: { overridePinHash: 1 },
                $set: { overridePinVersion: expect.any(String) },
            },
            { session },
        );
        expect(transaction.endSession).toHaveBeenCalledTimes(2);
    });
    it('rejects PIN admin actions when actor, target or target roles are invalid', async () => {
        users.findOne.mockReturnValueOnce(query(null));
        await expect(
            service.setPin(admin, MANAGER, { pin: '012345' }),
        ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
        users.findById.mockReturnValueOnce(query(null));
        await expect(
            service.setPin(admin, MANAGER, { pin: '012345' }),
        ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
        users.findById.mockReturnValueOnce(
            query({ ...manager, roles: [Role.Seller] }),
        );
        await expect(
            service.setPin(admin, MANAGER, { pin: '012345' }),
        ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_INVALID_INPUT });
    });
});
