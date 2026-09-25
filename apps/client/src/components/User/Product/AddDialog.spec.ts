import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, h, ref } from 'vue';
import { createPinia } from 'pinia';
import { click, field, fieldError, flush, type } from '@/testing/form-dom';
import type { ProductDraft } from '@/utils/payloads';
import AddDialog from './AddDialog.vue';
import { productErrors, type ProductFormInput } from './validation';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));

let app: App | null = null;
let added: ProductDraft[];

beforeEach(() => {
    api.get.mockReset();
    api.get.mockResolvedValue({ data: {} });
    added = [];
});

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

async function open(item?: Partial<ProductDraft>) {
    const isOpen = ref(false);
    const host = document.createElement('div');
    document.body.appendChild(host);
    app = createApp({
        render: () =>
            h(AddDialog, {
                modelValue: isOpen.value,
                'onUpdate:modelValue': (v: boolean) => (isOpen.value = v),
                item,
                onAdd: (p: ProductDraft) => added.push(p),
                onUpdate: (p: ProductDraft) => added.push(p),
            }),
    });
    app.use(createPinia());
    app.mount(host);
    isOpen.value = true;
    await flush();
}

const VALID: ProductFormInput = {
    EAN: '4006381333931',
    name: 'Pens',
    price: '20.00',
    autoGenerateEAN: false,
};

describe('productErrors (#17)', () => {
    it('accepts a valid product, typed or auto EAN', () => {
        expect(productErrors(VALID)).toEqual({});
        expect(
            productErrors({ ...VALID, EAN: '', autoGenerateEAN: true }),
        ).toEqual({});
    });

    it('rejects a blank, zero, over-precise or huge price', () => {
        expect(productErrors({ ...VALID, price: '' }).price).toBe(
            'This field is required',
        );
        expect(productErrors({ ...VALID, price: '0' }).price).toBe(
            'Enter at least ₱0.01',
        );
        expect(productErrors({ ...VALID, price: '1.005' }).price).toBeTruthy();
        expect(productErrors({ ...VALID, price: '10000001' }).price).toBe(
            'At most ₱10,000,000.00',
        );
    });

    it('rejects a blank or over-long name', () => {
        expect(productErrors({ ...VALID, name: ' ' }).name).toBeTruthy();
        expect(
            productErrors({ ...VALID, name: 'x'.repeat(51) }).name,
        ).toBeTruthy();
    });

    it('rejects a bad barcode unless auto-generated', () => {
        expect(productErrors({ ...VALID, EAN: '123' }).EAN).toBeTruthy();
    });
});

describe('Product AddDialog (#17)', () => {
    it('opens with a blank price and a decimal keypad', async () => {
        await open();
        expect(field('Selling Price').value).toBe('');
        expect(field('Selling Price').getAttribute('inputmode')).toBe(
            'decimal',
        );
        expect(field('Product Name').getAttribute('maxlength')).toBe('50');
    });

    it('rejects a blank price without checking the server', async () => {
        await open();
        await type('EAN / Barcode', VALID.EAN);
        await type('Product Name', 'Pens');
        await click('Add to Draft');
        expect(fieldError('Selling Price')).toBe('This field is required');
        expect(api.get).not.toHaveBeenCalled();
        expect(added).toEqual([]);
    });

    it('adds the price in centavos', async () => {
        await open();
        await type('EAN / Barcode', VALID.EAN);
        await type('Product Name', 'Pens');
        await type('Selling Price', '19.99');
        await click('Add to Draft');
        expect(added).toEqual([
            {
                EAN: VALID.EAN,
                name: 'Pens',
                price: 1999,
                autoGenerateEAN: false,
            },
        ]);
    });

    it('pre-fills an edited draft with two decimals', async () => {
        await open({ EAN: VALID.EAN, name: 'Pens', price: 2000 });
        expect(field('Selling Price').value).toBe('20.00');
    });
});
