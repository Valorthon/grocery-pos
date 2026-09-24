/**
 * Validation bounds shared by the API's DTOs and the client's form rules,
 * so the client can enforce exactly what the server will accept.
 */
export const STRING_LIMITS = {
    EAN: 13,
    USERNAME: 30,
    PRODUCT_NAME: 50,
    PASSWORD: 64,
    REASON: 100,
    DESCRIPTION: 300,
    REFERENCE_NUMBER: 50,
} as const;

/**
 * Money is stored and sent as integer centavos (₱1.00 = 100), so every money
 * bound here is in centavos too. Pesos exist only at the client's input and
 * display boundary.
 */
export const NUMERIC_LIMITS = {
    /** Smallest price or cost, in centavos: free products are invalid. */
    PRICE_MIN: 1,
    QUANTITY_MIN: 1,
    STOCK_MIN: 0,
    /** Smallest sale total, in centavos: a sale cannot total ₱0. */
    AMOUNT_MIN: 1,
} as const;

export const EAN_COUNTER = {
    PREFIX: 200,
    STARTING_VALUE: 0,
} as const;

export const VALIDATION = {
    CHANGE_NOT_ZERO: 0,
} as const;
