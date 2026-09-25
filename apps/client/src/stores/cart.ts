import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import {
    DISCOUNT_LIMITS,
    DiscountType,
    NUMERIC_LIMITS,
    STRING_LIMITS,
    BATCH_LIMITS,
} from '@grocery-pos/contracts';

export interface CartItem {
    product: string;
    EAN: string;
    name: string;
    /** Centavos, as priced when scanned; the server re-prices the sale. */
    unitPrice: number;
    quantity: number;
}

/**
 * The order discount being rung up (#23). `value` is a whole percent for
 * PERCENT and centavos for FIXED; a FIXED value of 0 means the amount has
 * not been typed yet (the ticket cannot be charged until it is).
 */
export interface CartDiscount {
    type: DiscountType;
    value: number;
    reason: string;
}

/**
 * The basket is kept in this browser per cashier (product decision
 * 2026-09-25, #23), so a refresh or a crash does not lose it. It is removed
 * on a completed sale, a void and any logout. Only the lines and the
 * discount are stored; bump the version when the shape changes, and
 * anything that does not match it is ignored.
 */
export const CART_STORAGE_VERSION = 1;
export const CART_STORAGE_PREFIX = 'grocery_pos_cart_v1:';

export function cartStorageKey(userId: string): string {
    return `${CART_STORAGE_PREFIX}${userId}`;
}

interface StoredCart {
    version: typeof CART_STORAGE_VERSION;
    items: CartItem[];
    discount: CartDiscount | null;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

const isText = (v: unknown, max: number): v is string =>
    typeof v === 'string' && v.length > 0 && v.length <= max;

/** True for a whole number of units the cart may hold. */
export function isValidQuantity(quantity: unknown): quantity is number {
    return (
        typeof quantity === 'number' &&
        Number.isSafeInteger(quantity) &&
        quantity >= NUMERIC_LIMITS.QUANTITY_MIN
    );
}

function parseItem(raw: unknown): CartItem | null {
    if (!isObject(raw)) return null;
    const { product, EAN, name, unitPrice, quantity } = raw;
    if (!isText(product, 64) || !isText(EAN, STRING_LIMITS.EAN)) return null;
    if (!isText(name, STRING_LIMITS.PRODUCT_NAME)) return null;
    if (
        typeof unitPrice !== 'number' ||
        !Number.isSafeInteger(unitPrice) ||
        unitPrice < NUMERIC_LIMITS.PRICE_MIN ||
        unitPrice > NUMERIC_LIMITS.AMOUNT_MAX
    ) {
        return null;
    }
    if (!isValidQuantity(quantity)) return null;
    return { product, EAN, name, unitPrice, quantity };
}

function parseDiscount(raw: unknown): CartDiscount | null {
    if (!isObject(raw)) return null;
    const { type, value, reason } = raw;
    if (typeof reason !== 'string' || reason.length > STRING_LIMITS.REASON) {
        return null;
    }
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) return null;
    if (type === DiscountType.PERCENT) {
        if (
            value < DISCOUNT_LIMITS.PERCENT_MIN ||
            value > DISCOUNT_LIMITS.PERCENT_MAX
        ) {
            return null;
        }
    } else if (type === DiscountType.FIXED) {
        if (value < 0 || value > NUMERIC_LIMITS.AMOUNT_MAX) return null;
    } else {
        return null;
    }
    return { type, value, reason };
}

/**
 * Reads a stored basket, or null when there is none or it is not one this
 * version wrote. A malformed line is dropped (the rest is kept); a
 * malformed discount is dropped on its own.
 */
export function parseStoredCart(
    json: string | null,
): { items: CartItem[]; discount: CartDiscount | null } | null {
    if (!json) return null;
    let raw: unknown;
    try {
        raw = JSON.parse(json);
    } catch {
        return null;
    }
    if (!isObject(raw) || raw.version !== CART_STORAGE_VERSION) return null;
    if (!Array.isArray(raw.items)) return null;

    const items: CartItem[] = [];
    for (const entry of raw.items.slice(0, BATCH_LIMITS.SALE_LINES)) {
        const item = parseItem(entry);
        if (item && !items.some((i) => i.product === item.product)) {
            items.push(item);
        }
    }
    return { items, discount: parseDiscount(raw.discount) };
}

function readStorage(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeStorage(key: string, value: string | null): void {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    } catch {
        // Storage full or blocked: the basket still works, unsaved.
    }
}

export const useCartStore = defineStore('cart', () => {
    const items = ref<CartItem[]>([]);
    const discount = ref<CartDiscount | null>(null);
    /** Whose basket this is: the key it is saved under. Null: not saved. */
    const owner = ref<string | null>(null);
    /**
     * True while `POST /sales` is in flight. The ticket being charged must
     * not change under the request: every edit below is ignored until the
     * response lands, so a scan cannot be cleared unsold by the success path.
     */
    const locked = ref(false);

    const totalUnits = computed(() =>
        items.value.reduce((sum, item) => sum + item.quantity, 0),
    );

    const subtotal = computed(() =>
        items.value.reduce(
            (sum, item) => sum + item.unitPrice * item.quantity,
            0,
        ),
    );

    function persist() {
        if (!owner.value) return;
        const key = cartStorageKey(owner.value);
        if (items.value.length === 0 && discount.value === null) {
            writeStorage(key, null);
            return;
        }
        const stored: StoredCart = {
            version: CART_STORAGE_VERSION,
            items: items.value.map(
                ({ product, EAN, name, unitPrice, quantity }) => ({
                    product,
                    EAN,
                    name,
                    unitPrice,
                    quantity,
                }),
            ),
            discount: discount.value && { ...discount.value },
        };
        writeStorage(key, JSON.stringify(stored));
    }

    // Saved on every change, synchronously, so a crash right after a scan
    // still has it.
    watch([items, discount], persist, { deep: true, flush: 'sync' });

    /**
     * Binds the basket to the signed-in cashier and restores what was saved
     * for them. Another cashier's basket is never shown: switching owners
     * starts from what the new one saved, or empty.
     */
    function setOwner(userId: string | null | undefined) {
        const next = userId || null;
        if (next === owner.value) return;
        owner.value = null;
        locked.value = false;
        const saved = next
            ? parseStoredCart(readStorage(cartStorageKey(next)))
            : null;
        items.value = saved?.items ?? [];
        discount.value = saved?.discount ?? null;
        owner.value = next;
        // Rewrites a basket that lost malformed parts, or drops an empty one.
        persist();
    }

    function add(
        product: {
            product: string;
            EAN: string;
            name: string;
            unitPrice: number;
        },
        quantity = 1,
    ) {
        if (locked.value || !isValidQuantity(quantity)) return;
        const existing = items.value.find((c) => c.product === product.product);
        if (existing) {
            existing.quantity += quantity;
        } else {
            items.value.push({ ...product, quantity });
        }
    }

    /**
     * Sets a line's quantity: a whole number of at least 1 (`@IsInt()
     * @Min(QUANTITY_MIN)` on the API). Anything else is refused and the
     * line is left as it was; removing a line is `remove`. The client does
     * not know the stock on hand, so a quantity beyond it is refused by
     * the server at checkout, which names the short products. Returns
     * whether the quantity was set.
     */
    function setQuantity(productId: string, quantity: number): boolean {
        if (locked.value || !isValidQuantity(quantity)) return false;
        const item = items.value.find((c) => c.product === productId);
        if (!item) return false;
        item.quantity = quantity;
        return true;
    }

    /**
     * Removes a line, returning it and where it was so it can be put back
     * (`restore`), or null when nothing was removed.
     */
    function remove(
        productId: string,
    ): { item: CartItem; index: number } | null {
        if (locked.value) return null;
        const index = items.value.findIndex((c) => c.product === productId);
        if (index === -1) return null;
        const [item] = items.value.splice(index, 1);
        return { item: { ...item }, index };
    }

    /**
     * Puts a removed line back at its position with its quantity. Refused
     * when the ticket is locked or the product is on it again.
     */
    function restore(item: CartItem, index: number): boolean {
        if (locked.value) return false;
        if (items.value.some((c) => c.product === item.product)) return false;
        const at = Math.min(Math.max(index, 0), items.value.length);
        items.value.splice(at, 0, { ...item });
        return true;
    }

    function setDiscount(next: CartDiscount | null) {
        if (locked.value) return;
        discount.value = next && { ...next };
    }

    /** Empties the ticket and its discount: a completed sale or a void. */
    function clear() {
        if (locked.value) return;
        items.value = [];
        discount.value = null;
    }

    /** Updates the unit price (centavos) of the lines in `prices`. */
    function setUnitPrices(prices: Map<string, number>) {
        if (locked.value) return;
        for (const item of items.value) {
            const price = prices.get(item.product);
            if (price !== undefined) item.unitPrice = price;
        }
    }

    /**
     * Empties the cart, removes the saved basket and releases the lock,
     * whatever state it is in: for logout (forced or not), so the next
     * cashier never inherits this one's basket.
     */
    function reset() {
        if (owner.value) writeStorage(cartStorageKey(owner.value), null);
        owner.value = null;
        items.value = [];
        discount.value = null;
        locked.value = false;
    }

    function lock() {
        locked.value = true;
    }

    function unlock() {
        locked.value = false;
    }

    return {
        items,
        discount,
        owner,
        locked,
        totalUnits,
        subtotal,
        setOwner,
        add,
        setQuantity,
        remove,
        restore,
        setDiscount,
        clear,
        setUnitPrices,
        reset,
        lock,
        unlock,
    };
});
