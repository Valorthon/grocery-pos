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
    /**
     * Largest money amount any request may carry, in centavos (₱10,000,000):
     * a price, a cost, a fixed discount or a tender. Far above any real
     * grocery figure, it only stops absurd values (and overflowing sums)
     * from reaching the ledger.
     */
    AMOUNT_MAX: 1_000_000_000,
} as const;

export const EAN_COUNTER = {
    PREFIX: 200,
    STARTING_VALUE: 0,
} as const;

export const VALIDATION = {
    CHANGE_NOT_ZERO: 0,
} as const;

/**
 * A GCash reference number as printed on the GCash receipt: 13 digits
 * (shown grouped as `1234 567 890123`). The client strips spaces before
 * sending and the server strips them again, so only the digits are stored.
 */
export const REFERENCE_NUMBER_LIMITS = {
    MIN_LENGTH: 13,
    MAX_LENGTH: 13,
    /** Digits only, after whitespace is removed. */
    PATTERN: /^\d+$/,
} as const;
