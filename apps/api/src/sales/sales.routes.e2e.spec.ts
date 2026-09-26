/**
 * The sales write routes over real HTTP (issue #30): POST /sales and the
 * void/refund routes behind the real guards, GlobalFilter and
 * ValidationPipe. The service is a stub: its logic is unit-tested
 * (sales.service.spec.ts) and its database behaviour (indexes, concurrent
 * checkout, concurrent reversal, rollback) is in the DB suite
 * (apps/api/test/db/sales.db-spec.ts). What is pinned here is what the
 * controller adds: who may call, what reaches the service, and how its
 * errors come back.
 */
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { Role } from '../auth/types';
import {
    AccessHarness,
    bootAccessHarness,
    caller,
} from '../common/testing/access-harness';
import { ConflictError, ErrorCode } from '../common/errors';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { PaymentType, ReversalType, TenderType } from './types';

const PRODUCT = new Types.ObjectId().toString();
const SALE = new Types.ObjectId().toString();
const SHIFT = new Types.ObjectId().toString();

const service = {
    sell: jest.fn(),
    reverse: jest.fn(),
    getAll: jest.fn(),
    getDetails: jest.fn(),
};

let harness: AccessHarness;

beforeAll(async () => {
    harness = await bootAccessHarness(
        [SalesController],
        [{ provide: SalesService, useValue: service }],
    );
});

afterAll(async () => {
    await harness.close();
});

beforeEach(() => {
    jest.resetAllMocks();
    service.sell.mockResolvedValue({ _id: SALE, totalAmount: 4550 });
    service.reverse.mockResolvedValue({ _id: SALE, status: 'VOIDED' });
});

function cashBody(overrides: Record<string, unknown> = {}) {
    return {
        idempotencyKey: randomUUID(),
        paymentType: PaymentType.CASH,
        tenders: [{ type: TenderType.CASH, amount: 5000 }],
        sellDetails: [{ product: PRODUCT, quantity: 1 }],
        ...overrides,
    };
}

async function errorOf(res: Response): Promise<string> {
    return ((await res.json()) as { error: string }).error;
}

describe('POST /sales (e2e)', () => {
    it('records the sale as the caller and returns the server receipt', async () => {
        const seller = caller(Role.Seller);
        const body = cashBody();

        const res = await harness.call(seller, 'POST', '/sales', body);

        expect(res.status).toBe(201);
        // The receipt the client shows comes from the server, as is.
        expect(await res.json()).toEqual({ _id: SALE, totalAmount: 4550 });
        expect(service.sell).toHaveBeenCalledWith(
            expect.objectContaining({ userId: seller.userId }),
            expect.objectContaining({
                idempotencyKey: body.idempotencyKey,
                tenders: [{ type: TenderType.CASH, amount: 5000 }],
            }),
        );
    });

    it('normalises the key and the GCash reference before the service hashes them', async () => {
        // A retry must hash like the first try: an upper-case key or a
        // reference typed with spaces is the same checkout / transfer.
        const key = randomUUID();
        await harness.call(caller(Role.Seller), 'POST', '/sales', {
            idempotencyKey: key.toUpperCase(),
            paymentType: PaymentType.GCASH,
            referenceNumber: '1234 5678 90123',
            tenders: [{ type: TenderType.GCASH, amount: 4550 }],
            sellDetails: [{ product: PRODUCT, quantity: 1 }],
        });

        expect(service.sell).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                idempotencyKey: key,
                referenceNumber: '1234567890123',
            }),
        );
    });

    it.each([
        [
            'a tender in pesos with centavos (45.5)',
            { tenders: [{ type: TenderType.CASH, amount: 45.5 }] },
        ],
        [
            'a fractional quantity',
            { sellDetails: [{ product: PRODUCT, quantity: 1.5 }] },
        ],
        ['a key that is not a UUID', { idempotencyKey: 'retry-1' }],
        [
            'a reference number on a cash sale',
            { referenceNumber: '1234567890123' },
        ],
        [
            'GCash without a reference number',
            {
                paymentType: PaymentType.GCASH,
                tenders: [{ type: TenderType.GCASH, amount: 5000 }],
            },
        ],
        ['no lines', { sellDetails: [] }],
        ['a client-sent total', { totalAmount: 1 }],
    ])('refuses %s with 400 before the service', async (_label, overrides) => {
        const res = await harness.call(
            caller(Role.Seller),
            'POST',
            '/sales',
            cashBody(overrides),
        );

        expect(res.status).toBe(400);
        expect(await errorOf(res)).toBe(ErrorCode.VALIDATION_INVALID_INPUT);
        expect(service.sell).not.toHaveBeenCalled();
    });

    it.each([Role.Restocker, Role.Adjuster, Role.UserManager])(
        'is 403 for %s without SELLER',
        async (role) => {
            const res = await harness.call(
                caller(role),
                'POST',
                '/sales',
                cashBody(),
            );
            expect(res.status).toBe(403);
            expect(service.sell).not.toHaveBeenCalled();
        },
    );

    // Issue #84: ADMIN alone does not sell; an admin account also needs
    // SELLER.
    it('is 403 for an ADMIN-only account, before the service', async () => {
        const res = await harness.call(
            caller(Role.Admin),
            'POST',
            '/sales',
            cashBody(),
        );
        expect(res.status).toBe(403);
        expect(await errorOf(res)).toBe(ErrorCode.FORBIDDEN);
        expect(service.sell).not.toHaveBeenCalled();
    });

    it.each([
        ['SELLER', [Role.Seller]],
        ['ADMIN with SELLER', [Role.Admin, Role.Seller]],
    ])('records a sale for %s', async (_label, roles) => {
        const who = caller(...roles);

        const res = await harness.call(who, 'POST', '/sales', cashBody());

        expect(res.status).toBe(201);
        expect(service.sell).toHaveBeenCalledWith(
            expect.objectContaining({ userId: who.userId }),
            expect.anything(),
        );
    });

    it('answers no open shift with 409 SHIFT_NOT_OPEN (#2)', async () => {
        service.sell.mockRejectedValue(
            new ConflictError(ErrorCode.SHIFT_NOT_OPEN, 'Open a shift first.'),
        );
        const res = await harness.call(
            caller(Role.Seller),
            'POST',
            '/sales',
            cashBody(),
        );
        expect(res.status).toBe(409);
        expect(await errorOf(res)).toBe(ErrorCode.SHIFT_NOT_OPEN);
    });

    it('passes a reused key’s stored receipt through in the 409 details (#7)', async () => {
        // The client credits the drawer from the stored sale, not from
        // what the cashier just re-tendered.
        const receipt = { _id: SALE, totalAmount: 4550 };
        service.sell.mockRejectedValue(
            new ConflictError(
                ErrorCode.SALE_IDEMPOTENCY_MISMATCH,
                'This checkout was already recorded with a different payment',
                { sale: SALE, receipt },
            ),
        );
        const res = await harness.call(
            caller(Role.Seller),
            'POST',
            '/sales',
            cashBody(),
        );
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({
            error: ErrorCode.SALE_IDEMPOTENCY_MISMATCH,
            details: { sale: SALE, receipt },
        });
    });
});

describe('POST /sales/:id/void and /refund (e2e)', () => {
    it.each([
        ['void', ReversalType.VOID],
        ['refund', ReversalType.REFUND],
    ])(
        '/%s reverses as the admin, with the reason and payout shift',
        async (action, type) => {
            const admin = caller(Role.Admin);
            const res = await harness.call(
                admin,
                'POST',
                `/sales/${SALE}/${action}`,
                { reason: '  mis-ring  ', payoutShiftId: SHIFT },
            );

            expect(res.status).toBe(201);
            expect(service.reverse).toHaveBeenCalledWith(
                expect.objectContaining({ userId: admin.userId }),
                SALE,
                { reason: 'mis-ring', payoutShiftId: SHIFT, type },
            );
        },
    );

    it.each([
        ['a malformed sale id', 'not-an-id', { reason: 'x' }],
        ['no reason', SALE, {}],
        ['a blank reason', SALE, { reason: '   ' }],
        ['a malformed payout shift', SALE, { reason: 'x', payoutShiftId: '1' }],
        ['a client-sent amount', SALE, { reason: 'x', amount: 100 }],
    ])('refuses %s with 400', async (_label, id, body) => {
        const res = await harness.call(
            caller(Role.Admin),
            'POST',
            `/sales/${id}/void`,
            body,
        );
        expect(res.status).toBe(400);
        expect(service.reverse).not.toHaveBeenCalled();
    });

    it('answers an already reversed sale with 409 SALE_002', async () => {
        service.reverse.mockRejectedValue(
            new ConflictError(
                ErrorCode.SALE_NOT_REVERSIBLE,
                'Only a completed sale can be voided or refunded',
            ),
        );
        const res = await harness.call(
            caller(Role.Admin),
            'POST',
            `/sales/${SALE}/refund`,
            { reason: 'returned' },
        );
        expect(res.status).toBe(409);
        expect(await errorOf(res)).toBe(ErrorCode.SALE_NOT_REVERSIBLE);
    });
});
