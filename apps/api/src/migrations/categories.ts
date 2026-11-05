import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import { LEGACY_CATEGORY_NAMES } from '@grocery-pos/contracts';
import {
    Category,
    CategorySchema,
    categoryNameKey,
} from '../category/category.schema';

/** Stop the API for this deployment. One transaction makes reruns safe after failure/crash. */
export async function migrateCategories(
    connection: Connection,
    apply: boolean,
) {
    const db = connection.db;
    if (!db) throw new Error('Not connected');
    const products = db.collection<{ _id: Types.ObjectId; category?: unknown }>(
        'products',
    );
    const legacy = await products
        .find({ category: { $type: 'string' } })
        .toArray();
    const unknown = legacy.filter(
        (p) =>
            !LEGACY_CATEGORY_NAMES.includes(
                p.category as (typeof LEGACY_CATEGORY_NAMES)[number],
            ),
    );
    if (unknown.length)
        throw new Error(
            `Unknown category strings on products: ${unknown.map((p) => p._id.toString()).join(', ')}. Resolve before applying.`,
        );
    const counts = LEGACY_CATEGORY_NAMES.map((name) => ({
        name,
        products: legacy.filter((p) => p.category === name).length,
    }));
    if (!apply) return counts;
    const categories = connection.model<Category>(
        Category.name,
        CategorySchema,
    );
    await categories.init();
    // The name-key unique index also serializes concurrent migration invocations.
    const session = await connection.startSession();
    try {
        await session.withTransaction(async () => {
            for (const [sortOrder, name] of LEGACY_CATEGORY_NAMES.entries()) {
                const row = await categories.findOneAndUpdate(
                    { nameKey: categoryNameKey(name) },
                    { $setOnInsert: { name, isActive: true, sortOrder } },
                    { upsert: true, new: true, session },
                );
                await products.updateMany(
                    { category: name },
                    { $set: { category: row._id } },
                    { session },
                );
            }
        });
    } finally {
        await session.endSession();
    }
    return counts;
}
