import type { PipelineStage } from 'mongoose';

/** Product fields use integer minor units, including legacy ten-unit defaults. */
export function stockScaleExpression() {
    return { $cond: [{ $in: ['$product.unit', ['KG', 'L']] }, 1000, 1] };
}
export function reorderLevelExpression() {
    return {
        $ifNull: [
            '$product.reorderLevel',
            { $multiply: [10, stockScaleExpression()] },
        ],
    };
}
/** Same predicate for the paginated reorder list, sidebar badge and dashboard. */
export function reorderMatchStage(): PipelineStage.Match {
    return {
        $match: {
            'product.isActive': { $ne: false },
            $expr: { $lte: ['$stock', reorderLevelExpression()] },
        },
    };
}
