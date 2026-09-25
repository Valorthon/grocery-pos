import { computed, onScopeDispose, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import {
    DISCOUNT_LIMITS,
    DiscountType,
    NUMERIC_LIMITS,
    STRING_LIMITS,
    BATCH_LIMITS,
} from '@grocery-pos/contracts';
import { formatCurrency } from '@/utils/currency';
import { Color, useUIStore } from './ui';

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
 * on a completed sale, a void and any logout. Only the lines, the
 * discount and the checkout attempt (the idempotency key a sale of this
 * ticket was sent with, so a retry after a reload cannot charge twice) are
 * stored; bump the version when the shape changes, and anything that does
 * not match it is ignored.
 */
export const CART_STORAGE_VERSION = 1;
export const CART_STORAGE_PREFIX = 'grocery_pos_cart_v1:';

export function cartStorageKey(userId: string): string {
    return `${CART_STORAGE_PREFIX}${userId}`;
}

/** The localStorage key the auth store caches the signed-in user under. */
export const USER_STORAGE_KEY = 'user';

/** The checkout attempt of this ticket (see `createCheckoutAttempt`). */
export interface StoredAttempt {
    idempotencyKey: string;
    ticketSignature: string;
}

interface StoredCart {
    version: typeof CART_STORAGE_VERSION;
    items: CartItem[];
    discount: CartDiscount | null;
    attempt: StoredAttempt | null;
}

/**
 * The most a ticket may come to, in centavos. The API has no per-line
 * quantity cap (`SellDto` quantity is only `@Min(1)`), but no tender may
 * exceed AMOUNT_MAX (`TenderFields.amount @Max`), so a ticket above it could
 * never be paid. Bounding the subtotal also keeps every line total and sum
 * well inside safe integers.
 */
export const TICKET_AMOUNT_MAX = NUMERIC_LIMITS.AMOUNT_MAX;

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

function parseAttempt(raw: unknown): StoredAttempt | null {
    if (!isObject(raw)) return null;
    const { idempotencyKey, ticketSignature } = raw;
    if (!isText(idempotencyKey, 100) || !isText(ticketSignature, 100_000)) {
        return null;
    }
    return { idempotencyKey, ticketSignature };
}

/**
 * Reads a stored basket, or null when there is none or it is not one this
 * version wrote. A malformed line is dropped (the rest is kept); a
 * malformed discount or attempt is dropped on its own. A dropped line
 * changes the ticket, so its old attempt no longer matches anyway.
 */
export function parseStoredCart(json: string | null): {
    items: CartItem[];
    discount: CartDiscount | null;
    attempt: StoredAttempt | null;
    /** Stored lines left out: unreadable, and past TICKET_AMOUNT_MAX. */
    dropped: { unreadable: number; overCap: number };
} | null {
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
    const dropped = {
        unreadable: Math.max(0, raw.items.length - BATCH_LIMITS.SALE_LINES),
        overCap: 0,
    };
    let total = 0;
    for (const entry of raw.items.slice(0, BATCH_LIMITS.SALE_LINES)) {
        const item = parseItem(entry);
        if (!item || items.some((i) => i.product === item.product)) {
            dropped.unreadable++;
            continue;
        }
        if (item.quantity > (TICKET_AMOUNT_MAX - total) / item.unitPrice) {
            dropped.overCap++;
            continue;
        }
        total += item.unitPrice * item.quantity;
        items.push(item);
    }
    return {
        items,
        discount: parseDiscount(raw.discount),
        attempt: parseAttempt(raw.attempt),
        dropped,
    };
}

/** What to tell the cashier about lines a saved basket lost, or ''. */
export function droppedNotice(
    dropped: { unreadable: number; overCap: number } | undefined,
): string {
    if (!dropped) return '';
    if (dropped.overCap) {
        return `Some saved lines were removed: a sale can't exceed ${formatCurrency(TICKET_AMOUNT_MAX)}.`;
    }
    if (dropped.unreadable) {
        return "Some saved lines couldn't be read and were removed.";
    }
    return '';
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
    /** The idempotency key this ticket was sent with, saved with it. */
    const attempt = ref<StoredAttempt | null>(null);
    /** True while applying another tab's write: not written back. */
    let applyingRemote = false;
    /** Counts baskets taken from another tab, for pages to react to. */
    const remoteChanges = ref(0);
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
        if (!owner.value || applyingRemote) return;
        const key = cartStorageKey(owner.value);
        if (
            items.value.length === 0 &&
            discount.value === null &&
            attempt.value === null
        ) {
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
            attempt: attempt.value && { ...attempt.value },
        };
        writeStorage(key, JSON.stringify(stored));
    }

    // Saved on every change, synchronously, so a crash right after a scan
    // still has it.
    watch([items, discount, attempt], persist, {
        deep: true,
        flush: 'sync',
    });

    /** Replaces the in-memory basket with a stored one (or nothing). */
    function load(saved: ReturnType<typeof parseStoredCart>) {
        items.value = saved?.items ?? [];
        discount.value = saved?.discount ?? null;
        attempt.value = saved?.attempt ?? null;
    }

    /**
     * Another tab of this browser wrote localStorage (#23 review). If it
     * signed a different cashier in (or out), this tab follows, so it can
     * never save one cashier's basket under another's session. If it
     * changed this cashier's basket (a sale, a void, a logout there), this
     * tab shows that basket instead of writing its stale copy back.
     */
    function onStorage(event: StorageEvent) {
        if (event.key === null || event.key === USER_STORAGE_KEY) {
            const json =
                event.key === null
                    ? readStorage(USER_STORAGE_KEY)
                    : event.newValue;
            let userId: string | null = null;
            try {
                const user: unknown = json ? JSON.parse(json) : null;
                if (isObject(user) && typeof user.userId === 'string') {
                    userId = user.userId;
                }
            } catch {
                userId = null;
            }
            setOwner(userId);
            return;
        }
        if (!owner.value || event.key !== cartStorageKey(owner.value)) return;
        // Mid-checkout this tab's ticket is being sold: leave it be.
        if (locked.value) return;
        applyingRemote = true;
        try {
            load(parseStoredCart(event.newValue));
        } finally {
            applyingRemote = false;
        }
        remoteChanges.value++;
    }

    if (typeof window !== 'undefined') {
        window.addEventListener('storage', onStorage);
        onScopeDispose(() => window.removeEventListener('storage', onStorage));
    }

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
        load(saved);
        owner.value = next;
        // Said once, when the basket comes back without some of its lines.
        const notice = droppedNotice(saved?.dropped);
        if (notice) useUIStore().queueMessage(Color.ERROR, notice);
        // Rewrites a basket that lost malformed parts, or drops an empty one.
        persist();
    }

    /**
     * The most units of a line at `unitPrice` the ticket can hold, the
     * other lines as they are: the ticket may not exceed TICKET_AMOUNT_MAX.
     */
    function maxQuantity(productId: string, unitPrice: number): number {
        const others = items.value.reduce(
            (sum, item) =>
                item.product === productId
                    ? sum
                    : sum + item.unitPrice * item.quantity,
            0,
        );
        return Math.max(
            0,
            Math.floor((TICKET_AMOUNT_MAX - others) / Math.max(unitPrice, 1)),
        );
    }

    /**
     * Adds `quantity` units of a product, merging with its line. Returns
     * false, changing nothing, when locked, for an invalid quantity, or
     * when the ticket would exceed TICKET_AMOUNT_MAX.
     */
    function add(
        product: {
            product: string;
            EAN: string;
            name: string;
            unitPrice: number;
        },
        quantity = 1,
    ): boolean {
        if (locked.value || !isValidQuantity(quantity)) return false;
        const existing = items.value.find((c) => c.product === product.product);
        const already = existing?.quantity ?? 0;
        const unitPrice = existing?.unitPrice ?? product.unitPrice;
        if (quantity > maxQuantity(product.product, unitPrice) - already) {
            return false;
        }
        if (existing) {
            existing.quantity += quantity;
        } else {
            items.value.push({ ...product, quantity });
        }
        return true;
    }

    /**
     * Sets a line's quantity: a whole number of at least 1 (`@IsInt()
     * @Min(QUANTITY_MIN)` on the API). Anything else is refused and the
     * line is left as it was; removing a line is `remove`. The client does
     * not know the stock on hand, so a quantity beyond it is refused by
     * the server at checkout, which names the short products. Nor may the
     * ticket exceed TICKET_AMOUNT_MAX (see there). Returns whether the
     * quantity was set.
     */
    function setQuantity(productId: string, quantity: number): boolean {
        if (locked.value || !isValidQuantity(quantity)) return false;
        const item = items.value.find((c) => c.product === productId);
        if (!item) return false;
        if (quantity > maxQuantity(productId, item.unitPrice)) return false;
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
     * when the ticket is locked, the product is on it again, or the ticket
     * would exceed TICKET_AMOUNT_MAX.
     */
    function restore(item: CartItem, index: number): boolean {
        if (locked.value) return false;
        if (items.value.some((c) => c.product === item.product)) return false;
        if (item.quantity > maxQuantity(item.product, item.unitPrice)) {
            return false;
        }
        const at = Math.min(Math.max(index, 0), items.value.length);
        items.value.splice(at, 0, { ...item });
        return true;
    }

    function setDiscount(next: CartDiscount | null) {
        if (locked.value) return;
        discount.value = next && { ...next };
    }

    function setAttempt(next: StoredAttempt | null) {
        attempt.value = next && { ...next };
    }

    /**
     * Empties the ticket, its discount and its checkout attempt: a
     * completed sale or a void.
     */
    function clear() {
        if (locked.value) return;
        items.value = [];
        discount.value = null;
        attempt.value = null;
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
        attempt.value = null;
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
        attempt,
        owner,
        remoteChanges,
        locked,
        totalUnits,
        subtotal,
        setOwner,
        onStorage,
        maxQuantity,
        add,
        setQuantity,
        remove,
        restore,
        setDiscount,
        setAttempt,
        clear,
        setUnitPrices,
        reset,
        lock,
        unlock,
    };
});
