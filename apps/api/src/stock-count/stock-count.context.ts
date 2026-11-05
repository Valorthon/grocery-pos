import { createHash } from 'node:crypto';
import type { StockCount } from './stock-count.schema';
/** The manager approves exact persisted variances, never caller supplied lines. */
export function stockCountContext(count: StockCount): string {
    return createHash('sha256')
        .update(
            JSON.stringify({
                count: String(count._id),
                version: count.version,
                scope: count.scope,
                category: count.category ? String(count.category) : null,
                lines: count.lines.map((line) => ({
                    id: String(line._id),
                    product: String(line.product),
                    batch: line.batch ? String(line.batch) : null,
                    unit: line.unit,
                    tracksExpiry: line.tracksExpiry,
                    expectedQty: line.expectedQty,
                    countedQty: line.countedQty,
                })),
            }),
        )
        .digest('hex');
}
