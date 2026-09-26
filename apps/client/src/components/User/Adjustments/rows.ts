/** A row of the adjustment history, also the details dialog's `item`. */
export interface AdjustmentListRow {
    id: string;
    description: string;
    /** The adjuster's name; `N/A` once the account is gone. */
    adjustedBy: string;
    /** Formatted in the store timezone. */
    date: string;
}
