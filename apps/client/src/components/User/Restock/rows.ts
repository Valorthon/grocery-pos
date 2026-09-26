/** A row of the restock history, also the details dialog's `item`. */
export interface RestockListRow {
    id: string;
    description: string;
    /** The restocker's name; `N/A` once the account is gone. */
    restockedBy: string;
    /** Formatted. */
    totalCost: string;
    /** Formatted in the store timezone. */
    date: string;
}
