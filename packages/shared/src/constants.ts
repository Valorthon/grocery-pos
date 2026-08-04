export const STRING_LIMITS = {
    EAN: 13,
    USERNAME: 30,
    PRODUCT_NAME: 50,
    PASSWORD: 64,
    REASON: 100,
    DESCRIPTION: 300,
    REFERENCE_NUMBER: 50,
} as const;

export const NUMERIC_LIMITS = {
    PRICE_MIN: 0,
    QUANTITY_MIN: 1,
    STOCK_MIN: 0,
    AMOUNT_MIN: 0,
} as const;

export const EAN_COUNTER = {
    PREFIX: 200,
    STARTING_VALUE: 0,
} as const;

export const VALIDATION = {
    CHANGE_NOT_ZERO: 0,
} as const;
