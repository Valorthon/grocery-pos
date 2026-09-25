import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, h, ref } from 'vue';
import { createPinia } from 'pinia';
import { SEARCH_DEBOUNCE_MS } from '@/composables/useProductMatches';
import {
    check,
    click,
    field,
    fieldError,
    flush,
    pickFirstMatch,
    type,
} from '@/testing/form-dom';
import AddDialog from './AddDialog.vue';
import type { AddForm } from './dto';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));

const MILK = {
    EAN: '4800361002516',
    name: 'BEAR BRAND MILK',
    product: '64b000000000000000000001',
};

let app: App | null = null;
let added: AddForm[];

beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.get.mockReset();
    api.get.mockImplementation((url: string) =>
        Promise.resolve({
            data: url === 'products/matches' ? [MILK] : { valid: true },
        }),
    );
    added = [];
});

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
    vi.useRealTimers();
});

async function open() {
    const isOpen = ref(false);
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({
        render: () =>
            h(AddDialog, {
                modelValue: isOpen.value,
                'onUpdate:modelValue': (v: boolean) => (isOpen.value = v),
                onAdd: (p: AddForm) => added.push(p),
            }),
    });
    app.use(createPinia());
    app.mount(host);
    isOpen.value = true;
    await flush();
}

async function searchAndPick(text: string) {
    await type('Search Product', text);
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await flush();
    await pickFirstMatch();
}

describe('Restock AddDialog (#17)', () => {
    it('opens with blank quantity and cost, not a pre-filled 0', async () => {
        await open();
        expect(field('Quantity').value).toBe('');
        expect(field('Unit Cost').value).toBe('');
    });

    it('marks the fields for a touch keypad and the API limits', async () => {
        await open();
        expect(field('Quantity').getAttribute('inputmode')).toBe('numeric');
        expect(field('Quantity').getAttribute('min')).toBe('1');
        expect(field('Quantity').getAttribute('step')).toBe('1');
        expect(field('Unit Cost').getAttribute('inputmode')).toBe('decimal');
        await check('This is a new product', true);
        expect(field('Selling Price').getAttribute('inputmode')).toBe(
            'decimal',
        );
        expect(field('Product Name').getAttribute('maxlength')).toBe('50');
        expect(field('EAN').getAttribute('maxlength')).toBe('13');
    });

    it('rejects a blank unit cost instead of recording ₱0', async () => {
        await open();
        await searchAndPick('bear');
        await type('Quantity', '6');
        await click('Restock');
        expect(fieldError('Unit Cost')).toBe('This field is required');
        expect(added).toEqual([]);
    });

    it('rejects a blank quantity', async () => {
        await open();
        await searchAndPick('bear');
        await type('Unit Cost', '12.50');
        await click('Restock');
        expect(fieldError('Quantity')).toBe('This field is required');
        expect(added).toEqual([]);
    });

    it('rejects typed text that was never picked from the matches', async () => {
        await open();
        await type('Search Product', 'bear');
        await type('Quantity', '6');
        await type('Unit Cost', '12.50');
        await click('Restock');
        expect(fieldError('Search Product')).toBe(
            'Pick a product from the matches',
        );
        expect(added).toEqual([]);
    });

    it('adds a picked product with its id and real EAN', async () => {
        await open();
        await searchAndPick('bear');
        expect(field('Search Product').value).toBe(MILK.EAN);
        await type('Quantity', '6');
        await type('Unit Cost', '12.50');
        await click('Restock');
        expect(added).toHaveLength(1);
        expect(added[0]).toMatchObject({
            isNewProduct: false,
            product: MILK.product,
            EAN: MILK.EAN,
            name: MILK.name,
            quantity: 6,
            unitCost: 1250,
        });
    });

    it('rejects a new product with a blank price', async () => {
        await open();
        await check('This is a new product', true);
        await check('Auto-generate EAN', true);
        await type('Product Name', 'Coffee');
        await type('Quantity', '2');
        await type('Unit Cost', '5');
        await click('Restock');
        expect(fieldError('Selling Price')).toBe('This field is required');
        expect(added).toEqual([]);
    });

    it('adds a new product with an auto-generated EAN', async () => {
        await open();
        await check('This is a new product', true);
        await check('Auto-generate EAN', true);
        await type('Product Name', 'Coffee');
        await type('Selling Price', '9.75');
        await type('Quantity', '2');
        await type('Unit Cost', '5');
        await click('Restock');
        expect(added).toHaveLength(1);
        expect(added[0]).toMatchObject({
            isNewProduct: true,
            autoGenerateEAN: true,
            name: 'Coffee',
            price: 975,
            quantity: 2,
            unitCost: 500,
        });
    });

    it('adds a new product with a valid typed EAN', async () => {
        await open();
        await check('This is a new product', true);
        await type('EAN', '4006381333931');
        await type('Product Name', 'Pens');
        await type('Selling Price', '20');
        await type('Quantity', '1');
        await type('Unit Cost', '10');
        await click('Restock');
        expect(added).toHaveLength(1);
        expect(added[0]).toMatchObject({ EAN: '4006381333931', price: 2000 });
    });
});
