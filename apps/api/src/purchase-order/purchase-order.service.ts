import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import {
    AuditAction,
    NUMERIC_LIMITS,
    OPEN_PURCHASE_ORDER_STATUSES,
    PurchaseOrderStatus,
    maxQuantityForAmount,
    purchaseOrderReference,
    quantityAmount,
    unitOf,
    type UnitOfMeasure,
    type Paginated,
    type PurchaseOrderView,
} from '@grocery-pos/contracts';
import {
    ConflictError,
    ErrorCode,
    NotFoundError,
    ValidationError,
} from '../common/errors';
import { runInTransaction } from '../common/utils/db';
import type { AuthUser } from '../auth/types';
import { SupplierService } from '../supplier/supplier.service';
import { Supplier } from '../supplier/supplier.schema';
import { Product } from '../product/product.schema';
import { User } from '../user/user.schema';
import { AuditService } from '../audit/audit.service';
import { RestockService } from '../inventory-man/restock/restock.service';
import type { RestockDto } from '../inventory-man/restock/types';
import {
    PurchaseOrder,
    type PurchaseOrderDoc,
    type PurchaseOrderLine,
} from './purchase-order.schema';
import type {
    CreatePurchaseOrderDto,
    PurchaseOrderLineDto,
    PurchaseOrderQueryDto,
    ReceivePurchaseOrderDto,
    UpdatePurchaseOrderDto,
} from './purchase-order.dto';

const conflict = () =>
    new ConflictError(
        ErrorCode.CONFLICT,
        'Purchase order changed. Reload it before continuing.',
    );
const invalid = (message: string, details: unknown = null) =>
    new ValidationError(ErrorCode.VALIDATION_INVALID_INPUT, message, details);
const notFound = () =>
    new NotFoundError(ErrorCode.NOT_FOUND, 'Purchase order not found');

type ProductInfo = {
    _id: Types.ObjectId;
    name: string;
    EAN: string;
    unit?: UnitOfMeasure;
    tracksExpiry?: boolean;
    isActive?: boolean;
};

/** Ordered total in centavos, refusing a sum above AMOUNT_MAX. */
export function expectedTotal(
    lines: Pick<PurchaseOrderLine, 'orderedQty' | 'expectedCost' | 'unit'>[],
): number {
    return lines.reduce((sum, line) => {
        if (
            line.expectedCost &&
            line.orderedQty >
                maxQuantityForAmount(
                    NUMERIC_LIMITS.AMOUNT_MAX - sum,
                    line.expectedCost,
                    line.unit,
                )
        )
            throw invalid('Purchase order exceeds the maximum amount');
        return (
            sum + quantityAmount(line.expectedCost, line.orderedQty, line.unit)
        );
    }, 0);
}

export function nextStatus(
    lines: Pick<PurchaseOrderLine, 'orderedQty' | 'receivedQty'>[],
): PurchaseOrderStatus {
    return lines.every((line) => line.receivedQty >= line.orderedQty)
        ? PurchaseOrderStatus.RECEIVED
        : PurchaseOrderStatus.PARTIALLY_RECEIVED;
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Fingerprint of a receive request, stored with its idempotency key (as
 * `POST /sales` does). Only what decides the receipt is hashed, in a fixed
 * order; the key itself is not part of it.
 */
export function receiveRequestHash(
    actor: string,
    id: string,
    dto: ReceivePurchaseOrderDto,
): string {
    const canonical = {
        actor,
        purchaseOrder: id,
        version: dto.version,
        invoiceNumber: dto.invoiceNumber ?? null,
        description: dto.description ?? null,
        lines: dto.lines
            .map((l) => ({
                line: String(l.line),
                quantity: l.quantity,
                unitCost: l.unitCost,
                expiryDate: l.expiryDate ?? null,
                batchNo: l.batchNo ?? null,
            }))
            .sort((a, b) => byString(a.line, b.line)),
    };
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** True for a replay; a reused key with another body is a 409. */
function matchReceipt(
    row: Pick<PurchaseOrderDoc, 'receipts'>,
    key: string,
    requestHash: string,
): boolean {
    const receipt = (row.receipts ?? []).find((r) => r.key === key);
    if (!receipt) return false;
    if (receipt.requestHash !== requestHash)
        throw new ConflictError(
            ErrorCode.SALE_IDEMPOTENCY_MISMATCH,
            'This receive was already recorded with different details. Reload the purchase order.',
        );
    return true;
}

type DraftLine = Pick<
    PurchaseOrderLine,
    'product' | 'orderedQty' | 'expectedCost'
>;
/** Allowlisted draft facts for the audit log (#46): never the document. */
export function draftAudit(
    row: { _id: unknown; supplier: unknown; status: string; version: number },
    lines: DraftLine[],
) {
    return {
        reference: purchaseOrderReference(String(row._id)),
        supplier: String(row.supplier),
        status: row.status,
        version: row.version,
        lineCount: lines.length,
        lines: lines.map(
            (l) => `${String(l.product)}:${l.orderedQty}:${l.expectedCost}`,
        ),
    };
}
const TARGET = 'PurchaseOrder';

@Injectable()
export class PurchaseOrderService {
    constructor(
        @InjectConnection() private connection: Connection,
        @InjectModel(PurchaseOrder.name) private orders: Model<PurchaseOrder>,
        @InjectModel(Product.name) private products: Model<Product>,
        @InjectModel(Supplier.name) private supplierRows: Model<Supplier>,
        @InjectModel(User.name) private users: Model<User>,
        private suppliers: SupplierService,
        private restocks: RestockService,
        private audit: AuditService,
    ) {}

    async list(
        dto: PurchaseOrderQueryDto,
    ): Promise<Paginated<PurchaseOrderView>> {
        const filter = {
            ...(dto.status && { status: dto.status }),
            ...(dto.supplier && {
                supplier: new Types.ObjectId(dto.supplier),
            }),
        };
        const [rows, totalItems] = await Promise.all([
            this.orders
                .find(filter)
                .sort({ createdAt: -1, _id: -1 })
                .skip((dto.page - 1) * dto.limit)
                .limit(dto.limit)
                .lean<PurchaseOrderDoc[]>(),
            this.orders.countDocuments(filter),
        ]);
        return { data: await this.views(rows), totalItems };
    }

    async get(id: string): Promise<PurchaseOrderView> {
        const row = await this.orders.findById(id).lean<PurchaseOrderDoc>();
        if (!row) throw notFound();
        const [view] = await this.views([row]);
        return view;
    }

    async create(
        actor: AuthUser,
        dto: CreatePurchaseOrderDto,
    ): Promise<PurchaseOrderView> {
        const id = await runInTransaction(async (session) => {
            await this.suppliers.assertActive(dto.supplier, session);
            const lines = await this.draftLines(dto.lines, session);
            const [created] = await this.orders.create(
                [
                    {
                        supplier: new Types.ObjectId(dto.supplier),
                        ...(dto.note && { note: dto.note }),
                        createdBy: new Types.ObjectId(actor.userId),
                        status: PurchaseOrderStatus.DRAFT,
                        version: 0,
                        lines,
                    },
                ],
                { session },
            );
            await this.audit.record(
                {
                    actor,
                    action: AuditAction.PURCHASE_ORDER_CREATED,
                    targetModel: TARGET,
                    targetId: String(created._id),
                    after: draftAudit(
                        {
                            _id: created._id,
                            supplier: dto.supplier,
                            status: PurchaseOrderStatus.DRAFT,
                            version: 0,
                        },
                        lines,
                    ),
                },
                session,
            );
            return String(created._id);
        }, this.connection);
        return this.get(id);
    }

    async update(
        actor: AuthUser,
        id: string,
        dto: UpdatePurchaseOrderDto,
    ): Promise<PurchaseOrderView> {
        await runInTransaction(async (session) => {
            const row = await this.load(id, session);
            if (row.status !== PurchaseOrderStatus.DRAFT)
                throw new ConflictError(
                    ErrorCode.CONFLICT,
                    'Only a draft purchase order can be edited. Cancel it and create a new one.',
                );
            await this.suppliers.assertActive(dto.supplier, session);
            const lines = await this.draftLines(dto.lines, session);
            await this.write(
                id,
                dto.version,
                [PurchaseOrderStatus.DRAFT],
                {
                    $set: {
                        supplier: new Types.ObjectId(dto.supplier),
                        lines,
                        ...(dto.note ? { note: dto.note } : {}),
                    },
                    ...(dto.note ? {} : { $unset: { note: 1 } }),
                },
                session,
            );
            await this.audit.record(
                {
                    actor,
                    action: AuditAction.PURCHASE_ORDER_UPDATED,
                    targetModel: TARGET,
                    targetId: id,
                    before: draftAudit(row, row.lines),
                    after: draftAudit(
                        {
                            _id: row._id,
                            supplier: dto.supplier,
                            status: row.status,
                            version: dto.version + 1,
                        },
                        lines,
                    ),
                },
                session,
            );
        }, this.connection);
        return this.get(id);
    }

    async send(
        actor: AuthUser,
        id: string,
        version: number,
    ): Promise<PurchaseOrderView> {
        await runInTransaction(async (session) => {
            const row = await this.load(id, session);
            if (row.status !== PurchaseOrderStatus.DRAFT) throw conflict();
            await this.suppliers.assertActive(String(row.supplier), session);
            // Products archived since drafting cannot be ordered.
            await this.draftLines(
                row.lines.map((line) => ({
                    product: String(line.product),
                    orderedQty: line.orderedQty,
                    expectedCost: line.expectedCost,
                })),
                session,
            );
            await this.write(
                id,
                version,
                [PurchaseOrderStatus.DRAFT],
                {
                    $set: {
                        status: PurchaseOrderStatus.SENT,
                        sentAt: new Date(),
                    },
                },
                session,
            );
            await this.audit.record(
                {
                    actor,
                    action: AuditAction.PURCHASE_ORDER_SENT,
                    targetModel: TARGET,
                    targetId: id,
                    before: { status: row.status, version },
                    after: {
                        reference: purchaseOrderReference(String(row._id)),
                        supplier: String(row.supplier),
                        status: PurchaseOrderStatus.SENT,
                        version: version + 1,
                    },
                },
                session,
            );
        }, this.connection);
        return this.get(id);
    }

    async cancel(
        actor: AuthUser,
        id: string,
        version: number,
    ): Promise<PurchaseOrderView> {
        await runInTransaction(async (session) => {
            const row = await this.load(id, session);
            const cancellable = [
                PurchaseOrderStatus.DRAFT,
                ...OPEN_PURCHASE_ORDER_STATUSES,
            ];
            if (!cancellable.includes(row.status)) throw conflict();
            const closedShort = row.lines.some((line) => line.receivedQty > 0);
            await this.write(
                id,
                version,
                cancellable,
                {
                    $set: {
                        status: PurchaseOrderStatus.CANCELLED,
                        cancelledAt: new Date(),
                        closedShort,
                    },
                },
                session,
            );
            await this.audit.record(
                {
                    actor,
                    action: AuditAction.PURCHASE_ORDER_CANCELLED,
                    targetModel: TARGET,
                    targetId: id,
                    before: { status: row.status, version },
                    after: {
                        reference: purchaseOrderReference(String(row._id)),
                        status: PurchaseOrderStatus.CANCELLED,
                        version: version + 1,
                        closedShort,
                    },
                },
                session,
            );
        }, this.connection);
        return this.get(id);
    }

    /**
     * One receive is one supplier restock linked to this PO, written in the
     * same transaction as the PO's received quantities. The version filter
     * makes a concurrent receive fail rather than exceed the outstanding
     * quantity; a retry with the same key replays without writing.
     */
    async receive(
        actor: AuthUser,
        id: string,
        dto: ReceivePurchaseOrderDto,
    ): Promise<PurchaseOrderView> {
        const requestHash = receiveRequestHash(actor.userId, id, dto);
        try {
            await this.receiveOnce(actor, id, dto, requestHash);
        } catch (err) {
            // A concurrent retry of the same attempt lost the version race
            // to the attempt itself: answer it as the replay it is.
            if (
                !(err instanceof ConflictError) ||
                err.code !== ErrorCode.CONFLICT ||
                !(await this.replayed(id, dto.idempotencyKey, requestHash))
            )
                throw err;
        }
        return this.get(id);
    }

    private async replayed(id: string, key: string, requestHash: string) {
        const row = await this.orders.findById(id).lean<PurchaseOrderDoc>();
        return !!row && matchReceipt(row, key, requestHash);
    }

    private async receiveOnce(
        actor: AuthUser,
        id: string,
        dto: ReceivePurchaseOrderDto,
        requestHash: string,
    ): Promise<void> {
        await runInTransaction(async (session) => {
            const row = await this.load(id, session);
            if (matchReceipt(row, dto.idempotencyKey, requestHash)) return;
            if (!OPEN_PURCHASE_ORDER_STATUSES.includes(row.status))
                throw new ConflictError(
                    ErrorCode.CONFLICT,
                    'Only a sent or partially received purchase order can be received.',
                );
            if (row.version !== dto.version) throw conflict();
            const lines = row.lines.map((line) => ({ ...line }));
            const seen = new Set<string>();
            const restockDetails = dto.lines.map((input, index) => {
                const line = lines.find((l) => String(l._id) === input.line);
                if (!line || seen.has(input.line))
                    throw invalid('Unknown or repeated purchase order line', {
                        index,
                    });
                seen.add(input.line);
                const outstanding = line.orderedQty - line.receivedQty;
                if (input.quantity > outstanding)
                    throw invalid(
                        'Received quantity exceeds the outstanding quantity; receive extra goods as a normal restock',
                        { index, outstanding },
                    );
                line.receivedQty += input.quantity;
                return {
                    product: String(line.product),
                    quantity: input.quantity,
                    unitCost: input.unitCost,
                    ...(input.expiryDate !== undefined && {
                        expiryDate: input.expiryDate,
                    }),
                    ...(input.batchNo !== undefined && {
                        batchNo: input.batchNo,
                    }),
                };
            });
            const restockDto = {
                supplier: String(row.supplier),
                ...(dto.invoiceNumber && { invoiceNumber: dto.invoiceNumber }),
                description:
                    dto.description ||
                    `Purchase order ${purchaseOrderReference(String(row._id))}`,
                restockDetails,
            } as RestockDto;
            const restock = await this.restocks.restock(
                actor,
                restockDto,
                session,
                { purchaseOrder: row._id },
            );
            await this.write(
                id,
                dto.version,
                OPEN_PURCHASE_ORDER_STATUSES,
                {
                    $set: { lines, status: nextStatus(lines) },
                    $push: {
                        receipts: {
                            key: dto.idempotencyKey,
                            requestHash,
                            restock,
                        },
                    },
                },
                session,
            );
            // A replay returned above, so a completed receive is audited once.
            await this.audit.record(
                {
                    actor,
                    action: AuditAction.PURCHASE_ORDER_RECEIVED,
                    targetModel: TARGET,
                    targetId: id,
                    before: { status: row.status, version: dto.version },
                    after: {
                        reference: purchaseOrderReference(String(row._id)),
                        supplier: String(row.supplier),
                        status: nextStatus(lines),
                        version: dto.version + 1,
                        restock: String(restock),
                        invoiceNumber: dto.invoiceNumber ?? null,
                        lineCount: restockDetails.length,
                        lines: restockDetails.map(
                            (d) => `${d.product}:${d.quantity}:${d.unitCost}`,
                        ),
                    },
                },
                session,
            );
        }, this.connection);
    }

    private async load(id: string, session: ClientSession) {
        const row = await this.orders
            .findById(id)
            .session(session)
            .lean<PurchaseOrderDoc>();
        if (!row) throw notFound();
        return row;
    }

    private async write(
        id: string,
        version: number,
        statuses: readonly PurchaseOrderStatus[],
        update: Record<string, unknown>,
        session: ClientSession,
    ) {
        const result = await this.orders.updateOne(
            { _id: id, version, status: { $in: statuses } },
            { ...update, $inc: { version: 1 } },
            { session, runValidators: true },
        );
        if (result.matchedCount !== 1) throw conflict();
    }

    /** Active, distinct products; units are snapshotted (immutable, #36). */
    private async draftLines(
        input: PurchaseOrderLineDto[],
        session: ClientSession,
    ) {
        const ids = input.map((line) => new Types.ObjectId(line.product));
        if (new Set(ids.map(String)).size !== ids.length)
            throw invalid('Each product may appear once in a purchase order');
        const found = await this.products
            .find({ _id: { $in: ids } })
            .select('unit isActive')
            .session(session)
            .lean<ProductInfo[]>();
        const byId = new Map(found.map((p) => [String(p._id), p]));
        const unusable = ids
            .map((pid, index) => ({ index, product: byId.get(String(pid)) }))
            .filter(({ product }) => !product || product.isActive === false)
            .map(({ index }) => ({ index }));
        if (unusable.length)
            throw new NotFoundError(
                ErrorCode.PRODUCT_NOT_FOUND,
                'One or more products do not exist or are archived',
                unusable,
            );
        const lines = input.map((line, index) => ({
            _id: new Types.ObjectId(),
            product: ids[index],
            unit: unitOf(byId.get(String(ids[index]))?.unit),
            orderedQty: line.orderedQty,
            receivedQty: 0,
            expectedCost: line.expectedCost,
        }));
        expectedTotal(lines);
        return lines;
    }

    private async views(
        rows: PurchaseOrderDoc[],
    ): Promise<PurchaseOrderView[]> {
        const productIds = [
            ...new Set(
                rows.flatMap((r) => r.lines.map((l) => String(l.product))),
            ),
        ];
        const [products, suppliers, users] = await Promise.all([
            this.products
                .find({ _id: { $in: productIds } })
                .select('name EAN tracksExpiry isActive')
                .lean<ProductInfo[]>(),
            this.supplierRows
                .find({ _id: { $in: rows.map((r) => r.supplier) } })
                .select('name isActive')
                .lean<
                    { _id: Types.ObjectId; name: string; isActive: boolean }[]
                >(),
            this.users
                .find({ _id: { $in: rows.map((r) => r.createdBy) } })
                .select('name')
                .lean<{ _id: Types.ObjectId; name: string }[]>(),
        ]);
        const product = new Map(products.map((p) => [String(p._id), p]));
        const supplier = new Map(suppliers.map((s) => [String(s._id), s]));
        const user = new Map(users.map((u) => [String(u._id), u]));
        return rows.map((row) => {
            const s = supplier.get(String(row.supplier));
            const u = user.get(String(row.createdBy));
            return {
                _id: String(row._id),
                supplier: s
                    ? { _id: String(s._id), name: s.name, isActive: s.isActive }
                    : null,
                status: row.status,
                version: row.version,
                ...(row.note && { note: row.note }),
                createdBy: u ? { _id: String(u._id), name: u.name } : null,
                ...(row.sentAt && { sentAt: row.sentAt.toISOString() }),
                ...(row.cancelledAt && {
                    cancelledAt: row.cancelledAt.toISOString(),
                }),
                closedShort: row.closedShort ?? false,
                receipts: (row.receipts ?? []).map((r) => String(r.restock)),
                expectedTotal: row.lines.reduce(
                    (sum, l) =>
                        sum +
                        quantityAmount(l.expectedCost, l.orderedQty, l.unit),
                    0,
                ),
                lines: row.lines.map((line) => {
                    const p = product.get(String(line.product));
                    return {
                        _id: String(line._id),
                        product: String(line.product),
                        name: p?.name ?? '',
                        EAN: p?.EAN ?? '',
                        unit: line.unit,
                        tracksExpiry: p?.tracksExpiry ?? false,
                        productActive: !!p && p.isActive !== false,
                        orderedQty: line.orderedQty,
                        receivedQty: line.receivedQty,
                        outstandingQty:
                            row.status === PurchaseOrderStatus.CANCELLED
                                ? 0
                                : line.orderedQty - line.receivedQty,
                        expectedCost: line.expectedCost,
                    };
                }),
                createdAt: row.createdAt.toISOString(),
                updatedAt: row.updatedAt.toISOString(),
            };
        });
    }
}
