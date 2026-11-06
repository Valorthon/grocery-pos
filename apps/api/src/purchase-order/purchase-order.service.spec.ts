import { Types } from 'mongoose';
import {
    AuditAction,
    PurchaseOrderStatus,
    purchaseOrderReference,
    Role,
    UnitOfMeasure,
} from '@grocery-pos/contracts';
import {
    PurchaseOrderService,
    expectedTotal,
    nextStatus,
    receiveRequestHash,
} from './purchase-order.service';
import { ErrorCode } from '../common/errors';
import { PurchaseOrderController } from './purchase-order.controller';
import type { AuditEvent } from '../audit/audit.service';
import { auditFields } from '../audit/audit-fields';

class Query<T> {
    constructor(readonly value: T) {}
    sort = jest.fn(() => this);
    skip = jest.fn(() => this);
    limit = jest.fn(() => this);
    select = jest.fn(() => this);
    session = jest.fn(() => this);
    lean = jest.fn(() => this);
    then<R>(resolve: (value: T) => R) {
        return Promise.resolve(this.value).then(resolve);
    }
}

const actor = {
    userId: String(new Types.ObjectId()),
    username: 'r',
    roles: [Role.Restocker],
};

function fixture(status = PurchaseOrderStatus.SENT, receivedQty = 0) {
    const productId = new Types.ObjectId();
    const supplierId = new Types.ObjectId();
    const lineId = new Types.ObjectId();
    const row = {
        _id: new Types.ObjectId(),
        supplier: supplierId,
        status,
        version: 2,
        createdBy: new Types.ObjectId(actor.userId),
        closedShort: false,
        lines: [
            {
                _id: lineId,
                product: productId,
                unit: UnitOfMeasure.KG,
                orderedQty: 5000,
                receivedQty,
                expectedCost: 18000,
            },
        ],
        receipts: [] as {
            key: string;
            requestHash: string;
            restock: Types.ObjectId;
        }[],
        createdAt: new Date('2026-11-06T00:00:00Z'),
        updatedAt: new Date('2026-11-06T00:00:00Z'),
    };
    const orders = {
        findById: jest.fn(() => new Query(row)),
        find: jest.fn(() => new Query([row])),
        countDocuments: jest.fn(async () => 1),
        create: jest.fn(async () => [{ _id: row._id }]),
        updateOne: jest.fn<
            Promise<{ matchedCount: number }>,
            [unknown, unknown, unknown]
        >(async () => ({ matchedCount: 1 })),
    };
    const product = {
        _id: productId,
        name: 'rice',
        EAN: '4800000000017',
        unit: UnitOfMeasure.KG,
        isActive: true,
        tracksExpiry: false,
    };
    const products = { find: jest.fn(() => new Query([product])) };
    const supplierRows = {
        find: jest.fn(
            () =>
                new Query([{ _id: supplierId, name: 'Farm', isActive: false }]),
        ),
    };
    const users = {
        find: jest.fn(
            () => new Query([{ _id: row.createdBy, name: 'restocker' }]),
        ),
    };
    const suppliers = {
        assertActive: jest.fn(async () => undefined),
    };
    const restockId = new Types.ObjectId();
    const restocks = {
        restock: jest.fn<Promise<Types.ObjectId>, unknown[]>(
            async () => restockId,
        ),
    };
    const session = {
        withTransaction: async (fn: (s: unknown) => unknown) => fn(session),
        endSession: jest.fn(),
    };
    const connection = { startSession: jest.fn(async () => session) };
    const audit = {
        record: jest.fn<Promise<void>, [AuditEvent, unknown]>(
            async () => undefined,
        ),
    };
    const service = new PurchaseOrderService(
        connection as never,
        orders as never,
        products as never,
        supplierRows as never,
        users as never,
        suppliers as never,
        restocks as never,
        audit as never,
    );
    return {
        service,
        row,
        orders,
        products,
        product,
        suppliers,
        restocks,
        restockId,
        lineId,
        productId,
        supplierId,
        session,
        audit,
    };
}

describe('purchase order helpers', () => {
    it('totals measured lines with half-up quantityAmount', () => {
        expect(
            expectedTotal([
                {
                    orderedQty: 450,
                    expectedCost: 18000,
                    unit: UnitOfMeasure.KG,
                },
            ]),
        ).toBe(8100);
    });
    it('refuses an expected total above AMOUNT_MAX', () => {
        expect(() =>
            expectedTotal([
                {
                    orderedQty: 2,
                    expectedCost: 1_000_000_000,
                    unit: UnitOfMeasure.PIECE,
                },
            ]),
        ).toThrow('maximum amount');
    });
    it('is RECEIVED only when every line is fully received', () => {
        expect(
            nextStatus([
                { orderedQty: 2, receivedQty: 2 },
                { orderedQty: 3, receivedQty: 1 },
            ]),
        ).toBe(PurchaseOrderStatus.PARTIALLY_RECEIVED);
        expect(nextStatus([{ orderedQty: 2, receivedQty: 2 }])).toBe(
            PurchaseOrderStatus.RECEIVED,
        );
    });
});

describe('PurchaseOrderService', () => {
    it('creates a draft with an active supplier and snapshots the unit', async () => {
        const f = fixture(PurchaseOrderStatus.DRAFT);
        const view = await f.service.create(actor, {
            supplier: String(f.supplierId),
            note: 'weekly',
            lines: [
                {
                    product: String(f.productId),
                    orderedQty: 5000,
                    expectedCost: 18000,
                },
            ],
        });
        expect(f.suppliers.assertActive).toHaveBeenCalledWith(
            String(f.supplierId),
            f.session,
        );
        const [[docs]] = f.orders.create.mock.calls as unknown as [
            [Array<{ status: string; lines: Array<{ unit: string }> }>],
        ];
        expect(docs[0]!.status).toBe(PurchaseOrderStatus.DRAFT);
        expect(docs[0]!.lines[0]!.unit).toBe(UnitOfMeasure.KG);
        expect(view.expectedTotal).toBe(90000);
        expect(view.supplier).toEqual({
            _id: String(f.supplierId),
            name: 'Farm',
            isActive: false,
        });
        expect(view.lines[0]).toMatchObject({
            name: 'rice',
            outstandingQty: 5000,
            productActive: true,
        });
    });
    it('refuses repeated, missing or archived products', async () => {
        const f = fixture(PurchaseOrderStatus.DRAFT);
        const line = {
            product: String(f.productId),
            orderedQty: 1,
            expectedCost: 1,
        };
        await expect(
            f.service.create(actor, {
                supplier: String(f.supplierId),
                lines: [line, line],
            }),
        ).rejects.toMatchObject({ statusCode: 400 });
        f.product.isActive = false;
        await expect(
            f.service.create(actor, {
                supplier: String(f.supplierId),
                lines: [line],
            }),
        ).rejects.toMatchObject({ statusCode: 404 });
        f.products.find.mockReturnValueOnce(new Query([]));
        await expect(
            f.service.create(actor, {
                supplier: String(f.supplierId),
                lines: [{ ...line, product: String(new Types.ObjectId()) }],
            }),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
    it('edits only drafts, guarded by version', async () => {
        const f = fixture(PurchaseOrderStatus.DRAFT);
        const dto = {
            version: 2,
            supplier: String(f.supplierId),
            lines: [
                {
                    product: String(f.productId),
                    orderedQty: 10,
                    expectedCost: 5,
                },
            ],
        };
        await f.service.update(actor, String(f.row._id), dto);
        expect(f.orders.updateOne).toHaveBeenCalledWith(
            {
                _id: String(f.row._id),
                version: 2,
                status: { $in: [PurchaseOrderStatus.DRAFT] },
            },
            expect.objectContaining({
                $inc: { version: 1 },
                $unset: { note: 1 },
            }),
            expect.anything(),
        );
        f.orders.updateOne.mockResolvedValueOnce({ matchedCount: 0 });
        await expect(
            f.service.update(actor, String(f.row._id), dto),
        ).rejects.toMatchObject({ statusCode: 409 });
        f.row.status = PurchaseOrderStatus.SENT;
        await expect(
            f.service.update(actor, String(f.row._id), dto),
        ).rejects.toMatchObject({ statusCode: 409 });
    });
    it('sends a draft once and needs an active supplier', async () => {
        const f = fixture(PurchaseOrderStatus.DRAFT);
        await f.service.send(actor, String(f.row._id), 2);
        expect(f.suppliers.assertActive).toHaveBeenCalled();
        expect(f.orders.updateOne.mock.calls[0]![1]).toMatchObject({
            $set: { status: PurchaseOrderStatus.SENT },
        });
        f.row.status = PurchaseOrderStatus.SENT;
        await expect(
            f.service.send(actor, String(f.row._id), 3),
        ).rejects.toMatchObject({ statusCode: 409 });
    });
    it('cancels a draft, or closes a partial receipt short', async () => {
        const f = fixture(PurchaseOrderStatus.DRAFT);
        await f.service.cancel(actor, String(f.row._id), 2);
        expect(f.orders.updateOne.mock.calls[0]![1]).toMatchObject({
            $set: { status: PurchaseOrderStatus.CANCELLED, closedShort: false },
        });
        const p = fixture(PurchaseOrderStatus.PARTIALLY_RECEIVED, 1000);
        await p.service.cancel(actor, String(p.row._id), 2);
        expect(p.orders.updateOne.mock.calls[0]![1]).toMatchObject({
            $set: { status: PurchaseOrderStatus.CANCELLED, closedShort: true },
        });
        p.row.status = PurchaseOrderStatus.CANCELLED;
        p.row.closedShort = true;
        const view = await p.service.get(String(p.row._id));
        expect(view.lines[0]!.outstandingQty).toBe(0);
        await expect(
            p.service.cancel(actor, String(p.row._id), 3),
        ).rejects.toMatchObject({ statusCode: 409 });
    });
    it('receives through one linked restock and advances status', async () => {
        const f = fixture(PurchaseOrderStatus.SENT, 1000);
        await f.service.receive(actor, String(f.row._id), {
            version: 2,
            idempotencyKey: 'key-00001',
            invoiceNumber: 'DR-1',
            lines: [
                { line: String(f.lineId), quantity: 4000, unitCost: 17500 },
            ],
        });
        expect(f.restocks.restock).toHaveBeenCalledWith(
            actor,
            {
                supplier: String(f.supplierId),
                invoiceNumber: 'DR-1',
                description: `Purchase order ${purchaseOrderReference(String(f.row._id))}`,
                restockDetails: [
                    {
                        product: String(f.productId),
                        quantity: 4000,
                        unitCost: 17500,
                    },
                ],
            },
            f.session,
            { purchaseOrder: f.row._id },
        );
        const [filter, update] = f.orders.updateOne.mock
            .calls[0] as unknown as [
            Record<string, unknown>,
            {
                $set: { status: string; lines: { receivedQty: number }[] };
                $push: unknown;
            },
        ];
        expect(filter).toMatchObject({ version: 2 });
        expect(update.$set.status).toBe(PurchaseOrderStatus.RECEIVED);
        expect(update.$set.lines[0]!.receivedQty).toBe(5000);
        expect(update.$push).toEqual({
            receipts: {
                key: 'key-00001',
                requestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
                restock: f.restockId,
            },
        });
    });
    it('refuses over-receipt, unknown lines, stale versions and closed orders', async () => {
        const f = fixture(PurchaseOrderStatus.PARTIALLY_RECEIVED, 4000);
        const base = { version: 2, idempotencyKey: 'key-00002' };
        await expect(
            f.service.receive(actor, String(f.row._id), {
                ...base,
                lines: [
                    { line: String(f.lineId), quantity: 1001, unitCost: 1 },
                ],
            }),
        ).rejects.toMatchObject({
            statusCode: 400,
            details: { index: 0, outstanding: 1000 },
        });
        await expect(
            f.service.receive(actor, String(f.row._id), {
                ...base,
                lines: [
                    { line: String(f.lineId), quantity: 1, unitCost: 1 },
                    { line: String(f.lineId), quantity: 1, unitCost: 1 },
                ],
            }),
        ).rejects.toMatchObject({ statusCode: 400 });
        await expect(
            f.service.receive(actor, String(f.row._id), {
                ...base,
                version: 1,
                lines: [{ line: String(f.lineId), quantity: 1, unitCost: 1 }],
            }),
        ).rejects.toMatchObject({ statusCode: 409 });
        f.orders.updateOne.mockResolvedValueOnce({ matchedCount: 0 });
        await expect(
            f.service.receive(actor, String(f.row._id), {
                ...base,
                lines: [{ line: String(f.lineId), quantity: 1, unitCost: 1 }],
            }),
        ).rejects.toMatchObject({ statusCode: 409 });
        f.row.status = PurchaseOrderStatus.DRAFT;
        await expect(
            f.service.receive(actor, String(f.row._id), {
                ...base,
                lines: [{ line: String(f.lineId), quantity: 1, unitCost: 1 }],
            }),
        ).rejects.toMatchObject({ statusCode: 409 });
    });
    it('replays a completed receive key without another restock', async () => {
        const f = fixture(PurchaseOrderStatus.RECEIVED, 5000);
        const dto = {
            version: 2,
            idempotencyKey: 'key-00003',
            lines: [{ line: String(f.lineId), quantity: 1, unitCost: 1 }],
        };
        f.row.receipts.push({
            key: 'key-00003',
            requestHash: receiveRequestHash(
                actor.userId,
                String(f.row._id),
                dto,
            ),
            restock: f.restockId,
        });
        const view = await f.service.receive(actor, String(f.row._id), dto);
        expect(f.restocks.restock).not.toHaveBeenCalled();
        expect(view.receipts).toEqual([String(f.restockId)]);
        expect(JSON.stringify(view)).not.toContain('key-00003');
        await expect(
            f.service.receive(actor, String(f.row._id), {
                ...dto,
                lines: [{ ...dto.lines[0]!, unitCost: 2 }],
            }),
        ).rejects.toMatchObject({
            statusCode: 409,
            code: ErrorCode.SALE_IDEMPOTENCY_MISMATCH,
        });
        expect(f.restocks.restock).not.toHaveBeenCalled();
    });
    it('answers a same-key retry that lost the version race as a replay', async () => {
        const f = fixture();
        const dto = {
            version: 2,
            idempotencyKey: 'key-00004',
            lines: [{ line: String(f.lineId), quantity: 1, unitCost: 1 }],
        };
        const winner = {
            ...f.row,
            version: 3,
            receipts: [
                {
                    key: 'key-00004',
                    requestHash: receiveRequestHash(
                        actor.userId,
                        String(f.row._id),
                        dto,
                    ),
                    restock: f.restockId,
                },
            ],
        };
        f.orders.updateOne.mockResolvedValueOnce({ matchedCount: 0 });
        f.orders.findById
            .mockReturnValueOnce(new Query(f.row))
            .mockReturnValue(new Query(winner));
        const view = await f.service.receive(actor, String(f.row._id), dto);
        expect(view.receipts).toEqual([String(f.restockId)]);
        f.orders.updateOne.mockResolvedValueOnce({ matchedCount: 0 });
        f.orders.findById.mockReturnValue(new Query(f.row));
        await expect(
            f.service.receive(actor, String(f.row._id), {
                ...dto,
                idempotencyKey: 'key-00005',
            }),
        ).rejects.toMatchObject({ statusCode: 409, code: ErrorCode.CONFLICT });
    });
    it('hashes the normalized body, not line order or the key', () => {
        const a = { line: 'a', quantity: 1, unitCost: 1 };
        const b = { line: 'b', quantity: 2, unitCost: 2 };
        const one = receiveRequestHash('u', 'po', {
            version: 1,
            idempotencyKey: 'x',
            lines: [a, b],
        });
        expect(
            receiveRequestHash('u', 'po', {
                version: 1,
                idempotencyKey: 'y',
                lines: [b, a],
            }),
        ).toBe(one);
        expect(
            receiveRequestHash('u', 'po', {
                version: 1,
                idempotencyKey: 'x',
                invoiceNumber: 'DR',
                lines: [a, b],
            }),
        ).not.toBe(one);
    });
    it('lists by status and supplier and 404s an unknown id', async () => {
        const f = fixture();
        const page = await f.service.list({
            page: 2,
            limit: 10,
            status: PurchaseOrderStatus.SENT,
            supplier: String(f.supplierId),
        });
        expect(page.totalItems).toBe(1);
        expect(f.orders.find).toHaveBeenCalledWith({
            status: PurchaseOrderStatus.SENT,
            supplier: f.supplierId,
        });
        f.orders.findById.mockReturnValueOnce(new Query(null as never));
        await expect(f.service.get(String(f.row._id))).rejects.toMatchObject({
            statusCode: 404,
        });
    });
});

describe('PurchaseOrderService edge views', () => {
    it('reads missing references, timestamps, note and legacy receipts safely', async () => {
        const f = fixture(PurchaseOrderStatus.CANCELLED);
        Object.assign(f.row, {
            note: 'n',
            sentAt: new Date('2026-11-06T01:00:00Z'),
            cancelledAt: new Date('2026-11-06T02:00:00Z'),
            receipts: undefined,
            closedShort: undefined,
        });
        f.products.find.mockReturnValue(new Query([]));
        const supplierRows = { find: jest.fn(() => new Query([])) };
        const users = { find: jest.fn(() => new Query([])) };
        const service = new PurchaseOrderService(
            { startSession: jest.fn() } as never,
            f.orders as never,
            f.products as never,
            supplierRows as never,
            users as never,
            f.suppliers as never,
            f.restocks as never,
            f.audit as never,
        );
        const view = await service.get(String(f.row._id));
        expect(view).toMatchObject({
            supplier: null,
            createdBy: null,
            note: 'n',
            sentAt: '2026-11-06T01:00:00.000Z',
            cancelledAt: '2026-11-06T02:00:00.000Z',
            receipts: [],
            closedShort: false,
        });
        expect(view.lines[0]).toMatchObject({
            name: '',
            EAN: '',
            tracksExpiry: false,
            productActive: false,
        });
    });
    it('keeps a note on edit and passes expiry, batch and description on receive', async () => {
        const d = fixture(PurchaseOrderStatus.DRAFT);
        await d.service.update(actor, String(d.row._id), {
            version: 2,
            supplier: String(d.supplierId),
            note: 'keep',
            lines: [
                {
                    product: String(d.productId),
                    orderedQty: 1,
                    expectedCost: 0,
                },
            ],
        });
        expect(d.orders.updateOne.mock.calls[0]![1]).toMatchObject({
            $set: { note: 'keep' },
        });
        const f = fixture();
        await f.service.receive(actor, String(f.row._id), {
            version: 2,
            idempotencyKey: 'key-00009',
            description: 'Morning delivery',
            lines: [
                {
                    line: String(f.lineId),
                    quantity: 1,
                    unitCost: 0,
                    expiryDate: '2099-01-01',
                    batchNo: 'B1',
                },
            ],
        });
        expect(f.restocks.restock.mock.calls[0]![1]).toEqual({
            supplier: String(f.supplierId),
            description: 'Morning delivery',
            restockDetails: [
                {
                    product: String(f.productId),
                    quantity: 1,
                    unitCost: 0,
                    expiryDate: '2099-01-01',
                    batchNo: 'B1',
                },
            ],
        });
    });
});

describe('PurchaseOrderService lookups', () => {
    it('404s a write to an unknown order and lists without filters', async () => {
        const f = fixture();
        f.orders.findById.mockReturnValueOnce(new Query(null as never));
        await expect(
            f.service.send(actor, String(f.row._id), 0),
        ).rejects.toMatchObject({ statusCode: 404 });
        await f.service.list({ page: 1, limit: 20 });
        expect(f.orders.find).toHaveBeenCalledWith({});
    });
});

describe('PurchaseOrderController', () => {
    it('delegates every route', async () => {
        const service = {
            list: jest.fn(),
            get: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            send: jest.fn(),
            cancel: jest.fn(),
            receive: jest.fn(),
        };
        const c = new PurchaseOrderController(service as never);
        await c.list({ page: 1, limit: 20 });
        await c.get({ id: 'po' });
        await c.create(actor, { supplier: 's', lines: [] });
        await c.update(
            actor,
            { id: 'po' },
            { version: 1, supplier: 's', lines: [] },
        );
        await c.send(actor, { id: 'po' }, { version: 1 });
        await c.cancel(actor, { id: 'po' }, { version: 2 });
        await c.receive(
            actor,
            { id: 'po' },
            {
                version: 3,
                idempotencyKey: 'k',
                lines: [],
            },
        );
        expect(service.send).toHaveBeenCalledWith(actor, 'po', 1);
        expect(service.cancel).toHaveBeenCalledWith(actor, 'po', 2);
        expect(service.receive).toHaveBeenCalledWith(actor, 'po', {
            version: 3,
            idempotencyKey: 'k',
            lines: [],
        });
    });
});

describe('PurchaseOrderService audit (#46)', () => {
    const ref = (f: ReturnType<typeof fixture>) =>
        purchaseOrderReference(String(f.row._id));
    const entry = (f: ReturnType<typeof fixture>, n = 0) => {
        const [event, session] = f.audit.record.mock.calls[n]!;
        expect(session).toBe(f.session);
        return event;
    };
    it('records a create with allowlisted draft facts in the transaction', async () => {
        const f = fixture();
        await f.service.create(actor, {
            supplier: String(f.supplierId),
            note: 'secret-ish note',
            lines: [
                {
                    product: String(f.productId),
                    orderedQty: 5000,
                    expectedCost: 18000,
                },
            ],
        });
        const event = entry(f);
        expect(event).toMatchObject({
            actor,
            action: AuditAction.PURCHASE_ORDER_CREATED,
            targetModel: 'PurchaseOrder',
            targetId: String(f.row._id),
        });
        expect(auditFields(event.action, event.after ?? {})).toEqual({
            reference: ref(f),
            supplier: String(f.supplierId),
            status: PurchaseOrderStatus.DRAFT,
            version: 0,
            lineCount: 1,
            lines: [`${String(f.productId)}:5000:18000`],
        });
    });
    it('records a draft edit before and after', async () => {
        const f = fixture(PurchaseOrderStatus.DRAFT);
        const other = String(new Types.ObjectId());
        await f.service.update(actor, String(f.row._id), {
            version: 2,
            supplier: other,
            lines: [
                {
                    product: String(f.productId),
                    orderedQty: 3000,
                    expectedCost: 0,
                },
            ],
        });
        const event = entry(f);
        expect(event.action).toBe(AuditAction.PURCHASE_ORDER_UPDATED);
        expect(event.before).toMatchObject({
            supplier: String(f.supplierId),
            version: 2,
            lines: [`${String(f.productId)}:5000:18000`],
        });
        expect(event.after).toMatchObject({
            supplier: other,
            version: 3,
            lineCount: 1,
            lines: [`${String(f.productId)}:3000:0`],
        });
    });
    it('records send and cancel with status, version and closedShort', async () => {
        const f = fixture(PurchaseOrderStatus.DRAFT);
        await f.service.send(actor, String(f.row._id), 2);
        expect(entry(f)).toMatchObject({
            action: AuditAction.PURCHASE_ORDER_SENT,
            before: { status: PurchaseOrderStatus.DRAFT, version: 2 },
            after: {
                reference: ref(f),
                supplier: String(f.supplierId),
                status: PurchaseOrderStatus.SENT,
                version: 3,
            },
        });
        const p = fixture(PurchaseOrderStatus.PARTIALLY_RECEIVED, 10);
        await p.service.cancel(actor, String(p.row._id), 2);
        expect(entry(p)).toMatchObject({
            action: AuditAction.PURCHASE_ORDER_CANCELLED,
            before: {
                status: PurchaseOrderStatus.PARTIALLY_RECEIVED,
                version: 2,
            },
            after: {
                status: PurchaseOrderStatus.CANCELLED,
                version: 3,
                closedShort: true,
            },
        });
    });
    it('records a receive without its key, hash or batch details', async () => {
        const f = fixture();
        await f.service.receive(actor, String(f.row._id), {
            version: 2,
            idempotencyKey: 'key-audit-1',
            invoiceNumber: 'DR-9',
            lines: [
                {
                    line: String(f.lineId),
                    quantity: 2000,
                    unitCost: 17000,
                    batchNo: 'B1',
                },
            ],
        });
        const event = entry(f);
        expect(event.action).toBe(AuditAction.PURCHASE_ORDER_RECEIVED);
        expect(auditFields(event.action, event.after ?? {})).toEqual({
            reference: ref(f),
            supplier: String(f.supplierId),
            status: PurchaseOrderStatus.PARTIALLY_RECEIVED,
            version: 3,
            restock: String(f.restockId),
            invoiceNumber: 'DR-9',
            lineCount: 1,
            lines: [`${String(f.productId)}:2000:17000`],
        });
        const text = JSON.stringify(event);
        expect(text).not.toContain('key-audit-1');
        expect(text).not.toMatch(/[0-9a-f]{64}/);
    });
    it('does not audit a replay or a failed write', async () => {
        const f = fixture(PurchaseOrderStatus.RECEIVED, 5000);
        const dto = {
            version: 2,
            idempotencyKey: 'key-audit-2',
            lines: [{ line: String(f.lineId), quantity: 1, unitCost: 1 }],
        };
        f.row.receipts.push({
            key: dto.idempotencyKey,
            requestHash: receiveRequestHash(
                actor.userId,
                String(f.row._id),
                dto,
            ),
            restock: f.restockId,
        });
        await f.service.receive(actor, String(f.row._id), dto);
        expect(f.audit.record).not.toHaveBeenCalled();
        const g = fixture(PurchaseOrderStatus.DRAFT);
        g.orders.updateOne.mockResolvedValueOnce({ matchedCount: 0 });
        await expect(
            g.service.send(actor, String(g.row._id), 2),
        ).rejects.toMatchObject({ statusCode: 409 });
        expect(g.audit.record).not.toHaveBeenCalled();
    });
    it('fails the action when the audit write fails', async () => {
        const f = fixture(PurchaseOrderStatus.DRAFT);
        f.audit.record.mockRejectedValueOnce(new Error('audit down'));
        await expect(
            f.service.cancel(actor, String(f.row._id), 2),
        ).rejects.toThrow();
    });
});
