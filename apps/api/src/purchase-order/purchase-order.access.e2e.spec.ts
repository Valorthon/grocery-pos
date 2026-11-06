/**
 * Purchase-order routes over real HTTP (#123): RESTOCKER and ADMIN only,
 * with the global ValidationPipe deciding which bodies reach the service.
 */
import { Role } from '../auth/types';
import {
    ALL_ROLES,
    AccessHarness,
    bootAccessHarness,
    caller,
} from '../common/testing/access-harness';
import { PurchaseOrderController } from './purchase-order.controller';
import { PurchaseOrderService } from './purchase-order.service';

const ID = '507f1f77bcf86cd799439011';
const LINE = { product: ID, orderedQty: 3, expectedCost: 1000 };

describe('Purchase order access and validation (e2e, #123)', () => {
    let harness: AccessHarness;
    const service = {
        list: jest.fn().mockResolvedValue({ data: [], totalItems: 0 }),
        get: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        send: jest.fn().mockResolvedValue({}),
        cancel: jest.fn().mockResolvedValue({}),
        receive: jest.fn().mockResolvedValue({}),
    };
    beforeAll(async () => {
        harness = await bootAccessHarness(
            [PurchaseOrderController],
            [{ provide: PurchaseOrderService, useValue: service }],
        );
    });
    afterAll(async () => {
        await harness.close();
    });
    beforeEach(() => jest.clearAllMocks());

    it.each(ALL_ROLES)(
        'lets only RESTOCKER and ADMIN in (%s)',
        async (role) => {
            const res = await harness.call(
                caller(role),
                'GET',
                '/purchase-orders?page=1&limit=20',
            );
            expect(res.status).toBe(
                role === Role.Restocker || role === Role.Admin ? 200 : 403,
            );
        },
    );

    it('trims the note and accepts a valid draft', async () => {
        const res = await harness.call(
            caller(Role.Restocker),
            'POST',
            '/purchase-orders',
            { supplier: ID, note: '  weekly  ', lines: [LINE] },
        );
        expect(res.status).toBe(201);
        expect(service.create.mock.calls[0][1]).toMatchObject({
            note: 'weekly',
        });
    });

    it.each([
        ['no lines', { supplier: ID, lines: [] }],
        [
            'fractional quantity',
            { supplier: ID, lines: [{ ...LINE, orderedQty: 1.5 }] },
        ],
        [
            'negative cost',
            { supplier: ID, lines: [{ ...LINE, expectedCost: -1 }] },
        ],
        ['too many lines', { supplier: ID, lines: Array(201).fill(LINE) }],
        ['unknown field', { supplier: ID, lines: [LINE], status: 'SENT' }],
    ])('refuses a draft with %s', async (_label, body) => {
        const res = await harness.call(
            caller(Role.Restocker),
            'POST',
            '/purchase-orders',
            body,
        );
        expect(res.status).toBe(400);
        expect(service.create).not.toHaveBeenCalled();
    });

    it('requires a version and an idempotency key to receive', async () => {
        const path = `/purchase-orders/${ID}/receive`;
        const line = { line: ID, quantity: 1, unitCost: 0 };
        const bad = await harness.call(caller(Role.Restocker), 'POST', path, {
            version: 1,
            lines: [line],
        });
        expect(bad.status).toBe(400);
        const ok = await harness.call(caller(Role.Admin), 'POST', path, {
            version: 1,
            idempotencyKey: 'attempt-0001',
            lines: [{ ...line, expiryDate: '2026-12-31', batchNo: ' B1 ' }],
        });
        expect(ok.status).toBe(201);
        expect(service.receive.mock.calls[0][2].lines[0].batchNo).toBe('B1');
    });

    it('refuses an invalid id', async () => {
        const res = await harness.call(
            caller(Role.Restocker),
            'POST',
            '/purchase-orders/nope/send',
            { version: 0 },
        );
        expect(res.status).toBe(400);
    });
});
