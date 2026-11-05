/** How a sale was paid, as a whole. The per-tender breakdown is `TenderType`. */
export enum PaymentType {
    GCASH = 'GCASH',
    CASH = 'CASH',
    /** Part cash, part GCash: one CASH tender and one GCASH tender. */
    SPLIT = 'SPLIT',
}

/** Prices are per this unit; quantities are integer minor units. */
export enum UnitOfMeasure {
    PIECE = 'PIECE',
    KG = 'KG',
    G = 'G',
    L = 'L',
}
