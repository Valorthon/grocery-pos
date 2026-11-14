import { SettingsService } from '../settings/settings.service';
import { Inject as InjectSettings } from '@nestjs/common';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
    StockMovementSource,
    StockMovementType,
    UnitOfMeasure,
    unitOf,
    type Paginated,
    type StockMovementView,
    type StockIntegrityView,
} from '@grocery-pos/contracts';
import { Inventory } from '../inventory-man/inventory/inventory.schema';
import { Product } from '../product/product.schema';
import { ErrorCode, InternalError, NotFoundError } from '../common/errors';
import { dateRangeFilter } from '../common/utils/timezone';
import { StockMovement } from './stock-movement.schema';
import { StockMovementQueryDto } from './stock-movement.dto';

export interface MovementContext {
    type: StockMovementType;
    refModel: StockMovementSource;
    refId: string;
    user: string;
    occurredAt?: Date;
}
export function netStockChanges(
    entries: { product: string; quantity: number }[],
) {
    const result = new Map<string, number>();
    for (const entry of entries) {
        const key = new Types.ObjectId(entry.product).toString();
        const quantity = (result.get(key) ?? 0) + entry.quantity;
        if (
            !Number.isSafeInteger(entry.quantity) ||
            !Number.isSafeInteger(quantity)
        )
            throw new InternalError('Invalid stock movement quantity');
        result.set(key, quantity);
    }
    return [...result].filter(([, quantity]) => quantity !== 0);
}
@Injectable()
export class StockMovementService implements OnModuleInit {
    constructor(
        @InjectModel(StockMovement.name)
        private movements: Model<StockMovement>,
        @InjectModel(Inventory.name) private inventory: Model<Inventory>,
        @InjectModel(Product.name) private products: Model<Product>,
        @InjectSettings(SettingsService)
        private settings: SettingsService,
    ) {}
    async onModuleInit() {
        const migration = await this.movements.db
            .collection('migrations')
            .findOne({ _id: 'issue-45-stock-ledger-v1' as never });
        if (
            migration &&
            ['running', 'incomplete'].includes(String(migration.status))
        )
            throw new Error(
                'Stock ledger migration must complete with API stopped before startup',
            );
        await this.movements.init();
    }

    /** Caller already wrote inventory in this transaction, serializing concurrent writers. */
    async record(
        entries: { product: string; quantity: number }[],
        context: MovementContext,
        session: ClientSession,
    ): Promise<void> {
        const changes = netStockChanges(entries);
        if (!changes.length) return;
        const ids = changes.map(([id]) => new Types.ObjectId(id));
        // Keep all driver operations serial on the caller's transaction/session.
        const inventories = await this.inventory
            .find({ product: { $in: ids } })
            .select('product stock')
            .session(session)
            .lean<{ product: Types.ObjectId; stock: number }[]>();
        const definitions = await this.products
            .find({ _id: { $in: ids } })
            .select('unit')
            .session(session)
            .lean();
        const latestRows = await this.movements
            .aggregate<{
                _id: Types.ObjectId;
                balanceAfter: number;
                sequence: number;
            }>([
                { $match: { product: { $in: ids } } },
                // This ordering matches the existing unique product/sequence index.
                { $sort: { product: 1, sequence: 1 } },
                {
                    $group: {
                        _id: '$product',
                        balanceAfter: { $last: '$balanceAfter' },
                        sequence: { $last: '$sequence' },
                    },
                },
            ])
            .session(session);
        const inventoryByProduct = new Map(
            inventories.map((row) => [row.product.toString(), row]),
        );
        const definitionByProduct = new Map(
            definitions.map((row) => [row._id.toString(), row]),
        );
        const latestByProduct = new Map(
            latestRows.map((row) => [row._id.toString(), row]),
        );
        const rows: Omit<StockMovement, 'createdAt'>[] = [];
        const now = new Date();
        for (const [id, quantity] of changes) {
            const product = new Types.ObjectId(id);
            const current = inventoryByProduct.get(id);
            const definition = definitionByProduct.get(id);
            if (!current || !definition || !Number.isSafeInteger(current.stock))
                throw new InternalError(
                    'Stock movement inventory is missing or invalid',
                );
            const before = current.stock - quantity;
            if (!Number.isSafeInteger(before))
                throw new InternalError('Invalid opening inventory');
            const unit = unitOf(definition.unit);
            if (!Object.values(UnitOfMeasure).includes(unit))
                throw new InternalError('Invalid stock movement unit');
            const latest = latestByProduct.get(id);
            if (latest && latest.balanceAfter !== before)
                throw new InternalError(
                    'Stock ledger does not reconcile; investigate before posting',
                );
            const sequence = (latest?.sequence ?? 0) + 1;
            if (
                !Number.isSafeInteger(sequence) ||
                sequence < 1 ||
                (latest && !Number.isSafeInteger(latest.sequence))
            )
                throw new InternalError('Stock movement sequence exhausted');
            if (!latest) {
                // Explicit unattributed baseline for first use without historical backfill.
                // Backfill must precede live writes; it refuses an existing live ledger.
                rows.push({
                    product,
                    type: StockMovementType.OPENING,
                    quantity: before,
                    balanceAfter: before,
                    unit,
                    sequence: 0,
                    refModel: StockMovementSource.OPENING,
                    occurredAt: now,
                    historical: false,
                });
            }
            rows.push({
                product,
                type: context.type,
                quantity,
                balanceAfter: current.stock,
                unit,
                sequence,
                refModel: context.refModel,
                refId: new Types.ObjectId(context.refId),
                user: new Types.ObjectId(context.user),
                occurredAt: context.occurredAt ?? now,
                historical: false,
            });
        }
        // Validate every product before the first write. insertMany issues one ordered
        // batch rather than create(array)'s individual document saves.
        await this.movements.insertMany(rows, { session, ordered: true });
    }

    private async assertProduct(id: string) {
        if (!(await this.products.exists({ _id: id })))
            throw new NotFoundError(
                ErrorCode.PRODUCT_NOT_FOUND,
                'Product not found',
            );
    }
    async list(
        id: string,
        dto: StockMovementQueryDto,
    ): Promise<Paginated<StockMovementView>> {
        await this.assertProduct(id);
        const createdAt = dateRangeFilter(
            dto.from,
            dto.to,
            await this.settings.timezone(),
        );
        const filter = {
            product: new Types.ObjectId(id),
            ...(createdAt && { createdAt }),
        };
        const [rows, totalItems] = await Promise.all([
            this.movements
                .find(filter)
                .sort({ sequence: -1 })
                .skip((dto.page - 1) * dto.limit)
                .limit(dto.limit)
                .populate<{
                    user: { _id: Types.ObjectId; name: string } | null;
                }>({ path: 'user', select: 'name' })
                .lean(),
            this.movements.countDocuments(filter),
        ]);
        return {
            totalItems,
            data: rows.map((row) => ({
                _id: String(row._id),
                product: String(row.product),
                type: row.type,
                quantity: row.quantity,
                balanceAfter: row.balanceAfter,
                unit: row.unit,
                sequence: row.sequence,
                refModel: row.refModel,
                ...(row.refId && { refId: String(row.refId) }),
                user: row.user
                    ? { _id: String(row.user._id), name: row.user.name }
                    : null,
                occurredAt: row.occurredAt.toISOString(),
                createdAt: row.createdAt.toISOString(),
                historical: row.historical,
            })),
        };
    }
    async integrity(id: string): Promise<StockIntegrityView> {
        await this.assertProduct(id);
        return this.inventory.db.transaction(
            async (session) => {
                const row = await this.inventory
                    .findOne({ product: id })
                    .select('stock')
                    .session(session)
                    .lean();
                const sums = await this.movements
                    .aggregate<{ total: Types.Decimal128 }>([
                        { $match: { product: new Types.ObjectId(id) } },
                        {
                            $group: {
                                _id: null,
                                total: { $sum: { $toDecimal: '$quantity' } },
                            },
                        },
                    ])
                    .session(session);
                const stock = row?.stock ?? 0;
                const movementTotal = Number(sums[0]?.total.toString() ?? 0);
                const difference = stock - movementTotal;
                if (
                    ![stock, movementTotal, difference].every(
                        Number.isSafeInteger,
                    )
                )
                    throw new InternalError('Invalid stock ledger sum');
                return {
                    product: id.toLowerCase(),
                    stock,
                    movementTotal,
                    difference,
                    matches: difference === 0,
                };
            },
            { readConcern: { level: 'snapshot' } },
        );
    }
}
