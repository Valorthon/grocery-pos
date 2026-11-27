import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type App, createApp, h, ref } from 'vue';
import { type Pinia, createPinia } from 'pinia';
import { AxiosError, AxiosHeaders } from 'axios';
import { useUIStore } from '@/stores/ui';
import {
    check,
    click,
    field,
    fieldError,
    flush,
    type,
} from '@/testing/form-dom';
import type { ProductDraft } from '@/utils/payloads';
import type { WithDraftId } from '@/composables/useDrafts';
import AddDialog from './AddDialog.vue';
import { productErrors, type ProductFormInput } from './validation';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/axios', () => ({ default: api }));

let app: App | null = null;
let added: ProductDraft[];
let opened: [string, boolean][];
let pinia: Pinia;

beforeEach(() => {
    api.get.mockReset();
    api.get.mockResolvedValue({ data: {} });
    added = [];
    opened = [];
});

afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
});

async function open(
    item?: Partial<ProductDraft>,
    drafts: WithDraftId<ProductDraft>[] = [],
    editingId: string | null = null,
) {
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
                drafts,
                editingId,
                onEditDraft: (id: string, dirty: boolean) =>
                    opened.push([id, dirty]),
            }),
    });
    pinia = createPinia();
    app.use(pinia);
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

    it('measures the name as stored, uppercased (#443)', () => {
        // 30 'ß' uppercase to 60 letters, past the 50 the DTO allows.
        expect(productErrors({ ...VALID, name: 'ß'.repeat(30) }).name).toBe(
            'At most 50 characters',
        );
        expect(
            productErrors({ ...VALID, name: 'ß'.repeat(25) }).name,
        ).toBeUndefined();
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
        expect(
            api.get.mock.calls.some(([url]) =>
                String(url).includes('ensureValid'),
            ),
        ).toBe(false);
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
                unit: 'PIECE',
                name: 'PENS',
                price: 1999,
                autoGenerateEAN: false,
            },
        ]);
    });

    it('pre-fills an edited draft with two decimals', async () => {
        await open({ EAN: VALID.EAN, name: 'Pens', price: 2000 });
        expect(field('Selling Price').value).toBe('20.00');
    });

    describe('a taken name (#455)', () => {
        const duplicate = (details: string[]) =>
            new AxiosError('dup', 'ERR_BAD_REQUEST', undefined, undefined, {
                status: 400,
                statusText: 'Bad Request',
                headers: {},
                config: { headers: new AxiosHeaders() },
                data: {
                    statusCode: 400,
                    error: 'PRODUCT_002',
                    message: 'Duplicate product',
                    details,
                },
            });
        const toasts = () => useUIStore(pinia).toasts.flatMap((t) => t.lines);

        async function submit() {
            await type('EAN / Barcode', VALID.EAN);
            await type('Product Name', 'Pens');
            await type('Selling Price', '20.00');
            await click('Add to Draft');
        }

        it('shows it under Product Name, with no toast', async () => {
            await open();
            api.get.mockRejectedValue(duplicate(['name already exists']));
            await submit();
            expect(fieldError('Product Name')).toBe(
                'A product with this name already exists',
            );
            expect(toasts()).toEqual([]);
            expect(added).toEqual([]);

            await type('Product Name', 'Pencils');
            expect(fieldError('Product Name')).toBe('');
        });

        it('shows a taken barcode under EAN / Barcode too (#470)', async () => {
            await open();
            api.get.mockRejectedValue(
                duplicate(['EAN already exists', 'name already exists']),
            );
            await submit();
            expect(fieldError('Product Name')).toBe(
                'A product with this name already exists',
            );
            expect(fieldError('EAN / Barcode')).toBe(
                'A product with this barcode already exists',
            );
            expect(toasts()).toEqual([]);
            expect(added).toEqual([]);

            await type('EAN / Barcode', '036000291452');
            expect(fieldError('EAN / Barcode')).toBe('');
            expect(fieldError('Product Name')).toBe(
                'A product with this name already exists',
            );
        });

        it('keeps other failures toasts', async () => {
            await open();
            api.get.mockRejectedValue(duplicate(['something else']));
            await submit();
            expect(fieldError('Product Name')).toBe('');
            expect(fieldError('EAN / Barcode')).toBe('');
            expect(toasts()).toEqual(['something else']);
        });
    });

    it('checks the name characters on blur (#507)', async () => {
        await open();
        await type('Product Name', 'QA 🍎 APPLE');
        field('Product Name').dispatchEvent(new Event('blur'));
        await flush();
        expect(fieldError('Product Name')).toBe(
            "Use only letters, numbers, spaces and . , - & ' / ( ) %",
        );
        await type('Product Name', 'Piña (1/2 kg)');
        field('Product Name').dispatchEvent(new Event('blur'));
        await flush();
        expect(fieldError('Product Name')).toBe('');
        await type('Product Name', 'Mama’s Best');
        field('Product Name').dispatchEvent(new Event('blur'));
        await flush();
        expect(fieldError('Product Name')).toBe('');
        await type('Product Name', '');
        field('Product Name').dispatchEvent(new Event('blur'));
        await flush();
        expect(fieldError('Product Name')).toBe('');
    });

    describe('a repeat of another draft (#478)', () => {
        const DRAFTS: WithDraftId<ProductDraft>[] = [
            {
                draftId: 'd1',
                EAN: '4006381333931',
                name: 'PENS',
                price: 2000,
                autoGenerateEAN: false,
            },
            {
                draftId: 'd2',
                EAN: '',
                name: 'MILK',
                price: 1000,
                autoGenerateEAN: true,
            },
        ];
        const blur = (label: string) =>
            field(label).dispatchEvent(new Event('blur'));
        const enter = (label: string) =>
            field(label).dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Enter' }),
            );
        const repeatButton = (which: 'ean' | 'name') =>
            document.body.querySelector<HTMLButtonElement>(
                `[data-testid="edit-repeat-${which}"]`,
            );

        it('flags a repeated barcode at scan Enter and on blur', async () => {
            await open(undefined, DRAFTS);
            await type('EAN / Barcode', '4006381333931');
            expect(fieldError('EAN / Barcode')).toBe('');
            enter('EAN / Barcode');
            await flush();
            expect(fieldError('EAN / Barcode')).toBe(
                'Another draft above already uses this barcode',
            );
            await type('EAN / Barcode', '036000291452');
            expect(fieldError('EAN / Barcode')).toBe('');
            await type('EAN / Barcode', '4006381333931');
            blur('EAN / Barcode');
            await flush();
            expect(repeatButton('ean')?.textContent).toContain(
                'Edit that draft',
            );
        });

        it('flags a repeated name as stored, and refuses Add', async () => {
            await open(undefined, DRAFTS);
            await type('EAN / Barcode', '036000291452');
            await type('Product Name', '  milk ');
            await type('Selling Price', '10');
            await click('Add to Draft');
            expect(fieldError('Product Name')).toBe(
                'Another draft above already uses this name',
            );
            expect(added).toEqual([]);
            expect(api.get).not.toHaveBeenCalledWith(
                'products/ensureValid',
                expect.anything(),
            );
        });

        it('refuses Add while the barcode repeats', async () => {
            await open(undefined, DRAFTS);
            await type('EAN / Barcode', '4006381333931');
            await type('Product Name', 'Other');
            await type('Selling Price', '10');
            await click('Add to Draft');
            expect(fieldError('EAN / Barcode')).toBe(
                'Another draft above already uses this barcode',
            );
            expect(added).toEqual([]);
        });

        it('Edit that draft names the earlier draft and whether input is discarded', async () => {
            await open(undefined, DRAFTS);
            await type('Product Name', 'pens');
            blur('Product Name');
            await flush();
            repeatButton('name')!.click();
            await flush();
            expect(opened).toEqual([['d1', true]]);
        });

        it('reports nothing typed when the edit dialog is unchanged', async () => {
            await open(
                DRAFTS[0],
                [...DRAFTS, { ...DRAFTS[0]!, draftId: 'd3' }],
                'd1',
            );
            blur('EAN / Barcode');
            await flush();
            repeatButton('ean')!.click();
            await flush();
            expect(opened).toEqual([['d3', false]]);
        });

        it('never flags the draft being edited', async () => {
            await open(DRAFTS[0], DRAFTS, 'd1');
            blur('EAN / Barcode');
            blur('Product Name');
            await click('Update Draft');
            expect(fieldError('EAN / Barcode')).toBe('');
            expect(fieldError('Product Name')).toBe('');
            expect(added).toHaveLength(1);
        });

        it('ignores auto-generated barcodes', async () => {
            await open(undefined, DRAFTS);
            await type('EAN / Barcode', '4006381333931');
            blur('EAN / Barcode');
            await flush();
            expect(repeatButton('ean')).not.toBeNull();
            await check('Auto-generate EAN', true);
            await flush();
            expect(fieldError('EAN / Barcode')).toBe('');
            expect(repeatButton('ean')).toBeNull();
        });
    });
});
