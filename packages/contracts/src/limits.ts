/**
 * Validation bounds shared by the API's DTOs and the client's form rules,
 * so the client can enforce exactly what the server will accept.
 */
export const STRING_LIMITS = {
    EAN: 13,
    USERNAME: 30,
    PRODUCT_NAME: 50,
    PASSWORD: 64,
    /**
     * Shortest password accepted when one is set: on create, on an admin
     * reset and on `PATCH /users/me/password`. Deliberately not checked on
     * login, so accounts with an older, shorter password can still sign in
     * (and then change it).
     */
    PASSWORD_MIN: 8,
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

/**
 * Paging bounds for every paginated list (`page` / `limit` queries). The
 * client's tables offer at most 50 rows a page; the shift picker asks for
 * 100 (issue #16).
 */
export const PAGINATION = {
    LIMIT_MAX: 100,
    /**
     * Highest page number. With LIMIT_MAX it bounds `skip` at 999,900
     * documents: past any real list here (a busy register rings well under
     * a million sales a decade), while a typo like `page=1e20` is a 400
     * rather than an absurd skip reaching Mongo.
     */
    PAGE_MAX: 10_000,
} as const;

/**
 * Most entries one request body may carry in a list, so a single request
 * cannot fan out into an unbounded bulk write (issue #16). Sized well above
 * a real grocery register or stock count; the tenders of a sale are bounded
 * separately, by the number of tender types.
 */
export const BATCH_LIMITS = {
    /** Distinct lines in one sale (`sellDetails`). */
    SALE_LINES: 200,
    /** Lines in one restock delivery (`restockDetails`). */
    RESTOCK_LINES: 200,
    /** Lines in one stock adjustment (`adjustDetails`). */
    ADJUSTMENT_LINES: 200,
    /** Products created by one `POST /products/bulk` (`newProducts`). */
    NEW_PRODUCTS: 200,
    /** Product edits in one `PATCH /products` (`updates`). */
    PRODUCT_UPDATES: 200,
    /** Accounts created or edited by one `POST`/`PATCH /users`. */
    USERS: 50,
} as const;

/**
 * Dashboard stock tiles (product owner, 2026-09-25): "low stock" is
 * 1 to LOW_STOCK_THRESHOLD units on hand, "out of stock" is 0 or below.
 * A store-wide stand-in until per-product reorder levels arrive (#40).
 */
export const LOW_STOCK_THRESHOLD = 10;
