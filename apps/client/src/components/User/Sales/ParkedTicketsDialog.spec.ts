import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, nextTick } from 'vue';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { ShiftStatus } from '@grocery-pos/contracts';
import { cartStorageKey, useCartStore } from '@/stores/cart';
import { useShiftStore } from '@/stores/shift';
import ParkedTicketsDialog from './ParkedTicketsDialog.vue';
const get = vi.hoisted(() => vi.fn());
vi.mock('@/axios', () => ({ default: { get } }));
const MILK = {
    product: 'p1',
    EAN: '2000000000015',
    name: 'milk',
    unitPrice: 9500,
    quantity: 2,
};
const PRODUCT = {
    _id: 'p1',
    EAN: MILK.EAN,
    name: 'milk updated',
    price: 10_000,
};
let app: App | null;
let pinia = createPinia();
let closed = vi.fn();
beforeEach(() => {
    localStorage.clear();
    pinia = createPinia();
    setActivePinia(pinia);
    closed = vi.fn();
    get.mockResolvedValue({ data: PRODUCT });
});
afterEach(() => {
    app?.unmount();
    app = null;
    disposePinia(pinia);
    document.body.innerHTML = '';
});
async function flush() {
    for (let n = 0; n < 12; n++) {
        await Promise.resolve();
        await nextTick();
    }
}
function setup(withTicket = true) {
    const cart = useCartStore();
    cart.setOwner('ana');
    if (withTicket) {
        cart.add(MILK, 2);
        cart.park('Customer A', 's');
    }
    const shift = useShiftStore();
    shift.activeShift = {
        _id: 's',
        cashierName: 'ana',
        status: ShiftStatus.OPEN,
        terminal: 'Lane 1',
        openedAt: new Date().toISOString(),
        openingFloat: 100,
        movements: [],
    };
    const host = document.createElement('main');
    document.body.append(host);
    app = createApp(ParkedTicketsDialog, {
        modelValue: true,
        'onUpdate:modelValue': closed,
    });
    app.use(pinia);
    app.mount(host);
    return { cart, shift };
}
function button(text: string) {
    return [...document.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === text,
    )!;
}

describe('parked tickets dialog', () => {
    it('shows the saved note, item count, and no-stock-reservation policy', async () => {
        setup();
        await flush();
        expect(document.body.textContent).toContain('Customer A');
        expect(document.body.textContent).toContain('2 items');
        expect(document.body.textContent).toContain('Stock is not reserved');
    });
    it('re-prices all lines, resumes intact, closes, and never posts a sale or changes stock', async () => {
        const { cart } = setup();
        button('Resume').click();
        await flush();
        expect(get).toHaveBeenCalledExactlyOnceWith(`/products/${MILK.EAN}`);
        expect(cart.items).toEqual([
            { ...MILK, name: PRODUCT.name, unitPrice: PRODUCT.price },
        ]);
        expect(cart.parked).toEqual([]);
        expect(closed).toHaveBeenCalledWith(false);
    });
    it('requires an empty active basket and an open shift', async () => {
        const { cart, shift } = setup();
        cart.add(MILK);
        await flush();
        expect(button('Resume').disabled).toBe(true);
        expect(document.body.textContent).toContain('Park or clear');
        cart.clear();
        shift.activeShift = null;
        await flush();
        expect(button('Resume').disabled).toBe(true);
        expect(document.body.textContent).toContain('Open a shift');
        expect(get).not.toHaveBeenCalled();
    });
    it('keeps every parked line when one product is unavailable or its barcode was reused', async () => {
        const { cart } = setup();
        get.mockResolvedValue({ data: { ...PRODUCT, _id: 'different' } });
        button('Resume').click();
        await flush();
        expect(cart.items).toEqual([]);
        expect(cart.parked[0].items).toEqual([MILK]);
        expect(document.querySelector('[role="alert"]')?.textContent).toContain(
            'no longer available',
        );
    });
    it('keeps the ticket and shows request failures', async () => {
        const { cart } = setup();
        get.mockRejectedValue(new Error('Product unavailable'));
        button('Resume').click();
        await flush();
        expect(document.querySelector('[role="alert"]')?.textContent).toContain(
            'Product unavailable',
        );
        expect(cart.parked).toHaveLength(1);
    });
    it.each(['logout', 'different cashier', 'shift close', 'unmount'])(
        'drops a late response after %s',
        async (change) => {
            let finish!: (value: unknown) => void;
            get.mockImplementation(
                () =>
                    new Promise((resolve) => {
                        finish = resolve;
                    }),
            );
            const { cart, shift } = setup();
            button('Resume').click();
            await flush();
            if (change === 'logout') cart.reset();
            else if (change === 'different cashier') cart.setOwner('ben');
            else if (change === 'shift close') shift.activeShift = null;
            else {
                app?.unmount();
                app = null;
            }
            finish({ data: PRODUCT });
            await flush();
            expect(cart.items).toEqual([]);
            expect(closed).not.toHaveBeenCalled();
        },
    );
    it('refuses a stale async result when another tab starts a ticket', async () => {
        let finish!: (value: unknown) => void;
        get.mockImplementation(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        );
        const { cart } = setup();
        button('Resume').click();
        await flush();
        const raw = JSON.parse(
            localStorage.getItem(cartStorageKey('ana'))!,
        ) as { items: (typeof MILK)[] };
        raw.items = [MILK];
        localStorage.setItem(cartStorageKey('ana'), JSON.stringify(raw));
        finish({ data: PRODUCT });
        await flush();
        expect(cart.items).toEqual([MILK]);
        expect(cart.parked).toHaveLength(1);
        expect(document.querySelector('[role="alert"]')?.textContent).toContain(
            'another tab',
        );
    });
    it('does not discard until the destructive confirmation is accepted', async () => {
        const { cart } = setup();
        button('Discard').click();
        await flush();
        expect(cart.parked).toHaveLength(1);
        button('Keep Ticket').click();
        await flush();
        expect(cart.parked).toHaveLength(1);
        button('Discard').click();
        await flush();
        const actions = [...document.querySelectorAll('button')].filter(
            (b) => b.textContent?.trim() === 'Discard',
        );
        actions[actions.length - 1].click();
        await flush();
        expect(cart.parked).toHaveLength(0);
    });
    it('shows persistence failure while retaining the parked draft', async () => {
        const { cart } = setup();
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota');
        });
        button('Resume').click();
        await flush();
        expect(cart.parked).toHaveLength(1);
        expect(document.querySelector('[role="alert"]')?.textContent).toContain(
            'Nothing was changed',
        );
    });
    it('shows an empty state', () => {
        setup(false);
        expect(document.body.textContent).toContain('No parked tickets');
    });
});
