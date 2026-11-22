import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import {
    STRING_LIMITS,
    planProductNameUppercase,
} from '@grocery-pos/contracts';

/**
 * #443: stores every product name in UPPERCASE. Stop the API first. The
 * plan is made from every product before any write; a collision after
 * uppercasing (or a name that would grow past the limit) is refused and
 * reported, writing nothing. Reruns plan nothing (idempotent). Each write
 * filters on the old name, inside one transaction.
 */
export async function migrateUppercaseProductNames(
    connection: Connection,
    apply: boolean,
) {
    const db = connection.db;
    if (!db) throw new Error('Not connected');
    const products = db.collection<{ _id: Types.ObjectId; name: string }>(
        'products',
    );
    const rows = await products.find({}, { projection: { name: 1 } }).toArray();
    const plan = planProductNameUppercase(
        rows.map((r) => ({ id: r._id.toString(), name: r.name })),
        STRING_LIMITS.PRODUCT_NAME,
    );
    if (plan.collisions.length)
        throw new Error(
            `Product names collide after uppercasing: ${plan.collisions
                .map((c) => `${c.name} (${c.ids.join(', ')})`)
                .join('; ')}. Rename them before applying.`,
        );
    if (plan.tooLong.length)
        throw new Error(
            `Product names exceed ${STRING_LIMITS.PRODUCT_NAME} characters after uppercasing: ${plan.tooLong
                .map((t) => t.id)
                .join(', ')}. Rename them before applying.`,
        );
    const summary = { products: rows.length, toUppercase: plan.updates.length };
    if (!apply || plan.updates.length === 0) return summary;
    const session = await connection.startSession();
    try {
        await session.withTransaction(async () => {
            for (const u of plan.updates) {
                const res = await products.updateOne(
                    { _id: new Types.ObjectId(u.id), name: u.from },
                    { $set: { name: u.to } },
                    { session },
                );
                if (res.matchedCount !== 1)
                    throw new Error(
                        `Product ${u.id} changed during the migration; stop the API and rerun.`,
                    );
            }
        });
    } finally {
        await session.endSession();
    }
    return summary;
}
