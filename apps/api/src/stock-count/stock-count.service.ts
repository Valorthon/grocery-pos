import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import {
    OverrideAction,
    Role,
    STOCK_COUNT_LINE_MAX,
    StockCountStatus,
    UnitOfMeasure,
    type AuthUser,
    type Paginated,
    type StockCountView,
} from '@grocery-pos/contracts';
import { StockCount, StockCountLine } from './stock-count.schema';
import {
    CreateStockCountDto,
    SaveStockCountDto,
    StockCountQueryDto,
} from './stock-count.dto';
import { Product } from '../product/product.schema';
import { Inventory } from '../inventory-man/inventory/inventory.schema';
import { InventoryBatch } from '../inventory-man/batch/batch.schema';
import { Adjustment } from '../inventory-man/adjustment/adjustment.schema';
import { AdjustmentDetails } from '../inventory-man/adjustment/adjustment-details.schema';
import { InventoryService } from '../inventory-man/inventory/inventory.service';
import { User } from '../user/user.schema';
import { ManagerOverrideService } from '../auth/override/override.service';
import { runInTransaction } from '../common/utils/db';
import {
    ConflictError,
    ErrorCode,
    ForbiddenError,
    InternalError,
    NotFoundError,
    ValidationError,
} from '../common/errors';
import { stockCountContext } from './stock-count.context';

const invalid = (message: string) =>
    new ValidationError(ErrorCode.VALIDATION_INVALID_INPUT, message);
const stale = () =>
    new ConflictError(
        ErrorCode.CONFLICT,
        'Stock count changed. Reload it before continuing.',
    );
const objectId = (value: string) => new Types.ObjectId(value);
@Injectable()
export class StockCountService implements OnModuleInit {
    constructor(
        @InjectConnection() private connection: Connection,
        @InjectModel(StockCount.name) private counts: Model<StockCount>,
        @InjectModel(Product.name) private products: Model<Product>,
        @InjectModel(Inventory.name) private inventories: Model<Inventory>,
        @InjectModel(InventoryBatch.name)
        private batches: Model<InventoryBatch>,
        @InjectModel(Adjustment.name) private adjustments: Model<Adjustment>,
        @InjectModel(AdjustmentDetails.name)
        private details: Model<AdjustmentDetails>,
        @InjectModel(User.name) private users: Model<User>,
        private inventory: InventoryService,
        private approvals: ManagerOverrideService,
    ) {}
    async onModuleInit(): Promise<void> {
        await this.counts.init();
    }
    private async assertActor(
        actor: AuthUser,
        session: ClientSession,
    ): Promise<void> {
        const result = await this.users.updateOne(
            {
                _id: actor.userId,
                isActive: true,
                roles: { $in: [Role.Adjuster, Role.Admin] },
            },
            { $inc: { overrideApprovalLock: 1 } },
            { session },
        );
        if (!result.matchedCount)
            throw new ForbiddenError(
                ErrorCode.FORBIDDEN,
                'Stock counts require an active adjuster or admin',
            );
    }
    async create(
        actor: AuthUser,
        dto: CreateStockCountDto,
    ): Promise<StockCountView> {
        if (
            (dto.scope === 'category') !== (dto.category !== undefined) ||
            (dto.scope === 'products') !== (dto.products !== undefined)
        )
            throw invalid(
                'Choose exactly the fields required by the count scope',
            );
        const picked = dto.products?.map((id) => String(objectId(id)));
        if (picked && new Set(picked).size !== picked.length)
            throw invalid('Products must be distinct');
        const id = await runInTransaction(async (session) => {
            await this.assertActor(actor, session);
            const query: Record<string, unknown> = { isActive: { $ne: false } };
            if (dto.category) query.category = objectId(dto.category);
            if (picked) query._id = { $in: picked.map(objectId) };
            const products = await this.products
                .find(query)
                .select('name EAN unit tracksExpiry')
                .sort({ name: 1, _id: 1 })
                .limit(STOCK_COUNT_LINE_MAX + 1)
                .session(session)
                .lean();
            if (!products.length)
                throw invalid('No active products match this scope');
            if (products.length > STOCK_COUNT_LINE_MAX)
                throw invalid(
                    `Choose a smaller scope, at most ${STOCK_COUNT_LINE_MAX} count lines`,
                );
            if (picked && products.length !== picked.length)
                throw invalid('A selected product is unavailable');
            const ids = products.map((product) => product._id);
            const inventory = await this.inventories
                .find({ product: { $in: ids } })
                .session(session)
                .lean<{ product: Types.ObjectId; stock: number }[]>();
            const lots = await this.batches
                .find({
                    product: {
                        $in: products
                            .filter((p) => p.tracksExpiry)
                            .map((p) => p._id),
                    },
                })
                .sort({ expiryDate: 1, createdAt: 1, _id: 1 })
                .limit(STOCK_COUNT_LINE_MAX + 1)
                .session(session)
                .lean();
            const lines: StockCountLine[] = [];
            for (const product of products) {
                const stock =
                    inventory.find(
                        (row) =>
                            row.product.toString() === product._id.toString(),
                    )?.stock ?? 0;
                if (!Number.isSafeInteger(stock))
                    throw new InternalError('Invalid inventory stock');
                const snapshot = {
                    product: product._id,
                    name: product.name,
                    EAN: product.EAN,
                    unit: product.unit ?? UnitOfMeasure.PIECE,
                    tracksExpiry: product.tracksExpiry === true,
                };
                if (product.tracksExpiry) {
                    const productLots = lots.filter(
                        (lot) =>
                            lot.product.toString() === product._id.toString(),
                    );
                    let sum = 0;
                    for (const lot of productLots) {
                        sum += lot.remainingQty;
                        if (
                            !Number.isSafeInteger(sum) ||
                            !Number.isSafeInteger(lot.remainingQty)
                        )
                            throw new InternalError('Invalid batch stock');
                        lines.push({
                            _id: new Types.ObjectId(),
                            ...snapshot,
                            batch: lot._id,
                            batchNo: lot.batchNo,
                            expiryDate: lot.expiryDate,
                            expectedQty: lot.remainingQty,
                        });
                    }
                    if (sum !== stock)
                        throw invalid(
                            'Batch scope is too large or inventory needs reconciliation; choose a smaller count scope',
                        );
                    // No lot exists to target; do not invent an expiry/opening batch.
                    if (!productLots.length)
                        lines.push({
                            _id: new Types.ObjectId(),
                            ...snapshot,
                            expectedQty: 0,
                        });
                } else
                    lines.push({
                        _id: new Types.ObjectId(),
                        ...snapshot,
                        expectedQty: stock,
                    });
            }
            if (lines.length > STOCK_COUNT_LINE_MAX)
                throw invalid(
                    `Choose a smaller scope, at most ${STOCK_COUNT_LINE_MAX} count lines`,
                );
            const [count] = await this.counts.create(
                [
                    {
                        scope: dto.scope,
                        ...(dto.category && {
                            category: objectId(dto.category),
                        }),
                        createdBy: actor.userId,
                        lines,
                    },
                ],
                { session },
            );
            return String(count._id);
        }, this.connection);
        return this.get(id);
    }
    async list(dto: StockCountQueryDto): Promise<Paginated<StockCountView>> {
        const filter = dto.status ? { status: dto.status } : {};
        const [rows, totalItems] = await Promise.all([
            this.counts
                .find(filter)
                .select('_id')
                .sort({ createdAt: -1, _id: -1 })
                .skip((dto.page - 1) * dto.limit)
                .limit(dto.limit)
                .lean(),
            this.counts.countDocuments(filter),
        ]);
        return {
            data: await Promise.all(
                rows.map((row) => this.get(String(row._id))),
            ),
            totalItems,
        };
    }
    async get(id: string): Promise<StockCountView> {
        const count = await this.counts.findById(id).lean();
        if (!count)
            throw new NotFoundError(
                ErrorCode.NOT_FOUND,
                'Stock count not found',
            );
        const currentInventory = await this.inventories
            .find({ product: { $in: count.lines.map((line) => line.product) } })
            .lean<{ product: Types.ObjectId; stock: number }[]>();
        const currentBatches = await this.batches
            .find({
                _id: {
                    $in: count.lines.flatMap((line) =>
                        line.batch ? [line.batch] : [],
                    ),
                },
            })
            .lean();
        const current = (line: StockCountLine): number =>
            line.batch
                ? (currentBatches.find((lot) => lot._id.equals(line.batch))
                      ?.remainingQty ?? 0)
                : (currentInventory.find(
                      (row) => row.product.toString() === String(line.product),
                  )?.stock ?? 0);
        const ids = [
            count.createdBy,
            ...(count.approvedBy ? [count.approvedBy] : []),
        ];
        const people = await this.users
            .find({ _id: { $in: ids } })
            .select('name')
            .lean();
        const ref = (id: Types.ObjectId) => {
            const user = people.find((p) => p._id.equals(id));
            return user ? { _id: String(user._id), name: user.name } : null;
        };
        return {
            _id: String(count._id),
            scope: count.scope,
            ...(count.category && { category: String(count.category) }),
            status: count.status,
            version: count.version,
            createdBy: ref(count.createdBy),
            ...(count.approvedBy && { approvedBy: ref(count.approvedBy) }),
            ...(count.adjustment && { adjustment: String(count.adjustment) }),
            createdAt: count.createdAt.toISOString(),
            updatedAt: count.updatedAt.toISOString(),
            lines: count.lines.map((line) => ({
                _id: String(line._id),
                ...((count.status === StockCountStatus.OPEN ||
                    count.status === StockCountStatus.SUBMITTED) && {
                    currentQty: current(line),
                }),
                product: String(line.product),
                name: line.name,
                EAN: line.EAN,
                unit: line.unit,
                tracksExpiry: line.tracksExpiry,
                ...(line.batch && { batch: String(line.batch) }),
                ...(line.batchNo && { batchNo: line.batchNo }),
                ...(line.expiryDate && { expiryDate: line.expiryDate }),
                expectedQty: line.expectedQty,
                ...(line.countedQty !== undefined && {
                    countedQty: line.countedQty,
                    variance: line.countedQty - line.expectedQty,
                }),
            })),
        };
    }
    async save(
        actor: AuthUser,
        id: string,
        dto: SaveStockCountDto,
    ): Promise<StockCountView> {
        await runInTransaction(async (session) => {
            await this.assertActor(actor, session);
            const count = await this.counts
                .findById(id)
                .session(session)
                .lean();
            if (
                !count ||
                count.status !== StockCountStatus.OPEN ||
                count.version !== dto.version
            )
                throw stale();
            const patches = new Map(
                dto.lines.map((line) => [
                    String(objectId(line.line)),
                    line.countedQty,
                ]),
            );
            if (patches.size !== dto.lines.length)
                throw invalid('Count lines must be distinct');
            if (
                [...patches.keys()].some(
                    (key) =>
                        !count.lines.some((line) => String(line._id) === key),
                )
            )
                throw invalid('Count line does not belong to this session');
            const lines = count.lines.map((line) => {
                const countedQty = patches.get(String(line._id));
                if (countedQty === undefined) return line;
                if (!Number.isSafeInteger(countedQty - line.expectedQty))
                    throw invalid(
                        'Count variance exceeds supported quantity limits',
                    );
                return { ...line, countedQty };
            });
            const update = await this.counts.updateOne(
                {
                    _id: id,
                    status: StockCountStatus.OPEN,
                    version: dto.version,
                },
                { $set: { lines }, $inc: { version: 1 } },
                { session, runValidators: true },
            );
            if (!update.matchedCount) throw stale();
        }, this.connection);
        return this.get(id);
    }
    async transition(
        actor: AuthUser,
        id: string,
        version: number,
        status: StockCountStatus.SUBMITTED | StockCountStatus.CANCELLED,
    ): Promise<StockCountView> {
        await runInTransaction(async (session) => {
            await this.assertActor(actor, session);
            const count = await this.counts
                .findById(id)
                .session(session)
                .lean();
            if (
                !count ||
                count.version !== version ||
                (count.status !== StockCountStatus.OPEN &&
                    !(
                        status === StockCountStatus.CANCELLED &&
                        count.status === StockCountStatus.SUBMITTED
                    ))
            )
                throw stale();
            if (
                status === StockCountStatus.SUBMITTED &&
                count.lines.some((line) => line.countedQty === undefined)
            )
                throw invalid(
                    'Count every line, including explicit zero, before submitting',
                );
            const update = await this.counts.updateOne(
                { _id: id, version, status: count.status },
                { $set: { status }, $inc: { version: 1 } },
                { session },
            );
            if (!update.matchedCount) throw stale();
        }, this.connection);
        return this.get(id);
    }
    async approve(
        actor: AuthUser,
        id: string,
        version: number,
        token: string | undefined,
    ): Promise<StockCountView> {
        await runInTransaction(async (session) => {
            await this.assertActor(actor, session);
            const count = await this.counts
                .findById(id)
                .session(session)
                .lean();
            if (!count)
                throw new NotFoundError(
                    ErrorCode.NOT_FOUND,
                    'Stock count not found',
                );
            if (count.status === StockCountStatus.APPROVED) return;
            if (
                count.status !== StockCountStatus.SUBMITTED ||
                count.version !== version
            )
                throw stale();
            const manager = await this.approvals.consume(
                token,
                actor,
                OverrideAction.STOCK_COUNT,
                stockCountContext(count),
                session,
            );
            const changes: {
                product: string;
                batch?: string;
                change: number;
                reason: string;
            }[] = [];
            for (const line of count.lines) {
                if (line.countedQty === undefined)
                    throw invalid('Count is incomplete');
                const product = await this.products
                    .findById(line.product)
                    .select('tracksExpiry unit')
                    .session(session)
                    .lean();
                if (
                    !product ||
                    (product.tracksExpiry === true) !== line.tracksExpiry ||
                    (product.unit ?? UnitOfMeasure.PIECE) !== line.unit
                )
                    throw invalid(
                        'Product measure/tracking changed; cancel and start a new count',
                    );
                const change = line.countedQty - line.expectedQty;
                if (!Number.isSafeInteger(change))
                    throw invalid(
                        'Count variance exceeds supported quantity limits',
                    );
                if (change !== 0 && line.tracksExpiry && !line.batch)
                    throw invalid(
                        'A tracked product with no batch can only be counted as zero; receive a batch before adding stock',
                    );
                if (change !== 0)
                    changes.push({
                        product: String(line.product),
                        ...(line.batch && { batch: String(line.batch) }),
                        change,
                        reason: `stock count ${id}`,
                    });
            }
            let adjustmentId: Types.ObjectId | undefined;
            if (changes.length) {
                const [adjustment] = await this.adjustments.create(
                    [
                        {
                            description: `stock count ${id}`,
                            adjustedBy: actor.userId,
                        },
                    ],
                    { session },
                );
                adjustmentId = adjustment._id;
                await this.inventory.adjust(
                    actor.userId,
                    {
                        description: `stock count ${id}`,
                        adjustDetails: changes,
                    },
                    session,
                );
                await this.details.insertMany(
                    changes.map((line) => ({
                        ...line,
                        adjustment: adjustmentId,
                    })),
                    { session },
                );
            }
            const update = await this.counts.updateOne(
                { _id: id, status: StockCountStatus.SUBMITTED, version },
                {
                    $set: {
                        status: StockCountStatus.APPROVED,
                        approvedBy: manager,
                        ...(adjustmentId && { adjustment: adjustmentId }),
                    },
                    $inc: { version: 1 },
                },
                { session },
            );
            if (!update.matchedCount) throw stale();
        }, this.connection);
        return this.get(id);
    }
}
