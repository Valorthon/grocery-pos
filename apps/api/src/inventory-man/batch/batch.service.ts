import { SettingsService } from '../../settings/settings.service';
import {
    Inject as InjectSettings,
    Optional as OptionalSettings,
} from '@nestjs/common';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
    EXPIRY_LIMITS,
    type BatchAllocation,
    type InventoryBatchView,
    type Paginated,
} from '@grocery-pos/contracts';
import { InventoryBatch } from './batch.schema';
import { Product } from '../../product/product.schema';
import { Inventory } from '../inventory/inventory.schema';
import { TypedConfigService } from '../../common/typed-config/typed-config.service';
import { ErrorCode, InternalError, ValidationError } from '../../common/errors';

const invalid = (message: string) =>
    new ValidationError(ErrorCode.VALIDATION_INVALID_INPUT, message);
const id = (value: { toString(): string }) =>
    new Types.ObjectId(value.toString());
@Injectable()
export class InventoryBatchService implements OnModuleInit {
    constructor(
        @InjectModel(InventoryBatch.name)
        private batches: Model<InventoryBatch>,
        @InjectModel(Product.name) private products: Model<Product>,
        @InjectModel(Inventory.name) private inventories: Model<Inventory>,
        private config: TypedConfigService,
        @OptionalSettings()
        @InjectSettings(SettingsService)
        private settings?: SettingsService,
    ) {}
    async assertCanChangeTracking(
        product: Types.ObjectId,
        session: ClientSession,
    ): Promise<void> {
        const pending = await this.batches
            .findOne({ product })
            .session(session)
            .lean();
        if (pending)
            throw invalid(
                'Expiry tracking cannot change after batch history exists',
            );
    }
    async onModuleInit() {
        await this.batches.init();
    }
    today(
        at = new Date(),
        timezone = this.config.get('STORE_TIMEZONE'),
    ): string {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).formatToParts(at);
        return ['year', 'month', 'day']
            .map((kind) => parts.find((p) => p.type === kind)!.value)
            .join('-');
    }
    private async tracked(
        product: Types.ObjectId,
        session: ClientSession,
    ): Promise<boolean> {
        const row = await this.products
            .findById(product)
            .select('tracksExpiry')
            .session(session)
            .lean();
        return row?.tracksExpiry === true;
    }
    async receive(
        lines: {
            _id: Types.ObjectId;
            product: Types.ObjectId;
            quantity: number;
            expiryDate?: string;
            batchNo?: string;
        }[],
        session: ClientSession,
    ): Promise<void> {
        for (const line of lines) {
            if (!(await this.tracked(line.product, session))) {
                if (line.expiryDate || line.batchNo)
                    throw invalid(
                        'Expiry and batch details require an expiry-tracked product',
                    );
                continue;
            }
            if (!line.expiryDate)
                throw invalid(
                    'Expiry date is required for expiry-tracked products',
                );
            await this.batches.create(
                [
                    {
                        product: line.product,
                        restockDetail: line._id,
                        receivedQty: line.quantity,
                        remainingQty: line.quantity,
                        expiryDate: line.expiryDate,
                        ...(line.batchNo && { batchNo: line.batchNo }),
                    },
                ],
                { session },
            );
        }
        for (const product of new Set(
            lines.map((line) => line.product.toString()),
        ))
            if (await this.tracked(id(product), session))
                await this.assertInvariant(id(product), session);
    }
    /** Consume only unexpired dated lots; aggregate stock guard remains a separate transaction write. */
    async consume(
        product: Types.ObjectId,
        quantity: number,
        session: ClientSession,
    ): Promise<BatchAllocation[]> {
        if (!(await this.tracked(product, session))) return [];
        const today = this.today(
            new Date(),
            this.settings
                ? await this.settings.timezone(session)
                : this.config.get('STORE_TIMEZONE'),
        );
        const rows = await this.batches
            .find({
                product,
                remainingQty: { $gt: 0 },
                reconciliation: { $ne: true },
                expiryDate: { $gte: today },
            })
            .sort({ expiryDate: 1, createdAt: 1, _id: 1 })
            .session(session)
            .lean();
        let remaining = quantity;
        const allocations: BatchAllocation[] = [];
        for (const row of rows) {
            if (remaining === 0) break;
            const take = Math.min(remaining, row.remainingQty);
            const changed = await this.batches.updateOne(
                { _id: row._id, remainingQty: { $gte: take } },
                { $inc: { remainingQty: -take } },
                { session },
            );
            if (changed.matchedCount !== 1)
                throw invalid('Batch availability changed; retry the sale');
            allocations.push({ batch: row._id.toString(), quantity: take });
            remaining -= take;
        }
        if (remaining !== 0)
            throw invalid(
                'Insufficient unexpired stock; expired batches cannot be sold',
            );
        return allocations;
    }
    async restore(
        product: Types.ObjectId,
        quantity: number,
        allocations: BatchAllocation[] | undefined,
        session: ClientSession,
    ): Promise<void> {
        if (!(await this.tracked(product, session))) return;
        if (allocations?.length) {
            let sum = 0;
            for (const allocation of allocations) {
                if (
                    !Number.isSafeInteger(allocation.quantity) ||
                    allocation.quantity <= 0 ||
                    !Number.isSafeInteger(sum + allocation.quantity)
                )
                    throw new InternalError('Invalid stored batch allocation');
                sum += allocation.quantity;
                const result = await this.batches.updateOne(
                    {
                        _id: id(allocation.batch),
                        product,
                        remainingQty: {
                            $lte: Number.MAX_SAFE_INTEGER - allocation.quantity,
                        },
                    },
                    { $inc: { remainingQty: allocation.quantity } },
                    { session },
                );
                if (result.matchedCount !== 1)
                    throw new InternalError(
                        'Sale batch allocation no longer exists',
                    );
            }
            if (sum !== quantity)
                throw new InternalError(
                    'Stored batch allocations do not match sale quantity',
                );
        } else {
            // A previously untracked sale can be refunded after zero-stock tracking enablement.
            // No expiry is invented: this returned quantity is quarantined for reconciliation.
            await this.batches.create(
                [
                    {
                        product,
                        receivedQty: quantity,
                        remainingQty: quantity,
                        reconciliation: true,
                    },
                ],
                { session },
            );
        }
    }
    async adjust(
        lines: { product: string; change: number; batch?: string }[],
        session: ClientSession,
    ): Promise<void> {
        for (const line of lines) {
            const product = id(line.product);
            if (!(await this.tracked(product, session))) {
                if (line.batch)
                    throw invalid(
                        'Batch adjustments require an expiry-tracked product',
                    );
                continue;
            }
            if (!line.batch)
                throw invalid(
                    'Select a batch when adjusting an expiry-tracked product',
                );
            const batch = await this.batches
                .findOne({ _id: id(line.batch), product })
                .session(session)
                .lean();
            if (!batch) throw invalid('Batch does not belong to this product');
            const next = batch.remainingQty + line.change;
            if (
                !Number.isSafeInteger(next) ||
                (next < 0 && !batch.reconciliation)
            )
                throw invalid('Adjustment exceeds available batch quantity');
            const result = await this.batches.updateOne(
                { _id: batch._id, remainingQty: batch.remainingQty },
                { $inc: { remainingQty: line.change } },
                { session },
            );
            if (result.matchedCount !== 1)
                throw invalid(
                    'Batch availability changed; retry the adjustment',
                );
        }
        for (const product of new Set(lines.map((line) => line.product)))
            if (await this.tracked(id(product), session))
                await this.assertInvariant(id(product), session);
    }
    async reconcileOffline(
        product: Types.ObjectId,
        quantity: number,
        session: ClientSession,
    ): Promise<void> {
        if (!(await this.tracked(product, session))) return;
        // Already-collected legacy cash must be recorded. It cannot invent which lot was sold.
        await this.batches.create(
            [
                {
                    product,
                    receivedQty: 0,
                    remainingQty: -quantity,
                    reconciliation: true,
                },
            ],
            { session },
        );
        await this.assertInvariant(product, session);
    }
    async assertInvariant(
        product: Types.ObjectId,
        session: ClientSession,
    ): Promise<void> {
        const rows = await this.batches
            .find({ product })
            .select('remainingQty')
            .session(session)
            .lean();
        const inventory = await this.inventories
            .findOne({ product })
            .session(session)
            .lean();
        let total = 0n;
        for (const row of rows) {
            if (!Number.isSafeInteger(row.remainingQty))
                throw new InternalError('Invalid stored batch quantity');
            total += BigInt(row.remainingQty);
        }
        if (
            !inventory ||
            !Number.isSafeInteger(inventory.stock) ||
            total !== BigInt(inventory.stock)
        )
            throw new InternalError(
                'Batch quantities do not match aggregate inventory',
            );
    }
    async list(dto: {
        page: number;
        limit: number;
        days?: number;
        product?: string;
        expiring?: boolean;
    }): Promise<Paginated<InventoryBatchView>> {
        const settings = this.settings ? await this.settings.read() : null;
        const today = this.today(
            new Date(),
            settings?.timezone ?? this.config.get('STORE_TIMEZONE'),
        );
        const query: Record<string, unknown> = { remainingQty: { $ne: 0 } };
        if (dto.product) query.product = id(dto.product);
        if (dto.expiring) {
            const date = new Date(`${today}T00:00:00Z`);
            date.setUTCDate(
                date.getUTCDate() +
                    (dto.days ??
                        settings?.expiryAlertDays ??
                        EXPIRY_LIMITS.DEFAULT_DAYS),
            );
            query.expiryDate = { $lte: date.toISOString().slice(0, 10) };
            query.remainingQty = { $gt: 0 };
            // Like the stock tiles, archived products raise no alert (#213).
            const archived = await this.products.distinct('_id', {
                isActive: false,
            });
            if (archived.length)
                query.product = dto.product
                    ? { $eq: id(dto.product), $nin: archived }
                    : { $nin: archived };
        }
        const [rows, totalItems] = await Promise.all([
            this.batches
                .find(query)
                .sort({ expiryDate: 1, createdAt: 1, _id: 1 })
                .skip((dto.page - 1) * dto.limit)
                .limit(dto.limit)
                .populate<{ product: InventoryBatchView['product'] }>({
                    path: 'product',
                    select: 'name EAN unit',
                })
                .lean(),
            this.batches.countDocuments(query),
        ]);
        return {
            data: rows.map((row) => ({
                _id: row._id.toString(),
                product: {
                    _id: String(row.product._id),
                    name: row.product.name,
                    EAN: row.product.EAN,
                    ...(row.product.unit && { unit: row.product.unit }),
                },
                receivedQty: row.receivedQty,
                remainingQty: row.remainingQty,
                reconciliation: row.reconciliation,
                ...(row.restockDetail && {
                    restockDetail: row.restockDetail.toString(),
                }),
                ...(row.batchNo !== undefined && { batchNo: row.batchNo }),
                ...(row.expiryDate && {
                    expiryDate: row.expiryDate,
                    daysLeft: Math.round(
                        (Date.parse(`${row.expiryDate}T00:00:00Z`) -
                            Date.parse(`${today}T00:00:00Z`)) /
                            86400000,
                    ),
                }),
                createdAt: row.createdAt.toISOString(),
                updatedAt: row.updatedAt.toISOString(),
            })),
            totalItems,
        };
    }
    /** The dashboard tile: the Expiring list's total at the store's alert window. */
    async expiringCount(days?: number): Promise<number> {
        return (await this.list({ page: 1, limit: 1, days, expiring: true }))
            .totalItems;
    }
}
