import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import {
    describeInvalidProductName,
    invalidProductNames,
} from '@grocery-pos/contracts';

/**
 * #483: lists stored product names that break the character rule (emoji
 * and other symbols). Read-only: nothing is rewritten; an admin renames
 * each listed product in Products (archived ones too) and re-runs this.
 */
export async function findInvalidProductNames(connection: Connection) {
    const db = connection.db;
    if (!db) throw new Error('Not connected');
    const rows = await db
        .collection<{
            _id: Types.ObjectId;
            name: string;
            EAN?: string;
            isActive?: boolean;
        }>('products')
        .find({}, { projection: { name: 1, EAN: 1, isActive: 1 } })
        .toArray();
    return invalidProductNames(
        rows.map((r) => ({
            id: r._id.toString(),
            name: String(r.name),
            EAN: r.EAN,
            isActive: r.isActive,
        })),
    ).map((row) => ({ ...row, label: describeInvalidProductName(row) }));
}
