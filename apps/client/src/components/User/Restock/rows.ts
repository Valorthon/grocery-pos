/** A row of the restock history, also the details dialog's `item`. */
export interface RestockListRow {
    id: string;
    description: string;
    /** Absent on legacy receipts without a supplier. */
    supplier?: string;
    /** Absent when none was recorded. */
    invoiceNumber?: string;
    /** The linked purchase order's id (#123), when received against one. */
    purchaseOrder?: string;
    /** The restocker's name; absent once the account is gone. */
    restockedBy?: string;
    /** Formatted. */
    totalCost: string;
    /** Formatted in the store timezone. */
    date: string;
}
