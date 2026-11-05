import type { Connection, ClientSession } from 'mongoose';
import { Types } from 'mongoose';
import { randomUUID, createHash } from 'node:crypto';
import {
    StockMovementType,
    StockMovementSource,
    UnitOfMeasure,
    unitOf,
} from '@grocery-pos/contracts';
import {
    StockMovementSchema,
    StockMovement,
} from '../stock-movement/stock-movement.schema';

export const STOCK_LEDGER_MIGRATION = 'issue-45-stock-ledger-v1';
interface Event {
    type: StockMovementType;
    refModel: StockMovementSource;
    refId: Types.ObjectId;
    quantity: number;
    user?: Types.ObjectId;
    occurredAt: Date;
    postedAt: Date;
    tie: string;
}
interface Marker {
    _id: string;
    status: string;
    owner?: string;
    startedAt?: Date;
    finishedAt?: Date;
    fingerprint?: string;
}
const validInteger = (v: unknown): v is number =>
    typeof v === 'number' && Number.isSafeInteger(v);
function integer(v: unknown): number {
    if (!validInteger(v)) throw new Error('Unsafe historical stock quantity');
    return v;
}
function date(v: unknown): Date {
    if (!(v instanceof Date) || !Number.isFinite(v.getTime()))
        throw new Error('Missing historical event timestamp');
    return v;
}
function sum(values: number[]) {
    const total = values.reduce((a, b) => a + BigInt(integer(b)), 0n);
    if (
        total > BigInt(Number.MAX_SAFE_INTEGER) ||
        total < BigInt(Number.MIN_SAFE_INTEGER)
    )
        throw new Error('Historical movement sum exceeds safe bounds');
    return Number(total);
}
/** Source data, never actor guesses: missing historical users stay unknown. */
async function eventsFor(
    connection: Connection,
    product: Types.ObjectId,
    session?: ClientSession,
): Promise<Event[]> {
    const db = connection.db!;
    const options = session ? { session } : {};
    const events: Event[] = [];
    for (const line of await db
        .collection('restockdetails')
        .find({ product }, options)
        .toArray()) {
        const parent = await db
            .collection('restocks')
            .findOne({ _id: line.restock as Types.ObjectId }, options);
        if (!parent)
            throw new Error(`Missing restock parent for ${String(line._id)}`);
        const time = date(parent.createdAt);
        events.push({
            type: StockMovementType.RESTOCK,
            refModel: StockMovementSource.RESTOCK,
            refId: parent._id,
            quantity: integer(line.quantity),
            user: parent.restockedBy as Types.ObjectId | undefined,
            occurredAt: time,
            postedAt: time,
            tie: `1:${String(line._id)}`,
        });
    }
    for (const line of await db
        .collection('adjustmentdetails')
        .find({ product }, options)
        .toArray()) {
        const parent = await db
            .collection('adjustments')
            .findOne({ _id: line.adjustment as Types.ObjectId }, options);
        if (!parent)
            throw new Error(
                `Missing adjustment parent for ${String(line._id)}`,
            );
        const count = await db
            .collection('stockcounts')
            .findOne({ adjustment: parent._id }, options);
        const time = date(parent.createdAt);
        events.push({
            type: count
                ? StockMovementType.COUNT
                : StockMovementType.ADJUSTMENT,
            refModel: count
                ? StockMovementSource.COUNT
                : StockMovementSource.ADJUSTMENT,
            refId: count ? count._id : parent._id,
            quantity: integer(line.change),
            user: parent.adjustedBy as Types.ObjectId | undefined,
            occurredAt: time,
            postedAt: time,
            tie: `2:${String(line._id)}`,
        });
    }
    for (const line of await db
        .collection('salesdetails')
        .find({ product }, options)
        .toArray()) {
        const parent = await db
            .collection('sales')
            .findOne({ _id: line.sales as Types.ObjectId }, options);
        if (!parent)
            throw new Error(`Missing sale parent for ${String(line._id)}`);
        const time = date(parent.createdAt);
        events.push({
            type: StockMovementType.SALE,
            refModel: StockMovementSource.SALE,
            refId: parent._id,
            quantity: -integer(line.quantity),
            user: parent.cashier as Types.ObjectId | undefined,
            occurredAt: date(parent.soldAt ?? parent.createdAt),
            postedAt: time,
            tie: `3:${String(line._id)}`,
        });
        const reversal = parent.reversal as
            | { type?: string; at?: Date; approvedBy?: Types.ObjectId }
            | undefined;
        if (reversal) {
            if (reversal.type !== 'VOID' && reversal.type !== 'REFUND')
                throw new Error('Unknown historical reversal type');
            const reversedAt = date(reversal.at);
            events.push({
                type:
                    reversal.type === 'VOID'
                        ? StockMovementType.VOID
                        : StockMovementType.REFUND,
                refModel: StockMovementSource.SALE,
                refId: parent._id,
                quantity: integer(line.quantity),
                user: reversal.approvedBy,
                occurredAt: reversedAt,
                postedAt: reversedAt,
                tie: `4:${String(line._id)}`,
            });
        }
    }
    if (events.length > 100000)
        throw new Error(
            'Product history exceeds 100,000 events; plan a dedicated migration',
        );
    return events.sort(
        (a, b) =>
            a.postedAt.getTime() - b.postedAt.getTime() ||
            a.tie.localeCompare(b.tie),
    );
}
export interface StockLedgerPlan {
    product: string;
    stock: number;
    knownNet: number;
    opening: number;
    events: number;
    alreadyApplied: boolean;
}
/** API stopped. Each product and its completion marker commit atomically; crash reruns never duplicate rows. */
export async function migrateStockLedger(
    connection: Connection,
    apply: boolean,
    resumeStale = false,
): Promise<StockLedgerPlan[]> {
    const db = connection.db;
    if (!db) throw new Error('Not connected');
    const markers = db.collection<Marker>('migrations');
    const prior = await markers.findOne({ _id: STOCK_LEDGER_MIGRATION });
    if (apply && prior?.status === 'running' && !resumeStale)
        throw new Error(
            'Ledger migration is already running; use --resume-stale only after confirming its process is gone',
        );
    const owner = randomUUID();
    if (apply) {
        // Conditional claim prevents two operators from concurrently taking a stale marker.
        const filter = prior
            ? {
                  _id: STOCK_LEDGER_MIGRATION,
                  status: prior.status,
                  ...(prior.owner && { owner: prior.owner }),
              }
            : { _id: STOCK_LEDGER_MIGRATION, status: { $exists: false } };
        const claim = await markers.updateOne(
            filter,
            { $set: { status: 'running', owner, startedAt: new Date() } },
            { upsert: !prior },
        );
        if (!claim.matchedCount && !claim.upsertedCount)
            throw new Error('Another migration process claimed the ledger');
    }
    const plans: StockLedgerPlan[] = [];
    try {
        // Dry-run uses raw collections only: no model construction/index/collection side effects.
        const model = apply
            ? connection.model<StockMovement>(
                  StockMovement.name,
                  StockMovementSchema,
              )
            : undefined;
        if (model) await model.init();
        for await (const inventory of db.collection('inventories').find({})) {
            const product = inventory.product as Types.ObjectId;
            const definition = await db
                .collection('products')
                .findOne({ _id: product });
            if (!definition)
                throw new Error(
                    `Orphan inventory ${String(inventory._id)} must be resolved before backfill`,
                );
            if (
                definition.unit !== undefined &&
                !Object.values(UnitOfMeasure).includes(
                    definition.unit as UnitOfMeasure,
                )
            )
                throw new Error('Unknown historical product unit');
            const stock = integer(inventory.stock);
            const existing = await db
                .collection('stockmovements')
                .find({ product })
                .toArray();
            if (existing.some((row) => row.historical !== true))
                throw new Error(
                    `Live ledger already exists for ${String(product)}; historical backfill must run before the new API. Refusing to overwrite it.`,
                );
            const eventRows = await eventsFor(connection, product);
            const fingerprint = createHash('sha256')
                .update(
                    JSON.stringify({
                        stock,
                        unit: unitOf(
                            definition.unit as UnitOfMeasure | undefined,
                        ),
                        events: eventRows,
                    }),
                )
                .digest('hex');
            const productMarkerId = `${STOCK_LEDGER_MIGRATION}:${String(product)}`;
            const knownNet = sum(eventRows.map((row) => row.quantity));
            const opening = sum([stock, -knownNet]);
            plans.push({
                product: String(product),
                stock,
                knownNet,
                opening,
                events: eventRows.length,
                alreadyApplied: existing.length > 0,
            });
            if (!apply) continue;
            const session = await connection.startSession();
            try {
                await session.withTransaction(async () => {
                    const found = await db
                        .collection('stockmovements')
                        .find({ product }, { session })
                        .toArray();
                    if (found.length) {
                        const priorProduct = await markers.findOne(
                            { _id: productMarkerId },
                            { session },
                        );
                        if (priorProduct?.fingerprint !== fingerprint)
                            throw new Error(
                                'Historical source changed after ledger backfill; investigate instead of overwriting',
                            );
                        if (
                            found.some((row) => row.historical !== true) ||
                            sum(found.map((row) => integer(row.quantity))) !==
                                stock
                        )
                            throw new Error(
                                'Existing ledger changed; refuse migration overwrite',
                            );
                        return;
                    }
                    const current = await db
                        .collection('inventories')
                        .findOne({ _id: inventory._id }, { session });
                    if (!current || current.stock !== stock)
                        throw new Error(
                            'Inventory changed during migration; stop the API before applying',
                        );
                    // Touch the inventory row so concurrent mutations conflict rather than producing an inconsistent baseline.
                    await db
                        .collection('inventories')
                        .updateOne(
                            { _id: inventory._id, stock },
                            { $inc: { __v: 1 } },
                            { session },
                        );
                    const again = await eventsFor(connection, product, session);
                    if (JSON.stringify(again) !== JSON.stringify(eventRows))
                        throw new Error(
                            'History changed during migration; stop the API',
                        );
                    const first =
                        eventRows[0]?.postedAt ?? date(inventory.createdAt);
                    let balance = BigInt(opening);
                    const records = [
                        {
                            product,
                            type: StockMovementType.OPENING,
                            quantity: opening,
                            balanceAfter: opening,
                            unit: unitOf(
                                definition.unit as UnitOfMeasure | undefined,
                            ),
                            sequence: 0,
                            refModel: StockMovementSource.OPENING,
                            occurredAt: first,
                            createdAt: first,
                            historical: true,
                        },
                    ];
                    for (const [index, event] of eventRows.entries()) {
                        balance += BigInt(event.quantity);
                        if (
                            balance > BigInt(Number.MAX_SAFE_INTEGER) ||
                            balance < BigInt(Number.MIN_SAFE_INTEGER)
                        )
                            throw new Error(
                                'Derived historical balance exceeds safe bounds',
                            );
                        records.push({
                            product,
                            type: event.type,
                            quantity: event.quantity,
                            balanceAfter: Number(balance),
                            unit: unitOf(
                                definition.unit as UnitOfMeasure | undefined,
                            ),
                            sequence: index + 1,
                            refModel: event.refModel,
                            occurredAt: event.occurredAt,
                            createdAt: event.postedAt,
                            historical: true,
                            ...(event.refId && { refId: event.refId }),
                            ...(event.user && { user: event.user }),
                        });
                    }
                    for (let index = 0; index < records.length; index += 1000)
                        await db
                            .collection('stockmovements')
                            .insertMany(records.slice(index, index + 1000), {
                                session,
                            });
                    await markers.insertOne(
                        {
                            _id: productMarkerId,
                            status: 'complete',
                            fingerprint,
                        },
                        { session },
                    );
                });
            } finally {
                await session.endSession();
            }
        }
        if (apply)
            await markers.updateOne(
                { _id: STOCK_LEDGER_MIGRATION, owner },
                { $set: { status: 'complete', finishedAt: new Date() } },
            );
        return plans;
    } catch (error) {
        if (apply)
            await markers.updateOne(
                { _id: STOCK_LEDGER_MIGRATION, owner },
                { $set: { status: 'incomplete' } },
            );
        throw error;
    }
}
