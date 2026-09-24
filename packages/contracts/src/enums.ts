/** How a sale was paid, as a whole. The per-tender breakdown is `TenderType`. */
export enum PaymentType {
    GCASH = 'GCASH',
    CASH = 'CASH',
    /** Part cash, part GCash: one CASH tender and one GCASH tender. */
    SPLIT = 'SPLIT',
}

export enum Category {
    FOOD = 'FOOD',
    DRINKS = 'DRINKS',
    ELECTRONICS = 'ELECTRONICS',
    HOUSEHOLD = 'HOUSEHOLD',
    CLOTHES = 'CLOTHES',
}
